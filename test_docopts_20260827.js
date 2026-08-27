/* 2026-08-27：報價單「不顯示總計區」＋「圖片大小可調／並排」離線測試
   ・預設：3 張中圖 → 兩排（兩張＋一張）、總計區照印
   ・全部改小 → 一排三張；個別覆蓋（一張大）→ 大圖自己一排
   ・勾「不顯示總計區」→ 預覽／PDF 沒有總計區，品項小計照印
   ・存檔 payload 帶 docopts 特殊列（JSON），預設狀態不帶
   ・載入含 docopts 的舊單能還原勾選／預設大小／每張大小；清除後回預設
   ・分頁：圖片一排一排塞，不會整組被推到下一頁 */
const { chromium } = require('/opt/node-tools/node_modules/playwright');

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
    case 'getTodayDigest':     return { ok:true, today:'2026-08-27', ship_due:[], final_due:[], no_scan:[], no_invoice:[], calendar:[], warnings:[] };
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

  /* 建一張瓶裝單＋3 張假圖（canvas 產生的 data URL） */
  await page.evaluate(() => {
    resetAll(true);
    document.getElementById('f-cli').value = '測試客戶';
    addBotRow({name:'測試酒', vol:500, price:800, qty:12});
    calc();
    const mk = (w,h,c)=>{ const cv=document.createElement('canvas'); cv.width=w; cv.height=h; const x=cv.getContext('2d'); x.fillStyle=c; x.fillRect(0,0,w,h); const u=cv.toDataURL('image/jpeg',.8); return {url:u, name:c+'.jpg', mime:'image/jpeg', data:u.split(',')[1]}; };
    imgs = [mk(400,300,'#c00'), mk(300,400,'#0c0'), mk(400,400,'#00c')];
    renderImgs();
  });

  /* UI 存在 */
  check('金額總計卡有「不顯示總計區」勾選', await page.evaluate(() => !!document.getElementById('f-hidetotals')));
  check('附加圖片卡有整張單的「圖片大小」下拉，預設中', await page.evaluate(() => document.getElementById('f-imgsize') && document.getElementById('f-imgsize').value === 'm'));
  check('每張縮圖下方有個別大小下拉（3 個）', await page.evaluate(() => document.querySelectorAll('#uprev select').length === 3));

  /* 預設：中圖 → 兩排 */
  const rowsOf = async () => page.evaluate(() => {
    const P = buildStdDocParts();
    const tails = P.tailBlocks.filter(Boolean);
    const imgRows = tails.filter(b => /<img /.test(b) && !/報 價 單/.test(b));
    return imgRows.map(r => (r.match(/<img /g) || []).length);
  });
  let r = await rowsOf();
  check('預設中圖：3 張排成兩排（2＋1）', r.length === 2 && r[0] === 2 && r[1] === 1);
  check('圖框＝中、照 4:3 比例縮（304×228）', await page.evaluate(() => /width:304px;height:228px/.test(buildStdDocParts().tailBlocks.filter(Boolean).find(b=>/<img /.test(b)&&!/報 價 單/.test(b)))));
  check('預設仍印總計區', await page.evaluate(() => buildStdDocParts().tailBlocks[0].includes('總計')));

  /* 全部改小 → 一排三張 */
  await page.evaluate(() => { document.getElementById('f-imgsize').value = 's'; onImgSizeChange(); });
  r = await rowsOf();
  check('整張改小：3 張排成一排', r.length === 1 && r[0] === 3);

  /* 個別覆蓋：第 2 張改大 → 小、大、小 → 三排 */
  await page.evaluate(() => setImgSize(1, 'l'));
  r = await rowsOf();
  check('第 2 張個別改大：小／大／小 → 三排（1＋1＋1）', r.length === 3 && r.every(n => n === 1));
  check('大圖框：直式 3:4 圖 → 高度吃滿 400、寬 300', await page.evaluate(() => /width:300px;height:400px/.test(buildStdDocParts().tailBlocks.filter(Boolean).filter(b=>/<img /.test(b)&&!/報 價 單/.test(b))[1])));

  /* 第 2 張改回預設、整張改中 → 兩排 */
  await page.evaluate(() => { setImgSize(1, ''); document.getElementById('f-imgsize').value = 'm'; onImgSizeChange(); });
  r = await rowsOf();
  check('個別改回預設後跟著整張設定走', r.length === 2 && r[0] === 2 && r[1] === 1);

  /* 勾「不顯示總計區」 */
  await page.evaluate(() => { document.getElementById('f-hidetotals').checked = true; });
  const t = await page.evaluate(() => { const P = buildStdDocParts(); return { first: P.tailBlocks[0], html: buildStdPagesHtml(), rows: P.rows.join('') }; });
  check('勾選後總計區為空', t.first === '');
  check('預覽頁面沒有總計區的「總計」列（付款條件文字裡的「訂金總計」不算）', !/<span>總計<\/span>/.test(t.html) && !/品項合計|<span>合計/.test(t.html));
  check('品項小計照印（$9,600）', /9,600/.test(t.rows) && /9,600/.test(t.html));
  check('圖片、付款條件、條款仍在', /<img /.test(t.html) && /匯款資訊/.test(t.html));

  /* 存檔 payload：docopts 特殊列 */
  await page.evaluate(() => setImgSize(2, 'l'));
  const docopts = await page.evaluate(() => { const q = collectQuote(); return { fn:'collectQuote', items:q.items, images:q.images.length }; });
  const d = docopts.items ? docopts.items.find(i => i.itemType === 'docopts') : null;
  check('存檔資料有 docopts 特殊列（' + docopts.fn + '）', !!d);
  const dj = d ? JSON.parse(d.flavorList) : {};
  check('docopts JSON：hideTotals=1、imgSize=m、imgSizes 第 3 張=l', dj.hideTotals === 1 && dj.imgSize === 'm' && Array.isArray(dj.imgSizes) && dj.imgSizes[2] === 'l' && !dj.imgSizes[0]);
  check('docopts 列金額全 0、不影響總計', d && d.subtotal === 0 && d.unitPrice === 0 && d.deduction === 0);
  check('存檔資料仍帶 3 張圖片', docopts.images === 3);

  /* 預設狀態不帶 docopts */
  await page.evaluate(() => { document.getElementById('f-hidetotals').checked = false; imgs.forEach(i => i.size = ''); document.getElementById('f-imgsize').value = 'm'; });
  const noOpt = await page.evaluate(() => collectQuote().items.some(i => i.itemType === 'docopts'));
  check('全部預設時不會多存 docopts 列', noOpt === false);

  /* 載入含 docopts 的單能還原 */
  await page.evaluate(() => {
    resetAll(true);
    const mk = c => { const cv=document.createElement('canvas'); cv.width=20; cv.height=20; const x=cv.getContext('2d'); x.fillStyle=c; x.fillRect(0,0,20,20); const u=cv.toDataURL('image/jpeg'); return {name:c, mime:'image/jpeg', data:u.split(',')[1]}; };
    const q = { quoteNo:'20260827-01', quoteType:'bottle', clientName:'還原客戶', quoteDate:'2026-08-27', priceMode:'inc', taxRate:5,
      images:[mk('#111'), mk('#222')],
      items:[
        {itemType:'bottle', name:'A酒', volume:'500', unitPrice:800, qty:6, subtotal:4800},
        {itemType:'docopts', name:'文件顯示設定', lot:'', volume:'', unitPrice:0, deduction:0, logoFee:0, qty:1, unit:'', subtotal:0, flavorList:JSON.stringify({hideTotals:1, imgSize:'s', imgSizes:['','l']})}
      ] };
    loadQuoteIntoForm(q);
  });
  await page.waitForTimeout(200);
  const ld = await page.evaluate(() => ({
    hide: document.getElementById('f-hidetotals').checked,
    size: document.getElementById('f-imgsize').value,
    s0: imgs[0].size, s1: imgs[1].size, n: imgs.length,
    rows: botItems.length,
    sel: [...document.querySelectorAll('#uprev select')].map(s => s.value),
  }));
  check('載入：勾選還原＝勾', ld.hide === true);
  check('載入：整張大小還原＝小', ld.size === 's');
  check('載入：第 2 張個別大小還原＝大、第 1 張預設', ld.s1 === 'l' && !ld.s0 && ld.n === 2);
  check('載入：縮圖下拉顯示對應值', ld.sel[0] === '' && ld.sel[1] === 'l');
  check('載入：docopts 不會變成品項列（只有 1 列）', ld.rows === 1);
  check('載入：後端圖片沒帶寬高，背景量到 20×20', await page.evaluate(() => imgs[0].w === 20 && imgs[0].h === 20));
  check('預覽框框照比例縮（20×20 小圖 → 150×150）', await page.evaluate(() => /width:150px;height:150px/.test(buildStdDocParts().tailBlocks.filter(Boolean).find(b=>/<img /.test(b)&&!/報 價 單/.test(b)))));
  r = await rowsOf();
  check('載入後預覽：小＋大 → 兩排', r.length === 2 && r[0] === 1 && r[1] === 1);

  /* 沒有 docopts 的舊單 → 預設 */
  await page.evaluate(() => loadQuoteIntoForm({ quoteNo:'20260827-02', quoteType:'bottle', clientName:'舊單', quoteDate:'2026-08-27', priceMode:'inc', taxRate:5, images:[], items:[{itemType:'bottle', name:'B酒', volume:'500', unitPrice:100, qty:1, subtotal:100}] }));
  await page.waitForTimeout(200);
  const old = await page.evaluate(() => ({ hide: document.getElementById('f-hidetotals').checked, size: document.getElementById('f-imgsize').value }));
  check('舊單（無 docopts）：不勾、大小＝中', old.hide === false && old.size === 'm');

  /* 清除回預設 */
  await page.evaluate(() => { document.getElementById('f-hidetotals').checked = true; document.getElementById('f-imgsize').value = 'l'; resetAll(true); });
  const rs = await page.evaluate(() => ({ hide: document.getElementById('f-hidetotals').checked, size: document.getElementById('f-imgsize').value, n: imgs.length }));
  check('清除後：不勾、大小＝中、圖片清空', rs.hide === false && rs.size === 'm' && rs.n === 0);

  /* 分頁：塞滿品項讓第 1 頁剩一點空間，圖片應一排一排分頁，而不是整組跳頁 */
  await page.evaluate(() => {
    resetAll(true);
    document.getElementById('f-cli').value = '分頁客戶';
    for (let i = 0; i < 8; i++) addBotRow({name:'酒款' + (i + 1), vol:500, price:500, qty:1});
    calc();
    const mk = c => { const cv=document.createElement('canvas'); cv.width=40; cv.height=30; const x=cv.getContext('2d'); x.fillStyle=c; x.fillRect(0,0,40,30); const u=cv.toDataURL('image/jpeg'); return {url:u, name:c, mime:'image/jpeg', data:u.split(',')[1]}; };
    imgs = [mk('#a00'), mk('#0a0'), mk('#00a'), mk('#aa0')];
    document.getElementById('f-imgsize').value = 'm'; renderImgs();
  });
  const pg = await page.evaluate(() => {
    const html = buildStdPagesHtml();
    const pages = html.split('class="cpage"').slice(1);
    return pages.map(p => (p.match(/<img [^>]*data:image/g) || []).length);
  });
  check('分頁：8 列品項＋4 張中圖 → 第 1 頁塞得下一排（2 張）、剩下 2 張到第 2 頁（一排一排塞，不是整組跳頁）', pg.length === 2 && pg[0] === 2 && pg[1] === 2);
  results.push(['INFO', '各頁圖片數＝' + JSON.stringify(pg)]);

  await browser.close();
  results.forEach(r => console.log(r[0].padEnd(5), r[1]));
  if (errors.length) { console.log('\n--- errors ---'); errors.forEach(e => console.log(e)); }
  const fails = results.filter(r => r[0] === 'FAIL').length;
  console.log(`\n${results.filter(r => r[0] === 'PASS').length} PASS / ${fails} FAIL / ${errors.length} errors`);
  process.exit(fails || errors.length ? 1 : 0);
})();
