/* 2026-09-04 寄售兩件事的離線測試
   A) 進出貨明細每一批「鋪貨/補貨」補一顆驗收單入口（事後補開／重印）
      1) 表頭多了「操作」欄（7 欄）
      2) 同一批（同 created_at）7 款只給一顆鈕；不同批各一顆；非 in 類型沒有鈕
      3) 單號＝CS-<客戶>-<建檔時間 14 碼>，同一批每次算出來都一樣
      4) 點下去會開簡化版驗收單，客戶／日期／品項數帶對
      5) 那批「已經有留底」→ 帶回留底內容並走取代模式（CONSIGN_VF_EDIT_ID 有值）
      6) 那批「沒有留底」→ CONSIGN_VF_EDIT_ID 是 null（會新開一筆）
      7) csLedMarkVerified：有留底顯示「查看驗收單」、沒有顯示「補開驗收單」＋金色標示
   B) 試飲瓶容量改成可選（原本寫死 500ml）
      8) csTasterVols 撈得到該酒款主檔的容量、由小到大
      9) csTasterVolDefault：有 500ml 就預設 500ml；只有 100ml 的酒自動預設 100ml
     10) 換公版酒 → 該列 tasterVol 自動跟著換
     11) 畫面上有容量下拉、文字不再寫死「附 500ml 試飲瓶」
     12) 存檔後驗收單的試飲瓶列容量＝當時選的那個（不是寫死 500ml）
*/
const { chromium } = require('/opt/node-tools/node_modules/playwright');

