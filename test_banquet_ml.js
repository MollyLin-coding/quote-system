/* 2026-07-31 宴會酒水 ML 計價＋自訂單併入報價紀錄 離線測試
   1) 兩組客製化調酒可切換 杯／ML 計價；手動小計（整包價）優先於 單價×數量
   2) 自訂品項列（宴會）：備註小字／免費贈送（劃線不計價）／手動小計
   3) collectQuote → loadQuoteIntoForm 完整往返（unit=ml、手動小計、免費、備註）
   4) 舊格式宴會單（杯計價、subtotal=單價×數量）載入不誤判成手動
   5) 報價紀錄 renderRecords：自訂單併入列表、標籤／篩選／排序正確
   6) quoteHasItems：空白宴會列的 checkbox 不會誤判成有內容 */
const { chromium } = require('/opt/node-tools/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  const isNoise = t => /Failed to load resource|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|favicon/i.test(t);
  page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('CONSOLE: ' + m.text()); });

  await page.goto('http://localhost:8899/index.html?cb=20260731a');
  const results = [];
  const check = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);

  await page.evaluate(() => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 'test-token';
    window.confirm = () => true;
    window.apiCall = async (p) => ({ ok: true, quotes: [] });
  });

  /* ---------- 1) 杯／ML 切換與手動小計 ---------- */
  await page.evaluate(() => { setType('banquet'); resetAll(true); setType('banquet'); });
  check('預設仍為杯計價', await page.evaluate(() => banUnitOf('g1') === 'cup' && document.getElementById('ban-g1-qtylabel').textContent === '總杯數'));

  await page.evaluate(() => {
    document.getElementById('ban-g1-unit').value = 'ml'; onBanUnitChange('g1');
    document.getElementById('ban-g1-qty').value = '80000';
    document.getElementById('ban-g1-price').value = '';
    calcBan();
  });
  check('切到 ML：數量標籤變「總ML數」', await page.evaluate(() => document.getElementById('ban-g1-qtylabel').textContent === '總ML數'));
  check('未填單價時小計為 $0', await page.evaluate(() => document.getElementById('ban-g1-sub').textContent === '$0'));

  await page.evaluate(() => {
    document.getElementById('ban-g1-man').checked = true; toggleBanManual('g1');
    document.getElementById('ban-g1-subman').value = '39000'; calcBan();
  });
  check('手動小計 39000 生效', await page.evaluate(() => document.getElementById('ban-g1-sub').textContent === '$39,000'));
  check('手動小計輸入框已顯示', await page.evaluate(() => document.getElementById('ban-g1-subman').style.display !== 'none'));

  /* g2 維持杯計價自動算 */
  await page.evaluate(() => {
    document.getElementById('ban-g2-price').value = '120';
    document.getElementById('ban-g2-qty').value = '50';
    calcBan();
  });
  check('g2 杯計價 120×50=6000', await page.evaluate(() => document.getElementById('ban-g2-sub').textContent === '$6,000'));

  /* ---------- 2) 自訂品項列：備註／免費／手動小計 ---------- */
  await page.evaluate(() => {
    document.getElementById('ban-free-body').innerHTML = ''; banFreeItems = [];
    addBanFreeRow({ name: '酒吧車租借', qty: 5, unit: '日', price: 2500, free: true, note: '商會友情支援' });
    addBanFreeRow({ name: '氣瓶', qty: 1, unit: '瓶', price: 1000 });
    addBanFreeRow({ name: '特調材料包', manual: true, subval: 800 });
    calc();
  });
  const banTotals = await page.evaluate(() => ({
    tot: document.getElementById('t-tot').textContent,
    freeCls: document.getElementById(`bf-${banFreeItems[0]}`).className,
    autoSub: document.getElementById(`bf-${banFreeItems[1]}`).querySelector('[data-f="subval"]').value,
    manRO: document.getElementById(`bf-${banFreeItems[2]}`).querySelector('[data-f="subval"]').readOnly
  }));
  // 39000 + 6000 + 0(免費) + 1000 + 800 = 46800（含稅模式總計＝輸入金額）
  check('總計＝46,800（免費列不計價）', banTotals.tot === '$46,800');
  check('免費列有 free 樣式', /free/.test(banTotals.freeCls));
  check('非手動列小計自動＝1000', banTotals.autoSub === '1000');
  check('手動列小計欄可編輯', banTotals.manRO === false);

  /* ---------- 3) collectQuote → loadQuoteIntoForm 往返 ---------- */
  const collected = await page.evaluate(() => {
    document.getElementById('f-cli').value = 'KKBar';
    flavors.g1 = ['Flutterfly', 'Taiwan Vibes 2.0']; renderFlavors('g1');
    calc();
    return collectQuote();
  });
  const g1it = collected.items.find(i => i.itemType === 'banquet_group' && i.name === '客製化調酒');
  const freeIt = collected.items.find(i => i.name === '酒吧車租借');
  const manIt = collected.items.find(i => i.name === '特調材料包');
  check('存檔：g1 unit=ml、subtotal=39000', g1it && g1it.unit === 'ml' && g1it.subtotal === 39000 && g1it.qty === 80000);
  check('存檔：免費列 noCharge=Y、subtotal=0、原價在 deduction', freeIt && freeIt.noCharge === 'Y' && freeIt.subtotal === 0 && freeIt.deduction === 12500);
  check('存檔：備註存進 flavorList 欄', freeIt && freeIt.flavorList === '商會友情支援');
  check('存檔：手動列 subtotal=800', manIt && manIt.subtotal === 800);

  const roundtrip = await page.evaluate((q) => {
    editingQuoteNo = null; resetAll(true);
    loadQuoteIntoForm(q);
    const freeRow = banFreeItems.map(id => document.getElementById(`bf-${id}`)).find(r => r.querySelector('[data-f="name"]').value === '酒吧車租借');
    const manRow = banFreeItems.map(id => document.getElementById(`bf-${id}`)).find(r => r.querySelector('[data-f="name"]').value === '特調材料包');
    return {
      unit: banUnitOf('g1'), qty: document.getElementById('ban-g1-qty').value,
      man: document.getElementById('ban-g1-man').checked, subman: document.getElementById('ban-g1-subman').value,
      flav: flavors.g1.join('、'),
      freeChecked: freeRow && freeRow.querySelector('[data-f="free"]').checked,
      freeNote: freeRow && freeRow.querySelector('[data-f="note"]').value,
      manChecked: manRow && manRow.querySelector('[data-f="manual"]').checked,
      manVal: manRow && manRow.querySelector('[data-f="subval"]').value,
      tot: document.getElementById('t-tot').textContent
    };
  }, collected);
  check('載回：g1 為 ML 計價、總ML數 80000', roundtrip.unit === 'ml' && roundtrip.qty === '80000');
  check('載回：手動小計勾起且值=39000', roundtrip.man === true && roundtrip.subman === '39000');
  check('載回：品名清單還原', roundtrip.flav === 'Flutterfly、Taiwan Vibes 2.0');
  check('載回：免費列勾起＋備註還原', roundtrip.freeChecked === true && roundtrip.freeNote === '商會友情支援');
  check('載回：手動列勾起＋小計 800', roundtrip.manChecked === true && roundtrip.manVal === '800');
  check('載回：總計不變 46,800', roundtrip.tot === '$46,800');

  /* ---------- 4) 舊格式宴會單相容 ---------- */
  const legacy = await page.evaluate(() => {
    editingQuoteNo = null; resetAll(true);
    loadQuoteIntoForm({ quoteNo: '20260601-01', quoteType: 'banquet', clientName: '老客戶', quoteDate: '2026-06-01',
      priceMode: 'inc', taxRate: 5, paymentType: '0',
      items: [
        { itemType: 'banquet_group', name: '客製化調酒', unitPrice: 150, qty: 90, unit: '杯', subtotal: 13500, flavorList: '櫻花白柚mojito' },
        { itemType: 'banquet_free', name: '杯具租借', unitPrice: 500, qty: 2, unit: '式', subtotal: 1000 }
      ] });
    const freeRow = document.getElementById(`bf-${banFreeItems[0]}`);
    return { unit: banUnitOf('g1'), man: document.getElementById('ban-g1-man').checked,
      sub: document.getElementById('ban-g1-sub').textContent,
      rowFree: freeRow.querySelector('[data-f="free"]').checked,
      rowMan: freeRow.querySelector('[data-f="manual"]').checked };
  });
  check('舊單：杯計價、未誤判手動、小計 13,500', legacy.unit === 'cup' && legacy.man === false && legacy.sub === '$13,500');
  check('舊單：自訂列未誤判免費/手動', legacy.rowFree === false && legacy.rowMan === false);

  /* ---------- 5) 報價紀錄併入自訂單 ---------- */
  const rec = await page.evaluate(() => {
    REC_QUOTES = [
      { quoteNo: '20260710-01', clientName: '湧金啤酒廠', quoteType: 'bottle', quoteDate: '2026-07-10', grandTotal: 3810, status: '草稿' },
      { quoteNo: '20260601-02', clientName: '被刪除的', quoteType: 'bottle', quoteDate: '2026-06-01', grandTotal: 1, status: '已刪除' }
    ];
    REC_CUSTOM = [
      { quote_no: '20260708-01', client: 'KKBar', tag: '活動酒水 · KKBar', quote_date: '2026-07-08',
        totals_json: JSON.stringify({ sub: 41429, tax: 2071, total: 43500 }), updated_at: '2026-07-08' }
    ];
    document.getElementById('rec-type-filter').value = '';
    document.getElementById('rec-search').value = '';
    renderRecords();
    return document.getElementById('rec-body').innerHTML;
  });
  check('自訂單 KKBar 出現在報價紀錄', rec.includes('20260708-01') && rec.includes('KKBar'));
  check('自訂單掛「自訂報價單」標籤', rec.includes('rec-badge custom'));
  check('自訂單總計取自 totals_json', rec.includes('$43,500'));
  check('自訂單列沒有刪除鈕、標準單有', (rec.match(/刪除/g) || []).length === 1);
  check('已刪除的標準單仍被濾掉', !rec.includes('被刪除的'));
  check('排序新→舊（0710 在 0708 前）', rec.indexOf('20260710-01') < rec.indexOf('20260708-01'));

  const recFiltered = await page.evaluate(() => {
    document.getElementById('rec-type-filter').value = 'custom'; renderRecords();
    const htmlCustom = document.getElementById('rec-body').innerHTML;
    document.getElementById('rec-type-filter').value = 'bottle'; renderRecords();
    const htmlBottle = document.getElementById('rec-body').innerHTML;
    document.getElementById('rec-type-filter').value = ''; renderRecords();
    return { htmlCustom, htmlBottle };
  });
  check('篩「自訂報價單」只剩 KKBar', recFiltered.htmlCustom.includes('KKBar') && !recFiltered.htmlCustom.includes('湧金'));
  check('篩「瓶裝」不含自訂單', recFiltered.htmlBottle.includes('湧金') && !recFiltered.htmlBottle.includes('KKBar'));

  const recSearch = await page.evaluate(() => {
    document.getElementById('rec-search').value = 'kkbar'; renderRecords();
    const html = document.getElementById('rec-body').innerHTML;
    document.getElementById('rec-search').value = ''; renderRecords();
    return html;
  });
  check('關鍵字搜尋找得到自訂單', recSearch.includes('20260708-01') && !recSearch.includes('湧金'));

  /* ---------- 6) 空白宴會列不誤判 ---------- */
  const emptyHas = await page.evaluate(() => {
    editingQuoteNo = null; resetAll(true); setType('banquet');
    document.getElementById('f-cli').value = '';
    return quoteHasItems();
  });
  check('空白宴會單 quoteHasItems=false（checkbox 不誤判）', emptyHas === false);

  /* ---------- 結果 ---------- */
  const pass = results.filter(r => r[0] === 'PASS').length;
  results.forEach(r => console.log(r[0] + '  ' + r[1]));
  console.log(`\n${pass}/${results.length} 項通過`);
  if (errors.length) { console.log('\n=== 頁面錯誤 ==='); errors.forEach(e => console.log(e)); }
  await browser.close();
  process.exit(pass === results.length && errors.length === 0 ? 0 : 1);
})();
