/* ============================================================
   二之二、出貨驗收管理（第三批）
   資料來源：getVerifications（客戶掃碼回報）／listVerifyForms（驗收單留底）
   欄位皆容錯：後端欄位名若有出入，讀不到就留白、不會壞頁。
   ============================================================ */
let VM_TAB='pending';           // pending | all | noreport | forms
let VM_CAT='all';               // 客訴分類篩選：all | 回報問題 | 驗收無誤 | 其他
let VM_FORM_CLIENT='all';       // 驗收單留底的客戶篩選：all | 客戶名 | (未歸戶)
let VM_DATA=null;
let VM_PROC_ID=null;
const VM_NOREPORT_DAYS=7;

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
  // 寄售鋪貨產的驗收單（單號 CS- 開頭）沒有報價單可查，客戶名直接存在留底的 client 欄（8/3 加）
  if(VM_DATA){ const f=(VM_DATA.forms||[]).find(x=>String(x.no||'').trim()===String(no).trim()&&x.client); if(f) return f.client; }
  /* 2026-09-03：buildOrders 對「沒填客戶的單」一律塞字面上的 '—'（顯示用佔位符）。
     這裡若原樣回傳，手動登記客訴時會被自動帶進客戶欄再存進資料庫，資料庫就多出一個叫「—」的客戶。 */
  if(ORDERS_CACHE){ const o=ORDERS_CACHE.find(x=>x.no===no); if(o){ const c=(o.client||'').split('｜')[0].trim(); if(c && c!=='—') return c; } }
  return '';
}
function vmToday(){ const t=new Date(),p=n=>String(n).padStart(2,'0'); return t.getFullYear()+'-'+p(t.getMonth()+1)+'-'+p(t.getDate()); }

/* 驗收管理
   舊做法是「先等訂單追蹤載完（2.5秒）、再去要驗收資料（又 2.5秒）」＝ 5 秒。
   改成兩邊同時要，並且都走讀取快取；訂單那份晚到就補畫一次客戶名稱。 */
function vmBuild(gv, lf){
  return {
    reports:(gv&&gv.records)||[], repSum:(gv&&gv.summary)||{},
    forms:(lf&&lf.records)||[], formSum:(lf&&lf.summary)||{},
    gvErr:(gv&&gv.ok===false)?gv.error:null, lfErr:(lf&&lf.ok===false)?lf.error:null
  };
}
async function loadVerifyMgmt(force){
  const body=document.getElementById('vm-body');
  const P1={action:'getVerifications', token:AUTH_TOKEN, filters:{}};
  const P2={action:'listVerifyForms', token:AUTH_TOKEN, filters:{}};
  const h1=rcPeek(P1), h2=rcPeek(P2);
  if(!force && h1 && h2){ VM_DATA=vmBuild(h1.data, h2.data); fillVmNoList(); renderVerifyMgmt(); }
  else if(body) body.innerHTML=sklBlock(4);
  // 訂單資料同時要（不 await，不擋自己的資料）
  const pOrders = loadOrders(force).then(()=>{ if(VM_DATA) renderVerifyMgmt(); }).catch(()=>{});
  if(!force && rcFresh(P1) && rcFresh(P2)) return pOrders;   // 90 秒內剛抓過就不重打
  try{
    const [gv, lf] = await Promise.all([
      readCall(P1, force).catch(e=>({ok:false,error:e.message})),
      readCall(P2, force).catch(e=>({ok:false,error:e.message}))
    ]);
    VM_DATA=vmBuild(gv, lf);
    fillVmNoList();
    renderVerifyMgmt();
  }catch(e){ if(body && !VM_DATA) body.innerHTML=`<div class="rec-empty">${escHtml(e.message||'載入失敗')}</div>`; }
}
onCacheClear(function(){ VM_DATA=null; });
function setVmTab(t){ VM_TAB=t; renderVerifyMgmt(); }
function vmNoReportList(){
  if(!VM_DATA) return [];
  /* 複檢 2026-08-13 #3-7：出貨日原本用留底的「建立時間」(last_at)，不是驗收單上印的配送日期。
     8/1 出貨、8/20 才補開驗收單 → 系統以為 8/20 才出貨，接下來 7 天不催；
     進留底按「編輯／重印」也會讓建立時間重來一次，已逾期的單直接從催單名單消失。
     改成優先用驗收單上的「配送日期」(ship_date)、同一張單取最新的那一張，讀不到才退回建立時間。 */
  const shipped={};
  (VM_DATA.forms||[]).forEach(f=>{
    if(!f.no || !f.ship_date) return;
    const nd=vmLocalYmd(f.ship_date)||'';
    const cur=shipped[f.no]?(vmLocalYmd(shipped[f.no])||''):'';
    if(!cur || nd>cur) shipped[f.no]=f.ship_date;
  });
  Object.keys(VM_DATA.formSum||{}).forEach(no=>{ const s=VM_DATA.formSum[no]||{}; if(!shipped[no]) shipped[no]=s.last_at||s.last||s.last_date||''; });
  (VM_DATA.forms||[]).forEach(f=>{ if(f.no && !shipped[f.no]) shipped[f.no]=f.created_at||''; });
  const reported={};
  (VM_DATA.reports||[]).forEach(r=>{ if(r.no) reported[r.no]=true; });
  Object.keys(VM_DATA.repSum||{}).forEach(no=>{ reported[no]=true; });
  const lotOf={};   // 每張單最新一張驗收單的 Lot（今日待辦 fallback 顯示用，與 digest 版對齊）
  (VM_DATA.forms||[]).forEach(f=>{ if(f.no && f.lot && lotOf[f.no]==null) lotOf[f.no]=f.lot; });
  const list=[];
  Object.keys(shipped).forEach(no=>{
    if(reported[no]) return;
    const d=vmDaysSince(shipped[no]);
    if(d==null||d>=VM_NOREPORT_DAYS) list.push({no, shipDate:vmLocalYmd(shipped[no]), days:d, client:vmClientOf(no), lot:lotOf[no]||''});
  });
  list.sort((a,b)=>(b.days||0)-(a.days||0));
  return list;
}
function vmCounts(){
  const reps=VM_DATA?VM_DATA.reports:[];
  return { pending:reps.filter(vmIsUnhandled).length, all:reps.length, noreport:vmNoReportList().length,
    forms:(VM_DATA?VM_DATA.forms:[]).length, taster:vmTasterList().length };
}
/* 2026-08-12 新增：試飲瓶記錄——彙整所有驗收單留底裡標 taster 的品項列（日期／客戶／酒款／支數）。
   純讀既有的「驗收單紀錄」資料（listVerifyForms 早就回 items），不用動後端、也不新增寫入路徑。 */
