/* ============================================================
   API 層 + 系統功能（登入 / 儲存 / 列表 / 匯出）
   ============================================================ */
const API_URL = "https://script.google.com/macros/s/AKfycbytSqCF0St1Gu8F_u8KW9rcKJnkkGAfrdaHYyrQ6wDKa19Z3TxZd-GRRi_3Ii3Ijv4i/exec";
let AUTH_TOKEN = null;
let USER_ROLE = 'owner';      // 'owner'（Molly，全權限）｜'general'（一般使用者，如阿軒/Vic）
let USER_NAME = '';
let currentPage = 'new';      // new | records

/* ============================================================
   角色權限（2026-08-07 加，配合後端 v46/v50）
   ⚠ 這裡只是「把不能用的東西藏起來」讓畫面乾淨，**不是安全機制**。
      真正的把關在後端 OWNER_ONLY_ACTIONS_，一般使用者就算硬打 API 也會被擋。
   ⚠ 後端擋下來時回的錯誤開頭是 FORBIDDEN（不是 UNAUTHORIZED），
      所以不會被 apiCall 誤判成「登入過期」而把人踢出去。
   ============================================================ */
function isOwner(){ return USER_ROLE !== 'general'; }

// 給寫入類函式開頭用：不是老闆就擋下並提示，回 false
function needOwner(what){
  if(isOwner()) return true;
  toast((what ? what + '：' : '') + '這個功能只有老闆帳號能操作', 'err');
  return false;
}

/* 一般使用者要藏起來的按鈕：比對 onclick 裡呼叫的函式名。
   用「掃 onclick」而不是逐一改每個 render 函式，是因為這些按鈕散在十幾個
   樣板字串裡，逐一改動到的地方太多、容易漏也容易改壞。 */
const OWNER_ONLY_FNS = [
  // 訂單追蹤（唯讀）
  'openOrdEdit','saveOrdEdit','shpAddRow','shpDelRow','shpSaveRow','shpToggle','fillHalf','openChangeLog',
  // 寄售管理（唯讀）
  'openConsignMove','saveConsignMove','csAddMoveRow','csDelMoveRow',
  'openConsignCustomerEdit','saveConsignCustomerForm','addConsignException','delConsignException',
  'consignMonthlyToQuote',
  // 客戶主檔／價目表
  'openCusEdit','saveCusEdit','deleteCusEdit','cusSeedFromQuotes','applyCusSync','syncCustomerRecipe',
  /* 複檢 2026-08-13：quickAddOwnbrand／quickAddProduct／quickAddProductCustom 是「純前端把品項帶進表單」，
     不打任何 API。原本被藏起來，害一般使用者只能照著螢幕手打單價，反而更容易報錯價，所以移出名單。 */
  // 行事曆
  'openCalAdd','openCalEdit','saveCalItem','deleteCalItem','syncGCal','toggleTodoDone',
  // 今日待辦上的入口（點下去會開 owner-only 的編輯彈窗，儲存鈕被藏＝填半天存不進去）
  'tdOpenOrder','tdOpenCal',
  // 刪除類
  'deleteRecord','vmDelForm','vmDelReport'
];
const OWNER_FN_RE = new RegExp('\\b(' + OWNER_ONLY_FNS.join('|') + ')\\s*\\(');

let ROLE_SWEEP_T = null;
function roleSweep(){
  if(isOwner()) return;
  /* 複檢 2026-08-13：index.html 上「工作行事曆」「客戶管理」「管理客戶」標了 data-owner-only，
     但以前沒有任何程式讀這個屬性，等於完全沒擋（點進去會看到空白破版的月曆、或整份客戶主檔）。 */
  document.querySelectorAll('[data-owner-only]').forEach(function(el){
    if(el.dataset.roleHidden) return;
    el.dataset.roleHidden='1'; el.style.display='none';
  });
  document.querySelectorAll('[onclick]').forEach(function(el){
    if(el.dataset.roleHidden) return;
    var h = el.getAttribute('onclick') || '';
    if(!OWNER_FN_RE.test(h)) return;
    /* 複檢 2026-08-13：表格的資料列（tr/td）也帶 onclick（點列＝開編輯進度），原本整列被藏掉，
       造成月報表「明細一列都沒有、合計卻還顯示金額」，看起來像資料掉了。
       資料列本身只是唯讀內容，改成只拿掉點擊行為、不隱藏內容。 */
    if(el.tagName==='TR'||el.tagName==='TD'){
      el.dataset.roleHidden='1'; el.removeAttribute('onclick'); el.style.cursor='default'; return;
    }
    el.dataset.roleHidden='1'; el.style.display='none';
  });
}
function roleSweepSoon(){
  if(isOwner()) return;
  clearTimeout(ROLE_SWEEP_T);
  ROLE_SWEEP_T = setTimeout(roleSweep, 120);
}
function applyRoleUI(){
  document.body.classList.toggle('role-general', !isOwner());
  if(isOwner()) return;
  roleSweep();
  // 表格/彈窗都是後端資料回來才畫，所以要持續盯著新長出來的節點
  try{
    if(!window.__ROLE_OBS){
      window.__ROLE_OBS = new MutationObserver(roleSweepSoon);
      window.__ROLE_OBS.observe(document.body, {childList:true, subtree:true});
    }
  }catch(e){}
}
function setUser(role, name){
  USER_ROLE = (role === 'general') ? 'general' : 'owner';
  USER_NAME = name || '';
  try{
    sessionStorage.setItem('quote_role', USER_ROLE);
    sessionStorage.setItem('quote_name', USER_NAME);
  }catch(e){}
  applyRoleUI();
}
let editingQuoteNo = null;    // 若非 null 表示正在編輯既有報價單

/* ---- API 呼叫核心（GAS Web App 用 text/plain 避開 CORS preflight）---- */
const _busy={};   // 各儲存動作的「進行中」旗標，避免連點重複送出
async function apiCall(payload){
  const ctrl = new AbortController();
  const timer = setTimeout(()=>ctrl.abort(), 25000);   // 25 秒逾時，避免按鈕永久卡住
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
  } catch(err) {
    clearTimeout(timer);
    /* 複檢 2026-08-06 #21：寫入類請求拋錯時（GAS 冷啟動 >25 秒逾時、斷線）原本會直接 throw，
       跳過下面的 rcClear()。但後端很可能其實已經寫入成功——快取沒清的話，90 秒內進報價紀錄
       看不到剛存的單，使用者照提示「再試一次」就會存出重複單。結果未知時寧可清掉快取。 */
    if(!rcIsRead(payload && payload.action)) rcClear();
    if(err && err.name==='AbortError') throw new Error('連線逾時，請檢查網路後再試一次（後台可能已經存好了，請先重新整理列表確認，不要直接重存）');
    throw new Error('無法連線到後台，請確認網路後再試一次');
  }
  clearTimeout(timer);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch(e){
    if(!rcIsRead(payload && payload.action)) rcClear();   // 同上：回應壞掉也可能已經寫入成功
    throw new Error('無法連線到後台（伺服器回應異常），請稍後再試');
  }
  if(data.ok === false && data.error && data.error.indexOf('UNAUTHORIZED') === 0){
    // token 失效，回登入頁
    AUTH_TOKEN = null;
    sessionStorage.removeItem('quote_token');
    rememberClear();                                       // 記住我的通行證也失效了，一起清掉
    if(typeof tdCacheClear==='function') tdCacheClear();   // 今日待辦的離線快取一併清掉，別讓下一個人看到上一個人的資料
    rcClear();                                             // 讀取快取也整包清掉，同理
    showLogin();
    throw new Error('登入已過期，請重新登入');
  }
  // batch 的子回應也要攔 UNAUTHORIZED（batch 頂層 ok:true，會繞過上面的檢查；不攔的話頁面會把
  // 「token 無效」當一般錯誤印在表格裡，還會再平行打一輪注定失敗的個別請求才彈登入）
  if(payload && payload.action==='batch' && data && data.ok && Array.isArray(data.results)
     && data.results.some(d=>d && d.ok===false && d.error && String(d.error).indexOf('UNAUTHORIZED')===0)){
    AUTH_TOKEN = null;
    sessionStorage.removeItem('quote_token');
    rememberClear();
    if(typeof tdCacheClear==='function') tdCacheClear();
    rcClear();
    showLogin();
    throw new Error('登入已過期，請重新登入');
  }
  // 只要不是「純讀取」（存單／改進度／刪除／登入…），一律把讀取快取清掉，
  // 下一次進任何頁面都會拿到最新資料，不會出現「明明存好了卻還顯示舊的」。
  if(!rcIsRead(payload && payload.action)) rcClear();
  return data;
}

/* ---- 「在這台裝置記住我」------------------------------------------
   後端發的通行證本來就有 8 小時效期，只是原本存在 sessionStorage，
   分頁一關就沒了，所以每次回來都要重打 PIN（而登入這一趟就要 2.5 秒）。
   勾了才會改存 localStorage，8 小時內回到網站直接進去。
   ⚠ 這是使用者自己選的：勾了等於「這台裝置在 8 小時內免 PIN」，
     所以只在自己的電腦勾；側邊選單有「登出」可以隨時清掉。
   ------------------------------------------------------------------ */
