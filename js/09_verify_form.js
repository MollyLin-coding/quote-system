/* ===================================================================
   出貨 Lot 驗收單（第一批・前端）
   從已存訂單一鍵帶入客戶/品項/批號/容量/總受訂數，補填配送與出貨，
   產 A4 橫式 PDF（含不良品欄、簽名欄、備註、QR）。
   QR 連到對話C 後端回報頁：<API_URL>?page=verify&no=..&lot=..（後端上線前為佔位）
   =================================================================== */
const VERIFY_LOGO="data:image/png;base64,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";
let VERIFY_DATA=null;
let VF_EDIT_ID=null;   // 編輯模式：正在編輯的驗收單留底紀錄ID（null＝一般新開）
const VERIFY_MIN_ROWS=3;
/* A4 橫式、@page margin 11mm 換算成可印範圍的 CSS px（96dpi）：
   寬 297-22=275mm→1039px；高 210-22=188mm→710px。自己手動分頁才印得出頁碼。 */
const VPAGE_W=1039, VPAGE_H=710;

/* 2026-08-13 複檢 #2-1／#2-7：驗收單 QR 加驗證碼。
   原本 QR 的網址就是 API 網址，單號是 YYYYMMDD-NN 這種可以逐號猜的格式，任何拿到任一張
   驗收單的人把單號改一改，就能看到別家客戶的公司名稱與訂購酒款、還能灌假的回報。
   Molly 2026-08-13 決定：**新單才驗、舊單維持現狀**，已經送到客戶手上的紙本 QR 照樣能用。
   驗證碼只有後端算得出來（Script Properties 裡的鹽），所以要先跟後端要。 */
let VF_KEYS={};
async function vfKeyFor(no){
  const key=String(no||''); if(!key) return '';
  if(VF_KEYS[key]!=null) return VF_KEYS[key];
  try{
    const d=await apiCall({action:'getVerifyKey', token:AUTH_TOKEN, no:key});
    VF_KEYS[key]=(d&&d.ok&&d.k)?d.k:'';
  }catch(e){ VF_KEYS[key]=''; }
  return VF_KEYS[key];
}
/* 產生驗收單前的檢查：驗證碼還沒拿到就先講清楚，不要印出一張客戶掃不進去的 QR。
   （驗證碼在「開啟驗收單」時就會先抓好，正常情況下這裡不會擋。） */
function vfKeyReady(no){
  const key=String(no||'');
  if(VF_KEYS[key]) return true;
  vfKeyFor(key);   // 先去抓，等一下再產生一次就會有
  const m=key.match(/20\d{6}/g);
  const ymd=(m&&m.length)?m[m.length-1]:'';
  if(!ymd || ymd<'20260813') return true;   // 舊單號後端不驗，沒有驗證碼也沒關係
  toast('QR 的驗證碼還沒取到，這樣印出去客戶會掃不進去。請等兩秒再按一次「產生」','err');
  return false;
}
function verifyQrUrl(no,lot){
  const k=VF_KEYS[String(no||'')]||'';
  return API_URL+'?page=verify&no='+encodeURIComponent(no||'')+'&lot='+encodeURIComponent(lot||'')
       + (k?('&k='+encodeURIComponent(k)):'');
}
function verifyQrSvg(text,cell){
  try{
    if(typeof qrcode!=='function') return '';
    const qr=qrcode(0,'M'); qr.addData(text); qr.make();
    return qr.createSvgTag({cellSize:cell||4,margin:0,scalable:true});
  }catch(e){ return ''; }
}
function vfDate(s){ return s?String(s).replace(/-/g,'/'):''; }