function vmTasterList(){
  if(!VM_DATA) return [];
  const out=[];
  (VM_DATA.forms||[]).forEach(f=>{
    const items=Array.isArray(f.items)?f.items:parseJsonSafe(f.items_json,[]);
    (Array.isArray(items)?items:[]).forEach(it=>{
      if(!it||!(Number(it.taster)||0)) return;
      const qty=(it.thisShip!=null&&it.thisShip!=='')?it.thisShip:(it.ordered!=null?it.ordered:0);
      out.push({ no:f.no||'', client:f._client||vmClientOf(String(f.no||'').trim())||f.client||'', date:vmLocalYmd(f.ship_date)||vmLocalYmd(f.created_at)||'',
        name:it.name||'', vol:it.vol||'500ml', qty:parseFloat(qty)||0, formId:f.id });
    });
  });
  out.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
  return out;
}
function renderVerifyMgmt(){
  const wrap=document.getElementById('vm-body'); if(!wrap) return;
  if(!VM_DATA){ wrap.innerHTML=sklBlock(4); return; }
  const c=vmCounts();
  const fs=[['pending','待處理回報',c.pending],['all','全部回報',c.all],['noreport','未回報催單',c.noreport],['forms','已開過的驗收單',c.forms],['taster','🍷 試飲瓶記錄',c.taster]];
  document.getElementById('vm-filters').innerHTML=fs.map(([k,l,n])=>
    `<button class="fchip${VM_TAB===k?' on':''}" onclick="setVmTab('${k}')">${l} <b>${n}</b></button>`).join('');
  let warn='';
  if(VM_DATA.gvErr||VM_DATA.lfErr) warn=`<div class="ob warn" style="display:block;margin:0 0 10px;padding:8px 12px;font-size:11.5px">部分資料讀取失敗（後端可能尚未更新此功能）：${escHtml(VM_DATA.gvErr||VM_DATA.lfErr||'')}</div>`;
  if(VM_TAB==='forms') wrap.innerHTML=warn+vmRenderForms();
  else if(VM_TAB==='noreport') wrap.innerHTML=warn+vmRenderNoReport();
  else if(VM_TAB==='taster') wrap.innerHTML=warn+vmRenderTaster();
  else wrap.innerHTML=warn+vmRenderReports(VM_TAB==='pending');
}
function vmStatusPill(r){
  if(!vmIsIssue(r)) return '<span class="vpill ok">驗收無誤</span>';
  const s=vmStatusNorm(r.status), map={'待處理':'wait','退費':'refund','補發':'resend','結案':'done'};
  return `<span class="vpill ${map[s]||'wait'}">${escHtml(s)}</span>`;
}
/* 2026-09-03：客戶回報／催單清單上「看得到單號卻打不開那張驗收單」。這一顆共用。
   ⚠ 寄售鋪貨產的 CS- 開頭單號沒有對應的報價單，openVerifyForm 會回「查無此單」，所以不給鈕。 */
