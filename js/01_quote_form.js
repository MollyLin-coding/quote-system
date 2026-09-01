let qType='bottle', taxMode='inc', payTab=0;
let LOADED_PAY_DETAIL=null; // 載入舊單時記住已存的付款條件文字，未重新編輯付款前直接沿用，避免重算改掉客戶看到的條件
let FORM_DIRTY=false; // 標準報價單是否有「使用者實際輸入、尚未儲存」的內容（供離開頁面前提醒；程式帶入值不算）
let botItems=[],banFreeItems=[],banAddonItems=[],banG1Items=[],banG2Items=[],extras=[],imgs=[],rowId=0;
/* 付款條件 Tab0（比例訂金＋尾款）計算用的快照，由 calc() 每次算完後寫入：
   LAST_WINE_SUB＝酒款金額（品項表小計 rawSub，不含額外費用）
   LAST_EXT_POS／LAST_EXT_NEG＝額外費用列拆成正數項（檢驗費、條碼費…）與負數項（運費折抵…）
   LAST_BASE＝rawSub＋額外費用合計（未加稅前的基數）／LAST_GRAND＝總計（含稅），供稅金按比例分攤 */
let LAST_WINE_SUB=0, LAST_EXT_POS=[], LAST_EXT_NEG=[], LAST_BASE=0, LAST_GRAND=0;
let customItems=[],previewKind='std';
let colDed=false, colLogo=false, colLot=false, colMark=false, colOwn=false, colGift=false;


(()=>{
  document.getElementById('f-dt').value=todayStr();
  onDate(); upNo(); addBotRow(); rebuildBotHeader();
  updateOrdProgVisibility();
})();

/* 2026-08-12：「訂單追蹤進度」併入報價單表單本身（見 index.html ordprog-block）。
   只在「新增報價單」時顯示——載入既有單編輯（editingQuoteNo 有值）就藏起來，
   避免她以為改這裡會動到已經存過、可能被手改過的訂單追蹤資料。實際送出邏輯在
   02_core_api.js 的 saveQuote()／maybeCreateOrderProgressOnSave()。 */
function updateOrdProgVisibility(){
  const editing=(typeof editingQuoteNo!=='undefined' && !!editingQuoteNo);
  const box=document.getElementById('ordprog-block');
  if(box){
    const qo=document.getElementById('f-quoteonly');
    const hide=editing || (qo && qo.checked); // 純報價單不建訂單追蹤，區塊一併藏起
    box.style.display=hide ? 'none' : 'block';
  }
  // 2026-08-28：「另存新單」鈕只在編輯既有單時顯示（新單直接按儲存就好）
  { const b=document.getElementById('btn-saveas'); if(b) b.style.display=editing?'':'none'; }
}
/* 2026-08-28：純報價單勾選（僅報價、不建訂單追蹤／行事曆）＋報價單稅金顯示切換 */
function onQuoteOnlyChange(){ FORM_DIRTY=true; updateOrdProgVisibility(); }
function onTaxDisplayChange(){
  FORM_DIRTY=true;
  const v=(document.getElementById('f-taxdisplay')||{}).value||'';
  const h=document.getElementById('taxdisp-hint');
  if(h) h.textContent = v==='excl' ? (taxMode==='inc'?'輸入的是含稅價：印出時會自動換算成未稅價':'') : '';
}

/* 訂金比例預設值：瓶裝／OEM代工／公版買斷／公版客製標／寄售一律 50%（酒款對半拆），宴會等其他類型維持 30% */
function defaultDepPct(){
  return (qType==='bottle'||qType==='ownbrand'||qType==='ownlabel'||qType==='consign') ? '50' : '30';
}

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
  /* 有效日期＝報價日 +1 個月。複檢 2026-08-06 #17：原本用 setMonth(+1)，1/31 會溢位成 3/3
     （2 月沒有 31 號）。改成直接建構目標月份並把日夾在該月最後一天——同檔 estPayDay()
     早就修過同一個問題，這裡漏修。 */
  const _y=d.getFullYear(), _m=d.getMonth()+1;
  const _last=new Date(_y, _m+1, 0).getDate();
  const e=new Date(_y, _m, Math.min(d.getDate(), _last));
  const estr=`${e.getFullYear()}/${s2(e.getMonth()+1)}/${s2(e.getDate())}`;
  document.getElementById('f-ex').value=estr;
  document.getElementById('pl-dt').textContent=disp;
  document.getElementById('pl-ex').textContent=estr;
  upNo(); estPayDay();
}

