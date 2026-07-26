/* ============================================================
   V2 前端：公司報價檔＋訂單追蹤＋工作行事曆＋自訂單備份＋修改紀錄
   （對應規格文件與對話B v2/v2.1 後端）
   ============================================================ */

/* ---- 共用狀態 ---- */
let COMPANY_DATA = null;          // {companies, products, rules}
let SELECTED_COMPANY = null;      // 標準模式選中的 company 物件
let SELECTED_COMPANY_C = null;    // 自訂模式選中的 company 物件
let RULE_SUPPRESS = {};           // 使用者刪掉的自動規則列（rule key -> true）
let ORDERS_CACHE = null;          // 合併後的訂單列表
let CAL_ITEMS = [];               // calendar_items
let CAL_VIEW = 'month';           // month | week | list
/* 勾選式篩選：類型（訂單日程/備忘/重複）與分類都可個別開關，預設全開 */
let CAL_KINDS = {order:true, memo:true, recur:true};
let CAL_CATS = {};                // {分類名:false}＝關閉；沒記錄＝開
let CAL_Y = new Date().getFullYear(), CAL_M = new Date().getMonth(); // 0-based
let ORD_FILTER = 'all';
/* 國定假日（資料來源：行政院人事行政總處「政府行政機關辦公日曆表」官方公告，經 ruyut/TaiwanCalendar 整理）
   ⚠ 政府每年約 11~12 月才會公告隔年行事曆，此表需每年手動補上新一年資料才會繼續顯示；
   舊的年份不用刪，保留著沒關係。要補資料時可到 https://github.com/ruyut/TaiwanCalendar/tree/master/data 抓當年 isHoliday=true 的項目。 */
const TAIWAN_HOLIDAYS = {
  '2025-01-01':'開國紀念日','2025-01-27':'小年夜','2025-01-28':'農曆除夕','2025-01-29':'春節','2025-01-30':'春節','2025-01-31':'春節',
  '2025-02-28':'和平紀念日','2025-04-03':'補假','2025-04-04':'兒童節及民族掃墓節','2025-05-30':'補假','2025-05-31':'端午節',
  '2025-09-28':'孔子誕辰紀念日','2025-09-29':'補假','2025-10-06':'中秋節','2025-10-10':'國慶日','2025-10-24':'補假',
  '2025-10-25':'臺灣光復節','2025-12-25':'行憲紀念日',
  '2026-01-01':'開國紀念日','2026-02-15':'小年夜','2026-02-16':'農曆除夕','2026-02-17':'春節','2026-02-18':'春節','2026-02-19':'春節',
  '2026-02-28':'和平紀念日','2026-04-04':'兒童節','2026-04-05':'清明節','2026-05-01':'勞動節','2026-06-19':'端午節',
  '2026-09-25':'中秋節','2026-09-28':'教師節','2026-10-10':'國慶日','2026-10-25':'臺灣光復節','2026-12-25':'行憲紀念日',
};
/* 農曆初二／十六（拜拜日，凱文南坡萬每月做牙習慣）：用瀏覽器內建 Intl 農曆換算，不是查表，任何年份都能自動算對，不用維護 */
function lunarDayOfMonth(ds){
  try{
    const d=new Date(ds+'T12:00:00');
    if(isNaN(d)) return null;
    const parts=new Intl.DateTimeFormat('zh-TW-u-ca-chinese',{month:'numeric',day:'numeric'}).formatToParts(d);
    const day=parseInt((parts.find(p=>p.type==='day')||{}).value);
    return isNaN(day)?null:day;
  }catch(e){ return null; }
}
function isWorshipDay(ds){ const d=lunarDayOfMonth(ds); return d===2||d===16; }
/* 行事曆分類配色（依「分類」自動上色，不用另外挑顏色） */
const CAL_CATEGORY_COLORS = {
  '工作': {bg:'#EAF0FF', fg:'#3457C7', bd:'#C7D6F5'},
  '會議': {bg:'#E7F3EA', fg:'#2F7A46', bd:'#C5E0CC'},
  '拜訪客戶': {bg:'#FBEFE4', fg:'#B25E1F', bd:'#EFD3B8'},
  '採購': {bg:'#F7EFDD', fg:'#8A6A2E', bd:'#E9D9B5'},
  '出貨物流': {bg:'#E4F2F2', fg:'#1F7A7A', bd:'#C2E0E0'},
  '收款提醒': {bg:'#F9ECEA', fg:'#B03A2E', bd:'#E8C7C2'},
  '私人': {bg:'#F1EAF9', fg:'#6B3FA0', bd:'#DDCBEF'},
  '其他': {bg:'#EDEDED', fg:'#5A5A5A', bd:'#D6D6D6'}
};
let _rulesBusy = false;


