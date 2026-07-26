/* 客戶主檔（後端 v40）前端離線測試
   ・主檔優先合併（主檔有填蓋掉報價單推算、主檔沒填用報價單補）
   ・主檔有、沒開過單的客戶也要出現
   ・新增／編輯／停用（送出的 payload 內容）
   ・從報價單匯入
   ・報價單填寫頁「選既有客戶」下拉帶入
   ・存單後主檔比對提醒（差異列、勾選、建新客戶）
   用 Playwright 攔真正的 fetch，並記錄每個寫入 action 的 payload。 */
const { chromium } = require('/opt/node-tools/node_modules/playwright');

const QUOTES = [
  { quoteNo:'20260701-01', quoteType:'bottle', clientName:'滿枝枒', contactName:'王小明', contactPhone:'0912-111-111',
    clientTaxId:'12345678', clientAddress:'台中市舊地址', invoiceTitle:'滿枝枒有限公司',
    quoteDate:'2026-07-01', grandTotal:12000, status:'', createdAt:'2026-07-01' },
  { quoteNo:'20260702-01', quoteType:'banquet', clientName:'有趣市集', contactName:'李小華', contactPhone:'0922-222-222',
    quoteDate:'2026-07-02', grandTotal:16800, status:'', createdAt:'2026-07-02' },
];
/* 主檔：滿枝枒有填新電話與標籤備註（要蓋掉報價單那組）；地址空白（要用報價單補）；
   「新朋友酒吧」還沒開過單，但主檔有 → 清單也要看得到 */
let CUSTOMERS = [
  { customer_id:'CU-001', name:'滿枝枒', contact:'王大明', phone:'0912-000-000', email:'mz@example.com',
    tax_id:'12345678', invoice_title:'', address:'', ship_contact:'', ship_phone:'', ship_address:'',
    pay_habit:'30/70', tags:'通路,婚宴', note:'開發票前先確認抬頭', active:'Y' },
  { customer_id:'CU-002', name:'新朋友酒吧', contact:'陳老闆', phone:'0933-333-333', email:'', tax_id:'',
    invoice_title:'', address:'台北市新生南路', ship_contact:'', ship_phone:'', ship_address:'',
    pay_habit:'', tags:'餐廳', note:'', active:'Y' },
];

