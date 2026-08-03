/* 2026-08-03 寄售「登記異動」一次登記多酒款＋自動出「出貨驗收單」離線測試
   1) 類型=鋪貨/補貨 → 顯示多列 UI（單列 UI 隱藏），預設留 2 空列
   2) 新增/刪除列（csAddMoveRow／csDelMoveRow）
   3) 只填一半（有酒款沒數量，或反過來）→ 擋下不送出
   4) 全空 → 擋下不送出
   5) 填好兩款 → saveConsignMove 呼叫 addConsignMovements（一次呼叫、movements 陣列 2 筆，type 都是 in）
   6) 存好後（勾選「同時產生出貨驗收單」）自動跳出簡化版驗收單視窗，客戶/單號/品項帶對
   7) 單號格式 CS-<客戶代碼>-<時間戳>
   8) 預覽／產生驗收單：產生時另存留底 saveVerifyForm，record.client 有值、items 對得上
   9) 切換類型離開「鋪貨/補貨」→ 改回單列 UI（原本單款登記流程不受影響）
   10) 06_verify_mgmt.js：vmClientOf 認得驗收單留底存的 client 欄（CS- 開頭那類沒有報價單可查）
   11) 06_verify_mgmt.js：vmEditForm 遇到 CS- 開頭單號 → 走簡化版編輯（openConsignVerifyForm），
       不會誤用報價單那套 buildVerifyModal/VF_EDIT_ID */
const { chromium } = require('/opt/node-tools/node_modules/playwright');

