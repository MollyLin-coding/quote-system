let qType='bottle', taxMode='inc', payTab=0;
let LOADED_PAY_DETAIL=null; // 載入舊單時記住已存的付款條件文字，未重新編輯付款前直接沿用，避免重算改掉客戶看到的條件
let FORM_DIRTY=false; // 標準報價單是否有「使用者實際輸入、尚未儲存」的內容（供離開頁面前提醒；程式帶入值不算）
let botItems=[],banFreeItems=[],banAddonItems=[],extras=[],imgs=[],rowId=0;
let customItems=[],previewKind='std';
let colDed=false, colLogo=false, colLot=false, colMark=false, colOwn=false, colGift=false;
let flavors={g1:[],g2:[]};


(()=>{
  document.getElementById('f-dt').value=todayStr();
  onDate(); upNo(); addBotRow(); rebuildBotHeader();
})();

/* 出貨資訊是否與聯絡/發票地址相同；prefix='f'（瓶裝/宴會）或 'c'（自訂） */
function toggleShipSame(prefix){
  const chk=document.getElementById(prefix+'-shipsame');
  const grp=document.getElementById(prefix+'-ship-group');
  if(!chk||!grp) return;
  grp.style.display=chk.checked?'none':'block';
  if(chk.checked){
    const clr=id=>{ const e=document.getElementById(id); if(e) e.value=''; };
    clr(prefix+'-shipcon'); clr(prefix+'-shipph'); clr(prefix+'-shipad');
  }
}

function onDate(){
  const v=document.getElementById('f-dt').value; if(!v) return;
  const d=new Date(v);
  const disp=`${d.getFullYear()}/${s2(d.getMonth()+1)}/${s2(d.getDate())}`;
  const e=new Date(d); e.setMonth(e.getMonth()+1);
  const estr=`${e.getFullYear()}/${s2(e.getMonth()+1)}/${s2(e.getDate())}`;
  document.getElementById('f-ex').value=estr;
  document.getElementById('pl-dt').textContent=disp;
  document.getElementById('pl-ex').textContent=estr;
  upNo(); estPayDay();
}

function upNo(){
  const v=document.getElementById('f-dt').value; if(!v) return;
  const d=new Date(v);
  const base=`${d.getFullYear()}${s2(d.getMonth()+1)}${s2(d.getDate())}`;
  let serN=parseInt(document.getElementById('f-ser').value,10); if(!serN||serN<1) serN=1; if(serN>99) serN=99;   // 流水號夾在 1~99，避免產生怪單號
  const ser=String(serN).padStart(2,'0');
  const no=`${base}-${ser}`;
  document.getElementById('f-no').value=no;
  document.getElementById('pl-no').textContent=no;
}

function setType(t){
  qType=t;
  const isConsign=(t==='consign');   // 寄售月結轉的報價單，沿用瓶裝品項表，不走選公司/選公版
  const isBot=(t==='bottle'||isConsign), isBan=(t==='banquet'), isOwn=(t==='ownbrand'), isOwnLabel=(t==='ownlabel');
  const isOwnCat=(isOwn||isOwnLabel);   // 自有品牌公版酒（一次性採購／公版酒客製標）共用公版帶入與瓶裝品項表
  const botLike=isBot||isOwnCat;   // 公版買斷／公版客製標／寄售月結 皆沿用瓶裝的品項表與額外費用
  document.getElementById('tc-bot').classList.toggle('on',t==='bottle');
  document.getElementById('tc-ban').classList.toggle('on',isBan);
  { const e=document.getElementById('tc-own'); if(e) e.classList.toggle('on',isOwnCat); }
  // 自有品牌公版酒 子模式選擇器（一次性採購／公版酒客製標／合作寄售）
  { const smd=document.getElementById('own-submodes'); if(smd) smd.style.display=isOwnCat?'flex':'none';
    const b1=document.getElementById('sm-buyout'); if(b1) b1.classList.toggle('on',isOwn);
    const b2=document.getElementById('sm-label'); if(b2) b2.classList.toggle('on',isOwnLabel); }
  document.getElementById('ban-meta').style.display=isBan?'block':'none';
  document.getElementById('bottle-items-card').style.display=botLike?'block':'none';
  document.getElementById('banquet-items-card').style.display=isBan?'block':'none';
  document.getElementById('banquet-svc-card').style.display=isBan?'block':'none';
  document.getElementById('banquet-addon-card').style.display=isBan?'block':'none';
  document.getElementById('ext-card').style.display=botLike?'block':'none';
  { const e=document.getElementById('company-card'); if(e) e.style.display=(isOwnCat||isConsign)?'none':'block'; }
  { const e=document.getElementById('ownbrand-card'); if(e) e.style.display=isOwnCat?'block':'none'; }
  { const note=document.getElementById('ob-modenote'); if(note) note.textContent = isOwnLabel
      ? '每列有原價・折數・計價三欄：帶公版原價，某款達 300 瓶↑自動填 6 折（折數可手改），計價＝原價×折自動算；PDF 標〔客製標〕、原廠批號不對客戶顯示、MOQ 300／款提示。'
      : '每列有原價・折數・計價三欄：帶公版原價，依每款瓶數自動填折數（6/5.5/5＝200/500/1000），折數可手改，計價＝原價×折自動算；原廠批號不對客戶顯示。'; }
  // OEM 標記欄：只有標準（瓶裝）＝OEM 逐列勾選；公版客製標＝整張單皆客製標（不用逐列勾）；寄售/宴會/一次性採購不顯示
  { const newMark=false; const newOwn=(t==='ownbrand'||t==='ownlabel');   // OEM 逐列勾選欄已移除（Molly 2026-07-24）
    const changed=(newMark!==colMark)||(newOwn!==colOwn); colMark=newMark; colOwn=newOwn;
    rebuildBotHeader(); if(changed && document.getElementById('itbody-bot').children.length) rebuildBotRows(); }
  if(isOwnCat) loadOwnbrandProducts().catch(()=>{});
  if(isBan && banFreeItems.length===0) addBanFreeRow();
  if(isBan && banAddonItems.length===0) addBanAddonRow();
  calc();
}
// 合作寄售子模式：導到寄售管理頁（寄售有自己的庫存/保證金/月結流程，不在報價頁另開）
function goConsign(){ gotoPage('consign'); }

