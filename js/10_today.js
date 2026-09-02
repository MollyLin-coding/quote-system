/* ============================================================
   今日待辦首頁（手機優先・登入後預設落地頁）
   資料來源：後端 v34 的 getTodayDigest（一趟拿齊五區塊）。
   後端若不支援或當掉，退回用既有 action 自己組（tdBuildFallback），功能不斷。
   體感速度：localStorage 快取先顯示 → 背景更新；等待中一律用共用骨架屏。
   ⚠ 快取只存「畫面上看得到的清單資料」，絕不存登入通行證（token 維持 sessionStorage）。
   ============================================================ */
const TD_CACHE_KEY = 'qs_today_v1';
let TD_DATA = null;         // 目前畫面上的資料
let TD_FROM_CACHE = false;  // 現在顯示的是不是快取（尚未拿到新資料）
let TD_CACHED_AT = null;    // 快取寫入時間（ISO 字串）
let TD_BUSY = false;
let TD_LAST_FETCH = 0;      // 上次真的打後端的時間（節流用）
// 任何寫入（apiCall 非讀取 action）都會清讀取快取；今日待辦跟著解除 90 秒節流，回到本頁時重抓最新（畫面仍先顯示舊資料不閃空）
if(typeof onCacheClear==='function') onCacheClear(function(){ TD_LAST_FETCH=0; });
const TD_MIN_GAP_MS = 90000; // 90 秒內在頁面之間來回切，不重複打後端（按「重新整理」不受限）
/* 門檻：與後端 v35 的 DIGEST_FINAL_AHEAD_DAYS_ / DIGEST_NOINVOICE_DAYS_ 一致，
   fallback 自己組時要用同一組數字，兩條路顯示的筆數才會一樣 */
const TD_FINAL_AHEAD_DAYS = 7;   // 預計尾款日往後看幾天算「急」
const TD_NOINVOICE_DAYS  = 7;    // 已出貨超過幾天未開發票算「急」

/* ---- 台北在地「今天」（沿用全站慣例，不用 UTC 切字串）---- */
function tdToday(){ return fmtD(new Date()); }

/* ---- 快取（登出／token 失效時由 apiCall 呼叫 tdCacheClear）---- */
function tdCacheRead(){
  try{
    const raw = localStorage.getItem(TD_CACHE_KEY);
    if(!raw) return null;
    const c = JSON.parse(raw);
    if(!c || c.date !== tdToday()) return null;   // 跨日的快取直接不用，避免看到昨天的待辦
    return c;
  }catch(e){ return null; }
}
function tdCacheWrite(data){
  try{ localStorage.setItem(TD_CACHE_KEY, JSON.stringify({ date: tdToday(), at: new Date().toISOString(), data })); }
  catch(e){ /* 無痕模式或空間滿了都不影響功能 */ }
}
function tdCacheClear(){ try{ localStorage.removeItem(TD_CACHE_KEY); }catch(e){} TD_DATA=null; TD_CACHED_AT=null; TD_FROM_CACHE=false; }

