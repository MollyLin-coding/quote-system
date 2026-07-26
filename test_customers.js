/* 客戶管理離線測試
   ・彙整（歸戶／聯絡資訊取最新／已刪除單不算／自訂單也歸戶／驗收靠單號反查）
   ・統計（成交金額、未收尾款推估、待處理客訴、最後往來日）
   ・畫面（清單列、搜尋、排序、明細四區塊、複製鈕）
   ・效能（有快取時進客戶管理＝0 個後端請求）
   ・選單（出貨驗收在報價單之後、客戶管理在最後） */
const { chromium } = require('/opt/node-tools/node_modules/playwright');

const QUOTES = [
  { quoteNo:'20260701-01', quoteType:'bottle',  clientName:'滿枝枒', contactName:'王小明', contactPhone:'0912-111-111',
    clientTaxId:'12345678', clientAddress:'台中市舊地址', invoiceTitle:'滿枝枒有限公司',
    quoteDate:'2026-07-01', grandTotal:12000, status:'', createdAt:'2026-07-01' },
  { quoteNo:'20260710-01', quoteType:'ownbrand', clientName:'滿枝枒 ', contactName:'王小明', contactPhone:'0912-999-999',
    clientTaxId:'', clientAddress:'台中市新地址', invoiceTitle:'',
    shipContact:'倉庫陳', shipPhone:'04-2222-3333', shipAddress:'台中市倉庫路 1 號',
    quoteDate:'2026-07-10', grandTotal:8000, status:'', createdAt:'2026-07-10' },
  { quoteNo:'20260702-01', quoteType:'banquet', clientName:'有趣市集', contactName:'李小華', contactPhone:'0922-222-222',
    quoteDate:'2026-07-02', grandTotal:16800, status:'', createdAt:'2026-07-02' },
  { quoteNo:'20260703-01', quoteType:'bottle',  clientName:'囍酒工藝', contactName:'', contactPhone:'',
    quoteDate:'2026-07-03', grandTotal:900, status:'', createdAt:'2026-07-03' },
  { quoteNo:'20260704-01', quoteType:'bottle',  clientName:'已刪那張', quoteDate:'2026-07-04', grandTotal:5000,
    status:'已刪除', createdAt:'2026-07-04' },
];
const CUSTOM = [{ quote_no:'C-001', client:'有趣市集', tag:'週年慶', quote_date:'2026-07-20',
  totals_json:JSON.stringify({total:3000}) }];
const ORDER_ST = [
  { quote_no:'20260701-01', status:'shipped',  grand_total:12000, deposit_amt:4000, ship_date_actual:'2026-07-15', final_date_est:'2026-07-20' },
  { quote_no:'20260710-01', status:'closed',   grand_total:8000,  deposit_amt:8000, final_amt:0, final_date:'2026-07-12', closed_at:'2026-07-12' },
  { quote_no:'20260702-01', status:'invoiced', grand_total:16800, deposit_amt:6800, final_amt:10000, invoice_no:'AB-123' },
  { quote_no:'20260703-01', status:'cancelled', grand_total:900 },
];
const VERIF = [
  { id:'V1', created_at:'2026-07-16', no:'20260701-01', lot:'31', client:'滿枝枒', type:'回報問題',
    desc:'瓶身有刮傷', status:'待處理', photos:'' },
  { id:'V2', created_at:'2026-07-17', no:'20260702-01', lot:'', client:'', type:'驗收無誤', desc:'', status:'' },
];
const FORMS = [{ id:'F1', created_at:'2026-07-15', no:'20260701-01', lot:'31', ship_date:'2026-07-15', items:[] }];

