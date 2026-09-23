/* 2026-09-23 晚 廠務×報價系統 深度複檢修正（GAS 純邏輯，node vm ＋ stub；不用瀏覽器）
   驗 gas/v5_factory.gs 的「複檢 0923」各項：
     A) 寄售單判斷（訂金狀態寄售／叫貨放行／月結認列／0 元經銷商出貨單；買斷的「經銷商-滿枝枒」不算）
     B) 推過去的單認回報價單號；C) 反向匯入跳過寄售單／推過去的單
     D) 運費：運費折抵相抵、免運折抵
     E) 「更新廠務訂單」合併：廠務的客戶鍵／瓶型／酒譜／Lot／配送／運費支付方／備註留著，數量／金流用報價系統的
     F) 推單：已刪→GONE、force_new、寄售單拒絕、對到別張拒絕、衝突不推、AI 空白先補、取消的單不推
     G) 同步：已刪除／純報價暫停、廠務刪單標記、號碼回收不亂接、補 AI、複製單不接、[FX:] 出貨列清掉、出貨日跟著改、
        同步中旗標、連結列沒變不寫、匯入去 V2＋帶運費＋記客戶對照
     H) 付款條件：無訂金／訂金 N%；已收的錢不改；讀不出來時尾款跟總額
     I) 寄售：上線後手動列不拿來抵、兩筆一樣近不猜、0 元售出退回報價系統單價、「不連結」不再提醒
     J) 其他：getFactoryLinks 回 lastSync、未連結清單排除寄售／推過去的單、手動連結不再跑整個同步
*/
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(__dirname + '/gas/v5_factory.gs', 'utf8');
const results = []; const check = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);

const OS_H = ['quote_no','status','deposit_amt','deposit_date','ship_date_est','ship_date_actual','invoice_no','invoice_date','final_amt','final_date','track_note','updated_at','grand_total','invoice_last5','invoice_detail','invoice_photos','final_date_est','closed_at','cust_lot'];
const SHIP_H = ['id','quote_no','seq','ship_date_est','ship_date_actual','amount','invoice_no','invoice_last5','note','created_at','updated_at'];
const MAIN_H = ['quoteNo', 'clientName', 'status', 'grandTotal', 'taxAmount', 'paymentDetail'];
const ITEM_H = ['quoteNo', 'itemType', 'name', 'unitPrice', 'subtotal', 'deduction', 'flavorList'];
const colsOf = h => { const o = {}; h.forEach((k, i) => { o[k] = i + 1; }); return o; };
const KEY = 'k'.repeat(24);

function mkCtx(opts) {
  opts = opts || {};
  const props = Object.assign({ FACTORY_API_URL: 'https://script.google.com/macros/s/x/exec', FACTORY_KEY: KEY, FACTORY_IMPORT_SINCE: '2026-09-10 00:00',
    FACTORY_CONSIGN_SINCE: '2026-09-16 00:00:00' }, opts.props || {});
  const sheets = {};
  const seed = opts.seed || {};
  const sheetObj = (name, headers) => {
    if (!sheets[name]) sheets[name] = { headers, rows: (seed[name] ? seed[name].map(r => r.slice()) : []), writes: 0 };
    const S = sheets[name];
    return {
      getLastRow: () => S.rows.length + 1,
      getRange: (r, c, nr, nc) => ({
        setValue: (v) => { S.rows[r - 2][c - 1] = v; S.writes++; },
        setValues: (vals) => { for (let i = 0; i < vals.length; i++) S.rows[r - 2 + i] = vals[i].slice(); S.writes++; },
        getValues: () => S.rows.slice(r - 2, r - 2 + (nr || 1)).map(row => { const x = row.slice(c - 1, c - 1 + (nc || row.length)); while (x.length < (nc || 0)) x.push(''); return x; }),
      }),
      appendRow: (row) => { S.rows.push(row.slice()); S.writes++; },
      deleteRow: (r) => { S.rows.splice(r - 2, 1); S.writes++; },
    };
  };
  const readAll = (name, headers) => { sheetObj(name, headers); return sheets[name].rows.map(row => { const o = {}; headers.forEach((h, i) => { o[h] = row[i] == null ? '' : row[i]; }); return o; }); };
  const cache = {};
  const ctx = {
    console, JSON, Math, Date, String, Number, Object, Array, isNaN, parseInt, parseFloat, RegExp,
    Logger: { log: () => {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] == null ? null : props[k], setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] == null ? null : cache[k], put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    UrlFetchApp: { fetch: (url, o) => { const body = JSON.parse(o.payload); ctx.__calls.push(body); const r = opts.factory(body, ctx); return { getContentText: () => JSON.stringify(r), getResponseCode: () => 200 }; } },
    Utilities: { formatDate: (d, tz, fmt) => { const p = n => String(n).padStart(2, '0'); const t = new Date(d.getTime() + 8 * 3600e3); const s = t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate()); return fmt.indexOf('HH') >= 0 ? s + (fmt.indexOf("'T'") >= 0 ? 'T' : ' ') + p(t.getUTCHours()) + ':' + p(t.getUTCMinutes()) + (fmt.indexOf('ss') >= 0 ? ':' + p(t.getUTCSeconds()) : '') + (fmt.indexOf('+08:00') >= 0 ? '+08:00' : '') : s; } },
    SHEET_CONSIGN_CUSTOMERS: 'consign_customers', CONSIGN_CUSTOMERS_HEADERS: ['customer_id', 'company_id', 'name', 'default_discount', 'billing_day', 'contact', 'phone', 'ship_address', 'active', 'note', 'deposit_required'],
    SHEET_CONSIGN_LEDGER: 'consign_ledger', CONSIGN_LEDGER_HEADERS: ['movement_id', 'date', 'customer_id', 'sku_id', 'type', 'qty', 'unit_price', 'note', 'created_at'],
    SHEET_OWNBRAND_PRODUCTS: 'ownbrand_products', OWNBRAND_PRODUCTS_HEADERS: ['sku_id', 'name', 'abv', 'volume', 'list_price', 'cost', 'bottle_type', 'active', 'synced_at'],
    SHEET_ORDER_STATUS: 'order_status', ORDER_STATUS_HEADERS: OS_H, SHEET_ORDER_SHIPMENTS: 'order_shipments', ORDER_SHIP_HEADERS: SHIP_H,
    SHEET_CUSTOMERS: 'customers', CUSTOMERS_HEADERS: ['customer_id', 'name', 'contact', 'phone', 'tax_id', 'pay_habit'],
    SHEET_MAIN: 'main', MAIN_HEADERS: MAIN_H, MAIN_COLS: colsOf(MAIN_H), SHEET_ITEMS: 'items', ITEM_HEADERS: ITEM_H, ITEM_COLS: colsOf(ITEM_H),
    effW_: (sh, headers) => headers.length,
    ssApp_: () => ({ getSheetByName: n => (n === 'main' ? sheetObj('main', MAIN_H) : n === 'items' ? sheetObj('items', ITEM_H) : null) }),
    v2Sheet_: (name, headers) => sheetObj(name, headers),
    v2ReadAll_: readAll,
    v2FindRow_: (name, headers, keyCol, keyVal) => { sheetObj(name, headers); const i = headers.indexOf(keyCol); const k = sheets[name].rows.findIndex(r => String(r[i]) === String(keyVal)); return k < 0 ? -1 : k + 2; },
    v2AsCell_: v => (v === null || v === undefined) ? '' : (typeof v === 'object' ? JSON.stringify(v) : v),
    tpeNow_: () => ctx.__now,
    logChange_: (a, r, p) => { ctx.__log.push([a, r, p]); },
    handleGetQuoteById_: ({ quoteNo }) => { const q = (opts.quotes || {})[quoteNo]; return q ? { ok: true, quote: q } : { ok: false, error: '找不到' }; },
    handleCreateQuote_: ({ quote }) => { const no = 'QI-' + (ctx.__created.length + 1); ctx.__created.push(Object.assign({ quoteNo: no }, quote)); sheetObj('main', MAIN_H); sheets.main.rows.push([no, quote.clientName, '草稿', quote.grandTotal, 0, quote.paymentDetail || '']); return { ok: true, quoteNo: no }; },
    handleUpdateOrderStatus_: ({ quote_no, fields }) => {
      ctx.__osUpd.push([quote_no, fields]); sheetObj('order_status', OS_H);
      let row = sheets.order_status.rows.find(r => String(r[0]) === String(quote_no));
      if (!row) { row = OS_H.map(() => ''); row[0] = quote_no; sheets.order_status.rows.push(row); }
      Object.keys(fields).forEach(k => { const i = OS_H.indexOf(k); if (i >= 0) row[i] = fields[k]; });
      return { ok: true };
    },
    handleAddShipment_: ({ quote_no, fields }) => { sheetObj('order_shipments', SHIP_H); const id = 'SH-' + (++ctx.__shipSeq); const row = SHIP_H.map(h => h === 'id' ? id : h === 'quote_no' ? quote_no : (fields[h] == null ? '' : fields[h])); sheets.order_shipments.rows.push(row); ctx.__shipOps.push(['add', id]); return { ok: true, id }; },
    handleUpdateShipment_: ({ id, fields }) => { const row = sheets.order_shipments.rows.find(r => r[0] === id); if (!row) throw new Error('找不到出貨批次：' + id); Object.keys(fields).forEach(k => { row[SHIP_H.indexOf(k)] = fields[k]; }); ctx.__shipOps.push(['upd', id]); return { ok: true, id }; },
    handleDeleteShipment_: ({ id }) => { const i = sheets.order_shipments.rows.findIndex(r => r[0] === id); if (i < 0) throw new Error('找不到出貨批次：' + id); sheets.order_shipments.rows.splice(i, 1); ctx.__shipOps.push(['del', id]); return { ok: true, id }; },
    upsertShipCalendar_: () => {},
    handleGetCompanyData_: () => ({ products: [], companies: [] }),
    resolveConsignUnitPrice_: (cid, sku) => (opts.unitPrice ? opts.unitPrice(cid, sku) : null),
    __calls: [], __log: [], __created: [], __osUpd: [], __shipOps: [], __shipSeq: 0, __sheets: sheets, __props: props, __cache: cache, __now: '2026-09-23T20:00:00+08:00',
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx;
}
const LINK_H = ['quote_no', 'factory_order_no', 'factory_status', 'factory_lot', 'factory_ship_est', 'factory_ship_actual', 'factory_fin_json', 'fin_mismatch', 'ship_json', 'source', 'last_sync', 'note', 'created_at', 'updated_at'];
const linkRow = o => LINK_H.map(h => (o[h] == null ? '' : o[h]));
const osRow = o => OS_H.map(h => (o[h] == null ? '' : o[h]));
const shipRow = o => SHIP_H.map(h => (o[h] == null ? '' : o[h]));
const linkOf = (ctx, q) => { const r = (ctx.__sheets.factory_links || { rows: [] }).rows.find(x => String(x[0]) === q); if (!r) return null; const o = {}; LINK_H.forEach((h, i) => { o[h] = r[i]; }); return o; };
const calls = (ctx, a) => ctx.__calls.filter(c => c.action === a);