const PRODUCTS = [
  { sku_id: 'A|500ml', name: '蜜香紅茶荔枝琴酒', volume: '500ml', list_price: 850, active: 'Y' },
  { sku_id: 'B|100ml', name: '茉莉香片脆梅琴酒', volume: '100ml', list_price: 320, active: 'Y' },
];
const CUSTOMERS = [{ customer_id: 'CS001', name: '滿枝枒餐酒館', default_discount: 0.75, billing_day: 5, active: 'Y' }];

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  const isNoise = t => /Failed to load resource|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|favicon/i.test(t);
  page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('CONSOLE: ' + m.text()); });
  page.on('dialog', d => d.accept());

  await page.goto('http://localhost:8899/index.html');
  await page.evaluate(({ PRODUCTS, CUSTOMERS }) => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 'test-token';
    window.CALLS = [];
    window.confirm = () => true;
    window.OPENED = [];
    window.open = () => ({ document: { open(){}, write(h){ window.OPENED.push(h); }, close(){} } });
    window.apiCall = async (payload) => {
      window.CALLS.push(JSON.parse(JSON.stringify(payload)));
      switch (payload.action) {
        case 'getOwnbrandProducts': return { ok: true, products: PRODUCTS };
        case 'getOwnbrandTiers': return { ok: true, tiers: [], terms: { deposit_100ml: 50, deposit_500ml: 250 } };
        case 'getConsignCustomers': return { ok: true, customers: CUSTOMERS, discounts: [] };
        case 'getConsignInventory': return { ok: true, inventory: [], deposit_held_by_customer: {} };
        case 'getConsignLedger': return { ok: true, rows: [] };
        case 'addConsignMovements': return { ok: true, movements: (payload.movements || []).map((m, i) => ({ ...m, movement_id: 'CM-TEST-' + i })) };
        case 'addConsignMovement': return { ok: true, movement: { ...(payload.movement || {}), movement_id: 'CM-TEST-SINGLE' } };
        case 'saveVerifyForm': return { ok: true, id: 'VF-NEW' };
        case 'deleteVerifyForm': return { ok: true };
        case 'getVerifications': return { ok: true, records: [], summary: {} };
        case 'listVerifyForms': return { ok: true, records: [], summary: {} };
        default: return { ok: true, quotes: [], orders: [], records: [], shipments: [], rows: [] };
      }
    };
  }, { PRODUCTS, CUSTOMERS });

  const results = [];
  const check = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);

  await page.evaluate(() => gotoPage('consign'));
  await page.waitForTimeout(200);
  await page.evaluate(async () => { await initConsignPage(true); });
  await page.evaluate(() => { document.getElementById('cs-customer').value = 'CS001'; onSelectConsignCustomer(); });
  await page.waitForTimeout(300);

  /* ---------- 1) 開登記異動：預設類型=in，多列 UI 顯示、單列 UI 隱藏、預設 2 空列 ---------- */
  await page.evaluate(() => openConsignMove());
  await page.waitForTimeout(200);
  check('登記異動視窗打開', await page.evaluate(() => document.getElementById('cs-move-overlay').style.display === 'flex'));
  check('預設類型＝鋪貨/補貨(in)', await page.evaluate(() => document.getElementById('cs-m-type').value === 'in'));
  check('多列 UI 顯示', await page.evaluate(() => document.getElementById('cs-m-multi-wrap').style.display !== 'none'));
  check('單列 UI 隱藏', await page.evaluate(() => document.getElementById('cs-m-single-wrap').style.display === 'none'));
  check('預設留 2 空列', await page.evaluate(() => csMoveItems.length === 2));
  check('DOM 也渲染出 2 列', await page.evaluate(() => document.querySelectorAll('#cs-m-items-body > div').length === 2));

  /* ---------- 2) 新增/刪除列 ---------- */
  await page.evaluate(() => csAddMoveRow());
  check('新增一列 → 3 列', await page.evaluate(() => csMoveItems.length === 3));
  await page.evaluate(() => csDelMoveRow(csMoveItems[2].id));
  check('刪除該列 → 回到 2 列', await page.evaluate(() => csMoveItems.length === 2));

  /* ---------- 3) 全空送出 → 擋下 ---------- */
  await page.evaluate(() => document.getElementById('cs-m-date').value = '2026-08-03');
  await page.evaluate(() => saveConsignMove());
  await page.waitForTimeout(150);
  check('全空送出 → 擋下（沒有呼叫 addConsignMovements）', !(await page.evaluate(() => window.CALLS.some(c => c.action === 'addConsignMovements'))));
  check('全空送出 → 有錯誤提示', (await page.evaluate(() => document.getElementById('toast-msg').textContent)).includes('至少填一款'));

  /* ---------- 4) 只填一半（第一列只填酒款沒數量）→ 擋下 ---------- */
  await page.evaluate(() => { window.CALLS.length = 0; });
  await page.evaluate(() => { csMoveItems[0].sku = 'A|500ml'; csMoveItems[0].qty = ''; renderCsMoveItems(); });
  await page.evaluate(() => saveConsignMove());
  await page.waitForTimeout(150);
  check('只填一半 → 擋下', !(await page.evaluate(() => window.CALLS.some(c => c.action === 'addConsignMovements'))));
  check('只填一半 → 錯誤訊息提示「補齊」', (await page.evaluate(() => document.getElementById('toast-msg').textContent)).includes('補齊'));

  /* ---------- 5) 填好兩款完整資料 → 一次呼叫 addConsignMovements ---------- */
  await page.evaluate(() => { window.CALLS.length = 0; });
  await page.evaluate(() => {
    csMoveItems[0].sku = 'A|500ml'; csMoveItems[0].qty = '10';
    csMoveItems[1].sku = 'B|100ml'; csMoveItems[1].qty = '5';
    renderCsMoveItems();
    document.getElementById('cs-m-note').value = '測試鋪貨';
    document.getElementById('cs-m-handler').value = '小美';
  });
  await page.evaluate(() => saveConsignMove());
  await page.waitForTimeout(300);
  const mvCall = await page.evaluate(() => window.CALLS.find(c => c.action === 'addConsignMovements'));
  check('存檔呼叫 addConsignMovements（只呼叫一次）', await page.evaluate(() => window.CALLS.filter(c => c.action === 'addConsignMovements').length === 1));
  check('movements 陣列有 2 筆', !!mvCall && Array.isArray(mvCall.movements) && mvCall.movements.length === 2);
  check('兩筆都是 type=in、customer_id=CS001、日期正確', !!mvCall && mvCall.movements.every(m => m.type === 'in' && m.customer_id === 'CS001' && m.date === '2026-08-03'));
  check('sku/qty 對應正確', !!mvCall && mvCall.movements[0].sku_id === 'A|500ml' && mvCall.movements[0].qty === 10 &&
    mvCall.movements[1].sku_id === 'B|100ml' && mvCall.movements[1].qty === 5);
  check('備註帶入兩筆', !!mvCall && mvCall.movements.every(m => m.note === '測試鋪貨'));
  check('沒有呼叫舊的單筆 addConsignMovement', !(await page.evaluate(() => window.CALLS.some(c => c.action === 'addConsignMovement'))));
  check('登記異動視窗存檔後關閉', await page.evaluate(() => document.getElementById('cs-move-overlay').style.display === 'none'));

  /* ---------- 6) 勾了「同時產生驗收單」→ 自動跳出簡化版驗收單視窗，資料帶對 ---------- */
  await page.waitForTimeout(200);
  check('驗收單視窗自動打開', await page.evaluate(() => document.getElementById('cs-vf-overlay').style.display === 'flex'));
  check('客戶帶入「滿枝枒餐酒館」', await page.evaluate(() => CONSIGN_VF_DATA.client === '滿枝枒餐酒館'));
  check('經手人帶入「小美」', await page.evaluate(() => CONSIGN_VF_DATA.handler === '小美'));
  check('品項兩款，名稱正確', await page.evaluate(() =>
    CONSIGN_VF_DATA.rows.length === 2 &&
    CONSIGN_VF_DATA.rows[0].name === '蜜香紅茶荔枝琴酒' && CONSIGN_VF_DATA.rows[0].qty === 10 &&
    CONSIGN_VF_DATA.rows[1].name === '茉莉香片脆梅琴酒' && CONSIGN_VF_DATA.rows[1].qty === 5));

  /* ---------- 7) 單號格式 CS-<客戶代碼>-<時間戳> ---------- */
  check('單號格式 CS-CS001-<14碼時間戳>', await page.evaluate(() => /^CS-CS001-\d{14}$/.test(CONSIGN_VF_DATA.no)));

  /* ---------- 8) 預覽／產生：產生時存留底，client/items 對得上 ---------- */
  await page.evaluate(() => previewConsignVerifyPdf());
  await page.waitForTimeout(100);
  check('預覽有開視窗，內容含標題與兩款品名', await page.evaluate(() =>
    window.OPENED.length >= 1 && window.OPENED[window.OPENED.length - 1].includes('寄售鋪貨驗收單') &&
    window.OPENED[window.OPENED.length - 1].includes('蜜香紅茶荔枝琴酒') && window.OPENED[window.OPENED.length - 1].includes('茉莉香片脆梅琴酒')));
  check('預覽不會呼叫 saveVerifyForm', !(await page.evaluate(() => window.CALLS.some(c => c.action === 'saveVerifyForm'))));

  await page.evaluate(() => { window.CALLS.length = 0; });
  await page.evaluate(() => generateConsignVerifyPdf());
  await page.waitForTimeout(200);
  const saveCall = await page.evaluate(() => window.CALLS.find(c => c.action === 'saveVerifyForm'));
  check('產生驗收單 → 呼叫 saveVerifyForm 留底', !!saveCall);
  check('留底 record.client 有值', !!saveCall && saveCall.record.client === '滿枝枒餐酒館');
  check('留底 record.no 是 CS- 開頭', !!saveCall && /^CS-CS001-/.test(saveCall.record.no));
  check('留底 items 兩筆、對應數量', !!saveCall && saveCall.record.items.length === 2 &&
    saveCall.record.items[0].thisShip === 10 && saveCall.record.items[1].thisShip === 5);
  check('產生後驗收單視窗關閉', await page.evaluate(() => document.getElementById('cs-vf-overlay').style.display === 'none'));

  /* ---------- 9) 切換類型離開 in → 改回單列 UI ---------- */
  await page.evaluate(() => { openConsignMove(); document.getElementById('cs-m-type').value = 'out'; onConsignMoveType(); });
  await page.waitForTimeout(150);
  check('切到「銷售」→ 多列 UI 隱藏', await page.evaluate(() => document.getElementById('cs-m-multi-wrap').style.display === 'none'));
  check('切到「銷售」→ 單列 UI 顯示', await page.evaluate(() => document.getElementById('cs-m-single-wrap').style.display !== 'none'));
  await page.evaluate(() => closeConsignMove());

  /* ---------- 10) vmClientOf 認得 CS- 留底存的 client 欄 ---------- */
  await page.evaluate(() => {
    // VM_DATA 是 let 宣告的全域變數，直接指名賦值（window.VM_DATA=... 對它沒有作用，兩個是不同儲存位置）
    VM_DATA = { reports: [], repSum: {}, forms: [
      { id: 'VFX1', no: 'CS-CS001-20260803120000', client: '滿枝枒餐酒館', items: [{ name: '蜜香紅茶荔枝琴酒', vol: '500ml', thisShip: 10, ordered: 10 }] }
    ], formSum: {} };
  });
  check('vmClientOf 認得留底 client 欄', await page.evaluate(() => vmClientOf('CS-CS001-20260803120000') === '滿枝枒餐酒館'));

  /* ---------- 11) vmEditForm 遇到 CS- 開頭 → 走簡化版編輯，不動報價單那套狀態 ---------- */
  await page.evaluate(() => { VF_EDIT_ID = null; VERIFY_DATA = null; });
  await page.evaluate(() => vmEditForm('VFX1'));
  await page.waitForTimeout(200);
  check('CS- 開頭 → 開的是簡化版驗收單視窗', await page.evaluate(() => document.getElementById('cs-vf-overlay').style.display === 'flex'));
  check('CONSIGN_VF_EDIT_ID＝VFX1（編輯模式）', await page.evaluate(() => CONSIGN_VF_EDIT_ID === 'VFX1'));
  check('沒有誤用報價單那套 VF_EDIT_ID', await page.evaluate(() => VF_EDIT_ID === null));
  check('沒有誤用報價單那套 VERIFY_DATA', await page.evaluate(() => VERIFY_DATA === null));
  check('簡化版編輯視窗品項帶回（蜜香紅茶荔枝琴酒 × 10）', await page.evaluate(() =>
    CONSIGN_VF_DATA.rows.length === 1 && CONSIGN_VF_DATA.rows[0].name === '蜜香紅茶荔枝琴酒' && CONSIGN_VF_DATA.rows[0].qty === 10));

  await browser.close();

  const fails = results.filter(r => r[0] === 'FAIL');
  results.forEach(r => console.log(r[0] + '  ' + r[1]));
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  if (errors.length) { console.log('\n頁面錯誤：'); errors.forEach(e => console.log(' - ' + e)); }
  process.exit(fails.length || errors.length ? 1 : 0);
})();
