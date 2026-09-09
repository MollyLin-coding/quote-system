// ===================================================================
// v5_factory.gs —— 廠務／酒譜 APP（repo MollyLin-coding/recipe）連結（2026-09-08）
// ===================================================================
// 設計（Molly 2026-09-08 決議）：
//   • 廠務系統＝公司同仁共用；報價系統＝只有 Molly 用 → 廠務端零回呼，全部由這裡主動打廠務 API（key 認證）。
//   • 轉單：訂單追蹤頁「轉廠務訂單」鈕 → factoryPushOrder（同一張報價單再推＝更新，冪等）。
//   • 同步：factorySync（每小時觸發＋開訂單追蹤頁時）→ 廠務製作狀態／Lot／實際出貨日／出貨紀錄→order_shipments／
//           金流比對（只提示不覆蓋）／廠務同仁新建的「有金流」訂單 → 自動建草稿報價單＋訂單追蹤（反向匯入）。
//   • 出貨以廠務為主；驗收單可從廠務出貨紀錄一鍵帶入（前端讀 factory_links.ship_json）。
//   • 寄售先不碰。
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
  return m || String(factoryName || '').trim();
}

// ── factory_links 讀寫 ─────────────────────────────────
function fxLinksAll_() { return v2ReadAll_(SHEET_FACTORY_LINKS, FACTORY_LINK_HEADERS); }
function handleGetFactoryLinks_(params) {
  var all = fxLinksAll_();
  var q = params && (params.quote_no || params.quoteNo);
  if (q) all = all.filter(function (l) { return String(l.quote_no) === String(q); });
  return { ok: true, links: all, configured: fxConfigured_() };
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
    return sh.getLastRow();
  }
  FACTORY_LINK_HEADERS.forEach(function (h, i) {
    if (h === 'quote_no' || h === 'created_at' || h === 'updated_at') return;
    if (fields[h] !== undefined) sh.getRange(rowNum, i + 1).setValue(v2AsCell_(fields[h]));
  });
  sh.getRange(rowNum, FACTORY_LINK_HEADERS.indexOf('updated_at') + 1).setValue(now);
  return rowNum;
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
  var since = fxImportSince_(); if (!since) return false;
  var c = fxParseTw_(o.createdAt); if (!c) return false;
  return c >= since;
}
function fxLotDigits_(lot) { var m = String(lot == null ? '' : lot).match(/\d+/); return m ? m[0] : ''; }
function fxVolMl_(v) { var m = String(v == null ? '' : v).match(/\d+(\.\d+)?/); return m ? m[0] : ''; }
function fxNum_(v) { if (v === '' || v == null) return ''; var n = Number(v); return isNaN(n) ? '' : n; }
// 報價單裡「運費」那一列（extra 品項，名稱含「運費」、正數；「運費折抵」是負數、「整批出貨免運」是 freeship 型，都不算）
function fxShippingOfItems_(items) {
  var sum = 0;
  (items || []).forEach(function (it) {
    if (String(it.itemType) !== 'extra') return;
    if (String(it.name || '').indexOf('運費') < 0) return;
    var v = Number(it.subtotal != null && it.subtotal !== '' ? it.subtotal : it.unitPrice) || 0;
    if (v > 0) sum += v;
  });
  return Math.round(sum);
}
// 一次讀整張品項表，回 { quote_no: 運費 }（同步時 20 幾張單不用各讀一次）
function fxShippingMap_() {
  var m = {};
  try {
    var sh = ssApp_().getSheetByName(SHEET_ITEMS);
    if (!sh || sh.getLastRow() < 2) return m;
    var data = sh.getRange(2, 1, sh.getLastRow() - 1, effW_(sh, ITEM_HEADERS)).getValues();
    data.forEach(function (r) {
      if (String(r[ITEM_COLS.itemType - 1]) !== 'extra') return;
      if (String(r[ITEM_COLS.name - 1] || '').indexOf('運費') < 0) return;
      var v = Number(r[ITEM_COLS.subtotal - 1] !== '' ? r[ITEM_COLS.subtotal - 1] : r[ITEM_COLS.unitPrice - 1]) || 0;
      if (v > 0) { var q = String(r[ITEM_COLS.quoteNo - 1]); m[q] = (m[q] || 0) + Math.round(v); }
    });
  } catch (e) {}
  return m;
}
function fxOrderStatusOf_(quoteNo) {
  var all = v2ReadAll_(SHEET_ORDER_STATUS, ORDER_STATUS_HEADERS);
  for (var i = 0; i < all.length; i++) if (String(all[i].quote_no) === String(quoteNo)) return all[i];
  return null;
}

