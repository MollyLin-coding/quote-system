/* 2026-08-03 全面複檢修正包 離線測試
   1) resetAll 斷開 editingQuoteNo（清除後儲存不再蓋掉舊單）
   2) 編輯舊單時 upNo 不重排單號（改日期/流水號單號不變）
   3) 服務費殘留：載入沒有服務費的單要清空上一張的服務費
   4) svcdetail 特殊列：服務費拆項（調酒師費/車馬費/人數）重開還原
   5) 稅率空字串載入＝5%（不再變 0%）
   6) noCharge='N' 且小計 0 的列不再被誤判成贈品
   7) quoteHasItems 不把「Lot 」預填字當成有內容
   8) 宴會加購列名稱含引號 往返不損毀
   9) 行事曆儲存/刪除失敗要還原快照（不再整頁清空）
   10) calSnap5 半夜不繞回 00:00
   11) eventsOn 用有效狀態判斷報價到期
   12) rcClear 連 RC_INFLIGHT 一起清
   13) readCallMany 超過 8 份自動拆批、BATCH_OK 不誤關
   14) batch 子回應 UNAUTHORIZED 一樣導回登入
   15) 客戶主檔 active=N 不進下拉/清單
   16) newQuote 取消時回傳 false（cusNewQuote 不覆寫表單）
   17) 自訂單載入前的未儲存確認 */
