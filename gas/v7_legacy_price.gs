/**
 * ===================================================================
 * v7（2026-10-12）：舊價客戶
 * Molly：「250 是新價格，之前還是有一些客戶賣 200」→ 島羽、downstairs 維持舊價、不設期限。
 *
 * 做法：
 *  - legacy_prices 分頁：漲價前的牌價快照（sku_id → legacy_price）。只在主檔改價「之前」跑
 *    setupLegacyPrices() 一次；已有資料的 SKU 不覆蓋（重跑安全）。
 *  - consign_customers.price_basis：'old'＝舊價客戶（空白＝新價）。前端寄售客戶設定可切換。
 *  - 套用處：寄售售出自動鎖價（resolveConsignUnitPrice_）、廠務轉單牌價查找（fxLookupPrice_）、
 *    getOwnbrandProducts 每列多帶 legacy_price、getOwnbrandTiers 多帶 legacy_customers（前端報價單用）。
 *  - 已寫進 consign_ledger 的售出單價不變（當時就鎖了）。
 * ===================================================================
 */
var SHEET_LEGACY_PRICES = 'legacy_prices';
var LEGACY_PRICE_HEADERS = ['sku_id', 'legacy_price', 'note', 'created_at'];

function legacyPriceMap_() {
  var map = {};
  try {
    v2ReadAll_(SHEET_LEGACY_PRICES, LEGACY_PRICE_HEADERS).forEach(function (r) {
      var v = Number(r.legacy_price);
      if (r.sku_id && v > 0) map[String(r.sku_id)] = v;
    });
  } catch (e) {}
  return map;
}

function legacyCustomers_() {
  return v2ReadAll_(SHEET_CONSIGN_CUSTOMERS, CONSIGN_CUSTOMERS_HEADERS).filter(function (c) {
    return String(c.price_basis || '').toLowerCase() === 'old';
  });
}

function isLegacyCustomerId_(customerId) {
  return legacyCustomers_().some(function (c) { return String(c.customer_id) === String(customerId); });
}

/* 名稱比對（跟前端 psIsLegacyClient 同一套）：中文連續 2 字↑、英數連續 4 字↑ 的詞，出現在客戶名稱裡就算 */
function legacyNameTokens_(s) {
  var t = String(s || '').toLowerCase();
  return (t.match(/[一-鿿]{2,}/g) || []).concat(t.match(/[a-z0-9]{4,}/g) || []);
}
function isLegacyClientName_(clientName) {
  var key = String(clientName || '').toLowerCase().replace(/[\s　]+/g, '');
  if (!key) return false;
  return legacyCustomers_().some(function (c) {
    return legacyNameTokens_(c.name).some(function (tok) { return key.indexOf(tok) !== -1; });
  });
}

/* 寄售：這位客戶這支酒該用的牌價 */
function obListPriceForCustomer_(customerId, product) {
  var lp = Number(product.list_price || 0);
  if (!isLegacyCustomerId_(customerId)) return lp;
  var lg = legacyPriceMap_()[String(product.sku_id)];
  return lg > 0 ? lg : lp;
}

/* 一次性設定（在 Apps Script 編輯器手動執行；主檔改價之前跑） */
function setupLegacyPrices_() {   // 2026-10-12 已執行過，改成私有避免誤跑
  var out = [];
  var sh = v2Sheet_(SHEET_LEGACY_PRICES, LEGACY_PRICE_HEADERS);
  var have = legacyPriceMap_();
  var now = tpeNow_();
  var rows = [];
  v2ReadAll_(SHEET_OWNBRAND_PRODUCTS, OWNBRAND_PRODUCTS_HEADERS).forEach(function (p) {
    if (String(p.active).toUpperCase() === 'N') return;
    if (have[String(p.sku_id)]) return;
    var v = Number(p.list_price);
    if (!(v > 0)) return;
    rows.push([p.sku_id, v, '2026-10 統一新價前的牌價', now]);
  });
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, LEGACY_PRICE_HEADERS.length).setValues(rows);
  out.push('legacy_prices 新增 ' + rows.length + ' 筆');

  v2Sheet_(SHEET_CONSIGN_CUSTOMERS, CONSIGN_CUSTOMERS_HEADERS);   // 自動補 price_basis 表頭
  ['2', '4'].forEach(function (cid) {   // 2＝downstairs、4＝島羽（2026-10-12 Molly 指定）
    var r = handleSaveConsignCustomer_({ customer: { customer_id: cid, price_basis: 'old' } });
    out.push(cid + ' ' + (r.customer && r.customer.name) + ' → 舊價');
  });
  logChange_('setupLegacyPrices', '', { msg: out.join(' / ') });
  return out.join(' / ');
}

/* 一次性：主檔「南坡萬公版_v2 / NO1.V2_報價」經典款改統一新價（2026-10-12 Molly 定案）
   100ml 250／500ml 1000／700ml 1350／8000ml 5000（典藏不動、梔子花 8000ml 10000 不動）。
   先把整個分頁複製一份「備份_NO1.V2_報價_20261012」，D 欄（含稅單價）改值；F 欄（報價）若是公式就不動，是數字才改。
   改完立刻同步 ownbrand_products。務必在 setupLegacyPrices() 之後才跑。 */
