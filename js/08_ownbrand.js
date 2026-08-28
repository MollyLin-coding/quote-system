/* ============================================================
   v3.0 自有品牌公版酒（A. 通路買斷報價模式）
   ============================================================ */
let OWNBRAND_PRODUCTS=null, OWNBRAND_TIERS=null, CONSIGN_TERMS=null;

async function loadOwnbrandData(force){
  if(OWNBRAND_PRODUCTS && OWNBRAND_TIERS && !force) return;
  if(!AUTH_TOKEN) throw new Error('尚未登入');
  const [p,t]=await Promise.all([
    readCall({action:'getOwnbrandProducts', token:AUTH_TOKEN}, force),
    readCall({action:'getOwnbrandTiers', token:AUTH_TOKEN}, force)
  ]);
  if(!p.ok) throw new Error(p.error||'載入公版酒失敗');
  OWNBRAND_PRODUCTS=(p.products||[]).filter(x=>String(x.active||'Y').toUpperCase()!=='N');
  if(t.ok){ OWNBRAND_TIERS=t.tiers||[]; CONSIGN_TERMS=t.terms||{}; }
  else { OWNBRAND_TIERS=OWNBRAND_TIERS||[]; CONSIGN_TERMS=CONSIGN_TERMS||{}; }
}
function ownbrandProductLabel(p){
  return `${p.name}（${p.volume}）｜建議零售 ${money(p.list_price)}`;
}
function buyoutTiers(){
  return (OWNBRAND_TIERS||[]).filter(t=>String(t.channel)==='buyout')
    .map(t=>({min:parseFloat(t.min_qty)||0, disc:parseFloat(t.discount)||1}))
    .sort((a,b)=>a.min-b.min);
}
/* ============================================================
   2026-08-28：一次性採購 量價級距（MOQ）每張單可調
   ・ob-tieredit 三組「門檻＋折數」欄位，預設帶後端標準級距（getOwnbrandTiers channel=buyout）
   ・改了只影響這張單：自動套折改讀本單級距；存檔存進 docopts 特殊列（moqTiers），重開單還原
   ・欄位清空＝該組不用；全部清空＝退回後端標準級距
   ============================================================ */
/* 讀本單級距編輯欄（回 {min,disc(0-1)} 陣列，依門檻小到大；沒有任何有效組就回 null → 用後端標準） */
function obCurrentTiers(){
  const out=[];
  for(let i=1;i<=3;i++){
    const mEl=document.getElementById('ob-t'+i+'-min'), dEl=document.getElementById('ob-t'+i+'-disc');
    if(!mEl||!dEl) return null;
    const m=parseFloat(mEl.value), d=parseFloat(dEl.value);
    if(m>0 && d>0 && d<=10) out.push({min:m, disc:d/10});
  }
  return out.length ? out.sort((a,b)=>a.min-b.min) : null;
}
/* 本單級距是否跟後端標準一樣（一樣就不用多存進單子） */
function obTiersAreDefault(){
  const cur=obCurrentTiers(), std=buyoutTiers().filter(t=>t.min>0);
  if(!cur) return true;
  if(!std.length) return false;
  if(cur.length!==std.length) return false;
  return cur.every((t,i)=>t.min===std[i].min && Math.abs(t.disc-std[i].disc)<1e-9);
}
/* 把級距填進編輯欄：tiers 用 {min,disc(0-1)} 陣列；不給 tiers＝填後端標準；force=false 時只在全空白才填 */
function obFillTiers(tiers, force){
  const mEl1=document.getElementById('ob-t1-min'); if(!mEl1) return;
  if(!force){
    let any=false;
    for(let i=1;i<=3;i++){ const e=document.getElementById('ob-t'+i+'-min'); if(e&&e.value!=='') any=true; }
    if(any) return;   // 已有內容（載入舊單還原的自訂級距）就不要蓋掉
  }
  const ts=(tiers||buyoutTiers().filter(t=>t.min>0)).slice(0,3);
  for(let i=1;i<=3;i++){
    const m=document.getElementById('ob-t'+i+'-min'), d=document.getElementById('ob-t'+i+'-disc');
    if(!m||!d) return;
    if(ts[i-1]){ m.value=ts[i-1].min; d.value=+(ts[i-1].disc*10).toFixed(2); }
    else { m.value=''; d.value=''; }
  }
}
/* 級距欄被改：未手改折數的列即時重套、更新未達門檻提醒 */
function obTierEdited(){
  FORM_DIRTY=true;
  const auto=document.getElementById('ob-autotier');
  if(auto && auto.checked) botItems.forEach(id=>autoDiscForRow(id,false));
  calc();
}
/* 還原標準級距（後端 buyout tiers），並重套所有列 */
function obResetTiers(){
  obFillTiers(null,true); FORM_DIRTY=true;
  applyOwnbrandTiers(); calc();
  toast('已還原標準級距','ok');
}
/* 依「每款瓶數」回傳折率；未達最低級距回傳 1（建議零售）。
   2026-08-28 起：一次性採購先看本單級距編輯欄，沒有自訂才用後端標準。 */
function buyoutDiscountForQty(qty){
  const ts=((typeof qType!=='undefined'&&qType==='ownbrand')?obCurrentTiers():null)||buyoutTiers();
  let d=1;
  ts.forEach(t=>{ if(qty>=t.min && t.min>0) d=t.disc; });
  return d;
}
/* ---- 開放客戶寄倉（一次性採購限定）：勾選＋條款文字，印在報價單上、存 docopts ---- */
const OB_STORAGE_DEFAULT='本單酒品可寄放乙方倉庫並分批提領，提領請於出貨前 3 個工作天通知安排；寄倉期間酒品由乙方妥善保管。';
function obStorageToggle(){
  FORM_DIRTY=true;
  const on=!!(document.getElementById('ob-storage')&&document.getElementById('ob-storage').checked);
  const ta=document.getElementById('ob-storage-terms');
  if(ta){ ta.style.display=on?'block':'none'; if(on && !ta.value.trim()) ta.value=OB_STORAGE_DEFAULT; }
}
/* 公版酒客製標 折率：預設公版原價（×1）；某款達 300 瓶↑自動 6 折（可手改） */
function labelDiscountForQty(qty){ return qty>=300 ? 0.6 : 1; }
async function loadOwnbrandProducts(){
  try{ await loadOwnbrandData(); }catch(e){ toast(e.message||'載入公版酒失敗','err'); return; }
  const sel=document.getElementById('ob-product'); if(!sel) return;
  sel.innerHTML=(OWNBRAND_PRODUCTS&&OWNBRAND_PRODUCTS.length)
    ? '<option value="">選擇公版酒帶入…</option>'+OWNBRAND_PRODUCTS.map(p=>`<option value="${escHtml(p.sku_id)}">${escHtml(ownbrandProductLabel(p))}</option>`).join('')
    : '<option value="">尚無公版酒資料（可先在後台同步）</option>';
  const info=document.getElementById('ob-tierinfo');
  if(info){
    const ts=buyoutTiers();
    /* 2026-08-28：一次性採購改用下方「本單可調」級距編輯欄，靜態說明行只留給客製標模式 */
    info.innerHTML=(qType!=='ownbrand' && ts.length)
      ? 'ℹ️ 量價級距（每款瓶數）：'+ts.filter(t=>t.min>0).map(t=>`${t.min}瓶↑ ${(t.disc*10)}折`).join('　·　')+'　·　未達最低量為建議零售價；皆免運'
      : '';
  }
  if(qType==='ownbrand') obFillTiers(null,false);   // 編輯欄還空著才帶標準級距（載入舊單的自訂值不會被蓋）
}
function ownbrandBySku(sku){ return (OWNBRAND_PRODUCTS||[]).find(p=>String(p.sku_id)===String(sku))||null; }

