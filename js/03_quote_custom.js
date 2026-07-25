/* ============================================================
   自訂報價單模式（第三種模式，獨立運作，不進資料庫、不動 GAS）
   ============================================================ */
function syncCustomPills(){
  document.getElementById('c-pl-no').textContent = document.getElementById('c-no').value.trim() || '—';
  document.getElementById('c-pl-dt').textContent = document.getElementById('c-dt').value || '—';
  document.getElementById('c-pl-ex').textContent = document.getElementById('c-ex').value || '—';
}

function addCustomRow(prefill){
  prefill = prefill || {};
  rowId++;
  const id = rowId;
  const div = document.createElement('div');
  div.className = 'crow' + (prefill.free ? ' free' : '');
  div.id = `cr-${id}`;
  const manual = !!prefill.manual;
  div.innerHTML = `
    <div class="crow-top">
      <input placeholder="品名" data-f="name" value="${escHtml(prefill.name||'')}" oninput="calcCustom()">
      <input type="number" placeholder="—" data-f="qty" value="${prefill.qty!=null?prefill.qty:''}" oninput="calcCustom()">
      <input placeholder="—" data-f="unit" value="${escHtml(prefill.unit||'')}" oninput="calcCustom()">
      <input type="number" placeholder="—" data-f="price" value="${prefill.price!=null?prefill.price:''}" oninput="calcCustom()">
      <input type="number" placeholder="—" data-f="subval" value="${prefill.subval!=null?prefill.subval:''}" oninput="calcCustom()" ${manual?'':'readonly'}>
      <button class="del" onclick="delCustomRow(${id})">✕</button>
    </div>
    <div class="crow-bottom">
      <div class="crow-note"><input placeholder="備註說明（選填，顯示於品名下方小字）" data-f="note" value="${escHtml(prefill.note||'')}" oninput="calcCustom()"></div>
      <div class="crow-flags">
        <label><input type="checkbox" data-f="manual" ${manual?'checked':''} onchange="toggleCustomManual(${id})">手動小計</label>
        <label><input type="checkbox" data-f="free" ${prefill.free?'checked':''} onchange="calcCustom()">免費</label>
      </div>
    </div>`;
  document.getElementById('c-rows').appendChild(div);
  customItems.push(id);
  calcCustom();
}

function toggleCustomManual(id){
  const row = document.getElementById(`cr-${id}`);
  const manual = row.querySelector('[data-f="manual"]').checked;
  const subInput = row.querySelector('[data-f="subval"]');
  subInput.readOnly = !manual;
  calcCustom();
}

function delCustomRow(id){
  const el = document.getElementById(`cr-${id}`);
  if(el) el.remove();
  customItems = customItems.filter(i=>i!==id);
  calcCustom();
}

function resetCustom(skipConfirm){
  if(!skipConfirm && customItems.length){
    if(!confirm('確定要清除目前自訂報價單內容？')) return;
  }
  document.getElementById('c-rows').innerHTML = '';
  customItems = [];
  ['c-tag','c-cli','c-con','c-no','c-dt','c-ex','c-tax','c-inv','c-ph','c-ad','c-shipcon','c-shipph','c-shipad'].forEach(id=>{
    const el = document.getElementById(id); if(el) el.value = '';
  });
  // 清掉「已選公司」狀態與公司下拉，避免開新自訂單時殘留上一家公司（比照標準模式 resetAll）
  SELECTED_COMPANY_C=null;
  { const cs=document.getElementById('qfc-company'); if(cs) cs.value=''; }
  { const row=document.getElementById('qfc-row'); if(row) row.style.display='none'; }
  { const sc=document.getElementById('c-shipsame'); if(sc) sc.checked=true; toggleShipSame('c'); }
  document.getElementById('c-taxmode').value = 'inc';
  document.getElementById('c-taxrate').value = '5';
  const defaults = {'c-h-name':'項目','c-h-qty':'數量','c-h-unit':'單位','c-h-price':'單價','c-h-sub':'小計'};
  Object.keys(defaults).forEach(id=>{ document.getElementById(id).value = defaults[id]; });
  syncCustomPills();
  addCustomRow();
  calcCustom();
}

