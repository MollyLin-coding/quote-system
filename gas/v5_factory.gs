// ===================================================================
// v5_factory.gs —— 廠務／酒譜 APP（repo MollyLin-coding/recipe）連結（2026-09-08）
// ===================================================================
// 設計（Molly 2026-09-08 決議）：
//   • 廠務系統＝公司同仁共用；報價系統＝只有 Molly 用 → 廠務端零回呼，全部由這裡主動打廠務 API（key 認證）。
//   • 轉單：訂單追蹤頁「轉廠務訂單」鈕 → factoryPushOrder（同一張報價單再推＝更新，冪等）。
//   • 同步：factorySync（每小時觸發＋開訂單追蹤頁時）→ 廠務製作狀態／Lot／實際出貨日／出貨紀錄→order_shipments／
//           金流比對（只提示不覆蓋）／廠務同仁新建的「有金流」訂單 → 自動建草稿報價單＋訂單追蹤（反向匯入）。
//   • 出貨以廠務為主；驗收單可從廠務出貨紀錄一鍵帶入（前端讀 factory_links.ship_json）。
//   • 寄售：2026-09-23 起以廠務「經銷商寄售」為主，consign_ledger 自動跟（見檔尾「寄售 × 廠務」一節）。
//   • 2026-09-23 晚 深度複檢修正（見各處「複檢 0923」註解）：
//       ①「更新廠務訂單」先讀廠務現況再合併，只覆蓋報價系統負責的欄位（原本會把瓶型／Lot／配送／運費支付方／備註／客戶鍵洗掉）
//       ② 經銷商寄售單（訂金狀態＝寄售／叫貨放行單／月結認列單）不匯入、不列入手動連結、不從報價系統推
//       ③ 報價單已刪除／純報價 → 停止同步寫入；廠務已刪除的單 → 連結標「廠務已刪除」；回收的訂單號不再亂接
//       ④ 廠務刪掉的出貨批次 → 對應的 [FX:] 出貨列一併移除；廠務改出貨日 → 報價系統跟著改（只改同步自己寫的）
//       ⑤ 同步改成「先抓資料、不佔鎖」＋同步中旗標防重疊；factory_links 一列一次寫、沒變就不寫
//       ⑥ 付款條件讀不出來時尾款跟著總額調（訂金不動）；已收的訂金／尾款不再被改；認得「無訂金」「訂金 N%」
//       ⑦ 反向匯入：酒名去掉 V2 再查牌價、帶廠務運費、客戶名對照自動記下來
// Script Properties：FACTORY_API_URL（廠務 /exec）、FACTORY_KEY（＝廠務 QS_LINK_KEY）。
// 資料表（本檔自建）：factory_links、factory_map。不動既有表的欄位定義。
// ===================================================================

var SHEET_FACTORY_LINKS = 'factory_links';
var FACTORY_LINK_HEADERS = ['quote_no', 'factory_order_no', 'factory_status', 'factory_lot', 'factory_ship_est', 'factory_ship_actual',
  'factory_fin_json', 'fin_mismatch', 'ship_json', 'source', 'last_sync', 'note', 'created_at', 'updated_at'];
var SHEET_FACTORY_MAP = 'factory_map';
var FACTORY_MAP_HEADERS = ['kind', 'qs_name', 'factory_name', 'note', 'updated_at'];

// 廠務訂單類型（字串要跟廠務 index.html 完全一致）
var FX_TYPE_OEM = '代工訂單(全客製/換前標)';
var FX_TYPE_SHIP = '自有酒款出貨訂單(有金流)';
var FX_IMPORT_TYPES = [FX_TYPE_OEM, FX_TYPE_SHIP, '自有酒款庫存出貨訂單'];   // 反向匯入只收「有金流」兩型（舊字串相容）
var FX_PUSH_QUOTE_TYPES = { bottle: FX_TYPE_OEM, ownbrand: FX_TYPE_SHIP, ownlabel: FX_TYPE_SHIP };
// 廠務客戶名前綴（反向匯入時剝掉來對報價系統客戶主檔）
var FX_CLIENT_PREFIX_RE = /^(OEM-|全客製-|換前標-|經銷商[－-]|經銷商)/;
// 廠務「運費支付方」選項（字串要跟廠務 index.html dlv_feepayer 完全一致）
var FX_PAYER_CO = '南坡萬付運費';
var FX_PAYER_CLIENT = '客戶付運費';
var FX_TYPE_CONSIGN_SETTLE = '經銷商寄售月結認列單';
// 複檢 0923：經銷商寄售相關的廠務訂單——叫貨放行單／同仁建的「經銷商寄售訂單」（兩者都存成有金流出貨單、訂金狀態＝寄售、金額 0）、
//   月結認列單。這些走寄售帳（factoryConsignSync），不能當一般銷售匯成草稿報價單、也不從報價系統推單覆蓋。
//   ⚠ 不能只看客戶名開頭「經銷商」：廠務也用「經銷商－」前綴記買斷的批發客戶（例：經銷商-滿枝枒(華山) 12,750）。
function fxIsConsignOrder_(o) {
  if (!o) return false;
  if (String(o.orderType || '') === FX_TYPE_CONSIGN_SETTLE) return true;
  if (String(o.depositStatus || '').trim() === '寄售') return true;
  if (/^經銷商叫貨/.test(String(o.orderCreator || '').trim())) return true;
  if ((Number(o.total) || 0) === 0 && /^經銷商/.test(String(o.client || '').trim()) && String(o.orderType || '') === FX_TYPE_SHIP) return true;
  return false;
}
// 報價系統推過去的單：建單人員「Molly(20260909-01)」、備註「報價單 20260909-01」→ 認回報價單號（AI 欄還沒寫到／回填失敗時用）
// 同一位客戶：名字鍵（去 OEM-／全客製-／經銷商－ 前綴、空白、符號，參＝叁）完全相同才算。
//   ⚠ 刻意不用「互相包含」：「日富一日台中店」會被當成「日富一日」，回收號碼的新單就會被當成舊單蓋掉
function fxSameClient_(a, b) {
  var ka = fxcNameKey_(a), kb = fxcNameKey_(b);
  return !!ka && ka === kb;
}
function fxPushedQuoteNoOf_(o) {
  var m = String((o && o.orderCreator) || '').match(/\((\d{8}-\d{2,3})\)\s*$/);
  if (m) return m[1];
  m = String((o && o.orderNote) || '').match(/^報價單\s+(\d{8}-\d{2,3})/);
  return m ? m[1] : '';
}
// 公司自付的運費＝成本：回數字；不是公司付／沒填運費 → ''
function fxShipCostOf_(o) {
  if (String(o.shipFeePayer || '').trim() !== FX_PAYER_CO) return '';
  var v = fxNum_(o.shipFee); return (v === '' || v <= 0) ? '' : Math.round(v);
}

function fxCfg_() {
  var pr = PropertiesService.getScriptProperties();
  return { url: String(pr.getProperty('FACTORY_API_URL') || '').trim(), key: String(pr.getProperty('FACTORY_KEY') || '').trim() };
}
function fxConfigured_() { var c = fxCfg_(); return !!(c.url && c.key); }
// 一次性設定（只在兩個屬性都還沒設時可寫；之後改請到 GAS 編輯器）
function handleFactorySetup_(params) {
  var pr = PropertiesService.getScriptProperties();
  if (pr.getProperty('FACTORY_API_URL') && pr.getProperty('FACTORY_KEY')) return { ok: false, error: '廠務連結已設定，拒絕覆寫' };
  var url = String(params.url || '').trim(), key = String(params.key || '').trim();
  if (url.indexOf('https://script.google.com/macros/s/') !== 0) return { ok: false, error: 'url 格式不對' };
  if (key.length < 20) return { ok: false, error: 'key 長度不足' };
  pr.setProperty('FACTORY_API_URL', url); pr.setProperty('FACTORY_KEY', key);
  // 上線時間：只有「這之後」廠務同仁新建的訂單才自動匯入；之前的舊單用「連結廠務已有訂單」手動對上（避免跟既有報價單重複）
  if (!pr.getProperty('FACTORY_IMPORT_SINCE')) pr.setProperty('FACTORY_IMPORT_SINCE', Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm'));
  return { ok: true, set: true };
}
// 打廠務 API（POST text/plain JSON；廠務 doPost 會解析後走 doGet 流程）。失敗回 {ok:false,error}
function fxCall_(action, payload) {
  var c = fxCfg_();
  if (!c.url || !c.key) return { ok: false, error: '廠務連結尚未設定（FACTORY_API_URL／FACTORY_KEY）' };
  var body = {}; Object.keys(payload || {}).forEach(function (k) { body[k] = payload[k]; });
  body.action = action; body.key = c.key;
  var res;
  try {
    res = UrlFetchApp.fetch(c.url, { method: 'post', contentType: 'text/plain;charset=utf-8', payload: JSON.stringify(body),
      muteHttpExceptions: true, followRedirects: true });
  } catch (e) { return { ok: false, error: '廠務連線失敗：' + (e && e.message || e) }; }
  var txt = res.getContentText() || '';
  try { return JSON.parse(txt); }
  catch (e) { return { ok: false, error: '廠務回應不是 JSON（HTTP ' + res.getResponseCode() + '）：' + txt.slice(0, 120) }; }
}
function handleFactoryPing_() {
  if (!fxConfigured_()) return { ok: false, error: '廠務連結尚未設定' };
  var r = fxCall_('extPing', {});
  return r;
}

// ── 對照表（客戶／酒款名稱）──────────────────────────────
function fxKey_(s) { return String(s || '').replace(/[\s　]+/g, '').toLowerCase(); }
function fxMapAll_() { return v2ReadAll_(SHEET_FACTORY_MAP, FACTORY_MAP_HEADERS); }
function handleGetFactoryMap_() { return { ok: true, map: fxMapAll_() }; }
// rows: [{kind:'client'|'product', qs_name, factory_name, note}]；以 kind+qs_name upsert；factory_name 空＝刪除
function handleSaveFactoryMap_(params) {
  var rows = params.rows || (params.row ? [params.row] : []);
  if (typeof rows === 'string') { try { rows = JSON.parse(rows); } catch (e) { rows = []; } }
  var sh = v2Sheet_(SHEET_FACTORY_MAP, FACTORY_MAP_HEADERS);
  var all = fxMapAll_();
  var now = tpeNow_();
  var saved = 0, removed = 0;
  rows.forEach(function (r) {
    var kind = String(r.kind || 'client'), qs = String(r.qs_name || '').trim(), fx = String(r.factory_name || '').trim();
    if (!qs) return;
    var idx = -1;
    for (var i = 0; i < all.length; i++) { if (String(all[i].kind) === kind && fxKey_(all[i].qs_name) === fxKey_(qs)) { idx = i; break; } }
    if (!fx) { if (idx >= 0) { sh.deleteRow(idx + 2); all.splice(idx, 1); removed++; } return; }
    if (idx >= 0) {
      sh.getRange(idx + 2, 1, 1, FACTORY_MAP_HEADERS.length).setValues([[kind, qs, fx, String(r.note || ''), now]]);
      all[idx].factory_name = fx;
    } else {
      sh.appendRow([kind, qs, fx, String(r.note || ''), now]);
      all.push({ kind: kind, qs_name: qs, factory_name: fx });
    }
    saved++;
  });
  return { ok: true, saved: saved, removed: removed };
}
function fxMapLookup_(map, kind, fromField, toField, name) {
  var k = fxKey_(name);
  for (var i = 0; i < map.length; i++) {
    if (String(map[i].kind) === kind && fxKey_(map[i][fromField]) === k) return String(map[i][toField]);
  }
  return '';
}
function fxClientToFactory_(map, name) { return fxMapLookup_(map, 'client', 'qs_name', 'factory_name', name) || String(name || '').trim(); }
function fxProductToFactory_(map, name) { return fxMapLookup_(map, 'product', 'qs_name', 'factory_name', name) || String(name || '').trim(); }
// 反向：先查對照表，再拿剝掉前綴的名字比對客戶主檔（customers.name），都沒有就回剝掉前綴的名字
function fxClientToQs_(map, factoryName, customers) {
  var m = fxMapLookup_(map, 'client', 'factory_name', 'qs_name', factoryName);
  if (m) return m;
  var bare = String(factoryName || '').trim().replace(FX_CLIENT_PREFIX_RE, '').trim();
  var k = fxKey_(bare);
  for (var i = 0; i < (customers || []).length; i++) {
    if (fxKey_(customers[i].name) === k) return String(customers[i].name);
  }
  return bare || String(factoryName || '');
}
function fxProductToQs_(map, factoryName) {
  var m = fxMapLookup_(map, 'product', 'factory_name', 'qs_name', factoryName);
  // 複檢 0923：廠務系統酒名帶「V2」＝配方微調版（客戶不需知道），報價單與牌價都用不帶 V2 的名字
  return m || String(factoryName || '').trim().replace(/\s*V\d+$/i, '').trim();
}

// ── factory_links 讀寫 ─────────────────────────────────
function fxLinksAll_() { return v2ReadAll_(SHEET_FACTORY_LINKS, FACTORY_LINK_HEADERS); }
function handleGetFactoryLinks_(params) {
  var all = fxLinksAll_();
  var q = params && (params.quote_no || params.quoteNo);
  if (q) all = all.filter(function (l) { return String(l.quote_no) === String(q); });
  var lastSync = '';
  try { lastSync = String(PropertiesService.getScriptProperties().getProperty('FACTORY_LAST_SYNC') || ''); } catch (e) {}
  return { ok: true, links: all, configured: fxConfigured_(), lastSync: lastSync };
}
// 複檢 0923：原本每張單每次同步逐格 setValue ~12 次（連 updated_at 無條件改）→ 改成讀一列、比對、有變才一次 setValues。
//   last_sync 單獨變不算「有變動」（全體最近同步時間另存 FACTORY_LAST_SYNC，getFactoryLinks 會回 lastSync）。回 {row, changed}
function fxCellStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Taipei', 'yyyy-MM-dd');
  return String(v == null ? '' : v);
}
function fxCellEq_(cur, v) {
  var a = fxCellStr_(cur), b = String(v == null ? '' : v);
  if (a === b) return true;
  var at = a.trim(), bt = b.trim();
  return /^\d+(\.\d+)?$/.test(at) && /^\d+(\.\d+)?$/.test(bt) && Number(at) === Number(bt);   // Lot「018」寫進去會變 18
}
function fxLinkUpsert_(quoteNo, fields) {
  var sh = v2Sheet_(SHEET_FACTORY_LINKS, FACTORY_LINK_HEADERS);
  var now = tpeNow_();
  var rowNum = v2FindRow_(SHEET_FACTORY_LINKS, FACTORY_LINK_HEADERS, 'quote_no', quoteNo);
  if (rowNum === -1) {
    var row = FACTORY_LINK_HEADERS.map(function (h) {
      if (h === 'quote_no') return quoteNo;
      if (h === 'created_at' || h === 'updated_at') return now;
      return v2AsCell_(fields[h]);
    });
    sh.appendRow(row);
    return { row: sh.getLastRow(), changed: true };
  }
  var cur = sh.getRange(rowNum, 1, 1, FACTORY_LINK_HEADERS.length).getValues()[0];
  var next = cur.slice(), changed = false;
  FACTORY_LINK_HEADERS.forEach(function (h, i) {
    if (h === 'quote_no' || h === 'created_at' || h === 'updated_at') return;
    if (fields[h] === undefined) return;
    var v = v2AsCell_(fields[h]);
    if (h === 'last_sync') { next[i] = v; return; }
    if (!fxCellEq_(cur[i], v)) { next[i] = v; changed = true; }
  });
  if (!changed) return { row: rowNum, changed: false };
  next[FACTORY_LINK_HEADERS.indexOf('updated_at')] = now;
  sh.getRange(rowNum, 1, 1, FACTORY_LINK_HEADERS.length).setValues([next]);
  return { row: rowNum, changed: true };
}

