/* 2026-08-28：純報價單＋報價單稅金顯示（未稅/含稅）離線測試
   ・純報價勾選：藏訂單追蹤進度區塊、collectQuote 帶 quoteOnly='Y'＋docopts quoteOnly:1
   ・存檔：純報價即使填了訂金日期也「不」打 updateOrderStatus；一般單照舊會打
   ・稅金顯示 excl：未稅輸入＝單價照印＋合計（未稅）＋稅額另計註記、沒有「總計」列
   ・稅金顯示 excl＋含稅輸入：單價/小計自動 ÷1.05 換算
   ・預設顯示：照現行（總計照印）；hideTotals 優先（整區不印）
   ・docopts 還原／resetAll 回預設
   ・buildOrders 過濾 quoteOnly='Y'；報價紀錄顯示「純報價」標記
   ・宴會單（客製化調酒）也吃稅金顯示：每款一列的單價／小計／手動小計都要換算

   2026-09-01 更新（只動測試、沒動產品碼）：
   1) 宴會段原本用 ban-g1-price／ban-g1-qty，2026-08-31 宴會改版後這些 id 已不存在
      （改成每款各自一列 addBanGroupRow → bg-<g>-<rowId> ＋ [data-f="..."]），會噴
      TypeError: Cannot set properties of null。改用 addBanGroupRow()，並補上換算／手動小計測項。
   2) goto 後改成等 99_boot.js 那發 getLoginUsers 收尾（登入下拉不再顯示「載入中」＋RC_GEN 穩定），
      不再賭 waitForTimeout(1200)。
   3) 金額斷言全部改成「連著標籤／儲存格一起比」——原本 html.includes('$9,600')
      會被品項列小計矇混，html.includes('合計（未稅）') 連一般顯示版面也會過
      （#lb-sub 未稅輸入時本來就寫「合計（未稅）」）。 */
const { chromium } = require('/opt/node-tools/node_modules/playwright');

