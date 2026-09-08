/* 2026-09-07（第五批）：Molly「我已經產出過出貨單且完成出貨了，訂單進度卻沒有跟著更改」。
   查證後其實是兩個獨立問題：
   ①【資料沒存到】`saveVerifyFormRecord()` 開頭 `if(!AUTH_TOKEN) return;` **完全不出聲**，
     但 PDF 照樣印得出來（20260806 早於 20260813，不需 QR 驗證碼，vfKeyReady 直接放行）
     → 她拿到列印好的驗收單、以為存好了，實際上整筆沒進資料庫（後端 summary 該單停在 9/2）。
     改成明確 toast 擋下並說怎麼補救。
   ②【存到了也不會推進度】訂單七關（orderSteps／effOrdStatus）**只看主線 `st.ship_date_actual`**，
     而驗收單流程從來沒人寫那個欄位（shpSyncFromVerify 只寫 order_shipments）
     → 新增 `ordSyncShippedFromVerify()`：這次出完後每項待出貨歸零才把主線實際出貨日填上去。
   ③ 順便（Molly 選的）：還沒出完時，編輯進度的出貨那一關標「已出 182/224」。
   這支測試切回未修版本會 FAIL（三支新函式不存在、時間軸沒有數字、沒登入時不出聲）。 */
const { chromium } = require('playwright');

