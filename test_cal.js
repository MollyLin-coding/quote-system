/* 行事曆分類擴充＋勾選篩選 離線測試
   ------------------------------------------------------------------
   ⚠ 開頁時序（原本這支會當掉的真正原因）：
     99_boot.js 開場會打一支 loadLoginUsers() → 真的 apiCall({action:'getLoginUsers'})。
     這支打不通（離線），而 'getLoginUsers' 不在 00_utils.js 的 RC_READ_ACTIONS 白名單裡，
     所以 02_core_api.js 的 apiCall 例外路徑會判定「非讀取」而呼叫 rcClear()；
     rcClear() 會跑 RC_RESETS，其中 07_calendar.js 登記了 onCacheClear(()=>{ CAL_ITEMS=[] })，
     loadOrders 那邊也會把 ORDERS_CACHE 歸零。
     實測這一發約在開頁後 ~0.5 秒落地。原本的測試 goto 完立刻塞資料 + loadCalendar()，
     資料就被這一發清光 → eventsOn() 全空 → calEvHtml(undefined) 噴
     「Cannot read properties of undefined (reading 't')」。
     修法：等 #login-user 不再是「載入中…」（＝那一發已經結束）再塞資料，不用猜秒數。

   選用的 mutation 驗證（不改產品碼，只在頁面上臨時覆寫函式）：
     CAL_MUTATE=catoff|kindoff|nocolor|recurstr|allon|chipgray node test_cal.js
   ------------------------------------------------------------------ */
const { chromium } = require('/opt/node-tools/node_modules/playwright');

const MUTATE = process.env.CAL_MUTATE || '';

