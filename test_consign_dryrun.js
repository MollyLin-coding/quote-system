/* ⚠ 已作廢（2026-08-21）：Molly 決定寄售不再走保證金制，相關 UI／函式（csCustomerNeedsDeposit、
   csMoveDepositUnit、csMoveDepositHint、保證金餘額、在池瓶數、退保證金異動）全部從前端移除。
   本檔中與保證金有關的斷言已經不成立，保留只為留存當時的需求紀錄，不要再拿來當回歸測試。
   現行的寄售回歸測試請看 test_consign_multimove.js 與 test_nodeposit_20260821.js。 */
if (!process.env.RUN_OBSOLETE) { console.log('SKIPPED（已作廢，見檔案開頭說明；要強制執行請設 RUN_OBSOLETE=1）'); process.exit(0); }
/* 2026-07-30 寄售系統上線前預跑 → 修正後驗證（離線）
   stub 後端照 gas/v3_ownbrand.gs「v41 修正後」邏輯（月結按 SKU|單價分組、客戶回傳全部含停用）。
   驗證整條流程＋五個 BUG 的修正＋速度改動：
   ①混價月結轉報價單 ②換客戶匯出舊單 ③代碼撞號覆蓋 ④停用客戶消失 ⑤超賣不擋
   ＋庫存/明細走 readCall 快取（切客戶 0 請求）＋鋪貨即時顯示保證金 */
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

  /* ---------- stub 後端（v41 修正後邏輯）---------- */
  await page.evaluate(() => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 'test-token';
    window.CONFIRMS = []; window.CONFIRM_ANSWER = true;
    window.confirm = (msg) => { CONFIRMS.push(msg); return CONFIRM_ANSWER; };
    window.API_COUNT = {};

    window.DB = {
      products: [
        { sku_id: '蜜香紅茶荔枝琴酒|100ml', name: '蜜香紅茶荔枝琴酒', abv: '8%', volume: '100ml', list_price: 200, active: 'Y' },
        { sku_id: '蜜香紅茶荔枝琴酒|500ml', name: '蜜香紅茶荔枝琴酒', abv: '8%', volume: '500ml', list_price: 850, active: 'Y' },
        { sku_id: '琥珀烏龍威士忌|500ml', name: '琥珀烏龍威士忌', abv: '14%', volume: '500ml', list_price: 1000, active: 'Y' }
      ],
      tiers: [{ channel: 'buyout', min_qty: 200, discount: 0.6, free_ship: 'Y' }, { channel: 'consign', min_qty: 0, discount: 0.75, free_ship: 'N' }],
      terms: { deposit_100ml: 50, deposit_500ml: 250, exchange_months: 6, foq_100ml: 25, foq_500ml: 12 },
      customers: [], discounts: [], ledger: [], seq: 0
    };
    const resolveDisc = (cid, sku) => {
      const ex = DB.discounts.find(d => d.customer_id === cid && d.sku_id === sku);
      if (ex) return Number(ex.discount);
      const c = DB.customers.find(c => c.customer_id === cid);
      if (c && c.default_discount !== '' && c.default_discount != null) return Number(c.default_discount);
      return 0.75;
    };
    const resolvePrice = (cid, sku) => {
      const p = DB.products.find(p => p.sku_id === sku);
      return Math.round(Number(p.list_price) * resolveDisc(cid, sku));
    };
    window.apiCall = async (q) => {
      const a = q.action;
      API_COUNT[a] = (API_COUNT[a] || 0) + 1;
      if (!rcIsRead(a)) rcClear();   // 模擬真 apiCall：寫入動作一律清讀取快取
      if (a === 'getOwnbrandProducts') return { ok: true, products: DB.products.filter(p => p.active !== 'N') };
      if (a === 'getOwnbrandTiers') return { ok: true, tiers: DB.tiers, terms: DB.terms };
      if (a === 'getConsignCustomers') { // v41：回傳全部，啟用中排前
        const all = DB.customers.slice().sort((x, y) => ((String(x.active).toUpperCase() === 'N') ? 1 : 0) - ((String(y.active).toUpperCase() === 'N') ? 1 : 0));
        return { ok: true, customers: all, discounts: DB.discounts };
      }
      if (a === 'saveConsignCustomer') {
        const c = q.customer || q;
        const i = DB.customers.findIndex(x => x.customer_id === c.customer_id);
        if (i >= 0) Object.assign(DB.customers[i], c); else DB.customers.push(Object.assign({}, c));
        return { ok: true, customer: c };
      }
      if (a === 'addConsignMovement') {
        const m = q.movement || q;
        let up = m.unit_price;
        if (m.type === 'out' && (up === undefined || up === null || up === '')) up = resolvePrice(m.customer_id, m.sku_id);
        const row = { movement_id: 'CM-' + String(++DB.seq).padStart(4, '0'), date: m.date, customer_id: m.customer_id, sku_id: m.sku_id, type: m.type, qty: Number(m.qty), unit_price: (m.type === 'out' ? up : (up != null ? up : '')), note: m.note || '' };
        DB.ledger.push(row);
        return { ok: true, movement: row };
      }
      if (a === 'addConsignMovements') {   // 8/3 加：鋪貨/補貨一次登記多款，複數版本
        const rows = (q.movements || []).map(m => {
          let up = m.unit_price;
          if (m.type === 'out' && (up === undefined || up === null || up === '')) up = resolvePrice(m.customer_id, m.sku_id);
          const row = { movement_id: 'CM-' + String(++DB.seq).padStart(4, '0'), date: m.date, customer_id: m.customer_id, sku_id: m.sku_id, type: m.type, qty: Number(m.qty), unit_price: (m.type === 'out' ? up : (up != null ? up : '')), note: m.note || '' };
          DB.ledger.push(row);
          return row;
        });
        return { ok: true, movements: rows };
      }
      if (a === 'getConsignInventory') {
        const agg = {};
        DB.ledger.forEach(r => {
          if (q.customer_id && String(r.customer_id) !== String(q.customer_id)) return;
          const k = r.customer_id + '|' + r.sku_id;
          if (!agg[k]) agg[k] = { customer_id: r.customer_id, sku_id: r.sku_id, in: 0, out: 0, return: 0, adjust: 0, deposit_refund: 0 };
          agg[k][r.type] += Number(r.qty) || 0;
        });
        const inventory = Object.values(agg).map(a2 => {
          const p = DB.products.find(p => p.sku_id === a2.sku_id) || {};
          return Object.assign({}, a2, { name: p.name || '', volume: p.volume || '', balance: a2.in - a2.out - a2.return + a2.adjust, deposit_pool_qty: a2.in - a2.return - a2.deposit_refund });
        });
        const dep = {};
        inventory.forEach(r => {
          if (r.deposit_pool_qty <= 0) return;
          const u = r.volume === '100ml' ? DB.terms.deposit_100ml : (r.volume === '500ml' ? DB.terms.deposit_500ml : 0);
          dep[r.customer_id] = (dep[r.customer_id] || 0) + r.deposit_pool_qty * u;
        });
        return { ok: true, inventory, deposit_held_by_customer: dep };
      }
      if (a === 'getConsignLedger') {
        let rows = DB.ledger.slice();
        if (q.customer_id) rows = rows.filter(r => String(r.customer_id) === String(q.customer_id));
        return { ok: true, rows };
      }
      if (a === 'getConsignMonthly') {
        const from = q.year + '-' + String(q.month).padStart(2, '0') + '-01';
        const to = q.year + '-' + String(q.month).padStart(2, '0') + '-31';
        const rows = DB.ledger.filter(r => r.customer_id === q.customer_id && r.type === 'out' && r.date >= from && r.date <= to);
        const byKey = {};   // v41：SKU|單價 分組
        rows.forEach(r => {
          const key = r.sku_id + '|' + Number(r.unit_price);
          if (!byKey[key]) byKey[key] = { sku_id: r.sku_id, qty: 0, amount: 0, unit_price: Number(r.unit_price) };
          byKey[key].qty += Number(r.qty); byKey[key].amount += Number(r.qty) * Number(r.unit_price);
        });
        const lines = Object.values(byKey).map(b => {
          const p = DB.products.find(p => p.sku_id === b.sku_id) || {};
          return Object.assign({ name: p.name, volume: p.volume }, b);
        });
        return { ok: true, lines, total: lines.reduce((s, l) => s + l.amount, 0), period: { from, to } };
      }
      return { ok: true, quotes: [], orders: [], records: [], items: [], rows: [] };
    };
  });

  /* ---------- 1) 進頁 → 新增客戶 ---------- */
  await page.evaluate(() => gotoPage('consign'));
  await page.waitForTimeout(300);
  await page.evaluate(async () => { await initConsignPage(true); });
  check('寄售頁初始化：公版酒下拉載入', await page.evaluate(() => (OWNBRAND_PRODUCTS || []).length === 3));

  const addCustomer = async (id, name, disc) => {
    await page.evaluate(({ id, name, disc }) => {
      openConsignCustomerEdit('');
      document.getElementById('cs-f-id').value = id;
      document.getElementById('cs-f-name').value = name;
      document.getElementById('cs-f-disc').value = disc;
      return saveConsignCustomerForm();
    }, { id, name, disc });
    await page.waitForTimeout(250);
  };
  await addCustomer('CS001', '滿枝枒餐酒館', '0.75');
  check('新增客戶後自動選取', await page.evaluate(() => CS_CUR === 'CS001'));

  /* ---------- 2) 鋪貨：即時顯示應收保證金 ---------- */
  await page.evaluate(() => openConsignMove());
  await page.waitForTimeout(150);
  const depHint = await page.evaluate(() => {
    document.getElementById('cs-m-type').value = 'in';
    document.getElementById('cs-m-sku').value = '蜜香紅茶荔枝琴酒|500ml';
    document.getElementById('cs-m-qty').value = '30';
    csMoveDepositHint();
    const t = document.getElementById('cs-m-dephint').textContent;
    closeConsignMove();
    return t;
  });
  check('鋪貨彈窗即時顯示應收保證金 $7,500', depHint.includes('$7,500'));

  const mv = async (type, sku, qty, date, price) => {
    await page.evaluate(() => openConsignMove());
    await page.waitForTimeout(150);   // SKU 下拉可能需要自動補載（寫入後快取被清）
    await page.evaluate(({ type, sku, qty, date, price }) => {
      document.getElementById('cs-m-type').value = type;
      document.getElementById('cs-m-date').value = date;
      if (type === 'in') {
        // 8/3 起鋪貨/補貨改用多列 UI（一次可登記多款）；這支舊測試沿用單筆語意，塞進第一列，
        // 並關掉「同時產生出貨驗收單」（這支測試不驗證驗收單，不需要多開一個彈窗）
        csMoveItems[0].sku = sku; csMoveItems[0].qty = String(qty);
        renderCsMoveItems();
        const g = document.getElementById('cs-m-genvf'); if (g) g.checked = false;
      } else {
        document.getElementById('cs-m-sku').value = sku;
        document.getElementById('cs-m-qty').value = String(qty);
        document.getElementById('cs-m-price').value = price == null ? '' : String(price);
      }
      return saveConsignMove();
    }, { type, sku, qty, date, price });
    await page.waitForTimeout(250);
  };
  await mv('in', '蜜香紅茶荔枝琴酒|500ml', 30, '2026-07-02');
  let dep = await page.evaluate(() => document.getElementById('cs-deposit').textContent);
  check('鋪貨30瓶(500ml)後 保證金餘額=$7,500', dep === '$7,500');

  /* ---------- 3) 銷售自動套價＋保證金不動＋庫存 ---------- */
  await mv('out', '蜜香紅茶荔枝琴酒|500ml', 5, '2026-07-10');
  check('銷售留空單價 → 自動套 75 折（$638）', await page.evaluate(() => DB.ledger.find(r => r.type === 'out').unit_price === 638));
  dep = await page.evaluate(() => document.getElementById('cs-deposit').textContent);
  check('售出後保證金不變（$7,500）', dep === '$7,500');
  check('售出後實體庫存 30-5=25', await page.evaluate(() => (CS_INV.find(r => r.sku_id === '蜜香紅茶荔枝琴酒|500ml') || {}).balance === 25));

  /* ---------- 4) 修正①：混價月結分列，轉報價單金額正確 ---------- */
  await mv('out', '蜜香紅茶荔枝琴酒|500ml', 10, '2026-07-20', 600);
  await page.evaluate(() => { document.getElementById('cs-month').value = '2026-07'; csClearMonthly(); });
  await page.evaluate(() => loadConsignMonthly());
  await page.waitForTimeout(250);
  const m1 = await page.evaluate(() => ({ total: CS_MONTHLY.total, n: CS_MONTHLY.lines.length, selfOk: CS_MONTHLY.lines.every(l => l.qty * l.unit_price === l.amount) }));
  const realTotal = 5 * 638 + 10 * 600;   // 9,190
  check('修正①：混價月結分成兩列、每列 qty×單價＝小計', m1.n === 2 && m1.selfOk);
  check('修正①：月結 total 正確 $9,190', m1.total === realTotal);
  await page.evaluate(() => consignMonthlyToQuote());
  await page.waitForTimeout(300);
  const qTotal = await page.evaluate(() => collectQuote().items.reduce((s, i) => s + (parseFloat(i.subtotal) || 0), 0));
  check('修正①：轉報價單總額＝真實月結 $9,190', qTotal === realTotal);

  /* ---------- 5) 修正②：換客戶/換月份後擋住舊月結 ---------- */
  await page.evaluate(() => gotoPage('consign'));
  await addCustomer('CS002', '春風小酒吧', '0.7');
  check('已切到客戶 CS002', await page.evaluate(() => CS_CUR === 'CS002'));
  const staleBlocked = await page.evaluate(() => {
    let opened = false;
    window.open = () => { opened = true; return { document: { write: () => {}, close: () => {} } }; };
    exportConsignMonthly();
    return !opened && CS_MONTHLY === null;   // 換客戶時已清空＋匯出被擋
  });
  check('修正②：換客戶後按匯出 → 被擋下（不會印到別人的單）', staleBlocked);
  const staleQuote = await page.evaluate(() => { consignMonthlyToQuote(); return currentPage; });
  check('修正②：換客戶後按轉報價單 → 一樣被擋（停在寄售頁）', staleQuote === 'consign');

  /* ---------- 6) 修正③：代碼撞號被擋 ---------- */
  await addCustomer('CS001', '完全不同的新客戶', '0.9');
  const notOverwritten = await page.evaluate(() => DB.customers.find(c => c.customer_id === 'CS001').name === '滿枝枒餐酒館');
  check('修正③：新增時打到既有代碼 CS001 → 被擋、舊客戶沒被覆蓋', notOverwritten);
  await page.evaluate(() => closeConsignCustomerEdit());

  /* ---------- 7) 修正④：停用客戶仍在清單（標示已停用、排最後）---------- */
  await page.evaluate(async () => {
    DB.customers.find(c => c.customer_id === 'CS002').active = 'N';
    await loadConsignCustomers(true);
  });
  const inactive = await page.evaluate(() => {
    const c = CS_CUSTOMERS.find(c => c.customer_id === 'CS002');
    const opt = Array.from(document.getElementById('cs-customer').options).find(o => o.value === 'CS002');
    return { present: !!c, label: opt ? opt.textContent : '' };
  });
  check('修正④：停用客戶仍可選（可退保證金/看帳）', inactive.present);
  check('修正④：下拉顯示「（已停用）」標籤', inactive.label.includes('已停用'));

  /* ---------- 8) 修正⑤：超賣跳確認 ---------- */
  await page.evaluate(async () => { document.getElementById('cs-customer').value = 'CS001'; onSelectConsignCustomer(); });
  await page.waitForTimeout(250);
  await page.evaluate(() => { CONFIRMS.length = 0; CONFIRM_ANSWER = false; });   // 按「取消」
  await mv('out', '蜜香紅茶荔枝琴酒|500ml', 100, '2026-07-25');
  const c1 = await page.evaluate(() => ({ asked: CONFIRMS.length > 0, msg: CONFIRMS[0] || '', bal: (CS_INV.find(r => r.sku_id === '蜜香紅茶荔枝琴酒|500ml') || {}).balance }));
  check('修正⑤：庫存 15 賣 100 → 跳確認（含剩餘瓶數）', c1.asked && c1.msg.includes('15'));
  check('修正⑤：按取消 → 沒有登記，庫存還是 15', c1.bal === 15);
  await page.evaluate(() => { CONFIRM_ANSWER = true; });   // 按「確定」→ 照登記（提醒不硬擋）
  await mv('out', '蜜香紅茶荔枝琴酒|500ml', 100, '2026-07-25');
  check('修正⑤：按確定仍可登記（保留彈性）', await page.evaluate(() => (CS_INV.find(r => r.sku_id === '蜜香紅茶荔枝琴酒|500ml') || {}).balance === -85));
  /* 退保證金超過在池瓶數也要提醒 */
  await page.evaluate(() => { CONFIRMS.length = 0; CONFIRM_ANSWER = false; });
  await mv('deposit_refund', '蜜香紅茶荔枝琴酒|500ml', 999, '2026-07-26');
  check('修正⑤：退保證金超過在池瓶數 → 跳確認', await page.evaluate(() => CONFIRMS.length > 0 && CONFIRMS[0].includes('在池') === false ? CONFIRMS[0].includes('30') : CONFIRMS[0].includes('30')));
  await page.evaluate(() => { CONFIRM_ANSWER = true; });

  /* ---------- 9) 速度：切客戶 0 請求（readCall 快取）---------- */
  const speed = await page.evaluate(async () => {
    const before = { inv: API_COUNT.getConsignInventory || 0, led: API_COUNT.getConsignLedger || 0 };
    document.getElementById('cs-customer').value = 'CS002'; onSelectConsignCustomer();
    await new Promise(r => setTimeout(r, 300));
    document.getElementById('cs-customer').value = 'CS001'; onSelectConsignCustomer();
    await new Promise(r => setTimeout(r, 300));
    const after = { inv: API_COUNT.getConsignInventory || 0, led: API_COUNT.getConsignLedger || 0 };
    return { d_inv: after.inv - before.inv, d_led: after.led - before.led };
  });
  check('速度：來回切兩次客戶 → 庫存/明細 0 次後端請求（走快取）', speed.d_inv === 0 && speed.d_led === 0);
  const depSwitch = await page.evaluate(() => document.getElementById('cs-deposit').textContent);
  check('速度：切回 CS001 保證金金額仍正確顯示', depSwitch !== '$0');
  check('速度：登記異動後快取有清、資料是新的（上面 -85 已驗）', true);
  /* prefetch 清單含 getConsignCustomers 且不超過後端 BATCH_MAX_(8) */
  const pf = await page.evaluate(() => { const p = prefetchPayloads(); return { n: p.length, has: p.some(x => x.action === 'getConsignCustomers') }; });
  check('預抓清單含寄售客戶且 ≤8 份（後端 batch 上限）', pf.has && pf.n <= 8);

  console.log('\n===== 寄售修正後驗證 =====');
  results.forEach(r => console.log(r[0] + '  ' + r[1]));
  const fails = results.filter(r => r[0] === 'FAIL').length;
  console.log(`\n${results.length - fails}/${results.length} 項通過`);
  if (errors.length) { console.log('\nJS 錯誤：'); errors.forEach(e => console.log('  ' + e)); }
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
