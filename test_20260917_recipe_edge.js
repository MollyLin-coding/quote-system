/* 2026-09-17 複檢：附件二配方帶入邊界情境（後端全 mock）。
   1 單瓶容量空白時帶入 → 體積退回配方原體積；之後補填容量，列體積是否跟著換算
   2 刪一列 → 重新編號、占比合計變紅（≠100）
   3 來源載入後才改客戶名稱 → ★ 分組是否跟著變
   4 來源載入失敗 → 下拉顯示失敗、不炸；再展開可重試
   5 產生合約：generateContract 收到的 products[].recipe 與畫面一致；空白列（無名稱）被濾掉
   6 手機寬度 390：配方面板不撐出水平捲軸
   7 無 pageerror */
const { chromium } = require('playwright');
const SRC = { ok: true,
  books: [ { key: 'Feeling Bar', matched: false, recipes: [{ sheet: 'FB_紫芋茉莉奶酒', recipeName: '紫芋茉莉奶酒' }] },
           { key: '全客製-日富一日', matched: false, recipes: [{ sheet: 'FUJI-芭樂紫蘇', recipeName: '芭樂紫蘇' }] } ],
  runcards: [ { id: 'RC-20260722-001', client: 'Feeling Bar', product: '紫芋茉莉奶酒', status: '進行中', matched: false } ] };
