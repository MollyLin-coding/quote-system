/* v32 三項改動離線測試：
   1) 訂單追蹤：客戶批號顯示（手動優先／驗收單備援）、複製鈕移除、表頭排序
   2) 狀態：加「排產中」＋依日期自動推進（effOrdStatus）
   3) 月報表：成交以「最早實際往來日」歸屬月份（雋荖情境：付了款但狀態卡報價中） */
const { chromium } = require('/opt/node-tools/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('CONSOLE: ' + m.text()); });

  await page.goto('http://localhost:8899/index.html');
  await page.evaluate(() => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 'test-token';
    window.apiCall = async () => ({ ok: true, quotes: [], orders: [], logs: [] });
    window.readCall = async () => ({ ok: true, quotes: [], orders: [], records: [], summary: {} });
  });

  const results = [];
  const check = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);

  /* ---------- effOrdStatus：自動推進規則 ---------- */
  const eff = await page.evaluate(() => ({
    a: effOrdStatus({ status: 'quoted', deposit_date: '2026-07-03' }),                    // 訂金→排產中
    b: effOrdStatus({ status: 'quoted', final_date: '2026-07-20' }),                      // 直接付全款→已收尾款
    c: effOrdStatus({ status: 'quoted', ship_date_actual: '2026-07-10' }),                // 先出貨→已出貨
    d: effOrdStatus({ status: 'deposit', invoice_no: 'AB123' }),                          // 有發票→已開發票
    e: effOrdStatus({ status: 'closed', deposit_date: '2026-07-01' }),                    // 手動結案不退回
    f: effOrdStatus({ status: 'cancelled', final_date: '2026-07-01' }),                   // 已取消一律尊重
    g: effOrdStatus({ status: 'production' }),                                            // 手動排產中保留
    h: effOrdStatus(null),                                                                // 沒進度＝報價中
    lbl: stageLabel('production'),
  }));
  check('訂金日→排產中', eff.a === 'production');
  check('直接付尾款→已收尾款', eff.b === 'paid');
  check('先出貨→已出貨', eff.c === 'shipped');
  check('有發票→已開發票', eff.d === 'invoiced');
  check('手動結案不被日期退回', eff.e === 'closed');
  check('已取消不被日期推進', eff.f === 'cancelled');
  check('手動排產中保留', eff.g === 'production');
  check('無進度＝報價中', eff.h === 'quoted');
  check('排產中標籤正確', eff.lbl === '排產中');

  /* ---------- 訂單追蹤：批號顯示＋複製移除＋排產中篩選 ---------- */
  await page.evaluate(() => {
    ORDERS_CACHE = [
      { no: 'O-1', client: '甲客戶', type: '瓶裝', typeKey: 'bottle', total: 100000, quoteDate: '2026-07-05',
        st: { status: 'quoted', deposit_date: '2026-07-06', cust_lot: 'PO-8871' }, src: 'std' },   // 手動批號＋自動推進成排產中
      { no: 'O-2', client: '乙客戶', type: '瓶裝', typeKey: 'bottle', total: 50000, quoteDate: '2026-07-08',
        st: { status: 'quoted' }, src: 'std' },                                                    // 驗收單批號備援
      { no: 'O-3', client: '丙客戶', type: '瓶裝', typeKey: 'bottle', total: 30000, quoteDate: '2026-07-01',
        st: { status: 'shipped', ship_date_actual: '2026-07-02' }, src: 'std' },
    ];
    ORDER_VSUM = { forms: {}, reps: {}, repList: [], lots: { 'O-2': 'KK-55', 'O-1': '驗收單舊批號' } };
    ORD_FILTER = 'all'; ORD_SORT = { key: '', dir: 1 };
    renderOrders();
  });
  const ordHtml = await page.evaluate(() => document.getElementById('ord-body').innerHTML);
  check('手動批號優先顯示', ordHtml.includes('PO-8871') && !ordHtml.includes('驗收單舊批號'));
  check('沒手動填→帶驗收單批號', ordHtml.includes('KK-55'));
  check('操作欄已無「複製」', !ordHtml.includes('>複製<'));
  check('O-1 顯示為排產中', ordHtml.includes('排產中'));
  const chips = await page.evaluate(() => document.getElementById('ord-filters').innerHTML);
  check('篩選chips含排產中(計數1)', /排產中 <b>1<\/b>/.test(chips));
  const toshipN = await page.evaluate(() => {
    const old = ORD_FILTER; ORD_FILTER = 'toship';
    const n = ORDERS_CACHE.filter(passOrdFilter).length; ORD_FILTER = old; return n;
  });
  check('待出貨含排產中', toshipN === 1);

  /* ---------- 排序 ---------- */
  const sort1 = await page.evaluate(() => {
    setOrdSort('total');                            // 第一下：小→大
    const t1 = [...document.querySelectorAll('#ord-body td[data-l="總計"]')].map(td => td.textContent.trim());
    setOrdSort('total');                            // 第二下：大→小
    const t2 = [...document.querySelectorAll('#ord-body td[data-l="總計"]')].map(td => td.textContent.trim());
    const arrow = document.querySelector('#ord-thead th[data-sk="total"]').textContent;
    setOrdSort('total');                            // 第三下：回預設
    const t3 = [...document.querySelectorAll('#ord-body td[data-l="總計"]')].map(td => td.textContent.trim());
    return { t1, t2, t3, arrow };
  });
  const nums = a => a.map(s => parseInt(s.replace(/[^0-9]/g, ''), 10));
  const asc = nums(sort1.t1), desc = nums(sort1.t2);
  check('總計第一下＝小→大', asc[0] <= asc[1] && asc[1] <= asc[2]);
  check('總計第二下＝大→小', desc[0] >= desc[1] && desc[1] >= desc[2]);
  check('第二下表頭有▼', sort1.arrow.includes('▼'));
  check('第三下回預設（快取原順序）', nums(sort1.t3)[0] === 100000);
  const sort2 = await page.evaluate(() => {
    setOrdSort('ship');
    const first = document.querySelector('#ord-body tr td.mc-main b').textContent;
    const last = [...document.querySelectorAll('#ord-body tr')].pop().querySelector('td.mc-main b')?.textContent;
    setOrdSort('ship'); setOrdSort('ship');         // 復位
    return { first, last };
  });
  check('出貨日排序：有日期在前', sort2.first === 'O-3');

  /* ---------- 月報表：成交歸屬 ---------- */
  await page.evaluate(() => {
    RPT_Y = 2026; RPT_M = 7;
    ORDERS_CACHE = [
      // 雋荖情境：6 月報價、7 月直接付全款、狀態忘了改（卡報價中）→ 應算 7 月成交＋7月已收尾款
      { no: 'J-1', client: '雋荖', type: '瓶裝', typeKey: 'bottle', total: 90000, quoteDate: '2026-06-18',
        st: { status: 'quoted', final_date: '2026-07-12', final_amt: 90000 }, src: 'std' },
      // 先出貨後請款：7 月出貨、沒收訂金、還沒收款 → 算 7 月成交（出貨月）
      { no: 'J-2', client: '先出貨客', type: '瓶裝', typeKey: 'bottle', total: 40000, quoteDate: '2026-06-25',
        st: { status: 'quoted', ship_date_actual: '2026-07-03' }, src: 'std' },
      // 6 月收訂金的單 → 不算 7 月成交
      { no: 'J-3', client: '六月客', type: '瓶裝', typeKey: 'bottle', total: 70000, quoteDate: '2026-06-01',
        st: { status: 'deposit', deposit_date: '2026-06-10', deposit_amt: 35000 }, src: 'std' },
      // 7 月報價但純報價中 → 不算成交、算「本月報價」
      { no: 'J-4', client: '純報價', type: '瓶裝', typeKey: 'bottle', total: 20000, quoteDate: '2026-07-20',
        st: null, src: 'std' },
      // 已取消：就算有日期也不算
      { no: 'J-5', client: '取消客', type: '瓶裝', typeKey: 'bottle', total: 999999, quoteDate: '2026-07-02',
        st: { status: 'cancelled', deposit_date: '2026-07-02' }, src: 'std' },
    ];
    currentPage = 'report';
    renderReport();
  });
  const rpt = await page.evaluate(() => document.getElementById('rpt-box').innerHTML);
  check('成交筆數＝2（雋荖＋先出貨）', /成交筆數<\/div><div class="v">2 筆/.test(rpt));
  check('成交金額＝130,000', rpt.includes('130,000'));
  check('雋荖列入客戶成交表', /雋荖/.test(rpt));
  check('本月已收尾款含雋荖 90,000', /本月已收尾款[\s\S]*?90,000/.test(rpt));
  check('取消客不列入', !rpt.includes('999,999'));
  check('本月報價＝2 筆（J-4、J-5）', /本月報價<\/div><div class="v">2 筆/.test(rpt));
  const dealDates = await page.evaluate(() => ({
    j1: rptDealDate(ORDERS_CACHE[0]), j2: rptDealDate(ORDERS_CACHE[1]),
    j3: rptDealDate(ORDERS_CACHE[2]), j4: rptDealDate(ORDERS_CACHE[3]), j5: rptDealDate(ORDERS_CACHE[4]),
  }));
  check('雋荖成交日＝付款日', dealDates.j1 === '2026-07-12');
  check('先出貨成交日＝出貨日', dealDates.j2 === '2026-07-03');
  check('訂金單成交日＝訂金日', dealDates.j3 === '2026-06-10');
  check('純報價無成交日', dealDates.j4 === '');
  check('取消單無成交日', dealDates.j5 === '');

  /* ---------- 編輯進度：儲存時自動推進＋cust_lot 有進 fields ---------- */
  const save = await page.evaluate(async () => {
    ORDERS_CACHE = [{ no: 'S-1', client: '存檔客', type: '瓶裝', typeKey: 'bottle', total: 10000, quoteDate: '2026-07-01',
      st: { status: 'quoted', updated_at: 'x' }, src: 'std' }];
    ORD_FILTER = 'all'; renderOrders();
    let sent = null;
    window.apiCall = async (p) => { sent = p; return { ok: true, order: {} }; };
    openOrdEdit('S-1');
    document.getElementById('oe-status').value = 'quoted';
    document.getElementById('oe-deposit_date').value = '2026-07-30';
    document.getElementById('oe-cust_lot').value = 'LOT-XYZ';
    await saveOrdEdit();
    return { status: sent && sent.fields.status, lot: sent && sent.fields.cust_lot };
  });
  check('存檔自動推進：訂金日→排產中', save.status === 'production');
  check('cust_lot 隨存檔送出', save.lot === 'LOT-XYZ');

  /* ---------- 時間軸：七關卡＋預計日標註 ---------- */
  const tl = await page.evaluate(() => orderTimelineHtml({ quoteDate: '2026-07-01',
    st: { status: 'quoted', deposit_date: '2026-07-05', ship_date_est: '2026-08-10' } }));
  check('時間軸含「排產」節點', tl.includes('排產'));
  check('排產節點已完成(訂金已收)', (tl.match(/otl-node done/g) || []).length >= 3);
  check('出貨節點顯示預計日', tl.includes('預計 08-10'));

  check('無 JS 錯誤', errors.length === 0);
  if (errors.length) console.log(errors.join('\n'));
  console.log(results.map(r => r.join(' ')).join('\n'));
  const fails = results.filter(r => r[0] === 'FAIL').length;
  console.log(`\n${results.length - fails}/${results.length} PASS`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
