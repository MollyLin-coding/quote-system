/* 2026-09-23 寄售 × 廠務（前端，js/08_ownbrand.js）離線測試
    1) 進寄售頁會走讀取快取問 getFactoryConsignDealers（只打一趟）；狀態列顯示最近同步時間＋沒對到的經銷商
    2) 客戶資訊列：已連結廠務的客戶多一段「🔗 已連結廠務「島羽 Wing Islands」」；沒連結的沒有
    3) 「同步廠務」鈕：呼叫 factoryConsignSync（帶 token）→ toast 摘要（新增／對上／沒對到）→ 重抓庫存明細
    4) 登記異動視窗：已連結客戶顯示提醒橫幅（不硬擋）；沒連結的客戶不顯示
    5) 客戶設定：下拉列出廠務經銷商、預選目前對應、別人已對走的那家 disabled；存檔時對應有變才打 saveFactoryMap（kind consign_client）
       ；沒變不打
    6) 明細：廠務同步進來的列標「廠務 260902-002」、備註本文不顯示 [FXC:…] 標記；同一張廠務訂單的 2 款鋪貨只給 1 顆驗收單鈕，
       單號用該批最早的 created_at 推；手動登的那批照舊各自一顆
    7) 廠務沒設定（configured=false）→ 同步鈕藏起來、客戶設定不顯示下拉
*/
const { chromium } = require('/opt/node-tools/node_modules/playwright');