function calcCustom(){
  syncCustomPills();
  let itemsSum = 0;
  customItems.forEach(id=>{
    const row = document.getElementById(`cr-${id}`); if(!row) return;
    const manual = row.querySelector('[data-f="manual"]').checked;
    const free = row.querySelector('[data-f="free"]').checked;
    const qty = gv(row,'qty'), price = gv(row,'price');
    const subInput = row.querySelector('[data-f="subval"]');
    let sub;
    if(manual){
      subInput.readOnly = false;
      sub = subInput.value === '' ? 0 : (parseFloat(subInput.value)||0);
    } else {
      subInput.readOnly = true;
      const raw = (qty && price) ? qty*price : 0;
      subInput.value = raw ? raw : '';
      sub = raw;
    }
    row.classList.toggle('free', free);
    if(!free) itemsSum += sub;
  });
  const mode = document.getElementById('c-taxmode').value;
  const rate = (parseFloat(document.getElementById('c-taxrate').value)||0)/100;
  let tax = 0, total = 0, net = itemsSum;
  if(mode === 'inc'){
    total = itemsSum;
    net = rate>0 ? itemsSum/(1+rate) : itemsSum;
    tax = Math.round(total) - Math.round(net);
  } else {
    net = itemsSum;
    tax = Math.round(net*rate);
    total = net + tax;
  }
  document.getElementById('c-t-sub').textContent = '$'+Math.round(net).toLocaleString();
  document.getElementById('c-t-tax').textContent = '$'+tax.toLocaleString();
  document.getElementById('c-t-tot').textContent = '$'+Math.round(total).toLocaleString();
}

function parseMoney(s){ return parseFloat(String(s).replace(/[^0-9.\-]/g,''))||0; }

/* ================================================================
   自訂模式：KKBar 視覺樣式（多頁支援：每頁統一頁首＋頁尾頁碼）
   規則：頁首每頁相同；表格跨頁時表頭重複並標示「品項明細（承前頁）」；
        總計與三行條款只出現在最後一頁；頁尾每頁「第 X 頁，共 Y 頁」。
   尺寸：A4 210×297mm、列印邊界 10mm → 內容 190×277mm ≈ 718×1047px @96dpi
   ================================================================ */
const CPAGE_W = 718, CPAGE_H = 1047, CPAD_T = 40, CPAD_X = 48;

