/* v31 三功能離線測試：PDF 留舊版＋歷史版本／發票照片上傳／分批出貨 */
const { chromium } = require('/opt/node-tools/node_modules/playwright');

/* 開機競態：99_boot.js 開場會呼叫 loadLoginUsers() 打真的 getLoginUsers。
   離線時這一發必失敗，而 getLoginUsers 不在 RC_READ_ACTIONS 白名單裡，
   apiCall 的 catch 會執行 rcClear() → 觸發 onCacheClear 把 ORDERS_CACHE／
   SHP_SUM／CAL_ITEMS 等全部歸零（實測開頁後約 0.5 秒）。
   測試若在那之前塞資料就會被洗掉，所以每次 goto 後都先等這一發結束再動手。
   判斷依據：loadLoginUsers 一開始把登入下拉寫成「載入中…」，
   不管成功或失敗都會在 rcClear() 之後才改掉那段文字。 */
async function settleBoot(p) {
  await p.waitForFunction(() => {
    const s = document.getElementById('login-user');
    return !s || !/載入中/.test(s.textContent || '');
  }, { timeout: 60000 });
  // 再確認 RC_GEN 不再變動（不會有第二發把資料洗掉）
  const g1 = await p.evaluate(() => RC_GEN);
  await p.waitForTimeout(250);
  const g2 = await p.evaluate(() => RC_GEN);
  if (g1 !== g2) throw new Error('RC_GEN 仍在變動，開機請求尚未結束');
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  const IGNORE_BOOT_NET = /script\.google\.com|Failed to load resource|net::ERR_/;   // 開機那一發真的後端請求離線必失敗，不算產品錯誤
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !IGNORE_BOOT_NET.test(m.text())) errors.push('CONSOLE: ' + m.text()); });

  await page.goto('http://localhost:8899/index.html');
  await settleBoot(page);
  await page.evaluate(() => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 'test-token';
    window.CALLS = [];
    window.apiCall = async (payload) => {
      window.CALLS.push(payload);
      switch (payload.action) {
        case 'listQuotePdfs':
          return { ok: true, versions: [
            { quote_no: 'T1', created_at: '2026-07-25T02:00:00.000Z', pdf_url: 'https://drive.google.com/pdf2', doc_url: 'https://drive.google.com/doc2', file_name: '客戶_T1_報價單_v2.pdf', active: true },
            { quote_no: 'T1', created_at: '2026-07-20T02:00:00.000Z', pdf_url: 'https://drive.google.com/pdf1', doc_url: '', file_name: '客戶_T1_報價單_v1.pdf', active: 'FALSE' },
          ]};
        case 'generateQuoteDocument':
          return { ok: true, pdfBase64: '', docxBase64: '', fileNameBase: 'x' };
        case 'saveInvoicePhotos':
          return { ok: true };
        case 'getOrderStatusList':
          return { ok: true, orders: [{ quote_no: 'T1', status: 'shipped', invoice_photos: 'https://drive.google.com/folder/inv_T1' }] };
        case 'listShipments':
          if (!payload.quote_no) return { ok: true, shipments: [ { id:'SHP-1', quote_no:'T1' }, { id:'SHP-2', quote_no:'T1' } ] };
          return { ok: true, shipments: [
            { id: 'SHP-1', quote_no: 'T1', seq: 1, ship_date_est: '2026-08-01', ship_date_actual: '2026-07-31T16:00:00.000Z', amount: 5000, invoice_last5: '12345', note: '第一批' },
            { id: 'SHP-2', quote_no: 'T1', seq: 2, ship_date_est: '2026-08-15', ship_date_actual: '', amount: '', invoice_last5: '', note: '' },
          ]};
        case 'addShipment': return { ok: true, id: 'SHP-3' };
        case 'updateShipment': return { ok: true };
        default: return { ok: true, quotes: [], orders: [], logs: [] };
      }
    };
  });

  const results = [];
  const check = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);

  /* 迴歸哨兵：確認 settleBoot 真的把開機那一發等完了。
     若沒等（或等法失效），這裡塞進去的資料會在 rcClear() 觸發 onCacheClear 時被清成 null。 */
  await page.evaluate(() => { ORDERS_CACHE = [{ no: '__canary__' }]; SHP_SUM = { __canary__: 1 }; });
  await page.waitForTimeout(1200);
  check('開機 rcClear 競態已結束（快取不會被洗掉）', await page.evaluate(() =>
    ORDERS_CACHE !== null && Array.isArray(ORDERS_CACHE) && ORDERS_CACHE[0] && ORDERS_CACHE[0].no === '__canary__' && !!SHP_SUM));
  await page.evaluate(() => { ORDERS_CACHE = null; SHP_SUM = null; });

  /* ---------- 功能一：產文件視窗 ---------- */
  await page.evaluate(() => { editingQuoteNo = 'T1'; generateOfficialDocument(); });
  await page.waitForTimeout(300);
  check('gd-overlay 開啟', await page.evaluate(() => document.getElementById('gd-overlay').style.display === 'flex'));
  check('預設選保留舊版', await page.evaluate(() => document.querySelector('input[name="gd-ow"]:checked').value === 'keep'));
  const hist = await page.evaluate(() => document.getElementById('gd-history').innerHTML);
  check('歷史版本列出 2 筆', (hist.match(/rec-act-btn/g) || []).length >= 3 && hist.includes('_v2.pdf') && hist.includes('_v1.pdf'));
  check('舊版標「已作廢」', hist.includes('已作廢'));
  check('新版在上（v2 先出現）', hist.indexOf('_v2.pdf') < hist.indexOf('_v1.pdf'));
  // 覆蓋舊版產生 → payload overwrite:true
  await page.evaluate(() => { document.querySelector('input[name="gd-ow"][value="over"]').checked = true; return gendocRun(); });
  await page.waitForTimeout(200);
  check('gendoc 帶 overwrite:true', await page.evaluate(() => {
    const c = window.CALLS.filter(c => c.action === 'generateQuoteDocument').pop();
    return c && c.overwrite === true && c.quoteNo === 'T1';
  }));
  // 預設（保留）→ overwrite:false
  await page.evaluate(() => { document.querySelector('input[name="gd-ow"][value="keep"]').checked = true; return gendocRun(); });
  await page.waitForTimeout(200);
  check('gendoc 預設 overwrite:false', await page.evaluate(() => {
    const c = window.CALLS.filter(c => c.action === 'generateQuoteDocument').pop();
    return c && c.overwrite === false;
  }));
  await page.evaluate(() => closeGendoc());

  /* ---------- 功能二＋三：編輯進度視窗 ---------- */
  await page.evaluate(() => {
    ORDERS_CACHE = [{ no: 'T1', client: '測試客戶', type: '瓶裝', typeKey: 'bottle', total: 10000, quoteDate: '2026-07-01', expiry: '', st: { status: 'shipped', invoice_photos: 'https://drive.google.com/old-link' }, src: 'std' }];
    openOrdEdit('T1');
  });
  check('oe-overlay 開啟', await page.evaluate(() => document.getElementById('oe-overlay').style.display === 'flex'));
  check('既有照片連結顯示', await page.evaluate(() => document.getElementById('oe-invphoto-links').innerHTML.includes('old-link')));
  check('分批區預設收合', await page.evaluate(() => document.getElementById('shp-box').style.display === 'none'));

  // 上傳發票照片（用 canvas 造一張真圖）
  await page.evaluate(async () => {
    const cv = document.createElement('canvas'); cv.width = 40; cv.height = 40;
    cv.getContext('2d').fillRect(0, 0, 40, 40);
    const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
    const f = new File([blob], 'inv1.png', { type: 'image/png' });
    await invPhotosPicked({ target: { files: [f], value: '' } });
  });
  await page.waitForTimeout(300);
  check('saveInvoicePhotos 送出 base64', await page.evaluate(() => {
    const c = window.CALLS.filter(c => c.action === 'saveInvoicePhotos').pop();
    return c && c.quote_no === 'T1' && Array.isArray(c.images) && c.images.length === 1 && c.images[0].data.length > 100 && c.images[0].mime === 'image/jpeg';
  }));
  check('上傳後回填資料夾連結', await page.evaluate(() =>
    document.getElementById('oe-invoice_photos').value.includes('inv_T1') &&
    document.getElementById('oe-invphoto-links').innerHTML.includes('inv_T1')));
  check('儲存進度會帶最新照片連結', await page.evaluate(async () => {
    await saveOrdEdit();
    const c = window.CALLS.filter(c => c.action === 'updateOrderStatus').pop();
    return c && c.fields.invoice_photos.includes('inv_T1');
  }));

  // 分批出貨（saveOrdEdit 關視窗且 loadOrders 清了快取，重設後重開）
  await page.evaluate(() => {
    ORDERS_CACHE = [{ no: 'T1', client: '測試客戶', type: '瓶裝', typeKey: 'bottle', total: 10000, quoteDate: '2026-07-01', expiry: '', st: { status: 'shipped', invoice_photos: 'https://drive.google.com/folder/inv_T1' }, src: 'std' }];
    openOrdEdit('T1');
  });
  await page.evaluate(() => shpToggle());
  await page.waitForTimeout(200);
  check('展開後載入子批 2 筆', await page.evaluate(() => document.querySelectorAll('#shp-body tr[data-shpid]').length === 2));
  check('時間戳日期轉台北（07-31T16Z→08-01）', await page.evaluate(() =>
    document.querySelector('#shp-body tr[data-shpid="SHP-1"] input[data-f="ship_date_actual"]').value === '2026-08-01'));
  check('純日期字串原樣（08-01）', await page.evaluate(() =>
    document.querySelector('#shp-body tr[data-shpid="SHP-1"] input[data-f="ship_date_est"]').value === '2026-08-01'));
  // 列內編輯 → updateShipment
  await page.evaluate(() => {
    const tr = document.querySelector('#shp-body tr[data-shpid="SHP-2"]');
    tr.querySelector('input[data-f="amount"]').value = '3000';
    return shpSaveRow(tr.querySelector('button'));
  });
  await page.waitForTimeout(200);
  check('updateShipment 帶 id+fields', await page.evaluate(() => {
    const c = window.CALLS.filter(c => c.action === 'updateShipment').pop();
    return c && c.id === 'SHP-2' && c.fields.amount === '3000';
  }));
  // 新增一批 → addShipment
  await page.evaluate(() => shpAddRow());
  check('新增列出現且批次=3', await page.evaluate(() => {
    const tr = document.querySelector('#shp-body tr[data-shpid=""]');
    return tr && tr.firstElementChild.textContent.trim() === '3';
  }));
  await page.evaluate(() => {
    const tr = document.querySelector('#shp-body tr[data-shpid=""]');
    tr.querySelector('input[data-f="ship_date_est"]').value = '2026-09-01';
    tr.querySelector('input[data-f="invoice_last5"]').value = '54321';
    return shpSaveRow(tr.querySelector('button'));
  });
  await page.waitForTimeout(200);
  check('addShipment 扁平＋fields 雙格式', await page.evaluate(() => {
    const c = window.CALLS.filter(c => c.action === 'addShipment').pop();
    return c && c.quote_no === 'T1' && c.ship_date_est === '2026-09-01' && c.fields && c.fields.ship_date_est === '2026-09-01' && c.invoice_last5 === '54321';
  }));
  // 末五碼防呆
  await page.evaluate(() => {
    const tr = document.querySelector('#shp-body tr[data-shpid="SHP-1"]');
    tr.querySelector('input[data-f="invoice_last5"]').value = '12';
    return shpSaveRow(tr.querySelector('button'));
  });
  await page.waitForTimeout(100);
  check('末五碼非 5 碼擋下', await page.evaluate(() => {
    const c = window.CALLS.filter(c => c.action === 'updateShipment').pop();
    return c.id !== 'SHP-1';
  }));

  // 徽章
  // shpSaveRow 成功後會背景呼叫 loadOrders()，stub 的 getQuotes 回空陣列 → ORDERS_CACHE 被重建成 []，
  // 所以這裡跟前面幾段一樣先把要檢查的那張單塞回去（原本沒補這一段就是 ORDERS_CACHE[0] undefined 的 crash 來源）。
  await page.evaluate(() => {
    ORDERS_CACHE = [{ no: 'T1', client: '測試客戶', type: '瓶裝', typeKey: 'bottle', total: 10000, quoteDate: '2026-07-01', expiry: '', st: { status: 'shipped', invoice_photos: 'https://drive.google.com/folder/inv_T1' }, src: 'std' }];
  });
  await page.evaluate(async () => { await loadShipmentBadges(); });
  check('訂單列徽章 分批×2', await page.evaluate(() => {
    return orderBadges(ORDERS_CACHE[0]).includes('分批×2');
  }));

  /* ---------- 手機版不溢出 ---------- */
  const mob = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mob.goto('http://localhost:8899/index.html');
  await settleBoot(mob);
  await mob.evaluate(() => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 't'; window.apiCall = async () => ({ ok: true, versions: [], orders: [], shipments: [] });
    editingQuoteNo = 'T1'; generateOfficialDocument();
  });
  await mob.waitForTimeout(200);
  check('手機版 gd-overlay 無橫向溢出', await mob.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await mob.evaluate(() => {
    closeGendoc();
    ORDERS_CACHE = [{ no: 'T1', client: 'c', typeKey: 'bottle', total: 1, quoteDate: '2026-07-01', st: null, src: 'std' }];
    openOrdEdit('T1'); shpToggle();
  });
  await mob.waitForTimeout(200);
  check('手機版 oe-overlay＋分批區無橫向溢出', await mob.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));

  results.forEach(r => console.log(r[0], r[1]));
  const fails = results.filter(r => r[0] === 'FAIL').length;
  console.log(errors.length ? 'JS ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(fails === 0 && errors.length === 0 ? 'ALL PASS' : `${fails} FAIL`);
  await browser.close();
  process.exit(fails === 0 ? 0 : 1);
})();
