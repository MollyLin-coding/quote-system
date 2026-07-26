/* 「今日待辦」急／不急（後端 v35 urgent 旗標）離線測試：
   ①不急的列淡化＋分隔線 ②徽章＝急件數 ③排序照後端給的順序 ④全部不急時的好消息列
   ⑤fallback 範圍與 digest 預設 all 一致（尾款不再砍 7 天外的、未開發票不再砍 7 天內的） */
const { chromium } = require('/opt/node-tools/node_modules/playwright');

const MIX = {
  ok: true, today: '2026-07-26', scope: 'all',
  ship_due: [{ quote_no: 'S-1', client: '酒旺商行', plan_ship_date: '2026-07-20', overdue_days: 6, urgent: true }],
  final_due: [
    { quote_no: 'F-1', client: 'BABY 酒館', final_amt: 36000, is_estimated: true, plan_final_date: '2026-07-22', overdue: true, overdue_days: 4, urgent: true, days_until: -4 },
    { quote_no: 'F-2', client: '中和店', final_amt: 12000, is_estimated: false, plan_final_date: '2026-08-20', overdue: false, overdue_days: 0, urgent: false, days_until: 25 },
    { quote_no: 'F-3', client: '七二巷', final_amt: 8000, is_estimated: false, plan_final_date: '2026-09-01', overdue: false, overdue_days: 0, urgent: false, days_until: 37 },
  ],
  no_scan: [{ quote_no: 'N-1', lot: 'L2607', client: '滿枝枒', ship_date: '2026-07-15', days_since: 11, urgent: true }],
  no_invoice: [
    { quote_no: 'I-1', client: '有趣市集', ship_date: '2026-07-02', days_since: 24, urgent: true },
    { quote_no: 'I-2', client: '囍酒工藝', ship_date: '2026-07-24', days_since: 2, urgent: false },
  ],
  calendar: [{ item_id: 'C1', title: '拜訪囍酒工藝', category: '拜訪客戶', time: '10:30', all_day: false }],
  warnings: [],
};
const CALM = {
  ok: true, today: '2026-07-26', scope: 'all',
  ship_due: [], no_scan: [], calendar: [], warnings: [],
  final_due: [{ quote_no: 'F-9', client: '慢慢來', final_amt: 5000, is_estimated: false, plan_final_date: '2026-09-30', overdue: false, overdue_days: 0, urgent: false, days_until: 66 }],
  no_invoice: [{ quote_no: 'I-9', client: '不急', ship_date: '2026-07-25', days_since: 1, urgent: false }],
};

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
      window.DIGEST = digest;
      window.DIGEST_FAIL = !!(opts && opts.digestFail);
      window.apiCall = async (payload) => {
        window.CALLS.push(payload);
        if (payload.action === 'getTodayDigest') {
          if (window.DIGEST_FAIL) return { ok: false, error: 'unknown action' };
          return window.DIGEST;
        }
        if (payload.action === 'getOrderStatusList') return { ok: true, orders: (opts && opts.orders) || [] };
        if (payload.action === 'getQuotes') return { ok: true, quotes: (opts && opts.quotes) || [] };
        if (payload.action === 'listCalendarItems') return { ok: true, items: [] };
        if (payload.action === 'listCustomQuotes') return { ok: true, quotes: [] };
        if (payload.action === 'getVerifications') return { ok: true, records: [], summary: {} };
        if (payload.action === 'listVerifyForms') return { ok: true, records: [], summary: {} };
        return { ok: true, quotes: [], orders: [], records: [], items: [], logs: [], shipments: [] };
      };
    }, { digest, opts: opts || {} });
  };
  const load = async (p) => {
    await p.evaluate(async () => { localStorage.clear(); gotoPage('today'); await loadToday(true); });
    await p.waitForTimeout(400);
  };

  /* ---------- 1. 混合：急／不急分組顯示 ---------- */
  const p1 = await newPage();
  await stub(p1, MIX);
  await load(p1);

  check('徽章＝急件數（不含不急的）', await p1.evaluate(() =>
    [...document.querySelectorAll('#td-body .td-ch .n')].map(e => e.textContent).join(',') === '1,1,1,1,1'));
  check('不急的列仍然全部列出來（尾款卡 3 列）', await p1.evaluate(() =>
    document.querySelectorAll('#td-body .td-card')[1].querySelectorAll('.td-row').length === 3));
  check('尾款卡有「以下還不急（2）」分隔線', await p1.evaluate(() => {
    const s = document.querySelectorAll('#td-body .td-card')[1].querySelector('.td-sep');
    return s && s.innerText.includes('以下還不急') && s.innerText.includes('2');
  }));
  check('分隔線出現在急的之後、不急的之前', await p1.evaluate(() => {
    const kids = [...document.querySelectorAll('#td-body .td-card')[1].children].slice(1);
    return kids[0].classList.contains('td-row') && !kids[0].classList.contains('dim')
      && kids[1].classList.contains('td-sep')
      && kids[2].classList.contains('dim') && kids[3].classList.contains('dim');
  }));
  check('不急的列加了 dim 樣式且真的變淡', await p1.evaluate(() => {
    const dim = document.querySelectorAll('#td-body .td-card')[1].querySelectorAll('.td-row.dim');
    return dim.length === 2 && parseFloat(getComputedStyle(dim[0]).opacity) < 0.8;
  }));
  check('急的列沒有被淡化', await p1.evaluate(() => {
    const rows = document.querySelectorAll('#td-body .td-card')[1].querySelectorAll('.td-row');
    return !rows[0].classList.contains('dim') && parseFloat(getComputedStyle(rows[0]).opacity) === 1;
  }));
  check('不急的尾款標「還有 N 天」', await p1.evaluate(() =>
    document.querySelectorAll('#td-body .td-card')[1].querySelectorAll('.td-row')[1].innerText.includes('還有 25 天')));
  check('未開發票卡也分組（1 急 1 不急）', await p1.evaluate(() => {
    const c = document.querySelectorAll('#td-body .td-card')[3];
    return c.querySelectorAll('.td-row').length === 2 && c.querySelectorAll('.td-row.dim').length === 1 && c.querySelector('.td-sep') !== null;
  }));
  check('不急的未開發票不標紅／橘', await p1.evaluate(() => {
    const dim = document.querySelectorAll('#td-body .td-card')[3].querySelector('.td-row.dim');
    return dim.querySelector('.td-tag.grey') !== null && dim.querySelector('.td-tag.red') === null && dim.querySelector('.td-tag.warn') === null;
  }));
  check('沒有 urgent 欄位的（行事曆）一律當急的、不淡化', await p1.evaluate(() => {
    const c = document.querySelectorAll('#td-body .td-card')[4];
    return c.querySelectorAll('.td-row').length === 1 && c.querySelectorAll('.dim').length === 0 && c.querySelector('.td-sep') === null;
  }));
  check('全急的卡片不出現分隔線', await p1.evaluate(() =>
    document.querySelectorAll('#td-body .td-card')[0].querySelector('.td-sep') === null));
  check('照後端給的順序渲染（F-1→F-2→F-3）', await p1.evaluate(() =>
    [...document.querySelectorAll('#td-body .td-card')[1].querySelectorAll('.td-row')].map(r => r.innerText.split('\n').pop().slice(0, 3)).join(',') === 'F-1,F-2,F-3'));
  check('點不急的列一樣打得開訂單', await p1.evaluate(async () => {
    ORDERS_CACHE = [{ no: 'F-2', client: '中和店', typeKey: 'bottle', total: 12000, quoteDate: '2026-07-01', expiry: '', st: { status: 'shipped' }, src: 'std' }];
    document.querySelectorAll('#td-body .td-card')[1].querySelectorAll('.td-row')[1].click();
    await new Promise(r => setTimeout(r, 300));
    return currentPage === 'orders' && ORD_EDITING === 'F-2';
  }));

  /* ---------- 2. 全部都不急 ---------- */
  const p2 = await newPage();
  await stub(p2, CALM);
  await load(p2);
  check('沒有急件時顯示「今天沒有急件」好消息列', await p2.evaluate(() => {
    const el = document.querySelector('#td-body .td-calm');
    return el !== null && el.innerText.includes('今天沒有急件');
  }));
  check('好消息列在卡片上方', await p2.evaluate(() => {
    const b = document.getElementById('td-body');
    return b.firstElementChild.classList.contains('td-calm') && b.querySelector('.td-grid') !== null;
  }));
  check('不急的清單照樣列出來（不是「今天都處理完了」）', await p2.evaluate(() =>
    document.querySelector('#td-body .td-alldone') === null && document.querySelectorAll('#td-body .td-row').length === 2));
  check('徽章全是灰色 0', await p2.evaluate(() =>
    [...document.querySelectorAll('#td-body .td-ch .n')].every(e => e.textContent === '0' && e.classList.contains('zero'))));
  check('有急件時不顯示好消息列', await p1.evaluate(() => document.querySelector('#td-body .td-calm') === null));

  /* ---------- 3. fallback 範圍＝digest 預設 all ---------- */
  const p3 = await newPage();
  await stub(p3, MIX, {
    digestFail: true,
    orders: [
      // 尾款：預計日在 30 天後（舊版會被 7 天過濾掉，現在要列出來且標不急）
      { quote_no: 'B-FAR', status: 'shipped', ship_date_actual: '2026-07-25', invoice_no: 'INV-1', invoice_date: '2026-07-25', final_date_est: '2026-08-25', grand_total: 100000, deposit_amt: 40000 },
      // 尾款：沒填預計日 → 急
      { quote_no: 'B-NONE', status: 'invoiced', grand_total: 50000, deposit_amt: 20000 },
      // 未開發票：出貨 1 天（舊版會被 >7 天過濾掉，現在要列出來且標不急）
      { quote_no: 'D-NEW', status: 'shipped', ship_date_actual: '2026-07-25', final_date: '2026-07-25' },
    ],
    quotes: [
      { quoteNo: 'B-FAR', client: '遠期公司', quoteDate: '2026-07-01', total: 100000, status: '' },
      { quoteNo: 'B-NONE', client: '沒填公司', quoteDate: '2026-07-01', total: 50000, status: '' },
      { quoteNo: 'D-NEW', client: '剛出貨', quoteDate: '2026-07-01', total: 30000, status: '' },
    ],
  });
  await load(p3);
  await p3.waitForTimeout(600);
  check('走的是 fallback', await p3.evaluate(() => TD_DATA && TD_DATA._fallback === true));
  check('fallback 尾款不再砍掉 7 天外的（2 筆都在）', await p3.evaluate(() =>
    TD_DATA.final_due.length === 2 && TD_DATA.final_due.map(x => x.quote_no).sort().join(',') === 'B-FAR,B-NONE'));
  check('fallback 尾款 urgent 旗標正確（遠期＝不急、沒填＝急）', await p3.evaluate(() => {
    const m = {}; TD_DATA.final_due.forEach(x => m[x.quote_no] = x.urgent);
    return m['B-FAR'] === false && m['B-NONE'] === true;
  }));
  check('fallback 尾款排序＝急的在前', await p3.evaluate(() => TD_DATA.final_due[0].quote_no === 'B-NONE'));
  check('fallback 尾款帶 days_until', await p3.evaluate(() =>
    TD_DATA.final_due.find(x => x.quote_no === 'B-FAR').days_until > 7));
  check('fallback 未開發票不再砍掉 7 天內的', await p3.evaluate(() =>
    TD_DATA.no_invoice.length === 1 && TD_DATA.no_invoice[0].quote_no === 'D-NEW' && TD_DATA.no_invoice[0].urgent === false));
  check('fallback 已填發票號碼的不列進未開發票', await p3.evaluate(() =>
    TD_DATA.no_invoice.every(x => x.quote_no !== 'B-FAR')));
  check('fallback 出貨清單一律帶 urgent:true', await p3.evaluate(() =>
    (TD_DATA.ship_due || []).every(x => x.urgent === true)));
  check('fallback 畫面也有分隔線／淡化', await p3.evaluate(() =>
    document.querySelectorAll('#td-body .td-sep').length >= 1 && document.querySelectorAll('#td-body .td-row.dim').length >= 1));

  /* ---------- 4. 手機版 ---------- */
  const mob = await newPage({ width: 390, height: 844 });
  await stub(mob, MIX);
  await load(mob);
  check('手機版無橫向溢出', await mob.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  check('手機版分隔線／淡化仍在', await mob.evaluate(() =>
    document.querySelectorAll('#td-body .td-sep').length === 2 && document.querySelectorAll('#td-body .td-row.dim').length === 3));

  results.forEach(r => console.log(r[0], r[1]));
  const fails = results.filter(r => r[0] === 'FAIL').length;
  console.log(errors.length ? 'JS ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(fails === 0 && errors.length === 0 ? 'ALL PASS' : `${fails} FAIL`);
  await browser.close();
  process.exit(fails === 0 && errors.length === 0 ? 0 : 1);
})();