function vmViewBtn(no){
  const n=String(no||'').trim();
  if(!n || n.indexOf('CS-')===0) return '';
  return `<button class="rec-act-btn" title="打開這張單的出貨驗收單" data-no="${escAttr(n)}" onclick="openVerifyForm(this.dataset.no)">驗收單</button>`;
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
      <td data-l="時間" style="white-space:nowrap;color:#6B6B63;font-size:11.5px">${escHtml(dt)||'—'}</td>
      <td class="mc-main"><b>${escHtml(r.no||'—')}</b><br><span style="color:#6B6B63;font-size:11.5px">${escHtml(r.client||vmClientOf(r.no)||'')}</span></td>
      <td data-l="內容"><span class="vtype ${catCls}">${catTxt}</span>${rawTxt}${r.item?`<br><span style="font-size:11.5px;color:#6B6B63">${escHtml(r.item)}</span>`:''}${r.desc?`<br><span style="font-size:12px">${escHtml(r.desc)}</span>`:''}${photos?`<br>${photos}`:''}</td>
      <td data-l="處理" style="text-align:center">${vmStatusPill(r)}${r.handle_note?`<br><span style="font-size:11px;color:#6B6B63">${escHtml(r.handle_note)}</span>`:''}${(r.amount!=null&&r.amount!=='')?`<br><span style="font-size:11px;color:var(--gold-deep)">${money(r.amount)}</span>`:''}</td>
      <td class="rec-actions" data-l="操作">${issue?`<button class="rec-act-btn" onclick="openVmProc('${escAttr(r.id)}')">處理</button>`:''}${vmViewBtn(r.no)}<button class="rec-act-btn del" onclick="vmDelReport('${escAttr(r.id)}','${escAttr(r.no||'')}')">刪除</button></td>
    </tr>`;
  }).join('');
  return bar+`<div class="tbl-scroll"><table class="rec-table mcard">
    <thead><tr><th>時間</th><th>單號／客戶</th><th>回報內容</th><th style="text-align:center">處理</th><th>操作</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}