/* ---- 幾分鐘前（金額類資料要讓人知道有多舊）---- */
function tdAgoText(iso){
  if(!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if(!(ms >= 0)) return '';
  const m = Math.floor(ms/60000);
  if(m < 1) return '剛剛';
  if(m < 60) return m + ' 分鐘前';
  const h = Math.floor(m/60);
  return h + ' 小時前';
}

/* ---- 後端 v38：登入時就一起帶回來的今日待辦，直接當成「剛剛才拿到的」---- */
function tdSeed(d){
  if(!d) return;
  TD_DATA = d;
  TD_FROM_CACHE = false;
  TD_CACHED_AT = new Date().toISOString();
  TD_LAST_FETCH = Date.now();        // 讓接下來的 loadToday() 走節流、不再打一次
  tdCacheWrite(d);
}

/* ---- 載入 ---- */
async function loadToday(force){
  const body = document.getElementById('td-body');
  if(!body) return;

  // 1) 先把快取畫出來（開頁三秒內就有東西看），再去背景要新的
  if(!TD_DATA){
    const c = tdCacheRead();
    if(c && c.data){ TD_DATA = c.data; TD_CACHED_AT = c.at; TD_FROM_CACHE = true; renderToday(); }
    else { body.innerHTML = tdSkeletonHtml(); }
  }else if(force){
    TD_FROM_CACHE = true;   // 手動重新整理：畫面留著舊資料，狀態列顯示「更新中…」
    renderToday();
  }
  // 剛剛才更新過就不要再打一次（例如在頁面之間來回切）；按「重新整理」一定重打
  if(!force && TD_DATA && !TD_FROM_CACHE && (Date.now() - TD_LAST_FETCH) < TD_MIN_GAP_MS){
    renderToday(); tdRenderStat(false); return;
  }
  tdRenderStat(true);

  if(TD_BUSY) return;
  TD_BUSY = true;
  try{
    let d = null;
    try{
      const r = await apiCall({ action:'getTodayDigest', token:AUTH_TOKEN });
      if(r && r.ok) d = r;
    }catch(e){ /* 後端沒這個 action、或連線失敗 → 走下面的 fallback */ }

    if(!d) d = await tdBuildFallback();

    TD_DATA = d; TD_FROM_CACHE = false; TD_CACHED_AT = new Date().toISOString(); TD_LAST_FETCH = Date.now();
    tdCacheWrite(d);
    renderToday();
  }catch(e){
    if(!TD_DATA) body.innerHTML = `<div class="td-none" style="padding:24px">讀取失敗：${escHtml(e.message||'請稍後再試')}</div>`;
    toast(e.message || '今日待辦讀取失敗', 'err');
  }finally{
    tdRenderStat(false); TD_BUSY = false;
  }
}

/* ---- 後端沒有 getTodayDigest 時的替代做法：用既有 action 自己組 ---- */
async function tdBuildFallback(){
  await Promise.all([
    (async()=>{ try{ if(!ORDERS_CACHE) await loadOrders(); }catch(e){} })(),
    (async()=>{ try{ if(!CAL_ITEMS || !CAL_ITEMS.length) await loadCalendar(); }catch(e){} })(),
    (async()=>{ try{ if(!VM_DATA) await loadVerifyMgmt(); }catch(e){} })()
  ]);
  const today = tdToday();
  const out = { ok:true, today, ship_due:[], final_due:[], no_scan:[], no_invoice:[], calendar:[], warnings:[], _fallback:true };
  const cli = o => String(o.client||'').split('｜')[0];

  (ORDERS_CACHE||[]).forEach(o=>{
    const st = o.st || {}; const s = (typeof effOrdStatus==='function')?effOrdStatus(st):String(st.status||'quoted');
    // A. 今天／逾期該出貨（恆為「急」）
    if(['cancelled','closed','paid','shipped','invoiced'].indexOf(s) < 0 && st.ship_date_est && !st.ship_date_actual){
      const dd = daysBetween(vmLocalYmd(st.ship_date_est));
      if(dd != null && dd <= 0) out.ship_due.push({ quote_no:o.no, client:cli(o), plan_ship_date:vmLocalYmd(st.ship_date_est), overdue_days:-dd, urgent:true });
    }
    // B. 該催的尾款（已出貨/已開發票、尾款日空白）。**全部都列**，7 天內到期／逾期／沒填預計日＝急
    if((s==='shipped' || s==='invoiced') && !st.final_date){
      const planned = st.final_date_est ? vmLocalYmd(st.final_date_est) : '';
      const ahead = planned ? daysBetween(planned) : null;
      const urgent = (ahead == null) || (ahead <= TD_FINAL_AHEAD_DAYS);
      let amt, isEst = false;
      if(st.final_amt !== '' && st.final_amt != null) amt = Number(st.final_amt) || 0;
      else { amt = (Number(st.grand_total) || Number(o.total) || 0) - (Number(st.deposit_amt) || 0); isEst = true; }
      out.final_due.push({ quote_no:o.no, client:cli(o), final_amt:amt, is_estimated:isEst, plan_final_date:planned,
        overdue:(ahead != null && ahead < 0), overdue_days:(ahead != null && ahead < 0) ? -ahead : 0,
        urgent:urgent, days_until:ahead });
    }
    // D. 已出貨未開發票。**全部都列**，超過 7 天／沒填實際出貨日＝急（判定沿用後端：看發票號碼）
    if((s === 'shipped' || (s === 'paid' && st.ship_date_actual)) && !st.invoice_no){
      const ymd = st.ship_date_actual ? vmLocalYmd(st.ship_date_actual) : '';
      const dd = ymd ? daysBetween(ymd) : null;
      const days = (dd == null) ? null : -dd;
      out.no_invoice.push({ quote_no:o.no, client:cli(o), ship_date:ymd, days_since:days,
        urgent:(days == null) || (days > TD_NOINVOICE_DAYS) });
    }
  });
  out.ship_due.sort((a,b)=>b.overdue_days-a.overdue_days);
  // 急的排前面；同組內預計日近的在前，沒填日期的排該組最後（與後端排序一致）
  out.final_due.sort((a,b)=>{
    if(a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    return String(a.plan_final_date||'9999-12-31').localeCompare(String(b.plan_final_date||'9999-12-31'));
  });
  out.no_invoice.sort((a,b)=>{
    if(a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    return (b.days_since||0)-(a.days_since||0);
  });

  // C. 掃碼未回報：直接沿用出貨驗收管理那份現成邏輯
  try{
    (vmNoReportList()||[]).forEach(x=>out.no_scan.push({ quote_no:x.no, client:x.client, ship_date:x.shipDate, days_since:x.days, lot:x.lot||'', urgent:true }));
  }catch(e){ out.warnings.push('未回報清單讀取失敗'); }

  // E. 今天的行事曆（備忘＋重複行程，比照行事曆頁的判定）
  try{
    const d = new Date(today + 'T00:00:00');
    (CAL_ITEMS||[]).forEach(it=>{
      if(typeof calIsPrivate==='function' && calIsPrivate(it)) return;   // 2026-09-02：私人行程不進今日待辦
      let hit = false;
      if(it.kind === 'memo') hit = (vmLocalYmd(it.date) === today && it.done !== 'Y');
      else if(it.kind === 'recur'){
        // 2026-09-01 複檢 #12：與月曆共用同一份判斷（js/00_utils.js recurHitsOn）
        hit = recurHitsOn(it, d);
      }
      if(hit) out.calendar.push({ item_id:it.item_id, title:it.title, category:it.category||'', time:(it.all_day!=='Y'&&it.time)?String(it.time):'', all_day:it.all_day==='Y' });
    });
    out.calendar.sort((a,b)=>String(a.time||'').localeCompare(String(b.time||'')));
  }catch(e){ out.warnings.push('今日行事曆讀取失敗'); }

  return out;
}

/* ---- 狀態列（更新中… / 已是最新 / 幾分鐘前的資料）---- */
function tdRenderStat(loading){
  const el = document.getElementById('td-stat'); if(!el) return;
  const dateTxt = (TD_DATA && TD_DATA.today) ? TD_DATA.today.slice(5).replace('-','/') : tdToday().slice(5).replace('-','/');
  let txt;
  if(loading) txt = TD_FROM_CACHE ? `${dateTxt}　更新中…（先顯示上次的資料${TD_CACHED_AT?'，'+tdAgoText(TD_CACHED_AT):''}）` : `${dateTxt}　載入中…`;
  else txt = `${dateTxt}　已是最新`;
  el.className = 'td-stat' + (loading ? ' loading' : '');
  el.innerHTML = `<span class="dot"></span>${escHtml(txt)}`;
}

/* ---- 骨架屏（共用；等 API 的區塊都用它，別讓畫面白著）---- */
function tdSkeletonHtml(){
  const rows = n => Array.from({length:n}, ()=>`<div class="skl-row"><div class="skl" style="width:58%"></div><div class="skl" style="width:34%;height:9px;margin-top:8px"></div></div>`).join('');
  const card = () => `<div class="td-card"><div class="td-ch"><div class="skl" style="width:120px;height:14px"></div></div>${rows(3)}</div>`;
  return `<div class="td-grid">${card()}${card()}${card()}${card()}</div>`;
}

/* ---- 點擊：先確保資料在，再開既有的編輯彈窗 ---- */
/* 2026-09-01 複檢 #20：從今日待辦直接開這張單的驗收單 */
function tdOpenVerifyForm(no){
  if(typeof openVerifyForm!=='function'){ toast('驗收單功能還沒載入完成，請稍候再試','err'); return; }
  openVerifyForm(no);
}
async function tdOpenOrder(no){
  try{ if(!ORDERS_CACHE) await loadOrders(); }catch(e){}
  if(!ORDERS_CACHE || !ORDERS_CACHE.find(x=>x.no===no)){ toast('找不到這張訂單，請到訂單追蹤看看','err'); return; }
  gotoPage('orders');
  openOrdEdit(no);
}
async function tdOpenCal(id){
  try{ if(!CAL_ITEMS || !CAL_ITEMS.length) await loadCalendar(); }catch(e){}
  gotoPage('cal');
  openCalEdit(id);
}
function tdCopyReminder(ev, no, shipDate){
  if(ev && ev.stopPropagation) ev.stopPropagation();   // 別讓整列的點擊蓋掉這顆鈕（老雷）
  vmCopyReminder(no, shipDate);
}

/* ---- 畫面 ---- */
/* 後端 v35 每筆帶 urgent 旗標（沒帶的一律當成急的，例如行事曆）。
   不急的淡化＋用一條「以下還不急」分隔線隔開；卡片右上角的數字＝急的件數。 */
function tdIsUrgent(o){ return !o || o.urgent !== false; }
function tdRowsHtml(list, rowFn){
  const arr = list || [];
  const urg  = arr.filter(tdIsUrgent);
  const soon = arr.filter(x=>!tdIsUrgent(x));
  let html = urg.map(o=>rowFn(o, false)).join('');
  if(soon.length){
    html += `<div class="td-sep">以下還不急（${soon.length}）</div>` + soon.map(o=>rowFn(o, true)).join('');
  }
  return html;
}
function tdCard(icon, title, list, rowsHtml, emptyTxt){
  const arr = list || [];
  const urgN = arr.filter(tdIsUrgent).length;
  return `<div class="td-card">
    <div class="td-ch">${icon} ${escHtml(title)}<span class="n${urgN?'':' zero'}">${urgN}</span></div>
    ${arr.length ? rowsHtml : `<div class="td-none">✓ ${escHtml(emptyTxt)}</div>`}
  </div>`;
}
/* 寄售請款提醒（2026-07-30 加）：純前端——用登入預抓的寄售客戶檔算「近 3 天內的請款日」，
   不多打任何後端請求。billing_day＝每月幾號請款；到期日已過就看下個月。 */
function tdConsignBilling(){
  try{
    const pk = rcPeek({action:'getConsignCustomers', token:(typeof AUTH_TOKEN!=='undefined'?AUTH_TOKEN:'')});
    const cs = (pk && pk.data && pk.data.customers) || [];
    const now = new Date(); const y=now.getFullYear(), mo=now.getMonth(), dnum=now.getDate();
    const out = [];
    cs.forEach(c=>{
      if(String(c.active||'Y').toUpperCase()==='N') return;
      const bd = parseInt(c.billing_day,10); if(!(bd>=1 && bd<=31)) return;
      const dim  = new Date(y, mo+1, 0).getDate();          // 這個月幾天（請款日 31 號遇小月＝月底）
      let dd = Math.min(bd,dim) - dnum;                     // 距這個月的請款日還幾天
      if(dd < 0){                                            // 這個月已過 → 看下個月
        const dim2 = new Date(y, mo+2, 0).getDate();
        dd = (dim - dnum) + Math.min(bd,dim2);
      }
      if(dd <= 3) out.push({ name:c.name||c.customer_id, customer_id:c.customer_id, bd, dd, urgent: dd===0 });
    });
    out.sort((a,b)=>a.dd-b.dd);
    return out;
  }catch(e){ return []; }
}
function tdOpenConsign(){ gotoPage('consign'); }
/* ⚠ 2026-09-03：今日待辦的「今天／逾期要出貨」也要看得到分批。
   後端 digest 只認訂單追蹤主線的那一個預計出貨日，所以在前端用共用的 orderShipPoints 規則重算一次：
   ①有分批的單 → 換成「該出而還沒出的那幾批」（主線那筆不再列，跟行事曆一致）
   ②主線日期還沒到、但某一批已經到期的單 → 後端根本沒送來，這裡補上
   分批資料來自 shpAllList()（登入後 prefetchCommon 已放進讀取快取），**不會多打任何一次後端**；
   拿不到分批資料時原樣回傳後端的清單，行為完全跟以前一樣。 */
function tdShipDueRows(list){
  const arr=Array.isArray(list)?list.slice():[];
  if(typeof shpAllList!=='function') return arr;
  let all=[]; try{ all=shpAllList(); }catch(e){ return arr; }
  if(!all.length) return arr;
  const byNo={}; arr.forEach(o=>{ byNo[String(o.quote_no||'')]=o; });
  const nos={}; all.forEach(s=>{ if(s.quote_no) nos[String(s.quote_no)]=1; });
  const out=arr.filter(o=>!nos[String(o.quote_no||'')]);          // 沒有分批的單原樣保留
  Object.keys(nos).forEach(no=>{
    const base=byNo[no]||null;
    const pts=(typeof orderShipPoints==='function')?orderShipPoints({no, st:{}}):[];
    pts.forEach(sp=>{
      if(sp.done || !sp.est) return;                              // 已出貨的批次不再催
      const dd=daysBetween(sp.est);
      if(dd==null || dd>0) return;                                // 只列今天與逾期的（跟後端同一條線）
      out.push({ quote_no:no,
        client:(base&&base.client)||((typeof shpClientOf==='function')?shpClientOf(no):'')||'',
        plan_ship_date:sp.est, overdue_days:-dd, urgent:true,
        batch_label:(typeof shpPointLabel==='function')?shpPointLabel(sp):'' });
    });
  });
  out.sort((a,b)=>(b.overdue_days||0)-(a.overdue_days||0));
  return out;
}
function renderToday(){
  const wrap = document.getElementById('td-body'); if(!wrap) return;
  const d = TD_DATA;
  if(!d){ wrap.innerHTML = tdSkeletonHtml(); return; }

  const shipDue   = tdShipDueRows(d.ship_due || []);
  const finalDue  = d.final_due  || [];
  const noScan    = d.no_scan    || [];
  const noInvoice = d.no_invoice || [];
  // 「出貨：XXX」備忘（item_id 為 ship-單號）是舊版存單自動寫進行事曆的，
  // 跟上面的 🚚 出貨卡片重複，這裡不再列一次
  /* 複檢 2026-08-13 #2-5：行事曆設計上不開放給一般使用者（後端 listCalendarItems 是 owner-only），
     但登入回應夾帶的 digest 會把當天的行事曆事項（含「私人」分類）一起送出來，
     阿軒／Vic 登入的第一個畫面就看得到。前端先擋掉；後端也要一起補（見複檢報告第二級）。 */
  const cal       = ((typeof isOwner==='function' && !isOwner()) ? [] : (d.calendar  || []))
                      .filter(it=>!/^ship-/.test(String(it.item_id||'')))
                      .filter(it=>String(it.category||'')!=='私人');   // 2026-09-02：私人行程不進今日待辦（後端 v73 也擋一層）
  const csBill    = tdConsignBilling();
  const total = shipDue.length + finalDue.length + noScan.length + noInvoice.length + cal.length + csBill.length;

  // 後端某區塊讀取失敗時淡淡提示一下（該區塊會是空的，不是真的沒事）
  const warn = (d.warnings && d.warnings.length)
    ? `<div class="ob warn" style="display:block;margin:0 0 12px;padding:9px 13px;font-size:11.5px">有部分資料沒讀到，下面的清單可能不完整：${escHtml(d.warnings.join('；'))}</div>` : '';
  document.getElementById('td-warn').innerHTML = warn;

  if(!total){
    wrap.innerHTML = `<div class="td-alldone"><div class="big">今天都處理完了 🎉</div>
      <div class="sm">沒有逾期出貨、待催尾款、未回報或未開發票的單，行事曆也沒有今天的事項。</div></div>`;
    return;
  }

  // 1. 今天／逾期要出貨
  /* 2026-09-01 複檢 #20：早上從這裡點今天要出貨的那一列，跳出來的是「編輯進度」，
     不是驗收單——她得先關掉彈窗再去別頁找。這裡直接多一顆「驗收單」。 */
  /* 2026-09-01 複檢 #20：早上從這裡點今天要出貨的那一列，跳出來的是「編輯進度」，不是驗收單。
     ⚠ 這一列本身要**維持是 <button class="td-row">**（整列可點、手機版全寬都靠它，
       roleSweep 也是靠 .td-row 判斷「只拿掉點擊、不要整列藏起來」）——所以驗收單鈕放在外層
       包一個 flex 容器當「兄弟」，不要把 td-row 改成 div 包在裡面（我第一版就這樣改壞了兩個既有行為）。 */
  const shipRows = tdRowsHtml(shipDue, (o,dim)=>`<div class="td-rowwrap" style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding-right:12px">
      <button type="button" class="td-row${dim?' dim':''}" style="flex:1 1 280px;min-width:0;border-bottom:none" onclick="tdOpenOrder('${escAttr(o.quote_no)}')">
        <div class="td-r1">${escHtml(o.client||o.quote_no||'—')}
          <span class="td-tag ${o.overdue_days>0?'red':'warn'}">${o.overdue_days>0?('逾期 '+o.overdue_days+' 天'):'今天'}</span></div>
        <div class="td-r2">${escHtml(o.quote_no||'')}${o.batch_label?('　'+escHtml(o.batch_label)):''}　預計出貨 ${escHtml(o.plan_ship_date||'—')}</div>
      </button>
      <button type="button" class="rec-act-btn" style="flex:0 0 auto;white-space:nowrap" title="開這張單的出貨驗收單" onclick="event.stopPropagation();tdOpenVerifyForm('${escAttr(o.quote_no)}')">驗收單</button>
    </div>`);

  // 2. 該催的尾款（金額為推估時標明，只顯示不寫回後端）
  const finalRows = tdRowsHtml(finalDue, (o,dim)=>`<button type="button" class="td-row${dim?' dim':''}" onclick="tdOpenOrder('${escAttr(o.quote_no)}')">
      <div class="td-r1">${escHtml(o.client||o.quote_no||'—')}
        ${o.overdue?`<span class="td-tag red">逾期 ${o.overdue_days} 天</span>`:''}
        ${(!o.overdue && dim && o.days_until!=null)?`<span class="td-tag grey">還有 ${o.days_until} 天</span>`:''}
        ${o.is_estimated?'<span class="td-tag grey">推估</span>':''}
        <span class="td-amt">${money(o.final_amt||0)}</span></div>
      <div class="td-r2">${escHtml(o.quote_no||'')}　預計尾款日 ${escHtml(o.plan_final_date||'未填')}</div>
    </button>`);

  // 3. 掃碼未回報（每列保留既有的「複製催單訊息」）
  /* 2026-09-03：原本整列點下去是 tdOpenVerify()＝只跳到驗收管理首頁的「待處理」分頁，跟你點的那一筆無關。
     照 🚚 出貨卡片同一個寫法：td-row 維持是 <button>（整列可點／手機全寬／roleSweep 都靠它），
     驗收單鈕放在外層 flex 容器當「兄弟」，不要包進 td-row 裡面。 */
  const scanRows = tdRowsHtml(noScan, (o,dim)=>`<div class="td-rowwrap" style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding-right:12px">
      <button type="button" class="td-row${dim?' dim':''}" style="flex:1 1 280px;min-width:0;border-bottom:none" onclick="tdOpenVerifyForm('${escAttr(o.quote_no)}')">
        <div class="td-r1">${escHtml(o.client||o.quote_no||'—')}
          <span class="td-tag warn">${o.days_since==null?'—':('出貨 '+o.days_since+' 天')}</span>
          <span style="margin-left:auto"><span class="td-mini" onclick="tdCopyReminder(event,'${escAttr(o.quote_no)}','${escAttr(o.ship_date||'')}')">複製催單訊息</span></span></div>
        <div class="td-r2">${escHtml(o.quote_no||'')}${o.lot?('　Lot '+escHtml(o.lot)):''}　出貨日 ${escHtml(o.ship_date||'—')}</div>
      </button>
      <button type="button" class="rec-act-btn" style="flex:0 0 auto;white-space:nowrap" title="到驗收管理看全部未回報的單" onclick="event.stopPropagation();tdOpenVerify()">驗收管理</button>
    </div>`);

  // 4. 已出貨未開發票
  const invRows = tdRowsHtml(noInvoice, (o,dim)=>`<button type="button" class="td-row${dim?' dim':''}" onclick="tdOpenOrder('${escAttr(o.quote_no)}')">
      <div class="td-r1">${escHtml(o.client||o.quote_no||'—')}
        <span class="td-tag ${dim?'grey':((o.days_since||0)>14?'red':'warn')}">出貨 ${o.days_since==null?'—':o.days_since} 天</span></div>
      <div class="td-r2">${escHtml(o.quote_no||'')}　出貨日 ${escHtml(o.ship_date||'—')}</div>
    </button>`);

  // 5. 今天的行事曆（沿用行事曆的分類顏色）
  const calRows = tdRowsHtml(cal, (it,dim)=>{
    const c = (typeof CAL_CATEGORY_COLORS!=='undefined' && CAL_CATEGORY_COLORS[it.category]) || null;
    const dot = c ? `<span class="td-dotc" style="background:${c.fg}"></span>` : '';
    return `<button type="button" class="td-row${dim?' dim':''}" onclick="tdOpenCal('${escAttr(it.item_id)}')">
      <div class="td-r1">${dot}${escHtml(it.title||'（無標題）')}
        <span class="td-tag time">${it.all_day||!it.time?'整天':escHtml(it.time)}</span></div>
      ${it.category?`<div class="td-r2">${escHtml(it.category)}</div>`:''}
    </button>`;
  });

  // 6. 寄售請款日（近 3 天內；點了直接去寄售管理產月結）
  const billRows = tdRowsHtml(csBill, (o,dim)=>`<button type="button" class="td-row${dim?' dim':''}" onclick="tdOpenConsign()">
      <div class="td-r1">${escHtml(o.name)}
        <span class="td-tag ${o.dd===0?'red':'warn'}">${o.dd===0?'今天請款！':('還有 '+o.dd+' 天')}</span></div>
      <div class="td-r2">每月 ${o.bd} 號請款　·　點一下去寄售管理產月結</div>
    </button>`);

  // 全部都不急時，先講一句好消息，再把「還不急」的清單列出來
  const urgTotal = [shipDue, finalDue, noScan, noInvoice, cal, csBill]
    .reduce((n, arr)=> n + arr.filter(tdIsUrgent).length, 0);
  const calmBar = urgTotal ? '' :
    `<div class="td-calm">今天沒有急件 🎉　下面是還不急、可以先看看的事情。</div>`;

  wrap.innerHTML = `${calmBar}<div class="td-grid">
    ${tdCard('🚚','今天／逾期要出貨', shipDue, shipRows, '沒有待出貨')}
    ${tdCard('💰','該催的尾款', finalDue, finalRows, '沒有要催的尾款')}
    ${tdCard('📮','客戶還沒回報驗收', noScan, scanRows, '沒有待催回報')}
    ${tdCard('🧾','已出貨未開發票', noInvoice, invRows, '沒有待開發票')}
    ${csBill.length?tdCard('💸','寄售請款日', csBill, billRows, ''):''}
    ${tdCard('📅','今天的行事曆', cal, calRows, '今天沒有排定事項')}
  </div>`;
}
function tdOpenVerify(){ gotoPage('verify'); }
