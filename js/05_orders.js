/* ============================================================
   二、訂單追蹤
   ============================================================ */
const ORDER_STAGES=[['quoted','報價中'],['deposit','已收訂金'],['production','排產中'],['shipped','已出貨'],['invoiced','已開發票'],['paid','已收尾款'],['closed','結案'],['cancelled','已取消']];
function stageLabel(s){ const f=ORDER_STAGES.find(x=>x[0]===s); return f?f[1]:'報價中'; }
function stageIdx(s){ return {quoted:1,deposit:2,production:3,shipped:4,invoiced:5,paid:6,closed:7}[s]||1; }
/* 有效狀態：手動選的狀態 vs 依「實際填了什麼資料」推得的狀態，取比較後面的那個。
   規則：填了訂金日→至少排產中；填了實際出貨日→至少已出貨；填了發票→至少已開發票；
   填了尾款收款日→至少已收尾款（客戶跳過訂金直接付全款也適用）。
   「已取消」一律尊重手動設定。全站列表／篩選／月報表都用這個，
   所以就算忘了改狀態，只要日期有填，單子就不會卡在「報價中」。 */
function effOrdStatus(st){
  st=st||{}; const s=st.status||'quoted';
  if(s==='cancelled') return s;
  const has=v=>String(v==null?'':v).trim()!=='';
  let d='quoted';
  if(has(st.deposit_date)) d='production';
  if(has(st.ship_date_actual)) d='shipped';
  if(has(st.invoice_date)||has(st.invoice_no)) d='invoiced';
  if(has(st.final_date)) d='paid';
  return stageIdx(d)>stageIdx(s)?d:s;
}
/* 七關卡：報價→訂金→排產→出貨→發票→尾款→結案。以「有沒有填資料」或有效狀態判斷是否過關 */
function orderSteps(st){
  st=st||{}; const s=effOrdStatus(st);
  const ge=(arr)=>arr.includes(s);
  return [
    {key:'quote',   label:'報價', done:true,                                                              date:''},
    {key:'deposit', label:'訂金', done: !!st.deposit_date     || ge(['deposit','production','shipped','invoiced','paid','closed']), date: st.deposit_date||''},
    {key:'production', label:'排產', done: ge(['production','shipped','invoiced','paid','closed']) || !!st.ship_date_actual, date:''},
    {key:'ship',    label:'出貨', done: !!st.ship_date_actual || ge(['shipped','invoiced','paid','closed']),           date: st.ship_date_actual||''},
    {key:'invoice', label:'發票', done: !!st.invoice_date     || ge(['invoiced','paid','closed']),                     date: st.invoice_date||''},
    {key:'final',   label:'尾款', done: !!st.final_date       || ge(['paid','closed']),                                date: st.final_date||''},
    {key:'closed',  label:'結案', done: s==='closed'          || !!st.closed_at,                                       date: st.closed_at||''}
  ];
}
function orderTimelineHtml(o){
  const st=o.st||{}; const steps=orderSteps(st);
  steps[0].date=o.quoteDate||'';
  const _ship=steps.find(x=>x.key==='ship'), _final=steps.find(x=>x.key==='final');
  if(!_ship.done && st.ship_date_est)   _ship.sub='預計 '+st.ship_date_est.slice(5);
  if(!_final.done && st.final_date_est) _final.sub='預計 '+st.final_date_est.slice(5);
  // 目前進行到的關卡＝最後一個已完成的下一關
  let curIdx=0; steps.forEach((sp,i)=>{ if(sp.done) curIdx=i; });
  if(curIdx<steps.length-1) curIdx++;
  if(st.status==='cancelled') return `<div class="otl-cancel" style="background:#F2F1EC;border-radius:8px;padding:10px 14px;color:#8A887E;font-size:12px;margin-bottom:14px">此訂單已取消</div>`;
  return `<div class="otl">`+steps.map((sp,i)=>`
    <div class="otl-node${sp.done?' done':''}${i===curIdx&&!sp.done?' cur':''}">
      <div class="otl-dot">${sp.done?'✓':(i+1)}</div>
      <div class="otl-lbl">${sp.label}</div>
      <div class="otl-date">${sp.done?(sp.date?sp.date.slice(5):'✓'):(sp.sub||'')}</div>
    </div>`).join('')+`</div>`;
}

/* 訂單追蹤：三份資料（報價單／自訂單／進度）都走讀取快取。
   有快取先秒開舊的、背景再更新；90 秒內重複進出完全不打後端。
   快取被寫入動作清掉時，這裡的衍生資料也要歸零（見檔尾 onCacheClear）。 */
/* 複檢 2026-08-11 #4：月報表要完整清單（累計型數字不能用裁切過的資料算）。
   ordSetLoadAll() 由 gotoPage('report') 呼叫；回傳 true 代表「這次要強制重抓」。
   一旦打開過月報表就維持完整模式，訂單追蹤與今日待辦 fallback 也一起受惠。 */
let ORD_LOAD_ALL=false;
function ordSetLoadAll(){ if(ORD_LOAD_ALL) return false; ORD_LOAD_ALL=true; return true; }
function ordPayloads(){
  const qp={action:'getQuotes', token:AUTH_TOKEN, filters:{}};
  return [ (ORD_LOAD_ALL||(typeof LIST_LOAD_ALL!=='undefined'&&LIST_LOAD_ALL))?qp:withLimit(qp),
           {action:'listCustomQuotes', token:AUTH_TOKEN},
           {action:'getOrderStatusList', token:AUTH_TOKEN} ];
}
function buildOrders(qs, cq, os){
  const stMap={}; ((os&&os.orders)||[]).forEach(o=>{ stMap[o.quote_no]=o; });
  const list=[];
  // 2026-08-28 純報價單（status='純報價'）不列入訂單追蹤／月報表
  ((qs&&qs.quotes)||[]).filter(q=>q.status!=='已刪除' && q.status!=='純報價' && q.quoteOnly!=='Y').forEach(q=>{
    list.push({ no:q.quoteNo, client:q.clientName||'—', type:q.quoteType==='banquet'?'宴會':'瓶裝',
      typeKey:q.quoteType, total:q.grandTotal||0, quoteDate:q.quoteDate||'', expiry:q.expiryDate||'',
      payDetail:q.paymentDetail||'',   // 複檢 #3：訂金/尾款要以報價單條款上的實際金額為準
      by:q.createdBy||'',              // v51 建立者（舊單沒有，空字串）
      st: stMap[q.quoteNo]||null, src:'std' });
  });
  ((cq&&cq.quotes)||[]).forEach(q=>{
    const tot=parseJsonSafe(q.totals_json,{}).total||0;
    list.push({ no:q.quote_no, client:(q.client||'—')+(q.tag?('｜'+q.tag):''), type:'自訂', typeKey:'custom',
      total:tot, quoteDate:q.quote_date||'', expiry:q.expiry||'', st:stMap[q.quote_no]||null, src:'custom', raw:q });
  });
  list.sort((a,b)=> (b.quoteDate||'').localeCompare(a.quoteDate||'') || (b.no||'').localeCompare(a.no||''));
  return list;
}
async function loadOrders(force){
  const body=document.getElementById('ord-body');
  const P=ordPayloads();
  const hits=P.map(p=>rcPeek(p));
  if(!force && hits.every(h=>h&&h.data)){
    ORDERS_CACHE=buildOrders(hits[0].data, hits[1].data, hits[2].data);
    renderOrders();
    if(currentPage==='report' && typeof renderReport==='function') renderReport();
    if(P.every(p=>rcFresh(p))){ ordSideBadges(); return ORDERS_CACHE; }   // 夠新就不重打
  }else if(body && !ORDERS_CACHE){ body.innerHTML=sklTableRows(6,5); }   // 畫面上已有列表就別鋪骨架屏蓋掉（存檔後的背景更新）
  try{
    const [qs, cq, os] = await Promise.all(P.map(p=>readCall(p, force)));
    ORDERS_CACHE=buildOrders(qs, cq, os);
    renderOrders();
    if(currentPage==='report' && typeof renderReport==='function') renderReport();
    ordSideBadges(force);
    return ORDERS_CACHE;
  }catch(e){
    if(body && !ORDERS_CACHE) body.innerHTML=`<tr><td colspan="6" class="rec-empty">${e.message||'載入失敗'}</td></tr>`;
    throw e;
  }
}
/* 徽章（驗收單／客訴／分批出貨）非同步補，不擋列表；也走快取所以不會重複打 */
function ordSideBadges(force){
  loadOrderVerifyBadges(force);
  loadShipmentBadges(force);
}
/* ── 卡關天數（2026-08-11 優化建議 #3）─────────────────────────────
   「這張單停在〈排產中〉幾天了」。取「讓它進到目前這一關的那個日期」往今天算：
   報價中→報價日、已收訂金/排產中→訂金日、已出貨→實際出貨日、已開發票→發票日、已收尾款→尾款收款日。
   結案與取消不算（已經結束了，不需要催）。日期缺漏就回 null，畫面上不顯示。 */
