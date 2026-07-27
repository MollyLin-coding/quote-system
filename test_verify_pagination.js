/* 驗收單分頁／頁碼／0瓶橫線／第幾次出貨／字體 三項新功能：離線測試 */
const { chromium } = require('/opt/node-tools/node_modules/playwright');

const QUOTE_SMALL = { quoteNo:'20260724-02', quoteType:'bottle', clientName:'有趣市集',
  items:[
    {itemType:'bottle', name:'蜜香紅茶荔枝琴酒', lot:'2', volume:'100', qty:60},
    {itemType:'bottle', name:'茉莉綠茶琴酒', lot:'', volume:'100', qty:0},
  ]};

// 造出很多品項，逼分頁
const bigItems = [];
for (let i=0;i<40;i++){
  bigItems.push({itemType:'bottle', name:`測試品項${i+1}號商品名稱比較長一點`, lot:'L'+i, volume:'100', qty: (i%5===0)?0:30});
}
const QUOTE_BIG = { quoteNo:'20260724-03', quoteType:'bottle', clientName:'測試大客戶', items: bigItems };

let priorFormsCount = 2; // 模擬這張單先前已產生過 2 次驗收單，測試「第幾次出貨」序號

function respond(action, params){
  switch(action){
    case 'getTodayDigest': return { ok:true, today:'2026-07-27', ship_due:[], final_due:[], no_scan:[], no_invoice:[], calendar:[], warnings:[] };
    case 'getQuoteById':
      return { ok:true, quote: params.quoteNo==='20260724-03' ? QUOTE_BIG : QUOTE_SMALL };
    case 'listVerifyForms':
      return { ok:true, records: Array.from({length:priorFormsCount}, ()=>({no:'20260724-02'})) };
    case 'saveVerifyForm': return { ok:true };
    default: return { ok:true };
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errors = [], results = [];
  const check = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);
  const isNoise = t => /Failed to load resource|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|favicon/i.test(t);

  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', e => errors.push('PAGEERROR(main): ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('CONSOLE(main): ' + m.text()); });
  await page.route('**/script.google.com/**', async route => {
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
    const payload = body.action === 'batch'
      ? { ok:true, results:(body.calls||[]).map(c => respond(c.action, c.params||c)) }
      : respond(body.action, body);
    await route.fulfill({ status:200, headers:{'Access-Control-Allow-Origin':'*'},
      contentType:'application/json', body:JSON.stringify(payload) });
  });
  await page.goto('http://localhost:8899/index.html');
  await page.evaluate(() => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 'test-token';
    PREFETCH_DONE = true;
  });

  /* ---- 測試1：小單（分批模式），檢查 0瓶→橫線、第幾次出貨序號 ---- */
  await page.evaluate(() => openVerifyForm('20260724-02'));
  await page.waitForTimeout(400);
  const priorCount = await page.evaluate(() => VERIFY_DATA.priorCount);
  check('priorCount 從 listVerifyForms 正確帶入 (=2)', priorCount === 2);

  const smallHtml = await page.evaluate(() => {
    const d = JSON.parse(JSON.stringify(VERIFY_DATA));
    d.mode = 'partial';
    d.rows.forEach(r=>{ r.thisShip = r.ordered; });
    return buildVerifyDocHtml(d);
  });
  check('分批模式標籤顯示「第 3 次」(priorCount 2 + 1)', smallHtml.includes('分批出貨・第 3 次'));
  check('0瓶品項顯示橫線(—)而不是「0 瓶」', !/[^0-9]0 瓶/.test(smallHtml) && smallHtml.includes('—'));
  check('.ttl 標題字體與內文相同 (Noto Sans TC，非標楷體)', /\.ttl\{font-family:'Noto Sans TC'/.test(smallHtml) && !smallHtml.includes('標楷體'));
  check('品項欄位字體加大到 12.83px', smallHtml.includes('font-size:12.83px'));
  check('只有一頁（品項少）', (smallHtml.match(/class="vpage"/g)||[]).length === 1);
  check('有頁碼文字「第 1 頁，共 1 頁」', smallHtml.includes('第 1 頁，共 1 頁'));

  /* ---- 測試2：大單（40 個品項），逼分頁，檢查頁碼、footer 只在最後一頁 ---- */
  await page.evaluate(() => openVerifyForm('20260724-03'));
  await page.waitForTimeout(400);
  const bigResult = await page.evaluate(() => {
    const d = JSON.parse(JSON.stringify(VERIFY_DATA));
    d.mode = 'full';
    const html = buildVerifyDocHtml(d);
    const pageCount = (html.match(/class="vpage"/g)||[]).length;
    const qrCount = (html.match(/class="qr"/g)||[]).length;
    const pgnoMatches = Array.from(html.matchAll(/第 (\d+) 頁，共 (\d+) 頁/g)).map(m=>[+m[1], +m[2]]);
    // 檢查所有品項名稱都有出現(沒有遺漏或重複列)
    const nameOccurrences = d.rows.map(r => (html.split(r.name).length - 1));
    return { pageCount, qrCount, pgnoMatches, nameOccurrences, rowCount: d.rows.length };
  });
  check('大單品項數夠多，確實產生超過 1 頁', bigResult.pageCount > 1);
  check('QR code(驗收回報區塊)只出現在最後一頁', bigResult.qrCount === 1);
  check('頁碼總數與 vpage 數一致，且每頁「共 Y 頁」一致',
    bigResult.pgnoMatches.length === bigResult.pageCount &&
    bigResult.pgnoMatches.every(([idx,total]) => total === bigResult.pageCount) &&
    bigResult.pgnoMatches.map(p=>p[0]).join(',') === Array.from({length:bigResult.pageCount},(_,i)=>i+1).join(','));
  check('每個品項名稱恰好出現一次（沒有遺漏或重複列）', bigResult.nameOccurrences.every(n => n === 1));

  console.log(`\n=== 結果：${results.filter(r=>r[0]==='PASS').length}/${results.length} 通過 ===`);
  results.filter(r=>r[0]==='FAIL').forEach(r=>console.log('FAIL:',r[1]));
  if (errors.length) { console.log('\n--- Console/Page errors ---'); errors.forEach(e=>console.log(e)); }

  await browser.close();
  process.exit(results.some(r=>r[0]==='FAIL') ? 1 : 0);
})();
