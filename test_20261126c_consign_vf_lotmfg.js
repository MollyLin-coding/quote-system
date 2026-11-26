/* 2026-11-26c 寄售驗收單「批號」「製造日期」（前端，js/09_verify_form.js／08_ownbrand.js／06_verify_mgmt.js）離線測試
   Molly：「寄售驗收單我需要可以打入酒款批號及製造日期」
    A) 表單每一列多「批號」（文字）「製造日期」（日期）兩格；欄位順序 酒款｜批號｜製造日期｜容量｜數量
    B) 印出來的驗收單：有填才印那一欄（都沒填＝版面跟原本一模一樣；只填批號＝只多批號欄；只填製造日期同理）
    C) 「帶到空白列」：拿第一個有填的值補進其他空白列，已填的不動、沒酒名的列不補；都沒填時提示先填一列
    D) 按「新增品項」「✕」重畫：剛打的批號／製造日期與表頭的日期／經手人／備註都還在
    E) 產生 → 留底 items 存 lot／mfg（去頭尾空白）；試飲瓶標示照舊
    F) 從留底重開都帶回：驗收管理（vmEditForm）、進出貨明細（csReopenVerify）、廠務待出貨（csFxPendingVerify）
    G) 留底裡製造日期存成 2026/11/20 也認得；批號有特殊字元會跳脫
*/
const { chromium } = require('/opt/node-tools/node_modules/playwright');