// ── 工具 ──────────────────────────────────────────────
// 廠務 createdAt 是 zh-TW toLocaleString（例「2026/9/8 下午3:20:11」）→ 正規化成 'yyyy-MM-dd HH:mm'；解析不了回 ''
function fxParseTw_(s) {
  var str = String(s || '').trim();
  if (!str) return '';
  var m = str.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s*(上午|下午)?\s*(\d{1,2}):(\d{2}))?/);
  if (!m) {
    // ⚠ 實測 extGetOrders 回來的 createdAt 是 Sheets 已轉成 Date 的 toString（「Wed Sep 09 2026 09:07:51 GMT+0800 (...)」）
    var t = Date.parse(str);
    if (isNaN(t)) return '';
    return Utilities.formatDate(new Date(t), 'Asia/Taipei', 'yyyy-MM-dd HH:mm');
  }
  var h = Number(m[5] || 0);
  if (m[4] === '下午' && h < 12) h += 12;
  if (m[4] === '上午' && h === 12) h = 0;
  var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
  return m[1] + '-' + p2(Number(m[2])) + '-' + p2(Number(m[3])) + ' ' + p2(h) + ':' + (m[6] || '00');
}
function fxImportSince_() { try { return String(PropertiesService.getScriptProperties().getProperty('FACTORY_IMPORT_SINCE') || ''); } catch (e) { return ''; } }
// 這張廠務訂單要不要自動匯入：類型是「有金流」＋建立時間在上線之後（解析不了建立時間＝當舊單，不匯）
function fxShouldImport_(o) {
  if (FX_IMPORT_TYPES.indexOf(String(o.orderType)) < 0) return false;
  if (fxIsConsignOrder_(o)) return false;          // 複檢 0923：寄售單走寄售帳，不匯成銷售草稿
  if (fxPushedQuoteNoOf_(o)) return false;         // 報價系統自己推過去的單，不再匯回來（AI 欄晚一步寫到時會撞）
  var since = fxImportSince_(); if (!since) return false;
  var c = fxParseTw_(o.createdAt); if (!c) return false;
  return c >= since;
}
function fxLotDigits_(lot) { var m = String(lot == null ? '' : lot).match(/\d+/); return m ? m[0] : ''; }
function fxVolMl_(v) { var m = String(v == null ? '' : v).match(/\d+(\.\d+)?/); return m ? m[0] : ''; }
function fxNum_(v) { if (v === '' || v == null) return ''; var n = Number(v); return isNaN(n) ? '' : n; }
// 報價單裡「運費」：extra 品項名稱含「運費」的列正負相抵（複檢 0923：「運費折抵」−300 要抵掉自動加的運費 300），最少 0。
//   ⚠ freeship（免運優惠）特殊列是「顯示給客戶看、不計入總計」，不能拿來扣（扣了貨款會多算）。
function fxShipNet_(sum) { return Math.max(0, Math.round(Number(sum) || 0)); }
function fxShippingOfItems_(items) {
  var sum = 0;
  (items || []).forEach(function (it) {
    if (String(it.itemType) !== 'extra') return;
    if (String(it.name || '').indexOf('運費') < 0) return;
    sum += Number(it.subtotal != null && it.subtotal !== '' ? it.subtotal : it.unitPrice) || 0;
  });
  return fxShipNet_(sum);
}
// 報價單是否「未稅顯示」（docopts 特殊列 flavorList JSON 的 taxDisplay==='excl'）
function fxExclOfItems_(items) {
  var ex = false;
  (items || []).forEach(function (it) {
    if (String(it.itemType) !== 'docopts') return;
    try { var o = JSON.parse(it.flavorList || '{}'); if (o && o.taxDisplay === 'excl') ex = true; } catch (e) {}
  });
  return ex;
}
// 2026-09-10 Molly 選 A：廠務一律看「報價單上印的數字」——未稅顯示的單就送未稅。
//   回 { excl, factor }：factor＝未稅總計／含稅總計（含稅單或稅額 0 就是 1），總額／訂金／尾款／運費一律乘這個係數
function fxConv_(excl, grandTotal, taxAmount) {
  var gt = Number(grandTotal) || 0, tax = Number(taxAmount) || 0;
  if (!excl || gt <= 0 || tax <= 0) return { excl: !!excl, factor: 1, net: Math.round(gt), gt: Math.round(gt), tax: Math.round(tax) };
  return { excl: true, factor: (gt - tax) / gt, net: Math.round(gt - tax), gt: Math.round(gt), tax: Math.round(tax) };
}
function fxConvAmt_(v, conv) { v = fxNum_(v); return v === '' ? '' : Math.round(v * conv.factor); }
// 一次讀整張品項表，回 { quote_no: 運費 }；另附 __excl:{quote_no:true}（未稅顯示的單）
function fxShippingMap_() {
  var m = { __excl: {} }, sum = {};
  try {
    var sh = ssApp_().getSheetByName(SHEET_ITEMS);
    if (!sh || sh.getLastRow() < 2) return m;
    var data = sh.getRange(2, 1, sh.getLastRow() - 1, effW_(sh, ITEM_HEADERS)).getValues();
    data.forEach(function (r) {
      var q = String(r[ITEM_COLS.quoteNo - 1]), t = String(r[ITEM_COLS.itemType - 1]);
      if (t === 'docopts') {
        try { var o = JSON.parse(r[ITEM_COLS.flavorList - 1] || '{}'); if (o && o.taxDisplay === 'excl') m.__excl[q] = true; } catch (e) {}
        return;
      }
      if (t !== 'extra') return;
      if (String(r[ITEM_COLS.name - 1] || '').indexOf('運費') < 0) return;
      sum[q] = (sum[q] || 0) + (Number(r[ITEM_COLS.subtotal - 1] !== '' ? r[ITEM_COLS.subtotal - 1] : r[ITEM_COLS.unitPrice - 1]) || 0);
    });
    Object.keys(sum).forEach(function (q) { var v = fxShipNet_(sum[q]); if (v > 0) m[q] = v; });
  } catch (e) {}
  return m;
}
function fxOrderStatusOf_(quoteNo) {
  var all = v2ReadAll_(SHEET_ORDER_STATUS, ORDER_STATUS_HEADERS);
  for (var i = 0; i < all.length; i++) if (String(all[i].quote_no) === String(quoteNo)) return all[i];
  return null;
}

// ═══ 轉單：報價單 → 廠務訂單 ═══════════════════════════
// 建單人員＝目前登入者名稱（例：Molly），後面帶報價單號；排程同步無登入者時退回「報價系統」
function fxCreatorName_() {
  try {
    if (typeof CURRENT_USER_ !== 'undefined' && CURRENT_USER_ && CURRENT_USER_.name) {
      var n = String(CURRENT_USER_.name).trim();
      if (n && n !== '廠務APP') return n;   // 廠務APP 是反向匯入時的暫代身分，不算登入者
    }
  } catch (e) {}
  return '報價系統';
}