// ── COLUMN TOGGLES (bottle) ──
let botDedCache={}, botLogoCache={}, botLotCache={};
function toggleCol(which){
  if(which==='ded') colDed=!colDed;
  if(which==='logo') colLogo=!colLogo;
  if(which==='lot') colLot=!colLot;
  if(which==='gift') colGift=!colGift;
  document.getElementById('ctg-ded').classList.toggle('on',colDed);
  document.getElementById('ctg-logo').classList.toggle('on',colLogo);
  document.getElementById('ctg-lot').classList.toggle('on',colLot);
  rebuildBotHeader();
  const oldData = botItems.map(id=>{
    const row=document.getElementById(`r-${id}`);
    if(!row) return null;
    const dedEl=row.querySelector('[data-f="ded"]');
    const logoEl=row.querySelector('[data-f="logo"]');
    const lotEl=row.querySelector('[data-f="lot"]');
    const lpEl=row.querySelector('[data-f="lp"]');
    const diEl=row.querySelector('[data-f="disc"]');
    const giftEl=row.querySelector('[data-f="gift"]');
    const markEl=row.querySelector('[data-f="mark"]');
    if(dedEl) botDedCache[id]=dedEl.value;
    if(logoEl) botLogoCache[id]=logoEl.value;
    if(lotEl) botLotCache[id]=lotEl.value;
    return {id,name:gs(row,'name'),lot:lotEl?lotEl.value:(botLotCache[id]||''),vol:gs(row,'vol'),price:gs(row,'price'),ded:botDedCache[id]||'',logo:botLogoCache[id]||'',qty:gs(row,'qty'),lp:lpEl?lpEl.value:'',disc:diEl?diEl.value:'',discManual:(diEl&&diEl.dataset.manual==='1')?1:0,gift:(giftEl&&giftEl.checked)?1:0,mark:(markEl&&markEl.checked)?1:0};
  }).filter(Boolean);
  document.getElementById('itbody-bot').innerHTML='';
  botItems=[];
  oldData.forEach(d=>addBotRow(d));
  if(oldData.length===0) addBotRow();
  calc();
}

function rebuildBotHeader(){
  let cols = ['2fr'];
  if(colLot) cols.push('1fr');
  cols.push('68px');                    // 容量
  if(colOwn) cols.push('76px','62px');  // 原價・折數（自有品牌）
  cols.push('80px');                    // 單價／計價
  if(colDed) cols.push('68px');
  if(colLogo) cols.push('68px');
  cols.push('60px','88px');
  if(colMark) cols.push('52px');
  if(colGift) cols.push('44px');
  cols.push('44px');
  document.getElementById('ith-bot').style.gridTemplateColumns = cols.join(' ');
  { const e=document.getElementById('th-gift'); if(e) e.style.display=colGift?'':'none'; }
  { const e=document.getElementById('ctg-gift'); if(e) e.classList.toggle('on',colGift); }
  { const e=document.getElementById('th-lot'); if(e){ e.style.display=colLot?'':'none'; e.textContent=colOwn?'原廠批次':'出貨批次'; } }
  { const e=document.getElementById('ctg-lot-lbl'); if(e) e.textContent=colOwn?'原廠批次':'出貨批次'; }
  { const e=document.getElementById('th-lp'); if(e) e.style.display=colOwn?'':'none'; }
  { const e=document.getElementById('th-disc'); if(e) e.style.display=colOwn?'':'none'; }
  { const e=document.getElementById('th-price'); if(e) e.textContent=colOwn?'計價':'單價'; }
  document.getElementById('th-ded').style.display = colDed?'':'none';
  document.getElementById('th-logo').style.display = colLogo?'':'none';
  const tm=document.getElementById('th-mark');
  if(tm){ tm.style.display = colMark?'':'none'; tm.textContent = 'OEM'; }
}
/* 保留現有品項列內容（含 OEM/貼牌 勾選、公版 sku/售價）重建整表——切換模式或增減欄位時用 */
function snapshotBotRows(){
  return botItems.map(id=>{
    const row=document.getElementById(`r-${id}`); if(!row) return null;
    const q=x=>row.querySelector(`[data-f="${x}"]`);
    return { name:gs(row,'name'),
      lot:(q('lot')?q('lot').value:(botLotCache[id]||''))||'',
      vol:gs(row,'vol'), price:gs(row,'price'),
      ded:(q('ded')?q('ded').value:(botDedCache[id]||''))||'',
      logo:(q('logo')?q('logo').value:(botLogoCache[id]||''))||'',
      qty:gs(row,'qty'),
      mark:(q('mark')&&q('mark').checked)?1:0,
      gift:(q('gift')&&q('gift').checked)?1:0,
      lp:(q('lp')?q('lp').value:'')||'', disc:(q('disc')?q('disc').value:'')||'',
      discManual:(q('disc')&&q('disc').dataset.manual==='1')?1:0,
      sku:row.dataset.sku||'', listprice:row.dataset.listprice||'',
      manual:(q('price')&&q('price').dataset.manual==='1')?1:0 };
  }).filter(Boolean);
}
function rebuildBotRows(){
  rebuildBotHeader();
  const data=snapshotBotRows();
  document.getElementById('itbody-bot').innerHTML=''; botItems=[];
  data.forEach(d=>addBotRow(d));
  calc();
}

