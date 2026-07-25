/* 提醒事項（備忘/重複行程）可編輯／刪除：修正月曆月檢視下事件標籤點擊冒泡蓋掉編輯視窗的 bug */
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
    window.__deleted = null;
    window.__saved = null;
    window.apiCall = async (p) => {
      if (p.action === 'deleteCalendarItem') { window.__deleted = p.item_id; return { ok: true }; }
      if (p.action === 'saveCalendarItem') { window.__saved = p.item; return { ok: true }; }
      return { ok: true, quotes: [], orders: [], logs: [], records: [] };
    };
  });

  const results = [];
  const check = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);

  await page.evaluate(() => { gotoPage('cal'); });
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    CAL_ITEMS = [
      { item_id: 'ci-1', kind: 'memo', title: '測試提醒', date: '2026-07-15', category: '其他', done: 'N' },
      { item_id: 'ci-2', kind: 'recur', title: '每週對帳', category: '工作', recur_json: '{"freq":"weekly","weekday":2}', done: 'N' },
    ];
    CAL_Y = 2026; CAL_M = 6; CAL_VIEW = 'month'; renderCalendar();
  });
  await page.waitForTimeout(100);

  /* ---------- 月檢視：點事件標籤要開「編輯」而不是被冒泡蓋成「新增」 ---------- */
  await page.click('.cev.memo');
  await page.waitForTimeout(100);
  let st = await page.evaluate(() => ({
    overlay: document.getElementById('ce-overlay').style.display,
    titleH: document.getElementById('ce-title-h').textContent,
    editId: CAL_EDIT_ID,
    delBtn: document.getElementById('ce-del').style.display,
    titleVal: document.getElementById('ce-title').value,
  }));
  check('月檢視點備忘標籤 → 開啟編輯視窗（不是新增）', st.titleH === '編輯事項');
  check('月檢視點備忘標籤 → CAL_EDIT_ID 正確設定', st.editId === 'ci-1');
  check('月檢視點備忘標籤 → 刪除鈕有顯示', st.delBtn === 'inline-block');
  check('月檢視點備忘標籤 → 表單帶入原標題', st.titleVal === '測試提醒');
  await page.evaluate(() => closeCalEdit());

  /* ---------- 重複行程標籤同樣可編輯 ---------- */
  await page.click('.cev.recur');
  await page.waitForTimeout(100);
  st = await page.evaluate(() => ({ titleH: document.getElementById('ce-title-h').textContent, editId: CAL_EDIT_ID }));
  check('月檢視點重複行程標籤 → 開啟編輯視窗', st.titleH === '編輯事項' && st.editId === 'ci-2');

  /* ---------- 點事件標籤不會誤觸底下格子的「新增事項」 ---------- */
  const addOpenedAsNew = await page.evaluate(() => document.getElementById('ce-title-h').textContent === '新增事項');
  check('點標籤後不會被底下格子的新增事項蓋掉', !addOpenedAsNew);

  /* ---------- 刪除流程：確認會呼叫後端 deleteCalendarItem 帶正確 id ---------- */
  await page.evaluate(() => { window.confirm = () => true; });
  await page.evaluate(() => deleteCalItem());
  await page.waitForTimeout(150);
  const deletedId = await page.evaluate(() => window.__deleted);
  check('點刪除 → 呼叫 deleteCalendarItem 帶正確 item_id', deletedId === 'ci-2');
  check('刪除成功後編輯視窗關閉', await page.evaluate(() => document.getElementById('ce-overlay').style.display === 'none'));

  /* ---------- 編輯流程：改標題後儲存，帶原本 item_id（更新而非新增一筆） ---------- */
  await page.evaluate(() => {
    CAL_ITEMS = [{ item_id: 'ci-1', kind: 'memo', title: '測試提醒', date: '2026-07-15', category: '其他', done: 'N' }];
    renderCalendar();
  });
  await page.waitForTimeout(100);
  await page.click('.cev.memo');
  await page.waitForTimeout(100);
  await page.evaluate(() => { document.getElementById('ce-title').value = '測試提醒（已修改）'; });
  await page.evaluate(() => saveCalItem());
  await page.waitForTimeout(150);
  const saved = await page.evaluate(() => window.__saved);
  check('儲存編輯 → item_id 沿用原本的 ci-1（更新而非新增）', saved && saved.item_id === 'ci-1');
  check('儲存編輯 → 標題已更新', saved && saved.title === '測試提醒（已修改）');

  /* ---------- 出貨/到期事件（訂單自動產生）點擊仍正常跳轉，不受影響 ---------- */
  await page.evaluate(() => {
    CAL_ITEMS = [];
    ORDERS_CACHE = [{ no: 'O-9', client: '客戶Z｜台北', typeKey: 'bottle', total: 1, quoteDate: '2026-07-01',
      st: { status: 'deposit', ship_date_est: '2026-07-15' }, src: 'std' }];
    renderCalendar();
  });
  await page.waitForTimeout(100);
  const shipClickOk = await page.evaluate(() => document.querySelector('.cev.ship') && document.querySelector('.cev.ship').getAttribute('onclick').includes("gotoPage('orders')"));
  check('出貨事件標籤仍可點擊跳轉訂單頁（未被 stopPropagation 誤傷）', !!shipClickOk);

  /* ---------- 列表檢視（週/30天）：本來就沒有冒泡問題，確認沒有被改壞 ---------- */
  await page.evaluate(() => {
    CAL_ITEMS = [{ item_id: 'ci-3', kind: 'memo', title: '列表檢視測試', date: fmtD(new Date()), category: '其他', done: 'N' }];
    CAL_VIEW = 'week'; renderCalendar();
  });
  await page.waitForTimeout(100);
  await page.click('.cev.memo');
  await page.waitForTimeout(100);
  const listEditOk = await page.evaluate(() => document.getElementById('ce-title-h').textContent === '編輯事項' && CAL_EDIT_ID === 'ci-3');
  check('列表檢視點備忘標籤仍可正常開啟編輯', listEditOk);

  console.log('\n=== 測試結果 ===');
  results.forEach(([s, n]) => console.log(s, n));
  const fails = results.filter(r => r[0] === 'FAIL');
  console.log(`\n共 ${results.length} 項，${fails.length} 項失敗`);
  if (errors.length) { console.log('\n=== JS 錯誤 ==='); errors.forEach(e => console.log(e)); }
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
