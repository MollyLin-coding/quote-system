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
