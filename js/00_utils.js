/* ============================================================
   共用小工具（全站共用，最先載入）
   2026-07-26：原本散在 01_quote_form / 04_company / 06_verify_mgmt 三個檔案裡，
   但幾乎每個檔都在用，靠「classic script 共用全域作用域」才成立。
   這裡集中成一支，函式內容一字未改，只是搬家。
   ============================================================ */
/* ---- 掛勾（hook）登記處 ----------------------------------------
   給「後面載入的模組想在前面模組的函式跑完後補做一些事」用。
   以前是用 window.calc = function(){...} 這種「猴子補丁」直接把函式換掉，
   能動但很脆：檔案順序一換就壞、看程式碼也不知道 calc 到底做了幾件事。
   改成明確登記後，基底函式自己在該呼叫的位置喊一聲 runHooks，
   各模組用 onHook 登記自己要補做的事，順序＝登記順序，看得見也測得到。
   ---------------------------------------------------------------- */
const HOOKS = {};
function onHook(name, fn){ (HOOKS[name] || (HOOKS[name] = [])).push(fn); }
function runHooks(name, arg){
  const list = HOOKS[name]; if(!list) return;
  for(let i=0;i<list.length;i++){
    try{ list[i](arg); }
    catch(e){ console.error('[hook] ' + name + ' 失敗：', e); }   // 單一掛勾出錯不拖垮主流程
  }
}

/* ---- 讀取快取（頁面之間切換秒開）--------------------------------
   實測（2026-07-26）：後端每被叫一次固定要 2.5 秒起跳，連「什麼都不做」的
   空請求也一樣，冷啟動更要 12 秒。也就是說慢的不是資料量，是「叫了幾次」。
   這裡把「純讀取」的回應在記憶體裡放 90 秒：
     ・切回同一頁 → 直接用記憶體那份，0 秒。
     ・兩個頁面要同一份資料（訂單追蹤與驗收管理都要驗收資料）→ 只打一次。
     ・同一份同時被要兩次（預抓撞上點擊）→ 共用同一個請求，不會打兩次。
     ・任何「寫入類」動作（存單／改進度／刪除…）一律整包清掉，不會看到舊資料。
   ⚠ 只放在記憶體（重新整理瀏覽器就沒了），且絕不存 token。
   ---------------------------------------------------------------- */
const RC_TTL_MS = 90000;
/* 白名單：只有這些 action 算「純讀取」。沒列到的一律當成寫入（寧可多清一次快取）。 */
const RC_READ_ACTIONS = ['getQuotes','getQuoteById','getCompanyData','getOrderStatusList',
  'listQuotePdfs','listShipments','listCustomQuotes','listCalendarItems','getChangeLog',
  'getOwnbrandProducts','getOwnbrandTiers','getConsignCustomers','getConsignInventory',
  'getConsignLedger','getConsignMonthly','getVerifications','listVerifyForms',
  'getTodayDigest','getCustomers','verifyHeaders','batch','getStorageData',
  /* 2026-08-24：syncCalendarNow 只讀 order_status／calendar_items 兩張表、寫的是「外部」Google
     日曆，不改這兩張表本身，所以不用當成「寫入」清掉 ORDERS_CACHE/CAL_ITEMS——放進白名單，
     這樣改完出貨日期後背景補打一次才不會平白把畫面快取洗空。 */
  'syncCalendarNow',
  /* 2026-09-01 複檢：這兩支也是純讀取，原本漏列 → 開一次驗收單（要拿 QR 驗證碼）或按一次
     行事曆的「自我檢查」，就會被當成寫入把整站快取清光：公司報價檔跟著失效（級距價/MOQ 全停）、
     驗收管理的資料被清成空的但畫面不重畫（按鈕按了沒反應）。兩支都只讀不寫，放進白名單。 */
  'getVerifyKey','calendarSelfCheck'];
const RC_STORE = {};      // key -> {at, data}
const RC_INFLIGHT = {};   // key -> Promise（同一份資料同時被要時共用）
const RC_RESETS = [];     // 各模組登記「快取被清掉時，我的衍生資料也要歸零」
let RC_GEN = 0;           // 世代編號：rcClear 會 +1。「清快取之前就出發」的請求回來時不寫進快取，
                          // 免得存檔後被一份「存檔前的舊資料」重新填回快取（2026-07-28 修）
