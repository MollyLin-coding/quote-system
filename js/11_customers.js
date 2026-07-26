/* ============================================================
   客戶管理（2026-07-26 新增；同日加上「可編輯的客戶主檔」＝後端 v40）
   ── 兩層資料疊在一起：
      1. 客戶主檔 customers（後端 v40 的 getCustomers／saveCustomer／deleteCustomer）
         ＝Molly 自己維護的那一份，有填的欄位一律優先。
      2. 從既有報價單「歸戶」算出來的資料（原本就有的做法，見下），
         主檔沒填的欄位就用它補，統計數字（成交、未收款、客訴）也一律來自這裡。
      所以：主檔還沒建的客戶照樣看得到；主檔新增的客戶就算還沒開過單也看得到。
   ── 從既有的五份讀取資料「歸戶」算出來
      getQuotes（標準報價單，含聯絡人／電話／統編／地址／發票抬頭）
      listCustomQuotes（自訂報價單）
      getOrderStatusList（訂單進度、訂金、尾款）
      getVerifications（客戶掃碼回報／客訴）
      listVerifyForms（驗收單留底，只有單號 → 靠報價單反查客戶）
      這五份正好就是登入後背景預抓那幾份（見 08_ownbrand prefetchPayloads），
      所以正常情況下切進這頁是 0 個後端請求、直接秒開。
   ── 歸戶鍵＝客戶名稱去掉空白與大小寫差異；顯示用最近一張單的原始寫法。
   ============================================================ */
let CUS_DATA = null;      // [{key, name, ...}] 已排序前的彙整結果
let CUS_SEL = null;       // 目前展開明細的客戶 key
let CUS_SORT = 'last';    // last | amount | unpaid | count | name
let CUS_KW = '';

function cusPayloads(){
  return ordPayloads().concat([
    { action:'getVerifications', token:AUTH_TOKEN, filters:{} },
    { action:'listVerifyForms',  token:AUTH_TOKEN, filters:{} },
    { action:'getCustomers',     token:AUTH_TOKEN }
  ]);
}
/* 主檔欄位名（後端 snake_case）↔ 這支檔案內部用的欄位名 */
const CUS_M2D = { contact:'contact', phone:'phone', email:'email', tax_id:'taxId',
  invoice_title:'invoiceTitle', address:'address', ship_contact:'shipContact',
  ship_phone:'shipPhone', ship_address:'shipAddress', pay_habit:'payHabit',
  tags:'tags', note:'note' };
/* 報價單 quote 物件欄位 ↔ 主檔欄位（存單後比對用） */
const CUS_Q2M = { contactName:'contact', contactPhone:'phone', clientTaxId:'tax_id',
  invoiceTitle:'invoice_title', clientAddress:'address', shipContact:'ship_contact',
  shipPhone:'ship_phone', shipAddress:'ship_address' };
const CUS_FLABEL = { contact:'聯絡人', phone:'聯絡電話', email:'Email', tax_id:'客戶統編',
  invoice_title:'發票抬頭', address:'聯絡地址', ship_contact:'出貨收件人',
  ship_phone:'收件人電話', ship_address:'出貨地址', pay_habit:'付款習慣', tags:'標籤', note:'備註' };
let CUS_MASTER = [];      // 客戶主檔原始列（active 的）
function cusKey(name){ return String(name==null?'':name).replace(/[\s　]+/g,'').toLowerCase(); }
/* 「最近一張單才算數」：日期較新的單，其非空欄位可以蓋掉舊的 */
function cusFill(dst, src, date){
  ['contact','phone','taxId','address','invoiceTitle','shipContact','shipPhone','shipAddress','handler'].forEach(k=>{
    const v = String(src[k]==null?'':src[k]).trim();
    if(v && (!dst[k] || String(date||'') >= String(dst[k+'_at']||''))){ dst[k]=v; dst[k+'_at']=date||''; }
  });
}