function ensureVerifyOverlay(){
  if(document.getElementById('vf-overlay')) return;
  const ov=document.createElement('div');
  ov.className='v2ov'; ov.id='vf-overlay';
  ov.innerHTML=`<div class="v2box" style="max-width:940px">
    <div class="v2h"><span>產生 Lot 驗收單</span><button class="v2x" onclick="closeVerifyForm()">✕</button></div>
    <div id="vf-body"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn btn-g" onclick="closeVerifyForm()">取消</button>
      <button class="btn btn-g" onclick="previewVerifyPdf('partial')"><i class="ti ti-eye"></i>預覽分批</button>
      <button class="btn btn-g" onclick="previewVerifyPdf('full')"><i class="ti ti-eye"></i>預覽整批</button>
      <button class="btn btn-g" onclick="generateVerifyPdf('partial')">產生分批驗收單</button>
      <button class="btn btn-gold" onclick="generateVerifyPdf('full')"><i class="ti ti-file-download"></i>產生整批驗收單</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
}
function closeVerifyForm(){ VF_EDIT_ID=null; const o=document.getElementById('vf-overlay'); if(o) o.style.display='none'; }

async function openVerifyForm(no){
  if(!no) return;
  VF_EDIT_ID=null;
  try{
    toast('讀取訂單資料…','ok');
    // 走讀取快取：留底那份登入後就預抓好了，通常 0 秒；報價單本身 90 秒內開過也 0 秒
    vfKeyFor(no);   // 複檢 #2-1：順便把 QR 驗證碼抓回來（跟下面兩支平行，不多花時間）
    const [data, formsData] = await Promise.all([
      readCall({ action:'getQuoteById', token:AUTH_TOKEN, quoteNo:no }),
      readCall({ action:'listVerifyForms', token:AUTH_TOKEN, filters:{} }).catch(()=>null),
      /* 2026-08-28：順手把寄倉現況一起抓（平行、有快取，不多花時間）——
         這樣開驗收單時才知道這位客戶寄倉還有幾瓶，能給「入倉／提領」聰明預設 */
      (typeof loadStorage==='function' ? loadStorage().catch(()=>{}) : Promise.resolve())
    ]);
    const q=data.quote;
    if(!q){ toast('查無此單','err'); return; }
    const items=(q.items||[]).filter(it=>it.itemType==='bottle');
    if(!items.length){ toast('這張單沒有瓶裝品項，無法產生驗收單','err'); return; }
    /* 抬頭這欄是「客戶批號」（客戶自己的批號／貨號），跟我們自己的 LOT 是兩套編號，
       系統裡沒有客戶批號資料，不從我方 it.lot 帶入，一律留空給人工填 */
    /* 這張單先前產生過的驗收單留底：算「第幾次出貨」，並把每次的「本次出貨數」
       按品項（品名＋容量）加總 → 這次打開時「已出貨」自動帶前幾次的量、
       「本次出貨」自動帶剩餘量（第二次產出就不會又是全部數量了，2026-07-28 Molly 回報） */
    const priorForms=(formsData&&formsData.ok&&Array.isArray(formsData.records))
      ? formsData.records.filter(r=>String(r.no||'').trim()===String(no).trim()) : [];
    const priorCount=priorForms.length;
    /* 複檢 2026-08-06 #8：原本用「品名｜容量」當鍵加總已出貨量後，同一張單若有兩列
       同品名同容量（例如同酒款兩個 LOT），每一列都會拿到「合計值」→ 已出貨變兩倍、
       待出貨變負數，印出來的分批驗收單是錯的。改成同鍵的多列依序分配：先把已出貨量
       分給第一列（最多分到它的訂購量），剩下的再給下一列，總量守恆也不重複計。 */
    const shippedSum={}, keyOf=(n,v)=>String(n||'').trim()+'|'+String(v==null?'':v).trim();
    priorForms.forEach(f=>{
      const its=Array.isArray(f.items)?f.items:parseJsonSafe(f.items_json,[]);
      (its||[]).forEach(pi=>{
        const k=keyOf(pi.name, pi.vol);
        shippedSum[k]=(shippedSum[k]||0)+(parseFloat(pi.thisShip)||0);
      });
    });
    const poolLeft=Object.assign({}, shippedSum);   // 每個鍵還沒分配掉的已出貨量
    /* 2026-08-28：這張報價單有沒有勾「開放客戶寄倉」（docopts 特殊列）→ 驗收單多一個自動登記寄倉的區塊 */
    let _stOn=false;
    try{ const _do=(q.items||[]).find(it=>it&&it.itemType==='docopts');
         if(_do&&_do.flavorList){ const _o=JSON.parse(_do.flavorList); _stOn=!!(_o.storage&&_o.storage!=='0'&&_o.storage!=='N'); } }catch(_){}
    VERIFY_DATA={ no:q.quoteNo, client:q.clientName||'', priorCount, storage:_stOn,
      rows:items.map(it=>{
        const ordered=parseFloat(it.qty)||0;
        const k=keyOf(it.name, it.volume);
        const avail=poolLeft[k]||0;
        const shipped=(ordered>0)?Math.min(avail, ordered):avail;   // 這一列最多只認到自己的訂購量
        poolLeft[k]=avail-shipped;
        const remain=ordered-shipped;
        return { name:it.name||'', lot:it.lot||'', vol:it.volume||'', ordered, mfg:'',
          thisShip: shipped>0 ? (remain>0?remain:0) : ordered, shipped };
      }) };
    buildVerifyModal('');
    document.getElementById('vf-overlay').style.display='flex';
    /* 複檢 2026-08-06 #24：留底是用「品名＋容量」跟報價單品項比對的，報價單存檔後若改過
       品名或容量（例如 500→550），舊留底就對不上任何一列 → 已出貨全部歸零、本次出貨又帶
       成全部訂購量，但「第幾次出貨」還是照算，會印出矛盾的單。這種情況要明講，不能默默帶錯。 */
    const _leftover=Object.keys(poolLeft).reduce((s,k)=>s+(poolLeft[k]||0),0);
    if(priorCount>0 && _leftover>0){
      toast(`⚠ 這是第 ${priorCount+1} 次出貨，但有 ${Math.round(_leftover)} 個單位的舊出貨紀錄對不上目前的品項（報價單的品名或容量改過？）。「已出貨」可能少算，請自行核對後手動修正數量再產生。`,'err');
    } else if(priorCount>0 && VERIFY_DATA.rows.some(r=>r.shipped>0)){
      toast(`已帶入前 ${priorCount} 張驗收單的出貨數量：「已出貨」＝之前出過的、「本次出貨」＝剩餘量（都可以再改）`,'ok');
    }
  }catch(e){ toast(e.message||'讀取失敗','err'); }
}

function buildVerifyModal(hdrLot){
  ensureVerifyOverlay();
  const ttl=document.querySelector('#vf-overlay .v2h span');
  if(ttl) ttl.textContent = VF_EDIT_ID ? '編輯驗收單（產生後取代舊留底）' : '產生 Lot 驗收單';
  const d=VERIFY_DATA;
  const today=(function(){ const t=new Date(),p=n=>String(n).padStart(2,'0'); return t.getFullYear()+'-'+p(t.getMonth()+1)+'-'+p(t.getDate()); })();
  const inS='border:1px solid var(--bd);border-radius:5px;padding:5px 7px;font-size:12px;font-family:inherit;width:100%';
  const rowsH=d.rows.map((r,i)=>`<tr>
    <td style="font-weight:600;text-align:left;padding-left:6px">${escHtml(r.name)}</td>
    <td><input type="date" style="${inS};width:130px" data-i="${i}" data-k="mfg" class="vfi" value="${escHtml(r.mfg||'')}"></td>
    <td class="vf-lotcol" style="display:none"><input style="${inS};width:70px" data-i="${i}" data-k="lot" class="vfi" value="${escHtml(r.lot)}"></td>
    <td style="text-align:center;color:#6B6B63">${escHtml(r.vol)||'—'}</td>
    <td><input type="number" min="0" style="${inS};width:72px" data-i="${i}" data-k="thisShip" data-manual="0" class="vfi" value="${(r.thisShip!==''&&r.thisShip!=null)?r.thisShip:''}" oninput="onThisShipInput(this)"></td>
    <td style="text-align:center;font-weight:600">${r.ordered||0}</td>
    <td><input type="number" min="0" style="${inS};width:72px" data-i="${i}" data-k="shipped" class="vfi" value="${(r.shipped!==''&&r.shipped!=null)?r.shipped:0}" oninput="onShippedInput(this)"></td>
    <td style="text-align:center;font-weight:700;color:var(--gold-deep)" id="vf-remain-${i}">${(parseFloat(r.ordered)||0)-(parseFloat(r.shipped)||0)-(parseFloat(r.thisShip)||0)}</td>
  </tr>`).join('');
  document.getElementById('vf-body').innerHTML=`
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
      <div class="fl"><label>客戶</label><input class="fi ro" value="${escHtml(d.client)}" readonly></div>
      <div class="fl"><label>客戶批號</label><input class="fi" id="vf-lot" value="${escHtml(hdrLot||'')}" placeholder="客戶自己的批號／貨號（選填）"></div>
      <div class="fl"><label>單號</label><input class="fi ro" value="${escHtml(d.no)}" readonly></div>
      <div class="fl"><label>配送日期</label><input class="fi" type="date" id="vf-shipdate" value="${today}"></div>
      <div class="fl"><label>專案經理 PM</label><input class="fi" id="vf-shipper" placeholder="PM 姓名"></div>
      <div class="fl"><label>此次配送總箱數</label><input class="fi" type="number" min="0" id="vf-boxes" placeholder="箱數"></div>
      <div class="fl"><label>第幾次出貨（分批用）</label><input class="fi" type="number" min="1" id="vf-shipseq" value="${(d.priorCount||0)+1}"></div>
    </div>
    <label style="display:inline-flex;align-items:center;gap:6px;margin-top:12px;font-size:12px;color:var(--fg);cursor:pointer">
      <input type="checkbox" id="vf-showlot" onchange="toggleLotCol()"> 各品項不同批號時，顯示批號欄（預設隱藏，客戶批號仍會印）
    </label>
    <div style="overflow-x:auto;margin-top:12px">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:var(--gold-pale);color:var(--gold-deep)">
          <th style="padding:7px 4px;text-align:left;padding-left:6px">品項</th>
          <th style="padding:7px 4px">製造日期</th><th class="vf-lotcol" style="padding:7px 4px;display:none">批號</th>
          <th style="padding:7px 4px">容量</th><th style="padding:7px 4px">本次出貨數</th>
          <th style="padding:7px 4px">總受訂數</th><th style="padding:7px 4px">已出貨</th>
          <th style="padding:7px 4px">待出貨</th>
        </tr></thead>
        <tbody>${rowsH}</tbody>
      </table>
    </div>
    ${vfStorageBlockHtml(d)}
    <p style="font-size:11px;color:var(--hint);margin-top:10px;line-height:1.6">
      「待出貨」＝總受訂數 − 已出貨 − 本次出貨數，系統自動算。<br>
      一次全部出貨用「產生整批驗收單」；分幾次出貨用「產生分批驗收單」（會多印訂購總數／待出貨欄）。PDF 下方含「驗收與品質說明」，右下 QR 供客戶收貨後線上驗收回報。</p>`;
}

/* 2026-08-28：寄倉自動登記區塊（只有報價單勾了「開放客戶寄倉」才出現）
   設計主軸：資料全部從這張驗收單帶，使用者不必重打；方向給聰明預設，她只要確認。 */
function vfStorageBlockHtml(d){
  if(!d||!d.storage) return '';
  /* 聰明預設：這個客戶寄倉還有庫存 → 這次多半是「客戶來提貨」；沒有庫存 → 多半是「做好先入倉」 */
  let bal=0;
  try{ bal=(typeof stCustomerTotal==='function')?stCustomerTotal(d.client):0; }catch(_){}
  const defOut = bal>0;
  const balNote = bal>0 ? `（目前這位客戶寄倉還有 <strong>${bal}</strong> 瓶）` : '（目前這位客戶寄倉沒有庫存）';
  return `<div id="vf-storage-box" style="margin-top:14px;padding:11px 13px;border:1px solid var(--bd);border-radius:8px">
    <label style="display:flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:var(--ink);cursor:pointer">
      <input type="checkbox" id="vf-st-on" checked style="width:15px;height:15px"> 同步更新「客戶寄倉」庫存
    </label>
    <div id="vf-st-opts" style="margin-top:8px;font-size:12.5px;color:var(--sub);line-height:1.9">
      這張單有開放寄倉${balNote}。本次出貨的數量要記成：
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:4px">
        <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer">
          <input type="radio" name="vf-st-dir" value="in"${defOut?'':' checked'}> 入倉（做好了先放我方倉庫，客戶暫不提領）</label>
        <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer">
          <input type="radio" name="vf-st-dir" value="out"${defOut?' checked':''}> 提領（客戶這次把酒領走）</label>
      </div>
      <div style="font-size:11px;color:var(--hint);margin-top:5px">客戶、酒款、容量、數量、日期全部自動沿用上面的驗收單內容，不用重填；同一張驗收單重印不會重複計。</div>
    </div>
  </div>`;
}
function toggleLotCol(){
  const on=document.getElementById('vf-showlot');
  const show=!!(on&&on.checked);
  document.querySelectorAll('#vf-body .vf-lotcol').forEach(el=>{ el.style.display=show?'':'none'; });
}
function onThisShipInput(el){ if(el) el.dataset.manual='1'; recalcVerify(); }
function onShippedInput(el){
  if(!VERIFY_DATA||!el) return;
  const i=+el.dataset.i;
  const ts=document.querySelector('#vf-body .vfi[data-i="'+i+'"][data-k="thisShip"]');
  if(ts && ts.dataset.manual!=='1' && VERIFY_DATA.rows[i]){
    const ordered=parseFloat(VERIFY_DATA.rows[i].ordered)||0;
    const shipped=parseFloat(el.value)||0;
    const rem=ordered-shipped;
    ts.value = rem>0 ? rem : 0;
  }
  recalcVerify();
}
function recalcVerify(){
  if(!VERIFY_DATA) return;
  document.querySelectorAll('#vf-body .vfi').forEach(el=>{
    const i=+el.dataset.i,k=el.dataset.k; if(VERIFY_DATA.rows[i]) VERIFY_DATA.rows[i][k]=el.value;
  });
  VERIFY_DATA.rows.forEach((r,i)=>{
    const remain=(parseFloat(r.ordered)||0)-(parseFloat(r.shipped)||0)-(parseFloat(r.thisShip)||0);
    const el=document.getElementById('vf-remain-'+i); if(el) el.textContent=isNaN(remain)?'—':remain;
  });
}

function generateVerifyPdf(mode){
  recalcVerify();
  const d=VERIFY_DATA; if(!d) return;
  d.mode=(mode==='partial')?'partial':'full';
  const gvl=id=>{const e=document.getElementById(id);return e?e.value.trim():'';};
  d.lot=gvl('vf-lot'); d.shipDate=gvl('vf-shipdate'); d.shipper=gvl('vf-shipper'); d.boxes=gvl('vf-boxes');
  d.shipSeq=parseInt(gvl('vf-shipseq'),10)||1; // 「第幾次出貨」改成人工填，不再自動算
  if(!vfKeyReady(d.no)) return;   // 複檢 #2-1：沒有 QR 驗證碼就先別印
  /* 複檢 2026-08-13 #1-3：留底一定要先存。原本是彈窗被瀏覽器擋掉就直接 return，留底一筆都不會存
     → 下次開同一張單的驗收單，「已出貨」歸零、「本次出貨」又帶成全部訂購量，第二批會印成整批數量。 */
  saveVerifyFormRecord(d);
  /* 2026-08-28：同步寫進客戶寄倉帳（勾了才做；背景執行不擋列印，冪等所以重印不會重複計） */
  try{
    const _stOn=document.getElementById('vf-st-on');
    if(d.storage && _stOn && _stOn.checked && typeof stSyncFromVerify==='function'){
      const _dirEl=document.querySelector('input[name="vf-st-dir"]:checked');
      const _dir=(_dirEl&&_dirEl.value==='out')?'out':'in';
      stSyncFromVerify(d, _dir, d.shipSeq).catch(e=>toast(e.message||'寄倉登記失敗，請到「客戶寄倉」手動登記','err'));
    }
  }catch(_){}
  const seqEl=document.getElementById('vf-shipseq'); if(seqEl) seqEl.value=d.shipSeq+1; // 方便下一次接著填
  /* 複檢 2026-08-13 #3-4：產生完要關掉視窗（寄售那套本來就有關）。原本留在畫面上，想比較版面
     先按「產生分批」再按「產生整批」就會存出兩筆同單號留底，下次開同一張單「已出貨」數量加倍、
     「本次出貨」變 0，還會跳一則歸因錯誤的警告。要改版面請用「預覽」，那個不留底。 */
  closeVerifyForm();
  const w=window.open('','_blank');
  if(!w){ toast('留底已存好了，但列印視窗被瀏覽器擋掉。請允許彈出視窗後，到「驗收單留底」重印這一筆','err'); return; }
  w.document.open(); w.document.write(buildVerifyDocHtml(d)); w.document.close();
  toast('已開啟驗收單，於列印視窗選「另存為 PDF」','ok');
}
/* 純預覽：只是給人看排版對不對，不留底、不自動跳出列印視窗（跟「產生」的差別）
   mode 跟「產生分批／整批驗收單」一樣可以指定，這樣分批的版面（多印訂購總數／待出貨欄）也能先預覽 */
function previewVerifyPdf(mode){
  recalcVerify();
  const d=VERIFY_DATA; if(!d) return;
  const gvl=id=>{const e=document.getElementById(id);return e?e.value.trim():'';};
  const preview={ ...d, mode:(mode==='partial')?'partial':'full', lot:gvl('vf-lot'), shipDate:gvl('vf-shipdate'), shipper:gvl('vf-shipper'), boxes:gvl('vf-boxes'), shipSeq:parseInt(gvl('vf-shipseq'),10)||1 };
  const w=window.open('','_blank');
  if(!w){ toast('請允許彈出視窗，才能預覽','err'); return; }
  w.document.open(); w.document.write(buildVerifyDocHtml(preview,{preview:true})); w.document.close();
  toast('這只是預覽，不會留底；要正式送出請按下方「產生」按鈕','ok');
}
/* 產生驗收單時，把這次的出貨紀錄留底到後台（fire-and-forget，失敗不擋前端）。
   編輯模式（VF_EDIT_ID 有值）＝「取代」：先存新留底，成功後刪掉舊的那筆，再重整驗收管理清單。 */
function saveVerifyFormRecord(d){
  try{
    if(!AUTH_TOKEN) return;
    const editId=VF_EDIT_ID; VF_EDIT_ID=null;
    const record={ no:d.no, lot:d.lot, shipDate:d.shipDate, pm:d.shipper, boxes:d.boxes,
      items:(d.rows||[]).map(r=>({ name:r.name, lot:r.lot, vol:r.vol, mfg:r.mfg, thisShip:r.thisShip, ordered:r.ordered, shipped:r.shipped })) };
    /* 複檢 2026-08-06 #23：留底存檔原本失敗完全不出聲，使用者不會知道這批沒留底——
       下次開驗收單就算不到這批，「已出貨」歸零、「本次出貨」又帶成全部數量。改成明確提示。 */
    apiCall({action:'saveVerifyForm', token:AUTH_TOKEN, record}).then(res=>{
      if(!(res&&res.ok)){ toast('⚠ 這批的驗收單留底沒有存成功，下次開驗收單不會算到這批出貨量，請再產生一次','err'); return; }
      if(!editId) return;
      return apiCall({action:'deleteVerifyForm', token:AUTH_TOKEN, id:editId})
        .then(()=>{ toast('驗收單留底已更新（新版已取代舊紀錄）','ok'); })
        .catch(()=>{ toast('新留底已存，但舊紀錄刪除失敗，請到「驗收單留底」手動刪掉舊的那筆','err'); })
        .then(()=>{ try{ if(typeof loadVerifyMgmt==='function') loadVerifyMgmt(true); }catch(_){} });
    }).catch(()=>{
      toast('⚠ 這批的驗收單留底沒有存成功（連線問題），下次開驗收單不會算到這批出貨量，請確認後再產生一次','err');
    });
  }catch(_){}
}

/* 印出來的樣式表，跟量測分頁高度用的是同一份，才不會量出來的高度跟實際印出來的不一樣 */
function verifyDocStyleBlock(){
  return `
@page{size:A4 landscape;margin:11mm}
*{box-sizing:border-box}
html,body{margin:0}
body{font-family:'Noto Sans TC','Microsoft JhengHei','PingFang TC','Heiti TC',sans-serif;color:#26261f;font-size:12px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.vpage{width:${VPAGE_W}px;height:${VPAGE_H}px;overflow:hidden;background:#fff;display:flex;flex-direction:column;color:#26261f}
.vpage+.vpage{page-break-before:always;break-before:page}
.hd{display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:11px;border-bottom:1.4px solid #b9954e}
.hl{display:flex;align-items:center;gap:12px}
.hl img{height:30px;width:auto;display:block}
.hl .co{display:flex;align-items:center}
.hl .co small{font-size:8.5px;color:#9a9689;font-weight:500;letter-spacing:2px}
.hr{text-align:right}
.ttl{font-family:'Noto Sans TC','Microsoft JhengHei','PingFang TC','Heiti TC',sans-serif;font-size:23px;font-weight:700;letter-spacing:9px;color:#2b4a37}
.tag{display:inline-block;font-family:'Noto Sans TC',sans-serif;font-size:9px;font-weight:700;color:#9a7b33;border:1px solid #d8c48f;border-radius:10px;padding:1px 9px;letter-spacing:1px;margin-left:8px;vertical-align:4px}
.nos{margin-top:6px;font-size:11px;color:#55554c}
.nos b{color:#26261f;font-weight:700;letter-spacing:.5px}
.nos .sp{display:inline-block;width:1px;height:10px;background:#d8d2c4;margin:0 10px;vertical-align:-1px}
.meta{display:flex;margin:13px 2px 0;font-size:11px;color:#55554c}
.meta div{flex:1}
.meta span{color:#9a9689;letter-spacing:1px;margin-right:6px;font-size:9.5px}
.meta b{color:#26261f;font-weight:700}
table.vt{width:100%;border-collapse:collapse;margin-top:14px;font-size:11.5px}
table.vt th{color:#5f5e54;font-weight:600;font-size:10px;letter-spacing:.6px;padding:0 6px 7px;border-bottom:1.2px solid #c7ac6e;text-align:center;white-space:nowrap;vertical-align:bottom}
table.vt th.l{text-align:left;padding-left:2px}
table.vt th .u{display:block;font-size:8px;color:#a8a49a;font-weight:400;margin-top:2px;letter-spacing:0}
table.vt tr{break-inside:avoid}
table.vt td{padding:0 6px;height:36px;text-align:center;border-bottom:.8px solid #eae5da;font-variant-numeric:tabular-nums;color:#33332c}
table.vt td.l{text-align:left;padding-left:2px;font-weight:600;color:#26261f;font-size:12.83px}
table.vt td.mut{color:#9a9689}
table.vt tbody tr:last-child td{border-bottom:1.2px solid #d8d2c4}
table.vt tbody tr.sum td{font-weight:700;color:#26261f;border-top:1.3px solid #c7ac6e;border-bottom:none;height:32px}
table.vt tbody tr.sum td.l{color:#5f5e54;letter-spacing:2px;font-weight:700}
.ft{display:flex;justify-content:space-between;align-items:stretch;margin-top:24px;gap:28px}
.fl2{flex:1;display:flex;flex-direction:column;justify-content:flex-end;gap:14px}
.notes{border-left:2px solid #c7ac6e;padding-left:13px}
.notes .nh{font-size:10px;font-weight:700;color:#9a7b33;letter-spacing:2px;margin-bottom:6px}
.notes .nb{font-size:10px;color:#4a4438;line-height:1.7;position:relative;padding-left:13px;margin-top:3px}
.notes .nb:before{content:"•";position:absolute;left:1px;color:#b9954e;font-size:9px;top:.5px}
.notes .nb b{color:#2b2b22;font-weight:700}
.qr{text-align:center;flex-shrink:0;align-self:flex-end}
.qr svg{width:92px;height:92px;display:block;margin:0 auto}
.qr .cap{font-size:9px;color:#5a4a28;margin-top:5px;font-weight:700;letter-spacing:.5px}
.qr .cap2{font-size:8px;color:#9a9689;margin-top:2px;letter-spacing:.3px}
.pgno{font-size:9px;color:#b4ac9a;letter-spacing:1px;text-align:right;padding-top:6px;border-top:.8px solid #efe7d8}
.noprint{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:9;display:flex;align-items:center;gap:10px}
.noprint button{background:#2b4a37;color:#fff;border:none;border-radius:7px;padding:9px 20px;font-size:13px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)}
.noprint .pvtag{background:#9a7b33;color:#fff;font-size:11px;font-weight:700;letter-spacing:1px;padding:5px 10px;border-radius:20px}
@media print{.noprint{display:none!important}}
`;
}

/* 手動分頁（不再靠瀏覽器自己斷頁）：因為要印「第 X 頁，共 Y 頁」，
   瀏覽器自己斷頁沒辦法讓每頁印不同文字，只能自己量高度、自己切頁。
   品項列高度固定（CSS height:36px），但保險起見還是用真的量測，不用猜的數字。 */
function buildVerifyPages({headerBlockHtml, theadCols, rowsHtml, footBlockHtml}){
  const font="'Noto Sans TC','Microsoft JhengHei','PingFang TC','Heiti TC',sans-serif";
  let styleEl=document.getElementById('vf-measure-style');
  if(!styleEl){ styleEl=document.createElement('style'); styleEl.id='vf-measure-style'; document.head.appendChild(styleEl); }
  styleEl.textContent=verifyDocStyleBlock();
  const sb=document.createElement('div');
  sb.style.cssText=`position:absolute;visibility:hidden;left:-9999px;top:0;width:${VPAGE_W}px;font-family:${font};font-size:12px`;
  document.body.appendChild(sb);
  const mh=h=>{ sb.innerHTML=h; return sb.getBoundingClientRect().height; };
  const mhRow=h=>{ sb.innerHTML=`<table class="vt"><tbody>${h}</tbody></table>`; return sb.querySelector('tbody').getBoundingClientRect().height; };

  /* 每頁都固定會有的：頁首資訊區＋表格自己的 margin-top＋欄位抬頭列 */
  const overheadH=mh(headerBlockHtml+`<table class="vt"><thead><tr>${theadCols}</tr></thead></table>`);
  const footH=mh(footBlockHtml);
  const pgnoH=mh(`<div class="pgno">第 1 頁，共 1 頁</div>`);
  const rowHs=rowsHtml.map(r=>mhRow(r));
  document.body.removeChild(sb);

  const SAFETY=6;
  let avail=VPAGE_H-overheadH-footH-pgnoH-SAFETY;
  if(avail<36) avail=36; // 保險：量測異常也至少留一列的空間，不要卡死或每列各自成頁

  const pages=[]; let i=0;
  do{
    let used=0; const pageRows=[];
    while(i<rowHs.length && used+rowHs[i]<=avail){ used+=rowHs[i]; pageRows.push(rowsHtml[i]); i++; }
    if(!pageRows.length && i<rowsHtml.length){ pageRows.push(rowsHtml[i]); i++; } // 單列超高的保險
    pages.push(pageRows);
  }while(i<rowsHtml.length);
  if(!pages.length) pages.push([]);

  const total=pages.length;
  return pages.map((pageRows,idx)=>{
    const isLast=idx===total-1;
    const tail=isLast
      ? `<div style="margin-top:auto">${footBlockHtml}</div><div class="pgno">第 ${idx+1} 頁，共 ${total} 頁</div>`
      : `<div class="pgno" style="margin-top:auto">第 ${idx+1} 頁，共 ${total} 頁</div>`;
    return `<div class="vpage">${headerBlockHtml}<table class="vt"><thead><tr>${theadCols}</tr></thead><tbody>${pageRows.join('')}</tbody></table>${tail}</div>`;
  }).join('');
}

function buildVerifyDocHtml(d,opts){
  const isPreview=!!(opts&&opts.preview);
  const mode=(d.mode==='partial')?'partial':'full';
  const isPartial=mode==='partial';
  /* LOT／製造日期兩欄都是「有輸入才顯示欄位（含抬頭）」，沒人填就整欄不印 */
  const hasLot=d.rows.some(r=>String(r.lot||'').trim()!=='');
  const hasMfg=d.rows.some(r=>String(r.mfg||'').trim()!=='');
  const qrSvg=verifyQrSvg(verifyQrUrl(d.no,d.lot),4);
  const volMl=v=>{ if(!v) return 0; const s=String(v).toLowerCase(); let m=s.match(/([\d.]+)\s*ml/); if(m) return parseFloat(m[1])||0; m=s.match(/([\d.]+)\s*l/); if(m) return (parseFloat(m[1])||0)*1000; m=s.match(/([\d.]+)/); return m?(parseFloat(m[1])||0):0; };
  const unitOf=r=>volMl(r.vol)>=4000?'桶':'瓶';
  /* 0（或負數／無效值）一律印橫線，不要印「0 瓶」 */
  const qty=(v,u)=>{
    if(v===''||v==null) return '';
    const n=(typeof v==='number')?v:parseFloat(v);
    if(isNaN(n)) return '';
    return n>0 ? (n+' '+u) : '—';
  };
  let tThis=0,tShip=0,tOrd=0;
  d.rows.forEach(r=>{ tThis+=parseFloat(r.thisShip)||0; tShip+=parseFloat(r.shipped)||0; tOrd+=parseFloat(r.ordered)||0; });
  const tRemain=tOrd-tShip-tThis;
  const units=Array.from(new Set(d.rows.map(unitOf)));
  const tw=(units.length===1)?(' '+units[0]):'';
  const sv=n=>n>0?(n+tw):'—';
  const lotTh=hasLot?`<th style="width:10%">LOT</th>`:'';
  const lotTd=r=>hasLot?`<td class="mut">${escHtml(r.lot)||'—'}</td>`:'';
  const lotEmpty=hasLot?'<td></td>':'';
  const mfgTh=hasMfg?`<th style="width:16%">製造日期</th>`:'';
  const mfgTd=r=>hasMfg?`<td class="mut">${vfDate(r.mfg)||'—'}</td>`:'';
  const mfgEmpty=hasMfg?'<td></td>':'';
  const rowsHtml=d.rows.map(r=>{
    const u=unitOf(r);
    const remain=(parseFloat(r.ordered)||0)-(parseFloat(r.shipped)||0)-(parseFloat(r.thisShip)||0);
    if(isPartial){
      return `<tr>
      <td class="l">${escHtml(r.name)}</td>
      ${lotTd(r)}
      ${mfgTd(r)}
      <td class="mut">${escHtml(r.vol)}</td>
      <td>${qty(r.thisShip,u)}</td>
      <td class="mut">${qty(r.shipped,u)}</td>
      <td class="mut">${qty(r.ordered,u)}</td>
      <td>${(!isNaN(remain)&&remain>0)?(remain+' '+u):'—'}</td>
    </tr>`;
    }
    return `<tr>
      <td class="l">${escHtml(r.name)}</td>
      ${lotTd(r)}
      ${mfgTd(r)}
      <td class="mut">${escHtml(r.vol)}</td>
      <td>${qty(r.thisShip,u)}</td>
    </tr>`;
  });
  const colCount=(isPartial?6:3)+(hasLot?1:0)+(hasMfg?1:0);
  const pad=Math.max(0,VERIFY_MIN_ROWS-d.rows.length);
  const emptyCells='<td class="l">&nbsp;</td>'+'<td></td>'.repeat(colCount-1);
  for(let k=0;k<pad;k++) rowsHtml.push(`<tr>${emptyCells}</tr>`);
  const sumRow=isPartial
    ? `<tr class="sum"><td class="l">合計</td>${lotEmpty}${mfgEmpty}<td></td><td>${sv(tThis)}</td><td>${sv(tShip)}</td><td>${sv(tOrd)}</td><td>${sv(tRemain)}</td></tr>`
    : `<tr class="sum"><td class="l">合計</td>${lotEmpty}${mfgEmpty}<td></td><td>${sv(tThis)}</td></tr>`;
  rowsHtml.push(sumRow);
  const theadCols=isPartial
    ? `<th class="l" style="width:24%">品項</th>${lotTh}${mfgTh}<th style="width:9%">容量</th><th>本次出貨</th><th>已出貨</th><th>訂購總數</th><th>待出貨</th>`
    : `<th class="l" style="width:40%">品項</th>${lotTh}${mfgTh}<th style="width:14%">容量</th><th>出貨數量</th>`;
  const shipSeq=parseInt(d.shipSeq,10)||1; // 人工填的「第幾次出貨」，不再自動算
  const tag=(isPartial)?`<span class="tag">分批出貨・第 ${shipSeq} 次</span>`:'';

  const headerBlockHtml=`
  <div class="hd">
    <div class="hl"><img src="${VERIFY_LOGO}" alt="凱文南坡萬實業社"></div>
    <div class="hr">
      <div class="ttl">客戶驗收單${tag}</div>
      <div class="nos">單號 <b>${escHtml(d.no)}</b><span class="sp"></span>客戶批號 <b>${d.lot?escHtml(d.lot):'—'}</b></div>
    </div>
  </div>
  <div class="meta">
    <div><span>配送日期</span><b>${vfDate(d.shipDate)||'—'}</b></div>
    <div><span>專案經理</span><b>${escHtml(d.shipper||'')||'—'}</b></div>
    <div><span>客戶</span><b>${escHtml(d.client||'')||'—'}</b></div>
    <div><span>配送總箱數</span><b>${escHtml(d.boxes||'')?escHtml(d.boxes)+' 箱':'—'}</b></div>
  </div>`;

  const footBlockHtml=`
  <div class="ft">
    <div class="fl2">
      <div class="notes">
        <div class="nh">驗收與品質說明</div>
        <div class="nb"><b>驗收回報</b>　為保障您的權益，請於收到商品後 <b>7 日內</b>掃描右側 QR Code 完成線上驗收。若逾期未填寫，將視同驗收合格。如商品有任何問題，請隨時回報，我們將第一時間為您處理。</div>
        <div class="nb"><b>品質保證</b>　本產品採用<b>天然水果原料</b>製成，若瓶內出現果肉纖維或微量沉澱，均屬自然現象，請安心飲用。</div>
      </div>
    </div>
    <div class="qr">${qrSvg||''}<div class="cap">線上驗收回報</div><div class="cap2">收貨後 7 日內</div></div>
  </div>`;

  const pages=buildVerifyPages({headerBlockHtml, theadCols, rowsHtml, footBlockHtml});

  return `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"><title>驗收單_${escHtml(d.no)}</title>
<style>${verifyDocStyleBlock()}</style></head><body>
<div class="noprint">${isPreview?'<span class="pvtag">預覽・尚未留底</span>':''}<button onclick="window.print()">列印 / 另存 PDF</button></div>
${pages}
${isPreview?'':'<script>window.onload=function(){setTimeout(function(){try{window.print()}catch(e){}},350)}<\/script>'}
</body></html>`;
}

/* ===================================================================
   寄售鋪貨簡化版「出貨驗收單」（2026-08-03 加）
   跟報價單那套出貨 Lot 驗收單共用同一份版面 CSS／分頁邏輯（verifyDocStyleBlock／buildVerifyPages），
   但沒有「訂購總數／已出貨／待出貨」這些報價單才有的概念，只印品項/容量/數量＋簽收欄。
   單號用 CS-<客戶代碼>-<時間戳>（csGenVerifyNo，08_ownbrand.js），跟真報價單號分開兩套；
   QR 掃碼回報沿用同一套 c_verify.gs——後端查不到報價單時，會改查這裡存進留底的客戶名／品項
   （見 verifyFindQuoteRow_／verifyGetItemNames_ 的 CS- 分支，及 handleSaveVerifyForm_ 新增的 client 欄）。
   =================================================================== */
let CONSIGN_VF_DATA=null;
let CONSIGN_VF_EDIT_ID=null;   // 編輯模式：正在取代的舊留底紀錄ID（null＝一般新開）

function ensureConsignVerifyOverlay(){
  if(document.getElementById('cs-vf-overlay')) return;
  const ov=document.createElement('div');
  ov.className='v2ov'; ov.id='cs-vf-overlay';
  ov.innerHTML=`<div class="v2box" style="max-width:640px">
    <div class="v2h"><span>寄售鋪貨・出貨驗收單</span><button class="v2x" onclick="closeConsignVerifyForm()">✕</button></div>
    <div id="cs-vf-body"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn btn-g" onclick="closeConsignVerifyForm()">跳過，不產生</button>
      <button class="btn btn-g" onclick="previewConsignVerifyPdf()"><i class="ti ti-eye"></i>預覽</button>
      <button class="btn btn-gold" onclick="generateConsignVerifyPdf()"><i class="ti ti-file-download"></i>產生驗收單</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
}
function closeConsignVerifyForm(){ CONSIGN_VF_EDIT_ID=null; const o=document.getElementById('cs-vf-overlay'); if(o) o.style.display='none'; }

/* data={no, client, shipDate, handler, note, rows:[{name,vol,qty}]}；editId 有值＝編輯既有留底（產生後取代舊筆） */
function openConsignVerifyForm(data, editId){
  vfKeyFor(data&&data.no);   // 複檢 #2-1：先把 QR 驗證碼抓回來
  CONSIGN_VF_DATA={ ...data, rows:(data.rows||[]).map(r=>({...r})) };
  CONSIGN_VF_EDIT_ID=editId||null;
  ensureConsignVerifyOverlay();
  buildConsignVerifyModal();
  document.getElementById('cs-vf-overlay').style.display='flex';
}
function buildConsignVerifyModal(){
  const d=CONSIGN_VF_DATA; if(!d) return;
  const ttl=document.querySelector('#cs-vf-overlay .v2h span');
  if(ttl) ttl.textContent = CONSIGN_VF_EDIT_ID ? '編輯驗收單（產生後取代舊留底）' : '寄售鋪貨・出貨驗收單';
  const inS='border:1px solid var(--bd);border-radius:5px;padding:5px 7px;font-size:12px;font-family:inherit;width:100%';
  const rowsH=d.rows.map((r,i)=>`<tr${r.taster?' style="background:#FBF8F1"':''}>
    <td><input style="${inS}" data-i="${i}" data-k="name" class="cvfi" value="${escAttr(r.name||'')}">${r.taster?'<div style="font-size:10.5px;color:#7A5A1E;margin-top:3px">試飲瓶（免費贈送，不計價／不進庫存）</div>':''}</td>
    <td><input style="${inS};width:90px" data-i="${i}" data-k="vol" class="cvfi" value="${escAttr(r.vol||'')}"></td>
    <td><input type="number" min="0" style="${inS};width:80px" data-i="${i}" data-k="qty" class="cvfi" value="${(r.qty!==''&&r.qty!=null)?r.qty:''}"></td>
    <td style="text-align:center"><button class="del" onclick="csVfDelRow(${i})">✕</button></td>
  </tr>`).join('');
  document.getElementById('cs-vf-body').innerHTML=`
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
      <div class="fl"><label>客戶</label><input class="fi ro" id="cs-vf-client" value="${escHtml(d.client||'')}" readonly></div>
      <div class="fl"><label>單號</label><input class="fi ro" value="${escHtml(d.no||'')}" readonly></div>
      <div class="fl"><label>日期</label><input class="fi" type="date" id="cs-vf-date" value="${escHtml(d.shipDate||'')}"></div>
      <div class="fl"><label>經手人 <span class="opt">選填</span></label><input class="fi" id="cs-vf-handler" value="${escHtml(d.handler||'')}"></div>
      <div class="fl" style="grid-column:span 2"><label>備註 <span class="opt">選填</span></label><input class="fi" id="cs-vf-note" value="${escHtml(d.note||'')}"></div>
    </div>
    <div style="overflow-x:auto;margin-top:12px">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:var(--gold-pale);color:var(--gold-deep)">
          <th style="padding:7px 4px;text-align:left;padding-left:6px">酒款</th>
          <th style="padding:7px 4px">容量</th><th style="padding:7px 4px">數量</th><th style="padding:7px 4px"></th>
        </tr></thead>
        <tbody id="cs-vf-rows">${rowsH}</tbody>
      </table>
    </div>
    <button type="button" class="btn" style="border:1px solid #D9D6CC;background:#fff;color:#6B6B63;font-size:12px;padding:6px 12px;margin-top:8px" onclick="csVfAddRow()">＋ 新增品項</button>
    <p style="font-size:11px;color:var(--hint);margin-top:10px;line-height:1.6">簡化版驗收單：品項／容量／數量，右下 QR 供客戶收貨後線上驗收回報（版面與一般報價單的出貨驗收單一致，不另設簽收欄）。標「試飲」的列為免費贈送的試飲瓶。</p>`;
}
function csVfSyncFromInputs(){
  if(!CONSIGN_VF_DATA) return;
  document.querySelectorAll('#cs-vf-rows .cvfi').forEach(el=>{
    const i=+el.dataset.i, k=el.dataset.k;
    if(CONSIGN_VF_DATA.rows[i]) CONSIGN_VF_DATA.rows[i][k]=el.value;
  });
}
function csVfAddRow(){
  csVfSyncFromInputs();
  CONSIGN_VF_DATA.rows.push({name:'', vol:'', qty:''});
  buildConsignVerifyModal();
}
function csVfDelRow(i){
  csVfSyncFromInputs();
  CONSIGN_VF_DATA.rows.splice(i,1);
  if(!CONSIGN_VF_DATA.rows.length) CONSIGN_VF_DATA.rows.push({name:'', vol:'', qty:''});
  buildConsignVerifyModal();
}
function csVfCollect(){
  csVfSyncFromInputs();
  const d=CONSIGN_VF_DATA;
  const gvl=id=>{const e=document.getElementById(id);return e?e.value.trim():'';};
  d.client=gvl('cs-vf-client')||d.client;
  d.shipDate=gvl('cs-vf-date');
  d.handler=gvl('cs-vf-handler');
  d.note=gvl('cs-vf-note');
  d.rows=(d.rows||[]).filter(r=>String(r.name||'').trim()!==''&&(parseFloat(r.qty)||0)>0);
  return d;
}
function buildConsignVerifyDocHtml(d, opts){
  const isPreview=!!(opts&&opts.preview);
  const qrSvg=verifyQrSvg(verifyQrUrl(d.no,''),4);
  /* 2026-08-06 Molly：拿掉「簽收」欄，改對齊一般報價單那套出貨驗收單的格式
     （那套沒有簽收欄、也沒有手簽名欄位，一律走 QR 線上回報）。 */
  const theadCols=`<th class="l" style="width:58%">酒款</th><th style="width:21%">容量</th><th style="width:21%">數量</th>`;
  const rowsHtml=d.rows.map(r=>{
    // 試飲瓶：免費贈送，驗收單上明確標示，客戶一眼看得出這瓶不計價
    const tag=r.taster?' <span style="font-size:10px;font-weight:700;color:#7A5A1E;background:#F3ECDD;border-radius:4px;padding:1px 6px;margin-left:4px">試飲</span>':'';
    return `<tr><td class="l">${escHtml(r.name)}${tag}</td><td>${escHtml(r.vol)||'—'}</td><td>${(parseFloat(r.qty)||0)||'—'}</td></tr>`;
  });
  const headerBlockHtml=`
  <div class="hd">
    <div class="hl"><img src="${VERIFY_LOGO}" alt="凱文南坡萬實業社"></div>
    <div class="hr">
      <div class="ttl" style="font-size:19px">寄售鋪貨驗收單</div>
      <div class="nos">單號 <b>${escHtml(d.no)}</b><span class="sp"></span>日期 <b>${vfDate(d.shipDate)||'—'}</b></div>
    </div>
  </div>
  <div class="meta">
    <div><span>客戶</span><b>${escHtml(d.client||'')||'—'}</b></div>
    <div><span>經手人</span><b>${escHtml(d.handler||'')||'—'}</b></div>
    <div><span>備註</span><b>${escHtml(d.note||'')||'—'}</b></div>
  </div>`;
  const footBlockHtml=`
  <div class="ft">
    <div class="fl2">
      <div class="notes">
        <div class="nh">驗收與品質說明</div>
        <div class="nb"><b>驗收回報</b>　為保障您的權益，請於收到商品後 <b>7 日內</b>掃描右側 QR Code 完成線上驗收。若逾期未填寫，將視同驗收合格。如商品有任何問題，請隨時回報，我們將第一時間為您處理。</div>
        <div class="nb"><b>品質保證</b>　本產品採用<b>天然水果原料</b>製成，若瓶內出現果肉纖維或微量沉澱，均屬自然現象，請安心飲用。</div>
      </div>
    </div>
    <div class="qr">${qrSvg||''}<div class="cap">線上驗收回報</div><div class="cap2">收貨後 7 日內</div></div>
  </div>`;
  const pages=buildVerifyPages({headerBlockHtml, theadCols, rowsHtml, footBlockHtml});
  return `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"><title>寄售鋪貨驗收單_${escHtml(d.client||'')}_${escHtml(d.shipDate||'')}</title>
<style>${verifyDocStyleBlock()}</style></head><body>
<div class="noprint">${isPreview?'<span class="pvtag">預覽・尚未留底</span>':''}<button onclick="window.print()">列印 / 另存 PDF</button></div>
${pages}
${isPreview?'':'<script>window.onload=function(){setTimeout(function(){try{window.print()}catch(e){}},350)}<\/script>'}
</body></html>`;
}
function previewConsignVerifyPdf(){
  const d=csVfCollect(); if(!d||!d.rows.length){ toast('請至少填一項酒款與數量','err'); return; }
  const w=window.open('','_blank');
  if(!w){ toast('請允許彈出視窗，才能預覽','err'); return; }
  w.document.open(); w.document.write(buildConsignVerifyDocHtml(d,{preview:true})); w.document.close();
  toast('這只是預覽，不會留底；要正式送出請按「產生驗收單」','ok');
}
function generateConsignVerifyPdf(){
  const d=csVfCollect(); if(!d||!d.rows.length){ toast('請至少填一項酒款與數量','err'); return; }
  if(!vfKeyReady(d.no)) return;   // 複檢 #2-1：沒有 QR 驗證碼就先別印
  // 複檢 2026-08-13 #1-3：留底先存（試飲瓶只有留底查得到，彈窗被擋不能讓它整批消失）
  saveConsignVerifyFormRecord(d);
  closeConsignVerifyForm();
  const w=window.open('','_blank');
  if(!w){ toast('留底已存好了，但列印視窗被瀏覽器擋掉。請允許彈出視窗後，到「驗收單留底」重印這一筆','err'); return; }
  w.document.open(); w.document.write(buildConsignVerifyDocHtml(d)); w.document.close();
  toast('已開啟驗收單，於列印視窗選「另存為 PDF」','ok');
}
/* 存留底：跟報價單那套一樣存進「驗收單紀錄」（saveVerifyForm），額外多存 client 欄
   （報價單那套的客戶是靠單號查報價單歸戶，寄售這批沒有報價單可查，直接存客戶名）。
   編輯模式（CONSIGN_VF_EDIT_ID 有值）＝取代：先存新的，成功後刪舊的那筆。 */
function saveConsignVerifyFormRecord(d){
  try{
    if(!AUTH_TOKEN) return;
    const editId=CONSIGN_VF_EDIT_ID; CONSIGN_VF_EDIT_ID=null;
    const record={ no:d.no, lot:'', shipDate:d.shipDate, pm:d.handler||'', boxes:'', client:d.client,
      // taster 一起存進 items_json，之後從留底編輯這張單時「試飲」標示不會掉
      items:(d.rows||[]).map(r=>({ name:r.name, lot:'', vol:r.vol, mfg:'', thisShip:parseFloat(r.qty)||0, ordered:parseFloat(r.qty)||0, shipped:0, taster:r.taster?1:0 })) };
    /* 複檢 2026-08-06 #23：留底存檔原本失敗完全不出聲，使用者不會知道這批沒留底——
       下次開驗收單就算不到這批，「已出貨」歸零、「本次出貨」又帶成全部數量。改成明確提示。 */
    apiCall({action:'saveVerifyForm', token:AUTH_TOKEN, record}).then(res=>{
      if(!(res&&res.ok)){ toast('⚠ 這批的驗收單留底沒有存成功，下次開驗收單不會算到這批出貨量，請再產生一次','err'); return; }
      if(!editId) return;
      return apiCall({action:'deleteVerifyForm', token:AUTH_TOKEN, id:editId})
        .then(()=>{ toast('驗收單留底已更新（新版已取代舊紀錄）','ok'); })
        .catch(()=>{ toast('新留底已存，但舊紀錄刪除失敗，請到「驗收單留底」手動刪掉舊的那筆','err'); })
        .then(()=>{ try{ if(typeof loadVerifyMgmt==='function') loadVerifyMgmt(true); }catch(_){} });
    }).catch(()=>{
      toast('⚠ 這批的驗收單留底沒有存成功（連線問題），下次開驗收單不會算到這批出貨量，請確認後再產生一次','err');
    });
  }catch(_){}
}

