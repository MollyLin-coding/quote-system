/* 產生 Lot 驗收單 modal 新增「預覽」按鈕：離線測試
   ・按鈕存在，位置在「取消」跟「產生分批驗收單」之間
   ・點擊後會另開視窗顯示文件，且不會呼叫 saveVerifyForm（不留底）
   ・預覽視窗沒有 window.onload 自動列印，且有「預覽・尚未留底」標籤 */
const { chromium } = require('/opt/node-tools/node_modules/playwright');

const QUOTE = { quoteNo:'20260724-02', quoteType:'bottle', clientName:'有趣市集',
  items:[{itemType:'bottle', name:'蜜香紅茶荔枝琴酒', lot:'2', volume:'100', qty:60}] };

let savedCalls = 0;
function respond(action){
  switch(action){
    case 'getTodayDigest': return { ok:true, today:'2026-07-27', ship_due:[], final_due:[], no_scan:[], no_invoice:[], calendar:[], warnings:[] };
    case 'getQuoteById':   return { ok:true, quote:QUOTE };
    case 'saveVerifyForm': savedCalls++; return { ok:true };
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
      ? { ok:true, results:(body.calls||[]).map(c => respond(c.action)) }
      : respond(body.action);
    await route.fulfill({ status:200, headers:{'Access-Control-Allow-Origin':'*'},
      contentType:'application/json', body:JSON.stringify(payload) });
  });
  await page.goto('http://localhost:8899/index.html');
  await page.evaluate(() => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 'test-token';
    PREFETCH_DONE = true;
  });

  await page.evaluate(() => openVerifyForm('20260724-02'));
  await page.waitForTimeout(500);

  const btnTexts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#vf-overlay > div > div:last-child button')).map(b => b.textContent.trim()));
  check('modal 有「預覽」按鈕', btnTexts.some(t => t.includes('預覽')));
  check('順序＝取消→預覽→分批→整批', JSON.stringify(btnTexts) === JSON.stringify(['取消','預覽','產生分批驗收單','產生整批驗收單']));

  // 點預覽，攔截新開視窗
  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    page.evaluate(() => previewVerifyPdf()),
  ]);
  await popup.waitForLoadState('domcontentloaded');
  await popup.waitForTimeout(300);

  const popupHtml = await popup.content();
  check('預覽視窗有「預覽・尚未留底」標籤', popupHtml.includes('預覽・尚未留底'));
  check('預覽視窗沒有 window.onload 自動列印', !popupHtml.includes('window.onload'));
  check('預覽視窗仍有手動列印按鈕', popupHtml.includes('列印 / 另存 PDF'));
  check('點預覽不會呼叫 saveVerifyForm（不留底）', savedCalls === 0);

  console.log(`\n=== 結果：${results.filter(r=>r[0]==='PASS').length}/${results.length} 通過 ===`);
  results.filter(r=>r[0]==='FAIL').forEach(r=>console.log('FAIL:',r[1]));
  if (errors.length) { console.log('\n--- Console/Page errors ---'); errors.forEach(e=>console.log(e)); }

  await browser.close();
  process.exit(results.some(r=>r[0]==='FAIL') ? 1 : 0);
})();
