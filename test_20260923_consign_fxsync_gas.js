/* 2026-09-23 寄售×廠務同步（GAS 純邏輯，node vm ＋ stub；不用瀏覽器）
   驗 gas/v5_factory.gs 檔尾「寄售 × 廠務」那一節：
     1) 經銷商→客戶自動配對：日光貳參↔日光貳叁（參/叁）、downstair↔downstairs（前綴）、島羽 Wing Islands↔島羽Wing Islands、
        誠品生活／桃園青埔 精確；有趣市集沒有對應廠務不會亂配；配到的寫回 factory_map（kind consign_client）
     2) 客戶代碼重複（誠品生活跟島羽都是 4）→ 不自動配、回 ambiguous 說明
     3) 酒款：系統名去 V2 → sku_id；找不到的酒進 unmappedProducts、不寫入
     4) 類型／數量：進貨→in 正數、售出→out 正數＋成交單價、進貨取消→adjust 負數、盤點修正→adjust 正負照舊、退貨→return
     5) 冪等：note 帶 [FXC:id] 的不再寫；同一批跑兩次第二次 0 筆
     6) 過渡期自動對上舊手動列：同客戶同酒同型同量、7 天內、沒標記 → 補標記不新增；超過 7 天→新增
     7) 新列 movement_id 接續當日序號；created_at＝廠務建立時間轉 +08:00 格式；note 開頭是標記
     8) 沒對到經銷商的列 → unmappedDealers 計數、不寫
     9) handleGetFactoryConsignDealers_ 只要經銷商設定（since 9999）、回目前對照
    10) runFactorySync 會接著跑寄售同步（handleFactorySync_ 炸掉也照跑）
*/
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(__dirname + '/gas/v5_factory.gs', 'utf8');
const results = []; const check = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);