function fxBuildOrderPayload_(quote, os, map) {
  var items = (quote.items || []).filter(function (it) { return String(it.itemType) === 'bottle' && String(it.name || '').trim(); })
    .map(function (it) {
      return { product: fxProductToFactory_(map, it.name), sheet: '', volume: (fxVolMl_(it.volume) ? fxVolMl_(it.volume) + 'ml' : ''),
        bottleType: '', qty: Math.floor(Number(it.qty)) || 0, status: '待製作' };
    }).filter(function (it) { return it.qty > 0; });
  var lot = '';
  (quote.items || []).some(function (it) { if (String(it.itemType) === 'bottle' && fxLotDigits_(it.lot)) { lot = fxLotDigits_(it.lot); return true; } return false; });
  var conv = fxConv_(fxExclOfItems_(quote.items), quote.grandTotal, quote.taxAmount);
  var gt = conv.excl ? conv.net : (Number(quote.grandTotal) || 0);           // 未稅顯示的單＝送未稅總計（Molly 2026-09-10 選 A）
  var ship = fxConvAmt_(fxShippingOfItems_(quote.items), conv) || 0;        // 廠務「總金額」不含運費、運費另有「運費金額」欄
  var dep = os ? fxConvAmt_(os.deposit_amt, conv) : '';
  var fin = os ? fxConvAmt_(os.final_amt, conv) : '';
  if (conv.excl && dep !== '' && fin !== '' && (dep + fin) !== gt && Math.round((fxNum_(os.deposit_amt) + fxNum_(os.final_amt))) === conv.gt) fin = gt - dep;   // 換算後進位差，讓訂金＋尾款＝總計
  var balance = (fin !== '') ? fin : (dep !== '' ? Math.max(0, gt - dep) : gt);
  var taxNote = conv.excl ? '｜報價單未稅顯示：未稅 ' + conv.net + '（含稅 ' + conv.gt + '，稅 ' + conv.tax + '）' : '';
  var depositStatus = (os && os.final_date) ? '已結清' : ((os && os.deposit_date) ? '已收訂' : '未收');
  return {
    quoteNo: quote.quoteNo,
    client: fxClientToFactory_(map, quote.clientName),
    orderType: FX_PUSH_QUOTE_TYPES[String(quote.quoteType)] || FX_TYPE_OEM,
    deliveryDate: (os && os.ship_date_est) || quote.expectedShipDate || '',
    actualDeliveryDate: (os && os.ship_date_actual) || '',
    items: JSON.stringify(items),
    total: Math.max(0, gt - ship), balance: balance, depositStatus: depositStatus,
    pm: quote.handler || '', lot: lot,
    orderCreator: fxCreatorName_() + '(' + quote.quoteNo + ')',
    orderNote: ('報價單 ' + quote.quoteNo + taxNote + (quote.remark ? '｜' + String(quote.remark).slice(0, 200) : '')),
    // 金流九欄（報價系統為主）
    depositAmount: dep, depositDueDate: '', depositPaidDate: (os && os.deposit_date) || '',
    finalAmount: fin, finalDueDate: (os && os.final_date_est) || '', finalPaidDate: (os && os.final_date) || '',
    finalAdjusted: 'false', finalAdjustedAmount: '', finalAdjustNote: '',
    // 配送八欄
    shipMethod: '', shipFee: (ship > 0 ? ship : ''), shipFeePayer: (ship > 0 ? FX_PAYER_CLIENT : ''), recvName: quote.shipContact || quote.contactName || '', recvPhone: quote.shipPhone || quote.contactPhone || '',
    recvAddr: quote.shipAddress || quote.clientAddress || '', taxId: quote.clientTaxId || '',
    invoiceSent: 'false', invoiceLast5: (os && os.invoice_last5) || ''
  };
}
// 讀廠務某一張訂單的現況（full view，含每款 shipped、shipBatches、配送／金流欄）；找不到 order＝null
// 複檢 0923：整包 extGetOrders（全部訂單＋出貨紀錄、fresh）實測 15～20 秒，推單再加建單會超過前端 25 秒 → 只查一張（findOrderNo／findQuoteNo），
//   走廠務的讀取快取（廠務任何改訂單／出貨的動作都會立刻清快取，所以不會讀到舊的）
function fxFetchFactoryOrder_(orderNo, quoteNo) {
  var q = orderNo ? { findOrderNo: String(orderNo) } : { findQuoteNo: String(quoteNo) };
  var r = fxCall_('extGetOrders', q);
  if (!r || !r.ok) return { ok: false, error: '讀取廠務訂單失敗：' + ((r && r.error) || '無回應') };
  var o = (r.orders || []).filter(function (x) { return orderNo ? String(x.orderNo) === String(orderNo) : String(x.qsQuoteNo || '').trim() === String(quoteNo); })[0] || null;
  return { ok: true, order: o };
}
// 複檢 0923（P0）：「更新廠務訂單」原本用報價單重建整張廠務訂單，廠務 updateOrder 是整列覆寫
//   → 瓶型／酒譜綁定／試飲／Lot／配送方式／運費支付方／發票已隨貨／備註／客戶鍵全被清空或蓋回，實際出貨日變回表訂日。
//   線上實證：日富一日 260909-001 9/10 更新後客戶鍵與酒譜綁定被清掉（同仁 9/14～15 重補）；babyface 260915-001 更新後 Lot 18 被清空。
//   現在：先讀廠務現況，報價系統只負責「數量、表訂出貨日、金流（總額／訂金／尾款／收款日）、客戶付的運費」，
//   其餘以廠務為準、廠務空白才用報價單的；廠務有進度的款被拿掉或數量低於已出貨 → 不推，列出衝突請同仁確認。
function fxNameKey_(s) { return String(s || '').replace(/[\s　]+/g, '').toLowerCase().replace(/v\d+$/, ''); }
function fxMl_(v) {
  var s = String(v == null ? '' : v).trim(); if (!s) return '';
  var n = parseFloat(s.replace(/[^\d.]/g, '')); if (!(n > 0)) return '';
  if (/(ml|cc|毫升|c\.c)/i.test(s)) return String(Math.round(n));
  if (/(公升|公斤|升|l\b|l$|ℓ)/i.test(s)) return String(Math.round(n * 1000));
  return String(Math.round(n));
}
function fxMergeUpdatePayload_(p, cur) {
  var out = {}; Object.keys(p).forEach(function (k) { out[k] = p[k]; });
  var notes = [], conflicts = [];
  var blank = function (v) { return v === '' || v == null; };
  var keep = function (k) { if (!blank(cur[k])) out[k] = cur[k]; };   // 廠務有值就用廠務的
  out.client = cur.client || p.client;
  out.orderType = cur.orderType || p.orderType;
  keep('pm'); keep('lot'); keep('orderNote'); keep('shipMethod'); keep('recvName'); keep('recvPhone'); keep('recvAddr'); keep('taxId');
  if (!blank(cur.orderCreator)) out.orderCreator = cur.orderCreator;
  out.invoiceSent = cur.invoiceSent ? 'true' : 'false';
  out.invoiceLast5 = !blank(p.invoiceLast5) ? p.invoiceLast5 : (cur.invoiceLast5 || '');
  // 表訂出貨日：報價系統沒填（例：廠務匯入的單）＝廠務的留著（原本會被清空，連帶實際出貨日也變空）
  if (blank(p.deliveryDate) && !blank(cur.deliveryDate)) out.deliveryDate = cur.deliveryDate;
  // 運費：廠務標「南坡萬付運費」＝公司成本，報價系統不動（兩邊講法不同時 fxFinCompare_ 會提示）；
  //   其餘（客戶付）以報價單為準：報價單有運費列＝那個數字；報價單拿掉了、廠務原本是客戶付 → 一起拿掉；沒標支付方又沒運費列 → 不確定是誰的，照廠務的留著
  var qsShip = fxNum_(p.shipFee), curFee = fxNum_(cur.shipFee), curPayer = String(cur.shipFeePayer || '').trim();
  if (curPayer === FX_PAYER_CO) { out.shipFee = curFee; out.shipFeePayer = curPayer; }
  else if (qsShip !== '' && qsShip > 0) { out.shipFee = qsShip; out.shipFeePayer = FX_PAYER_CLIENT; }
  else if (curPayer === FX_PAYER_CLIENT) { out.shipFee = ''; out.shipFeePayer = ''; }
  else { out.shipFee = curFee; out.shipFeePayer = curPayer; }
  // 金流：報價系統為主；報價系統這邊沒有的（''）不要把廠務填的清掉；訂金預計日／尾款特殊調整是廠務專用欄
  ['depositAmount', 'depositPaidDate', 'finalAmount', 'finalDueDate', 'finalPaidDate'].forEach(function (k) { if (blank(p[k]) && !blank(cur[k])) out[k] = cur[k]; });
  out.depositDueDate = cur.depositDueDate || '';
  out.finalAdjusted = cur.finalAdjusted ? 'true' : 'false';
  out.finalAdjustedAmount = cur.finalAdjusted ? cur.finalAdjustedAmount : '';
  out.finalAdjustNote = cur.finalAdjustNote || '';
  // 訂金狀態跟著合併後的收款日走（原本收款日留廠務的、狀態卻用報價系統的「未收」，兩個對不起來）
  if (!blank(out.finalPaidDate)) out.depositStatus = '已結清';
  else if (!blank(out.depositPaidDate)) out.depositStatus = (!blank(cur.depositStatus) && String(cur.depositStatus) !== '未收' && String(cur.depositStatus) !== '已結清') ? cur.depositStatus : '已收訂';
  // 實際出貨日（L 欄）：已經有出貨紀錄或已確認 → 原封不動；還沒出貨才用報價系統的（空＝updateOrder 用表訂出貨日）
  if ((Number(cur.shipBatches) || 0) > 0 || cur.shipDateConfirmed) out.actualDeliveryDate = cur.actualDeliveryDate || '';
  // 品項配對：①全部先配「同酒款＋同容量」②剩下的配「同酒款」（容量改了）。酒款名不同就是不同款（新增＋拿掉），
  //   不再用「同位置」硬配——原本報價單把桂花換成蜜香，會被當成同一款、廠務照做桂花。帶回廠務的酒名／瓶型／酒譜／試飲／製作狀態
  var pushed = []; try { pushed = JSON.parse(p.items || '[]'); } catch (e) { pushed = []; }
  var curItems = (cur.items || []).map(function (it) { return { it: it, used: false }; });
  var vk = function (v) { return fxMl_(v); };
  var matchOf = pushed.map(function () { return null; });
  pushed.forEach(function (pi, idx) {
    var k = fxNameKey_(pi.product);
    for (var a = 0; a < curItems.length; a++) if (!curItems[a].used && fxNameKey_(curItems[a].it.product) === k && vk(curItems[a].it.volume) === vk(pi.volume)) { curItems[a].used = true; matchOf[idx] = curItems[a]; return; }
  });
  pushed.forEach(function (pi, idx) {
    if (matchOf[idx]) return;
    var k = fxNameKey_(pi.product);
    for (var b = 0; b < curItems.length; b++) if (!curItems[b].used && fxNameKey_(curItems[b].it.product) === k) { curItems[b].used = true; matchOf[idx] = curItems[b]; return; }
  });
  var merged = [], newCount = matchOf.filter(function (x) { return !x; }).length;
  pushed.forEach(function (pi, idx) {
    var m = matchOf[idx];
    if (!m) { merged.push(pi); notes.push('新增酒款「' + pi.product + '」' + (pi.volume ? pi.volume : '') + ' ×' + pi.qty); return; }
    var c = m.it;
    var shipped = Number(c.shipped) || 0;
    var volChanged = vk(pi.volume) !== '' && vk(c.volume) !== '' && vk(c.volume) !== vk(pi.volume);   // 廠務沒填容量＝不算改
    if (volChanged && (shipped > 0 || c.status === '完成' || c.batchId)) {
      conflicts.push('「' + c.product + '」廠務已' + (shipped > 0 ? '出貨 ' + shipped : '完成製作') + '（' + (c.volume || '原容量') + '），報價單卻改成 ' + pi.volume);
      merged.push(c); return;
    }
    var item = { product: c.product || pi.product, sheet: c.sheet || '', volume: volChanged ? pi.volume : (c.volume || pi.volume || ''),
      bottleType: volChanged ? '' : (c.bottleType || ''), qty: pi.qty, status: c.status || '待製作' };
    if (c.batchId) item.batchId = c.batchId;
    if (c.srcClient) item.srcClient = c.srcClient;
    if (c.sample) item.sample = c.sample;
    if (volChanged) notes.push('「' + item.product + '」容量 ' + (c.volume || '—') + '→' + pi.volume + '（瓶型請同仁重選）');
    if (pi.qty < shipped) conflicts.push('「' + item.product + '」廠務已出貨 ' + shipped + '，報價單卻改成 ' + pi.qty);
    else if ((Number(c.qty) || 0) !== pi.qty) notes.push('「' + item.product + '」數量 ' + c.qty + '→' + pi.qty + (c.status === '完成' ? '（這款廠務已完成製作，請同仁確認要不要補做）' : ''));
    merged.push(item);
  });
  curItems.forEach(function (c) {
    if (c.used) return;
    var it = c.it, sh = Number(it.shipped) || 0;
    if (sh > 0 || it.status === '完成' || it.batchId) conflicts.push('「' + it.product + '」廠務已' + (sh > 0 ? '出貨 ' + sh : '完成製作') + '，報價單卻沒有這款');
    else if (newCount > 0 && (String(it.sheet || '').trim() || it.srcClient || String(it.bottleType || '').trim() || it.sample))
      // 一款沒配到＋報價單又多一款新的＝多半是同仁在廠務改過酒名（補綁酒譜會改名），也可能是換酒款 → 不猜，先擋下
      conflicts.push('「' + it.product + '」廠務已經設定好（酒譜／瓶型），報價單卻換成別的酒名：如果報價單上那款就是它（同仁在廠務改過名字），請到「🏭 廠務對照」把報價單的酒名對到「' + it.product + '」再推；如果是真的換酒款，請同仁先在廠務把這款拿掉');
    else notes.push('「' + it.product + '」報價單沒有這款，廠務這款會一併拿掉');
  });
  out.items = JSON.stringify(merged);
  return { payload: out, notes: notes, conflicts: conflicts };
}
// action: factoryPushOrder {quote_no, force_new?:'1'}
function handleFactoryPushOrder_(params) {
  var quoteNo = params.quote_no || params.quoteNo;
  if (!quoteNo) throw new Error('缺少 quote_no');
  if (!fxConfigured_()) return { ok: false, error: '廠務連結尚未設定' };
  var q = handleGetQuoteById_({ quoteNo: quoteNo });
  if (!q || !q.ok) return { ok: false, error: (q && q.error) || '找不到報價單' };
  var quote = q.quote;
  var st = String(quote.status || '');
  if (st === '純報價') return { ok: false, error: '純報價單不轉廠務訂單' };
  if (st === '已刪除') return { ok: false, error: '已刪除的報價單不能轉' };
  if (!FX_PUSH_QUOTE_TYPES[String(quote.quoteType)]) return { ok: false, error: '這種單型（' + quote.quoteType + '）不轉廠務：只有瓶裝代工／公版買斷／客製標會轉' };
  var map = fxMapAll_();
  var os = fxOrderStatusOf_(quoteNo);
  if (os && String(os.status) === 'cancelled') return { ok: false, error: '這張單在訂單追蹤是「取消」，不轉廠務（要恢復請先改回訂單追蹤的狀態）' };
  var payload = fxBuildOrderPayload_(quote, os, map);
  var itemsArr = JSON.parse(payload.items);
  if (!itemsArr.length) return { ok: false, error: '報價單沒有可轉的瓶裝品項（數量要大於 0）' };
  var link = fxLinksAll_().filter(function (l) { return String(l.quote_no) === String(quoteNo) && String(l.factory_order_no || '').trim(); })[0] || null;
  var forceNew = String(params.force_new || '') === '1';
  var notes = [];
  // 先找廠務現在那張單：連著的 → 用連結的單號找（不見了＝GONE，交給前端問要不要重建）；
  //   沒連結／重建（force_new）→ 找「對應報價單號」＝這張的（連結表漏記或誤標刪除時，extCreateOrder 會更新那張，一樣要走合併、不能整張蓋掉）
  var curOrder = null;
  if (link && !forceNew && String(link.factory_status || '') === '廠務已刪除') return { ok: false, code: 'FACTORY_ORDER_GONE', factory_order_no: String(link.factory_order_no),
    error: '廠務訂單 ' + link.factory_order_no + ' 已經不在廠務系統（同仁刪掉了）。' };
  if (link && !forceNew) {
    var cur = fxFetchFactoryOrder_(link.factory_order_no, '');
    if (!cur.ok) return { ok: false, error: cur.error };
    if (!cur.order) return { ok: false, code: 'FACTORY_ORDER_GONE', factory_order_no: String(link.factory_order_no),
      error: '廠務訂單 ' + link.factory_order_no + ' 已經不在廠務系統（可能被同仁刪除了）。' };
    // 訂單編號會被回收（當天最後一張刪掉、又建新單＝拿到同一個號碼）：AI 欄空白時要確認是同一張，不然會把別位客戶的單蓋掉
    if (!String(cur.order.qsQuoteNo || '').trim()) {
      var lf = {}; try { lf = JSON.parse(link.factory_fin_json || '{}') || {}; } catch (e) { lf = {}; }
      var same = fxPushedQuoteNoOf_(cur.order) === String(quoteNo) || fxSameClient_(cur.order.client, lf.client) || fxSameClient_(cur.order.client, payload.client) || fxSameClient_(cur.order.client, quote.clientName);
      if (!same) return { ok: false, code: 'FACTORY_ORDER_GONE', factory_order_no: String(link.factory_order_no),
        error: '廠務訂單 ' + link.factory_order_no + ' 這個號碼現在是另一張單（客戶「' + (cur.order.client || '') + '」）：原本那張應該被刪了、號碼被新單用走。' };
    }
    curOrder = cur.order;
  } else {
    var fq = fxFetchFactoryOrder_('', quoteNo);
    if (!fq.ok) return { ok: false, error: fq.error };
    curOrder = fq.order;
    if (!curOrder && link) {
      fxLinkUpsert_(quoteNo, { factory_order_no: '', factory_status: '', fin_mismatch: '', ship_json: '', note: '廠務訂單 ' + link.factory_order_no + ' 已刪除，重新建單' });
    }
  }
  if (curOrder) {
    if (fxIsConsignOrder_(curOrder)) return { ok: false, error: '廠務訂單 ' + curOrder.orderNo + ' 是經銷商寄售單，不從報價系統更新' };
    var curQ = String(curOrder.qsQuoteNo || '').trim();
    if (curQ && curQ !== String(quoteNo)) return { ok: false, error: '廠務訂單 ' + curOrder.orderNo + ' 已對應到另一張報價單 ' + curQ };
    var mg = fxMergeUpdatePayload_(payload, curOrder);
    if (mg.conflicts.length) return { ok: false, code: 'CONFLICT', conflicts: mg.conflicts, factory_order_no: String(curOrder.orderNo),
      error: '廠務那邊已經有進度，這次更新會對不上：\n' + mg.conflicts.join('\n') + '\n請先跟同仁確認，到廠務系統手動調整。' };
    payload = mg.payload; notes = mg.notes;
    // 廠務 AI 欄（對應報價單號）空白＝當初回填失敗 → 先補上，extCreateOrder 才找得到這張、不會另建一張
    if (!curQ) {
      var mk = fxCall_('extMarkImported', { orderNo: curOrder.orderNo, quoteNo: quoteNo });
      if (!mk || !mk.ok) return { ok: false, error: '補回廠務「對應報價單號」失敗：' + ((mk && mk.error) || '無回應') };
    }
    if (!link || String(link.factory_order_no) !== String(curOrder.orderNo)) notes.push('連結改成廠務訂單 ' + curOrder.orderNo + '（廠務那邊本來就有這張報價單的單）');
  }
  var r = fxCall_('extCreateOrder', payload);
  if (!r || !r.ok) return { ok: false, error: '廠務建單失敗：' + ((r && r.error) || '無回應') };
  if (curOrder && !r.updated) notes.push('⚠ 廠務沒找到原本那張 ' + curOrder.orderNo + '，另建了一張 ' + r.orderNo);
  fxLinkUpsert_(quoteNo, { factory_order_no: r.orderNo, source: (curOrder && link) ? (link.source || 'push') : 'push', last_sync: tpeNow_(),
    note: (r.updated ? '已更新廠務訂單' : '已建立廠務訂單') + ' ' + r.orderNo });
  try { logChange_('factoryPushOrder', quoteNo, { factory_order_no: r.orderNo, updated: !!r.updated, client: payload.client, items: itemsArr.length, notes: notes }); } catch (e) {}
  return { ok: true, quote_no: quoteNo, factory_order_no: r.orderNo, updated: !!r.updated, client: payload.client, items: itemsArr.length, notes: notes };
}

