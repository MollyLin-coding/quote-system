/* 2026-09-23 寄售複檢 B6／B7 的離線測試（純前端）
   B6 驗收單單號兩邊算法對不上 → 重複留底
      1) 登記鋪貨後跳出的驗收單單號＝csLedBatchNo(後端回傳 created_at)，跟明細那顆鈕算出來的一樣
      2) 純試飲瓶（沒寫帳）退回當下時間單號（CS-<客戶>-YYYYMMDD…）
      3) csLedAssignVf：單號完全相同優先；差 5 秒的舊留底認得回來；差 20 分鐘不認；一張留底只配最接近的一批
      4) 明細鈕：舊留底（差幾秒）那批顯示「查看驗收單」、同一天另一批顯示「補開驗收單」
      5) 舊留底那批按「查看」→ 走取代模式，而且沿用舊留底的單號（紙本 QR 印的是那個號）
   B7 純試飲瓶關掉驗收單視窗＝零筆資料但 toast 說已登記
      6) 純試飲瓶登記的 toast 不再說「已登記」，改提醒要按「產生驗收單」
      7) 有試飲瓶的新單：CONSIGN_VF_PENDING_TASTER＝true、「跳過」鈕文字加註「試飲瓶不會登記」
      8) 按 ✕／跳過 → 先 confirm；取消＝視窗留著、旗標不清
      9) confirm 確定＝關掉、旗標清掉
     10) 按「產生驗收單」→ 有留底（saveVerifyForm）、旗標清掉、視窗關掉、不問
     11) 沒登入按「產生驗收單」→ 視窗留著、不留底（只 toast）
     12) 從留底重開（editId）→ 旗標 false，關窗不問
     13) 沒有試飲瓶的一般鋪貨單 → 旗標 false，關窗不問
*/
const { chromium } = require('/opt/node-tools/node_modules/playwright');

