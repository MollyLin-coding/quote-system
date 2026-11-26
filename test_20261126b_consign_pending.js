/* 2026-11-26b 寄售頁「廠務待出貨」卡＋先開驗收單（前端，js/08_ownbrand.js／js/09_verify_form.js）離線測試
   Molly：「待出貨也能先開驗收單」——廠務還沒出貨的寄售鋪貨單（訂金狀態＝寄售、金額 0）不會變報價單，
   寄售帳也要等廠務按出貨才有進貨；出貨前就要能先印隨貨的驗收單，出貨進帳後那一批要對回同一張留底。
    A) csFxPendingVfNo：單號規則（CS-<客戶>-20<YYMMDD>9<流水3碼><第幾趟2碼>）、QR 驗證碼照常要、不會被「同一天 15 分鐘」舊留底配對認走
    B) csLedAssignVf 的 alt 優先配對（先開的那張優先）＋不帶 altOf 時行為照舊
    C) 進寄售頁背景抓 getFactoryConsignPending（帶 token、在讀取白名單、再進頁走快取）
    D) 卡片：沒選客戶不顯示；選誠品（對 3 家廠務經銷商）→ 列出待出貨單（預計出貨日／單號／門市／品項／瓶數／鈕）
       分趟出貨標「第 2 趟」、單號格式不認得的不給鈕
    E) 按「先開驗收單」→ 開寄售驗收單視窗（單號、客戶、日期、經手人、備註＝門市、品項）；產生 → 留底存進去、鈕變「查看驗收單」
    F) 已經先開過 → 「查看驗收單」→ 編輯模式（帶回留底那張、單號不變）
    G) 出貨進帳後：明細那一批用 alt 單號對回先開的留底 →「查看驗收單」、重開沿用同一個單號；驗收單備註帶門市
    H) 只對一家的客戶（島羽）門市欄「—」；沒有待出貨的客戶整張卡不顯示；讀取失敗只對已連結的客戶講；廠務沒設定不抓也不顯示
    I) 按「同步廠務」會重抓待出貨
*/
const { chromium } = require('/opt/node-tools/node_modules/playwright');

