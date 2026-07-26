/* 讀取快取／切頁秒開的離線測試
   用 Playwright 攔截真正的 fetch（不是換掉 apiCall），所以連 apiCall 裡
   「寫入動作要清快取」那段也一起測到。 */
const { chromium } = require('/opt/node-tools/node_modules/playwright');

const QUOTES = [
  { quoteNo:'20260701-01', quoteType:'bottle',  clientName:'滿枝枒',   quoteDate:'2026-07-01', grandTotal:12000, status:'', expiryDate:'2026-08-01', createdAt:'2026-07-01' },
  { quoteNo:'20260702-01', quoteType:'banquet', clientName:'有趣市集', quoteDate:'2026-07-02', grandTotal:16800, status:'', expiryDate:'2026-08-02', createdAt:'2026-07-02' },
  { quoteNo:'20260703-01', quoteType:'bottle',  clientName:'囍酒工藝', quoteDate:'2026-07-03', grandTotal:  900, status:'', expiryDate:'2026-08-03', createdAt:'2026-07-03' },
  { quoteNo:'20260704-01', quoteType:'bottle',  clientName:'已刪那張', quoteDate:'2026-07-04', grandTotal: 5000, status:'已刪除', expiryDate:'', createdAt:'2026-07-04' },
];
const ORDER_ST = [{ quote_no:'20260701-01', status:'deposit', grand_total:12000, ship_date_est:'2026-07-31' }];
const DIGEST = { ok:true, today:'2026-07-26', ship_due:[], final_due:[], no_scan:[], no_invoice:[], calendar:[], warnings:[] };

