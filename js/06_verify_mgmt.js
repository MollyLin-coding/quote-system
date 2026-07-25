/* ============================================================
   二之二、出貨驗收管理（第三批）
   資料來源：getVerifications（客戶掃碼回報）／listVerifyForms（驗收單留底）
   欄位皆容錯：後端欄位名若有出入，讀不到就留白、不會壞頁。
   ============================================================ */
let VM_TAB='pending';           // pending | all | noreport | forms
let VM_CAT='all';               // 客訴分類篩選：all | 回報問題 | 驗收無誤 | 其他
let VM_DATA=null;
let VM_PROC_ID=null;
const VM_NOREPORT_DAYS=7;

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
function vmPhotos(p){ return vmArr(p).map(x=>{ if(x&&typeof x==='object') return x.url||x.src||x.link||x.dataUrl||''; return x; }).filter(Boolean); }
function vmStatusNorm(s){ s=String(s||'').trim(); if(!s||s==='待處理'||s==='未處理'||s==='新'||s==='pending') return '待處理'; return s; }
function vmIsIssue(r){
  const t=String(r.type||'').trim();
  if(/問題|issue|不良|客訴|退|補|異常/i.test(t)) return true;
  if(/無誤|合格|ok|good|正常|收到/i.test(t)) return false;
  return !!String(r.desc||'').trim();
}
function vmIsUnhandled(r){ return vmIsIssue(r) && vmStatusNorm(r.status)==='待處理'; }
/* 客訴分類（後端 v32 起 addVerification 會把「回報問題／驗收無誤／其他」如實存進 type 欄）。
   客戶掃碼回報那條線的 type 是另一組（ok／外觀／瓶內異物／數量不符／其他），這裡統一歸成三類供顯示與篩選；
   原本的 vmIsIssue／vmIsUnhandled 判斷完全不動，待處理計數與「處理」鈕行為維持原樣。 */
function vmCat(r){
  const t=String((r&&r.type)||'').trim();
  if(t==='回報問題'||t==='驗收無誤'||t==='其他') return t;
  if(!t) return vmIsIssue(r)?'回報問題':'驗收無誤';
  if(/^ok$/i.test(t)||/無誤|合格|正常|收到/.test(t)) return '驗收無誤';
  if(/問題|外觀|異物|不符|不良|客訴|退|補|異常|破|少|漏/.test(t)) return '回報問題';
  return '其他';
}
function vmCatCounts(reps){
  const c={'回報問題':0,'驗收無誤':0,'其他':0};
  (reps||[]).forEach(r=>{ const k=vmCat(r); if(c[k]!=null) c[k]++; });
  return c;
}
function setVmCat(c){ VM_CAT=c; renderVerifyMgmt(); }
function vmCatBar(reps){
  const c=vmCatCounts(reps);
  const defs=[['all','全部',(reps||[]).length],['回報問題','⚠ 回報問題',c['回報問題']],['驗收無誤','✓ 驗收無誤',c['驗收無誤']],['其他','其他',c['其他']]];
  return `<div class="vcat-bar">${defs.map(([k,l,n])=>
    `<button type="button" class="vcat${VM_CAT===k?' on':''}" onclick="setVmCat('${k}')">${l} <b>${n}</b></button>`).join('')}</div>`;
}
function vmClientOf(no){
  if(VM_DATA){ const r=(VM_DATA.reports||[]).find(x=>x.no===no&&x.client); if(r) return r.client; }
  if(ORDERS_CACHE){ const o=ORDERS_CACHE.find(x=>x.no===no); if(o) return (o.client||'').split('｜')[0]; }
  return '';
}
function vmToday(){ const t=new Date(),p=n=>String(n).padStart(2,'0'); return t.getFullYear()+'-'+p(t.getMonth()+1)+'-'+p(t.getDate()); }