/* 把五份資料算成客戶陣列 */
function cusBuild(qs, cq, os, gv, lf, gc){
  const stMap={}; ((os&&os.orders)||[]).forEach(o=>{ stMap[String(o.quote_no)]=o; });
  const map={};                                   // key -> 客戶
  const noOwner={};                               // 單號 -> 客戶 key（給驗收資料反查）
  const get=(name)=>{
    const k=cusKey(name);
    if(!map[k]) map[k]={ key:k, name:String(name||'').trim()||'（未填客戶）', quotes:[], reports:[], forms:[] };
    return map[k];
  };

  ((qs&&qs.quotes)||[]).filter(q=>q.status!=='已刪除').forEach(q=>{
    const c=get(q.clientName);
    const date=q.quoteDate||q.createdAt||'';
    if(String(q.clientName||'').trim() && date >= String(c.name_at||'')){ c.name=String(q.clientName).trim(); c.name_at=date; }
    cusFill(c, { contact:q.contactName, phone:q.contactPhone, taxId:q.clientTaxId, address:q.clientAddress,
      invoiceTitle:q.invoiceTitle, shipContact:q.shipContact, shipPhone:q.shipPhone, shipAddress:q.shipAddress,
      handler:q.handler }, date);
    c.quotes.push({ no:q.quoteNo, typeKey:q.quoteType, date:q.quoteDate||'', total:parseFloat(q.grandTotal)||0,
      st:stMap[String(q.quoteNo)]||null, src:'std' });
    noOwner[String(q.quoteNo)]=c.key;
  });
  ((cq&&cq.quotes)||[]).forEach(q=>{
    const c=get(q.client);
    const date=q.quote_date||'';
    c.quotes.push({ no:q.quote_no, typeKey:'custom', date:date, total:parseJsonSafe(q.totals_json,{}).total||0,
      st:stMap[String(q.quote_no)]||null, src:'custom', tag:q.tag||'' });
    noOwner[String(q.quote_no)]=c.key;
  });

  /* 驗收／客訴：先認 record 自己的客戶欄，認不出來就用單號反查 */
  ((gv&&gv.records)||[]).forEach(r=>{
    let k=null;
    if(String(r.client||'').trim() && map[cusKey(r.client)]) k=cusKey(r.client);
    if(!k) k=noOwner[String(r.no)];
    if(!k && String(r.client||'').trim()) k=get(r.client).key;
    if(k && map[k]) map[k].reports.push(r);
  });
  ((lf&&lf.records)||[]).forEach(f=>{
    const k=noOwner[String(f.no)];
    if(k && map[k]) map[k].forms.push(f);
  });

  /* 疊上客戶主檔：主檔有填的欄位優先；主檔有、但還沒開過單的客戶也要出現在清單 */
  CUS_MASTER = ((gc&&gc.customers)||[]).filter(m=>String(m.name||'').trim()||String(m.customer_id||'').trim());
  CUS_MASTER.forEach(m=>{
    const c=get(m.name);
    c.master=m; c.id=m.customer_id;
    if(String(m.name||'').trim()) c.name=String(m.name).trim();
    Object.keys(CUS_M2D).forEach(mk=>{
      const v=String(m[mk]==null?'':m[mk]).trim();
      if(v) c[CUS_M2D[mk]]=v;                 // 主檔有填就蓋掉報價單推出來的
      else if(mk==='pay_habit'||mk==='tags'||mk==='note'||mk==='email') c[CUS_M2D[mk]]=c[CUS_M2D[mk]]||'';
    });
  });

  /* 每個客戶算統計 */
  const list=Object.keys(map).map(k=>{
    const c=map[k];
    c.quotes.sort((a,b)=> String(b.date||'').localeCompare(String(a.date||'')) || String(b.no||'').localeCompare(String(a.no||'')));
    c.count=c.quotes.length;
    c.quoteSum=c.quotes.reduce((s,q)=>s+(q.total||0),0);
    const dealt=c.quotes.filter(q=>{ const s=q.st&&q.st.status; return s && s!=='quoted' && s!=='cancelled'; });
    c.dealCount=dealt.length;
    c.dealSum=dealt.reduce((s,q)=>s+(q.total||0),0);
    c.unpaidList=c.quotes.filter(q=>{ const s=q.st&&q.st.status; return (s==='shipped'||s==='invoiced') && !(q.st&&q.st.final_date); });
    c.unpaid=c.unpaidList.reduce((s,q)=>s+cusFinalAmt(q).amt,0);
    c.openList=c.quotes.filter(q=>{ const s=(q.st&&q.st.status)||'quoted'; return s!=='closed' && s!=='cancelled' && s!=='paid'; });
    c.lastDate=c.quotes.length?(c.quotes[0].date||''):'';
    c.pending=c.reports.filter(r=>typeof vmIsUnhandled==='function' && vmIsUnhandled(r)).length;
    return c;
  });
  return list;
}
/* 尾款金額：跟月報表同一套算法（沒填尾款金額就用總計減訂金推估） */
function cusFinalAmt(q){
  const s=q.st||{};
  if(s.final_amt!=null && s.final_amt!==''){ return { amt:parseFloat(s.final_amt)||0, est:false }; }
  const gt=(s.grand_total!=null && s.grand_total!=='') ? (parseFloat(s.grand_total)||0) : (q.total||0);
  return { amt: gt-(parseFloat(s.deposit_amt)||0), est:true };
}