async function run() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => d.accept());
  page.route('**/script.google.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, users: [], list: [] }) }));
  await page.goto('http://localhost:8899/index.html');
  await page.waitForFunction(() => { const s = document.getElementById('login-user'); return s && s.options && s.options.length > 0 && s.options[0].textContent.indexOf('載入中') === -1; }, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);
  await page.evaluate((SRC) => {
    window.__calls = []; window.__srcFail = false; window.__srcMatched = null;
    window.readCall = async () => ({ ok: true, quotes: [], records: [], links: [], orders: [], contracts: [] });
    window.apiCall = async (p) => {
      window.__calls.push(p);
      if (p.action === 'contractPrefill') return { ok: true, quote: null, customer: { name: '' }, consignCustomer: null, templates: { oem: true, consign: true } };
      if (p.action === 'contractRecipeSources') {
        if (window.__srcFail) return { ok: false, error: '試算表打不開' };
        const d = JSON.parse(JSON.stringify(SRC));
        d.books.forEach(b => { b.matched = !!p.clientName && b.key.includes(p.clientName); });
        return d;
      }
      if (p.action === 'contractRecipeFetch') return { ok: true, src: 'sheet', source: p.key + '／' + p.sheet, recipeName: '芭樂紫蘇', abv: 10, totalVol: 4000, processNote: '',
        rows: [{ name: '琴酒', pct: 25, vol: 1000, abv: 40, method: '' }, { name: '芭樂汁', pct: 50, vol: 2000, abv: 0, method: '' }, { name: '紫蘇水', pct: 25, vol: 1000, abv: 0, method: '' }] };
      if (p.action === 'generateContract') { window.__gen = p; return { ok: true, contractNo: 'CT-X', fileNameBase: 'x', docUrl: 'https://docs.google.com/document/d/X/edit', pdfUrl: '', docxUrl: '', pdfBase64: '' }; }
      return { ok: true };
    };
    window.downloadBase64_ = () => {};
    AUTH_TOKEN = 'x'; USER_ROLE = 'owner';
  }, SRC);
  const results = []; const check = (n, c, i) => results.push({ name: n, pass: !!c, info: i });

  await page.evaluate(async () => { gotoPage('contract'); await openContractForm(''); await new Promise(r => setTimeout(r, 200)); });

  // 1 容量空白帶入
  const r1 = await page.evaluate(async () => {
    const prod = document.querySelector('#ct-prod-body tr.ct-prod-row'), det = prod.nextElementSibling;
    prod.querySelector('[data-f=name]').value = ''; prod.querySelector('[data-f=volume]').value = '';
    prod.querySelector('.ct-rcp-btn').click(); await new Promise(r => setTimeout(r, 250));
    det.querySelector('.ct-rcp-src').value = 'sheet|全客製-日富一日|FUJI-芭樂紫蘇';
    det.querySelector('.rec-act-btn.primary').click(); await new Promise(r => setTimeout(r, 300));
    const vols0 = [...det.querySelectorAll('[data-r=vol]')].map(i => i.value);
    const nameAuto = prod.querySelector('[data-f=name]').value;
    const vi = prod.querySelector('[data-f=volume]'); vi.value = '500'; vi.dispatchEvent(new Event('input', { bubbles: true })); vi.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 100));
    const vols1 = [...det.querySelectorAll('[data-r=vol]')].map(i => i.value);
    return { vols0, vols1, nameAuto };
  });
  check('1 容量空白：體積退回配方原體積 1000/2000/1000、品名自動帶 芭樂紫蘇；補填 500ml 後列體積跟著換算成 125/250/125',
    r1.vols0.join(',') === '1000,2000,1000' && r1.nameAuto === '芭樂紫蘇' && r1.vols1.join(',') === '125,250,125', JSON.stringify(r1));

  // 2 刪一列
  const r2 = await page.evaluate(async () => {
    const det = document.querySelector('#ct-prod-body tr.ct-rcp-row');
    det.querySelectorAll('tbody > tr')[1].querySelector('.rec-act-btn.del').click(); await new Promise(r => setTimeout(r, 50));
    const idx = [...det.querySelectorAll('.ct-rcp-idx')].map(e => e.textContent);
    const sum = det.querySelector('.ct-rcp-sum');
    return { idx, sumTxt: sum.textContent, bad: !!sum.querySelector('.ct-rcp-bad'), btn: det.previousElementSibling.querySelector('.ct-rcp-btn').textContent.trim() };
  });
  check('2 刪第二列：重新編號 1,2；占比合計 50% 標紅；主列鈕列數更新為「配方 2」',
    r2.idx.join(',') === '1,2' && r2.sumTxt.includes('50%') && r2.bad && r2.btn === '配方 2', JSON.stringify(r2));

  // 3 改客戶名稱後分組
  const r3 = await page.evaluate(async () => {
    const det = document.querySelector('#ct-prod-body tr.ct-rcp-row');
    const g0 = [...det.querySelectorAll('.ct-rcp-src optgroup')].map(g => g.label);
    const n = document.getElementById('ct-cli-name'); n.value = '日富一日'; n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    const g1 = [...det.querySelectorAll('.ct-rcp-src optgroup')].map(g => g.label);
    return { g0, g1 };
  });
  check('3 來源載入時客戶空白 → 沒有 ★；之後填「日富一日」→ 該酒譜書分組變 ★ 並排前',
    !r3.g0.some(l => l.startsWith('★')) && r3.g1[0] && r3.g1[0].startsWith('★ 酒譜書：全客製-日富一日'), JSON.stringify(r3));

  // 4 載入失敗
  const r4 = await page.evaluate(async () => {
    window.__srcFail = true; CT_RCP_SRC = null;
    ctAddProdRow({ name: '第二款', volume: 500 });
    const prods = document.querySelectorAll('#ct-prod-body tr.ct-prod-row'), det = prods[1].nextElementSibling;
    prods[1].querySelector('.ct-rcp-btn').click(); await new Promise(r => setTimeout(r, 300));
    const failTxt = det.querySelector('.ct-rcp-src').options[0].textContent;
    window.__srcFail = false;
    prods[1].querySelector('.ct-rcp-btn').click(); await new Promise(r => setTimeout(r, 50));   // 收合
    prods[1].querySelector('.ct-rcp-btn').click(); await new Promise(r => setTimeout(r, 300)); // 再展開 → 重試
    const nOpt = det.querySelector('.ct-rcp-src').options.length;
    return { failTxt, nOpt };
  });
  check('4 來源載入失敗：下拉顯示（載入失敗：…）不炸；收合再展開會重試成功', r4.failTxt.includes('載入失敗') && r4.nOpt > 1, JSON.stringify(r4));

  // 5 產生：空白列濾掉、payload 一致
  const r5 = await page.evaluate(async () => {
    const det = document.querySelector('#ct-prod-body tr.ct-rcp-row');
    ctRcpAddRow(det.querySelector('tbody'));   // 空白列
    document.getElementById('ct-cli-rep').value = '王小明';
    await ctGenerate(); await new Promise(r => setTimeout(r, 100));
    const g = window.__gen;
    return { n: g.params.products.length, rows: g.params.products[0].recipe.rows.map(r => r.name + ':' + r.pct + ':' + r.vol), abvCalc: g.params.products[0].recipe.abvCalc, second: g.params.products[1].recipe || null };
  });
  check('5 產生合約：第一款 recipe 2 列（空白列濾掉）、體積是換算後的 125/125、abvCalc=10；第二款沒配方就不帶 recipe',
    r5.n === 2 && r5.rows.join('|') === '琴酒:25:125|紫蘇水:25:125' && r5.abvCalc === '10' && r5.second === null, JSON.stringify(r5));

  // 6 手機寬度
  await page.setViewportSize({ width: 390, height: 800 });
  await page.evaluate(() => { const l = document.getElementById('login-overlay'); if (l) l.style.display = 'none'; });
  await page.waitForTimeout(300);
  const r6 = await page.evaluate(() => {
    const ov = document.getElementById('ct-overlay'); const box = ov.querySelector('.ct-form, .modal, .ov-box') || ov.firstElementChild;
    const det = document.querySelector('#ct-prod-body tr.ct-rcp-row');
    const wrap = det.querySelector('.ct-rcp'); const tbl = det.querySelector('.ct-rcp-tbl');
    return { docW: document.documentElement.scrollWidth, winW: innerWidth, boxW: box.getBoundingClientRect().width, boxScroll: box.scrollWidth, wrapW: wrap.getBoundingClientRect().width, tblW: tbl.scrollWidth, wrapOverflow: getComputedStyle(wrap).overflowX };
  });
  await page.screenshot({ path: '/tmp/qs_live/_shot_mobile_rcp.png', fullPage: false });
  check('6 手機 390px：整頁無水平捲軸（scrollWidth ≤ 視窗）', r6.docW <= r6.winW + 1, JSON.stringify(r6));

  check('7 無 pageerror', errors.length === 0, errors.join(' | '));
  await browser.close();
  let pass = 0; results.forEach(x => { console.log((x.pass ? '✅ ' : '❌ ') + x.name + (x.pass ? '' : '  → ' + (x.info || ''))); if (x.pass) pass++; });
  console.log(`\n${pass}/${results.length} 通過`); process.exit(pass === results.length ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