// ── A/B/C ─────────────────────────────────────────
{
  const c = mkCtx({ factory: () => ({ ok: true }) });
  const SHIP = '自有酒款出貨訂單(有金流)';
  check('A1 訂金狀態＝寄售 → 寄售單', c.fxIsConsignOrder_({ orderType: SHIP, depositStatus: '寄售', client: '經銷商－島羽', total: 0 }));
  check('A2 叫貨放行單（建單人員 經銷商叫貨…）→ 寄售單', c.fxIsConsignOrder_({ orderType: SHIP, depositStatus: '', orderCreator: '經銷商叫貨放行(Kevin)', client: '經銷商－島羽', total: 0 }));
  check('A3 月結認列單 → 寄售單', c.fxIsConsignOrder_({ orderType: '經銷商寄售月結認列單', client: '經銷商－島羽', total: 3000 }));
  check('A4 0 元的經銷商出貨單 → 寄售單', c.fxIsConsignOrder_({ orderType: SHIP, client: '經銷商-downstair', total: 0 }));
  check('A5 買斷的「經銷商-滿枝枒(華山)」12,750 → 不是寄售單', !c.fxIsConsignOrder_({ orderType: SHIP, client: '經銷商-滿枝枒(華山)', total: 12750, depositStatus: '未收' }));
  check('A6 一般代工單 → 不是', !c.fxIsConsignOrder_({ orderType: '代工訂單(全客製/換前標)', client: 'OEM-好野吧', total: 94500 }));
  check('B1 建單人員 Molly(20260909-01) → 20260909-01', c.fxPushedQuoteNoOf_({ orderCreator: 'Molly(20260909-01)' }) === '20260909-01');
  check('B2 備註「報價單 20260915-01｜…」→ 20260915-01', c.fxPushedQuoteNoOf_({ orderCreator: 'Kevin', orderNote: '報價單 20260915-01｜報價單未稅顯示' }) === '20260915-01');
  check('B3 同仁自己建的單 → 空', c.fxPushedQuoteNoOf_({ orderCreator: 'Kevin', orderNote: '好野吧 Lot34' }) === '');
  const base = { orderType: SHIP, client: '酒肉朋友', total: 5000, createdAt: '2026/9/20 下午3:20:11', orderCreator: 'Kevin' };
  check('C1 上線後同仁建的有金流單 → 匯入', c.fxShouldImport_(base) === true);
  check('C2 寄售單 → 不匯', c.fxShouldImport_(Object.assign({}, base, { depositStatus: '寄售', total: 0, client: '經銷商－島羽' })) === false);
  check('C3 報價系統推過去的單 → 不匯', c.fxShouldImport_(Object.assign({}, base, { orderCreator: 'Molly(20260920-02)' })) === false);
  check('C4 上線前的舊單 → 不匯', c.fxShouldImport_(Object.assign({}, base, { createdAt: '2026/9/1 上午10:00:00' })) === false);
  // D 運費
  check('D1 運費 300＋運費折抵 −300 → 0', c.fxShippingOfItems_([{ itemType: 'extra', name: '運費', subtotal: 300 }, { itemType: 'extra', name: '運費折抵', subtotal: -300 }]) === 0);
  check('D2 運費 200＋免運優惠 200 → 200（免運優惠是顯示給客戶看、不計入總計，不能扣）', c.fxShippingOfItems_([{ itemType: 'extra', name: '運費', subtotal: 200 }, { itemType: 'freeship', name: '免運優惠', deduction: 200 }]) === 200);
  check('D3 運費 150 → 150；其他 extra 不算', c.fxShippingOfItems_([{ itemType: 'extra', name: '運費', subtotal: 150 }, { itemType: 'extra', name: '禮盒', subtotal: 500 }]) === 150);
  const c2 = mkCtx({ factory: () => ({ ok: true }), seed: { items: [['Q1', 'extra', '運費', 300, 300, 0, ''], ['Q1', 'extra', '運費折抵', -300, -300, 0, ''], ['Q2', 'extra', '運費', 200, 200, 0, ''], ['Q2', 'freeship', '免運', 0, 0, -120, ''], ['Q3', 'extra', '運費', 100, 100, 0, '']] } });
  const sm = c2.fxShippingMap_();
  check('D4 整表版：Q1 相抵沒運費、Q2 免運優惠不扣＝200、Q3 100', sm.Q1 === undefined && sm.Q2 === 200 && sm.Q3 === 100);
}