function applyUnifiedPrice20261012() {
  if (!legacyPriceMap_()['蜜香紅茶荔枝琴酒|100ml']) throw new Error('請先執行 setupLegacyPrices()，舊價還沒存');
  var NEW = { '100ml': 250, '500ml': 1000, '700ml': 1350, '8000ml': 5000 };
  var ss = SpreadsheetApp.openById(OWNBRAND_SOURCE_SHEET_ID);
  var sh = ss.getSheetByName(OWNBRAND_SOURCE_TAB);
  var bkName = '備份_NO1.V2_報價_20261012';
  if (!ss.getSheetByName(bkName)) sh.copyTo(ss).setName(bkName);
  var rng = sh.getDataRange(), vals = rng.getValues(), fx = rng.getFormulas();
  var lastAbv = '', changed = [];
  for (var r = 1; r < vals.length; r++) {
    var abv = String(vals[r][1] || '').trim(); if (abv) lastAbv = abv;
    var vol = String(vals[r][2] || '').trim().toLowerCase().replace(/\s/g, '');
    var n = parseFloat(String(lastAbv).replace('%', '')); if (n < 1) n = n * 100;
    if (!(n < 10) || NEW[vol] === undefined) continue;      // 只動經典（8%）
    var row = r + 1;
    if (!fx[r][3]) { sh.getRange(row, 4).setValue(NEW[vol]); }
    if (!fx[r][5]) { sh.getRange(row, 6).setValue(NEW[vol]); }
    changed.push(row + ':' + vol + (fx[r][3] ? '(D公式未動)' : '') + (fx[r][5] ? '(F公式)' : ''));
  }
  SpreadsheetApp.flush();
  var s = syncOwnbrandProducts_();
  try { CacheService.getScriptCache().remove(CD_CACHE_KEY_); } catch (e) {}
  var msg = '改 ' + changed.length + ' 列：' + changed.join(', ') + ' / 同步 ' + JSON.stringify(s);
  logChange_('applyUnifiedPrice20261012', '', { msg: msg });
  return msg;
}

/* ===================================================================
 * 2026-10-12b：帳號信箱（通路報價單頁尾跟著登入帳號換）
 *  - users 分頁多一欄 email（表頭自動補在最後一欄後面，不動 USERS_HEADERS）
 *  - 老闆帳號（Molly，PIN_CODE 那組）不在 users 分頁 → 存在 Script Properties 的 OWNER_EMAIL
 *  - getOwnbrandTiers 回 user_emails：{ 名字: email }（只給已登入的人，前端報價單用）
 * =================================================================== */
function userEmailMap_() {
  var map = {};
  try {
    var own = PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL');
    if (own) map[OWNER_DISPLAY_NAME] = own;
    var sh = getUsersSheet_();
    var lastCol = sh.getLastColumn(), lastRow = sh.getLastRow();
    if (lastRow < 2) return map;
    var head = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
    var iName = head.indexOf('name'), iMail = head.indexOf('email'), iAct = head.indexOf('active');
    if (iName < 0 || iMail < 0) return map;
    sh.getRange(2, 1, lastRow - 1, lastCol).getValues().forEach(function (r) {
      if (iAct >= 0 && String(r[iAct]) === 'N') return;
      var nm = String(r[iName] || '').trim(), em = String(r[iMail] || '').trim();
      if (nm && em) map[nm] = em;
    });
  } catch (e) {}
  return map;
}

/* 一次性：寫入三人信箱（2026-10-12 Molly 提供） */
function setupUserEmails20261012() {
  var MAIL = { 'Kevin': 'kevin_huang@kevinnumber1-cocktail.com', 'Vic': 'vic_kuo@kevinnumber1-cocktail.com' };
  PropertiesService.getScriptProperties().setProperty('OWNER_EMAIL', 'molly_lin@kevinnumber1-cocktail.com');
  var sh = getUsersSheet_();
  var lastCol = sh.getLastColumn();
  var head = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  var iMail = head.indexOf('email');
  if (iMail < 0) { iMail = lastCol; sh.getRange(1, lastCol + 1).setValue('email').setFontWeight('bold'); }
  var iName = head.indexOf('name');
  var out = ['OWNER_EMAIL 已設'];
  var lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    var names = sh.getRange(2, iName + 1, lastRow - 1, 1).getValues();
    names.forEach(function (r, i) {
      var nm = String(r[0] || '').trim();
      var key = Object.keys(MAIL).filter(function (k) { return k.toLowerCase() === nm.toLowerCase(); })[0];
      if (key) { sh.getRange(i + 2, iMail + 1).setValue(MAIL[key]); out.push(nm + ' → ' + MAIL[key]); }
    });
  }
  Logger.log(out.join(' / '));
  return out.join(' / ');
}