/* ---- 組出報價單各區塊（頁首/客戶/表頭/列/總計/條款/頁尾），預覽・列印・Word 共用 ---- */
function buildCustomDocParts(){
  const GOLD='#A6824A', HEADGREY='#8A8880', LINE='#E8E5DD', BORDER='#E5E2D8', GREY='#6B6B63', GREY2='#A8A69C', INK='#22241F';

  const tag = document.getElementById('c-tag').value.trim();
  const cli = document.getElementById('c-cli').value.trim();
  const con = document.getElementById('c-con').value.trim();
  const tax = document.getElementById('c-tax')?document.getElementById('c-tax').value.trim():'';
  const inv = document.getElementById('c-inv')?document.getElementById('c-inv').value.trim():'';
  const ph = document.getElementById('c-ph')?document.getElementById('c-ph').value.trim():'';
  const ad = document.getElementById('c-ad')?document.getElementById('c-ad').value.trim():'';
  const no = escHtml(document.getElementById('c-no').value.trim() || '—');
  const dt = escHtml(document.getElementById('c-dt').value || '—');
  const ex = escHtml(document.getElementById('c-ex').value || '—');
  const mode = document.getElementById('c-taxmode').value;
  const hName = document.getElementById('c-h-name').value.trim() || '項目';
  const hQty = document.getElementById('c-h-qty').value.trim() || '數量';
  const hUnit = document.getElementById('c-h-unit').value.trim() || '單位';
  let hPrice = document.getElementById('c-h-price').value.trim() || '單價';
  if(hPrice === '單價') hPrice += (document.getElementById('c-taxmode').value==='inc' ? '（含稅）' : '（未稅）');
  const hSub = document.getElementById('c-h-sub').value.trim() || '小計';

  const rows = [];
  customItems.forEach(id=>{
    const row = document.getElementById(`cr-${id}`); if(!row) return;
    const name = gs(row,'name'); if(!name) return;
    const note = gs(row,'note');
    const qty = gs(row,'qty'), unit = gs(row,'unit'), price = gs(row,'price');
    const free = row.querySelector('[data-f="free"]').checked;
    const subRaw = row.querySelector('[data-f="subval"]').value;
    const qtyD = qty ? qty : '—', unitD = unit ? unit : '—';
    const priceD = price ? ('$'+Math.round(parseFloat(price)).toLocaleString()) : '—';
    let subD;
    if(free){
      const orig = subRaw ? ('$'+Math.round(parseFloat(subRaw)).toLocaleString()) : '—';
      subD = `<span style="text-decoration:line-through;color:${GREY2}">${orig}</span> <span style="color:${GOLD};font-weight:700">免費</span>`;
    } else {
      subD = subRaw !== '' ? ('$'+Math.round(parseFloat(subRaw)).toLocaleString()) : '—';
    }
    rows.push(`<tr style="border-bottom:1px solid ${LINE}">
      <td style="padding:11px 12px;color:${INK}">
        <div style="font-weight:600">${escHtml(name)}</div>
        ${note?`<div style="font-size:10.5px;color:${GREY2};margin-top:2px">${escHtml(note)}</div>`:''}
      </td>
      <td style="padding:11px 8px;text-align:center;color:${GREY}">${qtyD}</td>
      <td style="padding:11px 8px;text-align:center;color:${GREY}">${unitD}</td>
      <td style="padding:11px 8px;text-align:right;color:${GREY}">${priceD}</td>
      <td style="padding:11px 8px;text-align:right;font-weight:700;color:${INK}">${subD}</td>
    </tr>`);
  });

  const itemsSum = parseMoney(document.getElementById('c-t-sub').textContent);
  const taxAmt = parseMoney(document.getElementById('c-t-tax').textContent);
  const grand = parseMoney(document.getElementById('c-t-tot').textContent);
  const lbSub = '合計（未稅）', lbTax = '營業稅';   // 發票格式，含稅／未稅模式顯示一致

  let cliRows = '';
  const cliFields=[[cli,'客戶名稱'],[con,'聯絡人'],[ph,'聯絡電話'],[ad,'地址'],[inv,'發票抬頭'],[tax,'統一編號']];
  cliFields.forEach(([v,l])=>{
    if(v) cliRows += `<div style="display:flex;gap:8px;font-size:12.5px;margin-bottom:7px;line-height:1.6"><span style="color:${GREY2};min-width:62px">${l}</span><span style="color:${INK}">${escHtml(v)}</span></div>`;
  });
  /* 出貨資訊：只在「與聯絡地址不同」且有填任一欄時才另外印出 */
  const shipSame = document.getElementById('c-shipsame')?document.getElementById('c-shipsame').checked:true;
  const shipCon = document.getElementById('c-shipcon')?document.getElementById('c-shipcon').value.trim():'';
  const shipPh = document.getElementById('c-shipph')?document.getElementById('c-shipph').value.trim():'';
  const shipAd = document.getElementById('c-shipad')?document.getElementById('c-shipad').value.trim():'';
  let shipRows = '';
  if(!shipSame && (shipCon||shipPh||shipAd)){
    const shipFields=[[shipCon,'出貨收件人'],[shipPh,'收件人電話'],[shipAd,'出貨地址']];
    shipFields.forEach(([v,l])=>{
      if(v) shipRows += `<div style="display:flex;gap:8px;font-size:12.5px;margin-bottom:7px;line-height:1.6"><span style="color:${GREY2};min-width:62px">${l}</span><span style="color:${INK}">${escHtml(v)}</span></div>`;
    });
  }
  const shipBlock = shipRows ? `<div style="margin-top:6px;padding-top:10px;border-top:1px dashed ${BORDER}">
    <div style="font-size:10px;color:${GOLD};font-weight:600;letter-spacing:1px;margin-bottom:6px">出貨資訊（與發票／聯絡地址不同）</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px">${shipRows}</div>
  </div>` : '';

  /* 統一頁首（每頁相同） */
  const header = `
  <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;border-bottom:1.5px solid ${INK};margin-bottom:18px">
    <div>
      <img src="https://raw.githubusercontent.com/MollyLin-coding/quote-system/main/assets/logo.png" style="height:32px;width:auto;display:block">
      <div style="font-size:9px;letter-spacing:1.8px;color:${GOLD};margin-top:7px;text-transform:uppercase;line-height:1.7;font-weight:600">KEVIN NUMBER 1 TAILORED.COCKTAIL<br>EST. 2023. TAIWAN</div>
      <div style="font-size:11px;color:${GREY2};margin-top:6px">新北市新莊區化成路554巷37號　(02)8991-0068　統編 92719710</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:22px;font-weight:700;color:${INK};letter-spacing:6px;margin-bottom:10px">報　價　單</div>
      ${tag?`<div style="display:inline-block;font-size:11px;color:${GOLD};font-weight:700;letter-spacing:.5px;margin-bottom:8px;border:1px solid ${GOLD};border-radius:20px;padding:3px 12px">${escHtml(tag)}</div><br>`:''}
      <div style="font-size:11.5px;color:${GREY2};line-height:1.9">單號：<span style="color:${INK};font-weight:600">${no}</span></div>
      <div style="font-size:11.5px;color:${GREY2};line-height:1.9">報價日：<span style="color:${INK}">${dt}</span></div>
      <div style="font-size:11.5px;color:${GOLD};font-weight:700">有效至：${ex}</div>
    </div>
  </div>`;

  const client = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px;margin-bottom:4px">${cliRows}</div>${shipBlock}`;
  const contNote = `<div style="font-size:10.5px;color:${GREY2};letter-spacing:.5px;margin:0 0 4px">品項明細（承前頁）</div>`;

  const colgroup = `<colgroup><col><col style="width:64px"><col style="width:64px"><col style="width:92px"><col style="width:118px"></colgroup>`;
  const thead = `<thead><tr>
      <th style="padding:10px 12px;text-align:left;color:${HEADGREY};font-weight:600;font-size:10.5px;letter-spacing:.3px;border-bottom:1.5px solid ${INK}">${escHtml(hName)}</th>
      <th style="padding:10px 8px;text-align:center;color:${HEADGREY};font-weight:600;font-size:10.5px;border-bottom:1.5px solid ${INK}">${escHtml(hQty)}</th>
      <th style="padding:10px 8px;text-align:center;color:${HEADGREY};font-weight:600;font-size:10.5px;border-bottom:1.5px solid ${INK}">${escHtml(hUnit)}</th>
      <th style="padding:10px 8px;text-align:right;color:${HEADGREY};font-weight:600;font-size:10.5px;border-bottom:1.5px solid ${INK}">${escHtml(hPrice)}</th>
      <th style="padding:10px 8px;text-align:right;color:${HEADGREY};font-weight:600;font-size:10.5px;border-bottom:1.5px solid ${INK}">${escHtml(hSub)}</th>
    </tr></thead>`;
  const mkTable = inner => `<table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:12.5px">${colgroup}${inner}</table>`;

  /* 總計（僅最後一頁） */
  const totals = `
  <div style="display:flex;justify-content:flex-end;margin-top:18px">
    <div style="min-width:250px">
      <div style="display:flex;justify-content:space-between;font-size:12px;color:${GREY};padding:5px 2px"><span>${lbSub}</span><span>$${Math.round(itemsSum).toLocaleString()}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:${GREY};padding:5px 2px"><span>${lbTax}</span><span>$${Math.round(taxAmt).toLocaleString()}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:18px;color:${INK};font-weight:700;border-top:1.5px solid ${INK};padding-top:10px;margin-top:4px;letter-spacing:.3px"><span>總計</span><span style="color:${GOLD}">$${Math.round(grand).toLocaleString()}</span></div>
    </div>
  </div>`;

  /* 固定三行條款（僅最後一頁） */
  const terms = `
  <div style="margin-top:20px;padding-top:14px;border-top:1px solid ${BORDER};font-size:11.5px;color:${GREY};line-height:1.7">
    <p style="margin:0">以下客戶簡稱甲方，凱文南坡萬實業社簡稱乙方。雙方確認此報價單內容無誤並於雙方各執一份，以維雙方權利。</p>
    <p style="margin:6px 0 0">匯款資訊：陽信銀行中興分行 (108)　02142-00230-91　凱文南坡萬實業社黃彥愷</p>
    <p style="margin:4px 0 0">匯款完成後，敬請提供轉帳截圖或帳號後五碼，以便核對入帳，謝謝。</p>
  </div>`;

  /* 統一頁尾：每頁標示頁數 */
  const footer = (p,t) => `
  <div style="margin-top:auto;border-top:1px solid ${BORDER};padding:12px 0 14px;display:flex;justify-content:space-between;align-items:center;font-size:10.5px;color:${GREY2};letter-spacing:.4px">
    <span>凱文南坡萬實業社　·　報價單 ${no}</span>
    <span style="color:${GREY};font-weight:600">第 <span style="color:${GOLD}">${p}</span> 頁，共 <span style="color:${GOLD}">${t}</span> 頁</span>
  </div>`;

  return {header, client, contNote, thead, rows, totals, terms, footer, mkTable};
}

