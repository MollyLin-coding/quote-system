/* 2026-08-28：純報價單＋報價單稅金顯示（未稅/含稅）離線測試
   ・純報價勾選：藏訂單追蹤進度區塊、collectQuote 帶 quoteOnly='Y'＋docopts quoteOnly:1
   ・存檔：純報價即使填了訂金日期也「不」打 updateOrderStatus；一般單照舊會打
   ・稅金顯示 excl：未稅輸入＝單價照印＋合計（未稅）＋稅額另計註記、沒有「總計」列
   ・稅金顯示 excl＋含稅輸入：單價/小計自動 ÷1.05 換算
   ・預設顯示：照現行（總計照印）；hideTotals 優先（整區不印）
   ・docopts 還原／resetAll 回預設
   ・buildOrders 過濾 quoteOnly='Y'；報價紀錄顯示「純報價」標記 */
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
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 'test-token'; PREFETCH_DONE = true;
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
    return { top:q.quoteOnly, dop: dop?JSON.parse(dop.flavorList):null };
  });
  check('collectQuote：quoteOnly=Y', r.top==='Y');
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
  let html = await page.evaluate(() => buildStdPagesHtml(''));
  check('excl＋未稅輸入：單價照印 $800', html.includes('$800'));
  check('excl：有「合計（未稅）」', html.includes('合計（未稅）'));
  check('excl：有「稅額另計」註記（含稅率5%）', /營業稅（5%）另計/.test(html));
  check('excl：沒有「總計」列', !/<span>總計<\/span>/.test(html));
  check('excl：沒有「營業稅」金額列', !/<span>營業稅<\/span>/.test(html));
  check('excl：表頭單價標（未稅）', html.includes('單價（未稅）'));
  check('excl：合計金額=9,600', html.includes('$9,600'));

  /* ── 6. 稅金顯示 excl＋含稅輸入：自動換算 ── */
  await page.evaluate(() => { setTaxMode('inc'); calc(); });
  html = await page.evaluate(() => buildStdPagesHtml(''));
  check('excl＋含稅輸入：單價換算 800/1.05=761.9', html.includes('$761.9'));
  check('excl＋含稅輸入：合計=9,143（9600/1.05 四捨五入）', html.includes('$9,143'));
  check('excl＋含稅輸入：表頭仍標（未稅）', html.includes('單價（未稅）'));

  /* ── 7. 預設顯示：照現行 ── */
  await page.evaluate(() => { document.getElementById('f-taxdisplay').value=''; onTaxDisplayChange(); });
  html = await page.evaluate(() => buildStdPagesHtml(''));
  check('預設顯示：總計照印', /<span>總計<\/span>/.test(html) && html.includes('$9,600'));
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
    return { top:q.quoteOnly, dop: dop?JSON.parse(dop.flavorList):null };
  });
  check('taxDisplay=excl 存進 docopts', r.dop && r.dop.taxDisplay==='excl');
  check('沒勾純報價：quoteOnly=N、docopts 不帶 quoteOnly', r.top==='N' && !(r.dop && r.dop.quoteOnly));

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
        { quoteNo:'A-1', status:'草稿', quoteOnly:'Y', quoteType:'bottle', grandTotal:100, quoteDate:'2026-08-28' },
        { quoteNo:'B-1', status:'草稿', quoteOnly:'N', quoteType:'bottle', grandTotal:200, quoteDate:'2026-08-28' },
        { quoteNo:'C-1', status:'草稿', quoteType:'bottle', grandTotal:300, quoteDate:'2026-08-28' }
      ]}, null, null);
    return list.map(x=>x.no);
  });
  check('buildOrders：quoteOnly=Y 不進訂單追蹤（舊單沒欄位照常列入）',
    !r.includes('A-1') && r.includes('B-1') && r.includes('C-1'));

  /* ── 13. 報價紀錄「純報價」標記 ── */
  r = await page.evaluate(() => {
    REC_QUOTES=[
      { quoteNo:'20260828-01', clientName:'甲', quoteType:'bottle', quoteDate:'2026-08-28', grandTotal:100, status:'草稿', quoteOnly:'Y' },
      { quoteNo:'20260828-02', clientName:'乙', quoteType:'bottle', quoteDate:'2026-08-28', grandTotal:200, status:'草稿' }
    ]; REC_CUSTOM=[];
    renderRecords();
    const rows=document.querySelectorAll('#rec-body tr');
    return { first:rows[0]?rows[0].innerHTML:'', second:rows[1]?rows[1].innerHTML:'' };
  });
  /* 清單依單號新→舊排序：-02（乙，一般）在前、-01（甲，純報價）在後 */
  check('報價紀錄：純報價單有標記、一般單沒有', r.second.includes('純報價') && !r.first.includes('純報價'));

  /* ── 14. 宴會單也吃稅金顯示 ── */
  await page.evaluate(() => {
    resetAll(true);
    setType('banquet');
    document.getElementById('f-cli').value='宴會客戶';
    document.getElementById('ban-g1-price').value='150';
    document.getElementById('ban-g1-qty').value='100';
    setTaxMode('exc'); calc();
    document.getElementById('f-taxdisplay').value='excl';
  });
  html = await page.evaluate(() => buildStdPagesHtml(''));
  check('宴會單 excl：合計（未稅）＋稅額另計', html.includes('合計（未稅）') && /另計。/.test(html));
  await page.evaluate(() => { resetAll(true); setType('bottle'); });

  await browser.close();
  results.forEach(x=>console.log(x[0]+'  '+x[1]));
  const fails = results.filter(x=>x[0]==='FAIL').length;
  console.log(`\n${results.length-fails}/${results.length} PASS${fails?`（${fails} FAIL）`:''}`);
  if (errors.length){ console.log('\n--- page errors ---'); errors.forEach(e=>console.log(e)); }
  process.exit(fails?1:0);
})();
