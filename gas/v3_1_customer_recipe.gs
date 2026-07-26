/**
 * ===================================================================
 * v3.1 擴充：客戶酒譜同步（品名/容量/售價 → products）
 * 依據專案文件「規格_v3.1_客戶酒譜同步與貼牌OEM.md」實作（2026-07-24，對話 B）
 *
 * 本檔只「新增」，不動 程式碼.gs / v2_extensions.gs / v3_ownbrand.gs 既有函式。
 * 程式碼.gs 僅修改 handleRequest_ 的 switch：新增 syncCustomerProducts /
 * syncAllCustomerProducts 兩個 action 分派。
 *
 * 背景：只自動同步客戶酒譜表的「品名/容量/售價」到 products 的
 * name/spec/unit_price 三欄；其餘欄位（label_fee/logo_fee/moq/note/
 * default_pay_terms…）維持手動維護，同步永遠不會動到。
 *
 * 比對邏輯：讀 companies.recipe_sheet_id / recipe_tab 指定的外部試算表，
 * 用標題列比對「品名/容量/售價」三欄（內建別名見下方常數）；
 * companies.recipe_col_map（選填 JSON，例如 {"name":"酒款","spec":"容量",
 * "price":"報價"}）可在自動比對失敗時覆寫指定欄位標題文字。
 *
 * 以 company_id + name + spec（去除頭尾空白後完全相等）為鍵 upsert：
 * - 找得到 → 只更新 unit_price（name/spec 本來就相等，不需要動）
 * - 找不到但品名/容量/售價三者都能正常解析 → 視為新品項，新增一列
 * - 品名或容量空白、售價無法解析成數字 → 不寫入，列進 unmatched 回傳
 *   （不會自動亂新增或亂覆寫，讓 Molly 自己確認後手動處理）
 *
 * 初始化順序（手動在編輯器執行一次）：
 * 1. setupCustomerRecipeColumns()（在 v2_extensions.gs，已建立 companies
 *    的 recipe_sheet_id / recipe_tab / recipe_col_map 三欄）
 * 2. 在 companies 分頁填入各客戶的 recipe_sheet_id / recipe_tab
 * 3. 呼叫 syncCustomerProducts {company_id} 測試單一客戶，或執行
 *    syncAllCustomerProducts_() 對全部客戶跑一輪
 * 4. setupCustomerRecipeSyncTrigger() 建立每日自動同步觸發器
 * ===================================================================
 */

// 標題比對用內建別名（依規格文件第三節 A）
var RECIPE_NAME_ALIASES_ = ['品名', '酒名', '酒款名稱', '商品名稱'];
var RECIPE_SPEC_ALIASES_ = ['容量', '容量(ml)', '規格', 'spec'];
var RECIPE_PRICE_ALIASES_ = ['售價', '單價', '含稅單價', '報價', '零售價'];

// ===================================================================
// 依標題列比對出「品名/容量/售價」三欄的欄位索引（0-based）。
// colMapJson（companies.recipe_col_map，選填）可覆寫個別欄位的比對文字，
// 格式：{"name":"實際標題文字","spec":"...","price":"..."}
// ===================================================================
function resolveRecipeColIndexes_(headerRow, colMapJson) {
  var colMap = {};
  if (colMapJson) {
    try { colMap = JSON.parse(colMapJson) || {}; } catch (e) { colMap = {}; }
  }
  var headers = headerRow.map(function (h) { return String(h || '').trim(); });

  function findCol(aliasList, override) {
    if (override) {
      var idx = headers.indexOf(String(override).trim());
      if (idx !== -1) return idx;
    }
    for (var i = 0; i < headers.length; i++) {
      if (aliasList.indexOf(headers[i]) !== -1) return i;
    }
    return -1;
  }

  return {
    nameIdx: findCol(RECIPE_NAME_ALIASES_, colMap.name),
    specIdx: findCol(RECIPE_SPEC_ALIASES_, colMap.spec),
    priceIdx: findCol(RECIPE_PRICE_ALIASES_, colMap.price)
  };
}

// 售價欄可能是數字或帶符號的字串（$1,200 / 1200元 等），統一解析成數字；
// 解析不出來回傳 null（列入 unmatched，不亂寫入）
function parseRecipePrice_(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return isNaN(v) ? null : v;
  var s = String(v).replace(/[,$\s元]/g, '');
  if (s === '') return null;
  var n = Number(s);
  return isNaN(n) ? null : n;
}

function formatRecipeSpec_(v) {
  return String(v === null || v === undefined ? '' : v).trim();
}

