/* 2026-09-07：Molly 回報「月曆格子文字被截斷看不完整」（截圖：格子太窄，長事件被省略號切掉）。
   查證：.cev 的 CSS 本來就是 white-space:nowrap+overflow:hidden+text-overflow:ellipsis（月曆格子
   空間本來就窄，不可能塞下所有內容），但 calEvHtml() 產生的 <span> 一直沒有 title 屬性──滑鼠移
   上去沒有瀏覽器原生提示可以看完整內容，只能用點的（點了會跳去開那張單/備忘，不方便只是想看一眼）。
   修法：calEvHtml() 幫每個事件標籤加 title="完整文字"（跟 innerHTML 用的 escHtml 分開跑
   escAttr，含單引號/雙引號的標題也不會壞掉）。純顯示層修改，不影響點擊行為、資料、排序。
   這支測試切回 git stash 版本重跑會 FAIL（title 屬性不存在），確認測試真的抓得到回歸。 */
const { chromium } = require('playwright');

async function run() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  page.route('**/script.google.com/**', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, users: [], list: [] }) });
  });

  await page.goto('http://localhost:8899/index.html');
  await page.waitForFunction(() => {
    const sel = document.getElementById('login-user');
    return sel && sel.options && sel.options.length > 0 && sel.options[0].textContent.indexOf('載入中') === -1;
  }, { timeout: 15000 }).catch(() => {});

  const results = [];
  const check = (name, cond, info) => { results.push({ name, pass: !!cond, info }); };

  const r = await page.evaluate(() => {
    // 一般出貨事件：文字含全形括號、單引號、雙引號，確認 escAttr 有正確處理不會壞掉屬性
    const e1 = { t: 'ship', txt: '🚚 客戶"Bar"O\'Reilly 出貨（第2批/共3批）（20260101-01）', no: '20260101-01' };
    const e2 = { t: 'memo', txt: '📌 提醒事項', item: { item_id: 'M1', category: '' } };
    const e3 = { t: 'exp', txt: '⏰ 過期提醒', no: '' };
    const h1 = calEvHtml(e1);
    const h2 = calEvHtml(e2);
    const h3 = calEvHtml(e3);
    document.getElementById('cal-root').innerHTML = h1 + h2 + h3;
    const spans = Array.from(document.querySelectorAll('#cal-root .cev'));
    return {
      count: spans.length,
      titles: spans.map(s => s.getAttribute('title')),
      texts: spans.map(s => s.textContent),
      h1HasTitleAttr: /title="/.test(h1),
      titleMatchesText: spans.every(s => s.getAttribute('title') === s.textContent),
    };
  });

  check('1 三種事件類型都有 title 屬性', r.count === 3 && r.titles.every(t => !!t), JSON.stringify(r.titles));
  check('2 title 內容跟顯示文字完全一致（含特殊字元也不跳脫壞掉）', r.titleMatchesText, JSON.stringify(r));
  check('3 含單引號/雙引號的事件文字，title 屬性沒有把 HTML 弄壞', r.h1HasTitleAttr && r.titles[0].indexOf('客戶"Bar"O\'Reilly') >= 0, JSON.stringify(r));

  // 再驗證：renderCalMonth／renderCalList 產生的月曆／清單畫面，事件標籤真的有 title
  const r2 = await page.evaluate(async () => {
    if (typeof CAL_ITEMS === 'undefined') window.CAL_ITEMS = [];
    CAL_ITEMS.length = 0;
    CAL_ITEMS.push({ item_id: 'X1', kind: 'memo', title: '這是一個很長很長很長會被截斷看不完整的備忘事項標題測試文字', date: (new Date()).toISOString().slice(0,10), done: 'N', category: '' });
    if (typeof CAL_VIEW !== 'undefined') CAL_VIEW = 'month';
    if (typeof renderCalendar === 'function') renderCalendar();
    const el = document.querySelector('#cal-root .cev.memo');
    return { found: !!el, title: el ? el.getAttribute('title') : null, txt: el ? el.textContent : null };
  });
  check('4 月曆檢視（renderCalMonth）實際渲染出來的事件標籤也有 title，且跟顯示文字一致', r2.found && r2.title === r2.txt && /很長很長/.test(r2.title || ''), JSON.stringify(r2));

  const r3 = await page.evaluate(async () => {
    if (typeof CAL_VIEW !== 'undefined') CAL_VIEW = 'week';
    if (typeof renderCalendar === 'function') renderCalendar();
    const el = document.querySelector('#cal-root .cev.memo');
    return { found: !!el, title: el ? el.getAttribute('title') : null };
  });
  check('5 清單檢視（renderCalList，週/月）也有 title', r3.found && !!r3.title, JSON.stringify(r3));

  await browser.close();

  const fails = results.filter(x => !x.pass);
  results.forEach(x => console.log((x.pass ? 'PASS' : 'FAIL') + ' ' + x.name + (x.pass ? '' : '   → ' + x.info)));
  console.log(errors.length ? ('JS ERRORS: ' + errors.join(' | ')) : 'NO JS ERRORS');
  console.log(results.length + ' checks');
  console.log(fails.length === 0 ? 'ALL PASS' : (fails.length + ' FAILED'));
  process.exit(fails.length === 0 && errors.length === 0 ? 0 : 1);
}
run();