function vmRenderNoReport(){
  const list=vmNoReportList();
  if(!list.length) return `<div class="rec-empty">沒有逾 ${VM_NOREPORT_DAYS} 天未回報的單 🎉（已出貨的都回報了，或尚無驗收單留底可對照）</div>`;
  const rows=list.map(o=>{
    const dtxt=o.days==null?'—':(o.days+' 天');
    return `<tr>
      <td class="mc-main"><b>${escHtml(o.no)}</b><br><span style="color:#6B6B63;font-size:11.5px">${escHtml(o.client||'')}</span></td>
      <td data-l="出貨日" style="text-align:center">${escHtml((o.shipDate||'').slice(0,10))||'—'}</td>
      <td data-l="狀態" style="text-align:center"><span class="ob ${(o.days!=null&&o.days>=VM_NOREPORT_DAYS)?'red':'warn'}">出貨 ${dtxt} 未回報</span></td>
      <td class="rec-actions" data-l="操作"><button class="rec-act-btn" onclick="vmCopyReminder('${escAttr(o.no)}','${escAttr((o.shipDate||'').slice(0,10))}')">複製催單訊息</button>${vmViewBtn(o.no)}</td>
    </tr>`;
  }).join('');
  return `<div style="font-size:11.5px;color:#A8A69C;margin-bottom:8px">已出貨（有開驗收單）滿 ${VM_NOREPORT_DAYS} 天、客戶仍未掃碼回報的單。按「複製催單訊息」貼到 LINE 即可。</div>
    <div class="tbl-scroll"><table class="rec-table mcard">
    <thead><tr><th>單號／客戶</th><th style="text-align:center">出貨日</th><th style="text-align:center">狀態</th><th>操作</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}
function setVmFormClient(v){ VM_FORM_CLIENT=v; renderVerifyMgmt(); }
function vmRenderForms(){
  const forms=(VM_DATA.forms||[]).slice();
  forms.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
  if(!forms.length) return `<div class="rec-empty">尚無驗收單留底（之後每次產生驗收單會自動存一筆）</div>`;
  // 客戶名＝用單號歸戶（vmClientOf：回報紀錄→訂單快取）；歸不出來的歸在「(未歸戶)」
  forms.forEach(f=>{ f._client=vmClientOf(String(f.no||'').trim())||''; });
  const cnt={};
  forms.forEach(f=>{ const k=f._client||'(未歸戶)'; cnt[k]=(cnt[k]||0)+1; });
  const cnames=Object.keys(cnt).sort((a,b)=>a.localeCompare(b,'zh-Hant'));
  if(VM_FORM_CLIENT!=='all' && !cnt[VM_FORM_CLIENT]) VM_FORM_CLIENT='all';
  const sel=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:12px;flex-wrap:wrap">
    <span style="color:#6B6B63">客戶</span>
    <select class="fi" id="vm-form-client" style="width:auto;min-width:170px" onchange="setVmFormClient(this.value)">
      <option value="all">全部客戶（${forms.length} 筆）</option>
      ${cnames.map(n=>`<option value="${escAttr(n)}"${VM_FORM_CLIENT===n?' selected':''}>${escHtml(n)}（${cnt[n]} 筆）</option>`).join('')}
    </select></div>`;
  const list=(VM_FORM_CLIENT==='all')?forms:forms.filter(f=>(f._client||'(未歸戶)')===VM_FORM_CLIENT);
  if(!list.length) return sel+`<div class="rec-empty">「${escHtml(VM_FORM_CLIENT)}」目前沒有留底紀錄</div>`;
  const rows=list.map(f=>{
    // items 欄位後端可能回陣列（items）或 JSON 字串（items_json），兩種都容錯讀
    const items=Array.isArray(f.items)?f.items:parseJsonSafe(f.items_json,[]);
    const names=(Array.isArray(items)?items:[]).map(it=>it.name).filter(Boolean).slice(0,3).join('、')+((Array.isArray(items)&&items.length>3)?'…':'');
    const dt=String(f.created_at||'').replace('T',' ').slice(0,16);
    return `<tr>
      <td data-l="產生時間" style="white-space:nowrap;color:#6B6B63;font-size:11.5px">${escHtml(dt)||'—'}</td>
      <td class="mc-main"><b>${escHtml(f.no||'—')}</b>${f.lot?` <span style="color:#6B6B63">Lot ${escHtml(f.lot)}</span>`:''}${f._client?`<br><span style="color:#6B6B63;font-size:11.5px">${escHtml(f._client)}</span>`:''}</td>
      <td data-l="配送日" style="text-align:center">${escHtml(vmLocalYmd(f.ship_date))||'—'}</td>
      <td data-l="PM" style="text-align:center">${escHtml(f.pm||'')||'—'}</td>
      <td data-l="箱數" style="text-align:center">${(f.boxes!=null&&f.boxes!=='')?escHtml(f.boxes)+' 箱':'—'}</td>
      <td data-l="品項" style="font-size:11.5px;color:#6B6B63">${escHtml(names)||'—'}</td>
      <td class="rec-actions" data-l="操作"><button class="rec-act-btn" onclick="vmEditForm('${escAttr(f.id)}')">編輯／重印</button><button class="rec-act-btn del" onclick="vmDelForm('${escAttr(f.id)}','${escAttr(f.no||'')}')">刪除</button></td>
    </tr>`;
  }).join('');
  return sel+`<div class="tbl-scroll"><table class="rec-table mcard">
    <thead><tr><th>產生時間</th><th>單號／客戶</th><th style="text-align:center">配送日</th><th style="text-align:center">PM</th><th style="text-align:center">箱數</th><th>品項</th><th>操作</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}
/* ---- 試飲瓶記錄（2026-08-12 加）：彙整所有客戶「送過幾次試飲瓶、什麼時候送的」----
   資料來源＝驗收單留底（listVerifyForms 的 items，taster=1 的列），跟寄售登記異動存的
   「附試飲瓶」勾選是同一份資料，只是這裡換一個角度彙整成可查詢的清單，不是新的紀錄來源。 */
function vmRenderTaster(){
  const list=vmTasterList();
  if(!list.length) return `<div class="rec-empty">尚無試飲瓶紀錄（登記寄售鋪貨時勾選「附 500ml 試飲瓶」，或單獨登記試飲瓶並產生驗收單後會出現在這裡）</div>`;
  const byClient={};
  list.forEach(r=>{ const k=r.client||'(未歸戶)'; byClient[k]=(byClient[k]||0)+(r.qty||0); });
  const summary=Object.keys(byClient).sort((a,b)=>byClient[b]-byClient[a])
    .map(k=>`<span class="rec-badge bottle" style="margin:0 6px 6px 0">${escHtml(k)} ${byClient[k]} 支</span>`).join('');
  const rows=list.map(r=>`<tr>
    <td data-l="日期" style="white-space:nowrap;color:#6B6B63;font-size:11.5px">${escHtml(r.date)||'—'}</td>
    <td class="mc-main">${escHtml(r.client)||'（未歸戶）'}<br><span style="color:#6B6B63;font-size:11.5px">${escHtml(r.no)}</span></td>
    <td data-l="酒款">${escHtml(r.name)}${r.vol?`（${escHtml(r.vol)}）`:''}</td>
    <td data-l="支數" style="text-align:right;font-weight:600">${(r.qty||0).toLocaleString()}</td>
    <td class="rec-actions" data-l="操作">${r.formId?`<button class="rec-act-btn" onclick="vmEditForm('${escAttr(r.formId)}')">查看驗收單</button>`:''}</td>
  </tr>`).join('');
  return `<div style="margin-bottom:10px">${summary}</div>
    <div class="tbl-scroll"><table class="rec-table mcard">
    <thead><tr><th>日期</th><th>客戶／單號</th><th>酒款</th><th style="text-align:right">支數</th><th>操作</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}
