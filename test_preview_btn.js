/* 報價紀錄列表新增「預覽」按鈕：離線測試
   ・按鈕存在、位置在「開啟」跟「驗收單」之間
   ・點擊後會載入該單並開啟預覽視窗（#pov 顯示），且不噴 console error */
const { chromium } = require('/opt/node-tools/node_modules/playwright');

const QUOTES = [
  { quoteNo:'20260724-02', quoteType:'bottle', clientName:'有趣市集', contactName:'李小華', contactPhone:'0922-222-222',
    quoteDate:'2026-07-24', grandTotal:16800, status:'', createdAt:'2026-07-24',
    items:[{itemType:'bottle', name:'蜜香紅茶荔枝琴酒', lot:'2', volume:'100', qty:60, unitPrice:100}] },
];

function respond(action){
  switch(action){
    case 'getQuotes':          return { ok:true, quotes:QUOTES };
    case 'listCustomQuotes':   return { ok:true, quotes:[] };
    case 'getOrderStatusList': return { ok:true, orders:[] };
    case 'getVerifications':   return { ok:true, records:[], summary:{} };
    case 'listVerifyForms':    return { ok:true, records:[], summary:{} };
    case 'listShipments':      return { ok:true, shipments:[] };
    case 'listCalendarItems':  return { ok:true, items:[] };
    case 'getCompanyData':     return { ok:true, companies:[], products:[], rules:[] };
    case 'getOwnbrandProducts':return { ok:true, products:[] };
    case 'getOwnbrandTiers':   return { ok:true, tiers:[], terms:{} };
    case 'getTodayDigest':     return { ok:true, today:'2026-07-27', ship_due:[], final_due:[], no_scan:[], no_invoice:[], calendar:[], warnings:[] };
    case 'getQuoteById':       return { ok:true, quote:QUOTES[0] };
    default:                   return { ok:true };
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errors = [], results = [];
  const check = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);
  const isNoise = t => /Failed to load resource|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|favicon/i.test(t);

  const page = await browser.newPage();
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('CONSOLE: ' + m.text()); });
  await page.route('**/script.google.com/**', async route => {
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
    let payload;
    if (body.action === 'batch') payload = { ok:true, results:(body.calls||[]).map(c => respond(c.action)) };
    else payload = respond(body.action);
    await route.fulfill({ status:200, headers:{'Access-Control-Allow-Origin':'*'},
      contentType:'application/json', body:JSON.stringify(payload) });
  });
  await page.goto('http://localhost:8899/index.html');
  await page.evaluate(() => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 'test-token';
    PREFETCH_DONE = true;
  });

  await page.evaluate(() => gotoPage('records'));
  await page.waitForTimeout(300);
  await page.evaluate(() => loadRecords(true));
  await page.waitForTimeout(500);

  const btnTexts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#rec-body tr .rec-actions button')).map(b => b.textContent.trim()));
  check('該列有「預覽」按鈕', btnTexts.includes('預覽'));
  check('順序＝開啟→預覽→驗收單→刪除', JSON.stringify(btnTexts) === JSON.stringify(['開啟','預覽','驗收單','刪除']));

  await page.evaluate(() => previewRecordQuote('20260724-02'));
  await page.waitForTimeout(500);
  const povShown = await page.evaluate(() => document.getElementById('pov').style.display === 'block');
  check('點「預覽」後 #pov 顯示', povShown);
  const hasClient = await page.evaluate(() => document.getElementById('pcon').innerText.includes('有趣市集'));
  check('預覽內容含客戶名稱', hasClient);
  const noNavSwitch = await page.evaluate(() => currentPage === 'new');
  check('底層頁面已切到 new（供預覽渲染）', noNavSwitch);

  console.log(`\n=== 結果：${results.filter(r=>r[0]==='PASS').length}/${results.length} 通過 ===`);
  results.filter(r=>r[0]==='FAIL').forEach(r=>console.log('FAIL:',r[1]));
  if (errors.length) { console.log('\n--- Console/Page errors ---'); errors.forEach(e=>console.log(e)); }

  await browser.close();
  process.exit(results.some(r=>r[0]==='FAIL') ? 1 : 0);
})();
