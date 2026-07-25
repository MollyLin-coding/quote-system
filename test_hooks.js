/* 掛勾機制測試（原本三個「猴子補丁」改成 onHook/runHooks 後的行為鎖定）
   重點：改寫前後行為必須一樣——自動規則會套上、防重入不會無限迴圈、
   刪自動列會記住不再加回、清除表單會連公司選擇一起清掉。 */
const { chromium } = require('/opt/node-tools/node_modules/playwright');

const COMPANY = {
  companies: [{ company_id: 'C1', name: '測試公司', tax_id: '', phone: '', address: '', invoice_title: '' }],
  products: [{ product_id: 'P1', company_id: 'C1', name: '測試酒', spec: '500ml', unit: '瓶', price: 300, moq: 0, tier_json: '' }],
  rules: [{ rule_id: 'R1', company_id: 'C1', rule_type: 'free_ship_threshold', display_text: '整批出貨免運', params_json: '{"min_qty":100,"ship_fee":800}' }],
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errors = [];
  // __e 那筆是本測試故意丟的錯誤（驗證單一掛勾出錯不會拖垮其他掛勾），不算真的錯
  const isNoise = t => /Failed to load resource|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|favicon|\[hook\] __e/i.test(t);
  const results = [];
  const check = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);

  const page = await browser.newPage();
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('CONSOLE: ' + m.text()); });
  let CONFIRM = true;
  page.on('dialog', d => (CONFIRM ? d.accept() : d.dismiss()));

  await page.goto('http://localhost:8899/index.html');
  await page.evaluate((COMPANY) => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 't';
    window.apiCall = async (p) => {
      if (p.action === 'getCompanyData') return Object.assign({ ok: true }, COMPANY);
      return { ok: true, quotes: [], orders: [], records: [], items: [] };
    };
    COMPANY_DATA = COMPANY;
  }, COMPANY);

  /* ---------- 1. 機制本身 ---------- */
  check('onHook / runHooks 存在', await page.evaluate(() => typeof onHook === 'function' && typeof runHooks === 'function'));
  check('依登記順序執行、參數傳得到', await page.evaluate(() => {
    const seen = [];
    onHook('__t', v => seen.push('a' + v));
    onHook('__t', v => seen.push('b' + v));
    runHooks('__t', 1);
    return seen.join(',') === 'a1,b1';
  }));
  check('某個掛勾出錯不會拖垮其他掛勾', await page.evaluate(() => {
    const seen = [];
    onHook('__e', () => { throw new Error('boom'); });
    onHook('__e', () => seen.push('still-ran'));
    runHooks('__e');
    return seen.length === 1;
  }));
  check('沒登記過的掛勾名稱不會爆', await page.evaluate(() => { try { runHooks('__none'); return true; } catch (e) { return false; } }));
  check('不再用 window.calc 覆寫（沒有猴子補丁殘留）', await page.evaluate(() =>
    String(window.calc).indexOf('_calcOrig') === -1 && String(window.resetAll).indexOf('_r(s)') === -1));

  /* ---------- 2. calc 掛勾：自動規則仍會套上 ---------- */
  await page.evaluate(() => {
    gotoPage('new');
    setType('bottle');
    populateCompanySelects();
    document.getElementById('qf-company').value = 'C1';
    onSelectCompany();
  });
  await page.waitForTimeout(300);
  check('選公司後帶入品項（前置）', await page.evaluate(() => {
    document.getElementById('qf-product').value = 'P1';
    quickAddProduct();
    return botItems.length >= 1;
  }));
  check('未達門檻→自動加一列運費（calc 掛勾有跑）', await page.evaluate(() => {
    const row = document.getElementById('r-' + botItems[0]);
    row.querySelector('[data-f="qty"]').value = '10';
    calc();
    const e = extras.find(x => x.auto === 'ship');
    return !!e && e.a === 800 && e.n.indexOf('未達') >= 0;
  }));
  check('達門檻→自動列變免運 $0（不會重複新增）', await page.evaluate(() => {
    const row = document.getElementById('r-' + botItems[0]);
    row.querySelector('[data-f="qty"]').value = '150';
    calc();
    const list = extras.filter(x => x.auto === 'ship');
    return list.length === 1 && list[0].a === 0 && list[0].n.indexOf('免運') >= 0;
  }));
  check('防重入旗標有回復（沒有卡在 true）', await page.evaluate(() => _rulesBusy === false));
  check('連續呼叫 calc 不會愈加愈多列', await page.evaluate(() => {
    calc(); calc(); calc();
    return extras.filter(x => x.auto === 'ship').length === 1;
  }));
  check('總計有把自動列算進去', await page.evaluate(() => {
    const row = document.getElementById('r-' + botItems[0]);
    row.querySelector('[data-f="qty"]').value = '10';
    calc();
    // 10 瓶 × 300 = 3000，加運費 800 = 3800（未稅小計）
    return document.getElementById('t-ext').textContent === '$800';
  }));

  /* ---------- 3. removeExt 掛勾：刪掉自動列後不再自動加回 ---------- */
  check('刪自動列會記住 RULE_SUPPRESS', await page.evaluate(() => {
    const e = extras.find(x => x.auto === 'ship');
    removeExt(e.id);
    return RULE_SUPPRESS['ship'] === true;
  }));
  check('刪掉後再算也不會自動長回來', await page.evaluate(() => {
    calc(); calc();
    return !extras.find(x => x.auto === 'ship');
  }));
  check('刪一般（非自動）額外費用不會誤設 RULE_SUPPRESS', await page.evaluate(() => {
    RULE_SUPPRESS = {};
    pushExt('手動費用', 500);
    const manual = extras.find(x => x.n === '手動費用');
    removeExt(manual.id);
    return Object.keys(RULE_SUPPRESS).length === 0 && !extras.find(x => x.n === '手動費用');
  }));

  /* ---------- 4. resetAll 掛勾 ---------- */
  check('清除表單會一起清掉公司選擇／發票抬頭', await page.evaluate(() => {
    document.getElementById('qf-company').value = 'C1';
    onSelectCompany();
    document.getElementById('f-inv').value = '某某公司';
    FORM_DIRTY = true;
    resetAll(true);
    return document.getElementById('f-inv').value === '' &&
      document.getElementById('qf-company').value === '' &&
      SELECTED_COMPANY === null && FORM_DIRTY === false;
  }));
  // 行為修正：以前按「清除」後選取消，公司選擇/發票抬頭還是會被清掉（掛勾在原函式外面）
  check('按清除後選「取消」→ 表單與公司選擇都保留（修正舊 bug）', await page.evaluate(async () => {
    document.getElementById('qf-company').value = 'C1';
    onSelectCompany();
    document.getElementById('f-inv').value = '不該被清掉';
    await new Promise(r => setTimeout(r, 50));
    return true;
  }) && await (async () => {
    CONFIRM = false;
    await page.evaluate(() => resetAll());
    await page.waitForTimeout(200);
    const r = await page.evaluate(() => ({ inv: document.getElementById('f-inv').value, cmp: document.getElementById('qf-company').value, sel: !!SELECTED_COMPANY }));
    CONFIRM = true;
    return r.inv === '不該被清掉' && r.cmp === 'C1' && r.sel === true;
  })());

  results.forEach(r => console.log(r[0], r[1]));
  const fails = results.filter(r => r[0] === 'FAIL').length;
  console.log(errors.length ? 'JS ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(fails === 0 && errors.length === 0 ? 'ALL PASS' : `${fails} FAIL`);
  await browser.close();
  process.exit(fails === 0 && errors.length === 0 ? 0 : 1);
})();
