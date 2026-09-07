/* 2026-09-07（第三批）：Molly 說「兩件事都要」——除了 20260907b 的 title 提示，
   還要把月曆格子加高、事件文字換行，讓被截斷的內容直接看得到更多。
   改法（assets/app.css）：
   - .cev 從 white-space:nowrap＋省略號 → display:-webkit-box + -webkit-line-clamp:3
     + white-space:normal + overflow-wrap:anywhere，最多換到 3 行。
     （先做 2 行，實測她真實的出貨事件還會差一點點，改 3 行才完整顯示——見 #6。）
   - .cd（日格）min-height 64px → 92px；手機版 44px → 68px。
   這支測試切回未修版本重跑會 FAIL 5 項（.cev 仍是 nowrap、長文字不會換行、min-height 沒加高）。 */
const { chromium } = require('playwright');

async function run() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text())) errors.push(m.text()); });

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

  /* ⚠ 一定要先 gotoPage('cal') 讓行事曆頁真的顯示出來，否則 getBoundingClientRect() 全部量到 0
     （#page-cal 沒顯示時元素沒有版面高度），「有沒有換行」就驗不出來。
     ⚠ 而且 gotoPage('cal') 自己會打一趟 loadCalendar 洗掉 CAL_ITEMS，所以要先切頁、再塞資料。 */
  await page.evaluate(() => { if (typeof gotoPage === 'function') gotoPage('cal'); });
  await page.waitForTimeout(600);

  // 在月曆檢視塞一短一長兩筆備忘，比較兩者的實際高度
  const r = await page.evaluate(() => {
    if (typeof CAL_ITEMS === 'undefined') window.CAL_ITEMS = [];
    CAL_ITEMS.length = 0;
    const today = (new Date()).toISOString().slice(0, 10);
    CAL_ITEMS.push({ item_id: 'SHORT', kind: 'memo', title: '短', date: today, done: 'N', category: '' });
    CAL_ITEMS.push({ item_id: 'LONG', kind: 'memo', title: '囍酒工藝股份有限公司 出貨（第2批/共3批）（20260813-01）補充說明很長很長', date: today, done: 'N', category: '' });
    if (typeof CAL_VIEW !== 'undefined') CAL_VIEW = 'month';
    if (typeof renderCalendar === 'function') renderCalendar();
    const spans = Array.from(document.querySelectorAll('#cal-root .cev.memo'));
    const shortEl = spans.find(s => s.textContent.indexOf('短') >= 0 && s.textContent.length < 8);
    const longEl = spans.find(s => s.textContent.indexOf('囍酒工藝') >= 0);
    const cs = shortEl ? getComputedStyle(shortEl) : null;
    const cd = document.querySelector('#cal-root .cd');
    return {
      foundBoth: !!(shortEl && longEl),
      whiteSpace: cs ? cs.whiteSpace : null,
      shortH: shortEl ? shortEl.getBoundingClientRect().height : 0,
      longH: longEl ? longEl.getBoundingClientRect().height : 0,
      lineClamp: cs ? (cs.webkitLineClamp || cs.lineClamp) : null,
      cdMinHeight: cd ? getComputedStyle(cd).minHeight : null,
      longStillHasTitle: longEl ? !!longEl.getAttribute('title') : false,
    };
  });

  check('1 .cev 不再是 nowrap（文字可以換行）', r.whiteSpace && r.whiteSpace !== 'nowrap', JSON.stringify(r));
  check('2 長事件真的換成兩行（高度明顯大於短事件）', r.foundBoth && r.longH > r.shortH * 1.5, JSON.stringify(r));
  check('3 限制在 3 行（放得下真實出貨事件，又不會把整個月曆撐爆）', String(r.lineClamp) === '3', JSON.stringify(r));
  check('4 日格 min-height 已加高到 92px', r.cdMinHeight === '92px', JSON.stringify(r));
  check('5 20260907b 的 title 提示還在（超過三行的極長文字仍看得到全文）', r.longStillHasTitle, JSON.stringify(r));

  /* 最重要的一項：Molly 真實會看到的出貨事件（客戶名＋第N批/共M批＋單號）要「完整顯示、沒被截」。
     判準＝scrollHeight === clientHeight（內容沒有溢出被藏起來），這比目測截圖可靠。 */
  const real = await page.evaluate(() => {
    CAL_ITEMS.length = 0;
    const add = (id, t) => CAL_ITEMS.push({ item_id: id, kind: 'memo', title: t, date: '2026-09-10', done: 'N', category: '出貨物流' });
    add('R1', '酒肉朋友 出貨（第1批/共3批）（20260806-01）');
    add('R2', '囍酒工藝股份有限公司 出貨（20260813-01）');
    if (typeof CAL_Y !== 'undefined') { CAL_Y = 2026; CAL_M = 8; }
    renderCalendar();
    return Array.from(document.querySelectorAll('#cal-root .cev.memo')).map(el => ({
      txt: el.textContent.slice(0, 12),
      clipped: el.scrollHeight > el.clientHeight + 1,
    }));
  });
  check('6 真實的出貨事件文字完整顯示、沒有被截掉', real.length === 2 && real.every(x => !x.clipped), JSON.stringify(real));

  // 桌機版不可以有橫向溢出
  const noOverflowDesktop = await page.evaluate(() => {
    if (typeof gotoPage === 'function') gotoPage('cal');
    return document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1;
  });
  check('7 桌機版行事曆頁沒有橫向溢出', noOverflowDesktop, 'scrollWidth > clientWidth');

  // 手機版：格子加高、一樣不可以橫向溢出
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const mob = await page.evaluate(() => {
    if (typeof renderCalendar === 'function') renderCalendar();
    const cd = document.querySelector('#cal-root .cd');
    return {
      minH: cd ? getComputedStyle(cd).minHeight : null,
      noOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    };
  });
  check('8 手機版日格 min-height 加高到 68px', mob.minH === '68px', JSON.stringify(mob));
  check('9 手機版行事曆頁沒有橫向溢出', mob.noOverflow, JSON.stringify(mob));

  await browser.close();

  const fails = results.filter(x => !x.pass);
  results.forEach(x => console.log((x.pass ? 'PASS' : 'FAIL') + ' ' + x.name + (x.pass ? '' : '   → ' + x.info)));
  console.log(errors.length ? ('JS ERRORS: ' + errors.join(' | ')) : 'NO JS ERRORS');
  console.log(results.length + ' checks');
  console.log(fails.length === 0 ? 'ALL PASS' : (fails.length + ' FAILED'));
  process.exit(fails.length === 0 && errors.length === 0 ? 0 : 1);
}
run();
