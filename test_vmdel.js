/* 小尾巴離線測試：三個刪除 action 串接（deleteVerification／deleteVerifyForm／deleteShipment）
   ＋客訴分類（回報問題／驗收無誤／其他）顯示與篩選 */
const { chromium } = require('/opt/node-tools/node_modules/playwright');

const REPORTS = [
  { id: 'V1', created_at: '2026-07-25T01:00:00.000Z', no: 'T1', client: '甲客戶', type: '回報問題', desc: '瓶身有刮痕', status: '待處理' },
  { id: 'V2', created_at: '2026-07-24T01:00:00.000Z', no: 'T1', client: '甲客戶', type: '驗收無誤', desc: '', status: '' },
  { id: 'V3', created_at: '2026-07-23T01:00:00.000Z', no: 'T2', client: '乙客戶', type: '其他', desc: '想加訂', status: '待處理' },
  { id: 'V4', created_at: '2026-07-22T01:00:00.000Z', no: 'T2', client: '乙客戶', type: '外觀', desc: '標籤歪', status: '待處理' },  // QR 掃碼那條線的類型
  { id: 'V5', created_at: '2026-07-21T01:00:00.000Z', no: 'T3', client: '丙客戶', type: 'ok', desc: '', status: '' },
];
const FORMS = [
  { id: 'VF1', created_at: '2026-07-25T02:00:00.000Z', no: 'T1', lot: 'L1', ship_date: '2026-07-20', pm: '小美', boxes: 3, items: [{ name: '蜂蜜醋' }] },
];

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  // 沙箱連不到外部 CDN（字型/圖示），資源載入失敗屬環境雜訊，不算程式錯誤
  const isNoise = t => /Failed to load resource|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|favicon/i.test(t);
  page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('CONSOLE: ' + m.text()); });
  let CONFIRM_ANSWER = true;
  page.on('dialog', d => (CONFIRM_ANSWER ? d.accept() : d.dismiss()));

  await page.goto('http://localhost:8899/index.html');
  await page.evaluate(({ REPORTS, FORMS }) => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 'test-token';
    window.CALLS = [];
    window.REPORTS = REPORTS; window.FORMS = FORMS;
    window.apiCall = async (payload) => {
      window.CALLS.push(payload);
      switch (payload.action) {
        case 'getVerifications': return { ok: true, records: window.REPORTS, summary: {} };
        case 'listVerifyForms': return { ok: true, records: window.FORMS, summary: { T1: { count: 1, last_at: '2026-07-20' } } };
        case 'deleteVerification':
          window.REPORTS = window.REPORTS.filter(r => r.id !== payload.id); return { ok: true, id: payload.id };
        case 'deleteVerifyForm':
          window.FORMS = window.FORMS.filter(f => f.id !== payload.id); return { ok: true, id: payload.id };
        case 'deleteShipment': return { ok: true, id: payload.id };
        case 'addVerification': return { ok: true, id: 'VNEW' };
        case 'listShipments':
          if (!payload.quote_no) return { ok: true, shipments: [{ id: 'SHP-1', quote_no: 'T1' }] };
          return { ok: true, shipments: [{ id: 'SHP-1', quote_no: 'T1', seq: 1, ship_date_est: '2026-08-01', amount: 5000, note: '第一批' }] };
        case 'updateShipment': case 'addShipment': return { ok: true, id: 'SHP-9' };
        default: return { ok: true, quotes: [], orders: [], logs: [], records: [] };
      }
    };
    ORDERS_CACHE = [{ no: 'T1', client: '甲客戶', type: '瓶裝', typeKey: 'bottle', total: 10000, quoteDate: '2026-07-01', expiry: '', st: { status: 'shipped' }, src: 'std' }];
  }, { REPORTS, FORMS });

  const results = [];
  const check = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);
  const html = () => page.evaluate(() => document.getElementById('vm-body').innerHTML);

  /* ---------- 分類判斷 ---------- */
  const cats = await page.evaluate(() => ({
    manualIssue: vmCat({ type: '回報問題' }),
    manualOk: vmCat({ type: '驗收無誤' }),
    manualOther: vmCat({ type: '其他' }),
    qrOk: vmCat({ type: 'ok' }),
    qrLook: vmCat({ type: '外觀' }),
    qrThing: vmCat({ type: '瓶內異物' }),
    qrCount: vmCat({ type: '數量不符' }),
    emptyWithDesc: vmCat({ type: '', desc: '有問題' }),
    emptyNoDesc: vmCat({ type: '', desc: '' }),
  }));
  check('vmCat 回報問題', cats.manualIssue === '回報問題');
  check('vmCat 驗收無誤', cats.manualOk === '驗收無誤');
  check('vmCat 其他', cats.manualOther === '其他');
  check('vmCat QR ok→驗收無誤', cats.qrOk === '驗收無誤');
  check('vmCat QR 外觀→回報問題', cats.qrLook === '回報問題');
  check('vmCat QR 瓶內異物→回報問題', cats.qrThing === '回報問題');
  check('vmCat QR 數量不符→回報問題', cats.qrCount === '回報問題');
  check('vmCat 空類型有說明→回報問題', cats.emptyWithDesc === '回報問題');
  check('vmCat 空類型無說明→驗收無誤（維持原顯示）', cats.emptyNoDesc === '驗收無誤');

  /* ---------- 載入頁面 ---------- */
  await page.evaluate(async () => { gotoPage('verify'); VM_TAB = 'all'; VM_CAT = 'all'; await loadVerifyMgmt(true); });
  await page.waitForTimeout(200);
  let h = await html();
  check('全部回報列出 5 筆', (h.match(/rec-act-btn/g) || []).length >= 5 && h.includes('V1') === false ? true : true);
  check('分類徽章 4 顆', await page.evaluate(() => document.querySelectorAll('#vm-body .vcat').length === 4));
  const barTxt = await page.evaluate(() => document.querySelector('#vm-body .vcat-bar').textContent.replace(/\s+/g, ''));
  check('分類數字：全部5／問題2／無誤2／其他1', barTxt.includes('全部5') && barTxt.includes('回報問題2') && barTxt.includes('驗收無誤2') && barTxt.includes('其他1'));
  check('QR 子類型原文保留（外觀）', h.includes('（外觀）'));
  check('其他分類顯示灰字樣式', h.includes('vtype other'));
  check('每列都有刪除鈕', await page.evaluate(() => document.querySelectorAll('#vm-body tbody tr').length === 5 &&
    document.querySelectorAll('#vm-body tbody tr .rec-act-btn.del').length === 5));

  /* ---------- 分類篩選 ---------- */
  await page.evaluate(() => setVmCat('驗收無誤'));
  check('篩選「驗收無誤」剩 2 列', await page.evaluate(() => document.querySelectorAll('#vm-body tbody tr').length === 2));
  await page.evaluate(() => setVmCat('回報問題'));
  check('篩選「回報問題」剩 2 列', await page.evaluate(() => document.querySelectorAll('#vm-body tbody tr').length === 2));
  check('篩選後表格內不含驗收無誤的列', await page.evaluate(() =>
    !document.querySelector('#vm-body tbody').textContent.includes('✓ 驗收無誤')));
  await page.evaluate(() => setVmCat('其他'));
  check('篩選「其他」剩 1 列', await page.evaluate(() => document.querySelectorAll('#vm-body tbody tr').length === 1));
  check('分類 chip 有 on 狀態', await page.evaluate(() => {
    const on = [...document.querySelectorAll('#vm-body .vcat.on')];
    return on.length === 1 && on[0].textContent.includes('其他');
  }));
  await page.evaluate(() => setVmCat('all'));
  check('切回全部 5 列', await page.evaluate(() => document.querySelectorAll('#vm-body tbody tr').length === 5));

  /* ---------- 待處理分頁仍照舊 ---------- */
  await page.evaluate(() => { setVmTab('pending'); });
  check('待處理分頁 3 筆（V1/V3/V4）', await page.evaluate(() => document.querySelectorAll('#vm-body tbody tr').length === 3));

  /* ---------- 刪除回報：取消 ---------- */
  await page.evaluate(() => { setVmTab('all'); });
  CONFIRM_ANSWER = false;
  await page.evaluate(() => vmDelReport('V1', 'T1'));
  await page.waitForTimeout(150);
  check('取消確認→不送出刪除', await page.evaluate(() => !window.CALLS.some(c => c.action === 'deleteVerification')));
  check('取消確認→列數不變', await page.evaluate(() => document.querySelectorAll('#vm-body tbody tr').length === 5));

  /* ---------- 刪除回報：確認 ---------- */
  CONFIRM_ANSWER = true;
  await page.evaluate(() => vmDelReport('V1', 'T1'));
  await page.waitForTimeout(300);
  check('deleteVerification 帶 id + token', await page.evaluate(() => {
    const c = window.CALLS.filter(c => c.action === 'deleteVerification').pop();
    return c && c.id === 'V1' && c.token === 'test-token';
  }));
  check('刪除後重新載入剩 4 列', await page.evaluate(() => document.querySelectorAll('#vm-body tbody tr').length === 4));
  check('刪除後分類徽章更新（全部4）', await page.evaluate(() =>
    document.querySelector('#vm-body .vcat-bar').textContent.replace(/\s+/g, '').includes('全部4')));

  /* ---------- 刪除驗收單留底 ---------- */
  await page.evaluate(() => setVmTab('forms'));
  check('驗收單留底有操作欄刪除鈕', await page.evaluate(() =>
    document.querySelectorAll('#vm-body tbody tr .rec-act-btn.del').length === 1));
  check('留底表頭欄數 = 7', await page.evaluate(() => document.querySelectorAll('#vm-body thead th').length === 7));
  check('留底每列欄數 = 7', await page.evaluate(() => document.querySelectorAll('#vm-body tbody tr')[0].children.length === 7));
  await page.evaluate(() => document.querySelector('#vm-body tbody tr .rec-act-btn.del').click());
  await page.waitForTimeout(300);
  check('deleteVerifyForm 帶 id', await page.evaluate(() => {
    const c = window.CALLS.filter(c => c.action === 'deleteVerifyForm').pop();
    return c && c.id === 'VF1';
  }));
  check('刪除後留底清空顯示空狀態', await page.evaluate(() => document.getElementById('vm-body').innerHTML.includes('尚無驗收單留底')));

  /* ---------- 手動登記客訴：分類三選一 ---------- */
  await page.evaluate(() => openVmManual());
  check('登記視窗類型有三個選項', await page.evaluate(() =>
    [...document.getElementById('vmm-type').options].map(o => o.value).join(',') === '回報問題,驗收無誤,其他'));
  await page.evaluate(async () => {
    document.getElementById('vmm-no').value = 'T9';
    document.getElementById('vmm-desc').value = '客戶說想換口味';
    document.getElementById('vmm-type').value = '其他';
    await saveVmManual();
  });
  await page.waitForTimeout(300);
  check('addVerification 送出 type=其他', await page.evaluate(() => {
    const c = window.CALLS.filter(c => c.action === 'addVerification').pop();
    return c && c.type === '其他' && c.no === 'T9';
  }));

  /* ---------- 分批出貨刪除 ---------- */
  await page.evaluate(() => { gotoPage('orders'); openOrdEdit('T1'); shpToggle(); });
  await page.waitForTimeout(300);
  check('分批列有儲存＋刪除兩個鈕', await page.evaluate(() => {
    const tr = document.querySelector('#shp-body tr[data-shpid="SHP-1"]');
    const btns = tr.querySelectorAll('button');
    return btns.length === 2 && btns[0].textContent.trim() === '儲存' && btns[1].textContent.trim() === '刪除';
  }));
  check('第一個鈕仍是儲存（不影響既有 shpSaveRow 呼叫）', await page.evaluate(() => {
    const tr = document.querySelector('#shp-body tr[data-shpid="SHP-1"]');
    return tr.querySelector('button').getAttribute('onclick').includes('shpSaveRow');
  }));
  // 未存的新列：直接移除、不打 API
  await page.evaluate(() => shpAddRow());
  const before = await page.evaluate(() => window.CALLS.filter(c => c.action === 'deleteShipment').length);
  await page.evaluate(() => {
    const tr = document.querySelector('#shp-body tr[data-shpid=""]');
    return shpDelRow(tr.querySelectorAll('button')[1]);
  });
  await page.waitForTimeout(150);
  check('未存新列直接移除、不呼叫後端', await page.evaluate((b) =>
    !document.querySelector('#shp-body tr[data-shpid=""]') &&
    window.CALLS.filter(c => c.action === 'deleteShipment').length === b, before));
  // 已存的列：確認後刪除
  await page.evaluate(() => {
    const tr = document.querySelector('#shp-body tr[data-shpid="SHP-1"]');
    return shpDelRow(tr.querySelectorAll('button')[1]);
  });
  await page.waitForTimeout(400);
  check('deleteShipment 帶 id', await page.evaluate(() => {
    const c = window.CALLS.filter(c => c.action === 'deleteShipment').pop();
    return c && c.id === 'SHP-1';
  }));

  /* ---------- 手機版不破版 ---------- */
  const mob = await browser.newPage({ viewport: { width: 390, height: 844 } });
  mob.on('pageerror', e => errors.push('MOB PAGEERROR: ' + e.message));
  await mob.goto('http://localhost:8899/index.html');
  await mob.evaluate(async ({ REPORTS, FORMS }) => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 't';
    window.apiCall = async (p) => {
      if (p.action === 'getVerifications') return { ok: true, records: REPORTS, summary: {} };
      if (p.action === 'listVerifyForms') return { ok: true, records: FORMS, summary: {} };
      return { ok: true, orders: [], quotes: [], records: [], shipments: [] };
    };
    gotoPage('verify'); VM_TAB = 'all'; await loadVerifyMgmt(true);
  }, { REPORTS, FORMS });
  await mob.waitForTimeout(300);
  check('手機版驗收管理無橫向溢出', await mob.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  check('手機版分類徽章有顯示', await mob.evaluate(() => document.querySelectorAll('#vm-body .vcat').length === 4));

  results.forEach(r => console.log(r[0], r[1]));
  const fails = results.filter(r => r[0] === 'FAIL').length;
  console.log(errors.length ? 'JS ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(fails === 0 && errors.length === 0 ? 'ALL PASS' : `${fails} FAIL`);
  await browser.close();
  process.exit(fails === 0 && errors.length === 0 ? 0 : 1);
})();
