/* 2026-08-28：另存新單／複製 離線測試
   ・編輯既有單才顯示「另存新單」鈕；新單／清除後隱藏
   ・saveAsNewQuote：走 createQuote（不是 updateQuote）、原單號不動、日期換今天、存完切到新單
   ・recCopyQuote：內容帶進表單、斷開成新單（沒存檔）、日期今天、FORM_DIRTY=true；再儲存走 createQuote
   ・複製純報價單：勾選一起帶過來 */
const { chromium } = require('/opt/node-tools/node_modules/playwright');

const seenActions = [];
const OLD_QUOTE = {
  quoteNo:'20260801-05', quoteType:'bottle', clientName:'複製來源客戶', contactName:'',
  quoteDate:'2026-08-01', expiryDate:'2026-09-01', handler:'Molly', priceMode:'exc', taxRate:5,
  itemsSubtotal:9600, taxAmount:480, extrasTotal:0, grandTotal:10080,
  paymentType:'3', paymentDetail:'', remark:'', status:'草稿',
  items:[
    {itemType:'bottle', name:'來源酒', lot:'', volume:'500', unitPrice:800, deduction:0, logoFee:0, qty:12, unit:'', subtotal:9600, flavorList:''}
  ]
};
const OLD_QUOTE_QO = Object.assign({}, OLD_QUOTE, { quoteNo:'20260801-06', status:'純報價',
  items: OLD_QUOTE.items.concat([{itemType:'docopts', name:'文件顯示設定', unitPrice:0, deduction:0, logoFee:0, qty:1, subtotal:0, flavorList:JSON.stringify({quoteOnly:1})}]) });

function respond(action, body){
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
    case 'getQuoteById':       return { ok:true, quote:(body && body.quoteNo==='20260801-06') ? OLD_QUOTE_QO : OLD_QUOTE };
    case 'createQuote':        return { ok:true, quoteNo:'20260828-88' };
    case 'updateQuote':        return { ok:true, quoteNo:(body&&body.quoteNo)||'' };
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
  page.on('dialog', d => d.accept());   // confirm 一律按「確定」
  await page.route('**/script.google.com/**', async route => {
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
    let payload;
    if (body.action === 'batch') { (body.calls||[]).forEach(c=>seenActions.push(c.action)); payload = { ok:true, results:(body.calls||[]).map(c => respond(c.action, c)) }; }
    else { seenActions.push(body.action); payload = respond(body.action, body); }
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

  const todayStr_ = await page.evaluate(() => todayStr());

  /* ── 1. 新單：另存鈕隱藏 ── */
  await page.evaluate(() => resetAll(true));
  let r = await page.evaluate(() => document.getElementById('btn-saveas').style.display);
  check('新單：另存新單鈕隱藏', r==='none');

  /* ── 2. 開啟既有單：另存鈕出現 ── */
  await page.evaluate(() => openRecord('20260801-05'));
  await page.waitForTimeout(400);
  r = await page.evaluate(() => ({ btn:document.getElementById('btn-saveas').style.display, no:document.getElementById('f-no').value, cli:document.getElementById('f-cli').value }));
  check('開啟舊單：另存鈕顯示、單號/客戶正確', r.btn!=='none' && r.no==='20260801-05' && r.cli==='複製來源客戶');

  /* ── 3. 另存新單：走 createQuote、切到新單 ── */
  seenActions.length = 0;
  await page.evaluate(() => saveAsNewQuote());
  await page.waitForTimeout(600);
  r = await page.evaluate(() => ({ no:document.getElementById('f-no').value, dt:document.getElementById('f-dt').value, dirty:FORM_DIRTY, btn:document.getElementById('btn-saveas').style.display }));
  check('另存新單：呼叫 createQuote 而非 updateQuote', seenActions.includes('createQuote') && !seenActions.includes('updateQuote'));
  check('另存新單：單號換成後端發的新號', r.no==='20260828-88');
  check('另存新單：報價日期換成今天', r.dt===todayStr_);
  check('另存新單：存檔後乾淨、鈕仍顯示（現在編輯的是新單）', r.dirty===false && r.btn!=='none');

  /* ── 4. 再按儲存＝更新新單（不再建更多單） ── */
  seenActions.length = 0;
  await page.evaluate(() => saveQuote());
  await page.waitForTimeout(500);
  check('另存後再儲存：走 updateQuote（更新剛另存的新單）', seenActions.includes('updateQuote') && !seenActions.includes('createQuote'));

  /* ── 5. 報價紀錄「複製」：帶內容、不存檔 ── */
  await page.evaluate(() => resetAll(true));
  seenActions.length = 0;
  await page.evaluate(() => recCopyQuote('20260801-05'));
  await page.waitForTimeout(500);
  r = await page.evaluate(() => ({ cli:document.getElementById('f-cli').value, dt:document.getElementById('f-dt').value,
    no:document.getElementById('f-no').value, dirty:FORM_DIRTY, btn:document.getElementById('btn-saveas').style.display,
    editing:(typeof editingQuoteNo!=='undefined' && editingQuoteNo)||null }));
  check('複製：內容帶進表單', r.cli==='複製來源客戶');
  check('複製：是新單（沒綁舊單號、鈕隱藏、未存檔）', r.editing===null && r.btn==='none' && r.dirty===true);
  check('複製：日期換今天、單號重編（不是 20260801-05）', r.dt===todayStr_ && r.no!=='20260801-05');
  check('複製：只讀取、沒有任何存檔動作', !seenActions.includes('createQuote') && !seenActions.includes('updateQuote'));

  /* ── 6. 複製後儲存＝createQuote，原單不動 ── */
  seenActions.length = 0;
  await page.evaluate(() => saveQuote());
  await page.waitForTimeout(500);
  check('複製後儲存：走 createQuote', seenActions.includes('createQuote') && !seenActions.includes('updateQuote'));

  /* ── 7. 複製純報價單：勾選一起帶過來 ── */
  await page.evaluate(() => resetAll(true));
  await page.evaluate(() => recCopyQuote('20260801-06'));
  await page.waitForTimeout(500);
  r = await page.evaluate(() => ({ qo:document.getElementById('f-quoteonly').checked }));
  check('複製純報價單：純報價勾選跟著帶', r.qo===true);

  /* ── 8. 清除：回到乾淨新單、鈕隱藏 ── */
  await page.evaluate(() => resetAll(true));
  r = await page.evaluate(() => ({ btn:document.getElementById('btn-saveas').style.display, qo:document.getElementById('f-quoteonly').checked }));
  check('清除：另存鈕隱藏、純報價不勾', r.btn==='none' && !r.qo);

  await browser.close();
  results.forEach(x=>console.log(x[0]+'  '+x[1]));
  const fails = results.filter(x=>x[0]==='FAIL').length;
  console.log(`\n${results.length-fails}/${results.length} PASS${fails?`（${fails} FAIL）`:''}`);
  if (errors.length){ console.log('\n--- page errors ---'); errors.forEach(e=>console.log(e)); }
  process.exit(fails?1:0);
})();