/* 帶入一支公版酒（沿用瓶裝品項列，額外記 data-listprice / data-sku 供套折用）*/
function quickAddOwnbrand(){
  const sku=document.getElementById('ob-product').value; if(!sku){ toast('請先選擇公版酒','err'); return; }
  const p=ownbrandBySku(sku); if(!p) return;
  const vol=String(p.volume||'').replace(/[^\d]/g,'');
  addBotRow({ name:p.name, vol:vol, price:p.list_price, qty:'', sku:p.sku_id, listprice:p.list_price });
  toast('已帶入 '+p.name+'（'+p.volume+'）','ok');
  calc();
}
/* 計價單價＝原價×折（折欄以「折」為單位：6＝6折；留空＝原價）——回填 readonly 計價欄並更新總額 */
function recalcOwnRow(id){
  const row=document.getElementById(`r-${id}`); if(!row) return;
  const lpEl=row.querySelector('[data-f="lp"]'),diEl=row.querySelector('[data-f="disc"]'),pEl=row.querySelector('[data-f="price"]');
  if(!lpEl||!diEl||!pEl) return;
  const lp=parseFloat(lpEl.value)||0;
  let dv=diEl.value.trim();
  /* 複檢 2026-08-13 #3-13：折欄以「折」為單位（6＝6折），原本沒有上下限——想打 6 折打成 60，
     計價就變成原價×6，而計價欄是 readonly 只顯示結果，金額不誇張時很容易漏看。 */
  if(dv!==''){
    const dnum=parseFloat(dv);
    if(!(dnum>0 && dnum<=10)){
      toast('折數要填 0～10（6 折就填 6，原價請留空）','err');
      diEl.value=''; dv='';
    }
  }
  const f = dv==='' ? 1 : ((parseFloat(dv)||0)/10);
  pEl.value = lp>0 ? Math.round(lp*f) : '';
  calc();
}
/* 折數欄手動輸入：標記為手改，之後瓶數變動不再自動覆寫 */
function onDiscInput(id){
  const row=document.getElementById(`r-${id}`); const di=row&&row.querySelector('[data-f="disc"]');
  if(di) di.dataset.manual='1';
  recalcOwnRow(id);
}
/* 原價欄輸入：重算計價 */
function onLpInput(id){ recalcOwnRow(id); }
/* 依「每款瓶數」自動填折數欄（autotier 開啟且該列折數未手改時；force＝按「重新套用」強制覆寫）*/
function autoDiscForRow(id, force){
  const auto=document.getElementById('ob-autotier');
  const row=document.getElementById(`r-${id}`); if(!row) return;
  const di=row.querySelector('[data-f="disc"]'); if(!di){ calc(); return; }
  if(!force && (!auto || !auto.checked)){ recalcOwnRow(id); return; }
  if(!force && di.dataset.manual==='1'){ recalcOwnRow(id); return; }
  const q=gv(row,'qty');
  const d01=q>0?(qType==='ownlabel'?labelDiscountForQty(q):buyoutDiscountForQty(q)):1;
  di.value = d01>=1 ? '' : +(d01*10).toFixed(2);   // ×1（原價）→ 折欄留空；否則填折數（6/5.5/5）
  if(force) delete di.dataset.manual;
  recalcOwnRow(id);
}
/* 相容舊呼叫：等同自動填折數 */
function applyOwnbrandTierForRow(id, force){ autoDiscForRow(id, force); }
/* 全部公版列重新套折（切換 autotier 或按「重新套用」時，強制依瓶數覆寫折數）*/
function applyOwnbrandTiers(){
  const auto=document.getElementById('ob-autotier');
  if(!auto || !auto.checked) return;
  botItems.forEach(id=>autoDiscForRow(id, true));
  calc();
}

/* ============================================================
   v3.0 自有品牌公版酒（B. 合作寄售管理）
   ============================================================ */
let CS_CUSTOMERS=[], CS_DISCOUNTS=[], CS_CUR='', CS_INV=[], CS_MONTHLY=null;
const CS_TYPE_LABEL={in:'鋪貨/補貨',out:'銷售',return:'退貨',adjust:'盤點調整'};
/* 2026-08-21 Molly：寄售不再走保證金制。保證金餘額／在池瓶數／退保證金異動全部從畫面移除，
   舊的 deposit_refund 明細也一併過濾不顯示（後端資料原封保留，沒有刪除任何東西）。 */