// ── E 合併 ─────────────────────────────────────────
{
  const c = mkCtx({ factory: () => ({ ok: true }) });
  const p = { quoteNo: 'Q1', client: '日富一日', orderType: '代工訂單(全客製/換前標)', deliveryDate: '2026-09-30', actualDeliveryDate: '',
    items: JSON.stringify([{ product: '桂花烏龍琴酒', sheet: '', volume: '500ml', bottleType: '', qty: 60, status: '待製作' }, { product: '蜜香紅茶', sheet: '', volume: '100ml', bottleType: '', qty: 20, status: '待製作' }]),
    total: 30000, balance: 15000, depositStatus: '已收訂', pm: 'Molly', lot: '', orderCreator: 'Molly(Q1)', orderNote: '報價單 Q1',
    depositAmount: 15000, depositDueDate: '', depositPaidDate: '', finalAmount: 15000, finalDueDate: '', finalPaidDate: '',
    finalAdjusted: 'false', finalAdjustedAmount: '', finalAdjustNote: '', shipMethod: '', shipFee: '', shipFeePayer: '', recvName: '王先生', recvPhone: '0912', recvAddr: '台北', taxId: '123', invoiceSent: 'false', invoiceLast5: '' };
  const cur = { orderNo: '260909-001', client: 'OEM-日富一日', orderType: '代工訂單(全客製/換前標)', pm: 'Kevin', lot: '18', orderNote: '同仁備註：要貼防偽', shipMethod: '黑貓', recvName: '王小姐', recvPhone: '', recvAddr: '新北', taxId: '',
    orderCreator: 'Molly(Q1)', invoiceSent: true, invoiceLast5: '12345', shipFee: 180, shipFeePayer: '南坡萬付運費', depositPaidDate: '2026-09-10', depositDueDate: '2026-09-08',
    finalAdjusted: true, finalAdjustedAmount: 14800, finalAdjustNote: '少一箱', shipBatches: 1, shipDateConfirmed: false, actualDeliveryDate: '2026-09-20',
    items: [{ product: '桂花烏龍琴酒 V2', sheet: 'RC-桂花', volume: '500ml', bottleType: '圓瓶', qty: 50, status: '完成', batchId: 'B-7', shipped: 30, sample: '試飲2' },
            { product: '蜜香紅茶', sheet: '', volume: '100ml', bottleType: '方瓶', qty: 20, status: '待製作', shipped: 0 }] };
  const m = c.fxMergeUpdatePayload_(p, cur);
  const o = m.payload, its = JSON.parse(o.items);
  check('E1 客戶鍵用廠務的（OEM-日富一日）、單型照廠務', o.client === 'OEM-日富一日' && o.orderType === '代工訂單(全客製/換前標)');
  check('E2 Lot／PM／備註／配送方式／收件人／地址 廠務有填就留著；廠務空白的（電話、統編）用報價單的', o.lot === '18' && o.pm === 'Kevin' && o.orderNote === '同仁備註：要貼防偽' && o.shipMethod === '黑貓' && o.recvName === '王小姐' && o.recvAddr === '新北' && o.recvPhone === '0912' && o.taxId === '123');
  check('E3 發票已隨貨留廠務的、發票末五碼報價單沒有就用廠務的', o.invoiceSent === 'true' && o.invoiceLast5 === '12345');
  check('E4 報價單沒運費 → 廠務的運費 180／南坡萬付運費留著', o.shipFee === 180 && o.shipFeePayer === '南坡萬付運費');
  check('E5 訂金收款日報價系統空白 → 不清掉廠務填的；訂金預計日／尾款特殊調整照廠務', o.depositPaidDate === '2026-09-10' && o.depositDueDate === '2026-09-08' && o.finalAdjusted === 'true' && o.finalAdjustedAmount === 14800 && o.finalAdjustNote === '少一箱');
  check('E6 已經出過貨 → 實際出貨日留廠務的（不會變回表訂日）', o.actualDeliveryDate === '2026-09-20');
  check('E7 品項：廠務酒名（含 V2）／酒譜／瓶型／狀態／batchId／試飲留著，數量用報價單的', its[0].product === '桂花烏龍琴酒 V2' && its[0].sheet === 'RC-桂花' && its[0].bottleType === '圓瓶' && its[0].status === '完成' && its[0].batchId === 'B-7' && its[0].sample === '試飲2' && its[0].qty === 60 && its[1].bottleType === '方瓶');
  check('E8 數量改了有提示（已完成製作的要同仁確認補做）', m.conflicts.length === 0 && m.notes.some(n => /50→60/.test(n) && /補做/.test(n)));
  const p2 = Object.assign({}, p, { shipFee: 300, items: JSON.stringify([{ product: '桂花烏龍琴酒', volume: '500ml', qty: 20, status: '待製作' }]) });
  const m2 = c.fxMergeUpdatePayload_(p2, Object.assign({}, cur, { shipFeePayer: '' }));
  check('E9 數量低於已出貨 → 衝突', m2.conflicts.some(x => /已出貨 30/.test(x) && /20/.test(x)));
  check('E10 報價單拿掉的款、廠務還沒動 → 只提示會拿掉', m2.notes.some(x => /蜜香紅茶.*拿掉/.test(x)));
  check('E11 報價單有運費 300 → 用報價單的、支付方預設客戶付運費', m2.payload.shipFee === 300 && m2.payload.shipFeePayer === '客戶付運費');
  const m3 = c.fxMergeUpdatePayload_(Object.assign({}, p, { items: JSON.stringify([{ product: '蜜香紅茶', volume: '100ml', qty: 20 }]) }), cur);
  check('E12 報價單拿掉「廠務已完成／已出貨」的款 → 衝突', m3.conflicts.some(x => /桂花烏龍琴酒 V2/.test(x) && /沒有這款/.test(x)));
  // 酒款名不同＝不同款（不再用位置硬配）：報價單把桂花換成蜜香 → 新增蜜香、廠務桂花沒進度就提示拿掉；有進度＝衝突
  const m4 = c.fxMergeUpdatePayload_(Object.assign({}, p, { items: JSON.stringify([{ product: '蜜香紅茶琴酒', volume: '500ml', qty: 60 }]) }),
    { client: 'X', items: [{ product: '桂花烏龍琴酒', volume: '500ml', bottleType: '', qty: 60, status: '待製作', shipped: 0 }] });
  const i4 = JSON.parse(m4.payload.items);
  check('E13 報價單換了酒款（桂花→蜜香）→ 廠務改做蜜香、提示桂花拿掉（原本會被當同一款、照做桂花）', i4.length === 1 && i4[0].product === '蜜香紅茶琴酒' && m4.notes.some(n => /新增酒款「蜜香紅茶琴酒」/.test(n)) && m4.notes.some(n => /桂花烏龍琴酒.*拿掉/.test(n)) && m4.conflicts.length === 0);
  const m4b = c.fxMergeUpdatePayload_(Object.assign({}, p, { items: JSON.stringify([{ product: '蜜香紅茶琴酒', volume: '500ml', qty: 60 }]) }),
    { client: 'X', items: [{ product: '桂花烏龍琴酒', volume: '500ml', qty: 60, status: '完成', batchId: 'B-1', shipped: 0 }] });
  check('E13b 換掉的那款廠務已完成製作 → 衝突不推', m4b.conflicts.some(x => /桂花烏龍琴酒/.test(x) && /沒有這款/.test(x)));
  // 同仁在廠務「補綁酒譜」改過名字（Babyface 蜂蜜檸檬 → 蜂蜜檸檬琴酒，已綁酒譜／瓶型）→ 不能當成換酒款把設定丟掉：擋下、請她用對照表對上
  const m4f = c.fxMergeUpdatePayload_(Object.assign({}, p, { items: JSON.stringify([{ product: 'Babyface 蜂蜜檸檬', volume: '500ml', qty: 60 }]) }),
    { client: 'OEM-Babyface', items: [{ product: '蜂蜜檸檬琴酒', sheet: 'RC-蜂蜜檸檬', srcClient: 'Babyface', volume: '500ml', bottleType: '圓瓶', qty: 60, status: '待製作', shipped: 0 }] });
  check('E13f 廠務改過名字（已綁酒譜）＋報價單是舊名 → 衝突、提示到廠務對照對上（不丟掉酒譜／瓶型）', m4f.conflicts.some(x => /蜂蜜檸檬琴酒/.test(x) && /廠務對照/.test(x)));
  const m4g = c.fxMergeUpdatePayload_(Object.assign({}, p, { items: JSON.stringify([{ product: '桂花烏龍琴酒', volume: '1000ml', qty: 10 }]) }),
    { client: 'X', items: [{ product: '桂花烏龍琴酒', volume: '1L', bottleType: '大瓶', qty: 10, status: '完成', batchId: 'B-9', shipped: 0 }] });
  const i4g = JSON.parse(m4g.payload.items);
  check('E13g 廠務寫 1L、報價單 1000ml → 同容量（不衝突、瓶型留著）', m4g.conflicts.length === 0 && i4g[0].bottleType === '大瓶' && i4g[0].batchId === 'B-9');
  const m4h = c.fxMergeUpdatePayload_(Object.assign({}, p, { items: JSON.stringify([{ product: '桂花烏龍琴酒', volume: '500ml', qty: 10 }]) }),
    { client: 'X', items: [{ product: '桂花烏龍琴酒', volume: '', bottleType: '圓瓶', qty: 10, status: '完成', batchId: 'B-9', shipped: 0 }] });
  check('E13h 廠務沒填容量 → 不算改容量（不衝突、瓶型留著）', m4h.conflicts.length === 0 && JSON.parse(m4h.payload.items)[0].bottleType === '圓瓶');
  // 同酒款兩種容量：先全部配同容量 → 100ml 那列不會搶走 500ml（已完成、B-1）
  const m4c = c.fxMergeUpdatePayload_(Object.assign({}, p, { items: JSON.stringify([{ product: '桂花烏龍琴酒', volume: '100ml', qty: 20 }, { product: '桂花烏龍琴酒', volume: '500ml', qty: 50 }]) }),
    { client: 'X', items: [{ product: '桂花烏龍琴酒 V2', volume: '500ml', bottleType: '圓瓶', qty: 50, status: '完成', batchId: 'B-1', shipped: 30 }] });
  const i4c = JSON.parse(m4c.payload.items);
  check('E13c 加一個 100ml → 新增 100ml、500ml 那款（已完成 B-1、已出 30）原封留著、沒有假衝突', m4c.conflicts.length === 0 && i4c.length === 2 && i4c[0].volume === '100ml' && !i4c[0].batchId && i4c[1].volume === '500ml' && i4c[1].batchId === 'B-1' && i4c[1].qty === 50);
  const m4d = c.fxMergeUpdatePayload_(Object.assign({}, p, { items: JSON.stringify([{ product: '桂花烏龍琴酒', volume: '100ml', qty: 50 }]) }),
    { client: 'X', items: [{ product: '桂花烏龍琴酒', volume: '500ml', bottleType: '圓瓶', qty: 50, status: '待製作', shipped: 0 }] });
  const i4d = JSON.parse(m4d.payload.items);
  check('E13d 只改容量（500→100、還沒做）→ 容量用報價單的、瓶型清掉請同仁重選、有提示', i4d.length === 1 && i4d[0].volume === '100ml' && i4d[0].bottleType === '' && m4d.notes.some(n => /容量 500ml→100ml/.test(n)));
  const m4e = c.fxMergeUpdatePayload_(Object.assign({}, p, { items: JSON.stringify([{ product: '桂花烏龍琴酒', volume: '100ml', qty: 50 }]) }),
    { client: 'X', items: [{ product: '桂花烏龍琴酒', volume: '500ml', qty: 50, status: '完成', batchId: 'B-2', shipped: 0 }] });
  check('E13e 容量改了、但廠務已完成製作 → 衝突', m4e.conflicts.some(x => /完成製作/.test(x) && /100ml/.test(x)));
  // 單欄規則：出貨日／運費／訂金狀態
  const base5 = Object.assign({}, p, { deliveryDate: '', shipFee: '', depositPaidDate: '', finalPaidDate: '', depositStatus: '未收' });
  const m5a = c.fxMergeUpdatePayload_(base5, { client: 'X', deliveryDate: '2026-10-05', shipFee: 300, shipFeePayer: '客戶付運費', depositPaidDate: '2026-09-15', items: [] });
  check('E15 報價系統沒填表訂出貨日 → 廠務的留著；報價單拿掉客戶付的運費 → 廠務也拿掉；訂金收款日留廠務的 → 狀態＝已收訂', m5a.payload.deliveryDate === '2026-10-05' && m5a.payload.shipFee === '' && m5a.payload.shipFeePayer === '' && m5a.payload.depositPaidDate === '2026-09-15' && m5a.payload.depositStatus === '已收訂');
  const m5b = c.fxMergeUpdatePayload_(Object.assign({}, base5, { shipFee: 300 }), { client: 'X', shipFee: 180, shipFeePayer: '南坡萬付運費', items: [] });
  check('E16 廠務是南坡萬付運費 180（成本）、報價單加了 300 → 廠務的 180／南坡萬付運費不動', m5b.payload.shipFee === 180 && m5b.payload.shipFeePayer === '南坡萬付運費');
  const m5c = c.fxMergeUpdatePayload_(base5, { client: 'X', shipFee: 250, shipFeePayer: '', items: [] });
  check('E17 廠務有運費但沒標誰付、報價單也沒運費 → 照廠務的留著', m5c.payload.shipFee === 250 && m5c.payload.shipFeePayer === '');
  const m5d = c.fxMergeUpdatePayload_(Object.assign({}, base5, { finalPaidDate: '2026-09-30' }), { client: 'X', depositStatus: '已收訂金 NT$3,000', depositPaidDate: '2026-09-01', items: [] });
  check('E18 尾款收了 → 已結清；只有訂金收 → 廠務自己寫的狀態文字留著', m5d.payload.depositStatus === '已結清' && c.fxMergeUpdatePayload_(base5, { client: 'X', depositStatus: '已收訂金 NT$3,000', depositPaidDate: '2026-09-01', items: [] }).payload.depositStatus === '已收訂金 NT$3,000');
  const m5 = c.fxMergeUpdatePayload_(Object.assign({}, p, { items: JSON.stringify([{ product: '新酒', volume: '100ml', qty: 5 }, { product: '桂花烏龍琴酒', volume: '500ml', qty: 50 }]) }), cur);
  check('E14 新增的款 → 照報價單加上、有提示', JSON.parse(m5.payload.items).some(x => x.product === '新酒' && x.qty === 5) && m5.notes.some(x => /新增酒款「新酒」/.test(x)));
}