// ===================================================================
// 單一客戶同步：讀 companies.recipe_sheet_id/recipe_tab，比對三欄，
// upsert products；回傳 { added, updated, unmatched }
// ===================================================================
function syncCustomerProducts_(companyId) {
  if (!companyId) throw new Error('缺少 company_id');

  var companies = v2ReadAll_(SHEET_COMPANIES, COMPANIES_HEADERS);
  var company = companies.filter(function (c) { return String(c.company_id) === String(companyId); })[0];
  if (!company) throw new Error('找不到 company_id：' + companyId);

  var sheetId = company.recipe_sheet_id;
  var tabName = company.recipe_tab;
  if (!sheetId || !tabName) {
    return { added: 0, updated: 0, unmatched: [], skipped_reason: '該客戶尚未設定 recipe_sheet_id / recipe_tab' };
  }

  var srcSs;
  try {
    srcSs = SpreadsheetApp.openById(sheetId);
  } catch (e) {
    throw new Error('無法開啟客戶酒譜表（recipe_sheet_id 錯誤或無權限存取）：' + sheetId);
  }
  var srcSh = srcSs.getSheetByName(tabName);
  if (!srcSh) throw new Error('客戶酒譜表找不到分頁：' + tabName);

  var all = srcSh.getDataRange().getValues();
  if (all.length < 2) return { added: 0, updated: 0, unmatched: [] };

  var headerRow = all[0];
  var idx = resolveRecipeColIndexes_(headerRow, company.recipe_col_map);
  if (idx.nameIdx === -1 || idx.specIdx === -1 || idx.priceIdx === -1) {
    var missing = [];
    if (idx.nameIdx === -1) missing.push('品名');
    if (idx.specIdx === -1) missing.push('容量');
    if (idx.priceIdx === -1) missing.push('售價');
    throw new Error('酒譜表標題比對失敗，找不到欄位：' + missing.join('、') + '（可在 companies.recipe_col_map 指定，例如 {"name":"實際欄位標題"}）');
  }

  var unmatched = [];
  var sourceItems = [];
  var dataRows = all.slice(1);

  dataRows.forEach(function (row, i) {
    var rawName = row[idx.nameIdx];
    var rawSpec = row[idx.specIdx];
    var rawPrice = row[idx.priceIdx];

    var name = String(rawName || '').trim();
    var spec = formatRecipeSpec_(rawSpec);
    var price = parseRecipePrice_(rawPrice);

    // 整列空白（品名/容量/售價都沒有）→ 略過，不算 unmatched
    if (!name && !spec && (rawPrice === '' || rawPrice === null || rawPrice === undefined)) return;

    if (!name || !spec || price === null) {
      unmatched.push({
        row: i + 2,
        name: name || '(空白)',
        spec: spec || '',
        price: rawPrice,
        reason: !name ? '品名空白' : (!spec ? '容量空白' : '售價無法解析')
      });
      return;
    }

    sourceItems.push({ name: name, spec: spec, unit_price: price });
  });

  var sh = v2Sheet_(SHEET_PRODUCTS, PRODUCTS_HEADERS);
  var cIdx = PRODUCTS_HEADERS.indexOf('company_id');
  var nIdx = PRODUCTS_HEADERS.indexOf('name');
  var sIdx = PRODUCTS_HEADERS.indexOf('spec');
  var priceCol = PRODUCTS_HEADERS.indexOf('unit_price') + 1;

  var existingKey = {};
  var lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    var vals = sh.getRange(2, 1, lastRow - 1, PRODUCTS_HEADERS.length).getValues();
    vals.forEach(function (r, i) {
      if (String(r[cIdx]) !== String(companyId)) return;
      var key = String(r[cIdx]) + '||' + String(r[nIdx]).trim() + '||' + String(r[sIdx]).trim();
      existingKey[key] = i + 2;
    });
  }

  var added = 0, updated = 0;
  sourceItems.forEach(function (item) {
    var key = String(companyId) + '||' + item.name + '||' + item.spec;
    if (existingKey[key]) {
      sh.getRange(existingKey[key], priceCol).setValue(item.unit_price);
      updated++;
    } else {
      var productId = companyId + '-' + Utilities.getUuid().slice(0, 8);
      var newRow = PRODUCTS_HEADERS.map(function (h) {
        if (h === 'product_id') return productId;
        if (h === 'company_id') return companyId;
        if (h === 'name') return item.name;
        if (h === 'spec') return item.spec;
        if (h === 'unit_price') return item.unit_price;
        if (h === 'active') return 'Y';
        return '';
      });
      sh.appendRow(newRow);
      added++;
    }
  });

  logChange_('syncCustomerProducts', companyId, { added: added, updated: updated, unmatched: unmatched.length });
  return { added: added, updated: updated, unmatched: unmatched };
}

function handleSyncCustomerProducts_(params) {
  var companyId = params.company_id;
  if (!companyId) throw new Error('缺少 company_id');
  var r = syncCustomerProducts_(companyId);
  return { ok: true, summary: { added: r.added, updated: r.updated, unmatched: r.unmatched } };
}

// ===================================================================
// 對所有 recipe_sheet_id 非空的客戶各跑一輪；單一客戶失敗不影響其他客戶
// ===================================================================
function syncAllCustomerProducts_() {
  var companies = v2ReadAll_(SHEET_COMPANIES, COMPANIES_HEADERS);
  var results = [];
  companies.forEach(function (c) {
    if (!c.recipe_sheet_id) return;
    try {
      var r = syncCustomerProducts_(c.company_id);
      results.push({ company_id: c.company_id, ok: true, added: r.added, updated: r.updated, unmatched: r.unmatched.length });
    } catch (e) {
      results.push({ company_id: c.company_id, ok: false, error: String(e) });
    }
  });
  return results;
}

function handleSyncAllCustomerProducts_(params) {
  var results = syncAllCustomerProducts_();
  return { ok: true, results: results };
}

// 每日觸發器目標（非底線函式，確保觸發器可掛且不會被 Run 選單隱藏）
function runCustomerRecipeSync() {
  return syncAllCustomerProducts_();
}

// 建立/重建每日同步觸發器（手動執行一次）；可跟公版同步共用清晨晪段
function setupCustomerRecipeSyncTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function (t) {
    if (t.getHandlerFunction() === 'runCustomerRecipeSync') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('runCustomerRecipeSync').timeBased().everyDays(1).atHour(3).create();
  return 'daily trigger (runCustomerRecipeSync, ~03:00 Asia/Taipei) created';
}
