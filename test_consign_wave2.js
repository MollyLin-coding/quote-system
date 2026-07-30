/* 2026-07-30 寄售第二波 離線測試
   1) 月結「已請款」標記：轉出過報價單的月份顯示 ✅＋單號；再轉會跳確認
   2) 沒轉過 → 📌 尚未請款、轉單不擋
   3) 轉報價單自動帶客戶主檔的統編/發票抬頭
   4) 今日待辦「寄售請款日」卡：今天到期＝紅急件；2 天後＝不急；5 天後不顯示
   5) 寄售三表＋月報表的手機卡片（mcard/data-l） */
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
    window.CONFIRMS = []; window.CONFIRM_ANSWER = true;
    window.confirm = (m) => { CONFIRMS.push(m); return CONFIRM_ANSWER; };

    window.QUOTES = [];   // 可由測試改
    window.apiCall = async (q) => {
      if (!rcIsRead(q.action)) rcClear();
      const a = q.action;
      if (a === 'getOwnbrandProducts') return { ok: true, products: [{ sku_id: 'A|500ml', name: '蜜香紅茶荔枝琴酒', volume: '500ml', list_price: 850, active: 'Y' }] };
      if (a === 'getOwnbrandTiers') return { ok: true, tiers: [], terms: { deposit_100ml: 50, deposit_500ml: 250 } };
      if (a === 'getConsignCustomers') return { ok: true, customers: window.CS_STUB || [], discounts: [] };
      if (a === 'getConsignInventory') return { ok: true, inventory: [], deposit_held_by_customer: {} };
      if (a === 'getConsignLedger') return { ok: true, rows: [] };
      if (a === 'getConsignMonthly') return { ok: true, lines: [{ sku_id: 'A|500ml', name: '蜜香紅茶荔枝琴酒', volume: '500ml', qty: 10, unit_price: 638, amount: 6380 }], total: 6380, period: { from: '2026-07-01', to: '2026-07-31' } };
      if (a === 'getQuotes') return { ok: true, quotes: window.QUOTES };
      if (a === 'getCustomers') return { ok: true, customers: [{ customer_id: 'M1', name: '滿枝枒餐酒館', tax_id: '92719710', invoice_title: '滿枝枒有限公司', address: '台北市某路1號', contact: '王小明', phone: '0912345678', active: 'Y' }] };
      return { ok: true, quotes: [], orders: [], records: [], items: [], rows: [] };
    };
    window.CS_STUB = [{ customer_id: 'CS001', name: '滿枝枒餐酒館', default_discount: 0.75, billing_day: 5, active: 'Y' }];
  });

  /* ---------- 準備：進寄售頁、選客戶、產月結 ---------- */
  await page.evaluate(() => gotoPage('consign'));
  await page.waitForTimeout(300);
  await page.evaluate(async () => { await initConsignPage(true); });
  await page.evaluate(() => { document.getElementById('cs-customer').value = 'CS001'; onSelectConsignCustomer(); });
  await page.waitForTimeout(300);

  /* ---------- 1) 沒轉過 → 📌 尚未請款 ---------- */
  await page.evaluate(async () => { await readCall({ action: 'getCustomers', token: AUTH_TOKEN }); });  // 模擬預抓過客戶主檔
  await page.evaluate(() => { document.getElementById('cs-month').value = '2026-07'; csClearMonthly(); });
  await page.evaluate(() => loadConsignMonthly());
  await page.waitForTimeout(400);
  let settled = await page.evaluate(() => document.getElementById('cs-settled').textContent);
  check('沒轉過報價單 → 顯示「尚未請款」', settled.includes('還沒轉出'));

  /* ---------- 2) 轉報價單：帶入客戶主檔統編/抬頭；備註寫期間 ---------- */
  await page.evaluate(() => consignMonthlyToQuote());
  await page.waitForTimeout(300);
  const filled = await page.evaluate(() => ({
    tax: document.getElementById('f-tax').value,
    inv: document.getElementById('f-inv').value,
    cli: document.getElementById('f-cli').value,
    note: document.getElementById('f-note').value,
    confirms: CONFIRMS.length
  }));
  check('轉報價單：統編自動帶入（92719710）', filled.tax === '92719710');
  check('轉報價單：發票抬頭帶客戶主檔（滿枝枒有限公司）', filled.inv === '滿枝枒有限公司');
  check('轉報價單：備註含結算期間（比對已請款用）', filled.note.includes('寄售月結：2026-07-01'));
  check('沒轉過時不會跳重複請款確認', filled.confirms === 0);

  /* ---------- 3) 已轉過 → ✅ 已請款＋單號；再轉跳確認 ---------- */
  await page.evaluate(() => {
    window.QUOTES = [{ quoteNo: '20260730-01', quoteType: 'consign', clientName: '滿枝枒餐酒館', quoteDate: '2026-07-30', remark: '寄售月結：2026-07-01 ～ 2026-07-31（折數 7.5 折）' }];
    rcClear();
  });
  await page.evaluate(() => gotoPage('consign'));
  await page.waitForTimeout(200);
  await page.evaluate(() => loadConsignMonthly());
  await page.waitForTimeout(400);
  settled = await page.evaluate(() => document.getElementById('cs-settled').textContent);
  check('已轉過 → 顯示 ✅ 已請款＋報價單號', settled.includes('已於') && settled.includes('20260730-01'));
  await page.evaluate(() => { CONFIRMS.length = 0; CONFIRM_ANSWER = false; });
  const stayed = await page.evaluate(() => { consignMonthlyToQuote(); return currentPage; });
  const confirmMsg = await page.evaluate(() => CONFIRMS[0] || '');
  check('再轉一次 → 跳「重複請款」確認（含舊單號）', confirmMsg.includes('20260730-01'));
  check('按取消 → 不會進報價單頁', stayed === 'consign');

  /* ---------- 4) 今日待辦「寄售請款日」卡 ---------- */
  await page.evaluate(async () => {
    const n = new Date();
    const dim = new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate();
    const in2 = new Date(n.getTime() + 2 * 86400000);
    window.CS_STUB = [
      { customer_id: 'C1', name: '今天請款戶', billing_day: n.getDate(), active: 'Y' },
      { customer_id: 'C2', name: '兩天後請款戶', billing_day: (in2.getMonth() === n.getMonth()) ? in2.getDate() : Math.min(in2.getDate(), dim), active: 'Y' },
      { customer_id: 'C3', name: '很久以後請款戶', billing_day: ((n.getDate() + 10 - 1) % 28) + 1, active: 'Y' },
      { customer_id: 'C4', name: '停用戶', billing_day: n.getDate(), active: 'N' }
    ];
    rcClear();
    await readCall({ action: 'getConsignCustomers', token: AUTH_TOKEN });   // 模擬預抓
  });
  const tdHtml = await page.evaluate(() => {
    gotoPage('today');
    TD_DATA = { ok: true, today: fmtD(new Date()), ship_due: [], final_due: [], no_scan: [], no_invoice: [], calendar: [], warnings: [] };
    renderToday();
    return document.getElementById('td-body').innerHTML;
  });
  check('今日待辦出現「寄售請款日」卡', tdHtml.includes('寄售請款日'));
  check('今天到期 → 紅色「今天請款！」', tdHtml.includes('今天請款戶') && tdHtml.includes('今天請款！'));
  check('兩天後 → 列出但標「還有 N 天」（不急）', tdHtml.includes('兩天後請款戶') && /還有\s*[12]\s*天/.test(tdHtml));
  check('10 天後 → 不顯示', !tdHtml.includes('很久以後請款戶'));
  check('停用客戶 → 不提醒', !(tdHtml.match(/停用戶/)));

  /* 沒有寄售客戶時不出卡（不干擾原畫面） */
  const tdHtml2 = await page.evaluate(async () => {
    window.CS_STUB = []; rcClear();
    await readCall({ action: 'getConsignCustomers', token: AUTH_TOKEN });
    TD_DATA = { ok: true, today: fmtD(new Date()), ship_due: [], final_due: [], no_scan: [], no_invoice: [], calendar: [{ item_id: 'x', title: '普通事項', category: '', time: '', all_day: true }], warnings: [] };
    renderToday();
    return document.getElementById('td-body').innerHTML;
  });
  check('沒有到期請款 → 不出現該卡', !tdHtml2.includes('寄售請款日'));

  /* ---------- 5) mcard 手機卡片 ---------- */
  const mc = await page.evaluate(() => ({
    inv: document.querySelector('#cs-inv-body') && !!document.querySelector('#page-consign table.mcard'),
    consignTables: document.querySelectorAll('#page-consign table.mcard').length,
    monthlyHasDataL: (document.getElementById('cs-monthly').innerHTML.match(/data-l=/g) || []).length
  }));
  check('寄售頁兩張固定表格已掛 mcard', mc.consignTables >= 2, mc.consignTables);
  check('月結表列有 data-l 標籤（手機顯示欄名）', mc.monthlyHasDataL > 0);

  /* 月報表：塞 ORDERS_CACHE 畫一次，檢查三張表 mcard */
  const rpt = await page.evaluate(() => {
    gotoPage('report');
    ORDERS_CACHE = [{ no: '20260701-01', client: '測試客戶', type: '瓶裝', typeKey: 'bottle', total: 1000, quoteDate: (new Date().getFullYear()) + '-' + String(new Date().getMonth() + 1).padStart(2, '0') + '-01',
      st: { quote_no: '20260701-01', status: 'shipped', deposit_amt: 300, deposit_date: '', ship_date_actual: '2026-07-10' }, src: 'std' }];
    renderReport();
    const box = document.getElementById('rpt-box');
    return { mcardTables: box.querySelectorAll('table.mcard').length, dataL: (box.innerHTML.match(/data-l=/g) || []).length };
  });
  check('月報表表格已掛 mcard（成交＋未收尾款＋未開發票）', rpt.mcardTables >= 2, rpt.mcardTables);
  check('月報表列有 data-l 標籤', rpt.dataL > 0);

  console.log('\n===== 寄售第二波測試 =====');
  results.forEach(r => console.log(r[0] + '  ' + r[1]));
  const fails = results.filter(r => r[0] === 'FAIL').length;
  console.log(`\n${results.length - fails}/${results.length} 項通過`);
  if (errors.length) { console.log('\nJS 錯誤：'); errors.forEach(e => console.log('  ' + e)); }
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