// ═══ 同步：廠務 → 報價系統 ═══════════════════════════════
// 金流比對：兩邊都有值且不同才算不符（'' 視為未填不比）
function fxFinCompare_(os, o, quoteShip, conv) {
  var out = [];
  conv = conv || { excl: false, factor: 1 };
  var ship = fxConvAmt_(Number(quoteShip) || 0, conv) || 0;
  var fxShipFee = fxNum_(o.shipFee);
  var payer = String(o.shipFeePayer || '').trim();
  var coPays = (payer === FX_PAYER_CO);   // 2026-09-10 Molly：南坡萬自付的運費＝成本，不進營收、不跟報價單比
  var tag = conv.excl ? '（未稅）' : '';
  function cmp(label, a, b) {
    a = fxNum_(a); b = fxNum_(b);
    if (a === '' || b === '') return;
    if (Math.abs(Math.round(a) - Math.round(b)) <= (conv.excl ? 1 : 0)) return;   // 未稅換算允許 1 元進位差
    // 2026-09-09 Molly：報價單含運費、廠務「總金額」不含（運費另填在「運費金額」欄，同仁常留空）→ 差額剛好＝運費就算一致
    if (ship > 0 && fxShipFee === '' && Math.round(a) === Math.round(b) + ship) return;
    out.push(label + '：報價 ' + a + ' ≠ 廠務 ' + b);
  }
  if (!os) return out;
  // 總額拆成「貨款」與「運費」各比各的：報價單總計含運費、廠務「總金額」不含（運費另一欄）
  var fxGoods = (Number(o.total) || 0) > 0 ? Number(o.total) : '';   // 廠務 total 預設 0＝未填
  var qsGoods = (fxNum_(os.grand_total) === '') ? '' : (fxConvAmt_(os.grand_total, conv) - ship);
  if (fxGoods !== '' && qsGoods !== '' && Math.abs(Math.round(fxGoods) - Math.round(qsGoods)) > (conv.excl ? 1 : 0)) out.push('貨款（不含運費）' + tag + '：報價 ' + qsGoods + ' ≠ 廠務 ' + fxGoods);
  if (coPays) {
    // 廠務標「南坡萬付運費」：這筆是成本（記在 factory_fin_json.shipCost 給月報表用）。報價單若還向客戶收運費就是兩邊講法不同，提示一下
    if (ship > 0) out.push('運費支付方：報價單向客戶收運費 ' + ship + '，廠務卻標「' + FX_PAYER_CO + '」');
  } else if (fxGoods !== '' && fxShipFee !== '' && Math.round(fxShipFee) !== ship) {
    out.push('運費' + tag + '：報價 ' + ship + ' ≠ 廠務 ' + fxShipFee + (ship === 0 && !payer ? '（若是南坡萬自付，請在廠務把「運費支付方」改成「' + FX_PAYER_CO + '」就不會再提示）' : ''));
  }
  cmp('訂金' + tag, fxConvAmt_(os.deposit_amt, conv), o.depositAmount);
  var fxFinal = (o.finalAdjusted && o.finalAdjustedAmount !== '') ? o.finalAdjustedAmount : o.finalAmount;
  cmp('尾款' + tag, fxConvAmt_(os.final_amt, conv), fxFinal);
  return out;
}
function fxShipTag_(orderNo, seq) { return '[FX:' + orderNo + ':' + seq + ']'; }
function fxShipTagSeq_(note, orderNo) {
  var s = String(note || ''), pre = '[FX:' + orderNo + ':';
  if (s.indexOf(pre) !== 0) return null;
  var m = s.slice(pre.length).match(/^(\d+)\]/);
  return m ? Number(m[1]) : null;
}
// 把廠務出貨紀錄（同 orderNo 依 seq 分組）upsert 進 order_shipments；回 {batches:[{seq,date,lines:[{product,bottleType,qty}]}], changed:n}
function fxSyncShipments_(quoteNo, o, shipRows, existingShips, opts) {
  opts = opts || {};
  var bySeq = {};
  (shipRows || []).forEach(function (s) {
    if (String(s.orderNo) !== String(o.orderNo)) return;
    var k = String(s.seq || 0);
    if (!bySeq[k]) bySeq[k] = { seq: Number(s.seq) || 0, date: s.date || '', lines: [], operator: s.operator || '' };
    bySeq[k].lines.push({ product: s.product, bottleType: s.bottleType, qty: s.qty });
  });
  var batches = Object.keys(bySeq).map(function (k) { return bySeq[k]; }).sort(function (a, b) { return a.seq - b.seq; });
  var changed = 0;
  var lotTxt = fxLotDigits_(o.lot) ? ' Lot ' + fxLotDigits_(o.lot) : '';
  batches.forEach(function (b) {
    var tag = fxShipTag_(o.orderNo, b.seq);
    var summary = b.lines.map(function (l) { return l.product + '×' + l.qty; }).join('、');
    var note = tag + lotTxt + ' · 廠務出貨 ' + summary + (b.operator ? '，' + b.operator : '');
    var hit = null;
    for (var i = 0; i < existingShips.length; i++) {
      if (String(existingShips[i].quote_no) === String(quoteNo) && String(existingShips[i].note || '').indexOf(tag) === 0) { hit = existingShips[i]; break; }
    }
    if (hit) {
      // 接管過驗收單那筆的 note 會是「FX 段 + 原 VF 段」，比對只看 FX 段，才不會每次同步都改一次
      var curNote = String(hit.note || ''), vfPos = curNote.indexOf(' [VF:');
      var curBase = vfPos > 0 ? curNote.slice(0, vfPos) : curNote, tail = vfPos > 0 ? curNote.slice(vfPos) : '';
      if (String(hit.ship_date_actual || '') !== String(b.date || '') || curBase !== note) {
        handleUpdateShipment_({ id: hit.id, fields: { ship_date_actual: b.date, note: note + tail } }); hit.note = note + tail; hit.ship_date_actual = b.date; changed++;
      }
    } else {
      // 驗收單那條路徑（[VF:...]）若已為同一天寫過一筆，就把那筆接管（避免月曆同一天兩筆）
      var vf = null;
      for (var j = 0; j < existingShips.length; j++) {
        var e = existingShips[j];
        if (String(e.quote_no) === String(quoteNo) && String(e.ship_date_actual || '') === String(b.date || '') && String(e.note || '').indexOf('[VF:') === 0) { vf = e; break; }
      }
      if (vf) { handleUpdateShipment_({ id: vf.id, fields: { note: note + ' ' + String(vf.note || '') } }); vf.note = note + ' ' + String(vf.note || ''); changed++; }
      else {
        var r = handleAddShipment_({ quote_no: quoteNo, fields: { ship_date_est: b.date, ship_date_actual: b.date, note: note } });
        existingShips.push({ id: r.id, quote_no: quoteNo, ship_date_actual: b.date, note: note }); changed++;
      }
    }
  });
  // 複檢 0923：廠務刪掉（或重編）的出貨批次 → 這邊那筆 [FX:單號:批次] 也要拿掉，不然行事曆一直顯示一趟沒發生的出貨。
  //   只動同步自己寫的列；有接管驗收單（note 後段帶 [VF:…]）的只去掉 FX 段、驗收單那段留著。
  var alive = {}; batches.forEach(function (b) { alive[String(b.seq)] = true; });
  var removed = 0;
  // 廠務 extGetOrders 讀出貨紀錄失敗時會回空陣列（ok 照樣 true）→ 這張單的批數（shipBatches，廠務另外算的）對不上就先不清
  if (opts.noRemove || batches.length !== (Number(o.shipBatches) || 0)) return { batches: batches, changed: changed, removed: 0 };
  for (var x = existingShips.length - 1; x >= 0; x--) {
    var e2 = existingShips[x];
    if (String(e2.quote_no) !== String(quoteNo)) continue;
    var sq = fxShipTagSeq_(e2.note, o.orderNo);
    if (sq === null || alive[String(sq)]) continue;
    var nt = String(e2.note || ''), vp = nt.indexOf(' [VF:');
    var hasMoney = ['amount', 'invoice_no', 'invoice_last5'].some(function (k) { return String(e2[k] == null ? '' : e2[k]).trim() !== ''; });
    try {
      if (vp > 0) { handleUpdateShipment_({ id: e2.id, fields: { note: nt.slice(vp + 1) } }); e2.note = nt.slice(vp + 1); }
      else if (hasMoney) {
        // Molly 在這筆填過金額／發票：不刪，拿掉 [FX:] 標記（同步不再管它）、開頭註明廠務刪了這趟
        var rest = nt.replace(/^\[FX:[^\]]*\]\s*/, '');
        var nn = '⚠ 廠務已刪除這趟出貨（原第 ' + sq + ' 次）' + (rest ? '：' + rest : '');
        handleUpdateShipment_({ id: e2.id, fields: { note: nn } }); e2.note = nn;
      }
      else { handleDeleteShipment_({ id: e2.id }); existingShips.splice(x, 1); }
      removed++; changed++;
    } catch (err) {}
  }
  return { batches: batches, changed: changed, removed: removed };
}

