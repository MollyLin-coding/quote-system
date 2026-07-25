/* 側邊選單改版離線測試：報價單四項合併原地展開子選單＋月報表獨立成頁 */
const { chromium } = require('/opt/node-tools/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto('http://localhost:8899/index.html');
  await page.evaluate(() => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 'test-token';
    window.apiCall = async () => ({ ok: true, quotes: [], orders: [], logs: [], records: [], summary: {} });
  });

  const results = [];
  const check = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);
  const cls = async (id) => page.evaluate((id) => document.getElementById(id).className, id);
  const isOn = async (id) => (await cls(id)).split(/\s+/).includes('on');

  /* ---------- 初始狀態（未操作前，純 HTML 預設值） ---------- */
  check('初始：page-new 顯示', await isOn('page-new'));
  check('初始：nav-new 高亮', await isOn('nav-new'));
  check('初始：報價單子選單預設展開', (await cls('qm-sub')).includes('open'));
  check('初始：報價單父項標記為使用中', (await cls('nav-quote')).includes('parent-active'));
  check('初始：月報表頁不存在於畫面上（尚未點過)', !(await isOn('page-report')));

  /* ---------- 手動收合/展開子選單 ---------- */
  await page.evaluate(() => toggleQuoteMenu());
  check('點「報價單」收合子選單', !(await cls('qm-sub')).includes('open'));
  await page.evaluate(() => toggleQuoteMenu());
  check('再點一次「報價單」重新展開', (await cls('qm-sub')).includes('open'));

  /* ---------- 月報表獨立成頁 ---------- */
  await page.evaluate(() => gotoPage('report'));
  await page.waitForTimeout(100);
  check('點「月報表」→ page-report 顯示', await isOn('page-report'));
  check('點「月報表」→ page-orders 隱藏', !(await isOn('page-orders')));
  check('點「月報表」→ nav-report 高亮', await isOn('nav-report'));
  check('點「月報表」→ 報價單父項不再標記使用中', !(await cls('nav-quote')).includes('parent-active'));
  const title = await page.evaluate(() => document.getElementById('tb-title').textContent);
  check('月報表頁標題正確', title === '月報表');
  check('rpt-box 元素仍在（renderReport 找得到掛載點）', await page.evaluate(() => !!document.getElementById('rpt-box')));

  /* ---------- 訂單追蹤頁不再內嵌報表 ---------- */
  await page.evaluate(() => gotoPage('orders'));
  await page.waitForTimeout(100);
  check('點「訂單追蹤」→ page-orders 顯示', await isOn('page-orders'));
  check('點「訂單追蹤」→ page-report 隱藏', !(await isOn('page-report')));
  check('訂單追蹤頁的 DOM 裡沒有月報表卡片重複出現在可見區', await page.evaluate(() => {
    const ordersPage = document.getElementById('page-orders');
    return !ordersPage.querySelector('#rpt-box');
  }));

  /* ---------- 回到報價單子項，確認自動展開＋高亮 ---------- */
  await page.evaluate(() => toggleQuoteMenu()); // 先手動收合
  check('手動收合後子選單為關閉狀態', !(await cls('qm-sub')).includes('open'));
  await page.evaluate(() => gotoPage('records'));
  await page.waitForTimeout(100);
  check('切到「報價紀錄」自動展開子選單', (await cls('qm-sub')).includes('open'));
  check('切到「報價紀錄」報價單父項標記使用中', (await cls('nav-quote')).includes('parent-active'));
  check('切到「報價紀錄」nav-records 高亮', await isOn('nav-records'));

  await page.evaluate(() => gotoPage('custom'));
  await page.waitForTimeout(100);
  check('切到「自訂報價單」nav-custom 高亮', await isOn('nav-custom'));
  check('切到「自訂報價單」報價單父項仍標記使用中', (await cls('nav-quote')).includes('parent-active'));

  await page.evaluate(() => newQuote());
  await page.waitForTimeout(100);
  check('點「新增報價單」nav-new 高亮', await isOn('nav-new'));
  check('點「新增報價單」page-new 顯示', await isOn('page-new'));

  /* ---------- 預覽報價單（子選單內的動作按鈕，不是換頁） ---------- */
  await page.evaluate(() => { document.getElementById('f-no').value = 'PVTEST-01'; });
  await page.evaluate(() => previewCurrent());
  await page.waitForTimeout(150);
  check('點「預覽報價單」開啟預覽視窗', await page.evaluate(() => document.getElementById('pov').style.display === 'block'));
  await page.evaluate(() => { document.getElementById('pov').style.display = 'none'; });

  /* ---------- 出貨驗收／寄售管理 等非報價單分頁，父項不應被標記使用中 ---------- */
  await page.evaluate(() => gotoPage('verify'));
  await page.waitForTimeout(100);
  check('切到「出貨驗收」報價單父項不再標記使用中', !(await cls('nav-quote')).includes('parent-active'));
  check('切到「出貨驗收」nav-verify 高亮', await isOn('nav-verify'));

  console.log('\n=== 測試結果 ===');
  results.forEach(([s, n]) => console.log(s, n));
  const fails = results.filter(r => r[0] === 'FAIL');
  console.log(`\n共 ${results.length} 項，${fails.length} 項失敗`);
  if (errors.length) { console.log('\n=== JS 錯誤 ==='); errors.forEach(e => console.log(e)); }
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