function addBotRow(prefill){
  let id;
  if(prefill && prefill.id!=null){ id=prefill.id; if(id>rowId) rowId=id; }
  else { rowId++; id=rowId; }
  const div=document.createElement('div');
  div.id=`r-${id}`;
  let cols = ['2fr'];
  if(colLot) cols.push('1fr');
  cols.push('68px');
  if(colOwn) cols.push('76px','62px');
  cols.push('80px');
  if(colDed) cols.push('68px');
  if(colLogo) cols.push('68px');
  cols.push('60px','88px');
  if(colMark) cols.push('52px');
  if(colGift) cols.push('44px');
  cols.push('44px');
  div.className='itr'+((prefill&&prefill.gift)?' gift':'');
  div.style.gridTemplateColumns = cols.join(' ');
  let lotVal = (prefill && prefill.lot) ? prefill.lot : '';
  if(colLot && !lotVal && !prefill) lotVal = 'Lot '; // 全新空列預填「Lot 」，只需接著打數字；載入/貼上既有列不塞
  let lpVal = '';
  if(prefill){ lpVal = (prefill.lp!=null && prefill.lp!=='') ? prefill.lp : (prefill.listprice || prefill.price || ''); }
  let discVal = (prefill && prefill.disc!=null) ? prefill.disc : '';
  let h = `
    <textarea rows="1" placeholder="品名（Enter新增下一筆／Shift+Enter換行／可貼上多行自動拆成多筆）" oninput="calc()" onkeydown="handleNameKeydown(event,${id})" onpaste="handleNamePaste(event,${id})" data-f="name">${escHtml(prefill?.name||'')}</textarea>`;
  if(colLot) h += `<input placeholder="Lot31" oninput="calc()" data-f="lot" value="${lotVal}">`;
  h += `
    <input type="number" min="0" placeholder="500" list="vol-options" oninput="calc()" data-f="vol" value="${prefill?.vol||''}">`;
  if(colOwn){
    h += `
    <input type="number" min="0" placeholder="原價" oninput="onLpInput(${id})" data-f="lp" value="${lpVal}" style="text-align:right">
    <input type="number" min="0" step="0.1" max="10" placeholder="10=原價" oninput="onDiscInput(${id})" data-f="disc" value="${discVal}" style="text-align:center" title="輸入折數，例：6＝6折、5.5＝5.5折；留空＝原價">
    <input type="number" min="0" placeholder="計價" readonly tabindex="-1" data-f="price" value="${prefill?.price||''}" style="background:#F5F3EE;color:#22241F;font-weight:600">`;
  } else {
    h += `
    <input type="number" min="0" placeholder="375" oninput="calc()" data-f="price" value="${prefill?.price||''}">`;
  }
  if(colDed) h += `<input type="number" placeholder="-2" oninput="calc()" data-f="ded" value="${prefill?.ded||''}">`;
  if(colLogo) h += `<input type="number" min="0" placeholder="25" oninput="calc()" data-f="logo" value="${prefill?.logo||''}">`;
  h += `
    <input type="number" min="0" placeholder="40" oninput="calc()" data-f="qty" value="${prefill?.qty||''}">
    <div class="sub" id="rs-${id}">—</div>`;
  if(colMark) h += `<div style="display:flex;align-items:center;justify-content:center"><input type="checkbox" data-f="mark" title="標記為 OEM／貼牌" onchange="onMarkChange(${id})" style="width:16px;height:16px;cursor:pointer" ${prefill&&prefill.mark?'checked':''}></div>`;
  if(colGift) h += `<div style="display:flex;align-items:center;justify-content:center"><input type="checkbox" data-f="gift" title="此列不計價（顯示金額、贈送）" onchange="onGiftChange(${id})" style="width:16px;height:16px;cursor:pointer" ${prefill&&prefill.gift?'checked':''}></div>`;
  h += `
    <div class="rowact"><span class="ordcol"><button type="button" class="ordb" title="上移" onclick="moveBotRow(${id},-1)">▲</button><button type="button" class="ordb" title="下移" onclick="moveBotRow(${id},1)">▼</button></span><button class="del" onclick="delBotRow(${id})">✕</button></div>`;
  div.innerHTML = h;
  document.getElementById('itbody-bot').appendChild(div);
  botItems.push(id);
  // 自有品牌（買斷／客製標）：記 sku／建議原價；瓶數變動時自動填折數（折數欄未手改時）；計價＝原價×折
  if(colOwn){
    if(prefill && prefill.sku) div.dataset.sku=prefill.sku;
    if(prefill && prefill.listprice) div.dataset.listprice=prefill.listprice;
    const di=div.querySelector('[data-f="disc"]');
    if(di && prefill && prefill.discManual) di.dataset.manual='1';
    const qi=div.querySelector('[data-f="qty"]');
    if(qi){ qi.addEventListener('input',()=>autoDiscForRow(id)); }
    recalcOwnRow(id);
  } else if(prefill && (prefill.sku || prefill.listprice)){
    if(prefill.sku) div.dataset.sku=prefill.sku;
    if(prefill.listprice) div.dataset.listprice=prefill.listprice;
  }
}
/* OEM／貼牌 勾選變動：公版模式（貼牌）確保套級距折，並更新 MOQ 提示與總額 */
function onMarkChange(id){
  if(qType==='ownbrand'){
    const row=document.getElementById(`r-${id}`);
    if(row && row.dataset.listprice) applyOwnbrandTierForRow(id);
  }
  calc();
}
/* 贈品／不計價 勾選變動：切換該列底色並重算總額（不計價列排除於總計） */
function onGiftChange(id){
  const row=document.getElementById(`r-${id}`);
  if(row){ const g=row.querySelector('[data-f="gift"]'); row.classList.toggle('gift', !!(g&&g.checked)); }
  calc();
}
/* 貼牌 MOQ 300／款 未達提醒（僅提示、不擋單）——公版買斷模式、已勾貼牌的列 */
function updateObMoqWarn(){
  const el=document.getElementById('ob-moqwarn'); if(!el) return;
  if(qType!=='ownlabel'){ el.innerHTML=''; return; }   // 客製標整張單皆客製前標，MOQ 300／款提示（每一列）
  const warns=[];
  botItems.forEach(id=>{
    const row=document.getElementById(`r-${id}`); if(!row) return;
    const q=gv(row,'qty');
    if(q>0 && q<300){
      const nm=gs(row,'name')||'該品項';
      warns.push(`⚠ ${escHtml(nm)} 客製標未達 MOQ 300／款（目前 ${q} 瓶）— 提醒用，照樣可出單`);
    }
  });
  el.innerHTML=warns.map(w=>`<div class="moq-warn">${w}</div>`).join('');
}


function handleNameKeydown(ev,id){
  if(ev.key!=='Enter') return;
  if(ev.shiftKey) return;
  ev.preventDefault();
  const row=document.getElementById(`r-${id}`);
  const nameInput=row.querySelector('[data-f="name"]');
  const lines=nameInput.value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  nameInput.value=lines[0]||'';
  for(let i=1;i<lines.length;i++){ addBotRow({name:lines[i]}); }
  addBotRow();
  calc();
  const newId=botItems[botItems.length-1];
  const newRow=document.getElementById(`r-${newId}`);
  const newNameInput=newRow?.querySelector('[data-f="name"]');
  if(newNameInput) newNameInput.focus();
}