// 反向匯入：廠務同仁建的「有金流」訂單 → 草稿報價單＋訂單追蹤；回 quoteNo
function fxImportOrder_(o, map, customers, priceCtx) {
  var quoteType = (String(o.orderType) === FX_TYPE_OEM) ? 'bottle' : 'ownbrand';
  var clientName = fxClientToQs_(map, o.client, customers);
  var cust = null;
  for (var i = 0; i < customers.length; i++) if (fxKey_(customers[i].name) === fxKey_(clientName)) { cust = customers[i]; break; }
  var items = [];
  var sub = 0;
  (o.items || []).forEach(function (it) {
    var name = fxProductToQs_(map, it.product);
    var vol = fxVolMl_(it.volume);
    var qty = Math.floor(Number(it.qty)) || 0;
    if (!name || qty <= 0) return;
    var price = fxLookupPrice_(priceCtx, clientName, name, vol);
    var lineSub = (price !== '' ? Number(price) * qty : 0);
    sub += lineSub;
    items.push({ itemType: 'bottle', name: name, lot: (fxLotDigits_(o.lot) ? 'Lot ' + fxLotDigits_(o.lot) : ''), volume: vol,
      unitPrice: (price !== '' ? price : 0), deduction: 0, logoFee: 0, qty: qty, unit: '瓶', subtotal: lineSub,
      flavorList: '', is_oem: (quoteType === 'bottle' ? 'Y' : 'N'), is_label: 'N', listPrice: '', discount: '', noCharge: 'N' });
  });
  if (!items.length) return { ok: false, error: '沒有可匯入的酒款' };
  var total = Number(o.total) || 0;
  var grand = total > 0 ? total : sub;
  // 複檢 0923：廠務「運費金額」（客戶付的；南坡萬付運費＝成本不進報價單）→ 報價單加一列運費，總計含運費（跟推單時的算法對稱）
  var fxShip = fxNum_(o.shipFee), extrasTotal = 0;
  if (fxShip !== '' && fxShip > 0 && String(o.shipFeePayer || '').trim() !== FX_PAYER_CO) {
    items.push({ itemType: 'extra', name: '運費', lot: '', volume: '', unitPrice: fxShip, deduction: 0, logoFee: 0, qty: 1, unit: '式', subtotal: fxShip,
      flavorList: '', is_oem: 'N', is_label: 'N', listPrice: '', discount: '', noCharge: 'N' });
    extrasTotal = fxShip; grand += fxShip;
  }
  var today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  var quote = {
    quoteType: quoteType, clientName: clientName,
    contactName: (cust && cust.contact) || o.recvName || '', clientTaxId: o.taxId || (cust && cust.tax_id) || '',
    contactPhone: (cust && cust.phone) || o.recvPhone || '', clientAddress: (cust && cust.address) || '',
    invoiceTitle: (cust && cust.invoice_title) || '',
    shipContact: o.recvName || (cust && cust.ship_contact) || '', shipPhone: o.recvPhone || (cust && cust.ship_phone) || '',
    shipAddress: o.recvAddr || (cust && cust.ship_address) || '',
    quoteDate: today, expiryDate: '', handler: o.pm || '',
    itemsSubtotal: sub, taxAmount: 0, extrasTotal: extrasTotal, grandTotal: grand,
    // 2026-09-23 Molly：客戶主檔的付款習慣帶進付款條件（自訂 Tab3）
    priceMode: 'inc', taxRate: 5,
    paymentType: (cust && String(cust.pay_habit || '').trim()) ? '3' : '',
    paymentDetail: (cust && String(cust.pay_habit || '').trim()) || '',
    remark: '由廠務訂單 ' + o.orderNo + ' 自動帶入（' + (o.orderCreator || '') + '）' + (o.orderNote ? '｜' + o.orderNote : '') + '；單價為系統自動帶牌價，請確認',
    status: '草稿', expectedShipDate: o.deliveryDate || '', showShipDate: (o.deliveryDate ? 'Y' : 'N'),
    items: items
  };
  if (typeof CURRENT_USER_ === 'undefined' || !CURRENT_USER_) { try { CURRENT_USER_ = { name: '廠務APP', role: 'owner' }; } catch (e) {} }
  var r = handleCreateQuote_({ quote: quote });
  if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'createQuote 失敗' };
  var quoteNo = r.quoteNo;
  try { logChange_('factoryImport', quoteNo, { factory_order_no: o.orderNo, client: clientName, items: items.length }); } catch (e) {}
  // 複檢 0923：廠務客戶鍵（OEM-好野吧）跟報價系統客戶名（好野吧）不同時記進對照表，之後這位客戶的單推過去才會用廠務的客戶鍵
  try {
    if (String(o.client || '').trim() && fxKey_(o.client) !== fxKey_(clientName) && !fxMapLookup_(map, 'client', 'qs_name', 'factory_name', clientName)) {
      handleSaveFactoryMap_({ rows: [{ kind: 'client', qs_name: clientName, factory_name: String(o.client).trim(), note: '匯入 ' + o.orderNo + ' 時自動記下' }] });
      map.push({ kind: 'client', qs_name: clientName, factory_name: String(o.client).trim() });
    }
  } catch (e) {}
  try { upsertShipCalendar_(quoteNo, clientName, o.deliveryDate || ''); } catch (e) {}
  // 訂單追蹤：直接帶廠務金流（這裡是「初始值」，之後兩邊不同會提示）
  var fields = { status: 'quoted', grand_total: grand, ship_date_est: o.deliveryDate || '', track_note: '廠務訂單 ' + o.orderNo };
  if (fxNum_(o.depositAmount) !== '') fields.deposit_amt = fxNum_(o.depositAmount);
  if (o.depositPaidDate) fields.deposit_date = o.depositPaidDate;
  if (fxNum_(o.finalAmount) !== '') fields.final_amt = fxNum_(o.finalAmount);
  if (o.finalDueDate) fields.final_date_est = o.finalDueDate;
  if (o.finalPaidDate) fields.final_date = o.finalPaidDate;
  if (o.invoiceLast5) fields.invoice_last5 = o.invoiceLast5;
  if (o.shipDateConfirmed && o.actualDeliveryDate && o.status === '已出貨') fields.ship_date_actual = o.actualDeliveryDate;
  try { handleUpdateOrderStatus_({ quote_no: quoteNo, fields: fields }); } catch (e) {}
  return { ok: true, quoteNo: quoteNo, clientName: clientName };
}
// 牌價查找：公版 ownbrand_products（名稱＋容量）→ 代工客戶 products（公司名＋品名＋規格）→ ''
function fxPriceCtx_() {
  var ctx = { ob: [], products: [], companies: [] };
  try { ctx.ob = v2ReadAll_(SHEET_OWNBRAND_PRODUCTS, OWNBRAND_PRODUCTS_HEADERS); } catch (e) {}
  try { var cd = handleGetCompanyData_({ refresh: true }); ctx.products = cd.products || []; ctx.companies = cd.companies || []; } catch (e) {}
  return ctx;
}
function fxLookupPrice_(ctx, clientName, name, vol) {
  var nk = fxKey_(name), vk = fxKey_(vol);
  for (var i = 0; i < ctx.ob.length; i++) {
    var p = ctx.ob[i];
    if (String(p.active).toUpperCase() === 'N') continue;
    if (fxKey_(p.name) === nk && (!vk || fxKey_(fxVolMl_(p.volume)) === vk) && fxNum_(p.list_price) !== '') return fxNum_(p.list_price);
  }
  var cid = '';
  for (var j = 0; j < ctx.companies.length; j++) if (fxKey_(ctx.companies[j].name) === fxKey_(clientName)) { cid = String(ctx.companies[j].company_id); break; }
  if (!cid) return '';   // 客戶沒有自己的價目表就不猜別家的價
  for (var k = 0; k < ctx.products.length; k++) {
    var q = ctx.products[k];
    if (String(q.company_id) !== cid) continue;
    if (fxKey_(q.name) === nk && (!vk || fxKey_(fxVolMl_(q.spec)) === vk || !fxVolMl_(q.spec)) && fxNum_(q.unit_price) !== '') return fxNum_(q.unit_price);
  }
  return '';
}

