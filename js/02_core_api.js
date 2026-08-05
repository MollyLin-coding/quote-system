/* ============================================================
   API 層 + 系統功能（登入 / 儲存 / 列表 / 匯出）
   ============================================================ */
const API_URL = "https://script.google.com/macros/s/AKfycbytSqCF0St1Gu8F_u8KW9rcKJnkkGAfrdaHYyrQ6wDKa19Z3TxZd-GRRi_3Ii3Ijv4i/exec";
let AUTH_TOKEN = null;
let currentPage = 'new';      // new | records
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
    if(err && err.name==='AbortError') throw new Error('連線逾時，請檢查網路後再試一次');
    throw new Error('無法連線到後台，請確認網路後再試一次');
  }
  clearTimeout(timer);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch(e){ throw new Error('無法連線到後台（伺服器回應異常），請稍後再試'); }
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
  try{ localStorage.setItem(REMEMBER_KEY, JSON.stringify({ t:token, exp:Date.now()+8*60*60*1000 })); }catch(e){}
}
function rememberClear(){ try{ localStorage.removeItem(REMEMBER_KEY); }catch(e){} }
function rememberRead(){
  try{
    const c = JSON.parse(localStorage.getItem(REMEMBER_KEY) || 'null');
    if(!c || !c.t || !c.exp || Date.now() >= c.exp){ rememberClear(); return null; }
    return c.t;
  }catch(e){ rememberClear(); return null; }
}
function doLogout(){
  AUTH_TOKEN = null;
  try{ sessionStorage.removeItem('quote_token'); }catch(e){}
  rememberClear();
  if(typeof tdCacheClear==='function') tdCacheClear();
  rcClear();
  location.reload();
}