/* ============================================================
   一、公司報價檔（三模式快速帶入）
   ============================================================ */
async function loadCompanyData(force){
  if(COMPANY_DATA && !force) return COMPANY_DATA;
  const d = await readCall({ action:'getCompanyData', token:AUTH_TOKEN }, force);
  if(!d.ok) throw new Error(d.error||'載入公司報價檔失敗');
  COMPANY_DATA = { companies:d.companies||[], products:d.products||[], rules:d.rules||[] };
  populateCompanySelects();
  return COMPANY_DATA;
}
function companyLabel(c){
  const b=(c.brand||'').trim(), n=(c.name||'').trim();
  return b ? (n && n!==b ? `${b}（${n}）` : b) : n;
}
function populateCompanySelects(){
  if(!COMPANY_DATA) return;
  const opts = '<option value="">不指定（自由輸入）</option>' +
    COMPANY_DATA.companies.map(c=>`<option value="${escHtml(c.company_id)}">${escHtml(companyLabel(c))}</option>`).join('');
  const s1=document.getElementById('qf-company'); if(s1){ const v=s1.value; s1.innerHTML=opts; s1.value=v; }
  const s2=document.getElementById('qfc-company'); if(s2){ const v=s2.value; s2.innerHTML=opts; s2.value=v; }
}
function companyById(id){ return (COMPANY_DATA?.companies||[]).find(c=>String(c.company_id)===String(id))||null; }
function productsOf(cid){ return (COMPANY_DATA?.products||[]).filter(p=>String(p.company_id)===String(cid)); }
function rulesOf(cid){ return (COMPANY_DATA?.rules||[]).filter(r=>String(r.company_id)===String(cid)); }
function productLabel(p){
  const spec=(p.spec!=null&&p.spec!=='')?(String(p.spec).match(/^\d+$/)?p.spec+'ml':p.spec):'';
  const parts=[spec,(p.bottle_cap||'').trim()].filter(Boolean).join('·');
  return `${p.name}${parts?'（'+parts+'）':''}｜${money(p.unit_price)}${p.tier_json?'·級距':''}`;
}
/* 選品項時顯示 MOQ／交期／瓶型（僅自己看，不印在報價單）*/
function showProdInfo(selId, infoId){
  const s=document.getElementById(selId), el=document.getElementById(infoId);
  if(!el) return;
  const p=(COMPANY_DATA?.products||[]).find(x=>String(x.product_id)===String(s.value));
  if(!p){ el.innerHTML=''; return; }
  const bits=[];
  if((p.bottle_cap||'').toString().trim()) bits.push('瓶型瓶蓋：'+escHtml(String(p.bottle_cap)));
  if(p.moq) bits.push('MOQ '+p.moq+(/ml/i.test(String(p.moq))?'':' 瓶'));
  if((p.lead_time||'').toString().trim()) bits.push('作業交期 '+escHtml(String(p.lead_time)));
  if((p.note||'').toString().trim()) bits.push(escHtml(String(p.note)));
  el.innerHTML=bits.length?('ℹ️ '+bits.join('　·　')+'<span style="color:#A8A69C">（僅供參考，不會印在報價單上）</span>'):'';
}
/* MOQ 未達提醒（不擋單）*/
function updateMoqWarnings(){
  const el=document.getElementById('qf-moqwarn'); if(!el) return;
  if(qType!=='bottle'||!SELECTED_COMPANY){ el.innerHTML=''; return; }
  const warns=[];
  botItems.forEach(id=>{
    const row=document.getElementById(`r-${id}`); if(!row||!row.dataset.pid) return;
    const p=(COMPANY_DATA?.products||[]).find(x=>String(x.product_id)===String(row.dataset.pid));
    if(!p||!p.moq) return;
    const q=gv(row,'qty');
    const moqStr=String(p.moq);
    if(/ml/i.test(moqStr)){
      // ml 型 MOQ：以該品項 瓶數×容量 判定總容量
      const th=parseFloat(moqStr), vol=gv(row,'vol');
      const tot=q*vol;
      if(q>0 && vol>0 && tot<th) warns.push(`⚠ ${escHtml(p.name)} 未達 MOQ ${moqStr}（目前 ${q} 瓶 × ${vol}ml = ${tot.toLocaleString()}ml）— 提醒用，照樣可出單`);
    } else if(q>0 && q<parseFloat(moqStr)){
      warns.push(`⚠ ${escHtml(p.name)}${(p.bottle_cap||'').toString().trim()?('（'+escHtml(String(p.bottle_cap))+'）'):''} 未達 MOQ ${moqStr} 瓶（目前 ${q} 瓶）— 提醒用，照樣可出單`);
    }
  });
  el.innerHTML=warns.map(w=>`<div class="moq-warn">${w}</div>`).join('');
}
function fillProductSelect(selId, cid){
  const s=document.getElementById(selId); if(!s) return;
  const ps=productsOf(cid);
  s.innerHTML = ps.length
    ? '<option value="">選擇品項帶入…</option>'+ps.map(p=>`<option value="${escHtml(p.product_id)}">${escHtml(productLabel(p))}</option>`).join('')
    : '<option value="">此公司尚無品項（可直接自由輸入）</option>';
}

