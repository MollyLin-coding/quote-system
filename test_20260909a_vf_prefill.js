/* 2026-09-07 Molly 要求、2026-09-09 上線（第六批）：Molly「驗收單如是分批出貨預設帶入第一批資訊(可供修改),不要每次都須打一次」。
   查證現況：開驗收單時本來就會自動帶「已出貨／本次出貨數量」「第幾次出貨」「客戶批號（從訂單追蹤）」
   「PM（localStorage 記的上一次）」，但**每一列的製造日期永遠是空的（`mfg:''` 寫死）**、
   **總箱數也永遠是空的**——所以分批出貨每一次都要重打這兩樣。
   修法：第 2 次以後出貨時，從**第一張**留底帶入 製造日期＋我方批號（逐列比對品名＋容量）、
   總箱數、PM、客戶批號；全部可改。
   ⚠ 配送日期**不帶**（那是「這次哪天出的」，沿用舊的會把出貨日記錯）；數量也不覆蓋（本來就有更聰明的算法）。
   這支測試切回未修版本會 FAIL（製造日期／批號／箱數都是空的）。 */
const { chromium } = require('playwright');

const QUOTE = { ok:true, quote:{ quoteNo:'Q-1', clientName:'酒肉朋友', items:[
  { itemType:'bottle', name:'梨香蜜桃紅烏龍調酒', volume:'500', qty:224, lot:'' },
] } };

