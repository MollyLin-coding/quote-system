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
/* 2026-09-02 Molly：「把我的 Google 日曆與此系統分開」→ 分類「私人」的行程整個從系統畫面移除
   （下拉選項也拿掉了，不會再有新的）。**資料仍留在 calendar_items 表**，只是不顯示、不進今日待辦、
   後端也不再推上「南坡萬」Google 日曆。要真的刪掉要另外處理，別在這裡偷偷刪。 */
function calIsPrivate(it){ return String((it&&it.category)||'')==='私人'; }
function eventsOn(dstr){
  const evs=[];
  const d=new Date(dstr+'T00:00:00');
  if(CAL_KINDS.order){
    (ORDERS_CACHE||[]).forEach(o=>{
      const s=(typeof effOrdStatus==='function')?effOrdStatus(o.st):(o.st?.status||'quoted');   // 用有效狀態：已收訂金但狀態欄沒改的單，不再誤報「報價到期」
      if(s==='cancelled') return;
      if(o.st?.ship_date_est===dstr && !o.st?.ship_date_actual) evs.push({t:'ship', txt:'🚚 '+o.client.split('｜')[0]+' 出貨', no:o.no});
      if(o.st?.ship_date_actual===dstr) evs.push({t:'ship', txt:'🚚 '+o.client.split('｜')[0]+' 出貨 ✓', no:o.no});
      // 2026-08-08 Molly：報價到期不需要提醒，不再產生 ⏰ 事件。
    });
  }
  CAL_ITEMS.forEach(it=>{
    const timeTxt = (it.all_day!=='Y' && it.time) ? it.time+' ' : '';
    if(calIsPrivate(it)) return;
    if(it.kind==='memo' && CAL_KINDS.memo && calCatOn(it.category) && !calShipMemoDup(it)){
      if(it.date===dstr) evs.push({t:'memo', txt:'📌 '+timeTxt+it.title, item:it, done:it.done==='Y', time:timeTxt?it.time:''});
    }
    if(it.kind==='recur' && CAL_KINDS.recur && calCatOn(it.category)){
      /* 2026-09-01 複檢 #12：改用共用的 recurHitsOn（含字串轉數字），
         原本嚴格比對會讓「weekday 存成字串」的舊資料整條在月曆上消失。 */
      const hit=recurHitsOn(it, d);
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
  /* 2026-09-02 Molly：「待辦清單（不指定日期）」卡片與「☑ 待辦」類型已拿掉（renderTodoList 移除、
     index.html 的 #cal-todos 與 todo 選項移除）。舊的 todo 資料仍留在 calendar_items 表，只是不顯示。 */
}
function calEvHtml(e){
  const cls={ship:'ship',exp:'exp',memo:'memo',recur:'recur'}[e.t];
  /* event.stopPropagation()：月曆檢視下事件標籤疊在「當日格子」上面，格子本身也有 onclick（新增事項），
     沒擋住冒泡的話點標籤會先開編輯視窗、又立刻被冒泡上去的「新增事項」蓋掉，變成永遠打不開編輯/刪除 */
  const click=e.no?`onclick="event.stopPropagation();gotoPage('orders')"`:(e.item?`data-id="${escAttr(e.item.item_id)}" onclick="event.stopPropagation();openCalEdit(this.dataset.id)"`:'');
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
  <div class="cal-legend">🚚 出貨（訂單自動）　📌 備忘　🔁 重複行程　🙏 拜拜日（農曆初二／十六，自動換算）　紅字＝國定假日　※ 點日期格可直接新增事項；點訂單事件跳到訂單追蹤　｜　顏色依「分類」自動區分：${Object.entries(CAL_CATEGORY_COLORS).map(([name,c])=>`<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${c.fg};margin:0 3px 0 8px;vertical-align:middle"></span>${name}`).join('')}</div>`;
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
  CAL_ITEMS.filter(it=>it.kind==='memo'&&it.done!=='Y'&&it.date&&!calShipMemoDup(it)&&!calIsPrivate(it)).forEach(it=>{
    const d=daysBetween(it.date);
    const box=`<span class="fdone" title="打勾＝標記完成，不再顯示於焦點" data-id="${escAttr(it.item_id)}" onclick="event.stopPropagation();calFocusDone(this.dataset.id)"></span>`;
    if(d!=null&&d<0) items.push({o:d,h:`${box}<span class="ob red">逾期 ${-d} 天</span> 📌 ${escHtml(it.title)}`,click:`openCalEdit(this.dataset.calId)`, calId:it.item_id});
    else if(d!=null&&d<=7) items.push({o:d,h:`${box}<span class="ob warn">${d===0?'今天':d+' 天後'}</span> 📌 ${escHtml(it.title)}`,click:`openCalEdit(this.dataset.calId)`, calId:it.item_id});
  });
  (ORDERS_CACHE||[]).forEach(o=>{
    const s=effOrdStatus(o.st);
    /* 2026-09-01 複檢 #12：原本 paid（已收尾款）直接跳過，於是「錢收了、發票還沒開」
       在行事曆上完全不會提醒（今日待辦有列）。發票是稅務要件，這裡補上。 */
    /* 2026-09-02：判斷要跟 effOrdStatus 一致——它是用 invoice_date || invoice_no 認定「已開發票」。
       原本只看 invoice_no，於是「發票開了、只是沒登號碼」的單會一直掛著清不掉的紅字提醒。 */
    if(s==='paid' && !(o.st&&(o.st.invoice_no||o.st.invoice_date)) && o.st&&o.st.ship_date_actual){
      items.push({o:99,h:`<span class="ob red">待開發票</span> 🧾 ${escHtml(o.client.split('｜')[0])}（${escHtml(o.no)}）尾款已收`,click:`gotoPage('orders')`});
    }
    if(s==='cancelled'||s==='closed'||s==='paid') return;
    if(o.st?.ship_date_est&&!o.st?.ship_date_actual){
      const d=daysBetween(o.st.ship_date_est);
      // 2026-08-19 Molly：出貨提醒本來沒有勾選確認已出貨的入口，只能點整列跳去訂單追蹤手動填，
      // 沒空填就會一直卡成逾期。跟備忘同一顆圈圈勾法：打勾＝把實際出貨日記為今天（同一個欄位，
      // 跟去訂單追蹤「編輯進度」填的效果一樣）；填錯了照樣可以到訂單追蹤調整。
      const shipBox=`<span class="fdone" title="打勾＝標記今天已出貨（記為實際出貨日），不再顯示於焦點" onclick="event.stopPropagation();calFocusShip('${escAttr(o.no)}')"></span>`;
      if(d!=null&&d<0) items.push({o:d,h:`${shipBox}<span class="ob red">出貨逾期 ${-d} 天</span> 🚚 ${escHtml(o.client.split('｜')[0])}（${escHtml(o.no)}）`,click:`gotoPage('orders')`});
      else if(d!=null&&d<=7) items.push({o:d,h:`${shipBox}<span class="ob warn">${d===0?'今天':d+' 天後'}</span> 🚚 ${escHtml(o.client.split('｜')[0])} 出貨（${escHtml(o.no)}）`,click:`gotoPage('orders')`});
    }
    /* 2026-08-08 Molly：報價到期不需要提醒。月曆格、訂單提醒徽章、Google 日曆同步當時都拿掉了，
       只有「今日焦點」這塊漏掉（複檢 2026-08-13 找到），一併移除。 */
    if(s==='shipped') items.push({o:99,h:`<span class="ob warn">待開發票</span> 💰 ${escHtml(o.client.split('｜')[0])}（${escHtml(o.no)}）`,click:`gotoPage('orders')`});
    if(s==='invoiced') items.push({o:99,h:`<span class="ob warn">待收尾款</span> 💰 ${escHtml(o.client.split('｜')[0])}（${escHtml(o.no)}）${o.st?.final_amt?'尾款 '+money(o.st.final_amt):''}`,click:`gotoPage('orders')`});
  });
  items.sort((a,b)=>a.o-b.o);
  el.innerHTML=`<div class="ph" style="font-weight:700;font-size:13px;margin-bottom:6px">今日焦點 — ${fmtD(new Date()).slice(5)}<span style="color:#A8A69C;font-weight:400;font-size:11px">　今天＋未來 7 天；逾期自動標紅；📌 備忘、🚚 出貨做完了就點左邊圈圈打勾</span></div>`+
    (items.length?items.map(i=>`<div class="focus-row"${i.calId!=null?` data-cal-id="${escAttr(i.calId)}"`:''} onclick="${i.click}">${i.h}</div>`).join(''):'<div style="color:#A8A69C;font-size:12.5px">目前沒有需要注意的事項 ✓</div>');
}
async function toggleTodoDone(id){
  const it=CAL_ITEMS.find(x=>String(x.item_id)===String(id)); if(!it) return;
  const prevDone=it.done, prevDate=it.done_date;   // 記住原狀態，失敗時可回復
  it.done = it.done==='Y'?'N':'Y';
  it.done_date = it.done==='Y'?fmtD(new Date()):'';
  renderCalendar();
  const snap=CAL_ITEMS, osnap=ORDERS_CACHE;        // apiCall（寫入類）會清空 CAL_ITEMS 與 ORDERS_CACHE，先各留一份
  try{
    const d=await apiCall({ action:'saveCalendarItem', token:AUTH_TOKEN, item:it });
    if(!d.ok) throw new Error(d.error||'儲存失敗');
    CAL_ITEMS=snap; if(osnap&&!ORDERS_CACHE) ORDERS_CACHE=osnap;   // 出貨/到期事件不消失
    renderCalendar();                              // 畫面即刻反映（這筆已是改好的），背景再同步
    loadCalendar().catch(()=>{});
  }
  catch(e){
    CAL_ITEMS=snap; if(osnap&&!ORDERS_CACHE) ORDERS_CACHE=osnap;
    it.done=prevDone; it.done_date=prevDate; renderCalendar();   // 回復畫面，避免以為打勾了其實沒存到
    toast('沒有存成功，畫面已改回原樣。請檢查網路後再打勾一次（'+e.message+'）','err');
  }
}
/* 今日焦點的「打勾＝完成」：備忘標成已完成（跟待辦清單同一套存法，可到月曆點該筆再取消） */
function calFocusDone(id){
  const it=CAL_ITEMS.find(x=>String(x.item_id)===String(id)); if(!it||it.done==='Y') return;
  toggleTodoDone(id);
  toast('已完成：'+(it.title||'')+'（要復原可在行事曆點這筆，取消「已完成」）','ok');
}
/* 今日焦點的「打勾＝已出貨」（2026-08-19，Molly 回報出貨提醒沒有勾選確認已出貨的入口，只能點整列
   跳去訂單追蹤手動填，沒空填就一直卡成逾期）：打勾把訂單追蹤的實際出貨日記為今天——跟去「訂單追蹤」
   開「編輯進度」填的是同一個欄位（updateOrderStatus 的 ship_date_actual），填錯了一樣可以到那邊改。
   跟 toggleTodoDone 同一套「樂觀更新＋失敗還原」寫法；差別是這裡動的是 ORDERS_CACHE，但 apiCall
   （寫入類）連 CAL_ITEMS 也會一起清空，所以兩份快照都要留、都要還原。 */
function calFocusShip(no){
  const o=(ORDERS_CACHE||[]).find(x=>x.no===no); if(!o) return;
  if(o.st && o.st.ship_date_actual) return;   // 已經標過了，不重複問
  if(_busy['shipFocus_'+no]) return;
  if(!confirm(`「${(o.client||'').split('｜')[0]}」（${no}）今天已出貨？\n將把訂單追蹤的實際出貨日記為今天；填錯了可以到訂單追蹤調整。`)) return;
  calFocusShipSave(no);
}
async function calFocusShipSave(no){
  _busy['shipFocus_'+no]=true;
  const o=(ORDERS_CACHE||[]).find(x=>x.no===no);
  if(!o){ _busy['shipFocus_'+no]=false; return; }
  const today=fmtD(new Date());
  const prevSt=o.st;
  o.st=Object.assign({}, o.st||{}, { ship_date_actual: today });
  renderCalendar();
  const snap=CAL_ITEMS, osnap=ORDERS_CACHE;   // apiCall（寫入類）會清空 CAL_ITEMS 與 ORDERS_CACHE，先各留一份
  try{
    const d=await apiCall({ action:'updateOrderStatus', token:AUTH_TOKEN, quote_no:no, fields:{ ship_date_actual: today } });
    if(!d.ok) throw new Error(d.error||'儲存失敗');
    CAL_ITEMS=snap; if(osnap) ORDERS_CACHE=osnap;
    renderCalendar();                              // 畫面即刻反映（這筆已是改好的），背景再同步
    if(typeof loadOrders==='function') loadOrders().catch(()=>{});
    // 2026-08-24：同 saveOrdEdit，打勾標出貨後背景補一次 syncCalendarNow，不用等每小時排程。
    if(typeof apiCall==='function' && AUTH_TOKEN) apiCall({ action:'syncCalendarNow', token:AUTH_TOKEN }).catch(()=>{});
    toast('已標記出貨，實際出貨日：'+today+'（要改可到訂單追蹤調整）','ok');
  }catch(e){
    CAL_ITEMS=snap; if(osnap) ORDERS_CACHE=osnap;
    const oo=(ORDERS_CACHE||[]).find(x=>x.no===no); if(oo) oo.st=prevSt;   // 回復畫面，避免以為標了其實沒存到
    renderCalendar();
    toast('標記出貨失敗，已還原：'+e.message,'err');
  }finally{ _busy['shipFocus_'+no]=false; }
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
  document.getElementById('ce-del').style.display=(typeof isOwner==='function'&&!isOwner())?'none':'inline-block';   // 2026-09-01：一般使用者不該重新看到刪除鈕
  document.getElementById('ce-kind').value=it.kind;
  document.getElementById('ce-date').value=it.date||fmtD(new Date());
  document.getElementById('ce-title').value=it.title||'';
  document.getElementById('ce-detail').value=it.detail||'';
  document.getElementById('ce-category').value=it.category||'工作';
  document.getElementById('ce-priority').checked=it.priority==='high';
  { const dc=document.getElementById('ce-done'); if(dc) dc.checked=(it.done==='Y'); }
  /* 全天／時間：舊資料 all_day 是空的。複檢 2026-08-13 發現，顯示端（月曆格／今日待辦／待辦信）
     把「空值＋有時間」當成「有指定時間」，但這裡卻當成全天並把時間欄清空——只要開一次編輯視窗
     再按儲存，時間就永久消失。改成跟顯示端同一套判斷：有填時間就不是全天。 */
  document.getElementById('ce-allday').checked=(String(it.all_day||'')==='Y' || !String(it.time||'').trim());
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
  if(mi===60){ if(h>=23){ h=23; mi=55; } else { mi=0; h=h+1; } }   // 23:58 不能繞回 00:00（會被「結束要晚於開始」擋住），夾在 23:55
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
  const snap=CAL_ITEMS, osnap=ORDERS_CACHE;   // apiCall（寫入類）會把 CAL_ITEMS/ORDERS_CACHE 清空，先各留一份
  const saveBtn=document.getElementById('ce-save');
  if(saveBtn){ saveBtn.disabled=true; saveBtn.textContent='儲存中…'; }
  try{
    const d=await apiCall({ action:'saveCalendarItem', token:AUTH_TOKEN, item });
    if(osnap&&!ORDERS_CACHE) ORDERS_CACHE=osnap;   // 出貨/到期事件不消失
    if(!d.ok){ CAL_ITEMS=snap; toast(d.error||'儲存失敗','err'); return; }   // 失敗一定要把快照放回去，不然整個行事曆會被清空
    // 先把存好的這筆直接放進畫面（0 秒），背景再跟後端要最新的
    CAL_ITEMS=(snap||[]).filter(x=>String(x.item_id)!==String(item.item_id)).concat([item]);
    closeCalEdit(); toast('已儲存','ok');
    renderCalendar();
    loadCalendar().catch(()=>{});
  }catch(e){ CAL_ITEMS=snap; if(osnap&&!ORDERS_CACHE) ORDERS_CACHE=osnap; toast(e.message||'儲存失敗','err'); }
  finally{ _busy.calSave=false; if(saveBtn){ saveBtn.disabled=false; saveBtn.textContent='儲存'; } }
}
async function deleteCalItem(){
  if(!CAL_EDIT_ID) return;
  if(typeof needOwner==='function' && !needOwner('刪除行事曆事項')) return;   // 2026-09-01：第二道防線
  /* 2026-09-01 複檢 #26：原本只寫「確定刪除這個事項？」，看不出刪的是哪一筆；
     如果那是「每月 5 號跟廠商對帳」，刪掉的是整條、以後每個月都不會再出現。 */
  {
    const _it=(CAL_ITEMS||[]).find(x=>String(x.item_id)===String(CAL_EDIT_ID));
    const _title=_it?(_it.title||''):'';
    const _isRecur=!!(_it && _it.kind==='recur');
    const _msg=_isRecur
      ? `確定刪除「${_title}」？\n\n⚠ 這是重複行程，刪掉的是整條——以後每一次都不會再出現。\n只想跳過某一天的話請改用編輯，不要刪除。`
      : (_title ? `確定刪除「${_title}」？刪掉後無法復原。` : '確定刪除這個事項？刪掉後無法復原。');
    if(!confirm(_msg)) return;
  }
  const delId=CAL_EDIT_ID, snap=CAL_ITEMS, osnap=ORDERS_CACHE;   // apiCall（寫入類）會把 CAL_ITEMS/ORDERS_CACHE 清空，先各留一份
  btnBusy('ce-del',true,'刪除中…');
  try{
    const d=await apiCall({ action:'deleteCalendarItem', token:AUTH_TOKEN, item_id:delId });
    if(osnap&&!ORDERS_CACHE) ORDERS_CACHE=osnap;
    if(!d.ok){ CAL_ITEMS=snap; toast(d.error||'刪除失敗','err'); return; }   // 失敗要把快照放回去
    CAL_ITEMS=(snap||[]).filter(x=>String(x.item_id)!==String(delId));   // 畫面即刻拿掉，背景再更新
    closeCalEdit(); toast('已刪除','ok');
    renderCalendar();
    loadCalendar().catch(()=>{});
  }catch(e){ CAL_ITEMS=snap; if(osnap&&!ORDERS_CACHE) ORDERS_CACHE=osnap; toast(e.message||'刪除失敗','err'); }
  finally{ btnBusy('ce-del',false); }
}
/* 2026-08-13 複檢建議 #1：自我檢查。
   這套系統最常出問題的地方是「同一條規則被抄在好幾個地方」（系統月曆／今日待辦／
   Google 日曆同步／每日待辦信），改一處另外幾處不會跟著動，而且壞掉不會有人知道，
   都要等 Molly 自己撞上才發現。這顆按鈕把「資料庫裡的真實狀態」跟「Google 日曆上
   真正存在的事件」對一次答案，把對不上的列出來。純檢查，不會新增/修改/刪除任何東西。 */
async function calSelfCheck(){
  const b=document.getElementById('gcal-check-btn');
  const orig=b?b.textContent:''; if(b){ b.textContent='檢查中…'; b.disabled=true; }
  try{
    const d=await apiCall({ action:'calendarSelfCheck', token:AUTH_TOKEN });
    if(!d||!d.ok) throw new Error((d&&d.error)||'檢查失敗');
    const issues=d.issues||[];
    const lvl={high:['嚴重','#B03A2E'],mid:['注意','#B5541F'],low:['提醒','#8A8880']};
    const body = issues.length
      ? `<div style="font-size:12px;color:#6B6B63;margin-bottom:10px">檢查範圍 ${escHtml(d.window?d.window.from:'')} ～ ${escHtml(d.window?d.window.to:'')}　·　Google 日曆上共 ${d.checked_events||0} 筆由系統產生的事件</div>`
        + issues.map(it=>{
            const L=lvl[it.level]||lvl.low;
            return `<div style="padding:9px 11px;border-left:3px solid ${L[1]};background:#FAF9F6;margin-bottom:7px;border-radius:0 6px 6px 0">
              <span class="ob" style="background:${L[1]};color:#fff">${L[0]}</span>
              <b style="margin-left:6px">${escHtml(it.type||'')}</b>
              <div style="margin-top:4px;font-size:12.5px;line-height:1.6">${escHtml(it.msg||'')}</div>
            </div>`;
          }).join('')
        + `<div style="font-size:11.5px;color:#8A8880;margin-top:10px">多數問題按一次上面的「⟳ 同步 Google 日曆」就會自動修好；按完可以再檢查一次確認。</div>`
      : `<div class="td-alldone" style="padding:26px 10px"><div class="big">都對得起來 🎉</div>
         <div class="sm">系統裡的資料跟 Google 日曆上的事件完全一致（檢查範圍 ${escHtml(d.window?d.window.from:'')} ～ ${escHtml(d.window?d.window.to:'')}，共 ${d.checked_events||0} 筆）。</div></div>`;
    let ov=document.getElementById('calchk-overlay');
    if(!ov){
      ov=document.createElement('div'); ov.className='v2ov'; ov.id='calchk-overlay';
      ov.innerHTML=`<div class="v2bx" style="max-width:640px">
        <div class="v2h"><span>🔍 行事曆自我檢查</span><button class="v2x" onclick="document.getElementById('calchk-overlay').style.display='none'">✕</button></div>
        <div class="v2b" id="calchk-body" style="max-height:60vh;overflow:auto"></div>
        <div class="v2f"><button class="btn btn-g" onclick="document.getElementById('calchk-overlay').style.display='none'">關閉</button></div>
      </div>`;
      document.body.appendChild(ov);
    }
    document.getElementById('calchk-body').innerHTML=body;
    ov.style.display='flex';
  }catch(e){ toast(e.message||'檢查失敗','err'); }
  finally{ if(b){ b.textContent=orig; b.disabled=false; } }
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
  CAL_ITEMS.forEach(it=>{ if((it.kind==='memo'||it.kind==='recur') && it.category && !calIsPrivate(it)) set.add(it.category); });  // 舊資料的自訂分類也列出
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
    /* 2026-09-02：分類名稱／item_id 是自由文字，含單引號時「塞進 inline onclick 的 JS 字串字面值」
       一定會壞掉（HTML 跳脫救不了，&#39; 解析回來還是 '，JS 語法照樣斷）。
       改成放在 data-* 屬性、handler 從 dataset 讀 —— 值永遠不會變成 JS 原始碼的一部分。 */
    return `<button class="fchip" style="${st}" data-cat="${escAttr(cat)}" onclick="toggleCalCat(this.dataset.cat)">${on?'✓ ':''}${escHtml(cat)}</button>`;
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