// action: factorySync {} → 回 {ok, synced:n, imported:[...], mismatches:[...], errors:[...]}
// 複檢 0923：同步中旗標（CacheService，5.5 分鐘自動失效）＋短暫 ScriptLock 做「檢查並設定」。
//   原本整段抱著 ScriptLock 去打廠務 API（extGetOrders 可能 10～30 秒），期間別人存報價單／訂單進度等鎖等到逾時；
//   而且內層呼叫（handleUpdateOrderStatus_／handleCreateQuote_）自己 releaseLock 會把外層的鎖一起放掉，鎖本來就擋不住重疊。
function fxSyncBegin_(key) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return false;
  try {
    var c = null; try { c = CacheService.getScriptCache(); } catch (e) { c = null; }
    if (!c) return true;
    if (c.get(key)) return false;
    c.put(key, String(new Date().getTime()), 330);
    return true;
  } finally { lock.releaseLock(); }
}
function fxSyncEnd_(key) { try { CacheService.getScriptCache().remove(key); } catch (e) {} }
function handleFactorySync_(params) {
  if (!fxConfigured_()) return { ok: false, error: '廠務連結尚未設定' };
  if (!fxSyncBegin_('FX_SYNC_BUSY')) return { ok: false, busy: true, error: '另一個同步正在進行，稍後再試' };
  try {
    var r = fxCall_('extGetOrders', { fresh: '1' });
    if (!r || !r.ok) return { ok: false, error: '讀取廠務失敗：' + ((r && r.error) || '無回應') };
    var orders = r.orders || [], shipRows = r.shipments || [];
    var map = fxMapAll_();
    var links = fxLinksAll_();
    var byFx = {}, byQ = {};
    links.forEach(function (l) {
      if (l.factory_order_no && String(l.factory_status || '') !== '廠務已刪除') byFx[String(l.factory_order_no)] = l;   // 已標刪除的號碼可能被新單用走，不再拿來認
      byQ[String(l.quote_no)] = l;
    });
    var osAll = v2ReadAll_(SHEET_ORDER_STATUS, ORDER_STATUS_HEADERS);
    var osBy = {}; osAll.forEach(function (o) { osBy[String(o.quote_no)] = o; });
    var ships = v2ReadAll_(SHEET_ORDER_SHIPMENTS, ORDER_SHIP_HEADERS);
    var customers = []; try { customers = v2ReadAll_(SHEET_CUSTOMERS, CUSTOMERS_HEADERS); } catch (e) {}
    var shipMap = fxShippingMap_();
    var finMap = fxQuoteFinMap_();
    var priceCtx = null;
    var now = tpeNow_();
    var synced = 0, imported = [], mismatches = [], errors = [], shipChanged = 0, linkChanged = 0, paused = [], goneMarked = [], healed = [], shipRemoved = 0, osChanged = 0;
    var doImport = !(params && String(params.noImport) === '1');
    var seenFx = {}, touchedQ = {};
    // 整包一筆出貨紀錄都沒有、但這邊明明有同步寫過的 [FX:] 列 → 八成是廠務那次讀出貨紀錄失敗，這輪不清任何出貨列
    var shipsTrusted = shipRows.length > 0 || !ships.some(function (s0) { return String(s0.note || '').indexOf('[FX:') === 0; });
    orders.forEach(function (o) { seenFx[String(o.orderNo)] = true; });

    orders.forEach(function (o) {
      try {
        var quoteNo = String(o.qsQuoteNo || '').trim();
        var needMark = false;
        if (!quoteNo) {
          // AI 欄空白：①報價系統推過去的單（建單人員/備註帶報價單號）②連結表記著這張單號——但訂單號會被廠務回收，要確認是同一張
          var pq = fxPushedQuoteNoOf_(o);
          var lk = byFx[String(o.orderNo)];
          var pqL = pq ? byQ[pq] : null;
          var pqLinked = (pqL && String(pqL.factory_status || '') !== '廠務已刪除') ? String(pqL.factory_order_no || '') : '';
          if (pq && finMap[pq] && pqLinked && pqLinked !== String(o.orderNo) && seenFx[pqLinked]) {
            // 同一張報價單已經連著另一張還在的廠務單（例：同仁複製了推過去的單）→ 不接、不匯入，提示一下
            errors.push(o.orderNo + '：看起來是報價單 ' + pq + ' 推過去的，但 ' + pq + ' 已連結廠務訂單 ' + pqLinked + '（可能是同仁複製出來的單，請確認）');
            return;
          }
          if (pq && finMap[pq]) { quoteNo = pq; needMark = true; }
          else if (lk) {
            var qf0 = finMap[String(lk.quote_no)] || {};
            var lf0 = {}; try { lf0 = JSON.parse(lk.factory_fin_json || '{}') || {}; } catch (e) { lf0 = {}; }
            // 同一位客戶：上次同步記下的廠務客戶名／對照表換算回來的報價系統客戶名／名字本身，任一個對得上就是
            var sameClient = fxSameClient_(o.client, lf0.client) || fxSameClient_(fxClientToQs_(map, o.client, customers), qf0.client) || fxSameClient_(o.client, qf0.client);
            if (sameClient) { quoteNo = String(lk.quote_no); needMark = true; }
            else {
              // 同一個訂單號換成了別的客戶的新單（原單被刪、號碼被回收）→ 舊連結標「廠務已刪除」，這張當未連結處理
              fxLinkUpsert_(String(lk.quote_no), { factory_status: '廠務已刪除', fin_mismatch: '', ship_json: '', note: '廠務訂單 ' + o.orderNo + ' 原單已刪除（號碼被新單 ' + (o.client || '') + ' 用走）' });
              goneMarked.push(String(lk.quote_no)); delete byFx[String(o.orderNo)];
            }
          }
        }
        if (needMark) {
          var mk0 = fxCall_('extMarkImported', { orderNo: o.orderNo, quoteNo: quoteNo });
          if (mk0 && mk0.ok) healed.push(o.orderNo + '→' + quoteNo); else errors.push(o.orderNo + '：補回對應報價單號失敗（' + ((mk0 && mk0.error) || '無回應') + '）');
        }
        if (!quoteNo) {
          if (!doImport) return;
          if (!fxShouldImport_(o)) return;   // 舊單／寄售單／報價系統推過去的單不自動匯入
          if (!priceCtx) priceCtx = fxPriceCtx_();
          var imp = fxImportOrder_(o, map, customers, priceCtx);
          if (!imp.ok) { errors.push(o.orderNo + '：' + imp.error); return; }
          quoteNo = imp.quoteNo;
          // 先記連結再回填廠務 AI 欄：回填失敗時下一輪還認得（不會重複匯入），推單時也會先補回
          fxLinkUpsert_(quoteNo, { factory_order_no: o.orderNo, source: 'import', note: '由廠務訂單匯入' });
          var mk = fxCall_('extMarkImported', { orderNo: o.orderNo, quoteNo: quoteNo });
          if (!mk || !mk.ok) errors.push(o.orderNo + '：回填廠務對應報價單號失敗（' + ((mk && mk.error) || '無回應') + '），下次同步會再補');
          osBy[quoteNo] = fxOrderStatusOf_(quoteNo);
          finMap[quoteNo] = { client: imp.clientName, status: '草稿', gt: 0, tax: 0, pay: null };
          imported.push({ factory_order_no: o.orderNo, quote_no: quoteNo, client: imp.clientName });
        }
        touchedQ[quoteNo] = String(o.orderNo);
        var qf = finMap[quoteNo] || {};
        var qStatus = String(qf.status || '');
        // 複檢 0923：報價單已刪除／純報價 → 不再往訂單追蹤／出貨紀錄寫任何東西（原本每小時照寫，已刪的單會長回殘留列）
        if (qStatus === '已刪除' || qStatus === '純報價') {
          var pr = fxLinkUpsert_(quoteNo, { factory_order_no: o.orderNo, factory_status: o.status || '', factory_lot: o.lot || '', fin_mismatch: '',
            note: '報價單' + qStatus + '：已停止同步（廠務訂單 ' + o.orderNo + ' 還在，要不要刪請跟同仁確認）', last_sync: now });
          if (pr && pr.changed) linkChanged++;
          paused.push({ quote_no: quoteNo, factory_order_no: o.orderNo, status: qStatus });
          return;
        }
        var os = osBy[quoteNo] || null;
        var mis = fxFinCompare_(os, o, shipMap[quoteNo] || 0, fxConv_(!!shipMap.__excl[quoteNo], qf.gt, qf.tax));
        var sres = fxSyncShipments_(quoteNo, o, shipRows, ships, { noRemove: !shipsTrusted });
        shipChanged += sres.changed; shipRemoved += (sres.removed || 0);
        // 出貨以廠務為主：全部出清（狀態＝已出貨，或每款都沒有寄倉餘量）→ 實際出貨日
        var allOut = String(o.status) === '已出貨' || ((Number(o.shipBatches) || 0) > 0 && (o.items || []).length > 0 &&
          (o.items || []).every(function (it) { return (Number(it.remainStock) || 0) === 0; }));
        var actual = allOut ? (o.lastShipDate || (o.shipDateConfirmed ? o.actualDeliveryDate : '') || '') : '';
        var prevFxActual = String((byQ[quoteNo] && byQ[quoteNo].factory_ship_actual) || '');
        if (actual && os && !os.ship_date_actual) {
          try { handleUpdateOrderStatus_({ quote_no: quoteNo, fields: { ship_date_actual: actual } }); os.ship_date_actual = actual; osChanged++; } catch (e) { errors.push(quoteNo + '：回寫實際出貨日失敗 ' + e.message); }
        } else if (actual && os && os.ship_date_actual && prevFxActual && String(os.ship_date_actual) === prevFxActual && actual !== prevFxActual) {
          // 之前是同步幫忙填的日期、廠務後來改了 → 跟著改（Molly 自己改過的日期不碰）
          try { handleUpdateOrderStatus_({ quote_no: quoteNo, fields: { ship_date_actual: actual } }); os.ship_date_actual = actual; osChanged++; } catch (e) { errors.push(quoteNo + '：更新實際出貨日失敗 ' + e.message); }
        }
        var lr = fxLinkUpsert_(quoteNo, {
          factory_order_no: o.orderNo, factory_status: o.status || '', factory_lot: o.lot || '',
          factory_ship_est: o.deliveryDate || '', factory_ship_actual: actual || (o.shipDateConfirmed ? o.actualDeliveryDate : ''),
          factory_fin_json: JSON.stringify({ total: o.total, depositAmount: o.depositAmount, depositPaidDate: o.depositPaidDate, finalAmount: o.finalAmount,
            finalPaidDate: o.finalPaidDate, finalAdjusted: !!o.finalAdjusted, finalAdjustedAmount: o.finalAdjustedAmount, depositStatus: o.depositStatus, pm: o.pm, client: o.client,
            shipFee: fxNum_(o.shipFee), shipFeePayer: String(o.shipFeePayer || ''), shipCost: fxShipCostOf_(o) }),
          fin_mismatch: mis.join('；'),
          ship_json: JSON.stringify({ orderNo: o.orderNo, client: o.client, lot: o.lot || '', pm: o.pm || '', items: (o.items || []).map(function (it) { return { product: it.product, volume: it.volume, bottleType: it.bottleType, qty: it.qty, shipped: it.shipped || 0 }; }), batches: sres.batches }),
          last_sync: now
        });
        if (lr && lr.changed) linkChanged++;
        if (mis.length) mismatches.push({ quote_no: quoteNo, factory_order_no: o.orderNo, items: mis });
        synced++;
      } catch (e) { errors.push((o && o.orderNo) + '：' + (e && e.message || e)); }
    });
    // 複檢 0923：連結著、但廠務那張已經不見了（被刪）→ 標「廠務已刪除」、清掉過期的金額不符提示（只在這次真的有抓到訂單時判斷）
    if (orders.length) {
      Object.keys(byFx).forEach(function (fxNo) {
        if (seenFx[fxNo]) return;
        var l = byFx[fxNo];
        if (String(l.factory_status || '') === '廠務已刪除') return;
        if (touchedQ[String(l.quote_no)] && touchedQ[String(l.quote_no)] !== fxNo) return;   // 這張報價單本輪已接上別張廠務單
        fxLinkUpsert_(String(l.quote_no), { factory_status: '廠務已刪除', fin_mismatch: '', note: '廠務訂單 ' + fxNo + ' 已不在廠務系統（被刪除）' });
        goneMarked.push(String(l.quote_no)); linkChanged++;
      });
    }
    try { PropertiesService.getScriptProperties().setProperty('FACTORY_LAST_SYNC', now); } catch (e) {}
    return { ok: true, synced: synced, imported: imported, mismatches: mismatches, shipChanged: shipChanged, shipRemoved: shipRemoved, osChanged: osChanged,
      linkChanged: linkChanged, paused: paused, gone: goneMarked, healed: healed, errors: errors, at: now };
  } finally { fxSyncEnd_('FX_SYNC_BUSY'); }
}

// ── 排程 ──────────────────────────────────────────────
function runFactorySync() {
  if (!fxConfigured_()) return;
  // 複檢 0923：排程不走 doPost，MAIN_COLS／ITEM_COLS 的動態欄位對應要自己先解析（不然主表搬過欄時會讀／寫錯欄）
  try { if (typeof ssCacheReset_ === 'function') ssCacheReset_(); } catch (e) {}
  try { if (typeof resolveColMaps_ === 'function') resolveColMaps_(); } catch (e) {}
  try { var r = handleFactorySync_({}); Logger.log(JSON.stringify(r).slice(0, 500)); } catch (e) { Logger.log('runFactorySync error: ' + e); }
  // 2026-09-23：寄售帳也跟著每小時同步（以廠務為主）；失敗不影響上面訂單同步
  try { var c = handleFactoryConsignSync_({}); Logger.log('consign: ' + JSON.stringify(c).slice(0, 500)); } catch (e) { Logger.log('runFactorySync consign error: ' + e); }
}
function setupFactorySyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'runFactorySync') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('runFactorySync').timeBased().everyHours(1).create();
  return 'runFactorySync 每小時觸發已建立';
}
function handleFactorySetupTrigger_() { return { ok: true, result: setupFactorySyncTrigger() }; }

// ── 連結廠務「已有」的訂單（上線前同仁就建好的舊單，跟既有報價單手動對上）──────
// action: factoryUnlinkedOrders {} → 有金流兩型、AI 欄空白、factory_links 也沒有的廠務訂單摘要
function handleFactoryUnlinkedOrders_(params) {
  if (!fxConfigured_()) return { ok: false, error: '廠務連結尚未設定' };
  var r = fxCall_('extGetOrders', { fresh: '1' });
  if (!r || !r.ok) return { ok: false, error: '讀取廠務失敗：' + ((r && r.error) || '無回應') };
  var linked = {};
  fxLinksAll_().forEach(function (l) { if (l.factory_order_no) linked[String(l.factory_order_no)] = true; });
  var list = (r.orders || []).filter(function (o) {
    return !String(o.qsQuoteNo || '').trim() && !linked[String(o.orderNo)] && FX_IMPORT_TYPES.indexOf(String(o.orderType)) >= 0
      && !fxIsConsignOrder_(o) && !fxPushedQuoteNoOf_(o);   // 複檢 0923：寄售單走寄售帳；推過去的單已經有主
  }).map(function (o) {
    return { orderNo: o.orderNo, client: o.client, orderType: o.orderType, status: o.status, lot: o.lot || '', deliveryDate: o.deliveryDate || '',
      total: o.total, createdAt: fxParseTw_(o.createdAt) || o.createdAt,
      items: (o.items || []).map(function (it) { return it.product + '×' + it.qty; }).join('、') };
  });
  list.sort(function (a, b) { return String(b.orderNo).localeCompare(String(a.orderNo)); });
  return { ok: true, orders: list, since: fxImportSince_() };
}
// action: factoryLinkExisting {quote_no, factory_order_no} → 廠務 AI 欄回填＋factory_links 建列（不建新訂單）；接著跑一次同步把狀態抓回來
function handleFactoryLinkExisting_(params) {
  var quoteNo = String(params.quote_no || params.quoteNo || '').trim();
  var orderNo = String(params.factory_order_no || params.orderNo || '').trim();
  if (!quoteNo || !orderNo) throw new Error('缺少 quote_no 或 factory_order_no');
  var cur = fxLinksAll_().filter(function (l) { return String(l.quote_no) === quoteNo && l.factory_order_no; })[0];
  if (cur && String(cur.factory_order_no) !== orderNo) return { ok: false, error: '這張報價單已連結廠務訂單 ' + cur.factory_order_no };
  var mk = fxCall_('extMarkImported', { orderNo: orderNo, quoteNo: quoteNo });
  if (!mk || !mk.ok) return { ok: false, error: '廠務回填失敗：' + ((mk && mk.error) || '無回應') };
  fxLinkUpsert_(quoteNo, { factory_order_no: orderNo, source: 'link', note: '手動連結廠務既有訂單' });
  try { logChange_('factoryLinkExisting', quoteNo, { factory_order_no: orderNo }); } catch (e) {}
  // 複檢 0923：原本這裡直接跑一次完整同步（10～30 秒），前端 25 秒就逾時、明明連好了卻顯示失敗 → 改由前端接著另外叫 factorySync
  return { ok: true, quote_no: quoteNo, factory_order_no: orderNo };
}

