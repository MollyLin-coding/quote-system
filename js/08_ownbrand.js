/* ============================================================
   v3.0 自有品牌公版酒（A. 通路買斷報價模式）
   ============================================================ */
let OWNBRAND_PRODUCTS=null, OWNBRAND_TIERS=null, CONSIGN_TERMS=null;

async function loadOwnbrandData(force){
  if(OWNBRAND_PRODUCTS && OWNBRAND_TIERS && !force) return;
  if(!AUTH_TOKEN) throw new Error('尚未登入');
  const [p,t]=await Promise.all([
    apiCall({action:'getOwnbrandProducts', token:AUTH_TOKEN}),
    apiCall({action:'getOwnbrandTiers', token:AUTH_TOKEN})
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
/* 依「每款瓶數」回傳折率；未達最低級距回傳 1（建議零售） */
function buyoutDiscountForQty(qty){
  const ts=buyoutTiers(); let d=1;
  ts.forEach(t=>{ if(qty>=t.min && t.min>0) d=t.disc; });
  return d;
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
    info.innerHTML=ts.length
      ? 'ℹ️ 量價級距（每款瓶數）：'+ts.filter(t=>t.min>0).map(t=>`${t.min}瓶↑ ${(t.disc*10)}折`).join('　·　')+'　·　未達最低量為建議零售價；皆免運'
      : '';
  }
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
  const dv=diEl.value.trim();
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
const CS_TYPE_LABEL={in:'鋪貨/補貨',out:'銷售',return:'退貨',adjust:'盤點調整',deposit_refund:'退保證金'};

async function initConsignPage(){
  try{ await loadOwnbrandData(); }catch(e){}
  await loadConsignCustomers();
}
async function loadConsignCustomers(force){
  const sel=document.getElementById('cs-customer'); if(!sel) return;
  try{
    const d=await apiCall({action:'getConsignCustomers', token:AUTH_TOKEN});
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
  document.getElementById('cs-monthly').innerHTML='';
  loadConsignInventory(); loadConsignLedger();
}
async function loadConsignInventory(){
  const body=document.getElementById('cs-inv-body');
  body.innerHTML=sklTableRows(4,4);
  try{
    const d=await apiCall({action:'getConsignInventory', token:AUTH_TOKEN, customer_id:CS_CUR});
    if(!d.ok) throw new Error(d.error||'載入庫存失敗');
    CS_INV=(d.inventory||[]).filter(r=>!r.customer_id||String(r.customer_id)===String(CS_CUR));
    const dep=(d.deposit_held_by_customer&&d.deposit_held_by_customer[CS_CUR])||0;
    document.getElementById('cs-deposit').textContent=money(dep);
    const totStock=CS_INV.reduce((s,r)=>s+(parseFloat(r.balance)||0),0);
    document.getElementById('cs-totstock').textContent=totStock.toLocaleString()+' 瓶';
    if(!CS_INV.length){ body.innerHTML='<tr><td colspan="4" class="rec-empty">尚無庫存資料（先登記鋪貨）</td></tr>'; return; }
    body.innerHTML=CS_INV.map(r=>{
      const p=ownbrandBySku(r.sku_id);
      const nm=r.name||(p?p.name:r.sku_id);
      const vol=r.volume||(p?p.volume:'');
      return `<tr><td>${escHtml(nm)}</td><td style="text-align:center">${escHtml(vol)}</td>
        <td style="text-align:right;font-weight:600">${(parseFloat(r.balance)||0).toLocaleString()}</td>
        <td style="text-align:right">${(parseFloat(r.deposit_pool_qty)||0).toLocaleString()}</td></tr>`;
    }).join('');
  }catch(e){ body.innerHTML=`<tr><td colspan="4" class="rec-empty">${escHtml(e.message||'載入失敗')}</td></tr>`; }
}
async function loadConsignLedger(){
  const body=document.getElementById('cs-ledger-body');
  body.innerHTML=sklTableRows(6,4);
  try{
    const d=await apiCall({action:'getConsignLedger', token:AUTH_TOKEN, customer_id:CS_CUR});
    if(!d.ok) throw new Error(d.error||'載入明細失敗');
    let rows=(d.rows||[]).filter(r=>!r.customer_id||String(r.customer_id)===String(CS_CUR));
    rows.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
    if(!rows.length){ body.innerHTML='<tr><td colspan="6" class="rec-empty">尚無異動明細</td></tr>'; return; }
    body.innerHTML=rows.map(r=>{
      const p=ownbrandBySku(r.sku_id);
      const nm=p?`${p.name}（${p.volume}）`:r.sku_id;
      const up=(r.unit_price!=null&&r.unit_price!=='')?money(r.unit_price):'—';
      return `<tr><td>${escHtml(r.date||'')}</td><td>${escHtml(CS_TYPE_LABEL[r.type]||r.type||'')}</td>
        <td>${escHtml(nm)}</td><td style="text-align:right">${(parseFloat(r.qty)||0).toLocaleString()}</td>
        <td style="text-align:right">${up}</td><td>${escHtml(r.note||'')}</td></tr>`;
    }).join('');
  }catch(e){ body.innerHTML=`<tr><td colspan="6" class="rec-empty">${escHtml(e.message||'載入失敗')}</td></tr>`; }
}
function populateConsignSkuSelect(selId){
  const s=document.getElementById(selId); if(!s) return;
  const ps=OWNBRAND_PRODUCTS||[];
  s.innerHTML=ps.length?ps.map(p=>`<option value="${escHtml(p.sku_id)}">${escHtml(p.name+'（'+p.volume+'）')}</option>`).join(''):'<option value="">尚無公版酒（先在後台同步）</option>';
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
  const disc=parseFloat(g('cs-f-disc'));
  const customer={ customer_id:id, name, default_discount:(disc>0&&disc<=1)?disc:0.75,
    billing_day:g('cs-f-bill'), contact:g('cs-f-contact'), phone:g('cs-f-phone'),
    ship_address:g('cs-f-addr'), note:g('cs-f-note'), active:document.getElementById('cs-f-active').value };
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
function openConsignMove(){
  if(!CS_CUR){ toast('請先選擇客戶','err'); return; }
  populateConsignSkuSelect('cs-m-sku');
  document.getElementById('cs-m-type').value='in';
  const n=new Date(); document.getElementById('cs-m-date').value=n.getFullYear()+'-'+s2(n.getMonth()+1)+'-'+s2(n.getDate());
  document.getElementById('cs-m-qty').value='';
  document.getElementById('cs-m-price').value='';
  document.getElementById('cs-m-note').value='';
  onConsignMoveType();
  document.getElementById('cs-move-overlay').style.display='flex';
}
function closeConsignMove(){ document.getElementById('cs-move-overlay').style.display='none'; }
function onConsignMoveType(){
  const t=document.getElementById('cs-m-type').value;
  const priceRow=document.getElementById('cs-m-price').closest('.fl');
  if(priceRow) priceRow.style.display=(t==='out')?'block':'none';
  const hint=document.getElementById('cs-m-qtyhint');
  hint.textContent = t==='deposit_refund' ? '退還保證金的瓶數（通常＝在池瓶數）' : (t==='adjust' ? '可為負數' : '瓶數');
}
let _csMoveSaving=false;
async function saveConsignMove(){
  if(_csMoveSaving) return; _csMoveSaving=true;
  const type=document.getElementById('cs-m-type').value;
  const date=document.getElementById('cs-m-date').value;
  const sku=document.getElementById('cs-m-sku').value;
  const qty=parseFloat(document.getElementById('cs-m-qty').value);
  const priceRaw=document.getElementById('cs-m-price').value.trim();
  const note=document.getElementById('cs-m-note').value.trim();
  if(!date){ toast('請選日期','err'); _csMoveSaving=false; return; }
  if(!sku){ toast('請選公版酒','err'); _csMoveSaving=false; return; }
  if(!(qty!==0 && !isNaN(qty))){ toast('請填數量','err'); _csMoveSaving=false; return; }
  if(type!=='adjust' && qty<0){ toast('此類型數量需為正數','err'); _csMoveSaving=false; return; }
  const movement={ date, customer_id:CS_CUR, sku_id:sku, type, qty, note };
  if(type==='out' && priceRaw!=='') movement.unit_price=parseFloat(priceRaw)||0;
  try{
    const d=await apiCall({action:'addConsignMovement', token:AUTH_TOKEN, movement, ...movement});
    if(!d.ok) throw new Error(d.error||'儲存失敗');
    toast('已登記'+(CS_TYPE_LABEL[type]||''),'ok');
    closeConsignMove();
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
    CS_MONTHLY={ ...d, year:y, month:m, customer:curConsignCustomer() };
    const lines=d.lines||[];
    if(!lines.length){ wrap.innerHTML='<div class="rec-empty">本月無銷售紀錄</div>'; return; }
    wrap.innerHTML=`<div class="tbl-scroll"><table class="rec-table">
      <thead><tr><th>公版酒</th><th style="text-align:center">容量</th><th style="text-align:right">銷售數量</th><th style="text-align:right">折後單價</th><th style="text-align:right">小計</th></tr></thead>
      <tbody>${lines.map(l=>`<tr><td>${escHtml(l.name||l.sku_id)}</td><td style="text-align:center">${escHtml(l.volume||'')}</td>
        <td style="text-align:right">${(parseFloat(l.qty)||0).toLocaleString()}</td><td style="text-align:right">${money(l.unit_price)}</td>
        <td style="text-align:right;font-weight:700">${money(l.amount)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="4" style="text-align:right;font-weight:700;padding:10px 12px">本月應收（含稅）</td><td style="text-align:right;font-weight:700;color:var(--gold-deep)">${money(d.total)}</td></tr></tfoot>
      </table></div>`;
  }catch(e){ wrap.innerHTML=`<div class="rec-empty">${escHtml(e.message||'計算失敗')}</div>`; }
}
function exportConsignMonthly(){
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
  if(!CS_MONTHLY||!(CS_MONTHLY.lines&&CS_MONTHLY.lines.length)){ toast('請先「產生月結」再轉為報價單','err'); return; }
  const c=CS_MONTHLY.customer||{};
  const period=(CS_MONTHLY.period&&CS_MONTHLY.period.from)?`${CS_MONTHLY.period.from} ～ ${CS_MONTHLY.period.to}`:`${CS_MONTHLY.year}年${CS_MONTHLY.month}月`;
  resetAll(true);
  editingQuoteNo=null;
  SELECTED_COMPANY=null; RULE_SUPPRESS={};
  { const csel=document.getElementById('qf-company'); if(csel) csel.value=''; }
  { const box=document.getElementById('qf-detail'); if(box) box.style.display='none'; }
  setType('consign');
  const set=(id,v)=>{ const e=document.getElementById(id); if(e && v!=null && v!=='') e.value=v; };
  set('f-cli', c.name);
  set('f-inv', c.name);
  set('f-con', c.contact);
  set('f-ph', c.phone);
  set('f-ad', c.ship_address);
  let note=`寄售月結：${period}`;
  if(c.default_discount) note+=`（折數 ${(c.default_discount*10).toFixed(1).replace(/\.0$/,'')} 折）`;
  set('f-note', note);
  setTaxMode('inc');
  document.getElementById('itbody-bot').innerHTML=''; botItems=[];
  CS_MONTHLY.lines.forEach(l=>{
    addBotRow({name:l.name||l.sku_id, vol:l.volume, price:l.unit_price, qty:l.qty});
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
  try{ await loadCompanyData(); }catch(e){ /* 靜默：未登入或後端未就緒不擋主流程 */ }
}

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
  const e = extras.find(x=>x.id===id);
  if(e && e.auto) RULE_SUPPRESS[e.auto]=true;
});

