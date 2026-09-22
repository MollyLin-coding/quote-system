/* 2026-09-22：客戶主檔「付款習慣」寫無訂金時，訂單追蹤的「依付款規則帶入」要給訂金 0／尾款 100%。
   只測 ordDepositPct 的字串判讀，不碰 UI。 */
const { chromium } = require('playwright');
async function run() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  page.route('**/script.google.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, users: [], list: [] }) }));
  await page.goto('http://localhost:8899/index.html');
  await page.waitForTimeout(800);
  const cases = [
    ['Babyface', '無訂金；驗收後 7 天內付尾款 100%', 0],
    ['A客戶', '訂金 0%', 0],
    ['B客戶', '免訂金，月結', 0],
    ['C客戶', '不收訂金', 0],
    ['D客戶', '訂金30%', 30],
    ['E客戶', '訂金 50 %', 50],
    ['F客戶', '到貨驗收無誤後付款', 50],
    ['G客戶', '', 50],
    ['H客戶', '訂金100%', 50],
  ];
  const got = await page.evaluate(cs => {
    CUS_MASTER = cs.map(c => ({ name: c[0], invoice_title: '', pay_habit: c[1] }));
    AUTH_TOKEN = 'x';
    return cs.map(c => ordDepositPct(c[0]));
  }, cases);
  const results = [];
  cases.forEach((c, i) => results.push({ name: `${c[0]}「${c[1]}」→ ${c[2]}%`, pass: got[i] === c[2], info: '實際 ' + got[i] }));
  results.push({ name: '未建檔客戶 → 50%', pass: (await page.evaluate(() => ordDepositPct('沒這家'))) === 50 });
  results.push({ name: '無 pageerror', pass: errors.length === 0, info: errors.join(' | ') });
  await browser.close();
  let pass = 0; results.forEach(x => { console.log((x.pass ? '✅ ' : '❌ ') + x.name + (x.pass ? '' : '  → ' + (x.info || ''))); if (x.pass) pass++; });
  console.log(`\n${pass}/${results.length} 通過`); process.exit(pass === results.length ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