// ── F 推單 ─────────────────────────────────────────
function pushCtx(o) {
  const quotes = { Q1: { quoteNo: 'Q1', status: '成交', quoteType: 'bottle', clientName: '日富一日', grandTotal: 31500, taxAmount: 1500, handler: 'Molly',
    items: [{ itemType: 'bottle', name: '桂花烏龍琴酒', volume: '500ml', qty: 60, lot: '' }], remark: '' } };
  if (o.quoteStatus) quotes.Q1.status = o.quoteStatus;
  const factory = (b, ctx) => {
    if (b.action === 'extGetOrders') return { ok: true, orders: o.fxOrders || [], shipments: [] };
    if (b.action === 'extCreateOrder') return { ok: true, orderNo: o.newNo || '260923-001', updated: o.updated !== undefined ? o.updated : !!(o.fxOrders || []).length };
    if (b.action === 'extMarkImported') return { ok: true };
    return { ok: false, error: 'x' };
  };
  return mkCtx({ factory, quotes, seed: { factory_links: o.links || [], order_status: o.os || [] } });
}
{
  let c = pushCtx({});
  let r = c.handleFactoryPushOrder_({ quote_no: 'Q1' });
  check('F1 沒連過 → 先查廠務有沒有這張報價單的單（沒有）→ 建單、連結列 source=push', r.ok && calls(c, 'extCreateOrder').length === 1 && linkOf(c, 'Q1').factory_order_no === '260923-001' && linkOf(c, 'Q1').source === 'push' && calls(c, 'extGetOrders').length === 1);
  c = pushCtx({ links: [linkRow({ quote_no: 'Q1', factory_order_no: '260909-001', source: 'push' })], fxOrders: [] });
  r = c.handleFactoryPushOrder_({ quote_no: 'Q1' });
  check('F2 連著的廠務單被刪了 → FACTORY_ORDER_GONE、不建單', !r.ok && r.code === 'FACTORY_ORDER_GONE' && r.factory_order_no === '260909-001' && calls(c, 'extCreateOrder').length === 0);
  r = c.handleFactoryPushOrder_({ quote_no: 'Q1', force_new: '1' });
  check('F3 force_new → 清掉舊連結、重新建一張', r.ok && calls(c, 'extCreateOrder').length === 1 && linkOf(c, 'Q1').factory_order_no === '260923-001' && /重新建單|已建立/.test(linkOf(c, 'Q1').note));
  const fxo = { orderNo: '260909-001', client: 'OEM-日富一日', orderType: '代工訂單(全客製/換前標)', qsQuoteNo: 'Q1', lot: '18', items: [{ product: '桂花烏龍琴酒', volume: '500ml', bottleType: '圓瓶', qty: 50, status: '製作中', shipped: 0 }] };
  c = pushCtx({ links: [linkRow({ quote_no: 'Q1', factory_order_no: '260909-001', source: 'push' })], fxOrders: [Object.assign({}, fxo, { depositStatus: '寄售' })] });
  r = c.handleFactoryPushOrder_({ quote_no: 'Q1' });
  check('F4 連到的是寄售單 → 拒絕', !r.ok && /寄售/.test(r.error) && calls(c, 'extCreateOrder').length === 0);
  c = pushCtx({ links: [linkRow({ quote_no: 'Q1', factory_order_no: '260909-001', source: 'push' })], fxOrders: [Object.assign({}, fxo, { qsQuoteNo: 'Q9' })] });
  r = c.handleFactoryPushOrder_({ quote_no: 'Q1' });
  check('F5 廠務那張已對應別的報價單 → 拒絕', !r.ok && /Q9/.test(r.error) && calls(c, 'extCreateOrder').length === 0);
  c = pushCtx({ links: [linkRow({ quote_no: 'Q1', factory_order_no: '260909-001', source: 'push' })], fxOrders: [Object.assign({}, fxo, { items: [{ product: '桂花烏龍琴酒', volume: '500ml', qty: 80, shipped: 70, status: '完成' }] })] });
  r = c.handleFactoryPushOrder_({ quote_no: 'Q1' });
  check('F6 報價單 60 < 已出貨 70 → CONFLICT、不推', !r.ok && r.code === 'CONFLICT' && r.conflicts.length === 1 && calls(c, 'extCreateOrder').length === 0);
  c = pushCtx({ links: [linkRow({ quote_no: 'Q1', factory_order_no: '260909-001', source: 'import' })], fxOrders: [Object.assign({}, fxo, { qsQuoteNo: '' })] });
  r = c.handleFactoryPushOrder_({ quote_no: 'Q1' });
  const seq = c.__calls.map(x => x.action);
  const cp = calls(c, 'extCreateOrder')[0] || {};
  check('F7 廠務 AI 欄空白 → 先補 extMarkImported 再更新；合併後 Lot 18／客戶鍵／瓶型都留著', r.ok && seq.indexOf('extMarkImported') >= 0 && seq.indexOf('extMarkImported') < seq.indexOf('extCreateOrder') && cp.lot === '18' && cp.client === 'OEM-日富一日' && JSON.parse(cp.items)[0].bottleType === '圓瓶' && linkOf(c, 'Q1').source === 'import');
  check('F8 更新有回數量異動提示', r.notes && r.notes.some(n => /50→60/.test(n)));
  c = pushCtx({ links: [linkRow({ quote_no: 'Q1', factory_order_no: '260909-001', source: 'push' })], fxOrders: [fxo], updated: false, newNo: '260923-009' });
  r = c.handleFactoryPushOrder_({ quote_no: 'Q1' });
  check('F9 廠務竟然另建了一張 → 回警告', r.ok && r.notes.some(n => /另建了一張 260923-009/.test(n)));
  // F12 連結表誤標刪除、其實廠務那張還在（AI＝Q1）→ force_new 也不另建、走合併（Lot／瓶型留著）、連結不清掉
  c = pushCtx({ links: [linkRow({ quote_no: 'Q1', factory_order_no: '260909-001', source: 'push', factory_status: '廠務已刪除' })], fxOrders: [fxo] });
  r = c.handleFactoryPushOrder_({ quote_no: 'Q1', force_new: '1' });
  let cp12 = calls(c, 'extCreateOrder')[0] || {};
  check('F12 force_new 但廠務那張其實還在 → 合併更新、不清連結', r.ok && cp12.lot === '18' && JSON.parse(cp12.items)[0].bottleType === '圓瓶' && linkOf(c, 'Q1').factory_order_no === '260923-001' && !/重新建單/.test(linkOf(c, 'Q1').note));
  // F13 沒連結、但廠務已有 AI＝Q1 的單（連結表漏記）→ 合併、提示改連結
  c = pushCtx({ fxOrders: [Object.assign({}, fxo, { orderNo: '260901-009' })], newNo: '260901-009', updated: true });
  r = c.handleFactoryPushOrder_({ quote_no: 'Q1' });
  cp12 = calls(c, 'extCreateOrder')[0] || {};
  check('F13 沒連結但廠務已有這張報價單的單 → 合併更新（不整張蓋掉）、提示連結改成那張', r.ok && cp12.lot === '18' && cp12.client === 'OEM-日富一日' && r.notes.some(n => /連結改成廠務訂單 260901-009/.test(n)) && linkOf(c, 'Q1').factory_order_no === '260901-009');
  // F14 連著的號碼被回收（AI 空白、客戶是別人）→ GONE，不蓋別人的單、不補 AI
  c = pushCtx({ links: [linkRow({ quote_no: 'Q1', factory_order_no: '260909-001', source: 'push', factory_fin_json: JSON.stringify({ client: 'OEM-日富一日' }) })],
    fxOrders: [Object.assign({}, fxo, { qsQuoteNo: '', client: 'OEM-好野吧', orderCreator: 'Kevin', items: [{ product: '好野吧特調', volume: '500ml', qty: 200, shipped: 0 }] })] });
  r = c.handleFactoryPushOrder_({ quote_no: 'Q1' });
  const cT = pushCtx({ links: [linkRow({ quote_no: 'Q1', factory_order_no: '260909-001', source: 'push', factory_fin_json: JSON.stringify({ client: 'OEM-日富一日' }) })],
    fxOrders: [Object.assign({}, fxo, { qsQuoteNo: '', client: '日富一日台中店', orderCreator: 'Kevin', items: [{ product: '桂花烏龍琴酒', volume: '500ml', qty: 200, shipped: 0 }] })] });
  const rT = cT.handleFactoryPushOrder_({ quote_no: 'Q1' });
  check('F14b 回收的號碼給了「日富一日台中店」（名字包含）→ 一樣當別張、GONE', !rT.ok && rT.code === 'FACTORY_ORDER_GONE' && calls(cT, 'extCreateOrder').length === 0);
  check('F14 號碼被回收成好野吧的新單 → GONE、不建不改不補 AI', !r.ok && r.code === 'FACTORY_ORDER_GONE' && /另一張單/.test(r.error) && calls(c, 'extCreateOrder').length === 0 && calls(c, 'extMarkImported').length === 0);
  c = pushCtx({ links: [linkRow({ quote_no: 'Q1', factory_order_no: '260909-001', source: 'push', factory_status: '廠務已刪除' })], fxOrders: [] });
  r = c.handleFactoryPushOrder_({ quote_no: 'Q1' });
  check('F15 連結已標廠務已刪除 → 直接 GONE（不用再查廠務）', !r.ok && r.code === 'FACTORY_ORDER_GONE' && c.__calls.length === 0);
  c = pushCtx({ links: [linkRow({ quote_no: 'Q1', factory_order_no: '260909-001', source: 'push' })], fxOrders: [fxo] });
  c.handleFactoryPushOrder_({ quote_no: 'Q1' });
  const g1 = calls(c, 'extGetOrders')[0] || {};
  c = pushCtx({});
  c.handleFactoryPushOrder_({ quote_no: 'Q1' });
  const g2 = calls(c, 'extGetOrders')[0] || {};
  check('F16 推單只查一張（findOrderNo／findQuoteNo、不帶 fresh）——整包要 15～20 秒會逾時', g1.findOrderNo === '260909-001' && !g1.fresh && g2.findQuoteNo === 'Q1' && !g2.fresh);
  c = pushCtx({ os: [osRow({ quote_no: 'Q1', status: 'cancelled' })] });
  r = c.handleFactoryPushOrder_({ quote_no: 'Q1' });
  check('F10 訂單追蹤是取消 → 不推', !r.ok && /取消/.test(r.error) && calls(c, 'extCreateOrder').length === 0);
  c = pushCtx({ quoteStatus: '純報價' });
  r = c.handleFactoryPushOrder_({ quote_no: 'Q1' });
  check('F11 純報價單不推（原本就有的）', !r.ok && /純報價/.test(r.error));
}

