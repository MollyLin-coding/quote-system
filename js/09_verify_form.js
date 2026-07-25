/* ===================================================================
   出貨 Lot 驗收單（第一批・前端）
   從已存訂單一鍵帶入客戶/品項/批號/容量/總受訂數，補填配送與出貨，
   產 A4 橫式 PDF（含不良品欄、簽名欄、備註、QR）。
   QR 連到對話C 後端回報頁：<API_URL>?page=verify&no=..&lot=..（後端上線前為佔位）
   =================================================================== */
const VERIFY_LOGO="data:image/png;base64,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";
let VERIFY_DATA=null;
const VERIFY_MIN_ROWS=3;

function verifyQrUrl(no,lot){
  return API_URL+'?page=verify&no='+encodeURIComponent(no||'')+'&lot='+encodeURIComponent(lot||'');
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
      <button class="btn btn-g" onclick="generateVerifyPdf('partial')">產生分批驗收單</button>
      <button class="btn btn-gold" onclick="generateVerifyPdf('full')"><i class="ti ti-file-download"></i>產生整批驗收單</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
}
function closeVerifyForm(){ const o=document.getElementById('vf-overlay'); if(o) o.style.display='none'; }

async function openVerifyForm(no){
  if(!no) return;
  try{
    toast('讀取訂單資料…','ok');
    const data=await apiCall({ action:'getQuoteById', token:AUTH_TOKEN, quoteNo:no });
    const q=data.quote;
    if(!q){ toast('查無此單','err'); return; }
    const items=(q.items||[]).filter(it=>it.itemType==='bottle');
    if(!items.length){ toast('這張單沒有瓶裝品項，無法產生驗收單','err'); return; }
    let hdrLot='';
    for(const it of items){ const m=String(it.lot||'').match(/(\d+)/); if(m){ hdrLot=m[1]; break; } }
    VERIFY_DATA={ no:q.quoteNo, client:q.clientName||'',
      rows:items.map(it=>({ name:it.name||'', lot:it.lot||'', vol:it.volume||'',
        ordered:parseFloat(it.qty)||0, mfg:'', thisShip:(parseFloat(it.qty)||0), shipped:0 })) };
    buildVerifyModal(hdrLot);
    document.getElementById('vf-overlay').style.display='flex';
  }catch(e){ toast(e.message||'讀取失敗','err'); }
}

