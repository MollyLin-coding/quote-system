/**
 * ===================================================================
 * v2 擴充：公司報價檔＋訂單進度追蹤＋自訂單備份＋工作行事曆＋異動日誌
 * 依據專案文件「規格_對話B_公司報價檔與訂單追蹤.md」實作（2026-07-15，對話 B）
 *
 * 本檔只「新增」，不動 程式碼.gs 的既有函式。
 * 程式碼.gs 僅修改 handleRequest_ 的 switch：
 *   1. 新增 9 個新 action 的分派
 *   2. createQuote / updateQuote / deleteQuote / generateQuoteDocument
 *      成功後追加 change_log（異動日誌）
 *
 * 新增 action：
 * - getCompanyData      回傳 companies/products/rules 三分頁 active 資料
 * - getOrderStatusList  回傳 order_status 全部列
 * - updateOrderStatus   {quote_no, fields:{...}} upsert，回傳整列
 * - saveCustomQuote     custom_quotes 整列欄位，以 quote_no upsert
 * - listCustomQuotes    回傳 custom_quotes 全部列（含 items_json）
 * - listCalendarItems   回傳 calendar_items 全部列
 * - saveCalendarItem    calendar_items 整列欄位，以 item_id upsert
 * - deleteCalendarItem  {item_id} 刪除（刪除前整列寫入 change_log）
 * - getChangeLog        {ref_no}（可選）回傳異動紀錄，新到舊
 *
 * 初始化：在編輯器手動執行一次 setupV2Sheets()
 *   → 建立 7 個分頁（含表頭）＋測試資料（1 家公司、2 品項、1 免運規則、2 行事曆項目）
 * ===================================================================
 */

const SHEET_COMPANIES = 'companies';
const SHEET_PRODUCTS = 'products';
const SHEET_RULES = 'rules';
const SHEET_CUSTOM_QUOTES = 'custom_quotes';
const SHEET_ORDER_STATUS = 'order_status';
const SHEET_CALENDAR = 'calendar_items';
const SHEET_CHANGELOG = 'change_log';

const COMPANIES_HEADERS = ['company_id','name','tax_id','address','brand','contact','phone','default_tax_mode','default_pay_terms','note','active','ship_contact','ship_phone','ship_address','recipe_sheet_id','recipe_tab','recipe_col_map'];
const PRODUCTS_HEADERS = ['product_id','company_id','name','spec','unit','unit_price','tier_json','label_fee','logo_fee','note','active','bottle_cap','moq','lead_time'];
const RULES_HEADERS = ['rule_id','company_id','rule_type','params_json','display_text','active'];
const CUSTOM_QUOTES_HEADERS = ['quote_no','tag','client','contact','quote_date','expiry','tax_mode','tax_rate','headers_json','items_json','totals_json','created_at','updated_at','client_json'];
const ORDER_STATUS_HEADERS = ['quote_no','status','deposit_amt','deposit_date','ship_date_est','ship_date_actual','invoice_no','invoice_date','final_amt','final_date','track_note','updated_at','grand_total','invoice_last5','invoice_detail','invoice_photos','final_date_est','closed_at','cust_lot'];

/* v32：有效狀態（與前端 effOrdStatus 同一套規則）。
   手動狀態 vs 依實際填寫日期推得的狀態，取比較後面的：
   訂金日→排產中(production)、實際出貨日→已出貨、發票→已開發票、尾款收款日→已收尾款。
   已取消一律尊重手動。給行事曆同步與今日待辦用，避免狀態忘了改就漏提醒。 */
function effOrdStatus_(o) {
  o = o || {};
  var s = String(o.status || 'quoted') || 'quoted';
  if (s === 'cancelled') return s;
  var idx = { quoted: 1, deposit: 2, production: 3, shipped: 4, invoiced: 5, paid: 6, closed: 7 };
  var has = function (v) { return String(v === null || v === undefined ? '' : v).trim() !== ''; };
  var d = 'quoted';
  if (has(o.deposit_date)) d = 'production';
  if (has(o.ship_date_actual)) d = 'shipped';
  if (has(o.invoice_date) || has(o.invoice_no)) d = 'invoiced';
  if (has(o.final_date)) d = 'paid';
  return (idx[d] || 1) > (idx[s] || 1) ? d : s;
}

var SHEET_QUOTE_PDFS = 'quote_pdfs';
var QUOTE_PDF_HEADERS = ['quote_no','created_at','pdf_url','doc_url','file_name','active','note'];
var SHEET_ORDER_SHIPMENTS = 'order_shipments';
var ORDER_SHIP_HEADERS = ['id','quote_no','seq','ship_date_est','ship_date_actual','amount','invoice_no','invoice_last5','note','created_at','updated_at'];
var INVOICE_IMG_ROOT = '發票照片';
const CALENDAR_HEADERS = ['item_id','kind','date','recur_json','title','detail','category','priority','done','done_date','created_at','updated_at','time','all_day','source_quote_no','repeat_interval'];
const CHANGELOG_HEADERS = ['ts','action','ref_no','payload_json'];

// ===================================================================
// 初始化：建立 v2 分頁與測試資料（手動執行一次；可重複執行，不會清掉既有資料）
// ===================================================================
function setupV2Sheets() {
  const created = [];
  v2Sheet_(SHEET_COMPANIES, COMPANIES_HEADERS);
  v2Sheet_(SHEET_PRODUCTS, PRODUCTS_HEADERS);
  v2Sheet_(SHEET_RULES, RULES_HEADERS);
  v2Sheet_(SHEET_CUSTOM_QUOTES, CUSTOM_QUOTES_HEADERS);
  v2Sheet_(SHEET_ORDER_STATUS, ORDER_STATUS_HEADERS);
  v2Sheet_(SHEET_CALENDAR, CALENDAR_HEADERS);
  v2Sheet_(SHEET_CHANGELOG, CHANGELOG_HEADERS);

  // 測試資料：只在分頁還沒有任何資料列時寫入（避免重複執行時塞重複資料）
  const now = tpeNow_();

  if (v2IsEmpty_(SHEET_COMPANIES)) {
    v2Append_(SHEET_COMPANIES, COMPANIES_HEADERS, [
      ['TESTCO','測試公司（請照此格式填正式資料）','12345678','台北市測試路1號','測試聯絡人','0912-345-678','exc','月結30天','這整列是測試資料，可直接刪除','Y','測試品牌']
    ]);
    created.push('companies 測試公司 x1');
  }
  if (v2IsEmpty_(SHEET_PRODUCTS)) {
    v2Append_(SHEET_PRODUCTS, PRODUCTS_HEADERS, [
      ['TESTCO-P1','TESTCO','測試琴酒（瓶裝）','750','',520,'[{"min":0,"max":299,"price":520},{"min":300,"price":480}]',3.5,10,'測試品項：瓶裝＋數量級距價','Y'],
      ['TESTCO-P2','TESTCO','宴會基礎方案','40,000ml','式',25000,'','','','測試品項：宴會/自訂通用','Y']
    ]);
    created.push('products 測試品項 x2');
  }
  if (v2IsEmpty_(SHEET_RULES)) {
    v2Append_(SHEET_RULES, RULES_HEADERS, [
      ['TESTCO-R1','TESTCO','free_ship_threshold','{"min_qty":600,"ship_fee":1500}','整批出貨免運（600瓶以上）','Y']
    ]);
    created.push('rules 免運規則 x1');
  }
  if (v2IsEmpty_(SHEET_CALENDAR)) {
    v2Append_(SHEET_CALENDAR, CALENDAR_HEADERS, [
      ['test-memo-001','memo','2026-07-20','','測試備忘：檢查酒標到貨','這是測試資料，可直接刪除','工作','','N','',now,now],
      ['test-todo-001','todo','','','測試待辦：回覆客戶報價','這是測試資料，可直接刪除','工作','high','N','',now,now]
    ]);
    created.push('calendar_items 測試項目 x2');
  }

  return 'v2 分頁建置完成。' + (created.length ? '寫入測試資料：' + created.join('、') : '測試資料已存在，未重複寫入。');
}

// ===================================================================
// 共用小工具
// ===================================================================
var V2_HDR_OK_ = {};   // v39：同一次請求裡，同一張表的表頭只檢查一次
function v2Sheet_(name, headers) {
  const ss = ssApp_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    V2_HDR_OK_[name] = false;
  }
  if (V2_HDR_OK_[name]) return sh;   // 這次請求已經檢查過了，省下一趟讀取
  V2_HDR_OK_[name] = true;
  // 表頭列空白時補上表頭（不動既有資料）
  if (String(sh.getRange(1, 1).getValue()) === '') {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#1B4D2E')
      .setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  }
  return sh;
}

function v2IsEmpty_(name) {
  const ss = ssApp_();
  const sh = ss.getSheetByName(name);
  return !sh || sh.getLastRow() < 2;
}

function v2Append_(name, headers, rows) {
  const sh = v2Sheet_(name, headers);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
}

// 讀取整個分頁 → 物件陣列（key＝表頭欄名；日期欄轉 yyyy-MM-dd 字串）
function v2ReadAll_(name, headers) {
  const sh = v2Sheet_(name, headers);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  const data = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return data.map(function (row) {
    const o = {};
    headers.forEach(function (h, i) {
      let v = row[i];
      if (v instanceof Date) {
        // 純時間值（如 10:30）Sheets 會存成 1899-12-30 那天的時間；
        // 以前一律轉成日期字串，會變成沒意義的 "1899-12-30"，這裡改成回 HH:mm
        v = (v.getFullYear() < 1900)
          ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'HH:mm')
          : Utilities.formatDate(v, 'Asia/Taipei', 'yyyy-MM-dd');
      }
      o[h] = v;
    });
    return o;
  });
}