/* ---- 刪除（後端 v32：deleteVerification／deleteVerifyForm／deleteShipment，皆 {id}→整列刪除、不可復原）---- */
async function vmDelReport(id, no){
  if(typeof needOwner==='function' && !needOwner('刪除回報紀錄')) return;   // 2026-09-01：第二道防線
  if(!id){ toast('這筆沒有編號，無法刪除','err'); return; }
  if(!confirm(`確定刪除這筆回報紀錄${no?`（單號 ${no}）`:''}？\n刪除後無法復原。`)) return;
  if(_busy.vmDel) return; _busy.vmDel=true;
  const snap=VM_DATA;   // apiCall（寫入類）會把 VM_DATA 清空，失敗時要放回去，否則整頁卡在空狀態
  try{
    const d=await apiCall({ action:'deleteVerification', token:AUTH_TOKEN, id });
    if(!d.ok){ if(!VM_DATA) VM_DATA=snap; toast(d.error||'刪除失敗','err'); vmBuild&&loadVerifyMgmt(); return; }
    toast('已刪除這筆回報','ok'); await loadVerifyMgmt(true);
  }catch(e){ if(!VM_DATA) VM_DATA=snap; toast(e.message||'刪除失敗','err'); }
  finally{ _busy.vmDel=false; }
}
async function vmDelForm(id, no){
  if(typeof needOwner==='function' && !needOwner('刪除驗收單留底')) return;   // 2026-09-01：第二道防線
  if(!id){ toast('這筆沒有編號，無法刪除','err'); return; }
  if(!confirm(`確定刪除這筆驗收單留底${no?`（單號 ${no}）`:''}？\n只會刪掉這筆產生紀錄，已印出的驗收單 PDF 不受影響。刪除後無法復原。`)) return;
  if(_busy.vmDelForm) return; _busy.vmDelForm=true;
  const snap=VM_DATA;
  try{
    const d=await apiCall({ action:'deleteVerifyForm', token:AUTH_TOKEN, id });
    if(!d.ok){ if(!VM_DATA) VM_DATA=snap; toast(d.error||'刪除失敗','err'); return; }
    toast('已刪除這筆驗收單留底','ok'); await loadVerifyMgmt(true);
  }catch(e){ if(!VM_DATA) VM_DATA=snap; toast(e.message||'刪除失敗','err'); }
  finally{ _busy.vmDelForm=false; }
}
/* 編輯／重印驗收單留底：把那筆紀錄帶回「產生驗收單」視窗（buildVerifyModal 在 09_verify_form.js）。
   看完不動＝純檢視；要重印就按「產生」；改過再按「產生」＝存新留底並刪舊的（取代，見 saveVerifyFormRecord）。 */