async function loadCustomers(force){
  const body=document.getElementById('cus-body');
  const P=cusPayloads();
  const hits=P.map(p=>rcPeek(p));
  if(!force && hits.every(h=>h&&h.data)){
    CUS_DATA=cusBuild(hits[0].data, hits[1].data, hits[2].data, hits[3].data, hits[4].data, hits[5].data);
    renderCustomers();
    if(P.every(p=>rcFresh(p))) return CUS_DATA;                 // 90 秒內剛抓過就不重打
  }else if(body){ body.innerHTML=sklTableRows(7,5); }
  try{
    let d;
    try{ d=await readCallMany(P, force); }                       // 六份 → 走後端 v37 的 batch
    catch(_){ d=await Promise.all(P.map(p=>readCall(p, force).catch(e=>({ok:false,error:e.message})))); }
    CUS_DATA=cusBuild(d[0], d[1], d[2], d[3], d[4], d[5]);
    renderCustomers();
    return CUS_DATA;
  }catch(e){
    if(body && !CUS_DATA) body.innerHTML=`<tr><td colspan="7" class="rec-empty">${escHtml(e.message||'載入失敗')}</td></tr>`;
  }
}
onCacheClear(function(){ CUS_DATA=null; });

function cusOnSearch(){ const e=document.getElementById('cus-search'); CUS_KW=e?e.value.trim():''; renderCustomers(); }
function cusOnSort(){ const e=document.getElementById('cus-sort'); CUS_SORT=e?e.value:'last'; renderCustomers(); }
function cusMatch(c, kw){
  if(!kw) return true;
  const k=kw.toLowerCase();
  return [c.name,c.contact,c.phone,c.taxId,c.invoiceTitle,c.address,c.email,c.tags,c.note,c.payHabit]
        .some(v=>String(v||'').toLowerCase().includes(k))
      || c.quotes.some(q=>String(q.no||'').toLowerCase().includes(k));
}
function cusSorted(){
  const list=(CUS_DATA||[]).filter(c=>cusMatch(c, CUS_KW));
  const by={
    last:  (a,b)=> String(b.lastDate||'').localeCompare(String(a.lastDate||'')),
    amount:(a,b)=> b.dealSum-a.dealSum,
    unpaid:(a,b)=> b.unpaid-a.unpaid,
    count: (a,b)=> b.count-a.count,
    name:  (a,b)=> String(a.name).localeCompare(String(b.name),'zh-Hant')
  };
  return list.sort(by[CUS_SORT]||by.last);
}
function cusFind(key){ return (CUS_DATA||[]).find(c=>c.key===key)||null; }
function cusTypeLabel(t){
  return { bottle:'瓶裝酒代工', banquet:'宴會酒水', ownbrand:'公版酒買斷', ownlabel:'公版酒客製標',
    consign:'寄售月結', custom:'自訂單' }[t] || '其他';
}

function renderCustomers(){
  const body=document.getElementById('cus-body'); if(!body) return;
  if(CUS_DATA==null){ body.innerHTML=sklTableRows(7,5); return; }
  const list=cusSorted();
  const stats=document.getElementById('cus-stats');
  if(stats){
    const tot=(CUS_DATA||[]).reduce((s,c)=>s+c.dealSum,0);
    const un=(CUS_DATA||[]).reduce((s,c)=>s+c.unpaid,0);
    const pend=(CUS_DATA||[]).reduce((s,c)=>s+c.pending,0);
    stats.innerHTML=`<div class="rpt-stats">
      <div class="rpt-stat"><div class="k">客戶數</div><div class="v">${CUS_DATA.length} 位</div></div>
      <div class="rpt-stat"><div class="k">累計成交金額</div><div class="v" style="color:#A6824A">${money(tot)}</div></div>
      <div class="rpt-stat"><div class="k">還沒收的尾款</div><div class="v" style="color:${un?'#B03A2E':'#2E7D4F'}">${money(un)}</div></div>
      <div class="rpt-stat"><div class="k">待處理客訴</div><div class="v" style="color:${pend?'#B5541F':'#2E7D4F'}">${pend} 件</div></div>
    </div>`;
  }
  if(!list.length){
    body.innerHTML=`<tr><td colspan="7" class="rec-empty">${(CUS_DATA||[]).length?'沒有符合條件的客戶':'尚無客戶資料（存出第一張報價單後就會出現）'}</td></tr>`;
  }else{
    body.innerHTML=list.map(c=>{
      const d=daysBetween(c.lastDate);
      const ago=(d==null)?'—':(d===0?'今天':(-d)+' 天前');
      return `<tr class="clickable${CUS_SEL===c.key?' cus-on':''}" onclick="cusOpen('${escAttr(c.key)}')">
        <td class="mc-main" style="font-weight:600">${escHtml(c.name)}${c.pending?`<span class="ob warn" style="margin-left:6px">客訴 ${c.pending}</span>`:''}${
          cusTagsHtml(c)}${c.master?'':'<span class="ob grey" style="margin-left:6px">未建主檔</span>'}</td>
        <td data-l="聯絡">${escHtml(c.contact||'—')}${c.phone?'<span style="color:#A8A69C"> ／ </span>'+escHtml(c.phone):''}</td>
        <td data-l="報價" style="text-align:center">${c.count} 筆${c.dealCount?`<span style="color:#A8A69C">（成交 ${c.dealCount}）</span>`:''}</td>
        <td data-l="成交金額" style="text-align:right;font-weight:600">${money(c.dealSum)}</td>
        <td data-l="未收尾款" style="text-align:right;${c.unpaid?'color:#B03A2E;font-weight:600':'color:#A8A69C'}">${c.unpaid?money(c.unpaid):'—'}</td>
        <td data-l="最後往來" style="text-align:center;white-space:nowrap">${escHtml(c.lastDate||'—')}<span style="font-size:10.5px;color:#A8A69C">　${ago}</span></td>
        <td class="rec-actions" data-l="操作" onclick="event.stopPropagation()">
          <button class="rec-act-btn" onclick="cusOpen('${escAttr(c.key)}')">${CUS_SEL===c.key?'收起':'明細'}</button>
          <button class="rec-act-btn" onclick="openCusEdit('${escAttr(c.key)}')">編輯</button>
          <button class="rec-act-btn" onclick="cusNewQuote('${escAttr(c.key)}')">開新單</button>
        </td>
      </tr>`;
    }).join('');
  }
  renderCusDetail();
}

