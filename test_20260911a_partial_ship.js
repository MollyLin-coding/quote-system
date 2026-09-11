/* 2026-09-11：Molly「好野吧昨天是分批出貨，行事曆卻沒有正確顯示」。
   實際資料：20260812-01 只出了第 1 批（46/126）、order_shipments 只有一筆 → 舊版 total=1 沒有批次標籤，
   月曆上「好野吧 出貨 Lot 34 ✓」看起來像整張出完；主線預計出貨日又被收起來，剩下 80 瓶完全消失。
   修法：①還沒出完的單，最新那批標「（第1批，已出 46/126）」 ②主線有預計日且還沒出完 → 多一顆
   「（尚餘 80 待出貨）」掛在預計日（月曆／今日焦點／今日待辦都看得到，今日焦點給「開驗收單」入口）
   ③出完（ordShipProgress 回 null）就回到原本行為。切回未修版本會 FAIL。 */
const { chromium } = require('playwright');

async function run() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.route('**/script.google.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, users: [], list: [] }) }));
  await page.goto('http://localhost:8899/index.html');
  await page.waitForFunction(() => { const s = document.getElementById('login-user'); return s && s.options && s.options.length > 0 && s.options[0].textContent.indexOf('載入中') === -1; }, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);

  const results = [];
  const check = (name, cond, info) => results.push({ name, pass: !!cond, info });

  const r = await page.evaluate(() => {
    if (typeof orderShipPoints !== 'function' || typeof shpPointLabel !== 'function') return { missing: true };
    const setup = (shipped, batches) => {
      SHP_ALL = batches;
      ORDERS_CACHE = [{ no: 'H-1', client: '好野吧', st: { ship_date_est: '2026-09-09', ship_date_actual: '' } }];
      ORDER_VSUM = { forms: {}, reps: {}, repList: [], lots: {}, ship: { 'H-1': { ordered: 126, shipped } } };
      if (typeof CAL_ITEMS === 'undefined') window.CAL_ITEMS = [];
      CAL_ITEMS.length = 0;
    };
    const one = [{ id: 'S1', quote_no: 'H-1', seq: 1, ship_date_est: '', ship_date_actual: '2026-09-10', note: '[VF:H-1:1] Lot 34 · 配送 10 箱，PM 阿軒' }];
    const out = {};
    // A. 只出一批、還沒出完
    setup(46, one);
    out.A_pts = orderShipPoints(ORDERS_CACHE[0]).map(sp => [sp.date, sp.done, !!sp.pending, shpPointLabel(sp)]);
    out.A_cal10 = eventsOn('2026-09-10').map(e => e.txt);
    out.A_cal09 = eventsOn('2026-09-09').map(e => e.txt);
    if (typeof renderTodayFocus === 'function') renderTodayFocus();
    out.A_focus = (document.getElementById('cal-focus') || {}).innerHTML || '';
    out.A_todo = (typeof tdShipDueRows === 'function') ? tdShipDueRows([]).map(x => [x.quote_no, x.plan_ship_date, x.batch_label]) : [];
    // B. 同一張單出完了（第 2 批補上、主線實際日也填了）
    setup(126, one.concat([{ id: 'S2', quote_no: 'H-1', seq: 2, ship_date_est: '', ship_date_actual: '2026-09-12', note: '[VF:H-1:2] Lot 34' }]));
    ORDERS_CACHE[0].st.ship_date_actual = '2026-09-12';
    out.B_pts = orderShipPoints(ORDERS_CACHE[0]).map(sp => [sp.date, shpPointLabel(sp)]);
    out.B_cal09 = eventsOn('2026-09-09').map(e => e.txt);
    // C. 兩批都出了但還沒出完（90/126），主線預計日還在
    setup(90, one.concat([{ id: 'S2', quote_no: 'H-1', seq: 2, ship_date_est: '', ship_date_actual: '2026-09-12', note: '[VF:H-1:2] Lot 34' }]));
    out.C_labels = orderShipPoints(ORDERS_CACHE[0]).map(sp => shpPointLabel(sp));
    // D. 沒有 ORDER_VSUM（進度還沒載）→ 退回舊行為，不噴錯
    setup(46, one); ORDER_VSUM = null;
    out.D_labels = orderShipPoints(ORDERS_CACHE[0]).map(sp => shpPointLabel(sp));
    // E. 沒分批的單完全不受影響
    SHP_ALL = []; ORDER_VSUM = { forms: {}, reps: {}, repList: [], lots: {}, ship: {} };
    out.E_pts = orderShipPoints({ no: 'X', st: { ship_date_est: '2026-09-20' } }).map(sp => [sp.date, sp.batch, shpPointLabel(sp)]);
    return out;
  });

  check('1 只出一批還沒出完：那一批標「第1批，已出 46/126」，且多一顆「尚餘 80 待出貨」掛在主線預計日 9/9',
    !r.missing && JSON.stringify(r.A_pts) === JSON.stringify([['2026-09-10', true, false, '（第1批，已出 46/126）'], ['2026-09-09', false, true, '（尚餘 80 待出貨）']]), JSON.stringify(r.A_pts));
  check('2 月曆 9/10：好野吧 出貨（第1批，已出 46/126） Lot 34 ✓', !r.missing && r.A_cal10.some(t => t === '🚚 好野吧 出貨（第1批，已出 46/126） Lot 34 ✓'), JSON.stringify(r.A_cal10));
  check('3 月曆 9/9：好野吧 出貨（尚餘 80 待出貨） Lot 34（沒有 ✓）', !r.missing && r.A_cal09.some(t => t === '🚚 好野吧 出貨（尚餘 80 待出貨） Lot 34'), JSON.stringify(r.A_cal09));
  check('4 今日焦點列出「尚餘 80 待出貨」且給「開驗收單」入口（不是打勾）', !r.missing && /尚餘 80 待出貨/.test(r.A_focus) && /開驗收單/.test(r.A_focus) && /openVerifyForm/.test(r.A_focus), (r.A_focus || '').slice(0, 300));
  check('5 今日待辦的「今天／逾期要出貨」有這一筆（掛 9/9）', !r.missing && r.A_todo.some(x => x[0] === 'H-1' && x[1] === '2026-09-09' && /尚餘 80/.test(x[2] || '')), JSON.stringify(r.A_todo));
  check('6 出完了：兩批標「第N批/共2批」、沒有「已出」、也沒有待出貨那一點', !r.missing && JSON.stringify(r.B_pts) === JSON.stringify([['2026-09-10', '（第1批/共2批）'], ['2026-09-12', '（第2批/共2批）']]) && r.B_cal09.length === 0, JSON.stringify([r.B_pts, r.B_cal09]));
  check('7 兩批還沒出完：最新那批標「第2批/共2批，已出 90/126」，前一批不標已出', !r.missing && JSON.stringify(r.C_labels) === JSON.stringify(['（第1批/共2批）', '（第2批/共2批，已出 90/126）', '（尚餘 36 待出貨）']), JSON.stringify(r.C_labels));
  check('8 進度資料還沒載到時退回舊行為（只出一批＝沒標籤）、不噴錯', !r.missing && JSON.stringify(r.D_labels) === JSON.stringify(['']), JSON.stringify(r.D_labels));
  check('9 沒分批的單不受影響', !r.missing && JSON.stringify(r.E_pts) === JSON.stringify([['2026-09-20', false, '']]), JSON.stringify(r.E_pts));
  check('10 無 pageerror', errors.length === 0, errors.join(' | '));

  await browser.close();
  let pass = 0;
  results.forEach(x => { console.log((x.pass ? '✅ ' : '❌ ') + x.name + (x.pass ? '' : '  → ' + (x.info || ''))); if (x.pass) pass++; });
  console.log(`\n${pass}/${results.length} 通過`);
  process.exit(pass === results.length ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