const REMEMBER_KEY = 'qs_session_v1';
function rememberSave(token){
  try{ localStorage.setItem(REMEMBER_KEY, JSON.stringify({ t:token, exp:Date.now()+8*60*60*1000, r:USER_ROLE, n:USER_NAME })); }catch(e){}
}
function rememberClear(){ try{ localStorage.removeItem(REMEMBER_KEY); }catch(e){} }
function rememberRead(){
  try{
    const c = JSON.parse(localStorage.getItem(REMEMBER_KEY) || 'null');
    if(!c || !c.t || !c.exp || Date.now() >= c.exp){ rememberClear(); return null; }
    if(c.r) setUser(c.r, c.n);
    return c.t;
  }catch(e){ rememberClear(); return null; }
}
function doLogout(){
  AUTH_TOKEN = null;
  try{ sessionStorage.removeItem('quote_token'); sessionStorage.removeItem('quote_role'); sessionStorage.removeItem('quote_name'); }catch(e){}
  rememberClear();
  if(typeof tdCacheClear==='function') tdCacheClear();
  rcClear();
  location.reload();
}

/* ---- 登入 ---- */
/* v51：登入頁的使用者下拉。這支不需要通行證（登入前就要用），
   後端只回名字，不回密碼也不回角色。抓不到就留一個預設值，不擋登入。 */
async function loadLoginUsers(){
  const sel = document.getElementById('login-user');
  if(!sel) return;
  sel.innerHTML = '<option value="">載入中…</option>';
  try{
    const d = await apiCall({ action:'getLoginUsers' });
    const names = (d && d.ok && Array.isArray(d.users) && d.users.length) ? d.users : ['Molly'];
    sel.innerHTML = names.map(n=>'<option value="'+escAttr(n)+'">'+escHtml(n)+'</option>').join('');
    // 記住上次是誰登入的，下次直接選好
    try{
      const last = localStorage.getItem('qs_last_user');
      if(last && names.indexOf(last)>=0) sel.value = last;
    }catch(e){}
  }catch(e){
    sel.innerHTML = '<option value="">Molly</option>';
  }
}

async function doLogin(){
  const pin = document.getElementById('login-pin').value.trim();
  const userSel = document.getElementById('login-user');
  const who = userSel ? (userSel.value||'') : '';
  const errEl = document.getElementById('login-err');
  const btn = document.getElementById('login-btn');
  errEl.textContent = '';
  if(!pin){ errEl.textContent = '請輸入 PIN 碼'; return; }
  // 後端登入時會順便整理今天的待辦（v38），所以這一趟比單純驗 PIN 久一點，
  // 文字寫清楚在做什麼，才不會覺得卡住。
  btn.disabled = true; btn.textContent = '登入中…正在整理今天的待辦';
  try {
    const data = await apiCall({ action:'login', pin, name: who });
    if(data.ok && data.token){
      AUTH_TOKEN = data.token;
      sessionStorage.setItem('quote_token', data.token);
      setUser(data.role, data.name);          // v46 起後端登入會回角色；舊後端沒回就當老闆（維持原行為）
      try{ if(data.name) localStorage.setItem('qs_last_user', data.name); }catch(e){}
      const rem = document.getElementById('login-remember');
      if(rem && rem.checked) rememberSave(data.token); else rememberClear();
      hideLogin();
      toast('登入成功','ok');
      // v38：後端登入時就把今日待辦一起帶回來了，直接用，省掉第二趟 2.5 秒。
      // 舊後端沒有這個欄位也沒關係，loadToday() 會照舊自己去要。
      if(data.digest && data.digest.ok !== false && typeof tdSeed==='function') tdSeed(data.digest);
      initV2();
    } else {
      errEl.textContent = data.error || 'PIN 碼錯誤';
    }
  } catch(e){
    errEl.textContent = e.message || '連線失敗，請稍後再試';
  } finally {
    btn.disabled = false; btn.textContent = '登入';
  }
}
function showLogin(){ document.getElementById('login-overlay').style.display='flex'; }
function hideLogin(){
  document.getElementById('login-overlay').style.display='none';
  document.getElementById('login-pin').value='';
}

/* ---- toast ---- */
let toastTimer=null;
function toast(msg, type){
  const t=document.getElementById('toast');
  document.getElementById('toast-msg').textContent=msg;
  t.className='toast show'+(type==='ok'?' ok':type==='err'?' err':'');
  const ic=t.querySelector('i');
  ic.className = type==='err' ? 'ti ti-alert-triangle' : 'ti ti-check';
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{ t.className='toast'+(type==='ok'?' ok':type==='err'?' err':''); }, type==='err'?6000:3200);
}

/* ---- 頁面切換 ---- */
function gotoPage(p){
  currentPage=p;
  document.getElementById('page-new').classList.toggle('on', p==='new');
  document.getElementById('page-records').classList.toggle('on', p==='records');
  document.getElementById('page-custom').classList.toggle('on', p==='custom');
  document.getElementById('page-orders').classList.toggle('on', p==='orders');
  document.getElementById('page-cal').classList.toggle('on', p==='cal');
  { const e=document.getElementById('page-report'); if(e) e.classList.toggle('on', p==='report'); }
  { const e=document.getElementById('page-verify'); if(e) e.classList.toggle('on', p==='verify'); }
  { const e=document.getElementById('page-consign'); if(e) e.classList.toggle('on', p==='consign'); }
  { const e=document.getElementById('page-storage'); if(e) e.classList.toggle('on', p==='storage'); }   // 2026-08-28：客戶寄倉獨立頁
  { const e=document.getElementById('page-today'); if(e) e.classList.toggle('on', p==='today'); }
  { const e=document.getElementById('page-customer'); if(e) e.classList.toggle('on', p==='customer'); }
  document.getElementById('tbr-standard').style.display = (p==='custom'||p==='orders'||p==='report'||p==='cal'||p==='consign'||p==='storage'||p==='verify'||p==='today'||p==='customer') ? 'none' : 'flex';
  document.getElementById('tbr-custom').style.display = p==='custom' ? 'flex' : 'none';
  const _titles={today:['今日待辦','今天該做的事，一頁看完，點下去就能處理'],
    custom:['自訂報價單','自由建立非常規報價單，可儲存到後台備份，並直接匯出 PDF / Word'],
    orders:['訂單追蹤','報價 → 訂金 → 出貨 → 發票 → 尾款，一眼掌握每張單走到哪'],
    report:['月報表','對帳一眼看懂：已收訂金／已收尾款／還沒收的尾款，一頁掌握'],
    verify:['出貨驗收管理','驗收單留底、客戶掃碼回報處理、未回報催單，一頁掌握'],
    cal:['工作行事曆','訂單日程自動連動＋備忘與待辦，防止遺漏'],
    consign:['寄售管理','公版酒鋪貨・銷售・庫存・月結，一頁掌握'],
    storage:['客戶寄倉','客戶買斷後寄放我方倉庫的酒：登記入倉／提領，隨時看剩幾瓶'],
    customer:['客戶管理','每個客戶的聯絡資訊、往來報價單、訂單進度與未收款、驗收客訴，一頁看完']};
  document.getElementById('tb-title').textContent = _titles[p]?_titles[p][0]:'報價單製作';
  document.getElementById('tb-sub').textContent = _titles[p]?_titles[p][1]:'填寫後可即時預覽，並匯出 PDF / Word';
  document.querySelectorAll('.nb').forEach(b=>b.classList.remove('on'));
  const QUOTE_SUBPAGES=['new','custom','records'];
  document.getElementById('nav-quote').classList.toggle('parent-active', QUOTE_SUBPAGES.includes(p));
  if(QUOTE_SUBPAGES.includes(p)) setQuoteMenuOpen(true);
  if(p==='new'){ document.getElementById('nav-new').classList.add('on'); }
  if(p==='today'){ document.getElementById('nav-today').classList.add('on'); loadToday().catch(()=>{}); }
  if(p==='records'){ document.getElementById('nav-records').classList.add('on'); loadRecords(); }
  if(p==='orders'){ document.getElementById('nav-orders').classList.add('on'); loadOrders().catch(()=>{}); }
  if(p==='report'){
    document.getElementById('nav-report').classList.add('on');
    if(ORDERS_CACHE) renderReport();                       // 有現成資料就先畫，不用等後端
    /* 複檢 2026-08-11 #4：月報表一定要用完整清單。
       訂單追蹤平常只抓最近 300 張報價單（LIST_LIMIT）比較快，但月報表的
       「還沒收的尾款」是累計型數字，用裁切過的清單算會安靜地漏掉舊欠款，
       而且翻回幾個月前看數字會愈來愈小。進到這一頁就補抓完整的一次。 */
    const _needAll=(typeof ordSetLoadAll==='function')?ordSetLoadAll():false;
    loadOrders(_needAll).then(renderReport).catch(()=>{});
  }
  if(p==='verify'){ document.getElementById('nav-verify').classList.add('on'); loadVerifyMgmt().catch(()=>{}); }
  if(p==='cal'){ document.getElementById('nav-cal').classList.add('on'); loadCalendar().catch(()=>{}); }
  if(p==='consign'){ document.getElementById('nav-consign').classList.add('on'); initConsignPage().catch(()=>{}); }
  if(p==='storage'){ document.getElementById('nav-storage').classList.add('on'); loadStorage().catch(()=>{}); }
  if(p==='customer'){ document.getElementById('nav-customer').classList.add('on'); loadCustomers().catch(()=>{}); }
  if(p==='custom'){
    document.getElementById('nav-custom').classList.add('on');
    if(customItems.length===0){ addCustomRow(); }
    calcCustom();
  }
  closeMobileNav();
  runHooks('afterGotoPage', p);   // 各模組想在換頁後補做的事（例：客戶下拉補資料）
}