// ── G 同步 ─────────────────────────────────────────
function syncCtx(o) {
  const factory = (b, ctx) => {
    if (b.action === 'extGetOrders') return { ok: true, orders: (typeof o.orders === 'function' ? o.orders(ctx) : o.orders) || [], shipments: (typeof o.shipments === 'function' ? o.shipments(ctx) : o.shipments) || [] };
    if (b.action === 'extMarkImported') return o.markFail ? { ok: false, error: 'x' } : { ok: true };
    if (b.action === 'extConsignLedger') return { ok: true, dealers: [], rows: [] };
    return { ok: false, error: 'unknown ' + b.action };
  };
  return mkCtx({ factory, props: o.props, seed: Object.assign({ factory_links: o.links || [], order_status: o.os || [], order_shipments: o.ships || [], main: o.main || [], items: o.items || [], customers: o.customers || [], ownbrand_products: o.products || [] }, o.seed || {}) });
}
{
  // G1 已刪除／純報價暫停；G2 廠務刪單
  const orders = [
    { orderNo: '260915-002', client: '測試', orderType: '代工訂單(全客製/換前標)', qsQuoteNo: '20260915-02', status: '製作中', items: [{ product: 'A', qty: 1, remainStock: 1 }], shipBatches: 1, lastShipDate: '2026-09-20' },
    { orderNo: '260918-003', client: '寶', orderType: '代工訂單(全客製/換前標)', qsQuoteNo: '20260918-09', status: '已出貨', items: [{ product: 'A', qty: 1, remainStock: 0 }], shipBatches: 1, lastShipDate: '2026-09-21' },
  ];
  const shipments = [{ orderNo: '260915-002', seq: 1, date: '2026-09-20', product: 'A', qty: 1 }, { orderNo: '260918-003', seq: 1, date: '2026-09-21', product: 'A', qty: 1 }];
  const c = syncCtx({ orders, shipments,
    links: [linkRow({ quote_no: '20260915-02', factory_order_no: '260915-002', source: 'push' }), linkRow({ quote_no: '20260909-03', factory_order_no: '260909-002', source: 'push', fin_mismatch: '訂金：報價 1 ≠ 廠務 2' }),
            linkRow({ quote_no: '20260918-09', factory_order_no: '260918-003', source: 'push' })],
    main: [['20260915-02', '測試', '已刪除', 1000, 0, ''], ['20260909-03', '福寶寶', '純報價', 5000, 0, ''], ['20260918-09', '寶', '純報價', 800, 0, '']],
    os: [osRow({ quote_no: '20260918-09', status: 'quoted' })] });
  const r = c.handleFactorySync_({});
  check('G1a 報價單已刪除 → 不寫訂單追蹤／出貨紀錄，列進 paused', r.ok && r.paused.some(x => x.quote_no === '20260915-02' && x.status === '已刪除') && c.__osUpd.length === 0 && c.__shipOps.length === 0);
  check('G1b 純報價（廠務單還在、已出貨）→ 同樣暫停、不回寫實際出貨日', r.paused.some(x => x.quote_no === '20260918-09') && !c.__osUpd.some(x => x[0] === '20260918-09'));
  check('G1c 暫停的連結列註明「已停止同步」', /已停止同步/.test(linkOf(c, '20260915-02').note));
  check('G2 廠務已刪的 260909-002 → 連結標「廠務已刪除」、清掉金額不符提示', linkOf(c, '20260909-03').factory_status === '廠務已刪除' && linkOf(c, '20260909-03').fin_mismatch === '' && r.gone.indexOf('20260909-03') >= 0);
  const r2 = c.handleFactorySync_({});
  check('G2b 再跑一次不會重複標、連結列沒變', r2.ok && r2.gone.length === 0 && r2.linkChanged === 0);
  // 抓不到任何訂單（廠務回空）→ 不亂標刪除
  const c0 = syncCtx({ orders: [], links: [linkRow({ quote_no: 'Q5', factory_order_no: '260901-001' })], main: [['Q5', 'X', '成交', 1, 0, '']] });
  const r0 = c0.handleFactorySync_({});
  check('G2c 廠務回 0 張單 → 不判斷刪除', r0.ok && linkOf(c0, 'Q5').factory_status === '');
}
{
  // G3 號碼回收；G4 AI 空白補回（連結表／推過去的單）；G5 複製的推單不接
  const orders = [
    { orderNo: '260905-001', client: '經銷商-滿枝枒(華山)', orderType: '自有酒款出貨訂單(有金流)', qsQuoteNo: '', status: '待製作', total: 12750, createdAt: '2026/9/1 上午10:00:00', orderCreator: 'Kevin', items: [{ product: 'A', qty: 5 }] },
    { orderNo: '260910-001', client: 'OEM-好野吧', orderType: '代工訂單(全客製/換前標)', qsQuoteNo: '', status: '製作中', total: 90000, createdAt: '2026/9/10 上午10:00:00', orderCreator: 'Kevin', items: [{ product: 'B', qty: 5 }] },
    { orderNo: '260912-001', client: '日富一日', orderType: '代工訂單(全客製/換前標)', qsQuoteNo: '', status: '待製作', total: 30000, createdAt: '2026/9/12 上午10:00:00', orderCreator: 'Molly(20260912-01)', items: [{ product: 'C', qty: 5 }] },
    { orderNo: '260913-001', client: '日富一日', orderType: '代工訂單(全客製/換前標)', qsQuoteNo: '', status: '待製作', total: 30000, createdAt: '2026/9/13 上午10:00:00', orderCreator: 'Molly(20260912-01)', items: [{ product: 'C', qty: 5 }] },
  ];
  // 260913-001 是同仁複製的單（建單人員同一段）→ 20260912-01 已連 260912-001 → 不接
  const c = syncCtx({ orders,
    props: { FACTORY_IMPORT_SINCE: '2026-09-20 00:00' },
    links: [linkRow({ quote_no: '20260901-05', factory_order_no: '260905-001', source: 'link' }), linkRow({ quote_no: '20260910-02', factory_order_no: '260910-001', source: 'import' }), linkRow({ quote_no: '20260912-01', factory_order_no: '260912-001', source: 'push' })],
    main: [['20260901-05', '酒肉朋友', '成交', 8000, 0, ''], ['20260910-02', '好野吧', '草稿', 90000, 0, ''], ['20260912-01', '日富一日', '成交', 30000, 0, '']],
    os: [osRow({ quote_no: '20260910-02', status: 'quoted', grand_total: 90000 }), osRow({ quote_no: '20260912-01', status: 'quoted', grand_total: 30000 })] });
  const r = c.handleFactorySync_({});
  check('G3 號碼被別的客戶用走（酒肉朋友→滿枝枒）→ 舊連結標廠務已刪除、不把滿枝枒接到酒肉朋友那張', linkOf(c, '20260901-05').factory_status === '廠務已刪除' && !calls(c, 'extMarkImported').some(x => x.orderNo === '260905-001') && r.gone.indexOf('20260901-05') >= 0);
  check('G4a 連結表有、客戶對得上（OEM-好野吧↔好野吧）→ 補回 AI、照常同步', calls(c, 'extMarkImported').some(x => x.orderNo === '260910-001' && x.quoteNo === '20260910-02') && r.healed.indexOf('260910-001→20260910-02') >= 0 && linkOf(c, '20260910-02').factory_status === '製作中');
  check('G4b 推過去的單 AI 空白 → 從建單人員認回、補 AI', calls(c, 'extMarkImported').some(x => x.orderNo === '260912-001' && x.quoteNo === '20260912-01'));
  const r2g = c.handleFactorySync_({});
  check('G3b 再跑一次：已標刪除的不會每輪又標（前端不會每 10 分鐘跳一次）', r2g.ok && r2g.gone.length === 0);
  check('G5 同仁複製出來的推單（同一張報價單已連別張）→ 不接、有提示、也不匯入', !calls(c, 'extMarkImported').some(x => x.orderNo === '260913-001') && r.errors.some(e => /260913-001/.test(e) && /複製/.test(e)) && c.__created.length === 0 && linkOf(c, '20260912-01').factory_order_no === '260912-001');
  // G4d 廠務客戶名跟報價系統差很多（OEM-Babyface↔貝比菲斯，靠對照表），AI 回填失敗過一次 → 認得出是同一位、補 AI，不會標刪除又重匯一張
  const c4 = syncCtx({ orders: [{ orderNo: '260915-003', client: 'OEM-Babyface', orderType: '代工訂單(全客製/換前標)', qsQuoteNo: '', status: '製作中', total: 1, createdAt: '2026/9/15 上午10:00:00', orderCreator: 'Kevin', items: [{ product: 'C', qty: 5 }] }],
    props: { FACTORY_IMPORT_SINCE: '2026-09-10 00:00' },
    links: [linkRow({ quote_no: 'QI-7', factory_order_no: '260915-003', source: 'import' })], main: [['QI-7', '貝比菲斯', '草稿', 1, 0, '']],
    seed: { factory_map: [['client', '貝比菲斯', 'OEM-Babyface', '', '']] } });
  const r4 = c4.handleFactorySync_({});
  check('G4d 對照表換算得到同一位客戶 → 補 AI、不標刪除、不重匯', r4.ok && calls(c4, 'extMarkImported').some(x => x.orderNo === '260915-003' && x.quoteNo === 'QI-7') && r4.gone.length === 0 && c4.__created.length === 0);
  // G4c 原本連的那張被刪、同仁照推單內容重建一張（AI 空白、建單人員帶報價單號）→ 改接新那張，不能又被標成「廠務已刪除」
  const c3 = syncCtx({ orders: [{ orderNo: '260922-007', client: '日富一日', orderType: '代工訂單(全客製/換前標)', qsQuoteNo: '', status: '待製作', total: 1, createdAt: '2026/9/22 上午10:00:00', orderCreator: 'Molly(20260912-01)', items: [{ product: 'C', qty: 5 }] }],
    links: [linkRow({ quote_no: '20260912-01', factory_order_no: '260912-001', source: 'push' })], main: [['20260912-01', '日富一日', '成交', 30000, 0, '']], os: [osRow({ quote_no: '20260912-01', status: 'quoted' })] });
  const r3 = c3.handleFactorySync_({});
  check('G4c 舊單被刪、重建的新單 → 接上新單、狀態不是「廠務已刪除」', r3.ok && linkOf(c3, '20260912-01').factory_order_no === '260922-007' && linkOf(c3, '20260912-01').factory_status === '待製作' && r3.gone.length === 0);
}
{
  // G6 [FX:] 出貨列清掉；G7 出貨日跟著改（只改同步自己寫的）
  const o = { orderNo: '260920-001', client: '日富一日', orderType: '代工訂單(全客製/換前標)', qsQuoteNo: 'Q7', status: '製作中', items: [{ product: 'C', qty: 10, remainStock: 0 }], shipBatches: 1, lastShipDate: '2026-09-22', lot: '' };
  const ships = [
    shipRow({ id: 'S1', quote_no: 'Q7', seq: 1, ship_date_actual: '2026-09-21', note: '[FX:260920-001:1] · 廠務出貨 C×10' }),
    shipRow({ id: 'S2', quote_no: 'Q7', seq: 2, ship_date_actual: '2026-09-22', note: '[FX:260920-001:2] · 廠務出貨 C×3' }),
    shipRow({ id: 'S3', quote_no: 'Q7', seq: 3, ship_date_actual: '2026-09-23', note: '[FX:260920-001:3] · 廠務出貨 C×2 [VF:20260923-01:1] 驗收單' }),
    shipRow({ id: 'S4', quote_no: 'Q7', seq: 4, ship_date_actual: '2026-09-23', note: 'Molly 手動記的一筆' }),
  ];
  const c = syncCtx({ orders: [o], shipments: [{ orderNo: '260920-001', seq: 1, date: '2026-09-22', product: 'C', qty: 10 }], ships,
    links: [linkRow({ quote_no: 'Q7', factory_order_no: '260920-001', factory_ship_actual: '2026-09-21' })], main: [['Q7', '日富一日', '成交', 1000, 0, '']],
    os: [osRow({ quote_no: 'Q7', status: 'production', ship_date_actual: '2026-09-21' })] });
  const r = c.handleFactorySync_({});
  const rows = c.__sheets.order_shipments.rows;
  const byId = id => rows.find(x => x[0] === id);
  check('G6a 廠務刪掉第 2 次出貨 → 那筆 [FX:…:2] 拿掉', !byId('S2') && r.shipRemoved === 2);
  check('G6b 接管過驗收單的 [FX:…:3] → 只去掉 FX 段、驗收單那段留著', byId('S3') && /^\[VF:20260923-01:1\]/.test(byId('S3')[SHIP_H.indexOf('note')]));
  check('G6c 手動記的出貨列不動；第 1 次改了日期 → 跟著改', byId('S4') && byId('S1')[SHIP_H.indexOf('ship_date_actual')] === '2026-09-22');
  check('G7a 實際出貨日之前是同步填的 09-21、廠務改成 09-22 → 跟著改、回 osChanged', c.__osUpd.some(x => x[0] === 'Q7' && x[1].ship_date_actual === '2026-09-22') && r.osChanged === 1);
  const c2 = syncCtx({ orders: [o], shipments: [{ orderNo: '260920-001', seq: 1, date: '2026-09-22', product: 'C', qty: 10 }],
    links: [linkRow({ quote_no: 'Q7', factory_order_no: '260920-001', factory_ship_actual: '2026-09-21' })], main: [['Q7', '日富一日', '成交', 1000, 0, '']],
    os: [osRow({ quote_no: 'Q7', status: 'production', ship_date_actual: '2026-09-19' })] });
  c2.handleFactorySync_({});
  check('G7b Molly 自己改過的實際出貨日（09-19）不碰', !c2.__osUpd.some(x => x[0] === 'Q7' && x[1].ship_date_actual));
  // G13 保險：整包沒有任何出貨紀錄（廠務讀取失敗）→ 不清；這張單批數對不上 → 不清；填過金額／發票的列 → 不刪、改提示
  const shipsB = [shipRow({ id: 'T1', quote_no: 'Q7', seq: 1, ship_date_actual: '2026-09-21', note: '[FX:260920-001:1] · 廠務出貨 C×10' }),
    shipRow({ id: 'T2', quote_no: 'Q7', seq: 2, ship_date_actual: '2026-09-22', note: '[FX:260920-001:2] Lot 3 · 廠務出貨 C×3', invoice_no: 'AB12345678' })];
  const cz = syncCtx({ orders: [Object.assign({}, o, { shipBatches: 2 })], shipments: [], ships: shipsB.map(x => x.slice()),
    links: [linkRow({ quote_no: 'Q7', factory_order_no: '260920-001' })], main: [['Q7', '日富一日', '成交', 1000, 0, '']], os: [osRow({ quote_no: 'Q7', status: 'production' })] });
  const rz = cz.handleFactorySync_({});
  check('G13a 廠務回來整包沒出貨紀錄（讀取失敗）→ 一筆都不刪', rz.ok && rz.shipRemoved === 0 && cz.__sheets.order_shipments.rows.length === 2);
  const cy = syncCtx({ orders: [Object.assign({}, o, { shipBatches: 2 }), { orderNo: '260920-009', client: 'Z', orderType: '代工訂單(全客製/換前標)', qsQuoteNo: 'Q8', status: '製作中', items: [], shipBatches: 1 }],
    shipments: [{ orderNo: '260920-009', seq: 1, date: '2026-09-20', product: 'Z', qty: 1 }], ships: shipsB.map(x => x.slice()),
    links: [linkRow({ quote_no: 'Q7', factory_order_no: '260920-001' }), linkRow({ quote_no: 'Q8', factory_order_no: '260920-009' })], main: [['Q7', '日富一日', '成交', 1000, 0, ''], ['Q8', 'Z', '成交', 1, 0, '']], os: [osRow({ quote_no: 'Q7', status: 'production' })] });
  const ry = cy.handleFactorySync_({});
  check('G13b 這張單廠務說有 2 批、出貨紀錄卻一批都沒回 → 這張先不清', ry.ok && cy.__sheets.order_shipments.rows.filter(x => x[1] === 'Q7').length === 2);
  const cx = syncCtx({ orders: [Object.assign({}, o, { shipBatches: 1 })], shipments: [{ orderNo: '260920-001', seq: 1, date: '2026-09-21', product: 'C', qty: 10 }], ships: shipsB.map(x => x.slice()),
    links: [linkRow({ quote_no: 'Q7', factory_order_no: '260920-001' })], main: [['Q7', '日富一日', '成交', 1000, 0, '']], os: [osRow({ quote_no: 'Q7', status: 'production' })] });
  cx.handleFactorySync_({});
  const t2 = cx.__sheets.order_shipments.rows.find(x => x[0] === 'T2');
  check('G13c 廠務刪了第 2 趟、但那筆 Molly 填過發票號碼 → 不刪，拿掉 [FX:] 標記、開頭註明廠務刪了', t2 && /^⚠ 廠務已刪除這趟出貨（原第 2 次）：Lot 3/.test(t2[SHIP_H.indexOf('note')]) && t2[SHIP_H.indexOf('invoice_no')] === 'AB12345678');
  // G8 同步中旗標
  c2.__cache['FX_SYNC_BUSY'] = '1';
  const rb = c2.handleFactorySync_({});
  check('G8 另一個同步進行中 → busy、不打廠務', !rb.ok && rb.busy === true && calls(c2, 'extGetOrders').length === 1);
  delete c2.__cache['FX_SYNC_BUSY'];
  const rc = c2.handleFactorySync_({});
  check('G8b 跑完旗標會放掉（下一次照跑）', rc.ok && !c2.__cache['FX_SYNC_BUSY']);
  // G9 連結列沒變就不寫
  const w0 = c2.__sheets.factory_links.writes, up0 = linkOf(c2, 'Q7').updated_at;
  c2.__now = '2026-09-23T21:00:00+08:00';
  const rd = c2.handleFactorySync_({});
  check('G9 什麼都沒變 → factory_links 不寫、updated_at 不動、linkChanged 0；lastSync 另存', rd.ok && rd.linkChanged === 0 && c2.__sheets.factory_links.writes === w0 && linkOf(c2, 'Q7').updated_at === up0 && c2.__props.FACTORY_LAST_SYNC === '2026-09-23T21:00:00+08:00');
  check('G9b getFactoryLinks 回 lastSync', c2.handleGetFactoryLinks_({}).lastSync === '2026-09-23T21:00:00+08:00');
}
{
  // G10 匯入：V2 去掉查牌價、客戶付的運費帶進來、客戶對照記下來；寄售單不匯
  const orders = [
    { orderNo: '260923-004', client: 'OEM-好野吧', orderType: '自有酒款出貨訂單(有金流)', qsQuoteNo: '', status: '待製作', total: 0, createdAt: '2026/9/23 上午10:00:00', orderCreator: 'Kevin',
      items: [{ product: '蜜香紅茶荔枝琴酒V2', volume: '100ml', qty: 10 }], shipFee: 150, shipFeePayer: '客戶付運費', deliveryDate: '2026-09-30' },
    { orderNo: '260923-005', client: '經銷商－島羽', orderType: '自有酒款出貨訂單(有金流)', qsQuoteNo: '', status: '待製作', total: 0, depositStatus: '寄售', createdAt: '2026/9/23 上午11:00:00', orderCreator: '經銷商叫貨放行(Kevin)', items: [{ product: 'A', qty: 5 }] },
  ];
  const c = syncCtx({ orders, customers: [['CU-9', '好野吧', 'Amy', '0922', '', '']], products: [['蜜香紅茶荔枝琴酒|100ml', '蜜香紅茶荔枝琴酒', '', '100ml', 200, '', '', 'Y', '']] });
  const r = c.handleFactorySync_({});
  const q = c.__created[0] || {};
  const bottle = (q.items || []).find(x => x.itemType === 'bottle') || {};
  const ship = (q.items || []).find(x => x.itemType === 'extra') || {};
  check('G10a 只匯一張（寄售單不匯）', r.ok && c.__created.length === 1 && r.imported.length === 1 && r.imported[0].factory_order_no === '260923-004');
  check('G10b 酒名去 V2、查到牌價 200', bottle.name === '蜜香紅茶荔枝琴酒' && bottle.unitPrice === 200 && bottle.subtotal === 2000);
  check('G10c 客戶付的運費 150 → 報價單加一列運費、總計含運費', ship.name === '運費' && ship.subtotal === 150 && q.extrasTotal === 150 && q.grandTotal === 2150);
  const mp = (c.__sheets.factory_map || { rows: [] }).rows;
  check('G10d 客戶名不同（OEM-好野吧↔好野吧）→ 自動記進客戶對照', mp.some(x => x[0] === 'client' && x[1] === '好野吧' && x[2] === 'OEM-好野吧'));
  check('G10e 先記連結再回填 AI', linkOf(c, 'QI-1') && linkOf(c, 'QI-1').factory_order_no === '260923-004' && calls(c, 'extMarkImported').some(x => x.orderNo === '260923-004' && x.quoteNo === 'QI-1'));
  const cf = syncCtx({ orders: [orders[0]], markFail: true, customers: [['CU-9', '好野吧', '', '', '', '']] });
  cf.handleFactorySync_({});
  const n1 = cf.__created.length;
  cf.handleFactorySync_({});
  check('G10f 回填 AI 失敗 → 下一輪認得連結表、不會重複匯入', n1 === 1 && cf.__created.length === 1);
}