// ═══ 轉單：報價單 → 廠務訂單 ═══════════════════════════
function fxBuildOrderPayload_(quote, os, map) {
  var items = (quote.items || []).filter(function (it) { return String(it.itemType) === 'bottle' && String(it.name || '').trim(); })
    .map(function (it) {
      return { product: fxProductToFactory_(map, it.name), sheet: '', volume: (fxVolMl_(it.volume) ? fxVolMl_(it.volume) + 'ml' : ''),
        bottleType: '', qty: Math.floor(Number(it.qty)) || 0, status: '待製作' };
    }).filter(function (it) { return it.qty > 0; });
  var lot = '';
  (quote.items || []).some(function (it) { if (String(it.itemType) === 'bottle' && fxLotDigits_(it.lot)) { lot = fxLotDigits_(it.lot); return true; } return false; });
  var gt = Number(quote.grandTotal) || 0;
  var ship = fxShippingOfItems_(quote.items);   // 廠務「總金額」不含運費、運費另有「運費金額」欄
  var dep = os ? fxNum_(os.deposit_amt) : '';
  var fin = os ? fxNum_(os.final_amt) : '';
  var balance = (fin !== '') ? fin : (dep !== '' ? Math.max(0, gt - dep) : gt);
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
    orderCreator: '報價系統(' + quote.quoteNo + ')',
    orderNote: ('報價單 ' + quote.quoteNo + (quote.remark ? '｜' + String(quote.remark).slice(0, 200) : '')),
    // 金流九欄（報價系統為主）
    depositAmount: dep, depositDueDate: '', depositPaidDate: (os && os.deposit_date) || '',
    finalAmount: fin, finalDueDate: (os && os.final_date_est) || '', finalPaidDate: (os && os.final_date) || '',
    finalAdjusted: 'false', finalAdjustedAmount: '', finalAdjustNote: '',
    // 配送八欄
    shipMethod: '', shipFee: (ship > 0 ? ship : ''), shipFeePayer: (ship > 0 ? '客戶付運費' : ''), recvName: quote.shipContact || quote.contactName || '', recvPhone: quote.shipPhone || quote.contactPhone || '',
    recvAddr: quote.shipAddress || quote.clientAddress || '', taxId: quote.clientTaxId || '',
    invoiceSent: 'false', invoiceLast5: (os && os.invoice_last5) || ''
  };
}
// action: factoryPushOrder {quote_no}
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
  var payload = fxBuildOrderPayload_(quote, os, map);
  var itemsArr = JSON.parse(payload.items);
  if (!itemsArr.length) return { ok: false, error: '報價單沒有可轉的瓶裝品項（數量要大於 0）' };
  var r = fxCall_('extCreateOrder', payload);
  if (!r || !r.ok) return { ok: false, error: '廠務建單失敗：' + ((r && r.error) || '無回應') };
  fxLinkUpsert_(quoteNo, { factory_order_no: r.orderNo, source: 'push', last_sync: tpeNow_(),
    note: (r.updated ? '已更新廠務訂單' : '已建立廠務訂單') + ' ' + r.orderNo });
  try { logChange_('factoryPushOrder', quoteNo, { factory_order_no: r.orderNo, updated: !!r.updated, client: payload.client, items: itemsArr.length }); } catch (e) {}
  return { ok: true, quote_no: quoteNo, factory_order_no: r.orderNo, updated: !!r.updated, client: payload.client, items: itemsArr.length };
}