function cusOpen(key){
  CUS_SEL = (CUS_SEL===key) ? null : key;
  renderCustomers();
  if(CUS_SEL){ const el=document.getElementById('cus-detail'); if(el && el.scrollIntoView) el.scrollIntoView({block:'nearest'}); }
}
function cusCloseDetail(){ CUS_SEL=null; renderCustomers(); }

function cusKv(label, val, copy){
  const v=String(val==null?'':val).trim();
  return `<div class="cus-kv"><div class="k">${escHtml(label)}</div><div class="v">${v?escHtml(v):'<span style="color:#C4C2B8">—</span>'}${
    (v&&copy!==false)?`<button class="cus-copy" title="複製" onclick="cusCopy('${escAttr(v)}')"><i class="ti ti-copy"></i></button>`:''}</div></div>`;
}
function cusCopy(t){
  const done=()=>{ if(typeof toast==='function') toast('已複製：'+t,'ok'); };
  try{
    if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(t).then(done, ()=>cusCopyFallback(t)); return; }
  }catch(_){}
  cusCopyFallback(t);
}
function cusCopyFallback(t){
  try{
    const ta=document.createElement('textarea');
    ta.value=t; ta.style.position='fixed'; ta.style.left='-9999px';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    if(typeof toast==='function') toast('已複製：'+t,'ok');
  }catch(e){ if(typeof toast==='function') toast('複製失敗，請手動選取','err'); }
}