/* ---- 共用分頁引擎：量測各區塊高度後分成一頁頁 A4（自訂／瓶裝／宴會三種模式共用）----
   P = {header, topFirst, contNote, thead, rows[], tailBlocks[], footer(p,t), mkTable, font} */
function buildQuotePagesHtml(P, extraPageStyle){
  const font = P.font || "'Noto Sans TC','Microsoft JhengHei',sans-serif";
  /* 量測沙盒（寬度＝頁面內容寬，overflow:hidden 讓 margin 一併計入） */
  const sb = document.createElement('div');
  sb.style.cssText = `position:absolute;visibility:hidden;left:-9999px;top:0;width:${CPAGE_W-CPAD_X*2}px;overflow:hidden;font-family:${font}`;
  document.body.appendChild(sb);
  const mh = h => { sb.innerHTML = h; return sb.getBoundingClientRect().height; };
  /* 量測單列時把量測用表格的外距歸零（表格外距已計入每頁上段高度，不能重複算進每一列） */
  const mhRow = h => { sb.innerHTML = h; if(sb.firstElementChild) sb.firstElementChild.style.margin = '0'; return sb.getBoundingClientRect().height; };

  const hasRows = P.rows.length > 0;
  const topFirstH = mh(P.header + P.topFirst + (hasRows ? P.mkTable(P.thead) : ''));
  const topContH  = mh(P.header + P.contNote + (hasRows ? P.mkTable(P.thead) : ''));
  const headOnlyH = mh(P.header);
  const rowHs = P.rows.map(r => mhRow(P.mkTable('<tbody>'+r+'</tbody>')));
  const tails = P.tailBlocks.filter(Boolean);
  const tailHs = tails.map(b => mh(b));
  const footH = mh(P.footer(1,1));
  document.body.removeChild(sb);

  const avail = CPAGE_H - CPAD_T - footH - 10;  // 每頁可用內容高度（留 10px 安全餘裕）

  /* 品項列：貪婪分頁 */
  const pages = []; let i = 0;
  do{
    const first = pages.length === 0;
    let used = first ? topFirstH : topContH;
    const chunks = [P.header, first ? P.topFirst : P.contNote];
    const pageRows = [];
    while(i < P.rows.length && used + rowHs[i] <= avail){ used += rowHs[i]; pageRows.push(P.rows[i]); i++; }
    if(!pageRows.length && i < P.rows.length){ used += rowHs[i]; pageRows.push(P.rows[i]); i++; } // 單列超高的保險
    if(hasRows) chunks.push(P.mkTable(P.thead + '<tbody>' + pageRows.join('') + '</tbody>'));
    pages.push({chunks, used});
  }while(i < P.rows.length);

  /* 尾段區塊（總計/圖片/付款條件/條款）逐塊塞入，放不下就另起新頁（只帶頁首） */
  tails.forEach((b, k)=>{
    let pg = pages[pages.length-1];
    if(pg.used + tailHs[k] > avail){
      pg = {chunks:[P.header], used: headOnlyH};
      pages.push(pg);
    }
    pg.chunks.push(b); pg.used += tailHs[k];
  });

  /* 組頁面 */
  const total = pages.length;
  return pages.map((pg, idx)=>
    `<div class="cpage" style="${extraPageStyle||''}width:${CPAGE_W}px;height:${CPAGE_H}px;box-sizing:border-box;padding:${CPAD_T}px ${CPAD_X}px 0;display:flex;flex-direction:column;overflow:hidden;background:#fff;color:#22241F;font-family:${font}">${pg.chunks.join('')}${P.footer(idx+1, total)}</div>`
  ).join('');
}

