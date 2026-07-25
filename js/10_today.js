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
    // A. 今天／逾期該出貨
    if(['cancelled','closed','paid','shipped','invoiced'].indexOf(s) < 0 && st.ship_date_est && !st.ship_date_actual){
      const dd = daysBetween(vmLocalYmd(st.ship_date_est));
      if(dd != null && dd <= 0) out.ship_due.push({ quote_no:o.no, client:cli(o), plan_ship_date:vmLocalYmd(st.ship_date_est), overdue_days:-dd });
    }
    // B. 該催的尾款（沿用月報表邏輯：已出貨/已開發票、尾款日空白；只留 7 天內到期／逾期／沒填預計日）
    if((s==='shipped' || s==='invoiced') && !st.final_date){
      const planned = st.final_date_est ? vmLocalYmd(st.final_date_est) : '';
      const ahead = planned ? daysBetween(planned) : null;
      if(!(ahead != null && ahead > 7)){
        let amt, isEst = false;
        if(st.final_amt !== '' && st.final_amt != null) amt = Number(st.final_amt) || 0;
        else { amt = (Number(st.grand_total) || Number(o.total) || 0) - (Number(st.deposit_amt) || 0); isEst = true; }
        out.final_due.push({ quote_no:o.no, client:cli(o), final_amt:amt, is_estimated:isEst, plan_final_date:planned,
          overdue:(ahead != null && ahead < 0), overdue_days:(ahead != null && ahead < 0) ? -ahead : 0 });
      }
    }
    // D. 已出貨未開發票（只列超過 7 天的）
    if(s === 'shipped' && !st.invoice_date && st.ship_date_actual){
      const dd = daysBetween(vmLocalYmd(st.ship_date_actual));
      if(dd != null && -dd > 7) out.no_invoice.push({ quote_no:o.no, client:cli(o), ship_date:vmLocalYmd(st.ship_date_actual), days_since:-dd });
    }
  });
  out.ship_due.sort((a,b)=>b.overdue_days-a.overdue_days);
  out.final_due.sort((a,b)=>String(a.plan_final_date||'9999-12-31').localeCompare(String(b.plan_final_date||'9999-12-31')));
  out.no_invoice.sort((a,b)=>(b.days_since||0)-(a.days_since||0));

  // C. 掃碼未回報：直接沿用出貨驗收管理那份現成邏輯
  try{
    (vmNoReportList()||[]).forEach(x=>out.no_scan.push({ quote_no:x.no, client:x.client, ship_date:x.shipDate, days_since:x.days }));
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
function tdCard(icon, title, count, rowsHtml, emptyTxt){
  return `<div class="td-card">
    <div class="td-ch">${icon} ${escHtml(title)}<span class="n${count?'':' zero'}">${count}</span></div>
    ${count ? rowsHtml : `<div class="td-none">✓ ${escHtml(emptyTxt)}</div>`}
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
  const shipRows = shipDue.map(o=>`<button type="button" class="td-row" onclick="tdOpenOrder('${escAttr(o.quote_no)}')">
      <div class="td-r1">${escHtml(o.client||o.quote_no||'—')}
        <span class="td-tag ${o.overdue_days>0?'red':'warn'}">${o.overdue_days>0?('逾期 '+o.overdue_days+' 天'):'今天'}</span></div>
      <div class="td-r2">${escHtml(o.quote_no||'')}　預計出貨 ${escHtml(o.plan_ship_date||'—')}</div>
    </button>`).join('');

  // 2. 該催的尾款（金額為推估時標明，只顯示不寫回後端）
  const finalRows = finalDue.map(o=>`<button type="button" class="td-row" onclick="tdOpenOrder('${escAttr(o.quote_no)}')">
      <div class="td-r1">${escHtml(o.client||o.quote_no||'—')}
        ${o.overdue?`<span class="td-tag red">逾期 ${o.overdue_days} 天</span>`:''}
        ${o.is_estimated?'<span class="td-tag grey">推估</span>':''}
        <span class="td-amt">${money(o.final_amt||0)}</span></div>
      <div class="td-r2">${escHtml(o.quote_no||'')}　預計尾款日 ${escHtml(o.plan_final_date||'未填')}</div>
    </button>`).join('');

  // 3. 掃碼未回報（每列保留既有的「複製催單訊息」）
  const scanRows = noScan.map(o=>`<button type="button" class="td-row" onclick="tdOpenVerify()">
      <div class="td-r1">${escHtml(o.client||o.quote_no||'—')}
        <span class="td-tag warn">${o.days_since==null?'—':('出貨 '+o.days_since+' 天')}</span>
        <span style="margin-left:auto"><span class="td-mini" onclick="tdCopyReminder(event,'${escAttr(o.quote_no)}','${escAttr(o.ship_date||'')}')">複製催單訊息</span></span></div>
      <div class="td-r2">${escHtml(o.quote_no||'')}${o.lot?('　Lot '+escHtml(o.lot)):''}　出貨日 ${escHtml(o.ship_date||'—')}</div>
    </button>`).join('');

  // 4. 已出貨未開發票
  const invRows = noInvoice.map(o=>`<button type="button" class="td-row" onclick="tdOpenOrder('${escAttr(o.quote_no)}')">
      <div class="td-r1">${escHtml(o.client||o.quote_no||'—')}
        <span class="td-tag ${(o.days_since||0)>14?'red':'warn'}">出貨 ${o.days_since==null?'—':o.days_since} 天</span></div>
      <div class="td-r2">${escHtml(o.quote_no||'')}　出貨日 ${escHtml(o.ship_date||'—')}</div>
    </button>`).join('');

  // 5. 今天的行事曆（沿用行事曆的分類顏色）
  const calRows = cal.map(it=>{
    const c = (typeof CAL_CATEGORY_COLORS!=='undefined' && CAL_CATEGORY_COLORS[it.category]) || null;
    const dot = c ? `<span class="td-dotc" style="background:${c.fg}"></span>` : '';
    return `<button type="button" class="td-row" onclick="tdOpenCal('${escAttr(it.item_id)}')">
      <div class="td-r1">${dot}${escHtml(it.title||'（無標題）')}
        <span class="td-tag time">${it.all_day||!it.time?'整天':escHtml(it.time)}</span></div>
      ${it.category?`<div class="td-r2">${escHtml(it.category)}</div>`:''}
    </button>`;
  }).join('');

  wrap.innerHTML = `<div class="td-grid">
    ${tdCard('🚚','今天／逾期要出貨', shipDue.length, shipRows, '沒有待出貨')}
    ${tdCard('💰','該催的尾款', finalDue.length, finalRows, '沒有要催的尾款')}
    ${tdCard('📮','客戶還沒回報驗收', noScan.length, scanRows, '沒有待催回報')}
    ${tdCard('🧾','已出貨未開發票', noInvoice.length, invRows, '沒有待開發票')}
    ${tdCard('📅','今天的行事曆', cal.length, calRows, '今天沒有排定事項')}
  </div>`;
}
function tdOpenVerify(){ gotoPage('verify'); }
