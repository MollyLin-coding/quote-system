/* ============================================================
   2026-10-12：通路報價單（標準報價單，所有帳號可下載）＋舊價客戶
   ・價格不手打：讀公版酒主檔 ownbrand_products（來源「南坡萬公版_v2」NO1.V2_報價，每天 03:00 同步）
     ＋級距 ownbrand_tiers（buyout 6／5.5／5 折、consign 75 折）＋寄售條款 consign_terms。
   ・同一容量價格一樣的酒款自動併成一列（10 款統一價 → 一列「全系列 10 款通用」）。
   ・下載 PDF＝把報價單放在獨立 iframe 裡列印（樣式與系統隔離，不互相干擾）。
   ・舊價客戶（2026-10-12 Molly：250 是新價，島羽／downstairs 維持舊價、不設期限）：
     後端 legacy_prices 存漲價前的牌價，consign_customers.price_basis='old' 標記；
     報價單「公版酒帶入」依客戶名稱自動勾「舊價客戶」，帶入時用舊價當原價（可手動取消）。
   ============================================================ */
const PS_VOLS=[100,500,700];
const PS_CASE={100:50, 500:12, 700:12};          // 整箱出貨瓶數（主檔沒有這欄，固定值）
const PS_FOQ_DEFAULT={100:25, 500:12, 700:12};   // consign_terms 沒填時的寄售 FOQ
/* 酒款順序與風味短句（主檔沒有風味欄；新酒款沒寫到的會排在最後、風味留白） */
const PS_FLAVOR=[
  ['蜜香紅茶荔枝琴酒','花蜜尾韻・輕盈果香'],
  ['茉莉香片脆梅琴酒','茶韻悠長・酸甜回甘'],
  ['芭樂綠茶梅酒','果香奔放・鹹甜回甘'],
  ['包種茶青梅甜酒','清雅茶香・酸甜梅果'],
  ['白桃翠玉莫奇朵','果漾茶香・氣泡微醺'],
  ['海鹽西瓜莫奇朵','西瓜清甜・海鹽提韻'],
  ['煙燻百香果蘭姆酒','熱帶張揚・煙燻收斂'],
  ['青花椒烏梅蘭姆酒','椒香微麻・梅韻深邃'],
  ['泰奶烏龍蘭姆酒','絲絨奶香・沉韻炭焙'],
  ['梔子花金萱威士忌','醉意金萱・清雅梔子']
];
/* 主檔品名 → 報價單顯示名（主檔是簡稱） */
const PS_DISPLAY_NAME={'泰奶烏龍蘭姆酒':'泰奶焙火烏龍蘭姆酒'};
/* 徽章（固定文案；改這裡就好） */
const PS_BADGES=[
  ['🏨','五星飯店供應商','嘉佩樂・遠東香格里拉'],
  ['🏆','2024 賽事優勝','台灣水果調飲大賽'],
  ['🍸','誠品書店通路','2026 年 11 月進駐'],
  ['🌏','備戰國際賽事','正積極備戰中']
];
/* 圖：書法字用系統既有的 assets/logo.png；人像小圖內嵌（免另外上傳圖檔） */
const PS_FIG='data:image/png;base64,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';

function psVolNum(v){ const n=parseInt(String(v||'').replace(/[^\d]/g,''),10); return isNaN(n)?0:n; }
function psNum(v){ const n=parseFloat(String(v==null?'':v).replace(/[^\d.\-]/g,'')); return isNaN(n)?null:n; }
function psAbv(v){ let n=psNum(v); if(n==null) return null; if(n>1) n=n/100; return n; }
/* 寄售折數沿用舊報價單寫法：0.75 → 75折、0.7 → 7折 */
function psConsignText(d){ const z=Math.round(d*100); return (z%10===0?z/10:z)+'折'; }
function psFmt(n){ return Number(n).toLocaleString('en-US'); }
function psDiscText(d){ const z=Math.round(d*1000)/100; return (Number.isInteger(z)?z:String(z).replace(/0+$/,''))+'折'; }

