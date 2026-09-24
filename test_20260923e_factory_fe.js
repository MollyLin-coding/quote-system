/* 2026-09-23 晚 廠務×報價系統 深度複檢（前端）離線測試
   13_factory.js：
     1) 連結資料還沒載入 → 轉單鈕「讀取中」不給按；廠務已刪除 → 「重新轉廠務訂單」＋紅色徽章
     2) 推單：GONE → 問了才帶 force_new 重送；CONFLICT → 列出來（alert）不報成功；合併提示跳 alert；送出中不重複送；
        不管成功失敗都 loadOrders(true)（寫入 API 會把訂單快取清成 null）
     3) 同步：只有金額一直不符 → 背景不清快取、不跳提示；出貨列／實際出貨日有變 → 清快取重抓；只有連結變 → 只重抓連結；
        busy → 手動才提示；同樣的錯誤背景只提示一次
     4) 自動同步：一般使用者／不在訂單追蹤頁／後端 10 分鐘內剛同步 → 不打；老闆在訂單追蹤頁 → 打
     5) 驗收單帶入：酒名去 V2、「蜜香紅茶」不搶「蜜香紅茶荔枝琴酒」、同款兩列依訂購量分配；預設選下一次；記下 fxShipSeq
     6) 對照表：酒款列可刪、改名＝刪舊的
     7) 讀取白名單加 factoryPing／factoryUnlinkedOrders；一般使用者藏同步／轉單鈕
     8) 月報表頁：連結資料到了會補畫
   05_orders.js：
     9) 產生驗收單時，同一天已有同步寫的 [FX:…] 出貨列 → 接在它後面（FX 段留前面、日期不動），不另加一筆；重印也一樣
    10) ORDERS_CACHE 被清成 null 時按「編輯進度」不噴錯
   08_ownbrand.js：
    11) 客戶設定「不連結廠務」存 '-'；那家經銷商不再列進「還沒對到」
    12) 客戶代碼重複 → 下拉鎖住、講明要先改代碼
    13) 同一張廠務訂單兩趟出貨＝兩批；登記視窗：廠務已停用的經銷商不說「不用在這裡登」
    14) 同步摘要顯示「可能重複」「售出單價用牌價補」
*/
const { chromium } = require('/opt/node-tools/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  const isNoise = t => /Failed to load resource|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|favicon/i.test(t);
  page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('CONSOLE: ' + m.text()); });
  page.route('**/script.google.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, users: [], list: [] }) }));
  await page.goto('http://localhost:8899/index.html');
  await page.waitForFunction(() => { const s = document.getElementById('login-user'); return !s || !/載入中/.test(s.innerHTML); }, { timeout: 15000 }).catch(() => {});
  const results = []; const check = (n, c, info) => results.push([c ? 'PASS' : 'FAIL', n, c ? '' : (info || '')]);

  // ── 13_factory.js ───────────────────────────────
  const a = await page.evaluate(async () => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 't'; USER_ROLE = 'owner';
    const out = {};
    window.CALLS = []; window.TOASTS = []; window.ALERTS = []; window.CONFIRMS = [];
    window.toast = (m, t) => window.TOASTS.push([String(m), t || '']);
    window.alert = m => window.ALERTS.push(String(m));
    window.CONFIRM_ANS = true; window.confirm = m => { window.CONFIRMS.push(String(m)); return window.CONFIRM_ANS; };
    let loadOrdersN = 0; window.loadOrders = async () => { loadOrdersN++; return []; };
    window.loadShipmentBadges = () => {};
    let rcN = 0; const _rc = rcClear; window.rcClear = () => { rcN++; _rc(); };
    // 1) FX_LINKS 還是 null
    FX_LINKS = null;
    const o1 = { no: 'Q1', typeKey: 'bottle', src: 'std', st: {} };
    out.btnNull = fxActionBtn(o1);
    await fxPushOrder('Q1', null);
    out.nullToast = window.TOASTS.map(t => t[0]).join('|');
    let links = [{ quote_no: 'Q1', factory_order_no: '260909-001', factory_status: '製作中' }, { quote_no: 'Q2', factory_order_no: '260909-002', factory_status: '廠務已刪除', note: '廠務訂單 260909-002 已不在廠務系統（被刪除）' }];
    window.readCall = async (p) => { window.CALLS.push(p); if (p.action === 'getFactoryLinks') return { ok: true, configured: true, links, lastSync: window.LAST_SYNC || '' }; return { ok: true }; };
    await loadFactoryLinks(true);
    out.btnLinked = fxActionBtn(o1); out.btnGone = fxActionBtn({ no: 'Q2', typeKey: 'bottle', src: 'std', st: {} });
    out.badgeGone = fxBadges({ no: 'Q2' });
    // 2) 推單
    let pushResp = [];
    window.apiCall = async (p) => { window.CALLS.push(JSON.parse(JSON.stringify(p))); if (p.action === 'factoryPushOrder') { const r = pushResp.shift(); return typeof r === 'function' ? await r(p) : r; } return { ok: true }; };
    // 2a GONE（連結表還不知道被刪）→ 問 → 帶 force_new
    window.CALLS = []; window.CONFIRMS = []; loadOrdersN = 0;
    pushResp = [{ ok: false, code: 'FACTORY_ORDER_GONE', factory_order_no: '260909-001', error: '廠務訂單 260909-001 已經不在廠務系統（可能被同仁刪除了）。' }, { ok: true, factory_order_no: '260923-011', updated: false, client: '日富一日', items: 1, notes: [] }];
    await fxPushOrderDo('Q1', null);
    const pc = window.CALLS.filter(c => c.action === 'factoryPushOrder');
    out.gone = { n: pc.length, second: pc[1] && pc[1].force_new, confirms: window.CONFIRMS.length, reload: loadOrdersN, text: window.CONFIRMS[0] || '' };
    // 2b 連結表已標刪除 → 直接問重建、第一趟就帶 force_new
    window.CALLS = []; window.CONFIRMS = [];
    pushResp = [{ ok: true, factory_order_no: '260923-012', updated: false, client: 'X', items: 1, notes: [] }];
    await fxPushOrderDo('Q2', null);
    const pc2 = window.CALLS.filter(c => c.action === 'factoryPushOrder');
    out.gone2 = { n: pc2.length, force: pc2[0] && pc2[0].force_new, text: window.CONFIRMS[0] || '' };
    // 2c GONE 但她按取消 → 不重送、照樣重抓清單
    window.CALLS = []; loadOrdersN = 0; window.CONFIRM_ANS = true;
    let asked = 0; window.confirm = m => { asked++; return asked === 1; };
    pushResp = [{ ok: false, code: 'FACTORY_ORDER_GONE', factory_order_no: '260909-001', error: 'gone' }];
    await fxPushOrderDo('Q1', null);
    out.goneNo = { n: window.CALLS.filter(c => c.action === 'factoryPushOrder').length, reload: loadOrdersN };
    window.confirm = m => { window.CONFIRMS.push(String(m)); return window.CONFIRM_ANS; };
    // 2d CONFLICT
    window.CALLS = []; window.ALERTS = []; window.TOASTS = []; loadOrdersN = 0;
    pushResp = [{ ok: false, code: 'CONFLICT', conflicts: ['「桂花」廠務已出貨 70，報價單卻改成 60'], error: '廠務那邊已經有進度，這次更新會對不上：\n「桂花」廠務已出貨 70，報價單卻改成 60' }];
    await fxPushOrderDo('Q1', null);
    out.conflict = { alert: window.ALERTS[0] || '', okToast: window.TOASTS.some(t => /已更新|已建立/.test(t[0])), reload: loadOrdersN };
    // 2e 成功＋合併提示
    window.ALERTS = []; window.TOASTS = [];
    pushResp = [{ ok: true, factory_order_no: '260909-001', updated: true, client: 'OEM-日富一日', items: 2, notes: ['「桂花」數量 50→60（這款廠務已完成製作，請同仁確認要不要補做）'] }];
    await fxPushOrderDo('Q1', null);
    out.notes = { alert: window.ALERTS[0] || '', toast: window.TOASTS.map(t => t[0]).join('|') };
    // 2f 送出中不重複送
    window.CALLS = [];
    let release; pushResp = [p => new Promise(res => { release = () => res({ ok: true, factory_order_no: '260909-001', updated: true, client: 'X', items: 1, notes: [] }); })];
    const p1 = fxPushOrderDo('Q1', null);
    await new Promise(r => setTimeout(r, 30));
    window.TOASTS = [];
    await fxPushOrderDo('Q1', null);
    out.dupToast = window.TOASTS.map(t => t[0]).join('|');
    release(); await p1;
    out.dupCalls = window.CALLS.filter(c => c.action === 'factoryPushOrder').length;
    // 2g 更新的確認文字講清楚改什麼／留什麼
    out.confirmText = (window.CONFIRMS.find(t => /更新到廠務訂單/.test(t)) || '');

    // 3) 同步
    let syncResp = null;
    window.apiCall = async (p) => { window.CALLS.push(p); if (p.action === 'factorySync') return syncResp; return { ok: true }; };
    let flN = 0; const _lfl = loadFactoryLinks; window.loadFactoryLinks = async (f) => { flN++; return _lfl(f); };
    const base = { ok: true, synced: 5, imported: [], mismatches: [], shipChanged: 0, shipRemoved: 0, osChanged: 0, linkChanged: 0, paused: [], gone: [], healed: [], errors: [], at: '2026-09-23T20:00:00+08:00' };
    // 3a 只有金額一直不符（背景）
    syncResp = Object.assign({}, base, { mismatches: [{ quote_no: '20260918-01', items: ['貨款'] }] });
    rcN = 0; loadOrdersN = 0; flN = 0; window.TOASTS = [];
    await fxSyncNow(null, true);
    out.s3a = { rc: rcN, lo: loadOrdersN, fl: flN, toast: window.TOASTS.length };
    // 3b 出貨列拿掉＋實際出貨日改了
    syncResp = Object.assign({}, base, { shipChanged: 1, shipRemoved: 1, osChanged: 1, linkChanged: 1 });
    rcN = 0; loadOrdersN = 0; window.TOASTS = [];
    await fxSyncNow(null, true);
    out.s3b = { rc: rcN, lo: loadOrdersN, toast: window.TOASTS.map(t => t[0]).join('|') };
    // 3c 只有連結變（狀態／Lot）
    syncResp = Object.assign({}, base, { linkChanged: 2 });
    rcN = 0; loadOrdersN = 0; flN = 0; window.TOASTS = [];
    await fxSyncNow(null, true);
    out.s3c = { rc: rcN, lo: loadOrdersN, fl: flN, toast: window.TOASTS.length };
    // 3d busy
    syncResp = { ok: false, busy: true, error: '另一個同步正在進行，稍後再試' };
    window.TOASTS = [];
    await fxSyncNow(null, true); const bSilent = window.TOASTS.length;
    await fxSyncNow(null, false); out.s3d = { silent: bSilent, manual: window.TOASTS.map(t => t[0]).join('|') };
    // 3e 同樣錯誤背景只提示一次；手動一定提示；廠務刪單會提醒
    syncResp = Object.assign({}, base, { errors: ['260913-001：看起來是報價單 20260912-01 推過去的…'] });
    window.TOASTS = [];
    await fxSyncNow(null, true); await fxSyncNow(null, true);
    const e1 = window.TOASTS.length;
    await fxSyncNow(null, false);
    syncResp = Object.assign({}, base, { gone: ['20260909-03'], linkChanged: 1 });
    await fxSyncNow(null, true);
    out.s3e = { bg: e1, total: window.TOASTS.length, gone: (window.TOASTS[window.TOASTS.length - 1] || [''])[0] };
    // 3f 手動、沒變化、有暫停的單 → 講一次暫停
    syncResp = Object.assign({}, base, { paused: [{ quote_no: '20260915-02', factory_order_no: '260915-002', status: '已刪除' }] });
    window.TOASTS = [];
    await fxSyncNow(null, false);
    out.s3f = window.TOASTS.map(t => t[0]).join('|');
    window.loadFactoryLinks = _lfl;

    // 4) 自動同步
    const origSync = fxSyncNow; let autoN = 0; window.fxSyncNow = async () => { autoN++; return null; };
    FX_CONFIGURED = true;
    const tryAuto = async (role, pageName, lastIso) => { USER_ROLE = role; currentPage = pageName; FX_LAST_SYNC_AT = 0; FX_LAST_SYNC_ISO = lastIso || ''; autoN = 0; fxAutoSync(); await new Promise(r => setTimeout(r, 1700)); return autoN; };
    out.auto = {
      general: await tryAuto('general', 'orders'),
      today: await tryAuto('owner', 'today'),
      recent: await tryAuto('owner', 'orders', new Date(Date.now() - 3 * 60 * 1000).toISOString()),
      owner: await tryAuto('owner', 'orders', new Date(Date.now() - 60 * 60 * 1000).toISOString()),
    };
    window.fxSyncNow = origSync; USER_ROLE = 'owner'; currentPage = 'new';

    // 5) 驗收單帶入
    links = [{ quote_no: 'Q5', factory_order_no: '260920-001', factory_status: '製作中', ship_json: JSON.stringify({ orderNo: '260920-001', pm: '小李', batches: [
      { seq: 1, date: '2026-09-21', lines: [{ product: '蜜香紅茶荔枝琴酒V2', qty: 30 }, { product: '蜜香紅茶', qty: 5 }] },
      { seq: 2, date: '2026-09-23', lines: [{ product: '蜜香紅茶荔枝琴酒 V2', qty: 50 }, { product: '桂花烏龍', qty: 4 }] } ] }) }];
    window.readCall = async (p) => { if (p.action === 'getFactoryLinks') return { ok: true, configured: true, links, lastSync: '' }; return { ok: true }; };
    await loadFactoryLinks(true);
    VERIFY_DATA = { no: 'Q5', client: 'X', priorCount: 1, rows: [
      { name: '蜜香紅茶荔枝琴酒', lot: 'Lot 3', vol: '100ml', ordered: 40, mfg: '', thisShip: 40, shipped: 0 },
      { name: '蜜香紅茶荔枝琴酒', lot: 'Lot 4', vol: '100ml', ordered: 60, mfg: '', thisShip: 60, shipped: 0 },
      { name: '蜜香紅茶', lot: '', vol: '100ml', ordered: 5, mfg: '', thisShip: 5, shipped: 0 } ] };
    buildVerifyModal('');
    out.vfDefault = document.getElementById('fx-vf-batch') && document.getElementById('fx-vf-batch').value;
    fxVerifyFill('Q5');
    const v = k => [...document.querySelectorAll(`#vf-body .vfi[data-k="${k}"]`)].map(e => e.value);
    out.vf = { thisShip: v('thisShip'), shipped: v('shipped'), seq: document.getElementById('vf-shipseq').value, date: document.getElementById('vf-shipdate').value, fxSeq: VERIFY_DATA.fxShipSeq, fxNo: VERIFY_DATA.fxOrderNo, toast: window.TOASTS.map(t => t[0]).pop() };
    if (typeof closeVerifyForm === 'function') closeVerifyForm();

    // 6) 對照表
    window.readCall = async p => { if (p.action === 'getFactoryMap') return { ok: true, map: [{ kind: 'product', qs_name: '舊名A', factory_name: 'A V2' }, { kind: 'product', qs_name: 'B', factory_name: 'B V2' }] }; if (p.action === 'getCustomers') return { ok: true, customers: [] }; return { ok: true }; };
    window.apiCall = async p => { window.CALLS.push(p); if (p.action === 'factoryPing') return { ok: true, env: 'PROD', time: 'now' }; return { ok: true, saved: 2, removed: 2 }; };
    await fxOpenMap();
    const trs = [...document.querySelectorAll('#fx-map-pbody tr')];
    trs[0].querySelector('.fx-map-pq').value = '新名A';   // 改名
    fxMapDelRow(trs[1].querySelector('button'));          // 刪掉 B
    window.CALLS = [];
    await fxSaveMap();
    out.mapRows = ((window.CALLS.find(c => c.action === 'saveFactoryMap') || {}).rows || []).filter(r => r.kind === 'product');
    // 7) 白名單／權限
    out.whitelist = rcIsRead('factoryPing') && rcIsRead('factoryUnlinkedOrders') && !rcIsRead('factoryPushOrder') && !rcIsRead('factoryConsignSync');
    out.ownerFns = ['fxPushOrder', 'fxSyncNow', 'fxOpenMap', 'fxSaveMap', 'fxLinkExisting', 'csFxSyncNow'].every(f => OWNER_ONLY_FNS.indexOf(f) >= 0) && OWNER_ONLY_FNS.indexOf('fxVerifyFill') < 0;
    out.slow = ['factorySync', 'factoryPushOrder', 'factoryUnlinkedOrders', 'factoryLinkExisting', 'factoryConsignSync'].every(a => API_SLOW_ACTIONS.indexOf(a) >= 0) && API_SLOW_ACTIONS.indexOf('saveQuote') < 0;
    // 8) 月報表頁補畫
    let rr = 0; const _rr = window.renderReport; window.renderReport = () => { rr++; };
    currentPage = 'report'; window.readCall = async p => ({ ok: true, configured: true, links: [], lastSync: '' });
    await loadFactoryLinks(true); out.reportRedraw = rr;
    window.renderReport = _rr; currentPage = 'new';
    return out;
  });
  check('1a 連結資料還沒載入 → 轉單鈕「讀取中」disabled', /disabled/.test(a.btnNull) && /讀取中/.test(a.btnNull), a.btnNull);
  check('1b 那時按轉單 → 提示等一下、不開對話框', /還在讀取/.test(a.nullToast), a.nullToast);
  check('1c 已連結＝更新、廠務已刪除＝重新轉＋紅色徽章', /更新廠務訂單/.test(a.btnLinked) && /重新轉廠務訂單/.test(a.btnGone) && /ob red/.test(a.badgeGone) && /廠務已刪除/.test(a.badgeGone), a.btnGone + ' :: ' + a.badgeGone);
  check('2a GONE → 問過才帶 force_new 重送、之後重抓清單', a.gone.n === 2 && a.gone.second === '1' && a.gone.confirms === 2 && a.gone.reload >= 1, JSON.stringify(a.gone));
  check('2b 已標廠務已刪除 → 直接問重建、一趟就帶 force_new', a.gone2.n === 1 && a.gone2.force === '1' && /已經不在廠務系統/.test(a.gone2.text), JSON.stringify(a.gone2));
  check('2c GONE 按取消 → 不重送、照樣重抓清單', a.goneNo.n === 1 && a.goneNo.reload === 1, JSON.stringify(a.goneNo));
  check('2d CONFLICT → alert 列出衝突、不報成功、照樣重抓清單', /已出貨 70/.test(a.conflict.alert) && !a.conflict.okToast && a.conflict.reload === 1, JSON.stringify(a.conflict));
  check('2e 成功有合併提示 → alert 列出來', /請留意/.test(a.notes.alert) && /50→60/.test(a.notes.alert) && /已更新廠務訂單 260909-001/.test(a.notes.toast), JSON.stringify(a.notes));
  check('2f 送出中再按 → 不重送', a.dupCalls === 1 && /傳送中/.test(a.dupToast), JSON.stringify([a.dupCalls, a.dupToast]));
  check('2g 更新的確認文字：會更新數量／金額、會保留瓶型／Lot／配送', /會更新：酒款數量/.test(a.confirmText) && /會保留廠務那邊的/.test(a.confirmText) && /Lot/.test(a.confirmText), a.confirmText.slice(0, 80));
  check('3a 背景同步只有金額一直不符 → 不清快取、不重抓訂單、不跳提示、也不重抓連結', a.s3a.rc === 0 && a.s3a.lo === 0 && a.s3a.fl === 0 && a.s3a.toast === 0, JSON.stringify(a.s3a));
  check('3b 出貨列拿掉＋出貨日改了 → 清快取重抓、提示講出來', a.s3b.rc === 1 && a.s3b.lo === 1 && /廠務刪掉的出貨/.test(a.s3b.toast) && /實際出貨日/.test(a.s3b.toast), JSON.stringify(a.s3b));
  check('3c 只有連結變 → 只重抓連結、不清整站快取', a.s3c.rc === 0 && a.s3c.lo === 0 && a.s3c.fl === 1 && a.s3c.toast === 0, JSON.stringify(a.s3c));
  check('3d busy → 背景不吵、手動提示「正在進行中」', a.s3d.silent === 0 && /正在進行中/.test(a.s3d.manual), JSON.stringify(a.s3d));
  check('3e 同樣的錯誤背景只提示一次、手動會再講；廠務刪單會提醒', a.s3e.bg === 1 && a.s3e.total === 3 && /廠務刪掉了 1 張/.test(a.s3e.gone), JSON.stringify(a.s3e));
  check('3f 手動同步講出「已停止同步」的單', /停止同步/.test(a.s3f) && /260915-002/.test(a.s3f), a.s3f);
  check('4 自動同步：一般使用者／今日待辦頁／後端 3 分鐘前剛同步 → 不打；老闆在訂單追蹤頁 → 打', a.auto.general === 0 && a.auto.today === 0 && a.auto.recent === 0 && a.auto.owner === 1, JSON.stringify(a.auto));
  check('5a 已產生過 1 張驗收單 → 預設選第 2 次出貨', a.vfDefault === '2', a.vfDefault);
  check('5b 帶入第 2 次：同款兩列依訂購量分配（前一次 30 先分）、去 V2 對上、「蜜香紅茶」沒被搶', JSON.stringify(a.vf.thisShip) === JSON.stringify(['10', '40', '0']) && JSON.stringify(a.vf.shipped) === JSON.stringify(['30', '0', '5']), JSON.stringify(a.vf));
  check('5c 對不上的「桂花烏龍」有提示；第幾次／日期帶入；記下 fxShipSeq／fxOrderNo', a.vf.seq === '2' && a.vf.date === '2026-09-23' && a.vf.fxSeq === 2 && a.vf.fxNo === '260920-001' && /桂花烏龍/.test(a.vf.toast || ''), JSON.stringify(a.vf));
  check('6 對照表：改名＝刪舊的＋存新的；✕ 的那列送空字串刪掉', a.mapRows.some(r => r.qs_name === '舊名A' && r.factory_name === '') && a.mapRows.some(r => r.qs_name === '新名A' && r.factory_name === 'A V2') && a.mapRows.some(r => r.qs_name === 'B' && r.factory_name === '') && a.mapRows.length === 3, JSON.stringify(a.mapRows));
  check('7a 讀取白名單：factoryPing／factoryUnlinkedOrders 是讀取；推單／寄售同步不是', a.whitelist === true);
  check('7b 老闆限定：轉單／同步／對照／連結／寄售同步藏起來；驗收單帶入不藏', a.ownerFns === true);
  check('7c 廠務連結的動作逾時放寬到 70 秒（其他照舊 25 秒）', a.slow === true);
  check('8 月報表頁：連結資料到了會補畫', a.reportRedraw === 1, String(a.reportRedraw));

  // ── 05_orders.js ───────────────────────────────
  const b = await page.evaluate(async () => {
    const out = {};
    window.CALLS = []; window.TOASTS = [];
    let ships = [
      { id: 'S1', quote_no: 'Q9', seq: 1, ship_date_actual: '2026-09-21', note: '[FX:260920-001:1] · 廠務出貨 A×10' },
      { id: 'S2', quote_no: 'Q9', seq: 2, ship_date_actual: '2026-09-23', note: '[FX:260920-001:2] · 廠務出貨 A×5' },
    ];
    SHP_ALL = ships.map(s => Object.assign({}, s));
    window.apiCall = async p => {
      window.CALLS.push(JSON.parse(JSON.stringify(p)));
      if (p.action === 'listShipments') return { ok: true, shipments: ships.map(s => Object.assign({}, s)) };
      if (p.action === 'updateShipment') { const s = ships.find(x => x.id === p.id); Object.assign(s, p.fields); return { ok: true }; }
      if (p.action === 'addShipment') { ships.push(Object.assign({ id: 'S' + (ships.length + 1), quote_no: p.quote_no }, p.fields)); return { ok: true }; }
      return { ok: true, shipments: ships };
    };
    window.loadShipmentBadges = () => {};
    // 9a 同一天（09-23）已有同步寫的第 2 趟 → 接上
    await shpSyncFromVerify({ no: 'Q9', shipDate: '2026-09-23', shipSeq: 2, lot: 'Lot 3', boxes: 2, shipper: 'Vic' });
    out.a = { add: window.CALLS.filter(c => c.action === 'addShipment').length, upd: window.CALLS.filter(c => c.action === 'updateShipment').map(c => [c.id, c.fields]) };
    // 9b 重印（箱數改 3）→ 還是改同一筆、FX 段留前面
    window.CALLS = []; SHP_ALL = ships.map(s => Object.assign({}, s));
    await shpSyncFromVerify({ no: 'Q9', shipDate: '2026-09-23', shipSeq: 2, lot: 'Lot 3', boxes: 3, shipper: 'Vic' });
    out.b = { add: window.CALLS.filter(c => c.action === 'addShipment').length, note: ships.find(s => s.id === 'S2').note, date: ships.find(s => s.id === 'S2').ship_date_actual };
    // 9c 從「帶入廠務第 1 次」來的、但驗收單日期填了 09-22 → 認 fxShipSeq 那趟（S1）
    window.CALLS = []; SHP_ALL = ships.map(s => Object.assign({}, s));
    await shpSyncFromVerify({ no: 'Q9', shipDate: '2026-09-22', shipSeq: 1, lot: '', boxes: 1, shipper: '', fxShipSeq: 1, fxOrderNo: '260920-001' });
    out.c = { add: window.CALLS.filter(c => c.action === 'addShipment').length, note: ships.find(s => s.id === 'S1').note, date: ships.find(s => s.id === 'S1').ship_date_actual };
    // 9d 沒有同步那筆（別天）→ 照舊新增
    window.CALLS = []; SHP_ALL = ships.map(s => Object.assign({}, s));
    await shpSyncFromVerify({ no: 'Q9', shipDate: '2026-09-30', shipSeq: 3, lot: '', boxes: 1, shipper: '' });
    out.d = { add: window.CALLS.filter(c => c.action === 'addShipment').length };
    // 10 ORDERS_CACHE null → 編輯進度不噴錯
    ORDERS_CACHE = null; let lo = 0; window.loadOrders = async () => { lo++; return []; };
    try { openOrdEdit('Q9'); out.edit = 'ok'; } catch (e) { out.edit = String(e); }
    out.editToast = window.TOASTS.map(t => t[0]).pop(); out.editReload = lo;
    return out;
  });
  check('9a 同一天已有同步寫的那趟 → 接在它後面（不新增、FX 段在前、驗收單段接後）', b.a.add === 0 && b.a.upd.length === 1 && b.a.upd[0][0] === 'S2' && /^\[FX:260920-001:2\] · 廠務出貨 A×5 \[VF:Q9:2\] Lot 3 · 配送 2 箱，PM Vic$/.test(b.a.upd[0][1].note) && b.a.upd[0][1].ship_date_actual === undefined, JSON.stringify(b.a));
  check('9b 重印 → 同一筆更新、FX 段還在最前面、日期不動', b.b.add === 0 && /^\[FX:260920-001:2\] · 廠務出貨 A×5 \[VF:Q9:2\] Lot 3 · 配送 3 箱/.test(b.b.note) && b.b.note.split('[VF:').length === 2 && b.b.date === '2026-09-23', JSON.stringify(b.b));
  check('9c 從廠務第 1 次帶入的（日期不同）→ 認那一趟', b.c.add === 0 && /^\[FX:260920-001:1\].*\[VF:Q9:1\]/.test(b.c.note) && b.c.date === '2026-09-21', JSON.stringify(b.c));
  check('9d 沒有對應的同步列 → 照舊新增一筆', b.d.add === 1, JSON.stringify(b.d));
  check('10 訂單快取被清掉時按編輯進度 → 不噴錯、提示並重抓', b.edit === 'ok' && /重新整理中/.test(b.editToast || '') && b.editReload === 1, JSON.stringify([b.edit, b.editToast, b.editReload]));

  // ── 08_ownbrand.js ───────────────────────────────
  const PRODUCTS = [{ sku_id: '蜜香紅茶荔枝琴酒|100ml', name: '蜜香紅茶荔枝琴酒', volume: '100ml', list_price: 320, active: 'Y' }, { sku_id: '泰奶烏龍蘭姆酒|100ml', name: '泰奶烏龍蘭姆酒', volume: '100ml', list_price: 320, active: 'Y' }];
  const CUSTOMERS = [
    { customer_id: '4', name: '島羽Wing Islands', default_discount: 0.7, billing_day: 30, active: 'Y' },
    { customer_id: '7', name: '日光貳叁', default_discount: 0.7, billing_day: 25, active: 'Y' },
    { customer_id: '9', name: '誠品生活', default_discount: 0.65, billing_day: 5, active: 'Y' },
    { customer_id: '9', name: '桃園青埔', default_discount: 0.67, billing_day: 5, active: 'Y' },
    { customer_id: '2', name: 'downstairs', default_discount: 0.75, billing_day: 5, active: 'Y' },
  ];
  const DEALERS = [
    { key: '經銷商－島羽', label: '島羽 Wing Islands', enabled: true }, { key: '經銷商－日光貳參', label: '日光貳參', enabled: true },
    { key: '經銷商－downstair', label: 'downstair', enabled: false },
  ];
  const MAP = [{ kind: 'consign_client', qs_name: '4', factory_name: '經銷商－島羽' }, { kind: 'consign_client', qs_name: '7', factory_name: '-' }, { kind: 'consign_client', qs_name: '2', factory_name: '經銷商－downstair' }];
  const LEDGER = [
    { movement_id: 'CM-20260918-0001', date: '2026-09-18', customer_id: 4, sku_id: '蜜香紅茶荔枝琴酒|100ml', type: 'in', qty: 10, note: '[FXC:CI-1|260917-001#1] 廠務 260917-001 第1次／Kevin', created_at: '2026-09-18T10:00:00+08:00' },
    { movement_id: 'CM-20260918-0002', date: '2026-09-18', customer_id: 4, sku_id: '泰奶烏龍蘭姆酒|100ml', type: 'in', qty: 6, note: '[FXC:CI-2|260917-001#1] 廠務 260917-001 第1次／Kevin', created_at: '2026-09-18T10:00:05+08:00' },
    { movement_id: 'CM-20260920-0001', date: '2026-09-20', customer_id: 4, sku_id: '蜜香紅茶荔枝琴酒|100ml', type: 'in', qty: 4, note: '[FXC:CI-3|260917-001#2] 廠務 260917-001 第2次／Kevin', created_at: '2026-09-20T09:00:00+08:00' },
  ];
  const c = await page.evaluate(async ({ PRODUCTS, CUSTOMERS, DEALERS, MAP, LEDGER }) => {
    const out = {};
    window.CALLS = []; window.TOASTS = [];
    window.FXMAP = MAP.map(m => Object.assign({}, m));
    window.apiCall = async (payload) => {
      window.CALLS.push(JSON.parse(JSON.stringify(payload)));
      switch (payload.action) {
        case 'getOwnbrandProducts': return { ok: true, products: PRODUCTS };
        case 'getOwnbrandTiers': return { ok: true, tiers: [], terms: {} };
        case 'getConsignCustomers': return { ok: true, customers: CUSTOMERS, discounts: [] };
        case 'getConsignInventory': return { ok: true, inventory: [], deposit_held_by_customer: {} };
        case 'getConsignLedger': return { ok: true, rows: LEDGER };
        case 'listVerifyForms': return { ok: true, records: [], summary: {} };
        case 'getFactoryConsignDealers': return { ok: true, configured: true, dealers: DEALERS, map: window.FXMAP, lastSync: '2026-09-23T19:00:00+08:00', since: '2026-09-16 00:00:00',
          lastResult: { at: '2026-09-23T19:00:00+08:00', inserted: 2, linked: 0, unmappedDealers: {}, unmappedProducts: {}, ignoredDealers: { '經銷商－日光貳參': 3 }, ambiguous: {}, possibleDup: ['X2（2026-09-20 茉莉|100ml ×4）'], priceFallback: ['X3（泰奶：廠務單價 0 → 報價系統 140）'], skipped: [] } };
        case 'saveFactoryMap': (payload.rows || []).forEach(r => { window.FXMAP = window.FXMAP.filter(m => !(m.kind === r.kind && String(m.qs_name) === String(r.qs_name))); if (r.factory_name) window.FXMAP.push(r); }); return { ok: true, saved: 1, removed: 0 };
        case 'saveConsignCustomer': return { ok: true, customer: payload.customer };
        default: return { ok: true, quotes: [], orders: [], records: [], shipments: [], rows: [] };
      }
    };
    window.readCall = async (p, f) => window.apiCall(p);
    gotoPage('consign');
    await new Promise(r => setTimeout(r, 200));
    await initConsignPage(true);
    await new Promise(r => setTimeout(r, 300));
    out.status = document.getElementById('cs-fxstatus').textContent;
    out.blocked = !!CS_FX.blocked['7'] && !CS_FX.map['7'];
    // 11 不連結：選項預選 '-'；改成未指定 → 送空字串；再改回不連結 → 送 '-'
    openConsignCustomerEdit('7'); await new Promise(r => setTimeout(r, 300));
    const sel = document.getElementById('cs-f-fxdealer');
    out.sel7 = { val: sel.value, opts: [...sel.options].map(o => o.value), hint: document.getElementById('cs-f-fxdealer-hint').textContent };
    window.CALLS = [];
    sel.value = ''; await saveConsignCustomerForm(); await new Promise(r => setTimeout(r, 300));
    out.unset = ((window.CALLS.find(x => x.action === 'saveFactoryMap') || {}).rows || [])[0];
    openConsignCustomerEdit('7'); await new Promise(r => setTimeout(r, 300));
    window.CALLS = [];
    document.getElementById('cs-f-fxdealer').value = '-'; await saveConsignCustomerForm(); await new Promise(r => setTimeout(r, 300));
    out.reblock = ((window.CALLS.find(x => x.action === 'saveFactoryMap') || {}).rows || [])[0];
    out.reblockState = !!CS_FX.blocked['7'];
    // 12 代碼重複
    openConsignCustomerEdit('9'); await new Promise(r => setTimeout(r, 300));
    const sel9 = document.getElementById('cs-f-fxdealer');
    out.dup = { disabled: sel9.disabled, hint: document.getElementById('cs-f-fxdealer-hint').textContent };
    if (typeof closeConsignCustomerEdit === 'function') closeConsignCustomerEdit();
    // 13 明細分批
    document.getElementById('cs-customer').value = '4'; onSelectConsignCustomer();
    await new Promise(r => setTimeout(r, 500));
    out.batches = CS_LED_BATCHES.map(b => ({ n: b.rows.length, note: b.note, date: b.date }));
    out.btns = document.querySelectorAll('#cs-ledger-body .cs-vfbtn').length;
    openConsignMove(); out.ban4 = document.getElementById('cs-m-fxbanner').textContent; closeConsignMove();
    document.getElementById('cs-customer').value = '2'; onSelectConsignCustomer();
    await new Promise(r => setTimeout(r, 400));
    openConsignMove(); out.ban2 = document.getElementById('cs-m-fxbanner').textContent; closeConsignMove();
    return out;
  }, { PRODUCTS, CUSTOMERS, DEALERS, MAP, LEDGER });
  check('11a 選了「不連結」的日光貳叁：廠務日光貳參不列進「還沒對到」', !/還沒對到/.test(c.status) || !/日光貳參/.test(c.status), c.status);
  check('11b 下拉有「未指定」「不連結」兩個選項、預選不連結、說明講清楚', c.blocked && c.sel7.val === '-' && c.sel7.opts[0] === '' && c.sel7.opts[1] === '-' && /不會再用名字自動配/.test(c.sel7.hint), JSON.stringify(c.sel7));
  check('11c 改成未指定 → 送空字串（刪對照）；改回不連結 → 送 \'-\'', c.unset && c.unset.factory_name === '' && c.reblock && c.reblock.factory_name === '-' && c.reblockState, JSON.stringify([c.unset, c.reblock]));
  check('12 客戶代碼重複（誠品生活／桃園青埔都是 9）→ 下拉鎖住、講明先改代碼', c.dup.disabled === true && /重複/.test(c.dup.hint) && /誠品生活/.test(c.dup.hint), JSON.stringify(c.dup));
  check('13a 同一張廠務訂單兩趟出貨＝兩批（第 1 趟 2 款、第 2 趟 1 款），驗收單備註不帶廠務摘要', c.btns === 2 && c.batches.length === 2 && c.batches.some(x => x.n === 2 && x.date === '2026-09-18') && c.batches.some(x => x.n === 1 && x.date === '2026-09-20') && c.batches.every(x => x.note === ''), JSON.stringify(c.batches));
  check('13b 登記視窗：連結中的島羽照舊提醒；廠務已停用的 downstair 改說「這裡照常登記」', /不用在這裡再登一次/.test(c.ban4) && /已停用/.test(c.ban2) && /照常登記/.test(c.ban2) && !/不用在這裡再登一次/.test(c.ban2), c.ban2);
  check('14 狀態列：可能重複＋算不出單價先用廠務的（每小時那次的摘要也看得到）', /跟妳手動登過的很像/.test(c.status) && /算不出單價/.test(c.status), c.status);

  // 15／16 月結提示廠務對帳單、售出單價以報價系統為準的提醒
  const d2 = await page.evaluate(async () => {
    const out = {};
    CS_FX.map = { '4': '經銷商－島羽' }; CS_FX.loaded = true; CS_FX.configured = true;
    CS_FX.statements = [{ dealer: '經銷商－島羽', period: '2026-09', status: '已結清', amount: 4200, paidDate: '2026-10-03', orderNo: '261003-001' }];
    CS_CUR = '4';
    let box = document.getElementById('cs-settled'); if (!box) { box = document.createElement('div'); box.id = 'cs-settled'; document.body.appendChild(box); }
    CS_MONTHLY = { ok: true, lines: [{ sku_id: 'A|100ml', name: 'A', volume: '100ml', qty: 2, unit_price: 140, amount: 280 }], total: 280, year: 2026, month: 9, customer: { name: '島羽Wing Islands' }, for_customer: '4', for_ym: '2026-09', period: { from: '2026-09-01', to: '2026-09-30' } };
    window.readCall = async p => ({ ok: true, quotes: [] });
    await csCheckSettled();
    out.settled = (document.getElementById('cs-settled') || {}).textContent || '';
    const cf = []; window.confirm = m => { cf.push(String(m)); return false; };
    const _stale = window.csMonthlyStale; window.csMonthlyStale = () => false;
    consignMonthlyToQuote();
    window.csMonthlyStale = _stale;
    out.confirm = cf.join(' || ');
    CS_FX.lastResult = { at: 'x', unmappedDealers: {}, unmappedProducts: {}, ambiguous: {}, possibleDup: [], priceFallback: [], priceDiff: ['Z1（2026-09-24 泰奶|100ml：廠務 120／報價系統 140）'] };
    CS_FX.dealers = [{ key: '經銷商－島羽', label: '島羽 Wing Islands', enabled: true }];
    csFxRenderStatus();
    out.status = (document.getElementById('cs-fxstatus') || {}).textContent || '';
    return out;
  });
  check('15a 月結：廠務這期已結清 → 顯示金額／入帳／認列單、講明會重複請款', /廠務這期（2026-09）已經登記結清/.test(d2.settled) && /4,200/.test(d2.settled) && /261003-001/.test(d2.settled), d2.settled);
  check('15b 轉報價單前再問一次（廠務已結清）', /廠務這期（2026-09）已經登記結清/.test(d2.confirm) && /重複請款/.test(d2.confirm), d2.confirm);
  check('16 狀態列：售出單價廠務跟這裡不一樣 → 已照報價系統記、請同仁改廠務折扣', /照報價系統的記/.test(d2.status) && /廠務 120／報價系統 140/.test(d2.status), d2.status);

  check('00 零 JS 例外／console error', errors.length === 0, errors.slice(0, 3).join(' | '));
  results.forEach(r => console.log(r[0], r[1], r[2] ? '  ← ' + r[2] : ''));
  const fails = results.filter(r => r[0] === 'FAIL').length;
  console.log(`\n${results.length - fails}/${results.length} PASS${fails ? ' — ' + fails + ' FAIL' : ''}`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
