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
    const st = o.st || {}; const s = String(st.status||'quoted');
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
    if(s === 'shipped' && !st.invoice_no){
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
    (vmNoReportList()||[]).forEach(x=>out.no_scan.push({ quote_no:x.no, client:x.client, ship_date:x.shipDate, days_since:x.days, urgent:true }));
  }catch(e){ out.warnings.push('未回報清單讀取失敗'); }

  // E. 今天的行事曆（備忘＋重複行程，比照行事曆頁的判定）
  try{
    const d = new Date(today + 'T00:00:00');
    (CAL_ITEMS||[]).forEach(it=>{
      let hit = false;
      if(it.kind === 'memo') hit = (vmLocalYmd(it.date) === today && it.done !== 'Y');
      else if(it.kind === 'recur'){
        const r = parseJsonSafe(it.recur_json, {});
        hit = (r.freq==='weekly' && d.getDay()===(r.weekday==null?-1:Number(r.weekday)))
           || (r.freq==='monthly' && d.getDate()===Number(r.day||0) && monthlyIntervalHit(r,d))
           || (r.freq==='yearly' && (d.getMonth()+1)===Number(r.month||0) && d.getDate()===Number(r.day||0));
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
function renderToday(){
  const wrap = document.getElementById('td-body'); if(!wrap) return;
  const d = TD_DATA;
  if(!d){ wrap.innerHTML = tdSkeletonHtml(); return; }

  const shipDue   = d.ship_due   || [];
  const finalDue  = d.final_due  || [];
  const noScan    = d.no_scan    || [];
  const noInvoice = d.no_invoice || [];
  const cal       = d.calendar   || [];
  const total = shipDue.length + finalDue.length + noScan.length + noInvoice.length + cal.length;

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
  const shipRows = tdRowsHtml(shipDue, (o,dim)=>`<button type="button" class="td-row${dim?' dim':''}" onclick="tdOpenOrder('${escAttr(o.quote_no)}')">
      <div class="td-r1">${escHtml(o.client||o.quote_no||'—')}
        <span class="td-tag ${o.overdue_days>0?'red':'warn'}">${o.overdue_days>0?('逾期 '+o.overdue_days+' 天'):'今天'}</span></div>
      <div class="td-r2">${escHtml(o.quote_no||'')}　預計出貨 ${escHtml(o.plan_ship_date||'—')}</div>
    </button>`);

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
  const scanRows = tdRowsHtml(noScan, (o,dim)=>`<button type="button" class="td-row${dim?' dim':''}" onclick="tdOpenVerify()">
      <div class="td-r1">${escHtml(o.client||o.quote_no||'—')}
        <span class="td-tag warn">${o.days_since==null?'—':('出貨 '+o.days_since+' 天')}</span>
        <span style="margin-left:auto"><span class="td-mini" onclick="tdCopyReminder(event,'${escAttr(o.quote_no)}','${escAttr(o.ship_date||'')}')">複製催單訊息</span></span></div>
      <div class="td-r2">${escHtml(o.quote_no||'')}${o.lot?('　Lot '+escHtml(o.lot)):''}　出貨日 ${escHtml(o.ship_date||'—')}</div>
    </button>`);

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

  // 全部都不急時，先講一句好消息，再把「還不急」的清單列出來
  const urgTotal = [shipDue, finalDue, noScan, noInvoice, cal]
    .reduce((n, arr)=> n + arr.filter(tdIsUrgent).length, 0);
  const calmBar = urgTotal ? '' :
    `<div class="td-calm">今天沒有急件 🎉　下面是還不急、可以先看看的事情。</div>`;

  wrap.innerHTML = `${calmBar}<div class="td-grid">
    ${tdCard('🚚','今天／逾期要出貨', shipDue, shipRows, '沒有待出貨')}
    ${tdCard('💰','該催的尾款', finalDue, finalRows, '沒有要催的尾款')}
    ${tdCard('📮','客戶還沒回報驗收', noScan, scanRows, '沒有待催回報')}
    ${tdCard('🧾','已出貨未開發票', noInvoice, invRows, '沒有待開發票')}
    ${tdCard('📅','今天的行事曆', cal, calRows, '今天沒有排定事項')}
  </div>`;
}
function tdOpenVerify(){ gotoPage('verify'); }
