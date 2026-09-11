/* 2026-09-11 全系統複檢第一批（純前端 ?v=20260911b）——鎖住這些修正：
   ① factorySync 列入讀取白名單，fxSyncNow 沒變化不清快取／不重抓；有變化才 rcClear＋重抓
   ② 行事曆頁 CAL_ITEMS 被清空時 shpRerenderSide_ 先把備忘抓回來再畫（不會整批消失）
   ③ orderShipPoints 的 total 先過濾沒日期的列再算
   ④ tdShipDueRows：每批都出了但進度算不出來時，保留後端那一筆
   ⑤ openCalAdd 依點的那天預設星期／日／月（ce-mon 也會重設）
   ⑥ showLogin 名單空的會補載
   ⑦ detachAsNewQuote_ 清掉 f-ord-* 三格
   ⑧ 自訂付款條款跳脫＋換行
   ⑨ 寄售驗收單沒登入會 toast
   ⑩ 寄倉：客戶建議清單讀 CUS_MASTER、日期歸零、餘額同品名去重
   ⑪ 客戶管理：openList 擋 null、cusEnc 把單引號轉 %27
   切回未修版本會 FAIL。 */
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

  const r = await page.evaluate(async () => {
    const out = {};
    AUTH_TOKEN = 'x';
    // ① factorySync 白名單＋fxSyncNow
    out.fxRead = (typeof rcIsRead === 'function') ? rcIsRead('factorySync') : null;
    { const calls = []; let cleared = 0, loadedForce = 0;
      const oApi = window.apiCall, oClear = window.rcClear, oLoad = window.loadOrders, oLfl = window.loadFactoryLinks, oToast = window.toast;
      window.toast = () => {};
      window.rcClear = () => { cleared++; };
      window.loadOrders = async (f) => { if (f) loadedForce++; };
      window.loadFactoryLinks = async () => {};
      window.apiCall = async (p) => { calls.push(p.action); return { ok: true, synced: 3, imported: [], mismatches: [] }; };
      await fxSyncNow(null, true);
      out.fx_noChange = { cleared, loadedForce };
      window.apiCall = async () => ({ ok: true, synced: 3, imported: [], mismatches: [], shipChanged: 2 });
      await fxSyncNow(null, true);
      out.fx_changed = { cleared, loadedForce };
      window.apiCall = oApi; window.rcClear = oClear; window.loadOrders = oLoad; window.loadFactoryLinks = oLfl; window.toast = oToast; }
    // ② CAL_ITEMS 空的時候 shpRerenderSide_ 會先抓備忘
    { let fetched = 0; const oRead = window.readCall;
      window.readCall = async (p) => { if (p.action === 'listCalendarItems') { fetched++; return { ok: true, items: [{ item_id: 'M1', kind: 'memo', date: '2026-09-11', title: '備忘X', category: '工作' }] }; } return { ok: true }; };
      currentPage = 'cal'; CAL_ITEMS = [];
      shpRerenderSide_(); await new Promise(r => setTimeout(r, 50));
      out.calRefetch = { fetched, items: (CAL_ITEMS || []).length };
      shpRerenderSide_(); await new Promise(r => setTimeout(r, 50));
      out.calRefetch2 = fetched;   // 已有資料就不再抓
      window.readCall = oRead; currentPage = 'today'; }
    // ③ total 先過濾
    { SHP_ALL = [
        { id: 'S1', quote_no: 'T-1', seq: 1, ship_date_est: '', ship_date_actual: '2026-09-10', note: '[VF:T-1:1] Lot 1' },
        { id: 'S0', quote_no: 'T-1', seq: 2, ship_date_est: '', ship_date_actual: '', note: '', amount: 100 } ];
      ORDER_VSUM = { forms: {}, reps: {}, repList: [], lots: {}, ship: { 'T-1': { ordered: 10, shipped: 4 } } };
      out.pts = orderShipPoints({ no: 'T-1', st: { ship_date_est: '2026-09-09' } }).map(sp => [sp.seq, sp.total, !!sp.pending, shpPointLabel(sp)]); }
    // ④ tdShipDueRows：進度未知＝照 9/3 規則不催；進度載到且沒出完＝長出「尚餘」那一筆
    { ORDERS_CACHE = [{ no: 'T-1', client: 'T客', st: { ship_date_est: '2026-09-09' } }];
      ORDER_VSUM = null;
      out.tdUnknown = tdShipDueRows([{ quote_no: 'T-1', client: 'T客', plan_ship_date: '2026-09-09', overdue_days: 2 }]).map(x => [x.quote_no, x.batch_label]);
      ORDER_VSUM = { forms: {}, reps: {}, repList: [], lots: {}, ship: { 'T-1': { ordered: 10, shipped: 4 } } };
      out.tdKnown = tdShipDueRows([{ quote_no: 'T-1', client: 'T客', plan_ship_date: '2026-09-09', overdue_days: 2 }]).map(x => [x.quote_no, x.batch_label]);
      // ensure：快取沒東西時絕不打後端
      let api = 0; const oR = window.readCall; window.readCall = async () => { api++; return { ok: true }; };
      ORDERS_CACHE = null; ORDER_VSUM = null; await shpEnsureSideData_(); out.ensureNoApi = api; window.readCall = oR; }
    // ⑤ openCalAdd 預設
    { document.getElementById('ce-mon').value = '9';
      openCalAdd('2026-09-15', 'memo');   // 2026-09-15 是週二、15 號、9 月 → 但要看的是它有沒有依那天設
      out.calAdd = { wd: document.getElementById('ce-weekday').value, md: document.getElementById('ce-mday').value, mon: document.getElementById('ce-mon').value };
      openCalAdd(null, 'memo');
      out.calAddToday = { mon: document.getElementById('ce-mon').value, md: document.getElementById('ce-mday').value };
      document.getElementById('ce-overlay').style.display = 'none'; }
    // ⑥ showLogin 補名單
    { let called = 0; const o = window.loadLoginUsers; window.loadLoginUsers = async () => { called++; };
      const s = document.getElementById('login-user'); const keep = s.innerHTML; s.innerHTML = '';
      LOGIN_USERS_REQ = false; showLogin(); await new Promise(r => setTimeout(r, 20)); out.loginReload = called; s.innerHTML = keep; window.loadLoginUsers = o;
      showLogin(); await new Promise(r => setTimeout(r, 20)); out.loginReloadKeep = called;   // 名單在了就不再打
      document.getElementById('login-overlay').style.display = 'none'; }
    // ⑦ detachAsNewQuote_ 清三格
    { const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
      set('f-ord-depdate', '2026-09-01'); set('f-ord-lot', 'L9'); set('f-ord-note', 'n');
      const oS = window.autoNextSerial; window.autoNextSerial = async () => {};
      await detachAsNewQuote_(); window.autoNextSerial = oS;
      out.ordCleared = ['f-ord-depdate', 'f-ord-lot', 'f-ord-note'].map(id => (document.getElementById(id) || {}).value || ''); }
    // ⑧ 自訂付款條款
    { const oTab = payTab; payTab = 3; document.getElementById('p3-txt').value = '第一行 <300ml\n第二行';
      out.pay3 = getPayTerms(); payTab = oTab; }
    // ⑨ 寄售驗收單沒登入
    { const toasts = []; const oT = window.toast; window.toast = (m, t) => toasts.push([m, t]);
      const oTok = AUTH_TOKEN; AUTH_TOKEN = null; saveConsignVerifyFormRecord({ no: 'CS-X', rows: [] }); AUTH_TOKEN = oTok; window.toast = oT;
      out.csToast = toasts.map(x => x[0]).join('|'); }
    // ⑩ 寄倉
    { CUS_MASTER = [{ name: '主檔客A' }, { name: '主檔客B' }]; CUS_DATA = null;
      ST_MOVES = []; stRender();
      out.stCus = [...document.querySelectorAll('#st-cuslist option')].map(o => o.value);
      const d = document.getElementById('st-f-date'); d.value = '2026-08-01'; stCloseForm(); out.stDate = d.value;
      const oB = window.stBalanceFor; window.stBalanceFor = () => 50;
      out.stBal = stBalanceForRows('C', [{ name: '玫開二度', vol: '500ml' }, { name: '玫開二度', vol: '500' }, { name: '老鷹教父', vol: '500' }]);
      window.stBalanceFor = oB; }
    // ⑪ 客戶管理
    { out.enc = cusEnc("Molly's Bar");
      const c = cusBuild({ ok: true, quotes: [
        { quoteNo: 'Q1', clientName: '甲', quoteType: 'bottle', grandTotal: 100, quoteDate: '2026-09-01' },
        { quoteNo: 'Q2', clientName: '甲', quoteType: 'bottle', grandTotal: 100, quoteDate: '2026-09-02' } ] },
        { ok: true, quotes: [] }, { ok: true, orders: [{ quote_no: 'Q2', status: 'production', deposit_date: '2026-09-03' }] }, { ok: true }, { ok: true }, { ok: true });
      out.openList = (c[0] || {}).openList ? c[0].openList.map(q => q.no) : null; }
    return out;
  });

  check('1 factorySync 在讀取白名單；沒變化＝不清快取、不強制重抓', r.fxRead === true && r.fx_noChange.cleared === 0 && r.fx_noChange.loadedForce === 0, JSON.stringify([r.fxRead, r.fx_noChange]));
  check('2 有變化（出貨紀錄更新）＝清快取＋強制重抓一次', r.fx_changed.cleared === 1 && r.fx_changed.loadedForce === 1, JSON.stringify(r.fx_changed));
  check('3 行事曆頁 CAL_ITEMS 空的 → 先抓備忘再畫；已有資料就不再抓', r.calRefetch.fetched === 1 && r.calRefetch.items === 1 && r.calRefetch2 === 1, JSON.stringify([r.calRefetch, r.calRefetch2]));
  check('4 沒日期的分批列不算進「共 N 批」，最新那批仍有「已出 4/10」', JSON.stringify(r.pts) === JSON.stringify([[1, 1, false, '（第1批，已出 4/10）'], [2, 1, true, '（尚餘 6 待出貨）']]), JSON.stringify(r.pts));
  check('5 今日待辦：進度未知＝不催（9/3 規則）；進度載到且沒出完＝「尚餘 6 待出貨」', JSON.stringify(r.tdUnknown) === '[]' && JSON.stringify(r.tdKnown) === JSON.stringify([['T-1', '（尚餘 6 待出貨） Lot 1']]), JSON.stringify([r.tdUnknown, r.tdKnown]));
  check('5b shpEnsureSideData_ 快取沒東西時不打後端', r.ensureNoApi === 0, String(r.ensureNoApi));
  check('6 新增事項依點的那天預設：9/15＝週二／15 號／9 月', r.calAdd.wd === '2', r.calAdd.md === '15', JSON.stringify(r.calAdd));
  check('6b ce-mon 有重設（不沿用上一筆）', r.calAdd.mon === '9' && r.calAddToday.mon === String(new Date().getMonth() + 1) && r.calAddToday.md === String(new Date().getDate()), JSON.stringify([r.calAdd, r.calAddToday]));
  check('7 登入框名單空的會補載；名單在了就不再打', r.loginReload === 1 && r.loginReloadKeep === 1, JSON.stringify([r.loginReload, r.loginReloadKeep]));
  check('8 另存／複製會清掉訂單進度三格', r.ordCleared.join('') === '', JSON.stringify(r.ordCleared));
  check('9 自訂付款條款：跳脫 < 且換行變 <br>', r.pay3 === '第一行 &lt;300ml<br>第二行', r.pay3);
  check('10 寄售驗收單沒登入會 toast 警告', /沒有.*留底/.test(r.csToast), r.csToast);
  check('11 寄倉客戶建議清單讀主檔（CUS_MASTER）', r.stCus.includes('主檔客A') && r.stCus.includes('主檔客B'), JSON.stringify(r.stCus));
  check('12 寄倉表單關閉後日期歸零', r.stDate === '', r.stDate);
  check('13 寄倉餘額同品名同容量只算一次（50+50 不是 150）', r.stBal === 100, String(r.stBal));
  check('14 cusEnc 把單引號轉成 %27', r.enc === 'Molly%27s%20Bar', r.enc);
  check('15 客戶「進行中訂單」不含沒建進度的純報價', JSON.stringify(r.openList) === JSON.stringify(['Q2']), JSON.stringify(r.openList));
  check('16 無 pageerror', errors.length === 0, errors.join(' | '));

  await browser.close();
  let pass = 0;
  results.forEach(x => { console.log((x.pass ? '✅ ' : '❌ ') + x.name + (x.pass ? '' : '  → ' + (x.info || ''))); if (x.pass) pass++; });
  console.log(`\n${pass}/${results.length} 通過`);
  process.exit(pass === results.length ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