function handleNamePaste(ev,id){
  const text=(ev.clipboardData||window.clipboardData).getData('text');
  if(!text || !/\r?\n/.test(text)) return;
  ev.preventDefault();
  const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(!lines.length) return;
  const row=document.getElementById(`r-${id}`);
  const nameInput=row.querySelector('[data-f="name"]');
  nameInput.value=lines[0];
  for(let i=1;i<lines.length;i++){ addBotRow({name:lines[i]}); }
  calc();
}
function delBotRow(id){
  const el=document.getElementById(`r-${id}`); if(el) el.remove();
  delete botDedCache[id]; delete botLogoCache[id]; delete botLotCache[id];
  botItems=botItems.filter(i=>i!==id); calc();
}
/* ---- 品項明細調整順序（botItems 陣列是各處的資料順序來源，重排陣列＋DOM 即可）---- */
function reorderBotDom(){
  const body=document.getElementById('itbody-bot');
  botItems.forEach(id=>{ const r=document.getElementById(`r-${id}`); if(r) body.appendChild(r); });
}
function moveBotRow(id,dir){
  const i=botItems.indexOf(id); if(i<0) return;
  const j=i+dir; if(j<0||j>=botItems.length) return;
  const t=botItems[i]; botItems[i]=botItems[j]; botItems[j]=t;
  reorderBotDom(); calc();
}

// ── BANQUET 計價方式（杯／ML）與手動小計 ──
/* 兩組客製化調酒可切換「以杯計價」或「以 ML 計價」（大桶出貨、談整包價的宴會單用）；
   勾「手動小計」可直接填談好的整包價（例：40,000ml 共 $39,000），不用單價×數量。 */
function banUnitOf(g){ const e=document.getElementById(`ban-${g}-unit`); return (e&&e.value==='ml')?'ml':'cup'; }
function banManualOn(g){ const e=document.getElementById(`ban-${g}-man`); return !!(e&&e.checked); }
function onBanUnitChange(g){
  const ml=banUnitOf(g)==='ml';
  const lb=document.getElementById(`ban-${g}-qtylabel`); if(lb) lb.textContent=ml?'總ML數':'總杯數';
  const qi=document.getElementById(`ban-${g}-qty`); if(qi) qi.placeholder=ml?'40000':(g==='g1'?'90':'0');
  calcBan();
}
function toggleBanManual(g){
  const on=banManualOn(g);
  const mi=document.getElementById(`ban-${g}-subman`);
  if(mi){
    mi.style.display=on?'':'none';
    if(on && !mi.value){   // 勾起時先帶入目前的自動小計當起點，再讓人改成談好的整包價
      const p=parseFloat(document.getElementById(`ban-${g}-price`).value)||0;
      const q=parseFloat(document.getElementById(`ban-${g}-qty`).value)||0;
      if(p*q) mi.value=Math.round(p*q);
    }
  }
  calcBan();
}
/* 該組小計：手動小計優先，否則單價×數量（杯或 ML 都一樣） */
function banGroupSub(g){
  if(banManualOn(g)) return parseFloat(document.getElementById(`ban-${g}-subman`)?.value)||0;
  const p=parseFloat(document.getElementById(`ban-${g}-price`)?.value)||0;
  const q=parseFloat(document.getElementById(`ban-${g}-qty`)?.value)||0;
  return p*q;
}

// ── BANQUET FREE ITEMS ──
/* 自訂品項列（宴會）：比照自訂報價單的列，多了 備註小字／免費贈送／手動小計。
   版面沿用自訂單的 .crow 樣式；小計欄未勾手動時唯讀、自動＝單價×數量。 */
function addBanFreeRow(prefill){
  prefill=prefill||{};
  rowId++;
  const id=rowId;
  const manual=!!prefill.manual;
  const div=document.createElement('div');
  div.id=`bf-${id}`;
  div.className='crow'+(prefill.free?' free':'');
  div.innerHTML=`
    <div class="crow-top" style="grid-template-columns:3fr 60px 56px 86px 86px 26px;min-width:0">
      <input placeholder="自訂品項描述" oninput="calc()" data-f="name" value="${escAttr(prefill.name||'')}">
      <input type="number" placeholder="1" oninput="calc()" data-f="qty" value="${prefill.qty!=null?prefill.qty:''}">
      <input placeholder="式" oninput="calc()" data-f="unit" value="${escAttr(prefill.unit||'')}">
      <input type="number" placeholder="0" oninput="calc()" data-f="price" value="${prefill.price!=null?prefill.price:''}">
      <input type="number" placeholder="—" data-f="subval" value="${prefill.subval!=null?prefill.subval:''}" oninput="calc()" ${manual?'':'readonly'}>
      <button class="del" onclick="delBanFreeRow(${id})">✕</button>
    </div>
    <div class="crow-bottom">
      <div class="crow-note"><input placeholder="備註說明（選填，顯示於品名下方小字）" data-f="note" value="${escAttr(prefill.note||'')}" oninput="calc()"></div>
      <div class="crow-flags">
        <label title="談好的整包價直接填小計"><input type="checkbox" data-f="manual" ${manual?'checked':''} onchange="toggleBanFreeManual(${id})">手動小計</label>
        <label title="顯示金額但劃線標示免費，不計入總計"><input type="checkbox" data-f="free" ${prefill.free?'checked':''} onchange="calc()">免費</label>
      </div>
    </div>`;
  document.getElementById('ban-free-body').appendChild(div);
  banFreeItems.push(id);
}
function toggleBanFreeManual(id){
  const row=document.getElementById(`bf-${id}`); if(!row) return;
  const man=row.querySelector('[data-f="manual"]').checked;
  row.querySelector('[data-f="subval"]').readOnly=!man;
  calc();
}
/* 該列小計＋免費旗標（collectQuote／預覽／calc 共用） */
function banFreeRowInfo(row){
  const manual=!!(row.querySelector('[data-f="manual"]')&&row.querySelector('[data-f="manual"]').checked);
  const free=!!(row.querySelector('[data-f="free"]')&&row.querySelector('[data-f="free"]').checked);
  const subInput=row.querySelector('[data-f="subval"]');
  let sub;
  if(manual){ sub=(subInput&&subInput.value!=='')?(parseFloat(subInput.value)||0):0; }
  else {
    sub=gv(row,'price')*gv(row,'qty');
    if(subInput) subInput.value=sub?Math.round(sub):'';
  }
  return {manual, free, sub};
}
function delBanFreeRow(id){
  const el=document.getElementById(`bf-${id}`); if(el) el.remove();
  banFreeItems=banFreeItems.filter(i=>i!==id); calc();
}