function respond(action, body){
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
    case 'getTodayDigest':     return { ok:true, today:'2026-07-26', ship_due:[], final_due:[], no_scan:[], no_invoice:[], calendar:[], warnings:[] };
    case 'getCustomers':       return { ok:true, customers:CUSTOMERS.filter(c=>String(c.active).toUpperCase()!=='N') };
    case 'saveCustomer': {
      const c = body.customer || {};
      let row = c.customer_id ? CUSTOMERS.find(x=>x.customer_id===c.customer_id) : null;
      if(!row) row = CUSTOMERS.find(x=>String(x.name).replace(/\s/g,'')===String(c.name||'').replace(/\s/g,''));
      if(!row){ row={ customer_id:'CU-NEW', name:'', active:'Y' }; CUSTOMERS.push(row); }
      Object.keys(c).forEach(k=>{ if(k!=='customer_id') row[k]=c[k]; });
      return { ok:true, customer:row };
    }
    case 'deleteCustomer': {
      const row = CUSTOMERS.find(x=>x.customer_id===body.customer_id);
      if(row) row.active='N';
      return { ok:true, deleted:'soft' };
    }
    case 'seedCustomersFromQuotes': {
      CUSTOMERS.push({ customer_id:'CU-003', name:'有趣市集', contact:'李小華', phone:'0922-222-222',
        email:'', tax_id:'', invoice_title:'', address:'', ship_contact:'', ship_phone:'', ship_address:'',
        pay_habit:'', tags:'', note:'（由既有報價單自動建立）', active:'Y' });
      return { ok:true, added:1, skipped:2, names:['有趣市集'] };
    }
    case 'createQuote':        return { ok:true, quoteNo:'20260726-01' };
    case 'updateQuote':        return { ok:true, quoteNo:'20260701-01' };
    case 'getQuoteById':       return { ok:true, quote:QUOTES[0], items:[] };
    default:                   return { ok:true };
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errors = [], results = [];
  const check = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);
  const isNoise = t => /Failed to load resource|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|favicon/i.test(t);

  let LOG = [], SUB = [], SENT = [];
  const reset = () => { LOG = []; SUB = []; SENT = []; };
  const sentOf = a => SENT.filter(x => x.action === a);

  const page = await browser.newPage();
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('CONSOLE: ' + m.text()); });
  await page.route('**/script.google.com/**', async route => {
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
    LOG.push(body.action); SENT.push(body);
    let payload;
    if (body.action === 'batch') {
      (body.calls || []).forEach(c => SUB.push(c.action));
      payload = { ok:true, results:(body.calls||[]).map(c => respond(c.action, c)) };
    } else payload = respond(body.action, body);
    await route.fulfill({ status:200, headers:{'Access-Control-Allow-Origin':'*'},
      contentType:'application/json', body:JSON.stringify(payload) });
  });
  await page.goto('http://localhost:8899/index.html');
  await page.evaluate(() => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 'test-token';
    PREFETCH_DONE = true;
    window.confirm = () => true;
  });

  /* ---------- 1. 主檔優先合併 ---------- */
  await page.evaluate(() => gotoPage('customer'));
  await page.waitForTimeout(700);
  const D = () => page.evaluate(() => CUS_DATA.map(c => ({
    name:c.name, hasMaster:!!c.master, id:c.id, contact:c.contact, phone:c.phone, email:c.email,
    taxId:c.taxId, invoiceTitle:c.invoiceTitle, address:c.address, payHabit:c.payHabit,
    tags:c.tags, note:c.note, count:c.count })));
  let d = await D();
  const by = n => d.find(c => c.name === n);
  check('客戶數＝3（兩位有開單＋一位只有主檔）', d.length === 3);
  check('主檔的電話蓋掉報價單那組', by('滿枝枒').phone === '0912-000-000');
  check('主檔的聯絡人蓋掉報價單那組', by('滿枝枒').contact === '王大明');
  check('主檔沒填的地址用報價單補', by('滿枝枒').address === '台中市舊地址');
  check('主檔沒填的發票抬頭用報價單補', by('滿枝枒').invoiceTitle === '滿枝枒有限公司');
  check('主檔專屬欄位讀得到（Email）', by('滿枝枒').email === 'mz@example.com');
  check('主檔專屬欄位讀得到（付款習慣）', by('滿枝枒').payHabit === '30/70');
  check('主檔專屬欄位讀得到（標籤）', by('滿枝枒').tags === '通路,婚宴');
  check('主檔專屬欄位讀得到（備註）', by('滿枝枒').note === '開發票前先確認抬頭');
  check('有主檔的客戶標記 hasMaster', by('滿枝枒').hasMaster === true && by('滿枝枒').id === 'CU-001');
  check('沒主檔的客戶 hasMaster＝false', by('有趣市集').hasMaster === false);
  check('只有主檔、沒開過單的客戶也在清單', !!by('新朋友酒吧') && by('新朋友酒吧').count === 0);
  check('清單顯示「未建主檔」提示', await page.evaluate(() => document.getElementById('cus-body').innerHTML.includes('未建主檔')));
  check('清單顯示標籤徽章', await page.evaluate(() => document.getElementById('cus-body').innerHTML.includes('cus-tag')));
  check('清單筆數：有主檔的兩位不會重複出現', await page.evaluate(() => document.querySelectorAll('#cus-body tr').length === 3));
  check('可以用標籤搜尋', await page.evaluate(() => { document.getElementById('cus-search').value='餐廳'; cusOnSearch();
    return document.getElementById('cus-body').textContent.includes('新朋友酒吧') && document.querySelectorAll('#cus-body tr').length===1; }));
  check('可以用備註搜尋', await page.evaluate(() => { document.getElementById('cus-search').value='抬頭'; cusOnSearch();
    return document.getElementById('cus-body').textContent.includes('滿枝枒'); }));
  await page.evaluate(() => { document.getElementById('cus-search').value=''; cusOnSearch(); });

  /* ---------- 2. 明細顯示主檔欄位 ---------- */
  await page.evaluate(() => cusOpen(cusKey('滿枝枒')));
  await page.waitForTimeout(150);
  const det = () => page.evaluate(() => document.getElementById('cus-detail').textContent);
  check('明細顯示 Email', (await det()).includes('mz@example.com'));
  check('明細顯示付款習慣', (await det()).includes('30/70'));
  check('明細顯示備註內容', (await det()).includes('開發票前先確認抬頭'));
  check('明細鈕寫「編輯客戶資料」', (await det()).includes('編輯客戶資料'));
  check('明細說明以主檔為準', (await det()).includes('以客戶主檔為準'));
  await page.evaluate(() => cusOpen(cusKey('有趣市集')));
  await page.waitForTimeout(120);
  check('沒主檔的客戶鈕寫「建立客戶主檔」', (await det()).includes('建立客戶主檔'));
  await page.evaluate(() => cusCloseDetail());

  /* ---------- 3. 編輯既有客戶 ---------- */
  await page.evaluate(() => openCusEdit(cusKey('滿枝枒')));
  await page.waitForTimeout(150);
  check('編輯視窗打開', await page.evaluate(() => document.getElementById('cus-edit-overlay').style.display === 'flex'));
  check('標題帶客戶名稱', await page.evaluate(() => document.getElementById('cus-edit-title').textContent.includes('滿枝枒')));
  check('編輯時帶入 customer_id', await page.evaluate(() => document.getElementById('cus-f-id').value === 'CU-001'));
  check('表單帶入主檔電話', await page.evaluate(() => document.getElementById('cus-f-phone').value === '0912-000-000'));
  check('表單帶入主檔備註', await page.evaluate(() => document.getElementById('cus-f-note').value === '開發票前先確認抬頭'));
  check('表單帶入報價單補的地址', await page.evaluate(() => document.getElementById('cus-f-addr').value === '台中市舊地址'));
  check('有主檔才顯示停用鈕', await page.evaluate(() => document.getElementById('cus-f-del').style.display !== 'none'));
  reset();
  await page.evaluate(async () => { document.getElementById('cus-f-phone').value='0912-777-777';
    document.getElementById('cus-f-tags').value='通路'; await saveCusEdit(); });
  await page.waitForTimeout(600);
  const sc = sentOf('saveCustomer')[0];
  check('儲存送出 saveCustomer', !!sc);
  check('送出帶 customer_id（不會變成新客戶）', sc && sc.customer.customer_id === 'CU-001');
  check('送出改過的電話', sc && sc.customer.phone === '0912-777-777');
  check('送出改過的標籤', sc && sc.customer.tags === '通路');
  check('儲存後視窗關閉', await page.evaluate(() => document.getElementById('cus-edit-overlay').style.display === 'none'));
  check('儲存後重抓資料（有 batch 或 getCustomers）', LOG.includes('batch') || LOG.includes('getCustomers'));
  check('儲存後畫面吃到新電話', await page.evaluate(() => CUS_DATA.find(c=>c.name==='滿枝枒').phone === '0912-777-777'));

  /* ---------- 4. 新增客戶 ---------- */
  await page.evaluate(() => openCusEdit(''));
  await page.waitForTimeout(120);
  check('新增時 customer_id 空白', await page.evaluate(() => document.getElementById('cus-f-id').value === ''));
  check('新增時不顯示停用鈕', await page.evaluate(() => document.getElementById('cus-f-del').style.display === 'none'));
  check('新增時表單是空的', await page.evaluate(() => document.getElementById('cus-f-name').value === ''));
  reset();
  await page.evaluate(async () => { await saveCusEdit(); });
  await page.waitForTimeout(200);
  check('沒填名稱不會送出', sentOf('saveCustomer').length === 0);
  reset();
  await page.evaluate(async () => {
    document.getElementById('cus-f-name').value='丙丁酒館';
    document.getElementById('cus-f-contact').value='丙先生';
    document.getElementById('cus-f-pay').value='月結15日';
    await saveCusEdit();
  });
  await page.waitForTimeout(600);
  const sc2 = sentOf('saveCustomer')[0];
  check('新增送出沒有 customer_id', sc2 && sc2.customer.customer_id === undefined);
  check('新增送出名稱與付款習慣', sc2 && sc2.customer.name === '丙丁酒館' && sc2.customer.pay_habit === '月結15日');
  check('新增後清單多一位', await page.evaluate(() => CUS_DATA.length === 4));
  check('新增後自動展開那位的明細', await page.evaluate(() => document.getElementById('cus-detail').textContent.includes('丙丁酒館')));

  /* ---------- 5. 停用 ---------- */
  await page.evaluate(() => openCusEdit(cusKey('新朋友酒吧')));
  await page.waitForTimeout(120);
  reset();
  await page.evaluate(async () => { await deleteCusEdit(); });
  await page.waitForTimeout(600);
  const dc = sentOf('deleteCustomer')[0];
  check('停用送出 deleteCustomer 帶 id', dc && dc.customer_id === 'CU-002');
  check('停用後清單少一位', await page.evaluate(() => !CUS_DATA.some(c => c.name === '新朋友酒吧')));

  /* ---------- 6. 從報價單匯入 ---------- */
  reset();
  await page.evaluate(async () => { await cusSeedFromQuotes(); });
  await page.waitForTimeout(700);
  check('送出 seedCustomersFromQuotes', sentOf('seedCustomersFromQuotes').length === 1);
  check('匯入後「有趣市集」變成有主檔', await page.evaluate(() => !!CUS_DATA.find(c=>c.name==='有趣市集').master));
  check('匯入後清單不會多出重複的客戶', await page.evaluate(() =>
    CUS_DATA.filter(c=>c.name==='有趣市集').length === 1));

  /* ---------- 7. 報價單填寫頁的選客戶下拉 ---------- */
  await page.evaluate(() => gotoPage('new'));
  await page.waitForTimeout(300);
  const opts = await page.evaluate(() => Array.from(document.getElementById('f-cuspick').options).map(o => o.value + '|' + o.textContent));
  check('下拉有主檔客戶（滿枝枒）', opts.some(o => o.includes('滿枝枒')));
  check('下拉有新增的客戶（丙丁酒館）', opts.some(o => o.includes('丙丁酒館')));
  check('下拉沒有已停用的客戶', !opts.some(o => o.includes('新朋友酒吧')));
  check('下拉第一項是不帶入', opts[0].startsWith('|'));
  await page.evaluate(() => { document.getElementById('f-cuspick').value='CU-001'; pickQuoteCustomer(); });
  await page.waitForTimeout(150);
  check('選客戶帶入名稱', await page.evaluate(() => document.getElementById('f-cli').value === '滿枝枒'));
  check('選客戶帶入主檔電話', await page.evaluate(() => document.getElementById('f-ph').value === '0912-777-777'));
  check('選客戶帶入聯絡人', await page.evaluate(() => document.getElementById('f-con').value === '王大明'));
  check('選客戶帶入統編', await page.evaluate(() => document.getElementById('f-tax').value === '12345678'));
  check('單號跟著客戶名稱更新', await page.evaluate(() => document.getElementById('f-no').value.length > 0));
  check('選客戶不會送任何後端請求', await (async()=>{ reset();
    await page.evaluate(() => { document.getElementById('f-cuspick').value='CU-001'; pickQuoteCustomer(); });
    await page.waitForTimeout(150); return LOG.length === 0; })());
  await page.evaluate(() => { newQuote(); });
  await page.waitForTimeout(200);
  check('開新單後下拉歸零', await page.evaluate(() => document.getElementById('f-cuspick').value === ''));

  /* ---------- 8. 存單後主檔比對提醒 ---------- */
  reset();
  await page.evaluate(() => cusSyncPrompt({ clientName:'滿枝枒', contactPhone:'0912-777-777', contactName:'王大明' }));
  await page.waitForTimeout(120);
  check('資料一樣時不會跳提醒', await page.evaluate(() => document.getElementById('cus-sync-overlay').style.display !== 'flex'));
  await page.evaluate(() => cusSyncPrompt({ clientName:'滿枝枒', contactPhone:'0999-888-777', clientAddress:'台中市新地址' }));
  await page.waitForTimeout(120);
  check('資料不同才跳提醒', await page.evaluate(() => document.getElementById('cus-sync-overlay').style.display === 'flex'));
  const diffTxt = await page.evaluate(() => document.getElementById('cus-sync-diff').textContent);
  check('提醒列出電話的新舊值', diffTxt.includes('0912-777-777') && diffTxt.includes('0999-888-777'));
  check('提醒列出地址差異', diffTxt.includes('台中市新地址'));
  check('沒改的欄位不列進差異', !diffTxt.includes('王大明'));
  check('差異預設全部勾選', await page.evaluate(() =>
    Array.from(document.querySelectorAll('#cus-sync-diff input')).every(i => i.checked)));
  /* 取消勾選地址 → 只更新電話 */
  reset();
  await page.evaluate(async () => {
    const boxes = document.querySelectorAll('#cus-sync-diff input');
    boxes[1].checked = false;
    await applyCusSync();
  });
  await page.waitForTimeout(500);
  const sc3 = sentOf('saveCustomer')[0];
  check('更新主檔只送勾選的欄位', sc3 && sc3.customer.phone === '0999-888-777' && sc3.customer.address === undefined);
  check('更新主檔帶 customer_id', sc3 && sc3.customer.customer_id === 'CU-001');
  check('更新後提醒關閉', await page.evaluate(() => document.getElementById('cus-sync-overlay').style.display === 'none'));

  /* 全新客戶：提醒改成「建進主檔」 */
  await page.evaluate(() => cusSyncPrompt({ clientName:'路過酒吧', contactName:'路先生', contactPhone:'0955-000-111' }));
  await page.waitForTimeout(150);
  check('主檔沒有的客戶也會提醒', await page.evaluate(() => document.getElementById('cus-sync-overlay').style.display === 'flex'));
  check('提醒文字改成「主檔還沒有的客戶」', await page.evaluate(() =>
    document.querySelector('#cus-sync-overlay .v2h span').textContent.includes('還沒有')));
  reset();
  await page.evaluate(async () => { await applyCusSync(); });
  await page.waitForTimeout(500);
  const sc4 = sentOf('saveCustomer')[0];
  check('建新客戶送出名稱與欄位', sc4 && sc4.customer.name === '路過酒吧' && sc4.customer.contact === '路先生');
  check('建新客戶不帶 customer_id', sc4 && sc4.customer.customer_id === undefined);
  await page.evaluate(() => closeCusSync());
  check('客戶名稱空白不會跳提醒', await page.evaluate(() => {
    cusSyncPrompt({ clientName:'', contactPhone:'09' });
    return document.getElementById('cus-sync-overlay').style.display !== 'flex'; }));

  /* ---------- 9. 存報價單會觸發提醒（掛勾接上了）---------- */
  await page.evaluate(() => { gotoPage('new'); document.getElementById('f-cli').value='滿枝枒';
    document.getElementById('f-ph').value='0911-555-666'; });
  reset();
  await page.evaluate(async () => { await saveQuote(); });
  await page.waitForTimeout(800);
  check('存單有送 createQuote', LOG.includes('createQuote') || LOG.includes('updateQuote'));
  check('存單後自動跳出主檔比對提醒', await page.evaluate(() => document.getElementById('cus-sync-overlay').style.display === 'flex'));
  check('提醒內容是這張單填的新電話', await page.evaluate(() =>
    document.getElementById('cus-sync-diff').textContent.includes('0911-555-666')));
  await page.evaluate(() => closeCusSync());
  check('按「這次不用」不會送 saveCustomer', sentOf('saveCustomer').length === 0);

  /* ---------- 10. 後端還沒有客戶主檔（舊版）也不能壞 ---------- */
  const p2 = await browser.newPage();
  p2.on('pageerror', e => errors.push('PAGEERROR(p2): ' + e.message));
  await p2.route('**/script.google.com/**', async route => {
    let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
    const bad = a => a === 'getCustomers' ? { ok:false, error:'Unknown action: getCustomers' } : respond(a, body);
    let payload = body.action === 'batch'
      ? { ok:true, results:(body.calls||[]).map(c => bad(c.action)) }
      : bad(body.action);
    await route.fulfill({ status:200, headers:{'Access-Control-Allow-Origin':'*'},
      contentType:'application/json', body:JSON.stringify(payload) });
  });
  await p2.goto('http://localhost:8899/index.html');
  await p2.evaluate(() => { document.getElementById('login-overlay').style.display='none'; AUTH_TOKEN='t'; PREFETCH_DONE=true; });
  await p2.evaluate(async () => { gotoPage('customer'); await loadCustomers(); });
  await p2.waitForTimeout(400);
  check('後端不認得 getCustomers 時客戶頁照樣有資料', await p2.evaluate(() => CUS_DATA && CUS_DATA.length === 2));
  check('後端不認得 getCustomers 時全部顯示未建主檔', await p2.evaluate(() => CUS_DATA.every(c => !c.master)));
  await p2.evaluate(async () => { gotoPage('new'); await cusEnsureMaster(); });
  await p2.waitForTimeout(200);
  check('後端不認得 getCustomers 時下拉只有「不帶入」', await p2.evaluate(() =>
    document.getElementById('f-cuspick').options.length <= 2));

  console.log('\n=== 測試結果 ===');
  results.forEach(r => console.log(r[0], r[1]));
  const fails = results.filter(r => r[0] === 'FAIL').length;
  console.log(`\n共 ${results.length} 項，${fails} 項失敗`);
  console.log(errors.length ? 'JS ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  await browser.close();
  process.exit(fails === 0 && errors.length === 0 ? 0 : 1);
})();
