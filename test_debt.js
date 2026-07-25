/* 技術債整理測試：共用工具集中／統一骨架屏／手機卡片式列表／清單分頁／今日待辦節流 */
const { chromium } = require('/opt/node-tools/node_modules/playwright');

const mkQuotes = n => Array.from({ length: n }, (_, i) => ({
  quoteNo: '2026070' + (1 + (i % 9)) + '-' + String((i % 99) + 1).padStart(2, '0') + '-' + i,
  clientName: '客戶' + i, quoteType: 'bottle', quoteDate: '2026-07-01', grandTotal: 1000 + i, status: '',
}));

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errors = [];
  const isNoise = t => /Failed to load resource|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|favicon/i.test(t);
  const results = [];
  const check = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);

  const newPage = async (vp) => {
    const p = vp ? await browser.newPage({ viewport: vp }) : await browser.newPage();
    p.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('CONSOLE: ' + m.text()); });
    await p.goto('http://localhost:8899/index.html');
    return p;
  };
  const stub = (p, opts) => p.evaluate((opts) => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 't';
    window.CALLS = [];
    window.OPTS = opts;
    window.apiCall = async (payload) => {
      window.CALLS.push(payload);
      const o = window.OPTS;
      if (payload.action === 'getQuotes') {
        const all = o.quotes || [];
        return { ok: true, quotes: payload.limit ? all.slice(0, payload.limit) : all };
      }
      if (payload.action === 'getOrderStatusList') return { ok: true, orders: o.orders || [] };
      if (payload.action === 'listCustomQuotes') return { ok: true, quotes: [] };
      if (payload.action === 'getTodayDigest') {
        if (o.slow) await new Promise(r => setTimeout(r, 1200));
        return { ok: true, today: '2026-07-26', ship_due: [], final_due: [], no_scan: [], no_invoice: [], calendar: [], warnings: [] };
      }
      return { ok: true, quotes: [], orders: [], records: [], items: [], shipments: [], summary: {} };
    };
  }, opts);

  /* ---------- 1. 共用工具集中 ---------- */
  const page = await newPage();
  await stub(page, { quotes: mkQuotes(5) });
  check('共用工具都在（集中到 00_utils 後仍可全域取用）', await page.evaluate(() =>
    ['escHtml', 'escAttr', 'money', 'fmtMoney', 'fmtD', 'daysBetween', 'parseJsonSafe', 'vmLocalYmd', 'vmDaysSince', 'vmArr', 's2', 'todayStr']
      .every(f => typeof window[f] === 'function')));
  check('工具行為沒被改到', await page.evaluate(() =>
    money(-500) === '-$500' && money(1234) === '$1,234' &&
    escHtml('<b>&x</b>') === '&lt;b&gt;&amp;x&lt;/b&gt;' &&
    escAttr('a"b') === 'a&quot;b' &&
    vmLocalYmd('2026-07-24T16:00:00.000Z') === '2026-07-25' &&
    vmLocalYmd('2026-07-24') === '2026-07-24' &&
    parseJsonSafe('bad', 'fb') === 'fb' && s2(3) === '03'));

  /* ---------- 2. 統一骨架屏 ---------- */
  check('sklBlock／sklTableRows 產生骨架', await page.evaluate(() =>
    sklBlock(3).split('skl-row').length === 4 &&
    sklTableRows(6, 4).split('<tr>').length === 5 &&
    sklTableRows(6, 1).indexOf('colspan="6"') > -1));
  const sklPages = await page.evaluate(async () => {
    const out = {};
    // 報價紀錄：載入瞬間應該是骨架，不是「載入中…」三個字
    window.apiCall = () => new Promise(() => { });   // 永遠不回，卡在載入狀態
    loadRecords();
    await new Promise(r => setTimeout(r, 150));
    out.records = document.querySelectorAll('#rec-body .skl').length;
    out.recordsNoText = document.getElementById('rec-body').innerText.indexOf('載入中') === -1;
    loadOrders().catch(() => { });
    await new Promise(r => setTimeout(r, 150));
    out.orders = document.querySelectorAll('#ord-body .skl').length;
    VM_DATA = null; loadVerifyMgmt(true).catch(() => { });
    await new Promise(r => setTimeout(r, 150));
    out.verify = document.querySelectorAll('#vm-body .skl').length;
    return out;
  });
  check('報價紀錄載入中顯示骨架屏', sklPages.records >= 3 && sklPages.recordsNoText);
  check('訂單追蹤載入中顯示骨架屏', sklPages.orders >= 3);
  check('驗收管理載入中顯示骨架屏', sklPages.verify >= 3);
  check('HTML 靜態預設值也改成骨架（不再寫死載入中…）', await page.evaluate(() =>
    document.body.innerHTML.indexOf('class="rec-empty">載入中…') === -1));

  /* ---------- 3. 清單分頁 ---------- */
  const p2 = await newPage();
  await stub(p2, { quotes: mkQuotes(5) });
  await p2.evaluate(async () => { gotoPage('records'); await new Promise(r => setTimeout(r, 400)); });
  check('資料量小的時候：有帶 limit 但畫面不出現提示', await p2.evaluate(() => {
    const c = window.CALLS.filter(c => c.action === 'getQuotes').pop();
    return c && c.limit === LIST_LIMIT && document.getElementById('rec-body').innerText.indexOf('只顯示最近') === -1;
  }));
  check('資料量小的時候列數正確（行為與以前一樣）', await p2.evaluate(() =>
    document.querySelectorAll('#rec-body tr').length === 5));
  const p3 = await newPage();
  await stub(p3, { quotes: mkQuotes(400) });
  await p3.evaluate(async () => { gotoPage('records'); await new Promise(r => setTimeout(r, 600)); });
  check('超過上限：只顯示 300 筆＋「載入全部」提示', await p3.evaluate(() =>
    document.querySelectorAll('#rec-body tr').length === 301 &&
    document.getElementById('rec-body').innerText.indexOf('只顯示最近 300 筆') > -1));
  check('按「載入全部」後不再帶 limit、列出全部 400 筆', await p3.evaluate(async () => {
    loadAllLists();
    await new Promise(r => setTimeout(r, 600));
    const c = window.CALLS.filter(c => c.action === 'getQuotes').pop();
    return c.limit === undefined && document.querySelectorAll('#rec-body tr').length === 400 &&
      document.getElementById('rec-body').innerText.indexOf('只顯示最近') === -1;
  }));

  /* ---------- 4. 手機卡片式列表 ---------- */
  const mob = await newPage({ width: 390, height: 844 });
  await stub(mob, {
    quotes: mkQuotes(3),
    orders: [{ quote_no: mkQuotes(3)[0].quoteNo, status: 'shipped', ship_date_actual: '2026-07-20' }],
  });
  await mob.evaluate(async () => { gotoPage('records'); await new Promise(r => setTimeout(r, 500)); });
  check('手機：報價紀錄表頭隱藏、變成一列一張卡', await mob.evaluate(() => {
    const th = document.querySelector('#page-records .mcard thead');
    const tr = document.querySelector('#rec-body tr');
    return getComputedStyle(th).display === 'none' && getComputedStyle(tr).display === 'block';
  }));
  check('手機：欄位名稱用 data-l 顯示在值旁邊', await mob.evaluate(() => {
    const td = document.querySelector('#rec-body td[data-l="客戶"]');
    return !!td && getComputedStyle(td, '::before').content.indexOf('客戶') > -1;
  }));
  check('手機：報價紀錄沒有橫向溢出', await mob.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await mob.evaluate(async () => { gotoPage('orders'); await new Promise(r => setTimeout(r, 700)); });
  check('手機：訂單追蹤也是卡片式且不溢出', await mob.evaluate(() =>
    getComputedStyle(document.querySelector('#ord-body tr')).display === 'block' &&
    document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  check('手機：訂單卡片有「進度／總計／出貨日／操作」標籤', await mob.evaluate(() => {
    const t = document.getElementById('ord-body').innerHTML;
    return ['進度', '總計', '出貨日', '操作'].every(l => t.indexOf('data-l="' + l + '"') > -1);
  }));
  await mob.evaluate(async () => { VM_DATA = null; gotoPage('verify'); await new Promise(r => setTimeout(r, 700)); });
  check('手機：驗收管理表格也帶 mcard', await mob.evaluate(() => {
    VM_DATA = { reports: [{ id: 'v1', no: 'A-1', client: '甲', type: '回報問題', desc: 'x', status: '待處理', created_at: '2026-07-25T01:00:00Z' }], forms: [], repSum: {}, formSum: {} };
    VM_TAB = 'all'; renderVerifyMgmt();
    return !!document.querySelector('#vm-body table.mcard') &&
      document.documentElement.scrollWidth <= document.documentElement.clientWidth;
  }));

  /* ---------- 5. 桌機版不受影響 ---------- */
  const pc = await newPage({ width: 1280, height: 900 });
  await stub(pc, { quotes: mkQuotes(3) });
  await pc.evaluate(async () => { gotoPage('records'); await new Promise(r => setTimeout(r, 500)); });
  check('桌機：表頭仍然看得到、列仍是 table-row', await pc.evaluate(() => {
    const th = document.querySelector('#page-records .mcard thead');
    const tr = document.querySelector('#rec-body tr');
    return getComputedStyle(th).display !== 'none' && getComputedStyle(tr).display === 'table-row';
  }));
  check('桌機：data-l 標籤不會顯示出來', await pc.evaluate(() => {
    const td = document.querySelector('#rec-body td[data-l="客戶"]');
    return getComputedStyle(td, '::before').content === 'none';
  }));

  /* ---------- 6. 今日待辦節流 ---------- */
  const p4 = await newPage();
  await stub(p4, {});
  await p4.evaluate(async () => { localStorage.clear(); gotoPage('today'); await new Promise(r => setTimeout(r, 400)); });
  check('第一次進今日待辦會打 API', await p4.evaluate(() => window.CALLS.filter(c => c.action === 'getTodayDigest').length === 1));
  check('90 秒內切走再切回來不重打', await p4.evaluate(async () => {
    gotoPage('orders'); await new Promise(r => setTimeout(r, 200));
    gotoPage('today'); await new Promise(r => setTimeout(r, 400));
    return window.CALLS.filter(c => c.action === 'getTodayDigest').length === 1;
  }));
  check('按「重新整理」一定會重打', await p4.evaluate(async () => {
    await loadToday(true);
    return window.CALLS.filter(c => c.action === 'getTodayDigest').length === 2;
  }));
  check('節流時畫面仍然是最新狀態（不會卡在更新中）', await p4.evaluate(() =>
    document.getElementById('td-stat').innerText.indexOf('已是最新') > -1));

  results.forEach(r => console.log(r[0], r[1]));
  const fails = results.filter(r => r[0] === 'FAIL').length;
  console.log(errors.length ? 'JS ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(fails === 0 && errors.length === 0 ? 'ALL PASS' : `${fails} FAIL`);
  await browser.close();
  process.exit(fails === 0 && errors.length === 0 ? 0 : 1);
})();
