/* ------------------------------------------------------------------
   14_contract.js —— 合約產生（2026-09-15）
   從報價單／客戶主檔帶入必要資訊，後端 v6_contract.gs 套 Google Docs 範本產出
   代工（再製酒類委託生產契約書）或寄售（自有品牌酒款寄售合作契約書，免保證金）合約：
   Google Doc（可再手改）＋ PDF ＋ docx，並在 contracts 分頁留底。
   入口：合約頁「新增合約」（2026-09-16 起報價紀錄不再掛「合約」鈕）。老闆專用。
   2026-09-16：附件二「產品配方及規格表」可從廠務APP 的酒譜書分頁／無訂單之獨立 Run Card 帶入
   （後端 contractRecipeSources／contractRecipeFetch），帶入後仍可手改；圖片辨識（B）暫緩。
   ------------------------------------------------------------------ */
let CT_LIST=null;            // contracts 分頁快取
let CT_PREFILL=null;         // 目前表單帶入的來源（quote / customer / consignCustomer / pay）
const CT_LS_KEY='ct_our_contact';   // 乙方聯絡人／Email 記住上次填的

function ctG(id){ return document.getElementById(id); }
function ctVal(id){ const e=ctG(id); return e ? String(e.value==null?'':e.value).trim() : ''; }
function ctSet(id,v){ const e=ctG(id); if(e) e.value=(v==null?'':v); }
function ctTodayYmd(){ const d=new Date(); const p=n=>('0'+n).slice(-2); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
function ctAddYear(ymd){ const m=String(ymd||'').match(/^(\d{4})-(\d{2})-(\d{2})$/); if(!m) return ''; const d=new Date(+m[1]+1,+m[2]-1,+m[3]); d.setDate(d.getDate()-1); const p=n=>('0'+n).slice(-2); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }

/* ---------- 合約頁 ---------- */
async function loadContracts(force){
  const body=ctG('ct-body'); if(!body) return;
  if(!AUTH_TOKEN){ showLogin(); return; }
  if(!CT_LIST || force) body.innerHTML=sklTableRows(4,6);
  try{
    const d=await readCall({ action:'listContracts', token:AUTH_TOKEN }, force);
    if(!d || !d.ok) throw new Error((d&&d.error)||'載入失敗');
    CT_LIST=d.contracts||[];
    renderContracts();
  }catch(e){ body.innerHTML=`<tr><td colspan="6" class="rec-empty">${escHtml(e.message||'載入失敗')}</td></tr>`; }
}
function ctTypeBadge(t){ return t==='oem' ? '<span class="rec-badge bottle">代工</span>' : '<span class="rec-badge consign">寄售</span>'; }
function renderContracts(){
  const body=ctG('ct-body'); if(!body || !CT_LIST) return;
  const kw=(ctVal('ct-search')||'').toLowerCase();
  let rows=CT_LIST.slice();
  if(kw) rows=rows.filter(r=>[r.contract_no,r.client,r.quote_no].some(x=>String(x||'').toLowerCase().includes(kw)));
  if(!rows.length){ body.innerHTML=`<tr><td colspan="6" class="rec-empty">${CT_LIST.length?'沒有符合條件的合約':'還沒有產生過合約'}</td></tr>`; return; }
  body.innerHTML=rows.map(r=>`<tr>
    <td class="mc-main rec-id"><div class="rec-main"><span class="rec-cli">${escHtml(r.client||'—')}</span></div><span class="rec-sub">${escHtml(r.contract_no||'')}${r.created_by?`<span class="rec-dot">·</span>${escHtml(r.created_by)}`:''}</span></td>
    <td data-l="類型">${ctTypeBadge(r.type)}</td>
    <td data-l="報價單" class="rec-date">${r.quote_no?`<a href="#" onclick="event.preventDefault();openRecord('${escAttr(r.quote_no)}')">${escHtml(r.quote_no)}</a>`:'—'}</td>
    <td data-l="簽約日" class="rec-date">${escHtml(r.sign_date||'—')}</td>
    <td data-l="合約期間" class="rec-date">${escHtml(r.term_start||'')}${r.term_end?' ～ '+escHtml(r.term_end):''}</td>
    <td class="rec-actions" data-l="操作">
      <span class="rec-act-grp">
        ${r.docUrl?`<a class="rec-act-btn primary" href="${escAttr(r.docUrl)}" target="_blank" rel="noopener">Google 文件</a>`:''}
        ${r.pdfUrl?`<a class="rec-act-btn" href="${escAttr(r.pdfUrl)}" target="_blank" rel="noopener">PDF</a>`:''}
        ${r.docxUrl?`<a class="rec-act-btn" href="${escAttr(r.docxUrl)}" target="_blank" rel="noopener">Word</a>`:''}
      </span>
      <span class="rec-act-grp rec-act-sec">
        <button class="rec-act-btn" data-no="${escAttr(r.quote_no||'')}" data-type="${escAttr(r.type||'')}" onclick="openContractForm(this.dataset.no,this.dataset.type)" title="用同一張報價單再產生一份（例如改條件重出）">再產生</button>
      </span>
    </td>
  </tr>`).join('');
}
function ctOnSearch(){ renderContracts(); }

/* ---------- 範本設定（老闆） ---------- */
async function ctSaveTemplate(type){
  const id=ctVal(type==='oem'?'ct-tpl-oem':'ct-tpl-consign');
  if(!id){ toast('請貼上 Google 文件的檔案 ID（網址 /d/ 後面那串）','err'); return; }
  try{
    const d=await apiCall({ action:'setContractTemplate', token:AUTH_TOKEN, type, fileId:id });
    if(!d.ok) throw new Error(d.error||'設定失敗');
    toast('範本已設定','ok'); rcClear();
  }catch(e){ toast(e.message||'設定失敗','err'); }
}

/* ---------- 表單 ---------- */
function ctTypeGuess(q){
  if(!q) return 'oem';
  return (q.quoteType==='consign') ? 'consign' : 'oem';
}
async function openContractForm(quoteNo, type){
  if(!AUTH_TOKEN){ showLogin(); return; }
  if(typeof isOwner==='function' && !isOwner()){ toast('合約只有老闆帳號能產生','err'); return; }
  const ov=ctG('ct-overlay'); ov.style.display='flex';
  ctG('ct-form-body').style.opacity='.5';
  ctResetForm();
  CT_PREFILL=null; CT_RCP_SRC=null;
  ctSet('ct-quote-no', quoteNo||'');
  try{
    const d=await apiCall({ action:'contractPrefill', token:AUTH_TOKEN, quoteNo:quoteNo||'' });
    if(!d.ok) throw new Error(d.error||'帶入失敗');
    CT_PREFILL=d;
    ctApplyPrefill(d, type);
    const tplOk=d.templates||{};
    const warn=ctG('ct-tpl-warn');
    const missing=[!tplOk.oem?'代工':'',!tplOk.consign?'寄售':''].filter(Boolean);
    warn.style.display=missing.length?'block':'none';
    warn.textContent=missing.length?('尚未設定範本：'+missing.join('、')+'。請到「合約」頁貼上 Google 文件 ID。'):'';
  }catch(e){ toast(e.message||'帶入失敗','err'); }
  finally{ ctG('ct-form-body').style.opacity='1'; }
}
function closeContractForm(){ const e=ctG('ct-overlay'); if(e) e.style.display='none'; }
function ctResetForm(){
  ['ct-cli-name','ct-cli-rep','ct-cli-tax','ct-cli-addr','ct-cli-phone','ct-cli-email','ct-cli-contact','ct-cli-inv',
   'ct-first-l','ct-later-l','ct-annual-ml','ct-supply-items','ct-supply-days','ct-split-fee','ct-gs1-fee','ct-sgs-fee','ct-penalty','ct-dep','ct-bal','ct-note','ct-quote-expiry','ct-result']
    .forEach(id=>{ const e=ctG(id); if(e){ if(e.tagName==='DIV') e.innerHTML=''; else e.value=''; } });
  ctSet('ct-sign', ctTodayYmd()); ctSet('ct-term-start', ctTodayYmd()); ctSet('ct-term-end', ctAddYear(ctTodayYmd()));
  ctSet('ct-owner','b'); ctSet('ct-gs1','none'); ctSet('ct-tax','inc'); ctSet('ct-discount','0.75');
  ctG('ct-supply').checked=false; ctG('ct-sgs').checked=false;
  ctG('ct-prod-body').innerHTML=''; ctAddProdRow();
  try{ const s=JSON.parse(localStorage.getItem(CT_LS_KEY)||'{}'); ctSet('ct-our-contact', s.contact||''); ctSet('ct-our-email', s.email||''); }catch(_){}
  ctSetType('oem');
}
function ctSetType(t){
  document.querySelectorAll('#ct-type-chips .fchip').forEach(b=>b.classList.toggle('on', b.dataset.t===t));
  ctG('ct-sec-oem').style.display = t==='oem' ? '' : 'none';
  ctG('ct-sec-consign').style.display = t==='consign' ? '' : 'none';
  ctG('ct-party-label').textContent = t==='oem' ? '甲方（委託廠商）' : '乙方（受託銷售人）';
  ctG('ct-inv-wrap').style.display = t==='oem' ? '' : 'none';
}
function ctType(){ const b=document.querySelector('#ct-type-chips .fchip.on'); return b ? b.dataset.t : 'oem'; }
function ctApplyPrefill(d, forceType){
  const q=d.quote, c=d.customer, cc=d.consignCustomer;
  const type=forceType || ctTypeGuess(q);
  ctSetType(type);
  ctSet('ct-cli-name', (q&&q.clientName)||(c&&c.name)||'');
  ctSet('ct-cli-contact', (q&&q.contactName)||(c&&c.contact)||(cc&&cc.contact)||'');
  ctSet('ct-cli-phone', (q&&q.contactPhone)||(c&&c.phone)||(cc&&cc.phone)||'');
  ctSet('ct-cli-tax', (q&&q.clientTaxId)||(c&&c.tax_id)||'');
  ctSet('ct-cli-addr', (q&&q.clientAddress)||(c&&c.address)||(cc&&cc.ship_address)||'');
  ctSet('ct-cli-email', (c&&c.email)||'');
  ctSet('ct-cli-inv', (q&&q.invoiceTitle)||(c&&c.invoice_title)||'');
  if(q){
    ctSet('ct-tax', q.priceMode==='exc' ? 'exc' : 'inc');
    ctSet('ct-quote-expiry', q.expiryDate||'');
    const items=(q.items||[]).filter(it=>it.itemType==='bottle' && String(it.name||'').trim());
    ctG('ct-prod-body').innerHTML='';
    if(items.length) items.forEach(it=>ctAddProdRow({ name:it.name, volume:it.volume, qty:it.qty, unitPrice:it.unitPrice }));
    else ctAddProdRow();
    if(d.pay){ ctSet('ct-dep', d.pay.dep||''); ctSet('ct-bal', d.pay.bal||''); }
  }
  if(cc && cc.default_discount){ const dd=Number(cc.default_discount); if(dd>0 && dd<=1) ctSet('ct-discount', dd); else if(dd>1 && dd<=100) ctSet('ct-discount', dd/100); }
}
function ctAddProdRow(p){
  p=p||{};
  const tr=document.createElement('tr');
  tr.className='ct-prod-row';
  tr.innerHTML=`<td><input class="fi" data-f="name" placeholder="品名（酒標品名）" value="${escAttr(p.name||'')}"></td>
    <td><input class="fi" data-f="abv" type="number" step="0.1" placeholder="標示度數" value="${escAttr(p.abv||'')}"></td>
    <td><input class="fi" data-f="abvCalc" type="number" step="0.01" placeholder="配方計算值" value="${escAttr(p.abvCalc||'')}"></td>
    <td><input class="fi" data-f="volume" type="number" placeholder="ml" value="${escAttr(p.volume||'')}"></td>
    <td><input class="fi" data-f="qty" type="number" placeholder="瓶" value="${escAttr(p.qty||'')}"></td>
    <td><input class="fi" data-f="unitPrice" type="number" placeholder="單價" value="${escAttr(p.unitPrice||'')}"></td>
    <td class="ct-prod-act"><button class="rec-act-btn ct-rcp-btn" onclick="ctRcpToggle(this)" title="附件二 產品配方及規格表：從酒譜書／獨立 Run Card 帶入或手填">配方</button><button class="rec-act-btn del" onclick="ctRemoveProdRow(this)" title="移除">✕</button></td>`;
  ctG('ct-prod-body').appendChild(tr);
  const d=document.createElement('tr');
  d.className='ct-rcp-row'; d.style.display='none';
  d.innerHTML=`<td colspan="7"><div class="ct-rcp">
      <div class="ct-rcp-bar">
        <span class="ct-rcp-lbl">附件二 配方來源</span>
        <select class="fi ct-rcp-src"><option value="">（載入中…）</option></select>
        <button class="rec-act-btn primary" onclick="ctRcpImport(this)">帶入</button>
        <button class="rec-act-btn" onclick="ctRcpAddRow(this.closest('.ct-rcp').querySelector('tbody'))"><i class="ti ti-plus"></i> 加一列</button>
        <span class="ct-rcp-note"></span>
      </div>
      <table class="rec-table ct-rcp-tbl"><thead><tr><th>#</th><th>原料名稱／品牌</th><th>占比 %</th><th>實際體積 ml</th><th>原料酒精度 %</th><th>提供方</th><th>備註</th><th></th></tr></thead><tbody></tbody></table>
      <div class="ct-rcp-foot"><label>製程摘要／特殊條件 <input class="fi ct-rcp-proc" placeholder="空白＝合約上留手寫線"></label>
        <span class="ct-rcp-sum"></span></div>
    </div></td>`;
  ctG('ct-prod-body').appendChild(d);
  if(p.recipe){ ctRcpFill(d, p.recipe); }
}
function ctRemoveProdRow(btn){ const tr=btn.closest('tr'); const d=tr.nextElementSibling; if(d&&d.classList.contains('ct-rcp-row')) d.remove(); tr.remove(); }

/* ---------- 附件二 配方帶入（2026-09-16） ---------- */
let CT_RCP_SRC=null;   // contractRecipeSources 結果（每次開表單清空；後端另有 10 分鐘快取）
function ctRcpToggle(btn){
  const tr=btn.closest('tr'), d=tr.nextElementSibling;
  if(!d||!d.classList.contains('ct-rcp-row')) return;
  const open=d.style.display==='none';
  d.style.display=open?'':'none'; btn.classList.toggle('on', open);
  if(open) ctRcpEnsureSources(d.querySelector('.ct-rcp-src'));
}
function ctRcpSrcOptions(src){
  const cli=ctVal('ct-cli-name');
  const esc=escHtml, ea=escAttr;
  let html='<option value="">— 選擇酒譜書分頁或獨立 Run Card —</option>';
  const books=(src.books||[]).slice().sort((a,b)=>(b.matched?1:0)-(a.matched?1:0));
  const rcs=(src.runcards||[]).slice().sort((a,b)=>(b.matched?1:0)-(a.matched?1:0));
  const rcM=rcs.filter(r=>r.matched), rcO=rcs.filter(r=>!r.matched);
  const rcOpt=r=>`<option value="${ea('runcard|'+r.id)}">${esc(r.id)}　${esc(r.product||'')}${r.client?'（'+esc(r.client)+'）':''}${r.status?'・'+esc(r.status):''}</option>`;
  if(rcM.length) html+=`<optgroup label="🧪 獨立 Run Card（${esc(cli||'本客戶')}）">${rcM.map(rcOpt).join('')}</optgroup>`;
  books.forEach(b=>{
    if(!(b.recipes||[]).length) return;
    html+=`<optgroup label="${b.matched?'★ ':''}酒譜書：${ea(b.key)}">${b.recipes.map(r=>`<option value="${ea('sheet|'+b.key+'|'+r.sheet)}">${esc(r.recipeName||r.sheet)}${r.recipeName&&r.recipeName!==r.sheet?'　<small>'+esc(r.sheet)+'</small>':''}</option>`).join('')}</optgroup>`;
  });
  if(rcO.length) html+=`<optgroup label="🧪 其他獨立 Run Card">${rcO.map(rcOpt).join('')}</optgroup>`;
  return html;
}
async function ctRcpEnsureSources(sel, force){
  if(CT_RCP_SRC && !force){ if(sel && sel.options.length<=1) sel.innerHTML=ctRcpSrcOptions(CT_RCP_SRC); return CT_RCP_SRC; }
  try{
    const d=await apiCall({ action:'contractRecipeSources', token:AUTH_TOKEN, clientName:ctVal('ct-cli-name'), force:!!force });
    if(!d.ok) throw new Error(d.error||'載入配方來源失敗');
    CT_RCP_SRC=d;
    document.querySelectorAll('#ct-prod-body .ct-rcp-src').forEach(s=>{ const v=s.value; s.innerHTML=ctRcpSrcOptions(d); if(v) s.value=v; });
  }catch(e){ if(sel) sel.innerHTML=`<option value="">（載入失敗：${escHtml(e.message||'')}）</option>`; toast(e.message||'載入配方來源失敗','err'); }
  return CT_RCP_SRC;
}
function ctRcpAddRow(tbody, r){
  r=r||{};
  const tr=document.createElement('tr');
  const by=r.by||'乙';
  tr.innerHTML=`<td class="ct-rcp-idx"></td>
    <td><input class="fi" data-r="name" value="${escAttr(r.name||'')}" placeholder="原料／品牌">${r.method?`<input class="fi ct-rcp-method" data-r="method" value="${escAttr(r.method)}" placeholder="製作方式">`:''}</td>
    <td><input class="fi" data-r="pct" type="number" step="0.01" value="${escAttr(r.pct==null?'':r.pct)}" oninput="ctRcpRecalc(this)"></td>
    <td><input class="fi" data-r="vol" type="number" step="0.1" value="${escAttr(r.vol==null?'':r.vol)}"></td>
    <td><input class="fi" data-r="abv" type="number" step="0.01" value="${escAttr(r.abv==null?'':r.abv)}" oninput="ctRcpRecalc(this)"></td>
    <td><select class="fi" data-r="by"><option value="乙"${by==='乙'?' selected':''}>乙方</option><option value="甲"${by==='甲'?' selected':''}>甲方</option><option value=""${by===''?' selected':''}>—</option></select></td>
    <td><input class="fi" data-r="note" value="${escAttr(r.note||'')}" placeholder="備註"></td>
    <td><button class="rec-act-btn del" onclick="const tb=this.closest('tbody');this.closest('tr').remove();ctRcpRenumber(tb)">✕</button></td>`;
  tbody.appendChild(tr);
  ctRcpRenumber(tbody);
}
function ctRcpRenumber(tbody){ [...tbody.querySelectorAll('tr')].forEach((tr,i)=>{ tr.querySelector('.ct-rcp-idx').textContent=i+1; }); ctRcpRecalc(tbody); }
function ctRcpRecalc(el){
  const panel=el.closest('.ct-rcp'); if(!panel) return;
  const rows=[...panel.querySelectorAll('tbody > tr')];
  let pct=0, abv=0;
  rows.forEach(tr=>{ const p=Number(tr.querySelector('[data-r=pct]').value)||0, a=Number(tr.querySelector('[data-r=abv]').value)||0; pct+=p; abv+=p*a/100; });
  const sum=panel.querySelector('.ct-rcp-sum');
  sum.innerHTML=rows.length?`占比合計 <b${Math.abs(pct-100)>0.5?' class="ct-rcp-bad"':''}>${Math.round(pct*100)/100}%</b>　占比加權酒精度 <b>${Math.round(abv*100)/100}%</b>`:'';
  panel.dataset.abvCalc=rows.length?String(Math.round(abv*100)/100):'';
}
function ctRcpProdRow(panel){ return panel.closest('tr').previousElementSibling; }
function ctRcpGuessBy(name){
  if(!ctG('ct-supply').checked) return '乙';
  const items=ctVal('ct-supply-items'); if(!items) return '乙';
  const n=String(name||'').replace(/[\s　]/g,'');
  return items.split(/[、,，;；\/／\s]+/).some(x=>{ x=x.replace(/[\s　]/g,''); return x && (n.includes(x)||x.includes(n)); }) ? '甲' : '乙';
}
function ctRcpFill(detailTr, rcp){
  const panel=detailTr.querySelector('.ct-rcp'), tbody=panel.querySelector('tbody');
  tbody.innerHTML='';
  const prod=ctRcpProdRow(panel);
  const bottle=Number(prod.querySelector('[data-f=volume]').value)||0;
  (rcp.rows||[]).forEach(r=>{
    const pct=Number(r.pct)||0;
    const vol=(pct>0&&bottle>0) ? Math.round(bottle*pct/100*10)/10 : (r.vol===''||r.vol==null?'':r.vol);
    ctRcpAddRow(tbody,{ name:r.name, method:r.method||'', pct:(r.pct===''||r.pct==null)?'':pct, vol, abv:(r.abv===''||r.abv==null)?'':r.abv, by:r.by||ctRcpGuessBy(r.name), note:r.note||'' });
  });
  panel.querySelector('.ct-rcp-proc').value=rcp.processNote||'';
  panel.dataset.source=rcp.source||''; panel.dataset.totalVol=rcp.totalVol||'';
  panel.querySelector('.ct-rcp-note').textContent=rcp.source?('來源：'+rcp.source+(rcp.totalVol?'（配方總體積 '+rcp.totalVol+' ml，體積已按單瓶容量換算）':'')):'';
  ctRcpRecalc(tbody);
  const ac=prod.querySelector('[data-f=abvCalc]');
  if(panel.dataset.abvCalc && (!ac.value || rcp.abv)) ac.value=rcp.abv||panel.dataset.abvCalc;
  const btn=prod.querySelector('.ct-rcp-btn'); if(btn) btn.textContent='配方 '+tbody.querySelectorAll('tr').length;
}
async function ctRcpImport(btn){
  const panel=btn.closest('.ct-rcp'), sel=panel.querySelector('.ct-rcp-src');
  const v=sel.value; if(!v){ toast('請先選一個配方來源','err'); return; }
  const [src,a,b]=v.split('|');
  if(panel.querySelector('tbody > tr') && !confirm('會覆蓋目前這款的配方表，確定帶入？')) return;
  btn.disabled=true;
  try{
    const q=src==='sheet' ? { action:'contractRecipeFetch', token:AUTH_TOKEN, src, key:a, sheet:b } : { action:'contractRecipeFetch', token:AUTH_TOKEN, src, id:a };
    const d=await apiCall(q);
    if(!d.ok) throw new Error(d.error||'帶入失敗');
    ctRcpFill(panel.closest('tr'), d);
    const prod=ctRcpProdRow(panel), nm=prod.querySelector('[data-f=name]');
    if(!nm.value && d.recipeName) nm.value=d.recipeName;
    toast('已帶入 '+(d.rows||[]).length+' 項原料，請核對後再產合約','ok');
  }catch(e){ toast(e.message||'帶入失敗','err'); }
  finally{ btn.disabled=false; }
}
function ctRcpCollect(detailTr){
  if(!detailTr||!detailTr.classList.contains('ct-rcp-row')) return null;
  const panel=detailTr.querySelector('.ct-rcp');
  const rows=[...panel.querySelectorAll('tbody > tr')].map(tr=>{ const o={}; tr.querySelectorAll('[data-r]').forEach(i=>{ o[i.dataset.r]=String(i.value||'').trim(); }); return o; }).filter(o=>o.name);
  const proc=panel.querySelector('.ct-rcp-proc').value.trim();
  if(!rows.length && !proc) return null;
  return { source:panel.dataset.source||'', totalVol:Number(panel.dataset.totalVol)||0, abvCalc:panel.dataset.abvCalc||'', processNote:proc, rows };
}
function ctCollect(){
  const type=ctType();
  const p={
    type, quoteNo:ctVal('ct-quote-no'), signDate:ctVal('ct-sign'),
    clientName:ctVal('ct-cli-name'), clientRep:ctVal('ct-cli-rep'), clientTaxId:ctVal('ct-cli-tax'), clientAddr:ctVal('ct-cli-addr'),
    clientPhone:ctVal('ct-cli-phone'), clientEmail:ctVal('ct-cli-email'), clientContact:ctVal('ct-cli-contact'),
    note:ctVal('ct-note')
  };
  if(type==='oem'){
    Object.assign(p,{
      invoiceTitle:ctVal('ct-cli-inv'), quoteExpiry:ctVal('ct-quote-expiry'), taxMode:ctVal('ct-tax'),
      termStart:ctVal('ct-term-start'), termEnd:ctVal('ct-term-end'),
      firstBatchL:Number(ctVal('ct-first-l'))||0, laterBatchL:Number(ctVal('ct-later-l'))||0,
      formulaOwner:ctVal('ct-owner'), annualMinMl:Number(ctVal('ct-annual-ml'))||0,
      clientSupplies:ctG('ct-supply').checked, supplyItems:ctVal('ct-supply-items'), supplyDays:Number(ctVal('ct-supply-days'))||0,
      splitShipFee:Number(ctVal('ct-split-fee'))||0, gs1:ctVal('ct-gs1'), gs1Fee:Number(ctVal('ct-gs1-fee'))||0,
      sgs:ctG('ct-sgs').checked, sgsFee:Number(ctVal('ct-sgs-fee'))||0, secrecyPenalty:Number(ctVal('ct-penalty'))||0,
      depositAmt:Number(ctVal('ct-dep'))||0, balanceAmt:Number(ctVal('ct-bal'))||0,
      ourContact:ctVal('ct-our-contact'), ourEmail:ctVal('ct-our-email'),
      products:[...ctG('ct-prod-body').querySelectorAll('tr.ct-prod-row')].map(tr=>{
        const o={}; tr.querySelectorAll('[data-f]').forEach(i=>{ o[i.dataset.f]=String(i.value||'').trim(); });
        const rcp=ctRcpCollect(tr.nextElementSibling); if(rcp) o.recipe=rcp;   // 2026-09-16 附件二配方表
        return o;
      }).filter(o=>o.name)
    });
  } else {
    Object.assign(p,{ discount:Number(ctVal('ct-discount'))||0.75, termStart:ctVal('ct-sign'), termEnd:ctAddYear(ctVal('ct-sign')) });
  }
  return p;
}
async function ctGenerate(){
  const p=ctCollect();
  if(!p.clientName){ toast('請填客戶名稱','err'); return; }
  if(!p.signDate){ toast('請填簽約日期','err'); return; }
  if(p.type==='oem' && !p.products.length){ toast('代工合約至少要有一款產品','err'); return; }
  if(p.type==='oem' && !p.clientRep){ if(!confirm('甲方「代表人」沒填，合約簽署欄會留空。仍要產生嗎？')) return; }
  try{ localStorage.setItem(CT_LS_KEY, JSON.stringify({ contact:p.ourContact||'', email:p.ourEmail||'' })); }catch(_){}
  const btn=ctG('ct-gen-btn'); btn.disabled=true; btn.innerHTML='<i class="ti ti-loader"></i>產生中（約 15–30 秒）…';
  try{
    const d=await apiCall({ action:'generateContract', token:AUTH_TOKEN, type:p.type, params:p });
    if(!d.ok) throw new Error(d.error||'產生失敗');
    if(typeof downloadBase64_==='function') downloadBase64_(d.pdfBase64, 'application/pdf', d.fileNameBase+'.pdf');
    ctG('ct-result').innerHTML=`<div class="ct-done"><b>已產生 ${escHtml(d.contractNo)}</b>
      <a class="rec-act-btn primary" href="${escAttr(d.docUrl)}" target="_blank" rel="noopener">開啟 Google 文件（可手改）</a>
      <a class="rec-act-btn" href="${escAttr(d.pdfUrl)}" target="_blank" rel="noopener">PDF</a>
      ${d.docxUrl?`<a class="rec-act-btn" href="${escAttr(d.docxUrl)}" target="_blank" rel="noopener">Word</a>`:''}
      <div style="font-size:11px;color:#6B6B63;margin-top:6px">※ 附件二配方表沒帶入的款會留空白表格供手寫；特殊條款請直接在 Google 文件上改，改完用「檔案 → 下載」重出 PDF。</div></div>`;
    toast('合約已產生並開始下載 PDF','ok');
    rcClear(); CT_LIST=null;
    if(currentPage==='contract') loadContracts(true);
  }catch(e){ toast(e.message||'產生失敗','err'); }
  finally{ btn.disabled=false; btn.innerHTML='<i class="ti ti-file-certificate"></i>產生合約'; }
}