/* 純函式：主檔＋級距＋條款 → 報價單模型（node 測試可直接呼叫） */
function psBuildModel(products, tiers, terms, now){
  terms=terms||{}; now=now||new Date();
  const byName={};
  (products||[]).forEach(p=>{
    if(String(p.active==null?'Y':p.active).toUpperCase()==='N') return;
    const vol=psVolNum(p.volume); if(!PS_VOLS.includes(vol)) return;   // 8000ml 桶裝等不列在通路報價單
    const price=psNum(p.list_price); if(price==null||price<=0) return;
    const nm=String(p.name||'').trim(); if(!nm) return;
    const o=byName[nm]||(byName[nm]={name:nm, abv:psAbv(p.abv), prices:{}});
    if(o.abv==null) o.abv=psAbv(p.abv);
    o.prices[vol]=price;
  });
  const order=PS_FLAVOR.map(x=>x[0]);
  const items=Object.values(byName).sort((a,b)=>{
    const ia=order.indexOf(a.name), ib=order.indexOf(b.name);
    return (ia<0?999:ia)-(ib<0?999:ib) || a.name.localeCompare(b.name,'zh-Hant');
  }).map(o=>{
    const f=PS_FLAVOR.find(x=>x[0]===o.name);
    const premium=(o.abv!=null && o.abv>=0.1);
    return {...o, display:PS_DISPLAY_NAME[o.name]||o.name, flavor:f?f[1]:'', series:premium?'premium':'classic'};
  });
  const vols=PS_VOLS.filter(v=>items.some(it=>it.prices[v]!=null));

  /* 系列（酒款清單用） */
  const abvText=list=>{ const a=[...new Set(list.map(it=>it.abv).filter(x=>x!=null))].map(x=>Math.round(x*1000)/10+'%'); return a.length===1?a[0]:a.join('／'); };
  const series=[['classic','經典系列'],['premium','典藏系列']].map(([k,label])=>{
    const list=items.filter(it=>it.series===k);
    return {key:k, label, abv:abvText(list), items:list};
  }).filter(s=>s.items.length);

  /* 價格分組：各容量價格完全一樣的酒款併成一列 */
  const groups=[];
  items.forEach(it=>{
    const sig=vols.map(v=>it.prices[v]==null?'-':it.prices[v]).join('|');
    let g=groups.find(x=>x.sig===sig);
    if(!g){ g={sig, prices:{...it.prices}, items:[]}; groups.push(g); }
    g.items.push(it);
  });
  groups.forEach(g=>{
    const n=g.items.length;
    if(groups.length===1){
      g.label=`全系列 ${n} 款通用`+(series.length>1?`（${series.map(s=>s.label.replace('系列','')+' ABV '+s.abv).join('・')}）`:'');
    }else{
      const s=series.find(s=>s.items.length===n && s.items.every(x=>g.items.includes(x)));
      g.label=s?`${s.label} ABV ${s.abv}（${n}款通用）`:g.items.map(x=>x.display).join('・');
    }
  });

  /* 級距 */
  const buy=(tiers||[]).filter(t=>String(t.channel)==='buyout')
    .map(t=>({min:psNum(t.min_qty)||0, disc:psNum(t.discount)}))
    .filter(t=>t.min>0 && t.disc>0 && t.disc<=1).sort((a,b)=>a.min-b.min);
  const cs=(tiers||[]).find(t=>String(t.channel)==='consign');
  const consignDisc=(cs && psNum(cs.discount)>0 && psNum(cs.discount)<=1)?psNum(cs.discount):0.75;
  groups.forEach(g=>{
    g.rows=vols.map(v=>{
      const lp=g.prices[v];
      if(lp==null) return {vol:v, lp:null, buy:buy.map(()=>null), consign:null};
      return {vol:v, lp, buy:buy.map(t=>Math.round(lp*t.disc)), consign:Math.round(lp*consignDisc)};
    });
  });

  const foq=vols.slice().reverse().map(v=>{
    const t=psNum(terms['foq_'+v+'ml']); return `${v}ml 每款${t!=null&&t>0?t:PS_FOQ_DEFAULT[v]}瓶`;
  }).join('／');
  const exMonths=psNum(terms.exchange_months)||6;
  const ym=`${now.getFullYear()} 年 ${now.getMonth()+1} 月`;
  const ymTag=`${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}`;
  return {
    items, series, groups, vols, buy, consignDisc,
    caseText: vols.map(v=>`${v}ml ${PS_CASE[v]}瓶/箱`).join('・'),
    foq, ship: String(terms.ship_note||'運費買方負擔').replace(/^運費/,'')||'買方負擔',
    exchange: `${exMonths}個月內（外觀完好）`,
    dateText: ym, fileName:`通路報價單_凱文南坡萬實業社_${ymTag}`,
    uniform: groups.length===1
  };
}