/* 側邊「報價單」原地展開子選單（新增／自訂／紀錄／預覽） */
function setQuoteMenuOpen(open){
  document.getElementById('qm-sub').classList.toggle('open', open);
  document.getElementById('qm-chev').classList.toggle('rot', open);
}
function toggleQuoteMenu(){
  setQuoteMenuOpen(!document.getElementById('qm-sub').classList.contains('open'));
}

/* ---- 手機版側邊選單開關 ---- */
function openMobileNav(){
  document.getElementById('sb').classList.add('open');
  document.getElementById('sb-backdrop').classList.add('open');
}
function closeMobileNav(){
  document.getElementById('sb').classList.remove('open');
  document.getElementById('sb-backdrop').classList.remove('open');
}
/* 視窗放大回桌機寬度時，關掉手機選單抽屜與遮罩，避免殘留 */
window.addEventListener('resize', ()=>{ if(window.innerWidth>860) closeMobileNav(); });

/* ---- 收集表單資料成 quote 物件 ---- */
function collectQuote(){
  const g=id=>document.getElementById(id);
  const val=id=>{const e=g(id);return e?e.value.trim():''};
  const num=id=>{const e=g(id);return e?(parseFloat(e.value)||0):0};

  const items=[];
  if(qType==='bottle'||qType==='ownbrand'||qType==='ownlabel'||qType==='consign'){
    botItems.forEach(rid=>{
      const row=document.getElementById(`r-${rid}`); if(!row) return;
      const name=gs(row,'name'); const sub=(gv(row,'price')+(colDed?gv(row,'ded'):0)+(colLogo?gv(row,'logo'):0))*gv(row,'qty');
      if(!name && !sub) return;
      const _marked=(row.querySelector('[data-f="mark"]')&&row.querySelector('[data-f="mark"]').checked)?'Y':'N';
      const _gift=(row.querySelector('[data-f="gift"]')&&row.querySelector('[data-f="gift"]').checked)?'Y':'N';
      let _lot=gs(row,'lot'); if(_lot.replace(/\s/g,'').toLowerCase()==='lot') _lot='';   // 未填數字的預填「Lot 」不存
      const _lpEl=row.querySelector('[data-f="lp"]'),_diEl=row.querySelector('[data-f="disc"]');
      /* 複檢 2026-08-11 #2：把「這一列是公司報價檔的哪個產品」（product_id）一起存下來。
         沒有它，舊單重新載入後就跟報價檔永久脫鉤——改瓶數不會換級距價（停在舊價＝多收或少收）、
         MOQ 未達提醒也不會出現，而且重選一次公司也救不回來（列上仍然沒有 pid）。
         借用 bottle 列從來沒用到的 flavorList 欄存放（比照 taglabel／banquet_free 的借欄約定），
         不動資料庫結構；後端正式文件的瓶裝表也不會印這一欄（只有宴會列會印）。 */
      items.push({ itemType:'bottle', name, lot:_lot, volume:gv(row,'vol'),
        unitPrice:gv(row,'price'), deduction:colDed?gv(row,'ded'):0, logoFee:colLogo?gv(row,'logo'):0,
        qty:gv(row,'qty'), unit:'瓶', subtotal:(_gift==='Y'?0:sub), flavorList:(row.dataset.pid||''),
        is_oem:(qType==='bottle'?_marked:'N'), is_label:(qType==='ownlabel'?'Y':'N'), noCharge:_gift,
        listPrice:(colOwn&&_lpEl?(parseFloat(_lpEl.value)||''):''), discount:(colOwn&&_diEl?_diEl.value.trim():'') });
    });
  } else {
    // banquet groups（unit 依計價方式存「杯」或「ml」；手動小計時 subtotal＝談好的整包價）
    const g1p=num('ban-g1-price'),g1q=num('ban-g1-qty'),g1sub=Math.round(banGroupSub('g1'));
    if(g1p||g1q||g1sub) items.push({ itemType:'banquet_group', name:'客製化調酒', lot:'', volume:'',
      unitPrice:g1p, deduction:0, logoFee:0, qty:g1q, unit:(banUnitOf('g1')==='ml'?'ml':'杯'), subtotal:g1sub, flavorList:flavors.g1.join('、') });
    const g2p=num('ban-g2-price'),g2q=num('ban-g2-qty'),g2sub=Math.round(banGroupSub('g2'));
    if(g2p||g2q||g2sub) items.push({ itemType:'banquet_group', name:'客製化無酒精雞尾酒', lot:'', volume:'',
      unitPrice:g2p, deduction:0, logoFee:0, qty:g2q, unit:(banUnitOf('g2')==='ml'?'ml':'杯'), subtotal:g2sub, flavorList:flavors.g2.join('、') });
    banFreeItems.forEach(rid=>{
      const row=document.getElementById(`bf-${rid}`); if(!row) return;
      const name=gs(row,'name'); const info=banFreeRowInfo(row); const sub=Math.round(info.sub);
      if(!name && !sub) return;
      // 免費列：subtotal 存 0（不計價），原金額借放 deduction 供載入／預覽還原劃線價；
      // 備註借放 flavorList 欄（後端品項表沒有備註欄，宴會自訂列原本不用此欄）
      items.push({ itemType:'banquet_free', name, lot:'', volume:'', unitPrice:gv(row,'price'),
        deduction:(info.free?sub:0), logoFee:0, qty:gv(row,'qty'), unit:gs(row,'unit'),
        subtotal:(info.free?0:sub), flavorList:gs(row,'note'), noCharge:(info.free?'Y':'N') });
    });
    banAddonItems.forEach(rid=>{
      const row=document.getElementById(`ba-${rid}`); if(!row) return;
      const name=gs(row,'name'); const sub=gv(row,'price')*gv(row,'qty');
      if(!name && !sub) return;
      items.push({ itemType:'banquet_addon', name, lot:'', volume:'', unitPrice:gv(row,'price'),
        deduction:0, logoFee:0, qty:gv(row,'qty'), unit:gs(row,'unit'), subtotal:sub, flavorList:'' });
    });
  }
  // bottle / 公版買斷 extras 也放進 items
  if(qType==='bottle'||qType==='ownbrand'||qType==='ownlabel'||qType==='consign'){
    extras.forEach(e=>{
      // 複檢 2026-08-06 #5：自動規則列（運費/扣標）的 auto 標記要一起存，
      // 否則載入舊單再重選公司時 applyAutoRules 認不得它，會再長出一列重複的運費。
      // 借用 extras 用不到的 unit 欄位存 auto key（'ship'/'label'），不動資料庫結構。
      items.push({ itemType:'extra', name:e.n, lot:'', volume:'', unitPrice:e.a,
        deduction:0, logoFee:0, qty:1, unit:e.auto||'', subtotal:e.a, flavorList:'' });
    });
  }
  // 免運優惠（顯示用、不計價）：以特殊品項存進 items_json，適用所有單型；金額放 deduction，unitPrice/subtotal=0 不影響總計
  { const _fs=parseFloat(document.getElementById('f-freeship')?.value)||0;
    if(_fs>0){ items.push({ itemType:'freeship', name:'免運優惠', lot:'', volume:'', unitPrice:0, deduction:_fs, logoFee:0, qty:1, unit:'', subtotal:0, flavorList:'' }); } }
  // 批次標籤（Lot/日期標記＋客戶名稱標籤）：後端主表沒有 tagLot/tagCli 欄位，直接存會被丟掉、重開就消失；
  // 比照免運優惠存成特殊品項列（品項後端全欄保存），Lot 標記放 lot 欄、客戶名稱標籤借放 flavorList 欄，載入時還原
  { const _tl=val('f-tag-lot'), _tc=val('f-tag-cli');
    if(_tl||_tc){ items.push({ itemType:'taglabel', name:'批次標籤', lot:_tl, volume:'', unitPrice:0, deduction:0, logoFee:0, qty:1, unit:'', subtotal:0, flavorList:_tc }); } }
  // 文件顯示設定（不顯示總計區／圖片大小）：2026-08-27 起存成 docopts 特殊列（flavorList 放 JSON），只在有非預設設定時才加
  { const _do=(typeof buildDocOptsItem==='function')?buildDocOptsItem():null; if(_do) items.push(_do); }

  const numFromText=id=>parseFloat((document.getElementById(id).textContent||'0').replace(/[$,]/g,''))||0;
  const svcMode=g('svc-mode')?g('svc-mode').value:'';
  const svcAmt1=parseFloat(document.getElementById('svc-amt1')?.value)||0;
  const svcAmt2=parseFloat(document.getElementById('svc-amt2')?.value)||0;
  const svcQty=parseFloat(document.getElementById('svc-qty')?.value)||1;
  let svcAmount=0;
  if(svcMode){
    svcAmount=(svcAmt1+(svcMode==='travel'?svcAmt2:0))*svcQty;
    // 服務費拆項：後端主表只存 svcMode/svcAmount，拆項（調酒師費/車馬費/人數）存成特殊列供重開還原
    // unitPrice=svcAmt1、deduction=svcAmt2（借欄）、qty=svcQty；subtotal=0 不影響金額
    items.push({ itemType:'svcdetail', name:'服務費拆項', lot:'', volume:'', unitPrice:svcAmt1, deduction:svcAmt2, logoFee:0, qty:svcQty, unit:'', subtotal:0, flavorList:'' });
  }

  return {
    quoteNo: editingQuoteNo || val('f-no'),
    quoteType: qType,
    clientName: val('f-cli'), contactName: val('f-con'), clientTaxId: val('f-tax'),
    invoiceTitle: val('f-inv'),
    contactPhone: val('f-ph'), clientAddress: val('f-ad'),
    shipContact: val('f-shipcon'), shipPhone: val('f-shipph'), shipAddress: val('f-shipad'),
    quoteDate: val('f-dt'), expiryDate: val('f-ex'), handler: val('f-hdl'),
    itemsSubtotal: numFromText('t-sub'), taxAmount: numFromText('t-tax'),
    extrasTotal: numFromText('t-ext'), grandTotal: numFromText('t-tot'),
    priceMode: taxMode, taxRate: num('taxrate'),
    paymentType: String(payTab), paymentDetail: getPayTerms(),
    remark: val('f-note'),
    images: imgs.filter(i=>i&&i.data).map(i=>({name:i.name||'圖片', mime:i.mime||'image/jpeg', data:i.data})), // B4：整組現有圖片以 base64 送後端；後端據此保存並回寫 imageLinks（不再送 imageLinks，避免清空後台已存連結）
    status: '草稿',
    venue: val('f-ven'), entryTime: val('f-ent'), serviceTime: val('f-svc'), exitTime: val('f-ext'),
    svcMode: svcMode, svcAmount: svcAmount,
    svcAmt1: svcAmt1, svcAmt2: svcAmt2, svcQty: svcQty,
    tagLot: val('f-tag-lot'), tagCli: val('f-tag-cli'),
    expectedShipDate: val('f-shipdate'), showShipDate: (document.getElementById('f-shipdate-show')?.checked ? 'Y' : 'N'),
    items
  };
}