function renderCusDetail(){
  const el=document.getElementById('cus-detail'); if(!el) return;
  const c=CUS_SEL?cusFind(CUS_SEL):null;
  if(!c){ el.innerHTML=''; return; }

  /* 1. 聯絡資訊 */
  const info=`<div class="cus-kvs">
    ${cusKv('聯絡人', c.contact)}
    ${cusKv('聯絡電話', c.phone)}
    ${cusKv('Email', c.email)}
    ${cusKv('客戶統編', c.taxId)}
    ${cusKv('發票抬頭', c.invoiceTitle)}
    ${cusKv('付款習慣', c.payHabit)}
    ${cusKv('聯絡地址', c.address)}
    ${cusKv('出貨聯絡人', c.shipContact)}
    ${cusKv('出貨電話', c.shipPhone)}
    ${cusKv('出貨地址', c.shipAddress)}
  </div>${c.note?`<div class="cus-note"><b>備註</b>${escHtml(c.note)}</div>`:''}`;

  /* 2. 往來報價單 */
  const qRows=c.quotes.map(q=>{
    const s=(q.st&&q.st.status)||'';
    const pill=s?`<span class="ob ${s==='cancelled'?'grey':(s==='closed'||s==='paid')?'':'info'}">${escHtml(stageLabel(s))}</span>`:'<span class="ob grey">未建進度</span>';
    return `<tr class="clickable" onclick="cusOpenQuote('${escAttr(q.no)}','${escAttr(q.src)}')">
      <td class="mc-main" style="font-weight:600">${escHtml(q.no||'—')}</td>
      <td data-l="日期">${escHtml(q.date||'—')}</td>
      <td data-l="類型">${escHtml(cusTypeLabel(q.typeKey))}${q.tag?'<span style="color:#A8A69C">｜'+escHtml(q.tag)+'</span>':''}</td>
      <td data-l="金額" style="text-align:right;font-weight:600">${money(q.total)}</td>
      <td data-l="進度">${pill}</td>
    </tr>`;
  }).join('');

  /* 3. 訂單進度與未收款 */
  const openRows=c.openList.map(q=>{
    const s=q.st||{}; const stat=s.status||'quoted';
    const fa=cusFinalAmt(q);
    const owe=(stat==='shipped'||stat==='invoiced')&&!s.final_date;
    const fde=s.final_date_est; let fdeTxt='—';
    if(fde){ const d=daysBetween(fde); fdeTxt=(d!=null&&d<0)?`<span style="color:#B03A2E;font-weight:600">${escHtml(String(fde).slice(5))}（逾期${-d}天）</span>`:escHtml(String(fde).slice(5)); }
    return `<tr class="clickable" onclick="cusGotoOrder('${escAttr(q.no)}')">
      <td class="mc-main" style="font-weight:600">${escHtml(q.no)}</td>
      <td data-l="進度">${escHtml(stageLabel(stat))}</td>
      <td data-l="出貨日" style="text-align:center">${escHtml(s.ship_date_actual||s.ship_date_est||'—')}${(!s.ship_date_actual&&s.ship_date_est)?'<span style="color:#A8A69C;font-size:10.5px">（預計）</span>':''}</td>
      <td data-l="未收尾款" style="text-align:right;${owe?'color:#B03A2E;font-weight:600':'color:#A8A69C'}">${owe?money(fa.amt)+(fa.est?'<span style="color:#B5541F;font-size:10.5px;margin-left:3px">推估</span>':''):'—'}</td>
      <td data-l="預計尾款日" style="text-align:center">${fdeTxt}</td>
    </tr>`;
  }).join('');

  /* 4. 驗收／客訴 */
  const vRows=c.reports.map(r=>{
    const cat=(typeof vmCat==='function')?vmCat(r):'';
    const pill=(typeof vmStatusPill==='function')?vmStatusPill(r):'';
    return `<tr>
      <td class="mc-main">${escHtml(vmLocalYmd(r.created_at)||'—')}</td>
      <td data-l="單號">${escHtml(r.no||'—')}${r.lot?'<span style="color:#A8A69C">｜Lot '+escHtml(r.lot)+'</span>':''}</td>
      <td data-l="分類">${escHtml(cat)}</td>
      <td data-l="內容">${escHtml(String(r.desc||'').slice(0,60))||'—'}</td>
      <td data-l="狀態">${pill}</td>
    </tr>`;
  }).join('');

  el.innerHTML=`<div class="card cus-detail">
    <div class="ch"><i class="ti ti-user"></i><span>${escHtml(c.name)}</span>${cusTagsHtml(c)}
      <span class="ch-opt">
        <button class="rec-act-btn" onclick="openCusEdit('${escAttr(c.key)}')"><i class="ti ti-edit"></i> ${c.master?'編輯客戶資料':'建立客戶主檔'}</button>
        <button class="rec-act-btn" onclick="cusNewQuote('${escAttr(c.key)}')"><i class="ti ti-file-plus"></i> 用這客戶開新報價單</button>
        <button class="rec-act-btn" onclick="cusCloseDetail()">收起</button>
      </span></div>
    <div class="cb">
      <div class="rpt-stats" style="margin-top:0">
        <div class="rpt-stat"><div class="k">報價 / 成交</div><div class="v">${c.count} / ${c.dealCount} 筆</div></div>
        <div class="rpt-stat"><div class="k">成交金額</div><div class="v" style="color:#A6824A">${money(c.dealSum)}</div></div>
        <div class="rpt-stat"><div class="k">還沒收的尾款</div><div class="v" style="color:${c.unpaid?'#B03A2E':'#2E7D4F'}">${money(c.unpaid)}</div></div>
      </div>

      <div class="cus-sec">聯絡資訊<span class="cus-hint">${c.master?'以客戶主檔為準，主檔沒填的用最近一張單補':'還沒建主檔，全部取自最近一張單'}；點右邊圖示可複製</span></div>
      ${info}

      <div class="cus-sec">往來報價單（${c.quotes.length}）<span class="cus-hint">點一列開啟那張單</span></div>
      ${c.quotes.length?`<div class="tbl-scroll"><table class="rec-table mcard"><thead><tr><th>單號</th><th>日期</th><th>類型</th><th style="text-align:right">金額</th><th>進度</th></tr></thead><tbody>${qRows}</tbody></table></div>`
        :'<div class="rec-empty" style="padding:22px">尚無報價單</div>'}

      <div class="cus-sec">進行中訂單與未收款（${c.openList.length}）<span class="cus-hint">已結案／已取消不列；點一列前往訂單追蹤</span></div>
      ${c.openList.length?`<div class="tbl-scroll"><table class="rec-table mcard"><thead><tr><th>單號</th><th>進度</th><th style="text-align:center">出貨日</th><th style="text-align:right">未收尾款</th><th style="text-align:center">預計尾款日</th></tr></thead><tbody>${openRows}</tbody></table></div>`
        :'<div class="rec-empty" style="padding:22px">沒有進行中的訂單 🎉</div>'}

      <div class="cus-sec">驗收 / 客訴紀錄（${c.reports.length}）<span class="cus-hint">驗收單留底 ${c.forms.length} 張</span></div>
      ${c.reports.length?`<div class="tbl-scroll"><table class="rec-table mcard"><thead><tr><th>日期</th><th>單號</th><th>分類</th><th>內容</th><th>狀態</th></tr></thead><tbody>${vRows}</tbody></table></div>`
        :'<div class="rec-empty" style="padding:22px">尚無回報紀錄</div>'}
    </div>
  </div>`;
}