// ═══ 同步：廠務 → 報價系統 ═══════════════════════════════
// 金流比對：兩邊都有值且不同才算不符（'' 視為未填不比）
function fxFinCompare_(os, o, quoteShip) {
  var out = [];
  var ship = Number(quoteShip) || 0;
  var fxShipFee = fxNum_(o.shipFee);
  function cmp(label, a, b) {
    a = fxNum_(a); b = fxNum_(b);
    if (a === '' || b === '') return;
    if (Math.round(a) === Math.round(b)) return;
    // 2026-09-09 Molly：報價單含運費、廠務「總金額」不含（運費另填在「運費金額」欄，同仁常留空）→ 差額剛好＝運費就算一致
    if (ship > 0 && fxShipFee === '' && Math.round(a) === Math.round(b) + ship) return;
    out.push(label + '：報價 ' + a + ' ≠ 廠務 ' + b);
  }
  if (!os) return out;
  var fxTotal = (Number(o.total) || 0) > 0 ? (Number(o.total) + (fxShipFee !== '' ? fxShipFee : 0)) : '';   // 廠務 total 預設 0＝未填
  cmp('總額', os.grand_total, fxTotal);
  cmp('訂金', os.deposit_amt, o.depositAmount);
  var fxFinal = (o.finalAdjusted && o.finalAdjustedAmount !== '') ? o.finalAdjustedAmount : o.finalAmount;
  cmp('尾款', os.final_amt, fxFinal);
  return out;
}
function fxShipTag_(orderNo, seq) { return '[FX:' + orderNo + ':' + seq + ']'; }
// 把廠務出貨紀錄（同 orderNo 依 seq 分組）upsert 進 order_shipments；回 {batches:[{seq,date,lines:[{product,bottleType,qty}]}], changed:n}
function fxSyncShipments_(quoteNo, o, shipRows, existingShips) {
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
      if (vf) { handleUpdateShipment_({ id: vf.id, fields: { note: note + ' ' + String(vf.note || '') } }); vf.note = note; changed++; }
      else {
        var r = handleAddShipment_({ quote_no: quoteNo, fields: { ship_date_est: b.date, ship_date_actual: b.date, note: note } });
        existingShips.push({ id: r.id, quote_no: quoteNo, ship_date_actual: b.date, note: note }); changed++;
      }
    }
  });
  return { batches: batches, changed: changed };
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
  var today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  var quote = {
    quoteType: quoteType, clientName: clientName,
    contactName: (cust && cust.contact) || o.recvName || '', clientTaxId: o.taxId || (cust && cust.tax_id) || '',
    contactPhone: (cust && cust.phone) || o.recvPhone || '', clientAddress: (cust && cust.address) || '',
    invoiceTitle: (cust && cust.invoice_title) || '',
    shipContact: o.recvName || (cust && cust.ship_contact) || '', shipPhone: o.recvPhone || (cust && cust.ship_phone) || '',
    shipAddress: o.recvAddr || (cust && cust.ship_address) || '',
    quoteDate: today, expiryDate: '', handler: o.pm || '',
    itemsSubtotal: sub, taxAmount: 0, extrasTotal: 0, grandTotal: grand,
    priceMode: 'inc', taxRate: 5, paymentType: '', paymentDetail: '',
    remark: '由廠務訂單 ' + o.orderNo + ' 自動帶入（' + (o.orderCreator || '') + '）' + (o.orderNote ? '｜' + o.orderNote : '') + '；單價為系統自動帶牌價，請確認',
    status: '草稿', expectedShipDate: o.deliveryDate || '', showShipDate: (o.deliveryDate ? 'Y' : 'N'),
    items: items
  };
  if (typeof CURRENT_USER_ === 'undefined' || !CURRENT_USER_) { try { CURRENT_USER_ = { name: '廠務APP', role: 'owner' }; } catch (e) {} }
  var r = handleCreateQuote_({ quote: quote });
  if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'createQuote 失敗' };
  var quoteNo = r.quoteNo;
  try { logChange_('factoryImport', quoteNo, { factory_order_no: o.orderNo, client: clientName, items: items.length }); } catch (e) {}
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
function handleFactorySync_(params) {
  if (!fxConfigured_()) return { ok: false, error: '廠務連結尚未設定' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { ok: false, error: '另一個同步正在進行，稍後再試' };
  try {
    var r = fxCall_('extGetOrders', { fresh: '1' });
    if (!r || !r.ok) return { ok: false, error: '讀取廠務失敗：' + ((r && r.error) || '無回應') };
    var orders = r.orders || [], shipRows = r.shipments || [];
    var map = fxMapAll_();
    var links = fxLinksAll_();
    var byFx = {}, byQ = {};
    links.forEach(function (l) { if (l.factory_order_no) byFx[String(l.factory_order_no)] = l; byQ[String(l.quote_no)] = l; });
    var osAll = v2ReadAll_(SHEET_ORDER_STATUS, ORDER_STATUS_HEADERS);
    var osBy = {}; osAll.forEach(function (o) { osBy[String(o.quote_no)] = o; });
    var ships = v2ReadAll_(SHEET_ORDER_SHIPMENTS, ORDER_SHIP_HEADERS);
    var customers = []; try { customers = v2ReadAll_(SHEET_CUSTOMERS, CUSTOMERS_HEADERS); } catch (e) {}
    var shipMap = fxShippingMap_();
    var priceCtx = null;
    var now = tpeNow_();
    var synced = 0, imported = [], mismatches = [], errors = [], shipChanged = 0;
    var doImport = !(params && String(params.noImport) === '1');

    orders.forEach(function (o) {
      try {
        var quoteNo = String(o.qsQuoteNo || '').trim();
        if (!quoteNo && byFx[o.orderNo]) quoteNo = String(byFx[o.orderNo].quote_no);   // 推單成功但廠務 AI 欄還沒寫到（保險）
        if (!quoteNo) {
          if (!doImport) return;
          if (!fxShouldImport_(o)) return;   // 舊單不自動匯入（用「連結廠務已有訂單」手動對）
          if (!priceCtx) priceCtx = fxPriceCtx_();
          var imp = fxImportOrder_(o, map, customers, priceCtx);
          if (!imp.ok) { errors.push(o.orderNo + '：' + imp.error); return; }
          quoteNo = imp.quoteNo;
          var mk = fxCall_('extMarkImported', { orderNo: o.orderNo, quoteNo: quoteNo });
          if (!mk || !mk.ok) errors.push(o.orderNo + '：回填廠務對應報價單號失敗（' + ((mk && mk.error) || '無回應') + '），下次同步可能重複匯入');
          fxLinkUpsert_(quoteNo, { factory_order_no: o.orderNo, source: 'import', note: '由廠務訂單匯入' });
          osBy[quoteNo] = fxOrderStatusOf_(quoteNo);
          imported.push({ factory_order_no: o.orderNo, quote_no: quoteNo, client: imp.clientName });
        }
        var os = osBy[quoteNo] || null;
        var mis = fxFinCompare_(os, o, shipMap[quoteNo] || 0);
        var sres = fxSyncShipments_(quoteNo, o, shipRows, ships);
        shipChanged += sres.changed;
        var actual = '';
        if (String(o.status) === '已出貨') actual = o.lastShipDate || (o.shipDateConfirmed ? o.actualDeliveryDate : '') || '';
        // 廠務已出貨、報價系統還沒填實際出貨日 → 自動補（出貨以廠務為主）
        if (actual && os && !os.ship_date_actual) {
          try { handleUpdateOrderStatus_({ quote_no: quoteNo, fields: { ship_date_actual: actual } }); os.ship_date_actual = actual; } catch (e) { errors.push(quoteNo + '：回寫實際出貨日失敗 ' + e.message); }
        }
        fxLinkUpsert_(quoteNo, {
          factory_order_no: o.orderNo, factory_status: o.status || '', factory_lot: o.lot || '',
          factory_ship_est: o.deliveryDate || '', factory_ship_actual: actual || (o.shipDateConfirmed ? o.actualDeliveryDate : ''),
          factory_fin_json: JSON.stringify({ total: o.total, depositAmount: o.depositAmount, depositPaidDate: o.depositPaidDate, finalAmount: o.finalAmount,
            finalPaidDate: o.finalPaidDate, finalAdjusted: !!o.finalAdjusted, finalAdjustedAmount: o.finalAdjustedAmount, depositStatus: o.depositStatus, pm: o.pm, client: o.client }),
          fin_mismatch: mis.join('；'),
          ship_json: JSON.stringify({ orderNo: o.orderNo, client: o.client, lot: o.lot || '', pm: o.pm || '', items: (o.items || []).map(function (it) { return { product: it.product, volume: it.volume, bottleType: it.bottleType, qty: it.qty, shipped: it.shipped || 0 }; }), batches: sres.batches }),
          last_sync: now
        });
        if (mis.length) mismatches.push({ quote_no: quoteNo, factory_order_no: o.orderNo, items: mis });
        synced++;
      } catch (e) { errors.push((o && o.orderNo) + '：' + (e && e.message || e)); }
    });
    try { PropertiesService.getScriptProperties().setProperty('FACTORY_LAST_SYNC', now); } catch (e) {}
    return { ok: true, synced: synced, imported: imported, mismatches: mismatches, shipChanged: shipChanged, errors: errors, at: now };
  } finally { lock.releaseLock(); }
}

// ── 排程 ──────────────────────────────────────────────
function runFactorySync() {
  if (!fxConfigured_()) return;
  try { var r = handleFactorySync_({}); Logger.log(JSON.stringify(r).slice(0, 500)); } catch (e) { Logger.log('runFactorySync error: ' + e); }
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
    return !String(o.qsQuoteNo || '').trim() && !linked[String(o.orderNo)] && FX_IMPORT_TYPES.indexOf(String(o.orderType)) >= 0;
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
  var sync = null;
  try { sync = handleFactorySync_({ noImport: '1' }); } catch (e) {}
  return { ok: true, quote_no: quoteNo, factory_order_no: orderNo, synced: !!(sync && sync.ok) };
}

// ═══ 2026-09-09 Molly：「報價單資訊有更改，訂單追蹤要跟著一起更新」═══════════════════
// 付款條件文字 → {dep, bal}（跟 v2_extensions 的 orderPayFromQuote_ 同一套規則，但吃文字不讀表，才能整批一次算）
function fxParsePay_(detail, gt) {
  var s = String(detail || '').replace(/<br\s*\/?>/gi, '\n');
  if (!s) return null;
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
      pay: fxParsePay_(r[MAIN_COLS.paymentDetail - 1], gt) };
  });
  return m;
}
// 算這一列該改什麼：回 {fields, changed}（changed 空＝不用動）
function fxOrderStatusDiff_(os, q) {
  var fields = {}, changed = [];
  if (!q) return { fields: fields, changed: changed };
  if (q.gt > 0 && Math.round(Number(os.grand_total) || 0) !== q.gt) { fields.grand_total = q.gt; changed.push('總額 ' + (os.grand_total === '' ? '—' : os.grand_total) + '→' + q.gt); }
  if (q.pay) {
    if (fxNum_(os.deposit_amt) !== q.pay.dep) { fields.deposit_amt = q.pay.dep; changed.push('訂金 ' + (os.deposit_amt === '' ? '—' : os.deposit_amt) + '→' + q.pay.dep); }
    if (fxNum_(os.final_amt) !== q.pay.bal) { fields.final_amt = q.pay.bal; changed.push('尾款 ' + (os.final_amt === '' ? '—' : os.final_amt) + '→' + q.pay.bal); }
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