/* ---- 儲存（新增 or 更新）---- */
/* 判斷標準報價單是否至少有一筆品項（含瓶裝列／宴會自訂列／宴會加購列／宴會兩組數量）*/
function quoteHasItems(){
  // 排除 checkbox（其 .value 恆為 'on'，會把空列誤判成有內容）
  // 排除 checkbox（.value 恆為 'on'）與批次欄的預填字「Lot 」（新空列自動塞的，不算有內容）
  const check=(ids,pfx)=>ids.some(id=>{ const r=document.getElementById(pfx+'-'+id); return r&&Array.from(r.querySelectorAll('[data-f]')).some(i=>{ if(i.type==='checkbox') return false; const v=(i.value||'').trim(); if(!v) return false; if(i.dataset.f==='lot'&&v==='Lot') return false; return true; }); });
  if(check(botItems,'r')) return true;
  if(check(banFreeItems,'bf')) return true;
  if(check(banAddonItems,'ba')) return true;
  if((parseFloat(document.getElementById('ban-g1-qty')?.value)||0)||(parseFloat(document.getElementById('ban-g2-qty')?.value)||0)) return true;
  return false;
}
async function saveQuote(){
  if(!AUTH_TOKEN){ showLogin(); return; }
  // 擋空白單：客戶名稱空白且完全沒有品項時不儲存，避免存出一堆空單
  const cliName=(document.getElementById('f-cli')?.value||'').trim();
  if(!cliName && !quoteHasItems()){ toast('請至少填寫客戶名稱或一筆品項再儲存','err'); return; }
  const quote=collectQuote();
  const wasNewQuote=!editingQuoteNo;   // 2026-08-12：存檔前先記住是不是新單，決定要不要順便建訂單追蹤進度
  const btn=document.getElementById('btn-save');
  if(btn){ btn.disabled=true; btn.innerHTML='<i class="ti ti-loader"></i>儲存中…'; }
  try {
    let data;
    if(editingQuoteNo){
      data=await apiCall({ action:'updateQuote', token:AUTH_TOKEN, quoteNo:editingQuoteNo, quote });
    } else {
      data=await apiCall({ action:'createQuote', token:AUTH_TOKEN, quote });
    }
    if(data.ok){
      editingQuoteNo=data.quoteNo;
      /* 複檢 2026-08-06 #10：後端會自己發號（會同時掃標準單與自訂單），前端 autoNextSerial
         只掃標準單，同一天先存過自訂單時兩邊會不一樣。存檔後必須把後端實際發的單號寫回
         畫面，否則接著用瀏覽器列印/匯出 PDF，客戶拿到的單號跟資料庫（訂單追蹤、驗收單
         都以單號為鍵）對不上。 */
      if(data.quoteNo){
        const _fn=document.getElementById('f-no'); if(_fn) _fn.value=data.quoteNo;
        const _pn=document.getElementById('pl-no'); if(_pn) _pn.textContent=data.quoteNo;
        const _m=String(data.quoteNo).match(/-(\d+)\s*$/);
        if(_m){ const _s=document.getElementById('f-ser'); if(_s) _s.value=parseInt(_m[1],10)||1; }
      }
      FORM_DIRTY=false;
      quote.quoteNo=data.quoteNo;   // collectQuote() 存的是存檔前的猜測值，這裡校正成後端實際發的單號
      toast('已儲存：'+data.quoteNo,'ok');
      if(wasNewQuote && typeof updateOrdProgVisibility==='function') updateOrdProgVisibility();
      if(wasNewQuote) await maybeCreateOrderProgressOnSave(data.quoteNo, quote);
      else await maybeSyncOrderProgressOnEdit(data.quoteNo, quote);
      runHooks('afterSaveQuote', quote);   // 客戶主檔比對提醒登記在 11_customers.js
    } else {
      toast(data.error||'儲存失敗','err');
    }
  } catch(e){
    toast(e.message||'儲存失敗','err');
  } finally {
    if(btn){ btn.disabled=false; btn.innerHTML='<i class="ti ti-device-floppy"></i>儲存'; }
  }
}
/* 2026-08-12：「訂單追蹤進度」併入報價單表單本身（index.html #ordprog-block），存檔成功後
   （只有「新增」，不含編輯既有單——見 saveQuote 的 wasNewQuote）直接呼叫既有的
   updateOrderStatus 建一筆進度，不用另外再跑一趟「訂單追蹤」→「編輯進度」。
   三格（訂金日期／客戶批號／備註）都留空就完全不呼叫——維持「沒編輯進度就不建列」的原本行為，
   不會平白多出一堆空的訂單追蹤紀錄。訂金／尾款金額算法跟 05_orders.js 的 openOrdEdit 自動帶入
   完全同一套（ordPayFromQuote 優先讀報價單條款上的實際金額，讀不出來才退回客戶主檔的訂金比例）。 */
async function maybeCreateOrderProgressOnSave(quoteNo, quote){
  const depDate=(document.getElementById('f-ord-depdate')?.value||'').trim();
  const lot=(document.getElementById('f-ord-lot')?.value||'').trim();
  const note=(document.getElementById('f-ord-note')?.value||'').trim();
  if(!depDate && !lot && !note) return;
  const gt=Math.round(parseFloat(quote.grandTotal)||0);
  const fields={};
  if(gt>0) fields.grand_total=gt;
  if(lot) fields.cust_lot=lot;
  if(note) fields.track_note=note;
  let _amtUnknown=false;
  if(depDate){
    fields.deposit_date=depDate;
    if(gt>0){
      /* 複檢 2026-08-13 #1-1：這裡是「不經人眼、直接寫進資料庫」的路徑，讀不出金額就不要猜。
         原本付款條件選「自訂」或「不顯示此欄位」時會靜默寫入「總額各半」，那兩個數字報價單上
         根本不存在、畫面上也從沒出現過，卻會流進月報表的已收訂金、今日待辦的尾款金額、
         客戶頁的未收款。改成：只有從報價單條款上真的讀得到金額才寫，讀不到就留空並明講。 */
      const fromQuote=(typeof ordPayFromQuote==='function')?ordPayFromQuote({payDetail:quote.paymentDetail}, gt):null;
      if(fromQuote){ fields.deposit_amt=fromQuote.dep; fields.final_amt=fromQuote.bal; }
      else _amtUnknown=true;
    }
  }
  if(typeof effOrdStatus==='function'){
    const eff=effOrdStatus(fields);
    if(eff) fields.status=eff;
  }
  try{
    const d=await apiCall({ action:'updateOrderStatus', token:AUTH_TOKEN, quote_no:quoteNo, fields });
    if(d&&d.ok){
      if(_amtUnknown) toast('已建立訂單追蹤進度。⚠ 這張單的付款條件讀不出訂金／尾款金額，兩欄先留空（不亂猜），請到「訂單追蹤」自行填寫','err');
      else toast('已同時建立訂單追蹤進度','ok');
    }
    else toast('報價單已存，但訂單追蹤進度建立失敗：'+((d&&d.error)||'請到「訂單追蹤」手動補上'),'err');
  }catch(e){ toast('報價單已存，但訂單追蹤進度建立失敗，請到「訂單追蹤」手動補上','err'); }
}
/* 2026-08-12（Molly 追加需求）：編輯既有報價單、金額有改的話，要「聯動更新」訂單追蹤裡的資料，
   不用改完報價單又跑一趟訂單追蹤手動對金額。規則（Molly 選的，避免蓋掉已經實際收款的金額）：
   - 這張單從沒建過訂單追蹤進度（getOrderStatusList 查不到這個 quote_no）→ 不主動建立，維持
     「當初報價單存檔時三格留空＝不追蹤這張單」的選擇；純編輯金額不會平白生出訂單追蹤紀錄。
   - 已經建過、但還沒開始收訂金（deposit_date 空）→ 視為「沒有進度」，總額＋訂金／尾款
     一起用最新金額重新算好（跟 maybeCreateOrderProgressOnSave 同一套算法）。
   - 已經有進度（deposit_date 有填，代表可能已經實際收了訂金）→ 只更新 grand_total 這個
     「總額參考」欄位，訂金／尾款金額完全不動，避免把已經收到的實際金額覆蓋掉；要調整
     還是得手動去「訂單追蹤」改。updateOrderStatus 後端是逐欄位覆蓋（沒送的欄位不會被動到），
     所以這裡只要不把 deposit_amt/final_amt 放進 fields 就不會被改。
   - 金額其實沒變就不打後端（用快取 getOrderStatusList 比對，省一次呼叫）。 */