function vfRecord(id, created, ship, over){
  return Object.assign({ id, no:'Q-1', created_at:created, ship_date:ship, lot:'CUST-1', pm:'Vic', boxes:6,
    items:[{ name:'梨香蜜桃紅烏龍調酒', vol:'500', mfg:'2026-08-20', lot:'L-9', thisShip:50, ordered:224, shipped:0 }] }, over||{});
}

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

  // 共用：mock readCall／apiCall，開一次驗收單，回傳畫面上的值
  const openWith = async (records) => page.evaluate(async ({ quote, records }) => {
    AUTH_TOKEN = 'tk';
    const origRead = window.readCall, origApi = window.apiCall, origToast = window.toast, origLoadSt = window.loadStorage;
    const toasts = [];
    window.toast = (m) => toasts.push(String(m));
    window.loadStorage = async () => {};
    window.readCall = async (p) => {
      if (p.action === 'getQuoteById') return quote;
      if (p.action === 'listVerifyForms') return { ok: true, records };
      return { ok: true };
    };
    window.apiCall = async () => ({ ok: true, k: 'kk' });
    await openVerifyForm('Q-1');
    const v = id => { const e = document.getElementById(id); return e ? e.value : null; };
    const rowVal = k => { const e = document.querySelector(`#vf-body .vfi[data-k="${k}"]`); return e ? e.value : null; };
    const out = { lot: v('vf-lot'), shipdate: v('vf-shipdate'), shipper: v('vf-shipper'),
                  boxes: v('vf-boxes'), seq: v('vf-shipseq'),
                  mfg: rowVal('mfg'), itemLot: rowVal('lot'),
                  thisShip: rowVal('thisShip'), shipped: rowVal('shipped'), toasts,
                  today: (new Date()).toISOString().slice(0,10) };
    const ov = document.getElementById('vf-overlay'); if (ov) ov.style.display = 'none';
    window.readCall = origRead; window.apiCall = origApi; window.toast = origToast; window.loadStorage = origLoadSt;
    return out;
  }, { quote: QUOTE, records });

  // ── 1. 第一次出貨（沒有前一批）：行為維持原樣，不該憑空冒出東西
  const r1 = await openWith([]);
  check('1 第一次出貨：製造日期／箱號留空（沒有前一批可帶，行為不變）',
    (r1.mfg === '' || r1.mfg == null) && (r1.boxes === '' || r1.boxes == null), JSON.stringify(r1));
  check('2 第一次出貨：第幾次＝1、配送日期預設今天', r1.seq === '1' && r1.shipdate === r1.today, JSON.stringify(r1));

  // ── 2. 第二次出貨：帶入第一批的製造日期／批號／箱數／PM／客戶批號
  const r2 = await openWith([vfRecord('V1', '2026-08-31T10:00:00+08:00', '2026-08-31')]);
  check('3 製造日期自動帶入第一批的（不用再打一次）', r2.mfg === '2026-08-20', JSON.stringify(r2));
  check('4 我方批號自動帶入第一批的', r2.itemLot === 'L-9', JSON.stringify(r2));
  check('5 總箱數自動帶入第一批的', String(r2.boxes) === '6', JSON.stringify(r2));
  check('6 PM 與客戶批號也帶進來', r2.shipper === 'Vic' && r2.lot === 'CUST-1', JSON.stringify(r2));
  check('7 ⚠ 配送日期「不」沿用舊的，維持今天（不然出貨日會記錯）', r2.shipdate === r2.today, JSON.stringify(r2));
  check('8 第幾次出貨自動變成 2', r2.seq === '2', JSON.stringify(r2));
  check('9 數量算法沒被覆蓋：已出貨 50、本次出貨帶剩餘 174',
    String(r2.shipped) === '50' && String(r2.thisShip) === '174', JSON.stringify(r2));
  check('10 有提示告訴她哪些欄位是自動帶的、可以改',
    (r2.toasts || []).some(t => /製造日期/.test(t) && /可以再改/.test(t)), JSON.stringify(r2.toasts));

  // ── 3. 第三次出貨：仍然取「第一批」，不是最近一批
  const r3 = await openWith([
    vfRecord('V1', '2026-08-31T10:00:00+08:00', '2026-08-31'),
    vfRecord('V2', '2026-09-01T10:00:00+08:00', '2026-09-01', { boxes: 99, pm: '阿軒', lot: 'CUST-9',
      items: [{ name: '梨香蜜桃紅烏龍調酒', vol: '500', mfg: '2026-09-01', lot: 'L-99', thisShip: 60, ordered: 224, shipped: 50 }] }),
  ]);
  check('11 第三次出貨仍取「第一批」的製造日期／批號／箱數（不是最近那一批）',
    r3.mfg === '2026-08-20' && r3.itemLot === 'L-9' && String(r3.boxes) === '6', JSON.stringify(r3));
  check('12 已出貨累計正確（50+60＝110）、本次帶剩餘 114',
    String(r3.shipped) === '110' && String(r3.thisShip) === '114', JSON.stringify(r3));

  // ── 4. records 順序顛倒（後端是新→舊）也要抓對第一批
  const r4 = await openWith([
    vfRecord('V2', '2026-09-01T10:00:00+08:00', '2026-09-01', { boxes: 99, pm: '阿軒',
      items: [{ name: '梨香蜜桃紅烏龍調酒', vol: '500', mfg: '2026-09-01', lot: 'L-99', thisShip: 60, ordered: 224, shipped: 50 }] }),
    vfRecord('V1', '2026-08-31T10:00:00+08:00', '2026-08-31'),
  ]);
  check('13 回傳順序是新→舊時也抓得對（依 created_at 排，不是靠陣列順序）',
    r4.mfg === '2026-08-20' && String(r4.boxes) === '6' && r4.shipper === 'Vic', JSON.stringify(r4));

  // ── 5. 第一批沒填製造日期／箱數 → 不要硬塞
  const r5 = await openWith([vfRecord('V1', '2026-08-31T10:00:00+08:00', '2026-08-31',
    { boxes: '', pm: '', lot: '', items: [{ name: '梨香蜜桃紅烏龍調酒', vol: '500', mfg: '', lot: '', thisShip: 50, ordered: 224, shipped: 0 }] })]);
  check('14 第一批本來就沒填的欄位不會冒出奇怪的值（空的還是空的）',
    (r5.mfg === '' || r5.mfg == null) && (r5.boxes === '' || r5.boxes == null), JSON.stringify(r5));

  await browser.close();
  const fails = results.filter(x => !x.pass);
  results.forEach(x => console.log((x.pass ? 'PASS' : 'FAIL') + ' ' + x.name + (x.pass ? '' : '   → ' + x.info)));
  console.log(errors.length ? ('JS ERRORS: ' + errors.join(' | ')) : 'NO JS ERRORS');
  console.log(results.length + ' checks');
  console.log(fails.length === 0 ? 'ALL PASS' : (fails.length + ' FAILED'));
  process.exit(fails.length === 0 && errors.length === 0 ? 0 : 1);
}
run();