const PS_CSS=`@page{size:A4 portrait;margin:0}*{box-sizing:border-box;margin:0;padding:0}
:root{--green:#1f4628;--green-dk:#16331a;--brown:#6b3d1c;--gold:#8a6d2f;--gray:#555;--cream:#f7f4eb;--beige:#f0ead8;--green-mid:#2f6b3f}
html,body{background:#fff}
body{font-family:"Noto Sans TC","Microsoft JhengHei",sans-serif;color:#333;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;min-height:297mm;background:#fff;margin:0 auto;padding:10mm 9mm;position:relative}
.top-eyebrow{font-size:7.5pt;letter-spacing:2px;color:var(--gold);font-weight:600}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-top:2mm}
.brand{display:flex;align-items:center;gap:6px}.brand img.calli{height:13mm}.brand img.fig{height:12mm}
.tagline{font-size:7.5pt;color:#6b7a5e;margin-top:1.5mm}
.title-box{text-align:right}.title-box .t{font-size:21pt;font-weight:700;color:var(--green);letter-spacing:6px;font-family:"Noto Serif TC",serif}
.title-box .meta{font-size:7.5pt;color:#888;margin-top:1mm;line-height:1.5}
.badges{display:flex;gap:5px;margin:3mm 0 2mm}
.badge{flex:1;border:1px solid #e0d9c8;border-radius:5px;padding:2mm 1mm;text-align:center;background:#fdfcf9}
.badge .bi{font-size:16pt;line-height:7mm;height:7mm;font-family:"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif}.badge .b1{font-size:8pt;font-weight:700;color:var(--green);margin-top:1mm}.badge .b2{font-size:6.5pt;color:#999;margin-top:.5mm}
.sec-title{display:flex;align-items:center;gap:5px;font-size:10pt;font-weight:700;color:var(--green);margin:2mm 0}
.sec-title::before{content:"";width:3px;height:12px;background:var(--green);display:inline-block}
table.ptab{width:100%;border-collapse:collapse;font-size:9pt;margin-bottom:1mm}
table.ptab td{text-align:center;padding:7px 4px}
.ptab thead .h1 td{color:#fff;font-weight:700;font-size:9pt}
.ptab thead .cA{background:var(--green-dk)}.ptab thead .cB{background:var(--green)}.ptab thead .cC{background:var(--brown)}
.ptab thead .h2 td{color:#fff;font-size:6.8pt;padding:2px}
.ptab .srow td{background:var(--beige);text-align:left;font-weight:700;font-size:8.5pt;color:var(--green);padding:4px 8px}
.ptab td.sp{font-weight:700;color:#333;background:#fafaf6}.ptab td.rsp{color:#999;background:#fafafa}
.ptab td.buy{font-weight:700;color:#2a2a2a;background:#eef4ee}.ptab td.cons{font-weight:700;color:var(--brown);background:#f6efe7}
.ptab tbody td{border-top:1px solid #eee}
.plist{display:flex;gap:5mm;margin-top:1.5mm}
.pcol{flex:1;border:1px solid #e6dfce;border-radius:5px;overflow:hidden}
.pcol .ph{font-size:8.5pt;font-weight:700;color:#fff;background:var(--green);padding:2.2mm 3.5mm}.pcol.pm .ph{background:var(--brown)}
.pcol table{width:100%;border-collapse:collapse}
.pcol td{font-size:8pt;padding:2.6mm 3.5mm;border-top:1px solid #f0ece0;background:#fdfcf9}
.pcol td.nm{font-weight:700;color:#222;white-space:nowrap}.pcol td.fl{color:#888;font-size:7.2pt;text-align:right;white-space:nowrap}
.panels{display:flex;gap:6mm;margin-top:3mm}
.panel{flex:1;border-radius:5px;overflow:hidden;border:1px solid #e6dfce}
.panel .phead{color:#fff;font-weight:700;font-size:9pt;padding:3mm 4mm}.panel.left .phead{background:var(--green)}.panel.right .phead{background:var(--brown)}
.panel .pbody{background:var(--cream)}
table.summary{width:100%;border-collapse:collapse;table-layout:fixed}
table.summary td{height:7.4mm;vertical-align:middle;font-size:7.6pt;padding:0 3.5mm;white-space:nowrap}
table.summary td.lbl{text-align:left;color:var(--gray);width:30%}
table.summary td.val{text-align:right;color:var(--gold);font-weight:700}table.summary td.val.tight{font-size:6.6pt;letter-spacing:-.2px}
.note{background:var(--cream);border-left:4px solid #c8a951;padding:2.2mm 4mm;margin-top:2.8mm;font-size:7.6pt;color:#555;line-height:1.55}.note b{color:#333}
.footer{display:flex;justify-content:space-between;margin-top:2.5mm;font-size:7.5pt;color:#999;border-top:1px solid #eee;padding-top:2mm}
.footer .dept{color:var(--green);font-weight:700}
.warn{text-align:center;font-size:11pt;font-weight:800;color:#fff;background:#111;letter-spacing:1px;padding:2.2mm 2mm;margin-top:2.5mm;line-height:1.45}`;