/* ---- 標準模式：選公司 ---- */
function onSelectCompany(){
  const cid=document.getElementById('qf-company').value;
  SELECTED_COMPANY = cid ? companyById(cid) : null;
  RULE_SUPPRESS = {};
  const box=document.getElementById('qf-detail');
  if(!SELECTED_COMPANY){ box.style.display='none'; clearAutoRuleExtras(); renderExt(); calc(); return; }
  const c=SELECTED_COMPANY;
  // 換公司時先清空「快速帶入」的欄位，避免上一家公司留下的舊值跟這家公司的新值混在一起
  // （例如上一家有填聯絡人、這家沒填，若不清空畫面會誤顯示上一家的聯絡人）
  ['f-tax','f-ph','f-ad','f-con','f-shipcon','f-shipph','f-shipad'].forEach(id=>{
    const e=document.getElementById(id); if(e) e.value='';
  });
  // 客戶資料帶入（brand → 客戶名稱；正式公司名 → 發票抬頭）— 全部可再手改
  const set=(id,v)=>{ const e=document.getElementById(id); if(e && v!=null && v!=='') e.value=v; };
  set('f-cli', (c.brand||'').trim()||c.name); if(typeof upNo==='function') upNo();
  set('f-inv', c.name);
  set('f-tax', c.tax_id); set('f-ph', c.phone); set('f-ad', c.address); set('f-con', c.contact);
  // 出貨資訊：公司檔若有存預設出貨收件人/電話/地址，帶入並自動視為「不同」；否則清空後維持與聯絡地址相同
  {
    const sc=document.getElementById('f-shipsame');
    if((c.ship_address||'').trim()||(c.ship_contact||'').trim()||(c.ship_phone||'').trim()){
      set('f-shipcon', c.ship_contact); set('f-shipph', c.ship_phone); set('f-shipad', c.ship_address);
      if(sc) sc.checked=false;
    } else if(sc){ sc.checked=true; }
    toggleShipSame('f');
  }
  if(c.default_tax_mode==='inc'||c.default_tax_mode==='exc') setTaxMode(c.default_tax_mode);
  if((c.default_pay_terms||'').trim()){ setPay(3); const t=document.getElementById('p3-txt'); if(t && !t.value.trim()) t.value=c.default_pay_terms; }
  // preset_note
  rulesOf(c.company_id).filter(r=>r.rule_type==='preset_note').forEach(r=>{
    const note=parseJsonSafe(r.params_json,{}).note||'';
    const f=document.getElementById('f-note');
    if(note && f && !f.value.trim()) f.value=note;
  });
  box.style.display='block';
  { const sb=document.getElementById('qf-syncbtn');
    if(sb){
      // 後端若已回傳 recipe_sheet_id：只有設定酒譜表的公司顯示同步鈕；欄位尚未回傳(undefined)時一律顯示，由後端回覆是否有酒譜
      const rid=c.recipe_sheet_id;
      const show=(rid===undefined)?true:!!(String(rid||'').trim());
      sb.style.display=show?'':'none';
    }
    const nb=document.getElementById('qf-syncnote'); if(nb) nb.innerHTML='';
  }
  fillProductSelect('qf-product', c.company_id);
  renderRuleChips();
  applyAutoRules(); renderExt(); calc();
  toast('已帶入 '+companyLabel(c)+' 的客戶資料與報價邏輯','ok');
}
/* 客戶酒譜同步：呼叫後端 syncCustomerProducts，更新該公司 products 的品名/容量/售價 */
async function syncCustomerRecipe(){
  if(!SELECTED_COMPANY){ toast('請先選擇公司','err'); return; }
  const cid=SELECTED_COMPANY.company_id;
  const btn=document.getElementById('qf-syncbtn');
  const note=document.getElementById('qf-syncnote');
  let _restore='';
  if(btn){ _restore=btn.innerHTML; btn.disabled=true; btn.innerHTML='<i class="ti ti-loader"></i> 同步中…'; }
  try{
    const d=await apiCall({ action:'syncCustomerProducts', token:AUTH_TOKEN, company_id:cid });
    if(d && d.ok===false) throw new Error(d.error||'同步失敗');
    const s=(d&&d.summary)||d||{};
    const added=s.added||0, updated=s.updated||0, un=Array.isArray(s.unmatched)?s.unmatched:[];
    toast(`酒譜同步完成：更新 ${updated} 筆、新增 ${added} 筆`+(un.length?`、${un.length} 筆待確認`:''),'ok');
    // 重新載入公司報價檔，讓最新售價可帶入
    try{ await loadCompanyData(true); SELECTED_COMPANY=companyById(cid)||SELECTED_COMPANY; }catch(e){}
    fillProductSelect('qf-product', cid);
    if(note){
      note.innerHTML = un.length
        ? `<div class="moq-warn">⚠ 有 ${un.length} 筆酒譜品項與系統既有品項對不上、未自動更新，請確認品名／容量：<br>`+
          un.map(u=>escHtml(typeof u==='string'?u:(u.name||u['品名']||u.reason||JSON.stringify(u)))).join('、')+`</div>`
        : `<span class="qf-chip ok">✓ 全部品項比對成功，無待確認項目</span>`;
    }
  }catch(e){
    toast(e.message||'酒譜同步失敗（此公司可能尚未設定酒譜表）','err');
    if(note) note.innerHTML=`<div class="moq-warn">⚠ ${escHtml(e.message||'同步失敗，請確認此公司是否已設定酒譜試算表')}</div>`;
  }finally{
    if(btn){ btn.disabled=false; btn.innerHTML=_restore||'<i class="ti ti-refresh"></i> 同步最新酒譜'; }
  }
}
function renderRuleChips(){
  const wrap=document.getElementById('qf-rules'); if(!wrap) return;
  if(!SELECTED_COMPANY){ wrap.innerHTML=''; return; }
  const rs=rulesOf(SELECTED_COMPANY.company_id);
  let h='';
  rs.forEach(r=>{
    const p=parseJsonSafe(r.params_json,{});
    if(r.rule_type==='free_ship_threshold'){
      h+=`<span class="qf-chip ok">✓ 滿 ${p.min_qty||0} 瓶免運（未達運費 ${money(p.ship_fee||0)}，金額可改）</span>`;
    } else if(r.rule_type==='label_deduct'){
      const amt = p.use_product_label_fee ? '' : (p.per_bottle||0);
      h+=`<label class="qf-chip toggle"><input type="checkbox" id="qf-ownlabel" onchange="applyRulesAndRefresh()"> 客戶自備酒標：每瓶扣 $<input type="number" id="qf-labelamt" value="${amt}" style="width:56px" oninput="applyRulesAndRefresh()">（可調）</label>`;
    } else if(r.rule_type==='qty_tier'){
      h+=`<span class="qf-chip info">數量級距價自動套用（單價仍可手改）</span>`;
    } else if(r.rule_type==='preset_note'){
      h+=`<span class="qf-chip info">已帶入預設備註</span>`;
    }
  });
  h+=`<span class="qf-chip act" onclick="RULE_SUPPRESS={};applyRulesAndRefresh()">↻ 重新套用規則</span>`;
  wrap.innerHTML=h;
}
function applyRulesAndRefresh(){ applyAutoRules(); renderExt(); calc(); }