// ── BANQUET ADDON ITEMS ──
function addBanAddonRow(prefill){
  rowId++;
  const id=rowId;
  const div=document.createElement('div');
  div.id=`ba-${id}`;
  div.className='itr';
  div.style.gridTemplateColumns='3fr 60px 56px 86px 86px 26px';
  div.innerHTML=`
    <input placeholder="${prefill?.ph||'加購項目名稱'}" oninput="calc()" data-f="name" value="${prefill?.name||''}">
    <input type="number" placeholder="1" oninput="calc()" data-f="qty" value="${prefill?.qty||''}">
    <input placeholder="式" oninput="calc()" data-f="unit" value="${prefill?.unit||''}">
    <input type="number" placeholder="0" oninput="calc()" data-f="price" value="${prefill?.price||''}">
    <div class="sub" id="bas-${id}">—</div>
    <button class="del" onclick="delBanAddonRow(${id})">✕</button>`;
  document.getElementById('ban-addon-body').appendChild(div);
  banAddonItems.push(id);
}
function delBanAddonRow(id){
  const el=document.getElementById(`ba-${id}`); if(el) el.remove();
  banAddonItems=banAddonItems.filter(i=>i!==id); calc();
}

// ── FLAVOR TAGS ──
function addFlavor(g){
  const inp=document.getElementById(`ban-${g}-input`);
  const lines=inp.value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(!lines.length) return;
  flavors[g].push(...lines);
  inp.value='';
  renderFlavors(g);
}
function handleFlavorKeydown(ev,g){
  if(ev.key!=='Enter') return;
  if(ev.shiftKey) return;
  ev.preventDefault();
  addFlavor(g);
}
function handleFlavorPaste(ev,g){
  const text=(ev.clipboardData||window.clipboardData).getData('text');
  if(!text || !/\r?\n/.test(text)) return;
  ev.preventDefault();
  const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(!lines.length) return;
  flavors[g].push(...lines);
  renderFlavors(g);
}
function removeFlavor(g,idx){
  flavors[g].splice(idx,1);
  renderFlavors(g);
}
function renderFlavors(g){
  document.getElementById(`ban-${g}-flavors`).innerHTML = flavors[g].map((f,i)=>
    `<div class="flavor-tag">${f}<button onclick="removeFlavor('${g}',${i})">✕</button></div>`
  ).join('') || `<span style="font-size:11px;color:var(--hint);font-style:italic">尚未新增品名（選填，可不填）</span>`;
}
renderFlavors('g1'); renderFlavors('g2');

// ── SERVICE FEE MODE ──
function onSvcModeChange(){
  const mode=document.getElementById('svc-mode').value;
  const wrap=document.getElementById('svc-detail-wrap');
  const f2wrap=document.getElementById('svc-field-2-wrap');
  const l1=document.getElementById('svc-label-1');
  const l2=document.getElementById('svc-label-2');
  if(!mode){ wrap.classList.remove('on'); calc(); return; }
  wrap.classList.add('on');
  if(mode==='basic'){ l1.textContent='調酒師服務費及運費（基礎運費）'; f2wrap.style.display='none'; }
  else if(mode==='equip'){ l1.textContent='調酒師費（含設備）'; f2wrap.style.display='none'; }
  else if(mode==='travel'){ l1.textContent='調酒師費'; l2.textContent='車馬費及酒水運費'; f2wrap.style.display='block'; }
  else if(mode==='travelonly'){ l1.textContent='車馬費'; f2wrap.style.display='none'; }
  calc();
}

function calcBan(){
  // group totals（手動小計優先；杯／ML 計價的乘法相同）
  document.getElementById('ban-g1-sub').textContent='$'+Math.round(banGroupSub('g1')).toLocaleString();
  document.getElementById('ban-g2-sub').textContent='$'+Math.round(banGroupSub('g2')).toLocaleString();

  // service fee
  const mode=document.getElementById('svc-mode').value;
  let svcSub=0;
  if(mode){
    const a1=parseFloat(document.getElementById('svc-amt1').value)||0;
    const a2=parseFloat(document.getElementById('svc-amt2').value)||0;
    const q=parseFloat(document.getElementById('svc-qty').value)||1;
    svcSub=(a1+(mode==='travel'?a2:0))*q;
  }
  document.getElementById('svc-sub').value = svcSub?Math.round(svcSub):'';
  calc();
}

function svcReverseCalc(){
  const mode=document.getElementById('svc-mode').value;
  if(!mode) return;
  const sub=parseFloat(document.getElementById('svc-sub').value)||0;
  const q=parseFloat(document.getElementById('svc-qty').value)||1;
  const a2=mode==='travel'?(parseFloat(document.getElementById('svc-amt2').value)||0):0;
  const a1 = q>0 ? (sub/q - a2) : 0;
  document.getElementById('svc-amt1').value = a1?Math.round(a1*100)/100:'';
  calc();
}

function gv(r,f){const i=r.querySelector(`[data-f="${f}"]`);return i?parseFloat(i.value)||0:0}
function gs(r,f){const i=r.querySelector(`[data-f="${f}"]`);return i?i.value.trim():''}