async function maybeSyncOrderProgressOnEdit(quoteNo, quote){
  const gt=Math.round(parseFloat(quote.grandTotal)||0);
  if(gt<=0 || typeof readCall!=='function') return;
  try{
    const d=await readCall({ action:'getOrderStatusList', token:AUTH_TOKEN });
    const list=(d&&d.orders)||[];
    const st=list.find(o=>o.quote_no===quoteNo);
    if(!st) return;   // 從沒連結過訂單追蹤，編輯報價單不會主動建立
    if(gt===Math.round(parseFloat(st.grand_total)||0)) return;   // 金額沒變，不用同步
    const hasProgress=String(st.deposit_date||'').trim()!=='';
    const fields={ grand_total: gt };
    let _amtUnknown=false;
    if(!hasProgress){
      // 複檢 2026-08-13 #1-1：同上，讀不出來就不要猜著寫進資料庫
      const fromQuote=(typeof ordPayFromQuote==='function')?ordPayFromQuote({payDetail:quote.paymentDetail}, gt):null;
      if(fromQuote){ fields.deposit_amt=fromQuote.dep; fields.final_amt=fromQuote.bal; }
      else _amtUnknown=true;
    }
    const r=await apiCall({ action:'updateOrderStatus', token:AUTH_TOKEN, quote_no:quoteNo, fields });
    if(r&&r.ok){
      if(hasProgress) toast('金額已修改，訂單追蹤總額已同步（訂金/尾款已有進度，未變動）','ok');
      else if(_amtUnknown) toast('金額已修改，訂單追蹤總額已同步。⚠ 付款條件讀不出訂金／尾款金額，那兩欄沒有動，請到「訂單追蹤」確認','err');
      else toast('金額已修改，訂單追蹤的訂金/尾款也一起重新算好了','ok');
    }
    /* 複檢 2026-08-13 #1-5：原本失敗完全靜默。一般使用者（阿軒／Vic）沒有 updateOrderStatus 權限，
       每次改金額都會失敗、而且完全沒有提示，Molly 看到的訂單總額會一直停在舊值。改成明確提示。 */
    else toast('⚠ 報價單已存，但訂單追蹤的總額沒有同步到：'+((r&&r.error)||'請到「訂單追蹤」手動更新總額'),'err');
  }catch(e){ toast('⚠ 報價單已存，但訂單追蹤的總額沒有同步到，請到「訂單追蹤」手動更新總額','err'); }
}

/* ---- 產生正式 PDF/Word 文件（GAS 動態建立 Google Doc）----
   v31：改為先開視窗選「保留舊版（預設）／覆蓋舊版」，並可查歷史版本（listQuotePdfs） */
function generateOfficialDocument(){
  if(!AUTH_TOKEN){ showLogin(); return; }
  if(!editingQuoteNo){
    toast('請先「儲存」報價單後再產生正式文件','err');
    return;
  }
  /* 複檢 2026-08-06 #11：正式文件是後端拿「資料庫裡已存的資料」產的，畫面上改了沒存
     就按下去，會拿到改之前的舊金額而且完全沒有提示。這裡先擋一下。 */
  if(typeof FORM_DIRTY!=='undefined' && FORM_DIRTY && currentPage==='new'){
    if(!confirm('這張單有修改還沒儲存。\n\n正式文件是依「後台已儲存的資料」產生的，現在產出來會是修改前的版本。\n\n建議先按「儲存」再產生。仍要繼續嗎？')) return;
  }
  document.getElementById('gd-title').textContent='產生正式文件 — '+editingQuoteNo;
  const keep=document.querySelector('input[name="gd-ow"][value="keep"]'); if(keep) keep.checked=true;
  document.getElementById('gd-overlay').style.display='flex';
  loadGendocHistory();
}
function closeGendoc(){ document.getElementById('gd-overlay').style.display='none'; }
function gdFmtDt(s){
  if(!s) return '';
  const str=String(s);
  const d=new Date(str);
  if(isNaN(d)) return str.slice(0,16);
  const tpe=new Date(d.getTime()+8*60*60*1000);           // 以台北時間顯示（同 vmLocalYmd 作法）
  return tpe.toISOString().slice(0,16).replace('T',' ');
}
async function loadGendocHistory(){
  const box=document.getElementById('gd-history');
  box.innerHTML=sklBlock(4);
  try{
    const d=await apiCall({ action:'listQuotePdfs', token:AUTH_TOKEN, quote_no:editingQuoteNo });
    if(!d.ok){ box.innerHTML=`<div class="rec-empty">${d.error||'載入失敗'}</div>`; return; }
    const list=(d.versions||d.pdfs||d.list||[]).slice();
    if(!list.length){ box.innerHTML='<div class="rec-empty">這張單還沒產生過正式文件</div>'; return; }
    list.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
    box.innerHTML=list.map(v=>{
      const inactive=(v.active===false||v.active===0||String(v.active).toUpperCase()==='FALSE');
      return `<div style="display:flex;gap:8px;align-items:center;padding:7px 4px;border-bottom:1px solid #E8E5DD;${inactive?'opacity:.55':''}">
        <span style="white-space:nowrap;color:var(--sub)">${escHtml(gdFmtDt(v.created_at))}</span>
        <span style="flex:1;word-break:break-all">${escHtml(v.file_name||'')}${inactive?' <span class="ob grey">已作廢</span>':''}</span>
        ${v.pdf_url?`<a class="rec-act-btn" href="${escHtml(v.pdf_url)}" target="_blank" rel="noopener">PDF</a>`:''}
        ${v.doc_url?`<a class="rec-act-btn" href="${escHtml(v.doc_url)}" target="_blank" rel="noopener">Doc</a>`:''}
      </div>`;
    }).join('');
  }catch(e){ box.innerHTML=`<div class="rec-empty">${e.message||'載入失敗'}</div>`; }
}
async function gendocRun(){
  if(_busy.gendoc) return; _busy.gendoc=true;
  const ow=((document.querySelector('input[name="gd-ow"]:checked')||{}).value==='over');
  const btn=document.getElementById('gd-run');
  if(btn){ btn.disabled=true; btn.innerHTML='<i class="ti ti-loader"></i>產生中…'; }
  try {
    const data=await apiCall({ action:'generateQuoteDocument', token:AUTH_TOKEN, quoteNo:editingQuoteNo, overwrite:ow });
    if(!data.ok){ toast(data.error||'產生失敗','err'); return; }
    downloadBase64_(data.pdfBase64, 'application/pdf', data.fileNameBase+'.pdf');
    downloadBase64_(data.docxBase64, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data.fileNameBase+'.docx');
    toast(ow?'已產生新版並開始下載（舊版已丟垃圾桶）':'已產生新版並開始下載（舊版保留）','ok');
    loadGendocHistory();
  } catch(e){
    toast(e.message||'產生失敗','err');
  } finally {
    if(btn){ btn.disabled=false; btn.innerHTML='<i class="ti ti-file-text"></i>產生並下載'; }
    _busy.gendoc=false;
  }
}

function downloadBase64_(base64, mime, filename){
  if(!base64) return;
  const byteChars=atob(base64);
  const byteNumbers=new Array(byteChars.length);
  for(let i=0;i<byteChars.length;i++) byteNumbers[i]=byteChars.charCodeAt(i);
  const byteArray=new Uint8Array(byteNumbers);
  const blob=new Blob([byteArray],{type:mime});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=filename;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
}
/* ---- 載入報價記錄列表 ---- */
/* 報價紀錄
   ・清單只跟後端要「全部類型」一次（快取共用給訂單追蹤／今日待辦），
     類型與關鍵字都改成前端篩，所以打字搜尋、換類型都是 0 秒。
   ・有快取先秒開舊資料，背景再更新（loadRecords(true)＝強制重抓）。 */