/* ---- 登入 ---- */
async function doLogin(){
  const pin = document.getElementById('login-pin').value.trim();
  const errEl = document.getElementById('login-err');
  const btn = document.getElementById('login-btn');
  errEl.textContent = '';
  if(!pin){ errEl.textContent = '請輸入 PIN 碼'; return; }
  // 後端登入時會順便整理今天的待辦（v38），所以這一趟比單純驗 PIN 久一點，
  // 文字寫清楚在做什麼，才不會覺得卡住。
  btn.disabled = true; btn.textContent = '登入中…正在整理今天的待辦';
  try {
    const data = await apiCall({ action:'login', pin });
    if(data.ok && data.token){
      AUTH_TOKEN = data.token;
      sessionStorage.setItem('quote_token', data.token);
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
  { const e=document.getElementById('page-today'); if(e) e.classList.toggle('on', p==='today'); }
  { const e=document.getElementById('page-customer'); if(e) e.classList.toggle('on', p==='customer'); }
  document.getElementById('tbr-standard').style.display = (p==='custom'||p==='orders'||p==='report'||p==='cal'||p==='consign'||p==='verify'||p==='today'||p==='customer') ? 'none' : 'flex';
  document.getElementById('tbr-custom').style.display = p==='custom' ? 'flex' : 'none';
  const _titles={today:['今日待辦','今天該做的事，一頁看完，點下去就能處理'],
    custom:['自訂報價單','自由建立非常規報價單，可儲存到後台備份，並直接匯出 PDF / Word'],
    orders:['訂單追蹤','報價 → 訂金 → 出貨 → 發票 → 尾款，一眼掌握每張單走到哪'],
    report:['月報表','對帳一眼看懂：已收訂金／已收尾款／還沒收的尾款，一頁掌握'],
    verify:['出貨驗收管理','驗收單留底、客戶掃碼回報處理、未回報催單，一頁掌握'],
    cal:['工作行事曆','訂單日程自動連動＋備忘與待辦，防止遺漏'],
    consign:['寄售管理','公版酒鋪貨・銷售・庫存・保證金・月結，一頁掌握'],
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
    loadOrders().then(renderReport).catch(()=>{});
  }
  if(p==='verify'){ document.getElementById('nav-verify').classList.add('on'); loadVerifyMgmt().catch(()=>{}); }
  if(p==='cal'){ document.getElementById('nav-cal').classList.add('on'); loadCalendar().catch(()=>{}); }
  if(p==='consign'){ document.getElementById('nav-consign').classList.add('on'); initConsignPage().catch(()=>{}); }
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
      items.push({ itemType:'bottle', name, lot:_lot, volume:gv(row,'vol'),
        unitPrice:gv(row,'price'), deduction:colDed?gv(row,'ded'):0, logoFee:colLogo?gv(row,'logo'):0,
        qty:gv(row,'qty'), unit:'瓶', subtotal:(_gift==='Y'?0:sub), flavorList:'',
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
      items.push({ itemType:'extra', name:e.n, lot:'', volume:'', unitPrice:e.a,
        deduction:0, logoFee:0, qty:1, unit:'', subtotal:e.a, flavorList:'' });
    });
  }
  // 免運優惠（顯示用、不計價）：以特殊品項存進 items_json，適用所有單型；金額放 deduction，unitPrice/subtotal=0 不影響總計
  { const _fs=parseFloat(document.getElementById('f-freeship')?.value)||0;
    if(_fs>0){ items.push({ itemType:'freeship', name:'免運優惠', lot:'', volume:'', unitPrice:0, deduction:_fs, logoFee:0, qty:1, unit:'', subtotal:0, flavorList:'' }); } }
  // 批次標籤（Lot/日期標記＋客戶名稱標籤）：後端主表沒有 tagLot/tagCli 欄位，直接存會被丟掉、重開就消失；
  // 比照免運優惠存成特殊品項列（品項後端全欄保存），Lot 標記放 lot 欄、客戶名稱標籤借放 flavorList 欄，載入時還原
  { const _tl=val('f-tag-lot'), _tc=val('f-tag-cli');
    if(_tl||_tc){ items.push({ itemType:'taglabel', name:'批次標籤', lot:_tl, volume:'', unitPrice:0, deduction:0, logoFee:0, qty:1, unit:'', subtotal:0, flavorList:_tc }); } }

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
      FORM_DIRTY=false;
      toast('已儲存：'+data.quoteNo,'ok');
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

/* ---- 產生正式 PDF/Word 文件（GAS 動態建立 Google Doc）----
   v31：改為先開視窗選「保留舊版（預設）／覆蓋舊版」，並可查歷史版本（listQuotePdfs） */
function generateOfficialDocument(){
  if(!AUTH_TOKEN){ showLogin(); return; }
  if(!editingQuoteNo){
    toast('請先「儲存」報價單後再產生正式文件','err');
    return;
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
    if(merged.length===0){ body.innerHTML='<tr><td colspan="6" class="rec-empty">'+((REC_QUOTES.length||customs.length)?'沒有符合條件的報價單':'尚無報價單記錄')+'</td></tr>'; return; }
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
    document.getElementById('itbody-bot').innerHTML=''; botItems=[];
    extras=[];
    const realItems = items.filter(it=>it.itemType!=='extra'&&it.itemType!=='freeship'&&it.itemType!=='taglabel'&&it.itemType!=='svcdetail');
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
      if(it.itemType==='extra'){ extras.push({id:`ext${++_extSeq}`,n:it.name,a:it.unitPrice||it.subtotal||0}); }
      else if(it.itemType==='freeship'){ /* 免運優惠已於上方共用區還原到 f-freeship，不建品項列 */ }
      else if(it.itemType==='taglabel'){ /* 批次標籤已於上方共用區還原到 f-tag-lot / f-tag-cli，不建品項列 */ }
      else if(it.itemType==='svcdetail'){ /* 服務費拆項＝宴會用特殊列，瓶裝型不會有；防呆跳過不建品項列 */ }
      else { addBotRow({name:it.name,lot:it.lot,vol:it.volume,price:it.unitPrice,ded:it.deduction,logo:it.logoFee,qty:it.qty,mark:((it.is_oem==='Y'||it.is_label==='Y')?1:0), gift:(isGiftItem(it)?1:0),
        lp:((it.listPrice!=null&&it.listPrice!=='')?it.listPrice:it.unitPrice), disc:(it.discount!=null?it.discount:''), discManual:((it.discount!=null&&it.discount!=='')?1:0), listprice:(it.listPrice||it.unitPrice)}); }
    });
    if(botItems.length===0) addBotRow();
    renderExt();
  } else {
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
      if(st && st!==auto){
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
    // 改用讀取快取（登入後預抓早就抓好了）：開新單不用再等一趟後端
    const lst=await readCall(withLimit({ action:'getQuotes', token:AUTH_TOKEN, filters:{} }));
    if(!lst.ok || !Array.isArray(lst.quotes)) return;
    let mx=0;
    lst.quotes.forEach(x=>{ const m=String(x.quoteNo||'').match(new RegExp('^'+today+'-(\\d+)$')); if(m){ const n=parseInt(m[1],10); if(n>mx) mx=n; } });
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