const PRODUCTS = [
  { sku_id: '蜜香紅茶荔枝琴酒|100ml', name: '蜜香紅茶荔枝琴酒', volume: '100ml', list_price: 320, active: 'Y' },
  { sku_id: '茉莉香片脆梅琴酒|100ml', name: '茉莉香片脆梅琴酒', volume: '100ml', list_price: 320, active: 'Y' },
];
const CUSTOMERS = [
  { customer_id: '4', name: '島羽Wing Islands', default_discount: 0.7, billing_day: 30, active: 'Y' },
  { customer_id: '2', name: 'downstairs', default_discount: 0.75, billing_day: 5, active: 'Y' },
];
const DEALERS = [
  { key: '經銷商－島羽', label: '島羽 Wing Islands', enabled: true, discount: 0.7, closeDay: 30 },
  { key: '經銷商－downstair', label: 'downstair', enabled: true, discount: 0.7, closeDay: 30 },
  { key: '經銷商－誠品生活', label: '誠品生活', enabled: true, discount: 0.65, closeDay: 5 },
];
const MAP = [{ kind: 'consign_client', qs_name: '4', factory_name: '經銷商－島羽', note: '' }];
const LEDGER = [
  { movement_id:'CM-20260918-0001', date:'2026-09-18', customer_id:4, sku_id:'蜜香紅茶荔枝琴酒|100ml', type:'in', qty:10, note:'[FXC:CI-A1|260917-001#1] 廠務 260917-001 第1次／Kevin：訂單出貨 第 1 次', created_at:'2026-09-18T10:00:00+08:00' },
  { movement_id:'CM-20260918-0002', date:'2026-09-18', customer_id:4, sku_id:'茉莉香片脆梅琴酒|100ml', type:'in', qty:10, note:'[FXC:CI-A2|260917-001#2] 廠務 260917-001 第2次／Kevin：訂單出貨 第 2 次', created_at:'2026-09-18T11:30:00+08:00' },
  { movement_id:'CM-20260919-0001', date:'2026-09-19', customer_id:4, sku_id:'蜜香紅茶荔枝琴酒|100ml', type:'out', qty:2, unit_price:140, note:'[FXC:CI-A3] 廠務／島羽', created_at:'2026-09-19T20:00:00+08:00' },
  { movement_id:'CM-20260911-0007', date:'2026-09-11', customer_id:4, sku_id:'蜜香紅茶荔枝琴酒|100ml', type:'in', qty:5, note:'手動登的特規單', created_at:'2026-09-11T15:32:49+08:00' },
];

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  const isNoise = t => /Failed to load resource|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|favicon/i.test(t);
  page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('CONSOLE: ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto('http://localhost:8899/index.html');
  await page.waitForFunction(() => { const s = document.getElementById('login-user'); return !s || !/載入中/.test(s.innerHTML); }, { timeout: 15000 }).catch(() => {});
  await page.evaluate(({ PRODUCTS, CUSTOMERS, LEDGER, DEALERS, MAP }) => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 'test-token';
    window.CALLS = []; window.TOASTS = [];
    window.confirm = () => true; window.alert = () => {};
    window.toast = (msg, type) => { window.TOASTS.push([String(msg), type || '']); };
    window.FX_CONFIGURED = true; window.FX_MAP = MAP.map(m => ({ ...m }));
    window.apiCall = async (payload) => {
      window.CALLS.push(JSON.parse(JSON.stringify(payload)));
      switch (payload.action) {
        case 'getOwnbrandProducts': return { ok: true, products: PRODUCTS };
        case 'getOwnbrandTiers':    return { ok: true, tiers: [], terms: {} };
        case 'getConsignCustomers': return { ok: true, customers: CUSTOMERS, discounts: [] };
        case 'getConsignInventory': return { ok: true, inventory: [], deposit_held_by_customer: {} };
        case 'getConsignLedger':    return { ok: true, rows: LEDGER };
        case 'listVerifyForms':     return { ok: true, records: [], summary: {} };
        case 'getFactoryConsignDealers': return { ok: true, configured: window.FX_CONFIGURED, dealers: window.FX_CONFIGURED ? DEALERS : [], map: window.FX_MAP, lastSync: '2026-09-23T11:00:00+08:00', since: '2026-09-16 00:00:00' };
        case 'factoryConsignSync':  if (typeof rcClear === 'function') rcClear();   // 真的 apiCall 對寫入 action 會清讀取快取，這裡照做
                                    return { ok: true, inserted: [{ fx: 'CI-N1' }, { fx: 'CI-N2' }], linked: [{ fx: 'CI-L1' }], skipped: [], unmappedDealers: { '經銷商－誠品生活': 3 }, unmappedProducts: {}, ambiguous: {}, autoMapped: [], dealerMap: {}, dealers: DEALERS, at: '2026-09-23T12:34:00+08:00' };
        case 'saveFactoryMap':      return { ok: true, saved: 1, removed: 0 };
        case 'saveConsignCustomer': return { ok: true, customer: payload.customer };
        default: return { ok: true, quotes: [], orders: [], records: [], shipments: [], rows: [] };
      }
    };
  }, { PRODUCTS, CUSTOMERS, LEDGER, DEALERS, MAP });

  const results = []; const check = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);
  const has = f => page.evaluate(f => typeof window[f] === 'function', f);
  check('0 新函式都在', (await has('csFxLoad')) && (await has('csFxSyncNow')) && (await has('csFxFillDealerSelect')) && (await has('csFxTag')));

  await page.evaluate(() => gotoPage('consign'));
  await page.waitForTimeout(200);
  await page.evaluate(async () => { await initConsignPage(true); });
  await page.waitForTimeout(300);
  // gotoPage 自己也會跑一次 initConsignPage（掛勾）；這裡看「再進一次頁」有沒有靠讀取快取不重打
  await page.evaluate(async () => { window.CALLS = []; await initConsignPage(false); });
  const s1 = await page.evaluate(() => ({
    calls: window.CALLS.filter(c => c.action === 'getFactoryConsignDealers').length,
    calls0: (CS_FX.loaded && CS_FX.dealers.length === 3) ? 1 : 0,
    tokenOk: window.CALLS.filter(c => c.action === 'getFactoryConsignDealers').every(c => c.token === 'test-token'),
    status: document.getElementById('cs-fxstatus').textContent,
    btn: document.getElementById('cs-fxsync-btn').style.display !== 'none',
    readWhitelisted: typeof rcIsRead === 'function' && rcIsRead('getFactoryConsignDealers'),
  }));
  check('1a 再進頁走讀取快取不重打 getFactoryConsignDealers（在讀取白名單）；資料已載', s1.calls === 0 && s1.calls0 === 1 && s1.readWhitelisted);
  check('1b 狀態列：最近同步時間', /2026-09-23 11:00/.test(s1.status));
  check('1c 狀態列：沒對到的經銷商點名（downstair、誠品生活）', /還沒對到/.test(s1.status) && /downstair/.test(s1.status) && /誠品生活/.test(s1.status) && !/島羽/.test(s1.status));
  check('1d 同步鈕顯示', s1.btn === true);

  // 2) 客戶資訊列
  await page.evaluate(() => { document.getElementById('cs-customer').value = '4'; onSelectConsignCustomer(); });
  await page.waitForTimeout(500);
  const info4 = await page.evaluate(() => document.getElementById('cs-cusinfo').textContent);
  check('2a 島羽（已連結）資訊列有 🔗 已連結廠務「島羽 Wing Islands」', /已連結廠務「島羽 Wing Islands」/.test(info4));
  // 6) 明細
  const led = await page.evaluate(() => {
    const trs = [...document.querySelectorAll('#cs-ledger-body tr')];
    const notes = trs.map(tr => tr.children[5].textContent);
    const tags = trs.map(tr => !!tr.querySelector('.cs-fxtag'));
    const btns = [...document.querySelectorAll('#cs-ledger-body .cs-vfbtn')].map(b => b.dataset.no);
    return { n: trs.length, notes, tags, btns, batches: CS_LED_BATCHES.map(b => ({ no: b.no, n: b.rows.length, fxOrder: b.fxOrder, note: b.note })) };
  });
  check('6a 4 列都畫出來', led.n === 4);
  check('6b 廠務列有「廠務 260917-001」標籤、手動列沒有', led.tags.filter(Boolean).length === 3 && led.tags[3] === false && led.notes.filter(t => /廠務\s*260917-001/.test(t)).length === 2 && /^廠務廠務／島羽$/.test(led.notes[0].replace(/\s+/g, '')));
  check('6c 備註本文不顯示 [FXC:…] 標記', led.notes.every(t => t.indexOf('[FXC:') < 0) && led.notes.some(t => /訂單出貨 第 1 次/.test(t)) && led.notes[3] === '手動登的特規單');
  check('6d 同一張廠務訂單 2 款＝1 批 1 顆鈕；手動那批另 1 顆 → 共 2 顆', led.btns.length === 2);
  check('6e 廠務批單號用最早的 created_at（10:00）推', led.btns.includes('CS-4-20260918100000') && led.batches.some(b => b.fxOrder === '260917-001' && b.n === 2 && b.no === 'CS-4-20260918100000' && b.note.indexOf('[FXC:') < 0));
  check('6f 手動那批單號照舊', led.btns.includes('CS-4-20260911153249'));

  // 4) 登記異動橫幅
  await page.evaluate(() => openConsignMove());
  const ban4 = await page.evaluate(() => { const b = document.getElementById('cs-m-fxbanner'); return { shown: b.style.display !== 'none', text: b.textContent }; });
  check('4a 已連結客戶：登記異動顯示提醒橫幅（提醒不擋）', ban4.shown && /島羽 Wing Islands/.test(ban4.text) && /不用在這裡再登一次/.test(ban4.text));
  await page.evaluate(() => closeConsignMove());
  await page.evaluate(() => { document.getElementById('cs-customer').value = '2'; onSelectConsignCustomer(); });
  await page.waitForTimeout(400);
  const info2 = await page.evaluate(() => document.getElementById('cs-cusinfo').textContent);
  check('2b downstairs（沒連結）資訊列沒有 🔗', !/已連結廠務/.test(info2));
  await page.evaluate(() => openConsignMove());
  const ban2 = await page.evaluate(() => document.getElementById('cs-m-fxbanner').style.display !== 'none');
  check('4b 沒連結客戶：不顯示橫幅', ban2 === false);
  await page.evaluate(() => closeConsignMove());

  // 3) 同步鈕
  await page.evaluate(async () => { window.CALLS = []; window.TOASTS = []; await csFxSyncNow(document.getElementById('cs-fxsync-btn')); });
  await page.waitForTimeout(400);
  const s3 = await page.evaluate(() => ({
    call: window.CALLS.find(c => c.action === 'factoryConsignSync'),
    toast: window.TOASTS.map(t => t[0]).join(' || '),
    reloaded: window.CALLS.some(c => c.action === 'getConsignLedger') && window.CALLS.some(c => c.action === 'getConsignInventory'),
    status: document.getElementById('cs-fxstatus').textContent,
    btnText: document.getElementById('cs-fxsync-btn').textContent,
  }));
  check('3a 呼叫 factoryConsignSync（帶 token）', !!s3.call && s3.call.token === 'test-token');
  check('3b toast 摘要：新增 2／對上 1／1 家沒對到', /新增 2 筆/.test(s3.toast) && /1 筆跟妳手動登過的對上/.test(s3.toast) && /1 家經銷商還沒對到/.test(s3.toast));
  check('3c 同步後重抓庫存＋明細', s3.reloaded === true);
  check('3d 狀態列更新成這次同步時間', /2026-09-23 12:34/.test(s3.status));
  check('3e 鈕復原', /同步廠務/.test(s3.btnText));

  // 5) 客戶設定下拉
  await page.evaluate(() => openConsignCustomerEdit('2'));
  await page.waitForTimeout(400);
  const f5 = await page.evaluate(() => {
    const sel = document.getElementById('cs-f-fxdealer');
    return { shown: sel.closest('.fl').style.display !== 'none', opts: [...sel.options].map(o => o.value + '|' + o.textContent + '|' + (o.disabled ? 'D' : '')), val: sel.value };
  });
  check('5a 下拉列出 3 家經銷商＋不連結；downstairs 目前沒對應', f5.shown && f5.opts.length === 4 && f5.val === '');
  check('5b 島羽那家已被客戶 4 對走 → disabled＋標示', f5.opts.some(o => /經銷商－島羽\|.*已對到 島羽Wing Islands.*\|D$/.test(o)));
  // 存檔：選 downstair → saveConsignCustomer 之後打 saveFactoryMap
  await page.evaluate(async () => {
    window.CALLS = []; window.TOASTS = [];
    document.getElementById('cs-f-fxdealer').value = '經銷商－downstair';
    await saveConsignCustomerForm();
  });
  await page.waitForTimeout(400);
  const s5 = await page.evaluate(() => ({
    saveCus: window.CALLS.findIndex(c => c.action === 'saveConsignCustomer'),
    saveMap: window.CALLS.findIndex(c => c.action === 'saveFactoryMap'),
    mapRow: (window.CALLS.find(c => c.action === 'saveFactoryMap') || {}).rows,
    map: CS_FX.map['2'],
    toast: window.TOASTS.map(t => t[0]).join('|'),
  }));
  check('5c 存客戶後打 saveFactoryMap（kind consign_client、qs_name＝客戶代碼、factory_name＝經銷商鍵）', s5.saveCus >= 0 && s5.saveMap > s5.saveCus && s5.mapRow && s5.mapRow[0].kind === 'consign_client' && s5.mapRow[0].qs_name === '2' && s5.mapRow[0].factory_name === '經銷商－downstair');
  check('5d 前端對照更新、沒噴錯', s5.map === '經銷商－downstair' && !/沒存成功/.test(s5.toast));
  // 沒變 → 不打
  await page.evaluate(() => openConsignCustomerEdit('2'));
  await page.waitForTimeout(300);
  await page.evaluate(async () => { window.CALLS = []; await saveConsignCustomerForm(); });
  await page.waitForTimeout(300);
  check('5e 對應沒變 → 不打 saveFactoryMap', await page.evaluate(() => !window.CALLS.some(c => c.action === 'saveFactoryMap')));
  // 取消連結 → factory_name 空
  await page.evaluate(() => openConsignCustomerEdit('2'));
  await page.waitForTimeout(300);
  await page.evaluate(async () => { window.CALLS = []; document.getElementById('cs-f-fxdealer').value = ''; await saveConsignCustomerForm(); });
  await page.waitForTimeout(300);
  const s5f = await page.evaluate(() => ({ row: (window.CALLS.find(c => c.action === 'saveFactoryMap') || {}).rows, map: CS_FX.map['2'] }));
  check('5f 改回不連結 → factory_name 空字串（後端刪對照）、前端對照移除', s5f.row && s5f.row[0].factory_name === '' && s5f.map === undefined);

  // 7) 廠務沒設定
  await page.evaluate(async () => { window.FX_CONFIGURED = false; rcClear(); await csFxLoad(true); csFxRenderStatus(); });
  const s7 = await page.evaluate(() => ({ btn: document.getElementById('cs-fxsync-btn').style.display, status: document.getElementById('cs-fxstatus').textContent }));
  await page.evaluate(() => openConsignCustomerEdit('2'));
  await page.waitForTimeout(300);
  const s7b = await page.evaluate(() => document.getElementById('cs-f-fxdealer').closest('.fl').style.display);
  check('7 廠務沒設定 → 同步鈕藏起來、狀態列空白、客戶設定不顯示下拉', s7.btn === 'none' && s7.status === '' && s7b === 'none');

  check('00 零 JS 例外／console error', errors.length === 0);
  results.forEach(r => console.log(r[0], r[1]));
  const fails = results.filter(r => r[0] === 'FAIL').length;
  console.log(`\n${results.length - fails}/${results.length} PASS${fails ? ' — ' + fails + ' FAIL' : ''}`);
  if (errors.length) console.log('errors:', errors.slice(0, 5));
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