/* ===================================================================
 * 2026-10-12b：定價毛利試算表加「寄售 7 折」情境（多數寄售客戶 7 折）
 *  - 在「寄售 標準 75折」參數列下面插一列「寄售 7折（多數寄售客戶）」0.7（黃色可改）
 *  - 在 75折寄售那三欄（寄售價／毛利**／毛利率）右邊插三欄 7折寄售價／毛利**／毛利率，
 *    公式同 75 折那組（寄售運費買方負擔不扣運費），格式＋顏色規則照抄
 *  - 跑之前先整頁備份「備份_定價毛利試算表_20261012」
 * =================================================================== */
function addConsign70Scenario20261012() {
  var ss = SpreadsheetApp.openById(OWNBRAND_SOURCE_SHEET_ID);
  var sh = ss.getSheetByName('定價毛利試算表');
  if (!sh) throw new Error('找不到分頁：定價毛利試算表');
  var bk = '備份_定價毛利試算表_20261012';
  if (!ss.getSheetByName(bk)) sh.copyTo(ss).setName(bk);
  var colA = sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map(function (r) { return String(r[0]); });
  if (colA.some(function (s) { return s.indexOf('寄售 7折') === 0; })) return '已經加過了，略過';
  var pRow = colA.findIndex(function (s) { return s.indexOf('寄售 標準') === 0; }) + 1;
  if (pRow < 1) throw new Error('找不到「寄售 標準」參數列');
  sh.insertRowAfter(pRow);
  var newP = pRow + 1;
  sh.getRange(pRow, 1, 1, 3).copyTo(sh.getRange(newP, 1, 1, 3));   // 連格式（黃格）一起
  sh.getRange(newP, 1).setValue('寄售 7折（多數寄售客戶）');
  sh.getRange(newP, 2).setValue(0.7);
  sh.getRange(newP, 3).clearContent();
  // 表頭列＝A 欄是「品名」那列
  colA = sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map(function (r) { return String(r[0]); });
  var hRow = colA.indexOf('品名') + 1;
  var lastCol = sh.getLastColumn();
  var head = sh.getRange(hRow, 1, 1, lastCol).getValues()[0].map(String);
  var rCol = head.findIndex(function (s) { return s.indexOf('寄售價') >= 0; }) + 1;   // 75折寄售價
  if (rCol < 1) throw new Error('找不到寄售價欄');
  var first = hRow + 1, last = first;
  while (last + 1 <= sh.getLastRow() && String(sh.getRange(last + 1, 3).getValue()).match(/ml$/)) last++;
  var n = last - first + 1;
  sh.insertColumnsAfter(rCol + 2, 3);
  var c0 = rCol + 3;
  sh.getRange(hRow, rCol, n + 1, 3).copyTo(sh.getRange(hRow, c0, n + 1, 3), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  sh.getRange(hRow, c0, 1, 3).setValues([['7折寄售價', '毛利**', '毛利率']]);
  var L = function (c) { return sh.getRange(1, c).getA1Notation().replace(/\d+/, ''); };
  var D = 'D', E = 'E', P = L(c0), S = L(c0 + 1);
  var f = [];
  for (var r = first; r <= last; r++) {
    f.push(['=ROUND(' + D + r + '*$B$' + newP + ',0)', '=ROUND(' + P + r + '-' + E + r + ',0)', '=IF(' + P + r + '=0,0,' + S + r + '/' + P + r + ')']);
  }
  sh.getRange(first, c0, n, 3).setFormulas(f);
  // 75折那組的顏色規則（條件式格式）若只套在原欄，複製一份到新毛利率欄
  var rules = sh.getConditionalFormatRules(), add = [];
  var tColA1 = L(rCol + 2);
  rules.forEach(function (rule) {
    var hit = rule.getRanges().some(function (rg) { return rg.getColumn() <= rCol + 2 && rg.getLastColumn() >= rCol + 2 && rg.getColumn() >= rCol; });
    if (!hit) return;
    var b = rule.copy().setRanges([sh.getRange(first, c0 + 2, n, 1)]);
    var cond = rule.getBooleanCondition();
    if (cond && cond.getCriteriaType() === SpreadsheetApp.BooleanCriteria.CUSTOM_FORMULA) {
      var re = new RegExp('(^|[^A-Z$])(\\$?)' + tColA1 + '(\\$?\\d+)', 'g');
      var fx = String(cond.getCriteriaValues()[0]).replace(re, '$1$2' + L(c0 + 2) + '$3');
      b.whenFormulaSatisfied(fx);
    }
    add.push(b.build());
  });
  if (add.length) sh.setConditionalFormatRules(rules.concat(add));
  var msg = '參數列 ' + newP + '（0.7）／新增欄 ' + P + ':' + L(c0 + 2) + '／資料列 ' + first + '-' + last + '（' + n + ' 列）／複製顏色規則 ' + add.length + ' 條';
  Logger.log(msg);
  return msg;
}
