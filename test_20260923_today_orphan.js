/* 2026-09-23：今日待辦「今天／逾期要出貨」出現找不到的單。
   ①報價單已刪除／不存在的單號（order_status 殘留）不列；②已結案（closed_at）的單不再長「尚餘 N 待出貨」；
   ③真的還沒出完的單照列；④ORDERS_CACHE 還沒載好時不過濾。 */
const { chromium } = require('playwright');
async function run() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  page.route('**/script.google.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, users: [], list: [] }) }));
  await page.goto('http://localhost:8899/index.html');
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    AUTH_TOKEN = 'x';
    const orders = [
      { no: '20260701-01', client: 'Babyface', st: { status: 'paid', ship_date_est: '2026-07-27', closed_at: '2026-08-18' } },
      { no: '20260812-01', client: '好野吧', st: { status: 'production', ship_date_est: '2026-09-09' } },
    ];
    const ships = [
      { quote_no: '20260701-01', ship_date_actual: '2026-07-27' },
      { quote_no: '20260812-01', ship_date_actual: '2026-09-10' },
    ];
    shpAllList = () => ships;
    shpBatchesOf = no => ships.filter(s => s.quote_no === no);
    ordShipProgress = no => no === '20260701-01' ? { ordered: 912, shipped: 662 } : { ordered: 126, shipped: 46 };
    const digest = { ok: true, ship_due: [
      { quote_no: '20260728-04', client: 'babyface', plan_ship_date: '2026-08-11', overdue_days: 43, urgent: true },
      { quote_no: '20260817-01', client: '', plan_ship_date: '2026-08-17', overdue_days: 37, urgent: true },
    ], final_due: [{ quote_no: '20260817-01', client: '', final_amt: 1, urgent: true }], no_scan: [], no_invoice: [], calendar: [], warnings: [] };
    const out = {};
    // 未載好：不過濾
    ORDERS_CACHE = null;
    out.beforeLoad = tdShipDueRows(digest.ship_due).filter(tdKnownOrderFilter()).map(x => x.quote_no);
    ORDERS_CACHE = orders;
    out.rows = tdShipDueRows(digest.ship_due).filter(tdKnownOrderFilter()).map(x => x.quote_no + '|' + (x.batch_label || ''));
    out.babyPts = orderShipPoints(orders[0]).filter(p => p.pending).length;
    out.hyPts = orderShipPoints(orders[1]).filter(p => p.pending).length;
    // 取消的單也不長
    out.cancelPts = orderShipPoints({ no: '20260812-01', st: { status: 'cancelled', ship_date_est: '2026-09-09' } }).filter(p => p.pending).length;
    TD_DATA = digest; if (!document.getElementById('td-body')) { const d = document.createElement('div'); d.id = 'td-body'; document.body.appendChild(d); }
    if (!document.getElementById('td-warn')) { const d = document.createElement('div'); d.id = 'td-warn'; document.body.appendChild(d); }
    renderToday();
    out.html = document.getElementById('td-body').innerText;
    return out;
  });
  const T = [];
  T.push({ name: '未載好訂單清單時不過濾（兩筆殘留照列）', pass: r.beforeLoad.includes('20260728-04') && r.beforeLoad.includes('20260817-01'), info: JSON.stringify(r.beforeLoad) });
  T.push({ name: '已刪除 20260728-04 不列', pass: !r.rows.some(x => x.startsWith('20260728-04')), info: JSON.stringify(r.rows) });
  T.push({ name: '不存在 20260817-01 不列', pass: !r.rows.some(x => x.startsWith('20260817-01')), info: JSON.stringify(r.rows) });
  T.push({ name: '已結案 20260701-01 不再「尚餘待出貨」', pass: r.babyPts === 0 && !r.rows.some(x => x.startsWith('20260701-01')), info: r.babyPts + ' ' + JSON.stringify(r.rows) });
  T.push({ name: '好野吧 20260812-01 還沒出完照列', pass: r.hyPts === 1 && r.rows.some(x => x.startsWith('20260812-01') && x.includes('尚餘 80')), info: JSON.stringify(r.rows) });
  T.push({ name: '已取消的單不長待出貨點', pass: r.cancelPts === 0 });
  T.push({ name: '畫面只剩好野吧、尾款卡也濾掉殘留', pass: r.html.includes('好野吧') && !r.html.includes('20260817-01') && !r.html.includes('20260728-04'), info: r.html.slice(0, 300) });
  T.push({ name: '無 pageerror', pass: errors.length === 0, info: errors.join(' | ') });
  await browser.close();
  let pass = 0; T.forEach(x => { console.log((x.pass ? '✅ ' : '❌ ') + x.name + (x.pass ? '' : '  → ' + (x.info || ''))); if (x.pass) pass++; });
  console.log(`\n${pass}/${T.length} 通過`); process.exit(pass === T.length ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