const PRODUCTS = [
  { sku_id: '蜜香紅茶荔枝琴酒|500ml', name: '蜜香紅茶荔枝琴酒', volume: '500ml', list_price: 850, active: 'Y' },
  { sku_id: '蜜香紅茶荔枝琴酒|100ml', name: '蜜香紅茶荔枝琴酒', volume: '100ml', list_price: 320, active: 'Y' },
  { sku_id: '茉莉香片脆梅琴酒|100ml', name: '茉莉香片脆梅琴酒', volume: '100ml', list_price: 320, active: 'Y' },
];
const CUSTOMERS = [{ customer_id: '4', name: '島羽Wing Islands', default_discount: 0.7, billing_day: '', active: 'Y' }];
const TS = '2026-09-03T15:44:39+08:00';
const LEDGER = [
  { movement_id:'CM-1', date:'2026-09-03', customer_id:4, sku_id:'蜜香紅茶荔枝琴酒|100ml', type:'in', qty:10, note:'100ml試飲瓶', created_at:TS },
  { movement_id:'CM-2', date:'2026-09-03', customer_id:4, sku_id:'茉莉香片脆梅琴酒|100ml', type:'in', qty:10, note:'100ml試飲瓶', created_at:TS },
  { movement_id:'CM-3', date:'2026-08-20', customer_id:4, sku_id:'蜜香紅茶荔枝琴酒|500ml', type:'in', qty:6,  note:'', created_at:'2026-08-20T10:00:00+08:00' },
  { movement_id:'CM-4', date:'2026-08-25', customer_id:4, sku_id:'蜜香紅茶荔枝琴酒|500ml', type:'out', qty:2, note:'', created_at:'2026-08-25T10:00:00+08:00' },
];
const NO_0903 = 'CS-4-20260903154439';

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  const isNoise = t => /Failed to load resource|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|favicon/i.test(t);
  page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('CONSOLE: ' + m.text()); });
  page.on('dialog', d => d.accept());

  await page.goto('http://localhost:8899/index.html');
  // ⚠ 開機競態：99_boot 打 getLoginUsers 失敗會 rcClear()，等登入下拉不再是「載入中」再動手
  await page.waitForFunction(() => {
    const s = document.getElementById('login-user');
    return !s || !/載入中/.test(s.innerHTML);
  }, { timeout: 15000 }).catch(() => {});
  await page.evaluate(({ PRODUCTS, CUSTOMERS, LEDGER }) => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 'test-token';
    window.CALLS = []; window.OPENED = [];
    window.confirm = () => true; window.alert = () => {};
    window.open = () => ({ document: { open(){}, write(h){ window.OPENED.push(h); }, close(){} } });
    window.VF_RECORDS = [];          // 測試中可換掉，模擬「有／沒有留底」
    window.apiCall = async (payload) => {
      window.CALLS.push(JSON.parse(JSON.stringify(payload)));
      switch (payload.action) {
        case 'getOwnbrandProducts': return { ok: true, products: PRODUCTS };
        case 'getOwnbrandTiers':    return { ok: true, tiers: [], terms: {} };
        case 'getConsignCustomers': return { ok: true, customers: CUSTOMERS, discounts: [] };
        case 'getConsignInventory': return { ok: true, inventory: [], deposit_held_by_customer: {} };
        case 'getConsignLedger':    return { ok: true, rows: LEDGER };
        case 'listVerifyForms':     return { ok: true, records: window.VF_RECORDS, summary: {} };
        case 'getVerifyKey':        return { ok: true, k: 'TESTKEY' };
        case 'addConsignMovements': return { ok: true, movements: (payload.movements||[]).map((m,i)=>({...m, movement_id:'CM-N'+i})) };
        case 'saveVerifyForm':      return { ok: true, id: 'VF-NEW' };
        case 'deleteVerifyForm':    return { ok: true };
        default: return { ok: true, quotes: [], orders: [], records: [], shipments: [], rows: [] };
      }
    };
  }, { PRODUCTS, CUSTOMERS, LEDGER });

  const results = [];
  const check = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);
  const guard = fn => `(function(){ if(typeof ${fn}!=='function') return '__MISSING__'; })()`;

  await page.evaluate(() => gotoPage('consign'));
  await page.waitForTimeout(200);
  await page.evaluate(async () => { await initConsignPage(true); });
  await page.evaluate(() => { document.getElementById('cs-customer').value = '4'; onSelectConsignCustomer(); });
  await page.waitForTimeout(600);

  /* ---------- A) 明細的驗收單入口 ---------- */
  check('1 明細表頭有「操作」欄（共 7 欄）', await page.evaluate(() => {
    const ths = document.querySelectorAll('#cs-ledger-body') && document.querySelector('#cs-ledger-body').closest('table').querySelectorAll('thead th');
    return ths.length === 7 && /操作/.test(ths[6].textContent);
  }));

  const btnInfo = await page.evaluate(() => {
    const bs = [...document.querySelectorAll('#cs-ledger-body .cs-vfbtn')];
    return { n: bs.length, nos: bs.map(b => b.dataset.no), rows: document.querySelectorAll('#cs-ledger-body tr').length };
  });
  check('2a 4 列明細（3 in + 1 out）都畫出來', btnInfo.rows === 4);
  check('2b 同一批 2 款只給一顆鈕、另一批一顆 → 共 2 顆（out 沒有）', btnInfo.n === 2);
  check('3a 單號＝CS-<客戶>-<建檔時間14碼>', btnInfo.nos.includes('CS-4-20260903154439'));
  check('3b 另一批是另一個單號', btnInfo.nos.includes('CS-4-20260820100000'));
  check('3c csLedBatchNo 同一批算兩次結果一樣', await page.evaluate(() => {
    if (typeof csLedBatchNo !== 'function') return false;
    const r = { created_at: '2026-09-03T15:44:39+08:00', date: '2026-09-03' };
    return csLedBatchNo(4, r) === csLedBatchNo(4, r) && csLedBatchNo(4, r) === 'CS-4-20260903154439';
  }));

  // 4+6) 沒有留底 → 新開
  await page.evaluate(async () => {
    window.VF_RECORDS = []; rcClear();
    const i = [...document.querySelectorAll('#cs-ledger-body .cs-vfbtn')].find(b => b.dataset.no === 'CS-4-20260903154439').dataset.b;
    await csReopenVerify(i);
  });
  await page.waitForTimeout(200);
  const fresh = await page.evaluate(() => ({
    open: document.getElementById('cs-vf-overlay') && document.getElementById('cs-vf-overlay').style.display === 'flex',
    no: CONSIGN_VF_DATA && CONSIGN_VF_DATA.no,
    client: document.getElementById('cs-vf-client').value,
    date: document.getElementById('cs-vf-date').value,
    n: CONSIGN_VF_DATA && CONSIGN_VF_DATA.rows.length,
    names: (CONSIGN_VF_DATA.rows || []).map(r => r.name + '/' + r.vol + '/' + r.qty),
    editId: CONSIGN_VF_EDIT_ID,
  }));
  check('4a 點鈕會開簡化版驗收單', fresh.open === true);
  check('4b 單號帶對', fresh.no === NO_0903);
  check('4c 客戶帶主檔名稱', fresh.client === '島羽Wing Islands');
  check('4d 日期＝那批異動的日期', fresh.date === '2026-09-03');
  check('4e 那批的 2 款都帶進來（含容量與數量）',
    fresh.n === 2 && fresh.names[0] === '蜜香紅茶荔枝琴酒/100ml/10' && fresh.names[1] === '茉莉香片脆梅琴酒/100ml/10');
  check('6 沒有留底 → 不是取代模式', fresh.editId === null);
  await page.evaluate(() => closeConsignVerifyForm());

  // 5) 已有留底 → 帶回留底內容＋取代模式
  await page.evaluate(async (no) => {
    window.VF_RECORDS = [{ id: 'VF-OLD', no, client: '島羽Wing Islands', ship_date: '2026-09-03', pm: '阿軒',
      items_json: JSON.stringify([{ name: '蜜香紅茶荔枝琴酒', vol: '100ml', thisShip: 8, ordered: 8, taster: 1 }]) }];
    rcClear();
    const i = [...document.querySelectorAll('#cs-ledger-body .cs-vfbtn')].find(b => b.dataset.no === no).dataset.b;
    await csReopenVerify(i);
  }, NO_0903);
  await page.waitForTimeout(200);
  const edit = await page.evaluate(() => ({
    editId: CONSIGN_VF_EDIT_ID, n: CONSIGN_VF_DATA.rows.length,
    qty: CONSIGN_VF_DATA.rows[0].qty, taster: !!CONSIGN_VF_DATA.rows[0].taster,
    handler: document.getElementById('cs-vf-handler').value,
    title: document.querySelector('#cs-vf-overlay .v2h span').textContent,
  }));
  check('5a 已有留底 → 走取代模式（editId 有值）', edit.editId === 'VF-OLD');
  check('5b 內容以留底為準（1 列、數量 8、試飲標示留著）', edit.n === 1 && String(edit.qty) === '8' && edit.taster === true);
  check('5c 經手人一起帶回', edit.handler === '阿軒');
  check('5d 標題顯示「編輯…取代舊留底」', /取代舊留底/.test(edit.title));
  await page.evaluate(() => closeConsignVerifyForm());

  // 7) 鈕的文字：有留底＝查看、沒留底＝補開（金色）
  await page.evaluate(async () => { rcClear(); await loadConsignLedger(); });
  await page.waitForTimeout(400);
  const labels = await page.evaluate(() => {
    const o = {}; document.querySelectorAll('#cs-ledger-body .cs-vfbtn').forEach(b => o[b.dataset.no] = b.textContent + '|' + (b.classList.contains('primary') ? 'gold' : '-'));
    return o;
  });
  check('7a 已有留底那批＝「查看驗收單」', labels[NO_0903] === '查看驗收單|-');
  check('7b 沒留底那批＝「補開驗收單」並金色標示', labels['CS-4-20260820100000'] === '補開驗收單|gold');

  /* ---------- B) 試飲瓶容量可選 ---------- */
  /* ⚠ 上面的 rcClear() 會觸發 onCacheClear 把 OWNBRAND_PRODUCTS 清成 null（寄售頁的既有行為），
     容量清單就會退回「100ml/500ml」兩個常用值。先把公版酒主檔載回來再測。 */
  await page.evaluate(async () => { await loadOwnbrandData(); });
  check('8a csTasterVols 撈到該酒款主檔的兩個容量、小的在前', await page.evaluate(() => {
    if (typeof csTasterVols !== 'function') return false;
    return JSON.stringify(csTasterVols('蜜香紅茶荔枝琴酒|500ml')) === JSON.stringify(['100ml', '500ml']);
  }));
  check('8b 只出 100ml 的酒只給 100ml', await page.evaluate(() =>
    typeof csTasterVols === 'function' && JSON.stringify(csTasterVols('茉莉香片脆梅琴酒|100ml')) === JSON.stringify(['100ml'])));
  check('9a 有 500ml 就預設 500ml', await page.evaluate(() =>
    typeof csTasterVolDefault === 'function' && csTasterVolDefault('蜜香紅茶荔枝琴酒|500ml') === '500ml'));
  check('9b 只有 100ml 的酒自動預設 100ml', await page.evaluate(() =>
    typeof csTasterVolDefault === 'function' && csTasterVolDefault('茉莉香片脆梅琴酒|100ml') === '100ml'));
  check('9c 還沒選酒款時預設 500ml', await page.evaluate(() =>
    typeof csTasterVolDefault === 'function' && csTasterVolDefault('') === '500ml'));

  await page.evaluate(() => openConsignMove());
  await page.waitForTimeout(200);
  check('11a 畫面文字不再寫死「附 500ml 試飲瓶」', await page.evaluate(() =>
    !/附\s*500ml\s*試飲瓶/.test(document.getElementById('cs-m-items-body').innerHTML)));
  check('11b 每一列都有試飲瓶容量下拉', await page.evaluate(() => {
    const rows = document.querySelectorAll('#cs-m-items-body > div');
    const sels = document.querySelectorAll('#cs-m-items-body select');
    return rows.length > 0 && sels.length === rows.length * 2;   // 公版酒下拉＋容量下拉
  }));
  check('10 換成只出 100ml 的酒 → 該列容量自動變 100ml', await page.evaluate(() => {
    const id = csMoveItems[0].id;
    csMoveRowInput(id, 'sku', '茉莉香片脆梅琴酒|100ml');
    return csMoveItems[0].tasterVol === '100ml';
  }));

  // 12) 存檔後驗收單的試飲瓶列容量＝當時選的
  await page.evaluate(async () => {
    document.getElementById('cs-m-type').value = 'in';
    document.getElementById('cs-m-date').value = '2026-09-04';
    csMoveItems = [{ id: 1, sku: '蜜香紅茶荔枝琴酒|500ml', qty: 6, taster: true, tasterQty: 2, tasterVol: '100ml' }];
    renderCsMoveItems();
    await saveConsignMove();
  });
  await page.waitForTimeout(400);
  const vfRows = await page.evaluate(() => (CONSIGN_VF_DATA && CONSIGN_VF_DATA.rows || []).map(r => r.name + '/' + r.vol + '/' + r.qty + '/' + (r.taster ? 'T' : '-')));
  check('12a 驗收單有鋪貨列＋試飲瓶列', vfRows.length === 2);
  check('12b 試飲瓶列容量＝選的 100ml（不是寫死 500ml）', vfRows[1] === '蜜香紅茶荔枝琴酒/100ml/2/T');
  check('12c 鋪貨列本身不受影響', vfRows[0] === '蜜香紅茶荔枝琴酒/500ml/6/-');

  await browser.close();
  const fail = results.filter(r => r[0] === 'FAIL');
  results.forEach(r => console.log(r[0] + '  ' + r[1]));
  if (errors.length) { console.log('\n--- JS 錯誤 ---'); errors.forEach(e => console.log(e)); }
  console.log('\n合計 ' + results.length + ' 項，FAIL ' + fail.length + ' 項' + (errors.length ? '，另有 ' + errors.length + ' 個 JS 錯誤' : ''));
  process.exit(fail.length || errors.length ? 1 : 0);
})();
