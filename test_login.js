/* 登入速度相關的離線測試：開頁先叫醒後端／登入順便帶回今日待辦／在這台裝置記住我／登出
   一樣用 Playwright 攔真正的 fetch，所以 apiCall 裡的邏輯都測得到。 */
const { chromium } = require('/opt/node-tools/node_modules/playwright');

const DIGEST = {
  ok:true, today:'2026-07-26',
  ship_due:[{ quote_no:'T-101', client:'酒旺商行', plan_ship_date:'2026-07-20', overdue_days:6, urgent:true }],
  final_due:[], no_scan:[], no_invoice:[], calendar:[], warnings:[]
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errors = [];
  const results = [];
  const check = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);
  const isNoise = t => /Failed to load resource|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|favicon/i.test(t);

  let LOG = [];
  let WITH_DIGEST = true;         // 模擬後端有沒有 v38 的 digest
  let PIN_OK = true;
  const countOf = a => LOG.filter(x => x === a).length;
  const reset = () => { LOG = []; };

  const newPage = async () => {
    const p = await browser.newPage();
    p.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    p.on('console', m => { if (m.type()==='error' && !isNoise(m.text())) errors.push('CONSOLE: ' + m.text()); });
    await p.route('**/script.google.com/**', async route => {
      let b = {};
      try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
      LOG.push(b.action);
      let r;
      if (b.action === 'login') {
        if (!PIN_OK) r = { ok:false, error:'PIN 錯誤（再錯 4 次會鎖 15 分鐘）' };
        else { r = { ok:true, token:'tok-123' }; if (WITH_DIGEST) r.digest = DIGEST; }
      }
      else if (b.action === 'verifyHeaders') r = { ok:true, message:'欄位表頭一致' };
      else if (b.action === 'getTodayDigest') r = DIGEST;
      else if (b.action === 'getCompanyData') r = { ok:true, companies:[], products:[], rules:[] };
      else if (b.action === 'batch') r = { ok:true, results:(b.calls||[]).map(()=>({ok:true, quotes:[], orders:[], records:[], summary:{}, shipments:[]})) };
      else r = { ok:true, quotes:[], orders:[], records:[], items:[], shipments:[], summary:{} };
      await route.fulfill({ status:200, headers:{'Access-Control-Allow-Origin':'*'}, contentType:'application/json', body:JSON.stringify(r) });
    });
    await p.goto('http://localhost:8899/index.html');
    return p;
  };

  /* ---------- 1. 開登入頁就先叫醒後端 ---------- */
  reset();
  let page = await newPage();
  await page.waitForTimeout(400);
  check('沒登入時顯示登入框', await page.evaluate(() => getComputedStyle(document.getElementById('login-overlay')).display !== 'none'));
  check('開頁馬上叫醒後端（打了 verifyHeaders）', countOf('verifyHeaders') === 1);
  check('叫醒用的那支不需要通行證、也沒順便撈資料', LOG.length === 1);
  check('登入框有「在這台裝置記住我」且預設沒勾', await page.evaluate(() => {
    const c = document.getElementById('login-remember');
    return c && c.type === 'checkbox' && c.checked === false;
  }));

  /* ---------- 2. 登入：後端順便把今日待辦帶回來 ---------- */
  reset();
  await page.evaluate(() => { document.getElementById('login-pin').value = '123456'; });
  await page.evaluate(async () => { await doLogin(); });
  await page.waitForTimeout(600);
  check('登入成功後登入框關閉', await page.evaluate(() => getComputedStyle(document.getElementById('login-overlay')).display === 'none'));
  check('登入只打了 login，沒有再打一趟 getTodayDigest', countOf('login')===1 && countOf('getTodayDigest')===0);
  check('今日待辦直接畫出來了', await page.evaluate(() => document.getElementById('td-body').innerText.includes('酒旺商行')));
  check('沒勾記住我 → localStorage 不留通行證', await page.evaluate(() => localStorage.getItem('qs_session_v1') === null));
  check('沒勾記住我 → 分頁內仍然是登入狀態', await page.evaluate(() => AUTH_TOKEN === 'tok-123' && sessionStorage.getItem('quote_token') === 'tok-123'));

  /* ---------- 3. 舊後端（沒有 digest）照舊自己去要 ---------- */
  WITH_DIGEST = false;
  const p3 = await newPage();
  reset();
  await p3.evaluate(async () => { document.getElementById('login-pin').value='123456'; await doLogin(); });
  await p3.waitForTimeout(700);
  check('後端沒帶 digest → 前端自己打 getTodayDigest（不會空白）', countOf('getTodayDigest') === 1);
  check('後端沒帶 digest → 今日待辦一樣有內容', await p3.evaluate(() => document.getElementById('td-body').innerText.includes('酒旺商行')));
  WITH_DIGEST = true;

  /* ---------- 4. 勾了「記住我」→ 下次直接進去 ---------- */
  const p4 = await newPage();
  reset();
  await p4.evaluate(async () => {
    document.getElementById('login-pin').value='123456';
    document.getElementById('login-remember').checked = true;
    await doLogin();
  });
  await p4.waitForTimeout(400);
  check('勾了記住我 → localStorage 有存通行證', await p4.evaluate(() => !!localStorage.getItem('qs_session_v1')));
  check('存的內容有 90 天效期（2026-08-31 起：除非登出否則不再打 PIN）', await p4.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('qs_session_v1'));
    const days = (c.exp - Date.now()) / 86400000;
    return c.t === 'tok-123' && days > 89.9 && days <= 90.01;
  }));

  /* ---------- 4b. 2026-08-31：持續在用 → 到期時間會被 rememberTouch 一直往後推（滑動視窗） ---------- */
  await p4.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('qs_session_v1'));
    c.exp = Date.now() + 1000;                          // 模擬只剩 1 秒就過期
    localStorage.setItem('qs_session_v1', JSON.stringify(c));
  });
  await p4.evaluate(async () => { try{ await apiCall({action:'getQuotes', token:AUTH_TOKEN}); }catch(e){} });
  await p4.waitForTimeout(200);
  check('4b. 快過期時只要正常用（apiCall 成功）→ 到期時間被推回 90 天，不會突然要求重打 PIN', await p4.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('qs_session_v1'));
    const days = (c.exp - Date.now()) / 86400000;
    return days > 89 && days <= 90.01;
  }));
  reset();
  await p4.reload();                                   // 模擬關掉分頁再回來
  await p4.waitForTimeout(600);
  check('重開網頁 → 直接進去，不用再打 PIN', await p4.evaluate(() => getComputedStyle(document.getElementById('login-overlay')).display === 'none'));
  check('重開網頁 → 不用再打 login（省掉 2.5 秒）', countOf('login') === 0);
  check('重開網頁 → 也不會再叫醒後端（已經登入了）', countOf('verifyHeaders') === 0);

  /* ---------- 5. 過期的通行證不會被拿來用 ---------- */
  const p5 = await newPage();
  await p5.evaluate(() => localStorage.setItem('qs_session_v1', JSON.stringify({ t:'old-token', exp:Date.now()-1000 })));
  await p5.reload();
  await p5.waitForTimeout(400);
  check('過期通行證 → 還是要打 PIN', await p5.evaluate(() => getComputedStyle(document.getElementById('login-overlay')).display !== 'none'));
  check('過期通行證 → 直接被清掉', await p5.evaluate(() => localStorage.getItem('qs_session_v1') === null));

  /* ---------- 6. 後端說通行證失效 → 兩邊都清掉 ---------- */
  const p6 = await newPage();
  await p6.evaluate(async () => {
    document.getElementById('login-pin').value='123456';
    document.getElementById('login-remember').checked = true;
    await doLogin();
  });
  await p6.waitForTimeout(300);
  await p6.route('**/script.google.com/**', async route => {
    await route.fulfill({ status:200, headers:{'Access-Control-Allow-Origin':'*'}, contentType:'application/json',
      body: JSON.stringify({ ok:false, error:'UNAUTHORIZED: token 無效或已過期，請重新登入' }) });
  });
  await p6.evaluate(async () => { try{ await apiCall({action:'getQuotes', token:AUTH_TOKEN}); }catch(e){} });
  await p6.waitForTimeout(200);
  check('通行證失效 → localStorage 的也清掉', await p6.evaluate(() => localStorage.getItem('qs_session_v1') === null));
  check('通行證失效 → 回到登入畫面', await p6.evaluate(() => getComputedStyle(document.getElementById('login-overlay')).display !== 'none'));

  /* ---------- 7. 登出 ---------- */
  const p7 = await newPage();
  await p7.evaluate(async () => {
    document.getElementById('login-pin').value='123456';
    document.getElementById('login-remember').checked = true;
    await doLogin();
  });
  await p7.waitForTimeout(300);
  check('側邊選單有登出鈕', await p7.evaluate(() => {
    const b=[...document.querySelectorAll('.sb-foot button')].find(x=>x.textContent.includes('登出'));
    return !!b;
  }));
  await p7.evaluate(() => { doLogout(); });
  await p7.waitForTimeout(800);
  check('登出後 localStorage 清空', await p7.evaluate(() => localStorage.getItem('qs_session_v1') === null));
  check('登出後回到登入畫面', await p7.evaluate(() => getComputedStyle(document.getElementById('login-overlay')).display !== 'none'));
  check('登出後今日待辦的離線快取也清掉', await p7.evaluate(() => localStorage.getItem('qs_today_v1') === null));

  /* ---------- 8. PIN 打錯不會被記住 ---------- */
  PIN_OK = false;
  const p8 = await newPage();
  await p8.evaluate(async () => {
    document.getElementById('login-pin').value='000000';
    document.getElementById('login-remember').checked = true;
    await doLogin();
  });
  await p8.waitForTimeout(300);
  check('PIN 錯誤 → 不會存任何通行證', await p8.evaluate(() => localStorage.getItem('qs_session_v1') === null));
  check('PIN 錯誤 → 顯示後端給的訊息', await p8.evaluate(() => document.getElementById('login-err').textContent.includes('PIN 錯誤')));
  check('PIN 錯誤 → 登入鈕恢復可按', await p8.evaluate(() => document.getElementById('login-btn').disabled === false));
  PIN_OK = true;

  results.forEach(r => console.log(r[0], r[1]));
  const fails = results.filter(r => r[0]==='FAIL').length;
  console.log(errors.length ? 'JS ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(fails===0 && errors.length===0 ? 'ALL PASS' : `${fails} FAIL`);
  await browser.close();
  process.exit(fails===0 && errors.length===0 ? 0 : 1);
})();