// 以 keyCol 尋找列號（回傳 sheet 實際列號，找不到回傳 -1）
function v2FindRow_(name, headers, keyCol, keyVal) {
  const sh = v2Sheet_(name, headers);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return -1;
  const colIdx = headers.indexOf(keyCol) + 1;
  const vals = sh.getRange(2, colIdx, lastRow - 1, 1).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i][0]) === String(keyVal)) return i + 2;
  }
  return -1;
}

// 物件裡若是物件/陣列就 stringify，其他原樣（items_json 等欄位保險用）
function v2AsCell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

// ===================================================================
// 異動日誌：所有寫入 action 成功後呼叫；只追加、永不修改或刪除
// ===================================================================
function logChange_(action, refNo, payload) {
  try {
    const sh = v2Sheet_(SHEET_CHANGELOG, CHANGELOG_HEADERS);
    sh.appendRow([tpeNow_(), action, refNo || '', JSON.stringify(payload || {})]);
  } catch (e) {
    // 日誌失敗絕不能影響主要流程
  }
}

// ===================================================================
// action: getCompanyData —— companies/products/rules 三分頁 active 資料一包
// ===================================================================
/* ---- 公司報價檔快取（v33）：少變動、每次進報價頁都要拉，先放 5 分鐘 ---- */
var CD_CACHE_KEY_ = 'COMPANY_DATA_V1';
var CD_CACHE_SEC_ = 300;
// 這些 action 會動到 companies/products/rules，跑完自動把快取清掉
var CD_CACHE_BUSTERS_ = ['syncOwnbrandProducts', 'syncCustomerProducts', 'syncAllCustomerProducts',
  'saveConsignCustomer', 'saveConsignDiscount', 'deleteConsignDiscount'];

function cdCacheClear_() {
  try { CacheService.getScriptCache().remove(CD_CACHE_KEY_); } catch (e) {}
}

function handleGetCompanyData_(params) {
  const p = params || {};
  const skipCache = (p.refresh === true || String(p.refresh) === 'true');
  let cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) { cache = null; }

  if (cache && !skipCache) {
    try {
      const hit = cache.get(CD_CACHE_KEY_);
      if (hit) {
        const cached = JSON.parse(hit);
        cached.cached = true;
        return cached;
      }
    } catch (e) {}
  }

  const isActive = function (o) { return String(o.active).toUpperCase() !== 'N'; };
  const out = {
    ok: true,
    companies: v2ReadAll_(SHEET_COMPANIES, COMPANIES_HEADERS).filter(isActive),
    products: v2ReadAll_(SHEET_PRODUCTS, PRODUCTS_HEADERS).filter(isActive),
    rules: v2ReadAll_(SHEET_RULES, RULES_HEADERS).filter(isActive)
  };
  if (cache) {
    // 超過 CacheService 上限（100KB）會丟例外，靜靜跳過就好，不影響回傳
    try { cache.put(CD_CACHE_KEY_, JSON.stringify(out), CD_CACHE_SEC_); } catch (e) {}
  }
  return out;
}

// ===================================================================
// action: getOrderStatusList —— order_status 全部列（track_note 完整回傳）
// ===================================================================
function handleGetOrderStatusList_(params) {
  let orders = v2ReadAll_(SHEET_ORDER_STATUS, ORDER_STATUS_HEADERS);
  // v33 選填 limit/since：有帶才排序＋裁切，不帶＝順序與內容完全照舊
  if (listHasOpts_(params)) {
    orders = orders.slice().sort(function (a, b) {
      return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
    });
    orders = applyListOpts_(orders, params, 'updated_at');
  }
  return { ok: true, orders: orders };
}

// ===================================================================
// action: updateOrderStatus —— {quote_no, fields:{...}} upsert，回傳更新後整列
// ===================================================================
function handleUpdateOrderStatus_(params) {
  const quoteNo = params.quote_no;
  const fields = params.fields || {};
  if (!quoteNo) throw new Error('缺少 quote_no');

  const sh = v2Sheet_(SHEET_ORDER_STATUS, ORDER_STATUS_HEADERS);
  const now = tpeNow_();
  let rowNum = v2FindRow_(SHEET_ORDER_STATUS, ORDER_STATUS_HEADERS, 'quote_no', quoteNo);

  // v30: 結案時自動填結案日（未帶 closed_at 時）；v32 修正：前端存的是 'closed' 不是中文
  if ((fields.status === 'closed' || fields.status === '結案') && (fields.closed_at === undefined || fields.closed_at === '')) {
    fields.closed_at = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  }
  // v30: 新單自動帶 50/50 訂金尾款（未指定金額時，總額取自主表或前端傳入）
  if (rowNum === -1) {
    var _gt = Number(fields.grand_total);
    if (!_gt) { _gt = orderGrandTotal_(quoteNo); }
    if (_gt > 0) {
      if (fields.grand_total === undefined || fields.grand_total === '') fields.grand_total = _gt;
      var _depEmpty = (fields.deposit_amt === undefined || fields.deposit_amt === '');
      var _finEmpty = (fields.final_amt === undefined || fields.final_amt === '');
      if (_depEmpty && _finEmpty) {
        var _dep = Math.round(_gt * 0.5);
        fields.deposit_amt = _dep;
        fields.final_amt = _gt - _dep;
      }
    }
  }

  if (rowNum === -1) {
    const newRow = ORDER_STATUS_HEADERS.map(function (h) {
      if (h === 'quote_no') return quoteNo;
      if (h === 'updated_at') return now;
      return v2AsCell_(fields[h]);
    });
    sh.appendRow(newRow);
    rowNum = sh.getLastRow();
  } else {
    ORDER_STATUS_HEADERS.forEach(function (h, i) {
      if (h === 'quote_no' || h === 'updated_at') return;
      if (fields[h] !== undefined) {
        sh.getRange(rowNum, i + 1).setValue(v2AsCell_(fields[h]));
      }
    });
    sh.getRange(rowNum, ORDER_STATUS_HEADERS.indexOf('updated_at') + 1).setValue(now);
  }

  const rowVals = sh.getRange(rowNum, 1, 1, ORDER_STATUS_HEADERS.length).getValues()[0];
  const order = {};
  ORDER_STATUS_HEADERS.forEach(function (h, i) {
    let v = rowVals[i];
    if (v instanceof Date) v = Utilities.formatDate(v, 'Asia/Taipei', 'yyyy-MM-dd');
    order[h] = v;
  });

  logChange_('updateOrderStatus', quoteNo, order);
  return { ok: true, order: order };
}

// ===================================================================
// action: saveCustomQuote —— custom_quotes 整列欄位，以 quote_no upsert
// 參數：params.quote（物件，欄位名同分頁表頭）；也接受直接放在 params 頂層
// 後端補充行為（已於規格文件補記）：儲存成功後若 order_status 尚無該單號，
// 自動建一筆 status='quoted'，避免自訂單漏進訂單追蹤。
// ===================================================================
function orderGrandTotal_(quoteNo) {
  try {
    var ss = ssApp_();
    var sh = ss.getSheetByName(SHEET_MAIN);
    if (!sh) return 0;
    var last = sh.getLastRow();
    if (last < 2) return 0;
    var w = effW_(sh, MAIN_HEADERS);
    var data = sh.getRange(2, 1, last - 1, w).getValues();
    var qi = MAIN_COLS.quoteNo - 1, gi = MAIN_COLS.grandTotal - 1;
    for (var r = 0; r < data.length; r++) {
      if (String(data[r][qi]) === String(quoteNo)) return Number(data[r][gi]) || 0;
    }
    return 0;
  } catch (e) { return 0; }
}

function setupOrderStatusV30Columns() {
  var ss = ssApp_();
  var sh = ss.getSheetByName(SHEET_ORDER_STATUS);
  if (!sh) { v2Sheet_(SHEET_ORDER_STATUS, ORDER_STATUS_HEADERS); return 'order_status 新建，含 ' + ORDER_STATUS_HEADERS.length + ' 欄'; }
  var out = [];
  for (var i = 0; i < ORDER_STATUS_HEADERS.length; i++) {
    var col = i + 1, name = ORDER_STATUS_HEADERS[i];
    var maxc = sh.getMaxColumns();
    if (maxc < col) sh.insertColumnsAfter(maxc, col - maxc);
    if (String(sh.getRange(1, col).getValue()) === '') {
      sh.getRange(1, col).setValue(name).setFontWeight('bold').setBackground('#1B4D2E').setFontColor('#FFFFFF');
      out.push(col + '=' + name);
    }
  }
  return out.length ? ('新增欄位: ' + out.join(', ')) : ('欄位皆已存在，共 ' + ORDER_STATUS_HEADERS.length + ' 欄');
}