/* 明細裡的動作 */
function cusOpenQuote(no, src){
  if(src==='custom'){ toast('自訂報價單請在「自訂報價單」頁面開啟','ok'); gotoPage('custom'); return; }
  openRecord(no);
}
function cusGotoOrder(no){
  gotoPage('orders');
  if(typeof openOrdEdit==='function') setTimeout(()=>openOrdEdit(no), 300);
}
/* 用這個客戶的資料開一張新報價單（只帶客戶欄位，品項自己填） */
function cusNewQuote(key){
  const c=cusFind(key); if(!c) return;
  newQuote();                                    // 沿用既有流程（會問未儲存、清表單、帶下一個流水號）
  const set=(id,v)=>{ const e=document.getElementById(id); if(e && v) e.value=v; };
  set('f-cli', c.name); set('f-con', c.contact); set('f-tax', c.taxId);
  set('f-inv', c.invoiceTitle); set('f-ph', c.phone); set('f-ad', c.address);
  if(c.shipContact||c.shipPhone||c.shipAddress){
    const same=document.getElementById('f-shipsame');
    if(same){ same.checked=false; if(typeof toggleShipSame==='function') toggleShipSame('f'); }
    set('f-shipcon', c.shipContact); set('f-shipph', c.shipPhone); set('f-shipad', c.shipAddress);
  }
  if(typeof FORM_DIRTY!=='undefined') FORM_DIRTY=true;
  toast('已帶入「'+c.name+'」的客戶資料','ok');
}

/* ============================================================
   客戶主檔的新增／修改／停用（後端 v40）
   ・儲存一律走 apiCall（寫入類），apiCall 會自動把讀取快取清光，
     所以存完只要 loadCustomers(true) 就會拿到最新資料。
   ・只送「表單上真的有的欄位」；空字串代表「清空這欄」，後端照實寫入。
   ============================================================ */
const CUS_FORM = { name:'cus-f-name', contact:'cus-f-contact', phone:'cus-f-phone', email:'cus-f-email',
  tax_id:'cus-f-tax', invoice_title:'cus-f-inv', address:'cus-f-addr', ship_contact:'cus-f-shipcon',
  ship_phone:'cus-f-shipph', ship_address:'cus-f-shipad', pay_habit:'cus-f-pay', tags:'cus-f-tags',
  note:'cus-f-note', active:'cus-f-active' };

function cusTagsHtml(c){
  return vmArr(c.tags).slice(0,4).map(t=>`<span class="cus-tag">${escHtml(t)}</span>`).join('');
}
function cusMasterById(id){ return CUS_MASTER.find(m=>String(m.customer_id)===String(id))||null; }

/* key 可以是客戶管理清單的 key（帶主檔或只有報價單資料），空字串＝開新客戶 */
function openCusEdit(key){
  const c=key?cusFind(key):null;
  const m=(c&&c.master)||null;
  const g=id=>document.getElementById(id);
  const set=(f,v)=>{ const e=g(CUS_FORM[f]); if(e) e.value=(v==null?'':v); };
  g('cus-edit-title').textContent = m ? '編輯客戶 — '+c.name : (c ? '建立客戶主檔 — '+c.name : '新增客戶');
  g('cus-f-id').value = m ? (m.customer_id||'') : '';
  /* 還沒建主檔的客戶：把報價單推算出來的資料當草稿帶進去，Molly 按儲存就等於建檔 */
  set('name',   c?c.name:'');
  set('contact',c?c.contact:'');       set('phone',       c?c.phone:'');
  set('email',  c?c.email:'');         set('tax_id',      c?c.taxId:'');
  set('invoice_title', c?c.invoiceTitle:''); set('address', c?c.address:'');
  set('ship_contact',  c?c.shipContact:'');  set('ship_phone', c?c.shipPhone:'');
  set('ship_address',  c?c.shipAddress:'');  set('pay_habit',  c?c.payHabit:'');
  set('tags',   c?c.tags:'');          set('note',        c?c.note:'');
  set('active', (m && String(m.active).toUpperCase()==='N') ? 'N' : 'Y');
  g('cus-f-del').style.display = m ? 'inline-block' : 'none';
  g('cus-edit-overlay').style.display='flex';
  setTimeout(()=>{ const e=g('cus-f-name'); if(e) e.focus(); }, 50);
}
function closeCusEdit(){ const e=document.getElementById('cus-edit-overlay'); if(e) e.style.display='none'; }

