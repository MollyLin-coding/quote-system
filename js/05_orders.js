/* ============================================================
   二、訂單追蹤
   ============================================================ */
const ORDER_STAGES=[['quoted','報價中'],['deposit','已收訂金'],['shipped','已出貨'],['invoiced','已開發票'],['paid','已收尾款'],['closed','結案'],['cancelled','已取消']];
function stageLabel(s){ const f=ORDER_STAGES.find(x=>x[0]===s); return f?f[1]:'報價中'; }
function stageIdx(s){ return {quoted:1,deposit:2,shipped:3,invoiced:4,paid:5,closed:6}[s]||1; }
/* 六關卡：報價→訂金→出貨→發票→尾款→結案。以「有沒有填資料」或狀態判斷是否過關 */
function orderSteps(st){
  st=st||{}; const s=st.status||'quoted';
  const ge=(arr)=>arr.includes(s);
  return [
    {key:'quote',   label:'報價', done:true,                                                              date:''},
    {key:'deposit', label:'訂金', done: !!st.deposit_date     || ge(['deposit','shipped','invoiced','paid','closed']), date: st.deposit_date||''},
    {key:'ship',    label:'出貨', done: !!st.ship_date_actual || ge(['shipped','invoiced','paid','closed']),           date: st.ship_date_actual||''},
    {key:'invoice', label:'發票', done: !!st.invoice_date     || ge(['invoiced','paid','closed']),                     date: st.invoice_date||''},
    {key:'final',   label:'尾款', done: !!st.final_date       || ge(['paid','closed']),                                date: st.final_date||''},
    {key:'closed',  label:'結案', done: s==='closed'          || !!st.closed_at,                                       date: st.closed_at||''}
  ];
}
function orderTimelineHtml(o){
  const st=o.st||{}; const steps=orderSteps(st);
  steps[0].date=o.quoteDate||'';
  if(!steps[2].done && st.ship_date_est)  steps[2].sub='預計 '+st.ship_date_est.slice(5);
  if(!steps[4].done && st.final_date_est) steps[4].sub='預計 '+st.final_date_est.slice(5);
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
function ordPayloads(){
  return [ withLimit({action:'getQuotes', token:AUTH_TOKEN, filters:{}}),
           {action:'listCustomQuotes', token:AUTH_TOKEN},
           {action:'getOrderStatusList', token:AUTH_TOKEN} ];
}
function buildOrders(qs, cq, os){
  const stMap={}; ((os&&os.orders)||[]).forEach(o=>{ stMap[o.quote_no]=o; });
  const list=[];
  ((qs&&qs.quotes)||[]).filter(q=>q.status!=='已刪除').forEach(q=>{
    list.push({ no:q.quoteNo, client:q.clientName||'—', type:q.quoteType==='banquet'?'宴會':'瓶裝',
      typeKey:q.quoteType, total:q.grandTotal||0, quoteDate:q.quoteDate||'', expiry:q.expiryDate||'',
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
  }else if(body){ body.innerHTML=sklTableRows(6,5); }
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
function orderBadges(o){
  const s=o.st?.status||'quoted';
  let h='';
  if(s==='quoted' && o.expiry){
    const d=daysBetween(o.expiry);
    if(d!=null && d<0) h+='<span class="ob red">已過有效期</span>';
    else if(d!=null && d<=7) h+=`<span class="ob red">有效期剩 ${d} 天</span>`;
  }
  if(o.st?.ship_date_est && !o.st?.ship_date_actual && ['deposit','quoted'].includes(s)){
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
    ORDER_VSUM={ forms:(lf&&lf.summary)||{}, reps:(gv&&gv.summary)||{}, repList:(gv&&gv.records)||[] };
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
function orderDots(o){
  const s=o.st?.status||'quoted';
  if(s==='cancelled') return '<span class="ost grey">已取消</span>';
  const steps=orderSteps(o.st||{});
  let dots=''; steps.forEach(sp=>{ dots+=`<span class="odot${sp.done?' f':''}"></span>`; });
  return `<span class="odots">${dots}</span><span class="ost">${stageLabel(s)}</span>`;
}
function passOrdFilter(o){
  const s=o.st?.status||'quoted';
  switch(ORD_FILTER){
    case 'all': return s!=='cancelled';
    case 'quoted': return s==='quoted';
    case 'toship': return s==='deposit';
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
function renderOrders(){
  const body=document.getElementById('ord-body'); if(!body||!ORDERS_CACHE) return;
  // 篩選計數
  const cnt=k=>{ const old=ORD_FILTER; ORD_FILTER=k; const n=ORDERS_CACHE.filter(passOrdFilter).length; ORD_FILTER=old; return n; };
  const fs=[['all','全部'],['quoted','報價中'],['toship','待出貨'],['toinv','待開發票'],['tofinal','待收尾款'],['done','已結案'],['cancelled','已取消']];
  document.getElementById('ord-filters').innerHTML=fs.map(([k,l])=>
    `<button class="fchip${ORD_FILTER===k?' on':''}" onclick="setOrdFilter('${k}',this)">${l} <b>${cnt(k)}</b></button>`).join('');
  const rows=ORDERS_CACHE.filter(passOrdFilter);
  if(!rows.length){ body.innerHTML='<tr><td colspan="6" class="rec-empty">沒有符合的訂單</td></tr>'+(listMaybeMore(ORDERS_CACHE.length)?moreRowHtml(6):''); return; }
  body.innerHTML=rows.map(o=>{
    const note=(o.st?.track_note||'').split('\n')[0];
    const shipD=o.st?.ship_date_actual?`${o.st.ship_date_actual.slice(5)} ✓`:(o.st?.ship_date_est?o.st.ship_date_est.slice(5):'—');
    return `<tr>
      <td class="mc-main"><b>${escHtml(o.no)}</b> <span class="rec-badge ${o.typeKey==='banquet'?'banquet':o.typeKey==='custom'?'custom':'bottle'}">${o.type}</span><br>
        <span style="color:#6B6B63;font-size:11.5px">${escHtml(o.client)}</span></td>
      <td data-l="進度">${orderDots(o)}${note?`<br><span class="onote">📌 ${escHtml(note)}${(o.st.track_note.includes('\n'))?'…':''}</span>`:''}</td>
      <td data-l="總計" style="text-align:right;font-weight:600">${money(o.total)}</td>
      <td data-l="出貨日" style="text-align:center">${shipD}</td>
      <td data-l="提醒">${orderBadges(o)}${orderVerifyBadge(o)}</td>
      <td class="rec-actions" data-l="操作">
        <button class="rec-act-btn" onclick="openOrdEdit('${escHtml(o.no)}')">編輯進度</button>
        <button class="rec-act-btn" onclick="copyOrder('${escHtml(o.no)}','${o.src}')">複製</button>
        <button class="rec-act-btn" onclick="openChangeLog('${escHtml(o.no)}')">修改紀錄</button>
        ${['bottle','ownbrand','ownlabel','consign'].includes(o.typeKey)?`<button class="rec-act-btn" onclick="openVerifyForm('${escHtml(o.no)}')">驗收單</button>`:''}
        ${o.src==='custom'?`<button class="rec-act-btn" onclick="loadCustomFromOrders('${escHtml(o.no)}')">載入編輯</button>`:''}
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
  ['deposit_amt','deposit_date','ship_date_est','ship_date_actual','invoice_no','invoice_date',
   'invoice_last5','invoice_detail','invoice_photos','final_amt','final_date_est','final_date'].forEach(k=>{
    document.getElementById('oe-'+k).value=g(k);
  });
  // 訂單總額：沒存過就先帶報價單總額，讓後端據此算訂金/尾款各半
  document.getElementById('oe-grand_total').value = st.grand_total || (o.total?Math.round(o.total):'') || '';
  // 這張單從沒存過進度（新單）→ 訂金/尾款依付款規則自動帶入（預設各半；
  // 客戶主檔「付款習慣」寫「訂金30%」就帶 30/70）。存過的單一律不動，避免蓋掉手改值。
  if(!st.updated_at && !String(g('deposit_amt')).trim() && !String(g('final_amt')).trim()){
    const _gt=Math.round(parseFloat(document.getElementById('oe-grand_total').value)||0);
    if(_gt>0){
      const _pct=ordDepositPct(o.client);
      const _dep=Math.round(_gt*_pct/100);
      document.getElementById('oe-deposit_amt').value=_dep;
      document.getElementById('oe-final_amt').value=_gt-_dep;
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
  ['grand_total','deposit_amt','deposit_date','ship_date_est','ship_date_actual','invoice_no','invoice_date',
   'invoice_last5','invoice_detail','invoice_photos','final_amt','final_date_est','final_date','track_note']
    .forEach(k=>{ fields[k]=document.getElementById('oe-'+k).value; });
  try{
    const d=await apiCall({ action:'updateOrderStatus', token:AUTH_TOKEN, quote_no:ORD_EDITING, fields });
    if(!d.ok){ toast(d.error||'儲存失敗','err'); return; }
    toast('進度已儲存','ok'); closeOrdEdit();
    await loadOrders(true);
  }catch(e){ toast(e.message||'儲存失敗','err'); }
  finally{ _busy.ordEdit=false; }
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
  try{
    const d=await apiCall({ action:'saveInvoicePhotos', token:AUTH_TOKEN, quote_no:ORD_EDITING,
      images: arr.map(i=>({name:i.name, mime:i.mime, data:i.data})) });
    if(!d.ok){ toast(d.error||'上傳失敗','err'); hint.textContent='上傳失敗，請再試一次'; return; }
    toast(`已上傳 ${arr.length} 張發票照片`,'ok');
    hint.textContent=''; prev.innerHTML='';
    await refreshInvPhotoLinks();             // 重新讀 order_status，避免之後儲存進度用舊值蓋掉
  }catch(e){ toast(e.message||'上傳失敗','err'); hint.textContent='上傳失敗，請再試一次'; }
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
  try{
    let d;
    if(id){ d=await apiCall({ action:'updateShipment', token:AUTH_TOKEN, id, fields }); }
    else  { d=await apiCall(Object.assign({ action:'addShipment', token:AUTH_TOKEN, quote_no:ORD_EDITING, fields }, fields)); }  // 扁平＋fields 都給，相容兩種後端寫法
    if(!d.ok){ toast(d.error||'儲存失敗','err'); return; }
    toast(id?'這一批已更新':'已新增一批','ok');
    await loadShipments();
  }catch(e){ toast(e.message||'儲存失敗','err'); }
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
  try{
    const d=await apiCall({ action:'deleteShipment', token:AUTH_TOKEN, id });
    if(!d.ok){ toast(d.error||'刪除失敗','err'); return; }
    toast('已刪除這一批','ok');
    await loadShipments();
    loadShipmentBadges();                    // 順手刷新訂單列的「分批×N」徽章
  }catch(e){ toast(e.message||'刪除失敗','err'); }
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
    const d=await apiCall({ action:'getQuoteById', token:AUTH_TOKEN, quoteNo:no });
    if(!d.ok){ toast(d.error||'讀取失敗','err'); return; }
    loadQuoteIntoForm(d.quote);
    editingQuoteNo=null;                       // 關鍵：複製＝新單，不沿用舊單號
    const today=fmtD(new Date());
    document.getElementById('f-dt').value=today;
    // 找出今天已用過的最大流水號 +1，避免複製出來的單號與現有單撞號
    let nextSer=1;
    try{
      const base=today.replace(/-/g,'');
      const lst=await apiCall({ action:'getQuotes', token:AUTH_TOKEN, filters:{} });
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
function rptUnpaidList(){
  if(!ORDERS_CACHE) return [];
  return ORDERS_CACHE.filter(o=>{
    const s=o.st?.status;
    return (s==='shipped'||s==='invoiced') && !(o.st&&o.st.final_date);
  });
}
function rptUnbilledList(){
  if(!ORDERS_CACHE) return [];
  return ORDERS_CACHE.filter(o=> o.st?.status==='shipped' && !(o.st&&o.st.invoice_no));
}
function renderReport(){
  const el=document.getElementById('rpt-box'); if(!el||!ORDERS_CACHE) return;
  const mm=`${RPT_Y}-${String(RPT_M).padStart(2,'0')}`;
  const inMonth=ORDERS_CACHE.filter(o=>(o.quoteDate||'').startsWith(mm));
  const dealt=inMonth.filter(o=>{ const s=o.st?.status||'quoted'; return s!=='quoted'&&s!=='cancelled'; });
  const sum=dealt.reduce((s,o)=>s+(parseFloat(o.total)||0),0);
  const byC={}; dealt.forEach(o=>{ const k=o.client.split('｜')[0]; byC[k]=byC[k]||{n:0,a:0}; byC[k].n++; byC[k].a+=parseFloat(o.total)||0; });
  const rows=Object.entries(byC).sort((a,b)=>b[1].a-a[1].a);

  // 對帳視角：本月已收訂金／已收尾款（存量以外的月份篩選），未收尾款（存量、不分月）
  const depositedThisMonth=ORDERS_CACHE.filter(o=>o.st?.status!=='cancelled' && (o.st?.deposit_date||'').startsWith(mm));
  const depositSum=depositedThisMonth.reduce((s,o)=>s+(parseFloat(o.st.deposit_amt)||0),0);
  const paidThisMonth=ORDERS_CACHE.filter(o=>o.st?.status!=='cancelled' && (o.st?.final_date||'').startsWith(mm));
  const paidSum=paidThisMonth.reduce((s,o)=>s+(parseFloat(o.st.final_amt)||0),0);
  const unpaidList=rptUnpaidList();
  const rptRowDaysLeft=r=>{ const d=daysBetween(r.o.st?.final_date_est); return d==null?99999:d; };
  const unpaidRows=unpaidList.map(o=>({o, ...rptFinalAmt(o)})).sort((a,b)=>rptRowDaysLeft(a)-rptRowDaysLeft(b));
  const unpaidSum=unpaidRows.reduce((s,r)=>s+r.amt,0);
  const unbilledList=rptUnbilledList().slice().sort((a,b)=>(a.st?.ship_date_actual||'').localeCompare(b.st?.ship_date_actual||''));

  el.innerHTML=`
    <div class="rpt-head">月報表　<span class="qf-chip act" onclick="rptShift(-1)">◀ 上月</span> <b>${RPT_Y} 年 ${RPT_M} 月</b> <span class="qf-chip act" onclick="rptShift(1)">下月 ▶</span>
      <button class="rec-act-btn" style="float:right" onclick="exportReport()">匯出 CSV</button></div>
    <div class="rpt-stats">
      <div class="rpt-stat"><div class="k">成交筆數</div><div class="v">${dealt.length} 筆</div></div>
      <div class="rpt-stat"><div class="k">成交金額</div><div class="v" style="color:#A6824A">${money(sum)}</div></div>
      <div class="rpt-stat"><div class="k">本月報價</div><div class="v">${inMonth.length} 筆</div></div>
      <div class="rpt-stat"><div class="k">本月已收訂金</div><div class="v" style="color:#2E7D4F">${money(depositSum)}</div></div>
      <div class="rpt-stat"><div class="k">本月已收尾款</div><div class="v" style="color:#2E7D4F">${money(paidSum)}</div></div>
      <div class="rpt-stat"><div class="k">還沒收的尾款（累計）</div><div class="v" style="color:#B03A2E">${money(unpaidSum)}</div></div>
    </div>
    ${rows.length?`<div class="tbl-scroll"><table class="rec-table" style="margin-top:10px"><thead><tr><th>客戶</th><th style="text-align:center">筆數</th><th style="text-align:right">金額</th></tr></thead><tbody>
      ${rows.map(([k,v])=>`<tr><td>${escHtml(k)}</td><td style="text-align:center">${v.n}</td><td style="text-align:right">${money(v.a)}</td></tr>`).join('')}
    </tbody></table></div>`:'<div class="rec-empty">本月尚無成交（狀態需為已收訂金以上才列入）</div>'}
    <div style="font-size:11px;color:#A8A69C;margin-top:8px">※ 以報價日期歸屬月份；狀態「已收訂金」（含）之後視為成交。</div>

    <div class="rpt-head" style="margin-top:22px">還沒收的尾款　<span style="font-size:11px;color:#A8A69C;font-weight:400">已出貨或已開發票、但還沒收尾款的單（不分月份，點列可開編輯進度）</span></div>
    ${unpaidRows.length?`<div class="tbl-scroll"><table class="rec-table" style="margin-top:8px"><thead><tr><th>單號</th><th>客戶</th><th style="text-align:right">尾款金額</th><th style="text-align:center">預計尾款日</th><th style="text-align:center">發票</th></tr></thead><tbody>
      ${unpaidRows.map(r=>{
        const o=r.o, s=o.st||{};
        const fde=s.final_date_est;
        let fdeTxt='—';
        if(fde){ const d=daysBetween(fde); fdeTxt=(d!=null&&d<0)?`<span style="color:#B03A2E;font-weight:600">${escHtml(fde.slice(5))}（逾期${-d}天）</span>`:escHtml(fde.slice(5)); }
        return `<tr style="cursor:pointer" onclick="openOrdEdit('${escHtml(o.no)}')">
          <td><b>${escHtml(o.no)}</b></td>
          <td>${escHtml(o.client.split('｜')[0])}</td>
          <td style="text-align:right">${money(r.amt)}${r.est?'<span style="color:#B5541F;font-size:10.5px;margin-left:4px">推估</span>':''}</td>
          <td style="text-align:center">${fdeTxt}</td>
          <td style="text-align:center">${s.invoice_no?'✓':'未開'}</td>
        </tr>`;
      }).join('')}
    </tbody><tfoot><tr><td colspan="2" style="text-align:right;font-weight:700">合計</td><td style="text-align:right;font-weight:700">${money(unpaidSum)}</td><td colspan="2"></td></tr></tfoot></table></div>`
      :'<div class="rec-empty">目前沒有還沒收的尾款 🎉</div>'}

    <div class="rpt-head" style="margin-top:22px">已出貨未開發票　<span style="font-size:11px;color:#A8A69C;font-weight:400">出貨超過 7 天標橘提醒</span></div>
    ${unbilledList.length?`<div class="tbl-scroll"><table class="rec-table" style="margin-top:8px"><thead><tr><th>單號</th><th>客戶</th><th style="text-align:center">實際出貨日</th><th style="text-align:center">出貨後天數</th></tr></thead><tbody>
      ${unbilledList.map(o=>{
        const sd=o.st?.ship_date_actual;
        const d=sd?daysBetween(sd):null;
        const days=d==null?null:-d;
        return `<tr style="cursor:pointer" onclick="openOrdEdit('${escHtml(o.no)}')">
          <td><b>${escHtml(o.no)}</b></td>
          <td>${escHtml(o.client.split('｜')[0])}</td>
          <td style="text-align:center">${sd?escHtml(sd.slice(5)):'—'}</td>
          <td style="text-align:center">${days==null?'—':`<span class="ob ${days>7?'warn':''}">${days} 天</span>`}</td>
        </tr>`;
      }).join('')}
    </tbody></table></div>`:'<div class="rec-empty">目前沒有已出貨未開發票的單 🎉</div>'}

    <div style="margin-top:16px"><span class="qf-chip act" onclick="gotoPage('consign')">寄售月結請款 → 前往寄售管理</span></div>`;
}
function exportReport(){
  if(!ORDERS_CACHE) return;
  const mm=`${RPT_Y}-${String(RPT_M).padStart(2,'0')}`;
  const rows=ORDERS_CACHE.filter(o=>(o.quoteDate||'').startsWith(mm));
  const head=['單號','類型','客戶','報價日','總計','狀態','訂金','訂金日','預計出貨','實際出貨','發票號碼','發票開立日','發票後五碼','尾款','預計尾款日','尾款收款日','備註'];
  const csv=[head.join(',')].concat(rows.map(o=>{
    const s=o.st||{};
    const esc=v=>'"'+String(v==null?'':v).replace(/"/g,'""').replace(/\n/g,' ')+'"';
    return [o.no,o.type,o.client,o.quoteDate,Math.round(o.total),stageLabel(s.status||'quoted'),s.deposit_amt||'',s.deposit_date||'',s.ship_date_est||'',s.ship_date_actual||'',s.invoice_no||'',s.invoice_date||'',s.invoice_last5||'',s.final_amt||'',s.final_date_est||'',s.final_date||'',s.track_note||''].map(esc).join(',');
  })).join('\r\n');
  const blob=new Blob(['﻿'+csv],{type:'text/csv'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download=`訂單報表_${mm}.csv`; document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(a.href),3000);
}

/* 寫入類動作清掉讀取快取時，訂單頁的衍生資料也一併歸零，
   免得下一次進來先畫出「存檔前」的舊列表。 */
onCacheClear(function(){ ORDERS_CACHE=null; ORDER_VSUM=null; SHP_SUM=null; });