function rcIsRead(action){ return RC_READ_ACTIONS.indexOf(String(action||'')) >= 0; }
function rcKey(payload){
  const q = {};
  Object.keys(payload||{}).sort().forEach(k=>{ if(k!=='token') q[k] = payload[k]; });
  return JSON.stringify(q);
}
function rcPeek(payload){ return RC_STORE[rcKey(payload)] || null; }        // 不管多舊，有就給
function rcFresh(payload, ttl){
  const e = rcPeek(payload);
  return !!e && (Date.now() - e.at) < (ttl == null ? RC_TTL_MS : ttl);
}
function onCacheClear(fn){ RC_RESETS.push(fn); }
function rcClear(){
  RC_GEN++;
  Object.keys(RC_STORE).forEach(k => delete RC_STORE[k]);
  Object.keys(RC_INFLIGHT).forEach(k => delete RC_INFLIGHT[k]);   // 清掉「清除前就出發」的舊請求登記，寫入後的新讀取才不會搭到舊班車拿到舊資料
  for(let i=0;i<RC_RESETS.length;i++){
    try{ RC_RESETS[i](); }catch(e){ console.error('[cache] reset 失敗：', e); }
  }
}
/* 讀取用的 apiCall 包裝：90 秒內同一份資料直接給快取，force=true 一定重打 */
async function readCall(payload, force){
  const k = rcKey(payload);
  if(!force){
    const e = RC_STORE[k];
    if(e && (Date.now() - e.at) < RC_TTL_MS) return e.data;
    if(RC_INFLIGHT[k]) return RC_INFLIGHT[k];
  }
  const gen = RC_GEN;
  const p = apiCall(payload).then(d => {
    if(RC_INFLIGHT[k] === p) delete RC_INFLIGHT[k];   // 只刪自己的登記：rcClear 後若有新請求接手，別把人家的登記刪掉
    if(d && d.ok !== false && gen === RC_GEN) RC_STORE[k] = { at: Date.now(), data: d };   // 只快取成功的；出發後快取被清過就不寫回（那是舊資料）
    return d;
  }, e => { if(RC_INFLIGHT[k] === p) delete RC_INFLIGHT[k]; throw e; });
  RC_INFLIGHT[k] = p;
  return p;
}
/* ---- 一次要好幾份資料：合併成一個 batch 請求（後端 v37）----------
   實測（2026-07-26，各測 4 輪）同時要 5 份資料：
     平行 5 支：2.9 / 3.1 / 5.4 / 12.2 秒 —— 平均 5.9 秒，偶爾會卡到 12 秒
     合併 1 支：3.8 / 4.1 / 4.3 / 4.9 秒 —— 平均 4.3 秒，且很穩
   3 支以下兩者差不多（batch 2.9 / 平行 3.2），所以只有「同時要 4 份以上」
   才值得合併；畫面正在等的那幾支仍走平行（先畫出來比較重要）。
   後端若還沒有 batch（舊版部署）→ 自動關掉、之後一律走平行，不會壞。
   ---------------------------------------------------------------- */