function respond(action){
  switch(action){
    case 'getQuotes':          return { ok:true, quotes:QUOTES };
    case 'listCustomQuotes':   return { ok:true, quotes:[] };
    case 'getOrderStatusList': return { ok:true, orders:ORDER_ST };
    case 'getVerifications':   return { ok:true, records:[], summary:{} };
    case 'listVerifyForms':    return { ok:true, records:[], summary:{} };
    case 'listShipments':      return { ok:true, shipments:[] };
    case 'listCalendarItems':  return { ok:true, items:[] };
    case 'getCompanyData':     return { ok:true, companies:[], products:[], rules:[] };
    case 'getOwnbrandProducts':return { ok:true, products:[] };
    case 'getOwnbrandTiers':   return { ok:true, tiers:[], terms:{} };
    case 'getTodayDigest':     return DIGEST;
    case 'getCustomers':       return { ok:true, customers:[] };
    case 'getQuoteById':       return { ok:true, quote:QUOTES[0], items:[] };
    default:                   return { ok:true };
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errors = [];
  const results = [];
  const check = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);
  const isNoise = t => /Failed to load resource|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|favicon/i.test(t);

  let LOG = [];                                     // [{action, at}]  一筆＝一個 HTTP 請求
  let SUB = [];                                     // batch 裡面的子 action
  let BATCH_BROKEN = false;                         // 模擬「後端還是舊版、不認得 batch」
  const countOf = a => LOG.filter(x => x.action === a).length;
  const gotData = a => LOG.filter(x => x.action === a).length + SUB.filter(x => x === a).length;
  const reset = () => { LOG = []; SUB = []; };

  const newPage = async () => {
    const p = await browser.newPage();
    p.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('CONSOLE: ' + m.text()); });
    await p.route('**/script.google.com/**', async route => {
      let body = {};
      try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
      LOG.push({ action: body.action, at: Date.now() });
      await new Promise(r => setTimeout(r, 30));    // 假裝後端要一點時間
      let payload;
      if (body.action === 'batch') {
        if (BATCH_BROKEN) payload = { ok:false, error:'unknown action: batch' };
        else {
          (body.calls || []).forEach(c => SUB.push(c.action));
          payload = { ok:true, results:(body.calls||[]).map(c => respond(c.action)) };
        }
      } else payload = respond(body.action);
      await route.fulfill({
        status: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        contentType: 'application/json',
        body: JSON.stringify(payload)
      });
    });
    await p.goto('http://localhost:8899/index.html');
    await p.evaluate(() => {
      document.getElementById('login-overlay').style.display = 'none';
      AUTH_TOKEN = 'test-token';
      PREFETCH_DONE = true;                          // 預抓另外測，先關掉免得干擾計數
    });
    return p;
  };

  /* ---------- 1. 第一次進訂單追蹤：該打的都打了 ---------- */
  let page = await newPage();
  reset();
  await page.evaluate(async () => { gotoPage('orders'); await loadOrders(); });
  await page.waitForTimeout(300);
  check('訂單追蹤首次載入：三支主資料各打一次', countOf('getQuotes')===1 && countOf('listCustomQuotes')===1 && countOf('getOrderStatusList')===1);
  check('訂單追蹤首次載入：徽章三支也打了', countOf('listVerifyForms')===1 && countOf('getVerifications')===1 && countOf('listShipments')===1);
  check('訂單列表有畫出來（3 張有效單）', await page.evaluate(() => ORDERS_CACHE && ORDERS_CACHE.length===3));
  check('已刪除的單沒被算進去', await page.evaluate(() => !ORDERS_CACHE.some(o=>o.no==='20260704-01')));

  /* ---------- 2. 來回切頁不重打 ---------- */
  reset();
  await page.evaluate(async () => { gotoPage('today'); await loadToday(); gotoPage('orders'); await loadOrders(); });
  await page.waitForTimeout(300);
  check('切走再切回訂單追蹤：完全不打後端', countOf('getQuotes')===0 && countOf('getOrderStatusList')===0 && countOf('listCustomQuotes')===0);
  check('切回來列表還在', await page.evaluate(() => document.getElementById('ord-body').innerHTML.includes('20260701-01')));

  /* ---------- 3. 月報表吃現成資料 ---------- */
  reset();
  await page.evaluate(async () => { gotoPage('report'); });
  await page.waitForTimeout(400);
  check('月報表：不重抓訂單', countOf('getQuotes')===0);
  check('月報表：有內容（不是空白）', await page.evaluate(() => document.getElementById('rpt-box').innerHTML.length > 50));

  /* ---------- 4. 驗收管理與報價紀錄共用同一份快取 ---------- */
  reset();
  await page.evaluate(async () => { gotoPage('verify'); await loadVerifyMgmt(); });
  await page.waitForTimeout(300);
  check('驗收管理：驗收兩支已在快取，不重打', countOf('getVerifications')===0 && countOf('listVerifyForms')===0);
  reset();
  await page.evaluate(async () => { gotoPage('records'); await loadRecords(); });
  await page.waitForTimeout(300);
  check('報價紀錄：getQuotes 已在快取，不重打', countOf('getQuotes')===0);
  check('報價紀錄有列出 3 張單', await page.evaluate(() => document.querySelectorAll('#rec-body tr.clickable').length===3));

  /* ---------- 5. 篩選／搜尋完全在前端 ---------- */
  reset();
  await page.evaluate(() => { document.getElementById('rec-type-filter').value='bottle'; renderRecords(); });
  check('換類型篩選：不打後端', countOf('getQuotes')===0);
  check('換類型篩選：只剩 2 張瓶裝', await page.evaluate(() => document.querySelectorAll('#rec-body tr.clickable').length===2));
  await page.evaluate(() => { document.getElementById('rec-search').value='囍酒'; renderRecords(); });
  check('關鍵字搜尋：前端就過濾好', await page.evaluate(() => {
    const rows=document.querySelectorAll('#rec-body tr.clickable');
    return rows.length===1 && rows[0].textContent.includes('囍酒工藝');
  }));
  await page.evaluate(() => { document.getElementById('rec-search').value='20260702'; document.getElementById('rec-type-filter').value=''; renderRecords(); });
  check('關鍵字也能搜單號', await page.evaluate(() => {
    const rows=document.querySelectorAll('#rec-body tr.clickable');
    return rows.length===1 && rows[0].textContent.includes('有趣市集');
  }));
  await page.evaluate(() => { document.getElementById('rec-search').value=''; renderRecords(); });
  check('搜不到時顯示「沒有符合條件」', await page.evaluate(() => {
    document.getElementById('rec-search').value='不可能存在的客戶';
    renderRecords();
    const t=document.getElementById('rec-body').textContent;
    document.getElementById('rec-search').value=''; renderRecords();
    return t.includes('沒有符合條件');
  }));

  /* ---------- 6. 讀取動作不會清掉快取 ---------- */
  reset();
  await page.evaluate(async () => { await apiCall({action:'getQuoteById', token:AUTH_TOKEN, quoteNo:'20260701-01'}); });
  await page.evaluate(async () => { await loadOrders(); });
  await page.waitForTimeout(200);
  check('純讀取動作之後，快取仍在（只打了那支讀取）', countOf('getQuoteById')===1 && countOf('getQuotes')===0);

  /* ---------- 7. 寫入動作一定清快取 ---------- */
  reset();
  await page.evaluate(async () => { await apiCall({action:'updateOrderStatus', token:AUTH_TOKEN, quote_no:'20260701-01', fields:{}}); });
  check('寫入後快取被清空', await page.evaluate(() => Object.keys(RC_STORE).length===0));
  check('寫入後訂單衍生資料也歸零', await page.evaluate(() => ORDERS_CACHE===null && VM_DATA===null));
  await page.evaluate(async () => { await loadOrders(); });
  await page.waitForTimeout(300);
  check('寫入後再進訂單追蹤：確實重新抓', countOf('getQuotes')===1 && countOf('getOrderStatusList')===1);

  /* ---------- 8. 「重新整理」一定重打 ---------- */
  reset();
  await page.evaluate(async () => { await loadOrders(true); });
  await page.waitForTimeout(300);
  check('按重新整理：強制重抓', countOf('getQuotes')===1);
  reset();
  await page.evaluate(async () => { await loadRecords(true); });
  await page.waitForTimeout(200);
  check('報價紀錄重新整理：強制重抓', countOf('getQuotes')===1);

  /* ---------- 9. 同一份資料同時被要 → 只打一次 ---------- */
  const p9 = await newPage();
  reset();
  await p9.evaluate(async () => { rcClear(); await Promise.all([loadOrders(), loadRecords()]); });
  await p9.waitForTimeout(300);
  check('兩頁同時要 getQuotes：只打一次（請求去重）', countOf('getQuotes')===1);

  /* ---------- 10. 驗收管理不再「等兩輪」 ---------- */
  const p10 = await newPage();
  reset();
  await p10.evaluate(async () => { rcClear(); gotoPage('verify'); await loadVerifyMgmt(); });
  await p10.waitForTimeout(500);
  const firstAt = Math.min(...LOG.map(x=>x.at));
  const vAt = (LOG.find(x=>x.action==='getVerifications')||{}).at;
  const qAt = (LOG.find(x=>x.action==='getQuotes')||{}).at;
  check('驗收管理：驗收資料與訂單資料同時發出（不是一個等一個）',
    vAt!=null && qAt!=null && (vAt-firstAt) < 150 && (qAt-firstAt) < 150);
  check('驗收管理有畫出內容', await p10.evaluate(() => document.getElementById('vm-body').innerHTML.length>50));

  /* ---------- 11. 登入後背景預抓 ---------- */
  const p11 = await browser.newPage();
  p11.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  p11.on('console', m => { if (m.type()==='error' && !isNoise(m.text())) errors.push('CONSOLE: ' + m.text()); });
  await p11.route('**/script.google.com/**', async route => {
    let body={}; try{ body=JSON.parse(route.request().postData()||'{}'); }catch(e){}
    LOG.push({action:body.action, at:Date.now()});
    let payload;
    if (body.action === 'batch') {
      if (BATCH_BROKEN) payload = { ok:false, error:'unknown action: batch' };
      else { (body.calls||[]).forEach(c => SUB.push(c.action)); payload = { ok:true, results:(body.calls||[]).map(c => respond(c.action)) }; }
    } else payload = respond(body.action);
    await route.fulfill({status:200, headers:{'Access-Control-Allow-Origin':'*'}, contentType:'application/json', body:JSON.stringify(payload)});
  });
  await p11.goto('http://localhost:8899/index.html');
  reset();
  await p11.evaluate(async () => {
    document.getElementById('login-overlay').style.display='none';
    AUTH_TOKEN='test-token';
    await initV2();
  });
  check('登入當下不會馬上狂打（只有今日待辦與公司檔）', countOf('getQuotes')===0);
  await p11.waitForTimeout(3200);
  check('2.5 秒後背景預抓：合併成「一個」HTTP 請求', countOf('batch')===1 && countOf('getQuotes')===0);
  check('預抓一次拿到七份資料', ['getQuotes','listCustomQuotes','getOrderStatusList','getVerifications','listVerifyForms','listShipments','getCustomers'].every(a => SUB.includes(a)));
  reset();
  await p11.evaluate(async () => { gotoPage('orders'); await loadOrders(); });
  await p11.waitForTimeout(200);
  check('預抓過後點進訂單追蹤：0 個新請求（秒開）', LOG.length===0);
  check('預抓過後訂單列表直接有資料', await p11.evaluate(() => ORDERS_CACHE && ORDERS_CACHE.length===3));
  check('預抓過後進驗收管理也不用再打', await (async()=>{ reset(); await p11.evaluate(async()=>{ gotoPage('verify'); await loadVerifyMgmt(); }); await p11.waitForTimeout(200); return LOG.length===0; })());

  /* ---------- 13. 後端沒有 batch 時自動退回平行 ---------- */
  const p13 = await newPage();
  BATCH_BROKEN = true;
  reset();
  await p13.evaluate(async () => { rcClear(); await readCallMany(prefetchPayloads()); });
  await p13.waitForTimeout(300);
  check('後端不認得 batch：改用平行、五份資料照樣拿到', countOf('batch')===1 && gotData('getQuotes')===1 && gotData('getVerifications')===1);
  check('後端不認得 batch：資料有進快取', await p13.evaluate(() => Object.keys(RC_STORE).length===7));
  reset();
  await p13.evaluate(async () => { rcClear(); await readCallMany(prefetchPayloads()); });
  await p13.waitForTimeout(300);
  check('試過一次失敗後就不再送 batch', countOf('batch')===0 && gotData('getQuotes')===1);
  BATCH_BROKEN = false;

  /* ---------- 12. 快取不存 token ---------- */
  check('快取內容不含 token', await page.evaluate(() => JSON.stringify(RC_STORE).indexOf('test-token') < 0));
  check('快取 key 不含 token', await page.evaluate(() => Object.keys(RC_STORE).join('|').indexOf('test-token') < 0));

  results.forEach(r => console.log(r[0], r[1]));
  const fails = results.filter(r => r[0]==='FAIL').length;
  console.log(errors.length ? 'JS ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(fails===0 && errors.length===0 ? 'ALL PASS' : `${fails} FAIL`);
  await browser.close();
  process.exit(fails===0 && errors.length===0 ? 0 : 1);
})();