/* 基準資料：跟原本測試完全一樣的四筆，好讓「5 / 4 / 3 / 1」這些數字保持原意 */
const BASE_ITEMS = [
  { item_id: 'c1', kind: 'memo', date: '2026-07-28', title: '開會', category: '會議', all_day: 'Y', done: 'N' },
  { item_id: 'c2', kind: 'memo', date: '2026-07-28', title: '收貨款', category: '收款提醒', all_day: 'Y', done: 'N' },
  { item_id: 'c3', kind: 'memo', date: '2026-07-28', title: '舊資料自訂', category: '報稅季', all_day: 'Y', done: 'N' },
  { item_id: 'c4', kind: 'recur', recur_json: '{"freq":"weekly","weekday":2}', title: '每週盤點', category: '出貨物流', all_day: 'Y', done: 'N' },
];

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.goto('http://localhost:8899/index.html');

  // 等 99_boot.js 那一發 getLoginUsers 收工（成功會填人名、失敗會填 Molly），rcClear 才不會半路清掉資料
  await page.waitForFunction(() => {
    const s = document.getElementById('login-user');
    return !!s && s.textContent.indexOf('載入中') < 0;
  }, null, { timeout: 30000 });
  await page.waitForTimeout(150);

  await page.evaluate((items) => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 't';
    window.confirm = () => true;
    window.CAL_TEST_ITEMS = items;
    window.apiCall = async (p) => {
      if (p.action === 'listCalendarItems') return { ok: true, items: window.CAL_TEST_ITEMS.map(x => Object.assign({}, x)) };
      // 行事曆現在會與訂單資料平行載入（不再是「有 ORDERS_CACHE 就不抓」），
      // 所以這裡要回傳等價的訂單資料，讓 ORDERS_CACHE 重建後仍是同一張出貨單。
      if (p.action === 'getQuotes') return { ok: true, quotes: [
        { quoteNo:'O1', quoteType:'bottle', clientName:'客戶A', quoteDate:'2026-07-01', grandTotal:1, status:'', expiryDate:'' }
      ]};
      if (p.action === 'getOrderStatusList') return { ok: true, orders: [
        { quote_no:'O1', status:'deposit', ship_date_est:'2026-07-28' }
      ]};
      return { ok: true, quotes: [], orders: [] };
    };
    ORDERS_CACHE = [{ no: 'O1', client: '客戶A', typeKey: 'bottle', total: 1, quoteDate: '2026-07-01',
      st: { status: 'deposit', ship_date_est: '2026-07-28' }, src: 'std' }];
  }, BASE_ITEMS);

  /* ---- 選用：runtime override 把被測邏輯弄壞，用來確認斷言真的會咬 ---- */
  if (MUTATE) await page.evaluate((m) => {
    if (m === 'catoff')  window.calCatOn = () => true;                       // 分類開關失效
    if (m === 'kindoff') window.toggleCalKind = () => renderCalendar();      // 類型開關失效
    if (m === 'nocolor') { const o = window.calEvHtml; window.calEvHtml = e => String(o(e)).replace(/ style="[^"]*"/, ''); }
    if (m === 'recurstr') window.recurHitsOn = (it, d) => {                  // 退回「不轉數字」的嚴格比對
      try { const r = it && it.recur_json != null ? JSON.parse(it.recur_json) : (it || {});
            return r.freq === 'weekly' && d.getDay() === r.weekday; } catch (e) { return false; }
    };
    if (m === 'allon')   window.calAllOn = () => renderCalendar();           // 「全部」按了不重置
    if (m === 'chipgray') { const o = window.renderCalCatBar; window.renderCalCatBar = function () {
      o.apply(this, arguments); const el = document.getElementById('cal-catbar');
      if (el) el.innerHTML = el.innerHTML.replace(/dashed/g, 'solid'); }; }
  }, MUTATE);

  const results = [];
  const check = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);
  // 每個測項自己包例外：某一項爆掉只該讓那一項 FAIL，不該整支測試當掉
  const checkA = async (n, fn) => {
    try { check(n, !!(await fn())); }
    catch (e) { results.push(['FAIL', n + '  [EXCEPTION: ' + e.message + ']']); }
  };

  const reload = async (items) => {
    await page.evaluate(async (its) => {
      window.CAL_TEST_ITEMS = its;
      CAL_Y = 2026; CAL_M = 6;
      calAllOn();                       // 每個階段都從「全開」起跑
      await loadCalendar(true);         // force：略過 90 秒讀取快取，一定重打 stub
    }, items);
    await page.waitForTimeout(300);
  };

  const DAY = '2026-07-28';   // 週二：memo 三筆 + 訂單出貨 + 每週盤點都落在這天
  const evs = (d) => page.evaluate(ds => eventsOn(ds).map(e => ({ t: e.t, txt: e.txt })), d || DAY);
  const cnt = async (d) => (await evs(d)).length;

  /* ================= 第一階段：原本的 11 個測項（資料與數字完全比照原版） ================= */
  await reload(BASE_ITEMS);

  // 新分類進了編輯視窗選單
  /* 2026-09-02 Molly 要求把「私人」分類整個從系統移除（她的私人行程要跟這套系統分開），
     所以內建分類從 8 種變 7 種、chip 也少一顆。這是刻意的產品變更，不是回歸。 */
  await checkA('編輯選單有 7 種分類（2026-09-02 起不含「私人」）', () =>
    page.evaluate(() => document.querySelectorAll('#ce-category option').length === 7));
  await checkA('編輯選單不再有「私人」', () =>
    page.evaluate(() => !/私人/.test(document.getElementById('ce-category').innerHTML)));
  // 分類 chip 列（7 內建 + 1 舊資料自訂）
  await checkA('分類 chip 列出 8 顆（含舊自訂、不含私人）', () =>
    page.evaluate(() => document.querySelectorAll('#cal-catbar button').length === 8));
  // 預設全開：28 號當天 3 個 memo + 1 訂單出貨（recur 週二 28 號＝週二）
  await checkA('預設全開＝5 個事件', async () => (await cnt()) === 5);
  // 關掉訂單日程
  await page.evaluate(() => toggleCalKind('order'));
  await checkA('關訂單日程 → 4 個', async () => (await cnt()) === 4);
  // 關掉「會議」分類
  await page.evaluate(() => toggleCalCat('會議'));
  await checkA('再關會議 → 3 個', async () => (await cnt()) === 3);
  // 關掉備忘類型（收款提醒/舊自訂都是 memo）
  await page.evaluate(() => toggleCalKind('memo'));
  await checkA('再關備忘 → 剩每週盤點 1 個', async () => {
    const e = await evs();
    return e.length === 1 && e[0].txt.includes('盤點');
  });
  // 新分類上色（出貨物流 fg=#1F7A7A，來自 04_company.js 的 CAL_CATEGORY_COLORS）
  await checkA('出貨物流事件有配色', () => page.evaluate(() => {
    const e = eventsOn('2026-07-28')[0];
    return !!e && calEvHtml(e).includes('#1F7A7A');
  }));
  // 全部按鈕重置
  await page.evaluate(() => calAllOn());
  await checkA('按全部 → 回到 5 個', async () => (await cnt()) === 5);
  await checkA('全部 chip 亮起', () => page.evaluate(() => {
    const b = document.querySelector('#cal-filters .fchip[data-f="all"]');
    return !!b && b.classList.contains('on');
  }));
  // 關閉的分類 chip 變灰虛線
  await page.evaluate(() => toggleCalCat('採購'));
  await checkA('關掉的分類 chip 呈灰色', () => page.evaluate(() => {
    const b = [...document.querySelectorAll('#cal-catbar button')].find(x => x.textContent.includes('採購'));
    return !!b && (b.getAttribute('style') || '').includes('dashed') && !b.textContent.includes('✓');
  }));

  /* ================= 第二階段：分類／類型開關的其他組合 ================= */
  await reload(BASE_ITEMS);

  // 分類開關對「重複行程」也要生效（不是只管備忘）
  await page.evaluate(() => toggleCalCat('出貨物流'));
  await checkA('只關出貨物流分類 → 每週盤點消失、其餘 4 個還在', async () => {
    const e = await evs();
    return e.length === 4 && !e.some(x => x.txt.includes('盤點'));
  });
  await page.evaluate(() => toggleCalCat('出貨物流'));
  await checkA('分類再打開 → 回到 5 個', async () => (await cnt()) === 5);

  // 只關重複行程類型，備忘與訂單不受影響
  await page.evaluate(() => toggleCalKind('recur'));
  await checkA('只關重複行程 → 4 個且都不是 recur', async () => {
    const e = await evs();
    return e.length === 4 && !e.some(x => x.t === 'recur');
  });
  await checkA('關重複行程時「全部」chip 熄滅', () => page.evaluate(() => {
    const b = document.querySelector('#cal-filters .fchip[data-f="all"]');
    return !!b && !b.classList.contains('on');
  }));
  await page.evaluate(() => calAllOn());

  // 分類 chip 的顏色取自 CAL_CATEGORY_COLORS；未知的舊分類用灰色 fallback
  await checkA('會議 chip 用配色表的顏色', () => page.evaluate(() => {
    const b = [...document.querySelectorAll('#cal-catbar button')].find(x => x.textContent.includes('會議'));
    const c = CAL_CATEGORY_COLORS['會議'], st = b && b.getAttribute('style') || '';
    return !!b && st.includes(c.bg) && st.includes(c.fg) && st.includes(c.bd);
  }));
  await checkA('舊自訂分類 chip 用灰色 fallback', () => page.evaluate(() => {
    const b = [...document.querySelectorAll('#cal-catbar button')].find(x => x.textContent.includes('報稅季'));
    const st = b && b.getAttribute('style') || '';
    return !!b && st.includes('#EDEDED') && st.includes('#5A5A5A');
  }));
  // 編輯選單的分類清單＝配色表的 key，兩邊不能對不起來（不然新分類會沒有顏色）
  await checkA('編輯選單分類與配色表完全一致', () => page.evaluate(() => {
    const opts = [...document.querySelectorAll('#ce-category option')].map(o => o.textContent.trim());
    const keys = Object.keys(CAL_CATEGORY_COLORS);
    return opts.length === keys.length && opts.every((v, i) => v === keys[i]);
  }));

  // 備忘也要依分類上色；訂單自動事件（ship）維持固定配色、不套分類色
  await checkA('收款提醒備忘依分類上色', () => page.evaluate(() => {
    const e = eventsOn('2026-07-28').find(x => x.txt.includes('收貨款'));
    return !!e && calEvHtml(e).includes(CAL_CATEGORY_COLORS['收款提醒'].fg);
  }));
  await checkA('訂單出貨事件不套分類色', () => page.evaluate(() => {
    const e = eventsOn('2026-07-28').find(x => x.t === 'ship');
    return !!e && !/ style="/.test(calEvHtml(e));
  }));

  /* ================= 第三階段：共用 recurHitsOn ＋ 未填分類歸「其他」 ================= */
  await reload(BASE_ITEMS.concat([
    // 舊資料常見：weekday 被存成字串。recurHitsOn（js/00_utils.js）要能轉數字，否則整條會從月曆消失
    { item_id: 'c5', kind: 'recur', recur_json: '{"freq":"weekly","weekday":"2"}', title: '字串週二盤點', category: '工作', all_day: 'Y', done: 'N' },
    // 沒填分類的備忘，應歸到「其他」，跟著「其他」chip 開關
    { item_id: 'c6', kind: 'memo', date: '2026-07-28', title: '沒填分類', category: '', all_day: 'Y', done: 'N' },
  ]));

  await checkA('weekday 存成字串的重複行程照樣顯示', async () => {
    const e = await evs();
    return e.some(x => x.txt.includes('字串週二盤點'));
  });
  await checkA('兩條重複行程在下一個週二（8/4）也會出現', async () => {
    const e = await evs('2026-08-04');
    return e.some(x => x.txt.includes('每週盤點')) && e.some(x => x.txt.includes('字串週二盤點'));
  });
  await checkA('重複行程不會跑到非週二（7/29 週三）', async () => {
    const e = await evs('2026-07-29');
    return e.length === 0;
  });
  await checkA('未填分類的備忘預設看得到', async () => {
    const e = await evs();
    return e.some(x => x.txt.includes('沒填分類'));
  });
  await page.evaluate(() => toggleCalCat('其他'));
  await checkA('關掉「其他」→ 未填分類的備忘跟著消失', async () => {
    const e = await evs();
    return !e.some(x => x.txt.includes('沒填分類'));
  });
  await page.evaluate(() => calAllOn());
  await checkA('按全部 → 7 個事件（含新增的兩筆）', async () => (await cnt()) === 7);

  /* ================= 手機版不溢出 ================= */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { gotoPage('cal'); renderCalendar(); });
  await page.waitForTimeout(200);
  await checkA('手機版行事曆頁無橫向溢出', () =>
    page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));

  results.forEach(r => console.log(r[0], r[1]));
  const fails = results.filter(r => r[0] === 'FAIL').length;
  console.log(errors.length ? 'JS ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(`${results.length} checks` + (MUTATE ? `  (CAL_MUTATE=${MUTATE})` : ''));
  console.log(fails === 0 && errors.length === 0 ? 'ALL PASS' : `${fails} FAIL`);
  await browser.close();
  process.exit(fails === 0 && errors.length === 0 ? 0 : 1);
})();