function mkCtx(opts) {
  const props = { FACTORY_API_URL: 'https://script.google.com/macros/s/x/exec', FACTORY_KEY: 'k'.repeat(24), FACTORY_CONSIGN_SINCE: '2026-09-16 00:00:00' };
  const sheets = {};   // name -> { headers, rows:[[...]] }
  const sheetObj = (name, headers) => {
    if (!sheets[name]) sheets[name] = { headers, rows: (opts.seed && opts.seed[name] ? opts.seed[name].map(r => r.slice()) : []) };
    const S = sheets[name];
    return {
      getLastRow: () => S.rows.length + 1,
      getRange: (r, c, nr, nc) => ({
        setValue: (v) => { S.rows[r - 2][c - 1] = v; },
        setValues: (vals) => { for (let i = 0; i < vals.length; i++) S.rows[r - 2 + i] = vals[i].slice(); },
        getValues: () => S.rows.slice(r - 2, r - 2 + (nr || 1)).map(row => row.slice(c - 1, c - 1 + (nc || row.length))),
      }),
      appendRow: (row) => { S.rows.push(row.slice()); },
      deleteRow: (r) => { S.rows.splice(r - 2, 1); },
    };
  };
  const fxResp = opts.factory;
  const ctx = {
    console, JSON, Math, Date, String, Number, Object, Array, isNaN, parseInt, parseFloat, RegExp,
    Logger: { log: () => {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] == null ? null : props[k], setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    UrlFetchApp: { fetch: (url, o) => { const body = JSON.parse(o.payload); ctx.__calls.push(body); const r = fxResp(body); return { getContentText: () => JSON.stringify(r), getResponseCode: () => 200 }; } },
    Utilities: { formatDate: (d, tz, fmt) => { const p = n => String(n).padStart(2, '0'); const t = new Date(d.getTime() + 8 * 3600e3); const s = t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate()); return fmt.indexOf('HH') >= 0 ? s + (fmt.indexOf("'T'") >= 0 ? 'T' : ' ') + p(t.getUTCHours()) + ':' + p(t.getUTCMinutes()) + (fmt.indexOf('ss') >= 0 ? ':' + p(t.getUTCSeconds()) : '') + (fmt.indexOf('+08:00') >= 0 ? '+08:00' : '') : s; } },
    SHEET_CONSIGN_CUSTOMERS: 'consign_customers', CONSIGN_CUSTOMERS_HEADERS: ['customer_id', 'company_id', 'name', 'default_discount', 'billing_day', 'contact', 'phone', 'ship_address', 'active', 'note', 'deposit_required'],
    SHEET_CONSIGN_LEDGER: 'consign_ledger', CONSIGN_LEDGER_HEADERS: ['movement_id', 'date', 'customer_id', 'sku_id', 'type', 'qty', 'unit_price', 'note', 'created_at'],
    SHEET_OWNBRAND_PRODUCTS: 'ownbrand_products', OWNBRAND_PRODUCTS_HEADERS: ['sku_id', 'name', 'abv', 'volume', 'list_price', 'cost', 'bottle_type', 'active', 'synced_at'],
    SHEET_ORDER_STATUS: 'order_status', ORDER_STATUS_HEADERS: ['quote_no'], SHEET_ORDER_SHIPMENTS: 'order_shipments', ORDER_SHIP_HEADERS: ['id'], SHEET_CUSTOMERS: 'customers', CUSTOMERS_HEADERS: ['name'],
    v2Sheet_: (name, headers) => sheetObj(name, headers),
    v2ReadAll_: (name, headers) => { sheetObj(name, headers); return sheets[name].rows.map(row => { const o = {}; headers.forEach((h, i) => { o[h] = row[i] == null ? '' : row[i]; }); return o; }); },
    v2Append_: (name, headers, rows) => { sheetObj(name, headers); rows.forEach(r => sheets[name].rows.push(r.slice())); },
    tpeNow_: () => '2026-09-23T12:00:00+08:00',
    logChange_: (a, r, p) => { ctx.__log.push([a, r, p]); },
    handleUpdateOrderStatus_: () => ({ ok: true }),
    __calls: [], __log: [], __sheets: sheets,
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx;
}
const CUSTOMERS = [
  [1, '', '日光貳叁', 0.7, 25, '', '', '', 'Y', '', ''],
  [2, '', 'downstairs', 0.75, 5, '', '', '', 'Y', '', ''],
  [3, '', '有趣市集', 0.75, 30, '', '', '', 'Y', '', ''],
  [4, '', '島羽Wing Islands', 0.7, 30, '', '', '', 'Y', '', ''],
  [6, '', '誠品生活', 0.65, '', '', '', '', 'Y', '', ''],
  [5, '', '桃園青埔環球購物中心', 0.67, '', '', '', '', 'Y', '', ''],
];
// 線上目前的狀況：誠品生活的代碼跟島羽都是 4（Molly 要改成 6）→ 兩家都不能自動配、要講清楚原因
const CUSTOMERS_DUP = CUSTOMERS.map(r => r.slice()); CUSTOMERS_DUP[4][0] = 4;
const PRODUCTS = ['蜜香紅茶荔枝琴酒', '茉莉香片脆梅琴酒', '泰奶烏龍蘭姆酒', '包種茶青梅甜酒'].map(n => [n + '|100ml', n, '', '100ml', 200, '', '', 'Y', '']);
const DEALERS = [
  { key: '經銷商－日光貳參', label: '日光貳參', enabled: false, discount: 0.7, closeDay: 25 },
  { key: '經銷商－島羽', label: '島羽 Wing Islands', enabled: true, discount: 0.7, closeDay: 30 },
  { key: '經銷商－downstair', label: 'downstair', enabled: true, discount: 0.7, closeDay: 30 },
  { key: '經銷商－誠品生活', label: '誠品生活', enabled: true, discount: 0.65, closeDay: 5 },
  { key: '經銷商－桃園青埔環球購物中心', label: '桃園青埔環球購物中心', enabled: true, discount: '', closeDay: 5 },
  { key: '經銷商－神秘店', label: '神秘店', enabled: true, discount: 0.7, closeDay: 5 },
];
const ROWS = [
  { id: 'CI-A1', date: '2026-09-18', dealer: '經銷商－島羽', product: '蜜香紅茶荔枝琴酒V2', volume: '100ml', type: '進貨', qty: 10, price: '', orderNo: '260917-001', seq: '1', operator: 'Kevin', createdAt: '2026-09-18 10:00:00', note: '訂單出貨 第 1 次' },
  { id: 'CI-A2', date: '2026-09-19', dealer: '經銷商－島羽', product: '蜜香紅茶荔枝琴酒V2', volume: '100ml', type: '售出', qty: -2, price: 140, orderNo: '', seq: '', operator: '島羽', createdAt: '2026-09-19 20:00:00', note: '' },
  { id: 'CI-A3', date: '2026-09-19', dealer: '經銷商－島羽', product: '蜜香紅茶荔枝琴酒V2', volume: '100ml', type: '進貨取消', qty: -10, price: '', orderNo: '260917-001', seq: '1', operator: 'Kevin', createdAt: '2026-09-19 21:00:00', note: '刪除第 1 次出貨紀錄' },
  { id: 'CI-A4', date: '2026-09-20', dealer: '經銷商－島羽', product: '茉莉香片脆梅琴酒V2', volume: '100ml', type: '盤點修正', qty: -1, price: '', orderNo: '', seq: '', operator: 'Kevin', createdAt: '2026-09-20 09:00:00', note: '破一瓶' },
  { id: 'CI-A5', date: '2026-09-20', dealer: '經銷商－島羽', product: '茉莉香片脆梅琴酒V2', volume: '100ml', type: '退貨', qty: -3, price: '', orderNo: '', seq: '', operator: '島羽', createdAt: '2026-09-20 10:00:00', note: '' },
  { id: 'CI-A6', date: '2026-09-20', dealer: '經銷商－島羽', product: '不存在的酒', volume: '100ml', type: '進貨', qty: 5, price: '', orderNo: '260917-002', seq: '1', operator: 'Kevin', createdAt: '2026-09-20 11:00:00', note: '' },
  { id: 'CI-B1', date: '2026-09-21', dealer: '經銷商－downstair', product: '泰奶烏龍蘭姆酒', volume: '100ml', type: '進貨', qty: 25, price: '', orderNo: '260920-001', seq: '1', operator: 'Kevin', createdAt: '2026-09-21 10:00:00', note: '' },
  { id: 'CI-C1', date: '2026-09-21', dealer: '經銷商－神秘店', product: '泰奶烏龍蘭姆酒', volume: '100ml', type: '進貨', qty: 1, price: '', orderNo: '', seq: '', operator: 'Kevin', createdAt: '2026-09-21 10:00:00', note: '' },
  { id: 'CI-D1', date: '2026-09-22', dealer: '經銷商－誠品生活', product: '泰奶烏龍蘭姆酒', volume: '100ml', type: '進貨', qty: 12, price: '', orderNo: '', seq: '', operator: 'Kevin', createdAt: '2026-09-22 10:00:00', note: '' },
  // 特規單：Molly 9/11 已手動登過（泰奶 5＋茉莉 5，type in），廠務 9/22 補登 → 應該只補標記
  { id: 'CI-E1', date: '2026-09-11', dealer: '經銷商－島羽', product: '泰奶烏龍蘭姆酒', volume: '100ml', type: '進貨', qty: 5, price: '', orderNo: '260911-009', seq: '1', operator: 'Molly', createdAt: '2026-09-22 15:00:00', note: '特規單補登' },
  // 同酒同量但日期差 30 天的舊列 → 不能對上、要新增
  { id: 'CI-E2', date: '2026-09-22', dealer: '經銷商－島羽', product: '包種茶青梅甜酒V2', volume: '100ml', type: '進貨', qty: 10, price: '', orderNo: '260922-001', seq: '1', operator: 'Kevin', createdAt: '2026-09-22 16:00:00', note: '' },
];
const LEDGER_SEED = [
  ['CM-20260911-0007', '2026-09-11', 4, '泰奶烏龍蘭姆酒|100ml', 'in', 5, '', '本訂單為特規單,月結以500ml單價計算', '2026-09-11T15:32:49+08:00'],
  ['CM-20260911-0008', '2026-09-11', 4, '茉莉香片脆梅琴酒|100ml', 'in', 5, '', '本訂單為特規單,月結以500ml單價計算', '2026-09-11T15:32:49+08:00'],
  ['CM-20260823-0001', '2026-08-23', 4, '包種茶青梅甜酒|100ml', 'in', 10, '', '', '2026-08-23T11:36:19+08:00'],
  ['CM-20260922-0001', '2026-09-22', 2, '蜜香紅茶荔枝琴酒|100ml', 'out', 1, 140, '[FXC:CI-OLD] 廠務／downstair', '2026-09-22T09:00:00+08:00'],
];
function factory(body) {
  if (body.key !== 'k'.repeat(24)) return { ok: false, error: 'key' };
  if (body.action === 'extConsignLedger') { const since = String(body.since || ''); return { ok: true, dealers: DEALERS, rows: ROWS.filter(r => r.createdAt >= since), prices: [], statements: [] }; }
  if (body.action === 'extGetOrders') return { ok: true, orders: [], shipments: [] };
  return { ok: false, error: 'unknown ' + body.action };
}

(function main() {
  const ctx = mkCtx({ factory, seed: { consign_customers: CUSTOMERS, ownbrand_products: PRODUCTS, consign_ledger: LEDGER_SEED } });
  const r = ctx.handleFactoryConsignSync_({});
  check('0 同步回 ok', r && r.ok === true);
  const dm = r.dealerMap || {};
  check('1a 日光貳參↔日光貳叁（參/叁同視）', dm['經銷商－日光貳參'] === '1');
  check('1b downstair↔downstairs（前綴）', dm['經銷商－downstair'] === '2');
  check('1c 島羽 Wing Islands↔島羽Wing Islands', dm['經銷商－島羽'] === '4');
  check('1d 桃園青埔 精確配到 5', dm['經銷商－桃園青埔環球購物中心'] === '5');
  check('1e 神秘店沒有客戶 → 不配', !dm['經銷商－神秘店']);
  const mapRows = ctx.__sheets.factory_map ? ctx.__sheets.factory_map.rows : [];
  check('1f 配到的寫回 factory_map（kind consign_client，5 筆）', mapRows.filter(x => x[0] === 'consign_client').length === 5 && mapRows.some(x => x[0] === 'consign_client' && x[1] === '4' && x[2] === '經銷商－島羽'));
  check('1g 誠品生活 精確配到 6', dm['經銷商－誠品生活'] === '6' && r.inserted.some(x => x.fx === 'CI-D1' && x.customer_id === '6'));
  check('8 神秘店的列進 unmappedDealers、沒寫入', r.unmappedDealers['經銷商－神秘店'] === 1 && !r.inserted.some(x => x.fx === 'CI-C1'));
  { // 2) 代碼重複的情境（線上現況）
    const cd = mkCtx({ factory, seed: { consign_customers: CUSTOMERS_DUP, ownbrand_products: PRODUCTS, consign_ledger: [] } });
    const rd = cd.handleFactoryConsignSync_({});
    check('2a 代碼重複 → 島羽／誠品都不自動配、ambiguous 講明「重複」', rd.ok && !rd.dealerMap['經銷商－島羽'] && !rd.dealerMap['經銷商－誠品生活'] && /重複/.test(String(rd.ambiguous['經銷商－島羽'] || '')) && /重複/.test(String(rd.ambiguous['經銷商－誠品生活'] || '')));
    check('2b 其他家照樣配到、島羽的列先不寫（進 unmappedDealers）', rd.dealerMap['經銷商－downstair'] === '2' && rd.unmappedDealers['經銷商－島羽'] >= 5 && !rd.inserted.some(x => x.customer_id === '4'));
    check('2c factory_map 沒有寫進重複代碼那兩家', !(cd.__sheets.factory_map || { rows: [] }).rows.some(x => x[2] === '經銷商－島羽' || x[2] === '經銷商－誠品生活'));
  }
  check('3 不存在的酒 → unmappedProducts、沒寫入', r.unmappedProducts['不存在的酒|100ml'] === 1 && !r.inserted.some(x => x.fx === 'CI-A6'));
  const ins = {}; r.inserted.forEach(x => { ins[x.fx] = x; });
  check('4a 進貨→in 正數（V2 去掉、sku 對上）', ins['CI-A1'] && ins['CI-A1'].type === 'in' && ins['CI-A1'].qty === 10 && ins['CI-A1'].sku_id === '蜜香紅茶荔枝琴酒|100ml' && ins['CI-A1'].customer_id === '4');
  check('4b 售出→out 正數＋成交單價', ins['CI-A2'] && ins['CI-A2'].type === 'out' && ins['CI-A2'].qty === 2);
  const led = ctx.__sheets.consign_ledger.rows;
  const rowOf = fx => led.find(x => String(x[7]).indexOf('[FXC:' + fx) === 0);
  check('4b2 out 列 unit_price＝140', rowOf('CI-A2') && rowOf('CI-A2')[6] === 140);
  check('4c 進貨取消→adjust 負數', ins['CI-A3'] && ins['CI-A3'].type === 'adjust' && ins['CI-A3'].qty === -10);
  check('4d 盤點修正→adjust 照正負', ins['CI-A4'] && ins['CI-A4'].type === 'adjust' && ins['CI-A4'].qty === -1);
  check('4e 退貨→return 正數', ins['CI-A5'] && ins['CI-A5'].type === 'return' && ins['CI-A5'].qty === 3);
  check('4f downstair 進貨 25 → 客戶 2', ins['CI-B1'] && ins['CI-B1'].customer_id === '2' && ins['CI-B1'].qty === 25);
  check('6a 特規單廠務補登 → 對上舊手動列、只補標記不新增', !ins['CI-E1'] && r.linked.some(x => x.fx === 'CI-E1' && x.movement_id === 'CM-20260911-0007'));
  check('6b 舊列 note 開頭補了 [FXC:CI-E1|260911-009#1]、原備註留著', /^\[FXC:CI-E1\|260911-009#1\] 本訂單為特規單/.test(String(led[0][7])));
  check('6c 同酒同量但差 30 天 → 新增不對上', ins['CI-E2'] && ins['CI-E2'].qty === 10 && !r.linked.some(x => x.fx === 'CI-E2'));
  check('7a 新列 movement_id 接續當日序號（9/22 已有 0001 → 誠品 0002、島羽 0003，依廠務建立時間排）', !!ins['CI-D1'] && ins['CI-D1'].movement_id === 'CM-20260922-0002' && !!ins['CI-E2'] && ins['CI-E2'].movement_id === 'CM-20260922-0003');
  const a1 = rowOf('CI-A1');
  check('7b created_at＝廠務建立時間轉 +08:00', a1 && a1[8] === '2026-09-18T10:00:00+08:00');
  check('7c note＝標記＋廠務摘要', a1 && a1[7] === '[FXC:CI-A1|260917-001#1] 廠務 260917-001 第1次／Kevin：訂單出貨 第 1 次');
  check('7d 廠務 customer_id 寫成數字 4（跟既有列一致）', a1 && a1[2] === 4);
  check('5a 冪等：既有 [FXC:CI-OLD] 不動', led.filter(x => String(x[7]).indexOf('[FXC:CI-OLD]') === 0).length === 1);
  const n1 = led.length;
  const r2 = ctx.handleFactoryConsignSync_({});
  check('5b 同一批再跑一次 → 0 新增 0 補標記、列數不變', r2.ok && r2.inserted.length === 0 && r2.linked.length === 0 && led.length === n1);
  check('5c 只送 since 給廠務（起點 2026-09-16）', ctx.__calls.some(c => c.action === 'extConsignLedger' && c.since === '2026-09-16 00:00:00'));
  check('7e 有寫 change_log', ctx.__log.some(l => l[0] === 'factoryConsignSync'));
  const dl = ctx.handleGetFactoryConsignDealers_();
  check('9a getFactoryConsignDealers 回經銷商清單＋對照', dl.ok && dl.dealers.length === 6 && dl.map.length === 5 && dl.since === '2026-09-16 00:00:00');
  check('9b 只要設定 → since 9999', ctx.__calls.some(c => c.action === 'extConsignLedger' && c.since === '9999-12-31 00:00:00'));
  // 10) runFactorySync：handleFactorySync_ 炸掉也照跑寄售
  const ctx2 = mkCtx({ factory, seed: { consign_customers: CUSTOMERS, ownbrand_products: PRODUCTS, consign_ledger: [] } });
  ctx2.handleFactorySync_ = () => { throw new Error('boom'); };
  ctx2.runFactorySync();
  check('10 runFactorySync 接著跑寄售同步（訂單同步炸掉也照跑）', ctx2.__sheets.consign_ledger.rows.length >= 6);

  results.forEach(r => console.log(r[0], r[1]));
  const fails = results.filter(r => r[0] === 'FAIL').length;
  console.log(`\n${results.length - fails}/${results.length} PASS${fails ? ' — ' + fails + ' FAIL' : ''}`);
  process.exit(fails ? 1 : 0);
})();