let REC_QUOTES = null;
let REC_CUSTOM = null;   // 自訂報價單備份（listCustomQuotes）——2026-07-31 起一併列進報價紀錄
function recPayload(){ return withLimit({ action:'getQuotes', token:AUTH_TOKEN, filters:{} }); }
function recCustomPayload(){ return { action:'listCustomQuotes', token:AUTH_TOKEN }; }
async function loadRecords(force){
  const body=document.getElementById('rec-body');
  const P=recPayload(), PC=recCustomPayload();
  const hit=rcPeek(P), hitC=rcPeek(PC);
  if(hitC && hitC.data && hitC.data.ok!==false) REC_CUSTOM=hitC.data.quotes||[];
  if(hit && hit.data && !force){ REC_QUOTES=hit.data.quotes||[]; renderRecords(); }
  else body.innerHTML=sklTableRows(6,5);
  if(!force && rcFresh(P) && rcFresh(PC)) return;         // 90 秒內剛抓過就不重打
  try {
    const [data,dataC]=await readCallMany([P,PC], force);
    if(!data || !data.ok){
      if(!hit) body.innerHTML=`<tr><td colspan="6" class="rec-empty">${(data&&data.error)||'載入失敗'}</td></tr>`;
      return;
    }
    REC_QUOTES=data.quotes||[];
    if(dataC && dataC.ok) REC_CUSTOM=dataC.quotes||[];
    window._CQ_CACHE=REC_CUSTOM||[];   // 讓「開啟自訂單」直接用，不用再打一次後端
    renderRecords();
  } catch(e){
    if(!hit) body.innerHTML=`<tr><td colspan="6" class="rec-empty">${e.message||'載入失敗'}</td></tr>`;
  }
}
function renderRecords(){
  const body=document.getElementById('rec-body');
  if(!body || REC_QUOTES==null) return;
  {
    const kwEl=document.getElementById('rec-search'), tfEl=document.getElementById('rec-type-filter');
    const kw=kwEl?kwEl.value.trim():''; const tf=tfEl?tfEl.value:'';
    let quotes=REC_QUOTES.filter(q=>q.status!=='已刪除');
    // 自訂報價單備份也一併列入（正規化成同一種列格式，quoteType='custom'）
    const customs=(REC_CUSTOM||[]).map(c=>({ _custom:true, quoteNo:c.quote_no, clientName:c.client,
      quoteType:'custom', quoteDate:String(c.quote_date||'').slice(0,10),
      grandTotal:(parseJsonSafe(c.totals_json,{}).total)||0 }));
    let merged=(tf==='custom')?customs.slice():(tf?quotes.filter(q=>q.quoteType===tf):quotes.concat(customs));
    if(kw){ const k=kw.toLowerCase(); merged=merged.filter(q=> String(q.clientName||'').toLowerCase().includes(k) || String(q.quoteNo||'').toLowerCase().includes(k)); }
    // 單號皆為 YYYYMMDD-NN 格式，直接以單號新→舊排序（自訂單與標準單自然交錯）
    merged.sort((a,b)=>String(b.quoteNo||'').localeCompare(String(a.quoteNo||'')));
    if(merged.length===0){ body.innerHTML='<tr><td colspan="7" class="rec-empty">'+((REC_QUOTES.length||customs.length)?'沒有符合條件的報價單':'尚無報價單記錄')+'</td></tr>'; return; }
    body.innerHTML=merged.map(q=>{
      const typeBadge=q.quoteType==='bottle'
        ? '<span class="rec-badge bottle">瓶裝酒代工</span>'
        : q.quoteType==='ownbrand'
        ? '<span class="rec-badge ownbrand">公版酒買斷</span>'
        : q.quoteType==='ownlabel'
        ? '<span class="rec-badge ownbrand">公版酒客製標</span>'
        : q.quoteType==='consign'
        ? '<span class="rec-badge consign">寄售月結</span>'
        : q.quoteType==='custom'
        ? '<span class="rec-badge custom">自訂報價單</span>'
        : '<span class="rec-badge banquet">宴會酒水</span>';
      const total='$'+Math.round(q.grandTotal||0).toLocaleString();
      if(q._custom){
        // 自訂單：開啟／預覽走自訂報價單頁；後端沒有刪除自訂單的 action，不提供刪除
        return `<tr class="clickable" onclick="recOpenCustom('${escAttr(q.quoteNo)}')">
          <td class="mc-main" style="font-weight:600">${escHtml(q.quoteNo||'—')}</td>
          <td data-l="客戶">${escHtml(q.clientName||'—')}</td>
          <td data-l="類型">${typeBadge}</td>
          <td data-l="報價日">${escHtml(q.quoteDate||'—')}</td>
          <td data-l="總計" style="font-weight:600">${total}</td>
          <td data-l="建立者">—</td>
          <td class="rec-actions" data-l="操作" onclick="event.stopPropagation()">
            <button class="rec-act-btn primary" onclick="recOpenCustom('${escAttr(q.quoteNo)}')">開啟</button>
            <button class="rec-act-btn" onclick="recPreviewCustom('${escAttr(q.quoteNo)}')">預覽</button>
          </td>
        </tr>`;
      }
      return `<tr class="clickable" onclick="openRecord('${escAttr(q.quoteNo)}')">
        <td class="mc-main" style="font-weight:600">${escHtml(q.quoteNo||'—')}</td>
        <td data-l="客戶">${escHtml(q.clientName||'—')}</td>
        <td data-l="類型">${typeBadge}</td>
        <td data-l="報價日">${escHtml(q.quoteDate||'—')}</td>
        <td data-l="總計" style="font-weight:600">${total}</td>
        <td data-l="建立者">${escHtml(q.createdBy||'—')}</td>
        <td class="rec-actions" data-l="操作" onclick="event.stopPropagation()">
          <button class="rec-act-btn primary" onclick="openRecord('${escAttr(q.quoteNo)}')">開啟</button>
          <button class="rec-act-btn" onclick="previewRecordQuote('${escAttr(q.quoteNo)}')">預覽</button>
          ${['bottle','ownbrand','ownlabel','consign'].includes(q.quoteType)?`<button class="rec-act-btn" onclick="openVerifyForm('${escAttr(q.quoteNo)}')">驗收單</button>`:''}
          <button class="rec-act-btn del" onclick="deleteRecord('${escAttr(q.quoteNo)}','${escAttr((q.clientName||'').replace(/'/g,''))}')">刪除</button>
        </td>
      </tr>`;
    }).join('') + (listMaybeMore(REC_QUOTES.length) ? moreRowHtml(6) : '');
  }
}

/* ---- 開啟既有報價單（載入到編輯表單）---- */
async function openRecord(quoteNo){
  if(isFormDirty() && !confirm('目前表單尚有未儲存的資料，開啟這張單會覆蓋目前內容，確定放棄？')) return;
  try {
    const data=await readCall({ action:'getQuoteById', token:AUTH_TOKEN, quoteNo });
    if(!data.ok){ toast(data.error||'讀取失敗','err'); return; }
    loadQuoteIntoForm(data.quote);
    gotoPage('new');
    toast('已載入 '+quoteNo,'ok');
  } catch(e){ toast(e.message||'讀取失敗','err'); }
}

/* ---- 預覽既有報價單（載入到表單後直接開預覽視窗，不用再手動點側邊「預覽報價單」）---- */
async function previewRecordQuote(quoteNo){
  if(isFormDirty() && !confirm('目前表單尚有未儲存的資料，預覽這張單會覆蓋目前內容，確定繼續？')) return;
  try {
    toast('讀取訂單資料…','ok');
    const data=await readCall({ action:'getQuoteById', token:AUTH_TOKEN, quoteNo });
    if(!data.ok){ toast(data.error||'讀取失敗','err'); return; }
    loadQuoteIntoForm(data.quote);
    gotoPage('new');
    openPreview();
  } catch(e){ toast(e.message||'讀取失敗','err'); }
}

/* ---- 刪除報價單 ---- */
async function deleteRecord(quoteNo, cliName){
  if(!confirm(`確定刪除報價單 ${quoteNo}（${cliName}）？\n此動作會將其標記為已刪除。`)) return;
  try {
    const data=await apiCall({ action:'deleteQuote', token:AUTH_TOKEN, quoteNo });
    if(data.ok){ toast('已刪除 '+quoteNo,'ok'); loadRecords(); }
    else toast(data.error||'刪除失敗','err');
  } catch(e){ toast(e.message||'刪除失敗','err'); }
}

