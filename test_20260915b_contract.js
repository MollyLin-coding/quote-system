/* 2026-09-15b：合約產生模組（14_contract.js + 合約頁 + 報價紀錄「合約」鈕）。
   後端全部 mock（contractPrefill / generateContract / listContracts），只驗前端接線：
   1 合約頁能開、標題正確  2 報價紀錄沒有「合約」鈕  3 開表單會帶入報價單資料
   4 型別切換顯示對應區塊  5 ctCollect 送出的 params 正確  6 產生後顯示連結並重整清單  7 無 pageerror */
const { chromium } = require('playwright');
async function run() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => d.accept());
  page.route('**/script.google.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, users: [], list: [] }) }));
  await page.goto('http://localhost:8899/index.html');
  await page.waitForFunction(() => { const s = document.getElementById('login-user'); return s && s.options && s.options.length > 0 && s.options[0].textContent.indexOf('載入中') === -1; }, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    window.__calls = [];
    window.readCall = async (p) => (p && p.action === 'listContracts') ? window.apiCall(p) : ({ ok: true, quotes: [], records: [], links: [], orders: [] });
    window.readCallMany = async () => [{ ok: true, quotes: [] }, { ok: true, quotes: [] }];
    window.apiCall = async (p) => {
      window.__calls.push(p);
      if (p.action === 'contractPrefill') return { ok: true,
        quote: { quoteNo: '20260912-01', clientName: '昭和浪漫冰室', quoteType: 'bottle', priceMode: 'exc', expiryDate: '2026-10-12', contactName: '王小明', contactPhone: '0912345678', clientTaxId: '12345678', clientAddress: '台北市中山區 1 號', invoiceTitle: '昭和浪漫冰室有限公司',
          items: [{ itemType: 'bottle', name: '浪漫梅酒', volume: 700, qty: 300, unitPrice: 320 }, { itemType: 'taglabel', name: '批次標籤' }, { itemType: 'bottle', name: '冰室荔枝酒', volume: 500, qty: 200, unitPrice: 280 }] },
        customer: { name: '昭和浪漫冰室', email: 'a@b.c' }, consignCustomer: null, pay: { dep: 60000, bal: 100000 }, templates: { oem: true, consign: true } };
      if (p.action === 'generateContract') return { ok: true, contractNo: 'CT-20260915-01', fileNameBase: 'CT-20260915-01_昭和浪漫冰室_代工合約', docUrl: 'https://docs.google.com/document/d/X/edit', pdfUrl: 'https://drive.google.com/file/d/P/view', docxUrl: 'https://drive.google.com/file/d/W/view', pdfBase64: '' };
      if (p.action === 'listContracts') return { ok: true, contracts: [{ contract_no: 'CT-20260915-01', type: 'oem', quote_no: '20260912-01', client: '昭和浪漫冰室', sign_date: '2026-09-15', term_start: '2026-09-15', term_end: '2027-09-14', doc_id: 'X', pdf_id: 'P', docx_id: 'W', docUrl: 'https://docs.google.com/document/d/X/edit', pdfUrl: 'https://drive.google.com/uc?export=download&id=P', docxUrl: '', created_by: 'Molly', created_at: '2026-09-15 10:00', status: 'draft' }] };
      return { ok: true };
    };
    window.downloadBase64_ = () => {};
    AUTH_TOKEN = 'x'; USER_ROLE = 'owner';
  });
  const results = []; const check = (n, c, i) => results.push({ name: n, pass: !!c, info: i });

  // 1 合約頁
  const r1 = await page.evaluate(async () => { gotoPage('contract'); await new Promise(r => setTimeout(r, 300));
    return { on: document.getElementById('page-contract').classList.contains('on'), title: document.getElementById('tb-title').textContent, nav: document.getElementById('nav-contract').classList.contains('on'), tbr: document.getElementById('tbr-standard').style.display, rows: document.querySelectorAll('#ct-body tr').length, txt: document.getElementById('ct-body').textContent }; });
  check('1 合約頁開啟、標題「合約」、側欄亮、清單有 1 筆', r1.on && r1.title === '合約' && r1.nav && r1.tbr === 'none' && r1.rows === 1 && r1.txt.includes('CT-20260915-01'), JSON.stringify(r1));

  // 2 報價紀錄「合約」鈕
  const r2 = await page.evaluate(() => { gotoPage('records');
    REC_QUOTES = [{ quoteNo: '20260912-01', clientName: '昭和浪漫冰室', quoteType: 'bottle', quoteDate: '2026-09-12', grandTotal: 50000, createdBy: 'Molly' }];
    REC_CUSTOM = []; REC_OS = {}; ORDER_VSUM = { forms: {}, reps: {}, repList: [], lots: {}, ship: {} }; FX_LINKS = {};
    document.getElementById('rec-search').value = ''; renderRecords();
    const b = [...document.querySelectorAll('#rec-body .rec-act-btn')].find(x => x.textContent.trim() === '合約');
    const has = !!b; USER_ROLE = 'general'; renderRecords();
    const hasG = !![...document.querySelectorAll('#rec-body .rec-act-btn')].find(x => x.textContent.trim() === '合約');
    USER_ROLE = 'owner'; return { has, hasG }; });
  check('2 報價紀錄不再有「合約」鈕（2026-09-16 Molly：合約是新客戶簽一年約，不掛在報價單上）', !r2.has && !r2.hasG, JSON.stringify(r2));

  // 3 開表單帶入
  const r3 = await page.evaluate(async () => { await openContractForm('20260912-01'); await new Promise(r => setTimeout(r, 200));
    const v = id => document.getElementById(id).value;
    return { shown: document.getElementById('ct-overlay').style.display, name: v('ct-cli-name'), tax: v('ct-tax'), exp: v('ct-quote-expiry'), inv: v('ct-cli-inv'), contact: v('ct-cli-contact'), email: v('ct-cli-email'), dep: v('ct-dep'), bal: v('ct-bal'),
      prods: [...document.querySelectorAll('#ct-prod-body tr.ct-prod-row')].map(tr => tr.querySelector('[data-f=name]').value), type: ctType(), warn: document.getElementById('ct-tpl-warn').style.display }; });
  check('3 表單帶入：客戶／未稅／有效期／抬頭／聯絡人／訂金尾款／只帶酒款品項（排除標籤列）', r3.shown === 'flex' && r3.name === '昭和浪漫冰室' && r3.tax === 'exc' && r3.exp === '2026-10-12' && r3.inv.includes('有限公司') && r3.contact === '王小明' && r3.email === 'a@b.c' && String(r3.dep) === '60000' && String(r3.bal) === '100000' && r3.prods.join(',') === '浪漫梅酒,冰室荔枝酒' && r3.type === 'oem' && r3.warn === 'none', JSON.stringify(r3));

  // 4 型別切換
  const r4 = await page.evaluate(() => { ctSetType('consign'); const a = { oem: document.getElementById('ct-sec-oem').style.display, con: document.getElementById('ct-sec-consign').style.display, lbl: document.getElementById('ct-party-label').textContent, t: ctType() }; ctSetType('oem'); a.back = document.getElementById('ct-sec-oem').style.display; return a; });
  check('4 切寄售：隱藏代工區、顯示寄售區、標籤變乙方；切回代工正常', r4.oem === 'none' && r4.con === '' && r4.lbl.includes('乙方') && r4.t === 'consign' && r4.back === '', JSON.stringify(r4));

  // 5 ctCollect
  const r5 = await page.evaluate(() => { const s = (id, v) => { document.getElementById(id).value = v; };
    s('ct-cli-rep', '陳老闆'); s('ct-first-l', '200'); s('ct-later-l', '100'); s('ct-owner', 'a'); s('ct-gs1', 'b'); s('ct-gs1-fee', '5000'); s('ct-penalty', '100000'); s('ct-split-fee', '1500');
    document.getElementById('ct-sgs').checked = true; s('ct-sgs-fee', '3000');
    [...document.querySelectorAll('#ct-prod-body tr.ct-prod-row')][0].querySelector('[data-f=abv]').value = '12';
    const p = ctCollect(); return p; });
  check('5 ctCollect 參數正確（型別／報價單號／代表人／批量／配方歸屬／GS1／SGS／產品度數）', r5.type === 'oem' && r5.quoteNo === '20260912-01' && r5.clientRep === '陳老闆' && r5.firstBatchL === 200 && r5.laterBatchL === 100 && r5.formulaOwner === 'a' && r5.gs1 === 'b' && r5.gs1Fee === 5000 && r5.sgs === true && r5.sgsFee === 3000 && r5.secrecyPenalty === 100000 && r5.splitShipFee === 1500 && r5.taxMode === 'exc' && r5.products.length === 2 && r5.products[0].abv === '12' && r5.depositAmt === 60000, JSON.stringify(r5).slice(0, 400));

  // 6 產生
  const r6 = await page.evaluate(async () => { await ctGenerate(); await new Promise(r => setTimeout(r, 300));
    const gen = window.__calls.find(c => c.action === 'generateContract');
    return { sent: !!gen && gen.type === 'oem' && gen.params && gen.params.clientName === '昭和浪漫冰室', html: document.getElementById('ct-result').innerHTML, btn: document.getElementById('ct-gen-btn').disabled }; });
  check('6 產生：呼叫 generateContract、顯示 Google 文件／PDF／Word 連結、按鈕恢復', r6.sent && r6.html.includes('CT-20260915-01') && r6.html.includes('docs.google.com') && r6.html.includes('Word') && r6.btn === false, JSON.stringify(r6).slice(0, 300));

  // 7 必填擋
  const r7 = await page.evaluate(async () => { const n = window.__calls.length; document.getElementById('ct-cli-name').value = ''; await ctGenerate(); return window.__calls.length === n; });
  check('7 客戶名稱空白時不送出', r7, '');
  check('8 無 pageerror', errors.length === 0, errors.join(' | '));
  await browser.close();
  let pass = 0; results.forEach(x => { console.log((x.pass ? '✅ ' : '❌ ') + x.name + (x.pass ? '' : '  → ' + (x.info || ''))); if (x.pass) pass++; });
  console.log(`\n${pass}/${results.length} 通過`); process.exit(pass === results.length ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