async function loadVerifyMgmt(force){
  const body=document.getElementById('vm-body');
  if(body && (force||!VM_DATA)) body.innerHTML='<div class="rec-empty">載入中…</div>';
  try{
    if(!ORDERS_CACHE){ try{ await loadOrders(); }catch(_){} }
    const [gv, lf] = await Promise.all([
      apiCall({action:'getVerifications', token:AUTH_TOKEN, filters:{}}).catch(e=>({ok:false,error:e.message})),
      apiCall({action:'listVerifyForms', token:AUTH_TOKEN, filters:{}}).catch(e=>({ok:false,error:e.message}))
    ]);
    VM_DATA={
      reports:(gv&&gv.records)||[], repSum:(gv&&gv.summary)||{},
      forms:(lf&&lf.records)||[], formSum:(lf&&lf.summary)||{},
      gvErr:(gv&&gv.ok===false)?gv.error:null, lfErr:(lf&&lf.ok===false)?lf.error:null
    };
    fillVmNoList();
    renderVerifyMgmt();
  }catch(e){ if(body) body.innerHTML=`<div class="rec-empty">${escHtml(e.message||'載入失敗')}</div>`; }
}
function setVmTab(t){ VM_TAB=t; renderVerifyMgmt(); }
function vmNoReportList(){
  if(!VM_DATA) return [];
  const shipped={};
  Object.keys(VM_DATA.formSum||{}).forEach(no=>{ const s=VM_DATA.formSum[no]||{}; shipped[no]=s.last_at||s.last||s.last_date||''; });
  (VM_DATA.forms||[]).forEach(f=>{ if(shipped[f.no]==null||shipped[f.no]==='') shipped[f.no]=f.ship_date||f.created_at||''; });
  const reported={};
  (VM_DATA.reports||[]).forEach(r=>{ if(r.no) reported[r.no]=true; });
  Object.keys(VM_DATA.repSum||{}).forEach(no=>{ reported[no]=true; });
  const list=[];
  Object.keys(shipped).forEach(no=>{
    if(reported[no]) return;
    const d=vmDaysSince(shipped[no]);
    if(d==null||d>=VM_NOREPORT_DAYS) list.push({no, shipDate:vmLocalYmd(shipped[no]), days:d, client:vmClientOf(no)});
  });
  list.sort((a,b)=>(b.days||0)-(a.days||0));
  return list;
}
function vmCounts(){
  const reps=VM_DATA?VM_DATA.reports:[];
  return { pending:reps.filter(vmIsUnhandled).length, all:reps.length, noreport:vmNoReportList().length, forms:(VM_DATA?VM_DATA.forms:[]).length };
}
function renderVerifyMgmt(){
  const wrap=document.getElementById('vm-body'); if(!wrap) return;
  if(!VM_DATA){ wrap.innerHTML='<div class="rec-empty">載入中…</div>'; return; }
  const c=vmCounts();
  const fs=[['pending','待處理回報',c.pending],['all','全部回報',c.all],['noreport','未回報催單',c.noreport],['forms','驗收單留底',c.forms]];
  document.getElementById('vm-filters').innerHTML=fs.map(([k,l,n])=>
    `<button class="fchip${VM_TAB===k?' on':''}" onclick="setVmTab('${k}')">${l} <b>${n}</b></button>`).join('');
  let warn='';
  if(VM_DATA.gvErr||VM_DATA.lfErr) warn=`<div class="ob warn" style="display:block;margin:0 0 10px;padding:8px 12px;font-size:11.5px">部分資料讀取失敗（後端可能尚未更新此功能）：${escHtml(VM_DATA.gvErr||VM_DATA.lfErr||'')}</div>`;
  if(VM_TAB==='forms') wrap.innerHTML=warn+vmRenderForms();
  else if(VM_TAB==='noreport') wrap.innerHTML=warn+vmRenderNoReport();
  else wrap.innerHTML=warn+vmRenderReports(VM_TAB==='pending');
}
function vmStatusPill(r){
  if(!vmIsIssue(r)) return '<span class="vpill ok">驗收無誤</span>';
  const s=vmStatusNorm(r.status), map={'待處理':'wait','退費':'refund','補發':'resend','結案':'done'};
  return `<span class="vpill ${map[s]||'wait'}">${escHtml(s)}</span>`;
}
function vmRenderReports(pendingOnly){
  let reps=(VM_DATA.reports||[]).slice();
  if(pendingOnly) reps=reps.filter(vmIsUnhandled);
  const bar=vmCatBar(reps);                       // 分類徽章的數字＝套用分類篩選「之前」的數量
  if(VM_CAT!=='all') reps=reps.filter(r=>vmCat(r)===VM_CAT);
  reps.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
  if(!reps.length) return bar+`<div class="rec-empty">${VM_CAT!=='all'?('「'+VM_CAT+'」目前沒有紀錄'):(pendingOnly?'目前沒有待處理的客戶回報 🎉':'尚無客戶回報紀錄')}</div>`;
  const rows=reps.map(r=>{
    const photos=vmPhotos(r.photos).map((src,i)=>`<img class="vth" src="${escAttr(src)}" onclick="window.open('${escAttr(src)}','_blank')" alt="照片${i+1}">`).join('');
    const issue=vmIsIssue(r);
    const cat=vmCat(r);
    const catCls=cat==='回報問題'?'issue':(cat==='驗收無誤'?'good':'other');
    const catTxt=cat==='回報問題'?'⚠ 回報問題':(cat==='驗收無誤'?'✓ 驗收無誤':'• 其他');
    const rawT=String(r.type||'').trim();
    const rawTxt=(rawT&&rawT!==cat)?`<span style="font-size:11px;color:#6B6B63">（${escHtml(rawT)}）</span>`:'';
    const dt=String(r.created_at||'').replace('T',' ').slice(0,16);
    return `<tr>
      <td style="white-space:nowrap;color:#6B6B63;font-size:11.5px">${escHtml(dt)||'—'}</td>
      <td><b>${escHtml(r.no||'—')}</b><br><span style="color:#6B6B63;font-size:11.5px">${escHtml(r.client||vmClientOf(r.no)||'')}</span></td>
      <td><span class="vtype ${catCls}">${catTxt}</span>${rawTxt}${r.item?`<br><span style="font-size:11.5px;color:#6B6B63">${escHtml(r.item)}</span>`:''}${r.desc?`<br><span style="font-size:12px">${escHtml(r.desc)}</span>`:''}${photos?`<br>${photos}`:''}</td>
      <td style="text-align:center">${vmStatusPill(r)}${r.handle_note?`<br><span style="font-size:11px;color:#6B6B63">${escHtml(r.handle_note)}</span>`:''}${(r.amount!=null&&r.amount!=='')?`<br><span style="font-size:11px;color:var(--gold-deep)">${money(r.amount)}</span>`:''}</td>
      <td class="rec-actions">${issue?`<button class="rec-act-btn" onclick="openVmProc('${escAttr(r.id)}')">處理</button>`:''}<button class="rec-act-btn del" onclick="vmDelReport('${escAttr(r.id)}','${escAttr(r.no||'')}')">刪除</button></td>
    </tr>`;
  }).join('');
  return bar+`<div class="tbl-scroll"><table class="rec-table">
    <thead><tr><th>時間</th><th>單號／客戶</th><th>回報內容</th><th style="text-align:center">處理</th><th>操作</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}
function vmRenderNoReport(){
  const list=vmNoReportList();
  if(!list.length) return `<div class="rec-empty">沒有逾 ${VM_NOREPORT_DAYS} 天未回報的單 🎉（已出貨的都回報了，或尚無驗收單留底可對照）</div>`;
  const rows=list.map(o=>{
    const dtxt=o.days==null?'—':(o.days+' 天');
    return `<tr>
      <td><b>${escHtml(o.no)}</b><br><span style="color:#6B6B63;font-size:11.5px">${escHtml(o.client||'')}</span></td>
      <td style="text-align:center">${escHtml((o.shipDate||'').slice(0,10))||'—'}</td>
      <td style="text-align:center"><span class="ob ${(o.days!=null&&o.days>=VM_NOREPORT_DAYS)?'red':'warn'}">出貨 ${dtxt} 未回報</span></td>
      <td class="rec-actions"><button class="rec-act-btn" onclick="vmCopyReminder('${escAttr(o.no)}','${escAttr((o.shipDate||'').slice(0,10))}')">複製催單訊息</button></td>
    </tr>`;
  }).join('');
  return `<div style="font-size:11.5px;color:#A8A69C;margin-bottom:8px">已出貨（有開驗收單）滿 ${VM_NOREPORT_DAYS} 天、客戶仍未掃碼回報的單。按「複製催單訊息」貼到 LINE 即可。</div>
    <div class="tbl-scroll"><table class="rec-table">
    <thead><tr><th>單號／客戶</th><th style="text-align:center">出貨日</th><th style="text-align:center">狀態</th><th>操作</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}
