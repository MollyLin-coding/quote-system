/* ============================================================
   四、工作行事曆
   ============================================================ */
/* 行事曆：訂單日程與備忘同時要（以前是一個等一個），兩邊都走讀取快取 */
async function loadCalendar(force){
  const P={ action:'listCalendarItems', token:AUTH_TOKEN };
  const hit=rcPeek(P);
  if(!force && hit && hit.data){ CAL_ITEMS = hit.data.ok ? (hit.data.items||[]) : []; renderCalendar(); }
  const pOrders = loadOrders(force).then(()=>renderCalendar()).catch(()=>{ /* orders 失敗仍可顯示備忘 */ });
  if(force || !rcFresh(P)){
    try{
      const d=await readCall(P, force);
      CAL_ITEMS = d.ok ? (d.items||[]) : [];
    }catch(e){ if(!hit) CAL_ITEMS=[]; toast(e.message||'行事曆載入失敗','err'); }
  }
  renderCalendar();
  await pOrders;
  renderCalendar();
}
onCacheClear(function(){ CAL_ITEMS=[]; });
/* 「出貨：XXX」備忘＝舊版「存單自動寫進行事曆」留下的（item_id 為 ship-單號、source_quote_no 有值）。
   現在訂單追蹤那邊會自動長出 🚚 出貨事件（同一天會出現兩筆），
   所以只要訂單那邊有這張單的出貨日，這種備忘就不再顯示，以訂單追蹤為準。 */