// ===== v31: 報價單 PDF 版本歷史 =====
function qpFileIdFromUrl_(url) {
  if (!url) return '';
  var m = String(url).match(/[-A-Za-z0-9_]{25,}/);
  return m ? m[0] : '';
}
function qpTrashByUrl_(url) {
  var id = qpFileIdFromUrl_(url);
  if (!id) return false;
  try { DriveApp.getFileById(id).setTrashed(true); return true; } catch (e) { return false; }
}
function quotePdfAppend_(quoteNo, pdfUrl, docUrl, fileName) {
  var sh = v2Sheet_(SHEET_QUOTE_PDFS, QUOTE_PDF_HEADERS);
  var now = tpeNow_();
  var row = QUOTE_PDF_HEADERS.map(function (h) {
    if (h === 'quote_no') return quoteNo;
    if (h === 'created_at') return now;
    if (h === 'pdf_url') return v2AsCell_(pdfUrl);
    if (h === 'doc_url') return v2AsCell_(docUrl);
    if (h === 'file_name') return v2AsCell_(fileName);
    if (h === 'active') return 'TRUE';
    return '';
  });
  sh.appendRow(row);
}
function quotePdfMarkInactive_(quoteNo) {
  var sh = v2Sheet_(SHEET_QUOTE_PDFS, QUOTE_PDF_HEADERS);
  var last = sh.getLastRow();
  if (last < 2) return;
  var qi = QUOTE_PDF_HEADERS.indexOf('quote_no');
  var ai = QUOTE_PDF_HEADERS.indexOf('active');
  var vals = sh.getRange(2, 1, last - 1, QUOTE_PDF_HEADERS.length).getValues();
  for (var r = 0; r < vals.length; r++) {
    if (String(vals[r][qi]) === String(quoteNo)) {
      sh.getRange(r + 2, ai + 1).setValue('FALSE');
    }
  }
}
function handleListQuotePdfs_(params) {
  var quoteNo = params.quote_no || params.quoteNo;
  if (!quoteNo) throw new Error('缺少 quote_no');
  var all = v2ReadAll_(SHEET_QUOTE_PDFS, QUOTE_PDF_HEADERS);
  var list = all.filter(function (o) { return String(o.quote_no) === String(quoteNo); });
  return { ok: true, quote_no: quoteNo, versions: list };
}

// ===== v31: 發票照片上傳存 Drive =====
function invoiceImgFolder_(quoteNo) {
  var roots = DriveApp.getFoldersByName(INVOICE_IMG_ROOT);
  var root = roots.hasNext() ? roots.next() : DriveApp.createFolder(INVOICE_IMG_ROOT);
  var name = 'inv_' + quoteNo;
  var it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}
function handleSaveInvoicePhotos_(params) {
  var quoteNo = params.quote_no || params.quoteNo;
  if (!quoteNo) throw new Error('缺少 quote_no');
  var images = params.images || [];
  var folder = invoiceImgFolder_(quoteNo);
  var added = 0;
  for (var i = 0; i < images.length; i++) {
    var img = images[i];
    if (!img || !img.data) continue;
    var mime = img.mime || 'image/jpeg';
    var nm = img.name || ('invoice_' + (i + 1) + '.jpg');
    var blob = Utilities.newBlob(Utilities.base64Decode(img.data), mime, nm);
    folder.createFile(blob);
    added++;
  }
  var links = [];
  var it = folder.getFiles();
  while (it.hasNext()) { links.push(it.next().getUrl()); }
  var linksStr = links.join(', ');
  try { handleUpdateOrderStatus_({ quote_no: quoteNo, fields: { invoice_photos: linksStr } }); } catch (e) {}
  return { ok: true, quote_no: quoteNo, added: added, total: links.length, invoice_photos: linksStr };
}

// ===== v31: 分批出貨子紀錄 =====
function shipGenId_() { return 'SHP-' + Utilities.getUuid().slice(0, 8); }
function handleAddShipment_(params) {
  var quoteNo = params.quote_no || params.quoteNo;
  if (!quoteNo) throw new Error('缺少 quote_no');
  var fields = params.fields || {};
  var sh = v2Sheet_(SHEET_ORDER_SHIPMENTS, ORDER_SHIP_HEADERS);
  var now = tpeNow_();
  var all = v2ReadAll_(SHEET_ORDER_SHIPMENTS, ORDER_SHIP_HEADERS);
  var seq = all.filter(function (o) { return String(o.quote_no) === String(quoteNo); }).length + 1;
  var id = shipGenId_();
  var row = ORDER_SHIP_HEADERS.map(function (h) {
    if (h === 'id') return id;
    if (h === 'quote_no') return quoteNo;
    if (h === 'seq') return seq;
    if (h === 'created_at' || h === 'updated_at') return now;
    return v2AsCell_(fields[h]);
  });
  sh.appendRow(row);
  return { ok: true, id: id, quote_no: quoteNo, seq: seq };
}
function handleListShipments_(params) {
  var quoteNo = params.quote_no || params.quoteNo;
  var all = v2ReadAll_(SHEET_ORDER_SHIPMENTS, ORDER_SHIP_HEADERS);
  var list = quoteNo ? all.filter(function (o) { return String(o.quote_no) === String(quoteNo); }) : all;
  return { ok: true, quote_no: quoteNo || '', shipments: list };
}
function handleUpdateShipment_(params) {
  var id = params.id;
  var fields = params.fields || {};
  if (!id) throw new Error('缺少 id');
  var sh = v2Sheet_(SHEET_ORDER_SHIPMENTS, ORDER_SHIP_HEADERS);
  var rowNum = v2FindRow_(SHEET_ORDER_SHIPMENTS, ORDER_SHIP_HEADERS, 'id', id);
  if (rowNum === -1) throw new Error('找不到出貨批次：' + id);
  ORDER_SHIP_HEADERS.forEach(function (h, i) {
    if (h === 'id' || h === 'quote_no' || h === 'created_at' || h === 'updated_at' || h === 'seq') return;
    if (fields[h] !== undefined) sh.getRange(rowNum, i + 1).setValue(v2AsCell_(fields[h]));
  });
  sh.getRange(rowNum, ORDER_SHIP_HEADERS.indexOf('updated_at') + 1).setValue(tpeNow_());
  return { ok: true, id: id };
}

function handleSaveCustomQuote_(params) {
  const q = params.quote || params;
  let quoteNo = q.quote_no;
  if (!quoteNo) {
    quoteNo = generateV2QuoteNo_(q.quote_date);
  }

  const sh = v2Sheet_(SHEET_CUSTOM_QUOTES, CUSTOM_QUOTES_HEADERS);
  const now = tpeNow_();
  let rowNum = v2FindRow_(SHEET_CUSTOM_QUOTES, CUSTOM_QUOTES_HEADERS, 'quote_no', quoteNo);

  if (rowNum === -1) {
    const newRow = CUSTOM_QUOTES_HEADERS.map(function (h) {
      if (h === 'quote_no') return quoteNo;
      if (h === 'created_at' || h === 'updated_at') return now;
      return v2AsCell_(q[h]);
    });
    sh.appendRow(newRow);
    rowNum = sh.getLastRow();
  } else {
    CUSTOM_QUOTES_HEADERS.forEach(function (h, i) {
      if (h === 'quote_no' || h === 'created_at' || h === 'updated_at') return;
      if (q[h] !== undefined) {
        sh.getRange(rowNum, i + 1).setValue(v2AsCell_(q[h]));
      }
    });
    sh.getRange(rowNum, CUSTOM_QUOTES_HEADERS.indexOf('updated_at') + 1).setValue(now);
  }

  const rowVals = sh.getRange(rowNum, 1, 1, CUSTOM_QUOTES_HEADERS.length).getValues()[0];
  const saved = {};
  CUSTOM_QUOTES_HEADERS.forEach(function (h, i) {
    let v = rowVals[i];
    if (v instanceof Date) v = Utilities.formatDate(v, 'Asia/Taipei', 'yyyy-MM-dd');
    saved[h] = v;
  });

  // 確保訂單追蹤有這張單（不覆蓋既有進度）
  if (v2FindRow_(SHEET_ORDER_STATUS, ORDER_STATUS_HEADERS, 'quote_no', quoteNo) === -1) {
    const osSh = v2Sheet_(SHEET_ORDER_STATUS, ORDER_STATUS_HEADERS);
    const osRow = ORDER_STATUS_HEADERS.map(function (h) {
      if (h === 'quote_no') return quoteNo;
      if (h === 'status') return 'quoted';
      if (h === 'updated_at') return now;
      return '';
    });
    osSh.appendRow(osRow);
  }

  logChange_('saveCustomQuote', quoteNo, saved);
  return { ok: true, quote: saved };
}

// 自訂單單號：沿用 YYYYMMDD-NN 格式，流水號同時看 報價單主表 與 custom_quotes，避免撞號
function generateV2QuoteNo_(dateStr) {
  const d = dateStr ? String(dateStr) : Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  const datePart = d.replace(/-/g, '');
  let maxSerial = 0;

  const scan = function (sheetName, colIdx) {
    const ss = ssApp_();
    const sh = ss.getSheetByName(sheetName);
    if (!sh || sh.getLastRow() < 2) return;
    const vals = sh.getRange(2, colIdx, sh.getLastRow() - 1, 1).getValues();
    vals.forEach(function (row) {
      const qn = String(row[0] || '');
      if (qn.indexOf(datePart + '-') === 0) {
        const serial = parseInt(qn.split('-')[1], 10);
        if (serial > maxSerial) maxSerial = serial;
      }
    });
  };
  scan(SHEET_MAIN, MAIN_COLS.quoteNo);
  scan(SHEET_CUSTOM_QUOTES, 1);

  return datePart + '-' + String(maxSerial + 1).padStart(2, '0');
}

// ===================================================================
// action: listCustomQuotes —— 全部列（含 items_json 完整內容）
// ===================================================================
function handleListCustomQuotes_(params) {
  return { ok: true, quotes: v2ReadAll_(SHEET_CUSTOM_QUOTES, CUSTOM_QUOTES_HEADERS) };
}

// ===================================================================
// action: listCalendarItems —— 全部列
// ===================================================================
function handleListCalendarItems_(params) {
  return { ok: true, items: v2ReadAll_(SHEET_CALENDAR, CALENDAR_HEADERS) };
}