const RC_BATCH_MIN = 4;
const RC_BATCH_MAX = 8;   // 後端 v37 的 BATCH_MAX_；一班車最多 8 份，超過拆批
let BATCH_OK = true;
async function readCallMany(payloads, force){
  const keys = payloads.map(rcKey);
  const isFresh = i => { const e=RC_STORE[keys[i]]; return !force && e && (Date.now()-e.at) < RC_TTL_MS; };
  // 已經有快取的不用要；別人正在要的就等別人那一份，別重複打
  const fresh = payloads.map((p,i)=>i).filter(i => !isFresh(i) && (force || !RC_INFLIGHT[keys[i]]));
  if(!BATCH_OK || fresh.length < RC_BATCH_MIN) return Promise.all(payloads.map(p => readCall(p, force)));

  // 後端一次最多收 RC_BATCH_MAX 份（v37 的 BATCH_MAX_=8）：超過要拆成多班車，
  // 不能整包丟過去——會被後端回絕，還會被下面誤判成「不支援 batch」而永久關閉合併。
  const gen = RC_GEN;
  let batchFailed = false;
  for(let ci = 0; ci < fresh.length && !batchFailed; ci += RC_BATCH_MAX){
    const group = fresh.slice(ci, ci + RC_BATCH_MAX);
    const calls = group.map(i => { const c = Object.assign({}, payloads[i]); delete c.token; return c; });
    const bp = apiCall({ action:'batch', token:AUTH_TOKEN, calls });
    group.forEach((idx, n) => {                     // 這幾份「正在路上」，讓同時要的人搭同一班車
      const one = bp.then(r => {
        const d = (r && r.ok && r.results) ? r.results[n] : null;
        if(!d) throw new Error('batch 沒有回這一格');
        return d;
      });
      one.catch(()=>{});
      RC_INFLIGHT[keys[idx]] = one;
    });
    /* 複檢 2026-08-06 #22：登入過期時 apiCall 會攔到 batch 子回應裡的 UNAUTHORIZED 並 throw，
       原本一律被當成「後端不支援 batch」→ BATCH_OK 永久關閉、還會再平行重打一輪注定失敗的
       個別請求（正是 apiCall 那段註解想避免的行為），重新登入後也不會恢復。
       認證問題要直接往外丟（讓 apiCall 那邊的流程去彈登入），不要動 BATCH_OK。 */
    let r = null, authErr = null;
    try{ r = await bp; }catch(e){ r = null; if(e && /登入已過期|UNAUTHORIZED/.test(String(e.message||e))) authErr = e; }
    group.forEach(idx => { delete RC_INFLIGHT[keys[idx]]; });
    if(authErr) throw authErr;
    if(!r || !r.ok || !Array.isArray(r.results) || r.results.length !== calls.length){
      BATCH_OK = false;                             // 後端不支援就別再試了
      batchFailed = true;
      break;
    }
    group.forEach((idx, n) => {
      const d = r.results[n];
      if(d && d.ok !== false && gen === RC_GEN) RC_STORE[keys[idx]] = { at: Date.now(), data: d };   // 出發後快取被清過就不寫回
    });
  }
  if(batchFailed) return Promise.all(payloads.map(p => readCall(p, force)));
  return Promise.all(payloads.map(p => readCall(p, false)));   // 這時候全在快取裡，等於直接取出
}

/* 「幾分鐘前」小標（給頁面顯示資料新舊用） */
function rcAgeText(at){
  if(!at) return '';
  const m = Math.floor((Date.now() - at) / 60000);
  if(m < 1) return '剛剛更新';
  if(m < 60) return m + ' 分鐘前的資料';
  return Math.floor(m/60) + ' 小時前的資料';
}

/* ---- 清單分頁 ------------------------------------------------
   後端 v34 起 list 類 action 吃選填的 limit（只回最近 N 筆）。
   預設只抓最近 LIST_LIMIT 筆，單量變大時才不會愈開愈慢；
   資料真的超過時畫面會出現「載入全部」，按下去就抓完整清單。
   不帶 limit＝行為與以前完全一樣，所以現在資料還少的時候什麼都不會變。
   ---------------------------------------------------------------- */
const LIST_LIMIT = 300;
let LIST_LOAD_ALL = false;
function withLimit(payload){ if(!LIST_LOAD_ALL) payload.limit = LIST_LIMIT; return payload; }
function listMaybeMore(n){ return !LIST_LOAD_ALL && n >= LIST_LIMIT; }
function moreRowHtml(cols){
  return '<tr><td colspan="'+cols+'" class="rec-empty">目前只顯示最近 '+LIST_LIMIT+' 筆（比較快）　'+
    '<button class="rec-act-btn" onclick="loadAllLists()">載入全部</button></td></tr>';
}
function loadAllLists(){
  LIST_LOAD_ALL = true;
  toast('正在載入全部資料…','ok');
  if(currentPage==='records' && typeof loadRecords==='function') loadRecords();
  else if(typeof loadOrders==='function') loadOrders(true).catch(()=>{});
}

/* ---- 共用骨架屏 ----------------------------------------------
   等 API 的區塊一律先鋪灰色骨架（不要留白畫面，也不要只放「載入中…」三個字）。
   樣式在 assets/app.css 的 .skl / .skl-row。
   ---------------------------------------------------------------- */
