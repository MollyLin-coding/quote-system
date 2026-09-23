/* 2026-09-23：從「公司報價檔」選公司時，公司檔沒填的聯絡人等要從客戶主檔補上（主檔優先）。
   共用統編的三個品牌（雋荖廚房／Babyface／拾山）不能靠統編亂配。 */
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
    COMPANY_DATA = { companies: [
      { company_id: 'jrpy', name: '貳捌參伍有限公司', brand: '酒肉朋友', tax_id: '00164695', contact: '', phone: '', address: '', active: 'Y' },
      { company_id: 'jl', name: '海越食品有限公司', brand: '雋荖廚房', tax_id: '53371016', contact: '', active: 'Y' },
      { company_id: 'Bai', name: '海越食品有限公司', brand: '拾山', tax_id: '53371016', contact: '', active: 'Y' },
      { company_id: 'zh', name: '昭和浪漫冰室', brand: '', tax_id: '', contact: '公司檔聯絡人', phone: '02-1', active: 'Y' },
    ], products: [], rules: [] };
    populateCompanySelects();
    CUS_MASTER = [
      { customer_id: 'CU-1', name: '酒肉朋友', contact: 'Jake', tax_id: '00164695', invoice_title: '貳捌參伍有限公司', phone: '', address: '', active: 'Y' },
      { customer_id: 'CU-2', name: '雋荖廚房', contact: 'jl', tax_id: '53371016', invoice_title: '海越食品有限公司', active: 'Y' },
      { customer_id: 'CU-3', name: 'babyface', contact: '王瓅雯小姐', tax_id: '53371016', invoice_title: '海越食品有限公司', active: 'Y' },
      { customer_id: 'CU-4', name: '昭和浪漫冰室', contact: '', phone: '', active: 'Y' },
    ];
    const v = id => document.getElementById(id).value;
    const pick = async cid => { const s = document.getElementById('qf-company'); s.value = cid; onSelectCompany(true); await new Promise(r => setTimeout(r, 50)); };
    const out = {};
    await pick('jrpy'); out.jrpy = { con: v('f-con'), tax: v('f-tax'), inv: v('f-inv'), cli: v('f-cli') };
    await pick('Bai'); out.bai = { con: v('f-con') };          // 拾山沒有主檔、統編跟另兩家共用 → 不可亂配
    await pick('jl'); out.jl = { con: v('f-con') };
    await pick('zh'); out.zh = { con: v('f-con'), ph: v('f-ph') }; // 主檔空白 → 保留公司檔的值
    // 主檔還沒載好：非同步補上，但不蓋掉已經有字的格子
    CUS_MASTER = [];
    cusEnsureMaster = async () => { CUS_MASTER = [{ customer_id: 'CU-1', name: '酒肉朋友', contact: 'Jake', phone: '0900', active: 'Y' }]; };
    await pick('jrpy'); document.getElementById('f-ph').value;
    out.late = { con: v('f-con'), ph: v('f-ph') };
    return out;
  });
  const T = [];
  T.push({ name: '選酒肉朋友 → 聯絡人帶出 Jake', pass: r.jrpy.con === 'Jake', info: JSON.stringify(r.jrpy) });
  T.push({ name: '統編保留 00164695、發票抬頭正確', pass: r.jrpy.tax === '00164695' && r.jrpy.inv === '貳捌參伍有限公司', info: JSON.stringify(r.jrpy) });
  T.push({ name: '拾山（共用統編、無主檔）不會被配成別家的聯絡人', pass: r.bai.con === '', info: JSON.stringify(r.bai) });
  T.push({ name: '雋荖廚房依品牌配到自己的主檔', pass: r.jl.con === 'jl', info: JSON.stringify(r.jl) });
  T.push({ name: '主檔空白的欄位保留公司檔的值', pass: r.zh.con === '公司檔聯絡人' && r.zh.ph === '02-1', info: JSON.stringify(r.zh) });
  T.push({ name: '主檔晚到：非同步補上空格', pass: r.late.con === 'Jake' && r.late.ph === '0900', info: JSON.stringify(r.late) });
  T.push({ name: '無 pageerror', pass: errors.length === 0, info: errors.join(' | ') });
  await browser.close();
  let pass = 0; T.forEach(x => { console.log((x.pass ? '✅ ' : '❌ ') + x.name + (x.pass ? '' : '  → ' + (x.info || ''))); if (x.pass) pass++; });
  console.log(`\n${pass}/${T.length} 通過`); process.exit(pass === T.length ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