// ===================================================================
// action: saveCalendarItem —— 以 item_id upsert，回傳存好的整列
// 參數：params.item（物件，欄位名同分頁表頭）；也接受直接放在 params 頂層
// ===================================================================
function handleSaveCalendarItem_(params) {
  const it = params.item || params;
  const itemId = it.item_id || Utilities.getUuid();

  const sh = v2Sheet_(SHEET_CALENDAR, CALENDAR_HEADERS);
  const now = tpeNow_();
  let rowNum = v2FindRow_(SHEET_CALENDAR, CALENDAR_HEADERS, 'item_id', itemId);

  if (rowNum === -1) {
    const newRow = CALENDAR_HEADERS.map(function (h) {
      if (h === 'item_id') return itemId;
      if (h === 'created_at' || h === 'updated_at') return now;
      return v2AsCell_(it[h]);
    });
    sh.appendRow(newRow);
    rowNum = sh.getLastRow();
  } else {
    CALENDAR_HEADERS.forEach(function (h, i) {
      if (h === 'item_id' || h === 'created_at' || h === 'updated_at') return;
      if (it[h] !== undefined) {
        sh.getRange(rowNum, i + 1).setValue(v2AsCell_(it[h]));
      }
    });
    sh.getRange(rowNum, CALENDAR_HEADERS.indexOf('updated_at') + 1).setValue(now);
  }

  const rowVals = sh.getRange(rowNum, 1, 1, CALENDAR_HEADERS.length).getValues()[0];
  const saved = {};
  CALENDAR_HEADERS.forEach(function (h, i) {
    let v = rowVals[i];
    if (v instanceof Date) v = Utilities.formatDate(v, 'Asia/Taipei', 'yyyy-MM-dd');
    saved[h] = v;
  });

  logChange_('saveCalendarItem', itemId, saved);
  return { ok: true, item: saved };
}

// ===================================================================
// action: deleteCalendarItem —— {item_id} 刪除該列（刪除前整列寫入 change_log）
// ===================================================================
function handleDeleteCalendarItem_(params) {
  const itemId = params.item_id;
  if (!itemId) throw new Error('缺少 item_id');

  const rowNum = v2FindRow_(SHEET_CALENDAR, CALENDAR_HEADERS, 'item_id', itemId);
  if (rowNum === -1) return { ok: false, error: '找不到行事曆項目：' + itemId };

  const sh = v2Sheet_(SHEET_CALENDAR, CALENDAR_HEADERS);
  const rowVals = sh.getRange(rowNum, 1, 1, CALENDAR_HEADERS.length).getValues()[0];
  const snapshot = {};
  CALENDAR_HEADERS.forEach(function (h, i) {
    let v = rowVals[i];
    if (v instanceof Date) v = Utilities.formatDate(v, 'Asia/Taipei', 'yyyy-MM-dd');
    snapshot[h] = v;
  });

  logChange_('deleteCalendarItem', itemId, snapshot);
  sh.deleteRow(rowNum);
  return { ok: true };
}

// ===================================================================
// action: getChangeLog —— {ref_no} 可選；不帶＝最近 200 筆；新到舊
// ===================================================================
function handleGetChangeLog_(params) {
  const refNo = params.ref_no;
  const sh = v2Sheet_(SHEET_CHANGELOG, CHANGELOG_HEADERS);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, logs: [] };

  const data = sh.getRange(2, 1, lastRow - 1, CHANGELOG_HEADERS.length).getValues();
  let logs = data.map(function (row) {
    let ts = row[0];
    if (ts instanceof Date) ts = Utilities.formatDate(ts, 'Asia/Taipei', "yyyy-MM-dd'T'HH:mm:ss");
    return { ts: ts, action: row[1], ref_no: row[2], payload_json: row[3] };
  });

  if (refNo) {
    logs = logs.filter(function (l) { return String(l.ref_no) === String(refNo); });
  }

  // 新到舊（change_log 只追加，反轉即為新到舊）
  logs.reverse();
  if (!refNo && logs.length > 200) logs = logs.slice(0, 200);

  return { ok: true, logs: logs };
}

// ===================================================================
// 2026-07-16 追加：brand 欄（companies K）＋發票抬頭欄（報價單主表 AF）
// 手動執行一次，補上既有分頁的新表頭（idempotent，可重複執行）
// ===================================================================
function setupBrandAndInvoiceColumns() {
  const ss = ssApp_();
  const out = [];

  const compSh = ss.getSheetByName(SHEET_COMPANIES);
  if (compSh && String(compSh.getRange(1, 11).getValue()) === '') {
    compSh.getRange(1, 11).setValue('brand')
      .setFontWeight('bold').setBackground('#1B4D2E').setFontColor('#FFFFFF');
    out.push('companies K1=brand 已建');
  }
  if (compSh && String(compSh.getRange(2, 1).getValue()) === 'TESTCO' && String(compSh.getRange(2, 11).getValue()) === '') {
    compSh.getRange(2, 11).setValue('測試品牌');
    out.push('TESTCO 補測試品牌');
  }

  const mainSh = ss.getSheetByName(SHEET_MAIN);
  if (mainSh && String(mainSh.getRange(1, 32).getValue()) === '') {
    mainSh.getRange(1, 32).setValue('發票抬頭')
      .setFontWeight('bold').setBackground('#1B4D2E').setFontColor('#FFFFFF');
    out.push('報價單主表 AF1=發票抬頭 已建');
  }

  return out.length ? out.join('；') : '欄位都已存在，無需變更';
}

// ===================================================================
// 內部測試：在編輯器手動執行，直接呼叫各 handler（不經過 token）
// 只做讀取與「測試單號」的寫入，執行後會自行清掉測試寫入的資料
// ===================================================================
function runV2Tests() {
  const out = [];

  const cd = handleGetCompanyData_({});
  out.push('getCompanyData: ok=' + cd.ok + ' companies=' + cd.companies.length + ' products=' + cd.products.length + ' rules=' + cd.rules.length);

  const os1 = handleUpdateOrderStatus_({ quote_no: 'TEST-V2-01', fields: { status: 'deposit', deposit_amt: 5000, deposit_date: '2026-07-15', track_note: '測試備註\n第二行' } });
  out.push('updateOrderStatus(新增): ok=' + os1.ok + ' status=' + os1.order.status);

  const os2 = handleUpdateOrderStatus_({ quote_no: 'TEST-V2-01', fields: { status: 'shipped', ship_date_actual: '2026-07-16' } });
  out.push('updateOrderStatus(更新): ok=' + os2.ok + ' status=' + os2.order.status + ' 訂金保留=' + (String(os2.order.deposit_amt) === '5000'));

  const osl = handleGetOrderStatusList_({});
  out.push('getOrderStatusList: ok=' + osl.ok + ' rows=' + osl.orders.length + ' track_note含換行=' + (osl.orders.some(function(o){return String(o.track_note).indexOf('\n') >= 0;})));

  const cq = handleSaveCustomQuote_({ quote: { quote_no: 'TEST-V2-CQ-01', tag: '測試案', client: '測試客戶', quote_date: '2026-07-15', expiry: '2026-07-30', tax_mode: 'exc', tax_rate: 5, headers_json: '{"item":"項目"}', items_json: '[{"name":"測試品項","qty":1,"price":100}]', totals_json: '{"sub":100,"tax":5,"total":105}' } });
  out.push('saveCustomQuote: ok=' + cq.ok + ' quote_no=' + cq.quote.quote_no);

  const lcq = handleListCustomQuotes_({});
  out.push('listCustomQuotes: ok=' + lcq.ok + ' rows=' + lcq.quotes.length + ' items_json原樣=' + (lcq.quotes.some(function(q){return String(q.items_json).indexOf('測試品項') >= 0;})));

  const ci = handleSaveCalendarItem_({ item: { item_id: 'TEST-V2-CAL-01', kind: 'memo', date: '2026-07-18', title: '測試行事曆', category: '工作', done: 'N' } });
  out.push('saveCalendarItem: ok=' + ci.ok);

  const lci = handleListCalendarItems_({});
  out.push('listCalendarItems: ok=' + lci.ok + ' rows=' + lci.items.length);

  const dci = handleDeleteCalendarItem_({ item_id: 'TEST-V2-CAL-01' });
  out.push('deleteCalendarItem: ok=' + dci.ok);

  const cl = handleGetChangeLog_({ ref_no: 'TEST-V2-01' });
  out.push('getChangeLog(ref_no): ok=' + cl.ok + ' logs=' + cl.logs.length);
  const clAll = handleGetChangeLog_({});
  out.push('getChangeLog(全部): ok=' + clAll.ok + ' logs=' + clAll.logs.length);

  // 清掉測試寫入的資料（change_log 依規格永不刪除，保留測試紀錄）
  const ss = ssApp_();
  const osRow = v2FindRow_(SHEET_ORDER_STATUS, ORDER_STATUS_HEADERS, 'quote_no', 'TEST-V2-01');
  if (osRow !== -1) ss.getSheetByName(SHEET_ORDER_STATUS).deleteRow(osRow);
  const cqRow = v2FindRow_(SHEET_CUSTOM_QUOTES, CUSTOM_QUOTES_HEADERS, 'quote_no', 'TEST-V2-CQ-01');
  if (cqRow !== -1) ss.getSheetByName(SHEET_CUSTOM_QUOTES).deleteRow(cqRow);
  const osRow2 = v2FindRow_(SHEET_ORDER_STATUS, ORDER_STATUS_HEADERS, 'quote_no', 'TEST-V2-CQ-01');
  if (osRow2 !== -1) ss.getSheetByName(SHEET_ORDER_STATUS).deleteRow(osRow2);

  Logger.log(out.join('\n'));
  return out.join('\n');
}