function sklBlock(n){
  n = n || 3;
  let h = '';
  for(let i=0;i<n;i++) h += '<div class="skl-row"><div class="skl" style="width:'+(48+((i*13)%34))+'%"></div><div class="skl" style="width:'+(26+((i*9)%22))+'%;height:9px;margin-top:8px"></div></div>';
  return '<div class="skl-wrap">'+h+'</div>';
}
function sklTableRows(cols, n){
  n = n || 3;
  let h = '';
  for(let i=0;i<n;i++) h += '<tr><td colspan="'+cols+'" style="padding:12px 14px"><div class="skl" style="width:'+(46+((i*17)%38))+'%"></div></td></tr>';
  return h;
}

function s2(n){return String(n).padStart(2,'0')}
function todayStr(){
  const t=new Date();
  return `${t.getFullYear()}-${s2(t.getMonth()+1)}-${s2(t.getDate())}`;
}
function escHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function fmtMoney(v){ v=Math.round(parseFloat(v)||0); return v<0 ? '-$'+Math.abs(v).toLocaleString() : '$'+v.toLocaleString(); }
function fmtD(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function money(n){ const v=Math.round(parseFloat(n)||0); return v<0 ? '-$'+Math.abs(v).toLocaleString() : '$'+v.toLocaleString(); }
function parseJsonSafe(s, fb){ try{ const v=JSON.parse(s); return v==null?fb:v; }catch(e){ return fb; } }
function daysBetween(dstr){ // 今天到 dstr 的天數（負=已過）
  if(!dstr) return null;
  const d=new Date(dstr+'T00:00:00'); if(isNaN(d)) return null;
  const t=new Date(); t.setHours(0,0,0,0);
  return Math.round((d-t)/86400000);
}
function escAttr(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
/* 驗收管理後端某些日期欄位（saveVerifyForm 的 ship_date／updateVerificationStatus 的 closed_date）
   會把純日期字串轉存成 UTC 時間戳（如 2026-07-24T16:00:00.000Z），讀回來若直接切前10碼會早一天。
   這裡統一轉回台北在地日期字串（YYYY-MM-DD）再顯示／計算。 */
function vmLocalYmd(s){
  if(!s) return '';
  const str=String(s);
  const m=str.match(/^(\d{4}-\d{2}-\d{2})(?!T)/);
  if(m) return m[1];               // 已經是純日期字串，直接用
  const d=new Date(str);
  if(isNaN(d)) return str.slice(0,10);
  const tpe=new Date(d.getTime()+8*60*60*1000);   // 轉回台北（+08:00）在地日期
  return tpe.toISOString().slice(0,10);
}
function vmDaysSince(dstr){ const d=daysBetween(vmLocalYmd(dstr)); return d==null?null:-d; }
function vmArr(v){ if(v==null||v==='') return []; if(Array.isArray(v)) return v; return String(v).split(/[\n,｜|]+/).map(s=>s.trim()).filter(Boolean); }

/* ---- 按鈕忙碌狀態（2026-09-01 複檢）------------------------------
   後端每趟固定 2.5 秒起跳，按下去畫面完全沒動靜，使用者會以為沒存到而重按或重填。
   報價單／訂單追蹤本來就有做，這支是給其餘那幾顆共用的：
     btnBusy('st-f-save', true)            → 變灰＋「儲存中…」
     btnBusy('st-f-save', false)           → 還原原本的文字（含裡面的 icon）
   找不到按鈕就安靜跳過，絕不能因為回饋失敗擋掉真正的儲存。
   ------------------------------------------------------------------ */
const BTN_BUSY_HTML = {};
function btnBusy(id, on, busyText){
  try{
    const el=(typeof id==='string')?document.getElementById(id):id;
    if(!el) return;
    const key=el.id||String(id);
    if(on){
      if(BTN_BUSY_HTML[key]==null) BTN_BUSY_HTML[key]=el.innerHTML;
      el.disabled=true; el.innerHTML=busyText||'儲存中…';
    } else {
      el.disabled=false;
      if(BTN_BUSY_HTML[key]!=null){ el.innerHTML=BTN_BUSY_HTML[key]; delete BTN_BUSY_HTML[key]; }
    }
  }catch(e){}
}
