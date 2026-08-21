/* 2026-08-21：寄售保證金規則從畫面全面移除的離線測試
   1) 庫存表沒有「保證金在池瓶數」欄、沒有保證金餘額數字方塊
   2) 明細過濾掉舊的 deposit_refund 列
   3) 登記異動類型下拉沒有「退保證金」
   4) 客戶編輯表單沒有保證金下拉；存檔時舊客戶的 deposit_required 原值保留、新客戶不帶這欄
   5) 鋪貨多列沒有保證金金額提示
   6) 整個寄售頁找不到「保證金」三個字，且沒有 JS 例外 */
const { chromium } = require('/opt/node-tools/node_modules/playwright');

const PRODUCTS = [
  { sku_id: 'A|500ml', name: '蜜香紅茶荔枝琴酒', volume: '500ml', list_price: 850, active: 'Y' },
  { sku_id: 'B|100ml', name: '茉莉香片脆梅琴酒', volume: '100ml', list_price: 320, active: 'Y' },
];
const CUSTOMERS = [
  { customer_id: 'CS001', name: '滿枝枒餐酒館', default_discount: 0.75, billing_day: 5, active: 'Y', deposit_required: 'Y' },
  { customer_id: 'CS002', name: '不押那家', default_discount: 0.8, billing_day: 10, active: 'Y', deposit_required: 'N' },
];
const INVENTORY = [
  { customer_id: 'CS001', sku_id: 'A|500ml', name: '蜜香紅茶荔枝琴酒', volume: '500ml', balance: 30, deposit_pool_qty: 30 },
];
const LEDGER = [
  { movement_id: 'M1', date: '2026-08-01', customer_id: 'CS001', sku_id: 'A|500ml', type: 'in', qty: 30, note: '鋪貨' },
  { movement_id: 'M2', date: '2026-08-05', customer_id: 'CS001', sku_id: 'A|500ml', type: 'out', qty: 4, unit_price: 637, note: '銷售' },
  { movement_id: 'M3', date: '2026-08-09', customer_id: 'CS001', sku_id: 'A|500ml', type: 'deposit_refund', qty: 10, note: '舊的退保證金' },
];

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  const isNoise = t => /Failed to load resource|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|favicon/i.test(t);
  page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('CONSOLE: ' + m.text()); });
  page.on('dialog', d => d.accept());

  await page.goto('http://localhost:8899/index.html');
  await page.waitForTimeout(1200);   // 讓 99_boot 那支必失敗的 getLoginUsers 先跑完（見記憶 fix-20260819）
  await page.evaluate(({ PRODUCTS, CUSTOMERS, INVENTORY, LEDGER }) => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 'test-token';
    window.CALLS = [];
    window.confirm = () => true;
    window.apiCall = async (payload) => {
      window.CALLS.push(JSON.parse(JSON.stringify(payload)));
      switch (payload.action) {
        case 'getOwnbrandProducts': return { ok: true, products: PRODUCTS };
        case 'getOwnbrandTiers': return { ok: true, tiers: [], terms: { deposit_100ml: 50, deposit_500ml: 250 } };
        case 'getConsignCustomers': return { ok: true, customers: CUSTOMERS, discounts: [] };
        case 'getConsignInventory': return { ok: true, inventory: INVENTORY, deposit_held_by_customer: { CS001: 7500 } };
        case 'getConsignLedger': return { ok: true, rows: LEDGER };
        case 'saveConsignCustomer': return { ok: true, customer: payload.customer };
        default: return { ok: true, quotes: [], orders: [], records: [], shipments: [], rows: [] };
      }
    };
  }, { PRODUCTS, CUSTOMERS, INVENTORY, LEDGER });

  const results = [];
  const check = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);

  await page.evaluate(() => gotoPage('consign'));
  await page.waitForTimeout(200);
  await page.evaluate(async () => { await initConsignPage(true); });
  await page.evaluate(() => { document.getElementById('cs-customer').value = 'CS001'; onSelectConsignCustomer(); });
  await page.waitForTimeout(600);

  /* ---------- 1) 庫存區 ---------- */
  check('保證金餘額數字方塊已移除', await page.evaluate(() => !document.getElementById('cs-deposit')));
  check('在客戶端總庫存仍在（30 瓶）', await page.evaluate(() => (document.getElementById('cs-totstock').textContent || '').includes('30')));
  check('庫存表頭只剩 3 欄', await page.evaluate(() => document.querySelectorAll('#cs-inv-body')[0].closest('table').querySelectorAll('thead th').length === 3));
  check('庫存表頭沒有「保證金在池瓶數」', await page.evaluate(() =>
    ![...document.querySelectorAll('#cs-inv-body')[0].closest('table').querySelectorAll('thead th')].some(th => th.textContent.includes('保證金'))));
  check('庫存資料列渲染出 3 格', await page.evaluate(() => document.querySelectorAll('#cs-inv-body tr')[0].querySelectorAll('td').length === 3));

  /* ---------- 2) 明細過濾 ---------- */
  const ledgerTxt = await page.evaluate(() => document.getElementById('cs-ledger-body').textContent);
  check('明細顯示鋪貨列', ledgerTxt.includes('鋪貨'));
  check('明細顯示銷售列', ledgerTxt.includes('銷售'));
  check('明細不再出現「退保證金」列', !ledgerTxt.includes('退保證金') && !ledgerTxt.includes('舊的退保證金'));
  check('明細只剩 2 列', await page.evaluate(() => document.querySelectorAll('#cs-ledger-body tr').length === 2));

  /* ---------- 3) 登記異動 ---------- */
  await page.evaluate(() => openConsignMove());
  await page.waitForTimeout(200);
  check('類型下拉只剩 4 種', await page.evaluate(() => document.getElementById('cs-m-type').options.length === 4));
  check('類型下拉沒有 deposit_refund', await page.evaluate(() =>
    ![...document.getElementById('cs-m-type').options].some(o => o.value === 'deposit_refund' || o.textContent.includes('保證金'))));
  check('保證金提示區塊 cs-m-dephint 已移除', await page.evaluate(() => !document.getElementById('cs-m-dephint')));
  check('鋪貨多列沒有每列保證金提示', await page.evaluate(() => !document.querySelector('[id^="cs-m-rowdep-"]')));
  await page.evaluate(() => { csMoveItems[0].sku = 'A|500ml'; csMoveItems[0].qty = '10'; renderCsMoveItems(); });
  await page.waitForTimeout(100);
  check('填了數量後仍不出現保證金金額', !(await page.evaluate(() => document.getElementById('cs-m-items-body').textContent.includes('保證金'))));
  check('試飲瓶說明已拿掉「不收保證金」', await page.evaluate(() => {
    const t = document.getElementById('cs-m-items-body').textContent;
    return t.includes('試飲瓶') && t.includes('不計價') && !t.includes('保證金');
  }));
  // 切到「銷售」/「退貨」都不能噴錯（原本會呼叫已刪掉的 csMoveDepositHint）
  await page.evaluate(() => { document.getElementById('cs-m-type').value = 'out'; onConsignMoveType(); });
  await page.evaluate(() => { document.getElementById('cs-m-type').value = 'return'; onConsignMoveType(); });
  await page.waitForTimeout(100);
  check('切換類型不噴錯、單列 UI 正常顯示', await page.evaluate(() => document.getElementById('cs-m-single-wrap').style.display !== 'none'));
  check('數量提示文字正常（瓶數）', await page.evaluate(() => document.getElementById('cs-m-qtyhint').textContent === '瓶數'));
  await page.evaluate(() => closeConsignMove());

  /* ---------- 4) 客戶編輯表單 ---------- */
  check('客戶表單保證金下拉已移除', await page.evaluate(() => !document.getElementById('cs-f-dep')));
  await page.evaluate(() => openConsignCustomerEdit('CS002'));
  await page.waitForTimeout(200);
  check('編輯舊客戶不噴錯、名稱帶對', await page.evaluate(() => document.getElementById('cs-f-name').value === '不押那家'));
  await page.evaluate(() => { window.CALLS.length = 0; });
  await page.evaluate(async () => { await saveConsignCustomerForm(); });
  await page.waitForTimeout(300);
  const saved = await page.evaluate(() => window.CALLS.find(c => c.action === 'saveConsignCustomer'));
  check('存舊客戶 → deposit_required 原值 N 沒被洗掉', !!saved && saved.customer.deposit_required === 'N');

  await page.evaluate(() => { window.CALLS.length = 0; });
  await page.evaluate(() => openConsignCustomerEdit(''));
  await page.waitForTimeout(150);
  await page.evaluate(async () => {
    document.getElementById('cs-f-id').value = 'CS999';
    document.getElementById('cs-f-name').value = '新客戶';
    await saveConsignCustomerForm();
  });
  await page.waitForTimeout(300);
  const saved2 = await page.evaluate(() => window.CALLS.find(c => c.action === 'saveConsignCustomer'));
  check('新客戶不帶 deposit_required 欄', !!saved2 && !('deposit_required' in saved2.customer));

  /* ---------- 5) 全頁字串掃描 ---------- */
  await page.evaluate(() => { const o = document.getElementById('cs-cus-overlay'); if (o) o.style.display = 'none'; });
  check('寄售頁面上找不到「保證金」三個字', await page.evaluate(() => {
    const p = document.getElementById('page-consign') || document.querySelector('#consign') || document.body;
    return !p.innerText.includes('保證金');
  }));
  check('沒有 JS 例外', errors.length === 0);

  results.forEach(([s, n]) => console.log(s + '  ' + n));
  const pass = results.filter(r => r[0] === 'PASS').length;
  console.log('\n' + pass + '/' + results.length + ' passed');
  if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
  await browser.close();
  process.exit(pass === results.length ? 0 : 1);
})();