const PRODUCTS = [
  { sku_id: '蜜香紅茶荔枝琴酒|100ml', name: '蜜香紅茶荔枝琴酒', volume: '100ml', list_price: 320, active: 'Y' },
  { sku_id: '茉莉香片脆梅琴酒|100ml', name: '茉莉香片脆梅琴酒', volume: '100ml', list_price: 320, active: 'Y' },
  { sku_id: '泰奶烏龍蘭姆酒|100ml', name: '泰奶烏龍蘭姆酒', volume: '100ml', list_price: 320, active: 'Y' },
];
const CUSTOMERS = [{ customer_id: '4', name: '島羽Wing Islands', default_discount: 0.7, billing_day: '', active: 'Y' }];
// 線上真實情境：9/11 同一天三批（15:23:05／15:28:41／15:32:49），只有一張舊留底 CS-4-20260911153254（差 5 秒）
const LEDGER = [
  { movement_id:'CM-7', date:'2026-09-11', customer_id:4, sku_id:'泰奶烏龍蘭姆酒|100ml', type:'in', qty:5, note:'特規單', created_at:'2026-09-11T15:32:49+08:00' },
  { movement_id:'CM-8', date:'2026-09-11', customer_id:4, sku_id:'茉莉香片脆梅琴酒|100ml', type:'in', qty:5, note:'特規單', created_at:'2026-09-11T15:32:49+08:00' },
  { movement_id:'CM-4', date:'2026-09-11', customer_id:4, sku_id:'蜜香紅茶荔枝琴酒|100ml', type:'in', qty:10, note:'', created_at:'2026-09-11T15:28:41+08:00' },
  { movement_id:'CM-1', date:'2026-09-11', customer_id:4, sku_id:'蜜香紅茶荔枝琴酒|100ml', type:'in', qty:10, note:'', created_at:'2026-09-11T15:23:05+08:00' },
];
const OLD_NO = 'CS-4-20260911153254';
const BATCH_1532 = 'CS-4-20260911153249', BATCH_1528 = 'CS-4-20260911152841', BATCH_1523 = 'CS-4-20260911152305';

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  const isNoise = t => /Failed to load resource|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|favicon/i.test(t);
  page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('CONSOLE: ' + m.text()); });
  page.on('dialog', d => d.accept());

  await page.goto('http://localhost:8899/index.html');
  await page.waitForFunction(() => {
    const s = document.getElementById('login-user');
    return !s || !/載入中/.test(s.innerHTML);
  }, { timeout: 15000 }).catch(() => {});
  await page.evaluate(({ PRODUCTS, CUSTOMERS, LEDGER }) => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 'test-token';
    window.CALLS = []; window.TOASTS = []; window.CONFIRMS = []; window.CONFIRM_ANSWER = true;
    window.confirm = (msg) => { window.CONFIRMS.push(String(msg)); return window.CONFIRM_ANSWER; };
    window.alert = () => {};
    window.toast = (msg, type) => { window.TOASTS.push([String(msg), type || '']); };
    window.open = () => ({ document: { open(){}, write(){}, close(){} } });
    window.VF_RECORDS = [];
    window.SAVED_CREATED_AT = '2026-09-23T10:20:30+08:00';
    window.apiCall = async (payload) => {
      window.CALLS.push(JSON.parse(JSON.stringify(payload)));
      switch (payload.action) {
        case 'getOwnbrandProducts': return { ok: true, products: PRODUCTS };
        case 'getOwnbrandTiers':    return { ok: true, tiers: [], terms: {} };
        case 'getConsignCustomers': return { ok: true, customers: CUSTOMERS, discounts: [] };
        case 'getConsignInventory': return { ok: true, inventory: [], deposit_held_by_customer: {} };
        case 'getConsignLedger':    return { ok: true, rows: LEDGER };
        case 'listVerifyForms':     return { ok: true, records: window.VF_RECORDS, summary: {} };
        case 'getVerifyKey':        return { ok: true, k: 'TESTKEY' };
        case 'addConsignMovements': return { ok: true, movements: (payload.movements||[]).map((m,i)=>({...m, movement_id:'CM-N'+i, created_at: window.SAVED_CREATED_AT})) };
        case 'saveVerifyForm':      return { ok: true, id: 'VF-NEW' };
        case 'deleteVerifyForm':    return { ok: true };
        default: return { ok: true, quotes: [], orders: [], records: [], shipments: [], rows: [] };
      }
    };
  }, { PRODUCTS, CUSTOMERS, LEDGER });

  const results = [];
  const check = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);

  await page.evaluate(() => gotoPage('consign'));
  await page.waitForTimeout(200);
  await page.evaluate(async () => { await initConsignPage(true); });
  await page.evaluate(() => { document.getElementById('cs-customer').value = '4'; onSelectConsignCustomer(); });
  await page.waitForTimeout(600);
  await page.evaluate(async () => { await loadOwnbrandData(); });

  /* ---------- B6 ---------- */
  // 1) 登記鋪貨（勾產生驗收單）→ 單號＝後端 created_at 推出來的
  await page.evaluate(async () => {
    window.CALLS = []; window.TOASTS = [];
    openConsignMove();
    document.getElementById('cs-m-type').value = 'in'; onConsignMoveType && onConsignMoveType();
    document.getElementById('cs-m-date').value = '2026-09-23';
    csMoveItems = [{ id: 1, sku: '蜜香紅茶荔枝琴酒|100ml', qty: 6, taster: false, tasterQty: 1, tasterVol: '100ml' }];
    renderCsMoveItems();
    const cb = document.getElementById('cs-m-genvf'); if (cb) { cb.disabled = false; cb.checked = true; }
    await saveConsignMove();
  });
  await page.waitForTimeout(400);
  const r1 = await page.evaluate(() => ({
    open: document.getElementById('cs-vf-overlay') && document.getElementById('cs-vf-overlay').style.display === 'flex',
    no: CONSIGN_VF_DATA && CONSIGN_VF_DATA.no,
    expect: csLedBatchNo('4', { created_at: window.SAVED_CREATED_AT }),
    pending: CONSIGN_VF_PENDING_TASTER,
  }));
  check('1a 登記鋪貨後驗收單有跳出', r1.open === true);
  check('1b 單號＝csLedBatchNo(後端 created_at)＝CS-4-20260923102030', r1.no === 'CS-4-20260923102030' && r1.no === r1.expect);
  check('13 沒有試飲瓶的一般鋪貨單 → 旗標 false', r1.pending === false);
  const c13 = await page.evaluate(() => { window.CONFIRMS = []; closeConsignVerifyForm(); return { asked: window.CONFIRMS.length, open: document.getElementById('cs-vf-overlay').style.display === 'flex' }; });
  check('13b 關窗不問、直接關', c13.asked === 0 && c13.open === false);

  // 2) 純試飲瓶（沒寫帳）→ 單號退回當下時間；6) toast 不再說「已登記」
  await page.evaluate(async () => {
    window.CALLS = []; window.TOASTS = [];
    openConsignMove();
    document.getElementById('cs-m-type').value = 'in'; onConsignMoveType && onConsignMoveType();
    document.getElementById('cs-m-date').value = '2026-09-23';
    csMoveItems = [{ id: 1, sku: '茉莉香片脆梅琴酒|100ml', qty: '', taster: true, tasterQty: 2, tasterVol: '100ml' }];
    renderCsMoveItems(); csMoveGenvfLock();
    await saveConsignMove();
  });
  await page.waitForTimeout(400);
  const r2 = await page.evaluate(() => ({
    no: CONSIGN_VF_DATA && CONSIGN_VF_DATA.no,
    wroteLedger: window.CALLS.some(c => c.action === 'addConsignMovements'),
    toasts: window.TOASTS.map(t => t[0]).join(' || '),
    pending: CONSIGN_VF_PENDING_TASTER,
    skip: (document.getElementById('cs-vf-skip') || {}).textContent || '',
    open: document.getElementById('cs-vf-overlay').style.display === 'flex',
  }));
  const today = new Date(); const p = x => String(x).padStart(2, '0');
  const ymd = today.getFullYear() + p(today.getMonth() + 1) + p(today.getDate());
  check('2a 純試飲瓶沒寫進帳', r2.wroteLedger === false);
  check('2b 單號退回當下時間（CS-4-今天日期…）', typeof r2.no === 'string' && r2.no.indexOf('CS-4-' + ymd) === 0 && r2.no.length === 'CS-4-'.length + 14);
  check('6a toast 不再說「已登記試飲瓶」', !/已登記試飲瓶/.test(r2.toasts));
  check('6b toast 提醒要按「產生驗收單」才算登記完成', /產生驗收單/.test(r2.toasts) && /登記完成/.test(r2.toasts));
  check('7a 有試飲瓶的新單 → CONSIGN_VF_PENDING_TASTER＝true', r2.pending === true && r2.open === true);
  check('7b 「跳過」鈕文字加註試飲瓶不會登記', /試飲瓶不會登記/.test(r2.skip));

  // 8) 按跳過 → confirm；取消＝留著
  const r8 = await page.evaluate(() => {
    window.CONFIRMS = []; window.CONFIRM_ANSWER = false;
    closeConsignVerifyForm();
    return { asked: window.CONFIRMS.length, msg: window.CONFIRMS[0] || '', open: document.getElementById('cs-vf-overlay').style.display === 'flex', pending: CONSIGN_VF_PENDING_TASTER };
  });
  check('8a 關窗前先 confirm，訊息講明試飲瓶不會登記', r8.asked === 1 && /試飲瓶/.test(r8.msg) && /沒有/.test(r8.msg));
  check('8b 取消＝視窗留著、旗標不清', r8.open === true && r8.pending === true);
  // 9) confirm 確定＝關掉
  const r9 = await page.evaluate(() => {
    window.CONFIRMS = []; window.CONFIRM_ANSWER = true;
    closeConsignVerifyForm();
    return { asked: window.CONFIRMS.length, open: document.getElementById('cs-vf-overlay').style.display === 'flex', pending: CONSIGN_VF_PENDING_TASTER };
  });
  check('9 確定＝關掉、旗標清掉', r9.asked === 1 && r9.open === false && r9.pending === false);

  // 10) 產生驗收單 → 留底、旗標清、關窗、不問
  await page.evaluate(async () => {
    window.CALLS = []; window.TOASTS = []; window.CONFIRMS = [];
    openConsignMove();
    document.getElementById('cs-m-type').value = 'in'; onConsignMoveType && onConsignMoveType();
    document.getElementById('cs-m-date').value = '2026-09-23';
    csMoveItems = [{ id: 1, sku: '茉莉香片脆梅琴酒|100ml', qty: '', taster: true, tasterQty: 1, tasterVol: '100ml' }];
    renderCsMoveItems(); csMoveGenvfLock();
    await saveConsignMove();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.CALLS = []; generateConsignVerifyPdf(); });
  await page.waitForTimeout(300);
  const r10 = await page.evaluate(() => ({
    saved: window.CALLS.some(c => c.action === 'saveVerifyForm' && (c.record.items || []).some(it => it.taster)),
    asked: window.CONFIRMS.length, open: document.getElementById('cs-vf-overlay').style.display === 'flex', pending: CONSIGN_VF_PENDING_TASTER,
  }));
  check('10 產生驗收單 → 留底（含試飲標示）、不問、關窗、旗標清', r10.saved && r10.asked === 0 && r10.open === false && r10.pending === false);

  // 11) 沒登入 → 視窗留著、不留底
  await page.evaluate(async () => {
    window.CALLS = []; window.TOASTS = []; window.CONFIRMS = [];
    openConsignMove();
    document.getElementById('cs-m-type').value = 'in'; onConsignMoveType && onConsignMoveType();
    document.getElementById('cs-m-date').value = '2026-09-23';
    csMoveItems = [{ id: 1, sku: '茉莉香片脆梅琴酒|100ml', qty: '', taster: true, tasterQty: 1, tasterVol: '100ml' }];
    renderCsMoveItems(); csMoveGenvfLock();
    await saveConsignMove();
  });
  await page.waitForTimeout(300);
  const r11 = await page.evaluate(() => {
    const keep = AUTH_TOKEN; AUTH_TOKEN = null; window.CALLS = []; window.TOASTS = [];
    generateConsignVerifyPdf();
    const out = { saved: window.CALLS.some(c => c.action === 'saveVerifyForm'), open: document.getElementById('cs-vf-overlay').style.display === 'flex',
      pending: CONSIGN_VF_PENDING_TASTER, toast: window.TOASTS.map(t => t[0]).join('|') };
    AUTH_TOKEN = keep; window.CONFIRM_ANSWER = true; closeConsignVerifyForm();
    return out;
  });
  check('11 沒登入按產生 → 不留底、視窗留著、旗標不清、有提示', r11.saved === false && r11.open === true && r11.pending === true && /沒有登入|重新登入/.test(r11.toast));

  // 3) csLedAssignVf 純函式
  const r3 = await page.evaluate((OLD_NO) => {
    if (typeof csLedAssignVf !== 'function') return null;
    const recs = [{ id: 'VF-OLD', no: OLD_NO }, { id: 'VF-EXACT', no: 'CS-4-20260911152841' }];
    const a = csLedAssignVf(recs, ['CS-4-20260911153249', 'CS-4-20260911152841', 'CS-4-20260911152305']);
    const b = csLedAssignVf([{ id: 'VF-FAR', no: 'CS-4-20260911160000' }], ['CS-4-20260911153249']);   // 差 27 分鐘 → 不認
    const c = csLedAssignVf([{ id: 'VF-OTHER', no: 'CS-2-20260911153254' }], ['CS-4-20260911153249']);  // 別的客戶 → 不認
    return { a, bEmpty: Object.keys(b).length === 0, cEmpty: Object.keys(c).length === 0 };
  }, OLD_NO);
  check('3a 單號完全相同優先配到', r3 && r3.a['CS-4-20260911152841'] && r3.a['CS-4-20260911152841'].id === 'VF-EXACT');
  check('3b 差 5 秒的舊留底配給最接近那批（15:32:49），並回傳留底實際單號', r3 && r3.a['CS-4-20260911153249'] && r3.a['CS-4-20260911153249'].id === 'VF-OLD' && r3.a['CS-4-20260911153249'].no === OLD_NO);
  check('3c 一張留底只配一批（15:23 那批沒配到）', r3 && !r3.a['CS-4-20260911152305']);
  check('3d 差 27 分鐘不認、別的客戶不認', r3 && r3.bEmpty && r3.cEmpty);

  // 4) 明細鈕文字
  await page.evaluate(async (OLD_NO) => {
    window.VF_RECORDS = [{ id: 'VF-OLD', no: OLD_NO, client: '島羽Wing Islands', ship_date: '2026-09-10', pm: '',
      items_json: JSON.stringify([{ name: '泰奶烏龍蘭姆酒', vol: '100ml', thisShip: 5, ordered: 5 }, { name: '茉莉香片脆梅琴酒', vol: '100ml', thisShip: 5, ordered: 5 }]) }];
    rcClear(); await loadConsignLedger();
  }, OLD_NO);
  await page.waitForTimeout(500);
  const r4 = await page.evaluate(() => {
    const o = {}; document.querySelectorAll('#cs-ledger-body .cs-vfbtn').forEach(b => o[b.dataset.no] = b.textContent + '|' + (b.classList.contains('primary') ? 'gold' : '-'));
    return o;
  });
  check('4a 三批各一顆鈕', Object.keys(r4).length === 3 && r4[BATCH_1532] && r4[BATCH_1528] && r4[BATCH_1523]);
  check('4b 舊留底（差 5 秒）那批＝「查看驗收單」', r4[BATCH_1532] === '查看驗收單|-');
  check('4c 同一天另外兩批＝「補開驗收單」（金色）', r4[BATCH_1528] === '補開驗收單|gold' && r4[BATCH_1523] === '補開驗收單|gold');

  // 5) 舊留底那批按查看 → 取代模式＋沿用舊單號
  await page.evaluate(async (no) => {
    const i = [...document.querySelectorAll('#cs-ledger-body .cs-vfbtn')].find(b => b.dataset.no === no).dataset.b;
    await csReopenVerify(i);
  }, BATCH_1532);
  await page.waitForTimeout(300);
  const r5 = await page.evaluate(() => ({ editId: CONSIGN_VF_EDIT_ID, no: CONSIGN_VF_DATA && CONSIGN_VF_DATA.no, n: CONSIGN_VF_DATA.rows.length, pending: CONSIGN_VF_PENDING_TASTER,
    open: document.getElementById('cs-vf-overlay').style.display === 'flex' }));
  check('5a 走取代模式（editId＝舊留底）', r5.editId === 'VF-OLD' && r5.open === true);
  check('5b 沿用舊留底的單號（不換成推算單號）', r5.no === OLD_NO);
  check('5c 內容以留底為準（2 列）', r5.n === 2);
  check('12 從留底重開 → 旗標 false', r5.pending === false);
  const c12 = await page.evaluate(() => { window.CONFIRMS = []; closeConsignVerifyForm(); return { asked: window.CONFIRMS.length, open: document.getElementById('cs-vf-overlay').style.display === 'flex' }; });
  check('12b 關窗不問', c12.asked === 0 && c12.open === false);

  // 沒留底那批按補開 → 新開、單號＝推算單號
  await page.evaluate(async (no) => {
    const i = [...document.querySelectorAll('#cs-ledger-body .cs-vfbtn')].find(b => b.dataset.no === no).dataset.b;
    await csReopenVerify(i);
  }, BATCH_1523);
  await page.waitForTimeout(300);
  const r5b = await page.evaluate(() => ({ editId: CONSIGN_VF_EDIT_ID, no: CONSIGN_VF_DATA && CONSIGN_VF_DATA.no }));
  check('5d 沒留底那批補開 → 新開、單號＝推算單號', r5b.editId === null && r5b.no === BATCH_1523);
  await page.evaluate(() => closeConsignVerifyForm());

  check('0 零 JS 例外／console error', errors.length === 0);

  results.forEach(r => console.log(r[0], r[1]));
  const fails = results.filter(r => r[0] === 'FAIL').length;
  console.log(`\n${results.length - fails}/${results.length} PASS${fails ? ' — ' + fails + ' FAIL' : ''}`);
  if (errors.length) console.log('errors:', errors.slice(0, 5));
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