/* ---- 把 quote 物件灌回表單 ---- */
function loadQuoteIntoForm(q){
  editingQuoteNo=q.quoteNo;
  if(typeof updateOrdProgVisibility==='function') updateOrdProgVisibility();   // 編輯既有單：隱藏「訂單追蹤進度」區塊，不去動已存的進度資料
  /* 複檢 2026-08-06 #2：凍結狀態必須在載入流程「最前面」清掉。
     下面的 setType/setTaxMode/onSvcModeChange 都會觸發 calc()，若上一張單的
     LOADED_PAY_DETAIL/SIG 還掛著，指紋比對會誤判「金額有異動」——
     誤跳提示不說，還會把上一張單的比例/天數解析進這張單的付款欄位。 */
  LOADED_PAY_DETAIL=null; LOADED_PAY_SIG=null;
  // 載入舊單前先清掉「已選公司」狀態，避免殘留規則污染這張單的金額
  SELECTED_COMPANY=null; RULE_SUPPRESS={};
  { const csel=document.getElementById('qf-company'); if(csel) csel.value=''; }
  { const box=document.getElementById('qf-detail'); if(box) box.style.display='none'; }
  const set=(id,v)=>{const e=document.getElementById(id);if(e)e.value=v||''};
  setType(q.quoteType||'bottle');
  // 服務費殘留清除：先清空，宴會分支若有存 svcMode 再還原——否則上一張單的服務費會混進這張的總計
  set('svc-mode',''); set('svc-amt1',''); set('svc-amt2',''); set('svc-qty','');
  if(typeof onSvcModeChange==='function') onSvcModeChange();
  set('f-cli',q.clientName); set('f-con',q.contactName); set('f-tax',q.clientTaxId);
  set('f-inv',q.invoiceTitle);
  set('f-ph',q.contactPhone); set('f-ad',q.clientAddress);
  set('f-shipcon',q.shipContact); set('f-shipph',q.shipPhone); set('f-shipad',q.shipAddress);
  { const same=!(q.shipAddress||q.shipContact||q.shipPhone);
    const chk=document.getElementById('f-shipsame'); if(chk) chk.checked=same;
    toggleShipSame('f'); }
  // 批次標籤：後端主表沒存 tagLot/tagCli，從 taglabel 特殊列還原；物件本身有值（本地往返/測試）優先用
  { const _tg=(q.items||[]).find(it=>it.itemType==='taglabel')||{};
    set('f-tag-lot', q.tagLot||_tg.lot); set('f-tag-cli', q.tagCli||_tg.flavorList); }
  set('f-dt',q.quoteDate); set('f-hdl',q.handler);
  set('f-ven',q.venue); set('f-ent',q.entryTime); set('f-svc',q.serviceTime); set('f-ext',q.exitTime);
  set('f-note',q.remark);
  // B4：由後端回傳的 images（base64）還原附加圖片；相容舊資料（無 images 即清空）
  imgs=(Array.isArray(q.images)?q.images:[]).filter(i=>i&&i.data).map(i=>({name:i.name||'圖片', mime:i.mime||'image/jpeg', data:i.data, url:'data:'+(i.mime||'image/jpeg')+';base64,'+i.data}));
  renderImgs();
  if(typeof applyDocOpts==='function') applyDocOpts(q); // 不顯示總計區／圖片大小（docopts 特殊列）
  // 免運優惠：從 items 的 freeship 特殊列還原（所有單型共用）
  { const _fs=(q.items||[]).find(it=>it.itemType==='freeship'); const fe=document.getElementById('f-freeship'); if(fe) fe.value=_fs?((+_fs.deduction||+_fs.unitPrice||'')||''):''; }
  { const sd=document.getElementById('f-shipdate'); if(sd) sd.value=q.expectedShipDate||''; }
  { const ss=document.getElementById('f-shipdate-show'); if(ss) ss.checked=(q.showShipDate!=='N'); } // 預設顯示；後端尚未存此欄前一律視為顯示
  { const _tr=document.getElementById('taxrate'); if(_tr) _tr.value=((q.taxRate==null||q.taxRate==='')?5:q.taxRate); } // 稅率填 0（免稅）要保留 0，不能被 ||5 改回 5%；舊單空白（''）視為預設 5%，不能變 0%
  // 先把流水號從單號尾碼還原，onDate() 會用它重算單號，避免顯示/PDF 變成 -01
  if(q.quoteNo){ const m=String(q.quoteNo).match(/-(\d+)\s*$/); if(m){ const s=document.getElementById('f-ser'); if(s) s.value=parseInt(m[1],10)||1; } }
  setTaxMode(q.priceMode||'inc');
  onDate();
  // onDate()→upNo() 會依日期+流水號重組單號；強制還原成原本存的單號，確保與後台/客戶文件一致
  if(q.quoteNo){ document.getElementById('f-no').value=q.quoteNo; document.getElementById('pl-no').textContent=q.quoteNo; }
  const items=q.items||[];
  if(q.quoteType==='bottle'||q.quoteType==='ownbrand'||q.quoteType==='ownlabel'||q.quoteType==='consign'){
    /* 複檢 2026-08-13 #3-2：反方向也要清。宴會分支已經會清瓶裝的殘留（複檢 #9），但瓶裝分支沒清宴會的——
       開完一張宴會單再開一張瓶裝單、然後把單型改成「宴會酒水」，上一張宴會單的調酒組金額、
       免費列、加購列會整批冒出來並計進總計，直接存檔就把別張單的品項寫進這張。 */
    ['g1','g2'].forEach(g=>{
      set(`ban-${g}-price`,''); set(`ban-${g}-qty`,'');
      const _us=document.getElementById(`ban-${g}-unit`); if(_us) _us.value='cup';
      const _m=document.getElementById(`ban-${g}-man`); if(_m) _m.checked=false;
      const _s=document.getElementById(`ban-${g}-subman`); if(_s){ _s.value=''; _s.style.display='none'; }
    });
    { const _fb=document.getElementById('ban-free-body'); if(_fb) _fb.innerHTML=''; }
    { const _ab=document.getElementById('ban-addon-body'); if(_ab) _ab.innerHTML=''; }
    try{ banFreeItems=[]; banAddonItems=[]; flavors={g1:[],g2:[]}; }catch(_){}
    document.getElementById('itbody-bot').innerHTML=''; botItems=[];
    extras=[];
    const realItems = items.filter(it=>it.itemType!=='extra'&&it.itemType!=='freeship'&&it.itemType!=='taglabel'&&it.itemType!=='svcdetail'&&it.itemType!=='docopts');
    // 贈品／不計價 還原：後端有明確存 noCharge（Y/N）就以它為準；沒存（舊資料空白）才用「有單價有瓶數但小計為0」推斷
    const isGiftItem = it => { const nc=String(it.noCharge||'').toUpperCase(); if(nc==='Y') return true; if(nc==='N') return false;
      return (parseFloat(it.unitPrice)>0 && parseFloat(it.qty)>0 && !(parseFloat(it.subtotal)>0)); };
    colLot = realItems.some(it=>it.lot);
    colDed = realItems.some(it=>it.deduction);
    colLogo = realItems.some(it=>it.logoFee);
    colGift = realItems.some(isGiftItem);
    colMark = false;
    colOwn = (q.quoteType==='ownbrand'||q.quoteType==='ownlabel');
    document.getElementById('ctg-lot').classList.toggle('on',colLot);
    document.getElementById('ctg-ded').classList.toggle('on',colDed);
    document.getElementById('ctg-logo').classList.toggle('on',colLogo);
    rebuildBotHeader();
    items.forEach(it=>{
      if(it.itemType==='extra'){
        const _auto=(it.unit==='ship'||it.unit==='label')?it.unit:null;   // 複檢 #5：還原自動規則標記
        const _e={id:`ext${++_extSeq}`,n:it.name,a:it.unitPrice||it.subtotal||0};
        if(_auto) _e.auto=_auto;
        extras.push(_e);
      }
      else if(it.itemType==='freeship'){ /* 免運優惠已於上方共用區還原到 f-freeship，不建品項列 */ }
      else if(it.itemType==='taglabel'){ /* 批次標籤已於上方共用區還原到 f-tag-lot / f-tag-cli，不建品項列 */ }
      else if(it.itemType==='svcdetail'){ /* 服務費拆項＝宴會用特殊列，瓶裝型不會有；防呆跳過不建品項列 */ }
      else if(it.itemType==='docopts'){ /* 文件顯示設定已於上方 applyDocOpts 還原，不建品項列 */ }
      /* 複檢 2026-08-11 #2：還原 pid（存在 flavorList 欄）＋「載入當下的瓶數」。
         tierBaseQty 的用意：剛開起來時瓶數還沒被動過，這一列的單價就照原單顯示，
         不讓級距價在載入的瞬間把當初談好的價錢改掉；等使用者真的改了瓶數，
         applyAutoRules 才開始按級距換價（也才會出現 MOQ 提醒）。 */
      else { addBotRow({name:it.name,lot:it.lot,vol:it.volume,price:it.unitPrice,ded:it.deduction,logo:it.logoFee,qty:it.qty,mark:((it.is_oem==='Y'||it.is_label==='Y')?1:0), gift:(isGiftItem(it)?1:0),
        pid:(it.flavorList||''), tierBaseQty:((it.flavorList||'')?String(parseFloat(it.qty)||0):''),
        lp:((it.listPrice!=null&&it.listPrice!=='')?it.listPrice:it.unitPrice), disc:(it.discount!=null?it.discount:''), discManual:((it.discount!=null&&it.discount!=='')?1:0), listprice:(it.listPrice||it.unitPrice)}); }
    });
    if(botItems.length===0) addBotRow();
    renderExt();
  } else {
    /* 複檢 2026-08-06 #9：宴會分支原本只清宴會自己的欄位，上一張瓶裝單的品項列與
       額外費用會整批留在畫面上（雖然宴會不計入總計，但只要在這張單切回瓶裝型就會
       全部冒出來並算進金額，接著被存進這張宴會單）。這裡比照瓶裝分支一併清乾淨。 */
    document.getElementById('itbody-bot').innerHTML=''; botItems=[];
    extras=[]; renderExt();
    botDedCache={}; botLogoCache={}; botLotCache={};
    flavors={g1:[],g2:[]};
    document.getElementById('ban-free-body').innerHTML=''; banFreeItems=[];
    document.getElementById('ban-addon-body').innerHTML=''; banAddonItems=[];
    // 先清掉兩組群組的殘留值（含計價方式／手動小計），沒存到的組才不會留上一張單的數字
    ['g1','g2'].forEach(g=>{
      set(`ban-${g}-price`,''); set(`ban-${g}-qty`,'');
      const us=document.getElementById(`ban-${g}-unit`); if(us) us.value='cup';
      const m=document.getElementById(`ban-${g}-man`); if(m) m.checked=false;
      const s=document.getElementById(`ban-${g}-subman`); if(s){ s.value=''; s.style.display='none'; }
      if(typeof onBanUnitChange==='function') onBanUnitChange(g);
    });
    // 宴會群組還原：計價方式（杯／ml）看存下的 unit；手動小計靠「subtotal ≠ 單價×數量」判定（相容舊單）
    const restoreBanGroup=(g,it)=>{
      set(`ban-${g}-price`,it.unitPrice); set(`ban-${g}-qty`,it.qty);
      const us=document.getElementById(`ban-${g}-unit`); if(us) us.value=(String(it.unit).toLowerCase()==='ml')?'ml':'cup';
      if(typeof onBanUnitChange==='function') onBanUnitChange(g);
      const auto=Math.round((parseFloat(it.unitPrice)||0)*(parseFloat(it.qty)||0));
      const st=Math.round(parseFloat(it.subtotal)||0);
      /* 複檢 2026-08-13 #3-1：原本是 if(st && …)，手動小計填 0（整組招待／併入其他費用不另計）
         會因為 0 是 falsy 而沒被勾回，重新開啟這張單就自己變回「單價×杯數」，總計無聲變大。 */
      const hasSt=(it.subtotal!=null && String(it.subtotal).trim()!=='');
      if(hasSt && st!==auto){
        const m=document.getElementById(`ban-${g}-man`); if(m) m.checked=true;
        const s=document.getElementById(`ban-${g}-subman`); if(s){ s.style.display=''; s.value=st; }
      }
      flavors[g]=it.flavorList?String(it.flavorList).split('、').filter(Boolean):[];
    };
    items.forEach(it=>{
      if(it.itemType==='banquet_group'){
        restoreBanGroup(it.name==='客製化調酒'?'g1':'g2', it);
      } else if(it.itemType==='banquet_free'){
        const free=String(it.noCharge||'').toUpperCase()==='Y';
        const disp=free?(parseFloat(it.deduction)||0):(parseFloat(it.subtotal)||0);
        const auto=Math.round((parseFloat(it.unitPrice)||0)*(parseFloat(it.qty)||0));
        const manual=!!disp && Math.round(disp)!==auto;
        addBanFreeRow({name:it.name, qty:it.qty, unit:it.unit, price:it.unitPrice,
          note:it.flavorList||'', free, manual, subval:(manual?Math.round(disp):'')});
      } else if(it.itemType==='banquet_addon'){
        addBanAddonRow({name:it.name,qty:it.qty,unit:it.unit,price:it.unitPrice});
      }
    });
    if(banFreeItems.length===0) addBanFreeRow();
    if(banAddonItems.length===0) addBanAddonRow();
    if(q.svcMode){
      set('svc-mode',q.svcMode); onSvcModeChange();
      // 還原調酒師服務費金額：優先用物件裡的原始輸入 → 其次 svcdetail 特殊列（後端主表沒存拆項）→ 最後才用合計金額回填
      const _sd=(q.items||[]).find(it=>it.itemType==='svcdetail');
      if(q.svcAmt1!=null || q.svcAmt2!=null || q.svcQty!=null){
        set('svc-amt1', q.svcAmt1||''); set('svc-amt2', q.svcAmt2||''); set('svc-qty', (q.svcQty!=null&&q.svcQty!=='')?q.svcQty:1);
      } else if(_sd){
        set('svc-amt1', _sd.unitPrice||''); set('svc-amt2', _sd.deduction||''); set('svc-qty', (_sd.qty!=null&&_sd.qty!=='')?_sd.qty:1);
      } else if(q.svcAmount){
        set('svc-amt1', q.svcAmount); set('svc-qty', 1);
      }
      calcBan();
    }
    renderFlavors('g1'); renderFlavors('g2');
  }
  // payment
  // 舊單若存過已移除的 Tab5（酒款訂金＋其他費用，2026-08-05 併回 Tab0），一律回到 Tab0；
  // 付款文字仍由下方 LOADED_PAY_DETAIL 沿用存檔當下的版本，客戶看到的內容不會被改掉
  let pt=parseInt(q.paymentType)||0; if(pt<0||pt>4) pt=0;
  setPay(pt);
  if(pt===3 && q.paymentDetail){ const e=document.getElementById('p3-txt'); if(e)e.value=q.paymentDetail; }
  // 沿用存檔當下算好的付款文字，避免重載重算改掉客戶看到的條件（setPay 已把 LOADED_PAY_DETAIL 清為 null，這裡在其後設定）
  LOADED_PAY_DETAIL=(q.paymentDetail!=null&&q.paymentDetail!=='')?q.paymentDetail:null;
  /* 複檢 2026-08-06 #1：載入當下就把原單的比例/天數/備註從凍結文字解析回付款欄位。
     這樣付款面板顯示的就是原單設定（而不是預設 50%/15/7/30），之後不管從哪條路解除凍結
     （改金額、直接編輯付款欄位、點付款分頁），重算用的都是原單的值，不會被預設值蓋掉。 */
  if(LOADED_PAY_DETAIL!=null){ try{ restorePayFieldsFromText(LOADED_PAY_DETAIL); }catch(e){} }
  calc();
  FORM_DIRTY=false; // 剛載入的舊單視為已儲存狀態
}

