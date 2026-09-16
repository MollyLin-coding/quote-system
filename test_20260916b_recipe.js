/* 2026-09-16b：附件二配方帶入（14_contract.js ctRcp*）。後端全 mock。
   1 產品列有「配方」鈕、展開面板並載入來源（本客戶的酒譜書排前、獨立 Run Card 分組）
   2 帶入酒譜書分頁 → 列數、體積按單瓶容量換算、提供方猜測（甲方供料）、配方計算值回填主列
   3 帶入 Run Card（含固體）→ 固體列無占比、備註標固體
   4 ctCollect 帶 recipe（rows/processNote/source），沒展開的款不帶 recipe
   5 移除產品列會連同配方列一起移除；產品列數只算 .ct-prod-row
   6 無 pageerror */
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
    window.readCall = async () => ({ ok: true, quotes: [], records: [], links: [], orders: [], contracts: [] });
    window.apiCall = async (p) => {
      window.__calls.push(p);
      if (p.action === 'contractPrefill') return { ok: true,
        quote: { quoteNo: '20260907-01', clientName: '日富一日', quoteType: 'bottle', priceMode: 'exc', expiryDate: '2026-10-07',
          items: [{ itemType: 'bottle', name: '蘋果威士忌調酒', volume: 500, qty: 250, unitPrice: 500 }, { itemType: 'bottle', name: '芭樂琴酒調酒', volume: 500, qty: 250, unitPrice: 470 }] },
        customer: null, consignCustomer: null, pay: { dep: 133088, bal: 133087 }, templates: { oem: true, consign: true } };
      if (p.action === 'contractRecipeSources') return { ok: true,
        books: [ { key: 'Feeling Bar', matched: false, recipes: [{ sheet: 'FB_紫芋茉莉奶酒', recipeName: '紫芋茉莉奶酒' }] },
                 { key: '全客製-日富一日', matched: true, recipes: [{ sheet: 'FUJI-蘋果蜂蜜威士忌調酒', recipeName: '蘋果蜂蜜威士忌' }, { sheet: 'FUJI-芭樂紫蘇', recipeName: '芭樂紫蘇' }] } ],
        runcards: [ { id: 'RC-20260722-001', client: 'Feeling Bar', product: '紫芋茉莉奶酒', status: '進行中', matched: false },
                    { id: 'RC-20260901-001', client: '日富一日', product: '蘋果威士忌試作', status: '進行中', matched: true } ] };
      if (p.action === 'contractRecipeFetch' && p.src === 'sheet') return { ok: true, src: 'sheet', source: p.key + '／' + p.sheet, recipeName: '蘋果蜂蜜威士忌', abv: 14.55, totalVol: 4000, processNote: '蘋果浸泡 7 天',
        rows: [{ name: '威士忌', pct: 30, vol: 1200, abv: 40, method: '' }, { name: '蘋果汁', pct: 50, vol: 2000, abv: 0, method: '' }, { name: '蜂蜜水', pct: 20, vol: 800, abv: 0, method: '(蜂蜜:水=1:3)' }] };
      if (p.action === 'contractRecipeFetch' && p.src === 'runcard') return { ok: true, src: 'runcard', source: 'Run Card ' + p.id + '／蘋果威士忌試作', recipeName: '蘋果威士忌試作', abv: 12, totalVol: 4000, processNote: '',
        rows: [{ name: '40%糖蜜酒', pct: 30, vol: 1200, abv: 40, method: '', note: '' }, { name: '茶湯', pct: 70, vol: 2800, abv: 0, method: '', note: '子料：茉莉綠茶×2' }, { name: '肉桂棒', pct: '', vol: '', abv: '', method: '', note: '固體原料，比例 1' }] };
      if (p.action === 'generateContract') return { ok: true, contractNo: 'CT-20260916-01', fileNameBase: 'x', docUrl: 'https://docs.google.com/document/d/X/edit', pdfUrl: '', docxUrl: '', pdfBase64: '' };
      return { ok: true };
    };
    window.downloadBase64_ = () => {};
    AUTH_TOKEN = 'x'; USER_ROLE = 'owner';
  });
  const results = []; const check = (n, c, i) => results.push({ name: n, pass: !!c, info: i });

  await page.evaluate(async () => { gotoPage('contract'); await openContractForm('20260907-01'); await new Promise(r => setTimeout(r, 200)); });

  // 1 配方鈕＋面板＋來源
  const r1 = await page.evaluate(async () => {
    const prods = document.querySelectorAll('#ct-prod-body tr.ct-prod-row'), dets = document.querySelectorAll('#ct-prod-body tr.ct-rcp-row');
    const btn = prods[0].querySelector('.ct-rcp-btn'); btn.click(); await new Promise(r => setTimeout(r, 250));
    const sel = dets[0].querySelector('.ct-rcp-src');
    const groups = [...sel.querySelectorAll('optgroup')].map(g => g.label);
    return { prods: prods.length, dets: dets.length, shown: dets[0].style.display, groups, nOpt: sel.options.length, srcCall: window.__calls.filter(c => c.action === 'contractRecipeSources').length };
  });
  check('1 兩款各有配方鈕與隱藏面板；展開後載入來源，本客戶酒譜書 ★ 排前、獨立 Run Card 分組',
    r1.prods === 2 && r1.dets === 2 && r1.shown === '' && r1.groups[0].includes('獨立 Run Card') && r1.groups[1].startsWith('★ 酒譜書：全客製-日富一日') && r1.nOpt === 1 + 1 + 3 + 1 && r1.srcCall === 1, JSON.stringify(r1));

  // 2 帶入酒譜書
  const r2 = await page.evaluate(async () => {
    document.getElementById('ct-supply').checked = true; document.getElementById('ct-supply-items').value = '蘋果汁、蜂蜜';
    const det = document.querySelectorAll('#ct-prod-body tr.ct-rcp-row')[0];
    const sel = det.querySelector('.ct-rcp-src'); sel.value = 'sheet|全客製-日富一日|FUJI-蘋果蜂蜜威士忌調酒';
    det.querySelector('.rec-act-btn.primary').click(); await new Promise(r => setTimeout(r, 300));
    const rows = [...det.querySelectorAll('tbody > tr')].map(tr => ({ name: tr.querySelector('[data-r=name]').value, pct: tr.querySelector('[data-r=pct]').value, vol: tr.querySelector('[data-r=vol]').value, abv: tr.querySelector('[data-r=abv]').value, by: tr.querySelector('[data-r=by]').value, method: (tr.querySelector('[data-r=method]') || {}).value || '' }));
    const prod = document.querySelectorAll('#ct-prod-body tr.ct-prod-row')[0];
    return { rows, abvCalc: prod.querySelector('[data-f=abvCalc]').value, proc: det.querySelector('.ct-rcp-proc').value, note: det.querySelector('.ct-rcp-note').textContent, sum: det.querySelector('.ct-rcp-sum').textContent, btn: prod.querySelector('.ct-rcp-btn').textContent };
  });
  check('2 帶入酒譜書：3 列、體積按單瓶 500ml 換算（30%→150）、甲方供料猜對（蘋果汁／蜂蜜水→甲）、製作方式、配方計算值回填 14.55、鈕顯示「配方 3」',
    r2.rows.length === 3 && r2.rows[0].vol === '150' && r2.rows[1].vol === '250' && r2.rows[0].by === '乙' && r2.rows[1].by === '甲' && r2.rows[2].by === '甲' && r2.rows[2].method.includes('1:3') && r2.abvCalc === '14.55' && r2.proc === '蘋果浸泡 7 天' && r2.note.includes('FUJI-蘋果蜂蜜威士忌調酒') && r2.sum.includes('100%') && r2.btn.trim() === '配方 3', JSON.stringify(r2));

  // 3 帶入 Run Card（第二款）
  const r3 = await page.evaluate(async () => {
    const prods = document.querySelectorAll('#ct-prod-body tr.ct-prod-row'), dets = document.querySelectorAll('#ct-prod-body tr.ct-rcp-row');
    prods[1].querySelector('.ct-rcp-btn').click(); await new Promise(r => setTimeout(r, 100));
    const sel = dets[1].querySelector('.ct-rcp-src'); sel.value = 'runcard|RC-20260901-001';
    dets[1].querySelector('.rec-act-btn.primary').click(); await new Promise(r => setTimeout(r, 300));
    const rows = [...dets[1].querySelectorAll('tbody > tr')].map(tr => ({ name: tr.querySelector('[data-r=name]').value, pct: tr.querySelector('[data-r=pct]').value, note: tr.querySelector('[data-r=note]').value }));
    const fetchCall = window.__calls.filter(c => c.action === 'contractRecipeFetch').pop();
    return { rows, fetchCall, abvCalc: prods[1].querySelector('[data-f=abvCalc]').value };
  });
  check('3 帶入 Run Card：呼叫 src=runcard id；3 列含固體（無占比、備註「固體原料」）、子料寫在備註、計算值 12',
    r3.fetchCall && r3.fetchCall.src === 'runcard' && r3.fetchCall.id === 'RC-20260901-001' && r3.rows.length === 3 && r3.rows[2].pct === '' && r3.rows[2].note.includes('固體原料') && r3.rows[1].note.includes('子料') && r3.abvCalc === '12', JSON.stringify(r3));

  // 4 ctCollect
  const r4 = await page.evaluate(() => { document.getElementById('ct-cli-rep').value = '趙庭甄'; const p = ctCollect(); return { n: p.products.length, r0: p.products[0].recipe, r1: p.products[1].recipe }; });
  check('4 ctCollect：兩款都帶 recipe（rows／processNote／source／totalVol），提供方與備註都在',
    r4.n === 2 && r4.r0 && r4.r0.rows.length === 3 && r4.r0.processNote === '蘋果浸泡 7 天' && r4.r0.source.includes('日富一日') && r4.r0.totalVol === 4000 && r4.r0.rows[1].by === '甲' && r4.r1 && r4.r1.rows.length === 3 && r4.r1.rows[2].note.includes('固體'), JSON.stringify(r4).slice(0, 500));

  // 5 移除
  const r5 = await page.evaluate(async () => {
    ctAddProdRow({ name: '第三款' });
    const before = { p: document.querySelectorAll('#ct-prod-body tr.ct-prod-row').length, d: document.querySelectorAll('#ct-prod-body tr.ct-rcp-row').length };
    const prods = document.querySelectorAll('#ct-prod-body tr.ct-prod-row');
    prods[1].querySelector('.rec-act-btn.del').click(); await new Promise(r => setTimeout(r, 50));
    const after = { p: document.querySelectorAll('#ct-prod-body tr.ct-prod-row').length, d: document.querySelectorAll('#ct-prod-body tr.ct-rcp-row').length };
    const p = ctCollect();
    return { before, after, names: p.products.map(x => x.name), third: !!p.products[1].recipe };
  });
  check('5 加第三款（無配方）→ 3+3；移除第二款連同其配方列 → 2+2；沒展開的款不帶 recipe',
    r5.before.p === 3 && r5.before.d === 3 && r5.after.p === 2 && r5.after.d === 2 && r5.names.join(',') === '蘋果威士忌調酒,第三款' && r5.third === false, JSON.stringify(r5));

  check('6 無 pageerror', errors.length === 0, errors.join(' | '));
  await browser.close();
  let pass = 0; results.forEach(x => { console.log((x.pass ? '✅ ' : '❌ ') + x.name + (x.pass ? '' : '  → ' + (x.info || ''))); if (x.pass) pass++; });
  console.log(`\n${pass}/${results.length} 通過`); process.exit(pass === results.length ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