const PRODUCTS = [
  { sku_id: '蜜香紅茶荔枝琴酒|100ml', name: '蜜香紅茶荔枝琴酒', volume: '100ml', list_price: 250, active: 'Y' },
  { sku_id: '茉莉香片脆梅琴酒|100ml', name: '茉莉香片脆梅琴酒', volume: '100ml', list_price: 250, active: 'Y' },
];
const CUSTOMERS = [
  { customer_id: '6', name: '誠品生活', default_discount: 0.65, billing_day: 5, active: 'Y' },
  { customer_id: '4', name: '島羽Wing Islands', default_discount: 0.7, billing_day: 30, active: 'Y' },
  { customer_id: '2', name: 'downstairs', default_discount: 0.75, billing_day: 5, active: 'Y' },
  { customer_id: '7', name: '至美蒔光', default_discount: 0.75, billing_day: 5, active: 'Y' },
];
const DEALERS = [
  { key: '經銷商－誠品生活', label: '誠品生活', enabled: true, discount: 0.65, closeDay: 5 },
  { key: '經銷商－誠品生活_南西店', label: '誠品生活_南西店（B085）', enabled: true, discount: 0.65, closeDay: 5 },
  { key: '經銷商－誠品生活_平鎮物流中心', label: '誠品生活_平鎮物流中心（F100）', enabled: true, discount: 0.65, closeDay: 5 },
  { key: '經銷商－島羽', label: '島羽 Wing Islands', enabled: true, discount: 0.7, closeDay: 30 },
  { key: '經銷商－至美蒔光', label: '至美蒔光', enabled: true, discount: 0.75, closeDay: 5 },
];
const MAP = [
  { kind: 'consign_client', qs_name: '6', factory_name: '經銷商－誠品生活', note: '' },
  { kind: 'consign_client', qs_name: '6', factory_name: '經銷商－誠品生活_南西店', note: '' },
  { kind: 'consign_client', qs_name: '6', factory_name: '經銷商－誠品生活_平鎮物流中心', note: '' },
  { kind: 'consign_client', qs_name: '4', factory_name: '經銷商－島羽', note: '' },
  { kind: 'consign_client', qs_name: '7', factory_name: '經銷商－至美蒔光', note: '' },
];
// 日期一律相對「今天」算（測試哪一天跑都一樣）：D(1)＝明天
const D = n => { const t = new Date(); t.setDate(t.getDate() + n); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); };
const TODAY = D(0), D1 = D(1), D3 = D(3), D4 = D(4), D5 = D(5);
const IT = (name, qty, ordered, shipped) => ({ sku_id: name + '|100ml', name, vol: '100ml', qty, ordered: ordered == null ? qty : ordered, shipped: shipped || 0 });
const PENDING = [
  { orderNo: '261027-001', dealer: '經銷商－誠品生活', customer_id: '6', status: '待製作', deliveryDate: '2026-10-27', actualDeliveryDate: '', nextSeq: 1, lot: '', pm: '阿軒',
    items: [IT('蜜香紅茶荔枝琴酒', 30), IT('茉莉香片脆梅琴酒', 30)] },
  { orderNo: '261123-001', dealer: '經銷商－誠品生活_平鎮物流中心', customer_id: '6', status: '待製作', deliveryDate: D1, actualDeliveryDate: '', nextSeq: 1, lot: '', pm: 'Kevin',
    items: [IT('蜜香紅茶荔枝琴酒', 20), IT('茉莉香片脆梅琴酒', 10)] },
  { orderNo: '261120-002', dealer: '經銷商－誠品生活_南西店', customer_id: '6', status: '製作中', deliveryDate: D4, actualDeliveryDate: '2026-11-21', nextSeq: 2, lot: '', pm: 'Kevin',
    items: [IT('蜜香紅茶荔枝琴酒', 5, 15, 10)] },
  { orderNo: 'X-99', dealer: '經銷商－誠品生活_南西店', customer_id: '6', status: '待製作', deliveryDate: '', actualDeliveryDate: '', nextSeq: 1, lot: '', pm: '',
    items: [IT('茉莉香片脆梅琴酒', 3)] },
  { orderNo: '261125-003', dealer: '經銷商－島羽', customer_id: '4', status: '待製作', deliveryDate: D5, actualDeliveryDate: D3, nextSeq: 1, lot: '', pm: 'Kevin',
    items: [IT('蜜香紅茶荔枝琴酒', 12)] },
];
// 南西店 261120-002 第 1 趟（已出貨、已同步進帳）＋一批手動登的
const LEDGER0 = [
  { movement_id: 'CM-20261121-0001', date: '2026-11-21', customer_id: 6, sku_id: '蜜香紅茶荔枝琴酒|100ml', type: 'in', qty: 10, note: '[FXC:CI-B1|261120-002#1] 【南西店（B085）】廠務 261120-002 第1次／Kevin：訂單出貨 第 1 次', created_at: '2026-11-21T10:00:00+08:00' },
  { movement_id: 'CM-20261110-0001', date: '2026-11-10', customer_id: 6, sku_id: '茉莉香片脆梅琴酒|100ml', type: 'in', qty: 4, note: '手動登的', created_at: '2026-11-10T09:30:00+08:00' },
];
// 平鎮 261123-001 出貨後同步進來的兩款（同一趟＝一批）
const LEDGER_SHIPPED = [
  { movement_id: 'CM-20261127-0001', date: '2026-11-27', customer_id: 6, sku_id: '蜜香紅茶荔枝琴酒|100ml', type: 'in', qty: 20, note: '[FXC:CI-C1|261123-001#1] 【平鎮物流中心（F100）】廠務 261123-001 第1次／Kevin：訂單出貨 第 1 次', created_at: '2026-11-27T15:10:00+08:00' },
  { movement_id: 'CM-20261127-0002', date: '2026-11-27', customer_id: 6, sku_id: '茉莉香片脆梅琴酒|100ml', type: 'in', qty: 10, note: '[FXC:CI-C2|261123-001#1] 【平鎮物流中心（F100）】廠務 261123-001 第1次／Kevin：訂單出貨 第 1 次', created_at: '2026-11-27T15:10:02+08:00' },
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  const isNoise = t => /Failed to load resource|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|favicon/i.test(t);
  page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('CONSOLE: ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto('http://localhost:8899/index.html');
  await page.waitForFunction(() => { const s = document.getElementById('login-user'); return !s || !/載入中/.test(s.innerHTML); }, { timeout: 15000 }).catch(() => {});
  await page.evaluate(({ PRODUCTS, CUSTOMERS, LEDGER0, DEALERS, MAP, PENDING }) => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 'test-token';
    window.CALLS = []; window.TOASTS = []; window.DOCS = [];
    window.confirm = () => true; window.alert = () => {};
    window.toast = (msg, type) => { window.TOASTS.push([String(msg), type || '']); };
    window.open = () => ({ document: { open() {}, write(h) { window.DOCS.push(String(h)); }, close() {} } });   // 列印視窗：只收 HTML，不真的開
    window.FX_CONFIGURED = true; window.FX_MAP = MAP.map(m => ({ ...m }));
    window.PENDING = PENDING.map(o => JSON.parse(JSON.stringify(o))); window.PENDING_FAIL = '';
    window.LEDGER = LEDGER0.map(r => ({ ...r }));
    window.VF = []; window.VF_SEQ = 0;
    const isWrite = a => ['saveVerifyForm', 'deleteVerifyForm', 'factoryConsignSync', 'saveFactoryMap', 'saveConsignCustomer'].includes(a);
    window.apiCall = async (payload) => {
      window.CALLS.push(JSON.parse(JSON.stringify(payload)));
      if (isWrite(payload.action) && typeof rcClear === 'function') rcClear();   // 真的 apiCall 對寫入 action 會清讀取快取，這裡照做
      switch (payload.action) {
        case 'getOwnbrandProducts': return { ok: true, products: PRODUCTS };
        case 'getOwnbrandTiers':    return { ok: true, tiers: [], terms: {} };
        case 'getConsignCustomers': return { ok: true, customers: CUSTOMERS, discounts: [] };
        case 'getConsignInventory': return { ok: true, inventory: [], deposit_held_by_customer: {} };
        case 'getConsignLedger':    return { ok: true, rows: window.LEDGER };
        case 'listVerifyForms':     return { ok: true, records: window.VF.slice().reverse(), summary: {} };
        case 'getVerifyKey':        return { ok: true, k: 'K-' + payload.no };
        case 'saveVerifyForm':      { const id = 'VF' + (++window.VF_SEQ); const r = payload.record;
                                      window.VF.push({ id, created_at: '2026-11-26T15:00:0' + window.VF_SEQ + '+08:00', no: r.no, lot: r.lot || '', ship_date: r.shipDate, pm: r.pm || '', boxes: 0, items: r.items, client: r.client });
                                      return { ok: true, id }; }
        case 'deleteVerifyForm':    window.VF = window.VF.filter(f => f.id !== payload.id); return { ok: true };
        case 'getFactoryConsignDealers': return { ok: true, configured: window.FX_CONFIGURED, dealers: window.FX_CONFIGURED ? DEALERS : [], map: window.FX_MAP, lastSync: '2026-11-26T14:18:00+08:00', since: '2026-09-16 00:00:00' };
        case 'getFactoryConsignPending': if (window.PENDING_FAIL) return { ok: false, error: window.PENDING_FAIL };
                                    return { ok: true, configured: true, orders: window.PENDING, unmapped: {}, at: '2026-11-26T15:00:00+08:00' };
        case 'factoryConsignSync':  return { ok: true, inserted: [], linked: [], skipped: [], unmappedDealers: {}, unmappedProducts: {}, ambiguous: {}, autoMapped: [], dealerMap: {}, dealers: DEALERS, at: '2026-11-26T15:10:00+08:00', moneyAdj: [] };
        default: return { ok: true, quotes: [], orders: [], records: [], shipments: [], rows: [] };
      }
    };
  }, { PRODUCTS, CUSTOMERS, LEDGER0, DEALERS, MAP, PENDING });

  const results = []; const check = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);
  const has = f => page.evaluate(f => typeof window[f] === 'function', f);
  const fns = ['csFxLoadPending', 'csFxRenderPending', 'csFxPendingVfNo', 'csFxPendingVerify', 'csFxPendingMarkVerified', 'csFxPendingFor', 'csFxBranchOf', 'csFxBranchFromNote', 'csLedAltMap', 'csVfAfterSaved'];
  let allFns = true; for (const f of fns) if (!(await has(f))) { allFns = false; console.log('  缺函式', f); }
  check('0 新函式都在', allFns);

  // ---- A) 單號規則 ----
  const a = await page.evaluate(() => {
    const no = csFxPendingVfNo('6', '261123-001', 1);
    const m = no.match(/20\d{6}/g);
    const st = csVfStamp(no);
    // 「同一天 15 分鐘內」舊留底配對：同一天最晚的真實單號（23:59:59）也認不走這張
    const stray = csLedAssignVf([{ no, id: 'P1' }], ['CS-6-20261123235959', 'CS-6-20261123000000']);
    return {
      no, seq2: csFxPendingVfNo('6', '261123-001', 2), seqStr: csFxPendingVfNo('6', '261123-001', '3'), pad: csFxPendingVfNo(6, ' 261123-12 ', 1),
      seq0: csFxPendingVfNo('6', '261123-001', 0), seqBig: csFxPendingVfNo('6', '261123-001', 250),
      bad: [csFxPendingVfNo('6', 'X-99', 1), csFxPendingVfNo('6', '', 1), csFxPendingVfNo('6', '20261123-001', 1), csFxPendingVfNo('6', '261123-0001', 1), csFxPendingVfNo('6', null, 1)],
      cidClean: csFxPendingVfNo('A 6!', '261123-001', 1),
      lastYmd: m && m[m.length - 1], nMatch: m && m.length, stamp: st && (st.cid + '|' + st.ts), stray: Object.keys(stray).length,
      overlap: (csFxPendingVfNo('6', '261120-001', 1).match(/20\d{6}/g) || []).join(','),   // 2611「20」9001… 不會被當成第二個日期
    };
  });
  check('A1 客戶 6、廠務單 261123-001 第 1 趟 → CS-6-20261123900101', a.no === 'CS-6-20261123900101');
  check('A2 第 2 趟尾碼 02、趟數吃字串、流水號補滿 3 碼', a.seq2 === 'CS-6-20261123900102' && a.seqStr === 'CS-6-20261123900103' && a.pad === 'CS-6-20261123901201');
  check('A3 趟數 0 當第 1 趟、超過 99 封頂 99', a.seq0 === 'CS-6-20261123900101' && a.seqBig === 'CS-6-20261123900199');
  check('A4 廠務單號格式不認得 → 空字串（不編對不回來的號）', a.bad.every(x => x === ''));
  check('A5 客戶代碼只留英數', a.cidClean === 'CS-A6-20261123900101');
  check('A6 單號是 CS-<客戶>-14 碼、含日期 20261123（≥20260813 → QR 驗證碼照常要）、只認到一個日期', a.stamp === '6|20261123900101' && a.lastYmd === '20261123' && a.nMatch === 1 && a.overlap === '20261120');
  check('A7 不會被「同一天 15 分鐘內」的舊留底配對認走', a.stray === 0);

  // ---- B) csLedAssignVf alt 優先 ----
  const b = await page.evaluate(() => {
    const N1 = 'CS-6-20261127151000', N2 = 'CS-6-20261110093000', ALT1 = 'CS-6-20261123900101';
    const r1 = csLedAssignVf([{ no: ALT1, id: 'a' }, { no: N2, id: 'b' }], [N1, N2], { [N1]: ALT1 });
    const r2 = csLedAssignVf([{ no: N1, id: 'x' }, { no: ALT1, id: 'y' }], [N1], { [N1]: ALT1 });        // 兩張都在 → 先開的那張優先
    const r3 = csLedAssignVf([{ no: N1, id: 'x' }], [N1], { [N1]: ALT1 });                                 // 沒有先開的 → 照舊用同號
    const r4 = csLedAssignVf([{ no: ALT1, id: 'a' }], [N1, N2]);                                           // 不帶 altOf → 對不到（行為照舊）
    const r5 = csLedAssignVf([{ no: 'CS-6-20261127151130', id: 'old' }], [N1], { [N1]: ALT1 });            // 舊留底（差 90 秒）退路照舊
    const r6 = csLedAssignVf([{ no: ALT1, id: 'a' }], [N1, N2], { [N1]: ALT1, [N2]: ALT1 });               // 一張留底只配一批
    return { r1, r2, r3, r4n: Object.keys(r4).length, r5, r6n: Object.keys(r6).length, r6first: r6[N1] && r6[N1].id, N1, N2, ALT1 };
  });
  check('B1 有 alt 的那批配到先開的留底、另一批照同號配', b.r1[b.N1] && b.r1[b.N1].no === b.ALT1 && b.r1[b.N1].id === 'a' && b.r1[b.N2] && b.r1[b.N2].id === 'b');
  check('B2 同號留底跟先開的都在 → 先開的那張優先', b.r2[b.N1] && b.r2[b.N1].id === 'y');
  check('B3 沒有先開的留底 → 照舊用同號', b.r3[b.N1] && b.r3[b.N1].id === 'x');
  check('B4 不帶 altOf → 行為照舊（先開的那張不會被亂配）', b.r4n === 0);
  check('B5 舊留底「同一天 15 分鐘內」退路照舊', b.r5[b.N1] && b.r5[b.N1].id === 'old');
  check('B6 一張留底只配一批', b.r6n === 1 && b.r6first === 'a');

  // ---- C) 進頁背景抓 ----
  await page.evaluate(() => gotoPage('consign'));
  await page.waitForTimeout(300);
  await page.evaluate(async () => { window.CALLS = []; await initConsignPage(true); });
  await page.waitForTimeout(300);
  const c1 = await page.evaluate(() => ({
    calls: window.CALLS.filter(c => c.action === 'getFactoryConsignPending'),
    whitelisted: rcIsRead('getFactoryConsignPending'),
    loaded: CS_FX_PENDING.loaded, n: CS_FX_PENDING.orders.length,
    card: document.getElementById('cs-fxpending-card').style.display,
    cur: CS_CUR || '',
  }));
  check('C1 進寄售頁抓一次 getFactoryConsignPending（帶 token）', c1.calls.length === 1 && c1.calls[0].token === 'test-token' && c1.loaded && c1.n === 5);
  check('C2 在讀取白名單（不會把整站快取清掉）', c1.whitelisted === true);
  await page.evaluate(async () => { window.CALLS = []; await initConsignPage(false); });
  await page.waitForTimeout(200);
  check('C3 再進頁走讀取快取、不重打', await page.evaluate(() => window.CALLS.filter(c => c.action === 'getFactoryConsignPending').length === 0));
  check('D0 還沒選客戶 → 整張卡不顯示', c1.cur === '' && c1.card === 'none');

  // ---- D) 選誠品 ----
  await page.evaluate(() => { document.getElementById('cs-customer').value = '6'; onSelectConsignCustomer(); });
  await page.waitForTimeout(500);
  const d1 = await page.evaluate(() => {
    const card = document.getElementById('cs-fxpending-card');
    const trs = [...document.querySelectorAll('#cs-fxpending-body tr')];
    return {
      shown: card.style.display !== 'none', title: card.querySelector('.ch').textContent,
      rows: trs.map(tr => [...tr.children].map(td => td.textContent.replace(/\s+/g, ' ').trim())),
      btns: trs.map(tr => { const x = tr.querySelector('.cs-pvfbtn'); return x ? { no: x.dataset.no, i: x.dataset.i, text: x.textContent, primary: x.classList.contains('primary') } : null; }),
      before: card.nextElementSibling && card.nextElementSibling.querySelector('.ch') ? card.nextElementSibling.querySelector('.ch').textContent : '',
    };
  });
  check('D1 誠品：卡片顯示、標題「廠務待出貨」、排在「目前庫存」前面', d1.shown && /廠務待出貨/.test(d1.title) && /目前庫存/.test(d1.before));
  check('D2 列出誠品的 4 張（島羽那張不在）', d1.rows.length === 4 && !d1.rows.some(r => /261125-003/.test(r[1])));
  const rP = d1.rows.find(r => /261123-001/.test(r[1])) || [];
  check('D3 261123-001：預計出貨日（明天）／待製作／門市「平鎮物流中心（F100）」／兩款 ×20 ×10／30 瓶', rP[0] === D1 && /待製作/.test(rP[1]) && rP[2] === '平鎮物流中心（F100）' && /蜜香紅茶荔枝琴酒（100ml） ×20/.test(rP[3]) && /茉莉香片脆梅琴酒（100ml） ×10/.test(rP[3]) && rP[4] === '30');
  const rOld = d1.rows.find(r => /261027-001/.test(r[1])) || [];
  check('D4 261027-001（舊的「誠品生活」經銷商）：預計日已過 → 標「已過預計日」；門市欄顯示「誠品生活」、60 瓶', rOld[0] === '2026-10-27已過預計日' && rOld[2] === '誠品生活' && rOld[4] === '60');
  const rPart = d1.rows.find(r => /261120-002/.test(r[1])) || [];
  check('D5 分趟出貨的單：標「第 2 趟（只列還沒出的）」、只列剩下的 5 瓶、門市「南西店（B085）」；日期看表訂出貨日（不是上一趟的實際出貨日）', rPart[0] === D4 && /製作中/.test(rPart[1]) && /第 2 趟（只列還沒出的）/.test(rPart[1]) && rPart[2] === '南西店（B085）' && /×5/.test(rPart[3]) && rPart[4] === '5');
  const iP = d1.rows.findIndex(r => /261123-001/.test(r[1])), iOld = d1.rows.findIndex(r => /261027-001/.test(r[1])), iPart = d1.rows.findIndex(r => /261120-002/.test(r[1])), iBad = d1.rows.findIndex(r => /X-99/.test(r[1]));
  check('D6 每張鈕帶自己的單號：CS-6-20261123900101／CS-6-20261027900101／CS-6-20261120900202，都是「先開驗收單」', d1.btns[iP] && d1.btns[iP].no === 'CS-6-20261123900101' && d1.btns[iOld].no === 'CS-6-20261027900101' && d1.btns[iPart].no === 'CS-6-20261120900202' && [iP, iOld, iPart].every(i => d1.btns[i].text === '先開驗收單' && d1.btns[i].primary));
  check('D7 單號格式不認得（X-99）→ 不給鈕、講「出貨後再開」；沒排日期顯示「未排」', d1.btns[iBad] === null && /出貨後再開/.test(d1.rows[iBad][5]) && d1.rows[iBad][0] === '未排');

  await page.evaluate((i) => { document.querySelectorAll('#cs-fxpending-body tr')[i].querySelector('.cs-pvfbtn').click(); }, iOld);
  await page.waitForTimeout(400);
  const d8 = await page.evaluate(() => ({ no: CONSIGN_VF_DATA && CONSIGN_VF_DATA.no, date: document.getElementById('cs-vf-date').value, note: document.getElementById('cs-vf-note').value, handler: document.getElementById('cs-vf-handler').value }));
  check('D8 預計日已過的那張先開驗收單 → 日期預設今天（不會印出過去的日期）；經手人帶廠務的 PM', d8.no === 'CS-6-20261027900101' && d8.date === TODAY && d8.note === '誠品生活' && d8.handler === '阿軒');
  await page.evaluate(() => closeConsignVerifyForm(true));

  // ---- E) 先開驗收單 ----
  await page.evaluate((i) => { window.CALLS = []; window.TOASTS = []; document.querySelectorAll('#cs-fxpending-body tr')[i].querySelector('.cs-pvfbtn').click(); }, iP);
  await page.waitForTimeout(500);
  const e1 = await page.evaluate(() => {
    const ov = document.getElementById('cs-vf-overlay');
    return {
      open: !!ov && ov.style.display === 'flex', title: ov ? ov.querySelector('.v2h span').textContent : '',
      no: CONSIGN_VF_DATA && CONSIGN_VF_DATA.no, client: document.getElementById('cs-vf-client').value, date: document.getElementById('cs-vf-date').value,
      handler: document.getElementById('cs-vf-handler').value, note: document.getElementById('cs-vf-note').value,
      rows: (CONSIGN_VF_DATA.rows || []).map(r => r.name + '|' + r.vol + '|' + r.qty), editId: CONSIGN_VF_EDIT_ID,
      keyAsked: window.CALLS.some(c => c.action === 'getVerifyKey' && c.no === 'CS-6-20261123900101'),
    };
  });
  check('E1 開寄售驗收單視窗（新開，不是編輯）', e1.open && /寄售鋪貨・出貨驗收單/.test(e1.title) && e1.editId === null);
  check('E2 帶入：單號 CS-6-20261123900101、客戶 誠品生活、日期＝預計出貨日（明天）、經手人 Kevin、備註＝門市', e1.no === 'CS-6-20261123900101' && e1.client === '誠品生活' && e1.date === D1 && e1.handler === 'Kevin' && e1.note === '平鎮物流中心（F100）');
  check('E3 品項＝還沒出的兩款（×20、×10）', JSON.stringify(e1.rows) === JSON.stringify(['蜜香紅茶荔枝琴酒|100ml|20', '茉莉香片脆梅琴酒|100ml|10']));
  check('E4 先去要 QR 驗證碼', e1.keyAsked);
  await page.evaluate(() => { window.CALLS = []; window.TOASTS = []; generateConsignVerifyPdf(); });
  await page.waitForTimeout(600);
  const e2 = await page.evaluate(() => {
    const sv = window.CALLS.find(c => c.action === 'saveVerifyForm');
    const x = [...document.querySelectorAll('#cs-fxpending-body .cs-pvfbtn')].find(b => b.dataset.no === 'CS-6-20261123900101');
    const others = [...document.querySelectorAll('#cs-fxpending-body .cs-pvfbtn')].filter(b => b.dataset.no !== 'CS-6-20261123900101').map(b => b.textContent);
    const doc = window.DOCS[window.DOCS.length - 1] || '';
    return { rec: sv && sv.record, tokenOk: sv && sv.token === 'test-token', closed: document.getElementById('cs-vf-overlay').style.display === 'none', btn: x && x.textContent, primary: x && x.classList.contains('primary'), others,
      docNo: doc.indexOf('CS-6-20261123900101') >= 0, docBranch: doc.indexOf('平鎮物流中心（F100）') >= 0, docKey: doc.indexOf('K-CS-6-20261123900101') >= 0 || /svg/i.test(doc),
      ledgerWrites: window.CALLS.filter(c => /ConsignMove|saveConsignMovement|addConsign/i.test(c.action)).length, vf: window.VF.length, toast: window.TOASTS.map(t => t[0]).join('|') };
  });
  check('E5 產生 → 留底存進去（單號、客戶、配送日期、經手人、兩款數量）', e2.rec && e2.tokenOk && e2.rec.no === 'CS-6-20261123900101' && e2.rec.client === '誠品生活' && e2.rec.shipDate === D1 && e2.rec.pm === 'Kevin' && e2.rec.items.length === 2 && e2.rec.items[0].thisShip === 20 && e2.rec.items[1].thisShip === 10 && e2.vf === 1);
  check('E6 印出來的驗收單有單號、門市備註；視窗關掉', e2.docNo && e2.docBranch && e2.closed);
  check('E7 留底存好 → 那顆鈕自己變「查看驗收單」（其他張還是「先開驗收單」）', e2.btn === '查看驗收單' && e2.primary === false && e2.others.length === 2 && e2.others.every(t => t === '先開驗收單'));
  check('E8 先開驗收單不寫寄售帳（不動庫存）', e2.ledgerWrites === 0);

  // ---- F) 已經先開過 → 查看＝編輯模式 ----
  await page.evaluate(() => { window.CALLS = []; window.TOASTS = []; [...document.querySelectorAll('#cs-fxpending-body .cs-pvfbtn')].find(b => b.dataset.no === 'CS-6-20261123900101').click(); });
  await page.waitForTimeout(500);
  const f1 = await page.evaluate(() => ({
    title: document.querySelector('#cs-vf-overlay .v2h span').textContent, editId: CONSIGN_VF_EDIT_ID, no: CONSIGN_VF_DATA.no,
    rows: CONSIGN_VF_DATA.rows.map(r => r.name + '|' + r.qty), date: document.getElementById('cs-vf-date').value, handler: document.getElementById('cs-vf-handler').value,
    toast: window.TOASTS.map(t => t[0]).join('|'),
  }));
  check('F1 已先開過 → 編輯模式（帶回留底那張、單號不變、提示「已經先開過」）', /編輯驗收單/.test(f1.title) && f1.editId === 'VF1' && f1.no === 'CS-6-20261123900101' && /已經先開過驗收單/.test(f1.toast));
  check('F2 帶回留底的數量／日期／經手人', JSON.stringify(f1.rows) === JSON.stringify(['蜜香紅茶荔枝琴酒|20', '茉莉香片脆梅琴酒|10']) && f1.date === D1 && f1.handler === 'Kevin');
  // 改數量再產生一次 → 新留底取代舊的（單號不變、只剩一筆）
  await page.evaluate(() => { const q = document.querySelector('#cs-vf-rows input[data-k="qty"]'); q.value = '18'; q.dispatchEvent(new Event('input', { bubbles: true })); q.dispatchEvent(new Event('change', { bubbles: true })); window.CALLS = []; window.TOASTS = []; generateConsignVerifyPdf(); });
  await page.waitForTimeout(700);
  const f2 = await page.evaluate(() => ({ vf: window.VF.map(f => f.id + '|' + f.no + '|' + f.items[0].thisShip), del: window.CALLS.some(c => c.action === 'deleteVerifyForm' && c.id === 'VF1'),
    btn: ([...document.querySelectorAll('#cs-fxpending-body .cs-pvfbtn')].find(b => b.dataset.no === 'CS-6-20261123900101') || {}).textContent }));
  check('F3 改完再產生 → 新版取代舊留底（同單號只剩一筆、數量 18）、鈕還是「查看驗收單」', f2.del && f2.vf.length === 1 && f2.vf[0] === 'VF2|CS-6-20261123900101|18' && f2.btn === '查看驗收單');

  // ---- G) 出貨進帳後，明細那一批對回先開的留底 ----
  const g0 = await page.evaluate(() => ({ batches: CS_LED_BATCHES.map(b => ({ no: b.no, alt: b.alt, note: b.note, fxOrder: b.fxOrder })), btns: [...document.querySelectorAll('#cs-ledger-body .cs-vfbtn')].map(b => b.dataset.no + '|' + b.textContent) }));
  check('G0 出貨前：明細只有南西店那批（alt＝CS-6-20261120900201、備註帶門市）＋手動那批（沒有 alt、備註照舊），都還沒留底', g0.batches.length === 2
    && g0.batches.some(x => x.fxOrder === '261120-002' && x.no === 'CS-6-20261121100000' && x.alt === 'CS-6-20261120900201' && x.note === '南西店（B085）')
    && g0.batches.some(x => !x.fxOrder && x.alt === '' && x.note === '手動登的') && g0.btns.every(t => /補開驗收單$/.test(t)));
  await page.evaluate(async ({ LEDGER_SHIPPED }) => {
    window.LEDGER = window.LEDGER.concat(LEDGER_SHIPPED);                       // 廠務出貨了、同步進帳
    window.PENDING = window.PENDING.filter(o => o.orderNo !== '261123-001');     // 那張從待出貨消失
    window.CALLS = []; window.TOASTS = [];
    await csFxSyncNow(null);
  }, { LEDGER_SHIPPED });
  await page.waitForTimeout(900);
  const g1 = await page.evaluate(() => ({
    pendRefetched: window.CALLS.filter(c => c.action === 'getFactoryConsignPending').length,
    pendRows: [...document.querySelectorAll('#cs-fxpending-body tr')].map(tr => tr.children[1].textContent.replace(/\s+/g, ' ').trim()),
    batch: CS_LED_BATCHES.filter(b => b.fxOrder === '261123-001').map(b => ({ no: b.no, alt: b.alt, note: b.note, n: b.rows.length })),
    btn: ([...document.querySelectorAll('#cs-ledger-body .cs-vfbtn')].find(b => b.dataset.no === 'CS-6-20261127151000') || {}).textContent,
    vfOf: CS_LED_VF['CS-6-20261127151000'],
    other: [...document.querySelectorAll('#cs-ledger-body .cs-vfbtn')].filter(b => b.dataset.no !== 'CS-6-20261127151000').map(b => b.textContent),
  }));
  check('I1 按「同步廠務」→ 待出貨重抓；出貨的那張從卡片消失', g1.pendRefetched === 1 && g1.pendRows.length === 3 && !g1.pendRows.some(t => /261123-001/.test(t)));
  check('G1 出貨進帳：同一趟兩款＝一批（CS-6-20261127151000）、alt＝先開的單號、驗收單備註帶門市', g1.batch.length === 1 && g1.batch[0].no === 'CS-6-20261127151000' && g1.batch[0].alt === 'CS-6-20261123900101' && g1.batch[0].note === '平鎮物流中心（F100）' && g1.batch[0].n === 2);
  check('G2 那一批的鈕直接是「查看驗收單」（對回先開的留底 VF2）；其他批還是「補開驗收單」', g1.btn === '查看驗收單' && g1.vfOf && g1.vfOf.no === 'CS-6-20261123900101' && g1.vfOf.id === 'VF2' && g1.other.length === 2 && g1.other.every(t => t === '補開驗收單'));
  await page.evaluate(() => { window.CALLS = []; window.TOASTS = []; const x = [...document.querySelectorAll('#cs-ledger-body .cs-vfbtn')].find(b => b.dataset.no === 'CS-6-20261127151000'); x.click(); });
  await page.waitForTimeout(500);
  const g3 = await page.evaluate(() => ({ title: document.querySelector('#cs-vf-overlay .v2h span').textContent, editId: CONSIGN_VF_EDIT_ID, no: CONSIGN_VF_DATA.no, note: document.getElementById('cs-vf-note').value, rows: CONSIGN_VF_DATA.rows.map(r => r.name + '|' + r.qty) }));
  check('G3 從明細重開 → 編輯先開的那張（單號沿用 CS-6-20261123900101，紙本 QR 不會換號）、帶留底的數量 18', /編輯驗收單/.test(g3.title) && g3.editId === 'VF2' && g3.no === 'CS-6-20261123900101' && g3.note === '平鎮物流中心（F100）' && g3.rows[0] === '蜜香紅茶荔枝琴酒|18');
  await page.evaluate(() => closeConsignVerifyForm(true));
  // 沒先開過的那批（南西店第 1 趟）補開 → 用自己的批次單號（不是 alt），存檔後鈕變查看
  await page.evaluate(() => { window.CALLS = []; [...document.querySelectorAll('#cs-ledger-body .cs-vfbtn')].find(b => b.dataset.no === 'CS-6-20261121100000').click(); });
  await page.waitForTimeout(500);
  const g4 = await page.evaluate(() => ({ no: CONSIGN_VF_DATA.no, editId: CONSIGN_VF_EDIT_ID, note: document.getElementById('cs-vf-note').value }));
  check('G4 沒先開過的那批補開 → 用批次自己的單號（建檔時間推的）、備註帶門市', g4.no === 'CS-6-20261121100000' && g4.editId === null && g4.note === '南西店（B085）');
  await page.evaluate(() => { generateConsignVerifyPdf(); });
  await page.waitForTimeout(700);
  const g5 = await page.evaluate(() => ({ btn: ([...document.querySelectorAll('#cs-ledger-body .cs-vfbtn')].find(b => b.dataset.no === 'CS-6-20261121100000') || {}).textContent, vf: window.VF.map(f => f.no) }));
  check('G5 補開存好 → 明細那顆鈕自己變「查看驗收單」（不用重整）', g5.btn === '查看驗收單' && g5.vf.includes('CS-6-20261121100000'));

  // ---- H) 其他客戶／狀態 ----
  await page.evaluate(() => { document.getElementById('cs-customer').value = '4'; onSelectConsignCustomer(); });
  await page.waitForTimeout(400);
  const h1 = await page.evaluate(() => { const trs = [...document.querySelectorAll('#cs-fxpending-body tr')]; return { shown: document.getElementById('cs-fxpending-card').style.display !== 'none', rows: trs.map(tr => [...tr.children].map(td => td.textContent.replace(/\s+/g, ' ').trim())), no: (document.querySelector('#cs-fxpending-body .cs-pvfbtn') || { dataset: {} }).dataset.no }; });
  check('H1 島羽（只對一家）：只列自己那張、門市欄「—」、單號 CS-4-20261125900301；還沒出過 → 日期看廠務的實際出貨日', h1.shown && h1.rows.length === 1 && h1.rows[0][0] === D3 && /261125-003/.test(h1.rows[0][1]) && h1.rows[0][2] === '—' && h1.no === 'CS-4-20261125900301');
  await page.evaluate(() => { window.TOASTS = []; document.querySelector('#cs-fxpending-body .cs-pvfbtn').click(); });
  await page.waitForTimeout(400);
  const h1b = await page.evaluate(() => ({ note: document.getElementById('cs-vf-note').value, client: document.getElementById('cs-vf-client').value, date: document.getElementById('cs-vf-date').value }));
  check('H2 島羽先開驗收單：備註空白（不用標門市）、客戶名／日期帶對', h1b.note === '' && h1b.client === '島羽Wing Islands' && h1b.date === D3);
  await page.evaluate(() => closeConsignVerifyForm(true));
  await page.evaluate(() => { document.getElementById('cs-customer').value = '7'; onSelectConsignCustomer(); });
  await page.waitForTimeout(400);
  check('H3 至美蒔光（已連結、沒有待出貨）→ 整張卡不顯示', await page.evaluate(() => document.getElementById('cs-fxpending-card').style.display === 'none' && document.getElementById('cs-fxpending-body').innerHTML === ''));
  await page.evaluate(() => { document.getElementById('cs-customer').value = '2'; onSelectConsignCustomer(); });
  await page.waitForTimeout(400);
  check('H4 downstairs（沒連結廠務）→ 不顯示', await page.evaluate(() => document.getElementById('cs-fxpending-card').style.display === 'none'));
  // 讀取失敗
  await page.evaluate(async () => { window.PENDING_FAIL = '讀取廠務失敗：逾時'; await csFxLoadPending(true); });
  const h5a = await page.evaluate(() => document.getElementById('cs-fxpending-card').style.display);
  await page.evaluate(() => { document.getElementById('cs-customer').value = '7'; onSelectConsignCustomer(); });
  await page.waitForTimeout(400);
  const h5b = await page.evaluate(() => ({ shown: document.getElementById('cs-fxpending-card').style.display !== 'none', text: document.getElementById('cs-fxpending-body').textContent, err: CS_FX_PENDING.err }));
  check('H5 讀取失敗：沒連結的客戶不吵；已連結的客戶講明讀不到＋叫她按「同步廠務」', h5a === 'none' && h5b.shown && /讀不到廠務的待出貨清單/.test(h5b.text) && /逾時/.test(h5b.text) && /同步廠務/.test(h5b.text));
  await page.evaluate(async () => { window.PENDING_FAIL = ''; await csFxLoadPending(true); });
  check('H6 重抓成功 → 錯誤列收掉（至美蒔光沒有待出貨＝不顯示）', await page.evaluate(() => document.getElementById('cs-fxpending-card').style.display === 'none' && CS_FX_PENDING.err === ''));
  // 第一次還在等廠務回：已連結的客戶先看到「正在問廠務…」，沒連結的不顯示；回來後照實際結果
  const h6b = await page.evaluate(() => {
    const keep = CS_FX_PENDING; CS_FX_PENDING = { loaded: false, orders: [], at: '', err: '' };
    const sel = id => { CS_CUR = id; csFxRenderPending(); return { shown: document.getElementById('cs-fxpending-card').style.display !== 'none', text: document.getElementById('cs-fxpending-body').textContent }; };
    const a = sel('7'), b = sel('2');
    CS_FX_PENDING = keep; const c = sel('7');
    return { a, b, c };
  });
  check('H6b 還在等廠務回：已連結的客戶顯示「正在問廠務…」、沒連結的不顯示；回來後沒有待出貨就收掉', h6b.a.shown && /正在問廠務/.test(h6b.a.text) && !h6b.b.shown && !h6b.c.shown);
  // 待出貨清單重抓後舊索引失效 → 不會開錯張
  await page.evaluate(() => { document.getElementById('cs-customer').value = '6'; onSelectConsignCustomer(); });
  await page.waitForTimeout(400);
  const h7 = await page.evaluate(async () => { window.TOASTS = []; CONSIGN_VF_DATA = null; await csFxPendingVerify('9'); return { toast: window.TOASTS.map(t => t[0]).join('|'), opened: !!CONSIGN_VF_DATA }; });
  check('H7 索引對不到（清單剛重載）→ 提示重選客戶、不開視窗', /請重選一次客戶再試/.test(h7.toast) && h7.opened === false);
  // 廠務沒設定
  await page.evaluate(async () => { window.FX_CONFIGURED = false; rcClear(); window.CALLS = []; await initConsignPage(true); });
  await page.waitForTimeout(300);
  const h8 = await page.evaluate(() => ({ calls: window.CALLS.filter(c => c.action === 'getFactoryConsignPending').length, card: document.getElementById('cs-fxpending-card').style.display }));
  check('H8 廠務沒設定 → 進頁不抓待出貨、卡片自己收掉', h8.calls === 0 && h8.card === 'none');

  check('00 零 JS 例外／console error', errors.length === 0);
  results.forEach(r => console.log(r[0], r[1]));
  const fails = results.filter(r => r[0] === 'FAIL').length;
  console.log(`\n${results.length - fails}/${results.length} PASS${fails ? ' — ' + fails + ' FAIL' : ''}`);
  if (errors.length) console.log('errors:', errors.slice(0, 5));
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