async function run() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.route('**/script.google.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, users: [], list: [] }) }));

  await page.goto('http://localhost:8899/index.html');
  await page.waitForFunction(() => {
    const s = document.getElementById('login-user');
    return s && s.options && s.options.length > 0 && s.options[0].textContent.indexOf('載入中') === -1;
  }, { timeout: 15000 }).catch(() => {});

  const results = [];
  const check = (name, cond, info) => { results.push({ name, pass: !!cond, info }); };

  // ── 1. vfRemainOf：待出貨總數
  const r1 = await page.evaluate(() => {
    if (typeof vfRemainOf !== 'function') return { missing: true };
    return {
      done:    vfRemainOf([{ ordered: 224, shipped: 182, thisShip: 42 }]),      // 剛好出完 → 0
      partial: vfRemainOf([{ ordered: 224, shipped: 110, thisShip: 72 }]),      // 還差 42
      multi:   vfRemainOf([{ ordered: 10, shipped: 0, thisShip: 10 }, { ordered: 5, shipped: 0, thisShip: 3 }]), // 還差 2
      over:    vfRemainOf([{ ordered: 10, shipped: 0, thisShip: 12 }]),          // 出超過也算出完 → 0
      feeRow:  vfRemainOf([{ ordered: 10, shipped: 0, thisShip: 10 }, { name: '運費' }]), // 沒 ordered 的列不影響
      none:    vfRemainOf([{ name: '運費' }]),                                   // 沒有可判斷的品項 → null
      empty:   vfRemainOf([]),
    };
  });
  check('1 全部出完時待出貨＝0', !r1.missing && r1.done === 0 && r1.over === 0, JSON.stringify(r1));
  check('2 還沒出完時算得出剩幾瓶', !r1.missing && r1.partial === 42 && r1.multi === 2, JSON.stringify(r1));
  check('3 沒有訂購數的列（運費等）不影響判斷；完全沒品項回 null（不亂推進度）',
    !r1.missing && r1.feeRow === 0 && r1.none === null && r1.empty === null, JSON.stringify(r1));

  // ── 2. ordSyncShippedFromVerify：只有出完才推進主線
  const r2 = await page.evaluate(async () => {
    if (typeof ordSyncShippedFromVerify !== 'function') return { missing: true };
    const calls = [];
    const origApi = window.apiCall, origLoad = window.loadOrders, origToast = window.toast;
    window.apiCall = async (p) => { calls.push(p); return { ok: true }; };
    window.loadOrders = async () => {};
    window.toast = () => {};
    AUTH_TOKEN = 'tk';
    ORDERS_CACHE = [{ no: 'A-1', client: '酒肉朋友', st: {} },
                    { no: 'A-2', client: '已填過', st: { ship_date_actual: '2026-09-07' } }];

    await ordSyncShippedFromVerify({ no: 'A-1', shipDate: '2026-09-07', rows: [{ ordered: 224, shipped: 110, thisShip: 72 }] });
    const afterPartial = calls.filter(c => c.action === 'updateOrderStatus').length;

    await ordSyncShippedFromVerify({ no: 'A-1', shipDate: '2026-09-07', rows: [{ ordered: 224, shipped: 182, thisShip: 42 }] });
    const upd = calls.filter(c => c.action === 'updateOrderStatus');

    // 重印同一張（主線已經是同一天）→ 不該再打一次
    const before = calls.length;
    await ordSyncShippedFromVerify({ no: 'A-2', shipDate: '2026-09-07', rows: [{ ordered: 10, shipped: 0, thisShip: 10 }] });
    const reprintCalls = calls.length - before;

    // 沒登入 → 不打任何 API
    AUTH_TOKEN = '';
    const before2 = calls.length;
    await ordSyncShippedFromVerify({ no: 'A-1', shipDate: '2026-09-08', rows: [{ ordered: 10, shipped: 0, thisShip: 10 }] });
    const loggedOutCalls = calls.length - before2;

    AUTH_TOKEN = 'tk';
    window.apiCall = origApi; window.loadOrders = origLoad; window.toast = origToast;
    return { afterPartial, upd, reprintCalls, loggedOutCalls, cacheDate: (ORDERS_CACHE.find(x => x.no === 'A-1').st || {}).ship_date_actual };
  });
  check('4 還沒出完 → 完全不動訂單主線', !r2.missing && r2.afterPartial === 0, JSON.stringify(r2));
  check('5 出完了 → 用 updateOrderStatus 把實際出貨日填成這次的配送日',
    !r2.missing && r2.upd.length === 1 && r2.upd[0].quote_no === 'A-1' && r2.upd[0].fields.ship_date_actual === '2026-09-07'
    && !!r2.upd[0].token, JSON.stringify(r2));
  check('6 畫面手上那份也同步更新（不用等重抓）', !r2.missing && r2.cacheDate === '2026-09-07', JSON.stringify(r2));
  check('7 重印同一次出貨（日期沒變）不會再打一次 API', !r2.missing && r2.reprintCalls === 0, JSON.stringify(r2));
  check('8 沒登入時不打 API（不會把錯誤資料寫進去）', !r2.missing && r2.loggedOutCalls === 0, JSON.stringify(r2));

  // ── 3. 填了實際出貨日 → 七關真的推進到「已出貨」
  const r3 = await page.evaluate(() => {
    const before = { st: effOrdStatus({ status: 'production', deposit_date: '2026-08-11' }),
                     ship: orderSteps({ status: 'production', deposit_date: '2026-08-11' }).find(x => x.key === 'ship').done };
    const st2 = { status: 'production', deposit_date: '2026-08-11', ship_date_actual: '2026-09-07' };
    return { before, after: { st: effOrdStatus(st2), ship: orderSteps(st2).find(x => x.key === 'ship').done } };
  });
  check('9 填上實際出貨日後，狀態自動變「已出貨」、出貨那一關打勾',
    r3.before.st === 'production' && r3.before.ship === false && r3.after.st === 'shipped' && r3.after.ship === true, JSON.stringify(r3));

  // ── 4. 還沒出完時，編輯進度顯示「已出 182/224」
  const r4 = await page.evaluate(() => {
    if (typeof ordShipProgress !== 'function') return { missing: true };
    ORDER_VSUM = { forms: {}, reps: {}, repList: [], lots: {},
      ship: { 'A-1': { ordered: 224, shipped: 182 }, 'A-9': { ordered: 100, shipped: 100 }, 'A-8': { ordered: null, shipped: 5 } } };
    const html = orderTimelineHtml({ no: 'A-1', quoteDate: '2026-08-06', st: { status: 'production', deposit_date: '2026-08-11', ship_date_est: '2026-08-31' } });
    const htmlDone = orderTimelineHtml({ no: 'A-9', quoteDate: '2026-08-06', st: { status: 'production', ship_date_est: '2026-08-31' } });
    return {
      partial: ordShipProgress('A-1'), full: ordShipProgress('A-9'), noOrdered: ordShipProgress('A-8'), unknown: ordShipProgress('ZZ'),
      hasNum: html.indexOf('已出 182/224') >= 0, doneHasNum: htmlDone.indexOf('已出') >= 0,
      estStillShown: orderTimelineHtml({ no: 'ZZ', quoteDate: '2026-08-06', st: { status: 'production', ship_date_est: '2026-08-31' } }).indexOf('預計 08-31') >= 0,
    };
  });
  check('10 還沒出完 → 出貨那一關標「已出 182/224」', !r4.missing && r4.hasNum && r4.partial && r4.partial.shipped === 182, JSON.stringify(r4));
  check('11 已經出完／訂購數不明／沒留底 → 不顯示數字（不會出現 100/100 這種廢話）',
    !r4.missing && r4.full === null && r4.noOrdered === null && r4.unknown === null && !r4.doneHasNum, JSON.stringify(r4));
  check('12 沒有留底的單，原本的「預計 08-31」照常顯示（沒被我蓋掉）', !r4.missing && r4.estStillShown, JSON.stringify(r4));

  // ── 5. 沒登入時，驗收單留底不再「安靜地不存」
  const r5 = await page.evaluate(() => {
    const toasts = [];
    const origToast = window.toast, origApi = window.apiCall;
    window.toast = (m, t) => { toasts.push(String(m) + '|' + (t || '')); };
    let apiCalled = 0; window.apiCall = async () => { apiCalled++; return { ok: true }; };
    AUTH_TOKEN = '';
    saveVerifyFormRecord({ no: 'A-1', shipDate: '2026-09-07', rows: [{ ordered: 10, thisShip: 10 }] });
    AUTH_TOKEN = 'tk';
    window.toast = origToast; window.apiCall = origApi;
    return { toasts, apiCalled };
  });
  check('13 沒登入按「產生」→ 明確告知沒留底（不再安靜跳過）',
    r5.toasts.length === 1 && /沒有登入/.test(r5.toasts[0]) && /沒有.*留底|沒有」留底|「沒有」/.test(r5.toasts[0]) && /err/.test(r5.toasts[0]), JSON.stringify(r5));
  check('14 沒登入時不會硬打 saveVerifyForm', r5.apiCalled === 0, JSON.stringify(r5));

  await browser.close();
  const fails = results.filter(x => !x.pass);
  results.forEach(x => console.log((x.pass ? 'PASS' : 'FAIL') + ' ' + x.name + (x.pass ? '' : '   → ' + x.info)));
  console.log(errors.length ? ('JS ERRORS: ' + errors.join(' | ')) : 'NO JS ERRORS');
  console.log(results.length + ' checks');
  console.log(fails.length === 0 ? 'ALL PASS' : (fails.length + ' FAILED'));
  process.exit(fails.length === 0 && errors.length === 0 ? 0 : 1);
}
run();
