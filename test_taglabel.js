/* 2026-07-31 批次標籤（Lot/日期標記＋客戶名稱標籤）存檔還原 離線測試
   BUG：後端主表沒有 tagLot/tagCli 欄位，存檔被丟掉 → 報價單重新開啟兩欄消失。
   修法：比照免運優惠，存成 itemType='taglabel' 特殊品項列（lot=Lot標記、flavorList=客戶名稱標籤），
   載入時從該列還原、不建品項列。 */
const { chromium } = require('/opt/node-tools/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  const isNoise = t => /Failed to load resource|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|favicon/i.test(t);
  page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('CONSOLE: ' + m.text()); });

  await page.goto('http://localhost:8899/index.html');
  /* 開場的 loadLoginUsers()（99_boot.js）離線一定失敗，失敗路徑會呼叫 rcClear()（RC_GEN++）
     把 RC_STORE／各模組衍生資料整包洗掉。若在這一發之前就塞資料／stub apiCall，
     資料會被洗掉或 stub 被繞過。這裡等 RC_GEN 連續 800ms 不再變動才視為開場結束（不用固定秒數）。 */
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForFunction(() => {
    if (typeof RC_GEN === 'undefined') return false;
    const now = Date.now();
    if (window.__genSeen !== RC_GEN) { window.__genSeen = RC_GEN; window.__genAt = now; return false; }
    return (now - (window.__genAt || now)) > 800;
  }, null, { timeout: 30000 });

  const results = [];
  const check = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);

  await page.evaluate(() => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 'test-token';
    window.confirm = () => true;
    window.apiCall = async (p) => ({ ok: true, quotes: [], orders: [], records: [], items: [] });
    gotoPage('form');
  });

  /* ---------- 1) collectQuote：填了標籤 → 產生 taglabel 特殊列 ---------- */
  let q1 = await page.evaluate(() => {
    resetAll(true);
    document.getElementById('f-cli').value = '測試客戶';
    document.getElementById('f-tag-lot').value = 'Lot 31';
    document.getElementById('f-tag-cli').value = '南野子';
    const rid = botItems[0];
    const row = document.getElementById('r-' + rid);
    row.querySelector('[data-f="name"]').value = '琴酒 700ml';
    row.querySelector('[data-f="price"]').value = '500';
    row.querySelector('[data-f="qty"]').value = '10';
    calc();
    return collectQuote();
  });
  const tg1 = (q1.items || []).find(it => it.itemType === 'taglabel');
  check('collectQuote 產生 taglabel 特殊列', !!tg1);
  check('taglabel 列：lot 放 Lot 標記', tg1 && tg1.lot === 'Lot 31');
  check('taglabel 列：flavorList 放客戶名稱標籤', tg1 && tg1.flavorList === '南野子');
  check('taglabel 列不影響金額（unitPrice/subtotal=0）', tg1 && !(+tg1.unitPrice) && !(+tg1.subtotal));
  check('quote 物件本身仍帶 tagLot/tagCli（前端相容）', q1.tagLot === 'Lot 31' && q1.tagCli === '南野子');

  /* ---------- 2) 模擬後端往返：主表欄位被丟掉，只剩 items ---------- */
  const roundtrip = JSON.parse(JSON.stringify(q1));
  delete roundtrip.tagLot; delete roundtrip.tagCli; // 後端主表沒這兩欄
  roundtrip.quoteNo = '20260731-77';
  const r2 = await page.evaluate((q) => {
    resetAll(true);
    loadQuoteIntoForm(q);
    return {
      lot: document.getElementById('f-tag-lot').value,
      cli: document.getElementById('f-tag-cli').value,
      rows: botItems.length,
      names: botItems.map(id => document.getElementById('r-' + id).querySelector('[data-f="name"]').value)
    };
  }, roundtrip);
  check('重新開啟：Lot / 日期標記還原', r2.lot === 'Lot 31');
  check('重新開啟：客戶名稱標籤還原', r2.cli === '南野子');
  check('taglabel 列不會多出一筆品項列', r2.rows === 1 && r2.names.join() === '琴酒 700ml');

  /* ---------- 3) 再存一次不會重複累積 taglabel 列 ---------- */
  const q3 = await page.evaluate(() => collectQuote());
  check('重開後再存：taglabel 列只有一筆', (q3.items || []).filter(it => it.itemType === 'taglabel').length === 1);
  check('重開後再存：標籤內容不變', (() => { const t = (q3.items || []).find(it => it.itemType === 'taglabel'); return t && t.lot === 'Lot 31' && t.flavorList === '南野子'; })());

  /* ---------- 4) 沒填標籤 → 不產生特殊列；舊單（沒有 taglabel 列）→ 欄位空白 ---------- */
  const q4 = await page.evaluate(() => {
    resetAll(true);
    document.getElementById('f-cli').value = '無標籤客戶';
    const rid = botItems[0];
    const row = document.getElementById('r-' + rid);
    row.querySelector('[data-f="name"]').value = '威士忌';
    row.querySelector('[data-f="price"]').value = '800';
    row.querySelector('[data-f="qty"]').value = '6';
    calc();
    return collectQuote();
  });
  check('沒填標籤：不產生 taglabel 列', !(q4.items || []).some(it => it.itemType === 'taglabel'));
  const r5 = await page.evaluate(() => {
    resetAll(true);
    loadQuoteIntoForm({ quoteNo: '20260601-01', quoteType: 'bottle', clientName: '舊客戶', quoteDate: '2026-06-01',
      items: [{ itemType: 'bottle', name: '舊酒款', lot: '', volume: '700', unitPrice: 300, deduction: 0, logoFee: 0, qty: 12, unit: '瓶', subtotal: 3600, flavorList: '' }] });
    return { lot: document.getElementById('f-tag-lot').value, cli: document.getElementById('f-tag-cli').value, rows: botItems.length };
  });
  check('舊單相容：標籤欄位空白不報錯', r5.lot === '' && r5.cli === '');
  check('舊單相容：品項列數正常', r5.rows === 1);

  /* ---------- 5) 只填其中一欄也要存／還原 ---------- */
  const q6 = await page.evaluate(() => {
    resetAll(true);
    document.getElementById('f-cli').value = '只填客戶標籤';
    document.getElementById('f-tag-cli').value = '滿枝枒';
    return collectQuote();
  });
  const tg6 = (q6.items || []).find(it => it.itemType === 'taglabel');
  check('只填客戶名稱標籤也會存', tg6 && tg6.lot === '' && tg6.flavorList === '滿枝枒');
  const rt6 = JSON.parse(JSON.stringify(q6)); delete rt6.tagLot; delete rt6.tagCli; rt6.quoteNo = '20260731-78';
  const r6 = await page.evaluate((q) => { resetAll(true); loadQuoteIntoForm(q);
    return { lot: document.getElementById('f-tag-lot').value, cli: document.getElementById('f-tag-cli').value }; }, rt6);
  check('只填一欄：重開還原正確', r6.lot === '' && r6.cli === '滿枝枒');

  /* ---------- 6) 宴會單：標籤照樣往返、不進宴會品項列 ---------- */
  const q7 = await page.evaluate(() => {
    resetAll(true);
    setType('banquet');
    document.getElementById('f-cli').value = '宴會客戶';
    document.getElementById('f-tag-lot').value = '2026/08/08';
    /* 2026-08-31 起兩組客製化調酒改成「每一款酒各自一列」（addBanGroupRow / banG1Items），
       不再是整組共用的 ban-g1-price / ban-g1-qty 兩個輸入框（那兩個 id 已不存在）。 */
    addBanGroupRow('g1', { name: '甘蔗檸檬Mojito', qty: 100, price: 150 });
    calcBan();
    return collectQuote();
  });
  check('宴會單也會存 taglabel 列', (q7.items || []).some(it => it.itemType === 'taglabel'));
  check('宴會單：調酒款列照常存成 banquet_group', (() => {
    const bg = (q7.items || []).filter(it => it.itemType === 'banquet_group');
    return bg.length === 1 && bg[0].name === '甘蔗檸檬Mojito' && +bg[0].subtotal === 15000;
  })());
  const rt7 = JSON.parse(JSON.stringify(q7)); delete rt7.tagLot; delete rt7.tagCli; rt7.quoteNo = '20260731-79';
  const r7 = await page.evaluate((q) => { resetAll(true); loadQuoteIntoForm(q);
    return { lot: document.getElementById('f-tag-lot').value,
             cli: document.getElementById('f-tag-cli').value,
             free: banFreeItems.length, addon: banAddonItems.length,
             g1: banG1Items.length, g2: banG2Items.length,
             g1names: banG1Items.map(id => document.getElementById('bg-g1-' + id).querySelector('[data-f="name"]').value) }; }, rt7);
  check('宴會單重開：標籤還原', r7.lot === '2026/08/08' && r7.cli === '');
  check('宴會單重開：taglabel 不混進宴會品項列', r7.free === 1 && r7.addon === 1); // 各只有預設空列
  check('宴會單重開：taglabel 不混進調酒組列', r7.g1 === 1 && r7.g2 === 0 && r7.g1names.join() === '甘蔗檸檬Mojito');

  /* ---------- 7) 預覽頁首會顯示標籤 ---------- */
  const pv = await page.evaluate(() => {
    /* resetAll() 不會改單型，上一段把畫面切成宴會單了；這裡要驗的是瓶裝單頁首，先切回來。 */
    setType('bottle');
    resetAll(true);
    document.getElementById('f-cli').value = '預覽客戶';
    document.getElementById('f-tag-lot').value = 'Lot 31';
    document.getElementById('f-tag-cli').value = '南野子';
    const rid = botItems[0];
    const row = document.getElementById('r-' + rid);
    row.querySelector('[data-f="name"]').value = '琴酒';
    row.querySelector('[data-f="price"]').value = '500';
    row.querySelector('[data-f="qty"]').value = '10';
    calc();
    openPreview();
    const html = document.getElementById('pcon').innerHTML;
    closePreview();
    return html;
  });
  check('預覽頁首顯示 Lot 標記', pv.includes('Lot 31'));
  check('預覽頁首顯示客戶名稱標籤', pv.includes('南野子'));

  const pass = results.filter(r => r[0] === 'PASS').length;
  results.forEach(r => console.log(r[0] + '  ' + r[1]));
  console.log(`\n${pass}/${results.length} PASS`);
  if (errors.length) { console.log('\n--- 頁面錯誤 ---'); errors.forEach(e => console.log(e)); }
  await browser.close();
  process.exit(pass === results.length && errors.length === 0 ? 0 : 1);
})();
