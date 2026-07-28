/* 訂單追蹤：訂金/尾款依付款規則帶入 離線測試
   ・新單（沒存過進度）打開編輯 → 預設 50/50 帶入
   ・客戶主檔付款習慣寫「訂金30%」（好野吧/南野子）→ 30/70 帶入；用發票抬頭比對也要中
   ・已存過進度的單 → 不自動帶（避免蓋掉手動留空／手改值）
   ・「依規則帶入」按鈕同樣吃規則；付款習慣沒寫訂金%（如 預付全款9折）→ 回預設 50 */
const { chromium } = require('/opt/node-tools/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  const isNoise = t => /Failed to load resource|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|favicon/i.test(t);
  page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('CONSOLE: ' + m.text()); });

  await page.goto('http://localhost:8899/index.html');
  await page.evaluate(() => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 'test-token';
    window.apiCall = async () => ({ ok: true, quotes: [], orders: [], records: [] });
    CUS_MASTER = [
      { customer_id: 'CU-1', name: '好野吧', invoice_title: '南野子國際整合行銷股份有限公司', pay_habit: '訂金30%/尾款70%' },
      { customer_id: 'CU-2', name: '淘飲', invoice_title: '佩波電商', pay_habit: '預付全款9折' },
    ];
    ORDERS_CACHE = [
      { no: 'N1', client: '一般客戶', type: '瓶裝', typeKey: 'bottle', total: 10000, quoteDate: '2026-07-01', expiry: '', st: {}, src: 'std' },
      { no: 'N2', client: '好野吧', type: '瓶裝', typeKey: 'bottle', total: 10000, quoteDate: '2026-07-01', expiry: '', st: {}, src: 'std' },
      { no: 'N3', client: '南野子國際整合行銷股份有限公司', type: '瓶裝', typeKey: 'bottle', total: 20000, quoteDate: '2026-07-01', expiry: '', st: {}, src: 'std' },
      { no: 'N4', client: '好野吧', type: '瓶裝', typeKey: 'bottle', total: 10000, quoteDate: '2026-07-01', expiry: '',
        st: { updated_at: '2026-07-20T10:00:00+08:00', status: 'shipped', grand_total: 10000, deposit_amt: '', final_amt: 10000 }, src: 'std' },
      { no: 'N5', client: '淘飲', type: '瓶裝', typeKey: 'bottle', total: 9000, quoteDate: '2026-07-01', expiry: '', st: {}, src: 'std' },
    ];
  });

  const results = [];
  const check = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);
  const openAndRead = async (no) => page.evaluate(n => {
    openOrdEdit(n);
    const v = id => document.getElementById(id).value;
    const r = { dep: v('oe-deposit_amt'), fin: v('oe-final_amt'), gt: v('oe-grand_total') };
    closeOrdEdit();
    return r;
  }, no);

  const n1 = await openAndRead('N1');
  check('一般客戶新單：總額帶入 10000', n1.gt === '10000');
  check('一般客戶新單：訂金 50% = 5000', n1.dep === '5000');
  check('一般客戶新單：尾款 5000', n1.fin === '5000');

  const n2 = await openAndRead('N2');
  check('好野吧新單：訂金 30% = 3000', n2.dep === '3000');
  check('好野吧新單：尾款 70% = 7000', n2.fin === '7000');

  const n3 = await openAndRead('N3');
  check('用發票抬頭（南野子…公司）比對也吃 30%：訂金 6000', n3.dep === '6000');
  check('發票抬頭比對：尾款 14000', n3.fin === '14000');

  const n4 = await openAndRead('N4');
  check('已存過的單：訂金不被自動蓋（維持空白）', n4.dep === '');
  check('已存過的單：尾款維持原值 10000', n4.fin === '10000');

  const n5 = await openAndRead('N5');
  check('付款習慣沒寫訂金%（預付全款9折）→ 預設 50%：4500', n5.dep === '4500');

  check('ordDepositPct 查無客戶 → 50', await page.evaluate(() => ordDepositPct('不存在的客戶') === 50));
  check('ordDepositPct 空名稱 → 50', await page.evaluate(() => ordDepositPct('') === 50));

  /* 「依規則帶入」按鈕 */
  const btn = await page.evaluate(() => {
    openOrdEdit('N2');
    document.getElementById('oe-deposit_amt').value = '';
    document.getElementById('oe-final_amt').value = '';
    document.getElementById('oe-grand_total').value = '5000';
    fillHalf();
    const v = id => document.getElementById(id).value;
    const r = { dep: v('oe-deposit_amt'), fin: v('oe-final_amt') };
    closeOrdEdit();
    return r;
  });
  check('按鈕依規則帶入（好野吧 30%）：訂金 1500', btn.dep === '1500');
  check('按鈕依規則帶入：尾款 3500', btn.fin === '3500');

  results.forEach(r => console.log(r[0], r[1]));
  const fails = results.filter(r => r[0] === 'FAIL').length;
  console.log(errors.length ? 'JS ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(fails === 0 ? 'ALL PASS' : fails + ' FAIL');
  await browser.close();
  process.exit(fails === 0 && errors.length === 0 ? 0 : 1);
})();