function buildVerifyModal(hdrLot){
  ensureVerifyOverlay();
  const d=VERIFY_DATA;
  const today=(function(){ const t=new Date(),p=n=>String(n).padStart(2,'0'); return t.getFullYear()+'-'+p(t.getMonth()+1)+'-'+p(t.getDate()); })();
  const inS='border:1px solid var(--bd);border-radius:5px;padding:5px 7px;font-size:12px;font-family:inherit;width:100%';
  const rowsH=d.rows.map((r,i)=>`<tr>
    <td style="font-weight:600;text-align:left;padding-left:6px">${escHtml(r.name)}</td>
    <td><input type="date" style="${inS};width:130px" data-i="${i}" data-k="mfg" class="vfi"></td>
    <td class="vf-lotcol" style="display:none"><input style="${inS};width:70px" data-i="${i}" data-k="lot" class="vfi" value="${escHtml(r.lot)}"></td>
    <td style="text-align:center;color:#6B6B63">${escHtml(r.vol)||'—'}</td>
    <td><input type="number" min="0" style="${inS};width:72px" data-i="${i}" data-k="thisShip" data-manual="0" class="vfi" value="${(r.thisShip!==''&&r.thisShip!=null)?r.thisShip:''}" oninput="onThisShipInput(this)"></td>
    <td style="text-align:center;font-weight:600">${r.ordered||0}</td>
    <td><input type="number" min="0" style="${inS};width:72px" data-i="${i}" data-k="shipped" class="vfi" value="0" oninput="onShippedInput(this)"></td>
    <td style="text-align:center;font-weight:700;color:var(--gold-deep)" id="vf-remain-${i}">${(parseFloat(r.ordered)||0)-(parseFloat(r.shipped)||0)-(parseFloat(r.thisShip)||0)}</td>
  </tr>`).join('');
  document.getElementById('vf-body').innerHTML=`
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
      <div class="fl"><label>客戶</label><input class="fi ro" value="${escHtml(d.client)}" readonly></div>
      <div class="fl"><label>抬頭 Lot 號</label><input class="fi" id="vf-lot" value="${escHtml(hdrLot||'')}" placeholder="如 31"></div>
      <div class="fl"><label>單號</label><input class="fi ro" value="${escHtml(d.no)}" readonly></div>
      <div class="fl"><label>配送日期</label><input class="fi" type="date" id="vf-shipdate" value="${today}"></div>
      <div class="fl"><label>專案經理 PM</label><input class="fi" id="vf-shipper" placeholder="PM 姓名"></div>
      <div class="fl"><label>此次配送總箱數</label><input class="fi" type="number" min="0" id="vf-boxes" placeholder="箱數"></div>
    </div>
    <label style="display:inline-flex;align-items:center;gap:6px;margin-top:12px;font-size:12px;color:var(--fg);cursor:pointer">
      <input type="checkbox" id="vf-showlot" onchange="toggleLotCol()"> 各品項不同批號時，顯示批號欄（預設隱藏，抬頭 Lot 仍會印）
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
    <p style="font-size:11px;color:var(--hint);margin-top:10px;line-height:1.6">
      「待出貨」＝總受訂數 − 已出貨 − 本次出貨數，系統自動算。<br>
      一次全部出貨用「產生整批驗收單」；分幾次出貨用「產生分批驗收單」（會多印訂購總數／待出貨欄）。PDF 下方含「驗收與品質說明」，右下 QR 供客戶收貨後線上驗收回報。</p>`;
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
  d.showLot=!!(document.getElementById('vf-showlot')&&document.getElementById('vf-showlot').checked);
  const gvl=id=>{const e=document.getElementById(id);return e?e.value.trim():'';};
  d.lot=gvl('vf-lot'); d.shipDate=gvl('vf-shipdate'); d.shipper=gvl('vf-shipper'); d.boxes=gvl('vf-boxes');
  const w=window.open('','_blank');
  if(!w){ toast('請允許彈出視窗，才能列印／存成 PDF','err'); return; }
  w.document.open(); w.document.write(buildVerifyDocHtml(d)); w.document.close();
  saveVerifyFormRecord(d);
  toast('已開啟驗收單，於列印視窗選「另存為 PDF」','ok');
}
/* 產生驗收單時，把這次的出貨紀錄留底到後台（fire-and-forget，失敗不擋前端） */
function saveVerifyFormRecord(d){
  try{
    if(!AUTH_TOKEN) return;
    const record={ no:d.no, lot:d.lot, shipDate:d.shipDate, pm:d.shipper, boxes:d.boxes,
      items:(d.rows||[]).map(r=>({ name:r.name, lot:r.lot, vol:r.vol, mfg:r.mfg, thisShip:r.thisShip, ordered:r.ordered, shipped:r.shipped })) };
    apiCall({action:'saveVerifyForm', token:AUTH_TOKEN, record}).catch(()=>{});
  }catch(_){}
}