/* ---- 自訂模式：分頁（委派給共用引擎） ---- */
function buildCustomPagesHtml(extraPageStyle){
  calcCustom();
  const P = buildCustomDocParts();
  return buildQuotePagesHtml({
    header: P.header, topFirst: P.client, contNote: P.contNote, thead: P.thead,
    rows: P.rows, tailBlocks: [P.totals + P.terms], footer: P.footer, mkTable: P.mkTable
  }, extraPageStyle);
}

/* ---- 自訂模式：預覽（多頁時逐頁顯示，每頁統一頁首＋頁尾頁碼）---- */
function openCustomPreview(){
  const pages = buildCustomPagesHtml('margin:0 auto 18px;box-shadow:0 4px 18px rgba(40,38,30,.22);');
  document.getElementById('pcon').innerHTML = `<div style="background:#D6D4CC;padding:18px 0 1px">${pages}</div>`;
  previewKind = 'custom';
  const btn2 = document.getElementById('pv-btn-secondary');
  btn2.innerHTML = '<i class="ti ti-file-text"></i>匯出 Word';
  document.getElementById('pov').style.display = 'block';
}

/* ---- 預覽視窗內按鈕：依模式分派 ---- */
function previewExportPDF(){
  if(previewKind === 'custom') exportCustomPDF(); else exportPDF();
}
function previewSecondaryAction(){
  if(previewKind === 'custom') exportCustomWord(); else generateOfficialDocument();
}