// ═══ 2026-09-09 Molly：「報價單資訊有更改，訂單追蹤要跟著一起更新」═══════════════════
// 付款條件文字 → {dep, bal}（跟 v2_extensions 的 orderPayFromQuote_ 同一套規則，但吃文字不讀表，才能整批一次算）
function fxParsePay_(detail, gt) {
  var s = String(detail || '').replace(/<br\s*\/?>/gi, '\n');
  if (!s) return null;
  // 複檢 0923：自訂條款（客戶主檔付款習慣帶進來的 Tab3）常見寫法——「無訂金；驗收後 7 天內付尾款 100%」「訂金 50%，尾款 50%」
  //   跟前端 ordDepositPct（05_orders.js）同一套判斷
  if (!/支付訂金|支付(?:全額)?款項新台幣/.test(s)) {
    var g = Math.round(Number(gt) || 0);
    if (!(g > 0)) return null;
    if (/(無|免|不收|不付|不需)\s*訂金/.test(s) || /訂金\s*0+\s*%/.test(s)) return { dep: 0, bal: g };
    var mp = s.match(/訂金\s*(\d{1,3}(?:\.\d+)?)\s*%/);
    if (mp) {
      var pct = parseFloat(mp[1]);
      if (!(pct > 0 && pct < 100)) return null;
      var mb = s.match(/尾款\s*(\d{1,3}(?:\.\d+)?)\s*%/);
      if (mb && Math.round(parseFloat(mb[1]) + pct) !== 100) return null;
      var d0 = Math.round(g * pct / 100);
      return { dep: d0, bal: g - d0 };
    }
    return null;
  }
  if (!/支付訂金/.test(s)) {
    var mFull = s.match(/支付(?:全額)?款項新台幣\s*\$?([\d,]+(?:\.\d+)?)\s*元整/);
    if (!mFull) return null;
    var mPct = s.match(/元整\s*之\s*(\d+(?:\.\d+)?)\s*%/);
    if (mPct && Math.round(parseFloat(mPct[1])) !== 100) return null;
    var full = Math.round(parseFloat(String(mFull[1]).replace(/,/g, '')) || 0);
    if (gt > 0 && full !== Math.round(gt)) return null;
    return { dep: 0, bal: full };
  }
  var mDep = s.match(/支付訂金(?:總計)?新台幣\s*\$?([\d,]+(?:\.\d+)?)\s*元整/);
  if (!mDep) return null;
  var dep = Math.round(parseFloat(String(mDep[1]).replace(/,/g, '')) || 0);
  var mBal = s.match(/支付尾款新台幣\s*\$?([\d,]+(?:\.\d+)?)\s*元整/);
  var bal;
  if (mBal) bal = Math.round(parseFloat(String(mBal[1]).replace(/,/g, '')) || 0);
  else if (/無須另付尾款/.test(s)) bal = 0;
  else return null;
  if (gt > 0 && (dep + bal) !== Math.round(gt)) return null;
  return { dep: dep, bal: bal };
}
// 讀一次報價單主表 → { quoteNo: {client, status, gt, pay} }
function fxQuoteFinMap_() {
  var m = {};
  var sh = ssApp_().getSheetByName(SHEET_MAIN);
  if (!sh || sh.getLastRow() < 2) return m;
  var data = sh.getRange(2, 1, sh.getLastRow() - 1, effW_(sh, MAIN_HEADERS)).getValues();
  data.forEach(function (r) {
    var no = String(r[MAIN_COLS.quoteNo - 1] || ''); if (!no) return;
    var gt = Math.round(Number(r[MAIN_COLS.grandTotal - 1]) || 0);
    m[no] = { client: String(r[MAIN_COLS.clientName - 1] || ''), status: String(r[MAIN_COLS.status - 1] || ''), gt: gt,
      tax: Math.round(Number(r[MAIN_COLS.taxAmount - 1]) || 0),
      pay: fxParsePay_(r[MAIN_COLS.paymentDetail - 1], gt) };
  });
  return m;
}
// 算這一列該改什麼：回 {fields, changed}（changed 空＝不用動）
function fxOrderStatusDiff_(os, q) {
  var fields = {}, changed = [];
  if (!q) return { fields: fields, changed: changed };
  var gtChanged = q.gt > 0 && Math.round(Number(os.grand_total) || 0) !== q.gt;
  if (gtChanged) { fields.grand_total = q.gt; changed.push('總額 ' + (os.grand_total === '' ? '—' : os.grand_total) + '→' + q.gt); }
  // 複檢 0923：已經收到的錢不改——訂金收款日有填＝訂金金額凍結、差額放尾款；尾款收款日也有填＝兩腿都不動（只更新總額）
  var depPaid = !!String(os.deposit_date || '').trim(), finPaid = !!String(os.final_date || '').trim();
  var curDep = fxNum_(os.deposit_amt), curFin = fxNum_(os.final_amt);
  var want = null;
  if (finPaid) want = null;
  else if (depPaid) { if (gtChanged && curDep !== '') want = { dep: curDep, bal: Math.max(0, q.gt - curDep), why: '（訂金已收，差額放尾款）' }; }
  else if (q.pay) want = { dep: q.pay.dep, bal: q.pay.bal, why: '' };
  else if (gtChanged && curFin !== '') {
    // 付款條件讀不出來：原本只改總額、訂金尾款不動 → 訂金＋尾款≠總額，推到廠務的金額也對不起來。改成訂金不動、尾款＝總額−訂金
    want = { dep: curDep === '' ? '' : curDep, bal: Math.max(0, q.gt - (curDep === '' ? 0 : curDep)), why: '（付款條件讀不出來：訂金不動，尾款跟著總額調）' };
  }
  if (want) {
    // 全額型（訂金 0）而追蹤列訂金空白＝同一個意思（空＝沒有訂金這回事），不要把空白硬寫成 0（今日待辦／月報的「待收訂金」判斷靠這個分別）
    var depSame = want.dep === '' || (curDep === want.dep) || (want.dep === 0 && curDep === '');
    if (!depSame) { fields.deposit_amt = want.dep; changed.push('訂金 ' + (os.deposit_amt === '' ? '—' : os.deposit_amt) + '→' + want.dep + want.why); }
    if (curFin !== want.bal) { fields.final_amt = want.bal; changed.push('尾款 ' + (os.final_amt === '' ? '—' : os.final_amt) + '→' + want.bal + want.why); }
  }
  return { fields: fields, changed: changed };
}
// 報價單存檔（updateQuote）後呼叫：訂單追蹤的 總額／訂金／尾款 依報價單重算。
//   總額＝報價單總計；訂金／尾款＝從付款條件文字解析（解析不出來就不動這兩欄）。
//   ⚠ 只更新「已存在」的訂單追蹤列（不新建：純報價單／還沒建追蹤的單不碰）；日期欄一律不動。
function syncOrderStatusFromQuote_(quoteNo) {
  var q = fxQuoteFinMap_()[String(quoteNo)];
  if (!q) return { ok: false, error: '找不到報價單' };
  if (q.status === '純報價' || q.status === '已刪除') return { ok: true, changed: [], skipped: q.status };
  var os = fxOrderStatusOf_(quoteNo);
  if (!os) return { ok: true, changed: [], skipped: 'no-order-status' };
  var d = fxOrderStatusDiff_(os, q);
  if (!d.changed.length) return { ok: true, changed: [] };
  handleUpdateOrderStatus_({ quote_no: quoteNo, fields: d.fields });
  try { logChange_('syncOrderStatusFromQuote', quoteNo, d.fields); } catch (e) {}
  return { ok: true, changed: d.changed, fields: d.fields };
}
// action: resyncOrderStatusFromQuotes {dry:'1'?} → 全部訂單追蹤列重算一遍（一次性補救／定期核對用）。主表只讀一次，20 幾張單幾秒內做完。
function handleResyncOrderStatusFromQuotes_(params) {
  var dry = params && String(params.dry || '') === '1';
  var qm = fxQuoteFinMap_();
  var all = v2ReadAll_(SHEET_ORDER_STATUS, ORDER_STATUS_HEADERS);
  var out = [], errors = [];
  all.forEach(function (row) {
    var no = String(row.quote_no || ''); if (!no) return;
    var q = qm[no]; if (!q || q.status === '純報價' || q.status === '已刪除') return;
    try {
      var d = fxOrderStatusDiff_(row, q);
      if (!d.changed.length) return;
      if (!dry) { handleUpdateOrderStatus_({ quote_no: no, fields: d.fields }); try { logChange_('syncOrderStatusFromQuote', no, d.fields); } catch (e) {} }
      out.push({ quote_no: no, client: q.client, changed: d.changed, parsed: !!q.pay });
    } catch (e) { errors.push(no + '：' + (e && e.message || e)); }
  });
  return { ok: true, dry: dry, updated: out, errors: errors };
}