function calc(){
  const rate=(parseFloat(document.getElementById('taxrate').value)||0)/100;
  let rawSub=0;

  if(qType==='bottle'||qType==='ownbrand'||qType==='ownlabel'||qType==='consign'){
    botItems.forEach(id=>{
      const row=document.getElementById(`r-${id}`); if(!row) return;
      if(colOwn){   // 自有品牌：計價單價＝原價×折（折欄空＝原價），即時回填 readonly 的計價欄
        const lpEl=row.querySelector('[data-f="lp"]'),diEl=row.querySelector('[data-f="disc"]'),pEl=row.querySelector('[data-f="price"]');
        if(lpEl&&diEl&&pEl){ const lp=parseFloat(lpEl.value)||0; const dv=diEl.value.trim(); const f=dv===''?1:((parseFloat(dv)||0)/10); pEl.value=lp>0?Math.round(lp*f):''; }
      }
      const p=gv(row,'price'),d=colDed?gv(row,'ded'):0,l=colLogo?gv(row,'logo'):0,q=gv(row,'qty');
      const lineRaw=(p+d+l)*q;
      const giftEl=row.querySelector('[data-f="gift"]'); const isGift=!!(giftEl&&giftEl.checked);
      row.classList.toggle('gift', isGift);
      if(!isGift) rawSub+=lineRaw;   // 贈品／不計價：顯示金額但不計入總計
      const el=document.getElementById(`rs-${id}`);
      if(el){
        if(isGift) el.innerHTML = lineRaw?`<span style="text-decoration:line-through;color:#A8A69C">$${Math.round(lineRaw).toLocaleString()}</span> <span style="color:#A6824A;font-weight:700">贈</span>`:'—';
        else el.textContent=lineRaw?'$'+Math.round(lineRaw).toLocaleString():'—';
      }
    });
  } else {
    rawSub += banGroupSub('g1') + banGroupSub('g2');

    banFreeItems.forEach(id=>{
      const row=document.getElementById(`bf-${id}`); if(!row) return;
      const info=banFreeRowInfo(row);
      row.classList.toggle('free', info.free);
      if(!info.free) rawSub+=info.sub;   // 免費列：顯示金額但不計入總計
    });

    const mode=document.getElementById('svc-mode').value;
    if(mode){
      const a1=parseFloat(document.getElementById('svc-amt1').value)||0;
      const a2=parseFloat(document.getElementById('svc-amt2').value)||0;
      const q=parseFloat(document.getElementById('svc-qty').value)||1;
      rawSub += (a1+(mode==='travel'?a2:0))*q;
    }

    banAddonItems.forEach(id=>{
      const row=document.getElementById(`ba-${id}`); if(!row) return;
      const p=gv(row,'price'),q=gv(row,'qty');
      const lineRaw=p*q;
      rawSub+=lineRaw;
      const el=document.getElementById(`bas-${id}`);
      if(el) el.textContent=lineRaw?'$'+Math.round(lineRaw).toLocaleString():'—';
    });
  }

  /* 額外費用一併計稅；顯示統一為發票格式：合計（未稅）／營業稅／總計（含稅、未稅模式皆同） */
  const extTotal = (qType==='bottle'||qType==='ownbrand'||qType==='ownlabel'||qType==='consign') ? extras.reduce((s,e)=>s+e.a,0) : 0;
  const base = rawSub + extTotal;   // inc＝含稅總額、exc＝未稅總額
  let taxAmt=0, netAll=base, grandTotal=base;
  if(rate>0){
    if(taxMode==='inc'){
      netAll = base/(1+rate);
      grandTotal = base;
      taxAmt = Math.round(grandTotal) - Math.round(netAll);   // 避免分行進位誤差，三行相加必等於總計
    } else {
      taxAmt = Math.round(base*rate);
      grandTotal = base + taxAmt;
    }
    document.getElementById('tr-tax').style.display='flex';
    document.getElementById('t-tax').textContent='$'+taxAmt.toLocaleString();
  } else {
    document.getElementById('tr-tax').style.display='none';
    document.getElementById('t-tax').textContent='$0';   // 稅率0時歸零，避免存檔時殘留舊稅額
  }
  document.getElementById('t-sub').textContent='$'+Math.round(netAll).toLocaleString();
  document.getElementById('tr-ext').style.display='none';   // 額外費用已併入合計計稅（品項表內仍有明細列）
  // #21 修正：t-ext 先前只被隱藏、從未寫回加總值，導致存檔送出的 extrasTotal 永遠是初始值 0（不影響總計，但對帳/報表看不到額外費用）。這裡補寫回實際加總。
  document.getElementById('t-ext').textContent=(extTotal<0?'-$':'$')+Math.round(Math.abs(extTotal)).toLocaleString();
  document.getElementById('t-tot').textContent='$'+Math.round(grandTotal).toLocaleString();
  try{ updateObMoqWarn(); }catch(e){}
  calcPay();
  runHooks('afterCalc');    // 公司報價檔的自動規則／MOQ 提醒登記在這（見 04_company.js 檔尾）
}

function setTaxMode(m){
  taxMode=m;
  document.getElementById('tp-inc').classList.toggle('on',m==='inc');
  document.getElementById('tp-exc').classList.toggle('on',m==='exc');
  const status=document.getElementById('tax-status');
  if(m==='inc'){
    document.getElementById('lb-sub').textContent='合計（未稅）';
    document.getElementById('lb-tax').textContent='營業稅';
    status.textContent='輸入含稅價：總計＝輸入金額，未稅與營業稅自動回算';
  } else {
    document.getElementById('lb-sub').textContent='合計（未稅）';
    document.getElementById('lb-tax').textContent='營業稅';
    status.textContent='輸入未稅價，自動加計營業稅';
  }
  calc();
}

function setPay(n){
  LOADED_PAY_DETAIL=null; // 切換付款方式視為重新設定，恢復即時計算
  payTab=n;
  document.querySelectorAll('.ptab').forEach((b,i)=>b.classList.toggle('on',i===n));
  document.querySelectorAll('.pay-panel').forEach((p,i)=>p.classList.toggle('on',i===n));
  estPayDay();
}

function calcPay(){
  const tot=parseFloat((document.getElementById('t-tot').textContent||'0').replace(/[$,]/g,''))||0;
  const pct=(parseFloat(document.getElementById('dep-pct')?.value)||30)/100;
  const dep=Math.round(tot*pct);
  const bal=tot-dep;
  const da=document.getElementById('dep-amt'); if(da) da.textContent='$'+dep.toLocaleString();
  const db=document.getElementById('dep-bal'); if(db) db.textContent='$'+bal.toLocaleString();
}