function ordStageSince(o){
  const st=(o&&o.st)||{}; const s=effOrdStatus(st);
  if(s==='closed'||s==='cancelled') return null;
  const pick={quoted:o.quoteDate, deposit:st.deposit_date, production:st.deposit_date,
              shipped:st.ship_date_actual, invoiced:(st.invoice_date||st.ship_date_actual),
              paid:st.final_date}[s];
  const d=String(pick==null?'':pick).trim();
  if(!/^\d{4}-\d{2}-\d{2}/.test(d)) return null;
  const n=daysBetween(d.slice(0,10));
  return n==null?null:-n;   // daysBetween 是「還有幾天」，這裡要「過了幾天」
}
/* 幾天以上才顯示：7 天內是正常流程，不吵。14 天橘、30 天紅。 */
function ordStuckBadge(o){
  const n=ordStageSince(o);
  if(n==null||n<7) return '';
  const cls=n>=30?'red':(n>=14?'warn':'info');
  return `<span class="ob ${cls}">停在「${stageLabel(effOrdStatus(o.st))}」${n} 天</span>`;
}
function orderBadges(o){
  const s=effOrdStatus(o.st);
  let h=ordStuckBadge(o);
  // 2026-08-08 Molly：報價到期不需要提醒，這裡的「有效期剩 N 天／已過有效期」整段拿掉。
  if(o.st?.ship_date_est && !o.st?.ship_date_actual && ['deposit','production','quoted'].includes(s)){
    const d=daysBetween(o.st.ship_date_est);
    if(d!=null && d<0) h+='<span class="ob red">出貨已逾期</span>';
    else if(d!=null && d<=3) h+=`<span class="ob warn">出貨倒數 ${d} 天</span>`;
  }
  if(o.st?.final_date_est && !o.st?.final_date && ['shipped','invoiced'].includes(s)){
    const d=daysBetween(o.st.final_date_est);
    if(d!=null && d<0) h+='<span class="ob red">尾款已逾期</span>';
    else if(d!=null && d<=3) h+=`<span class="ob warn">尾款倒數 ${d} 天</span>`;
  }
  if(SHP_SUM && SHP_SUM[o.no]) h+=`<span class="ob info">分批×${SHP_SUM[o.no]}</span>`;
  return h;
}
/* 訂單列的驗收單／客訴徽章（資料來自 ORDER_VSUM，非同步載入後重繪） */
let ORDER_VSUM=null;
async function loadOrderVerifyBadges(force){
  try{
    if(!AUTH_TOKEN) return;
    const [lf,gv]=await Promise.all([
      readCall({action:'listVerifyForms', token:AUTH_TOKEN, filters:{}}, force).catch(()=>({})),
      readCall({action:'getVerifications', token:AUTH_TOKEN, filters:{}}, force).catch(()=>({}))
    ]);
    // 客戶批號備援：每張單取最新一張驗收單上填的客戶批號（records 已是新→舊）
    const lots={};
    ((lf&&lf.records)||[]).forEach(r=>{ if(r.no && String(r.lot||'').trim() && !(r.no in lots)) lots[r.no]=String(r.lot).trim(); });
    ORDER_VSUM={ forms:(lf&&lf.summary)||{}, reps:(gv&&gv.summary)||{}, repList:(gv&&gv.records)||[], lots };
    renderOrders();
  }catch(_){}
}
function orderUnhandledCount(no){
  if(!ORDER_VSUM) return 0;
  const s=ORDER_VSUM.reps[no];
  if(s&&(s.unhandled!=null||s.pending!=null)) return (s.unhandled!=null?s.unhandled:s.pending)||0;
  return (ORDER_VSUM.repList||[]).filter(r=>r.no===no&&(typeof vmIsIssue==='function'?vmIsIssue(r):true)&&(typeof vmStatusNorm==='function'?vmStatusNorm(r.status)==='待處理':true)).length;
}
function orderVerifyBadge(o){
  if(!ORDER_VSUM) return '';
  let h=''; const f=ORDER_VSUM.forms[o.no];
  const cnt=f?(f.count||f.n||f.total):0;
  if(cnt){ const last=String(f.last_at||f.last||f.last_date||'').slice(5,10); h+=`<span class="ob info">驗收單×${cnt}${last?'·'+last:''}</span>`; }
  const unh=orderUnhandledCount(o.no);
  if(unh>0) h+=`<span class="ob red">客訴 ${unh} 待處理</span>`;
  return h;
}
/* 訂單的客戶批號：編輯進度手動填的優先，沒填就帶最新驗收單上的 */
function ordCustLot(o){
  const manual=String(o.st?.cust_lot||'').trim();
  if(manual) return manual;
  return (ORDER_VSUM&&ORDER_VSUM.lots&&ORDER_VSUM.lots[o.no])||'';
}
function orderDots(o){
  const s=effOrdStatus(o.st);
  if(s==='cancelled') return '<span class="ost grey">已取消</span>';
  const steps=orderSteps(o.st||{});
  let dots=''; steps.forEach(sp=>{ dots+=`<span class="odot${sp.done?' f':''}"></span>`; });
  return `<span class="odots">${dots}</span><span class="ost">${stageLabel(s)}</span>`;
}
function passOrdFilter(o){
  const s=effOrdStatus(o.st);
  switch(ORD_FILTER){
    case 'all': return s!=='cancelled';
    case 'quoted': return s==='quoted';
    case 'production': return s==='production';
    case 'toship': return s==='deposit'||s==='production';
    case 'toinv': return s==='shipped';
    case 'tofinal': return s==='invoiced';
    case 'done': return s==='paid'||s==='closed';
    case 'cancelled': return s==='cancelled';
  }
  return true;
}
function setOrdFilter(f, el){
  ORD_FILTER=f;
  document.querySelectorAll('#ord-filters .fchip').forEach(b=>b.classList.remove('on'));
  if(el) el.classList.add('on');
  renderOrders();
}
/* ---- 表頭點擊排序：第一下↑、第二下↓、第三下回預設（報價日新→舊） ---- */
let ORD_SORT={key:'',dir:1};
function setOrdSort(key){
  if(ORD_SORT.key===key){ ORD_SORT = ORD_SORT.dir===1 ? {key,dir:-1} : {key:'',dir:1}; }
  else ORD_SORT={key,dir:1};
  renderOrders();
}
function ordSortVal(o,key){
  switch(key){
    case 'no': return o.no||'';
    case 'stage': return stageIdx(effOrdStatus(o.st));
    case 'total': return parseFloat(o.total)||0;
    case 'ship': return o.st?.ship_date_actual||o.st?.ship_date_est||'';
  }
  return '';
}
function ordApplySort(rows){
  if(!ORD_SORT.key) return rows;                      // 預設順序＝buildOrders 排好的（報價日新→舊）
  const k=ORD_SORT.key, d=ORD_SORT.dir;
  return rows.slice().sort((a,b)=>{
    const va=ordSortVal(a,k), vb=ordSortVal(b,k);
    const ea=(va===''||va==null), eb=(vb===''||vb==null);
    if(ea&&eb) return 0; if(ea) return 1; if(eb) return -1;   // 空值永遠排最後
    if(typeof va==='number') return (va-vb)*d;
    return String(va).localeCompare(String(vb))*d;
  });
}
function ordPaintSortHeads(){
  document.querySelectorAll('#ord-thead th[data-sk]').forEach(th=>{
    const k=th.getAttribute('data-sk');
    const arrow=(ORD_SORT.key===k)?(ORD_SORT.dir===1?' ▲':' ▼'):'';
    th.innerHTML=escHtml(th.getAttribute('data-lbl')||'')+`<span style="color:#A6824A">${arrow}</span>`;
  });
}
function renderOrders(){
  const body=document.getElementById('ord-body'); if(!body||!ORDERS_CACHE) return;
  // 篩選計數
  const cnt=k=>{ const old=ORD_FILTER; ORD_FILTER=k; const n=ORDERS_CACHE.filter(passOrdFilter).length; ORD_FILTER=old; return n; };
  const fs=[['all','全部'],['quoted','報價中'],['production','排產中'],['toship','待出貨'],['toinv','待開發票'],['tofinal','待收尾款'],['done','已結案'],['cancelled','已取消']];
  document.getElementById('ord-filters').innerHTML=fs.map(([k,l])=>
    `<button class="fchip${ORD_FILTER===k?' on':''}" onclick="setOrdFilter('${k}',this)">${l} <b>${cnt(k)}</b></button>`).join('');
  ordPaintSortHeads();
  const rows=ordApplySort(ORDERS_CACHE.filter(passOrdFilter));
  if(!rows.length){ body.innerHTML='<tr><td colspan="6" class="rec-empty">沒有符合的訂單</td></tr>'+(listMaybeMore(ORDERS_CACHE.length)?moreRowHtml(6):''); return; }
  body.innerHTML=rows.map(o=>{
    const note=(o.st?.track_note||'').split('\n')[0];
    const shipD=o.st?.ship_date_actual?`${o.st.ship_date_actual.slice(5)} ✓`:(o.st?.ship_date_est?o.st.ship_date_est.slice(5):'—');
    const lot=ordCustLot(o);
    return `<tr>
      <td class="mc-main"><b>${escHtml(o.no)}</b> <span class="rec-badge ${o.typeKey==='banquet'?'banquet':o.typeKey==='custom'?'custom':'bottle'}">${o.type}</span><br>
        <span style="color:#6B6B63;font-size:11.5px">${escHtml(o.client)}</span>${lot?`<br><span style="color:#A6824A;font-size:11px">批號 ${escHtml(lot)}</span>`:''}${o.by?`<br><span style="color:#8A8880;font-size:11px">建立者 ${escHtml(o.by)}</span>`:''}</td>
      <td data-l="進度">${orderDots(o)}${note?`<br><span class="onote">📌 ${escHtml(note)}${(o.st.track_note.includes('\n'))?'…':''}</span>`:''}</td>
      <td data-l="總計" style="text-align:right;font-weight:600">${money(ordGrandTotal(o))}</td>
      <td data-l="出貨日" style="text-align:center">${shipD}</td>
      <td data-l="提醒">${orderBadges(o)}${orderVerifyBadge(o)}</td>
      <td class="rec-actions" data-l="操作">
        <button class="rec-act-btn primary" onclick="openOrdEdit('${escAttr(o.no)}')">編輯進度</button>
        <button class="rec-act-btn" onclick="openChangeLog('${escAttr(o.no)}')">修改紀錄</button>
        ${['bottle','ownbrand','ownlabel','consign'].includes(o.typeKey)?`<button class="rec-act-btn" onclick="openVerifyForm('${escAttr(o.no)}')">驗收單</button>`:''}
        ${o.src==='custom'?`<button class="rec-act-btn" onclick="loadCustomFromOrders('${escAttr(o.no)}')">載入編輯</button>`:''}
      </td>
    </tr>`;
  }).join('') + (listMaybeMore(ORDERS_CACHE.length) ? moreRowHtml(6) : '');
}