function cusCollectForm(){
  const out={};
  Object.keys(CUS_FORM).forEach(f=>{
    const e=document.getElementById(CUS_FORM[f]);
    if(e) out[f]=String(e.value==null?'':e.value).trim();
  });
  const id=document.getElementById('cus-f-id');
  if(id && id.value.trim()) out.customer_id=id.value.trim();
  return out;
}
async function saveCusEdit(){
  if(!AUTH_TOKEN){ showLogin(); return; }
  const c=cusCollectForm();
  if(!c.name){ toast('請填客戶名稱','err'); return; }
  const btn=document.getElementById('cus-f-save');
  if(btn){ btn.disabled=true; btn.innerHTML='<i class="ti ti-loader"></i>儲存中…'; }
  try{
    const d=await apiCall({ action:'saveCustomer', token:AUTH_TOKEN, customer:c });
    if(!d.ok) throw new Error(d.error||'儲存失敗');
    toast('已儲存客戶：'+c.name,'ok');
    closeCusEdit();
    await loadCustomers(true);
    CUS_SEL=cusKey(c.name); renderCustomers();
    cusFillPickSelect();
  }catch(e){ toast(e.message||'儲存失敗','err'); }
  finally{ if(btn){ btn.disabled=false; btn.innerHTML='<i class="ti ti-device-floppy"></i>儲存'; } }
}
async function deleteCusEdit(){
  const id=(document.getElementById('cus-f-id')||{}).value;
  const nm=(document.getElementById('cus-f-name')||{}).value;
  if(!id){ toast('這個客戶還沒建主檔，不用停用','err'); return; }
  if(!confirm('要把「'+nm+'」設為停用嗎？\n清單上會看不到，但資料與報價紀錄都留著，之後可以改回往來中。')) return;
  try{
    const d=await apiCall({ action:'deleteCustomer', token:AUTH_TOKEN, customer_id:id });
    if(!d.ok) throw new Error(d.error||'停用失敗');
    toast('已停用：'+nm,'ok');
    closeCusEdit();
    CUS_SEL=null;
    await loadCustomers(true);
    cusFillPickSelect();
  }catch(e){ toast(e.message||'停用失敗','err'); }
}
/* 一鍵把既有報價單的客戶匯進主檔（後端只補主檔還沒有的，不覆蓋） */
async function cusSeedFromQuotes(){
  if(!AUTH_TOKEN){ showLogin(); return; }
  const n=(CUS_DATA||[]).filter(c=>!c.master).length;
  if(!confirm('要把既有報價單裡的客戶匯進客戶主檔嗎？\n預計新增 '+n+' 位（已經在主檔裡的完全不動）。')) return;
  toast('正在匯入…','ok');
  try{
    const d=await apiCall({ action:'seedCustomersFromQuotes', token:AUTH_TOKEN });
    if(!d.ok) throw new Error(d.error||'匯入失敗');
    await loadCustomers(true);
    cusFillPickSelect();
    toast('匯入完成：新增 '+(d.added||0)+' 位，略過 '+(d.skipped||0)+' 位','ok');
  }catch(e){ toast(e.message||'匯入失敗','err'); }
}

/* ---- 報價單填寫頁的「選既有客戶自動帶入」下拉 ---- */
function cusFillPickSelect(){
  const sel=document.getElementById('f-cuspick'); if(!sel) return;
  const cur=sel.value;
  const list=CUS_MASTER.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),'zh-Hant'));
  sel.innerHTML='<option value="">— 不帶入，手動填 —</option>'+
    list.map(m=>`<option value="${escAttr(m.customer_id)}">${escHtml(m.name)}${m.contact?'（'+escHtml(m.contact)+'）':''}</option>`).join('')+
    (list.length?'':'<option value="" disabled>（客戶主檔還沒有資料，可到客戶管理按「從報價單匯入」）</option>');
  if(cur && list.some(m=>String(m.customer_id)===String(cur))) sel.value=cur;
}
/* 沒有主檔資料時先去要一份（正常情況登入後的預抓早就抓好了，等於 0 秒） */
async function cusEnsureMaster(){
  if(!AUTH_TOKEN) return;
  const P={action:'getCustomers', token:AUTH_TOKEN};
  const hit=rcPeek(P);
  if(hit && hit.data){ CUS_MASTER=(hit.data.customers||[]).slice(); cusFillPickSelect(); if(rcFresh(P)) return; }
  try{
    const d=await readCall(P);
    if(d && d.ok){ CUS_MASTER=(d.customers||[]).slice(); cusFillPickSelect(); }
  }catch(_){}
}
function pickQuoteCustomer(){
  const sel=document.getElementById('f-cuspick'); if(!sel) return;
  const m=cusMasterById(sel.value); if(!m) return;
  const set=(id,v)=>{ const e=document.getElementById(id); if(e) e.value=(v==null?'':String(v)); };
  set('f-cli', m.name); set('f-con', m.contact); set('f-tax', m.tax_id);
  set('f-inv', m.invoice_title); set('f-ph', m.phone); set('f-ad', m.address);
  if(m.ship_contact||m.ship_phone||m.ship_address){
    const same=document.getElementById('f-shipsame');
    if(same){ same.checked=false; if(typeof toggleShipSame==='function') toggleShipSame('f'); }
    set('f-shipcon', m.ship_contact); set('f-shipph', m.ship_phone); set('f-shipad', m.ship_address);
  }
  if(typeof upNo==='function') upNo();
  if(typeof FORM_DIRTY!=='undefined') FORM_DIRTY=true;
  let msg='已帶入「'+m.name+'」';
  if(String(m.pay_habit||'').trim()) msg+='　付款習慣：'+m.pay_habit;
  toast(msg,'ok');
  if(String(m.note||'').trim()) setTimeout(()=>toast('備註：'+m.note,'ok'), 400);
}
onHook('afterReset', function(){ const s=document.getElementById('f-cuspick'); if(s) s.value=''; cusEnsureMaster(); });
onHook('afterGotoPage', function(p){ if(p==='new') cusEnsureMaster(); });

