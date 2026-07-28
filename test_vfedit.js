/* 驗收單留底「編輯／重印」離線測試
   ・出貨驗收管理 → 驗收單留底列表有「編輯／重印」按鈕（刪除鈕不受影響）
   ・點編輯 → 開啟產生驗收單視窗，表頭與品項欄位全部帶回、標題切成編輯模式、第幾次出貨推估正確
   ・編輯後按「產生」→ 先 saveVerifyForm（帶修改後內容）、成功後 deleteVerifyForm 舊 id（＝取代）
   ・按取消關閉 → VF_EDIT_ID 歸零；一般新開單流程產生 → 不會誤刪任何留底 */
const { chromium } = require('/opt/node-tools/node_modules/playwright');

const FORMS = [
  { id: 'VF1', created_at: '2026-07-25T02:00:00+08:00', no: 'T1', lot: 'L1', ship_date: '2026-07-20', pm: '小美', boxes: 3,
    items: [
      { name: '蜜香紅茶荔枝琴酒', lot: '2', vol: '100', mfg: '2026-07-15', thisShip: 60, ordered: 60, shipped: 0 },
      { name: '茉莉香片脆梅琴酒', lot: '',  vol: '500', mfg: '',           thisShip: 1,  ordered: 2,  shipped: 1 },
    ] },
  { id: 'VF0', created_at: '2026-07-20T02:00:00+08:00', no: 'T1', lot: '', ship_date: '2026-07-18', pm: '小美', boxes: 1,
    items: [ { name: '蜜香紅茶荔枝琴酒', lot: '', vol: '100', mfg: '', thisShip: 10, ordered: 60, shipped: 0 } ] },
];
const QUOTE = { quoteNo: 'T9', quoteType: 'bottle', clientName: '新客戶',
  items: [{ itemType: 'bottle', name: '辦桌', lot: '', volume: '100', qty: 100 }] };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  const isNoise = t => /Failed to load resource|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|favicon/i.test(t);
  page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('CONSOLE: ' + m.text()); });
  page.on('dialog', d => d.accept());

  await page.goto('http://localhost:8899/index.html');
  await page.evaluate(({ FORMS, QUOTE }) => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 'test-token';
    window.CALLS = [];
    window.FORMS = JSON.parse(JSON.stringify(FORMS));
    window.apiCall = async (payload) => {
      window.CALLS.push(JSON.parse(JSON.stringify(payload)));
      switch (payload.action) {
        case 'getVerifications': return { ok: true, records: [], summary: {} };
        case 'listVerifyForms': return { ok: true, records: window.FORMS, summary: {} };
        case 'saveVerifyForm': return { ok: true, id: 'VF-NEW' };
        case 'deleteVerifyForm':
          window.FORMS = window.FORMS.filter(f => f.id !== payload.id); return { ok: true, id: payload.id };
        case 'getQuoteById': return { ok: true, quote: QUOTE };
        default: return { ok: true, quotes: [], orders: [], records: [], shipments: [], logs: [] };
      }
    };
    // 擋掉真的彈出視窗：產生時只需要 document 介面
    window.open = () => ({ document: { open(){}, write(){}, close(){} } });
    ORDERS_CACHE = [{ no: 'T1', client: '甲客戶', type: '瓶裝', typeKey: 'bottle', total: 10000, quoteDate: '2026-07-01', expiry: '', st: { status: 'shipped' }, src: 'std' }];
  }, { FORMS, QUOTE });

  const results = [];
  const check = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);

  /* ---------- 載入驗收管理頁、切到驗收單留底 ---------- */
  await page.evaluate(() => gotoPage('verify'));
  await page.waitForTimeout(600);
  await page.evaluate(() => setVmTab('forms'));
  await page.waitForTimeout(300);
  // 頁面載入過程可能重建過 ORDERS_CACHE（stub 回空資料），這裡重設供 vmClientOf 歸戶
  await page.evaluate(() => { ORDERS_CACHE = [{ no: 'T1', client: '甲客戶', type: '瓶裝', typeKey: 'bottle', total: 10000, quoteDate: '2026-07-01', expiry: '', st: { status: 'shipped' }, src: 'std' }]; });

  check('留底列表有「編輯／重印」按鈕（每筆一顆）', await page.evaluate(() =>
    [...document.querySelectorAll('#vm-body .rec-act-btn')].filter(b => b.textContent.includes('編輯')).length === 2));
  check('刪除鈕仍在（.rec-act-btn.del 兩顆）', await page.evaluate(() =>
    document.querySelectorAll('#vm-body .rec-act-btn.del').length === 2));

  /* ---------- 點編輯：欄位帶回 ---------- */
  await page.evaluate(() => vmEditForm('VF1'));
  await page.waitForTimeout(200);
  const g = id => page.evaluate(i => { const e = document.getElementById(i); return e ? e.value : null; }, id);
  check('編輯視窗打開', await page.evaluate(() => document.getElementById('vf-overlay').style.display === 'flex'));
  check('標題切成編輯模式', await page.evaluate(() => document.querySelector('#vf-overlay .v2h span').textContent.includes('編輯')));
  check('VF_EDIT_ID＝VF1', await page.evaluate(() => VF_EDIT_ID === 'VF1'));
  check('客戶批號帶回 L1', (await g('vf-lot')) === 'L1');
  check('配送日帶回', (await g('vf-shipdate')) === '2026-07-20');
  check('PM 帶回 小美', (await g('vf-shipper')) === '小美');
  check('箱數帶回 3', (await g('vf-boxes')) === '3');
  check('第幾次出貨推估＝2（前面已有 VF0）', (await g('vf-shipseq')) === '2');
  check('客戶名帶回（從 ORDERS_CACHE 歸戶）', await page.evaluate(() => VERIFY_DATA.client === '甲客戶'));
  const row0 = await page.evaluate(() => {
    const v = k => { const e = document.querySelector('#vf-body .vfi[data-i="0"][data-k="' + k + '"]'); return e ? e.value : null; };
    return { mfg: v('mfg'), thisShip: v('thisShip'), shipped: v('shipped') };
  });
  check('品項列帶回 製造日期', row0.mfg === '2026-07-15');
  check('品項列帶回 本次出貨數 60', row0.thisShip === '60');
  const row1shipped = await page.evaluate(() => document.querySelector('#vf-body .vfi[data-i="1"][data-k="shipped"]').value);
  check('品項列帶回 已出貨 1', row1shipped === '1');

  /* ---------- 取消關閉會清編輯狀態 ---------- */
  await page.evaluate(() => closeVerifyForm());
  check('取消後 VF_EDIT_ID 歸零', await page.evaluate(() => VF_EDIT_ID === null));

  /* ---------- 重新進編輯 → 改 PM → 產生 ＝ 取代 ---------- */
  await page.evaluate(() => { vmEditForm('VF1'); });
  await page.waitForTimeout(200);
  await page.evaluate(() => { document.getElementById('vf-shipper').value = '小華'; window.CALLS = []; });
  await page.evaluate(() => generateVerifyPdf('full'));
  await page.waitForTimeout(600);
  const calls = await page.evaluate(() => window.CALLS);
  const saveIdx = calls.findIndex(c => c.action === 'saveVerifyForm');
  const delIdx = calls.findIndex(c => c.action === 'deleteVerifyForm');
  check('產生時有存新留底', saveIdx >= 0);
  check('新留底內容帶修改後 PM', saveIdx >= 0 && calls[saveIdx].record.pm === '小華');
  check('新留底單號正確', saveIdx >= 0 && calls[saveIdx].record.no === 'T1');
  check('新留底品項完整（2 列）', saveIdx >= 0 && Array.isArray(calls[saveIdx].record.items) && calls[saveIdx].record.items.length === 2);
  check('存好後刪舊紀錄 VF1（＝取代）', delIdx >= 0 && calls[delIdx].id === 'VF1');
  check('先存新、後刪舊（順序防丟資料）', saveIdx >= 0 && delIdx > saveIdx);
  check('產生後 VF_EDIT_ID 歸零', await page.evaluate(() => VF_EDIT_ID === null));
  check('取代後有重整驗收管理資料（listVerifyForms 再被呼叫）', calls.filter(c => c.action === 'listVerifyForms').length >= 1);

  /* ---------- 一般新開單流程：不會誤刪 ---------- */
  await page.evaluate(() => { window.CALLS = []; });
  await page.evaluate(() => openVerifyForm('T9'));
  await page.waitForTimeout(400);
  check('一般流程標題不是編輯模式', await page.evaluate(() => !document.querySelector('#vf-overlay .v2h span').textContent.includes('編輯')));
  await page.evaluate(() => generateVerifyPdf('full'));
  await page.waitForTimeout(500);
  const calls2 = await page.evaluate(() => window.CALLS);
  check('一般流程產生只存新留底', calls2.some(c => c.action === 'saveVerifyForm'));
  check('一般流程不會呼叫 deleteVerifyForm', !calls2.some(c => c.action === 'deleteVerifyForm'));

  results.forEach(r => console.log(r[0], r[1]));
  const fails = results.filter(r => r[0] === 'FAIL').length;
  console.log(errors.length ? 'JS ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(fails === 0 ? 'ALL PASS' : fails + ' FAIL');
  await browser.close();
  process.exit(fails === 0 && errors.length === 0 ? 0 : 1);
})();
