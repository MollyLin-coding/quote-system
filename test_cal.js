/* 行事曆分類擴充＋勾選篩選 離線測試 */
const { chromium } = require('/opt/node-tools/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.goto('http://localhost:8899/index.html');
  await page.evaluate(() => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 't';
    window.apiCall = async (p) => {
      if (p.action === 'listCalendarItems') return { ok: true, items: [
        { item_id: 'c1', kind: 'memo', date: '2026-07-28', title: '開會', category: '會議', all_day: 'Y', done: 'N' },
        { item_id: 'c2', kind: 'memo', date: '2026-07-28', title: '收貨款', category: '收款提醒', all_day: 'Y', done: 'N' },
        { item_id: 'c3', kind: 'memo', date: '2026-07-28', title: '舊資料自訂', category: '報稅季', all_day: 'Y', done: 'N' },
        { item_id: 'c4', kind: 'recur', recur_json: '{"freq":"weekly","weekday":2}', title: '每週盤點', category: '出貨物流', all_day: 'Y', done: 'N' },
      ]};
      return { ok: true, quotes: [], orders: [] };
    };
    ORDERS_CACHE = [{ no: 'O1', client: '客戶A', typeKey: 'bottle', total: 1, quoteDate: '2026-07-01',
      st: { status: 'deposit', ship_date_est: '2026-07-28' }, src: 'std' }];
  });

  const results = [];
  const check = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);

  await page.evaluate(async () => { CAL_Y = 2026; CAL_M = 6; await loadCalendar(); });
  await page.waitForTimeout(300);

  // 新分類進了編輯視窗選單
  check('編輯選單有 8 種分類', await page.evaluate(() => document.querySelectorAll('#ce-category option').length === 8));
  // 分類 chip 列（8 內建 + 1 舊資料自訂）
  check('分類 chip 列出 9 顆（含舊自訂）', await page.evaluate(() => document.querySelectorAll('#cal-catbar button').length === 9));
  // 預設全開：28 號當天 3 個 memo + 1 訂單出貨（recur 週二 28 號＝週二）
  const cnt = () => page.evaluate(() => eventsOn('2026-07-28').length);
  check('預設全開＝5 個事件', (await cnt()) === 5);
  // 關掉訂單日程
  await page.evaluate(() => toggleCalKind('order'));
  check('關訂單日程 → 4 個', (await cnt()) === 4);
  // 關掉「會議」分類
  await page.evaluate(() => toggleCalCat('會議'));
  check('再關會議 → 3 個', (await cnt()) === 3);
  // 關掉備忘類型（收款提醒/舊自訂都是 memo）
  await page.evaluate(() => toggleCalKind('memo'));
  check('再關備忘 → 剩每週盤點 1 個', await page.evaluate(() => { const e = eventsOn('2026-07-28'); return e.length === 1 && e[0].txt.includes('盤點'); }));
  // 新分類上色
  check('出貨物流事件有配色', await page.evaluate(() => {
    const e = eventsOn('2026-07-28')[0];
    return calEvHtml(e).includes('#1F7A7A');
  }));
  // 全部按鈕重置
  await page.evaluate(() => calAllOn());
  check('按全部 → 回到 5 個', (await cnt()) === 5);
  check('全部 chip 亮起', await page.evaluate(() => document.querySelector('#cal-filters .fchip[data-f="all"]').classList.contains('on')));
  // 關閉的分類 chip 變灰虛線
  await page.evaluate(() => toggleCalCat('私人'));
  check('關掉的分類 chip 呈灰色', await page.evaluate(() => {
    const b = [...document.querySelectorAll('#cal-catbar button')].find(x => x.textContent.includes('私人'));
    return b && b.getAttribute('style').includes('dashed') && !b.textContent.includes('✓');
  }));

  // 手機版不溢出
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { gotoPage('cal'); renderCalendar(); });
  await page.waitForTimeout(200);
  check('手機版行事曆頁無橫向溢出', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));

  results.forEach(r => console.log(r[0], r[1]));
  const fails = results.filter(r => r[0] === 'FAIL').length;
  console.log(errors.length ? 'JS ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(fails === 0 && errors.length === 0 ? 'ALL PASS' : `${fails} FAIL`);
  await browser.close();
  process.exit(fails === 0 ? 0 : 1);
})();