function vmEditForm(id){
  const f=((VM_DATA&&VM_DATA.forms)||[]).find(x=>String(x.id)===String(id));
  if(!f){ toast('查無此留底紀錄，請先按重新整理','err'); return; }
  const items=Array.isArray(f.items)?f.items:parseJsonSafe(f.items_json,[]);
  if(!Array.isArray(items)||!items.length){ toast('這筆留底沒有品項明細，無法編輯','err'); return; }
  const noStr=String(f.no||'').trim();
  // 寄售鋪貨那批（單號開頭 CS-）沒有對應的報價單，走簡化版驗收單編輯（09_verify_form.js 的 openConsignVerifyForm）
  if(noStr.indexOf('CS-')===0){
    openConsignVerifyForm({
      no:noStr, client:f.client||vmClientOf(noStr)||'',
      shipDate:vmLocalYmd(f.ship_date)||'', handler:f.pm||'', note:'',
      // taster＝試飲瓶標示（2026-08-06 加）：從留底編輯時要一起帶回，否則重新產生會掉標示
      rows:items.map(it=>({ name:it.name||'', vol:it.vol||'', qty:(it.thisShip!=null&&it.thisShip!=='')?it.thisShip:(it.ordered||0), taster:!!(it.taster&&String(it.taster)!=='0') }))
    }, id);
    toast('已帶回這筆驗收單；只看不改直接關閉即可，修改後按「產生驗收單」會以新版取代舊紀錄','ok');
    return;
  }
  // 「第幾次出貨」推估＝同單號、比這筆更早的留底數＋1（欄位仍可手改）
  const earlier=((VM_DATA&&VM_DATA.forms)||[]).filter(x=>String(x.no||'').trim()===noStr && String(x.created_at||'')<String(f.created_at||'')).length;
  /* 2026-09-01 複檢 #8：原本重建時漏了 storage 旗標 → 重印／改數量時整個寄倉區塊不會出現，
     寄倉庫存永遠停在第一次的數字。改成從那張報價單的 docopts 重新判斷一次。 */
  let _stOn=false;
  try{
    const _q=(ORDERS_CACHE||[]).find(x=>String(x.no)===noStr);
    const _items=(_q&&_q.items)||[];
    const _do=_items.find(it=>it&&it.itemType==='docopts');
    if(_do&&_do.flavorList){ const _o=JSON.parse(_do.flavorList); _stOn=!!(_o.storage&&_o.storage!=='0'&&_o.storage!=='N'); }
  }catch(_){}
  VERIFY_DATA={ no:noStr, client:vmClientOf(noStr)||'', priorCount:earlier, storage:_stOn,
    rows:items.map(it=>({ name:it.name||'', lot:it.lot||'', vol:it.vol||'',
      mfg:vmLocalYmd(it.mfg)||'', ordered:parseFloat(it.ordered)||0,
      thisShip:(it.thisShip!=null&&it.thisShip!=='')?it.thisShip:0,
      shipped:(it.shipped!=null&&it.shipped!=='')?it.shipped:0 })) };
  VF_EDIT_ID=String(f.id);
  buildVerifyModal(f.lot||'');
  const set=(eid,v)=>{ const e=document.getElementById(eid); if(e&&v!=null&&v!=='') e.value=v; };
  set('vf-shipdate', vmLocalYmd(f.ship_date));
  set('vf-shipper', f.pm||'');
  set('vf-boxes', (f.boxes!=null&&f.boxes!=='')?f.boxes:'');
  document.getElementById('vf-overlay').style.display='flex';
  toast('已帶回這筆驗收單；只看不改直接關閉即可，修改後按「產生」會以新版取代舊紀錄','ok');
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
  /* 2026-09-01 複檢：VM_DATA 會被任何一次寫入（rcClear）清成 null，這裡原本沒防護 →
     直接 TypeError，按「處理」完全沒反應而且畫面上沒有任何訊息。 */
  const r=((VM_DATA&&VM_DATA.reports)||[]).find(x=>String(x.id)===String(id));
  if(!r){ toast(VM_DATA?'查無此回報':'資料剛被更新，正在重新載入…請再按一次','err'); if(!VM_DATA) loadVerifyMgmt(true); return; }
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
  if(_busy.vmProc) return; _busy.vmProc=true; btnBusy('vmp-save',true);
  const fields={ status:document.getElementById('vmp-status').value, handle_note:document.getElementById('vmp-handle_note').value,
    amount:document.getElementById('vmp-amount').value, closed_date:document.getElementById('vmp-closed_date').value };
  if(fields.status==='結案'&&!fields.closed_date) fields.closed_date=vmToday();
  const snap=VM_DATA;
  try{
    const d=await apiCall({action:'updateVerificationStatus', token:AUTH_TOKEN, id:VM_PROC_ID, fields});
    if(!d.ok){ if(!VM_DATA) VM_DATA=snap; toast(d.error||'儲存失敗','err'); return; }
    toast('已更新處理狀態','ok'); closeVmProc(); await loadVerifyMgmt(true);
  }catch(e){ if(!VM_DATA) VM_DATA=snap; toast(e.message||'儲存失敗','err'); }
  finally{ _busy.vmProc=false; btnBusy('vmp-save',false); }
}
/* 手動登記客訴 */
function fillVmNoList(){
  const dl=document.getElementById('vmm-nolist'); if(!dl||!ORDERS_CACHE) return;
  dl.innerHTML=ORDERS_CACHE.slice(0,300).map(o=>`<option value="${escAttr(o.no)}">${escAttr((o.client||'').split('｜')[0])}</option>`).join('');
}
/* 2026-09-01 複檢 #24：選了單號就把客戶帶出來（下拉選項上本來就印著客戶名，
   卻還要她再打一次；客戶名打得跟報價單不一樣，客戶管理那邊的歸戶就會漏掉這筆）。 */
