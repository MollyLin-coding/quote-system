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
/* 2026-09-30e：客戶名稱比對不分大小寫、忽略前後與中間空白——「Babyface」「babyface」「baby face」同一本帳
   （報價單 20260701-01 客戶名是 Babyface、其他張是 babyface，驗收單提領時扣不到）。後端 storageCusKey_ 同一套。
   顯示與寫入一律用帳上已有的那個拼法（stCusCanon），避免再長出第二種寫法。 */
function stCusKey(v){ return String(v==null?'':v).trim().toLowerCase().replace(/\s+/g,''); }
function stCusCanon(name){
  const k=stCusKey(name); if(!k) return String(name==null?'':name).trim();
  const hit=(ST_MOVES||[]).find(m=>!stVoided(m) && stCusKey(m.customer)===k) || (ST_MOVES||[]).find(m=>stCusKey(m.customer)===k);
  return hit ? String(hit.customer) : String(name).trim();
}
function stCustomers(){
  const seen={}, out=[];
  (ST_MOVES||[]).forEach(m=>{ const k=stCusKey(m.customer); if(!k||seen[k]) return; seen[k]=1; out.push(String(m.customer)); });
  return out.sort((a,b)=>a.localeCompare(b,'zh-Hant'));
}
/* 彙總：客戶＋酒款（sku_id 優先，自行輸入款用 名稱|容量 當 key）→ {in,out} */
/* 2026-09-01 複檢：同一支酒，手動登記（有選公版酒＝有 sku_id）與驗收單自動登記（沒有 sku_id）
   原本會被算成兩本帳 → 彙總表出現兩列，而且她要登記客戶真的來提貨時會被「提領超過剩餘量」擋死。
   改成：**兩邊都有 sku_id 才比 sku_id，否則一律比「酒款名＋容量」**（後端 v71 的判斷同步改成一樣）。 */
function stNm(v){ return String(v==null?'':v).trim().toLowerCase().replace(/\s+/g,''); }
function stVol(v){ return stNm(v).replace(/ml$/,''); }
/* 2026-09-30 Molly：「寄倉庫存明細我需要顯示是哪一個 lot 號」＋「彙總也分 Lot」
   → 寄倉每筆多一個 lot 欄；彙總依 客戶＋酒款＋容量＋Lot 分列；提領要指定 Lot、餘額也按 Lot 算。
   Lot 比對不分大小寫、忽略空白與開頭的「Lot」：「Lot 18」「LOT18」「18」視為同一個（後端 storageLotKey_ 同一套）。
   顯示一律用 shpLotText 的格式（Lot 18）。舊紀錄沒有 Lot 的，歸在「未填 Lot」那一列。 */