/* ---- 標準模式：帶入品項 ---- */
function quickAddProduct(){
  const pid=document.getElementById('qf-product').value; if(!pid) return;
  const p=(COMPANY_DATA?.products||[]).find(x=>String(x.product_id)===String(pid)); if(!p) return;
  if(qType==='bottle'){
    const vol=String(p.spec||'').match(/^\d+$/)?parseFloat(p.spec):'';
    addBotRow({ name:p.name, vol:vol, price:p.unit_price, ded:(colDed&&p.label_fee!==''&&p.label_fee!=null)?p.label_fee:'', logo:(colLogo&&p.logo_fee!==''&&p.logo_fee!=null)?p.logo_fee:'', qty:'' });
    const id=rowId, row=document.getElementById(`r-${id}`);
    if(row){
      row.dataset.pid=p.product_id;
      const pi=row.querySelector('[data-f="price"]');
      pi.dataset.src=p.unit_price;
      pi.removeAttribute('oninput');   // 改由下行接手：先立「已手改」旗標再重算，級距價才不會蓋掉手改值
      pi.addEventListener('input',()=>{ pi.dataset.manual='1'; markHand(pi); calc(); });
    }
  } else {
    // 宴會模式 → 加到「加購項目」
    addBanAddonRow({ name:p.name+(p.spec?('（'+p.spec+(String(p.spec).match(/^\d+$/)?'ml':'')+'）'):''), unit:p.unit||'式', price:p.unit_price, qty:1 });
  }
  calc();
}
function markHand(input){
  const src=parseFloat(input.dataset.src);
  if(!isNaN(src) && parseFloat(input.value)!==src){ input.classList.add('hand-edit'); input.title='已手改（價目預設 '+money(src)+'，只影響這張單）'; }
  else { input.classList.remove('hand-edit'); input.title=''; }
}

