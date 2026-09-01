/* ============================================================
   2026-08-28：客戶寄倉（一次性採購買斷後寄放我方倉庫）
   ・跟「寄售」是兩套帳：寄售＝貨還是我方的、賣掉才結；寄倉＝客戶已買斷、只是放我們倉庫
   ・後端：storage_ledger 表（v4_storage.gs）；action：getStorageData / addStorageMove / deleteStorageMove
   ・畫面：寄售管理頁最下方「客戶寄倉」卡片——彙總（入倉/提領/剩餘）＋明細＋登記表單
   ============================================================ */
let ST_MOVES=null, ST_DIR='in', ST_LOADING=false;
/* 任何寫入動作清快取時，寄倉資料一起重置（下次進頁面重抓），比照 OWNBRAND_PRODUCTS 的做法 */
if(typeof onCacheClear==='function') onCacheClear(function(){ ST_MOVES=null; });

/* 進寄售管理頁時呼叫（initConsignPage 內）；force＝按「重新整理」 */
async function loadStorage(force){
  if(ST_LOADING) return;
  if(ST_MOVES && !force){ stRender(); return; }
  if(!AUTH_TOKEN) return;
  ST_LOADING=true;
  try{
    const r=await readCall({action:'getStorageData', token:AUTH_TOKEN}, force);
    if(!r.ok) throw new Error(r.error||'載入寄倉資料失敗');
    ST_MOVES=(r.moves||[]);
    stRender();
  }catch(e){ toast(e.message||'載入寄倉資料失敗','err'); }
  finally{ ST_LOADING=false; }
}
function stCustomers(){
  const s=new Set(); (ST_MOVES||[]).forEach(m=>{ if(m.customer) s.add(String(m.customer)); });
  return [...s].sort((a,b)=>a.localeCompare(b,'zh-Hant'));
}
/* 彙總：客戶＋酒款（sku_id 優先，自行輸入款用 名稱|容量 當 key）→ {in,out} */
function stKey(m){ return String(m.customer)+'␟'+(m.sku_id?('S:'+m.sku_id):('F:'+(m.name||'')+'|'+(m.volume||''))); }
function stSummary(filterCus){
  const map={};
  (ST_MOVES||[]).forEach(m=>{
    if(filterCus && String(m.customer)!==filterCus) return;
    const k=stKey(m);
    if(!map[k]) map[k]={customer:m.customer, name:m.name||m.sku_id||'—', volume:m.volume||'', in:0, out:0};
    const q=parseFloat(m.qty)||0;
    if(String(m.direction)==='out') map[k].out+=q; else map[k].in+=q;
  });
  return Object.values(map).sort((a,b)=>String(a.customer).localeCompare(String(b.customer),'zh-Hant')||String(a.name).localeCompare(String(b.name),'zh-Hant'));
}
/* 某客戶某酒款目前剩餘（提領防呆用） */
function stBalanceFor(cus, skuId, name, vol){
  let bal=0;
  (ST_MOVES||[]).forEach(m=>{
    if(String(m.customer)!==String(cus)) return;
    const same = skuId ? (String(m.sku_id)===String(skuId))
                       : (!m.sku_id && String(m.name||'')===String(name||'') && String(m.volume||'')===String(vol||''));
    if(!same) return;
    const q=parseFloat(m.qty)||0;
    bal += (String(m.direction)==='out') ? -q : q;
  });
  return bal;
}
function stRender(){
  const cusSel=document.getElementById('st-customer'); if(!cusSel) return;
  const cur=cusSel.value;
  const cus=stCustomers();
  cusSel.innerHTML='<option value="">全部客戶</option>'+cus.map(c=>`<option value="${escAttr(c)}"${c===cur?' selected':''}>${escHtml(c)}</option>`).join('');
  { const dl=document.getElementById('st-cuslist'); if(dl) dl.innerHTML=cus.map(c=>`<option value="${escAttr(c)}">`).join(''); }
  const filter=cusSel.value;
  const sum=stSummary(filter);
  const inv=document.getElementById('st-inv-body');
  if(inv) inv.innerHTML=sum.length?sum.map(r=>{
    const bal=r.in-r.out;
    return `<tr><td data-l="客戶">${escHtml(r.customer)}</td><td data-l="酒款">${escHtml(r.name)}</td>
      <td data-l="容量" style="text-align:center">${escHtml(r.volume||'—')}</td>
      <td data-l="已入倉" style="text-align:right">${r.in.toLocaleString()}</td>
      <td data-l="已提領" style="text-align:right">${r.out.toLocaleString()}</td>
      <td data-l="剩餘" style="text-align:right"><strong style="color:${bal>0?'var(--ink)':'var(--hint)'}">${bal.toLocaleString()}</strong></td></tr>`;
  }).join(''):'<tr><td colspan="6" class="rec-empty">尚無寄倉紀錄</td></tr>';
  const rows=(ST_MOVES||[]).filter(m=>!filter||String(m.customer)===filter)
    .slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||String(b.move_id||'').localeCompare(String(a.move_id||'')));
  const lg=document.getElementById('st-ledger-body');
  if(lg) lg.innerHTML=rows.length?rows.map(m=>{
    const isOut=String(m.direction)==='out';
    return `<tr><td data-l="日期">${escHtml(m.date||'')}</td>
      <td data-l="類型"><span style="font-weight:600;color:${isOut?'#B0483A':'#4A7A46'}">${isOut?'提領':'入倉'}</span></td>
      <td data-l="客戶">${escHtml(m.customer||'')}</td>
      <td data-l="酒款">${escHtml((m.name||m.sku_id||'—')+(m.volume?('（'+m.volume+'）'):''))}</td>
      <td data-l="數量" style="text-align:right">${(parseFloat(m.qty)||0).toLocaleString()}</td>
      <td data-l="單號">${escHtml(m.quote_no||'—')}</td>
      <td data-l="備註">${escHtml(m.note||'')}</td>
      <td style="text-align:right"><button class="rec-act-btn" title="刪除這筆（登記錯了才用）" onclick="stDeleteMove('${escAttr(m.move_id)}')">✕</button></td></tr>`;
  }).join(''):'<tr><td colspan="8" class="rec-empty">尚無寄倉紀錄</td></tr>';
}
/* ---- 登記表單 ---- */
function stOpenForm(dir){
  ST_DIR=(dir==='out')?'out':'in';
  const box=document.getElementById('st-form'); if(!box) return;
  box.style.display='block';
  { const t=document.getElementById('st-form-title'); if(t) t.textContent=(ST_DIR==='out')?'登記提領（客戶把酒領走）':'登記入倉（客戶的酒放進我方倉庫）'; }
  { const d=document.getElementById('st-f-date'); if(d && !d.value) d.value=todayStr(); }
  { const c=document.getElementById('st-f-cus'); if(c && !c.value){ const f=document.getElementById('st-customer'); if(f&&f.value) c.value=f.value; } }
  stFillSkuOptions();
}
function stCloseForm(){
  const box=document.getElementById('st-form'); if(box) box.style.display='none';
  ['st-f-cus','st-f-qty','st-f-no','st-f-note','st-f-name','st-f-vol'].forEach(id=>{ const e=document.getElementById(id); if(e) e.value=''; });
  { const s=document.getElementById('st-f-sku'); if(s) s.value=''; }
  stSkuChange();
}
function stFillSkuOptions(){
  const s=document.getElementById('st-f-sku'); if(!s) return;
  const build=()=>{
    /* cur 要在「重建當下」才讀：公版酒清單是非同步載入（寫入後快取被清就要重抓），
       使用者可能在載入完成前就先選好了，用呼叫當下抓的舊值會把選擇蓋掉 */
    const cur=s.value;
    const ps=(OWNBRAND_PRODUCTS||[]);
    s.innerHTML='<option value="">選擇公版酒…</option>'
      +ps.map(p=>`<option value="${escAttr(p.sku_id)}"${String(p.sku_id)===cur?' selected':''}>${escHtml(p.name+'（'+p.volume+'）')}</option>`).join('')
      +'<option value="__free"'+(cur==='__free'?' selected':'')+'>其他（自行輸入酒款）</option>';
  };
  if(OWNBRAND_PRODUCTS) build();
  else if(AUTH_TOKEN){ loadOwnbrandData().then(build).catch(()=>{ s.innerHTML='<option value="__free">其他（自行輸入酒款）</option>'; stSkuChange(); }); }
  else s.innerHTML='<option value="__free">其他（自行輸入酒款）</option>';
}
function stSkuChange(){
  const s=document.getElementById('st-f-sku'), w=document.getElementById('st-f-freewrap');
  if(w) w.style.display=(s&&s.value==='__free')?'block':'none';
}
let _stSaving=false; btnBusy('st-f-save',false);
async function stSaveMove(){
  if(_stSaving) return; _stSaving=true; btnBusy('st-f-save',true,'登記中…');
  try{
    const cus=(document.getElementById('st-f-cus').value||'').trim();
    const date=document.getElementById('st-f-date').value||todayStr();
    const skuSel=document.getElementById('st-f-sku').value;
    const qty=parseFloat(document.getElementById('st-f-qty').value);
    const quoteNo=(document.getElementById('st-f-no').value||'').trim();
    const note=(document.getElementById('st-f-note').value||'').trim();
    if(!cus){ toast('請填客戶名稱','err'); return; }
    if(!(qty>0)){ toast('數量要大於 0','err'); return; }
    let skuId='', name='', vol='';
    if(skuSel && skuSel!=='__free'){
      const p=(typeof ownbrandBySku==='function')?ownbrandBySku(skuSel):null;
      skuId=skuSel; name=p?p.name:skuSel; vol=p?String(p.volume||''):'';
    } else if(skuSel==='__free'){
      name=(document.getElementById('st-f-name').value||'').trim();
      vol=(document.getElementById('st-f-vol').value||'').trim();
      if(!name){ toast('請填酒款名稱','err'); return; }
    } else { toast('請選公版酒（或選「其他」自行輸入）','err'); return; }
    if(ST_DIR==='out'){
      const bal=stBalanceFor(cus, skuId, name, vol);
      if(qty>bal){ toast(`提領超過剩餘量（${escHtml(cus)}／${escHtml(name)} 目前剩 ${bal} 瓶）。登記錯了可在明細用 ✕ 刪掉重登。`,'err'); return; }
    }
    const r=await apiCall({action:'addStorageMove', token:AUTH_TOKEN,
      date:date, customer:cus, sku_id:skuId, name:name, volume:vol,
      direction:ST_DIR, qty:qty, quote_no:quoteNo, note:note});
    if(!r.ok) throw new Error(r.error||'登記失敗');
    toast((ST_DIR==='out'?'已登記提領 ':'已登記入倉 ')+qty+' 瓶','ok');
    stCloseForm();
    await loadStorage(true);
  }catch(e){ toast(e.message||'登記失敗','err'); }
  finally{ _stSaving=false; btnBusy('st-f-save',false); }
}
let _stDeleting=false;
async function stDeleteMove(moveId){
  if(!moveId||_stDeleting) return;
  if(!confirm('確定刪除這筆寄倉紀錄？（只有登記錯誤才建議刪除，刪除會留在異動日誌）')) return;
  _stDeleting=true;
  try{
    const r=await apiCall({action:'deleteStorageMove', token:AUTH_TOKEN, move_id:moveId});
    if(!r.ok) throw new Error(r.error||'刪除失敗');
    toast('已刪除','ok');
    await loadStorage(true);
  }catch(e){ toast(e.message||'刪除失敗','err'); }
  finally{ _stDeleting=false; }
}

