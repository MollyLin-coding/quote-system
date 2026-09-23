/* 2026-09-23 Molly 定：客戶主檔「付款習慣」帶進報價單付款條件（自訂 Tab3）。
   空白或系統自動帶的字才填；自己打的字、編輯舊單、已選其他付款方式都不動；主檔優先於公司預設條款。 */
const { chromium } = require('playwright');
async function run() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  page.route('**/script.google.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, users: [], list: [], customers: [] }) }));
  await page.goto('http://localhost:8899/index.html');
  await page.waitForTimeout(800);
  const r = await page.evaluate(async () => {
    AUTH_TOKEN = 'x';
    const HAB = '排產前15日訂金50%/驗收後15日尾款50%';
    COMPANY_DATA = { companies: [
      { company_id: 'jrpy', name: '貳捌參伍有限公司', brand: '酒肉朋友', tax_id: '00164695', contact: '', active: 'Y' },
      { company_id: 'dpt', name: '有預設條款公司', brand: '預設', tax_id: '', default_pay_terms: '公司預設：月結30天', active: 'Y' },
      { company_id: 'none', name: '空白公司', brand: '空白', tax_id: '', active: 'Y' },
    ], products: [], rules: [] };
    populateCompanySelects();
    CUS_MASTER = [
      { customer_id: 'CU-1', name: '酒肉朋友', contact: 'Jake', pay_habit: HAB, active: 'Y' },
      { customer_id: 'CU-2', name: '預設', contact: 'A', pay_habit: '主檔：驗收後7天100%', active: 'Y' },
      { customer_id: 'CU-3', name: '沒習慣', contact: 'B', pay_habit: '', active: 'Y' },
    ];
    cusFillPickSelect();
    const t = () => document.getElementById('p3-txt').value;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const pick = async cid => { const s = document.getElementById('qf-company'); s.value = cid; onSelectCompany(true); await sleep(50); };
    const out = {};
    setPay(0); document.getElementById('p3-txt').value = '';
    await pick('jrpy'); out.a = { txt: t(), tab: payTab };
    await pick('dpt'); out.b = { txt: t(), tab: payTab };            // 主檔優先於公司預設
    await pick('none'); out.c = { txt: t(), tab: payTab };           // 換到沒有習慣／條款的公司 → 清掉自動帶的字
    // 自己打過字不蓋
    await pick('none'); setPay(3); document.getElementById('p3-txt').value = '我自己寫的條款';
    await pick('jrpy'); out.d = { txt: t() };
    // 選既有客戶（主檔下拉）
    document.getElementById('p3-txt').value = ''; PAY_TXT_AUTOFILL = ''; setPay(0);
    const sel = document.getElementById('f-cuspick'); sel.value = 'CU-1'; pickQuoteCustomer(); await sleep(50);
    out.e = { txt: t(), tab: payTab };
    // 使用者已選 Tab1 → 不動
    document.getElementById('p3-txt').value = ''; PAY_TXT_AUTOFILL = ''; setPay(1);
    sel.value = 'CU-1'; pickQuoteCustomer(); await sleep(50);
    out.f = { txt: t(), tab: payTab };
    // 編輯舊單（有存檔付款條件）→ 不動
    setPay(0); document.getElementById('p3-txt').value = ''; PAY_TXT_AUTOFILL = ''; LOADED_PAY_DETAIL = '舊單原文';
    sel.value = 'CU-1'; pickQuoteCustomer(); await sleep(50);
    out.g = { txt: t(), tab: payTab, loaded: LOADED_PAY_DETAIL };
    LOADED_PAY_DETAIL = null;
    // 存單送出的付款條件就是這段文字
    setPay(0); document.getElementById('p3-txt').value = ''; PAY_TXT_AUTOFILL = '';
    await pick('jrpy'); out.h = { terms: (typeof getPayTerms === 'function') ? getPayTerms() : '' , tab: payTab };
    return out;
  });
  const HAB = '排產前15日訂金50%/驗收後15日尾款50%';
  const T = [];
  T.push({ name: '選公司酒肉朋友 → 付款條件自訂帶入付款習慣', pass: r.a.txt === HAB && r.a.tab === 3, info: JSON.stringify(r.a) });
  T.push({ name: '主檔付款習慣優先於公司預設條款', pass: r.b.txt === '主檔：驗收後7天100%' && r.b.tab === 3, info: JSON.stringify(r.b) });
  T.push({ name: '換到沒有習慣的公司 → 清掉自動帶的字', pass: r.c.txt === '' && r.c.tab === 0, info: JSON.stringify(r.c) });
  T.push({ name: '自己打過的條款不被蓋掉', pass: r.d.txt === '我自己寫的條款', info: JSON.stringify(r.d) });
  T.push({ name: '選既有客戶 → 帶入付款習慣', pass: r.e.txt === HAB && r.e.tab === 3, info: JSON.stringify(r.e) });
  T.push({ name: '已選其他付款方式（Tab1）→ 不動', pass: r.f.txt === '' && r.f.tab === 1, info: JSON.stringify(r.f) });
  T.push({ name: '編輯舊單 → 不動', pass: r.g.txt === '' && r.g.loaded === '舊單原文', info: JSON.stringify(r.g) });
  T.push({ name: '存單的付款條件文字＝付款習慣', pass: r.h.terms.includes(HAB), info: JSON.stringify(r.h) });
  T.push({ name: '無 pageerror', pass: errors.length === 0, info: errors.join(' | ') });
  await browser.close();
  let pass = 0; T.forEach(x => { console.log((x.pass ? '✅ ' : '❌ ') + x.name + (x.pass ? '' : '  → ' + (x.info || ''))); if (x.pass) pass++; });
  console.log(`\n${pass}/${T.length} 通過`); process.exit(pass === T.length ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