// ── H 付款條件 ─────────────────────────────────────
{
  const c = mkCtx({ factory: () => ({ ok: true }) });
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check('H1 「無訂金；驗收後 7 天內付尾款 100%」→ 訂金 0／尾款全額', eq(c.fxParsePay_('無訂金；驗收後 7 天內付尾款 100%', 10000), { dep: 0, bal: 10000 }));
  check('H2 「排產前15日訂金50%/驗收後15日尾款50%」→ 各半', eq(c.fxParsePay_('排產前15日訂金50%/驗收後15日尾款50%', 10001), { dep: 5001, bal: 5000 }));
  check('H3 「訂金 30%，尾款 60%」加起來不是 100 → 讀不出來', c.fxParsePay_('訂金 30%，尾款 60%', 10000) === null);
  check('H4 標準條款照舊', eq(c.fxParsePay_('於簽約後支付訂金新台幣 $5,000 元整<br>出貨前支付尾款新台幣 $5,000 元整', 10000), { dep: 5000, bal: 5000 }));
  check('H5 沒寫比例的自訂字 → 讀不出來', c.fxParsePay_('月結 30 天', 10000) === null);
  const os = (x) => Object.assign({ grand_total: 10000, deposit_amt: 5000, final_amt: 5000, deposit_date: '', final_date: '' }, x);
  let d = c.fxOrderStatusDiff_(os({ final_date: '2026-09-20' }), { gt: 12000, pay: { dep: 6000, bal: 6000 } });
  check('H6 尾款已收 → 只改總額、訂金尾款不動', d.fields.grand_total === 12000 && d.fields.deposit_amt === undefined && d.fields.final_amt === undefined);
  d = c.fxOrderStatusDiff_(os({ deposit_date: '2026-09-10' }), { gt: 12000, pay: { dep: 6000, bal: 6000 } });
  check('H7 訂金已收 → 訂金凍結 5000、差額放尾款 7000', d.fields.deposit_amt === undefined && d.fields.final_amt === 7000);
  d = c.fxOrderStatusDiff_(os({}), { gt: 12000, pay: null });
  check('H8 付款條件讀不出來、總額變了 → 訂金不動、尾款＝12000−5000', d.fields.grand_total === 12000 && d.fields.deposit_amt === undefined && d.fields.final_amt === 7000);
  d = c.fxOrderStatusDiff_(os({}), { gt: 10000, pay: null });
  check('H9 總額沒變、讀不出來 → 什麼都不動', d.changed.length === 0);
  d = c.fxOrderStatusDiff_(os({}), { gt: 12000, pay: { dep: 6000, bal: 6000 } });
  check('H10 都沒收、讀得出來 → 照條款', d.fields.deposit_amt === 6000 && d.fields.final_amt === 6000);
  d = c.fxOrderStatusDiff_(os({ deposit_date: '2026-09-10', final_amt: 4800 }), { gt: 10000, pay: { dep: 5000, bal: 5000 } });
  check('H11 訂金已收、總額沒變、尾款手動議價成 4800 → 不動', d.changed.length === 0);
}