// ===================================================================
// 寄售 × 廠務（2026-09-23，Molly 決議「以廠務為主，報價系統自動跟」）
//   廠務 v3.71 起提供 extConsignLedger（QS_LINK_KEY、唯讀）：經銷商設定＋門市在庫異動＋牌價＋對帳單摘要。
//   這裡每小時（runFactorySync 內）＋寄售頁「⟳ 同步廠務」把廠務的
//     進貨→in／進貨取消→adjust(負)／售出→out／退貨→return／損耗→adjust(負)／盤點修正→adjust(±)
//   寫進 consign_ledger；note 開頭帶 [FXC:<廠務異動ID>|<廠務訂單#批次>] 當冪等識別（同 ID 永不重寫）。
//   起點＝Script Property FACTORY_CONSIGN_SINCE（yyyy-MM-dd HH:mm:ss，預設 2026-09-16 00:00:00）：
//   之前廠務那 17 筆島羽 Molly 已手動登過，不重複匯入（她 2026-09-23 拍板）。
//   過渡期「兩邊都登」的保險：同客戶＋同酒款＋同類型＋同數量、日期差 7 天內、還沒帶 [FXC:] 的手動列
//   → 只在那列 note 補標記、不新增（例：廠務之後補登特規單，不會跟她已登的那筆重複）。
//   客戶對照：factory_map kind='consign_client'（qs_name＝consign_customers.customer_id、factory_name＝經銷商鍵）；
//   沒設定的用名字自動配（去「經銷商－」前綴、去空白、參／叁同視、前綴包含），唯一配到才算、並自動寫進 factory_map。
//   酒款對照：廠務系統名去尾巴 V2 → 「<酒名>|<規格>」＝ownbrand_products.sku_id；也可 factory_map kind='product' 手動指定。
//   ⚠ 只會「新增／補標記」consign_ledger，不刪不改數量；廠務端刪出貨會自己寫「進貨取消」負數列，這邊照樣同步進來。
// ===================================================================
var FXC_TAG_RE = /\[FXC:([^\]|\s]+)(?:\|([^\]]*))?\]/;
var FXC_TYPE_MAP = { '進貨': 'in', '進貨取消': 'adjust', '售出': 'out', '退貨': 'return', '損耗': 'adjust', '盤點修正': 'adjust' };
var FXC_SINCE_DEFAULT = '2026-09-16 00:00:00';
// 複檢 0923：「過渡期補標記」只認上線前（兩邊都手動登的年代）的手動列；上線後在報價系統手登的列不再拿來抵廠務的新異動
var FXC_GOLIVE_DEFAULT = '2026-09-23T12:40:00+08:00';
var FXC_NO_LINK = '-';   // factory_map consign_client 的 factory_name＝'-'：Molly 選了「不連結廠務」，自動配對也跳過這位客戶
function fxcGoLive_() { try { return String(PropertiesService.getScriptProperties().getProperty('FACTORY_CONSIGN_GOLIVE') || '').trim() || FXC_GOLIVE_DEFAULT; } catch (e) { return FXC_GOLIVE_DEFAULT; } }
function fxcSince_() { try { return String(PropertiesService.getScriptProperties().getProperty('FACTORY_CONSIGN_SINCE') || '').trim() || FXC_SINCE_DEFAULT; } catch (e) { return FXC_SINCE_DEFAULT; } }
function fxcLastSync_() { try { return String(PropertiesService.getScriptProperties().getProperty('FACTORY_CONSIGN_LAST_SYNC') || ''); } catch (e) { return ''; } }
function fxcTagOf_(note) { var m = String(note || '').match(FXC_TAG_RE); return m ? m[1] : ''; }
// 名字比對用的鍵：去經銷商前綴、去空白、小寫、參→叁、只留中英數
function fxcNameKey_(s) { return fxKey_(String(s || '').replace(FX_CLIENT_PREFIX_RE, '')).replace(/參/g, '叁').replace(/[^0-9a-z一-鿿]/g, ''); }
function fxcDays_(a, b) { var ta = Date.parse(String(a).slice(0, 10) + 'T00:00:00Z'), tb = Date.parse(String(b).slice(0, 10) + 'T00:00:00Z'); if (isNaN(ta) || isNaN(tb)) return 9999; return Math.round((tb - ta) / 86400000); }
// 廠務「建立時間」（yyyy-MM-dd HH:mm:ss，台北）→ consign_ledger.created_at 的格式（yyyy-MM-ddTHH:mm:ss+08:00）
function fxcIso_(s) {
  var m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) { var t = fxParseTw_(s); m = t ? t.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/) : null; }
  if (!m) return tpeNow_();
  return m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + (m[6] || '00') + '+08:00';
}
// 經銷商鍵 → consign customer_id（factory_map 優先；沒設定就用名字自動配、配到寫回 factory_map）。回 { map:{鍵:id}, auto:[…], ambiguous:{鍵:原因} }
function fxcDealerMap_(map, dealers, customers) {
  var out = {}, auto = [], ambiguous = {}, usedId = {}, blocked = {}, blockedDealers = {};
  var idCount = {}; (customers || []).forEach(function (c) { var id = String(c.customer_id); idCount[id] = (idCount[id] || 0) + 1; });
  (map || []).forEach(function (r) {
    if (String(r.kind) !== 'consign_client' || !r.qs_name) return;
    var qs = String(r.qs_name).trim(), fn = String(r.factory_name || '').trim();
    if (fn === FXC_NO_LINK) { blocked[qs] = true; usedId[qs] = FXC_NO_LINK; return; }
    if (!fn) return;
    // 手動指定也要檢查客戶代碼唯一（重複的代碼會讓兩家的帳混在一起）
    if (idCount[qs] > 1) { ambiguous[fn] = '客戶代碼 ' + qs + ' 在 consign_customers 重複了，先把代碼改成不重複再同步'; usedId[qs] = fn; return; }
    out[fn] = qs; usedId[qs] = fn;
  });
  (dealers || []).forEach(function (d) {
    var key = String(d.key || '').trim(); if (!key || out[key] || ambiguous[key]) return;
    var k1 = fxcNameKey_(key), k2 = fxcNameKey_(d.label);
    var nameHit = function (c) {
      var ck = fxcNameKey_(c.name); if (!ck) return false;
      if (ck === k1 || ck === k2) return true;
      return ck.length >= 2 && (k1.indexOf(ck) === 0 || k2.indexOf(ck) === 0 || ck.indexOf(k1) === 0 || ck.indexOf(k2) === 0);
    };
    var all = (customers || []).filter(nameHit);
    var hits = all.filter(function (c) { return !blocked[String(c.customer_id)]; });
    if (!hits.length && all.length) { blockedDealers[key] = String(all[0].name); return; }
    var ids = {}; hits.forEach(function (c) { ids[String(c.customer_id)] = String(c.name); });
    var idList = Object.keys(ids);
    if (idList.length !== 1) { if (idList.length > 1) ambiguous[key] = '名字同時像 ' + idList.map(function (i) { return ids[i]; }).join('／') + '，請到客戶設定手動指定'; return; }
    var id = idList[0];
    if (idCount[id] > 1) { ambiguous[key] = '客戶代碼 ' + id + ' 在 consign_customers 重複了（' + ids[id] + '），先把代碼改成不重複再同步'; return; }
    if (usedId[id]) { ambiguous[key] = '客戶「' + ids[id] + '」已對到廠務「' + usedId[id] + '」'; return; }
    out[key] = id; usedId[id] = key;
    auto.push({ kind: 'consign_client', qs_name: id, factory_name: key, note: '自動配對：' + ids[id] });
  });
  if (auto.length) { try { handleSaveFactoryMap_({ rows: auto }); } catch (e) {} }
  return { map: out, auto: auto, ambiguous: ambiguous, blocked: blocked, blockedDealers: blockedDealers };
}
// 廠務酒款（系統名，可能帶 V2 尾巴）＋規格 → ownbrand_products.sku_id；找不到回 ''
function fxcSkuOf_(map, products, product, volume) {
  var m = fxMapLookup_(map, 'product', 'factory_name', 'qs_name', product);   // 手動對照：qs_name 可填 sku_id 或酒名
  var name = (m || String(product || '')).replace(/\s*V\d+$/i, '').trim();
  var vol = String(volume || '').trim();
  if (products[name]) return name;                     // 對照表直接填了 sku_id
  var sku = name + '|' + vol;
  if (products[sku]) return sku;
  var nk = fxKey_(name) + '|' + fxKey_(vol);
  var keys = Object.keys(products);
  for (var i = 0; i < keys.length; i++) { var p = products[keys[i]]; if (fxKey_(p.name) + '|' + fxKey_(p.volume) === nk) return keys[i]; }
  return '';
}
function fxcMaxSerial_(ledger, date) {
  var prefix = 'CM-' + String(date).replace(/-/g, '') + '-', mx = 0;
  ledger.forEach(function (l) { var id = String(l.movement_id || ''); if (id.indexOf(prefix) === 0) { var n = parseInt(id.slice(prefix.length), 10); if (n > mx) mx = n; } });
  return mx;
}
// action: factoryConsignSync {} → 把廠務寄售帳同步進 consign_ledger（新增／補標記），回摘要
function handleFactoryConsignSync_(params) {
  if (!fxConfigured_()) return { ok: false, error: '廠務連結尚未設定' };
  if (!fxSyncBegin_('FXC_SYNC_BUSY')) return { ok: false, busy: true, error: '另一個寄售同步正在進行，稍後再試' };
  try {
    var since = fxcSince_(), goLive = fxcGoLive_();
    var r = fxCall_('extConsignLedger', { since: since });   // 複檢 0923：先抓資料、不佔鎖（打廠務可能 10 秒以上）
    if (!r || !r.ok) return { ok: false, error: '讀取廠務寄售帳失敗：' + ((r && r.error) || '無回應') };
    var dealers = r.dealers || [], rows = (r.rows || []).slice();
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);   // 寫 consign_ledger 要跟 addConsignMovement(s) 用同一把鎖，單號（CM-日期-序號）才不會撞
    try {
      var customers = v2ReadAll_(SHEET_CONSIGN_CUSTOMERS, CONSIGN_CUSTOMERS_HEADERS);
      var dm = fxcDealerMap_(fxMapAll_(), dealers, customers);
      var map = fxMapAll_();   // 自動配對可能剛寫了新列，重讀
      var products = {}; v2ReadAll_(SHEET_OWNBRAND_PRODUCTS, OWNBRAND_PRODUCTS_HEADERS).forEach(function (p) { products[String(p.sku_id)] = p; });
      var sh = v2Sheet_(SHEET_CONSIGN_LEDGER, CONSIGN_LEDGER_HEADERS);
      var ledger = v2ReadAll_(SHEET_CONSIGN_LEDGER, CONSIGN_LEDGER_HEADERS);   // 陣列位置＝表列順序（列號＝i+2）
      var noteCol = CONSIGN_LEDGER_HEADERS.indexOf('note') + 1;
      var have = {}; ledger.forEach(function (l) { var t = fxcTagOf_(l.note); if (t) have[t] = 1; });
      var inserted = [], linked = [], skipped = [], unmappedDealers = {}, unmappedProducts = {}, serialByDate = {}, toAppend = [], possibleDup = [], priceFallback = [], ignoredDealers = {};
      rows.sort(function (a, b) { return String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id || '').localeCompare(String(b.id || '')); });
      rows.forEach(function (fr) {
        var id = String(fr.id || '').trim(); if (!id || have[id]) return;
        var type = FXC_TYPE_MAP[String(fr.type || '').trim()];
        if (!type) { skipped.push(id + '：不認得的類型「' + fr.type + '」'); return; }
        var dealerKey = String(fr.dealer || '').trim();
        var cid = dm.map[dealerKey];
        if (!cid) {
          if (dm.blockedDealers && dm.blockedDealers[dealerKey]) ignoredDealers[dealerKey] = (ignoredDealers[dealerKey] || 0) + 1;
          else unmappedDealers[dealerKey] = (unmappedDealers[dealerKey] || 0) + 1;
          return;
        }
        var sku = fxcSkuOf_(map, products, fr.product, fr.volume);
        if (!sku) { var pk = String(fr.product || '') + '|' + String(fr.volume || ''); unmappedProducts[pk] = (unmappedProducts[pk] || 0) + 1; return; }
        var q = Math.round(Number(fr.qty) || 0);
        if (!q) { skipped.push(id + '：數量 0'); return; }
        var qty = (type === 'adjust') ? q : Math.abs(q);
        var date = String(fr.date || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { skipped.push(id + '：日期格式不對「' + fr.date + '」'); return; }
        var tag = '[FXC:' + id + (fr.orderNo ? '|' + String(fr.orderNo) + '#' + String(fr.seq || '') : '') + ']';
        var noteBody = '廠務' + (fr.orderNo ? ' ' + fr.orderNo + (fr.seq ? ' 第' + fr.seq + '次' : '') : '') + (fr.operator ? '／' + fr.operator : '') + (fr.note ? '：' + fr.note : '');
        // 過渡期保險（複檢 0923 收緊）：只拿「上線前」的手動列來抵；鋪貨容許 ±3 天、其他類型要同一天；
        //   挑日期最接近的一筆，同樣接近的有兩筆以上就不猜（照常新增，列進 possibleDup 讓 Molly 看）
        var best = -1, bestDiff = 99, tie = false, maxDiff = (type === 'in') ? 3 : 0;   // tie＝有另一筆「一樣接近、但不同天」的手動列
        for (var i = 0; i < ledger.length; i++) {
          var l = ledger[i];
          if (fxcTagOf_(l.note)) continue;
          if (String(l.created_at || '') >= goLive) continue;
          if (String(l.customer_id) !== String(cid) || String(l.sku_id) !== sku || String(l.type) !== type) continue;
          if (Math.round(Number(l.qty) || 0) !== qty) continue;
          var dd = Math.abs(fxcDays_(l.date, date));
          if (dd > maxDiff) continue;
          if (dd < bestDiff) { best = i; bestDiff = dd; tie = false; }
          else if (dd === bestDiff && String(l.date || '').slice(0, 10) !== String(ledger[best].date || '').slice(0, 10)) tie = true;
        }
        if (best >= 0) {
          // 同一天、一模一樣的手動列有好幾筆（例：同一天賣了兩次各 1 瓶）＝可互換，對第一筆；廠務下一筆會對到下一筆
          var newNote = (tag + ' ' + String(ledger[best].note || '')).trim();
          sh.getRange(best + 2, noteCol).setValue(newNote);
          ledger[best].note = newNote; have[id] = 1;
          linked.push({ fx: id, movement_id: String(ledger[best].movement_id), customer_id: String(cid), sku_id: sku, type: type, qty: qty });
          if (tie) possibleDup.push(id + '（' + date + ' ' + sku + ' ×' + qty + '：前後一樣近的手動列有兩筆，先對上 ' + String(ledger[best].movement_id) + '，請確認沒對錯）');
          return;
        }
        if (serialByDate[date] === undefined) serialByDate[date] = fxcMaxSerial_(ledger, date);
        serialByDate[date]++;
        var mid = 'CM-' + date.replace(/-/g, '') + '-' + ('0000' + serialByDate[date]).slice(-4);
        var unit = '';
        if (type === 'out') {
          unit = (fr.price !== '' && fr.price != null && !isNaN(Number(fr.price))) ? Number(fr.price) : '';
          // 複檢 0923：廠務成交單價是 0／空白（例：經銷商設定沒填折扣率）→ 月結會變 $0。退回報價系統自己的算法（公版牌價×這位客戶的折數），並列出來提醒
          if (!(Number(unit) > 0)) {
            var rp = null; try { rp = (typeof resolveConsignUnitPrice_ === 'function') ? resolveConsignUnitPrice_(cid, sku) : null; } catch (e) { rp = null; }
            var up = rp && Number(rp.unitPrice);
            priceFallback.push(id + '（' + sku + '：廠務單價 ' + (unit === '' ? '空白' : unit) + ' → 報價系統 ' + (up > 0 ? up : '也算不出來') + '）');
            if (up > 0) unit = up;
          }
        }
        var cidCell = /^\d+$/.test(String(cid)) ? Number(cid) : String(cid);
        var vals = [mid, date, cidCell, sku, type, qty, unit, (tag + ' ' + noteBody).trim(), fxcIso_(fr.createdAt)];
        toAppend.push(vals);
        var obj = {}; CONSIGN_LEDGER_HEADERS.forEach(function (h, k) { obj[h] = vals[k]; }); ledger.push(obj); have[id] = 1;
        inserted.push({ fx: id, movement_id: mid, customer_id: String(cid), sku_id: sku, type: type, qty: qty, date: date });
      });
      if (toAppend.length) sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, CONSIGN_LEDGER_HEADERS.length).setValues(toAppend);
      try { SpreadsheetApp.flush(); } catch (e) {}
    } finally { lock.releaseLock(); }
    var now = tpeNow_();
    var summary = { at: now, inserted: inserted.length, linked: linked.length, unmappedDealers: unmappedDealers, unmappedProducts: unmappedProducts, ignoredDealers: ignoredDealers,
      ambiguous: dm.ambiguous, possibleDup: possibleDup.slice(0, 20), priceFallback: priceFallback.slice(0, 20), skipped: skipped.slice(0, 10) };
    try {
      var pr = PropertiesService.getScriptProperties();
      pr.setProperty('FACTORY_CONSIGN_LAST_SYNC', now);
      var sj = JSON.stringify(summary); if (sj.length < 8000) pr.setProperty('FACTORY_CONSIGN_LAST_RESULT', sj);
    } catch (e) {}
    if (inserted.length || linked.length) {
      try { logChange_('factoryConsignSync', inserted.length + '+' + linked.length, { inserted: inserted.map(function (x) { return x.movement_id + '=' + x.fx; }), linked: linked.map(function (x) { return x.movement_id + '=' + x.fx; }) }); } catch (e) {}
    }
    return { ok: true, inserted: inserted, linked: linked, skipped: skipped, unmappedDealers: unmappedDealers, unmappedProducts: unmappedProducts, ignoredDealers: ignoredDealers,
      ambiguous: dm.ambiguous, autoMapped: dm.auto, dealerMap: dm.map, dealers: dealers, possibleDup: possibleDup, priceFallback: priceFallback,
      since: since, goLive: goLive, at: now, factoryRows: rows.length };
  } finally { fxSyncEnd_('FXC_SYNC_BUSY'); }
}
// action: getFactoryConsignDealers {} → 廠務經銷商清單＋目前對照（給寄售頁客戶設定的下拉；只讀，不同步）
function handleGetFactoryConsignDealers_() {
  if (!fxConfigured_()) return { ok: true, configured: false, dealers: [], map: [], lastSync: '', since: fxcSince_() };
  var r = fxCall_('extConsignLedger', { since: '9999-12-31 00:00:00' });   // 只要經銷商設定，異動列一筆都不要
  if (!r || !r.ok) return { ok: false, error: '讀取廠務失敗：' + ((r && r.error) || '無回應') };
  var map = fxMapAll_().filter(function (x) { return String(x.kind) === 'consign_client'; });
  var last = null;
  try { var lr = PropertiesService.getScriptProperties().getProperty('FACTORY_CONSIGN_LAST_RESULT'); if (lr) last = JSON.parse(lr); } catch (e) { last = null; }
  return { ok: true, configured: true, dealers: r.dealers || [], map: map, lastSync: fxcLastSync_(), since: fxcSince_(), lastResult: last };
}