function calShipMemoDup(it){
  const sq=String(it.source_quote_no||'').trim();
  const isShip=sq || /^ship-/.test(String(it.item_id||''));
  if(!isShip) return false;
  const no=sq || String(it.item_id||'').replace(/^ship-/,'');
  const o=(ORDERS_CACHE||[]).find(x=>String(x.no)===String(no));
  return !!(o && o.st && (o.st.ship_date_est||o.st.ship_date_actual));
}
/* 產生某日的全部事件 */
function eventsOn(dstr){
  const evs=[];
  const d=new Date(dstr+'T00:00:00');
  if(CAL_KINDS.order){
    (ORDERS_CACHE||[]).forEach(o=>{
      const s=o.st?.status||'quoted';
      if(s==='cancelled') return;
      if(o.st?.ship_date_est===dstr && !o.st?.ship_date_actual) evs.push({t:'ship', txt:'🚚 '+o.client.split('｜')[0]+' 出貨', no:o.no});
      if(o.st?.ship_date_actual===dstr) evs.push({t:'ship', txt:'🚚 '+o.client.split('｜')[0]+' 出貨 ✓', no:o.no});
      if(s==='quoted' && o.expiry===dstr) evs.push({t:'exp', txt:'⏰ '+o.client.split('｜')[0]+' 報價到期', no:o.no});
    });
  }
  CAL_ITEMS.forEach(it=>{
    const timeTxt = (it.all_day!=='Y' && it.time) ? it.time+' ' : '';
    if(it.kind==='memo' && CAL_KINDS.memo && calCatOn(it.category) && !calShipMemoDup(it)){
      if(it.date===dstr) evs.push({t:'memo', txt:'📌 '+timeTxt+it.title, item:it, done:it.done==='Y', time:timeTxt?it.time:''});
    }
    if(it.kind==='recur' && CAL_KINDS.recur && calCatOn(it.category)){
      const r=parseJsonSafe(it.recur_json,{});
      const hit=(r.freq==='weekly'&&d.getDay()===(r.weekday??-1))
        || (r.freq==='monthly'&&d.getDate()===(r.day||0)&&monthlyIntervalHit(r,d))
        || (r.freq==='yearly'&&d.getMonth()+1===(r.month||0)&&d.getDate()===(r.day||0));
      if(hit) evs.push({t:'recur', txt:'🔁 '+timeTxt+it.title, item:it, time:timeTxt?it.time:''});
    }
  });
  /* 全天／無時間的事項排前面，有指定時間的依時間排序 */
  evs.sort((a,b)=>(a.time||'').localeCompare(b.time||''));
  return evs;
}
function renderCalendar(){
  const el=document.getElementById('cal-root'); if(!el) return;
  renderTodayFocus();
  document.querySelectorAll('#cal-views .fchip').forEach(b=>b.classList.toggle('on', b.dataset.v===CAL_VIEW));
  document.querySelectorAll('#cal-filters .fchip').forEach(b=>{ if(b.dataset.f!=='all') b.classList.toggle('on', !!CAL_KINDS[b.dataset.f]); });
  const _allOn = CAL_KINDS.order && CAL_KINDS.memo && CAL_KINDS.recur && calCatList().every(c=>calCatOn(c));
  const _ab=document.querySelector('#cal-filters .fchip[data-f="all"]'); if(_ab) _ab.classList.toggle('on', _allOn);
  renderCalCatBar();
  if(CAL_VIEW==='month') renderCalMonth(el);
  else if(CAL_VIEW==='week') renderCalList(el, 7, '本週起 7 天');
  else renderCalList(el, 30, '未來 30 天');
  renderTodoList();
}
function calEvHtml(e){
  const cls={ship:'ship',exp:'exp',memo:'memo',recur:'recur'}[e.t];
  /* event.stopPropagation()：月曆檢視下事件標籤疊在「當日格子」上面，格子本身也有 onclick（新增事項），
     沒擋住冒泡的話點標籤會先開編輯視窗、又立刻被冒泡上去的「新增事項」蓋掉，變成永遠打不開編輯/刪除 */
  const click=e.no?`onclick="event.stopPropagation();gotoPage('orders')"`:(e.item?`onclick="event.stopPropagation();openCalEdit('${escHtml(e.item.item_id)}')"`:'');
  /* memo／recur 依「分類」上色；ship／exp（訂單自動事件）維持原本固定配色 */
  let style='';
  if((e.t==='memo'||e.t==='recur') && e.item){
    const c=CAL_CATEGORY_COLORS[e.item.category];
    if(c) style=` style="background:${c.bg};color:${c.fg};border-color:${c.bd}"`;
  }
  return `<span class="cev ${cls}${e.done?' done':''}"${style} ${click}>${escHtml(e.txt)}</span>`;
}
function renderCalMonth(el){
  const first=new Date(CAL_Y, CAL_M, 1);
  const startDow=(first.getDay()+6)%7;   // 週一為第 0 欄、週日為第 6 欄
  const daysIn=new Date(CAL_Y, CAL_M+1, 0).getDate();
  const today=fmtD(new Date());
  let cells='';
  ['一','二','三','四','五','六','日'].forEach(w=>cells+=`<div class="cwd">${w}</div>`);
  for(let i=0;i<startDow;i++) cells+='<div class="cd dim"></div>';
  for(let d=1;d<=daysIn;d++){
    const ds=`${CAL_Y}-${String(CAL_M+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dow=new Date(CAL_Y,CAL_M,d).getDay();   // 0=日...6=六（僅用來判斷是否為六日，跟顯示順序無關）
    const isWeekend=dow===0||dow===6;
    const hol=TAIWAN_HOLIDAYS[ds];
    const worship=isWorshipDay(ds);
    const evs=eventsOn(ds);
    const cls='cd'+(ds===today?' today':'')+(isWeekend?' weekend':'')+(hol?' holiday':'');
    cells+=`<div class="${cls}" onclick="openCalAdd('${ds}')">
      <span class="n">${d}${ds===today?' 今天':''}${worship?'<span class="lunar-mark">🙏</span>':''}</span>${hol?`<span class="holname">${escHtml(hol)}</span>`:''}${evs.map(calEvHtml).join('')}</div>`;
  }
  el.innerHTML=`<div class="calhead">
    <span class="qf-chip act" onclick="CAL_M--;if(CAL_M<0){CAL_M=11;CAL_Y--;}renderCalendar()">◀ 上月</span>
    <b style="font-size:14px">${CAL_Y} 年 ${CAL_M+1} 月</b>
    <span class="qf-chip act" onclick="CAL_M++;if(CAL_M>11){CAL_M=0;CAL_Y++;}renderCalendar()">下月 ▶</span>
    <span style="flex:1"></span>
    <button class="btn btn-gold" style="font-size:12px;padding:6px 14px" onclick="openCalAdd('')">＋ 新增事項</button>
  </div><div class="cal">${cells}</div>
  <div class="cal-legend">🚚 出貨（訂單自動）　⏰ 報價到期（自動）　📌 備忘　🔁 重複行程　🙏 拜拜日（農曆初二／十六，自動換算）　紅字＝國定假日　※ 點日期格可直接新增事項；點訂單事件跳到訂單追蹤　｜　顏色依「分類」自動區分：${Object.entries(CAL_CATEGORY_COLORS).map(([name,c])=>`<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${c.fg};margin:0 3px 0 8px;vertical-align:middle"></span>${name}`).join('')}</div>`;
}
function renderCalList(el, days, title){
  const t=new Date(); t.setHours(0,0,0,0);
  let h=`<div class="calhead"><b style="font-size:14px">${title}</b><span style="flex:1"></span>
    <button class="btn btn-gold" style="font-size:12px;padding:6px 14px" onclick="openCalAdd('')">＋ 新增事項</button></div>`;
  let any=false;
  for(let i=0;i<days;i++){
    const d=new Date(t); d.setDate(t.getDate()+i);
    const ds=fmtD(d);
    const evs=eventsOn(ds);
    const hol=TAIWAN_HOLIDAYS[ds];
    const worship=isWorshipDay(ds);
    if(!evs.length && !hol && !worship) continue;
    any=true;
    const tag=(hol?` · <span style="color:#B03A2E;font-weight:600">${escHtml(hol)}</span>`:'')+(worship?' · 🙏拜拜日（農曆初二／十六）':'');
    h+=`<div class="cal-day"><div class="cal-day-h">${ds.slice(5)}（${'一二三四五六日'[(d.getDay()+6)%7]}）${i===0?'・今天':''}${tag}</div>${evs.map(calEvHtml).join(' ')}</div>`;
  }
  if(!any) h+='<div class="rec-empty">這段期間沒有事項</div>';
  el.innerHTML=h;
}
function renderTodayFocus(){
  const el=document.getElementById('cal-focus'); if(!el) return;
  const items=[];
  // 逾期備忘（未完成）；左邊有個圈圈，打勾＝完成，之後不再出現在焦點
  CAL_ITEMS.filter(it=>it.kind==='memo'&&it.done!=='Y'&&it.date&&!calShipMemoDup(it)).forEach(it=>{
    const d=daysBetween(it.date);
    const box=`<span class="fdone" title="打勾＝標記完成，不再顯示於焦點" onclick="event.stopPropagation();calFocusDone('${escAttr(it.item_id)}')"></span>`;
    if(d!=null&&d<0) items.push({o:d,h:`${box}<span class="ob red">逾期 ${-d} 天</span> 📌 ${escHtml(it.title)}`,click:`openCalEdit('${escHtml(it.item_id)}')`});
    else if(d!=null&&d<=7) items.push({o:d,h:`${box}<span class="ob warn">${d===0?'今天':d+' 天後'}</span> 📌 ${escHtml(it.title)}`,click:`openCalEdit('${escHtml(it.item_id)}')`});
  });
  (ORDERS_CACHE||[]).forEach(o=>{
    const s=effOrdStatus(o.st);
    if(s==='cancelled'||s==='closed'||s==='paid') return;
    if(o.st?.ship_date_est&&!o.st?.ship_date_actual){
      const d=daysBetween(o.st.ship_date_est);
      if(d!=null&&d<0) items.push({o:d,h:`<span class="ob red">出貨逾期 ${-d} 天</span> 🚚 ${escHtml(o.client.split('｜')[0])}（${escHtml(o.no)}）`,click:`gotoPage('orders')`});
      else if(d!=null&&d<=7) items.push({o:d,h:`<span class="ob warn">${d===0?'今天':d+' 天後'}</span> 🚚 ${escHtml(o.client.split('｜')[0])} 出貨（${escHtml(o.no)}）`,click:`gotoPage('orders')`});
    }
    if(s==='quoted'&&o.expiry){
      const d=daysBetween(o.expiry);
      if(d!=null&&d>=0&&d<=7) items.push({o:d,h:`<span class="ob red">有效期剩 ${d} 天</span> ⏰ ${escHtml(o.client.split('｜')[0])}（${escHtml(o.no)}）`,click:`gotoPage('orders')`});
    }
    if(s==='shipped') items.push({o:99,h:`<span class="ob warn">待開發票</span> 💰 ${escHtml(o.client.split('｜')[0])}（${escHtml(o.no)}）`,click:`gotoPage('orders')`});
    if(s==='invoiced') items.push({o:99,h:`<span class="ob warn">待收尾款</span> 💰 ${escHtml(o.client.split('｜')[0])}（${escHtml(o.no)}）${o.st?.final_amt?'尾款 '+money(o.st.final_amt):''}`,click:`gotoPage('orders')`});
  });
  items.sort((a,b)=>a.o-b.o);
  el.innerHTML=`<div class="ph" style="font-weight:700;font-size:13px;margin-bottom:6px">今日焦點 — ${fmtD(new Date()).slice(5)}<span style="color:#A8A69C;font-weight:400;font-size:11px">　今天＋未來 7 天；逾期自動標紅；📌 備忘做完了就點左邊圈圈打勾</span></div>`+
    (items.length?items.map(i=>`<div class="focus-row" onclick="${i.click}">${i.h}</div>`).join(''):'<div style="color:#A8A69C;font-size:12.5px">目前沒有需要注意的事項 ✓</div>');
}
function renderTodoList(){
  const el=document.getElementById('cal-todos'); if(!el) return;
  const todos=CAL_ITEMS.filter(it=>it.kind==='todo');
  el.innerHTML=`<div class="ph" style="font-weight:700;font-size:13px;margin-bottom:4px">待辦清單（不指定日期）<span style="color:#A8A69C;font-weight:400;font-size:11px">　做完打勾</span></div>`+
    (todos.length?todos.sort((a,b)=>(a.done||'N').localeCompare(b.done||'N')||(b.priority==='high')-(a.priority==='high')).map(it=>
      `<div class="todo-row${it.done==='Y'?' done':''}">
        <span class="tbox" onclick="toggleTodoDone('${escHtml(it.item_id)}')">${it.done==='Y'?'✓':''}</span>
        <span class="ttl" onclick="openCalEdit('${escHtml(it.item_id)}')">${escHtml(it.title)}${it.priority==='high'?' <span class="ob warn">優先</span>':''}</span>
      </div>`).join(''):'<div style="color:#A8A69C;font-size:12.5px">目前沒有待辦</div>')+
    `<div style="margin-top:8px"><button class="rec-act-btn" onclick="openCalAdd('', 'todo')">＋ 新增待辦</button></div>`;
}
async function toggleTodoDone(id){
  const it=CAL_ITEMS.find(x=>String(x.item_id)===String(id)); if(!it) return;
  const prevDone=it.done, prevDate=it.done_date;   // 記住原狀態，失敗時可回復
  it.done = it.done==='Y'?'N':'Y';
  it.done_date = it.done==='Y'?fmtD(new Date()):'';
  renderCalendar();
  const snap=CAL_ITEMS;                            // apiCall（寫入類）會清空 CAL_ITEMS，先留一份
  try{
    const d=await apiCall({ action:'saveCalendarItem', token:AUTH_TOKEN, item:it });
    if(!d.ok) throw new Error(d.error||'儲存失敗');
    CAL_ITEMS=snap; renderCalendar();              // 畫面即刻反映（這筆已是改好的），背景再同步
    loadCalendar().catch(()=>{});
  }
  catch(e){
    CAL_ITEMS=snap;
    it.done=prevDone; it.done_date=prevDate; renderCalendar();   // 回復畫面，避免以為打勾了其實沒存到
    toast('同步失敗，已還原：'+e.message,'err');
  }
}
/* 今日焦點的「打勾＝完成」：備忘標成已完成（跟待辦清單同一套存法，可到月曆點該筆再取消） */
function calFocusDone(id){
  const it=CAL_ITEMS.find(x=>String(x.item_id)===String(id)); if(!it||it.done==='Y') return;
  toggleTodoDone(id);
  toast('已完成：'+(it.title||'')+'（要復原可在行事曆點這筆，取消「已完成」）','ok');
}
/* 新增／編輯事項 */
let CAL_EDIT_ID=null;
function openCalAdd(dstr, kind){
  CAL_EDIT_ID=null;
  document.getElementById('ce-title-h').textContent='新增事項';
  document.getElementById('ce-del').style.display='none';
  document.getElementById('ce-kind').value=kind||(dstr?'memo':'memo');
  document.getElementById('ce-date').value=dstr||fmtD(new Date());
  ['ce-title','ce-detail'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('ce-category').value='工作';
  document.getElementById('ce-priority').checked=false;
  { const dc=document.getElementById('ce-done'); if(dc) dc.checked=false; }
  document.getElementById('ce-allday').checked=true;
  document.getElementById('ce-time').value='';
  document.getElementById('ce-time-end').value='';
  document.getElementById('ce-freq').value='weekly';
  document.getElementById('ce-weekday').value='1';
  document.getElementById('ce-mday').value='5';
  document.getElementById('ce-interval').value='1';
  onCalKindChange();
  onAllDayChange();
  onCalCategoryChange();
  document.getElementById('ce-overlay').style.display='flex';
}
function openCalEdit(id){
  const it=CAL_ITEMS.find(x=>String(x.item_id)===String(id)); if(!it) return;
  CAL_EDIT_ID=id;
  document.getElementById('ce-title-h').textContent='編輯事項';
  document.getElementById('ce-del').style.display='inline-block';
  document.getElementById('ce-kind').value=it.kind;
  document.getElementById('ce-date').value=it.date||fmtD(new Date());
  document.getElementById('ce-title').value=it.title||'';
  document.getElementById('ce-detail').value=it.detail||'';
  document.getElementById('ce-category').value=it.category||'工作';
  document.getElementById('ce-priority').checked=it.priority==='high';
  { const dc=document.getElementById('ce-done'); if(dc) dc.checked=(it.done==='Y'); }
  // 全天／時間：舊資料沒有 all_day 欄位時，視為全天（維持原本沒有時間的行為）
  document.getElementById('ce-allday').checked=(it.all_day!=='N');
  // time 欄可能是 "14:00" 或 "14:00-15:30"（幾點到幾點）
  const tparts=String(it.time||'').split('-');
  document.getElementById('ce-time').value=(tparts[0]||'').trim();
  document.getElementById('ce-time-end').value=(tparts[1]||'').trim();
  const r=parseJsonSafe(it.recur_json,{});
  document.getElementById('ce-freq').value=r.freq||'weekly';
  document.getElementById('ce-weekday').value=String(r.weekday??1);
  document.getElementById('ce-mon').value=String(r.month||1);
  document.getElementById('ce-mday').value=String(r.day||5);
  document.getElementById('ce-interval').value=String(r.interval||1);
  onCalKindChange();
  onAllDayChange();
  onCalCategoryChange();
  document.getElementById('ce-overlay').style.display='flex';
}
function onCalKindChange(){
  const k=document.getElementById('ce-kind').value;
  document.getElementById('ce-date-wrap').style.display = k==='memo'?'block':'none';
  document.getElementById('ce-recur-wrap').style.display = k==='recur'?'block':'none';
  document.getElementById('ce-pri-wrap').style.display = k==='todo'?'inline-flex':'none';
  // 「已完成」勾選：編輯既有的備忘才顯示（新增的當然還沒完成；待辦在清單上打勾就好）
  { const dw=document.getElementById('ce-done-wrap'); if(dw) dw.style.display = (k==='memo'&&CAL_EDIT_ID)?'inline-flex':'none'; }
  // 全天／時間：指定日期備忘、重複行程才需要（待辦不指定日期，時間沒有意義）
  document.getElementById('ce-time-wrap').style.display = (k==='memo'||k==='recur')?'block':'none';
  const f=document.getElementById('ce-freq').value;
  document.getElementById('ce-weekday').style.display = f==='weekly'?'inline-block':'none';
  document.getElementById('ce-mon').style.display = f==='yearly'?'inline-block':'none';   // 每年才顯示月份
  document.getElementById('ce-mday').style.display = f!=='weekly'?'inline-block':'none';
  document.getElementById('ce-interval-wrap').style.display = (f==='monthly')?'inline-flex':'none'; // 「每 N 個月」間隔只在每月顯示
  document.getElementById('ce-interval-hint').style.display = (k==='recur'&&f==='monthly')?'block':'none';
}
function onAllDayChange(){
  const ad=document.getElementById('ce-allday').checked;
  const row=document.getElementById('ce-time-row');
  if(row) row.style.display = ad ? 'none' : 'flex';
  if(ad){ document.getElementById('ce-time').value=''; document.getElementById('ce-time-end').value=''; }
}
/* 時間吸附到 5 分鐘（14:03→14:05）；空值原樣回傳 */
function calSnap5(v){
  const m=String(v||'').match(/^(\d{1,2}):(\d{2})/);
  if(!m) return '';
  let h=parseInt(m[1],10), mi=Math.round(parseInt(m[2],10)/5)*5;
  if(mi===60){ mi=0; h=(h+1)%24; }
  return String(h).padStart(2,'0')+':'+String(mi).padStart(2,'0');
}
function onCalCategoryChange(){
  const cat=document.getElementById('ce-category').value;
  const c=CAL_CATEGORY_COLORS[cat];
  const dot=document.getElementById('ce-cat-dot');
  if(dot) dot.style.background = c ? c.fg : '#CCC';
}
function closeCalEdit(){ document.getElementById('ce-overlay').style.display='none'; CAL_EDIT_ID=null; }
/* 每月重複的「每 N 個月」間隔判斷：從錨點月份起算、每 interval 個月才命中；沒 interval 或沒錨點＝維持每月（相容舊資料）*/
function monthlyIntervalHit(r,d){
  const iv=r&&r.interval?r.interval:1;
  if(iv<=1) return true;
  if(r.anchorYm==null) return true;
  const dYm=d.getFullYear()*12+d.getMonth();
  const diff=dYm-r.anchorYm;
  return diff>=0 && diff%iv===0;
}
async function saveCalItem(){
  if(_busy.calSave) return;
  const k=document.getElementById('ce-kind').value;
  const title=document.getElementById('ce-title').value.trim();
  if(!title){ toast('請輸入標題','err'); return; }
  _busy.calSave=true;
  let recur='';
  if(k==='recur'){
    const f=document.getElementById('ce-freq').value;
    if(f==='monthly'){
      const interval=Math.max(1, parseInt(document.getElementById('ce-interval').value)||1);
      const day=parseInt(document.getElementById('ce-mday').value)||1;
      const o={freq:'monthly', day, interval};
      if(interval>1){
        // 錨點月份：編輯時沿用舊錨點（不打亂既有排程），新建/舊資料升級時用本次儲存的月份
        const prior = CAL_EDIT_ID ? parseJsonSafe((CAL_ITEMS.find(x=>String(x.item_id)===String(CAL_EDIT_ID))||{}).recur_json,{}) : {};
        const now=new Date();
        o.anchorYm = (prior && prior.anchorYm!=null) ? prior.anchorYm : (now.getFullYear()*12+now.getMonth());
      }
      recur = JSON.stringify(o);
    } else {
      recur = f==='weekly' ? JSON.stringify({freq:'weekly',weekday:parseInt(document.getElementById('ce-weekday').value)})
            : JSON.stringify({freq:'yearly',month:parseInt(document.getElementById('ce-mon').value)||1,day:parseInt(document.getElementById('ce-mday').value)||1});
    }
  }
  const existing = CAL_EDIT_ID ? CAL_ITEMS.find(x=>String(x.item_id)===String(CAL_EDIT_ID)) : null;
  const hasTime = (k==='memo'||k==='recur');
  const allDay = hasTime ? document.getElementById('ce-allday').checked : true;
  // 指定時間＝幾點到幾點：吸附 5 分鐘；結束可留空（只記開始）；存成 "14:00" 或 "14:00-15:30"
  let calTimeStr='';
  if(hasTime && !allDay){
    const t1=calSnap5(document.getElementById('ce-time').value);
    const t2=calSnap5(document.getElementById('ce-time-end').value);
    if(t2 && !t1){ toast('請先填開始時間','err'); _busy.calSave=false; return; }
    if(t1 && t2 && t2<=t1){ toast('結束時間要晚於開始時間','err'); _busy.calSave=false; return; }
    calTimeStr = t1 ? (t1+(t2?'-'+t2:'')) : '';
  }
  const item={
    item_id: CAL_EDIT_ID || ('ci-'+Date.now()+'-'+Math.floor(Math.random()*1000)),
    kind:k, date:k==='memo'?document.getElementById('ce-date').value:'',
    recur_json:recur, title, detail:document.getElementById('ce-detail').value,
    category:document.getElementById('ce-category').value,
    priority:(k==='todo'&&document.getElementById('ce-priority').checked)?'high':'normal',
    all_day: hasTime ? (allDay?'Y':'N') : 'Y',
    time: calTimeStr,
    done: existing?existing.done:'N', done_date: existing?existing.done_date:''
  };
  // 編輯備忘時可直接勾/取消「已完成」（完成的不會出現在今日焦點與今日待辦）
  if(k==='memo' && CAL_EDIT_ID){
    const dc=document.getElementById('ce-done');
    if(dc){
      const nv=dc.checked?'Y':'N';
      if(nv!==item.done){ item.done=nv; item.done_date = nv==='Y'?fmtD(new Date()):''; }
    }
  }
  const snap=CAL_ITEMS;                       // apiCall（寫入類）會把 CAL_ITEMS 清空，先留一份
  const saveBtn=document.getElementById('ce-save');
  if(saveBtn){ saveBtn.disabled=true; saveBtn.textContent='儲存中…'; }
  try{
    const d=await apiCall({ action:'saveCalendarItem', token:AUTH_TOKEN, item });
    if(!d.ok){ toast(d.error||'儲存失敗','err'); return; }
    // 先把存好的這筆直接放進畫面（0 秒），背景再跟後端要最新的
    CAL_ITEMS=(snap||[]).filter(x=>String(x.item_id)!==String(item.item_id)).concat([item]);
    closeCalEdit(); toast('已儲存','ok');
    renderCalendar();
    loadCalendar().catch(()=>{});
  }catch(e){ toast(e.message||'儲存失敗','err'); }
  finally{ _busy.calSave=false; if(saveBtn){ saveBtn.disabled=false; saveBtn.textContent='儲存'; } }
}
async function deleteCalItem(){
  if(!CAL_EDIT_ID) return;
  if(!confirm('確定刪除這個事項？')) return;
  const delId=CAL_EDIT_ID, snap=CAL_ITEMS;   // apiCall（寫入類）會把 CAL_ITEMS 清空，先留一份
  try{
    const d=await apiCall({ action:'deleteCalendarItem', token:AUTH_TOKEN, item_id:delId });
    if(!d.ok){ toast(d.error||'刪除失敗','err'); return; }
    CAL_ITEMS=(snap||[]).filter(x=>String(x.item_id)!==String(delId));   // 畫面即刻拿掉，背景再更新
    closeCalEdit(); toast('已刪除','ok');
    renderCalendar();
    loadCalendar().catch(()=>{});
  }catch(e){ toast(e.message||'刪除失敗','err'); }
}
async function syncGCal(){
  const b=document.getElementById('gcal-sync-btn');
  const orig=b.textContent; b.textContent='同步中…'; b.disabled=true;
  try{
    const d=await apiCall({ action:'syncCalendarNow', token:AUTH_TOKEN });
    if(d.ok) toast('已同步到 Google 日曆「南坡萬」'+(d.summary?('：'+d.summary):''),'ok');
    else toast(d.error==='Unknown action'?'後台尚未部署日曆同步（待對話 B v2.3）':(d.error||'同步失敗'),'err');
  }catch(e){ toast(e.message||'同步失敗','err'); }
  finally{ b.textContent=orig; b.disabled=false; }
}
function setCalView(v){ CAL_VIEW=v; renderCalendar(); }
/* ---- 勾選式篩選：類型與分類都可個別開關 ---- */
function calCatList(){
  const set=new Set(Object.keys(CAL_CATEGORY_COLORS));
  CAL_ITEMS.forEach(it=>{ if((it.kind==='memo'||it.kind==='recur') && it.category) set.add(it.category); });  // 舊資料的自訂分類也列出
  return [...set];
}
function calCatOn(cat){ return CAL_CATS[cat||'其他']!==false; }
function toggleCalKind(k){ CAL_KINDS[k]=!CAL_KINDS[k]; renderCalendar(); }
function toggleCalCat(cat){ CAL_CATS[cat]=!calCatOn(cat); renderCalendar(); }
function calAllOn(){ CAL_KINDS={order:true,memo:true,recur:true}; CAL_CATS={}; renderCalendar(); }
function renderCalCatBar(){
  const el=document.getElementById('cal-catbar'); if(!el) return;
  el.innerHTML='<span style="font-size:11px;color:var(--hint)">分類（點一下可開關顯示）：</span>'+calCatList().map(cat=>{
    const c=CAL_CATEGORY_COLORS[cat]||{bg:'#EDEDED',fg:'#5A5A5A',bd:'#D6D6D6'};
    const on=calCatOn(cat);
    const st=on?`background:${c.bg};color:${c.fg};border:1px solid ${c.bd}`:'background:#F4F3EF;color:#B5B3A8;border:1px dashed #D6D3C8';
    return `<button class="fchip" style="${st}" onclick="toggleCalCat('${escHtml(cat)}')">${on?'✓ ':''}${escHtml(cat)}</button>`;
  }).join('');
}

/* ============================================================
   五、掛勾：calc 尾端套規則、登入後載資料
   ============================================================ */
/* calc() 跑完後：套公司報價檔的自動規則（免運／扣標費／級距）＋更新 MOQ 提醒。
   _rulesBusy 是防重入旗標：規則改了額外費用後要再算一次總計，那次再進來就直接跳過。 */
onHook('afterCalc', function(){
  if(_rulesBusy) return;
  _rulesBusy = true;
  try{ if(applyAutoRules()){ renderExt(); calc(); } updateMoqWarnings(); }
  finally{ _rulesBusy=false; }
});