function vmManualNoChanged(){
  const noEl=document.getElementById('vmm-no'), cliEl=document.getElementById('vmm-client');
  if(!noEl||!cliEl) return;
  const no=String(noEl.value||'').trim(); if(!no) return;
  if(cliEl.value.trim() && cliEl.dataset.auto!=='1') return;   // 她自己打過的不覆蓋
  const cli=(typeof vmClientOf==='function')?(vmClientOf(no)||''):'';
  if(cli){ cliEl.value=cli; cliEl.dataset.auto='1'; }
}
function openVmManual(){
  ['vmm-no','vmm-client','vmm-item','vmm-desc','vmm-reporter'].forEach(id=>{ const e=document.getElementById(id); if(e){ e.value=''; delete e.dataset.auto; } });
  document.getElementById('vmm-type').value='回報問題';
  fillVmNoList();
  document.getElementById('vmm-overlay').style.display='flex';
}
function closeVmManual(){ document.getElementById('vmm-overlay').style.display='none'; }
async function saveVmManual(){
  if(_busy.vmManual) return;
  const no=document.getElementById('vmm-no').value.trim();
  const desc=document.getElementById('vmm-desc').value.trim();
  /* 2026-09-03：原本是「單號和問題說明都空才擋」，於是只打一行描述就能存出一筆沒單號、沒客戶的客訴，
     之後歸不了戶、對不回是哪一張單。改成：問題說明一定要填，單號與客戶至少要有一個。 */
  const _cli=(document.getElementById('vmm-client').value||'').trim();
  if(!desc){ toast('請填問題說明','err'); try{ document.getElementById('vmm-desc').focus(); }catch(e){} return; }
  if(!no && (!_cli || _cli==='—')){ toast('請填單號，或至少填客戶名稱（不然之後對不回是誰的單）','err'); try{ document.getElementById('vmm-no').focus(); }catch(e){} return; }
  _busy.vmManual=true; btnBusy('vmm-save',true,'登記中…');
  // 後端 addVerification 吃「扁平頂層欄位」，不是包在 record:{...} 裡面（已實測對齊）
  const payload={ action:'addVerification', token:AUTH_TOKEN, no,
    client:document.getElementById('vmm-client').value.trim(), type:document.getElementById('vmm-type').value,
    item:document.getElementById('vmm-item').value.trim(), desc, reporter:document.getElementById('vmm-reporter').value.trim(), status:'待處理' };
  try{
    const d=await apiCall(payload);
    if(!d.ok){ toast(d.error||'登記失敗（後端可能尚未支援手動登記）','err'); return; }
    toast('已登記','ok'); closeVmManual(); await loadVerifyMgmt(true);
  }catch(e){ toast(e.message||'登記失敗','err'); }
  finally{ _busy.vmManual=false; btnBusy('vmm-save',false); }
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
  if(_busy.customSave) return; _busy.customSave=true; btnBusy('c-save-backend',true);
  calcCustom();
  const q=collectCustomQuote();
  // 2026-09-03：客戶名稱必填（跟標準報價單同一條規則，避免報價紀錄／訂單追蹤出現空白客戶）
  if(!q.client){
    toast('請先填寫客戶名稱再儲存','err');
    const _c=document.getElementById('c-cli'); if(_c){ try{ _c.focus(); _c.scrollIntoView({block:'center'}); }catch(e){} }
    _busy.customSave=false; btnBusy('c-save-backend',false); return;
  }
  if(!(parseJsonSafe(q.items_json,[]).length)){ toast('請先填寫內容再儲存','err'); _busy.customSave=false; btnBusy('c-save-backend',false); return; }
  try{
    const d=await apiCall({ action:'saveCustomQuote', token:AUTH_TOKEN, quote:q });
    if(!d.ok){ toast(d.error||'儲存失敗','err'); return; }
    const saved=d.quote||q;
    if(saved.quote_no) document.getElementById('c-no').value=saved.quote_no;
    toast('已儲存到後台：'+(saved.quote_no||''),'ok');
    loadMyCustomQuotes();
  }catch(e){ toast(e.message||'儲存失敗','err'); }
  finally{ _busy.customSave=false; btnBusy('c-save-backend',false); }
}
async function loadMyCustomQuotes(){
  const box=document.getElementById('cq-list'); if(!box) return;
  box.innerHTML=sklBlock(3);
  try{
    const d=await readCall({ action:'listCustomQuotes', token:AUTH_TOKEN });
    if(!d.ok){ box.innerHTML=`<div class="rec-empty">${d.error||'載入失敗'}</div>`; return; }
    const qs=(d.quotes||[]).slice().sort((a,b)=>(b.updated_at||'').localeCompare(a.updated_at||''));   // slice()：readCall 回的是快取本尊，不能就地排序污染快取
    window._CQ_CACHE=qs;
    if(!qs.length){ box.innerHTML='<div class="rec-empty">尚無已備份的自訂單</div>'; return; }
    box.innerHTML=`<div class="tbl-scroll"><table class="rec-table mcard"><thead><tr><th>單號 / 案名</th><th>客戶</th><th style="text-align:right">總計</th><th>更新</th><th>操作</th></tr></thead><tbody>`+
      qs.map(q=>{
        const tot=parseJsonSafe(q.totals_json,{}).total||0;
        return `<tr><td><b>${escHtml(q.quote_no||'—')}</b><br><span style="color:#6B6B63;font-size:11.5px">${escHtml(q.tag||'')}</span></td>
        <td>${escHtml(q.client||'—')}</td><td style="text-align:right;font-weight:600">${money(tot)}</td>
        <td>${(q.updated_at||'').slice(0,10)}</td>
        <td class="rec-actions"><button class="rec-act-btn" data-no="${escAttr(q.quote_no||'')}" onclick="recPreviewCustom(this.dataset.no,'custom')">預覽</button>
        <button class="rec-act-btn" onclick="loadCustomQuoteByNo(decodeURIComponent('${encodeURIComponent(q.quote_no||'')}'),false)">載入編輯</button>
        <button class="rec-act-btn" onclick="loadCustomQuoteByNo(decodeURIComponent('${encodeURIComponent(q.quote_no||'')}'),true)">複製成新單</button></td></tr>`;
      }).join('')+'</tbody></table></div>';
  }catch(e){ box.innerHTML=`<div class="rec-empty">${e.message||'載入失敗'}</div>`; }
}
async function loadCustomQuoteByNo(no, asCopy){
  let q=(window._CQ_CACHE||[]).find(x=>x.quote_no===no);
  if(!q){
    const d=await readCall({ action:'listCustomQuotes', token:AUTH_TOKEN });
    q=(d.quotes||[]).find(x=>x.quote_no===no);
  }
  if(!q){ toast('找不到 '+no,'err'); return; }
  // 自訂單頁若已有打到一半的內容（且不是同一張單），先問過再覆蓋，避免誤點清掉未儲存的單
  { const curNo=(document.getElementById('c-no')?.value||'').trim();
    const curCli=(document.getElementById('c-cli')?.value||'').trim();
    const hasRows=(typeof customItems!=='undefined') && customItems.some(id=>{ const r=document.getElementById('cr-'+id); return r&&Array.from(r.querySelectorAll('input,textarea')).some(i=>i.type!=='checkbox'&&(i.value||'').trim()!==''); });
    if((curCli||hasRows) && curNo!==String(no||'') && !confirm('自訂報價單頁還有未儲存的內容，載入「'+no+'」會把它清掉，確定要繼續？')) return; }
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
/* 報價紀錄頁列出的自訂單：開啟＝載入到自訂報價單頁；預覽＝載入後直接開預覽視窗 */
async function recOpenCustom(no){ await loadCustomQuoteByNo(no,false); }
async function recPreviewCustom(no, backPage){ await loadCustomQuoteByNo(no,false); openCustomPreview(); if(typeof pvSetBackPage==='function') pvSetBackPage(backPage||null); }