/* ---- 單筆進度編輯 ---- */
let ORD_EDITING=null;
function openOrdEdit(no){
  const o=ORDERS_CACHE.find(x=>x.no===no); if(!o) return;
  ORD_EDITING=no;
  const st=o.st||{};
  const g=(k)=>st[k]||'';
  document.getElementById('oe-title').textContent=`編輯進度 — ${no}（${o.client}）`;
  document.getElementById('oe-timeline').innerHTML=orderTimelineHtml(o);
  document.getElementById('oe-status').value=st.status||'quoted';
  ['cust_lot','deposit_amt','deposit_date','ship_date_est','ship_date_actual','invoice_no','invoice_date',
   'invoice_last5','invoice_detail','invoice_photos','final_amt','final_date_est','final_date'].forEach(k=>{
    document.getElementById('oe-'+k).value=g(k);
  });
  // 客戶批號沒手動填、但驗收單上有 → 用 placeholder 提示（存檔仍以手動填的為準）
  const _vlot=(ORDER_VSUM&&ORDER_VSUM.lots&&ORDER_VSUM.lots[no])||'';
  document.getElementById('oe-cust_lot').placeholder=_vlot?`驗收單上填的是「${_vlot}」，沒填就顯示它`:'客戶自己的批號／貨號（選填）';
  // 訂單總額：沒存過就先帶報價單總額，讓後端據此算訂金/尾款各半
  document.getElementById('oe-grand_total').value = st.grand_total || (o.total?Math.round(o.total):'') || '';
  // 這張單從沒存過進度（新單）→ 訂金/尾款依付款規則自動帶入（預設各半；
  // 客戶主檔「付款習慣」寫「訂金30%」就帶 30/70）。存過的單一律不動，避免蓋掉手改值。
  if(!st.updated_at && !String(g('deposit_amt')).trim() && !String(g('final_amt')).trim()){
    const _gt=Math.round(parseFloat(document.getElementById('oe-grand_total').value)||0);
    if(_gt>0){
      /* 複檢 #3：先用報價單條款上的實際金額（2026-08-11 起也認得「全額型」條款：
         Tab1 驗收後付 100%／Tab2 月結全額 → 訂金 0、尾款全額）。
         讀不出來才退回客戶主檔的訂金比例——這條退路留著沒關係，因為這裡是「填在畫面上
         給 Molly 過目、要按儲存才會進資料庫」；真正危險的是後端在背景自動建列時亂猜，
         那邊已改成讀不出來就留空（見 v2_extensions.gs 的 orderPayFromQuote_ 呼叫端）。 */
      const _fromQuote=ordPayFromQuote(o,_gt);
      const _dep=_fromQuote?_fromQuote.dep:Math.round(_gt*ordDepositPct(o.client)/100);
      document.getElementById('oe-deposit_amt').value=_dep;
      document.getElementById('oe-final_amt').value=_fromQuote?_fromQuote.bal:(_gt-_dep);
    }
  }
  document.getElementById('oe-closed_at').value = g('closed_at');
  document.getElementById('oe-track_note').value=g('track_note');
  // v31 發票照片：顯示既有資料夾/照片連結
  renderInvPhotoLinks(g('invoice_photos'));
  document.getElementById('oe-invphoto-prev').innerHTML='';
  document.getElementById('oe-invphoto-hint').textContent='';
  // v31 分批出貨：每次開單重置為收合、未載入
  shpReset();
  document.getElementById('oe-overlay').style.display='flex';
}
/* ── 複檢 2026-08-06 #3：訂金/尾款以「報價單條款上實際印的金額」為準 ──────────────
   2026-08-05 付款條件改版後，訂金＝酒款×比例＋其他費用全額（不再是總計×比例），
   但訂單追蹤一直還在用總計×比例，兩邊對不上（例：報價單印訂金 $50,500、這裡帶 $47,750）。
   報價單存檔時已經把算好的條款文字存進 paymentDetail，直接從那段文字把金額讀回來最準——
   不管付款方式怎麼改、將來條款算法再變，這裡都會跟著對。
   讀不到（自訂條款、舊單沒存、金額對不上總額）就退回原本的比例算法。 */