/* ---- 自訂模式：檔名 ---- */
function buildCustomExportFilename(){
  const cli = document.getElementById('c-cli').value.trim() || '客戶';
  const no = document.getElementById('c-no').value.trim() || '單號';
  return sanitizeFilename(`${cli}_${no}_報價單_凱文南坡萬實業社`);
}

/* ---- 自訂模式：PDF 匯出（瀏覽器列印；每頁固定 A4，與預覽分頁完全一致）---- */
function exportCustomPDF(){
  const pages = buildCustomPagesHtml();
  const fname = buildCustomExportFilename();
  const w = window.open('', '_blank');
  if(!w){ toast('瀏覽器擋住了新視窗，請允許本站彈出視窗後再匯出','err'); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${fname}</title>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
      @page{size:A4;margin:10mm}
      html,body{margin:0;padding:0}
      .cpage{page-break-after:always}
      .cpage:last-child{page-break-after:auto}
      img{page-break-inside:avoid}
    </style>
    </head><body>${pages}</body></html>`);
  w.document.close();
  setTimeout(()=>{ w.print(); }, 700);
}

/* ---- 自訂模式：Word 匯出（純前端，MS Office HTML 格式，不動 GAS）---- */
function exportCustomWord(){
  calcCustom();
  setTimeout(()=>{
    /* Word 用連續排版（Word 會自行分頁），不用固定高度的頁面切割 */
    const P = buildCustomDocParts();
    const pcon = `<div style="font-family:'Noto Sans TC','Microsoft JhengHei',sans-serif;color:#22241F">${P.header}${P.client}${P.mkTable(P.thead+'<tbody>'+P.rows.join('')+'</tbody>')}${P.totals}${P.terms}</div>`;
    const fname = buildCustomExportFilename();
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="UTF-8"><title>${fname}</title>
    <!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->
    <style>body{font-family:'Noto Sans TC','Microsoft JhengHei',sans-serif}</style>
    </head><body>${pcon}</body></html>`;
    const blob = new Blob(['﻿', html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fname + '.doc';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url), 3000);
  }, 200);
}

/* ---- 自訂模式：載入 KKBar 範例資料（測試 / 預設值用）---- */
function loadKKBarSample(){
  resetCustom(true);
  document.getElementById('c-tag').value = '活動酒水 · KKBar';
  document.getElementById('c-cli').value = 'KKBar';
  document.getElementById('c-con').value = '小六';
  document.getElementById('c-no').value = '20260708-01';
  document.getElementById('c-dt').value = '2026-07-08';
  document.getElementById('c-ex').value = '2026-08-08';
  document.getElementById('c-taxmode').value = 'inc';
  document.getElementById('c-taxrate').value = '5';
  document.getElementById('c-rows').innerHTML = '';
  customItems = [];
  addCustomRow({name:'Flutterfly（40,000ml）', note:'兩款合計 / 含加急客製打版工本費', manual:true, subval:39000});
  addCustomRow({name:'Taiwan Vibes 2.0（40,000ml）', manual:true, subval:''});
  addCustomRow({name:'酒吧車租借', qty:5, unit:'日', price:2500, free:true, note:'商會友情支援'});
  addCustomRow({name:'氣瓶', qty:1, unit:'瓶', price:1000});
  addCustomRow({name:'運費', qty:1, unit:'式', price:1500});
  syncCustomPills();
  calcCustom();
  toast('已載入 KKBar 範例資料','ok');
}