/* ============================================================
   2026-08-28 下午：驗收單 → 寄倉庫存自動登記（設計主軸：輸入一次、其他自動同步）
   ・資料全部從驗收單帶（客戶／單號／品項／容量／本次出貨數／配送日），使用者不用重打
   ・聰明預設：該客戶該酒款寄倉已有庫存 → 預設「客戶提走（提領）」；沒有 → 預設「入倉」
   ・冪等：每筆帶 src='VF:<單號>:<第幾次出貨>'，後端同 src 會跳過，重印驗收單不會重複計
   ============================================================ */
/* 某客戶在寄倉的總剩餘（不分酒款）——判斷聰明預設用 */
function stCustomerTotal(cus){
  let bal=0;
  (ST_MOVES||[]).forEach(m=>{
    if(String(m.customer)!==String(cus)) return;
    bal += (String(m.direction)==='out' ? -1 : 1) * (parseFloat(m.qty)||0);
  });
  return bal;
}
/* 驗收單存檔後呼叫：把這批「本次出貨」寫進寄倉帳
   d：驗收單資料（client/no/shipDate/rows），dir：'in'｜'out'，srcTag：第幾次出貨 */
async function stSyncFromVerify(d, dir, srcTag){
  const moves=(d.rows||[])
    .map(r=>({ qty:parseFloat(r.thisShip)||0, name:r.name, vol:r.vol }))
    .filter(r=>r.qty>0)
    .map(r=>({ customer:d.client, sku_id:'', name:r.name, volume:(r.vol?String(r.vol).replace(/ml$/i,'')+'ml':''),
      direction:dir, qty:r.qty, date:d.shipDate||todayStr(), quote_no:d.no,
      note:(dir==='in'?'驗收單自動入倉':'驗收單自動提領'),
      src:'VF:'+d.no+':'+srcTag+':'+r.name+':'+(r.vol||'') }));
  if(!moves.length) return { ok:true, saved:[], skipped:[] };
  const r=await apiCall({action:'addStorageMoves', token:AUTH_TOKEN, moves});
  if(!r.ok) throw new Error(r.error||'寄倉登記失敗');
  ST_MOVES=null;
  const nSave=(r.saved||[]).length, nSkip=(r.skipped||[]).length;
  if(nSave) toast(`已自動${dir==='in'?'入倉':'登記提領'} ${nSave} 個品項到客戶寄倉`,'ok');
  if(nSkip){
    const why=(r.skipped||[]).map(x=>x.reason).filter((v,i,a)=>a.indexOf(v)===i).join('；');
    toast(`寄倉有 ${nSkip} 筆沒登記：${why}`, nSave?'ok':'err');
  }
  return r;
}