function estPayDay(){
  const dt=document.getElementById('f-dt').value; if(!dt) return;
  const mon=parseInt(document.getElementById('p2-mon')?.value)||1;
  const day=parseInt(document.getElementById('p2-day')?.value)||15;
  // 直接建構目標月份的日期，避免「先加月再設日」在月底(如1/31+1月)溢位到隔月；並把日夾制在該月最後一天
  const d0=new Date(dt);
  const y=d0.getFullYear(), m=d0.getMonth()+mon;
  const lastDay=new Date(y, m+1, 0).getDate();
  const base=new Date(y, m, Math.min(day, lastDay));
  const el=document.getElementById('p2-est');
  if(el) el.value=`${base.getFullYear()}/${s2(base.getMonth()+1)}/${s2(base.getDate())}`;
}
document.addEventListener('input',e=>{ if(e.target.id==='p2-mon'||e.target.id==='p2-day') estPayDay(); });
// 使用者一旦編輯任一付款欄位，就取消「沿用已存文字」，改回即時計算並刷新預覽
document.addEventListener('input',e=>{
  if(LOADED_PAY_DETAIL==null) return;
  const PAY_FIELDS=['dep-pct','dep-days','dep-ded','p1-vdays','p1-pct','p1-note','p2-mon','p2-day','p3-txt'];
  if(PAY_FIELDS.includes(e.target.id)){ LOADED_PAY_DETAIL=null; if(typeof calc==='function') calc(); }
});
// 滾輪滑過「聚焦中的數字欄」時讓它失焦，避免不小心把金額/數量滾掉
document.addEventListener('wheel',function(e){
  const t=e.target;
  if(t&&t.tagName==='INPUT'&&t.type==='number'&&document.activeElement===t) t.blur();
},{passive:true});
// 使用者在報價單頁實際輸入 → 標記為有未儲存內容（程式用 .value 帶入不會觸發 input，不會誤標）
document.addEventListener('input',function(e){
  const t=e.target;
  if(t&&t.closest&&t.closest('#page-new')) FORM_DIRTY=true;
});
// 彈窗：點遮罩空白處／按 Esc 關閉
// 注意：正在輸入的表單型彈窗（oe-overlay 編輯進度、ce-overlay 行事曆、vmp/vmm-overlay 客訴處理、
// cs-cus/cs-move-overlay 寄售、vf-overlay 驗收單 等）不自動關，避免誤觸/誤按掉還沒存的資料；
// 只有純檢視型彈窗（cl-overlay 修改紀錄、gd-overlay 產文件）才允許點遮罩／Esc 關閉。
// .pov（報價單預覽，純檢視）維持原本可關閉行為。
const V2OV_AUTOCLOSE_IDS=['cl-overlay','gd-overlay'];
function _isAutoCloseOverlay(o){
  if(!o) return false;
  if(o.classList.contains('pov')) return true;
  if(o.classList.contains('v2ov')) return V2OV_AUTOCLOSE_IDS.includes(o.id);
  return false;
}
document.addEventListener('mousedown',function(e){
  const t=e.target;
  if(t&&t.classList&&(t.classList.contains('v2ov')||t.classList.contains('pov')) && _isAutoCloseOverlay(t)) t.style.display='none';
});
// Esc 只關「最上層可見」的一個可自動關閉彈窗（v2ov z-index 高於 pov，優先關 v2ov）；login-overlay 不受影響。
document.addEventListener('keydown',function(e){
  if(e.key!=='Escape') return;
  const openV2ov=V2OV_AUTOCLOSE_IDS.map(id=>document.getElementById(id)).filter(o=>o&&o.style.display&&o.style.display!=='none');
  if(openV2ov.length){ openV2ov[openV2ov.length-1].style.display='none'; return; }
  const pov=document.getElementById('pov');
  if(pov && pov.style.display && pov.style.display!=='none') pov.style.display='none';
});
// 有未儲存內容時，重新整理/關閉分頁前提醒（僅在報價單頁）
window.addEventListener('beforeunload',function(e){
  if(FORM_DIRTY && document.getElementById('page-new') && document.getElementById('page-new').classList.contains('on')){
    e.preventDefault(); e.returnValue='';
  }
});

function addExt(){
  const n=document.getElementById('en').value.trim();
  const a=parseFloat(document.getElementById('ea').value)||0;
  if(!n) return;
  pushExt(n,a);
  document.getElementById('en').value='';
  document.getElementById('ea').value='';
}
function pres(n,a){pushExt(n,a);}
function presAmt(n,def){
  const s=prompt(`請輸入${n}金額`, def!=null?String(def):'');
  if(s===null) return;
  const amt=parseFloat(s)||0;
  pushExt(n, amt);
}
function handleExtPreset(sel){
  const v=sel.value;
  sel.value='';
  if(v==='sgs') presQty('SGS 檢驗費',4000);
  else if(v==='gs1') presQty('GS1條碼登記費',1500);
  else if(v==='freeship') pres('整批出貨免運',0);
  else if(v==='shipping') presAmt('運費');
  else if(v==='customlabel') presAmt('客製化前標',0);
  else if(v==='chamber') presDiscount('商會特別優惠');
}
function presDiscount(n){
  const s=prompt(`請輸入「${n}」折抵金額（正數即可，會以折抵方式扣減總額）`, '');
  if(s===null) return;
  const amt=Math.abs(parseFloat(s)||0);
  if(!amt){ toast('折抵金額需大於 0','err'); return; }
  pushExt(n, -amt); // 以負數列入額外費用 → 於合計前扣減（與其他額外費用一併計稅）
}
function presQty(n,unit){
  const def=botItems.length||1;
  const s=prompt(`請輸入需要${n}的款數（每款 $${unit.toLocaleString()}）`, def);
  if(s===null) return;
  const qty=parseInt(s)||1;
  pushExt(`${n}（${qty}款 × $${unit.toLocaleString()}）`, unit*qty);
}
let _extSeq=0;
function pushExt(n,a){
  const id=`ext${++_extSeq}`; extras.push({id,n,a});
  renderExt(); calc();
}
function removeExt(id){runHooks('beforeRemoveExt', id);extras=extras.filter(e=>String(e.id)!==String(id));renderExt();calc();}
function renderExt(){
  document.getElementById('ext-list').innerHTML=extras.map(e=>
    `<div class="etag">${e.n}${e.a?'：'+fmtMoney(e.a):''}<button onclick="removeExt('${e.id}')">✕</button></div>`
  ).join('');
}