/* ---- 存單後：這張單的客戶資料跟主檔不一樣就問一下（Molly 選「跳提醒讓我選」）---- */
let CUS_SYNC=null;      // {master, name, diffs:[{field,label,from,to}]}
function cusDiffAgainstMaster(quote){
  const nm=String((quote&&quote.clientName)||'').trim();
  if(!nm) return null;
  const key=cusKey(nm);
  const m=CUS_MASTER.find(x=>cusKey(x.name)===key)||null;
  const diffs=[];
  Object.keys(CUS_Q2M).forEach(qk=>{
    const mk=CUS_Q2M[qk];
    const to=String((quote&&quote[qk])==null?'':quote[qk]).trim();
    if(!to) return;                                   // 單上沒填就不動主檔
    const from=String((m&&m[mk])==null?'':m[mk]).trim();
    if(from!==to) diffs.push({ field:mk, label:CUS_FLABEL[mk]||mk, from:from, to:to });
  });
  if(!m && !diffs.length && !nm) return null;
  return { master:m, name:nm, diffs:diffs };
}
function cusSyncPrompt(quote){
  if(!AUTH_TOKEN) return;
  const r=cusDiffAgainstMaster(quote);
  if(!r) return;
  if(r.master && !r.diffs.length) return;             // 完全一樣就不要吵
  CUS_SYNC=r;
  const box=document.getElementById('cus-sync-overlay'); if(!box) return;
  document.getElementById('cus-sync-name').textContent='「'+r.name+'」';
  document.querySelector('#cus-sync-overlay .v2h span').textContent =
    r.master ? '這張單的客戶資料跟主檔不一樣' : '這是主檔還沒有的客戶';
  const rows=r.diffs.map((d,i)=>`<label class="cus-diff">
      <input type="checkbox" checked data-i="${i}">
      <span class="k">${escHtml(d.label)}</span>
      <span class="v">${d.from?`<s>${escHtml(d.from)}</s> → `:''}<b>${escHtml(d.to)}</b></span>
    </label>`).join('');
  document.getElementById('cus-sync-diff').innerHTML =
    (r.master ? '' : '<div class="ob info" style="display:inline-block;margin-bottom:8px">按「更新主檔」就會把這個客戶建進客戶主檔</div>') +
    (rows || '<div style="font-size:12.5px;color:#6B6B63">這張單只有客戶名稱，其他欄位空白。</div>');
  box.style.display='flex';
}
function closeCusSync(){ const e=document.getElementById('cus-sync-overlay'); if(e) e.style.display='none'; CUS_SYNC=null; }
async function applyCusSync(){
  if(!CUS_SYNC) { closeCusSync(); return; }
  const r=CUS_SYNC;
  const c={ name:r.name };
  if(r.master && r.master.customer_id) c.customer_id=r.master.customer_id;
  document.querySelectorAll('#cus-sync-diff input[type="checkbox"]').forEach(cb=>{
    if(!cb.checked) return;
    const d=r.diffs[parseInt(cb.getAttribute('data-i'),10)];
    if(d) c[d.field]=d.to;
  });
  closeCusSync();
  try{
    const d=await apiCall({ action:'saveCustomer', token:AUTH_TOKEN, customer:c });
    if(!d.ok) throw new Error(d.error||'更新失敗');
    toast('客戶主檔已更新：'+r.name,'ok');
    CUS_DATA=null;
    await cusEnsureMaster();
    if(currentPage==='customer') loadCustomers(true);
  }catch(e){ toast(e.message||'更新失敗','err'); }
}
onHook('afterSaveQuote', function(quote){ try{ cusSyncPrompt(quote); }catch(e){ console.error('[cus] sync 提示失敗', e); } });