// ================================================================
// v2.2（2026-07-19）：products 追加 bottle_cap / moq / lead_time 三欄
// 表頭 idempotent 補建；getCompanyData 因 v2ReadAll_ 按 PRODUCTS_HEADERS
// 讀取，已自動帶出這三欄（PRODUCTS_HEADERS 已擴充為 A~N 共 14 欄）。
// 首次部署後手動執行一次 setupProductV22Columns()。
// ===================================================================
function setupProductV22Columns() {
  var ss = ssApp_();
  var sh = ss.getSheetByName(SHEET_PRODUCTS);
  if (!sh) { return 'products 分頁不存在，請先執行 setupV2Sheets()'; }
  var defs = [[12, 'bottle_cap'], [13, 'moq'], [14, 'lead_time']];
  var out = [];
  defs.forEach(function (d) {
    var col = d[0], name = d[1];
    if (String(sh.getRange(1, col).getValue()) === '') {
      sh.getRange(1, col).setValue(name)
        .setFontWeight('bold').setBackground('#1B4D2E').setFontColor('#FFFFFF');
      out.push('已建立 ' + name + '(col ' + col + ')');
    } else {
      out.push('col ' + col + ' 已存在，略過');
    }
  });
  return out.join(' / ');
}

// ===================================================================
// v2.3（2026-07-19）：工作行事曆單向同步 Google 日曆（系統 → Google）
// 專屬日曆「南坡萬」；事件 09:00-09:30 定時，提醒 popup 0 分 + 1440 分
// （＝當天 9 點 + 前一天 9 點）。以描述內隱藏標記 [qs_key:xxx] 對帳，
// 只動系統自建的事件，Molly 自己的行程完全不碰。
// action syncCalendarNow 供前端「⟳ 同步」即時觸發；另設每小時觸發器
// runCalendarSync。首次執行需在編輯器授權 Calendar 權限。
// ===================================================================
var NANPOWAN_CAL_NAME = '南坡萬';
var CAL_WINDOW_PAST_DAYS = 7;
var CAL_WINDOW_FUTURE_DAYS = 180;

function ensureNanpowanCalendar_() {
  var cals = CalendarApp.getCalendarsByName(NANPOWAN_CAL_NAME);
  if (cals && cals.length > 0) return cals[0];
  return CalendarApp.createCalendar(NANPOWAN_CAL_NAME);
}

function calMarker_(key) { return '[qs_key:' + key + ']'; }

function calExtractKey_(desc) {
  var s = String(desc || '');
  var i = s.indexOf('[qs_key:');
  if (i < 0) return '';
  var j = s.indexOf(']', i);
  if (j < 0) return '';
  return s.substring(i + 8, j);
}

function calStripMarker_(desc) {
  var s = String(desc || '');
  var i = s.indexOf('[qs_key:');
  if (i < 0) return s.replace(/\s+$/, '');
  return s.substring(0, i).replace(/\s+$/, '');
}

function calBuildDesc_(detail, key) {
  var base = detail ? (detail + '\n\n') : '';
  return base + calMarker_(key);
}

function calParseYmd_(v) {
  if (!v) return null;
  if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  var mm = String(v).match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!mm) return null;
  return new Date(parseInt(mm[1], 10), parseInt(mm[2], 10) - 1, parseInt(mm[3], 10));
}

function calTimedRange_(baseDate) {
  var s = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 9, 0, 0);
  var e = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 9, 30, 0);
  return { start: s, end: e };
}

function calApplyReminders_(ev) {
  try { ev.removeAllReminders(); } catch (x) {}
  ev.addPopupReminder(0);
  ev.addPopupReminder(1440);
}

function calWeekday_(n) {
  var map = [
    CalendarApp.Weekday.SUNDAY, CalendarApp.Weekday.MONDAY, CalendarApp.Weekday.TUESDAY,
    CalendarApp.Weekday.WEDNESDAY, CalendarApp.Weekday.THURSDAY, CalendarApp.Weekday.FRIDAY,
    CalendarApp.Weekday.SATURDAY
  ];
  var i = parseInt(n, 10);
  if (isNaN(i) || i < 0 || i > 6) i = 1;
  return map[i];
}

// 前端「⟳ 同步 Google 日曆」按鈕呼叫
function handleSyncCalendarNow_(params) {
  var r = syncGoogleCalendar_();
  return { ok: true, summary: r.summary, added: r.added, updated: r.updated, removed: r.removed };
}

// 每小時觸發器目標（非底線函式，確保觸發器可掛）
function runCalendarSync() {
  return syncGoogleCalendar_();
}

// 建立/重建每小時觸發器（手動執行一次）
function setupCalendarSyncTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function (t) {
    if (t.getHandlerFunction() === 'runCalendarSync' || t.getHandlerFunction() === 'syncGoogleCalendar_') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('runCalendarSync').timeBased().everyHours(1).create();
  return 'hourly trigger (runCalendarSync) created';
}

function syncGoogleCalendar_() {
  var cal = ensureNanpowanCalendar_();
  var now = new Date();
  var winStart = new Date(now.getTime() - CAL_WINDOW_PAST_DAYS * 86400000);
  var winEnd = new Date(now.getTime() + CAL_WINDOW_FUTURE_DAYS * 86400000);

  // ---- 客戶名稱 / 到期日查表（主表 + custom_quotes）----
  var clientByNo = {}, expiryByNo = {};
  try {
    var mss = ssApp_().getSheetByName(SHEET_MAIN);
    if (mss && mss.getLastRow() > 1) {
      var width = MAIN_COLS.svcAmount;
      var mrows = mss.getRange(2, 1, mss.getLastRow() - 1, width).getValues();
      mrows.forEach(function (r) {
        var no = String(r[MAIN_COLS.quoteNo - 1] || '');
        if (!no) return;
        clientByNo[no] = r[MAIN_COLS.clientName - 1] || '';
        var ex = r[MAIN_COLS.expiryDate - 1];
        expiryByNo[no] = (ex instanceof Date)
          ? Utilities.formatDate(ex, 'Asia/Taipei', 'yyyy-MM-dd')
          : String(ex || '');
      });
    }
  } catch (x) {}
  try {
    var cq = v2ReadAll_(SHEET_CUSTOM_QUOTES, CUSTOM_QUOTES_HEADERS);
    cq.forEach(function (q) {
      var no = String(q['quote_no'] || '');
      if (!no) return;
      if (!clientByNo[no]) clientByNo[no] = q['client'] || '';
      if (!expiryByNo[no]) expiryByNo[no] = q['expiry'] || '';
    });
  } catch (x) {}

  // ---- 建立 desired 事件集：key -> {title, date(Date), detail, recur, recurJson} ----
  var desired = {};

  // 訂單狀態：出貨 + 報價到期
  var orders = [];
  try { orders = v2ReadAll_(SHEET_ORDER_STATUS, ORDER_STATUS_HEADERS); } catch (x) {}
  orders.forEach(function (o) {
    var no = String(o['quote_no'] || '');
    if (!no) return;
    var status = effOrdStatus_(o);
    var client = clientByNo[no] || no;
    var est = o['ship_date_est'];
    var actual = o['ship_date_actual'];
    if (est && !actual && ['paid', 'closed', 'cancelled'].indexOf(status) === -1) {
      var d = calParseYmd_(est);
      if (d) desired['ship:' + no] = { title: '🚚 ' + client + ' 出貨（' + no + '）', date: d, detail: '' };
    }
    if (status === 'quoted') {
      var de = calParseYmd_(expiryByNo[no]);
      if (de) desired['exp:' + no] = { title: '⏰ ' + client + ' 報價單到期（' + no + '）', date: de, detail: '' };
    }
  });

  // 行事曆備忘 + 重複行程
  var items = [];
  try { items = v2ReadAll_(SHEET_CALENDAR, CALENDAR_HEADERS); } catch (x) {}
  items.forEach(function (it) {
    var id = String(it['item_id'] || '');
    if (!id) return;
    var kind = String(it['kind'] || '').toLowerCase();
    var done = String(it['done'] || '').toUpperCase() === 'Y';
    if (done) return;
    if (kind === 'memo') {
      var d = calParseYmd_(it['date']);
      if (d) desired['memo:' + id] = { title: '📌 ' + (it['title'] || '備忘'), date: d, detail: String(it['detail'] || '') };
    } else if (kind === 'recur') {
      var rj = {};
      try { rj = JSON.parse(it['recur_json'] || '{}') || {}; } catch (x) { rj = {}; }
      desired['recur:' + id] = {
        title: '🔁 ' + (it['title'] || '重複行程'),
        date: calParseYmd_(it['date']) || new Date(),
        detail: String(it['detail'] || ''),
        recur: true, recurJson: rj
      };
    }
  });

  // ---- 讀取現有帶標記事件（單次 + 重複系列）----
  var singleByKey = {}, seriesByKey = {};
  var evs = cal.getEvents(winStart, winEnd);
  evs.forEach(function (ev) {
    var k = calExtractKey_(ev.getDescription());
    if (!k) return;
    var isRec = false;
    try { isRec = ev.isRecurringEvent(); } catch (x) {}
    if (isRec) {
      if (!seriesByKey[k]) {
        try { seriesByKey[k] = ev.getEventSeries(); } catch (x) {}
      }
    } else {
      singleByKey[k] = ev;
    }
  });

  var added = 0, updated = 0, removed = 0;

  // ---- 單次事件建立 / 更新 ----
  Object.keys(desired).forEach(function (k) {
    var d = desired[k];
    if (d.recur) return;
    var rng = calTimedRange_(d.date);
    var ev = singleByKey[k];
    if (ev) {
      var changed = false;
      if (ev.getTitle() !== d.title) { ev.setTitle(d.title); changed = true; }
      var st = ev.getStartTime();
      if (!st || st.getTime() !== rng.start.getTime()) { ev.setTime(rng.start, rng.end); changed = true; }
      if (calStripMarker_(ev.getDescription()) !== String(d.detail || '')) {
        ev.setDescription(calBuildDesc_(d.detail, k)); changed = true;
      }
      if (changed) updated++;
      delete singleByKey[k];
    } else {
      var nev = cal.createEvent(d.title, rng.start, rng.end, { description: calBuildDesc_(d.detail, k) });
      calApplyReminders_(nev);
      added++;
    }
  });

  // ---- 重複事件：不存在才建立（重複系列不做即時更新，改動請刪除重建）----
  Object.keys(desired).forEach(function (k) {
    var d = desired[k];
    if (!d.recur) return;
    if (seriesByKey[k]) { delete seriesByKey[k]; return; }
    var series = calCreateRecurSeries_(cal, d, k);
    if (series) added++;
  });

  // ---- 來源已消失 → 刪除（只刪帶標記的）----
  Object.keys(singleByKey).forEach(function (k) {
    try { singleByKey[k].deleteEvent(); removed++; } catch (x) {}
  });
  Object.keys(seriesByKey).forEach(function (k) {
    try { seriesByKey[k].deleteEventSeries(); removed++; } catch (x) {}
  });

  var summary = '新增 ' + added + '、更新 ' + updated + '、移除 ' + removed;
  try { logChange_('syncCalendarNow', '', { added: added, updated: updated, removed: removed }); } catch (x) {}
  return { summary: summary, added: added, updated: updated, removed: removed };
}