function ordPayFromQuote(o, gt){
  const s=String((o&&o.payDetail)||'').replace(/<br\s*\/?>/gi,'\n');
  if(!s) return null;
  const num=m=>m?Math.round(parseFloat(String(m[1]).replace(/[$,]/g,''))||0):null;
  /* 複檢 2026-08-11 #3：全額型條款（Tab1 驗收後付 100%／Tab2 月結全額）沒有「訂金」這個字，
     原本一律解不出來就退回「總額×比例」，尾款被算成一半、還多掛一筆不會收的訂金。
     這裡先認全額型：訂金 0、尾款＝全額。Tab3 自訂文字仍回 null（呼叫端留空不猜）。 */
  if(!/支付訂金/.test(s)){
    const full=num(s.match(/支付(?:全額)?款項新台幣\s*\$?([\d,]+(?:\.\d+)?)\s*元整/));
    if(full==null) return null;
    const mPct=s.match(/元整\s*之\s*(\d+(?:\.\d+)?)\s*%/);
    if(mPct && Math.round(parseFloat(mPct[1]))!==100) return null;   // 只付部分比例：語意不明確，不猜
    if(gt>0 && full!==Math.round(gt)) return null;
    return {dep:0, bal:full};
  }
  const dep=num(s.match(/支付訂金(?:總計)?新台幣\s*\$?([\d,]+(?:\.\d+)?)\s*元整/));
  if(dep==null) return null;
  let bal=num(s.match(/支付尾款新台幣\s*\$?([\d,]+(?:\.\d+)?)\s*元整/));
  if(bal==null && /無須另付尾款/.test(s)) bal=0;   // 折抵把尾款抵光的情況（複檢 #12 的條款寫法）
  if(bal==null) return null;
  if(gt>0 && dep+bal!==Math.round(gt)) return null;   // 跟訂單總額對不上就不要硬套
  return {dep, bal};
}
/* 訂金比例（%）：預設 50；客戶主檔「付款習慣」寫「訂金30%」之類就用那個數字。
   用客戶名稱（或發票抬頭）比對客戶主檔；主檔還沒載入就從讀取快取拿。 */
function ordDepositPct(clientName){
  const nm=String(clientName||'').split('｜')[0].trim();
  if(!nm) return 50;
  let list=(typeof CUS_MASTER!=='undefined'&&Array.isArray(CUS_MASTER)&&CUS_MASTER.length)?CUS_MASTER:null;
  if(!list){
    try{
      const hit=(typeof rcPeek==='function'&&AUTH_TOKEN)?rcPeek({action:'getCustomers', token:AUTH_TOKEN}):null;
      if(hit&&hit.data&&Array.isArray(hit.data.customers)) list=hit.data.customers;
    }catch(_){}
  }
  if(!list) return 50;
  const key=s=>String(s||'').replace(/\s+/g,'').toLowerCase();
  const m=list.find(c=>key(c.name)===key(nm))||list.find(c=>c.invoice_title&&key(c.invoice_title)===key(nm));
  if(!m) return 50;
  const mt=String(m.pay_habit||'').match(/訂金\s*(\d{1,3})\s*%/);
  const p=mt?parseInt(mt[1],10):50;
  return (p>0&&p<100)?p:50;
}
/* 依訂單總額＋付款規則帶入訂金/尾款（可再手改）；規則同上，預設各半 */
function fillHalf(){
  const gt=Math.round(parseFloat(document.getElementById('oe-grand_total').value)||0);
  if(!gt){ toast('請先填訂單總額','err'); return; }
  const o=(typeof ORDERS_CACHE!=='undefined'&&ORDERS_CACHE)?ORDERS_CACHE.find(x=>x.no===ORD_EDITING):null;
  const fromQuote=o?ordPayFromQuote(o,gt):null;   // 複檢 #3：優先用報價單條款上的實際金額
  if(fromQuote){
    document.getElementById('oe-deposit_amt').value=fromQuote.dep;
    document.getElementById('oe-final_amt').value=fromQuote.bal;
    toast(`已依報價單付款條件帶入：訂金 ${money(fromQuote.dep)}／尾款 ${money(fromQuote.bal)}`,'ok');
    return;
  }
  const pct=ordDepositPct(o?o.client:'');
  const dep=Math.round(gt*pct/100);
  document.getElementById('oe-deposit_amt').value=dep;
  document.getElementById('oe-final_amt').value=gt-dep;
  toast(`已依付款規則帶入（訂金 ${pct}%）：訂金 ${money(dep)}／尾款 ${money(gt-dep)}`,'ok');
}
function closeOrdEdit(){ document.getElementById('oe-overlay').style.display='none'; ORD_EDITING=null; }
async function saveOrdEdit(){
  if(!ORD_EDITING) return;
  if(_busy.ordEdit) return; _busy.ordEdit=true;
  const fields={ status:document.getElementById('oe-status').value };
  ['cust_lot','grand_total','deposit_amt','deposit_date','ship_date_est','ship_date_actual','invoice_no','invoice_date',
   'invoice_last5','invoice_detail','invoice_photos','final_amt','final_date_est','final_date','track_note']
    .forEach(k=>{ fields[k]=document.getElementById('oe-'+k).value; });
  // 自動推進：填了訂金日→排產中、實際出貨日→已出貨、發票→已開發票、尾款收款日→已收尾款。
  // 手動選了更後面的（含結案）或已取消就不動。
  let bumped='';
  if(fields.status!=='cancelled'){
    const eff=effOrdStatus(fields);
    if(eff!==fields.status){ bumped=stageLabel(eff); fields.status=eff; }
  }
  const no=ORD_EDITING, snap=ORDERS_CACHE;   // apiCall（寫入類）會把 ORDERS_CACHE 清空，先留一份
  const btn=document.getElementById('oe-save');
  if(btn){ btn.disabled=true; btn.textContent='儲存中…'; }
  try{
    const d=await apiCall({ action:'updateOrderStatus', token:AUTH_TOKEN, quote_no:no, fields });
    if(!d.ok){ if(snap&&!ORDERS_CACHE) ORDERS_CACHE=snap; toast(d.error||'儲存失敗','err'); return; }   // 失敗要把快照放回去，不然清單會卡死在空狀態
    // 先把改好的值直接更新到畫面（0 秒），背景再跟後端要最新的
    if(snap){
      ORDERS_CACHE=snap;
      const o=ORDERS_CACHE.find(x=>x.no===no);
      if(o) o.st=Object.assign({}, o.st||{}, fields, { quote_no:no, updated_at:new Date().toISOString() });
      renderOrders();
      if(typeof renderReport==='function' && currentPage==='report') renderReport();
    }
    toast(bumped?`進度已儲存，狀態自動更新為「${bumped}」`:'進度已儲存','ok'); closeOrdEdit();
    loadOrders().catch(()=>{});
    // 2026-08-24 Molly 回報：改出貨日期行事曆沒跟著改——之前只靠每小時排程或手動按「⟳ 同步」才會推到
    // 真正的 Google 日曆。這裡存檔成功後背景補打一次 syncCalendarNow，讓異動立即反映，不擋存檔流程、失敗也不打擾。
    if(typeof apiCall==='function' && AUTH_TOKEN) apiCall({ action:'syncCalendarNow', token:AUTH_TOKEN }).catch(()=>{});
  }catch(e){ if(snap&&!ORDERS_CACHE) ORDERS_CACHE=snap; toast(e.message||'儲存失敗','err'); }
  finally{ _busy.ordEdit=false; if(btn){ btn.disabled=false; btn.textContent='儲存進度'; } }
}