const PRODUCTS = [
  { sku_id: '蜜香紅茶荔枝琴酒|100ml', name: '蜜香紅茶荔枝琴酒', volume: '100ml', list_price: 250, active: 'Y' },
  { sku_id: '茉莉香片脆梅琴酒|100ml', name: '茉莉香片脆梅琴酒', volume: '100ml', list_price: 250, active: 'Y' },
];
const CUSTOMERS = [{ customer_id: '6', name: '誠品生活', default_discount: 0.65, billing_day: 5, active: 'Y' }];
const DEALERS = [
  { key: '經銷商－誠品生活', label: '誠品生活', enabled: true, discount: 0.65, closeDay: 5 },
  { key: '經銷商－誠品生活_南西店', label: '誠品生活_南西店（B085）', enabled: true, discount: 0.65, closeDay: 5 },
];
const MAP = [
  { kind: 'consign_client', qs_name: '6', factory_name: '經銷商－誠品生活', note: '' },
  { kind: 'consign_client', qs_name: '6', factory_name: '經銷商－誠品生活_南西店', note: '' },
];
const D = n => { const t = new Date(); t.setDate(t.getDate() + n); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); };
const PENDING = [
  { orderNo: '261123-001', dealer: '經銷商－誠品生活_南西店', customer_id: '6', status: '待製作', deliveryDate: D(1), actualDeliveryDate: '', nextSeq: 1, lot: '', pm: 'Molly',
    items: [{ sku_id: '蜜香紅茶荔枝琴酒|100ml', name: '蜜香紅茶荔枝琴酒', vol: '100ml', qty: 20, ordered: 20, shipped: 0 }, { sku_id: '茉莉香片脆梅琴酒|100ml', name: '茉莉香片脆梅琴酒', vol: '100ml', qty: 10, ordered: 10, shipped: 0 }] },
];
const LEDGER = [
  { movement_id: 'CM-20261121-0001', date: '2026-11-21', customer_id: 6, sku_id: '蜜香紅茶荔枝琴酒|100ml', type: 'in', qty: 10, note: '[FXC:CI-B1|261120-002#1] 【南西店（B085）】廠務 261120-002 第1次／Kevin：訂單出貨 第 1 次', created_at: '2026-11-21T10:00:00+08:00' },
];
// 既有留底：明細那一批（單號＝建檔時間推的）、待出貨先開過的那張（製造日期存成斜線寫法）
const VF0 = [
  { id: 'VFA', created_at: '2026-11-21T10:05:00+08:00', no: 'CS-6-20261121100000', lot: '', ship_date: '2026-11-21', pm: 'Kevin', boxes: 0, client: '誠品生活',
    items: [{ name: '蜜香紅茶荔枝琴酒', lot: 'L2611A', vol: '100ml', mfg: '2026-11-18', thisShip: 10, ordered: 10, shipped: 0, taster: 0 }] },
  { id: 'VFB', created_at: '2026-11-26T09:00:00+08:00', no: 'CS-6-20261123900101', lot: '', ship_date: D(1), pm: 'Molly', boxes: 0, client: '誠品生活',
    items: [{ name: '蜜香紅茶荔枝琴酒', lot: 'L2611B', vol: '100ml', mfg: '2026/11/20', thisShip: 20, ordered: 20, shipped: 0, taster: 0 },
            { name: '茉莉香片脆梅琴酒', lot: '', vol: '100ml', mfg: '', thisShip: 10, ordered: 10, shipped: 0, taster: 0 }] },
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
  await page.evaluate(({ PRODUCTS, CUSTOMERS, LEDGER, DEALERS, MAP, PENDING, VF0 }) => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 'test-token';
    window.CALLS = []; window.TOASTS = []; window.DOCS = [];
    window.confirm = () => true; window.alert = () => {};
    window.toast = (msg, type) => { window.TOASTS.push([String(msg), type || '']); };
    window.open = () => ({ document: { open() {}, write(h) { window.DOCS.push(String(h)); }, close() {} } });
    window.VF = VF0.map(f => JSON.parse(JSON.stringify(f))); window.VF_SEQ = 0;
    const isWrite = a => ['saveVerifyForm', 'deleteVerifyForm'].includes(a);
    window.apiCall = async (payload) => {
      window.CALLS.push(JSON.parse(JSON.stringify(payload)));
      if (isWrite(payload.action) && typeof rcClear === 'function') rcClear();
      switch (payload.action) {
        case 'getOwnbrandProducts': return { ok: true, products: PRODUCTS };
        case 'getOwnbrandTiers':    return { ok: true, tiers: [], terms: {} };
        case 'getConsignCustomers': return { ok: true, customers: CUSTOMERS, discounts: [] };
        case 'getConsignInventory': return { ok: true, inventory: [], deposit_held_by_customer: {} };
        case 'getConsignLedger':    return { ok: true, rows: LEDGER };
        case 'listVerifyForms':     return { ok: true, records: window.VF.slice().reverse(), summary: {} };
        case 'getVerifyKey':        return { ok: true, k: 'K-' + payload.no };
        case 'saveVerifyForm':      { const id = 'VFN' + (++window.VF_SEQ); const r = payload.record;
                                      window.VF.push({ id, created_at: '2026-11-26T16:00:0' + window.VF_SEQ + '+08:00', no: r.no, lot: r.lot || '', ship_date: r.shipDate, pm: r.pm || '', boxes: 0, items: r.items, client: r.client });
                                      return { ok: true, id }; }
        case 'deleteVerifyForm':    window.VF = window.VF.filter(f => f.id !== payload.id); return { ok: true };
        case 'getFactoryConsignDealers': return { ok: true, configured: true, dealers: DEALERS, map: MAP, lastSync: '2026-11-26T15:10:00+08:00', since: '2026-09-16 00:00:00' };
        case 'getFactoryConsignPending': return { ok: true, configured: true, orders: PENDING, unmapped: {}, at: '2026-11-26T16:00:00+08:00' };
        default: return { ok: true, quotes: [], orders: [], records: [], shipments: [], rows: [] };
      }
    };
  }, { PRODUCTS, CUSTOMERS, LEDGER, DEALERS, MAP, PENDING, VF0 });

  const results = []; const check = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);
  const setVal = (i, k, v) => page.evaluate(({ i, k, v }) => { const el = document.querySelector(`#cs-vf-rows input[data-i="${i}"][data-k="${k}"]`); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, { i, k, v });
  const docOf = () => page.evaluate(() => {
    const html = buildConsignVerifyDocHtml(csVfCollect(), { preview: true });
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const ths = [...doc.querySelectorAll('table.vt thead tr')][0];
    return { th: [...ths.children].map(th => th.textContent + ':' + ((th.getAttribute('style') || '').match(/width:(\d+)%/) || [])[1]),
      rows: [...doc.querySelectorAll('table.vt tbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim())), html };
  });
  check('0 新函式都在', await page.evaluate(() => typeof csVfFillDown === 'function' && typeof csVfYmd === 'function'));

  // ---- A) 表單 ----
  await page.evaluate(() => openConsignVerifyForm({ no: 'CS-6-20261126120000', client: '誠品生活', shipDate: '2026-11-27', handler: 'Molly', note: '南西店',
    rows: [{ name: '蜜香紅茶荔枝琴酒', vol: '100ml', qty: 10 }, { name: '茉莉香片脆梅琴酒', vol: '100ml', qty: 5 }, { name: '泰奶烏龍蘭姆酒', vol: '500ml', qty: 2 }] }));
  const a1 = await page.evaluate(() => ({
    th: [...document.querySelectorAll('#cs-vf-body thead th')].map(t => t.textContent),
    keys: [...document.querySelectorAll('#cs-vf-rows tr')].map(tr => [...tr.querySelectorAll('input')].map(i => i.dataset.k + (i.type === 'date' ? '(date)' : '')).join(',')),
    vals: [...document.querySelectorAll('#cs-vf-rows input[data-k="lot"], #cs-vf-rows input[data-k="mfg"]')].map(i => i.value).join('|'),
    box: document.querySelector('#cs-vf-overlay .v2box').style.maxWidth,
    btns: ['cs-vf-filllot', 'cs-vf-fillmfg'].map(id => (document.getElementById(id) || {}).textContent).join('｜'),
    hint: document.getElementById('cs-vf-body').textContent,
  }));
  check('A1 欄位：酒款｜批號｜製造日期｜容量｜數量', JSON.stringify(a1.th) === JSON.stringify(['酒款', '批號', '製造日期', '容量', '數量', '']));
  check('A2 每一列都有批號（文字）與製造日期（日期）輸入格、預設空白', a1.keys.length === 3 && a1.keys.every(k => k === 'name,lot,mfg(date),vol,qty') && a1.vals === '|||||');
  check('A3 視窗加寬、有兩顆「帶到空白列」、說明寫明「有填才會印」', a1.box === '780px' && /批號帶到空白列｜.*製造日期帶到空白列/.test(a1.btns) && /有填才會印在驗收單上/.test(a1.hint));

  // ---- B) 印出來：有填才印 ----
  const b0 = await docOf();
  check('B1 都沒填 → 版面跟原本一樣（酒款 58%｜容量 21%｜數量 21%，沒有批號／製造日期欄）', JSON.stringify(b0.th) === JSON.stringify(['酒款:58', '容量:21', '數量:21']) && b0.rows[0].length === 3
    && b0.html.indexOf('<th class="l" style="width:58%">酒款</th><th style="width:21%">容量</th><th style="width:21%">數量</th>') >= 0);
  await setVal(0, 'lot', ' L2611 ');
  const b1 = await docOf();
  check('B2 只填批號（一列）→ 只多「批號」欄；有填的印值（去空白）、沒填的印「—」', JSON.stringify(b1.th) === JSON.stringify(['酒款:46', '批號:16', '容量:19', '數量:19']) && b1.rows[0].join('|') === '蜜香紅茶荔枝琴酒|L2611|100ml|10' && b1.rows[1].join('|') === '茉莉香片脆梅琴酒|—|100ml|5');
  await setVal(0, 'lot', ''); await setVal(1, 'mfg', '2026-11-20');
  const b2 = await docOf();
  check('B3 只填製造日期 → 只多「製造日期」欄、印成 2026/11/20', JSON.stringify(b2.th) === JSON.stringify(['酒款:44', '製造日期:18', '容量:19', '數量:19']) && b2.rows[1].join('|') === '茉莉香片脆梅琴酒|2026/11/20|100ml|5' && b2.rows[0][1] === '—');
  await setVal(0, 'lot', 'L2611');
  const b3 = await docOf();
  check('B4 兩種都有 → 酒款｜批號｜製造日期｜容量｜數量（合計 100%）', JSON.stringify(b3.th) === JSON.stringify(['酒款:36', '批號:14', '製造日期:18', '容量:16', '數量:16']) && b3.rows[0].join('|') === '蜜香紅茶荔枝琴酒|L2611|—|100ml|10' && b3.rows[1].join('|') === '茉莉香片脆梅琴酒|—|2026/11/20|100ml|5');

  // ---- C) 帶到空白列 ----
  await setVal(2, 'lot', 'X9');
  await page.evaluate(() => { window.TOASTS = []; csVfAddRow(); });   // 多一列空白的（沒酒名）
  await page.evaluate(() => document.getElementById('cs-vf-filllot').click());
  const c1 = await page.evaluate(() => ({ lots: [...document.querySelectorAll('#cs-vf-rows input[data-k="lot"]')].map(i => i.value), mfgs: [...document.querySelectorAll('#cs-vf-rows input[data-k="mfg"]')].map(i => i.value), toast: window.TOASTS.map(t => t[0]).join('|') }));
  check('C1 批號帶到空白列：第 2 列補成 L2611、原本有填的 X9 不動、沒酒名的那列不補', JSON.stringify(c1.lots) === JSON.stringify(['L2611', 'L2611', 'X9', '']) && /帶到其餘 1 列/.test(c1.toast));
  await page.evaluate(() => { window.TOASTS = []; document.getElementById('cs-vf-fillmfg').click(); });
  const c2 = await page.evaluate(() => ({ mfgs: [...document.querySelectorAll('#cs-vf-rows input[data-k="mfg"]')].map(i => i.value), toast: window.TOASTS.map(t => t[0]).join('|') }));
  check('C2 製造日期帶到空白列：拿第一個有填的（第 2 列）補到第 1、3 列', JSON.stringify(c2.mfgs) === JSON.stringify(['2026-11-20', '2026-11-20', '2026-11-20', '']) && /帶到其餘 2 列/.test(c2.toast));
  await page.evaluate(() => { window.TOASTS = []; document.getElementById('cs-vf-fillmfg').click(); });
  check('C3 都填滿了再按 → 講「都已經有填了」、不亂動', await page.evaluate(() => /都已經有填了/.test(window.TOASTS.map(t => t[0]).join('|'))));
  const c4 = await page.evaluate(() => { const keep = JSON.parse(JSON.stringify(CONSIGN_VF_DATA.rows)); document.querySelectorAll('#cs-vf-rows input[data-k="lot"]').forEach(i => { i.value = ''; }); window.TOASTS = []; csVfFillDown('lot'); const t = window.TOASTS.map(x => x[0] + '/' + x[1]).join('|'); CONSIGN_VF_DATA.rows = keep; buildConsignVerifyModal(); return t; });
  check('C4 一列都沒填就按 → 提示先填一列（紅字）', /請先在其中一列填好批號/.test(c4) && /\/err/.test(c4));

  // ---- D) 重畫不掉資料 ----
  await page.evaluate(() => { document.getElementById('cs-vf-date').value = '2026-11-28'; document.getElementById('cs-vf-handler').value = '阿軒'; document.getElementById('cs-vf-note').value = '南西店（B085）改送'; });
  await setVal(1, 'lot', 'L2611-B');
  await page.evaluate(() => csVfAddRow());
  const d1 = await page.evaluate(() => ({ date: document.getElementById('cs-vf-date').value, handler: document.getElementById('cs-vf-handler').value, note: document.getElementById('cs-vf-note').value,
    lots: [...document.querySelectorAll('#cs-vf-rows input[data-k="lot"]')].map(i => i.value), n: document.querySelectorAll('#cs-vf-rows tr').length }));
  check('D1 按「新增品項」重畫：表頭的日期／經手人／備註、剛改的批號都還在', d1.date === '2026-11-28' && d1.handler === '阿軒' && d1.note === '南西店（B085）改送' && d1.n === 5 && d1.lots[1] === 'L2611-B');
  await page.evaluate(() => { csVfDelRow(4); csVfDelRow(3); });
  const d2 = await page.evaluate(() => ({ date: document.getElementById('cs-vf-date').value, lots: [...document.querySelectorAll('#cs-vf-rows input[data-k="lot"]')].map(i => i.value), mfgs: [...document.querySelectorAll('#cs-vf-rows input[data-k="mfg"]')].map(i => i.value) }));
  check('D2 按「✕」刪掉空白列：其他列的批號／製造日期與表頭日期不變', d2.date === '2026-11-28' && JSON.stringify(d2.lots) === JSON.stringify(['L2611', 'L2611-B', 'X9']) && d2.mfgs.every(m => m === '2026-11-20'));

  // ---- E) 產生 → 留底 ----
  await page.evaluate(() => { window.CALLS = []; window.TOASTS = []; });
  await setVal(2, 'lot', ' <b>X9</b> '); await setVal(2, 'mfg', '');
  await page.waitForTimeout(300);
  await page.evaluate(() => generateConsignVerifyPdf());
  await page.waitForTimeout(600);
  const e1 = await page.evaluate(() => { const sv = window.CALLS.find(c => c.action === 'saveVerifyForm'); const doc = window.DOCS[window.DOCS.length - 1] || ''; return { rec: sv && sv.record, doc, closed: document.getElementById('cs-vf-overlay').style.display === 'none' }; });
  check('E1 留底 items 存批號／製造日期（去頭尾空白；沒填的存空字串）', e1.rec && e1.rec.no === 'CS-6-20261126120000' && e1.rec.items.length === 3
    && e1.rec.items[0].lot === 'L2611' && e1.rec.items[0].mfg === '2026-11-20' && e1.rec.items[1].lot === 'L2611-B' && e1.rec.items[2].lot === '<b>X9</b>' && e1.rec.items[2].mfg === '');
  check('E2 留底其他欄位照舊（數量、容量、日期、經手人、試飲標示 0）', e1.rec && e1.rec.shipDate === '2026-11-28' && e1.rec.pm === '阿軒' && e1.rec.items[0].thisShip === 10 && e1.rec.items[2].vol === '500ml' && e1.rec.items.every(it => it.taster === 0));
  check('E3 印出來的驗收單有兩欄、特殊字元有跳脫、視窗關掉', /<th style="width:14%">批號<\/th><th style="width:18%">製造日期<\/th>/.test(e1.doc) && e1.doc.indexOf('&lt;b&gt;X9&lt;/b&gt;') >= 0 && e1.doc.indexOf('<b>X9</b>') < 0 && /2026\/11\/20/.test(e1.doc) && e1.closed);

  // ---- F) 從留底重開都帶回 ----
  // F1 驗收管理
  await page.evaluate(() => { VM_DATA = { forms: window.VF.slice() }; window.TOASTS = []; return vmEditForm('VFN1'); });
  await page.waitForTimeout(300);
  const f1 = await page.evaluate(() => ({ edit: CONSIGN_VF_EDIT_ID, lots: [...document.querySelectorAll('#cs-vf-rows input[data-k="lot"]')].map(i => i.value), mfgs: [...document.querySelectorAll('#cs-vf-rows input[data-k="mfg"]')].map(i => i.value), open: document.getElementById('cs-vf-overlay').style.display }));
  check('F1 驗收管理編輯這張留底 → 批號／製造日期帶回輸入格', f1.open === 'flex' && f1.edit === 'VFN1' && JSON.stringify(f1.lots) === JSON.stringify(['L2611', 'L2611-B', '<b>X9</b>']) && JSON.stringify(f1.mfgs) === JSON.stringify(['2026-11-20', '2026-11-20', '']));
  await page.evaluate(() => closeConsignVerifyForm(true));
  // F2 進出貨明細那一批
  await page.evaluate(() => gotoPage('consign'));
  await page.waitForTimeout(300);
  await page.evaluate(async () => { await initConsignPage(true); document.getElementById('cs-customer').value = '6'; onSelectConsignCustomer(); });
  await page.waitForTimeout(700);
  await page.evaluate(() => { window.TOASTS = []; [...document.querySelectorAll('#cs-ledger-body .cs-vfbtn')].find(b => b.dataset.no === 'CS-6-20261121100000').click(); });
  await page.waitForTimeout(500);
  const f2 = await page.evaluate(() => ({ edit: CONSIGN_VF_EDIT_ID, no: CONSIGN_VF_DATA.no, lot: document.querySelector('#cs-vf-rows input[data-k="lot"]').value, mfg: document.querySelector('#cs-vf-rows input[data-k="mfg"]').value }));
  check('F2 明細「查看驗收單」→ 留底的批號 L2611A／製造日期 2026-11-18 帶回', f2.edit === 'VFA' && f2.no === 'CS-6-20261121100000' && f2.lot === 'L2611A' && f2.mfg === '2026-11-18');
  await page.evaluate(() => closeConsignVerifyForm(true));
  // F3 廠務待出貨（已先開過的那張；製造日期留底存成 2026/11/20）
  await page.evaluate(() => { window.TOASTS = []; document.querySelector('#cs-fxpending-body .cs-pvfbtn').click(); });
  await page.waitForTimeout(500);
  const f3 = await page.evaluate(() => ({ edit: CONSIGN_VF_EDIT_ID, no: CONSIGN_VF_DATA.no, lots: [...document.querySelectorAll('#cs-vf-rows input[data-k="lot"]')].map(i => i.value), mfgs: [...document.querySelectorAll('#cs-vf-rows input[data-k="mfg"]')].map(i => i.value) }));
  check('F3 廠務待出貨「查看驗收單」→ 批號帶回；留底存成 2026/11/20 的製造日期也認得', f3.edit === 'VFB' && f3.no === 'CS-6-20261123900101' && JSON.stringify(f3.lots) === JSON.stringify(['L2611B', '']) && JSON.stringify(f3.mfgs) === JSON.stringify(['2026-11-20', '']));
  // G) 重存：斜線寫法整理成 YYYY-MM-DD、印成 YYYY/MM/DD
  await page.evaluate(() => { window.CALLS = []; generateConsignVerifyPdf(); });
  await page.waitForTimeout(700);
  const g1 = await page.evaluate(() => { const sv = window.CALLS.find(c => c.action === 'saveVerifyForm'); const doc = window.DOCS[window.DOCS.length - 1] || ''; return { items: sv && sv.record.items, del: window.CALLS.some(c => c.action === 'deleteVerifyForm' && c.id === 'VFB'), docOk: /2026\/11\/20/.test(doc) && doc.indexOf('L2611B') >= 0 }; });
  check('G1 重新產生：製造日期存成 2026-11-20、印成 2026/11/20；舊留底被取代', g1.items && g1.items[0].mfg === '2026-11-20' && g1.items[0].lot === 'L2611B' && g1.items[1].mfg === '' && g1.del && g1.docOk);
  const g2 = await page.evaluate(() => [csVfYmd('2026-11-05'), csVfYmd('2026/11/5'), csVfYmd('2026.1.9'), csVfYmd('2026-11-20T00:00:00.000Z'), csVfYmd(''), csVfYmd(null), csVfYmd('11月製')].join('|'));
  check('G2 csVfYmd：橫線／斜線／點都整理成 YYYY-MM-DD，認不得的回空字串', g2 === '2026-11-05|2026-11-05|2026-01-09|2026-11-20|||');

  // ---- H) 試飲瓶列照舊 ----
  await page.evaluate(() => openConsignVerifyForm({ no: 'CS-6-20261126130000', client: '誠品生活', shipDate: '2026-11-27', handler: '', note: '',
    rows: [{ name: '蜜香紅茶荔枝琴酒', vol: '100ml', qty: 10, lot: 'L1' }, { name: '蜜香紅茶荔枝琴酒', vol: '500ml', qty: 1, taster: true }] }));
  const h1 = await docOf();
  const h1b = await page.evaluate(() => ({ tasterNote: /試飲瓶（免費贈送/.test(document.getElementById('cs-vf-rows').textContent), keys: [...document.querySelectorAll('#cs-vf-rows tr')][1].querySelectorAll('input').length }));
  check('H1 試飲瓶列照舊標示、一樣有批號／製造日期格；驗收單上「試飲」標籤還在', h1b.tasterNote && h1b.keys === 5 && /試飲/.test(h1.rows[1][0]) && h1.rows[0].join('|') === '蜜香紅茶荔枝琴酒|L1|100ml|10' && h1.rows[1][1] === '—');
  await page.evaluate(() => closeConsignVerifyForm(true));

  check('00 零 JS 例外／console error', errors.length === 0);
  results.forEach(r => console.log(r[0], r[1]));
  const fails = results.filter(r => r[0] === 'FAIL').length;
  console.log(`\n${results.length - fails}/${results.length} PASS${fails ? ' — ' + fails + ' FAIL' : ''}`);
  if (errors.length) console.log('errors:', errors.slice(0, 5));
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