function vmRenderForms(){
  const forms=(VM_DATA.forms||[]).slice();
  forms.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
  if(!forms.length) return `<div class="rec-empty">尚無驗收單留底（之後每次產生驗收單會自動存一筆）</div>`;
  const rows=forms.map(f=>{
    // items 欄位後端可能回陣列（items）或 JSON 字串（items_json），兩種都容錯讀
    const items=Array.isArray(f.items)?f.items:parseJsonSafe(f.items_json,[]);
    const names=(Array.isArray(items)?items:[]).map(it=>it.name).filter(Boolean).slice(0,3).join('、')+((Array.isArray(items)&&items.length>3)?'…':'');
    const dt=String(f.created_at||'').replace('T',' ').slice(0,16);
    return `<tr>
      <td style="white-space:nowrap;color:#6B6B63;font-size:11.5px">${escHtml(dt)||'—'}</td>
      <td><b>${escHtml(f.no||'—')}</b>${f.lot?` <span style="color:#6B6B63">Lot ${escHtml(f.lot)}</span>`:''}</td>
      <td style="text-align:center">${escHtml(vmLocalYmd(f.ship_date))||'—'}</td>
      <td style="text-align:center">${escHtml(f.pm||'')||'—'}</td>
      <td style="text-align:center">${(f.boxes!=null&&f.boxes!=='')?escHtml(f.boxes)+' 箱':'—'}</td>
      <td style="font-size:11.5px;color:#6B6B63">${escHtml(names)||'—'}</td>
      <td class="rec-actions"><button class="rec-act-btn del" onclick="vmDelForm('${escAttr(f.id)}','${escAttr(f.no||'')}')">刪除</button></td>
    </tr>`;
  }).join('');
  return `<div class="tbl-scroll"><table class="rec-table">
    <thead><tr><th>產生時間</th><th>單號</th><th style="text-align:center">配送日</th><th style="text-align:center">PM</th><th style="text-align:center">箱數</th><th>品項</th><th>操作</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}
/* ---- 刪除（後端 v32：deleteVerification／deleteVerifyForm／deleteShipment，皆 {id}→整列刪除、不可復原）---- */
async function vmDelReport(id, no){
  if(!id){ toast('這筆沒有編號，無法刪除','err'); return; }
  if(!confirm(`確定刪除這筆回報紀錄${no?`（單號 ${no}）`:''}？\n刪除後無法復原。`)) return;
  if(_busy.vmDel) return; _busy.vmDel=true;
  try{
    const d=await apiCall({ action:'deleteVerification', token:AUTH_TOKEN, id });
    if(!d.ok){ toast(d.error||'刪除失敗','err'); return; }
    toast('已刪除這筆回報','ok'); await loadVerifyMgmt(true);
  }catch(e){ toast(e.message||'刪除失敗','err'); }
  finally{ _busy.vmDel=false; }
}
async function vmDelForm(id, no){
  if(!id){ toast('這筆沒有編號，無法刪除','err'); return; }
  if(!confirm(`確定刪除這筆驗收單留底${no?`（單號 ${no}）`:''}？\n只會刪掉這筆產生紀錄，已印出的驗收單 PDF 不受影響。刪除後無法復原。`)) return;
  if(_busy.vmDelForm) return; _busy.vmDelForm=true;
  try{
    const d=await apiCall({ action:'deleteVerifyForm', token:AUTH_TOKEN, id });
    if(!d.ok){ toast(d.error||'刪除失敗','err'); return; }
    toast('已刪除這筆驗收單留底','ok'); await loadVerifyMgmt(true);
  }catch(e){ toast(e.message||'刪除失敗','err'); }
  finally{ _busy.vmDelForm=false; }
}
function vmCopyReminder(no, shipDate){
  const d=shipDate?String(shipDate).replace(/-/g,'/'):'';
  const msg=`您好，這裡是凱文南坡萬 🍶\n您於 ${d||'近日'} 收到的商品（單號 ${no}）目前系統尚未收到您的線上驗收回報。\n煩請掃描出貨單上的 QR Code 完成驗收（約 30 秒）；若逾期未回報將視同驗收合格。如商品有任何問題也歡迎直接回覆，我們會立即為您處理，謝謝！`;
  vmClip(msg);
}
function vmClip(text){
  try{
    if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(()=>toast('催單訊息已複製，貼到 LINE 即可','ok'),()=>vmClipFallback(text));
    else vmClipFallback(text);
  }catch(e){ vmClipFallback(text); }
}
function vmClipFallback(text){
  const ta=document.createElement('textarea'); ta.value=text; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select();
  try{ document.execCommand('copy'); toast('催單訊息已複製','ok'); }catch(_){ toast('複製失敗，請手動選取','err'); }
  document.body.removeChild(ta);
}
/* 處理狀態 */
function openVmProc(id){
  const r=(VM_DATA.reports||[]).find(x=>String(x.id)===String(id)); if(!r){ toast('查無此回報','err'); return; }
  VM_PROC_ID=id;
  document.getElementById('vmp-info').innerHTML=`<b>${escHtml(r.no||'')}</b>　${escHtml(r.client||vmClientOf(r.no)||'')}${r.item?('<br>'+escHtml(r.item)):''}${r.desc?('<br>'+escHtml(r.desc)):''}`;
  document.getElementById('vmp-status').value=vmStatusNorm(r.status);
  document.getElementById('vmp-amount').value=(r.amount!=null?r.amount:'');
  document.getElementById('vmp-handle_note').value=r.handle_note||'';
  document.getElementById('vmp-closed_date').value=vmLocalYmd(r.closed_date);
  document.getElementById('vmp-overlay').style.display='flex';
}
function closeVmProc(){ document.getElementById('vmp-overlay').style.display='none'; VM_PROC_ID=null; }
async function saveVmProc(){
  if(!VM_PROC_ID) return;
  if(_busy.vmProc) return; _busy.vmProc=true;
  const fields={ status:document.getElementById('vmp-status').value, handle_note:document.getElementById('vmp-handle_note').value,
    amount:document.getElementById('vmp-amount').value, closed_date:document.getElementById('vmp-closed_date').value };
  if(fields.status==='結案'&&!fields.closed_date) fields.closed_date=vmToday();
  try{
    const d=await apiCall({action:'updateVerificationStatus', token:AUTH_TOKEN, id:VM_PROC_ID, fields});
    if(!d.ok){ toast(d.error||'儲存失敗','err'); return; }
    toast('已更新處理狀態','ok'); closeVmProc(); await loadVerifyMgmt(true);
  }catch(e){ toast(e.message||'儲存失敗','err'); }
  finally{ _busy.vmProc=false; }
}
/* 手動登記客訴 */
function fillVmNoList(){
  const dl=document.getElementById('vmm-nolist'); if(!dl||!ORDERS_CACHE) return;
  dl.innerHTML=ORDERS_CACHE.slice(0,300).map(o=>`<option value="${escAttr(o.no)}">${escAttr((o.client||'').split('｜')[0])}</option>`).join('');
}
function openVmManual(){
  ['vmm-no','vmm-client','vmm-item','vmm-desc','vmm-reporter'].forEach(id=>{ const e=document.getElementById(id); if(e) e.value=''; });
  document.getElementById('vmm-type').value='回報問題';
  fillVmNoList();
  document.getElementById('vmm-overlay').style.display='flex';
}
function closeVmManual(){ document.getElementById('vmm-overlay').style.display='none'; }
async function saveVmManual(){
  if(_busy.vmManual) return;
  const no=document.getElementById('vmm-no').value.trim();
  const desc=document.getElementById('vmm-desc').value.trim();
  if(!no&&!desc){ toast('請至少填單號或問題說明','err'); return; }
  _busy.vmManual=true;
  // 後端 addVerification 吃「扁平頂層欄位」，不是包在 record:{...} 裡面（已實測對齊）
  const payload={ action:'addVerification', token:AUTH_TOKEN, no,
    client:document.getElementById('vmm-client').value.trim(), type:document.getElementById('vmm-type').value,
    item:document.getElementById('vmm-item').value.trim(), desc, reporter:document.getElementById('vmm-reporter').value.trim(), status:'待處理' };
  try{
    const d=await apiCall(payload);
    if(!d.ok){ toast(d.error||'登記失敗（後端可能尚未支援手動登記）','err'); return; }
    toast('已登記','ok'); closeVmManual(); await loadVerifyMgmt(true);
  }catch(e){ toast(e.message||'登記失敗','err'); }
  finally{ _busy.vmManual=false; }
}

/* ============================================================
   三、自訂單後台備份
   ============================================================ */
function collectCustomQuote(){
  const v=id=>document.getElementById(id).value;
  const items=[];
  customItems.forEach(id=>{
    const row=document.getElementById(`cr-${id}`); if(!row) return;
    const name=gs(row,'name'); if(!name) return;
    items.push({ name, note:gs(row,'note'), qty:gs(row,'qty'), unit:gs(row,'unit'), price:gs(row,'price'),
      manual:row.querySelector('[data-f="manual"]').checked, free:row.querySelector('[data-f="free"]').checked,
      subval:row.querySelector('[data-f="subval"]').value });
  });
  const pm=s=>parseFloat(String(s).replace(/[^0-9.\-]/g,''))||0;
  return {
    quote_no:v('c-no').trim(), tag:v('c-tag').trim(), client:v('c-cli').trim(), contact:v('c-con').trim(),
    quote_date:v('c-dt'), expiry:v('c-ex'), tax_mode:v('c-taxmode'), tax_rate:v('c-taxrate'),
    headers_json:JSON.stringify({ name:v('c-h-name'), qty:v('c-h-qty'), unit:v('c-h-unit'), price:v('c-h-price'), sub:v('c-h-sub') }),
    items_json:JSON.stringify(items),
    totals_json:JSON.stringify({ sub:pm(document.getElementById('c-t-sub').textContent), tax:pm(document.getElementById('c-t-tax').textContent), total:pm(document.getElementById('c-t-tot').textContent) }),
    // 客戶統編/發票抬頭/電話/地址/出貨資訊：包成一個 JSON 欄位存放，後端只要新增這一欄即可，不用逐一新增欄位
    client_json:JSON.stringify({
      tax_id:v('c-tax').trim(), invoice_title:v('c-inv').trim(), phone:v('c-ph').trim(), address:v('c-ad').trim(),
      ship_same:document.getElementById('c-shipsame')?document.getElementById('c-shipsame').checked:true,
      ship_contact:v('c-shipcon').trim(), ship_phone:v('c-shipph').trim(), ship_address:v('c-shipad').trim()
    })
  };
}
async function saveCustomToBackend(){
  if(_busy.customSave) return; _busy.customSave=true;
  calcCustom();
  const q=collectCustomQuote();
  if(!q.client && !(parseJsonSafe(q.items_json,[]).length)){ toast('請先填寫內容再儲存','err'); _busy.customSave=false; return; }
  try{
    const d=await apiCall({ action:'saveCustomQuote', token:AUTH_TOKEN, quote:q });
    if(!d.ok){ toast(d.error||'儲存失敗','err'); return; }
    const saved=d.quote||q;
    if(saved.quote_no) document.getElementById('c-no').value=saved.quote_no;
    toast('已儲存到後台：'+(saved.quote_no||''),'ok');
    loadMyCustomQuotes();
  }catch(e){ toast(e.message||'儲存失敗','err'); }
  finally{ _busy.customSave=false; }
}
async function loadMyCustomQuotes(){
  const box=document.getElementById('cq-list'); if(!box) return;
  box.innerHTML='<div class="rec-empty">載入中…</div>';
  try{
    const d=await apiCall({ action:'listCustomQuotes', token:AUTH_TOKEN });
    if(!d.ok){ box.innerHTML=`<div class="rec-empty">${d.error||'載入失敗'}</div>`; return; }
    const qs=(d.quotes||[]).sort((a,b)=>(b.updated_at||'').localeCompare(a.updated_at||''));
    window._CQ_CACHE=qs;
    if(!qs.length){ box.innerHTML='<div class="rec-empty">尚無已備份的自訂單</div>'; return; }
    box.innerHTML=`<div class="tbl-scroll"><table class="rec-table"><thead><tr><th>單號 / 案名</th><th>客戶</th><th style="text-align:right">總計</th><th>更新</th><th>操作</th></tr></thead><tbody>`+
      qs.map(q=>{
        const tot=parseJsonSafe(q.totals_json,{}).total||0;
        return `<tr><td><b>${escHtml(q.quote_no||'—')}</b><br><span style="color:#6B6B63;font-size:11.5px">${escHtml(q.tag||'')}</span></td>
        <td>${escHtml(q.client||'—')}</td><td style="text-align:right;font-weight:600">${money(tot)}</td>
        <td>${(q.updated_at||'').slice(0,10)}</td>
        <td class="rec-actions"><button class="rec-act-btn" onclick="loadCustomQuoteByNo('${escHtml(q.quote_no)}',false)">載入編輯</button>
        <button class="rec-act-btn" onclick="loadCustomQuoteByNo('${escHtml(q.quote_no)}',true)">複製成新單</button></td></tr>`;
      }).join('')+'</tbody></table></div>';
  }catch(e){ box.innerHTML=`<div class="rec-empty">${e.message||'載入失敗'}</div>`; }
}
async function loadCustomQuoteByNo(no, asCopy){
  let q=(window._CQ_CACHE||[]).find(x=>x.quote_no===no);
  if(!q){
    const d=await apiCall({ action:'listCustomQuotes', token:AUTH_TOKEN });
    q=(d.quotes||[]).find(x=>x.quote_no===no);
  }
  if(!q){ toast('找不到 '+no,'err'); return; }
  resetCustom(true);
  const set=(id,v)=>{ document.getElementById(id).value=v==null?'':v; };
  set('c-tag',q.tag); set('c-cli',q.client); set('c-con',q.contact);
  set('c-taxmode',q.tax_mode||'inc'); set('c-taxrate',q.tax_rate==null?5:q.tax_rate); // 稅率 0 要保留
  const h=parseJsonSafe(q.headers_json,{});
  set('c-h-name',h.name||''); set('c-h-qty',h.qty||''); set('c-h-unit',h.unit||''); set('c-h-price',h.price||''); set('c-h-sub',h.sub||'');
  // 客戶統編/發票抬頭/電話/地址/出貨資訊（舊單若無 client_json，欄位維持空白，不影響載入）
  const ci=parseJsonSafe(q.client_json,{});
  set('c-tax',ci.tax_id||''); set('c-inv',ci.invoice_title||''); set('c-ph',ci.phone||''); set('c-ad',ci.address||'');
  set('c-shipcon',ci.ship_contact||''); set('c-shipph',ci.ship_phone||''); set('c-shipad',ci.ship_address||'');
  { const sc=document.getElementById('c-shipsame'); if(sc) sc.checked=(ci.ship_same!==false); toggleShipSame('c'); }
  if(asCopy){ set('c-no',''); set('c-dt',fmtD(new Date())); set('c-ex',''); }
  else { set('c-no',q.quote_no); set('c-dt',q.quote_date); set('c-ex',q.expiry); }
  document.getElementById('c-rows').innerHTML=''; customItems=[];
  parseJsonSafe(q.items_json,[]).forEach(it=> addCustomRow(it));
  if(customItems.length===0) addCustomRow();
  syncCustomPills(); calcCustom();
  gotoPage('custom');
  toast(asCopy?('已複製 '+no+' 為新自訂單'):('已載入 '+no),'ok');
}
function loadCustomFromOrders(no){ loadCustomQuoteByNo(no,false); }