/* ---- 規則引擎（瓶裝模式的 extras 自動列）---- */
function totalBottleQty(){
  let q=0;
  botItems.forEach(id=>{ const r=document.getElementById(`r-${id}`); if(r) q+=gv(r,'qty'); });
  return q;
}
function clearAutoRuleExtras(){ extras=extras.filter(e=>!e.auto); }
function applyAutoRules(){
  if(qType!=='bottle') return false;
  let changed=false;
  const want=[]; // 期望存在的自動列
  if(SELECTED_COMPANY){
    const rs=rulesOf(SELECTED_COMPANY.company_id);
    const qty=totalBottleQty();
    rs.forEach(r=>{
      const p=parseJsonSafe(r.params_json,{});
      if(r.rule_type==='free_ship_threshold' && !RULE_SUPPRESS['ship']){
        if(qty>=(p.min_qty||0) && qty>0) want.push({auto:'ship', n:(r.display_text||'整批出貨免運'), a:0});
        else if(qty>0) want.push({auto:'ship', n:'運費（未達 '+(p.min_qty||0)+' 瓶免運門檻）', a:p.ship_fee||0});
      }
      if(r.rule_type==='label_deduct' && !RULE_SUPPRESS['label']){
        const on=document.getElementById('qf-ownlabel')?.checked;
        if(on && qty>0){
          let per=parseFloat(document.getElementById('qf-labelamt')?.value);
          if(isNaN(per)) per=p.per_bottle||0;
          want.push({auto:'label', n:`客戶自備酒標 — 每瓶扣酒標費 $${per} × ${qty}瓶`, a:-(per*qty)});
        }
      }
    });
  }
  // 同步 extras 中的 auto 列（使用者手動改過金額的 locked 列不動）
  ['ship','label'].forEach(k=>{
    const cur=extras.find(e=>e.auto===k);
    const w=want.find(e=>e.auto===k);
    if(w && !cur){ extras.push({id:++rowId, n:w.n, a:w.a, auto:k}); changed=true; }
    else if(!w && cur && !cur.locked){ extras=extras.filter(e=>e!==cur); changed=true; }
    else if(w && cur && !cur.locked && (cur.n!==w.n || cur.a!==w.a)){ cur.n=w.n; cur.a=w.a; changed=true; }
  });
  // 級距價：帶入的品項依瓶數自動換級距（手改過的不動）
  botItems.forEach(id=>{
    const row=document.getElementById(`r-${id}`); if(!row||!row.dataset.pid) return;
    const prod=(COMPANY_DATA?.products||[]).find(x=>String(x.product_id)===String(row.dataset.pid)); if(!prod||!prod.tier_json) return;
    const pi=row.querySelector('[data-f="price"]'); if(!pi||pi.dataset.manual==='1') return;
    const q=gv(row,'qty'); if(!q) return;
    const tiers=parseJsonSafe(prod.tier_json,[]);
    const t=tiers.find(t=> q>=(t.min||0) && (t.max==null || q<=t.max));
    if(t && parseFloat(pi.value)!==t.price){ pi.value=t.price; pi.dataset.src=t.price; changed=true; }
  });
  return changed;
}

