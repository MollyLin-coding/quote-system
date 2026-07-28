/* 2026-07-28 晚間修正包 離線測試
   1) 行事曆「出貨」重複兩筆：ship- 備忘在訂單有出貨日時不再顯示（月曆/今日焦點/今日待辦）
   2) 報價單「選既有客戶」切換：公司報價檔＋酒款下拉要跟著換；對不到公司要清空
   3) 訂單追蹤儲存進度：畫面即時更新（樂觀更新）、按鈕有「儲存中…」、不會被骨架屏蓋掉
   4) 行事曆儲存/刪除：樂觀更新，畫面即刻反映 */
const { chromium } = require('/opt/node-tools/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  const isNoise = t => /Failed to load resource|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|favicon/i.test(t);
  page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('CONSOLE: ' + m.text()); });

  await page.goto('http://localhost:8899/index.html');
  const results = [];
  const check = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);

  await page.evaluate(() => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 'test-token';
    window.confirm = () => true;
    window.apiCall = async (p) => ({ ok: true, quotes: [], orders: [], records: [], items: [] });
  });

  /* ---------- 1) ship- 備忘去重 ---------- */
  await page.evaluate(() => {
    ORDERS_CACHE = [
      { no: '20260728-03', client: '湧金啤酒廠', type: '瓶裝', typeKey: 'bottle', total: 3810, quoteDate: '2026-07-28', expiry: '',
        st: { quote_no: '20260728-03', status: 'quoted', ship_date_est: '2026-07-29' }, src: 'std' },
      { no: '20260701-01', client: '沒進度客戶', type: '瓶裝', typeKey: 'bottle', total: 100, quoteDate: '2026-07-01', expiry: '', st: null, src: 'std' }
    ];
    CAL_ITEMS = [
      { item_id: 'ship-20260728-03', kind: 'memo', date: '2026-07-29', title: '出貨：湧金啤酒廠（20260728-03）', category: '採購', done: 'N', source_quote_no: '20260728-03' },
      { item_id: 'ship-20260701-01', kind: 'memo', date: '2026-07-30', title: '出貨：沒進度客戶（20260701-01）', category: '採購', done: 'N', source_quote_no: '20260701-01' },
      { item_id: 'ci-1', kind: 'memo', date: '2026-07-29', title: '普通備忘', category: '工作', done: 'N' }
    ];
  });
  const ev29 = await page.evaluate(() => eventsOn('2026-07-29').map(e => e.txt));
  check('訂單有出貨日：ship- 備忘不再重複顯示', !ev29.some(t => t.includes('出貨：湧金啤酒廠')));
  check('同一天 🚚 訂單出貨事件照常顯示', ev29.some(t => t.includes('🚚') && t.includes('湧金啤酒廠')));
  check('普通備忘不受影響', ev29.some(t => t.includes('普通備忘')));
  const ev30 = await page.evaluate(() => eventsOn('2026-07-30').map(e => e.txt));
  check('訂單「沒有」出貨進度時 ship- 備忘保留（不丟資料）', ev30.some(t => t.includes('出貨：沒進度客戶')));

  /* 今日待辦卡片：digest 的行事曆區塊要濾掉 ship- 項目 */
  const tdHtml = await page.evaluate(() => {
    TD_DATA = { ok: true, today: fmtD(new Date()), ship_due: [], final_due: [], no_scan: [], no_invoice: [],
      calendar: [
        { item_id: 'ship-20260728-03', title: '出貨：湧金啤酒廠（20260728-03）', category: '採購', time: '', all_day: true },
        { item_id: 'ci-9', title: '今天要記得的事', category: '工作', time: '', all_day: true }
      ], warnings: [] };
    renderToday();
    return document.getElementById('td-body').innerHTML;
  });
  check('今日待辦：ship- 行事曆項目被濾掉', !tdHtml.includes('出貨：湧金啤酒廠'));
  check('今日待辦：一般行事曆項目照常顯示', tdHtml.includes('今天要記得的事'));

  /* ---------- 2) 選客戶 → 公司/酒款連動 ---------- */
  await page.evaluate(() => {
    COMPANY_DATA = {
      companies: [
        { company_id: 'C1', name: '湧金啤酒廠股份有限公司', brand: '湧金啤酒廠', tax_id: '11112222' },
        { company_id: 'C2', name: 'babyface', brand: '', tax_id: '33334444' }
      ],
      products: [
        { product_id: 'P1', company_id: 'C1', name: '湧金拉格', spec: '330', unit_price: 100 },
        { product_id: 'P2', company_id: 'C2', name: 'BF精釀', spec: '500', unit_price: 200 }
      ],
      rules: []
    };
    populateCompanySelects();
    CUS_MASTER = [
      { customer_id: 'CU-A', name: '湧金啤酒廠', tax_id: '11112222', contact: '金老闆' },
      { customer_id: 'CU-B', name: 'babyface', tax_id: '33334444', contact: 'BF' },
      { customer_id: 'CU-C', name: '沒建公司檔的客戶', tax_id: '', contact: '' }
    ];
    cusFillPickSelect();
  });
  const pickA = await page.evaluate(() => {
    document.getElementById('f-cuspick').value = 'CU-A'; pickQuoteCustomer();
    return { comp: document.getElementById('qf-company').value,
             prods: document.getElementById('qf-product').innerHTML,
             cli: document.getElementById('f-cli').value };
  });
  check('選客戶A：公司下拉自動切到 A 公司', pickA.comp === 'C1');
  check('選客戶A：酒款下拉是 A 公司的酒', pickA.prods.includes('湧金拉格') && !pickA.prods.includes('BF精釀'));
  check('選客戶A：客戶名稱以主檔為準', pickA.cli === '湧金啤酒廠');
  const pickB = await page.evaluate(() => {
    document.getElementById('f-cuspick').value = 'CU-B'; pickQuoteCustomer();
    return { comp: document.getElementById('qf-company').value,
             prods: document.getElementById('qf-product').innerHTML };
  });
  check('A→B 切換：公司下拉跟著換成 B', pickB.comp === 'C2');
  check('A→B 切換：酒款換成 B 公司的酒（Molly 回報的 bug）', pickB.prods.includes('BF精釀') && !pickB.prods.includes('湧金拉格'));
  const pickC = await page.evaluate(() => {
    document.getElementById('f-cuspick').value = 'CU-C'; pickQuoteCustomer();
    return { comp: document.getElementById('qf-company').value,
             prods: document.getElementById('qf-product').innerHTML };
  });
  check('切到沒建公司檔的客戶：公司下拉清空', pickC.comp === '');
  check('切到沒建公司檔的客戶：不殘留上一家的酒款', !pickC.prods.includes('BF精釀') && !pickC.prods.includes('湧金拉格'));

  /* ---------- 3) 訂單追蹤儲存：樂觀更新 ----------
     ⚠ 存檔後背景會 loadOrders()，stub 若回空資料會把列表洗掉（真後端會回存好的資料），
     所以 stub 的 getQuotes/getOrderStatusList 要回同一張單。 */
  const ordSave = await page.evaluate(async () => {
    const T1Q = { quoteNo: 'T1', clientName: '測試客戶', quoteType: 'bottle', grandTotal: 10000, quoteDate: '2026-07-28' };
    const T1ST = { quote_no: 'T1', status: 'deposit', deposit_date: '2026-07-28', updated_at: '2026-07-28T12:00:00+08:00' };
    window.apiCall = async (p) => {
      if (p.action === 'getQuotes') return { ok: true, quotes: [T1Q] };
      if (p.action === 'getOrderStatusList') return { ok: true, orders: [] };
      return { ok: true, quotes: [], orders: [], records: [], items: [] };
    };
    ORDERS_CACHE = [
      { no: 'T1', client: '測試客戶', type: '瓶裝', typeKey: 'bottle', total: 10000, quoteDate: '2026-07-28', expiry: '', st: null, src: 'std' }
    ];
    gotoPage('orders'); renderOrders();
    openOrdEdit('T1');
    document.getElementById('oe-status').value = 'deposit';
    document.getElementById('oe-deposit_date').value = '2026-07-28';
    let btnTextDuring = '';
    window.apiCall = async (p) => {
      if (p.action === 'updateOrderStatus') {
        btnTextDuring = document.getElementById('oe-save').textContent;
        rcClear();                                      // 模擬寫入動作清快取（真 apiCall 的行為）
        return { ok: true };
      }
      if (p.action === 'getQuotes') return { ok: true, quotes: [T1Q] };
      if (p.action === 'getOrderStatusList') return { ok: true, orders: [T1ST] };
      return { ok: true, quotes: [], orders: [], records: [], items: [] };
    };
    await saveOrdEdit();
    await new Promise(r => setTimeout(r, 60));          // 讓背景 loadOrders 跑完（stub 會回存好的資料）
    const row = document.getElementById('ord-body').innerHTML;
    const o = ORDERS_CACHE ? ORDERS_CACHE.find(x => x.no === 'T1') : null;
    return { btnTextDuring, row,
      stStatus: o && o.st ? o.st.status : '',
      overlay: document.getElementById('oe-overlay').style.display,
      btnAfter: document.getElementById('oe-save').textContent,
      hasSkeleton: /skl/.test(document.getElementById('ord-body').innerHTML) };
  });
  check('儲存中按鈕顯示「儲存中…」', ordSave.btnTextDuring === '儲存中…');
  check('存完畫面即時更新（狀態=已收訂金）', ordSave.stStatus === 'deposit' && ordSave.row.includes('已收訂金'));
  check('存完彈窗關閉', ordSave.overlay === 'none');
  check('按鈕文字復原', ordSave.btnAfter === '儲存進度');
  check('列表沒有被骨架屏蓋掉', !ordSave.hasSkeleton);

  /* 儲存失敗：按鈕復原、彈窗留著讓人重試 */
  const ordFail = await page.evaluate(async () => {
    if (!ORDERS_CACHE || !ORDERS_CACHE.find(x => x.no === 'T1')) {
      ORDERS_CACHE = [{ no: 'T1', client: '測試客戶', type: '瓶裝', typeKey: 'bottle', total: 10000, quoteDate: '2026-07-28', expiry: '', st: null, src: 'std' }];
    }
    openOrdEdit('T1');
    window.apiCall = async () => ({ ok: false, error: '測試失敗' });
    await saveOrdEdit();
    const r = { overlay: document.getElementById('oe-overlay').style.display,
                btn: document.getElementById('oe-save').textContent,
                disabled: document.getElementById('oe-save').disabled };
    closeOrdEdit();
    window.apiCall = async () => ({ ok: true, quotes: [], orders: [], records: [], items: [] });
    return r;
  });
  check('儲存失敗：彈窗留著可重試', ordFail.overlay === 'flex');
  check('儲存失敗：按鈕復原可再按', ordFail.btn === '儲存進度' && !ordFail.disabled);

  /* ---------- 4) 行事曆儲存/刪除：樂觀更新 ---------- */
  const calSave = await page.evaluate(async () => {
    CAL_ITEMS = [];
    gotoPage('cal');
    openCalAdd('2026-07-30');
    document.getElementById('ce-title').value = '樂觀更新測試';
    let savedItem = null;
    window.apiCall = async (p) => {
      if (p.action === 'saveCalendarItem') { savedItem = p.item; rcClear(); return { ok: true }; }
      if (p.action === 'listCalendarItems') return { ok: true, items: savedItem ? [savedItem] : [] };   // 背景重抓要回存好的那筆，別把畫面洗掉
      return { ok: true, items: [], quotes: [], orders: [], records: [] };
    };
    await saveCalItem();
    await new Promise(r => setTimeout(r, 60));
    return { n: CAL_ITEMS.length, t: CAL_ITEMS[0] ? CAL_ITEMS[0].title : '',
             overlay: document.getElementById('ce-overlay').style.display };
  });
  check('行事曆存檔：畫面即刻有這筆', calSave.n === 1 && calSave.t === '樂觀更新測試');
  check('行事曆存檔：彈窗關閉', calSave.overlay === 'none');
  const calDel = await page.evaluate(async () => {
    CAL_ITEMS = [{ item_id: 'ci-del', kind: 'memo', date: '2026-07-30', title: '要刪的', category: '工作', done: 'N' }];
    openCalEdit('ci-del');
    window.apiCall = async (p) => { if (p.action === 'deleteCalendarItem') { rcClear(); return { ok: true }; } return { ok: true, items: [], quotes: [], orders: [], records: [] }; };
    await deleteCalItem();
    return CAL_ITEMS.length;
  });
  check('行事曆刪除：畫面即刻拿掉', calDel === 0);

  /* ---------- 5) 今日焦點「打勾完成」＋編輯視窗「已完成」 ---------- */
  const focus = await page.evaluate(async () => {
    rcClear();                                    // 上一段留下的快取會把 fixture 洗掉，先清
    ORDERS_CACHE = [];
    const today = fmtD(new Date());
    CAL_ITEMS = [
      { item_id: 'ci-f1', kind: 'memo', date: today, title: '圓廣印刷廠拜訪', category: '拜訪客戶', done: 'N' },
      { item_id: 'ci-f2', kind: 'memo', date: today, title: '另一件事', category: '工作', done: 'N' }
    ];
    let saved = null;
    window.apiCall = async (p) => {
      if (p.action === 'saveCalendarItem') { saved = p.item; rcClear(); return { ok: true }; }
      if (p.action === 'listCalendarItems') return { ok: true, items: CAL_ITEMS };
      return { ok: true, items: [], quotes: [], orders: [], records: [] };
    };
    gotoPage('cal');
    await new Promise(r => setTimeout(r, 80));
    const before = document.getElementById('cal-focus').innerHTML;
    calFocusDone('ci-f1');
    await new Promise(r => setTimeout(r, 120));
    const after = document.getElementById('cal-focus').innerHTML;
    return { hasBox: before.includes('fdone'), before: before.includes('圓廣印刷廠拜訪'),
      afterGone: !after.includes('圓廣印刷廠拜訪'), otherStays: after.includes('另一件事'),
      savedDone: saved ? saved.done : '' };
  });
  check('焦點區備忘列有「完成」圈圈', focus.hasBox);
  check('打勾前備忘在焦點區', focus.before);
  check('打勾後這筆從焦點消失', focus.afterGone);
  check('其他備忘不受影響', focus.otherStays);
  check('後端收到 done=Y', focus.savedDone === 'Y');

  const editDone = await page.evaluate(async () => {
    CAL_ITEMS = [{ item_id: 'ci-f3', kind: 'memo', date: '2026-07-20', title: '做完的事', category: '工作', done: 'Y', done_date: '2026-07-21' }];
    openCalEdit('ci-f3');
    const shown = document.getElementById('ce-done-wrap').style.display !== 'none';
    const checked = document.getElementById('ce-done').checked;
    document.getElementById('ce-done').checked = false;      // 取消已完成 → 復原
    let saved = null;
    window.apiCall = async (p) => { if (p.action === 'saveCalendarItem') { saved = p.item; rcClear(); return { ok: true }; } return { ok: true, items: CAL_ITEMS, quotes: [], orders: [], records: [] }; };
    await saveCalItem();
    const addShown = (openCalAdd('2026-07-30'), document.getElementById('ce-done-wrap').style.display !== 'none');
    closeCalEdit();
    return { shown, checked, savedDone: saved ? saved.done : '', savedDate: saved ? saved.done_date : 'x', addShown };
  });
  check('編輯備忘：顯示「已完成」勾選且帶原狀態', editDone.shown && editDone.checked);
  check('取消勾選存檔 → done=N、完成日清空（可復原）', editDone.savedDone === 'N' && editDone.savedDate === '');
  check('新增事項不顯示「已完成」勾選', !editDone.addShown);

  results.forEach(r => console.log(r[0], r[1]));
  const fails = results.filter(r => r[0] === 'FAIL').length;
  console.log(errors.length ? 'JS ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(fails === 0 ? 'ALL PASS' : fails + ' FAIL');
  await browser.close();
  process.exit(fails === 0 && errors.length === 0 ? 0 : 1);
})();