function psAsset(name, base){ return name==='fig' ? PS_FIG : (base||'')+'assets/logo.png'; }
function psEsc(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* 模型 → 完整 HTML 文件（給 iframe srcdoc 與列印用） */
function psSheetHtml(m, base){
  const nB=m.buy.length, cols=2+nB+1;
  const wFirst=13, wRest=(100-wFirst)/(cols-1);
  const colg='<colgroup>'+`<col style="width:${wFirst}%">`+Array(cols-1).fill(`<col style="width:${wRest.toFixed(2)}%">`).join('')+'</colgroup>';
  const head=`<thead><tr class="h1"><td class="cA" rowspan="2">規格</td><td class="cB" rowspan="2">建議零售<br>參考</td>`+
    (nB?`<td class="cB" colspan="${nB}">一次性採購（免運）</td>`:'')+
    `<td class="cC" rowspan="2">合作寄售<br><span style="font-size:6.8pt;font-weight:400">${psConsignText(m.consignDisc)}</span></td></tr>`+
    `<tr class="h2">${m.buy.map(t=>`<td class="cB">MOQ ${psFmt(t.min)}瓶・${psDiscText(t.disc)}</td>`).join('')}</tr></thead>`;
  const body=m.groups.map(g=>`<tr class="srow"><td colspan="${cols}">▸ ${psEsc(g.label)}</td></tr>`+
    g.rows.map(r=>`<tr><td class="sp">${r.vol}ml</td><td class="rsp">${r.lp==null?'—':r.lp}</td>`+
      r.buy.map(b=>`<td class="buy">${b==null?'—':b}</td>`).join('')+
      `<td class="cons">${r.consign==null?'—':r.consign}</td></tr>`).join('')).join('');
  const plist=m.series.map(s=>`<div class="pcol${s.key==='premium'?' pm':''}"><div class="ph">${s.label} ABV ${psEsc(s.abv)}・${s.items.length} 款</div><table>`+
    s.items.map(it=>`<tr><td class="nm">${psEsc(it.display)}</td><td class="fl">${psEsc(it.flavor)}</td></tr>`).join('')+'</table></div>').join('');
  const buyRows=m.buy.map((t,i)=>`<tr><td class="lbl">MOQ 每款${psFmt(t.min)}瓶${i===nB-1?'+':''}</td><td class="val">${psDiscText(t.disc)}・免運</td></tr>`).join('');
  return `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="UTF-8"><title>${psEsc(m.fileName)}</title><style>${PS_CSS}</style></head><body><div class="page">
<div class="top-eyebrow">K E V I N N U M B E R 1 . &nbsp; E S T . &nbsp; 2 0 2 3 . &nbsp; T A I W A N</div>
<div class="header"><div><div class="brand"><img class="calli" src="${psAsset('logo',base)}"><img class="fig" src="${psAsset('fig',base)}"></div>
<div class="tagline">台灣茶調酒自有品牌・工藝自製・調製到裝瓶全程自主</div></div>
<div class="title-box"><div class="t">報　價　單</div><div class="meta">報價日期：${m.dateText}<br>有效期限：90 日<br>統一編號：92719710</div></div></div>
<div class="badges">${PS_BADGES.map(b=>`<div class="badge"><div class="bi">${b[0]}</div><div class="b1">${b[1]}</div><div class="b2">${b[2]}</div></div>`).join('')}</div>
<div class="sec-title">價格一覽（NT$，含稅）— ${m.uniform?`全系列 ${m.items.length} 款售價統一`:'同系列各款售價一致'}</div>
<table class="ptab">${colg}${head}<tbody>${body}</tbody></table>
<div class="sec-title">酒款清單（共 ${m.items.length} 款）</div>
<div class="plist">${plist}</div>
<div class="panels">
<div class="panel left"><div class="phead">一次性採購</div><div class="pbody"><table class="summary">${buyRows}
<tr><td class="lbl">整箱出貨</td><td class="val tight">${m.caseText}</td></tr></table></div></div>
<div class="panel right"><div class="phead">合作寄售</div><div class="pbody"><table class="summary">
<tr><td class="lbl">FOQ</td><td class="val tight">${psEsc(m.foq)}</td></tr>
<tr><td class="lbl">運費</td><td class="val">${psEsc(m.ship)}</td></tr>
<tr><td class="lbl">結算</td><td class="val">月結（每月5日對帳）</td></tr>
<tr><td class="lbl">換貨期限</td><td class="val">${psEsc(m.exchange)}</td></tr></table></div></div></div>
<div class="note"><b>備　註</b>　以上報價均為含稅價（已含菸酒稅・營業稅）。報價有效期 <b>90 日</b>，逾期請重新洽詢。客製酒標（ODM）方案另洽。<br>初次合作提供免費試飲樣品組，無採購承諾。</div>
<div class="footer"><div>凱文南坡萬實業社｜molly_lin@kevinnumber1-cocktail.com｜kevinnumber1-cocktail.com.tw</div><div><span class="dept">品牌開發部</span>　統一編號 92719710</div></div>
<div class="warn">禁止酒駕　・　飲酒過量，有害健康<br>未滿十八歲禁止飲酒</div>
</div></body></html>`;
}

/* ---- 頁面 ---- */
let PS_MODEL=null;
async function loadPriceSheet(force){
  const st=document.getElementById('ps-status');
  if(st) st.textContent='讀取公版酒價格中…';
  try{
    await loadOwnbrandData(!!force);
    PS_MODEL=psBuildModel(OWNBRAND_PRODUCTS, OWNBRAND_TIERS, CONSIGN_TERMS, new Date());
    if(!PS_MODEL.items.length) throw new Error('公版酒主檔沒有 100／500／700ml 的價格');
    const fr=document.getElementById('ps-frame');
    const base=location.href.replace(/[#?].*$/,'').replace(/[^/]*$/,'');
    fr.srcdoc=psSheetHtml(PS_MODEL, base);
    psFit();
    const synced=(OWNBRAND_PRODUCTS||[]).map(p=>String(p.synced_at||'')).sort().pop()||'';
    if(st) st.innerHTML=`價格來源：公版酒主檔（試算表「南坡萬公版_v2」，每天凌晨 3 點自動同步${synced?`；上次同步 ${escHtml(String(synced).replace('T',' ').slice(0,16))}`:''}）。改價請改試算表，報價單會跟著更新。`;
  }catch(e){
    if(st) st.textContent='讀取失敗：'+(e.message||e);
  }
}
function psFit(){
  const wrap=document.getElementById('ps-wrap'), fr=document.getElementById('ps-frame'); if(!wrap||!fr) return;
  const W=794, H=1123, s=Math.min(1, (wrap.clientWidth||W)/W);
  fr.style.transform=`scale(${s})`; wrap.style.height=(H*s)+'px';
}
function psDownload(){
  const fr=document.getElementById('ps-frame');
  if(!PS_MODEL||!fr||!fr.contentWindow){ toast('報價單還沒載入完成','err'); return; }
  try{ fr.contentWindow.focus(); fr.contentWindow.print(); }
  catch(e){ toast('無法開啟列印：'+(e.message||e),'err'); }
}
if(typeof window!=='undefined') window.addEventListener('resize',()=>{ if(typeof currentPage!=='undefined' && currentPage==='pricesheet') psFit(); });

/* ---- 舊價客戶（報價單「公版酒帶入」） ---- */
/* 客戶名稱比對用的詞：中文連續 2 字以上、英數連續 4 字以上（「島羽Wing Islands」→ 島羽／wing／islands） */
function psNameTokens(s){
  const t=String(s||'').toLowerCase();
  return [...(t.match(/[一-鿿]{2,}/g)||[]), ...(t.match(/[a-z0-9]{4,}/g)||[])];
}
function psIsLegacyClient(clientName, legacyNames){
  const key=String(clientName||'').toLowerCase().replace(/[\s　]+/g,'');
  if(!key) return false;
  return (legacyNames||[]).some(n=>psNameTokens(n).some(tok=>key.includes(tok)));
}
function psLegacyNames(){ return (typeof OWNBRAND_LEGACY!=='undefined' && OWNBRAND_LEGACY)||[]; }
function psSyncLegacyBox(){
  const cb=document.getElementById('ob-legacy'); if(!cb || cb.dataset.manual==='1') return;
  const cli=(document.getElementById('f-cli')||{}).value||'';
  cb.checked=psIsLegacyClient(cli, psLegacyNames());
  psLegacyHint();
}
function psLegacyHint(){
  const cb=document.getElementById('ob-legacy'), h=document.getElementById('ob-legacy-hint'); if(!cb||!h) return;
  const names=psLegacyNames();
  h.textContent=cb.checked
    ? '帶入的公版酒以舊價當原價（經典款 100ml 200 起算）；已帶入的品項不會自動改，要改請刪掉重帶。'
    : (names.length?'舊價客戶：'+names.join('、'):'');
}
function psLegacyToggled(){ const cb=document.getElementById('ob-legacy'); if(cb) cb.dataset.manual='1'; psLegacyHint(); }
/* 帶入時用的原價：勾了舊價客戶且主檔有舊價 → 舊價 */
function obEffectiveListPrice(p){
  const cb=document.getElementById('ob-legacy');
  const lg=parseFloat(p&&p.legacy_price);
  if(cb && cb.checked && lg>0) return lg;
  return p.list_price;
}
if(typeof document!=='undefined') document.addEventListener('DOMContentLoaded',()=>{
  const cli=document.getElementById('f-cli');
  if(cli){ cli.addEventListener('input',psSyncLegacyBox); cli.addEventListener('change',psSyncLegacyBox); }
});
if(typeof onHook==='function') onHook('afterReset',()=>{ const cb=document.getElementById('ob-legacy'); if(cb){ cb.dataset.manual=''; cb.checked=false; } psLegacyHint(); });
if(typeof module!=='undefined') module.exports={psBuildModel, psSheetHtml, psIsLegacyClient, psNameTokens};