/* ---- 自訂模式：選公司＋帶入 ---- */
function onSelectCompanyCustom(){
  const cid=document.getElementById('qfc-company').value;
  SELECTED_COMPANY_C = cid ? companyById(cid) : null;
  const row=document.getElementById('qfc-row');
  if(!SELECTED_COMPANY_C){ row.style.display='none'; return; }
  const c=SELECTED_COMPANY_C;
  // 換公司時先清空「快速帶入」的欄位，避免上一家公司留下的舊值跟這家公司的新值混在一起
  ['c-tax','c-ph','c-ad','c-con','c-shipcon','c-shipph','c-shipad'].forEach(id=>{
    const e=document.getElementById(id); if(e) e.value='';
  });
  const set=(id,v)=>{ const e=document.getElementById(id); if(e && v!=null && v!=='') e.value=v; };
  set('c-cli',(c.brand||'').trim()||c.name); set('c-con',c.contact);
  set('c-inv', c.name); set('c-tax', c.tax_id); set('c-ph', c.phone); set('c-ad', c.address);
  {
    const sc=document.getElementById('c-shipsame');
    if((c.ship_address||'').trim()||(c.ship_contact||'').trim()||(c.ship_phone||'').trim()){
      set('c-shipcon', c.ship_contact); set('c-shipph', c.ship_phone); set('c-shipad', c.ship_address);
      if(sc) sc.checked=false;
    } else if(sc){ sc.checked=true; }
    toggleShipSame('c');
  }
  if(c.default_tax_mode==='inc'||c.default_tax_mode==='exc') document.getElementById('c-taxmode').value=c.default_tax_mode;
  row.style.display='block';
  fillProductSelect('qfc-product', c.company_id);
  calcCustom();
  toast('已帶入 '+companyLabel(c)+' 的客戶資料','ok');
}
function quickAddProductCustom(){
  const pid=document.getElementById('qfc-product').value; if(!pid) return;
  const p=(COMPANY_DATA?.products||[]).find(x=>String(x.product_id)===String(pid)); if(!p) return;
  const spec=p.spec?('（'+p.spec+(String(p.spec).match(/^\d+$/)?'ml':'')+'）'):'';
  addCustomRow({ name:p.name+spec, qty:1, unit:p.unit||'', price:p.unit_price, note:p.note||'' });
}


/* 寫入類動作清掉讀取快取時，公司報價檔也一併歸零（下次要用會自己重抓） */
onCacheClear(function(){ COMPANY_DATA=null; });
