/* 2026-07-31 宴會酒水 ML 計價＋自訂單併入報價紀錄 離線測試
   （2026-09-01 改寫：配合 8/31「兩組客製化調酒改成每一款各自一列」的新版面，
     舊的 ban-g1-qtylabel／ban-g1-price／ban-g1-qty／ban-g1-man／ban-g1-subman 等
     整組共用欄位已不存在，改用列層級的 bg-<g>-<rowId> ＋ [data-f=...]。測試意圖不變。）
   1) 兩組客製化調酒可切換 杯／ML／桶 計價；每款各自單價×數量，手動小計（整包價）優先
   2) 自訂品項列（宴會）：備註小字／免費贈送（劃線不計價）／手動小計
   3) collectQuote → loadQuoteIntoForm 完整往返（unit=ml、手動小計、免費、備註、多款各自一列）
   4) 舊格式宴會單（杯計價、subtotal=單價×數量、品名清單在 flavorList）載入不誤判成手動
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

  await page.goto('http://localhost:8899/index.html?cb=20260901a');
  const results = [];
  const check = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);

  // 99_boot.js 開頁後會先打一次假 API，等它跑完再塞資料
  await page.waitForTimeout(1200);

  await page.evaluate(() => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 'test-token';
    window.confirm = () => true;
    window.apiCall = async (p) => ({ ok: true, quotes: [] });
  });

  /* ---------- 1) 杯／ML 切換與每款各自計價、手動小計 ---------- */
  await page.evaluate(() => { setType('banquet'); resetAll(true); setType('banquet'); });
  check('預設仍為杯計價（unit=cup、單位字＝杯）',
    await page.evaluate(() => banUnitOf('g1') === 'cup' && banUnitLabel('g1') === '杯'));

  // 新增第一款：杯計價下數量欄提示＝杯數預設值
  await page.evaluate(() => { addBanGroupRow('g1', { name: 'Flutterfly' }); calcBan(); });
  check('杯計價：新增列的數量欄提示為杯數（90）', await page.evaluate(() => {
    const row = document.getElementById(`bg-g1-${banGroupItems('g1')[0]}`);
    return row.querySelector('[data-f="qty"]').placeholder === '90';
  }));

  // 切到 ML：已存在的列也要跟著換提示（onBanUnitChange 掃全組）
  await page.evaluate(() => { document.getElementById('ban-g1-unit').value = 'ml'; onBanUnitChange('g1'); });
  check('切到 ML：既有列的數量提示變「總ML數」', await page.evaluate(() => {
    const row = document.getElementById(`bg-g1-${banGroupItems('g1')[0]}`);
    return row.querySelector('[data-f="qty"]').placeholder === '總ML數' && banUnitLabel('g1') === 'ml';
  }));

  // 切到桶（10 公升整桶出貨）
  await page.evaluate(() => { document.getElementById('ban-g1-unit').value = 'keg'; onBanUnitChange('g1'); });
  check('切到桶計價：提示變「桶數」、單位字＝桶', await page.evaluate(() => {
    const row = document.getElementById(`bg-g1-${banGroupItems('g1')[0]}`);
    return row.querySelector('[data-f="qty"]').placeholder === '桶數' && banUnitLabel('g1') === '桶';
  }));

  // 回到 ML 繼續後面的往返測試
  await page.evaluate(() => {
    document.getElementById('ban-g1-unit').value = 'ml'; onBanUnitChange('g1');
    const row = document.getElementById(`bg-g1-${banGroupItems('g1')[0]}`);
    row.querySelector('[data-f="qty"]').value = '80000';
    row.querySelector('[data-f="price"]').value = '';
    calcBan();
  });
  check('未填單價時該組小計為 $0',
    await page.evaluate(() => document.getElementById('ban-g1-sub').textContent === '$0'));

  await page.evaluate(() => {
    const id = banGroupItems('g1')[0];
    const row = document.getElementById(`bg-g1-${id}`);
    row.querySelector('[data-f="manual"]').checked = true; toggleBanGroupRowManual('g1', id);
    row.querySelector('[data-f="subval"]').value = '39000';
    calcBan();
  });
  check('手動小計 39000 生效',
    await page.evaluate(() => document.getElementById('ban-g1-sub').textContent === '$39,000'));
  check('勾手動後小計欄可編輯（非唯讀）', await page.evaluate(() => {
    const row = document.getElementById(`bg-g1-${banGroupItems('g1')[0]}`);
    return row.querySelector('[data-f="subval"]').readOnly === false;
  }));

  // 同一組第二款走自動算：驗證「每款各自一列、各自價」會加總成該組小計
  await page.evaluate(() => { addBanGroupRow('g1', { name: 'Taiwan Vibes 2.0', price: 100, qty: 30 }); calcBan(); });
  check('同組第二款自動算，組小計＝39,000+3,000=42,000',
    await page.evaluate(() => document.getElementById('ban-g1-sub').textContent === '$42,000'));

  /* g2 維持杯計價自動算 */
  await page.evaluate(() => { addBanGroupRow('g2', { name: '無酒精莫希托', price: 120, qty: 50 }); calcBan(); });
  check('g2 杯計價 120×50=6000',
    await page.evaluate(() => document.getElementById('ban-g2-sub').textContent === '$6,000'));

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
  // 42000 + 6000 + 0(免費) + 1000 + 800 = 49800（含稅模式總計＝輸入金額）
  check('總計＝49,800（免費列不計價）', banTotals.tot === '$49,800');
  check('免費列有 free 樣式', /free/.test(banTotals.freeCls));
  check('非手動列小計自動＝1000', banTotals.autoSub === '1000');
  check('手動列小計欄可編輯', banTotals.manRO === false);

  /* ---------- 3) collectQuote → loadQuoteIntoForm 往返 ---------- */
  const collected = await page.evaluate(() => {
    document.getElementById('f-cli').value = 'KKBar';
    calc();
    return collectQuote();
  });
  const g1its = collected.items.filter(i => i.itemType === 'banquet_group' && i.lot === 'g1');
  const g2it = collected.items.find(i => i.itemType === 'banquet_group' && i.lot === 'g2');
  const freeIt = collected.items.find(i => i.name === '酒吧車租借');
  const manIt = collected.items.find(i => i.name === '特調材料包');
  check('存檔：g1 第一款 unit=ml、subtotal=39000、qty=80000',
    g1its.length > 0 && g1its[0].name === 'Flutterfly' && g1its[0].unit === 'ml'
    && g1its[0].subtotal === 39000 && g1its[0].qty === 80000);
  check('存檔：g1 兩款各自存成一列（lot 記 g1、各自單價）',
    g1its.length === 2 && g1its[1].name === 'Taiwan Vibes 2.0'
    && g1its[1].unitPrice === 100 && g1its[1].qty === 30 && g1its[1].subtotal === 3000);
  check('存檔：g2 列 lot=g2、unit=杯、subtotal=6000',
    !!g2it && g2it.name === '無酒精莫希托' && g2it.unit === '杯' && g2it.subtotal === 6000 && g2it.unitPrice === 120);
  check('存檔：免費列 noCharge=Y、subtotal=0、原價在 deduction',
    freeIt && freeIt.noCharge === 'Y' && freeIt.subtotal === 0 && freeIt.deduction === 12500);
  check('存檔：備註存進 flavorList 欄', freeIt && freeIt.flavorList === '商會友情支援');
  check('存檔：手動列 subtotal=800', manIt && manIt.subtotal === 800);

  const roundtrip = await page.evaluate((q) => {
    editingQuoteNo = null; resetAll(true);
    loadQuoteIntoForm(q);
    const gRow = (g, i) => document.getElementById(`bg-${g}-${banGroupItems(g)[i]}`);
    const gf = (row, f) => row.querySelector(`[data-f="${f}"]`);
    const r0 = gRow('g1', 0), r1 = gRow('g1', 1);
    const freeRow = banFreeItems.map(id => document.getElementById(`bf-${id}`)).find(r => gf(r, 'name').value === '酒吧車租借');
    const manRow = banFreeItems.map(id => document.getElementById(`bf-${id}`)).find(r => gf(r, 'name').value === '特調材料包');
    return {
      unit: banUnitOf('g1'),
      qty0: r0 && gf(r0, 'qty').value,
      man0: r0 && gf(r0, 'manual').checked,
      subman0: r0 && gf(r0, 'subval').value,
      man1: r1 && gf(r1, 'manual').checked,
      price1: r1 && gf(r1, 'price').value,
      qty1: r1 && gf(r1, 'qty').value,
      sub1: r1 && gf(r1, 'subval').value,
      names: banGroupItems('g1').map(id => gf(document.getElementById(`bg-g1-${id}`), 'name').value).join('、'),
      g1cnt: banGroupItems('g1').length,
      g2unit: banUnitOf('g2'), g2sub: document.getElementById('ban-g2-sub').textContent,
      freeChecked: freeRow && gf(freeRow, 'free').checked,
      freeNote: freeRow && gf(freeRow, 'note').value,
      manChecked: manRow && gf(manRow, 'manual').checked,
      manVal: manRow && gf(manRow, 'subval').value,
      tot: document.getElementById('t-tot').textContent
    };
  }, collected);
  check('載回：g1 為 ML 計價、總ML數 80000；g2 回杯計價 6,000',
    roundtrip.unit === 'ml' && roundtrip.qty0 === '80000'
    && roundtrip.g2unit === 'cup' && roundtrip.g2sub === '$6,000');
  check('載回：第一款手動小計勾起且值=39000', roundtrip.man0 === true && roundtrip.subman0 === '39000');
  check('載回：兩款品名各自還原成各自一列',
    roundtrip.g1cnt === 2 && roundtrip.names === 'Flutterfly、Taiwan Vibes 2.0');
  check('載回：第二款未誤判手動、單價100×數量30=3000',
    roundtrip.man1 === false && roundtrip.price1 === '100' && roundtrip.qty1 === '30' && roundtrip.sub1 === '3000');
  check('載回：免費列勾起＋備註還原', roundtrip.freeChecked === true && roundtrip.freeNote === '商會友情支援');
  check('載回：手動列勾起＋小計 800', roundtrip.manChecked === true && roundtrip.manVal === '800');
  check('載回：總計不變 49,800', roundtrip.tot === '$49,800');

  /* ---------- 4) 舊格式宴會單相容（lot 空、品名清單在 flavorList）---------- */
  const legacy = await page.evaluate(() => {
    editingQuoteNo = null; resetAll(true);
    loadQuoteIntoForm({ quoteNo: '20260601-01', quoteType: 'banquet', clientName: '老客戶', quoteDate: '2026-06-01',
      priceMode: 'inc', taxRate: 5, paymentType: '0',
      items: [
        { itemType: 'banquet_group', name: '客製化調酒', unitPrice: 150, qty: 90, unit: '杯', subtotal: 13500, flavorList: '櫻花白柚mojito' },
        { itemType: 'banquet_free', name: '杯具租借', unitPrice: 500, qty: 2, unit: '式', subtotal: 1000 }
      ] });
    const gf = (row, f) => row.querySelector(`[data-f="${f}"]`);
    const gRow = document.getElementById(`bg-g1-${banGroupItems('g1')[0]}`);
    const freeRow = document.getElementById(`bf-${banFreeItems[0]}`);
    return { unit: banUnitOf('g1'),
      g1cnt: banGroupItems('g1').length,
      man: gRow && gf(gRow, 'manual').checked,
      rowName: gRow && gf(gRow, 'name').value,
      rowPrice: gRow && gf(gRow, 'price').value,
      rowQty: gRow && gf(gRow, 'qty').value,
      sub: document.getElementById('ban-g1-sub').textContent,
      rowFree: gf(freeRow, 'free').checked,
      rowMan: gf(freeRow, 'manual').checked };
  });
  check('舊單：杯計價、未誤判手動、小計 13,500',
    legacy.unit === 'cup' && legacy.man === false && legacy.sub === '$13,500'
    && legacy.rowPrice === '150' && legacy.rowQty === '90');
  check('舊單：整組共用價還原成一列、品名取自 flavorList',
    legacy.g1cnt === 1 && legacy.rowName === '櫻花白柚mojito');
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
  // 2026-09-02 起自訂單也有刪除鈕（後端補了 deleteCustomQuote），所以兩列各一顆
  check('自訂單列與標準單列都有刪除鈕', (rec.match(/刪除/g) || []).length === 2);
  check('自訂單走的是 deleteCustomRecord（不是標準單的 deleteRecord）', /deleteCustomRecord\(/.test(rec));
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
    const bare = quoteHasItems();
    addBanGroupRow('g1', {});                 // 空白酒款列（帶「手動小計」checkbox）
    const withEmptyRow = quoteHasItems();
    const row = document.getElementById(`bg-g1-${banGroupItems('g1')[0]}`);
    row.querySelector('[data-f="name"]').value = '甘蔗檸檬Mojito';
    const withName = quoteHasItems();
    return { bare, withEmptyRow, withName };
  });
  check('空白宴會單 quoteHasItems=false（自訂列 checkbox 不誤判）', emptyHas.bare === false);
  check('空白酒款列 quoteHasItems 仍為 false（手動小計 checkbox 不誤判）', emptyHas.withEmptyRow === false);
  check('酒款列填了品名後 quoteHasItems=true', emptyHas.withName === true);

  /* ---------- 結果 ---------- */
  const pass = results.filter(r => r[0] === 'PASS').length;
  results.forEach(r => console.log(r[0] + '  ' + r[1]));
  console.log(`\n${pass}/${results.length} 項通過`);
  if (errors.length) { console.log('\n=== 頁面錯誤 ==='); errors.forEach(e => console.log(e)); }
  await browser.close();
  process.exit(pass === results.length && errors.length === 0 ? 0 : 1);
})();