/* ---- 開新（清空編輯狀態）---- */
function isFormDirty(){
  if(editingQuoteNo) return FORM_DIRTY;   // 載入舊單後沒改過任何欄位＝乾淨，切單不用再跳「未儲存」警告
  if(document.getElementById('f-cli').value.trim()) return true;
  if(document.getElementById('f-con').value.trim()) return true;
  if(extras.length>0) return true;
  const hasRowData = (ids, prefix) => ids.some(id=>{
    const row=document.getElementById(`${prefix}-${id}`);
    if(!row) return false;
    return Array.from(row.querySelectorAll('[data-f]')).some(i=>i.type!=='checkbox' && i.value && i.value.trim()!=='');
  });
  if(hasRowData(botItems,'r')) return true;
  if(hasRowData(banFreeItems,'bf')) return true;
  if(hasRowData(banAddonItems,'ba')) return true;
  if((parseFloat(document.getElementById('ban-g1-price').value)||0) || (parseFloat(document.getElementById('ban-g1-qty').value)||0)) return true;
  if((parseFloat(document.getElementById('ban-g2-price').value)||0) || (parseFloat(document.getElementById('ban-g2-qty').value)||0)) return true;
  if(document.getElementById('svc-mode').value) return true;
  if(document.getElementById('f-note').value.trim()) return true;
  return false;
}
function newQuote(){
  if(isFormDirty()){
    if(!confirm('目前表單尚有未儲存的資料，確定要清除並開立新報價單？')) return false;   // 回傳 false 讓呼叫端（如 cusNewQuote）知道使用者取消了
  }
  editingQuoteNo=null;
  resetAll(true);
  gotoPage('new');
  autoNextSerial();   // 依今天已用單號自動帶下一個流水號，避免同一天重複
  return true;
}
/* 依今天已存在的單號，把流水號帶到下一個未使用值（best-effort，失敗就維持預設 1） */
async function autoNextSerial(){
  if(!AUTH_TOKEN) return;
  try{
    const today=todayStr().replace(/-/g,'');
    /* 改用讀取快取（登入後預抓早就抓好了）：開新單不用再等一趟後端。
       複檢 2026-08-06 #10：自訂報價單也會占用同一組單號（後端 generateQuoteNo_ 兩張表都掃），
       這裡只掃標準單的話，同一天存過自訂單就會帶出已被占用的流水號。 */
    const [lst, cst]=await Promise.all([
      readCall(withLimit({ action:'getQuotes', token:AUTH_TOKEN, filters:{} })),
      readCall({ action:'listCustomQuotes', token:AUTH_TOKEN }).catch(()=>null)
    ]);
    if(!lst.ok || !Array.isArray(lst.quotes)) return;
    let mx=0;
    const bump=no=>{ const m=String(no||'').match(new RegExp('^'+today+'-(\\d+)$')); if(m){ const n=parseInt(m[1],10); if(n>mx) mx=n; } };
    lst.quotes.forEach(x=>bump(x.quoteNo));
    if(cst && cst.ok && Array.isArray(cst.quotes)) cst.quotes.forEach(x=>bump(x.quote_no));
    if(mx>0 && !editingQuoteNo){ const s=document.getElementById('f-ser'); if(s){ s.value=mx+1; upNo(); } }
  }catch(_){}
}

/* ---- 組合另存新檔預設檔名 ---- */
function sanitizeFilename(s){
  return String(s).replace(/[\\/:*?"<>|]/g,'-').trim();
}
function buildExportFilename(){
  const tagCli=document.getElementById('f-tag-cli')?.value.trim();
  const tagLot=document.getElementById('f-tag-lot')?.value.trim();
  const cli=document.getElementById('f-cli')?.value.trim();
  const parts=[];
  if(tagCli) parts.push(tagCli);
  else if(cli) parts.push(cli);
  if(tagLot) parts.push(tagLot);
  parts.push('報價單_凱文南坡萬實業社');
  return sanitizeFilename(parts.join('_'));
}

/* ---- 標準模式：PDF 匯出（瀏覽器列印；每頁固定 A4，與預覽分頁完全一致）---- */
function exportPDF(){
  const pages = buildStdPagesHtml();
  const w=window.open('','_blank');
  if(!w){ toast('瀏覽器擋住了新視窗，請允許本站彈出視窗後再匯出','err'); return; }
  const fname=buildExportFilename();
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${fname}</title>
    <style>
      @page{size:A4;margin:10mm}
      html,body{margin:0;padding:0}
      .cpage{page-break-after:always}
      .cpage:last-child{page-break-after:auto}
      img{page-break-inside:avoid}
    </style>
    </head><body>${pages}</body></html>`);
  w.document.close();
  setTimeout(()=>{ w.print(); }, 500);
}