// ── I 寄售 ─────────────────────────────────────────
{
  const CUST = [[4, '', '島羽Wing Islands', 0.7, 30, '', '', '', 'Y', '', ''], [7, '', '日光貳叁', 0.7, 25, '', '', '', 'Y', '', '']];
  const PROD = [['泰奶烏龍蘭姆酒|100ml', '泰奶烏龍蘭姆酒', '', '100ml', 200, '', '', 'Y', ''], ['茉莉香片脆梅琴酒|100ml', '茉莉香片脆梅琴酒', '', '100ml', 200, '', '', 'Y', '']];
  const DEALERS = [{ key: '經銷商－島羽', label: '島羽 Wing Islands' }, { key: '經銷商－日光貳參', label: '日光貳參' }];
  const ROWS = [
    { id: 'X1', date: '2026-09-24', dealer: '經銷商－島羽', product: '泰奶烏龍蘭姆酒', volume: '100ml', type: '進貨', qty: 6, createdAt: '2026-09-24 10:00:00' },
    { id: 'X2', date: '2026-09-20', dealer: '經銷商－島羽', product: '茉莉香片脆梅琴酒', volume: '100ml', type: '進貨', qty: 4, createdAt: '2026-09-22 10:00:00' },
    { id: 'X3', date: '2026-09-22', dealer: '經銷商－島羽', product: '泰奶烏龍蘭姆酒V2', volume: '100ml', type: '售出', qty: -2, price: 0, createdAt: '2026-09-22 20:00:00' },
    { id: 'X4', date: '2026-09-22', dealer: '經銷商－日光貳參', product: '泰奶烏龍蘭姆酒', volume: '100ml', type: '進貨', qty: 3, createdAt: '2026-09-22 20:00:00' },
    { id: 'X5', date: '2026-09-21', dealer: '經銷商－島羽', product: '泰奶烏龍蘭姆酒', volume: '100ml', type: '售出', qty: -1, price: 140, createdAt: '2026-09-21 20:00:00' },
  ];
  const LEDGER = [
    ['CM-20260924-0001', '2026-09-24', 4, '泰奶烏龍蘭姆酒|100ml', 'in', 6, '', 'Molly 上線後自己登的', '2026-09-24T09:00:00+08:00'],
    ['CM-20260919-0001', '2026-09-19', 4, '茉莉香片脆梅琴酒|100ml', 'in', 4, '', '手動 A', '2026-09-19T09:00:00+08:00'],
    ['CM-20260921-0001', '2026-09-21', 4, '茉莉香片脆梅琴酒|100ml', 'in', 4, '', '手動 B', '2026-09-21T09:00:00+08:00'],
    ['CM-20260920-0001', '2026-09-20', 4, '泰奶烏龍蘭姆酒|100ml', 'out', 1, 140, '手動售出（前一天）', '2026-09-20T09:00:00+08:00'],
  ];
  const factory = b => (b.action === 'extConsignLedger' ? { ok: true, dealers: DEALERS, rows: ROWS.filter(r => r.createdAt >= String(b.since || '')) } : { ok: false });
  const c = mkCtx({ factory, unitPrice: (cid, sku) => (String(cid) === '4' ? { unitPrice: 140 } : null),
    seed: { consign_customers: CUST, ownbrand_products: PROD, consign_ledger: LEDGER, factory_map: [['consign_client', '7', '-', 'Molly：不連結', '']] } });
  const r = c.handleFactoryConsignSync_({});
  const ins = {}; (r.inserted || []).forEach(x => { ins[x.fx] = x; });
  check('I1 上線後手動登的列（9/24）不拿來抵 → 廠務 X1 照樣新增', r.ok && ins.X1 && !r.linked.some(x => x.fx === 'X1'));
  check('I2 兩筆手動列一樣近（9/19、9/21 各差 1 天）→ 對上第一筆（不另外新增）、列進 possibleDup 請確認', !ins.X2 && r.linked.some(x => x.fx === 'X2' && x.movement_id === 'CM-20260919-0001') && r.possibleDup.some(x => /^X2/.test(x)));
  const led = c.__sheets.consign_ledger.rows;
  const rowOf = fx => led.find(x => String(x[7]).indexOf('[FXC:' + fx) === 0);
  check('I3 售出單價 0 → 改用報價系統算的 140、列進 priceFallback', ins.X3 && rowOf('X3')[6] === 140 && r.priceFallback.some(x => /^X3/.test(x)));
  check('I4 售出不同天（手動 9/20、廠務 9/21）→ 不對上', ins.X5 && !r.linked.some(x => x.fx === 'X5'));
  check('I5 Molly 選「不連結」的日光貳叁 → 不自動配、異動不寫、不列進沒對到', !r.dealerMap['經銷商－日光貳參'] && !ins.X4 && !(r.unmappedDealers || {})['經銷商－日光貳參'] && r.ignoredDealers['經銷商－日光貳參'] === 1);
  const last = JSON.parse(c.__props.FACTORY_CONSIGN_LAST_RESULT || '{}');
  check('I6 同步摘要存起來（寄售頁顯示用）', last.inserted === r.inserted.length && Array.isArray(last.possibleDup) && Array.isArray(last.priceFallback));
  check('I7 手動對照指到重複的客戶代碼 → 不用、講明重複', (() => {
    const c2 = mkCtx({ factory, seed: { consign_customers: [[4, '', '島羽Wing Islands', 0.7, 30, '', '', '', 'Y', '', ''], [4, '', '誠品生活', 0.65, 5, '', '', '', 'Y', '', '']], ownbrand_products: PROD, consign_ledger: [], factory_map: [['consign_client', '4', '經銷商－島羽', '', '']] } });
    const r2 = c2.handleFactoryConsignSync_({});
    return r2.ok && !r2.dealerMap['經銷商－島羽'] && /重複/.test(String(r2.ambiguous['經銷商－島羽'] || ''));
  })());
  // I9 上線前手動登了兩筆一模一樣的售出（同一天、各 1 瓶），廠務也有兩筆 → 一對一對上，不會變四筆
  {
    const L2 = [['CM-20260920-0005', '2026-09-20', 4, '茉莉香片脆梅琴酒|100ml', 'out', 1, 140, '手動 1', '2026-09-20T20:00:00+08:00'], ['CM-20260920-0006', '2026-09-20', 4, '茉莉香片脆梅琴酒|100ml', 'out', 1, 140, '手動 2', '2026-09-20T20:05:00+08:00']];
    const R2 = [{ id: 'Y1', date: '2026-09-20', dealer: '經銷商－島羽', product: '茉莉香片脆梅琴酒', volume: '100ml', type: '售出', qty: -1, price: 140, createdAt: '2026-09-20 21:00:00' },
      { id: 'Y2', date: '2026-09-20', dealer: '經銷商－島羽', product: '茉莉香片脆梅琴酒', volume: '100ml', type: '售出', qty: -1, price: 140, createdAt: '2026-09-20 21:01:00' }];
    const c9 = mkCtx({ factory: b => (b.action === 'extConsignLedger' ? { ok: true, dealers: DEALERS, rows: R2 } : { ok: false }), seed: { consign_customers: CUST, ownbrand_products: PROD, consign_ledger: L2 } });
    const r9 = c9.handleFactoryConsignSync_({});
    check('I9 兩筆一模一樣的手動售出 × 廠務兩筆 → 各對一筆、0 新增、不列可能重複', r9.ok && r9.inserted.length === 0 && r9.linked.length === 2 && new Set(r9.linked.map(x => x.movement_id)).size === 2 && r9.possibleDup.length === 0);
  }
  c.__cache['FXC_SYNC_BUSY'] = '1';
  const rb = c.handleFactoryConsignSync_({});
  check('I8 寄售同步進行中 → busy', !rb.ok && rb.busy === true);
}

