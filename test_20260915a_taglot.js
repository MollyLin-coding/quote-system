/* 2026-09-15：Molly「昭和浪漫冰室，批次標籤 Lot11 為什麼在清單頁面出不來」。
   根因：報價紀錄清單的 Lot 只看 訂單進度 cust_lot → 驗收單留底 → 廠務 factory_lot，
   從來不讀報價單本身的「批次標籤」（存在品項表 taglabel 列，getQuotes 主表列拿不到）。
   修法：後端 v82 getQuotes 帶回 tagLot；前端 recLotOf 加第④層退回 tagLot。
   切回未修版本會 FAIL（recLotOf 忽略第二參數）。 */
const { chromium } = require('playwright');
async function run() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  page.route('**/script.google.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, users: [], list: [] }) }));
  await page.goto('http://localhost:8899/index.html');
  await page.waitForFunction(() => { const s = document.getElementById('login-user'); return s && s.options && s.options.length > 0 && s.options[0].textContent.indexOf('載入中') === -1; }, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    window.readCall = async () => ({ ok: true, quotes: [], records: [], links: [], orders: [] });
    window.readCallMany = async () => [{ ok: true, quotes: [] }, { ok: true, quotes: [] }];
    AUTH_TOKEN = 'x'; gotoPage('records');
  });
  await page.waitForTimeout(600);
  const results = []; const check = (n, c, i) => results.push({ name: n, pass: !!c, info: i });
  const r = await page.evaluate(() => {
    REC_QUOTES = [
      { quoteNo: '20260912-01', clientName: '昭和浪漫冰室', quoteType: 'bottle', quoteDate: '2026-09-12', grandTotal: 50000, createdBy: 'Molly', tagLot: 'Lot11' },
      { quoteNo: '20260910-01', clientName: 'Babyface', quoteType: 'bottle', quoteDate: '2026-09-10', grandTotal: 1000, createdBy: 'Molly', tagLot: 'Lot 99' },
      { quoteNo: '20260908-01', clientName: '廠務客', quoteType: 'bottle', quoteDate: '2026-09-08', grandTotal: 1000, createdBy: 'Molly', tagLot: '12' },
      { quoteNo: '20260905-01', clientName: '舊後端單', quoteType: 'bottle', quoteDate: '2026-09-05', grandTotal: 1000, createdBy: 'Molly' },
      { quoteNo: '20260901-01', clientName: '標籤只填客戶名', quoteType: 'bottle', quoteDate: '2026-09-01', grandTotal: 1000, createdBy: 'Molly', tagLot: '' },
    ];
    REC_CUSTOM = [];
    REC_OS = { '20260910-01': { cust_lot: 'Lot 15' } };
    ORDER_VSUM = { forms: {}, reps: {}, repList: [], lots: {}, ship: {} };
    FX_LINKS = { '20260908-01': { factory_order_no: 'F1', factory_lot: '7' } };
    document.getElementById('rec-search').value = ''; renderRecords();
    const rows = [...document.querySelectorAll('#rec-body tr')];
    const row = no => rows.find(tr => tr.textContent.includes(no));
    const lotOf = no => { const e = row(no).querySelector('.rec-lot'); return e ? e.textContent : ''; };
    const out = { sh: lotOf('20260912-01'), manualWins: lotOf('20260910-01'), fxWins: lotOf('20260908-01'), old: lotOf('20260905-01'), empty: lotOf('20260901-01') };
    document.getElementById('rec-search').value = '11'; renderRecords();
    out.search11 = [...document.querySelectorAll('#rec-body tr')].map(tr => tr.querySelector('.rec-sub').textContent.slice(0, 11));
    document.getElementById('rec-search').value = ''; renderRecords();
    return out;
  });
  check('1 三來源都空時退回批次標籤：昭和浪漫冰室顯示 Lot 11（Lot11 正規化）', r.sh === 'Lot 11', r.sh);
  check('2 訂單進度手動批號仍優先於批次標籤', r.manualWins === 'Lot 15', r.manualWins);
  check('3 廠務 factory_lot 仍優先於批次標籤', r.fxWins === 'Lot 7', r.fxWins);
  check('4 舊後端沒帶 tagLot 的單行為照舊（不冒空標籤）', r.old === '', r.old);
  check('5 批次標籤只填客戶名（tagLot 空）不冒空標籤', r.empty === '', r.empty);
  check('6 搜尋「11」找得到昭和那張', r.search11.length === 1 && r.search11[0] === '20260912-01', JSON.stringify(r.search11));
  check('7 無 pageerror', errors.length === 0, errors.join(' | '));
  await browser.close();
  let pass = 0; results.forEach(x => { console.log((x.pass ? '✅ ' : '❌ ') + x.name + (x.pass ? '' : '  → ' + (x.info || ''))); if (x.pass) pass++; });
  console.log(`\n${pass}/${results.length} 通過`); process.exit(pass === results.length ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