function calCreateRecurSeries_(cal, d, key) {
  var rj = d.recurJson || {};
  var freq = String(rj.freq || rj.type || rj.mode || rj.unit || '').toLowerCase();
  var base = d.date || new Date();
  var rng = calTimedRange_(base);
  var desc = calBuildDesc_(d.detail, key);
  var recurrence = CalendarApp.newRecurrence();
  var rule;
  if (freq === 'weekly' || freq === 'week') {
    var wdNum = (rj.weekday !== undefined) ? rj.weekday
      : (rj.dow !== undefined ? rj.dow
      : (rj.day !== undefined ? rj.day : base.getDay()));
    rule = recurrence.addWeeklyRule().onlyOnWeekday(calWeekday_(wdNum));
  } else if (freq === 'monthly' || freq === 'month') {
    var dom = rj.day || rj.date || rj.dom || base.getDate();
    rule = recurrence.addMonthlyRule().onlyOnMonthDay(parseInt(dom, 10));
  } else if (freq === 'yearly' || freq === 'year') {
    rule = recurrence.addYearlyRule();
  } else if (freq === 'daily' || freq === 'day') {
    rule = recurrence.addDailyRule();
  } else {
    // 無法辨識頻率 → 退回單次事件
    var nev = cal.createEvent(d.title, rng.start, rng.end, { description: desc });
    calApplyReminders_(nev);
    return nev;
  }
  var series = cal.createEventSeries(d.title, rng.start, rng.end, recurrence, { description: desc });
  try { series.removeAllReminders(); } catch (x) {}
  series.addPopupReminder(0);
  series.addPopupReminder(1440);
  return series;
}


// ===================================================================
// v2.4（2026-07-20）：發票地址／出貨地址分開
// companies 追加 ship_contact / ship_phone / ship_address 三欄（出貨資訊預設值，
// 選公司快速帶入時若有填會自動帶入報價單出貨資訊）；報價單主表追加
// shipContact(AG) / shipPhone(AH) / shipAddress(AI) 三欄（在 程式碼.gs 的
// MAIN_COLS / MAIN_HEADERS / handleCreateQuote_ / handleUpdateQuote_ /
// rowToQuoteObject_ / appendClientInfo_ 已處理，getCompanyData 因
// v2ReadAll_ 按 COMPANIES_HEADERS 讀取，已自動帶出這三欄）。
// 首次部署後手動各執行一次 setupCompanyV24Columns() 與 setupQuoteShipColumns()。
// ===================================================================
function setupCompanyV24Columns() {
  var ss = ssApp_();
  var sh = ss.getSheetByName(SHEET_COMPANIES);
  if (!sh) { return 'companies 分頁不存在，請先執行 setupV2Sheets()'; }
  var defs = [[12, 'ship_contact'], [13, 'ship_phone'], [14, 'ship_address']];
  var out = [];
  defs.forEach(function (d) {
    var col = d[0], name = d[1];
    if (String(sh.getRange(1, col).getValue()) === '') {
      sh.getRange(1, col).setValue(name)
        .setFontWeight('bold').setBackground('#1B4D2E').setFontColor('#FFFFFF');
      out.push('已建立 ' + name + '(col ' + col + ')');
    } else {
      out.push('col ' + col + ' 已存在，略過');
    }
  });
  return out.join(' / ');
}

function setupQuoteShipColumns() {
  var ss = ssApp_();
  var sh = ss.getSheetByName(SHEET_MAIN);
  if (!sh) { return '報價單主表不存在'; }
  var defs = [[33, '出貨聯絡人'], [34, '出貨電話'], [35, '出貨地址']];
  var out = [];
  defs.forEach(function (d) {
    var col = d[0], name = d[1];
    if (String(sh.getRange(1, col).getValue()) === '') {
      sh.getRange(1, col).setValue(name)
        .setFontWeight('bold').setBackground('#1B4D2E').setFontColor('#FFFFFF');
      out.push('已建立 ' + name + '(col ' + col + ')');
    } else {
      out.push('col ' + col + ' 已存在，略過');
    }
  });
  return out.join(' / ');
}


// ===================================================================
// v3.1（2026-07-23）：客戶酒譜同步 —— companies 追加 recipe_sheet_id /
// recipe_tab / recipe_col_map 三欄（col_map 選填，自動比對失敗才用）。
// 首次部署後手動執行一次 setupCustomerRecipeColumns()。
// ===================================================================
function setupCustomerRecipeColumns() {
  var ss = ssApp_();
  var sh = ss.getSheetByName(SHEET_COMPANIES);
  if (!sh) { return 'companies 分頁不存在，請先執行 setupV2Sheets()'; }
  var defs = [[15, 'recipe_sheet_id'], [16, 'recipe_tab'], [17, 'recipe_col_map']];
  var out = [];
  defs.forEach(function (d) {
    var col = d[0], name = d[1];
    if (String(sh.getRange(1, col).getValue()) === '') {
      sh.getRange(1, col).setValue(name)
        .setFontWeight('bold').setBackground('#1B4D2E').setFontColor('#FFFFFF');
      out.push('已建立 ' + name + '(col ' + col + ')');
    } else {
      out.push('col ' + col + ' 已存在，略過');
    }
  });
  return out.join(' / ');
}


// ===================================================================
// v2.5 (2026-07-24)：行事曆補 time/all_day/source_quote_no/repeat_interval；
// custom_quotes 補 client_json；報價單主表補 預計出貨日/顯示出貨日。
// 出貨日連動行事曆 helper：upsertShipCalendar_（以 source_quote_no 為鍵）。
// 首次部署後手動執行一次 setupV25Columns()。
// ===================================================================
function setupV25Columns() {
  var ss = ssApp_();
  var out = [];
  function addCol(sheetName, col, name){
    var sh = ss.getSheetByName(sheetName);
    if (!sh){ out.push(sheetName + ' 不存在'); return; }
    var maxc = sh.getMaxColumns();
    if (maxc < col){ sh.insertColumnsAfter(maxc, col - maxc); }
    if (String(sh.getRange(1, col).getValue()) === ''){
      sh.getRange(1, col).setValue(name).setFontWeight('bold').setBackground('#1B4D2E').setFontColor('#FFFFFF');
      out.push(sheetName + ' col ' + col + '=' + name + ' 已建');
    } else {
      out.push(sheetName + ' col ' + col + ' 已存在');
    }
  }
  addCol(SHEET_CALENDAR, 13, 'time');
  addCol(SHEET_CALENDAR, 14, 'all_day');
  addCol(SHEET_CALENDAR, 15, 'source_quote_no');
  addCol(SHEET_CALENDAR, 16, 'repeat_interval');
  addCol(SHEET_CUSTOM_QUOTES, 14, 'client_json');
  addCol(SHEET_MAIN, 36, '預計出貨日');
  addCol(SHEET_MAIN, 37, '顯示出貨日');
  return out.join(' / ');
}

function upsertShipCalendar_(quoteNo, clientName, shipDate) {
  if (!quoteNo) return;
  var sh = v2Sheet_(SHEET_CALENDAR, CALENDAR_HEADERS);
  var rowNum = v2FindRow_(SHEET_CALENDAR, CALENDAR_HEADERS, 'source_quote_no', quoteNo);
  var now = tpeNow_();
  if (!shipDate) {
    if (rowNum !== -1) {
      var snap = sh.getRange(rowNum, 1, 1, CALENDAR_HEADERS.length).getValues()[0];
      var obj = {}; CALENDAR_HEADERS.forEach(function(h, i){ obj[h] = snap[i]; });
      try { logChange_('deleteShipCalendar', quoteNo, obj); } catch (e) {}
      sh.deleteRow(rowNum);
    }
    return;
  }
  var title = '出貨：' + (clientName || quoteNo) + '（' + quoteNo + '）';
  var fields = { kind:'memo', date: shipDate, title: title, detail:'', category:'採購', priority:'', done:'N', done_date:'', time:'', all_day:'Y', source_quote_no: quoteNo, repeat_interval:'' };
  if (rowNum === -1) {
    var itemId = 'ship-' + quoteNo;
    var newRow = CALENDAR_HEADERS.map(function(h){
      if (h === 'item_id') return itemId;
      if (h === 'created_at' || h === 'updated_at') return now;
      return fields[h] !== undefined ? fields[h] : '';
    });
    sh.appendRow(newRow);
  } else {
    CALENDAR_HEADERS.forEach(function(h, i){
      if (h === 'item_id' || h === 'created_at') return;
      if (h === 'updated_at'){ sh.getRange(rowNum, i + 1).setValue(now); return; }
      if (fields[h] !== undefined) sh.getRange(rowNum, i + 1).setValue(fields[h]);
    });
  }
  try { logChange_('upsertShipCalendar', quoteNo, { date: shipDate, title: title }); } catch (e) {}
}