// ── L 連結列比對 ─────────────────────────────────────
{
  const c = syncCtx({ links: [linkRow({ quote_no: 'Q1', factory_order_no: '260901-001', factory_lot: 18, updated_at: 'U0' })] });
  const r1 = c.fxLinkUpsert_('Q1', { factory_lot: '018', factory_order_no: '260901-001', last_sync: 'X' });
  const up1 = linkOf(c, 'Q1').updated_at;
  const r2 = c.fxLinkUpsert_('Q1', { factory_lot: '19' });
  check('L1 Lot「018」寫進去變 18 → 下一輪比對算沒變（不會每輪重寫）；真的改成 19 才寫', r1.changed === false && up1 === 'U0' && r2.changed === true && linkOf(c, 'Q1').factory_lot === '19');
}

// ── J 其他 ─────────────────────────────────────────
{
  const orders = [
    { orderNo: '260901-001', client: '酒肉朋友', orderType: '自有酒款出貨訂單(有金流)', qsQuoteNo: '', status: '待製作', total: 5000, items: [{ product: 'A', qty: 1 }], orderCreator: 'Kevin' },
    { orderNo: '260901-002', client: '經銷商－島羽', orderType: '自有酒款出貨訂單(有金流)', qsQuoteNo: '', status: '待製作', total: 0, depositStatus: '寄售', items: [{ product: 'A', qty: 1 }], orderCreator: '經銷商叫貨放行(Kevin)' },
    { orderNo: '260901-003', client: '日富一日', orderType: '代工訂單(全客製/換前標)', qsQuoteNo: '', status: '待製作', total: 5000, items: [{ product: 'A', qty: 1 }], orderCreator: 'Molly(20260901-01)' },
  ];
  const c = syncCtx({ orders });
  const u = c.handleFactoryUnlinkedOrders_({});
  check('J1 未連結清單排除寄售單／推過去的單', u.ok && u.orders.length === 1 && u.orders[0].orderNo === '260901-001');
  const before = calls(c, 'extGetOrders').length;
  const lk = c.handleFactoryLinkExisting_({ quote_no: '20260901-05', factory_order_no: '260901-001' });
  check('J2 手動連結 → 補 AI、建連結，不在裡面跑整個同步', lk.ok && calls(c, 'extGetOrders').length === before && linkOf(c, '20260901-05').factory_order_no === '260901-001' && linkOf(c, '20260901-05').source === 'link');
  check('J3 runFactorySync 先重設欄位對應再同步', (() => {
    let order = [];
    c.ssCacheReset_ = () => order.push('reset'); c.resolveColMaps_ = () => order.push('cols');
    vm.runInContext('handleFactorySync_ = (function(orig){ return function(p){ ssCacheReset_ && 0; __order.push("sync"); return orig(p); }; })(handleFactorySync_);', Object.assign(c, { __order: order }));
    c.runFactorySync();
    return order.join(',').indexOf('reset,cols,sync') === 0;
  })());
}

let fail = 0;
results.forEach(([s, n]) => { if (s === 'FAIL') fail++; console.log(s, n); });
console.log('\n' + (results.length - fail) + '/' + results.length + ' PASS');
process.exit(fail ? 1 : 0);
