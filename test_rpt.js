/* 月報對帳升級＋#21 extrasTotal＋#22 Esc/遮罩關彈窗 離線測試 */
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
    window.apiCall = async (payload) => ({ ok: true, quotes: [], orders: [], logs: [] });
  });

  const results = [];
  const check = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);

  /* ---------- 功能一：月報表對帳視角 ---------- */
  await page.evaluate(() => {
    RPT_Y = 2026; RPT_M = 7;
    ORDERS_CACHE = [
      // 本月報價、已收訂金（成交）
      { no:'T-A', client:'甲客戶｜台北', type:'瓶裝', typeKey:'bottle', total:100000, quoteDate:'2026-07-05',
        st:{ status:'deposit', deposit_amt:30000, deposit_date:'2026-07-06', grand_total:100000 } },
      // 已出貨、尾款未收、有預計尾款日（已逾期）、無 final_amt → 應推估
      { no:'T-B', client:'乙客戶｜台中', type:'瓶裝', typeKey:'bottle', total:80000, quoteDate:'2026-06-20',
        st:{ status:'shipped', deposit_amt:24000, deposit_date:'2026-06-21', grand_total:80000, ship_date_actual:'2026-07-01', final_date_est:'2026-07-10', invoice_no:'' } },
      // 已開發票、尾款未收、有 final_amt（不推估）
      { no:'T-C', client:'丙客戶｜高雄', type:'瓶裝', typeKey:'bottle', total:50000, quoteDate:'2026-06-15',
        st:{ status:'invoiced', deposit_amt:15000, deposit_date:'2026-06-16', grand_total:50000, final_amt:35000, invoice_no:'AB12345678' } },
      // 本月已收尾款
      { no:'T-D', client:'丁客戶｜新竹', type:'瓶裝', typeKey:'bottle', total:60000, quoteDate:'2026-05-01',
        st:{ status:'paid', final_date:'2026-07-15', final_amt:60000, grand_total:60000 } },
      // 已出貨超過 7 天未開發票
      { no:'T-E', client:'戊客戶｜台南', type:'瓶裝', typeKey:'bottle', total:40000, quoteDate:'2026-07-01',
        st:{ status:'shipped', ship_date_actual:'2026-07-05', invoice_no:'' } },
      // 已出貨剛出貨（未滿 7 天）未開發票
      { no:'T-F', client:'己客戶｜桃園', type:'瓶裝', typeKey:'bottle', total:20000, quoteDate:'2026-07-20',
        st:{ status:'shipped', ship_date_actual:'2026-07-24', invoice_no:'' } },
      // 已取消，不該被列入任何對帳統計
      { no:'T-X', client:'取消客戶｜X', type:'瓶裝', typeKey:'bottle', total:99999, quoteDate:'2026-07-02',
        st:{ status:'cancelled', deposit_amt:99999, deposit_date:'2026-07-03' } },
    ];
    renderReport();
  });
  await page.waitForTimeout(150);

  const box = await page.evaluate(() => document.getElementById('rpt-box').innerHTML);
  check('6 張統計卡都在', (box.match(/class="rpt-stat"/g) || []).length === 6);
  check('本月已收訂金＝30,000（排除取消單）', /本月已收訂金[\s\S]{0,60}?\$30,000/.test(box));
  check('本月已收尾款＝60,000', /本月已收尾款[\s\S]{0,60}?\$60,000/.test(box));
  // 待收尾款清單條件是「shipped／invoiced 且 final_date 空白」，T-B/T-C/T-E/T-F 都符合（T-E/T-F 同時也出現在已出貨未開發票清單，這是預期中的重疊）
  // T-B 推估(80000-24000=56000) + T-C(35000，有filled final_amt不推估) + T-E 推估(無grand_total退回total 40000-0) + T-F 推估(20000-0) = 151000
  check('還沒收的尾款合計＝151,000（含 T-B/T-C/T-E/T-F）', /還沒收的尾款（累計）[\s\S]{0,60}?\$151,000/.test(box));
  check('待收尾款清單有 T-B／T-C 兩筆', box.includes('T-B') && box.includes('T-C'));
  check('T-B 標「推估」', /T-B[\s\S]{0,400}推估/.test(box));
  check('T-C 不標推估（有 final_amt）', !/T-C[\s\S]{0,300}推估/.test(box));
  check('T-B 預計尾款日逾期標紅字樣', /T-B[\s\S]{0,400}逾期/.test(box));
  check('T-C 發票欄顯示 ✓', /T-C[\s\S]{0,400}✓/.test(box));
  check('已出貨未開發票清單有 T-E／T-F', box.includes('T-E') && box.includes('T-F'));
  check('T-E 出貨超過7天標橘(ob warn)', /T-E[\s\S]{0,300}ob warn/.test(box));
  check('T-F 出貨未滿7天不標橘', !/T-F[\s\S]{0,300}ob warn/.test(box));
  check('取消單 T-X 不出現在任何清單', !box.includes('T-X'));
  check('寄售管理捷徑連結存在', box.includes("gotoPage('consign')") && box.includes('寄售月結請款'));
  check('點列可呼叫 openOrdEdit', box.includes("openOrdEdit('T-B')") || box.includes('openOrdEdit(\'T-B\')'));

  // CSV 匯出：欄位擴充
  const csvOk = await page.evaluate(() => {
    let captured = null;
    const origCreate = document.createElement.bind(document);
    document.createElement = (tag) => {
      const el = origCreate(tag);
      if (tag === 'a') { const origClick = el.click.bind(el); el.click = () => { captured = el.href; }; }
      return el;
    };
    exportReport();
    document.createElement = origCreate;
    return true;
  });
  check('exportReport 執行無誤', csvOk);
  // 直接檢查函式原始碼字串含新欄位（比 fetch blob URL 更直接可靠）
  const expFnSrc = await page.evaluate(() => exportReport.toString());
  ['預計尾款日','尾款收款日','發票開立日','發票後五碼'].forEach(col => {
    check(`CSV 新欄位「${col}」已加入`, expFnSrc.includes(col));
  });

  /* ---------- #21 extrasTotal ---------- */
  await page.evaluate(() => { gotoPage('new'); resetAll(true); });
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    pushExt('SGS 檢驗費（2款 × $4,000）', 8000);
    pushExt('商會特別優惠', -1500);
  });
  await page.waitForTimeout(100);
  const extText = await page.evaluate(() => document.getElementById('t-ext').textContent);
  check('t-ext 顯示正確加總 6,500（8000-1500）', extText.replace(/[$,]/g, '') === '6500');
  const collected = await page.evaluate(() => collectQuote());
  check('collectQuote().extrasTotal === 6500', collected.extrasTotal === 6500);
  // 移除全部額外費用後歸零
  await page.evaluate(() => { extras.slice().forEach(e => removeExt(e.id)); });
  await page.waitForTimeout(100);
  const extText2 = await page.evaluate(() => document.getElementById('t-ext').textContent);
  check('移除後 t-ext 歸零', extText2.replace(/[$,]/g, '') === '0');

  /* ---------- #22 Esc / 遮罩關彈窗 ---------- */
  // gd-overlay（純檢視型）：點遮罩應可關閉
  await page.evaluate(() => { document.getElementById('gd-overlay').style.display = 'flex'; });
  await page.evaluate(() => {
    const ov = document.getElementById('gd-overlay');
    ov.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  await page.waitForTimeout(50);
  check('gd-overlay 點遮罩可關閉', await page.evaluate(() => document.getElementById('gd-overlay').style.display === 'none'));

  // cl-overlay（純檢視型）：Esc 應可關閉
  await page.evaluate(() => { document.getElementById('cl-overlay').style.display = 'flex'; });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(50);
  check('cl-overlay 按 Esc 可關閉', await page.evaluate(() => document.getElementById('cl-overlay').style.display === 'none'));

  // oe-overlay（表單型，編輯進度）：點遮罩「不應」關閉
  await page.evaluate(() => { document.getElementById('oe-overlay').style.display = 'flex'; });
  await page.evaluate(() => {
    const ov = document.getElementById('oe-overlay');
    ov.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  await page.waitForTimeout(50);
  check('oe-overlay 點遮罩不會誤關（防丟資料）', await page.evaluate(() => document.getElementById('oe-overlay').style.display === 'flex'));

  // oe-overlay：Esc 也不應關閉（避免正在編輯時誤按 Esc 掉資料）
  await page.keyboard.press('Escape');
  await page.waitForTimeout(50);
  check('oe-overlay 按 Esc 不會誤關', await page.evaluate(() => document.getElementById('oe-overlay').style.display === 'flex'));
  await page.evaluate(() => { document.getElementById('oe-overlay').style.display = 'none'; });

  // ce-overlay（表單型，行事曆）：點遮罩不應關閉
  await page.evaluate(() => { document.getElementById('ce-overlay').style.display = 'flex'; });
  await page.evaluate(() => {
    const ov = document.getElementById('ce-overlay');
    ov.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  await page.waitForTimeout(50);
  check('ce-overlay 點遮罩不會誤關', await page.evaluate(() => document.getElementById('ce-overlay').style.display === 'flex'));
  await page.evaluate(() => { document.getElementById('ce-overlay').style.display = 'none'; });

  // login-overlay 不受 Esc 影響
  await page.evaluate(() => { document.getElementById('login-overlay').style.display = 'flex'; });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(50);
  check('login-overlay 不受 Esc 影響', await page.evaluate(() => document.getElementById('login-overlay').style.display === 'flex'));
  await page.evaluate(() => { document.getElementById('login-overlay').style.display = 'none'; });

  // toast 錯誤停留時間
  const toastSrc = await page.evaluate(() => toast.toString());
  check('錯誤 toast 停留 6000ms', /type===.err.\?6000/.test(toastSrc));

  console.log('\n=== 測試結果 ===');
  results.forEach(([s, n]) => console.log(s, n));
  const fails = results.filter(r => r[0] === 'FAIL');
  console.log(`\n共 ${results.length} 項，${fails.length} 項失敗`);
  if (errors.length) { console.log('\n=== JS 錯誤 ==='); errors.forEach(e => console.log(e)); }
  await browser.close();
  process.exit(fails.length || errors.length ? 1 : 0);
})();