function buildVerifyDocHtml(d){
  const mode=(d.mode==='partial')?'partial':'full';
  const isPartial=mode==='partial';
  const showLot=!!d.showLot;
  const qrSvg=verifyQrSvg(verifyQrUrl(d.no,d.lot),4);
  const volMl=v=>{ if(!v) return 0; const s=String(v).toLowerCase(); let m=s.match(/([\d.]+)\s*ml/); if(m) return parseFloat(m[1])||0; m=s.match(/([\d.]+)\s*l/); if(m) return (parseFloat(m[1])||0)*1000; m=s.match(/([\d.]+)/); return m?(parseFloat(m[1])||0):0; };
  const unitOf=r=>volMl(r.vol)>=4000?'桶':'瓶';
  const qty=(v,u)=>(v!==''&&v!=null&&!(typeof v==='number'&&isNaN(v)))?(v+' '+u):'';
  let tThis=0,tShip=0,tOrd=0;
  d.rows.forEach(r=>{ tThis+=parseFloat(r.thisShip)||0; tShip+=parseFloat(r.shipped)||0; tOrd+=parseFloat(r.ordered)||0; });
  const tRemain=tOrd-tShip-tThis;
  const units=Array.from(new Set(d.rows.map(unitOf)));
  const tw=(units.length===1)?(' '+units[0]):'';
  const lotTh=showLot?`<th>批號</th>`:'';
  const lotTd=r=>showLot?`<td>${escHtml(r.lot)}</td>`:'';
  const lotEmpty=showLot?'<td></td>':'';
  let body=d.rows.map(r=>{
    const u=unitOf(r);
    const remain=(parseFloat(r.ordered)||0)-(parseFloat(r.shipped)||0)-(parseFloat(r.thisShip)||0);
    if(isPartial){
      return `<tr>
      <td class="l">${escHtml(r.name)}</td>
      <td class="mut">${vfDate(r.mfg)||'—'}</td>
      ${lotTd(r)}
      <td class="mut">${escHtml(r.vol)}</td>
      <td>${qty(r.thisShip,u)}</td>
      <td class="mut">${qty(r.shipped,u)}</td>
      <td class="mut">${qty(r.ordered,u)}</td>
      <td>${(!isNaN(remain)&&remain>0)?(remain+' '+u):'—'}</td>
    </tr>`;
    }
    return `<tr>
      <td class="l">${escHtml(r.name)}</td>
      <td class="mut">${vfDate(r.mfg)||'—'}</td>
      ${lotTd(r)}
      <td class="mut">${escHtml(r.vol)}</td>
      <td>${qty(r.thisShip,u)}</td>
    </tr>`;
  }).join('');
  const colCount=(isPartial?7:4)+(showLot?1:0);
  const pad=Math.max(0,VERIFY_MIN_ROWS-d.rows.length);
  const emptyCells='<td class="l">&nbsp;</td>'+'<td></td>'.repeat(colCount-1);
  for(let k=0;k<pad;k++) body+=`<tr>${emptyCells}</tr>`;
  const sumRow=isPartial
    ? `<tr class="sum"><td class="l">合計</td><td></td>${lotEmpty}<td></td><td>${tThis}${tw}</td><td>${tShip}${tw}</td><td>${tOrd}${tw}</td><td>${tRemain>0?(tRemain+tw):0}</td></tr>`
    : `<tr class="sum"><td class="l">合計</td><td></td>${lotEmpty}<td></td><td>${tThis}${tw}</td></tr>`;
  const theadCols=isPartial
    ? `<th class="l" style="width:24%">品項</th><th style="width:13%">製造日期</th>${lotTh}<th style="width:9%">容量</th><th>本次出貨</th><th>已出貨</th><th>訂購總數</th><th>待出貨</th>`
    : `<th class="l" style="width:40%">品項</th><th style="width:18%">製造日期</th>${lotTh}<th style="width:14%">容量</th><th>出貨數量</th>`;
  const tag=(isPartial)?`<span class="tag">分批出貨</span>`:'';
  return `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"><title>驗收單_${escHtml(d.no)}</title>
<style>
@page{size:A4 landscape;margin:11mm}
*{box-sizing:border-box}
html,body{margin:0}
body{font-family:'Noto Sans TC','Microsoft JhengHei','PingFang TC','Heiti TC',sans-serif;color:#26261f;font-size:12px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
/* 外層表格：thead=頁首每頁重複、tfoot=頁尾每頁重複 */
table.page{width:100%;border-collapse:collapse}
table.page>thead{display:table-header-group}
table.page>tfoot{display:table-footer-group}
table.page>thead>tr>td,table.page>tfoot>tr>td,table.page>tbody>tr>td{padding:0}
.hd{display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:11px;border-bottom:1.4px solid #b9954e}
.hl{display:flex;align-items:center;gap:12px}
.hl img{height:30px;width:auto;display:block}
.hl .co{display:flex;align-items:center}
.hl .co small{font-size:8.5px;color:#9a9689;font-weight:500;letter-spacing:2px}
.hr{text-align:right}
.ttl{font-family:'DFKai-SB','標楷體','BiauKai','Kaiti TC','Noto Serif TC',serif;font-size:23px;font-weight:700;letter-spacing:9px;color:#2b4a37}
.tag{display:inline-block;font-family:'Noto Sans TC',sans-serif;font-size:9px;font-weight:700;color:#9a7b33;border:1px solid #d8c48f;border-radius:10px;padding:1px 9px;letter-spacing:1px;margin-left:8px;vertical-align:4px}
.nos{margin-top:6px;font-size:11px;color:#55554c}
.nos b{color:#26261f;font-weight:700;letter-spacing:.5px}
.nos .sp{display:inline-block;width:1px;height:10px;background:#d8d2c4;margin:0 10px;vertical-align:-1px}
.meta{display:flex;margin:13px 2px 0;font-size:11px;color:#55554c}
.meta div{flex:1}
.meta span{color:#9a9689;letter-spacing:1px;margin-right:6px;font-size:9.5px}
.meta b{color:#26261f;font-weight:700}
table.vt{width:100%;border-collapse:collapse;margin-top:14px;font-size:11.5px}
table.vt thead{display:table-header-group}
table.vt th{color:#5f5e54;font-weight:600;font-size:10px;letter-spacing:.6px;padding:0 6px 7px;border-bottom:1.2px solid #c7ac6e;text-align:center;white-space:nowrap;vertical-align:bottom}
table.vt th.l{text-align:left;padding-left:2px}
table.vt th .u{display:block;font-size:8px;color:#a8a49a;font-weight:400;margin-top:2px;letter-spacing:0}
table.vt tr{break-inside:avoid}
table.vt td{padding:0 6px;height:36px;text-align:center;border-bottom:.8px solid #eae5da;font-variant-numeric:tabular-nums;color:#33332c}
table.vt td.l{text-align:left;padding-left:2px;font-weight:600;color:#26261f}
table.vt td.mut{color:#9a9689}
table.vt tbody tr:last-child td{border-bottom:1.2px solid #d8d2c4}
table.vt tbody tr.sum td{font-weight:700;color:#26261f;border-top:1.3px solid #c7ac6e;border-bottom:none;height:32px}
table.vt tbody tr.sum td.l{color:#5f5e54;letter-spacing:2px;font-weight:700}
.ft{display:flex;justify-content:space-between;align-items:stretch;margin-top:24px;gap:28px}
.fl2{flex:1;display:flex;flex-direction:column;justify-content:flex-end;gap:14px}
.sign{display:flex;gap:34px;align-items:flex-end}
.sg .lb{font-size:9px;color:#9a9689;letter-spacing:1.5px;margin-bottom:9px}
.sg .u{border-bottom:1px solid #b3ab98;min-width:150px;height:1px}
.notes{border-left:2px solid #c7ac6e;padding-left:13px}
.notes .nh{font-size:10px;font-weight:700;color:#9a7b33;letter-spacing:2px;margin-bottom:6px}
.notes .nb{font-size:10px;color:#4a4438;line-height:1.7;position:relative;padding-left:13px;margin-top:3px}
.notes .nb:before{content:"•";position:absolute;left:1px;color:#b9954e;font-size:9px;top:.5px}
.notes .nb b{color:#2b2b22;font-weight:700}
.qr{text-align:center;flex-shrink:0;align-self:flex-end}
.qr svg{width:92px;height:92px;display:block;margin:0 auto}
.qr .cap{font-size:9px;color:#5a4a28;margin-top:5px;font-weight:700;letter-spacing:.5px}
.qr .cap2{font-size:8px;color:#9a9689;margin-top:2px;letter-spacing:.3px}
.pgft{margin-top:12px;padding-top:6px;border-top:.8px solid #efe7d8;display:flex;justify-content:space-between;font-size:8px;color:#b4ac9a;letter-spacing:1px}
@media print{.noprint{display:none}}
.noprint{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:9}
.noprint button{background:#2b4a37;color:#fff;border:none;border-radius:7px;padding:9px 20px;font-size:13px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)}
</style></head><body>
<div class="noprint"><button onclick="window.print()">列印 / 另存 PDF</button></div>
<table class="page">
<thead><tr><td>
  <div class="hd">
    <div class="hl"><img src="${VERIFY_LOGO}" alt="凱文南坡萬實業社"></div>
    <div class="hr">
      <div class="ttl">客戶驗收單${tag}</div>
      <div class="nos">單號 <b>${escHtml(d.no)}</b><span class="sp"></span>LOT <b>${d.lot?escHtml(d.lot):'—'}</b></div>
    </div>
  </div>
  <div class="meta">
    <div><span>配送日期</span><b>${vfDate(d.shipDate)||'—'}</b></div>
    <div><span>專案經理</span><b>${escHtml(d.shipper||'')||'—'}</b></div>
    <div><span>客戶</span><b>${escHtml(d.client||'')||'—'}</b></div>
    <div><span>配送總箱數</span><b>${escHtml(d.boxes||'')?escHtml(d.boxes)+' 箱':'—'}</b></div>
  </div>
</td></tr></thead>
<tfoot><tr><td>
  <div class="pgft"><span>凱文南坡萬實業社</span><span>批次代工 · 客製標籤 · SGS 檢驗</span></div>
</td></tr></tfoot>
<tbody><tr><td>
  <table class="vt"><thead><tr>${theadCols}</tr></thead><tbody>${body}${sumRow}</tbody></table>
  <div class="ft">
    <div class="fl2">
      <div class="sign">
        <div class="sg"><div class="lb">驗收日期</div><div class="u"></div></div>
        <div class="sg" style="flex:1"><div class="lb">驗收人簽名</div><div class="u" style="min-width:200px"></div></div>
      </div>
      <div class="notes">
        <div class="nh">驗收與品質說明</div>
        <div class="nb"><b>驗收回報</b>　為保障您的權益，請於收到商品後 <b>7 日內</b>掃描右側 QR Code 完成線上驗收。若逾期未填寫，將視同驗收合格。如商品有任何問題，請隨時回報，我們將第一時間為您處理。</div>
        <div class="nb"><b>品質保證</b>　本產品採用<b>天然水果原料</b>製成，若瓶內出現果肉纖維或微量沉澱，均屬自然現象，請安心飲用。</div>
      </div>
    </div>
    <div class="qr">${qrSvg||''}<div class="cap">線上驗收回報</div><div class="cap2">收貨後 7 日內</div></div>
  </div>
</td></tr></tbody>
</table>
<script>window.onload=function(){setTimeout(function(){try{window.print()}catch(e){}},350)}<\/script>
</body></html>`;
}

