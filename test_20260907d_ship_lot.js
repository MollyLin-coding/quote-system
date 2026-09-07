/* 2026-09-07（第四批）：Molly「出貨要顯示Lot號」。
   ⚠ `order_shipments` 表沒有 lot 欄位——Lot 只存在驗收單留底裡。所以作法是：
   ①`shpSyncFromVerify()` 同步時把 Lot 一起寫進 `note`（「[VF:單號:第幾次] Lot 3 · 配送 5 箱，PM Vic」）
   ②顯示時用 `shpLotOf()` 從 note 解析回來，跟批次標籤一起包成共用的 `shpPointSuffix()`
   ③月曆、今日焦點、今日待辦三邊都改用 `shpPointSuffix()`（同一份規則，不各寫一份）
   ⚠ 留底的 lot 有時是字串「Lot 17」、有時是純數字 1／15（Molly 兩種都打過）→ `shpLotText()` 要正規化。
   這支測試切回未修版本會 FAIL（shpLotText／shpLotOf／shpPointSuffix 不存在、事件文字沒有 Lot）。 */
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

  // ── 1. Lot 正規化與解析
  const r1 = await page.evaluate(() => {
    const guard = f => (typeof window[f] === 'function');
    if (!guard('shpLotText') || !guard('shpLotOf') || !guard('shpPointSuffix')) return { missing: true };
    return {
      text: {
        num: shpLotText(1),              // 純數字 → 補 Lot
        num15: shpLotText(15),
        str: shpLotText('Lot 17'),       // 已經有 Lot 前綴 → 不重複
        lower: shpLotText('lot 8'),      // 小寫也要正規化成 Lot
        empty: shpLotText(''),           // 空 → 空字串
        nul: shpLotText(null),
      },
      parse: {
        withBoxes: shpLotOf({ note: '[VF:20260806-01:1] Lot 3 · 配送 5 箱，PM Vic' }),
        lotOnly:   shpLotOf({ note: '[VF:X:1] Lot 17' }),
        manual:    shpLotOf({ note: '手動補的備註 Lot 9，順便記一下' }),   // 手打的備註也認得
        none:      shpLotOf({ note: '[VF:X:1] · 配送 2 箱' }),            // 沒 Lot → 空
        blank:     shpLotOf({ note: '' }),
      },
      suffix: {
        batchAndLot: shpPointSuffix({ batch: true, seq: 2, total: 3, note: '[VF:A:2] Lot 3 · 配送 1 箱' }),
        lotOnly:     shpPointSuffix({ batch: true, seq: 1, total: 1, note: '[VF:A:1] Lot 5' }),
        batchOnly:   shpPointSuffix({ batch: true, seq: 1, total: 2, note: '[VF:A:1] · 配送 1 箱' }),
        neither:     shpPointSuffix({ batch: false, seq: 0, total: 0, note: '' }),
      },
    };
  });

  check('1 純數字的 Lot 會自動補上「Lot 」前綴', !r1.missing && r1.text.num === 'Lot 1' && r1.text.num15 === 'Lot 15', JSON.stringify(r1.text));
  check('2 已經寫成「Lot 17」的不會變成「Lot Lot 17」', !r1.missing && r1.text.str === 'Lot 17' && r1.text.lower === 'Lot 8', JSON.stringify(r1.text));
  check('3 沒填 Lot 就回空字串（不會冒出「Lot 」或「Lot null」）', !r1.missing && r1.text.empty === '' && r1.text.nul === '', JSON.stringify(r1.text));
  check('4 從 note 解析得回 Lot（含後面還接了箱數／PM 的情況）', !r1.missing && r1.parse.withBoxes === 'Lot 3' && r1.parse.lotOnly === 'Lot 17', JSON.stringify(r1.parse));
  check('5 手動在「分批出貨」自己打的備註寫了 Lot 也認得', !r1.missing && r1.parse.manual === 'Lot 9', JSON.stringify(r1.parse));
  check('6 note 沒有 Lot 時不會亂抓', !r1.missing && r1.parse.none === '' && r1.parse.blank === '', JSON.stringify(r1.parse));
  check('7 批次＋Lot 一起顯示；只有其中一個時不會多出空白或括號', !r1.missing
    && r1.suffix.batchAndLot === '（第2批/共3批） Lot 3'
    && r1.suffix.lotOnly === ' Lot 5'          // 只出過一次貨 → 沒有批次標籤，只有 Lot
    && r1.suffix.batchOnly === '（第1批/共2批）'
    && r1.suffix.neither === '', JSON.stringify(r1.suffix));

  // ── 2. 同步時真的把 Lot 寫進 note
  const r2 = await page.evaluate(async () => {
    if (typeof shpSyncFromVerify !== 'function') return { missing: true };
    const calls = [];
    const origApi = window.apiCall, origLoad = window.loadShipmentBadges;
    window.apiCall = async (p) => { calls.push(p); return { ok: true, shipments: [] }; };
    window.loadShipmentBadges = () => {};
    SHP_ALL = [];
    await shpSyncFromVerify({ no: 'Q-1', shipSeq: 2, shipDate: '2026-09-07', lot: 3, boxes: 5, shipper: 'Vic' });
    await shpSyncFromVerify({ no: 'Q-2', shipSeq: 1, shipDate: '2026-09-07', lot: 'Lot 17', boxes: '', shipper: '' });
    await shpSyncFromVerify({ no: 'Q-3', shipSeq: 1, shipDate: '2026-09-07', lot: '', boxes: 2, shipper: '' });
    window.apiCall = origApi; window.loadShipmentBadges = origLoad;
    return { notes: calls.filter(c => c.action === 'addShipment').map(c => (c.fields && c.fields.note) || '') };
  });
  check('8 同步時 Lot 有寫進 note（數字 Lot 也正規化）', !r2.missing && /^\[VF:Q-1:2\] Lot 3 · 配送 5 箱，PM Vic$/.test(r2.notes[0] || ''), JSON.stringify(r2.notes));
  check('9 字串型 Lot 照原樣、沒箱數沒 PM 也不會多出符號', !r2.missing && r2.notes[1] === '[VF:Q-2:1] Lot 17', JSON.stringify(r2.notes));
  check('10 沒填 Lot 時 note 不會出現空的「Lot」', !r2.missing && r2.notes[2] === '[VF:Q-3:1] · 配送 2 箱' && !/Lot/.test(r2.notes[2] || ''), JSON.stringify(r2.notes));

  // ── 3. 月曆／今日焦點／今日待辦三邊都看得到 Lot
  const r3 = await page.evaluate(async () => {
    /* ⚠ SHP_ALL／ORDERS_CACHE 是 script-scope 變數，要「直接賦值」才會蓋到頁面用的那個；
       寫 window.SHP_ALL=… 會建立另一個不同的綁定，頁面完全讀不到（第一版就是這樣全空）。 */
    SHP_ALL = [
      { id: 'S1', quote_no: 'B-1', seq: 1, ship_date_est: '2026-09-07', ship_date_actual: '', note: '[VF:B-1:1] Lot 3 · 配送 5 箱' },
      { id: 'S2', quote_no: 'B-1', seq: 2, ship_date_est: '2026-09-20', ship_date_actual: '', note: '[VF:B-1:2] Lot 4' },
    ];
    ORDERS_CACHE = [{ no: 'B-1', client: '滿枝枒｜華山', st: { ship_date_est: '2026-09-20' } }];
    if (typeof CAL_ITEMS === 'undefined') window.CAL_ITEMS = [];
    CAL_ITEMS.length = 0;
    const cal = (typeof eventsOn === 'function') ? eventsOn('2026-09-07').map(e => e.txt) : [];
    if (typeof renderTodayFocus === 'function') renderTodayFocus();
    const focus = (document.getElementById('cal-focus') || {}).innerHTML || '';
    const todo = (typeof tdShipDueRows === 'function') ? tdShipDueRows([]) : [];
    return { cal, focusHasLot: focus.indexOf('Lot 3') >= 0, todoLabels: todo.map(x => x.batch_label) };
  });
  check('11 月曆的出貨事件顯示 Lot（含批次標籤）', (r3.cal || []).some(t => /🚚 滿枝枒 出貨（第1批\/共2批） Lot 3/.test(t)), JSON.stringify(r3.cal));
  check('12 今日焦點的出貨提醒也顯示 Lot', r3.focusHasLot, 'focus 沒找到 Lot 3');
  check('13 今日待辦的出貨列也顯示 Lot', (r3.todoLabels || []).some(l => /Lot 3/.test(l || '')), JSON.stringify(r3.todoLabels));

  await browser.close();
  const fails = results.filter(x => !x.pass);
  results.forEach(x => console.log((x.pass ? 'PASS' : 'FAIL') + ' ' + x.name + (x.pass ? '' : '   → ' + x.info)));
  console.log(errors.length ? ('JS ERRORS: ' + errors.join(' | ')) : 'NO JS ERRORS');
  console.log(results.length + ' checks');
  console.log(fails.length === 0 ? 'ALL PASS' : (fails.length + ' FAILED'));
  process.exit(fails.length === 0 && errors.length === 0 ? 0 : 1);
}
run();