const seenActions = [];
function respond(action){
  switch(action){
    case 'getQuotes':          return { ok:true, quotes:[] };
    case 'listCustomQuotes':   return { ok:true, quotes:[] };
    case 'getOrderStatusList': return { ok:true, orders:[] };
    case 'getVerifications':   return { ok:true, records:[], summary:{} };
    case 'listVerifyForms':    return { ok:true, records:[], summary:{} };
    case 'listShipments':      return { ok:true, shipments:[] };
    case 'listCalendarItems':  return { ok:true, items:[] };
    case 'getCompanyData':     return { ok:true, companies:[], products:[], rules:[] };
    case 'getOwnbrandProducts':return { ok:true, products:[] };
    case 'getOwnbrandTiers':   return { ok:true, tiers:[], terms:{} };
    case 'getTodayDigest':     return { ok:true, today:'2026-08-28', ship_due:[], final_due:[], no_scan:[], no_invoice:[], calendar:[], warnings:[] };
    case 'createQuote':        return { ok:true, quoteNo:'20260828-77' };
    case 'updateQuote':        return { ok:true, quoteNo:'20260828-77' };
    case 'updateOrderStatus':  return { ok:true };
    default:                   return { ok:true };
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errors = [], results = [];
  const check = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);
  const isNoise = t => /Failed to load resource|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|favicon|raw.githubusercontent/i.test(t);

  const page = await browser.newPage();
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('CONSOLE: ' + m.text()); });
  await page.route('**/script.google.com/**', async route => {
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
    let payload;
    if (body.action === 'batch') { (body.calls||[]).forEach(c=>seenActions.push(c.action)); payload = { ok:true, results:(body.calls||[]).map(c => respond(c.action)) }; }
    else { seenActions.push(body.action); payload = respond(body.action); }
    await route.fulfill({ status:200, headers:{'Access-Control-Allow-Origin':'*'}, contentType:'application/json', body:JSON.stringify(payload) });
  });
  await page.goto('http://localhost:8899/index.html');
  /* 開機競態：99_boot.js 開場會呼叫 loadLoginUsers() 打 getLoginUsers。
     這一發若失敗（或回空名單），apiCall 的 catch 會 rcClear() 把 RC_STORE／
     ORDERS_CACHE／CAL_ITEMS 整包洗掉（實測開頁後約 500-600ms）。
     固定 waitForTimeout 會賭運氣，改成等登入下拉文字不再是「載入中」＝那一發已收尾，
     再確認 RC_GEN 不再變動（不會有第二發把後面塞的資料洗掉）。 */
  await page.waitForFunction(() => {
    const s = document.getElementById('login-user');
    return !s || !/載入中/.test(s.textContent || '');
  }, null, { timeout: 60000 });
  {
    const g1 = await page.evaluate(() => (typeof RC_GEN === 'undefined' ? -1 : RC_GEN));
    await page.waitForTimeout(300);
    const g2 = await page.evaluate(() => (typeof RC_GEN === 'undefined' ? -1 : RC_GEN));
    if (g1 !== g2) throw new Error('RC_GEN 仍在變動，開機請求尚未結束');
  }
  await page.evaluate(() => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 'test-token'; PREFETCH_DONE = true;
    window.confirm = () => true;   // resetAll() 若哪裡少帶 skipConfirm 也不會卡住
  });
  await page.evaluate(() => gotoPage('new'));
  await page.waitForTimeout(300);

  /* ── 1. 純報價勾選：UI 行為 ── */
  await page.evaluate(() => {
    resetAll(true);
    document.getElementById('f-cli').value = '測試客戶';
    addBotRow({name:'測試酒', vol:500, price:800, qty:12});
    calc();
  });
  let r = await page.evaluate(() => ({
    ordVisible: document.getElementById('ordprog-block').style.display !== 'none',
    qoChecked: document.getElementById('f-quoteonly').checked,
    tdVal: document.getElementById('f-taxdisplay').value
  }));
  check('新單預設：純報價不勾、稅金顯示=含稅、訂單追蹤區塊顯示', !r.qoChecked && r.tdVal==='' && r.ordVisible);

  await page.evaluate(() => { document.getElementById('f-quoteonly').checked = true; onQuoteOnlyChange(); });
  r = await page.evaluate(() => ({
    ordVisible: document.getElementById('ordprog-block').style.display !== 'none'
  }));
  check('勾純報價 → 訂單追蹤進度區塊藏起來', !r.ordVisible);

  /* ── 2. collectQuote：quoteOnly 頂層欄＋docopts ── */
  r = await page.evaluate(() => {
    const q = collectQuote();
    const dop = (q.items||[]).find(i=>i.itemType==='docopts');
    return { top:q.quoteOnly, st:q.status, dop: dop?JSON.parse(dop.flavorList):null };
  });
  check('collectQuote：quoteOnly=Y 且 status=純報價', r.top==='Y' && r.st==='純報價');
  check('docopts 帶 quoteOnly:1', r.dop && r.dop.quoteOnly===1);

  /* ── 3. 存檔：純報價填了訂金日期也不建訂單追蹤 ── */
  await page.evaluate(() => { document.getElementById('f-ord-depdate').value='2026-08-28'; });
  seenActions.length = 0;
  await page.evaluate(() => saveQuote());
  await page.waitForTimeout(600);
  check('純報價存檔：有 createQuote、沒有 updateOrderStatus',
    seenActions.includes('createQuote') && !seenActions.includes('updateOrderStatus'));

  /* ── 4. 一般單存檔：照舊會建訂單追蹤 ── */
  await page.evaluate(() => {
    resetAll(true);
    document.getElementById('f-cli').value = '一般客戶';
    addBotRow({name:'一般酒', vol:500, price:1000, qty:10});
    calc();
    document.getElementById('f-ord-depdate').value='2026-08-28';
  });
  seenActions.length = 0;
  await page.evaluate(() => saveQuote());
  await page.waitForTimeout(600);
  check('一般單存檔：createQuote＋updateOrderStatus 都有',
    seenActions.includes('createQuote') && seenActions.includes('updateOrderStatus'));

  /* ── 5. 稅金顯示 excl＋未稅輸入：照印＋稅額另計 ── */
  await page.evaluate(() => {
    resetAll(true);
    document.getElementById('f-cli').value = '未稅客戶';
    addBotRow({name:'未稅酒', vol:500, price:800, qty:12});
    setTaxMode('exc'); calc();
    document.getElementById('f-taxdisplay').value='excl'; onTaxDisplayChange();
  });
  /* 合計列長這樣：<span>合計（未稅）</span><span style="color:#A6824A">$9,600</span>
     只用 html.includes('$9,600') 會被品項列的小計欄矇混過去（12×800 也是 9,600），
     所以金額一律連著它的標籤一起比。 */
  let html = await page.evaluate(() => buildStdPagesHtml(''));
  /* 注意：畫面上的小計標籤（#lb-sub）在「未稅輸入」時本來就寫「合計（未稅）」，
     所以單純 html.includes('合計（未稅）') 連「一般顯示」的版面也會過，咬不到 taxDisplay。
     未稅顯示的辨識點是那一行變成「最下面 18px 粗體的結論列」（一般顯示時 18px 那行是「總計」）。
     金額也一律連著標籤一起比，否則品項列的小計欄（12×800 也是 9,600）會矇混過去。 */
  const bigTotLabel = label =>
    new RegExp(`font-size:18px;[^"]*"><span>${label}</span>`).test(html);
  const bigTot = (label, amt) =>
    new RegExp(`font-size:18px;[^"]*"><span>${label}</span><span[^>]*>\\$${amt}</span>`).test(html);
  check('excl＋未稅輸入：單價照印 $800', />\$800<\/td>/.test(html));
  check('excl：結論列＝「合計（未稅）」（不是「總計」）', bigTotLabel('合計（未稅）') && !bigTotLabel('總計'));
  check('excl：有「稅額另計」註記（含稅率5%）', /營業稅（5%）另計/.test(html));
  check('excl：沒有「總計」列', !/<span>總計<\/span>/.test(html));
  check('excl：沒有「營業稅」金額列', !/<span>營業稅<\/span>/.test(html));
  check('excl：表頭單價標（未稅）', html.includes('單價（未稅）'));
  check('excl：合計（未稅）金額=9,600', bigTot('合計（未稅）', '9,600'));

  /* ── 6. 稅金顯示 excl＋含稅輸入：自動換算 ── */
  await page.evaluate(() => { setTaxMode('inc'); calc(); });
  html = await page.evaluate(() => buildStdPagesHtml(''));
  check('excl＋含稅輸入：單價換算 800/1.05=761.9', />\$761\.9<\/td>/.test(html) && !/>\$800<\/td>/.test(html));
  check('excl＋含稅輸入：合計（未稅）=9,143（9600/1.05 四捨五入）', bigTot('合計（未稅）', '9,143'));
  check('excl＋含稅輸入：表頭仍標（未稅）', html.includes('單價（未稅）'));

  /* ── 7. 預設顯示：照現行 ── */
  await page.evaluate(() => { document.getElementById('f-taxdisplay').value=''; onTaxDisplayChange(); });
  html = await page.evaluate(() => buildStdPagesHtml(''));
  check('預設顯示：總計照印 $9,600', bigTot('總計', '9,600'));
  check('預設顯示：沒有稅額另計註記', !html.includes('另計。'));
  check('預設顯示：含稅輸入表頭標（含稅）', html.includes('單價（含稅）'));

  /* ── 8. hideTotals 優先：excl 也整區不印 ── */
  await page.evaluate(() => {
    document.getElementById('f-taxdisplay').value='excl';
    document.getElementById('f-hidetotals').checked = true;
  });
  html = await page.evaluate(() => buildStdPagesHtml(''));
  check('hideTotals＋excl：合計與註記都不印', !html.includes('合計（未稅）') && !html.includes('另計。'));
  await page.evaluate(() => { document.getElementById('f-hidetotals').checked = false; });

  /* ── 9. docopts 存檔內容 ── */
  r = await page.evaluate(() => {
    const q = collectQuote();
    const dop = (q.items||[]).find(i=>i.itemType==='docopts');
    return { top:q.quoteOnly, st:q.status, dop: dop?JSON.parse(dop.flavorList):null };
  });
  check('taxDisplay=excl 存進 docopts', r.dop && r.dop.taxDisplay==='excl');
  check('沒勾純報價：quoteOnly=N、status=草稿、docopts 不帶 quoteOnly', r.top==='N' && r.st==='草稿' && !(r.dop && r.dop.quoteOnly));

  /* ── 10. 載入舊單還原 ── */
  await page.evaluate(() => {
    resetAll(true);
    loadQuoteIntoForm({
      quoteNo:'20260801-99', quoteType:'bottle', clientName:'還原客戶',
      quoteDate:'2026-08-01', expiryDate:'2026-09-01', priceMode:'exc', taxRate:5,
      paymentType:'0', paymentDetail:'', grandTotal:9600,
      items:[
        {itemType:'bottle', name:'還原酒', volume:'500', unitPrice:800, deduction:0, logoFee:0, qty:12, subtotal:9600, flavorList:''},
        {itemType:'docopts', name:'文件顯示設定', unitPrice:0, deduction:0, logoFee:0, qty:1, subtotal:0, flavorList:JSON.stringify({quoteOnly:1, taxDisplay:'excl'})}
      ]
    });
  });
  await page.waitForTimeout(300);
  r = await page.evaluate(() => ({
    qo: document.getElementById('f-quoteonly').checked,
    td: document.getElementById('f-taxdisplay').value,
    ordVisible: document.getElementById('ordprog-block').style.display !== 'none'
  }));
  check('載入舊單：純報價勾選還原', r.qo===true);
  check('載入舊單：稅金顯示還原 excl', r.td==='excl');
  check('載入舊單（純報價）：訂單追蹤區塊藏起', !r.ordVisible);

  /* ── 11. resetAll 回預設 ── */
  await page.evaluate(() => resetAll(true));
  r = await page.evaluate(() => ({
    qo: document.getElementById('f-quoteonly').checked,
    td: document.getElementById('f-taxdisplay').value,
    ordVisible: document.getElementById('ordprog-block').style.display !== 'none'
  }));
  check('清除：純報價不勾、稅金顯示回含稅、訂單追蹤區塊重新顯示', !r.qo && r.td==='' && r.ordVisible);

  /* ── 12. buildOrders 過濾純報價 ── */
  r = await page.evaluate(() => {
    const list = buildOrders(
      { quotes:[
        { quoteNo:'A-1', status:'純報價', quoteType:'bottle', grandTotal:100, quoteDate:'2026-08-28' },
        { quoteNo:'B-1', status:'草稿', quoteOnly:'N', quoteType:'bottle', grandTotal:200, quoteDate:'2026-08-28' },
        { quoteNo:'C-1', status:'草稿', quoteType:'bottle', grandTotal:300, quoteDate:'2026-08-28' },
        { quoteNo:'D-1', status:'已刪除', quoteType:'bottle', grandTotal:400, quoteDate:'2026-08-28' }
      ]}, null, null);
    return list.map(x=>x.no);
  });
  check('buildOrders：status=純報價 不進訂單追蹤（一般單照常、已刪除照常排除）',
    !r.includes('A-1') && r.includes('B-1') && r.includes('C-1') && !r.includes('D-1'));

  /* ── 13. 報價紀錄「純報價」標記 ── */
  r = await page.evaluate(() => {
    REC_QUOTES=[
      { quoteNo:'20260828-01', clientName:'甲', quoteType:'bottle', quoteDate:'2026-08-28', grandTotal:100, status:'純報價' },
      { quoteNo:'20260828-02', clientName:'乙', quoteType:'bottle', quoteDate:'2026-08-28', grandTotal:200, status:'草稿' }
    ]; REC_CUSTOM=[];
    renderRecords();
    const rows=document.querySelectorAll('#rec-body tr');
    return { first:rows[0]?rows[0].innerHTML:'', second:rows[1]?rows[1].innerHTML:'' };
  });
  /* 清單依單號新→舊排序：-02（乙，一般）在前、-01（甲，純報價）在後 */
  check('報價紀錄：純報價單有標記、一般單沒有', r.second.includes('純報價') && !r.first.includes('純報價'));

  /* ── 14. 宴會單也吃稅金顯示 ──
     2026-08-31 宴會改版：客製化調酒從「整組共用一個價」改成「每款各自一列」，
     ban-g1-price／ban-g1-qty／ban-g1-qtylabel 已不存在（原本這一段就是掛在這裡），
     改用 addBanGroupRow(g, prefill) 產生 bg-<g>-<rowId> 列 ＋ [data-f="..."] 欄位。
     另：resetAll() 刻意不重設 qType，所以先 setType('banquet') 讓 resetAll 補宴會預設列，
     清完再 setType('banquet') 一次確保區塊確實切到宴會。 */
  await page.evaluate(() => {
    setType('banquet'); resetAll(true); setType('banquet');
    document.getElementById('f-cli').value='宴會客戶';
    addBanGroupRow('g1', { name:'甘蔗檸檬Mojito', price:150, qty:100 });
    setTaxMode('exc'); calc();
    document.getElementById('f-taxdisplay').value='excl'; onTaxDisplayChange();
  });
  html = await page.evaluate(() => buildStdPagesHtml(''));
  check('宴會單 excl：合計（未稅）＋稅額另計', bigTotLabel('合計（未稅）') && /另計。/.test(html));
  /* 未稅輸入 → 該款單價照印、小計＝150×100＝15,000。
     金額比對一律鎖在「表格儲存格」（>$…</td>），否則總計區的同額字串會讓斷言誤過。 */
  check('宴會單 excl：客製調酒列照印（單價 $150、小計 $15,000）',
    html.includes('甘蔗檸檬Mojito') && />\$150<\/td>/.test(html) && />\$15,000<\/td>/.test(html));
  check('宴會單 excl：表頭單價標（未稅）', html.includes('單價（未稅）') && !html.includes('單價（含稅）'));
  check('宴會單 excl：沒有「總計」列', !/<span>總計<\/span>/.test(html));

  /* ── 15. 宴會單 excl＋含稅輸入：每一款單價／小計一樣要 ÷1.05 換算 ── */
  await page.evaluate(() => { setTaxMode('inc'); calc(); });
  html = await page.evaluate(() => buildStdPagesHtml(''));
  check('宴會單 excl＋含稅輸入：單價換算 150/1.05=142.86', />\$142\.86<\/td>/.test(html));
  check('宴會單 excl＋含稅輸入：小計換算 15000/1.05=14,286', />\$14,286<\/td>/.test(html));
  check('宴會單 excl＋含稅輸入：品項列不再出現含稅原值 $150／$15,000',
    !/>\$150<\/td>/.test(html) && !/>\$15,000<\/td>/.test(html));
  /* 含稅輸入時表頭預設會寫（含稅），要被 taxDisplay='excl' 蓋成（未稅）才對——
     這一項放在含稅輸入下才咬得到（未稅輸入時兩條路都印（未稅），驗不出差別）。 */
  check('宴會單 excl＋含稅輸入：表頭被蓋成（未稅）', html.includes('單價（未稅）') && !html.includes('單價（含稅）'));

  /* ── 16. 宴會單「手動小計」那一款：excl 一樣走換算（Molly 談整包價常用） ── */
  await page.evaluate(() => {
    setType('banquet'); resetAll(true); setType('banquet');
    document.getElementById('f-cli').value='宴會客戶2';
    addBanGroupRow('g1', { name:'整包價調酒', manual:true, subval:21000 });
    setTaxMode('inc'); calc();
    document.getElementById('f-taxdisplay').value='excl'; onTaxDisplayChange();
  });
  html = await page.evaluate(() => buildStdPagesHtml(''));
  check('宴會單 excl＋手動小計：21000/1.05=20,000', />\$20,000<\/td>/.test(html) && !/>\$21,000<\/td>/.test(html));
  await page.evaluate(() => { setType('bottle'); resetAll(true); setType('bottle'); });

  await browser.close();
  results.forEach(x=>console.log(x[0]+'  '+x[1]));
  const fails = results.filter(x=>x[0]==='FAIL').length;
  console.log(`\n${results.length-fails}/${results.length} PASS${fails?`（${fails} FAIL）`:''}`);
  if (errors.length){ console.log('\n--- page errors ---'); errors.forEach(e=>console.log(e)); }
  process.exit(fails?1:0);
})();