function upNo(){
  // 編輯既有單時單號固定＝原單號：改報價日/流水號不得重排單號，否則預覽/PDF 印的單號會跟後台存的對不上
  if(typeof editingQuoteNo!=='undefined' && editingQuoteNo){
    document.getElementById('f-no').value=editingQuoteNo;
    document.getElementById('pl-no').textContent=editingQuoteNo;
    return;
  }
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
  const typeChanged=(qType!==t);
  qType=t;
  // 切換單型時把訂金比例帶回該單型的預設（瓶裝／OEM／公版／寄售＝50，宴會等＝30）
  if(typeChanged){ const dp=document.getElementById('dep-pct'); if(dp) dp.value=defaultDepPct(); }
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
  // 2026-08-28：本單可調級距 只在「一次性採購」顯示；開放寄倉 代工／一次性採購／客製標 都顯示（寄售、宴會不適用）
  { const e=document.getElementById('ob-tieredit'); if(e) e.style.display=isOwn?'block':'none'; }
  { const e=document.getElementById('storage-card'); if(e) e.style.display=(t==='bottle'||isOwnCat)?'block':'none'; }
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
let botDedCache={}, botLogoCache={}, botLotCache={}, botGiftCache={};
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
    if(giftEl) botGiftCache[id]=giftEl.checked?1:0;   // 2026-09-01：欄位收起來時勾選狀態只剩快取，見下方 calc()
    /* 複檢 2026-08-06 #6：pid / 價格的 src 與手改旗標一定要一起帶走。
       少了 pid，重建後的列就跟公司報價檔脫鉤——級距價不再隨瓶數換、MOQ 提醒也消失。 */
    const priceEl=row.querySelector('[data-f="price"]');
    return {id,name:gs(row,'name'),lot:lotEl?lotEl.value:(botLotCache[id]||''),vol:gs(row,'vol'),price:gs(row,'price'),ded:botDedCache[id]||'',logo:botLogoCache[id]||'',qty:gs(row,'qty'),lp:lpEl?lpEl.value:'',disc:diEl?diEl.value:'',discManual:(diEl&&diEl.dataset.manual==='1')?1:0,gift:(giftEl?(giftEl.checked?1:0):(botGiftCache[id]||0)),mark:(markEl&&markEl.checked)?1:0,
      pid:row.dataset.pid||'', sku:row.dataset.sku||'', listprice:row.dataset.listprice||'',
      tierBaseQty:(row.dataset.tierBaseQty!=null?row.dataset.tierBaseQty:''),   // 複檢 2026-08-11 #2：切換欄位重建列時別把「還沒動過瓶數」的狀態弄丟
      priceSrc:(priceEl&&priceEl.dataset.src!=null)?priceEl.dataset.src:'', manual:(priceEl&&priceEl.dataset.manual==='1')?1:0};
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
      gift:(q('gift')?(q('gift').checked?1:0):(botGiftCache[id]||0)),
      lp:(q('lp')?q('lp').value:'')||'', disc:(q('disc')?q('disc').value:'')||'',
      discManual:(q('disc')&&q('disc').dataset.manual==='1')?1:0,
      sku:row.dataset.sku||'', listprice:row.dataset.listprice||'',
      /* 2026-09-01 複檢：原本少了 pid／tierBaseQty／priceSrc，切換單別重建品項表之後
         這幾列就跟公司報價檔脫鉤——改瓶數不再換級距價、MOQ 提醒也不再出現，而且畫面完全看不出來。
         （同檔 toggleCol() 的內嵌快照 2026-08-06 已修，這支姊妹函式當時漏改。） */
      pid:row.dataset.pid||'',
      tierBaseQty:(row.dataset.tierBaseQty!=null?row.dataset.tierBaseQty:''),
      priceSrc:(q('price')&&q('price').dataset.src!=null)?q('price').dataset.src:'',
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
  if(colLot) h += `<input placeholder="Lot31" oninput="calc()" data-f="lot" value="${escAttr(lotVal)}">`;
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
  /* 複檢 2026-08-06 #6：還原「這一列是從公司報價檔帶入的」關聯。
     toggleCol（切換前標費/LOGO/批次/贈品欄）會整批重建列，沒有這段的話 pid 就掉了，
     級距價與 MOQ 提醒全部失效。同時把 hand-edit 標示與手改監聽一併接回去。 */
  if(prefill && prefill.pid){
    div.dataset.pid=prefill.pid;
    /* 複檢 2026-08-11 #2：載入舊單時帶進來的「當時瓶數」。
       瓶數還等於這個值，就代表使用者還沒動過，級距價不介入（保留原單談好的價）。 */
    if(prefill.tierBaseQty!==''&&prefill.tierBaseQty!=null) div.dataset.tierBaseQty=String(prefill.tierBaseQty);
    const pi=div.querySelector('[data-f="price"]');
    if(pi){
      if(prefill.priceSrc!=='' && prefill.priceSrc!=null) pi.dataset.src=prefill.priceSrc;
      if(prefill.manual) pi.dataset.manual='1';
      pi.removeAttribute('oninput');
      pi.addEventListener('input',()=>{ pi.dataset.manual='1'; if(typeof markHand==='function') markHand(pi); calc(); });
      if(typeof markHand==='function') markHand(pi);
    }
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
  if(row){ const g=row.querySelector('[data-f="gift"]'); botGiftCache[id]=(g&&g.checked)?1:0; row.classList.toggle('gift', !!(g&&g.checked)); }
  calc();
}
/* 貼牌 MOQ 300／款 未達提醒（僅提示、不擋單）——公版買斷模式、已勾貼牌的列 */
function updateObMoqWarn(){
  const el=document.getElementById('ob-moqwarn'); if(!el) return;
  /* 2026-08-28：一次性採購也提醒「未達本單最低級距門檻」（門檻可在本單調整；僅提示、不擋單） */
  if(qType==='ownbrand'){
    const ts=(typeof obCurrentTiers==='function'?obCurrentTiers():null)||(typeof buyoutTiers==='function'?buyoutTiers().filter(t=>t.min>0):[]);
    const minTh=ts.length?ts[0].min:0;
    const warns=[];
    if(minTh>0) botItems.forEach(id=>{
      const row=document.getElementById(`r-${id}`); if(!row) return;
      const q=gv(row,'qty');
      if(q>0 && q<minTh){
        const nm=gs(row,'name')||'該品項';
        warns.push(`⚠ ${escHtml(nm)} 未達本單最低量價門檻 ${minTh} 瓶（目前 ${q} 瓶），以原價計 — 提醒用，照樣可出單`);
      }
    });
    el.innerHTML=warns.map(w=>`<div class="moq-warn">${w}</div>`).join('');
    return;
  }
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
  delete botDedCache[id]; delete botLogoCache[id]; delete botLotCache[id]; delete botGiftCache[id];
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

// ── BANQUET 計價方式（杯／ML）＋每款各自數量／單價 ──
/* 2026-08-31 起：兩組客製化調酒改成每一款酒各自填數量／單價（見 addBanGroupRow），
   不再整組共用一個價（Molly 反映：不同酒款成本不同，硬綁同一個價不合理）。
   「以杯計價」或「以 ML 計價」仍是整組共用的顯示單位（大桶出貨、談整包價的宴會單用）；
   每一款仍可勾「手動小計」直接填談好的整包價，不用單價×數量。 */
function banUnitOf(g){ const e=document.getElementById(`ban-${g}-unit`); const v=e?e.value:''; return (v==='ml'||v==='keg')?v:'cup'; }
/* 存檔／預覽／正式文件用的單位字：杯／ml／桶（桶＝10 公升整桶出貨，2026-08-31 加） */
function banUnitLabel(g){ const u=banUnitOf(g); return u==='ml'?'ml':(u==='keg'?'桶':'杯'); }
function banQtyPlaceholder(g){ const u=banUnitOf(g); return u==='ml'?'總ML數':(u==='keg'?'桶數':(g==='g1'?'90':'0')); }
function onBanUnitChange(g){
  const ph=banQtyPlaceholder(g);
  document.querySelectorAll(`#ban-${g}-body [data-f="qty"]`).forEach(i=>{ i.placeholder=ph; });
  calcBan();
}
function banGroupItems(g){ return g==='g1'?banG1Items:banG2Items; }
/* 該款小計＋手動旗標（collectQuote／預覽／calcBan 共用，比照 banFreeRowInfo） */
function banGroupRowInfo(row){
  const manual=!!(row.querySelector('[data-f="manual"]')&&row.querySelector('[data-f="manual"]').checked);
  const subInput=row.querySelector('[data-f="subval"]');
  let sub;
  if(manual){ sub=(subInput&&subInput.value!=='')?(parseFloat(subInput.value)||0):0; }
  else {
    sub=(parseFloat(row.querySelector('[data-f="price"]')?.value)||0)*(parseFloat(row.querySelector('[data-f="qty"]')?.value)||0);
    if(subInput) subInput.value=sub?Math.round(sub):'';
  }
  return {manual, sub};
}
/* 該組小計＝組內每一款小計加總 */
function banGroupSub(g){
  let s=0;
  banGroupItems(g).forEach(id=>{ const row=document.getElementById(`bg-${g}-${id}`); if(row) s+=banGroupRowInfo(row).sub; });
  return s;
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
    <input placeholder="${escAttr(prefill?.ph||'加購項目名稱')}" oninput="calc()" data-f="name" value="${escAttr(prefill?.name||'')}">
    <input type="number" placeholder="1" oninput="calc()" data-f="qty" value="${prefill?.qty||''}">
    <input placeholder="式" oninput="calc()" data-f="unit" value="${escAttr(prefill?.unit||'')}">
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

// ── BANQUET GROUP ROWS（每一款酒各自一列：品名／數量／單價／小計，比照 banFreeRow 版型）──
function addBanGroupRow(g,prefill){
  prefill=prefill||{};
  rowId++;
  const id=rowId;
  const manual=!!prefill.manual;
  const div=document.createElement('div');
  div.id=`bg-${g}-${id}`;
  div.className='crow';
  const qtyPh=banQtyPlaceholder(g);
  div.innerHTML=`
    <div class="crow-top" style="grid-template-columns:3fr 66px 86px 86px 26px;min-width:0">
      <input placeholder="酒款名稱（如：甘蔗檸檬Mojito）" oninput="calcBan()" data-f="name" value="${escAttr(prefill.name||'')}">
      <input type="number" placeholder="${qtyPh}" oninput="calcBan()" data-f="qty" value="${prefill.qty!=null?prefill.qty:''}">
      <input type="number" placeholder="單價" oninput="calcBan()" data-f="price" value="${prefill.price!=null?prefill.price:''}">
      <input type="number" placeholder="—" data-f="subval" value="${prefill.subval!=null?prefill.subval:''}" oninput="calcBan()" ${manual?'':'readonly'}>
      <button class="del" onclick="delBanGroupRow('${g}',${id})">✕</button>
    </div>
    <div class="crow-bottom">
      <div class="crow-flags">
        <label title="這一款談好的整包價直接填小計，不用單價×數量"><input type="checkbox" data-f="manual" ${manual?'checked':''} onchange="toggleBanGroupRowManual('${g}',${id})">手動小計</label>
      </div>
    </div>`;
  document.getElementById(`ban-${g}-body`).appendChild(div);
  banGroupItems(g).push(id);
}
function toggleBanGroupRowManual(g,id){
  const row=document.getElementById(`bg-${g}-${id}`); if(!row) return;
  const man=row.querySelector('[data-f="manual"]').checked;
  row.querySelector('[data-f="subval"]').readOnly=!man;
  calcBan();
}
function delBanGroupRow(g,id){
  const el=document.getElementById(`bg-${g}-${id}`); if(el) el.remove();
  if(g==='g1') banG1Items=banG1Items.filter(i=>i!==id); else banG2Items=banG2Items.filter(i=>i!==id);
  calcBan();
}
/* 輸入框 Enter／貼上多行＝一次新增多款（沿用原本「貼上多行自動拆成多筆」的手感），
   每款各自留白數量／單價讓她填，不再像以前套用整組同一個價。 */
function addBanGroupRowFromInput(g){
  const inp=document.getElementById(`ban-${g}-input`);
  const lines=inp.value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(!lines.length) return;
  lines.forEach(name=>addBanGroupRow(g,{name}));
  inp.value='';
  calcBan();
}
function handleBanGroupKeydown(ev,g){
  if(ev.key!=='Enter') return;
  if(ev.shiftKey) return;
  ev.preventDefault();
  addBanGroupRowFromInput(g);
}
function handleBanGroupPaste(ev,g){
  const text=(ev.clipboardData||window.clipboardData).getData('text');
  if(!text || !/\r?\n/.test(text)) return;
  ev.preventDefault();
  const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(!lines.length) return;
  lines.forEach(name=>addBanGroupRow(g,{name}));
  calcBan();
}

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
      /* 2026-09-01 複檢：把「贈品／不計價」欄收起來時 checkbox 根本不存在，原本一律當成要收錢
         → 總計無聲變大、灰底劃線也消失，畫面上完全看不出來。改成欄位不在時讀快取。 */
      const giftEl=row.querySelector('[data-f="gift"]');
      const isGift = giftEl ? giftEl.checked : !!botGiftCache[id];
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

  LAST_WINE_SUB = rawSub;   // 付款條件 Tab0 用：訂金比例只套用在這個「酒款金額」上
  /* 額外費用一併計稅；顯示統一為發票格式：合計（未稅）／營業稅／總計（含稅、未稅模式皆同） */
  const hasExtCard = (qType==='bottle'||qType==='ownbrand'||qType==='ownlabel'||qType==='consign');
  const extTotal = hasExtCard ? extras.reduce((s,e)=>s+e.a,0) : 0;
  // 付款條件 Tab0 用：正數＝檢驗費／條碼費這類「其他費用」（全額進訂金），負數＝運費折抵這類（從尾款扣）
  LAST_EXT_POS = hasExtCard ? extras.filter(e=>e.a>0) : [];
  LAST_EXT_NEG = hasExtCard ? extras.filter(e=>e.a<0) : [];
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
  LAST_BASE = base; LAST_GRAND = grandTotal;   // 付款條件 Tab0 用：稅金按 訂金/尾款 佔比分攤，確保兩者相加＝總計
  syncLoadedPayDetail();   // 載入舊單後若金額被改動 → 解除付款文字凍結、重新計算（見該函式說明）
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
  LOADED_PAY_DETAIL=null; LOADED_PAY_SIG=null; // 切換付款方式視為重新設定，恢復即時計算
  payTab=n;
  document.querySelectorAll('.ptab').forEach((b,i)=>b.classList.toggle('on',i===n));
  document.querySelectorAll('.pay-panel').forEach((p,i)=>p.classList.toggle('on',i===n));
  estPayDay();
}

/* 付款條件 Tab0「比例訂金＋尾款」（2026-08-05 依 Molly 指示改版，全單型適用）：
   ・訂金比例% 只套用在「酒款金額」（品項表小計 LAST_WINE_SUB，不含額外費用）上
   ・額外費用列裡的正數項（SGS 檢驗費、GS1 條碼費…）100% 併入訂金
   ・額外費用列裡的負數項（運費折抵…）從尾款扣除
   ・營業稅按 訂金／尾款 的未稅佔比分攤，確保 訂金＋尾款＝總計（含稅）
   沒有任何額外費用時，酒款金額＝總價，算出來的數字與改版前的「總價×%」完全相同。 */
function payBreakdown(){
  const raw=parseFloat(document.getElementById('dep-pct')?.value);
  const pctNum=Math.min(100,Math.max(0,isNaN(raw)?parseFloat(defaultDepPct()):raw));
  const pct=pctNum/100;
  const wine=LAST_WINE_SUB||0;
  const posEx=LAST_EXT_POS||[], negEx=LAST_EXT_NEG||[];
  const posTotal=posEx.reduce((s,e)=>s+e.a,0);
  const negTotal=negEx.reduce((s,e)=>s+Math.abs(e.a),0);
  const depWine=wine*pct;
  const depBase=depWine+posTotal;          // 訂金在「未加稅基數」上的金額
  const base=LAST_BASE||0, grand=Math.round(LAST_GRAND||0);
  let dep=0, bal=0;
  if(base!==0){ dep=Math.round(grand*(depBase/base)); bal=grand-dep; }
  /* 折抵（負數額外費用）超過尾款額度時封頂：訂金最多收到總計、尾款不得為負，
     否則條款會印出「支付尾款 $-2,100 元整」這種不能給客戶看的句子（複檢 2026-08-06 #12）。
     缺口視為折抵吃進訂金端，訂金＋尾款仍恆等於總計。 */
  const clamped=(bal<0);
  if(clamped){ dep=grand; bal=0; }
  /* 條款文字要逐項列出金額，這些明細必須跟訂金/尾款站在同一個稅基（未稅模式下 dep 已含稅），
     否則客戶會看到「內含 4,000＋45,000」卻對不上訂金總額。做法：各項費用先按同比例換算，
     酒款那一塊用「訂金減掉各項費用」當餘數，確保括號裡的數字加起來剛好等於括號外的總額。 */
  const scale=n=>base!==0?Math.round(grand*(n/base)):0;
  const posExShown=posEx.map(e=>({n:cleanFeeName(e.n), a:scale(e.a)}));
  const negExShown=negEx.map(e=>({n:cleanFeeName(e.n), a:scale(Math.abs(e.a))}));
  const depWineShown=dep-posExShown.reduce((s,e)=>s+e.a,0);
  const balWineShown=bal+negExShown.reduce((s,e)=>s+e.a,0);
  return {pctNum, wine, posEx, negEx, posTotal, negTotal, depWine, depBase, dep, bal, clamped,
          posExShown, negExShown, depWineShown, balWineShown};
}
/* 額外費用名稱在品項表會帶「（1款 × $4,000）」這種數量註記，合約條款只要品名，去掉尾巴的括號 */
function cleanFeeName(n){ return String(n||'').replace(/[（(][^（()）]*[)）]\s*$/,'').trim()||String(n||''); }

/* ── 載入舊單後「改了金額，付款條件卻沒跟著改」的修正（2026-08-06，Molly 回報）──────────
   背景：載入舊單時 LOADED_PAY_DETAIL 會存住當初存檔的付款文字，getPayTerms() 直接回傳它，
   目的是避免重算把客戶已經看過的條件改掉（天數/比例這些細節欄沒有存進資料庫，重算會失真）。
   問題：解除凍結的條件原本只有「使用者動到付款欄位」，所以改單價／瓶數／容量／額外費用時，
   金額變了但條款文字還停在舊數字——預覽和列印出來的訂金尾款是錯的。
   作法：記住載入當下的金額組合（總計＋酒款＋各項額外費用），一旦不一樣就
   ①從舊文字把天數與比例解析回欄位（盡量不遺失原本設定）②解除凍結讓條款重算 ③跳提示。
   金額沒動的話行為完全不變，舊單重印仍然是一字不差的原文。 */
let LOADED_PAY_SIG=null;
function payAmountSignature(){
  const amt=e=>Math.round(e.a);
  return [Math.round(LAST_GRAND||0), Math.round(LAST_WINE_SUB||0),
          (LAST_EXT_POS||[]).map(amt).join(','), (LAST_EXT_NEG||[]).map(amt).join(',')].join('|');
}
function syncLoadedPayDetail(){
  if(LOADED_PAY_DETAIL==null){ LOADED_PAY_SIG=null; return; }
  const sig=payAmountSignature();
  if(LOADED_PAY_SIG==null){ LOADED_PAY_SIG=sig; return; }   // 載入後第一次 calc：記錄基準，不動作
  if(sig===LOADED_PAY_SIG) return;                          // 金額沒變 → 維持沿用原文
  restorePayFieldsFromText(LOADED_PAY_DETAIL);
  LOADED_PAY_DETAIL=null; LOADED_PAY_SIG=null;
  try{ toast('金額有異動，付款條件已重新計算（天數與比例沿用原單設定，請確認一次）','ok'); }catch(e){}
}
/* 把已存的付款文字裡的天數/比例/備註解析回輸入欄，讓重算出來的條款盡量貼近原單設定。
   解析不到就維持欄位現值（HTML 預設 50%／15／7／30）。新舊兩種條款寫法都吃。 */
function restorePayFieldsFromText(txt){
  const s=String(txt||'').replace(/<br\s*\/?>/gi,'\n');
  // 條款文字裡的備註是跳脫過的（複檢 #15），還原回輸入欄時要解回原字，否則反覆存讀會越積越多 &amp;
  const unesc=v=>String(v==null?'':v).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
  const put=(id,m)=>{ if(!m) return; const el=document.getElementById(id); if(el) el.value=unesc(m[1]); };
  const note=s.match(/付款條件備註：([\s\S]+)$/);
  if(payTab===0){
    put('dep-pct', s.match(/酒水總價\s*(\d+(?:\.\d+)?)\s*%/) || s.match(/酒款金額之\s*(\d+(?:\.\d+)?)\s*%/) || s.match(/總價之\s*(\d+(?:\.\d+)?)\s*%/));   // (?:\.\d+)? 支援小數比例如 12.5%（複檢 #16）
    put('dep-days1', s.match(/製造前\s*(\d+)\s*日/));
    put('dep-days',  s.match(/到貨後\s*(\d+)\s*日/));
    put('dep-fdays', s.match(/(\d+)\s*日內支付尾款/));
    put('dep-ded', note);
  } else if(payTab===1){
    put('p1-vdays', s.match(/應於\s*(\d+)\s*日內完成驗收/));
    put('p1-pct',   s.match(/元整之\s*(\d+(?:\.\d+)?)\s*%/));
    put('p1-note', note);
  } else if(payTab===2){
    put('p2-mon', s.match(/第\s*(\d+)\s*個月/));
    put('p2-day', s.match(/(\d+)\s*號/));
    if(typeof estPayDay==='function') estPayDay();
  }
}
function calcPay(){
  const b=payBreakdown();
  const da=document.getElementById('dep-amt'); if(da) da.textContent='$'+b.dep.toLocaleString();
  const db=document.getElementById('dep-bal'); if(db) db.textContent='$'+b.bal.toLocaleString();
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
  const PAY_FIELDS=['dep-pct','dep-days1','dep-days','dep-fdays','dep-ded','p1-vdays','p1-pct','p1-note','p2-mon','p2-day','p3-txt'];
  if(PAY_FIELDS.includes(e.target.id)){ LOADED_PAY_DETAIL=null; LOADED_PAY_SIG=null; if(typeof calc==='function') calc(); }
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
/* 複檢 2026-08-13 #3-12：這兩個 prompt 是純文字輸入，打「1,500」會被 parseFloat 截成 1，
   報價單上直接出現「運費：$1」並進入合計與 PDF，沒有任何提示。先把逗號／空白／$ 去掉。 */
function _extNum(s){ return parseFloat(String(s==null?'':s).replace(/[,，\s$＄]/g,'')); }
function presAmt(n,def){
  const s=prompt(`請輸入${n}金額`, def!=null?String(def):'');
  if(s===null) return;
  const amt=_extNum(s)||0;
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
  const amt=Math.abs(_extNum(s)||0);
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
    `<div class="etag">${escHtml(e.n)}${e.a?'：'+fmtMoney(e.a):''}<button onclick="removeExt('${e.id}')">✕</button></div>`
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
        resolve({url:durl, name:f.name, mime, data:(durl.split(',')[1]||''), w, h}); // w/h：預覽排版用（框框依比例縮，不留白邊）
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
/* 2026-08-27：報價單圖片大小可調（整張單預設 f-imgsize：s 一排三張／m 一排兩張／l 一排一張；每張圖可個別覆蓋 imgs[i].size）
   ＋「不顯示總計區」勾選（f-hidetotals）。兩者都存成 docopts 特殊品項列（flavorList 放 JSON），後端一行不用改。 */
const IMG_SIZE_KEYS={s:'小',m:'中',l:'大'};
function imgSizeDefault(){ const e=document.getElementById('f-imgsize'); const v=e?e.value:'m'; return IMG_SIZE_KEYS[v]?v:'m'; }
function imgSizeOf(img){ return (img&&IMG_SIZE_KEYS[img.size])?img.size:imgSizeDefault(); }
function onImgSizeChange(){ FORM_DIRTY=true; renderImgs(); }
function setImgSize(i,v){ if(!imgs[i]) return; imgs[i].size=IMG_SIZE_KEYS[v]?v:''; FORM_DIRTY=true; }
/* 後端載回的圖片沒有寬高：背景量一次存到 imgs[i].w/h，預覽時框框就能照比例縮（量不到就退回固定框） */
function imgEnsureDims_(img){
  if(!img||!img.url||(img.w&&img.h)||img._dimLoading) return;
  img._dimLoading=true;
  try{ const im=new Image(); im.onload=()=>{ img.w=im.naturalWidth||im.width; img.h=im.naturalHeight||im.height; img._dimLoading=false; }; im.onerror=()=>{ img._dimLoading=false; }; im.src=img.url; }
  catch(_){ img._dimLoading=false; }
}
function renderImgs(){
  const def=imgSizeDefault();
  imgs.forEach(imgEnsureDims_);
  document.getElementById('uprev').innerHTML=imgs.map((img,i)=>{
    const cur=IMG_SIZE_KEYS[img.size]?img.size:'';
    const opt=(v,l)=>`<option value="${v}"${cur===v?' selected':''}>${l}</option>`;
    return `<div style="display:flex;flex-direction:column;gap:3px;align-items:center">
      <div class="uth"><img src="${img.url}" alt="${escAttr(img.name||'')}"><button class="rm" onclick="removeImg(${i})">✕</button></div>
      <select style="width:76px;font-size:11px;padding:2px 3px;border:1px solid var(--bd);border-radius:5px;background:var(--bg);color:var(--ink);font-family:inherit" onchange="setImgSize(${i},this.value)" title="這張圖的大小">
        ${opt('','預設（'+IMG_SIZE_KEYS[def]+'）')}${opt('s','小')}${opt('m','中')}${opt('l','大')}
      </select>
    </div>`;
  }).join('');
}
/* 文件顯示設定 → 存檔用的 docopts 特殊列（沒有任何非預設設定就回 null，不佔品項列）
   2026-08-28 起同一列也存：一次性採購的本單自訂級距（moqTiers）＋開放寄倉（storage/storageTerms） */
function buildDocOptsItem(){
  const hide=!!(document.getElementById('f-hidetotals')&&document.getElementById('f-hidetotals').checked);
  const size=imgSizeDefault();
  const sizes=imgs.map(i=>(IMG_SIZE_KEYS[i.size]?i.size:''));
  const o={hideTotals:hide?1:0, imgSize:size};
  if(sizes.some(Boolean)) o.imgSizes=sizes;
  let extra=false;
  if(qType==='ownbrand'){
    // 本單級距跟標準不一樣才存（moqTiers：[[門檻,折數(折)],…]）——僅一次性採購
    if(typeof obCurrentTiers==='function' && typeof obTiersAreDefault==='function' && !obTiersAreDefault()){
      const ct=obCurrentTiers();
      if(ct){ o.moqTiers=ct.map(t=>[t.min, +(t.disc*10).toFixed(2)]); extra=true; }
    }
  }
  // 開放寄倉：代工／一次性採購／客製標 三種單型（2026-08-28 下午擴充）
  if(qType==='bottle'||qType==='ownbrand'||qType==='ownlabel'){
    const stOn=!!(document.getElementById('ob-storage')&&document.getElementById('ob-storage').checked);
    if(stOn){
      o.storage=1;
      const ta=document.getElementById('ob-storage-terms');
      const txt=(ta?ta.value:'').trim();
      if(txt && txt!==(typeof OB_STORAGE_DEFAULT!=='undefined'?OB_STORAGE_DEFAULT:'')) o.storageTerms=txt;
      extra=true;
    }
  }
  // 2026-08-28：純報價單＋報價單稅金顯示（所有單型）
  { const qo=document.getElementById('f-quoteonly');
    if(qo&&qo.checked){ o.quoteOnly=1; extra=true; } }
  { const td=document.getElementById('f-taxdisplay');
    if(td&&td.value==='excl'){ o.taxDisplay='excl'; extra=true; } }
  if(!hide && size==='m' && !sizes.some(Boolean) && !extra) return null;
  return { itemType:'docopts', name:'文件顯示設定', lot:'', volume:'', unitPrice:0, deduction:0, logoFee:0, qty:1, unit:'', subtotal:0, flavorList:JSON.stringify(o) };
}
/* 載入報價單時還原（q.docOpts 物件優先，否則從 items 的 docopts 特殊列解析；舊單沒有就回預設） */
function applyDocOpts(q){
  let o=(q&&q.docOpts&&typeof q.docOpts==='object')?q.docOpts:null;
  if(!o){ const it=((q&&q.items)||[]).find(x=>x&&x.itemType==='docopts'); o=it?parseJsonSafe(it.flavorList,{}):{}; }
  o=o||{};
  { const h=document.getElementById('f-hidetotals'); if(h) h.checked=!!(o.hideTotals&&o.hideTotals!=='0'&&o.hideTotals!=='N'); }
  { const e=document.getElementById('f-imgsize'); if(e) e.value=IMG_SIZE_KEYS[o.imgSize]?o.imgSize:'m'; }
  const sizes=Array.isArray(o.imgSizes)?o.imgSizes:[];
  imgs.forEach((im,i)=>{ im.size=IMG_SIZE_KEYS[sizes[i]]?sizes[i]:''; });
  renderImgs();
  /* 2026-08-28：一次性採購 本單自訂級距＋開放寄倉 還原（其他單型把欄位清回預設，避免殘留到下一張單） */
  if(typeof obFillTiers==='function'){
    if(Array.isArray(o.moqTiers)&&o.moqTiers.length){
      obFillTiers(o.moqTiers.map(t=>({min:parseFloat(t[0])||0, disc:(parseFloat(t[1])||10)/10})).filter(t=>t.min>0), true);
    } else {
      obFillTiers(null,true);   // 沒存自訂＝這張單用標準級距（後端 tiers 還沒載入時會先清空，載入後自動補）
    }
  }
  { const st=document.getElementById('ob-storage'); if(st) st.checked=!!(o.storage&&o.storage!=='0'&&o.storage!=='N'); }
  { const ta=document.getElementById('ob-storage-terms');
    if(ta){ ta.value=(typeof o.storageTerms==='string'&&o.storageTerms.trim())?o.storageTerms:(typeof OB_STORAGE_DEFAULT!=='undefined'?OB_STORAGE_DEFAULT:''); } }
  if(typeof obStorageToggle==='function'){ const on=!!(document.getElementById('ob-storage')&&document.getElementById('ob-storage').checked); const ta=document.getElementById('ob-storage-terms'); if(ta) ta.style.display=on?'block':'none'; }
  /* 2026-08-28：純報價單勾選＋稅金顯示還原（沒存＝預設不勾／含稅顯示） */
  { const qo=document.getElementById('f-quoteonly'); if(qo) qo.checked=!!(o.quoteOnly&&o.quoteOnly!=='0'&&o.quoteOnly!=='N'); }
  { const td=document.getElementById('f-taxdisplay'); if(td) td.value=(o.taxDisplay==='excl')?'excl':''; }
  { const h=document.getElementById('taxdisp-hint'); if(h) h.textContent=''; }
  updateOrdProgVisibility();
}

function resetAll(skipConfirm){
  if(!skipConfirm && !confirm('確定清除這張報價單的內容？（只會清空目前這張新報價單，其他頁面不受影響）')) return;
  document.querySelectorAll('#page-new input:not([readonly]),#page-new textarea,#page-new select').forEach(el=>{
    if(el.type==='number'&&el.id==='f-ser') el.value='1';
    else if(el.id==='f-hdl') el.value='Molly';
    else if(el.type==='number'&&el.id==='dep-pct') el.value=defaultDepPct();
    else if(el.type==='number'&&el.id==='taxrate') el.value='5';
    else if(el.type==='number'&&el.id==='p2-mon') el.value='1';
    else if(el.id==='dep-days1') el.value='15';
    else if(el.id==='dep-days') el.value='7';
    else if(el.id==='dep-fdays') el.value='30';
    else if(el.id==='f-dt') el.value=todayStr();
    else if(el.tagName==='SELECT') el.value='';
    else if(!el.readOnly) el.value='';
  });
  botItems=[]; banFreeItems=[]; banAddonItems=[]; banG1Items=[]; banG2Items=[]; extras=[]; imgs=[]; rowId=0;
  { const h=document.getElementById('f-hidetotals'); if(h) h.checked=false; const e=document.getElementById('f-imgsize'); if(e) e.value='m'; } // 文件顯示設定回到預設
  // 2026-08-28：本單級距回標準、寄倉勾選取消（tier/條款輸入欄上面的迴圈已清空，這裡補回標準值與勾選狀態）
  { const st=document.getElementById('ob-storage'); if(st) st.checked=false; const ta=document.getElementById('ob-storage-terms'); if(ta) ta.style.display='none'; }
  { const qo=document.getElementById('f-quoteonly'); if(qo) qo.checked=false; const h=document.getElementById('taxdisp-hint'); if(h) h.textContent=''; } // 純報價勾選回預設（稅金顯示 select 由上方通用迴圈清回''＝含稅）
  if(typeof obFillTiers==='function') obFillTiers(null,true);
  botDedCache={}; botLogoCache={}; botLotCache={}; botGiftCache={};
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
  document.getElementById('ban-g1-body').innerHTML=''; document.getElementById('ban-g2-body').innerHTML='';
  // 宴會計價方式還原：杯計價（通用清空迴圈會把 select 設成空值，這裡補回預設）
  ['g1','g2'].forEach(g=>{ const u=document.getElementById(`ban-${g}-unit`); if(u) u.value='cup'; });
  document.getElementById('svc-detail-wrap').classList.remove('on');
  addBotRow();
  if(qType==='banquet'){ addBanFreeRow(); addBanAddonRow(); }
  setPay(0);   // 所有單型都回到 Tab0（比例訂金＋尾款）
  // 「清除」＝回到全新單：一定要斷開編輯中的舊單號，否則下一次儲存會用 updateQuote 把先前開啟的舊單整張蓋掉
  if(typeof editingQuoteNo!=='undefined') editingQuoteNo=null;
  calc(); onDate(); upNo();
  FORM_DIRTY=false;   // 清空後視為乾淨狀態，關頁/切單不再誤跳「未儲存」警告
  updateOrdProgVisibility();   // 清除＝回到全新單，「訂單追蹤進度」區塊要重新顯示出來
  runHooks('afterReset', skipConfirm);   // 清掉公司選擇／發票抬頭等登記在這（見 08_ownbrand.js 檔尾）
}

function getPayTerms(){
  if(LOADED_PAY_DETAIL!=null) return LOADED_PAY_DETAIL; // 載入舊單且未重新編輯付款 → 沿用已存文字（tab0/1/2 細節欄目前不會存下，重算會失真）
  const tot=document.getElementById('t-tot').textContent;
  if(payTab===0){
    const b=payBreakdown();
    const pct=b.pctNum;
    const dep=document.getElementById('dep-amt')?.textContent||'—';
    const bal=document.getElementById('dep-bal')?.textContent||'—';
    const d1=document.getElementById('dep-days1')?.value||'15';   // 製造前幾日內付訂金
    const vd=document.getElementById('dep-days')?.value||'7';     // 到貨後幾日內驗收
    const fd=document.getElementById('dep-fdays')?.value||'30';   // 驗收後幾日內付尾款
    /* 複檢 2026-08-06 #15：備註與費用名稱都是使用者輸入，條款字串會以 innerHTML 塞進
       預覽/列印，沒跳脫的話輸入「<」開頭的內容會被當標籤吃掉（或被注入）。這裡統一跳脫。
       條款自己的 <br> 是程式產生的、不受影響。 */
    const esc=s=>(typeof escHtml==='function')?escHtml(String(s==null?'':s)):String(s==null?'':s);
    const note=esc(document.getElementById('dep-ded')?.value);
    const money=n=>{const v=Math.round(n);return (v<0?'-$':'$')+Math.abs(v).toLocaleString();};   // 負數印 -$1,000 而非 $-1,000
    /* 條款格式依 Molly 2026-08-05 指定：訂金支付／驗收與尾款兩段，括號內逐項列出其他費用，
       其餘為「酒水總價 X% 之訂金」。括號裡的數字加總必等於括號外的訂金總額。 */
    const fees=b.posExShown.length ? `內含${b.posExShown.map(e=>`${esc(e.n)} ${money(e.a)}`).join('、')}，及` : '';
    if(b.clamped){
      /* 折抵超過尾款額度（複檢 #12）：尾款封頂 $0，改寫成「無須另付尾款」的版本，
         不能印出負數尾款，也不能再宣稱「X% 之訂金」（封頂後百分比已對不上） */
      const dedTxt=b.negExShown.length? b.negExShown.map(e=>`${esc(e.n)} ${money(e.a)}`).join('、') : '折抵項目';
      let tc=`訂金支付：甲方於乙方製造前 ${d1} 日內，支付訂金總計新台幣 ${dep} 元整（${fees}酒水款項 ${money(b.depWineShown)} 元整），作為乙方啟動生產之依據。`;
      tc+=`<br>驗收與尾款：乙方完成商品製作並全數交付後，甲方應於到貨後 ${vd} 日內完成驗收。驗收無誤後無須另付尾款（酒水總價剩餘款項已由${dedTxt}全數抵銷）。`;
      if(note) tc+=`<br>付款條件備註：${note}`;
      return tc;
    }
    let t=`訂金支付：甲方於乙方製造前 ${d1} 日內，支付訂金總計新台幣 ${dep} 元整（${fees}酒水總價 ${pct}% 之訂金 ${money(b.depWineShown)} 元整），作為乙方啟動生產之依據。`;
    t+=`<br>驗收與尾款：乙方完成商品製作並全數交付後，甲方應於到貨後 ${vd} 日內完成驗收。驗收無誤後，甲方應於 ${fd} 日內支付尾款新台幣 ${bal} 元整（即酒水總價剩餘之 ${100-pct}%`;
    if(b.negExShown.length) t+=`，減去${b.negExShown.map(e=>`${esc(e.n)} ${money(e.a)}`).join('、')}`;
    t+=`）。`;
    if(note) t+=`<br>付款條件備註：${note}`;
    return t;
  }
  if(payTab===1){
    const v=document.getElementById('p1-vdays')?.value||'7';
    const pct=document.getElementById('p1-pct')?.value||'100';
    const n=(typeof escHtml==='function')?escHtml(String(document.getElementById('p1-note')?.value||'')):(document.getElementById('p1-note')?.value||'');   // 複檢 #15
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
