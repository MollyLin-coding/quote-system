/* 2026-08-28：一次性採購 MOQ 級距每張單可調 ＋ 開放客戶寄倉 離線測試
   ・級距編輯欄：預設帶標準級距（200/500/1000＝6/5.5/5 折）、改門檻自動重套折、還原標準
   ・未達本單最低門檻 → ob-moqwarn 提醒（不擋單）
   ・存檔：自訂級距＋寄倉勾選存進 docopts 特殊列；全預設不多存
   ・載入：moqTiers／storage／storageTerms 還原；清除回預設
   ・預覽：勾寄倉 → 印「寄倉條款」；代工/一次性採購/客製標都可勾（8/28 下午擴充），宴會/寄售不適用
   ・寄倉管理卡片：彙總（入倉−提領＝剩餘）、登記入倉/提領打 addStorageMove、提領超量前端就擋 */
const { chromium } = require('/opt/node-tools/node_modules/playwright');

const STORAGE_MOVES = [
  { move_id:'ST20260820-01', date:'2026-08-20', customer:'甲公司', sku_id:'OB001', name:'琥珀琴酒', volume:'500ml', direction:'in',  qty:300, quote_no:'Q1', note:'', operator:'Molly', created_at:'' },
  { move_id:'ST20260821-01', date:'2026-08-21', customer:'甲公司', sku_id:'OB001', name:'琥珀琴酒', volume:'500ml', direction:'out', qty:80,  quote_no:'',   note:'第一批', operator:'Molly', created_at:'' },
  { move_id:'ST20260822-01', date:'2026-08-22', customer:'乙商行', sku_id:'',      name:'手作梅酒', volume:'750ml', direction:'in',  qty:120, quote_no:'',   note:'', operator:'Molly', created_at:'' }
];

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
    case 'getCustomers':       return { ok:true, customers:[] };
    case 'getConsignCustomers':return { ok:true, customers:[], discounts:[] };
    case 'getOwnbrandProducts':return { ok:true, products:[
      { sku_id:'OB001', name:'琥珀琴酒', volume:'500ml', list_price:1200, active:'Y' },
      { sku_id:'OB002', name:'手作梅酒', volume:'750ml', list_price:800,  active:'Y' } ] };
    case 'getOwnbrandTiers':   return { ok:true, tiers:[
      { channel:'buyout', min_qty:200,  discount:0.6 },
      { channel:'buyout', min_qty:500,  discount:0.55 },
      { channel:'buyout', min_qty:1000, discount:0.5 } ], terms:{} };
    case 'getStorageData':     return { ok:true, moves:STORAGE_MOVES };
    case 'addStorageMove':     return { ok:true, move:{ move_id:'ST-NEW' } };
    case 'deleteStorageMove':  return { ok:true };
    case 'getTodayDigest':     return { ok:true, today:'2026-08-28', ship_due:[], final_due:[], no_scan:[], no_invoice:[], calendar:[], warnings:[] };
    default:                   return { ok:true };
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errors = [], results = [], posted = [];
  const check = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);
  const isNoise = t => /Failed to load resource|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|favicon|raw.githubusercontent/i.test(t);

  const page = await browser.newPage();
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('CONSOLE: ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.route('**/script.google.com/**', async route => {
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
    posted.push(body);
    let payload;
    if (body.action === 'batch') payload = { ok:true, results:(body.calls||[]).map(c => respond(c.action)) };
    else payload = respond(body.action);
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

  /* ---- 1. 模式顯示：一次性採購才看得到 級距編輯欄＋寄倉區 ---- */
  await page.evaluate(() => { resetAll(true); setType('ownbrand'); });
  await page.waitForTimeout(600);   // 等 getOwnbrandTiers 回來、預設級距帶入
  let r = await page.evaluate(() => ({
    tieredit: document.getElementById('ob-tieredit').style.display,
    storage:  document.getElementById('storage-card').style.display,
    t1min: document.getElementById('ob-t1-min').value, t1d: document.getElementById('ob-t1-disc').value,
    t2min: document.getElementById('ob-t2-min').value, t2d: document.getElementById('ob-t2-disc').value,
    t3min: document.getElementById('ob-t3-min').value, t3d: document.getElementById('ob-t3-disc').value,
    isDef: obTiersAreDefault()
  }));
  check('一次性採購：級距編輯欄＋寄倉區顯示', r.tieredit==='block' && r.storage==='block');
  check('級距編輯欄預設帶標準值 200/6、500/5.5、1000/5', r.t1min==='200'&&r.t1d==='6'&&r.t2min==='500'&&r.t2d==='5.5'&&r.t3min==='1000'&&r.t3d==='5');
  check('預設狀態 obTiersAreDefault()=true', r.isDef===true);
  r = await page.evaluate(() => { setType('ownlabel'); const v={te:document.getElementById('ob-tieredit').style.display, st:document.getElementById('storage-card').style.display}; setType('bottle'); const v2=document.getElementById('ob-tieredit').style.display; const st2=document.getElementById('storage-card').style.display; setType('banquet'); const st3=document.getElementById('storage-card').style.display; setType('ownbrand'); return {...v, v2, st2, st3}; });
  check('客製標／瓶裝：級距編輯欄隱藏、寄倉卡片顯示', r.te==='none' && r.st==='block' && r.v2==='none' && r.st2==='block');
  check('宴會：寄倉卡片隱藏', r.st3==='none');

  /* ---- 2. 自動套折用「本單級距」；改門檻即時重套 ---- */
  await page.waitForTimeout(300);
  r = await page.evaluate(() => {
    quickAddOwnbrand; // 存在性
    document.getElementById('ob-product').value='OB001'; quickAddOwnbrand();
    const id=botItems[botItems.length-1];
    const row=document.getElementById('r-'+id);
    row.querySelector('[data-f="qty"]').value=250;
    autoDiscForRow(id);
    return { disc: row.querySelector('[data-f="disc"]').value, price: row.querySelector('[data-f="price"]').value };
  });
  check('qty 250 → 標準級距自動 6 折、計價 720', r.disc==='6' && r.price==='720');
  r = await page.evaluate(() => {
    document.getElementById('ob-t1-min').value=100; obTierEdited();
    const id=botItems[botItems.length-1];
    const row=document.getElementById('r-'+id);
    row.querySelector('[data-f="qty"]').value=120; autoDiscForRow(id);
    return { disc: row.querySelector('[data-f="disc"]').value, isDef: obTiersAreDefault() };
  });
  check('門檻改 100 後 qty 120 → 套 6 折（本單級距生效）', r.disc==='6');
  check('改過門檻 obTiersAreDefault()=false', r.isDef===false);

  /* ---- 3. 未達本單最低門檻 → 提醒 ---- */
  r = await page.evaluate(() => {
    const id=botItems[botItems.length-1];
    const row=document.getElementById('r-'+id);
    row.querySelector('[data-f="qty"]').value=50; autoDiscForRow(id); calc();
    return { warn: document.getElementById('ob-moqwarn').innerHTML, disc: row.querySelector('[data-f="disc"]').value };
  });
  check('qty 50（低於本單門檻 100）→ 顯示未達門檻提醒', /未達本單最低量價門檻 100/.test(r.warn));
  check('未達門檻 → 折欄留空（原價）', r.disc==='');

  /* ---- 4. 寄倉勾選：條款欄出現、帶預設文字 ---- */
  r = await page.evaluate(() => {
    document.getElementById('ob-storage').checked=true; obStorageToggle();
    return { show: document.getElementById('ob-storage-terms').style.display, txt: document.getElementById('ob-storage-terms').value };
  });
  check('勾寄倉 → 條款欄出現＋預設條款文字', r.show==='block' && r.txt.indexOf('寄放乙方倉庫')>=0);

  /* ---- 5. 存檔 payload：docopts 帶 moqTiers＋storage ---- */
  r = await page.evaluate(() => {
    document.getElementById('f-cli').value='測試客戶';
    document.getElementById('ob-storage-terms').value='免費寄倉六個月，期滿另議。';
    const q=collectQuote();
    const it=(q.items||[]).find(x=>x.itemType==='docopts');
    return { json: it?it.flavorList:'', count:(q.items||[]).filter(x=>x.itemType==='docopts').length };
  });
  {
    const o = r.json?JSON.parse(r.json):{};
    check('存檔：docopts 列只有一列', r.count===1);
    check('存檔：moqTiers=[[100,6],[500,5.5],[1000,5]]', JSON.stringify(o.moqTiers)===JSON.stringify([[100,6],[500,5.5],[1000,5]]));
    check('存檔：storage=1＋自訂條款', o.storage===1 && o.storageTerms==='免費寄倉六個月，期滿另議。');
  }

  /* ---- 6. 預覽印寄倉條款 ---- */
  r = await page.evaluate(() => { openPreview(); const h=document.getElementById('pcon').innerHTML; closePreview(); return h; });
  check('預覽：印「寄倉條款」＋自訂文字', /寄倉條款/.test(r) && /免費寄倉六個月/.test(r));

  /* ---- 7. 還原標準級距 ---- */
  r = await page.evaluate(() => { obResetTiers(); return { t1: document.getElementById('ob-t1-min').value, isDef: obTiersAreDefault() }; });
  check('還原標準級距 → 200、isDefault', r.t1==='200' && r.isDef===true);

  /* ---- 8. 載入舊單：moqTiers＋storage 還原 ---- */
  r = await page.evaluate(() => {
    resetAll(true); setType('ownbrand');
    const q={ quoteType:'ownbrand', quoteNo:'Q20260810-01', quoteDate:'2026-08-10', client:'甲公司',
      items:[ {itemType:'bottle', name:'琥珀琴酒', volume:'500', unitPrice:720, qty:150, subtotal:108000, flavorList:'', listPrice:1200, discount:6},
              {itemType:'docopts', name:'文件顯示設定', unitPrice:0, qty:1, subtotal:0, flavorList: JSON.stringify({hideTotals:0,imgSize:'m',moqTiers:[[150,6],[600,5]],storage:1,storageTerms:'寄倉條款測試ABC'}) } ] };
    loadQuoteIntoForm(q);
    return { t1: document.getElementById('ob-t1-min').value, t1d: document.getElementById('ob-t1-disc').value,
      t2: document.getElementById('ob-t2-min').value, t3: document.getElementById('ob-t3-min').value,
      st: document.getElementById('ob-storage').checked, terms: document.getElementById('ob-storage-terms').value,
      show: document.getElementById('ob-storage-terms').style.display,
      rows: botItems.length, disc150: buyoutDiscountForQty(150), disc100: buyoutDiscountForQty(100) };
  });
  check('載入：自訂級距還原 150/6、600/5、第三組空', r.t1==='150' && r.t1d==='6' && r.t2==='600' && r.t3==='');
  check('載入：寄倉勾選＋條款還原', r.st===true && r.terms==='寄倉條款測試ABC' && r.show==='block');
  check('載入：docopts 不變品項列（只有 1 列）', r.rows===1);
  check('載入後折率查詢用還原級距（150→0.6、100→1）', Math.abs(r.disc150-0.6)<1e-9 && r.disc100===1);

  /* ---- 9. 載入沒有 docopts 的舊單 → 回標準級距、寄倉不勾 ---- */
  r = await page.evaluate(() => {
    const q={ quoteType:'ownbrand', quoteNo:'Q20260701-01', quoteDate:'2026-07-01', client:'舊客戶',
      items:[ {itemType:'bottle', name:'手作梅酒', volume:'750', unitPrice:800, qty:100, subtotal:80000, flavorList:''} ] };
    loadQuoteIntoForm(q);
    return { t1: document.getElementById('ob-t1-min').value, st: document.getElementById('ob-storage').checked };
  });
  check('舊單（無 docopts）：級距回標準 200、寄倉不勾', r.t1==='200' && r.st===false);

  /* ---- 10a. 代工（瓶裝）單也可勾寄倉：存 docopts、印條款（8/28 下午擴充） ---- */
  r = await page.evaluate(() => {
    resetAll(true); setType('bottle');
    document.getElementById('f-cli').value='瓶裝客戶';
    addBotRow({name:'測試酒', vol:500, price:800, qty:12}); calc();
    document.getElementById('ob-storage').checked=true; obStorageToggle();
    const q=collectQuote();
    const it=(q.items||[]).find(x=>x.itemType==='docopts');
    const o=it?JSON.parse(it.flavorList):{};
    openPreview(); const h=document.getElementById('pcon').innerHTML; closePreview();
    return { st:o.storage===1, hasTiers:'moqTiers' in o, prints: /寄倉條款/.test(h), termShow: document.getElementById('ob-storage-terms').style.display };
  });
  check('代工單勾寄倉：docopts 存 storage、不存級距、預覽印條款', r.st===true && r.hasTiers===false && r.prints===true && r.termShow==='block');

  /* ---- 10b. 宴會單：即使殘留勾選也不存不印 ---- */
  r = await page.evaluate(() => {
    resetAll(true); setType('banquet');
    document.getElementById('ob-storage').checked=true;   // 硬勾（畫面上看不到）
    const q=collectQuote();
    const it=(q.items||[]).find(x=>x.itemType==='docopts');
    openPreview(); const h=document.getElementById('pcon').innerHTML; closePreview();
    document.getElementById('ob-storage').checked=false;
    return { hasDoc: !!it, prints: /寄倉條款/.test(h) };
  });
  check('宴會單：不存 docopts、不印寄倉條款', r.hasDoc===false && r.prints===false);

  /* ---- 11. 清除：級距回標準、寄倉取消 ---- */
  r = await page.evaluate(() => {
    setType('ownbrand');
    document.getElementById('ob-t1-min').value=99; obTierEdited();
    document.getElementById('ob-storage').checked=true; obStorageToggle();
    resetAll(true);
    return { t1: document.getElementById('ob-t1-min').value, st: document.getElementById('ob-storage').checked,
      show: document.getElementById('ob-storage-terms').style.display };
  });
  check('清除後：級距回標準 200、寄倉不勾、條款欄收合', r.t1==='200' && r.st===false && r.show==='none');

  /* ---- 12. 寄倉管理卡片：彙總＋明細 ---- */
  await page.evaluate(() => gotoPage('consign'));
  await page.waitForTimeout(800);
  r = await page.evaluate(() => ({
    inv: document.getElementById('st-inv-body').innerText,
    ledger: document.getElementById('st-ledger-body').innerText,
    cusOpts: [...document.getElementById('st-customer').options].map(o=>o.value)
  }));
  check('寄倉彙總：甲公司 琥珀琴酒 入300 提80 剩220', /甲公司/.test(r.inv) && /300/.test(r.inv) && /80/.test(r.inv) && /220/.test(r.inv));
  check('寄倉彙總：乙商行 自行輸入款 剩120', /乙商行/.test(r.inv) && /120/.test(r.inv));
  check('寄倉明細：三筆都在、類型標示入倉/提領', /入倉/.test(r.ledger) && /提領/.test(r.ledger) && /第一批/.test(r.ledger));
  check('客戶下拉：全部＋甲公司＋乙商行', r.cusOpts.length===3 && r.cusOpts.includes('甲公司') && r.cusOpts.includes('乙商行'));

  /* 篩選單一客戶 */
  r = await page.evaluate(() => {
    document.getElementById('st-customer').value='乙商行'; stRender();
    const t=document.getElementById('st-inv-body').innerText;
    document.getElementById('st-customer').value=''; stRender();
    return t;
  });
  check('篩選乙商行：彙總只剩乙商行', /乙商行/.test(r) && !/甲公司/.test(r));

  /* ---- 13. 登記入倉：打 addStorageMove ---- */
  posted.length=0;
  await page.evaluate(() => {
    stOpenForm('in');
    document.getElementById('st-f-cus').value='丙企業';
    document.getElementById('st-f-date').value='2026-08-28';
    document.getElementById('st-f-sku').value='OB002'; stSkuChange();
    document.getElementById('st-f-qty').value='60';
    document.getElementById('st-f-no').value='Q20260828-01';
    return stSaveMove();
  });
  await page.waitForTimeout(400);
  {
    const call = posted.find(b=>b.action==='addStorageMove');
    check('入倉登記：addStorageMove 帶客戶/酒款/數量/方向', !!call && call.customer==='丙企業' && call.sku_id==='OB002' && call.qty===60 && call.direction==='in' && call.quote_no==='Q20260828-01');
    check('登記後重抓 getStorageData', posted.some(b=>b.action==='getStorageData'));
  }

  /* ---- 14. 提領超量：前端就擋、不打後端 ---- */
  posted.length=0;
  r = await page.evaluate(() => {
    stOpenForm('out');
    document.getElementById('st-f-cus').value='甲公司';
    document.getElementById('st-f-sku').value='OB001'; stSkuChange();
    document.getElementById('st-f-qty').value='999';
    return stSaveMove().then(()=>document.getElementById('st-form').style.display);
  });
  await page.waitForTimeout(300);
  check('提領 999 > 剩 220 → 擋下、表單留著', r==='block' && !posted.some(b=>b.action==='addStorageMove'));
  /* 合法提領 */
  posted.length=0;
  await page.evaluate(() => {
    document.getElementById('st-f-qty').value='20';
    return stSaveMove();
  });
  await page.waitForTimeout(500);
  {
    const call = posted.find(b=>b.action==='addStorageMove');
    check('提領 20 ≤ 剩 220 → 正常送出', !!call && call.direction==='out' && call.qty===20);
  }

  /* ---- 15. 刪除一筆 → deleteStorageMove ---- */
  posted.length=0;
  await page.evaluate(() => stDeleteMove('ST20260821-01'));
  await page.waitForTimeout(400);
  check('刪除明細 → deleteStorageMove 帶 move_id', posted.some(b=>b.action==='deleteStorageMove' && b.move_id==='ST20260821-01'));

  await browser.close();
  results.forEach(([s,n])=>console.log(s+'  '+n));
  errors.forEach(e=>console.log('ERROR  '+e));
  const pass=results.filter(x=>x[0]==='PASS').length, fail=results.length-pass;
  console.log(`\n${pass} PASS / ${fail} FAIL / ${errors.length} errors`);
  process.exit(fail||errors.length?1:0);
})();
