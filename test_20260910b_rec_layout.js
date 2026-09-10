/* 2026-09-10：Molly「報價紀錄版面太亂，比起報價單號我更需要顯示 Lot 號方便分辨」。
   ①主欄改成「Lot ／ 客戶」，Lot 放最前面（深色標籤）、單號＋建立者退到第二行小字
   ②Lot 來源：訂單進度 cust_lot → 驗收單留底 lot（ORDER_VSUM.lots）→ 廠務 factory_lot；數字 Lot 正規化成「Lot N」
   ③搜尋框也比對 Lot ④操作分主（開啟／預覽／驗收單）／次（複製／刪除）兩組 ⑤欄數 7→5
   切回未修版本會 FAIL（recLotOf／recLoadLots 不存在、表頭仍是 7 欄）。 */
const { chromium } = require('playwright');

async function run() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.route('**/script.google.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, users: [], list: [] }) }));
  await page.goto('http://localhost:8899/index.html');
  await page.waitForFunction(() => { const s = document.getElementById('login-user'); return s && s.options && s.options.length > 0 && s.options[0].textContent.indexOf('載入中') === -1; }, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    window.readCall = async () => ({ ok: true, quotes: [], records: [], links: [], orders: [] });
    window.readCallMany = async () => [{ ok: true, quotes: [] }, { ok: true, quotes: [] }];
    AUTH_TOKEN = 'x';
    gotoPage('records');
  });
  await page.waitForTimeout(600);

  const results = [];
  const check = (name, cond, info) => results.push({ name, pass: !!cond, info });

  const r = await page.evaluate(() => {
    if (typeof recLotOf !== 'function' || typeof recLoadLots !== 'function') return { missing: true };
    REC_QUOTES = [
      { quoteNo: '20260910-01', clientName: 'Babyface', quoteType: 'bottle', quoteDate: '2026-09-10', grandTotal: 128400, createdBy: 'Molly' },
      { quoteNo: '20260908-02', clientName: '酒肉朋友', quoteType: 'ownbrand', quoteDate: '2026-09-08', grandTotal: 56000, createdBy: 'Molly', status: '純報價' },
      { quoteNo: '20260905-01', clientName: '', quoteType: 'banquet', quoteDate: '2026-09-05', grandTotal: 32000, createdBy: 'Vic' },
      { quoteNo: '20260828-01', clientName: '有趣市集', quoteType: 'ownlabel', quoteDate: '2026-08-28', grandTotal: 74200, createdBy: '阿軒' },
      { quoteNo: '20260820-01', clientName: '廠務客', quoteType: 'bottle', quoteDate: '2026-08-20', grandTotal: 1000, createdBy: 'Molly' },
    ];
    REC_CUSTOM = [{ quote_no: '20260903-05', client: '日光23', quote_date: '2026-09-03', totals_json: '{"total":9900}' }];
    REC_OS = { '20260910-01': { cust_lot: 'Lot 15' }, '20260908-02': { cust_lot: '1' }, '20260828-01': { cust_lot: '' } };
    ORDER_VSUM = { forms: {}, reps: {}, repList: [], lots: { '20260828-01': '3', '20260908-02': '99' }, ship: {} };
    FX_LINKS = { '20260820-01': { factory_order_no: 'F1', factory_lot: '7' } };
    document.getElementById('rec-search').value = '';
    renderRecords();
    const rows = [...document.querySelectorAll('#rec-body tr')];
    const row = no => rows.find(tr => tr.textContent.includes(no));
    const lotOf = no => { const e = row(no).querySelector('.rec-lot'); return e ? e.textContent : ''; };
    const out = {
      ths: [...document.querySelectorAll('#page-records thead th')].map(t => t.textContent.trim()),
      cols: rows[0].children.length,
      lot15: lotOf('20260910-01'), lot1: lotOf('20260908-02'), lot3: lotOf('20260828-01'), lotFx: lotOf('20260820-01'),
      noLot: lotOf('20260905-01'), customLot: lotOf('20260903-05'),
      subMolly: row('20260910-01').querySelector('.rec-sub').textContent,
      subCustom: row('20260903-05').querySelector('.rec-sub').textContent,
      warn: !!row('20260905-01').querySelector('.rec-warn'),
      qo: row('20260908-02').querySelector('.rec-badge.qo') != null,
      primaryBtns: [...row('20260910-01').querySelectorAll('.rec-act-grp:not(.rec-act-sec) button')].map(b => b.textContent),
      secBtns: [...row('20260910-01').querySelectorAll('.rec-act-sec button')].map(b => b.textContent),
      banquetBtns: [...row('20260905-01').querySelectorAll('button')].map(b => b.textContent),
      customBtns: [...row('20260903-05').querySelectorAll('button')].map(b => b.textContent),
      total: row('20260910-01').querySelector('.rec-total').textContent,
    };
    document.getElementById('rec-search').value = '15'; renderRecords();
    out.search15 = [...document.querySelectorAll('#rec-body tr')].map(tr => tr.querySelector('.rec-sub').textContent.slice(0, 11));
    document.getElementById('rec-search').value = 'lot 3'; renderRecords();
    out.searchLot3 = [...document.querySelectorAll('#rec-body tr')].map(tr => tr.querySelector('.rec-sub').textContent.slice(0, 11));
    document.getElementById('rec-search').value = ''; renderRecords();
    return out;
  });

  check('1 recLotOf／recLoadLots 存在，表頭 5 欄且第一欄是「Lot ／ 客戶」', !r.missing && r.cols === 5 && r.ths.length === 5 && /^Lot ／ 客戶/.test(r.ths[0]), JSON.stringify(r.ths));
  check('2 訂單進度手動填的客戶批號優先顯示', !r.missing && r.lot15 === 'Lot 15', r.lot15);
  check('3 純數字 Lot 正規化成「Lot 1」，且手動填的優先於驗收單留底（99）', !r.missing && r.lot1 === 'Lot 1', r.lot1);
  check('4 手動沒填時退回驗收單留底的 lot', !r.missing && r.lot3 === 'Lot 3', r.lot3);
  check('5 兩者都沒有時退回廠務 factory_lot', !r.missing && r.lotFx === 'Lot 7', r.lotFx);
  check('6 沒有任何 Lot 的單不會冒出空標籤（自訂單也一樣）', !r.missing && r.noLot === '' && r.customLot === '', JSON.stringify([r.noLot, r.customLot]));
  check('7 單號＋建立者退到第二行；自訂單只有單號', !r.missing && /20260910-01.*Molly/.test(r.subMolly) && r.subCustom.trim() === '20260903-05', JSON.stringify([r.subMolly, r.subCustom]));
  check('8 未填客戶名稱仍標紅、純報價標籤仍在', !r.missing && r.warn && r.qo, JSON.stringify([r.warn, r.qo]));
  check('9 操作分兩組：主＝開啟/預覽/驗收單，次＝複製/刪除', !r.missing && r.primaryBtns.join() === '開啟,預覽,驗收單' && r.secBtns.join() === '複製,刪除', JSON.stringify([r.primaryBtns, r.secBtns]));
  check('10 宴會單沒有驗收單鈕；自訂單只有開啟/預覽/刪除', !r.missing && r.banquetBtns.join() === '開啟,預覽,複製,刪除' && r.customBtns.join() === '開啟,預覽,刪除', JSON.stringify([r.banquetBtns, r.customBtns]));
  check('11 搜尋「15」找得到 Lot 15 那張（單號不含 15）', !r.missing && r.search15.length === 1 && r.search15[0] === '20260910-01', JSON.stringify(r.search15));
  check('12 搜尋「lot 3」不分大小寫找到 Lot 3', !r.missing && r.searchLot3.length === 1 && r.searchLot3[0] === '20260828-01', JSON.stringify(r.searchLot3));
  check('13 總計仍用 money() 格式', !r.missing && r.total === '$128,400', r.total);
  check('14 無 pageerror', errors.length === 0, errors.join(' | '));

  await browser.close();
  let pass = 0;
  results.forEach(x => { console.log((x.pass ? '✅ ' : '❌ ') + x.name + (x.pass ? '' : '  → ' + (x.info || ''))); if (x.pass) pass++; });
  console.log(`\n${pass}/${results.length} 通過`);
  process.exit(pass === results.length ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
