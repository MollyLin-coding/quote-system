/* 「今日待辦」首頁離線測試：五區塊渲染／空狀態／快取先顯示／骨架屏／fallback／點擊行為／手機版 */
const { chromium } = require('/opt/node-tools/node_modules/playwright');

const DIGEST = {
  ok: true, today: '2026-07-26',
  ship_due: [
    { quote_no: 'T-101', client: '酒旺商行', plan_ship_date: '2026-07-20', overdue_days: 6 },
    { quote_no: 'T-102', client: '七二巷', plan_ship_date: '2026-07-26', overdue_days: 0 },
  ],
  final_due: [
    { quote_no: 'T-090', client: 'BABY 酒館', final_amt: 36000, is_estimated: true, plan_final_date: '2026-07-22', overdue: true, overdue_days: 4 },
    { quote_no: 'T-091', client: '中和店', final_amt: 12000, is_estimated: false, plan_final_date: '', overdue: false, overdue_days: 0 },
  ],
  no_scan: [{ quote_no: 'T-080', lot: 'L2607', client: '滿枝枒', ship_date: '2026-07-15', days_since: 11 }],
  no_invoice: [{ quote_no: 'T-070', client: '有趣市集', ship_date: '2026-07-02', days_since: 24 }],
  calendar: [
    { item_id: 'C1', title: '拜訪囍酒工藝', category: '拜訪客戶', time: '10:30', all_day: false },
    { item_id: 'C2', title: '月結對帳', category: '工作', time: '', all_day: true },
  ],
  warnings: [],
};
const EMPTY = { ok: true, today: '2026-07-26', ship_due: [], final_due: [], no_scan: [], no_invoice: [], calendar: [], warnings: [] };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errors = [];
  const isNoise = t => /Failed to load resource|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|favicon/i.test(t);
  const results = [];
  const check = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);

  const newPage = async (viewport) => {
    const p = viewport ? await browser.newPage({ viewport }) : await browser.newPage();
    p.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('CONSOLE: ' + m.text()); });
    await p.goto('http://localhost:8899/index.html');
    return p;
  };
  const stub = async (p, digest, opts) => {
    await p.evaluate(({ digest, opts }) => {
      document.getElementById('login-overlay').style.display = 'none';
      AUTH_TOKEN = 'test-token';
      window.CALLS = [];
      window.__realApiCall = window.apiCall;   // 留一份真的，測 token 失效清快取要用
      window.DIGEST = digest;
      window.DIGEST_FAIL = !!(opts && opts.digestFail);
      window.DIGEST_DELAY = (opts && opts.delay) || 0;
      window.apiCall = async (payload) => {
        window.CALLS.push(payload);
        if (payload.action === 'getTodayDigest') {
          if (window.DIGEST_DELAY) await new Promise(r => setTimeout(r, window.DIGEST_DELAY));
          if (window.DIGEST_FAIL) return { ok: false, error: 'unknown action' };
          return window.DIGEST;
        }
        if (payload.action === 'getOrderStatusList') return { ok: true, orders: (opts && opts.orders) || [] };
        if (payload.action === 'getQuotes') return { ok: true, quotes: (opts && opts.quotes) || [] };
        if (payload.action === 'listCalendarItems') return { ok: true, items: (opts && opts.calItems) || [] };
        if (payload.action === 'listCustomQuotes') return { ok: true, quotes: [] };
        if (payload.action === 'getVerifications') return { ok: true, records: [], summary: {} };
        if (payload.action === 'listVerifyForms') return { ok: true, records: [], summary: {} };
        return { ok: true, quotes: [], orders: [], records: [], items: [], logs: [], shipments: [] };
      };
    }, { digest, opts: opts || {} });
  };

  /* ---------- 1. 側邊選單／預設落地頁 ---------- */
  let page = await newPage();
  await stub(page, DIGEST);
  check('側邊選單「今日待辦」在第一個', await page.evaluate(() => {
    const first = document.querySelector('.sb-nav .nb');
    return first && first.id === 'nav-today' && first.textContent.includes('今日待辦');
  }));
  await page.evaluate(async () => { await initV2(); });
  await page.waitForTimeout(400);
  check('登入後預設落地頁＝今日待辦', await page.evaluate(() =>
    currentPage === 'today' && document.getElementById('page-today').classList.contains('on') &&
    document.getElementById('nav-today').classList.contains('on')));
  check('標題列顯示「今日待辦」', await page.evaluate(() => document.getElementById('tb-title').textContent === '今日待辦'));
  check('報價單工具列在今日待辦頁隱藏', await page.evaluate(() => document.getElementById('tbr-standard').style.display === 'none'));

  /* ---------- 2. 五區塊內容 ---------- */
  const bodyTxt = await page.evaluate(() => document.getElementById('td-body').innerText);
  check('五張卡片都在', await page.evaluate(() => document.querySelectorAll('#td-body .td-card').length === 5));
  check('卡片標題齊全', ['今天／逾期要出貨', '該催的尾款', '客戶還沒回報驗收', '已出貨未開發票', '今天的行事曆'].every(t => bodyTxt.includes(t)));
  check('筆數徽章 2/2/1/1/2', await page.evaluate(() =>
    [...document.querySelectorAll('#td-body .td-ch .n')].map(e => e.textContent).join(',') === '2,2,1,1,2'));
  check('逾期出貨標紅字 tag', await page.evaluate(() => {
    const c = document.querySelectorAll('#td-body .td-card')[0];
    return c.querySelector('.td-tag.red') && c.innerText.includes('逾期 6 天');
  }));
  check('當天出貨顯示「今天」不標紅', await page.evaluate(() => {
    const rows = document.querySelectorAll('#td-body .td-card')[0].querySelectorAll('.td-row');
    return rows[1].innerText.includes('今天') && !rows[1].querySelector('.td-tag.red');
  }));
  check('尾款金額用 money() 顯示', bodyTxt.includes('$36,000') && bodyTxt.includes('$12,000'));
  check('推估尾款標「推估」', await page.evaluate(() => {
    const c = document.querySelectorAll('#td-body .td-card')[1];
    return c.querySelectorAll('.td-row')[0].innerText.includes('推估') && !c.querySelectorAll('.td-row')[1].innerText.includes('推估');
  }));
  check('尾款逾期標紅', await page.evaluate(() => document.querySelectorAll('#td-body .td-card')[1].querySelector('.td-tag.red') !== null));
  check('沒填預計尾款日顯示「未填」', bodyTxt.includes('預計尾款日 未填'));
  check('未回報列有「複製催單訊息」鈕', await page.evaluate(() =>
    document.querySelectorAll('#td-body .td-card')[2].innerText.includes('複製催單訊息')));
  check('未回報顯示 Lot 與出貨天數', bodyTxt.includes('Lot L2607') && bodyTxt.includes('出貨 11 天'));
  check('未開發票超過 14 天標紅', await page.evaluate(() =>
    document.querySelectorAll('#td-body .td-card')[3].querySelector('.td-tag.red') !== null));
  check('行事曆顯示時間與整天', bodyTxt.includes('10:30') && bodyTxt.includes('整天'));
  check('行事曆分類顏色點有出現', await page.evaluate(() =>
    document.querySelectorAll('#td-body .td-card')[4].querySelector('.td-dotc') !== null));
  check('狀態列顯示「已是最新」', await page.evaluate(() => document.getElementById('td-stat').innerText.includes('已是最新')));
  check('只打一趟 getTodayDigest（不再多趟組裝）', await page.evaluate(() =>
    window.CALLS.filter(c => c.action === 'getTodayDigest').length === 1 &&
    window.CALLS.filter(c => c.action === 'getOrderStatusList').length === 0));

  /* ---------- 3. 整列可點 → 開既有彈窗 ---------- */
  check('出貨列可點開訂單編輯', await page.evaluate(async () => {
    ORDERS_CACHE = [{ no: 'T-101', client: '酒旺商行', typeKey: 'bottle', total: 50000, quoteDate: '2026-07-01', expiry: '', st: { status: 'quoted' }, src: 'std' }];
    document.querySelectorAll('#td-body .td-card')[0].querySelector('.td-row').click();
    await new Promise(r => setTimeout(r, 300));
    return currentPage === 'orders' && document.getElementById('oe-overlay').style.display === 'flex' && ORD_EDITING === 'T-101';
  }));
  await page.evaluate(() => { closeOrdEdit(); gotoPage('today'); });
  await page.waitForTimeout(300);
  check('行事曆列可點開事項編輯', await page.evaluate(async () => {
    CAL_ITEMS = [{ item_id: 'C1', kind: 'memo', title: '拜訪囍酒工藝', category: '拜訪客戶', date: '2026-07-26', time: '10:30', all_day: 'N', done: 'N' }];
    document.querySelectorAll('#td-body .td-card')[4].querySelector('.td-row').click();
    await new Promise(r => setTimeout(r, 300));
    return currentPage === 'cal' && document.getElementById('ce-overlay').style.display === 'flex';
  }));
  await page.evaluate(() => { closeCalEdit(); gotoPage('today'); });
  await page.waitForTimeout(300);
  check('催單鈕不會冒泡去開訂單彈窗（stopPropagation）', await page.evaluate(async () => {
    const before = currentPage;
    document.querySelectorAll('#td-body .td-card')[2].querySelector('.td-mini').click();
    await new Promise(r => setTimeout(r, 300));
    return currentPage === before && document.getElementById('oe-overlay').style.display !== 'flex';
  }));

  /* ---------- 4. 空狀態 ---------- */
  const p2 = await newPage();
  await stub(p2, EMPTY);
  await p2.evaluate(async () => { localStorage.clear(); gotoPage('today'); await loadToday(true); });
  await p2.waitForTimeout(400);
  check('全空顯示「今天都處理完了」大字', await p2.evaluate(() =>
    document.querySelector('#td-body .td-alldone') !== null && document.getElementById('td-body').innerText.includes('今天都處理完了')));
  const HALF = JSON.parse(JSON.stringify(EMPTY)); HALF.ship_due = [{ quote_no: 'X1', client: '甲', plan_ship_date: '2026-07-26', overdue_days: 0 }];
  check('部分為空的區塊顯示「✓ 沒有…」灰字', await p2.evaluate(async (HALF) => {
    window.DIGEST = HALF; await loadToday(true);
    await new Promise(r => setTimeout(r, 300));
    const nones = [...document.querySelectorAll('#td-body .td-none')].map(e => e.innerText);
    return nones.length === 4 && nones.every(t => t.startsWith('✓'));
  }, HALF));

  /* ---------- 5. 快取先顯示、背景更新 ---------- */
  const p3 = await newPage();
  await stub(p3, DIGEST);
  await p3.evaluate(async () => { localStorage.clear(); gotoPage('today'); await loadToday(true); });
  await p3.waitForTimeout(300);
  check('成功後有寫入 localStorage 快取', await p3.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('qs_today_v1') || 'null');
    return c && c.date === fmtD(new Date()) && c.data && c.data.ship_due.length === 2 && !!c.at;
  }));
  check('快取不含登入通行證', await p3.evaluate(() => (localStorage.getItem('qs_today_v1') || '').indexOf('test-token') === -1));
  // 重開頁面：先看到快取內容＋「更新中…」，之後才變「已是最新」
  const p4 = await newPage();
  await stub(p4, DIGEST, { delay: 1200 });
  const cachedFirst = await p4.evaluate(async () => {
    localStorage.setItem('qs_today_v1', JSON.stringify({ date: fmtD(new Date()), at: new Date(Date.now() - 5 * 60000).toISOString(), data: window.DIGEST }));
    gotoPage('today');
    await new Promise(r => setTimeout(r, 200));
    return { rows: document.querySelectorAll('#td-body .td-row').length, stat: document.getElementById('td-stat').innerText, skl: document.querySelectorAll('#td-body .skl').length };
  });
  check('開頁立刻顯示快取資料（不必等 API）', cachedFirst.rows === 8);
  check('快取顯示時狀態列標「更新中…」＋幾分鐘前', cachedFirst.stat.includes('更新中') && cachedFirst.stat.includes('5 分鐘前'));
  check('有快取時不顯示骨架屏', cachedFirst.skl === 0);
  await p4.waitForTimeout(1600);
  check('API 回來後狀態列變「已是最新」', await p4.evaluate(() => document.getElementById('td-stat').innerText.includes('已是最新')));
  check('跨日的舊快取不會被採用', await p4.evaluate(() => {
    localStorage.setItem('qs_today_v1', JSON.stringify({ date: '2020-01-01', at: new Date().toISOString(), data: window.DIGEST }));
    return tdCacheRead() === null;
  }));
  check('tdCacheClear 會清掉快取', await p4.evaluate(() => {
    localStorage.setItem('qs_today_v1', 'x'); tdCacheClear();
    return localStorage.getItem('qs_today_v1') === null && TD_DATA === null;
  }));
  check('token 失效時 apiCall 會清快取', await p4.evaluate(async () => {
    localStorage.setItem('qs_today_v1', JSON.stringify({ date: fmtD(new Date()), at: new Date().toISOString(), data: window.DIGEST }));
    const realFetch = window.fetch;
    window.fetch = async () => ({ text: async () => JSON.stringify({ ok: false, error: 'UNAUTHORIZED: token 無效' }) });
    try { await window.__realApiCall({ action: 'getQuotes', token: 'x' }); } catch (e) { }
    window.fetch = realFetch;
    return localStorage.getItem('qs_today_v1') === null;
  }));

  /* ---------- 6. 骨架屏（無快取、API 還沒回來）---------- */
  const p5 = await newPage();
  await stub(p5, DIGEST, { delay: 1500 });
  const sklState = await p5.evaluate(async () => {
    localStorage.clear(); gotoPage('today');
    await new Promise(r => setTimeout(r, 250));
    return { skl: document.querySelectorAll('#td-body .skl').length, cards: document.querySelectorAll('#td-body .td-card').length, stat: document.getElementById('td-stat').innerText };
  });
  check('無快取時顯示骨架屏（不是白畫面）', sklState.skl > 0 && sklState.cards === 4);
  check('骨架屏期間狀態列顯示載入中', sklState.stat.includes('載入中'));
  await p5.waitForTimeout(1800);
  check('資料回來後骨架屏被真實內容取代', await p5.evaluate(() =>
    document.querySelectorAll('#td-body .skl').length === 0 && document.querySelectorAll('#td-body .td-card').length === 5));

  /* ---------- 7. fallback：後端沒有 getTodayDigest ---------- */
  const p6 = await newPage();
  await stub(p6, DIGEST, {
    digestFail: true,
    orders: [
      { quote_no: 'F1', status: 'quoted', ship_date_est: '2026-01-01' },
      { quote_no: 'F2', status: 'shipped', ship_date_actual: '2026-01-01', grand_total: 100000, deposit_amt: 40000 },
    ],
    quotes: [
      { quoteNo: 'F1', client: '甲公司', quoteDate: '2026-01-01', total: 80000, status: '' },
      { quoteNo: 'F2', client: '乙公司', quoteDate: '2026-01-01', total: 100000, status: '' },
    ],
  });
  await p6.evaluate(async () => { localStorage.clear(); gotoPage('today'); await loadToday(true); });
  await p6.waitForTimeout(1200);
  check('digest 失敗會退回多趟組裝（有打 getOrderStatusList）', await p6.evaluate(() =>
    window.CALLS.some(c => c.action === 'getTodayDigest') && window.CALLS.some(c => c.action === 'getOrderStatusList')));
  check('fallback 仍算得出逾期出貨', await p6.evaluate(() =>
    TD_DATA && TD_DATA._fallback === true && TD_DATA.ship_due.length === 1 && TD_DATA.ship_due[0].quote_no === 'F1' && TD_DATA.ship_due[0].overdue_days > 0));
  check('fallback 尾款用 總額−訂金 推估並標記', await p6.evaluate(() =>
    TD_DATA.final_due.length === 1 && TD_DATA.final_due[0].final_amt === 60000 && TD_DATA.final_due[0].is_estimated === true));
  check('fallback 也把畫面畫出來', await p6.evaluate(() => document.querySelectorAll('#td-body .td-card').length === 5));

  /* ---------- 8. warnings 提示 ---------- */
  const p7 = await newPage();
  const WARN = JSON.parse(JSON.stringify(DIGEST)); WARN.warnings = ['訂單進度讀取失敗：quota'];
  await stub(p7, WARN);
  await p7.evaluate(async () => { localStorage.clear(); gotoPage('today'); await loadToday(true); });
  await p7.waitForTimeout(400);
  check('warnings 非空時畫面有淡淡提示', await p7.evaluate(() =>
    document.getElementById('td-warn').innerText.includes('有部分資料沒讀到') && document.getElementById('td-warn').innerText.includes('quota')));

  /* ---------- 9. 手機版 ---------- */
  const mob = await newPage({ width: 390, height: 844 });
  await stub(mob, DIGEST);
  await mob.evaluate(async () => { localStorage.clear(); gotoPage('today'); await loadToday(true); });
  await mob.waitForTimeout(500);
  check('手機版無橫向溢出', await mob.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  check('手機版單欄排版', await mob.evaluate(() =>
    getComputedStyle(document.querySelector('#td-body .td-grid')).gridTemplateColumns.split(' ').length === 1));
  check('手機版整列可點（td-row 為全寬按鈕）', await mob.evaluate(() => {
    const r = document.querySelector('#td-body .td-row');
    return r.tagName === 'BUTTON' && r.getBoundingClientRect().width > 300;
  }));
  const mob420 = await newPage({ width: 400, height: 800 });
  await stub(mob420, DIGEST);
  await mob420.evaluate(async () => { localStorage.clear(); gotoPage('today'); await loadToday(true); });
  await mob420.waitForTimeout(500);
  check('420px 以下不破版', await mob420.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));

  results.forEach(r => console.log(r[0], r[1]));
  const fails = results.filter(r => r[0] === 'FAIL').length;
  console.log(errors.length ? 'JS ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(fails === 0 && errors.length === 0 ? 'ALL PASS' : `${fails} FAIL`);
  await browser.close();
  process.exit(fails === 0 && errors.length === 0 ? 0 : 1);
})();