async function initConsignPage(force){
  // 公版酒資料與寄售客戶同時要（以前是一個等一個，等於兩倍時間）
  await Promise.all([
    loadOwnbrandData(force).catch(()=>{}),
    loadConsignCustomers(force),
    (typeof loadStorage==='function'?loadStorage(force).catch(()=>{}):Promise.resolve())   // 2026-08-28：客戶寄倉卡片
  ]);
}
async function loadConsignCustomers(force){
  const sel=document.getElementById('cs-customer'); if(!sel) return;
  try{
    const d=await readCall({action:'getConsignCustomers', token:AUTH_TOKEN}, force);
    if(!d.ok) throw new Error(d.error||'載入寄售客戶失敗');
    CS_CUSTOMERS=d.customers||[]; CS_DISCOUNTS=d.discounts||[];
  }catch(e){ toast(e.message||'載入寄售客戶失敗','err'); return; }
  const cur=sel.value;
  sel.innerHTML='<option value="">請選擇寄售客戶…</option>'+
    CS_CUSTOMERS.map(c=>`<option value="${escHtml(c.customer_id)}">${escHtml(c.name||c.customer_id)}${String(c.active||'Y').toUpperCase()==='N'?'（已停用）':''}</option>`).join('');
  if(cur) sel.value=cur;
}
function curConsignCustomer(){ return CS_CUSTOMERS.find(c=>String(c.customer_id)===String(CS_CUR))||null; }
function csDiscountFor(sku){
  const ex=CS_DISCOUNTS.find(d=>String(d.customer_id)===String(CS_CUR)&&String(d.sku_id)===String(sku));
  if(ex) return parseFloat(ex.discount)||1;
  const c=curConsignCustomer(); return c?(parseFloat(c.default_discount)||1):1;
}
function onSelectConsignCustomer(){
  CS_CUR=document.getElementById('cs-customer').value;
  const box=document.getElementById('cs-detail');
  const eb=document.getElementById('cs-editbtn');
  const info=document.getElementById('cs-cusinfo');
  if(!CS_CUR){ box.style.display='none'; eb.style.display='none'; if(info) info.innerHTML=''; return; }
  eb.style.display='';
  const c=curConsignCustomer();
  if(info&&c){
    const disc=(parseFloat(c.default_discount)||0);
    info.innerHTML='ℹ️ 預設折數 '+(disc?((disc*10).toFixed(disc*10%1?1:0)+'折'):'—')+'　·　每月請款日 '+(c.billing_day||'—')+'　·　'+(String(c.active||'Y').toUpperCase()==='N'?'已停用':'啟用中');
  }
  box.style.display='block';
  if(!document.getElementById('cs-month').value){ const n=new Date(); document.getElementById('cs-month').value=n.getFullYear()+'-'+s2(n.getMonth()+1); }
  csClearMonthly();   // 換客戶＝上一個客戶的月結作廢，避免匯出/轉單用到別人的資料
  loadConsignInventory(); loadConsignLedger();
}
/* 月結暫存作廢（換客戶／換月份時呼叫；匯出與轉報價單前也會再比對一次） */
function csClearMonthly(){
  CS_MONTHLY=null;
  const w=document.getElementById('cs-monthly'); if(w) w.innerHTML='';
}
/* 匯出/轉報價單前的保險：月結資料必須是「目前這個客戶＋目前選的月份」產的 */
function csMonthlyStale(){
  const ym=document.getElementById('cs-month').value;
  return !CS_MONTHLY || String(CS_MONTHLY.for_customer)!==String(CS_CUR) || CS_MONTHLY.for_ym!==ym;
}
async function loadConsignInventory(){
  const body=document.getElementById('cs-inv-body');
  // 一次抓「全部客戶」的庫存進 90 秒讀取快取（前端本來就有按客戶過濾）：
  // 切換客戶不再重打後端（原本每切一次 2.5 秒起跳）；登記異動後快取自動清掉會重抓。
  const payload={action:'getConsignInventory', token:AUTH_TOKEN};
  if(!rcPeek(payload)) body.innerHTML=sklTableRows(3,4);
  try{
    const d=await readCall(payload);
    if(!d.ok) throw new Error(d.error||'載入庫存失敗');
    CS_INV=(d.inventory||[]).filter(r=>!r.customer_id||String(r.customer_id)===String(CS_CUR));
    const totStock=CS_INV.reduce((s,r)=>s+(parseFloat(r.balance)||0),0);
    document.getElementById('cs-totstock').textContent=totStock.toLocaleString()+' 瓶';
    if(!CS_INV.length){ body.innerHTML='<tr><td colspan="3" class="rec-empty">尚無庫存資料（先登記鋪貨）</td></tr>'; return; }
    body.innerHTML=CS_INV.map(r=>{
      const p=ownbrandBySku(r.sku_id);
      const nm=r.name||(p?p.name:r.sku_id);
      const vol=r.volume||(p?p.volume:'');
      return `<tr><td class="mc-main">${escHtml(nm)}</td><td data-l="容量" style="text-align:center">${escHtml(vol)}</td>
        <td data-l="實體庫存" style="text-align:right;font-weight:600">${(parseFloat(r.balance)||0).toLocaleString()}</td></tr>`;
    }).join('');
  }catch(e){ body.innerHTML=`<tr><td colspan="3" class="rec-empty">${escHtml(e.message||'載入失敗')}</td></tr>`; }
}
async function loadConsignLedger(){
  const body=document.getElementById('cs-ledger-body');
  const payload={action:'getConsignLedger', token:AUTH_TOKEN};   // 同庫存：抓全部進快取，切客戶 0 秒
  if(!rcPeek(payload)) body.innerHTML=sklTableRows(6,4);
  try{
    const d=await readCall(payload);
    if(!d.ok) throw new Error(d.error||'載入明細失敗');
    // 2026-08-21：保證金制取消，舊的「退保證金」異動一併不顯示（資料仍在後端）
    let rows=(d.rows||[]).filter(r=>(!r.customer_id||String(r.customer_id)===String(CS_CUR)) && String(r.type||'')!=='deposit_refund');
    rows.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
    if(!rows.length){ body.innerHTML='<tr><td colspan="6" class="rec-empty">尚無異動明細</td></tr>'; return; }
    body.innerHTML=rows.map(r=>{
      const p=ownbrandBySku(r.sku_id);
      const nm=p?`${p.name}（${p.volume}）`:r.sku_id;
      const up=(r.unit_price!=null&&r.unit_price!=='')?money(r.unit_price):'—';
      return `<tr><td class="mc-main">${escHtml(r.date||'')}</td><td data-l="類型">${escHtml(CS_TYPE_LABEL[r.type]||r.type||'')}</td>
        <td data-l="公版酒">${escHtml(nm)}</td><td data-l="數量" style="text-align:right">${(parseFloat(r.qty)||0).toLocaleString()}</td>
        <td data-l="折後單價" style="text-align:right">${up}</td><td data-l="備註">${escHtml(r.note||'')}</td></tr>`;
    }).join('');
  }catch(e){ body.innerHTML=`<tr><td colspan="6" class="rec-empty">${escHtml(e.message||'載入失敗')}</td></tr>`; }
}
function populateConsignSkuSelect(selId){
  const s=document.getElementById(selId); if(!s) return;
  const ps=OWNBRAND_PRODUCTS||[];
  if(!ps.length){
    // 任何寫入動作（存客戶/存單…）都會清讀取快取，把公版酒清單一起洗掉；
    // 這裡自動補載，否則存完客戶馬上開「登記異動」會看到空下拉（預跑抓到的 BUG）
    s.innerHTML='<option value="">公版酒載入中…</option>';
    loadOwnbrandData().then(()=>{
      const ps2=OWNBRAND_PRODUCTS||[];
      s.innerHTML=ps2.length?ps2.map(p=>`<option value="${escHtml(p.sku_id)}">${escHtml(p.name+'（'+p.volume+'）')}</option>`).join(''):'<option value="">尚無公版酒（先在後台同步）</option>';
    }).catch(()=>{ s.innerHTML='<option value="">尚無公版酒（先在後台同步）</option>'; });
    return;
  }
  s.innerHTML=ps.map(p=>`<option value="${escHtml(p.sku_id)}">${escHtml(p.name+'（'+p.volume+'）')}</option>`).join('');
}