/* B4 附加圖片存後台：加圖時前端先縮圖→轉 base64，存進 imgs[].data；儲存時隨 quote.images 送後端保存、載入時由後端回傳 base64 還原 */
const IMG_MAX_COUNT=8, IMG_MAX_DIM=1600, IMG_JPEG_Q=0.85, IMG_TOTAL_WARN=6*1024*1024;
function imgFileToData_(f){
  return new Promise((resolve,reject)=>{
    const fr=new FileReader();
    fr.onerror=()=>reject(new Error('讀取失敗'));
    fr.onload=()=>{
      const im=new Image();
      im.onerror=()=>reject(new Error('圖片解析失敗'));
      im.onload=()=>{
        let w=im.naturalWidth||im.width, h=im.naturalHeight||im.height;
        const scale=Math.min(1, IMG_MAX_DIM/Math.max(w,h||1));
        w=Math.max(1,Math.round(w*scale)); h=Math.max(1,Math.round(h*scale));
        const cv=document.createElement('canvas'); cv.width=w; cv.height=h;
        const ctx=cv.getContext('2d');
        ctx.fillStyle='#FFFFFF'; ctx.fillRect(0,0,w,h); // JPEG 無透明度，鋪白底避免透明區變黑
        ctx.drawImage(im,0,0,w,h);
        const mime='image/jpeg';
        const durl=cv.toDataURL(mime, IMG_JPEG_Q);
        resolve({url:durl, name:f.name, mime, data:(durl.split(',')[1]||'')});
      };
      im.src=fr.result;
    };
    fr.readAsDataURL(f);
  });
}
async function handleImg(ev){
  const files=Array.from(ev.target.files||[]);
  ev.target.value=''; // 清空 input，讓同一檔可再次選取仍觸發 onchange
  for(const f of files){
    if(imgs.length>=IMG_MAX_COUNT){ toast(`最多只能附加 ${IMG_MAX_COUNT} 張圖片`,'err'); break; }
    if(!/^image\//.test(f.type||'')){ toast(`「${f.name}」不是圖片檔，略過`,'err'); continue; }
    try{ imgs.push(await imgFileToData_(f)); }
    catch(e){ toast(`「${f.name}」處理失敗，略過`,'err'); }
  }
  renderImgs();
  FORM_DIRTY=true;
  const total=imgs.reduce((s,i)=>s+((i.data&&i.data.length)||0),0);
  if(total>IMG_TOTAL_WARN) toast('圖片總量偏大，儲存可能較慢，建議減少張數或改用較小的圖','err');
}
function removeImg(i){imgs.splice(i,1);renderImgs();FORM_DIRTY=true;}
function renderImgs(){
  document.getElementById('uprev').innerHTML=imgs.map((img,i)=>
    `<div class="uth"><img src="${img.url}" alt="${img.name}"><button class="rm" onclick="removeImg(${i})">✕</button></div>`
  ).join('');
}

function resetAll(skipConfirm){
  if(!skipConfirm && !confirm('確定清除這張報價單的內容？（只會清空目前這張新報價單，其他頁面不受影響）')) return;
  document.querySelectorAll('#page-new input:not([readonly]),#page-new textarea,#page-new select').forEach(el=>{
    if(el.type==='number'&&el.id==='f-ser') el.value='1';
    else if(el.id==='f-hdl') el.value='Molly';
    else if(el.type==='number'&&el.id==='dep-pct') el.value='30';
    else if(el.type==='number'&&el.id==='taxrate') el.value='5';
    else if(el.type==='number'&&el.id==='p2-mon') el.value='1';
    else if(el.id==='f-dt') el.value=todayStr();
    else if(el.tagName==='SELECT') el.value='';
    else if(!el.readOnly) el.value='';
  });
  botItems=[]; banFreeItems=[]; banAddonItems=[]; extras=[]; imgs=[]; rowId=0;
  botDedCache={}; botLogoCache={}; botLotCache={};
  flavors={g1:[],g2:[]};
  colDed=false; colLogo=false; colLot=false; colGift=false;
  colMark=false;
  colOwn=(qType==='ownbrand'||qType==='ownlabel');
  document.getElementById('ctg-ded').classList.remove('on');
  document.getElementById('ctg-logo').classList.remove('on');
  document.getElementById('ctg-lot').classList.remove('on');
  { const e=document.getElementById('ctg-gift'); if(e) e.classList.remove('on'); }
  rebuildBotHeader();
  document.getElementById('itbody-bot').innerHTML='';
  document.getElementById('ban-free-body').innerHTML='';
  document.getElementById('ban-addon-body').innerHTML='';
  document.getElementById('ext-list').innerHTML='';
  document.getElementById('uprev').innerHTML='';
  renderFlavors('g1'); renderFlavors('g2');
  // 宴會計價方式還原：杯計價、手動小計關閉（通用清空迴圈會把 select 設成空值，這裡補回預設）
  ['g1','g2'].forEach(g=>{
    const u=document.getElementById(`ban-${g}-unit`); if(u) u.value='cup';
    const m=document.getElementById(`ban-${g}-man`); if(m) m.checked=false;
    const s=document.getElementById(`ban-${g}-subman`); if(s){ s.value=''; s.style.display='none'; }
    const lb=document.getElementById(`ban-${g}-qtylabel`); if(lb) lb.textContent='總杯數';
    const qi=document.getElementById(`ban-${g}-qty`); if(qi) qi.placeholder=(g==='g1'?'90':'0');
  });
  document.getElementById('svc-detail-wrap').classList.remove('on');
  addBotRow();
  if(qType==='banquet'){ addBanFreeRow(); addBanAddonRow(); }
  setPay(0);
  calc(); onDate(); upNo();
  runHooks('afterReset', skipConfirm);   // 清掉公司選擇／發票抬頭等登記在這（見 08_ownbrand.js 檔尾）
}

function getPayTerms(){
  if(LOADED_PAY_DETAIL!=null) return LOADED_PAY_DETAIL; // 載入舊單且未重新編輯付款 → 沿用已存文字（tab0/1/2 細節欄目前不會存下，重算會失真）
  const tot=document.getElementById('t-tot').textContent;
  if(payTab===0){
    const pct=document.getElementById('dep-pct')?.value||30;
    const dep=document.getElementById('dep-amt')?.textContent||'—';
    const bal=document.getElementById('dep-bal')?.textContent||'—';
    const days=document.getElementById('dep-days')?.value;
    const note=document.getElementById('dep-ded')?.value;
    let t=`甲方應於本報價單成立後，支付訂金新台幣 ${dep} 元整（總價之 ${pct}%），作為乙方開始製造之依據。乙方完成商品製作並全數交付後，`;
    t+= days?`甲方應於到貨後 ${days} 日內完成驗收，驗收無誤後支付尾款新台幣 ${bal} 元整（總價之 ${100-pct}%）。`:`甲方應於驗收無誤後支付尾款新台幣 ${bal} 元整（總價之 ${100-pct}%）。`;
    if(note) t+=`<br>付款條件備註：${note}`;
    return t;
  }
  if(payTab===1){
    const v=document.getElementById('p1-vdays')?.value||'7';
    const pct=document.getElementById('p1-pct')?.value||'100';
    const n=document.getElementById('p1-note')?.value;
    let t=`乙方交付商品後，甲方應於 ${v} 日內完成驗收，驗收無誤後即應支付款項新台幣 ${tot} 元整之 ${pct}%。`;
    if(n) t+=`<br>付款條件備註：${n}`;
    return t;
  }
  if(payTab===2){
    const mon=document.getElementById('p2-mon')?.value||'1';
    const day=document.getElementById('p2-day')?.value||'15';
    const est=document.getElementById('p2-est')?.value||'—';
    return `甲方應於收貨後第 ${mon} 個月 ${day} 號支付全額款項新台幣 ${tot} 元整，預估付款日：${est}。`;
  }
  if(payTab===3) return document.getElementById('p3-txt')?.value||'（請填寫自訂付款條款）';
  if(payTab===4) return '';
  return '';
}