/* ---- v31 發票照片上傳（saveInvoicePhotos：存 Drive「發票照片/inv_單號」，資料夾連結回填 order_status.invoice_photos）---- */
function renderInvPhotoLinks(v){
  const box=document.getElementById('oe-invphoto-links'); if(!box) return;
  const links=String(v||'').split(',').map(s=>s.trim()).filter(s=>/^https?:\/\//.test(s));
  box.innerHTML=links.map((u,i)=>{
    const lbl=/\/folders\//.test(u) ? '📁 照片資料夾' : ('📷 發票照片'+(links.length>1?' '+(i+1):''));
    return `<a class="rec-act-btn" href="${escHtml(u)}" target="_blank" rel="noopener" style="margin:0 6px 4px 0">${lbl}</a>`;
  }).join('');
}
async function invPhotosPicked(ev){
  const files=Array.from(ev.target.files||[]);
  ev.target.value='';                       // 清空讓同一檔可再選
  if(!files.length) return;
  if(!ORD_EDITING){ toast('請先開啟訂單','err'); return; }
  if(_busy.invUpload){ toast('照片上傳中，請稍候','err'); return; }
  const arr=[];
  for(const f of files){
    if(!/^image\//.test(f.type||'')){ toast(`「${f.name}」不是圖片檔，略過`,'err'); continue; }
    try{ arr.push(await imgFileToData_(f)); }   // 沿用 B4 縮圖轉 base64（1600px/JPEG 0.85）
    catch(e){ toast(`「${f.name}」處理失敗，略過`,'err'); }
  }
  if(!arr.length) return;
  _busy.invUpload=true;
  const hint=document.getElementById('oe-invphoto-hint');
  const prev=document.getElementById('oe-invphoto-prev');
  prev.innerHTML=arr.map(i=>`<img src="${i.url}" style="width:52px;height:52px;object-fit:cover;border-radius:6px;border:1px solid var(--bd);opacity:.6">`).join('');
  hint.textContent=`上傳中…（${arr.length} 張）`;
  const snap=ORDERS_CACHE;   // 寫入會清空 ORDERS_CACHE，留一份
  try{
    const d=await apiCall({ action:'saveInvoicePhotos', token:AUTH_TOKEN, quote_no:ORD_EDITING,
      images: arr.map(i=>({name:i.name, mime:i.mime, data:i.data})) });
    if(snap&&!ORDERS_CACHE) ORDERS_CACHE=snap;
    if(!d.ok){ toast(d.error||'上傳失敗','err'); hint.textContent='上傳失敗，請再試一次'; return; }
    toast(`已上傳 ${arr.length} 張發票照片`,'ok');
    hint.textContent=''; prev.innerHTML='';
    await refreshInvPhotoLinks();             // 重新讀 order_status，避免之後儲存進度用舊值蓋掉
  }catch(e){ if(snap&&!ORDERS_CACHE) ORDERS_CACHE=snap; toast(e.message||'上傳失敗','err'); hint.textContent='上傳失敗，請再試一次'; }
  finally{ _busy.invUpload=false; }
}
async function refreshInvPhotoLinks(){
  try{
    const os=await apiCall({ action:'getOrderStatusList', token:AUTH_TOKEN });
    const row=(os.orders||[]).find(x=>x.quote_no===ORD_EDITING);
    if(row){
      document.getElementById('oe-invoice_photos').value=row.invoice_photos||'';
      renderInvPhotoLinks(row.invoice_photos||'');
      const o=(ORDERS_CACHE||[]).find(x=>x.no===ORD_EDITING); if(o) o.st=row;
    }
  }catch(_){}
}

/* ---- v31 分批出貨子紀錄（order_shipments：addShipment/listShipments/updateShipment）----
   主線 order_status 出貨欄位不動；約一成例外單才用，預設收合。
   日期讀回一律過 vmLocalYmd()：純日期字串原樣通過、時間戳轉台北日期，兩種後端行為都安全。 */
let SHP_LOADED=false, SHP_LIST=[], SHP_SUM=null;
function shpReset(){
  SHP_LOADED=false; SHP_LIST=[];
  const box=document.getElementById('shp-box'); if(box) box.style.display='none';
  const btn=document.getElementById('shp-toggle'); if(btn) btn.textContent='▸ 分批出貨（例外時才用）';
  const body=document.getElementById('shp-body'); if(body) body.innerHTML=sklTableRows(7,2);
}
function shpToggle(){
  const box=document.getElementById('shp-box');
  const btn=document.getElementById('shp-toggle');
  const open=box.style.display==='none';
  box.style.display=open?'block':'none';
  if(btn) btn.textContent=(open?'▾':'▸')+' 分批出貨（例外時才用）';
  if(open && !SHP_LOADED) loadShipments();
}
async function loadShipments(){
  const body=document.getElementById('shp-body');
  body.innerHTML=sklTableRows(7,2);
  try{
    const d=await apiCall({ action:'listShipments', token:AUTH_TOKEN, quote_no:ORD_EDITING });
    if(!d.ok){ body.innerHTML=`<tr><td colspan="7" class="rec-empty">${d.error||'載入失敗'}</td></tr>`; return; }
    SHP_LIST=d.shipments||d.list||[];
    SHP_LOADED=true;
    renderShipments();
    SHP_SUM=SHP_SUM||{}; SHP_SUM[ORD_EDITING]=SHP_LIST.length;   // 順手更新徽章快取
  }catch(e){ body.innerHTML=`<tr><td colspan="7" class="rec-empty">${e.message||'載入失敗'}</td></tr>`; }
}
function shpRowHtml(s, idx){
  return `<tr data-shpid="${escHtml(s.id||'')}">
    <td style="text-align:center;font-weight:600">${escHtml(String(s.seq||idx+1))}</td>
    <td><input class="fi" type="date" data-f="ship_date_est" value="${escHtml(vmLocalYmd(s.ship_date_est))}" style="min-width:132px"></td>
    <td><input class="fi" type="date" data-f="ship_date_actual" value="${escHtml(vmLocalYmd(s.ship_date_actual))}" style="min-width:132px"></td>
    <td><input class="fi" type="number" data-f="amount" value="${(s.amount!=null&&s.amount!=='')?escHtml(String(s.amount)):''}" style="min-width:92px;text-align:right"></td>
    <td><input class="fi" data-f="invoice_last5" maxlength="5" inputmode="numeric" value="${escHtml(s.invoice_last5||'')}" style="min-width:72px"></td>
    <td><input class="fi" data-f="note" value="${escHtml(s.note||'')}" style="min-width:120px"></td>
    <td style="white-space:nowrap"><button type="button" class="rec-act-btn" onclick="shpSaveRow(this)">儲存</button> <button type="button" class="rec-act-btn del" onclick="shpDelRow(this)">刪除</button></td>
  </tr>`;
}
function renderShipments(){
  const body=document.getElementById('shp-body');
  if(!SHP_LIST.length){ body.innerHTML='<tr><td colspan="7" class="rec-empty">此單尚無分批紀錄，按「＋新增一批」開始</td></tr>'; return; }
  body.innerHTML=SHP_LIST.map((s,i)=>shpRowHtml(s,i)).join('');
}
function shpAddRow(){
  const box=document.getElementById('shp-box');
  if(box.style.display==='none') shpToggle();
  const body=document.getElementById('shp-body');
  if(body.querySelector('tr[data-shpid=""]')){ toast('先儲存這一批，再新增下一批','err'); return; }
  if(!SHP_LIST.length) body.innerHTML='';
  body.insertAdjacentHTML('beforeend', shpRowHtml({id:'', seq:SHP_LIST.length+1}, SHP_LIST.length));
}
async function shpSaveRow(btn){
  const tr=btn.closest('tr'); if(!tr) return;
  if(_busy.shpSave) return; _busy.shpSave=true;
  const id=tr.getAttribute('data-shpid');
  const fields={};
  tr.querySelectorAll('input[data-f]').forEach(inp=>{ fields[inp.getAttribute('data-f')]=inp.value; });
  if(fields.invoice_last5 && !/^\d{5}$/.test(fields.invoice_last5)){ toast('發票末五碼需為 5 位數字','err'); _busy.shpSave=false; return; }
  btn.disabled=true; btn.textContent='…';
  const snap=ORDERS_CACHE;   // 寫入會清空 ORDERS_CACHE，留一份，避免關窗後訂單列表卡死在空狀態
  try{
    let d;
    if(id){ d=await apiCall({ action:'updateShipment', token:AUTH_TOKEN, id, fields }); }
    else  { d=await apiCall(Object.assign({ action:'addShipment', token:AUTH_TOKEN, quote_no:ORD_EDITING, fields }, fields)); }  // 扁平＋fields 都給，相容兩種後端寫法
    if(snap&&!ORDERS_CACHE) ORDERS_CACHE=snap;
    if(!d.ok){ toast(d.error||'儲存失敗','err'); return; }
    toast(id?'這一批已更新':'已新增一批','ok');
    await loadShipments();
    loadOrders().catch(()=>{});   // 背景刷新訂單彙總
  }catch(e){ if(snap&&!ORDERS_CACHE) ORDERS_CACHE=snap; toast(e.message||'儲存失敗','err'); }
  finally{ btn.disabled=false; btn.textContent='儲存'; _busy.shpSave=false; }
}
async function shpDelRow(btn){
  const tr=btn.closest('tr'); if(!tr) return;
  const id=tr.getAttribute('data-shpid');
  if(!id){                                   // 還沒存進後端的新列：直接把這一列移掉就好
    tr.remove();
    if(!document.getElementById('shp-body').children.length) renderShipments();
    return;
  }
  if(!confirm('確定刪除這一批出貨紀錄？\n只刪這筆分批紀錄，訂單本身的出貨資料不受影響。刪除後無法復原。')) return;
  if(_busy.shpDel) return; _busy.shpDel=true;
  btn.disabled=true; btn.textContent='…';
  const snap=ORDERS_CACHE;   // 寫入會清空 ORDERS_CACHE，留一份
  try{
    const d=await apiCall({ action:'deleteShipment', token:AUTH_TOKEN, id });
    if(snap&&!ORDERS_CACHE) ORDERS_CACHE=snap;
    if(!d.ok){ toast(d.error||'刪除失敗','err'); return; }
    toast('已刪除這一批','ok');
    await loadShipments();
    loadShipmentBadges();                    // 順手刷新訂單列的「分批×N」徽章
  }catch(e){ if(snap&&!ORDERS_CACHE) ORDERS_CACHE=snap; toast(e.message||'刪除失敗','err'); }
  finally{ btn.disabled=false; btn.textContent='刪除'; _busy.shpDel=false; }
}
/* 訂單列「分批×N」徽章：試打不帶 quote_no 的 listShipments，後端若回全部就能顯示；不支援就靜默略過 */
async function loadShipmentBadges(force){
  try{
    if(!AUTH_TOKEN) return;
    const d=await readCall({ action:'listShipments', token:AUTH_TOKEN }, force).catch(()=>null);
    if(!d||!d.ok) return;
    const arr=d.shipments||d.list||[];
    if(!Array.isArray(arr)) return;
    const m={}; arr.forEach(s=>{ if(s.quote_no) m[s.quote_no]=(m[s.quote_no]||0)+1; });
    SHP_SUM=m;
    renderOrders();
  }catch(_){}
}

/* ---- 複製舊單（新單號，避免沿用舊號重複建單）---- */
async function copyOrder(no, src){
  try{
    if(src==='custom'){
      await loadCustomQuoteByNo(no, true);
      return;
    }
    const d=await readCall({ action:'getQuoteById', token:AUTH_TOKEN, quoteNo:no });
    if(!d.ok){ toast(d.error||'讀取失敗','err'); return; }
    loadQuoteIntoForm(d.quote);
    editingQuoteNo=null;                       // 關鍵：複製＝新單，不沿用舊單號
    const today=fmtD(new Date());
    document.getElementById('f-dt').value=today;
    // 找出今天已用過的最大流水號 +1，避免複製出來的單號與現有單撞號
    // （改用讀取快取：正常情況 0 秒，不用每次複製都多等一趟後端）
    let nextSer=1;
    try{
      const base=today.replace(/-/g,'');
      const lst=await readCall(withLimit({ action:'getQuotes', token:AUTH_TOKEN, filters:{} }));
      if(lst.ok && Array.isArray(lst.quotes)){
        lst.quotes.forEach(x=>{ const m=String(x.quoteNo||'').match(new RegExp('^'+base+'-(\\d+)$')); if(m){ const n=parseInt(m[1],10); if(n>=nextSer) nextSer=n+1; } });
      }
    }catch(_){}
    document.getElementById('f-ser').value=nextSer;
    if(typeof onDate==='function') onDate();
    if(typeof upNo==='function') upNo();       // 依今天日期＋新流水號產生單號
    gotoPage('new');
    toast('已複製 '+no+' 為新單，單號：'+document.getElementById('f-no').value+'（存檔前可再調整流水號）','ok');
  }catch(e){ toast(e.message||'複製失敗','err'); }
}

/* ---- 修改紀錄 ---- */
async function openChangeLog(no){
  const box=document.getElementById('cl-body');
  document.getElementById('cl-title').textContent=`修改紀錄 — ${no}`;
  box.innerHTML=sklBlock(5);
  document.getElementById('cl-overlay').style.display='flex';
  try{
    const d=await apiCall({ action:'getChangeLog', token:AUTH_TOKEN, ref_no:no });
    if(!d.ok){ box.innerHTML=`<div class="rec-empty">${d.error||'載入失敗'}</div>`; return; }
    const logs=d.logs||[];
    if(!logs.length){ box.innerHTML='<div class="rec-empty">此單尚無異動紀錄（異動日誌自 2026-07-16 起記錄）</div>'; return; }
    box.innerHTML=logs.map((l,i)=>{
      const p=parseJsonSafe(l.payload_json,{});
      const q=p.quote||p.fields||p;
      const hints=[];
      if(q.clientName||q.client) hints.push('客戶 '+(q.clientName||q.client));
      if(q.grandTotal!=null) hints.push('總計 '+money(q.grandTotal));
      if(q.status) hints.push('狀態 '+stageLabel(q.status));
      if(q.track_note) hints.push('📌 '+String(q.track_note).split('\n')[0]);
      return `<div class="cl-row">
        <div class="cl-head" onclick="const x=document.getElementById('clp-${i}');x.style.display=x.style.display==='none'?'block':'none'">
          <b>${new Date(l.ts).toLocaleString('zh-TW',{hour12:false})}</b>　<span class="cl-act">${escHtml(l.action)}</span>
          <span style="color:#6B6B63;font-size:12px">${hints.map(escHtml).join('　·　')}</span>
          <span style="float:right;color:#A6824A;font-size:11px">展開▾</span>
        </div>
        <pre id="clp-${i}" style="display:none">${escHtml(JSON.stringify(p,null,2))}</pre>
      </div>`;
    }).join('');
  }catch(e){ box.innerHTML=`<div class="rec-empty">${e.message||'載入失敗'}</div>`; }
}
function closeChangeLog(){ document.getElementById('cl-overlay').style.display='none'; }

/* ---- 月報表（對帳視角） ---- */
let RPT_Y=new Date().getFullYear(), RPT_M=new Date().getMonth()+1;
function rptShift(d){ RPT_M+=d; if(RPT_M<1){RPT_M=12;RPT_Y--;} if(RPT_M>12){RPT_M=1;RPT_Y++;} renderReport(); }
/* 尾款金額：s.final_amt 有填就用，沒填就用 grand_total（沒有就退回 o.total）減 deposit_amt 推估，並標示為推估（只顯示，不寫回後端） */
function rptFinalAmt(o){
  const s=o.st||{};
  if(s.final_amt!=null && s.final_amt!==''){ return {amt:parseFloat(s.final_amt)||0, est:false}; }
  const gt=(s.grand_total!=null && s.grand_total!=='') ? (parseFloat(s.grand_total)||0) : (parseFloat(o.total)||0);
  const dep=parseFloat(s.deposit_amt)||0;
  return {amt:gt-dep, est:true};
}
/* 訂單金額：訂單追蹤裡手改過的「訂單總額」(grand_total) 優先，沒填才用報價單的總計。
   複檢 2026-08-13 #3-10：原本列表與月報表成交金額固定讀報價單總計，客戶追加後手改的金額不會反映，
   但同一頁的尾款推估卻是用 grand_total —— 同一張單在同一頁出現兩套基準。 */
function ordGrandTotal(o){
  const s=(o&&o.st)||{};
  if(s.grand_total!=null && String(s.grand_total)!=='') return parseFloat(s.grand_total)||0;
  return parseFloat(o&&o.total)||0;
}
/* 訂金金額：s.deposit_amt 有填就用；沒填但尾款有填 → 用總額－尾款推估；兩欄都空白 → 回 missing（不計入合計，另外標示筆數）。
   複檢 2026-08-13 #1-4：原本月報表的「本月已收訂金／已收尾款」是 parseFloat(...)||0，空白直接當 0，
   但同一頁的「還沒收的尾款」卻會推估 —— 同一筆錢在報表上兩邊都看不到。 */
function rptDepositAmt(o){
  const s=o.st||{};
  if(s.deposit_amt!=null && s.deposit_amt!==''){ return {amt:parseFloat(s.deposit_amt)||0, est:false}; }
  const gt=(s.grand_total!=null && s.grand_total!=='') ? (parseFloat(s.grand_total)||0) : (parseFloat(o.total)||0);
  if(s.final_amt!=null && s.final_amt!==''){ return {amt:Math.max(0, gt-(parseFloat(s.final_amt)||0)), est:true}; }
  return {amt:0, est:true, missing:true};
}
/* 帳齡天數：這筆應收「掛在帳上幾天了」。優先用發票日（開了票才真的算應收），
   沒開票就用實際出貨日；兩個都沒有才退回預計尾款日、再退回報價日。都沒有回 null。 */
function rptAgeDays(o){
  const s=o.st||{};
  const cand=[s.invoice_date, s.ship_date_actual, s.final_date_est, o.quoteDate];
  for(const c of cand){
    const d=String(c==null?'':c).trim();
    if(/^\d{4}-\d{2}-\d{2}/.test(d)){ const n=daysBetween(d.slice(0,10)); if(n!=null) return -n; }
  }
  return null;
}
function rptUnpaidList(){
  if(!ORDERS_CACHE) return [];
  return ORDERS_CACHE.filter(o=>{
    const s=effOrdStatus(o.st);
    return (s==='shipped'||s==='invoiced') && !(o.st&&o.st.final_date);
  });
}
function rptUnbilledList(){
  if(!ORDERS_CACHE) return [];
  // 已出貨（含尾款先收了）但發票還沒開；結案／取消的不追
  return ORDERS_CACHE.filter(o=>{ const s=effOrdStatus(o.st); return (s==='shipped'||(s==='paid'&&o.st&&o.st.ship_date_actual)) && !(o.st&&o.st.invoice_no); });
}
/* 成交日：訂金日／實際出貨日／尾款收款日中「最早的實際發生日」。
   三個都沒填、但狀態有手動推進（不是報價中/已取消）→ 退回報價日。
   先出貨、隔月才請款的單：沒收過訂金就算在「出貨那個月」；有訂金就算在收訂金那個月。 */
function rptDealDate(o){
  const s=effOrdStatus(o.st);
  if(s==='quoted'||s==='cancelled') return '';
  const st=o.st||{};
  const ds=[st.deposit_date, st.ship_date_actual, st.final_date]
    .map(v=>String(v||'').trim()).filter(v=>/^\d{4}-\d{2}/.test(v)).sort();
  return ds[0]||o.quoteDate||'';
}
function renderReport(){
  const el=document.getElementById('rpt-box'); if(!el||!ORDERS_CACHE) return;
  const mm=`${RPT_Y}-${String(RPT_M).padStart(2,'0')}`;
  const inMonth=ORDERS_CACHE.filter(o=>(o.quoteDate||'').startsWith(mm));
  // 成交＝以「成交日」歸屬月份（訂金→出貨→收款中最早的實際日期），不再看報價日、
  // 也不再被手動狀態卡住：只要有填收款/出貨日期，就算狀態忘了改也會列入
  const dealt=ORDERS_CACHE.filter(o=>rptDealDate(o).startsWith(mm));
  const sum=dealt.reduce((s,o)=>s+ordGrandTotal(o),0);
  const byC={}; dealt.forEach(o=>{ const k=o.client.split('｜')[0]; byC[k]=byC[k]||{n:0,a:0}; byC[k].n++; byC[k].a+=ordGrandTotal(o); });
  const rows=Object.entries(byC).sort((a,b)=>b[1].a-a[1].a);

  // 對帳視角：本月已收訂金／已收尾款（存量以外的月份篩選），未收尾款（存量、不分月）
  const depositedThisMonth=ORDERS_CACHE.filter(o=>effOrdStatus(o.st)!=='cancelled' && (o.st?.deposit_date||'').startsWith(mm));
  const depRows=depositedThisMonth.map(o=>rptDepositAmt(o));
  const depositSum=depRows.reduce((s,r)=>s+r.amt,0);
  const depEst=depRows.filter(r=>r.est&&!r.missing).length, depMiss=depRows.filter(r=>r.missing).length;
  const paidThisMonth=ORDERS_CACHE.filter(o=>effOrdStatus(o.st)!=='cancelled' && (o.st?.final_date||'').startsWith(mm));
  const paidRows=paidThisMonth.map(o=>rptFinalAmt(o));
  const paidSum=paidRows.reduce((s,r)=>s+r.amt,0);
  const paidEst=paidRows.filter(r=>r.est).length;
  const amtHint=(est,miss)=>{
    const p=[]; if(est) p.push('含推估 '+est+' 筆'); if(miss) p.push(miss+' 筆未填金額未計入');
    return p.length?'<div style="font-size:10px;color:#B5541F;margin-top:2px">'+p.join('、')+'</div>':'';
  };
  const unpaidList=rptUnpaidList();
  /* 帳齡（2026-08-11 優化建議 #3）：從「這筆錢開始能收」那天算起——
     有開發票就從發票日，沒開就從實際出貨日；都沒有才退回預計尾款日／報價日。
     排序改成帳齡由大到小＝欠最久的排最前面，才知道要先催誰。 */
  const unpaidRows=unpaidList.map(o=>({o, age:rptAgeDays(o), ...rptFinalAmt(o)}))
    .sort((a,b)=>(b.age==null?-1:b.age)-(a.age==null?-1:a.age));
  const unpaidSum=unpaidRows.reduce((s,r)=>s+r.amt,0);
  const ageBuckets=[
    {k:'≤30 天',   hit:n=>n!=null&&n<=30,            col:'#5A5850'},
    {k:'31–60 天', hit:n=>n!=null&&n>30&&n<=60,      col:'#B5541F'},
    {k:'61–90 天', hit:n=>n!=null&&n>60&&n<=90,      col:'#B03A2E'},
    {k:'超過 90 天',hit:n=>n!=null&&n>90,            col:'#B03A2E'},
    {k:'無日期',    hit:n=>n==null,                   col:'#A8A69C'}
  ].map(b=>{ const rs=unpaidRows.filter(r=>b.hit(r.age)); return {...b, n:rs.length, a:rs.reduce((s,r)=>s+r.amt,0)}; })
   .filter(b=>b.n>0);
  const unbilledList=rptUnbilledList().slice().sort((a,b)=>(a.st?.ship_date_actual||'').localeCompare(b.st?.ship_date_actual||''));

  el.innerHTML=`
    <div class="rpt-head">月報表　<span class="qf-chip act" onclick="rptShift(-1)">◀ 上月</span> <b>${RPT_Y} 年 ${RPT_M} 月</b> <span class="qf-chip act" onclick="rptShift(1)">下月 ▶</span>
      <button class="rec-act-btn" style="float:right" onclick="exportReport()">匯出 CSV</button></div>
    <div class="rpt-stats">
      <div class="rpt-stat"><div class="k">成交筆數</div><div class="v">${dealt.length} 筆</div></div>
      <div class="rpt-stat"><div class="k">成交金額</div><div class="v" style="color:#A6824A">${money(sum)}</div></div>
      <div class="rpt-stat"><div class="k">本月報價</div><div class="v">${inMonth.length} 筆</div></div>
      <div class="rpt-stat"><div class="k">本月已收訂金</div><div class="v" style="color:#2E7D4F">${money(depositSum)}</div>${amtHint(depEst,depMiss)}</div>
      <div class="rpt-stat"><div class="k">本月已收尾款</div><div class="v" style="color:#2E7D4F">${money(paidSum)}</div>${amtHint(paidEst,0)}</div>
      <div class="rpt-stat"><div class="k">還沒收的尾款（累計）</div><div class="v" style="color:#B03A2E">${money(unpaidSum)}</div></div>
    </div>
    ${rows.length?`<div class="tbl-scroll"><table class="rec-table mcard" style="margin-top:10px"><thead><tr><th>客戶</th><th style="text-align:center">筆數</th><th style="text-align:right">金額</th></tr></thead><tbody>
      ${rows.map(([k,v])=>`<tr><td class="mc-main">${escHtml(k)}</td><td data-l="筆數" style="text-align:center">${v.n}</td><td data-l="金額" style="text-align:right">${money(v.a)}</td></tr>`).join('')}
    </tbody></table></div>`:'<div class="rec-empty">本月尚無成交（有填訂金日／出貨日／收款日其中一個，就會列入該月）</div>'}
    <div style="font-size:11px;color:#A8A69C;margin-top:8px">※ 成交以「最早的實際往來日」歸屬月份：有收訂金→算收訂金那個月；先出貨後請款→算出貨那個月；直接付全款→算收款那個月。「本月報價」則照報價日計算。</div>

    <div class="rpt-head" style="margin-top:22px">還沒收的尾款　<span style="font-size:11px;color:#A8A69C;font-weight:400">已出貨或已開發票、但還沒收尾款的單（不分月份，欠最久的排最前面，點列可開編輯進度）</span></div>
    ${ageBuckets.length?`<div class="rpt-age">${ageBuckets.map(b=>
      `<div class="rpt-age-box"><div class="k">帳齡 ${b.k}</div><div class="v" style="color:${b.col}">${money(b.a)}</div><div class="n">${b.n} 筆</div></div>`).join('')}</div>`:''}
    ${unpaidRows.length?`<div class="tbl-scroll"><table class="rec-table mcard" style="margin-top:8px"><thead><tr><th>單號</th><th>客戶</th><th style="text-align:right">尾款金額</th><th style="text-align:center">預計尾款日</th><th style="text-align:center">發票</th><th style="text-align:center">帳齡</th></tr></thead><tbody>
      ${unpaidRows.map(r=>{
        const o=r.o, s=o.st||{};
        const fde=s.final_date_est;
        let fdeTxt='—';
        if(fde){ const d=daysBetween(fde); fdeTxt=(d!=null&&d<0)?`<span style="color:#B03A2E;font-weight:600">${escHtml(fde.slice(5))}（逾期${-d}天）</span>`:escHtml(fde.slice(5)); }
        return `<tr style="cursor:pointer" onclick="openOrdEdit(decodeURIComponent('${encodeURIComponent(o.no)}'))">
          <td class="mc-main"><b>${escHtml(o.no)}</b></td>
          <td data-l="客戶">${escHtml(o.client.split('｜')[0])}</td>
          <td data-l="尾款金額" style="text-align:right">${money(r.amt)}${r.est?'<span style="color:#B5541F;font-size:10.5px;margin-left:4px">推估</span>':''}</td>
          <td data-l="預計尾款日" style="text-align:center">${fdeTxt}</td>
          <td data-l="發票" style="text-align:center">${s.invoice_no?'✓':'未開'}</td>
          <td data-l="帳齡" style="text-align:center">${r.age==null?'—':`<span class="ob ${r.age>90?'red':(r.age>60?'red':(r.age>30?'warn':'info'))}">${r.age} 天</span>`}</td>
        </tr>`;
      }).join('')}
    </tbody><tfoot><tr><td colspan="2" style="text-align:right;font-weight:700">合計</td><td style="text-align:right;font-weight:700">${money(unpaidSum)}</td><td colspan="3"></td></tr></tfoot></table></div>`
      :'<div class="rec-empty">目前沒有還沒收的尾款 🎉</div>'}

    <div class="rpt-head" style="margin-top:22px">已出貨未開發票　<span style="font-size:11px;color:#A8A69C;font-weight:400">出貨超過 7 天標橘提醒</span></div>
    ${unbilledList.length?`<div class="tbl-scroll"><table class="rec-table mcard" style="margin-top:8px"><thead><tr><th>單號</th><th>客戶</th><th style="text-align:center">實際出貨日</th><th style="text-align:center">出貨後天數</th></tr></thead><tbody>
      ${unbilledList.map(o=>{
        const sd=o.st?.ship_date_actual;
        const d=sd?daysBetween(sd):null;
        const days=d==null?null:-d;
        return `<tr style="cursor:pointer" onclick="openOrdEdit(decodeURIComponent('${encodeURIComponent(o.no)}'))">
          <td class="mc-main"><b>${escHtml(o.no)}</b></td>
          <td data-l="客戶">${escHtml(o.client.split('｜')[0])}</td>
          <td data-l="實際出貨日" style="text-align:center">${sd?escHtml(sd.slice(5)):'—'}</td>
          <td data-l="出貨天數" style="text-align:center">${days==null?'—':`<span class="ob ${days>7?'warn':''}">${days} 天</span>`}</td>
        </tr>`;
      }).join('')}
    </tbody></table></div>`:'<div class="rec-empty">目前沒有已出貨未開發票的單 🎉</div>'}

    <div style="margin-top:16px"><span class="qf-chip act" onclick="gotoPage('consign')">寄售月結請款 → 前往寄售管理</span></div>`;
}
function exportReport(){
  if(!ORDERS_CACHE) return;
  const mm=`${RPT_Y}-${String(RPT_M).padStart(2,'0')}`;
  // 匯出範圍＝報價日或成交日落在本月的單（跟畫面上的成交統計對得起來）
  const rows=ORDERS_CACHE.filter(o=>(o.quoteDate||'').startsWith(mm) || rptDealDate(o).startsWith(mm));
  const head=['單號','類型','客戶','客戶批號','報價日','成交日','總計','狀態','訂金','訂金日','預計出貨','實際出貨','發票號碼','發票開立日','發票後五碼','尾款','預計尾款日','尾款收款日','備註'];
  const csv=[head.join(',')].concat(rows.map(o=>{
    const s=o.st||{};
    const esc=v=>'"'+String(v==null?'':v).replace(/"/g,'""').replace(/\n/g,' ')+'"';
    /* 2026-09-01 複檢：畫面用 ordGrandTotal（訂單追蹤可手改的成交金額），匯出卻用報價單原始金額，
       客戶追加酒款後兩邊對不起來。改成跟畫面同一個來源。 */
    return [o.no,o.type,o.client,ordCustLot(o),o.quoteDate,rptDealDate(o),Math.round(ordGrandTotal(o)),stageLabel(effOrdStatus(s)),s.deposit_amt||'',s.deposit_date||'',s.ship_date_est||'',s.ship_date_actual||'',s.invoice_no||'',s.invoice_date||'',s.invoice_last5||'',s.final_amt||'',s.final_date_est||'',s.final_date||'',s.track_note||''].map(esc).join(',');
  })).join('\r\n');
  const blob=new Blob(['﻿'+csv],{type:'text/csv'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download=`訂單報表_${mm}.csv`; document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(a.href),3000);
}

/* 寫入類動作清掉讀取快取時，訂單頁的衍生資料也一併歸零，
   免得下一次進來先畫出「存檔前」的舊列表。 */
onCacheClear(function(){ ORDERS_CACHE=null; ORDER_VSUM=null; SHP_SUM=null; });