// ====================================================================
// 對話B 2026-07-25：每週自動備份／表頭保護／驗收與出貨刪除能力
// 依據交接文件「交接_給對話B_20260725_備份保護刪除與客訴分類.md」實作
// 本段只「新增」，不動既有函式。
// ====================================================================

var BACKUP_FOLDER_NAME_ = '系統備份';
var BACKUP_KEEP_COUNT_ = 8;
var BACKUP_TRIGGER_FN_ = 'weeklyBackup_';

function getOrCreateBackupFolder_() {
  var folders = DriveApp.getFoldersByName(BACKUP_FOLDER_NAME_);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(BACKUP_FOLDER_NAME_);
}

// 備份整份試算表到「系統備份」資料夾，檔名帶當天台北日期；只保留最近 8 份，較舊的丟垃圾桶。
function weeklyBackup_() {
  var folder = getOrCreateBackupFolder_();
  var today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd');
  var name = '備份_報價單資料庫_' + today;
  var srcFile = DriveApp.getFileById(SHEET_ID);
  var copy = srcFile.makeCopy(name, folder);

  var files = [];
  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    files.push({ file: f, time: f.getDateCreated().getTime() });
  }
  files.sort(function (a, b) { return b.time - a.time; });
  for (var i = BACKUP_KEEP_COUNT_; i < files.length; i++) {
    try { files[i].file.setTrashed(true); } catch (e) {}
  }
  return copy.getName();
}

// 一次性：建立每週日凌晨 3 點的備份 trigger（建立前先刪同名舊 trigger，避免重複疊加）
function setupWeeklyBackup() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function (t) {
    if (t.getHandlerFunction() === BACKUP_TRIGGER_FN_) {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger(BACKUP_TRIGGER_FN_)
    .timeBased()
    .everyWeeks(1)
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(3)
    .create();
  var count = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === BACKUP_TRIGGER_FN_;
  }).length;
  return { ok: true, triggerCount: count };
}

function handleSetupWeeklyBackup_(params) {
  return setupWeeklyBackup();
}

function handleRunBackupNow_(params) {
  var fileName = weeklyBackup_();
  return { ok: true, fileName: fileName };
}

// ---- 試算表標題列保護 ----
var HEADER_PROTECT_DESC_ = '系統標題列勿動';

function protectHeaders() {
  var ss = ssApp_();
  var sheets = ss.getSheets();
  var processed = 0;
  sheets.forEach(function (sheet) {
    try {
      var existing = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
      var already = existing.some(function (p) { return p.getDescription() === HEADER_PROTECT_DESC_; });
      if (already) { processed++; return; }
      var range = sheet.getRange('1:1');
      var protection = range.protect().setDescription(HEADER_PROTECT_DESC_);
      protection.setWarningOnly(false);
      var editors = protection.getEditors();
      editors.forEach(function (ed) {
        try { protection.removeEditor(ed); } catch (e) {}
      });
      try { if (protection.canDomainEdit()) protection.setDomainEdit(false); } catch (e) {}
      processed++;
    } catch (e) {}
  });
  return { ok: true, sheetsProcessed: processed };
}

function handleProtectHeaders_(params) {
  return protectHeaders();
}

// ---- 刪除能力：驗收紀錄／驗收單紀錄／order_shipments ----
// 皆用 v2 系列現成的 v2Sheet_/v2FindRow_ helper；單筆 id 刪除，無多筆位移疑慮。
function handleDeleteVerification_(params) {
  var id = params.id;
  if (!id) throw new Error('缺少 id');
  var rowNum = v2FindRow_(SHEET_VERIFY, VERIFY_HEADERS, '紀錄ID', id);
  if (rowNum === -1) throw new Error('找不到驗收紀錄：' + id);
  var sh = v2Sheet_(SHEET_VERIFY, VERIFY_HEADERS);
  sh.deleteRow(rowNum);
  return { ok: true, id: id };
}

function handleDeleteVerifyForm_(params) {
  var id = params.id;
  if (!id) throw new Error('缺少 id');
  var rowNum = v2FindRow_(SHEET_VERIFY_FORM, VERIFY_FORM_HEADERS, '紀錄ID', id);
  if (rowNum === -1) throw new Error('找不到驗收單紀錄：' + id);
  var sh = v2Sheet_(SHEET_VERIFY_FORM, VERIFY_FORM_HEADERS);
  sh.deleteRow(rowNum);
  return { ok: true, id: id };
}

function handleDeleteShipment_(params) {
  var id = params.id;
  if (!id) throw new Error('缺少 id');
  var rowNum = v2FindRow_(SHEET_ORDER_SHIPMENTS, ORDER_SHIP_HEADERS, 'id', id);
  if (rowNum === -1) throw new Error('找不到出貨批次：' + id);
  var sh = v2Sheet_(SHEET_ORDER_SHIPMENTS, ORDER_SHIP_HEADERS);
  sh.deleteRow(rowNum);
  return { ok: true, id: id };
}


/* ============================================================
   v36：存單自動把主表「預計出貨日」帶進訂單追蹤（order_status.ship_date_est）
   規則：只在「該單沒有列」或「該列 ship_date_est 是空白」時才寫入，
   絕不覆蓋人工填過的值；沒填預計出貨日就什麼都不做。
   由 程式碼.gs 的 createQuote / updateQuote dispatcher 呼叫，失敗只吞掉不影響存單。
   ============================================================ */