const { chromium } = require('/opt/node-tools/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  const isNoise = t => /Failed to load resource|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|favicon/i.test(t);
  page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('CONSOLE: ' + m.text()); });

  await page.goto('http://localhost:8899/index.html');
  const results = [];
  const check = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);

  await page.evaluate(() => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 'test-token';
    window.confirm = () => true;
    window.__origApiCall = apiCall;   // 留住真的 apiCall（測試 14 要用）
    window.apiCall = async (p) => ({ ok: true, quotes: [], orders: [], records: [], items: [] });
    gotoPage('form');
  });

  /* ---------- 1) resetAll 斷開 editingQuoteNo ---------- */
  const r1 = await page.evaluate(() => {
    loadQuoteIntoForm({ quoteNo: '20260701-05', quoteType: 'bottle', clientName: '舊客戶', quoteDate: '2026-07-01',
      items: [{ itemType: 'bottle', name: '舊酒', volume: 700, unitPrice: 300, qty: 10, subtotal: 3000 }] });
    const before = editingQuoteNo;
    resetAll(true);
    return { before, after: editingQuoteNo, dirty: FORM_DIRTY, no: document.getElementById('f-no').value };
  });
  check('載入舊單後 editingQuoteNo 有值', r1.before === '20260701-05');
  check('resetAll 後 editingQuoteNo 清空（儲存不會蓋舊單）', r1.after === null);
  check('resetAll 後 FORM_DIRTY=false', r1.dirty === false);
  check('resetAll 後單號回到今天的新號', r1.no !== '20260701-05' && !!r1.no);

  /* ---------- 2) 編輯舊單時 upNo 不重排單號 ---------- */
  const r2 = await page.evaluate(() => {
    loadQuoteIntoForm({ quoteNo: '20260710-03', quoteType: 'bottle', clientName: 'X', quoteDate: '2026-07-10', items: [] });
    document.getElementById('f-dt').value = '2026-08-01';
    onDate();   // 會呼叫 upNo()
    return { no: document.getElementById('f-no').value, pl: document.getElementById('pl-no').textContent };
  });
  check('編輯舊單改日期：單號維持原單號', r2.no === '20260710-03' && r2.pl === '20260710-03');

  /* ---------- 3+4) 服務費殘留清除＋svcdetail 拆項還原 ---------- */
  const r3 = await page.evaluate(() => {
    resetAll(true);
    setType('banquet');
    document.getElementById('f-cli').value = '宴會A';
    document.getElementById('svc-mode').value = 'travel'; onSvcModeChange();
    document.getElementById('svc-amt1').value = '3000';
    document.getElementById('svc-amt2').value = '800';
    document.getElementById('svc-qty').value = '2';
    document.getElementById('ban-g1-price').value = '100';
    document.getElementById('ban-g1-qty').value = '10';
    calcBan();
    return collectQuote();
  });
  const sd = (r3.items || []).find(it => it.itemType === 'svcdetail');
  check('collectQuote 產生 svcdetail 拆項列', !!sd && +sd.unitPrice === 3000 && +sd.deduction === 800 && +sd.qty === 2);
  check('svcAmount 計算正確（(3000+800)×2）', r3.svcAmount === 7600);

  // 模擬後端往返：主表只回 svcMode/svcAmount，拆項欄位不見
  const rt3 = JSON.parse(JSON.stringify(r3));
  delete rt3.svcAmt1; delete rt3.svcAmt2; delete rt3.svcQty;
  rt3.quoteNo = '20260803-91';
  const r4 = await page.evaluate((q) => {
    resetAll(true); loadQuoteIntoForm(q);
    return { a1: document.getElementById('svc-amt1').value, a2: document.getElementById('svc-amt2').value,
             qy: document.getElementById('svc-qty').value, mode: document.getElementById('svc-mode').value };
  }, rt3);
  check('重開：服務費拆項自 svcdetail 列還原', r4.mode === 'travel' && r4.a1 === '3000' && r4.a2 === '800' && r4.qy === '2');

  // 再載入一張「沒有服務費」的宴會單 → 殘留要清掉
  const r5 = await page.evaluate(() => {
    loadQuoteIntoForm({ quoteNo: '20260803-92', quoteType: 'banquet', clientName: '宴會B', quoteDate: '2026-08-03',
      items: [{ itemType: 'banquet_group', name: '客製化調酒', unitPrice: 150, qty: 80, unit: '杯', subtotal: 12000 }] });
    return { mode: document.getElementById('svc-mode').value, a1: document.getElementById('svc-amt1').value,
             tot: document.getElementById('t-tot').textContent };
  });
  check('載入無服務費的單：svc 欄位清空', r5.mode === '' && r5.a1 === '');
  check('無服務費的單總計不含上一張的服務費', !r5.tot.replace(/[$,]/g, '').includes('7600'));

  // svcdetail 不會在瓶裝單多出品項列
  const r6 = await page.evaluate(() => {
    resetAll(true);
    loadQuoteIntoForm({ quoteNo: '20260803-93', quoteType: 'bottle', clientName: 'C', quoteDate: '2026-08-03',
      items: [{ itemType: 'bottle', name: '琴酒', volume: 700, unitPrice: 500, qty: 10, subtotal: 5000 },
              { itemType: 'svcdetail', name: '服務費拆項', unitPrice: 3000, deduction: 800, qty: 2, subtotal: 0 }] });
    return botItems.length;
  });
  check('svcdetail 列不會變成瓶裝品項列', r6 === 1);

  /* ---------- 5) 稅率空字串＝5% ---------- */
  const r7 = await page.evaluate(() => {
    resetAll(true);
    loadQuoteIntoForm({ quoteNo: '20260803-94', quoteType: 'bottle', clientName: 'D', quoteDate: '2026-08-03', taxRate: '',
      items: [{ itemType: 'bottle', name: '酒', volume: 700, unitPrice: 100, qty: 10, subtotal: 1000 }] });
    const tr5 = document.getElementById('taxrate').value;
    loadQuoteIntoForm({ quoteNo: '20260803-95', quoteType: 'bottle', clientName: 'E', quoteDate: '2026-08-03', taxRate: 0,
      items: [{ itemType: 'bottle', name: '酒', volume: 700, unitPrice: 100, qty: 10, subtotal: 1000 }] });
    return { blank: tr5, zero: document.getElementById('taxrate').value };
  });
  check('舊單稅率空白 → 載入為 5%（不再變 0%）', r7.blank === '5');
  check('稅率明確存 0（免稅）→ 保持 0', r7.zero === '0');

  /* ---------- 6) noCharge='N' 小計 0 不誤判贈品 ---------- */
  const r8 = await page.evaluate(() => {
    resetAll(true);
    loadQuoteIntoForm({ quoteNo: '20260803-96', quoteType: 'bottle', clientName: 'F', quoteDate: '2026-08-03',
      items: [{ itemType: 'bottle', name: '全額折抵列', volume: 700, unitPrice: 300, deduction: -300, qty: 10, subtotal: 0, noCharge: 'N' },
              { itemType: 'bottle', name: '真贈品', volume: 700, unitPrice: 300, qty: 2, subtotal: 0, noCharge: 'Y' }] });
    const g = id => { const r = document.getElementById('r-' + id); const c = r.querySelector('[data-f="gift"]'); return c ? c.checked : false; };
    return { first: g(botItems[0]), second: g(botItems[1]) };
  });
  check("noCharge='N' 且小計 0：不標成贈品", r8.first === false);
  check("noCharge='Y'：照樣標贈品", r8.second === true);

  /* ---------- 7) quoteHasItems 不吃「Lot 」預填字 ---------- */
  const r9 = await page.evaluate(() => {
    resetAll(true);
    toggleCol('lot');            // 開出貨批次欄 → 新空列預填「Lot 」
    addBotRow();
    const withPrefill = quoteHasItems();
    const row = document.getElementById('r-' + botItems[0]);
    row.querySelector('[data-f="name"]').value = '真的有品名';
    const withName = quoteHasItems();
    toggleCol('lot');            // 關回去
    return { withPrefill, withName };
  });
  check('只有「Lot 」預填字：quoteHasItems=false（空單擋得住）', r9.withPrefill === false);
  check('有真品名：quoteHasItems=true', r9.withName === true);

  /* ---------- 8) 加購列名稱含引號 往返不損毀 ---------- */
  const r10 = await page.evaluate(() => {
    resetAll(true); setType('banquet');
    document.getElementById('f-cli').value = 'G';
    const rid = banAddonItems[0];
    const row = document.getElementById('ba-' + rid);
    row.querySelector('[data-f="name"]').value = '冰雕（含"LOGO"雕刻）';
    row.querySelector('[data-f="qty"]').value = '1';
    row.querySelector('[data-f="price"]').value = '2000';
    calc();
    const q = collectQuote(); q.quoteNo = '20260803-97';
    resetAll(true); loadQuoteIntoForm(q);
    const row2 = document.getElementById('ba-' + banAddonItems[0]);
    return row2.querySelector('[data-f="name"]').value;
  });
  check('加購列名稱含雙引號：重開完整還原', r10 === '冰雕（含"LOGO"雕刻）');

  /* ---------- 9) 行事曆儲存/刪除失敗要還原快照 ---------- */
  const r11 = await page.evaluate(async () => {
    CAL_ITEMS = [
      { item_id: 'ci-1', kind: 'memo', date: '2026-08-03', title: '重要備忘', category: '工作', done: 'N' },
      { item_id: 'ci-2', kind: 'memo', date: '2026-08-04', title: '另一筆', category: '工作', done: 'N' }
    ];
    ORDERS_CACHE = [{ no: '20260801-01', client: '客戶X', type: '瓶裝', typeKey: 'bottle', total: 100, quoteDate: '2026-08-01', expiry: '', st: null, src: 'std' }];
    window.apiCall = async (p) => { rcClear(); return { ok: false, error: '模擬後端驗證失敗' }; };   // 寫入清快取＋回 ok:false
    gotoPage('calendar'); await new Promise(r => setTimeout(r, 300));
    CAL_ITEMS = [
      { item_id: 'ci-1', kind: 'memo', date: '2026-08-03', title: '重要備忘', category: '工作', done: 'N' },
      { item_id: 'ci-2', kind: 'memo', date: '2026-08-04', title: '另一筆', category: '工作', done: 'N' }
    ];
    ORDERS_CACHE = [{ no: '20260801-01', client: '客戶X', type: '瓶裝', typeKey: 'bottle', total: 100, quoteDate: '2026-08-01', expiry: '', st: null, src: 'std' }];
    openCalEdit('ci-1'); await new Promise(r => setTimeout(r, 100));
    await saveCalItem();
    const afterSaveFail = { cal: CAL_ITEMS.length, ord: (ORDERS_CACHE || []).length };
    // 刪除失敗也要還原
    CAL_EDIT_ID = 'ci-1';
    await deleteCalItem();
    const afterDelFail = { cal: CAL_ITEMS.length };
    closeCalEdit();
    window.apiCall = async (p) => ({ ok: true, quotes: [], orders: [], records: [], items: [] });
    return { afterSaveFail, afterDelFail };
  });
  check('儲存失敗：CAL_ITEMS 還原（不再整頁清空）', r11.afterSaveFail.cal === 2);
  check('儲存失敗：ORDERS_CACHE 也還原', r11.afterSaveFail.ord === 1);
  check('刪除失敗：CAL_ITEMS 還原', r11.afterDelFail.cal === 2);

  /* ---------- 10) calSnap5 半夜不繞回 00:00 ---------- */
  const r12 = await page.evaluate(() => [calSnap5('23:58'), calSnap5('14:03'), calSnap5('09:59')]);
  check('calSnap5(23:58) → 23:55（不繞回 00:00）', r12[0] === '23:55');
  check('calSnap5(14:03) → 14:05', r12[1] === '14:05');
  check('calSnap5(09:59) → 10:00', r12[2] === '10:00');

  /* ---------- 11) eventsOn 用有效狀態判斷報價到期 ---------- */
  const r13 = await page.evaluate(() => {
    ORDERS_CACHE = [
      { no: '20260720-01', client: '已收訂客戶', type: '瓶裝', typeKey: 'bottle', total: 100, quoteDate: '2026-07-20', expiry: '2026-08-20',
        st: { quote_no: '20260720-01', status: 'quoted', deposit_date: '2026-07-25' }, src: 'std' },
      { no: '20260720-02', client: '純報價客戶', type: '瓶裝', typeKey: 'bottle', total: 100, quoteDate: '2026-07-20', expiry: '2026-08-20', st: null, src: 'std' }
    ];
    CAL_ITEMS = [];
    return eventsOn('2026-08-20').map(e => e.txt);
  });
  check('已收訂金的單不再顯示「報價到期」', !r13.some(t => t.includes('已收訂客戶') && t.includes('報價到期')));
  check('沒進度的單照常顯示「報價到期」', r13.some(t => t.includes('純報價客戶') && t.includes('報價到期')));

  /* ---------- 12) rcClear 連 RC_INFLIGHT 一起清 ---------- */
  const r14 = await page.evaluate(async () => {
    let resolveOld; const oldData = { ok: true, quotes: ['舊資料'] };
    window.apiCall = (p) => new Promise(res => { resolveOld = () => res(oldData); });
    const P = { action: 'getQuotes', token: 'T' };
    const p1 = readCall(P);                    // 舊請求出發（掛著不回）
    rcClear();                                  // 模擬寫入清快取
    let gotNew = false;
    window.apiCall = async (p) => { gotNew = true; return { ok: true, quotes: ['新資料'] }; };
    const d2 = await readCall(P);               // 清除後的新讀取：不該搭到舊班車
    resolveOld();
    window.apiCall = async (p) => ({ ok: true });
    return { gotNew, fresh: d2.quotes && d2.quotes[0] === '新資料' };
  });
  check('rcClear 後的新讀取不搭舊班車（重新打後端）', r14.gotNew === true && r14.fresh === true);

  /* ---------- 13) readCallMany 超過 8 份自動拆批 ---------- */
  const r15 = await page.evaluate(async () => {
    rcClear(); BATCH_OK = true;
    const batchSizes = [];
    window.apiCall = async (p) => {
      if (p.action === 'batch') { batchSizes.push(p.calls.length); return { ok: true, results: p.calls.map(c => ({ ok: true, tag: c.action })) }; }
      return { ok: true };
    };
    const payloads = []; for (let i = 0; i < 9; i++) payloads.push({ action: 'getQuotes', token: 'T', which: i });
    await readCallMany(payloads);
    return { batchSizes, batchOk: BATCH_OK };
  });
  check('9 份 payload 拆成 8+1 兩班車', JSON.stringify(r15.batchSizes) === '[8,1]');
  check('拆批後 BATCH_OK 沒被誤關', r15.batchOk === true);

  /* ---------- 14) batch 子回應 UNAUTHORIZED 導回登入 ---------- */
  const r16 = await page.evaluate(async () => {
    // 還原真的 apiCall 邏輯：改 stub fetch
    window.apiCall = window.__origApiCall;
    const realFetch = window.fetch;
    window.fetch = async () => ({ text: async () => JSON.stringify({ ok: true, results: [{ ok: false, error: 'UNAUTHORIZED: token 無效' }] }) });
    AUTH_TOKEN = 'T';
    let threw = '';
    try { await apiCall({ action: 'batch', token: 'T', calls: [{ action: 'getQuotes' }] }); }
    catch (e) { threw = e.message; }
    const loggedOut = (AUTH_TOKEN === null);
    window.fetch = realFetch;
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 'test-token';
    window.apiCall = async (p) => ({ ok: true, quotes: [], orders: [], records: [], items: [] });
    return { threw, loggedOut };
  });
  check('batch 子回應 UNAUTHORIZED：擋下並導回登入', r16.threw.includes('重新登入') && r16.loggedOut === true);

  /* ---------- 15) 客戶主檔 active=N 過濾 ---------- */
  const r17 = await page.evaluate(() => {
    CUS_MASTER = [
      { customer_id: 'C001', name: '正常客戶', active: 'Y' },
      { customer_id: 'C002', name: '停用客戶', active: 'N' }
    ];
    cusFillPickSelect();
    const sel = document.getElementById('f-cuspick');
    const opts = sel ? Array.from(sel.options).map(o => o.textContent) : [];
    CUS_DATA = [
      { key: 'a', name: '正常客戶', quotes: [], count: 1, dealCount: 0, dealSum: 0, unpaid: 0, pending: 0, lastDate: '2026-08-01', master: { customer_id: 'C001', active: 'Y' } },
      { key: 'b', name: '停用客戶', quotes: [], count: 1, dealCount: 0, dealSum: 0, unpaid: 0, pending: 0, lastDate: '2026-08-01', master: { customer_id: 'C002', active: 'N' } }
    ];
    const listed = cusSorted().map(c => c.name);
    return { opts, listed };
  });
  check('停用客戶不進「選既有客戶」下拉', !r17.opts.some(t => t.includes('停用客戶')) && r17.opts.some(t => t.includes('正常客戶')));
  check('停用客戶不列在客戶管理清單', !r17.listed.includes('停用客戶') && r17.listed.includes('正常客戶'));

  /* ---------- 16) newQuote 取消回傳 false ---------- */
  const r18 = await page.evaluate(() => {
    gotoPage('form');
    resetAll(true);
    document.getElementById('f-cli').value = '打到一半的客戶';
    FORM_DIRTY = true;
    window.confirm = () => false;               // 使用者按取消
    const ret = newQuote();
    const cliAfter = document.getElementById('f-cli').value;
    window.confirm = () => true;
    return { ret, cliAfter };
  });
  check('newQuote 取消：回傳 false、表單內容保留', r18.ret === false && r18.cliAfter === '打到一半的客戶');

  /* ---------- 17) 自訂單載入前的未儲存確認 ---------- */
  const r19 = await page.evaluate(async () => {
    gotoPage('custom'); await new Promise(r => setTimeout(r, 200));
    resetCustom(true);
    document.getElementById('c-cli').value = '自訂單打到一半';
    window._CQ_CACHE = [{ quote_no: 'CQ-01', tag: '', client: '別的客戶', items_json: '[]', headers_json: '{}', totals_json: '{}' }];
    window.confirm = () => false;               // 按取消 → 不覆蓋
    await loadCustomQuoteByNo('CQ-01', false);
    const kept = document.getElementById('c-cli').value;
    window.confirm = () => true;                // 按確定 → 正常載入
    await loadCustomQuoteByNo('CQ-01', false);
    const loaded = document.getElementById('c-cli').value;
    return { kept, loaded };
  });
  check('自訂單載入按取消：不覆蓋打到一半的內容', r19.kept === '自訂單打到一半');
  check('自訂單載入按確定：正常載入', r19.loaded === '別的客戶');

  const pass = results.filter(r => r[0] === 'PASS').length;
  results.forEach(r => console.log(r[0] + '  ' + r[1]));
  console.log(`\n${pass}/${results.length} PASS`);
  if (errors.length) { console.log('\n--- 頁面錯誤 ---'); errors.forEach(e => console.log(e)); }
  await browser.close();
  process.exit(pass === results.length && errors.length === 0 ? 0 : 1);
})();