function stLotKey(v){ return stNm(v).replace(/^lot[-_#:.]?/,''); }
function stLotFmt(v){
  const s=String(v==null?'':v).trim(); if(!s) return '';
  return (typeof shpLotText==='function') ? shpLotText(s) : (/^lot/i.test(s) ? s.replace(/^lot\s*/i,'Lot ').trim() : ('Lot '+s));
}
function stKey(m){ return stCusKey(m.customer)+'␟'+stNm(m.name)+'|'+stVol(m.volume)+'␟'+stLotKey(m.lot); }
function stSameItem(m, skuId, name, vol){
  return (skuId && m.sku_id) ? (String(m.sku_id)===String(skuId))
                             : (stNm(m.name)===stNm(name) && stVol(m.volume)===stVol(vol));
}
/* 2026-09-02 Molly 定案「都須留底」：寄倉紀錄不再真的刪掉，改成標記作廢。
   已作廢的列仍留在明細裡（灰色刪除線＋誰在什麼時候作廢的），但不列入餘額與彙總。 */
function stVoided(m){ return !!(m && String(m.void_at||'')!==''); }
function stSummary(filterCus){
  const map={};
  (ST_MOVES||[]).forEach(m=>{
    if(stVoided(m)) return;
    if(filterCus && stCusKey(m.customer)!==stCusKey(filterCus)) return;
    const k=stKey(m);
    if(!map[k]) map[k]={customer:m.customer, name:m.name||m.sku_id||'—', volume:m.volume||'', lot:stLotFmt(m.lot), sku_id:'', in:0, out:0, quotes:[]};
    { const qn=String(m.quote_no||'').trim(); if(qn && String(m.direction)!=='out' && map[k].quotes.indexOf(qn)<0) map[k].quotes.push(qn); }   // 這一列的酒是哪張報價單入倉的（多款提領產驗收單用）
    if(m.sku_id && !map[k].sku_id) map[k].sku_id=String(m.sku_id);
    if(m.sku_id && m.name) map[k].name=m.name;   // 同一支酒併成一列時，用有酒款編號那筆的名稱
    const q=parseFloat(m.qty)||0;
    if(String(m.direction)==='out') map[k].out+=q; else map[k].in+=q;
  });
  return Object.values(map).sort((a,b)=>String(a.customer).localeCompare(String(b.customer),'zh-Hant')||String(a.lot).localeCompare(String(b.lot),'zh-Hant',{numeric:true})||String(a.name).localeCompare(String(b.name),'zh-Hant'));
}
/* 某客戶某酒款目前剩餘（提領防呆用）；lot 有給（含空字串＝未填 Lot）就只算那個 Lot，沒給（undefined）＝全部 Lot 合計 */
function stBalanceFor(cus, skuId, name, vol, lot){
  let bal=0;
  (ST_MOVES||[]).forEach(m=>{
    if(stVoided(m)) return;
    if(stCusKey(m.customer)!==stCusKey(cus)) return;
    if(!stSameItem(m, skuId, name, vol)) return;
    if(lot!==undefined && stLotKey(m.lot)!==stLotKey(lot)) return;
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
  /* 2026-09-01 複檢 #23：原本清單只有「已經有寄倉紀錄的客戶」，第一次替某位客戶登記一定得手打，
     而寄倉是拿客戶名稱當帳本的 key ——「南野子」跟「南野子 」（多一個空白）會變成兩本帳。
     這裡把客戶主檔（登入時就抓好了）一起放進建議清單。 */
  { const dl=document.getElementById('st-cuslist');
    if(dl){
      const extra=[];
      try{ ((typeof CUS_MASTER!=='undefined' && Array.isArray(CUS_MASTER)) ? CUS_MASTER : []).forEach(c=>{   // 2026-09-11 複檢：原本讀錯成 CUS_DATA（只有進過客戶管理才有），員工永遠是空的
        const nm=String((c&&(c.name||c.client||c.company))||'').trim();
        if(nm && cus.indexOf(nm)<0 && extra.indexOf(nm)<0) extra.push(nm);
      }); }catch(e){}
      dl.innerHTML=cus.concat(extra).map(c=>`<option value="${escAttr(c)}">`).join('');
    } }
  const filter=cusSel.value;
  const sum=stSummary(filter);
  ST_SUM=sum;   // 2026-09-30c：每列的「提領」鈕靠索引找回這一列
  const inv=document.getElementById('st-inv-body');
  if(inv) inv.innerHTML=sum.length?sum.map((r,i)=>{
    const bal=r.in-r.out;
    return `<tr><td data-l="客戶">${escHtml(r.customer)}</td><td data-l="Lot" style="white-space:nowrap">${r.lot?escHtml(r.lot):'<span style="color:var(--hint)">未填</span>'}</td><td data-l="酒款">${escHtml(r.name)}</td>
      <td data-l="容量" style="text-align:center">${escHtml(r.volume||'—')}</td>
      <td data-l="已入倉" style="text-align:right">${r.in.toLocaleString()}</td>
      <td data-l="已提領" style="text-align:right">${r.out.toLocaleString()}</td>
      <td data-l="剩餘" style="text-align:right"><strong style="color:${bal>0?'var(--ink)':'var(--hint)'}">${bal.toLocaleString()}</strong></td>
      <td data-l="本次提領" style="text-align:right;white-space:nowrap">${bal>0?`<input type="number" class="fi st-pick-qty" data-i="${i}" min="0" max="${bal}" step="1" placeholder="0" style="width:84px;text-align:right;padding:5px 7px" oninput="stPickChange()">`:''}</td></tr>`;
  }).join(''):'<tr><td colspan="8" class="rec-empty">尚無寄倉紀錄</td></tr>';
  stPickChange();
  const rows=(ST_MOVES||[]).filter(m=>!filter||stCusKey(m.customer)===stCusKey(filter))
    .slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||String(b.move_id||'').localeCompare(String(a.move_id||'')));
  const lg=document.getElementById('st-ledger-body');
  if(lg) lg.innerHTML=rows.length?rows.map(m=>{
    const isOut=String(m.direction)==='out';
    const vd=stVoided(m);
    const vTip=vd?('已作廢'+(m.void_by?('／'+m.void_by):'')+(m.void_at?('　'+String(m.void_at).slice(0,16).replace('T',' ')):'')+(m.void_note?('　'+m.void_note):'')):'';
    if(vd) return `<tr style="opacity:.55"><td data-l="日期" style="text-decoration:line-through">${escHtml(m.date||'')}</td>
      <td data-l="類型"><span style="font-weight:600;color:var(--hint)">${isOut?'提領':'入倉'}（已作廢）</span></td>
      <td data-l="客戶" style="text-decoration:line-through">${escHtml(m.customer||'')}</td>
      <td data-l="Lot" style="text-decoration:line-through;white-space:nowrap">${escHtml(stLotFmt(m.lot)||'—')}</td>
      <td data-l="酒款" style="text-decoration:line-through">${escHtml((m.name||m.sku_id||'—')+(m.volume?('（'+m.volume+'）'):''))}</td>
      <td data-l="數量" style="text-align:right;text-decoration:line-through">${(parseFloat(m.qty)||0).toLocaleString()}</td>
      <td data-l="單號">${escHtml(m.quote_no||'—')}</td>
      <td data-l="備註" colspan="2" style="color:var(--hint);font-size:12px">${escHtml(vTip)}</td></tr>`;
    return `<tr><td data-l="日期">${escHtml(m.date||'')}</td>
      <td data-l="類型"><span style="font-weight:600;color:${isOut?'#B0483A':'#4A7A46'}">${isOut?'提領':'入倉'}</span></td>
      <td data-l="客戶">${escHtml(m.customer||'')}</td>
      <td data-l="Lot" style="white-space:nowrap">${escHtml(stLotFmt(m.lot)||'—')}</td>
      <td data-l="酒款">${escHtml((m.name||m.sku_id||'—')+(m.volume?('（'+m.volume+'）'):''))}</td>
      <td data-l="數量" style="text-align:right">${(parseFloat(m.qty)||0).toLocaleString()}</td>
      <td data-l="單號">${escHtml(m.quote_no||'—')}</td>
      <td data-l="備註">${escHtml(m.note||'')}</td>
      <td style="text-align:right"><button class="rec-act-btn" title="作廢這筆（登記錯了才用；紀錄會留著）" onclick="stDeleteMove('${escAttr(m.move_id)}')">作廢</button></td></tr>`;
  }).join(''):'<tr><td colspan="9" class="rec-empty">尚無寄倉紀錄</td></tr>';
  { const f=document.getElementById('st-form'); if(f && f.style.display!=='none' && ST_DIR==='out') stFillOutOptions(); }   // 提領表單開著：資料更新後酒款清單跟著重建
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
  stFillLotList();
}
/* 客戶欄改了：提領的酒款清單要跟著換成這位客戶的寄倉品項；Lot 建議清單也重算 */
function stCusChange(){ stFillSkuOptions(); stFillLotList(); }
/* Lot 建議清單：提領＝這位客戶目前還有剩的 Lot；入倉＝這位客戶用過的 Lot（新 Lot 直接打） */
function stFillLotList(){
  const dl=document.getElementById('st-lotlist'); if(!dl) return;
  const cus=((document.getElementById('st-f-cus')||{}).value||'').trim();
  const seen={}, out=[];
  stSummary(cus||'').forEach(r=>{
    if(!r.lot) return;
    if(ST_DIR==='out' && !(r.in-r.out>0)) return;
    const k=stLotKey(r.lot); if(seen[k]) return; seen[k]=1; out.push(r.lot);
  });
  dl.innerHTML=out.map(v=>`<option value="${escAttr(v)}">`).join('');
}
/* 填了對應報價單號、Lot 還空著 → 用報價紀錄同一套來源帶 Lot（訂單進度客戶批號→驗收單→廠務→報價單批次標籤），帶了還是可以改 */
async function stNoChange(){
  const lotEl=document.getElementById('st-f-lot'); if(!lotEl || String(lotEl.value||'').trim()) return;
  const no=((document.getElementById('st-f-no')||{}).value||'').trim(); if(!no) return;
  try{
    if(typeof REC_OS!=='undefined' && !REC_OS && typeof recLoadLots==='function') await recLoadLots(false);
    let tag='';
    try{ const q=(typeof REC_QUOTES!=='undefined' && Array.isArray(REC_QUOTES)) ? REC_QUOTES.find(x=>x&&x.quoteNo===no) : null; tag=(q&&q.tagLot)||''; }catch(_){}
    if(!tag){
      const r=(typeof recPayload==='function') ? await readCall(recPayload()).catch(()=>null) : null;   // 跟報價紀錄同一份快取
      const q=r&&Array.isArray(r.quotes) ? r.quotes.find(x=>x&&x.quoteNo===no) : null; tag=(q&&q.tagLot)||'';
    }
    const lot=(typeof recLotOf==='function') ? recLotOf(no, tag) : stLotFmt(tag);
    if(lot && !String(lotEl.value||'').trim()) lotEl.value=lot;
  }catch(_){}
}
function stCloseForm(){
  const box=document.getElementById('st-form'); if(box) box.style.display='none';
  ['st-f-cus','st-f-qty','st-f-no','st-f-note','st-f-name','st-f-vol','st-f-date','st-f-lot'].forEach(id=>{ const e=document.getElementById(id); if(e) e.value=''; });   // 2026-09-11：日期也清，下一筆才會回到今天
  { const s=document.getElementById('st-f-sku'); if(s) s.value=''; }
  { const lt=document.getElementById('st-f-lot'); if(lt) lt.readOnly=false; }
  stSkuChange();
}
/* 2026-09-30b Molly：「登記提領的流程不對，babyface 品項跳成公版酒了」
   → 提領不能從公版酒清單選（客戶寄的多半是代工／客製酒，公版酒清單根本沒有）。
     提領時酒款下拉改成「這位客戶目前寄倉還有剩的品項」，一列＝酒款＋容量＋Lot＋剩幾瓶；
     選了就自動帶 Lot（鎖住不給改，避免提錯 Lot）。入倉維持原本：公版酒＋其他（自行輸入）。 */
let ST_OUT_OPTS=[], ST_SUM=[];
/* 2026-09-30c Molly：「請設計成更直覺化」→ 庫存表每一列直接有「提領」鈕：
   按下去客戶／酒款／Lot 全部帶好、鎖住，只要填數量（＋日期／備註），表單上方清楚寫出要提領的是哪一列、剩幾瓶。 */
function stWithdrawRow(i){
  const r=ST_SUM[i]; if(!r) return;
  stOpenForm('out');
  const c=document.getElementById('st-f-cus'); if(c) c.value=String(r.customer);
  stFillSkuOptions(); stFillLotList();
  const s=document.getElementById('st-f-sku');
  const idx=ST_OUT_OPTS.findIndex(o=>stCusKey(o.customer)===stCusKey(r.customer) && stNm(o.name)===stNm(r.name) && stVol(o.volume)===stVol(r.volume) && stLotKey(o.lot)===stLotKey(r.lot));
  if(s && idx>=0){ s.value='inv:'+idx; stSkuChange(); }
  const q=document.getElementById('st-f-qty'); if(q){ q.value=''; setTimeout(()=>{ try{ q.focus(); }catch(_){} },50); }
  const box=document.getElementById('st-form'); if(box && box.scrollIntoView) box.scrollIntoView({behavior:'smooth', block:'nearest'});
}
/* 2026-09-30d Molly：「提領也可能單次同時提領多酒款，且要可以產生驗收單」
   庫存表每列多一欄「本次提領」數量：填幾列就是提幾款。下方動作列即時顯示「已選 N 款／共 M 瓶」，
   ・「只登記提領」→ 直接寫寄倉帳（一次多筆、各自帶 Lot），不出驗收單
   ・「產生驗收單」→ 開這批貨原本那張報價單的驗收單（第 N 次出貨），本次出貨數＝提領數量、Lot 帶好、
     寄倉方向預選「提領」；產生後寄倉扣庫存、訂單待出貨減、行事曆記配送日（Molly 2026-09-30 定案）。
     同一次只能提同一張報價單的品項；跨單或沒有報價單號的列，會提示分開處理。 */
function stPicked(){
  const out=[];
  document.querySelectorAll('#st-inv-body .st-pick-qty').forEach(el=>{
    const q=parseFloat(el.value)||0; if(q<=0) return;
    const r=ST_SUM[parseInt(el.getAttribute('data-i'),10)]; if(!r) return;
    out.push({ row:r, qty:q, over:q>(r.in-r.out) });
  });
  return out;
}
function stPickChange(){
  const bar=document.getElementById('st-pick-bar'); if(!bar) return;
  const pk=stPicked();
  document.querySelectorAll('#st-inv-body .st-pick-qty').forEach(el=>{ const r=ST_SUM[parseInt(el.getAttribute('data-i'),10)]; const q=parseFloat(el.value)||0; el.style.borderColor=(r&&q>(r.in-r.out))?'#C0453F':''; });
  if(!pk.length){ bar.style.display='none'; return; }
  bar.style.display='flex';
  const cus=[...new Set(pk.map(x=>stCusCanon(x.row.customer)))];
  const total=pk.reduce((s,x)=>s+x.qty,0);
  const over=pk.filter(x=>x.over);
  const sum=document.getElementById('st-pick-sum');
  if(sum) sum.innerHTML = (cus.length>1)
    ? `<span style="color:#C0453F">⚠ 選到 ${cus.length} 位客戶的酒（${cus.map(escHtml).join('、')}），一次只能提同一位客戶</span>`
    : (over.length ? `<span style="color:#C0453F">⚠ ${over.map(x=>escHtml(x.row.name)+(x.row.lot?('／'+escHtml(x.row.lot)):'')).join('、')} 超過剩餘量</span>`
    : `提領 <strong>${escHtml(cus[0])}</strong>：已選 <strong>${pk.length}</strong> 款、共 <strong>${total.toLocaleString()}</strong> 瓶`);
  const ok=cus.length===1 && !over.length;
  ['st-pick-save','st-pick-vf'].forEach(id=>{ const b=document.getElementById(id); if(b) b.disabled=!ok; });
  const d=document.getElementById('st-pick-date'); if(d && !d.value) d.value=todayStr();
}
function stPickClear(){ document.querySelectorAll('#st-inv-body .st-pick-qty').forEach(el=>{ el.value=''; }); const n=document.getElementById('st-pick-note'); if(n) n.value=''; stPickChange(); }
let _stPickSaving=false;
/* 只登記提領（不出驗收單） */
async function stPickSave(){
  if(_stPickSaving) return;
  const pk=stPicked(); if(!pk.length) return;
  const cus=stCusCanon(pk[0].row.customer);
  if(pk.some(x=>stCusKey(x.row.customer)!==stCusKey(cus))){ toast('一次只能提同一位客戶的酒','err'); return; }
  if(pk.some(x=>x.over)){ toast('有品項超過剩餘量，請先修正數量','err'); return; }
  const date=((document.getElementById('st-pick-date')||{}).value)||todayStr();
  const note=((document.getElementById('st-pick-note')||{}).value||'').trim();
  if(!confirm(`登記提領 ${cus}：${pk.length} 款、共 ${pk.reduce((s,x)=>s+x.qty,0)} 瓶（${date}）？\n\n只寫寄倉帳、不出驗收單。`)) return;
  _stPickSaving=true; btnBusy('st-pick-save',true,'登記中…');
  try{
    const moves=pk.map(x=>({ customer:cus, sku_id:x.row.sku_id||'', name:x.row.name, volume:x.row.volume||'', direction:'out', qty:x.qty, date:date,
      quote_no:(x.row.quotes||[])[0]||'', note:note, lot:x.row.lot||'' }));
    const r=await apiCall({action:'addStorageMoves', token:AUTH_TOKEN, moves});
    if(!r.ok) throw new Error(r.error||'登記失敗');
    const nS=(r.saved||[]).length, nK=(r.skipped||[]).length;
    toast(`已登記提領 ${nS} 款`+(nK?`；${nK} 款沒登記：${(r.skipped||[]).map(x=>x.reason).join('；')}`:''), nK?'err':'ok');
    stPickClear();
    await loadStorage(true);
  }catch(e){ toast(e.message||'登記失敗','err'); }
  finally{ _stPickSaving=false; btnBusy('st-pick-save',false); }
}
/* 產生驗收單：開原報價單的驗收單，把提領數量帶進去 */
function stPickVerify(){
  const pk=stPicked(); if(!pk.length) return;
  const cus=stCusCanon(pk[0].row.customer);
  if(pk.some(x=>stCusKey(x.row.customer)!==stCusKey(cus))){ toast('一次只能提同一位客戶的酒','err'); return; }
  if(pk.some(x=>x.over)){ toast('有品項超過剩餘量，請先修正數量','err'); return; }
  const noLots=pk.filter(x=>!(x.row.quotes||[]).length);
  if(noLots.length){ toast(`${noLots.map(x=>escHtml(x.row.name)).join('、')} 沒有對應的報價單號，無法開驗收單；請用「只登記提領」`,'err'); return; }
  const qs=[...new Set(pk.map(x=>(x.row.quotes||[])[0]))];
  if(qs.length>1){ toast(`選到的品項來自 ${qs.length} 張報價單（${qs.join('、')}），驗收單一次只能開一張，請分開提領`,'err'); return; }
  if(pk.some(x=>(x.row.quotes||[]).length>1)) toast('有品項是從多張報價單入倉的，驗收單會掛在第一張（'+qs[0]+'）','ok');
  if(typeof openVerifyForm!=='function'){ toast('驗收單模組未載入','err'); return; }
  const date=((document.getElementById('st-pick-date')||{}).value)||todayStr();
  openVerifyForm(qs[0], { storageOut:{ date, items: pk.map(x=>({ name:x.row.name, vol:x.row.volume||'', qty:x.qty, lot:x.row.lot||'' })) } });
}
/* 表單上方的提示列：提領時寫出「要提領的是誰的哪一支酒、哪個 Lot、剩幾瓶」，選錯一眼就看得出來 */
function stPickBanner(){
  const b=document.getElementById('st-f-pick'); if(!b) return;
  const pk=(ST_DIR==='out')?stOutPick():null;
  if(!pk){ b.style.display='none'; b.innerHTML=''; return; }
  const bal=pk.in-pk.out;
  b.style.display='block';
  b.innerHTML=`<i class="ti ti-building-warehouse"></i> 提領 <strong>${escHtml(pk.customer)}</strong> 寄倉的 <strong>${escHtml(pk.name)}（${escHtml(pk.volume||'—')}）</strong>　${pk.lot?escHtml(pk.lot):'未填 Lot'}　目前剩 <strong>${bal.toLocaleString()}</strong> 瓶`;
}
function stSkuLabel(txt){ const s=document.getElementById('st-f-sku'); const l=s&&s.parentElement&&s.parentElement.querySelector('label'); if(l) l.textContent=txt; }
function stFillOutOptions(){
  const s=document.getElementById('st-f-sku'); if(!s) return;
  const cus=((document.getElementById('st-f-cus')||{}).value||'').trim();
  const cur=s.value;
  /* 2026-09-30c：寄倉資料還沒載完就按「登記提領」→ 先顯示載入中，載完 stRender 會再重建一次（不然會誤顯示「沒有寄倉庫存」） */
  if(ST_MOVES==null){ ST_OUT_OPTS=[]; s.innerHTML='<option value="">寄倉資料載入中…</option>'; if(!ST_LOADING && AUTH_TOKEN) loadStorage(); stSkuChange(); return; }
  ST_OUT_OPTS = cus ? stSummary(cus).filter(r=>stCusKey(r.customer)===stCusKey(cus) && (r.in-r.out)>0) : [];
  if(!cus){ s.innerHTML='<option value="">請先選客戶</option>'; }
  else if(!ST_OUT_OPTS.length){ s.innerHTML='<option value="">這位客戶目前沒有寄倉庫存</option>'; }
  else s.innerHTML='<option value="">選擇要提領的酒款…</option>'
    + ST_OUT_OPTS.map((r,i)=>{ const v='inv:'+i; return `<option value="${v}"${v===cur?' selected':''}>${escHtml(r.name+'（'+(r.volume||'—')+'）'+(r.lot?('｜'+r.lot):'｜未填 Lot')+'｜剩 '+(r.in-r.out).toLocaleString()+' 瓶')}</option>`; }).join('');
  if(ST_OUT_OPTS.length===1 && !s.value){ s.value='inv:0'; }
  stSkuChange();
}
function stOutPick(){
  const v=((document.getElementById('st-f-sku')||{}).value||'');
  return (v.indexOf('inv:')===0) ? (ST_OUT_OPTS[parseInt(v.slice(4),10)]||null) : null;
}
function stFillSkuOptions(){
  const s=document.getElementById('st-f-sku'); if(!s) return;
  if(ST_DIR==='out'){ stSkuLabel('寄倉中的酒款'); stFillOutOptions(); return; }
  stSkuLabel('公版酒');
  { const lt=document.getElementById('st-f-lot'); if(lt) lt.readOnly=false; }
  const build=()=>{
    if(ST_DIR==='out') return;   // 非同步載入回來時使用者已切到提領，別把清單蓋回公版酒
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
  if(ST_DIR==='out'){
    const pk=stOutPick(), lt=document.getElementById('st-f-lot');
    if(lt){ lt.readOnly=!!pk; if(pk) lt.value=pk.lot||''; }
    const q=document.getElementById('st-f-qty'); if(q){ if(pk) q.max=String(pk.in-pk.out); else q.removeAttribute('max'); }
  }
  stPickBanner();
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
    let lot=stLotFmt((document.getElementById('st-f-lot')||{}).value||'');
    if(!cus){ toast('請填客戶名稱','err'); return; }
    if(!(qty>0)){ toast('數量要大於 0','err'); return; }
    let skuId='', name='', vol='';
    const pk=(ST_DIR==='out') ? stOutPick() : null;
    if(ST_DIR==='out'){
      if(!pk){ toast('請選要提領的酒款（清單是這位客戶目前寄倉還有剩的品項）','err'); return; }
      skuId=pk.sku_id||''; name=pk.name; vol=pk.volume||'';
      lot=pk.lot||'';
    } else if(skuSel && skuSel!=='__free'){
      const p=(typeof ownbrandBySku==='function')?ownbrandBySku(skuSel):null;
      skuId=skuSel; name=p?p.name:skuSel; vol=p?String(p.volume||''):'';
    } else if(skuSel==='__free'){
      name=(document.getElementById('st-f-name').value||'').trim();
      vol=(document.getElementById('st-f-vol').value||'').trim();
      if(!name){ toast('請填酒款名稱','err'); return; }
    } else { toast('請選公版酒（或選「其他」自行輸入）','err'); return; }
    if(ST_DIR==='out'){
      const bal=stBalanceFor(cus, skuId, name, vol, lot);
      if(qty>bal){
        const all=stBalanceFor(cus, skuId, name, vol);
        const hint=(all>bal) ? `（其他 Lot 合計還有 ${all-bal} 瓶，請確認 Lot 有沒有選對）` : '';
        toast(`提領超過剩餘量：${escHtml(cus)}／${escHtml(name)}／${escHtml(lot||'未填 Lot')} 目前剩 ${bal} 瓶${hint}。登記錯了可在明細按「作廢」再重登。`,'err'); return; }
    }
    const r=await apiCall({action:'addStorageMove', token:AUTH_TOKEN,
      date:date, customer:stCusCanon(cus), sku_id:skuId, name:name, volume:vol,
      direction:ST_DIR, qty:qty, quote_no:quoteNo, note:note, lot:lot});
    if(!r.ok) throw new Error(r.error||'登記失敗');
    toast((ST_DIR==='out'?'已登記提領 ':'已登記入倉 ')+qty+' 瓶','ok');
    stCloseForm();
    await loadStorage(true);
  }catch(e){ toast(e.message||'登記失敗','err'); }
  finally{ _stSaving=false; btnBusy('st-f-save',false); }
}
let _stDeleting=false;
/* 2026-09-02 Molly 定案：其他使用者也可以登記與更正，但都要留底。
   所以這裡不再是老闆專用，也不再真的刪掉——改成「作廢」：那一列會留著（灰色刪除線），
   記下誰、什麼時候、為什麼作廢；餘額與彙總都不算它。要更正就作廢舊的、再登記一筆正確的。 */
async function stDeleteMove(moveId){
  if(!moveId||_stDeleting) return;
  if(!confirm('把這筆寄倉紀錄作廢？\n\n紀錄不會消失，會留著並標示成「已作廢」（記錄是誰在什麼時候作廢的），只是不再計入庫存。\n要更正數量的話：先作廢這筆，再登記一筆正確的。')) return;
  const why=prompt('作廢原因（可留空）','登記錯誤');
  if(why===null) return;
  _stDeleting=true;
  try{
    const r=await apiCall({action:'deleteStorageMove', token:AUTH_TOKEN, move_id:moveId, note:String(why||'').trim()});
    if(!r.ok) throw new Error(r.error||'作廢失敗');
    toast('已作廢（紀錄留著）','ok');
    await loadStorage(true);
  }catch(e){ toast(e.message||'作廢失敗','err'); }
  finally{ _stDeleting=false; }
}

/* ============================================================
   2026-08-28 下午：驗收單 → 寄倉庫存自動登記（設計主軸：輸入一次、其他自動同步）
   ・資料全部從驗收單帶（客戶／單號／品項／容量／本次出貨數／配送日），使用者不用重打
   ・聰明預設：該客戶該酒款寄倉已有庫存 → 預設「客戶提走（提領）」；沒有 → 預設「入倉」
   ・冪等：每筆帶 src='VF:<單號>:<第幾次出貨>'，後端同 src 會跳過，重印驗收單不會重複計
   ============================================================ */
/* 某客戶在寄倉的總剩餘（不分酒款）——判斷聰明預設用 */
/* 把某張驗收單某一次出貨產生的寄倉紀錄全部刪掉（重印／改數量前用）。
   只刪 src 前綴完全吻合的，其他紀錄不會被碰到。 */
async function stRemoveMovesBySrc(no, srcTag){
  const prefix='VF:'+no+':'+srcTag+':';
  const d=await readCall({action:'getStorageData', token:AUTH_TOKEN}, true);
  const list=(d&&d.ok&&Array.isArray(d.moves))?d.moves:[];
  /* 2026-09-02：後端的 deleteStorageMove 已改成「作廢」（不刪列），所以重印時舊紀錄會留著
     並標示「驗收單重印，已重新登記」，而不是無聲消失。已經作廢過的就別再打一次。 */
  const hit=list.filter(m=>String(m.src||'').indexOf(prefix)===0 && String(m.void_at||'')==='');
  for(const m of hit){
    try{ await apiCall({action:'deleteStorageMove', token:AUTH_TOKEN, move_id:m.move_id, note:'驗收單重印，已重新登記'}); }catch(e){}
  }
  if(hit.length) ST_MOVES=null;
  return hit.length;
}
/* 這張驗收單上這些酒款，客戶目前在我方倉庫還有多少（用來決定「入倉／提領」的預設） */
function stBalanceForRows(cus, rows){
  let bal=0; const seen={};
  (rows||[]).forEach(r=>{   // 2026-09-11 複檢：同品名同容量兩個 LOT 會算兩次 → 先去重
    const k=stNm(r.name)+'|'+stVol(r.vol); if(seen[k]) return; seen[k]=1;
    bal += stBalanceFor(cus, '', r.name, r.vol);
  });
  return bal;
}
function stCustomerTotal(cus){
  let bal=0;
  (ST_MOVES||[]).forEach(m=>{
    if(stVoided(m)) return;
    if(stCusKey(m.customer)!==stCusKey(cus)) return;
    bal += (String(m.direction)==='out' ? -1 : 1) * (parseFloat(m.qty)||0);
  });
  return bal;
}
/* 驗收單存檔後呼叫：把這批「本次出貨」寫進寄倉帳
   d：驗收單資料（client/no/shipDate/rows），dir：'in'｜'out'，srcTag：第幾次出貨 */
async function stSyncFromVerify(d, dir, srcTag){
  /* 2026-09-01：重印／編輯後重新產生時，先把「同一張單同一次出貨」的舊紀錄刪掉再重寫，
     否則後端會因為 src 相同直接跳過，寄倉數字永遠停在第一次的舊值（複檢 #8）。 */
  if(d && d.__stReplace){ try{ await stRemoveMovesBySrc(d.no, srcTag); }catch(e){} }
  const moves=(d.rows||[])
    .map(r=>({ qty:parseFloat(r.thisShip)||0, name:r.name, vol:r.vol, lot:stLotFmt(String(r.lot||'').trim()||String(d.lot||'').trim()) }))
    .filter(r=>r.qty>0)
    .map(r=>({ customer:stCusCanon(d.client), sku_id:'', name:r.name, volume:(r.vol?String(r.vol).replace(/ml$/i,'')+'ml':''),
      direction:dir, qty:r.qty, date:d.shipDate||todayStr(), quote_no:d.no, lot:r.lot,
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
