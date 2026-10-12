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
function setupLegacyPrices() {
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