function respond(action){
  switch(action){
    case 'getQuotes':          return { ok:true, quotes:QUOTES };
    case 'listCustomQuotes':   return { ok:true, quotes:CUSTOM };
    case 'getOrderStatusList': return { ok:true, orders:ORDER_ST };
    case 'getVerifications':   return { ok:true, records:VERIF, summary:{} };
    case 'listVerifyForms':    return { ok:true, records:FORMS, summary:{'20260701-01':{count:1}} };
    case 'listShipments':      return { ok:true, shipments:[] };
    case 'listCalendarItems':  return { ok:true, items:[] };
    case 'getCompanyData':     return { ok:true, companies:[], products:[], rules:[] };
    case 'getOwnbrandProducts':return { ok:true, products:[] };
    case 'getOwnbrandTiers':   return { ok:true, tiers:[], terms:{} };
    case 'getTodayDigest':     return { ok:true, today:'2026-07-26', ship_due:[], final_due:[], no_scan:[], no_invoice:[], calendar:[], warnings:[] };
    case 'getQuoteById':       return { ok:true, quote:QUOTES[0], items:[] };
    default:                   return { ok:true };
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errors = [], results = [];
  const check = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);
  const isNoise = t => /Failed to load resource|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|favicon/i.test(t);

  let LOG = [], SUB = [];
  const reset = () => { LOG = []; SUB = []; };

  const page = await browser.newPage();
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('CONSOLE: ' + m.text()); });
  await page.route('**/script.google.com/**', async route => {
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
    LOG.push(body.action);
    let payload;
    if (body.action === 'batch') {
      (body.calls || []).forEach(c => SUB.push(c.action));
      payload = { ok:true, results:(body.calls||[]).map(c => respond(c.action)) };
    } else payload = respond(body.action);
    await route.fulfill({ status:200, headers:{'Access-Control-Allow-Origin':'*'},
      contentType:'application/json', body:JSON.stringify(payload) });
  });
  await page.goto('http://localhost:8899/index.html');
  await page.evaluate(() => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 'test-token';
    PREFETCH_DONE = true;
  });

  /* ---------- 1. 側邊選單順序 ---------- */
  const navOrder = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.sb-nav .nb:not(.nb-sub)')).map(b => b.id));
  check('選單有「客戶管理」', navOrder.includes('nav-customer'));
  check('出貨驗收排在報價單之後', navOrder.indexOf('nav-verify') > navOrder.indexOf('nav-quote'));
  check('客戶管理排在最後一個', navOrder[navOrder.length - 1] === 'nav-customer');
  check('寄售管理仍在報價單之前', navOrder.indexOf('nav-consign') < navOrder.indexOf('nav-quote'));

  /* ---------- 2. 切頁與標題 ---------- */
  await page.evaluate(() => gotoPage('customer'));
  await page.waitForTimeout(600);
  check('page-customer 顯示', await page.evaluate(() => document.getElementById('page-customer').classList.contains('on')));
  check('nav-customer 高亮', await page.evaluate(() => document.getElementById('nav-customer').classList.contains('on')));
  check('標題改為客戶管理', await page.evaluate(() => document.getElementById('tb-title').textContent === '客戶管理'));
  check('客戶管理頁不顯示報價單工具列', await page.evaluate(() => document.getElementById('tbr-standard').style.display === 'none'));
  check('報價單父項不被標記使用中', await page.evaluate(() => !document.getElementById('nav-quote').classList.contains('parent-active')));

  /* ---------- 3. 歸戶正確性 ---------- */
  const D = await page.evaluate(() => CUS_DATA.map(c => ({
    key:c.key, name:c.name, count:c.count, dealCount:c.dealCount, dealSum:c.dealSum, unpaid:c.unpaid,
    lastDate:c.lastDate, pending:c.pending, contact:c.contact, phone:c.phone, taxId:c.taxId,
    address:c.address, invoiceTitle:c.invoiceTitle, shipAddress:c.shipAddress,
    reports:c.reports.length, forms:c.forms.length, open:c.openList.length,
    nos:c.quotes.map(q => q.no)
  })));
  const byName = n => D.find(c => c.name === n);
  check('客戶數＝3（已刪除那張不算、名稱前後空白視為同一人）', D.length === 3);
  check('「滿枝枒」兩張單歸成一戶', byName('滿枝枒') && byName('滿枝枒').count === 2);
  check('已刪除的單不建出客戶', !D.some(c => c.name === '已刪那張'));
  check('自訂單也歸到同一個客戶', byName('有趣市集') && byName('有趣市集').nos.includes('C-001'));
  check('自訂單客戶筆數＝2', byName('有趣市集') && byName('有趣市集').count === 2);

  /* ---------- 4. 聯絡資訊取最近一張單 ---------- */
  const mz = byName('滿枝枒');
  check('電話取最新那張（0912-999-999）', mz.phone === '0912-999-999');
  check('地址取最新那張', mz.address === '台中市新地址');
  check('新單沒填的統編沿用舊單（不會被清空）', mz.taxId === '12345678');
  check('新單沒填的發票抬頭沿用舊單', mz.invoiceTitle === '滿枝枒有限公司');
  check('出貨地址讀得到', mz.shipAddress === '台中市倉庫路 1 號');

  /* ---------- 5. 統計 ---------- */
  check('滿枝枒成交 2 筆（shipped＋closed）', mz.dealCount === 2);
  check('滿枝枒成交金額＝20000', mz.dealSum === 20000);
  check('滿枝枒未收尾款＝12000-4000＝8000（推估）', mz.unpaid === 8000);
  check('滿枝枒最後往來日＝2026-07-10', mz.lastDate === '2026-07-10');
  check('滿枝枒待處理客訴＝1', mz.pending === 1);
  check('滿枝枒驗收單留底＝1 張', mz.forms === 1);
  check('已結案的單不列進「進行中訂單」', mz.open === 1);
  const yq = byName('有趣市集');
  check('有趣市集未收尾款用實填金額 10000（不推估）', yq.unpaid === 10000);
  check('驗收紀錄客戶欄空白時靠單號反查歸戶', yq.reports === 1);
  check('有趣市集最後往來日吃自訂單日期 2026-07-20', yq.lastDate === '2026-07-20');
  const xj = byName('囍酒工藝');
  check('已取消的單不算成交', xj.dealCount === 0 && xj.dealSum === 0);
  check('已取消的單不算未收款', xj.unpaid === 0);
  check('已取消的單不列進行中訂單', xj.open === 0);

  /* ---------- 6. 清單畫面 ---------- */
  const rowCount = async () => page.evaluate(() =>
    document.querySelectorAll('#cus-body tr').length);
  check('清單畫出 3 列', await rowCount() === 3);
  check('上方統計：客戶數 3 位', await page.evaluate(() => document.getElementById('cus-stats').textContent.includes('3 位')));
  check('上方統計：未收尾款 18000', await page.evaluate(() => document.getElementById('cus-stats').textContent.includes('$18,000')));
  check('上方統計：待處理客訴 1 件', await page.evaluate(() => document.getElementById('cus-stats').textContent.includes('1 件')));
  check('清單有客訴徽章', await page.evaluate(() => document.getElementById('cus-body').innerHTML.includes('客訴 1')));

  /* ---------- 7. 搜尋 ---------- */
  await page.evaluate(() => { document.getElementById('cus-search').value = '0922'; cusOnSearch(); });
  check('用電話搜尋只剩 1 列', await rowCount() === 1);
  check('用電話搜尋找到有趣市集', await page.evaluate(() => document.getElementById('cus-body').textContent.includes('有趣市集')));
  await page.evaluate(() => { document.getElementById('cus-search').value = '20260710'; cusOnSearch(); });
  check('用單號也搜得到客戶', await page.evaluate(() => document.getElementById('cus-body').textContent.includes('滿枝枒')));
  await page.evaluate(() => { document.getElementById('cus-search').value = '不存在的客戶'; cusOnSearch(); });
  check('搜不到時顯示提示而不是空白', await page.evaluate(() => document.getElementById('cus-body').textContent.includes('沒有符合條件')));
  await page.evaluate(() => { document.getElementById('cus-search').value = ''; cusOnSearch(); });
  check('清空搜尋恢復 3 列', await rowCount() === 3);

  /* ---------- 8. 排序 ---------- */
  const firstName = () => page.evaluate(() => document.querySelector('#cus-body tr td').textContent.trim());
  check('預設按最後往來日：有趣市集(7/20)在最前', (await firstName()).startsWith('有趣市集'));
  await page.evaluate(() => { document.getElementById('cus-sort').value = 'amount'; cusOnSort(); });
  check('改成交金額排序：滿枝枒(20000)在最前', (await firstName()).startsWith('滿枝枒'));
  await page.evaluate(() => { document.getElementById('cus-sort').value = 'unpaid'; cusOnSort(); });
  check('改未收尾款排序：有趣市集(10000)在最前', (await firstName()).startsWith('有趣市集'));
  await page.evaluate(() => { document.getElementById('cus-sort').value = 'last'; cusOnSort(); });

  /* ---------- 9. 明細 ---------- */
  await page.evaluate(() => cusOpen(CUS_DATA.find(c => c.name === '滿枝枒').key));
  await page.waitForTimeout(120);
  const det = () => page.evaluate(() => document.getElementById('cus-detail').textContent);
  const detHtml = () => page.evaluate(() => document.getElementById('cus-detail').innerHTML);
  check('明細打開了', (await det()).includes('滿枝枒'));
  check('明細有四個區塊', await (async () => { const t = await det();
    return ['聯絡資訊','往來報價單','進行中訂單與未收款','驗收 / 客訴紀錄'].every(s => t.includes(s)); })());
  check('明細顯示電話（最新那張）', (await det()).includes('0912-999-999'));
  check('明細顯示統編', (await det()).includes('12345678'));
  check('明細列出兩張報價單', await page.evaluate(() =>
    ['20260701-01','20260710-01'].every(n => document.getElementById('cus-detail').textContent.includes(n))));
  check('明細顯示進度中文（已出貨）', (await det()).includes('已出貨'));
  check('明細未收尾款標「推估」', (await det()).includes('推估'));
  check('明細顯示客訴內容', (await det()).includes('瓶身有刮傷'));
  check('明細顯示驗收單留底張數', (await det()).includes('驗收單留底 1 張'));
  check('明細有複製鈕', (await detHtml()).includes('cusCopy('));
  check('明細有「用這客戶開新報價單」', (await det()).includes('用這客戶開新報價單'));
  check('被選到的列有標記', await page.evaluate(() => !!document.querySelector('#cus-body tr.cus-on')));

  /* 沒有進行中訂單 / 沒有客訴的客戶 → 顯示空狀態而不是壞掉 */
  await page.evaluate(() => cusOpen(CUS_DATA.find(c => c.name === '囍酒工藝').key));
  await page.waitForTimeout(120);
  check('無進行中訂單顯示空狀態', (await det()).includes('沒有進行中的訂單'));
  check('無客訴顯示空狀態', (await det()).includes('尚無回報紀錄'));
  await page.evaluate(() => cusCloseDetail());
  check('收起後明細清空', await page.evaluate(() => document.getElementById('cus-detail').innerHTML === ''));

  /* ---------- 10. 快取：切走再回來不打後端 ---------- */
  await page.evaluate(async () => { gotoPage('orders'); await loadOrders(); });
  await page.waitForTimeout(400);
  reset();
  await page.evaluate(async () => { gotoPage('customer'); await loadCustomers(); });
  await page.waitForTimeout(200);
  check('已有快取時進客戶管理：0 個後端請求', LOG.length === 0);
  check('客戶資料仍在', await page.evaluate(() => CUS_DATA && CUS_DATA.length === 3));

  /* ---------- 11. 寫入動作清快取後會重算 ---------- */
  reset();
  await page.evaluate(async () => { await apiCall({ action:'updateOrderStatus', token:AUTH_TOKEN, quote_no:'X' }); });
  check('寫入動作把客戶資料歸零', await page.evaluate(() => CUS_DATA === null));
  reset();
  await page.evaluate(async () => { await loadCustomers(); });
  await page.waitForTimeout(300);
  check('重新載入用一個 batch 拿五份', LOG.filter(a => a === 'batch').length === 1 &&
    ['getQuotes','listCustomQuotes','getOrderStatusList','getVerifications','listVerifyForms'].every(a => SUB.includes(a)));
  check('重算後客戶數仍為 3', await page.evaluate(() => CUS_DATA.length === 3));

  /* ---------- 12. 帶客戶資料開新報價單 ---------- */
  await page.evaluate(() => { window.confirm = () => true; });
  await page.evaluate(() => cusNewQuote(CUS_DATA.find(c => c.name === '滿枝枒').key));
  await page.waitForTimeout(200);
  check('開新單後跳到報價單填寫頁', await page.evaluate(() => document.getElementById('page-new').classList.contains('on')));
  check('客戶名稱帶入', await page.evaluate(() => document.getElementById('f-cli').value === '滿枝枒'));
  check('聯絡人帶入', await page.evaluate(() => document.getElementById('f-con').value === '王小明'));
  check('電話帶入最新那組', await page.evaluate(() => document.getElementById('f-ph').value === '0912-999-999'));
  check('統編帶入', await page.evaluate(() => document.getElementById('f-tax').value === '12345678'));
  check('有出貨資料時自動取消「與聯絡人相同」', await page.evaluate(() => document.getElementById('f-shipsame').checked === false));
  check('出貨地址帶入', await page.evaluate(() => document.getElementById('f-shipad').value === '台中市倉庫路 1 號'));
  check('品項是乾淨的空白列（沒有殘留金額）', await page.evaluate(() =>
    botItems.length === 1 && (parseFloat(document.getElementById('t-tot').textContent.replace(/[$,]/g,'')) || 0) === 0));

  /* ---------- 13. 後端讀取失敗不會白頁 ---------- */
  const p2 = await browser.newPage();
  p2.on('pageerror', e => errors.push('PAGEERROR(p2): ' + e.message));
  await p2.route('**/script.google.com/**', route => route.fulfill({ status:200,
    headers:{'Access-Control-Allow-Origin':'*'}, contentType:'application/json',
    body:JSON.stringify({ ok:false, error:'後端壞掉了' }) }));
  await p2.goto('http://localhost:8899/index.html');
  await p2.evaluate(() => { document.getElementById('login-overlay').style.display='none'; AUTH_TOKEN='t'; PREFETCH_DONE=true; });
  await p2.evaluate(async () => { gotoPage('customer'); await loadCustomers(); });
  await p2.waitForTimeout(200);
  check('後端回失敗時顯示空狀態、不炸掉', await p2.evaluate(() =>
    document.getElementById('cus-body').textContent.includes('尚無客戶資料')));

  console.log('\n=== 測試結果 ===');
  results.forEach(r => console.log(r[0], r[1]));
  const fails = results.filter(r => r[0] === 'FAIL').length;
  console.log(`\n共 ${results.length} 項，${fails} 項失敗`);
  console.log(errors.length ? 'JS ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  await browser.close();
  process.exit(fails === 0 && errors.length === 0 ? 0 : 1);
})();