function seedYmdOnly_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) {
    if (v.getFullYear() < 1900) return '';
    return Utilities.formatDate(v, 'Asia/Taipei', 'yyyy-MM-dd');
  }
  var s = String(v).trim().split('/').join('-').slice(0, 10);
  var p = s.split('-');
  if (p.length < 3) return '';
  var y = Number(p[0]), mo = Number(p[1]), d = Number(p[2]);
  if (!(y > 1900 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return '';
  return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
}

function seedOrderShipDate_(quoteNo, shipDate) {
  var no = String(quoteNo || '').trim();
  var ymd = seedYmdOnly_(shipDate);
  if (!no || !ymd) return { ok: false, skipped: 'no_date' };
  var rowNum = v2FindRow_(SHEET_ORDER_STATUS, ORDER_STATUS_HEADERS, 'quote_no', no);
  if (rowNum !== -1) {
    var sh = v2Sheet_(SHEET_ORDER_STATUS, ORDER_STATUS_HEADERS);
    var col = ORDER_STATUS_HEADERS.indexOf('ship_date_est') + 1;
    var cur = sh.getRange(rowNum, col).getValue();
    if (cur !== '' && cur !== null && cur !== undefined) return { ok: false, skipped: 'already_set' };
    handleUpdateOrderStatus_({ quote_no: no, fields: { ship_date_est: ymd } });
    return { ok: true, mode: 'filled', ship_date_est: ymd };
  }
  handleUpdateOrderStatus_({ quote_no: no, fields: { status: 'quoted', ship_date_est: ymd } });
  return { ok: true, mode: 'created', ship_date_est: ymd };
}


/* ============================================================
   v37：batch —— 一次請求跑完多個「讀取類」action
   實測 2026-07-26：這支 Web App 每被呼叫一次，光往返固定就要 2.5 秒
   （連什麼都不做的空請求也一樣），所以前端一頁要三～六份資料時，
   真正的成本是「打了幾次」。合併成一次可以省掉重複的往返。
   ・只接受白名單內的讀取 action（不含 batch 自己，避免遞迴）。
   ・每個子呼叫照樣各自驗 token，權限不會因為合併而變鬆。
   ・任何一個子呼叫出錯只會讓那一格回 ok:false，不影響其他格。
   ・回傳 { ok:true, results:[...] }，順序與送進來的 calls 完全相同。
   ============================================================ */
var BATCH_MAX_ = 8;
var BATCH_ALLOWED_ = ['verifyHeaders', 'getQuotes', 'getQuoteById', 'getCompanyData',
  'getOrderStatusList', 'listQuotePdfs', 'listShipments', 'listCustomQuotes',
  'listCalendarItems', 'getChangeLog', 'getOwnbrandProducts', 'getOwnbrandTiers',
  'getConsignCustomers', 'getConsignInventory', 'getConsignLedger', 'getConsignMonthly',
  'getVerifications', 'listVerifyForms', 'getTodayDigest', 'getCustomers'];

function handleBatch_(params) {
  var calls = (params && params.calls) || [];
  if (!calls.length) return { ok: true, results: [] };
  if (calls.length > BATCH_MAX_) return { ok: false, error: 'batch 一次最多 ' + BATCH_MAX_ + ' 個' };
  var results = [];
  for (var i = 0; i < calls.length; i++) {
    var c = calls[i] || {};
    var act = String(c.action || '');
    if (BATCH_ALLOWED_.indexOf(act) < 0) {
      results.push({ ok: false, error: 'batch 不接受這個 action：' + act });
      continue;
    }
    var sub = {};
    for (var k in c) { if (Object.prototype.hasOwnProperty.call(c, k)) sub[k] = c[k]; }
    if (sub.token === undefined) sub.token = params.token;
    try {
      var out = handleRequest_({ postData: { contents: JSON.stringify(sub) } });
      var txt = (out && typeof out.getContent === 'function') ? out.getContent() : String(out);
      results.push(JSON.parse(txt));
    } catch (err) {
      results.push({ ok: false, error: String((err && err.message) || err) });
    }
  }
  return { ok: true, results: results };
}


/* ============================================================
   v39：客戶主檔（customers）—— 可自己新增／修改客戶資料
   前端「客戶管理」原本純粹從報價單歸戶算出客戶，讀得到但改不了。
   這裡加一張真正的客戶表，讓 Molly 能自己維護：
     ・getCustomers   讀全部（預設只回 active，帶 includeInactive 才含停用）
     ・saveCustomer   以 customer_id upsert；沒給 id 就用「客戶名稱去空白比對」歸戶，
                      仍找不到才建新列（避免同一個客戶被建成兩筆）
     ・deleteCustomer 預設軟刪除（active=N，資料留著可還原）；hard:true 才真的刪列
     ・seedCustomersFromQuotes 一鍵把既有報價單的客戶匯進主檔（只補沒有的，不覆蓋）
   ⚠ 只有 saveCustomer 會寫入使用者填的欄位；空字串會照實寫入（代表「清空這欄」），
      undefined 才是「這次不動這欄」——前端只送使用者真的編輯過的欄位即可。
   ============================================================ */
var SHEET_CUSTOMERS = 'customers';
var CUSTOMERS_HEADERS = ['customer_id', 'name', 'contact', 'phone', 'email', 'tax_id', 'invoice_title',
  'address', 'ship_contact', 'ship_phone', 'ship_address', 'pay_habit', 'tags', 'note',
  'active', 'created_at', 'updated_at'];

/* 歸戶鍵：去掉所有空白（含全形）再轉小寫，與前端 cusKey 同一套規則 */
function custKey_(name) {
  return String(name == null ? '' : name).replace(/[\s　]+/g, '').toLowerCase();
}

/* 以「客戶名稱歸戶鍵」找列號，找不到回 -1 */
function findCustomerRowByName_(name) {
  var key = custKey_(name);
  if (!key) return -1;
  var sh = v2Sheet_(SHEET_CUSTOMERS, CUSTOMERS_HEADERS);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return -1;
  var col = CUSTOMERS_HEADERS.indexOf('name') + 1;
  var vals = sh.getRange(2, col, lastRow - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (custKey_(vals[i][0]) === key) return i + 2;
  }
  return -1;
}

function customerRowObj_(sh, rowNum) {
  var vals = sh.getRange(rowNum, 1, 1, CUSTOMERS_HEADERS.length).getValues()[0];
  var o = {};
  CUSTOMERS_HEADERS.forEach(function (h, i) { o[h] = vals[i]; });
  return o;
}

function handleGetCustomers_(params) {
  var p = params || {};
  var f = p.filters || {};
  var inc = (p.includeInactive === true) || (f.includeInactive === true);
  var rows = v2ReadAll_(SHEET_CUSTOMERS, CUSTOMERS_HEADERS).filter(function (r) {
    return String(r.customer_id || '') !== '' || String(r.name || '') !== '';
  });
  if (!inc) rows = rows.filter(function (r) { return String(r.active).toUpperCase() !== 'N'; });
  return { ok: true, customers: rows };
}

function handleSaveCustomer_(params) {
  var c = (params && params.customer) || {};
  var name = String(c.name == null ? '' : c.name).trim();
  var id = String(c.customer_id == null ? '' : c.customer_id).trim();
  if (!id && !name) return { ok: false, error: '客戶名稱必填' };

  var sh = v2Sheet_(SHEET_CUSTOMERS, CUSTOMERS_HEADERS);
  var rowNum = -1;
  if (id) rowNum = v2FindRow_(SHEET_CUSTOMERS, CUSTOMERS_HEADERS, 'customer_id', id);
  if (rowNum === -1 && name) {
    rowNum = findCustomerRowByName_(name);
    // 名稱撞到別人、但這次明確帶了不同的 id → 視為兩個不同客戶，不要合併
    if (rowNum !== -1 && id) {
      var hitId = String(sh.getRange(rowNum, CUSTOMERS_HEADERS.indexOf('customer_id') + 1).getValue() || '').trim();
      if (hitId && hitId !== id) return { ok: false, error: '已經有同名客戶了：' + name };
    }
  }

  var now = tpeNow_();
  if (rowNum === -1) {
    if (!name) return { ok: false, error: '找不到這個客戶：' + id };
    if (!id) id = 'CU-' + Utilities.getUuid().slice(0, 8);
    var newRow = CUSTOMERS_HEADERS.map(function (h) {
      if (h === 'customer_id') return id;
      if (h === 'name') return name;
      if (h === 'active') return (c.active !== undefined && c.active !== '') ? v2AsCell_(c.active) : 'Y';
      if (h === 'created_at' || h === 'updated_at') return now;
      return v2AsCell_(c[h]);
    });
    sh.appendRow(newRow);
    rowNum = sh.getLastRow();
  } else {
    CUSTOMERS_HEADERS.forEach(function (h, i) {
      if (h === 'customer_id' || h === 'created_at') return;
      if (h === 'updated_at') { sh.getRange(rowNum, i + 1).setValue(now); return; }
      if (c[h] !== undefined) sh.getRange(rowNum, i + 1).setValue(v2AsCell_(c[h]));
    });
  }

  var saved = customerRowObj_(sh, rowNum);
  logChange_('saveCustomer', saved.customer_id, saved);
  return { ok: true, customer: saved };
}

function handleDeleteCustomer_(params) {
  var p = params || {};
  var id = String(p.customer_id || p.id || '').trim();
  if (!id) return { ok: false, error: '缺少 customer_id' };
  var rowNum = v2FindRow_(SHEET_CUSTOMERS, CUSTOMERS_HEADERS, 'customer_id', id);
  if (rowNum === -1) return { ok: false, error: '找不到這個客戶：' + id };
  var sh = v2Sheet_(SHEET_CUSTOMERS, CUSTOMERS_HEADERS);
  var snap = customerRowObj_(sh, rowNum);
  if (p.hard === true) {
    sh.deleteRow(rowNum);
    logChange_('deleteCustomerHard', id, snap);
    return { ok: true, deleted: 'hard', customer: snap };
  }
  sh.getRange(rowNum, CUSTOMERS_HEADERS.indexOf('active') + 1).setValue('N');
  sh.getRange(rowNum, CUSTOMERS_HEADERS.indexOf('updated_at') + 1).setValue(tpeNow_());
  logChange_('deleteCustomer', id, snap);
  return { ok: true, deleted: 'soft', customer: snap };
}

/* 一鍵匯入：把報價單主表裡的客戶歸戶後，補進客戶主檔（已存在的完全不動）
   欄位取「最近一張有填的單」，與前端客戶管理的算法一致。 */
function handleSeedCustomersFromQuotes_(params) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var mainSheet = ss.getSheetByName(SHEET_MAIN);
  var lastRow = mainSheet ? mainSheet.getLastRow() : 0;
  if (lastRow < 2) return { ok: true, added: 0, skipped: 0, names: [] };

  var data = mainSheet.getRange(2, 1, lastRow - 1, effW_(mainSheet, MAIN_HEADERS)).getValues();
  var pick = ['contact', 'phone', 'tax_id', 'invoice_title', 'address', 'ship_contact', 'ship_phone', 'ship_address'];
  var srcCol = { contact: MAIN_COLS.contactName, phone: MAIN_COLS.contactPhone, tax_id: MAIN_COLS.clientTaxId,
    invoice_title: MAIN_COLS.invoiceTitle, address: MAIN_COLS.clientAddress,
    ship_contact: MAIN_COLS.shipContact, ship_phone: MAIN_COLS.shipPhone, ship_address: MAIN_COLS.shipAddress };
  var agg = {};
  data.forEach(function (row) {
    if (String(row[MAIN_COLS.status - 1] || '') === '已刪除') return;
    var nm = String(row[MAIN_COLS.clientName - 1] || '').trim();
    var key = custKey_(nm);
    if (!key) return;
    var d = row[MAIN_COLS.quoteDate - 1];
    var dstr = (d instanceof Date) ? Utilities.formatDate(d, 'Asia/Taipei', 'yyyy-MM-dd') : String(d || '');
    if (!agg[key]) agg[key] = { name: nm, at: '' };
    var a = agg[key];
    if (dstr >= a.at) { a.name = nm || a.name; a.at = dstr; }
    pick.forEach(function (f) {
      var v = String(row[srcCol[f] - 1] || '').trim();
      if (v && (!a[f] || dstr >= (a[f + '_at'] || ''))) { a[f] = v; a[f + '_at'] = dstr; }
    });
  });

  var added = 0, skipped = 0, names = [];
  Object.keys(agg).forEach(function (key) {
    if (findCustomerRowByName_(agg[key].name) !== -1) { skipped++; return; }
    var c = { name: agg[key].name };
    pick.forEach(function (f) { if (agg[key][f]) c[f] = agg[key][f]; });
    c.note = '（由既有報價單自動建立）';
    var r = handleSaveCustomer_({ customer: c });
    if (r && r.ok) { added++; names.push(agg[key].name); } else { skipped++; }
  });
  logChange_('seedCustomersFromQuotes', '', { added: added, skipped: skipped, names: names });
  return { ok: true, added: added, skipped: skipped, names: names };
}