/* ---- 客戶新增/編輯 ---- */
function openConsignCustomerEdit(id){
  const g=x=>document.getElementById(x);
  const editing=!!id;
  g('cs-cus-title').textContent=editing?'編輯寄售客戶':'新增寄售客戶';
  const c=editing?CS_CUSTOMERS.find(x=>String(x.customer_id)===String(id)):null;
  g('cs-f-id').value=editing?id:''; g('cs-f-id').readOnly=editing;
  g('cs-f-name').value=c?.name||'';
  g('cs-f-disc').value=c?(c.default_discount||''):'0.75';
  g('cs-f-bill').value=c?.billing_day||'';
  g('cs-f-contact').value=c?.contact||'';
  g('cs-f-phone').value=c?.phone||'';
  g('cs-f-addr').value=c?.ship_address||'';
  g('cs-f-note').value=c?.note||'';
  g('cs-f-active').value=String(c?.active||'Y').toUpperCase()==='N'?'N':'Y';
  // 例外折：僅在編輯既有客戶時顯示（需 customer_id）
  const w=g('cs-exc-wrap');
  if(editing){ w.style.display='block'; populateConsignSkuSelect('cs-exc-sku'); renderConsignExceptions(id); }
  else { w.style.display='none'; }
  g('cs-cus-overlay').style.display='flex';
}
function closeConsignCustomerEdit(){ document.getElementById('cs-cus-overlay').style.display='none'; }
function renderConsignExceptions(id){
  const el=document.getElementById('cs-exc-list');
  const list=CS_DISCOUNTS.filter(d=>String(d.customer_id)===String(id));
  if(!list.length){ el.innerHTML='<div style="font-size:12px;color:var(--hint)">目前沒有例外，未列出的品項一律用預設折。</div>'; return; }
  el.innerHTML=list.map(d=>{
    const p=ownbrandBySku(d.sku_id); const nm=p?`${p.name}（${p.volume}）`:d.sku_id;
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #EEEDE6;font-size:12.5px">
      <span>${escHtml(nm)}　→　${(parseFloat(d.discount)*10)}折</span>
      <button class="del" onclick="delConsignException('${escHtml(d.sku_id)}')">✕</button></div>`;
  }).join('');
}
async function addConsignException(){
  const id=document.getElementById('cs-f-id').value.trim();
  if(!id){ toast('請先儲存客戶，再設定例外折','err'); return; }
  const sku=document.getElementById('cs-exc-sku').value;
  const disc=parseFloat(document.getElementById('cs-exc-disc').value);
  if(!sku||!(disc>0&&disc<=1)){ toast('請選公版酒並填 0–1 的折數','err'); return; }
  try{
    const d=await apiCall({action:'saveConsignDiscount', token:AUTH_TOKEN, customer_id:id, sku_id:sku, discount:disc});
    if(!d.ok) throw new Error(d.error||'儲存失敗');
    await loadConsignCustomers(true);
    renderConsignExceptions(id);
    document.getElementById('cs-exc-disc').value='';
    toast('已加入例外折','ok');
    if(String(CS_CUR)===String(id)) loadConsignInventory();
  }catch(e){ toast(e.message||'儲存失敗','err'); }
}
async function delConsignException(sku){
  const id=document.getElementById('cs-f-id').value.trim(); if(!id) return;
  try{
    const d=await apiCall({action:'deleteConsignDiscount', token:AUTH_TOKEN, customer_id:id, sku_id:sku});
    if(!d.ok) throw new Error(d.error||'刪除失敗');
    await loadConsignCustomers(true); renderConsignExceptions(id); toast('已移除例外','ok');
  }catch(e){ toast(e.message||'刪除失敗','err'); }
}
let _csSaving=false;
async function saveConsignCustomerForm(){
  if(_csSaving) return; _csSaving=true;
  const g=x=>document.getElementById(x).value.trim();
  const id=g('cs-f-id'), name=g('cs-f-name');
  if(!id){ toast('請填客戶代碼','err'); _csSaving=false; return; }
  if(!name){ toast('請填客戶名稱','err'); _csSaving=false; return; }
  // 新增模式：代碼撞到既有客戶會整筆覆蓋對方（後端是 upsert），這裡先擋下來
  const editing=document.getElementById('cs-f-id').readOnly;
  if(!editing && CS_CUSTOMERS.some(c=>String(c.customer_id)===String(id))){
    toast('客戶代碼「'+id+'」已存在，換一個代碼；要改既有客戶請用「客戶設定」','err'); _csSaving=false; return;
  }
  /* 複檢 2026-08-13 #3-9：折數欄按習慣打「8」或「7.5」（想表達 8 折）會被靜默改成 0.75，
     之後每一筆銷售都用 0.75 自動鎖價，月結長期錯誤而且不可追溯。改成明確擋下來。 */
  const discRaw=String(g('cs-f-disc')).trim();
  const disc=parseFloat(discRaw);
  if(discRaw!=='' && !(disc>0 && disc<=1)){
    toast('預設折數要填 0～1 之間的小數（8 折請填 0.8、7.5 折請填 0.75），不是填 8 或 7.5','err');
    _csSaving=false; return;
  }
  const customer={ customer_id:id, name, default_discount:(disc>0&&disc<=1)?disc:0.75,
    billing_day:g('cs-f-bill'), contact:g('cs-f-contact'), phone:g('cs-f-phone'),
    ship_address:g('cs-f-addr'), note:g('cs-f-note'), active:document.getElementById('cs-f-active').value,
    /* 保證金欄位已從畫面移除（2026-08-21）。這裡照抄客戶原本的值送回去，避免存檔時
       把舊資料的 deposit_required 洗掉；新客戶不帶這欄，交給後端維持空白。 */
    ...(function(){ const old=CS_CUSTOMERS.find(x=>String(x.customer_id)===String(id));
      return (old && old.deposit_required!=null && old.deposit_required!=='') ? {deposit_required:old.deposit_required} : {}; })() };
  try{
    const d=await apiCall({action:'saveConsignCustomer', token:AUTH_TOKEN, customer, ...customer});
    if(!d.ok) throw new Error(d.error||'儲存失敗');
    toast('已儲存客戶','ok');
    await loadConsignCustomers(true);
    document.getElementById('cs-customer').value=id; CS_CUR=id;
    closeConsignCustomerEdit(); onSelectConsignCustomer();
  }catch(e){ toast(e.message||'儲存失敗','err'); }
  finally{ _csSaving=false; }
}

/* ---- 登記異動 ---- */
let CS_MOVE_ROWID=0;
let csMoveItems=[];   // [{id, sku, qty}]　鋪貨/補貨（type=in）用的多列狀態
function openConsignMove(){
  if(!CS_CUR){ toast('請先選擇客戶','err'); return; }
  populateConsignSkuSelect('cs-m-sku');
  document.getElementById('cs-m-type').value='in';
  const n=new Date(); document.getElementById('cs-m-date').value=n.getFullYear()+'-'+s2(n.getMonth()+1)+'-'+s2(n.getDate());
  document.getElementById('cs-m-qty').value='';
  document.getElementById('cs-m-price').value='';
  document.getElementById('cs-m-note').value='';
  { const e=document.getElementById('cs-m-handler'); if(e) e.value=''; }
  { const e=document.getElementById('cs-m-genvf'); if(e){ e.checked=true; e.disabled=false; } }
  { const h=document.getElementById('cs-m-genvf-hint'); if(h) h.style.display='none'; }
  CS_MOVE_ROWID=0; csMoveItems=[]; csAddMoveRow(); csAddMoveRow();   // 預留兩列，方便直接一次填多款
  if(!OWNBRAND_PRODUCTS || !OWNBRAND_PRODUCTS.length){ loadOwnbrandData().then(renderCsMoveItems).catch(()=>{}); }
  onConsignMoveType();
  document.getElementById('cs-move-overlay').style.display='flex';
}
function closeConsignMove(){ document.getElementById('cs-move-overlay').style.display='none'; }
function onConsignMoveType(){
  const t=document.getElementById('cs-m-type').value;
  const isIn=(t==='in');
  const single=document.getElementById('cs-m-single-wrap');
  const multi=document.getElementById('cs-m-multi-wrap');
  if(single) single.style.display=isIn?'none':'block';
  if(multi) multi.style.display=isIn?'block':'none';
  const priceRow=document.getElementById('cs-m-price').closest('.fl');
  if(priceRow) priceRow.style.display=(t==='out')?'block':'none';
  const hint=document.getElementById('cs-m-qtyhint');
  hint.textContent = (t==='adjust' ? '可為負數' : '瓶數');
}
/* ---- 鋪貨/補貨多列（一次登記多款酒）---- */
function csMoveSkuOptions(selectedSku){
  const ps=OWNBRAND_PRODUCTS||[];
  return '<option value="">選擇公版酒…</option>'+ps.map(p=>
    `<option value="${escHtml(p.sku_id)}"${String(p.sku_id)===String(selectedSku)?' selected':''}>${escHtml(p.name+'（'+p.volume+'）')}</option>`
  ).join('');
}
function csAddMoveRow(){
  CS_MOVE_ROWID++;
  csMoveItems.push({id:CS_MOVE_ROWID, sku:'', qty:'', taster:false, tasterQty:1});
  renderCsMoveItems();
}
function csDelMoveRow(id){
  csMoveItems=csMoveItems.filter(r=>r.id!==id);
  if(!csMoveItems.length){ csAddMoveRow(); return; }
  renderCsMoveItems();
}
function csMoveRowInput(id, key, val){
  const r=csMoveItems.find(x=>x.id===id); if(r) r[key]=val;
  if(key==='taster') csMoveGenvfLock();
}
/* 2026-08-12 Molly：試飲瓶只會出現在出貨驗收單上，不寫進 consign_ledger——
   一旦有任一列勾了試飲瓶，「同時產生出貨驗收單」就強制勾選＋鎖定，避免她手動取消
   之後那幾支試飲瓶就完全沒地方查得到（跟複檢報告 2026-08-11 #42 是同一個坑）。 */
function csMoveGenvfLock(){
  const cb=document.getElementById('cs-m-genvf'), hint=document.getElementById('cs-m-genvf-hint');
  if(!cb) return;
  const anyTaster=csMoveItems.some(r=>r.taster);
  if(anyTaster){ cb.checked=true; cb.disabled=true; if(hint) hint.style.display='block'; }
  else { cb.disabled=false; if(hint) hint.style.display='none'; }
}
function renderCsMoveItems(){
  const body=document.getElementById('cs-m-items-body'); if(!body) return;
  /* 2026-08-06 Molly：每款鋪貨酒都可以附一支 500ml 試飲瓶。
     試飲瓶是免費贈送、不進庫存帳——只會出現在出貨驗收單上並標示「試飲」，
     所以這裡只是一個旗標，不會產生 consign_ledger 異動。 */
  body.innerHTML=csMoveItems.map(r=>`<div style="margin-top:6px">
    <div style="display:flex;gap:8px;align-items:center">
      <select class="fi" style="flex:2" onchange="csMoveRowInput(${r.id},'sku',this.value)">${csMoveSkuOptions(r.sku)}</select>
      <input class="fi" type="number" min="0" style="flex:1" placeholder="數量" value="${(r.qty!=null&&r.qty!=='')?escAttr(r.qty):''}" oninput="csMoveRowInput(${r.id},'qty',this.value)">
      <button type="button" class="del" onclick="csDelMoveRow(${r.id})">✕</button>
    </div>
    <label style="display:inline-flex;align-items:center;gap:5px;margin:4px 0 0 2px;font-size:11.5px;color:var(--hint);cursor:pointer">
      <input type="checkbox" ${r.taster?'checked':''} onchange="csMoveRowInput(${r.id},'taster',this.checked)" style="width:14px;height:14px;cursor:pointer">
      附 500ml 試飲瓶
      <input type="number" min="1" value="${(r.tasterQty!=null&&r.tasterQty!=='')?escAttr(r.tasterQty):1}" onchange="csMoveRowInput(${r.id},'tasterQty',this.value)" style="width:46px;border:1px solid var(--bd);border-radius:4px;padding:1px 4px;font-size:11px;font-family:inherit">
      支（免費贈送，不計價、不進庫存）
    </label>
  </div>`).join('');
}
function csGenVerifyNo(customerId){
  const n=new Date(), p=x=>String(x).padStart(2,'0');
  const stamp=n.getFullYear()+p(n.getMonth()+1)+p(n.getDate())+p(n.getHours())+p(n.getMinutes())+p(n.getSeconds());
  return 'CS-'+String(customerId||'').replace(/[^A-Za-z0-9]/g,'')+'-'+stamp;
}
let _csMoveSaving=false;
async function saveConsignMove(){
  if(_csMoveSaving) return; _csMoveSaving=true;
  const type=document.getElementById('cs-m-type').value;
  const date=document.getElementById('cs-m-date').value;
  const note=document.getElementById('cs-m-note').value.trim();
  if(!date){ toast('請選日期','err'); _csMoveSaving=false; return; }

  if(type==='in'){
    // 鋪貨/補貨：一次登記多款（一次呼叫 addConsignMovements，backend 用鎖包住避免單號互撞）
    const rows=csMoveItems.map(r=>({sku:String(r.sku||'').trim(), qty:parseFloat(r.qty),
      taster:!!r.taster, tasterQty:Math.max(1, parseInt(r.tasterQty,10)||1)}));
    const hasSku=r=>!!r.sku, hasQty=r=>!isNaN(r.qty)&&r.qty>0;
    const valid=rows.filter(r=>hasSku(r)&&hasQty(r));
    /* 2026-08-12 Molly：有時只是純拜訪送試飲瓶，沒有搭配真的鋪貨——這種列允許
       「選了公版酒＋勾試飲瓶＋數量留空」單獨成立，不算填一半、也不會寫進庫存帳。 */
    const tasterOnly=rows.filter(r=>hasSku(r)&&r.taster&&!hasQty(r));
    const partial=rows.filter(r=>{
      if(hasSku(r)&&hasQty(r)) return false;               // 正常鋪貨列
      if(hasSku(r)&&r.taster&&!hasQty(r)) return false;     // 試飲瓶單獨列
      if(!hasSku(r)&&!hasQty(r)) return false;              // 完全空白列，忽略
      return true;                                          // 其餘＝填了一半
    });
    // 先看有沒有「填了一半」的列（比較具體、對使用者更有幫助）；全部列都完全空白才顯示泛用提示
    if(partial.length){ toast('有列只填了一半（公版酒或數量缺一個），請補齊或用 ✕ 刪掉該列','err'); _csMoveSaving=false; return; }
    if(!valid.length && !tasterOnly.length){ toast('請至少填一款酒的公版酒與數量，或勾選「附試飲瓶」單獨贈送','err'); _csMoveSaving=false; return; }
    const movements=valid.map(r=>({ date, customer_id:CS_CUR, sku_id:r.sku, type:'in', qty:r.qty, note }));
    try{
      if(movements.length){
        const d=await apiCall({action:'addConsignMovements', token:AUTH_TOKEN, movements});
        if(!d.ok) throw new Error(d.error||'儲存失敗');
      }
      const tasterExtra=valid.filter(r=>r.taster).length + tasterOnly.length;
      toast(valid.length
        ? ('已登記鋪貨（共 '+valid.length+' 款）'+(tasterExtra?'，另加 '+tasterExtra+' 款試飲瓶':''))
        : ('已登記試飲瓶（共 '+tasterOnly.length+' 款，不影響庫存）'), 'ok');
      const genvf=document.getElementById('cs-m-genvf');
      // 只要有任何試飲瓶（鋪貨列附加或單獨列），驗收單留底是唯一查得到「送了幾支、何時送」的地方，
      // 不管使用者有沒有勾，一律強制產生（畫面上的勾選已經被 csMoveGenvfLock 鎖住，這裡是後端保險）。
      const wantVf=tasterExtra>0 ? true : !!(genvf&&genvf.checked);
      const handler=(document.getElementById('cs-m-handler')||{}).value||'';
      const c=curConsignCustomer();
      closeConsignMove();
      // 複檢 2026-08-13 #1-2：帳動了，已產生的月結就作廢，避免匯出／轉報價單用到舊金額
      if(movements.length){ csClearMonthly(); loadConsignInventory(); loadConsignLedger(); }
      if(wantVf){
        /* 驗收單的列：正常鋪貨列＋（有勾的話）該款的 500ml 試飲瓶列＋單獨登記的試飲瓶列。
           試飲瓶只在這張單上出現，不寫進 consign_ledger，所以庫存不受影響。 */
        const rowsForVf=[];
        valid.forEach(r=>{
          const p=ownbrandBySku(r.sku);
          rowsForVf.push({ name:p?p.name:r.sku, vol:p?p.volume:'', qty:r.qty });
          if(r.taster) rowsForVf.push({ name:p?p.name:r.sku, vol:'500ml', qty:r.tasterQty, taster:true });
        });
        tasterOnly.forEach(r=>{
          const p=ownbrandBySku(r.sku);
          rowsForVf.push({ name:p?p.name:r.sku, vol:'500ml', qty:r.tasterQty, taster:true });
        });
        openConsignVerifyForm({
          no: csGenVerifyNo(CS_CUR),
          client: (c&&c.name)||CS_CUR,
          shipDate: date,
          handler: handler,
          note: note,
          rows: rowsForVf
        });
      }
    }catch(e){ toast(e.message||'儲存失敗','err'); }
    finally{ _csMoveSaving=false; }
    return;
  }

  // ---- 其他類型：維持原本單款登記 ----
  const sku=document.getElementById('cs-m-sku').value;
  const qty=parseFloat(document.getElementById('cs-m-qty').value);
  const priceRaw=document.getElementById('cs-m-price').value.trim();
  if(!sku){ toast('請選公版酒','err'); _csMoveSaving=false; return; }
  if(!(qty!==0 && !isNaN(qty))){ toast('請填數量','err'); _csMoveSaving=false; return; }
  if(type!=='adjust' && qty<0){ toast('此類型數量需為正數','err'); _csMoveSaving=false; return; }
  // 超賣/超退提醒（提醒不硬擋，按確定仍可登記，保留彈性）
  const invRow=(CS_INV||[]).find(r=>String(r.sku_id)===String(sku));
  const balNow=invRow?(parseFloat(invRow.balance)||0):0;
  let warn='';
  if((type==='out'||type==='return') && qty>balNow) warn='這支酒在客戶端的庫存只剩 '+balNow+' 瓶，確定要登記'+(type==='out'?'銷售':'退貨')+' '+qty+' 瓶嗎？（登記後庫存會變負數）';
  if(warn && !confirm(warn)){ _csMoveSaving=false; return; }
  const movement={ date, customer_id:CS_CUR, sku_id:sku, type, qty, note };
  if(type==='out' && priceRaw!=='') movement.unit_price=parseFloat(priceRaw)||0;
  try{
    const d=await apiCall({action:'addConsignMovement', token:AUTH_TOKEN, movement, ...movement});
    if(!d.ok) throw new Error(d.error||'儲存失敗');
    toast('已登記'+(CS_TYPE_LABEL[type]||''),'ok');
    closeConsignMove();
    // 複檢 2026-08-13 #1-2：帳動了，已產生的月結就作廢，避免匯出／轉報價單用到舊金額
    csClearMonthly();
    loadConsignInventory(); loadConsignLedger();
  }catch(e){ toast(e.message||'儲存失敗','err'); }
  finally{ _csMoveSaving=false; }
}

/* ---- 月結 ---- */
async function loadConsignMonthly(){
  const wrap=document.getElementById('cs-monthly');
  const ym=document.getElementById('cs-month').value;
  if(!ym){ toast('請選月份','err'); return; }
  const [y,m]=ym.split('-').map(x=>parseInt(x,10));
  wrap.innerHTML='<div class="rec-empty">計算中…</div>';
  try{
    const d=await apiCall({action:'getConsignMonthly', token:AUTH_TOKEN, customer_id:CS_CUR, year:y, month:m});
    if(!d.ok) throw new Error(d.error||'計算失敗');
    CS_MONTHLY={ ...d, year:y, month:m, customer:curConsignCustomer(), for_customer:CS_CUR, for_ym:ym };
    const lines=d.lines||[];
    if(!lines.length){ wrap.innerHTML='<div class="rec-empty">本月無銷售紀錄</div>'; return; }
    wrap.innerHTML=`<div class="tbl-scroll"><table class="rec-table mcard">
      <thead><tr><th>公版酒</th><th style="text-align:center">容量</th><th style="text-align:right">銷售數量</th><th style="text-align:right">折後單價</th><th style="text-align:right">小計</th></tr></thead>
      <tbody>${lines.map(l=>`<tr><td class="mc-main">${escHtml(l.name||l.sku_id)}</td><td data-l="容量" style="text-align:center">${escHtml(l.volume||'')}</td>
        <td data-l="銷售數量" style="text-align:right">${(parseFloat(l.qty)||0).toLocaleString()}</td><td data-l="折後單價" style="text-align:right">${money(l.unit_price)}</td>
        <td data-l="小計" style="text-align:right;font-weight:700">${money(l.amount)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="4" style="text-align:right;font-weight:700;padding:10px 12px">本月應收（含稅）</td><td style="text-align:right;font-weight:700;color:var(--gold-deep)">${money(d.total)}</td></tr></tfoot>
      </table></div><div id="cs-settled" style="margin-top:8px;font-size:12.5px;color:var(--hint)">查詢請款狀態中…</div>`;
    csCheckSettled();
  }catch(e){ wrap.innerHTML=`<div class="rec-empty">${escHtml(e.message||'計算失敗')}</div>`; }
}
/* 這個「客戶＋結算期間」是否已轉出過報價單（防重複請款；轉報價單時會把期間寫進備註）*/
async function csCheckSettled(){
  const snap=CS_MONTHLY;
  try{
    const d=await readCall(withLimit({action:'getQuotes', token:AUTH_TOKEN, filters:{}}));
    if(CS_MONTHLY!==snap || !CS_MONTHLY) return;   // 期間/客戶已切換就別亂寫畫面
    const c=CS_MONTHLY.customer||{};
    const from=CS_MONTHLY.period&&CS_MONTHLY.period.from;
    const q=from?(d.quotes||[]).find(q=>q.quoteType==='consign'
      && String(q.clientName||'').trim()===String(c.name||'').trim()
      && String(q.remark||'').includes('寄售月結：'+from)):null;
    CS_MONTHLY.settled=q||null;
    const el=document.getElementById('cs-settled');
    if(el) el.innerHTML=q
      ? `✅ 這個月已於 ${escHtml(q.quoteDate||'')} 轉出報價單 <b>${escHtml(q.quoteNo)}</b>（已請款，別重複開單）`
      : `📌 這個月還沒轉出報價單（尚未請款）`;
  }catch(e){ const el=document.getElementById('cs-settled'); if(el) el.textContent=''; }
}
function exportConsignMonthly(){
  if(csMonthlyStale()){ toast('請先按「產生月結」（客戶或月份換過了）','err'); return; }
  if(!CS_MONTHLY||!(CS_MONTHLY.lines&&CS_MONTHLY.lines.length)){ toast('請先「產生月結」再匯出','err'); return; }
  const c=CS_MONTHLY.customer||{};
  const period=(CS_MONTHLY.period&&CS_MONTHLY.period.from)?`${CS_MONTHLY.period.from} ～ ${CS_MONTHLY.period.to}`:`${CS_MONTHLY.year}年${CS_MONTHLY.month}月`;
  const rows=CS_MONTHLY.lines.map(l=>`<tr>
    <td style="padding:9px 12px;border-bottom:1px solid #EEE">${escHtml(l.name||l.sku_id)}</td>
    <td style="padding:9px 8px;text-align:center;border-bottom:1px solid #EEE">${escHtml(l.volume||'')}</td>
    <td style="padding:9px 8px;text-align:right;border-bottom:1px solid #EEE">${(parseFloat(l.qty)||0).toLocaleString()}</td>
    <td style="padding:9px 8px;text-align:right;border-bottom:1px solid #EEE">${money(l.unit_price)}</td>
    <td style="padding:9px 8px;text-align:right;border-bottom:1px solid #EEE;font-weight:700">${money(l.amount)}</td></tr>`).join('');
  const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>寄售月結單_${escHtml(c.name||'')}_${CS_MONTHLY.year}${s2(CS_MONTHLY.month)}</title>
    <style>body{font-family:'Noto Sans TC','Microsoft JhengHei',sans-serif;color:#22241F;padding:32px;max-width:720px;margin:auto}
    h1{font-size:22px;letter-spacing:4px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:16px;font-size:13px}
    th{background:#22241F;color:#fff;padding:9px 8px;font-size:11px;text-align:right}th:first-child{text-align:left}
    .muted{color:#8A8A80;font-size:11px}.tot{font-size:16px;font-weight:700;color:#7A5A1E}</style></head><body>
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div><h1>凱文南坡萬實業社</h1><div class="muted">KEVIN NUMBER 1 · TAILORED.COCKTAIL</div>
        <div class="muted">新北市新莊區化成路554巷37號　(02)8991-0068　統編 92719710</div></div>
      <div style="text-align:right"><div style="font-size:18px;font-weight:700;letter-spacing:4px">寄售月結單</div>
        <div class="muted" style="margin-top:6px">結算期間：${period}</div></div>
    </div>
    <div style="margin-top:14px;font-size:13px">客戶：<b>${escHtml(c.name||'')}</b>　·　折數：${c.default_discount?((c.default_discount*10)+'折（部分品項可能有例外）'):'—'}</div>
    <table><thead><tr><th>公版酒</th><th style="text-align:center">容量</th><th>銷售數量</th><th>折後單價</th><th>小計</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div style="text-align:right;margin-top:14px" class="tot">本期應收（含稅）：${money(CS_MONTHLY.total)}</div>
    <div class="muted" style="margin-top:26px;line-height:1.8">· 本月結單依「當月實際銷售數量 × 折後單價」計算，金額均為含稅價（已含菸酒稅・營業稅）。<br>
    · 匯款資訊：陽信銀行中興分行 (108)　02142-00230-91　凱文南坡萬實業社黃彥愷</div>
    <script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`;
  const w=window.open('','_blank');
  if(!w){ toast('瀏覽器阻擋了新視窗，請允許彈出視窗','err'); return; }
  w.document.write(html); w.document.close();
}

/* ---- 把月結資料轉為正式報價單（寄售月結 quoteType='consign'）---- */
function consignMonthlyToQuote(){
  if(csMonthlyStale()){ toast('請先按「產生月結」（客戶或月份換過了）','err'); return; }
  if(!CS_MONTHLY||!(CS_MONTHLY.lines&&CS_MONTHLY.lines.length)){ toast('請先「產生月結」再轉為報價單','err'); return; }
  if(CS_MONTHLY.settled && !confirm('這個月已經在 '+(CS_MONTHLY.settled.quoteDate||'')+' 轉出過報價單 '+CS_MONTHLY.settled.quoteNo+'。\n再轉一次會出現兩張同月份的請款單，確定要繼續嗎？')) return;
  if(typeof isFormDirty==='function' && isFormDirty() && !confirm('報價單表單還有未儲存的內容，轉出月結報價單會把它清掉，確定要繼續？')) return;
  const c=CS_MONTHLY.customer||{};
  const period=(CS_MONTHLY.period&&CS_MONTHLY.period.from)?`${CS_MONTHLY.period.from} ～ ${CS_MONTHLY.period.to}`:`${CS_MONTHLY.year}年${CS_MONTHLY.month}月`;
  resetAll(true);
  editingQuoteNo=null;
  SELECTED_COMPANY=null; RULE_SUPPRESS={};
  { const csel=document.getElementById('qf-company'); if(csel) csel.value=''; }
  { const box=document.getElementById('qf-detail'); if(box) box.style.display='none'; }
  setType('consign');
  const set=(id,v)=>{ const e=document.getElementById(id); if(e && v!=null && v!=='') e.value=v; };
  // 交叉帶入：客戶主檔（客戶管理）有同名客戶時，自動帶發票抬頭／統編／地址，統編不用再手查
  let master=null;
  try{
    const pk=rcPeek({action:'getCustomers', token:AUTH_TOKEN});
    const list=(pk&&pk.data&&pk.data.customers)||[];
    master=list.find(x=>String(x.active||'Y').toUpperCase()!=='N' && String(x.name||'').trim()===String(c.name||'').trim())||null;
  }catch(e){}
  set('f-cli', c.name);
  set('f-inv', (master&&master.invoice_title)||c.name);
  set('f-tax', master&&master.tax_id);
  set('f-con', c.contact||(master&&master.contact));
  set('f-ph', c.phone||(master&&master.phone));
  set('f-ad', c.ship_address||(master&&master.address));
  let note=`寄售月結：${period}`;
  if(c.default_discount) note+=`（折數 ${(c.default_discount*10).toFixed(1).replace(/\.0$/,'')} 折）`;
  set('f-note', note);
  setTaxMode('inc');
  document.getElementById('itbody-bot').innerHTML=''; botItems=[];
  CS_MONTHLY.lines.forEach(l=>{
    /* 複檢 2026-08-13 #3-3：l.volume 是 '100ml'/'500ml' 字串，直接塞進 type=number 的容量欄會變空白，
       轉出來的報價單與正式 PDF 整欄沒有容量，同支酒的 100ml/500ml 變成兩列同名。跟 quickAddOwnbrand 一樣先抽數字。 */
    addBotRow({name:l.name||l.sku_id, vol:String(l.volume||'').replace(/[^\d]/g,''), price:l.unit_price, qty:l.qty});
  });
  if(botItems.length===0) addBotRow();
  onDate(); upNo();
  calc();
  gotoPage('new');
  autoNextSerial();
  toast('已帶入「'+(c.name||'')+'」'+period+' 的月結資料，請確認內容後儲存報價單','ok');
}

async function initV2(){
  gotoPage('today');   // 登入後預設落地頁＝「今日待辦」（原本的行事曆保留，只是不再是預設）
  prefetchCommon();    // 你在看今日待辦時，背景先把其他頁的資料偷偷抓好
  try{ await loadCompanyData(); }catch(e){ /* 靜默：未登入或後端未就緒不擋主流程 */ }
}

/* ---- 登入後背景預抓 --------------------------------------------
   後端每叫一次都要 2.5 秒，所以與其等你點進去才抓，不如趁你在看今日待辦時先抓好。
   只放進讀取快取、完全不動畫面；等你點過去時資料已經在手上，是 0 秒。
   刻意錯開時間分兩批：同時打太多支反而會被 Google 排隊拖慢。
   ---------------------------------------------------------------- */
let PREFETCH_DONE = false;
function prefetchPayloads(){
  return ordPayloads().concat([                    // 訂單追蹤／月報表／報價紀錄共用的三支
    {action:'getVerifications', token:AUTH_TOKEN, filters:{}},   // ＋驗收管理與訂單徽章共用的兩支
    {action:'listVerifyForms', token:AUTH_TOKEN, filters:{}},
    {action:'listShipments', token:AUTH_TOKEN},                  // ＋訂單列的「分批×N」徽章
    {action:'getCustomers', token:AUTH_TOKEN},                   // ＋客戶主檔（客戶管理與報價單下拉共用）
    {action:'getConsignCustomers', token:AUTH_TOKEN}             // ＋寄售客戶（寄售頁下拉秒開）⚠ 已滿 8 份＝後端 BATCH_MAX_ 上限，要再加就得先調後端
  ]);
}
function prefetchCommon(){
  if(PREFETCH_DONE || !AUTH_TOKEN) return;
  PREFETCH_DONE = true;
  setTimeout(()=>{
    if(!AUTH_TOKEN) return;
    // 五份一起要 → 走後端 v37 的 batch 合併成一個請求：平均比平行快，
    // 更重要的是不會偶爾卡到十幾秒，也不會跟你當下在看的畫面搶連線。
    readCallMany(prefetchPayloads()).catch(()=>{});
  }, 2500);
}
onCacheClear(function(){ OWNBRAND_PRODUCTS=null; OWNBRAND_TIERS=null; CONSIGN_TERMS=null; });

/* resetAll 後同步清掉公司選擇與發票抬頭 */
onHook('afterReset', function(){
  const e=document.getElementById('f-inv'); if(e) e.value='';
  const c=document.getElementById('qf-company'); if(c) c.value='';
  SELECTED_COMPANY=null; RULE_SUPPRESS={};
  const d=document.getElementById('qf-detail'); if(d) d.style.display='none';
  const sc=document.getElementById('f-shipsame'); if(sc) sc.checked=true;
  toggleShipSame('f');
  { const ss=document.getElementById('f-shipdate-show'); if(ss) ss.checked=true; } // 出貨日「顯示」勾選回到預設
  FORM_DIRTY=false; // 清空/開新單後視為無未儲存內容
});
/* 使用者手動移除自動規則列 → 記住不要再自動加回 */
onHook('beforeRemoveExt', function(id){
  // 複檢 2026-08-06 #14：UI 的 onclick 傳進來的是字串（`removeExt('7')`），
  // 自動列的 id 卻是數字（04_company.js 的 ++rowId），嚴格等號永遠比不中 →
  // RULE_SUPPRESS 設不進去 → 刪掉後 afterCalc 立刻又把同一列加回來，看起來「刪不掉」。
  const e = extras.find(x=>String(x.id)===String(id));
  if(e && e.auto) RULE_SUPPRESS[e.auto]=true;
});

