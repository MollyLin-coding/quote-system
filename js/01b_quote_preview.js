// ── PREVIEW ──
/* ---- 標準模式（瓶裝／宴會）：組出報價單各區塊，預覽・PDF 共用 ---- */
function buildStdDocParts(){
  const no=document.getElementById('f-no').value||'—';
  const dt=document.getElementById('f-dt').value||'—';
  const ex=document.getElementById('f-ex').value||'—';
  const shipDate=document.getElementById('f-shipdate')?document.getElementById('f-shipdate').value:'';
  const showShip=document.getElementById('f-shipdate-show')?document.getElementById('f-shipdate-show').checked:true;
  const fmtYmd=s=>{const m=String(s||'').match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);return m?`${m[1]}/${String(m[2]).padStart(2,'0')}/${String(m[3]).padStart(2,'0')}`:(s||'—');};
  const dtF=fmtYmd(dt), exF=fmtYmd(ex), shipF=fmtYmd(shipDate);
  const cli=escHtml(document.getElementById('f-cli').value||'');
  const tagLot=escHtml(document.getElementById('f-tag-lot')?.value||'');
  const tagCli=escHtml(document.getElementById('f-tag-cli')?.value||'');
  const con=escHtml(document.getElementById('f-con').value||'');
  const tax=escHtml(document.getElementById('f-tax').value||'');
  const ph=escHtml(document.getElementById('f-ph').value||'');
  const ad=escHtml(document.getElementById('f-ad').value||'');
  const hdl=escHtml(document.getElementById('f-hdl').value||'');
  const note=escHtml(document.getElementById('f-note').value||'');
  const tot=document.getElementById('t-tot').textContent;
  const tsub=document.getElementById('t-sub').textContent;
  const ttax=document.getElementById('t-tax').textContent;
  const taxVisible=document.getElementById('tr-tax').style.display!=='none';
  const lbsub=document.getElementById('lb-sub').textContent;
  const lbtax=document.getElementById('lb-tax').textContent;
  const extVisible=document.getElementById('tr-ext').style.display!=='none';
  const text=document.getElementById('t-ext').textContent;
  const freeShip=parseFloat(document.getElementById('f-freeship')?.value)||0; // 免運優惠：顯示用、不計入總計

  /* 2026-08-28：報價單稅金顯示——'excl'＝印未稅價、總計區只印合計（未稅）＋「稅額另計」註記；
     ''＝照現行（發票格式：合計／營業稅／總計）。含稅輸入＋未稅顯示時，單價／小計自動除以(1+稅率)換算，
     可能與畫面合計有 1-2 元進位差；輸入未稅價則完全一致。只影響印出來的文件，畫面總計與存檔資料照舊。 */
  const taxDisp=(document.getElementById('f-taxdisplay')?.value)||'';
  const _rate=(parseFloat(document.getElementById('taxrate').value)||0)/100;
  const exFac=(taxDisp==='excl'&&taxMode==='inc'&&_rate>0)?(1/(1+_rate)):1;
  const cvA=x=>x*exFac;                                    // 金額換算（未稅顯示＋含稅輸入才 ≠1）
  const cvP=x=>Math.round(cvA(x)*100)/100;                 // 單價：留到小數兩位
  const taxTag = taxDisp==='excl' ? '（未稅）' : (taxMode==='inc' ? '（含稅）' : '（未稅）');

  let colgroup='', theadStr='';
  const rows=[];
  if(qType==='bottle'||qType==='ownbrand'||qType==='ownlabel'||qType==='consign'){
    let headCols = `<th style="padding:10px 12px;text-align:left;color:#6B6B63;font-weight:600;font-size:10.5px;letter-spacing:.3px;border-bottom:1.5px solid #22241F">品名</th>`;
    const showLotDoc = colLot && !colOwn;   // 自有品牌批號為內部記錄用，不顯示給客戶
    if(showLotDoc) headCols += `<th style="padding:10px 8px;text-align:center;color:#6B6B63;font-weight:600;font-size:10.5px;border-bottom:1.5px solid #22241F">批次</th>`;
    headCols += `<th style="padding:10px 8px;text-align:center;color:#6B6B63;font-weight:600;font-size:10.5px;border-bottom:1.5px solid #22241F">容量</th>
      <th style="padding:10px 8px;text-align:right;color:#6B6B63;font-weight:600;font-size:10.5px;border-bottom:1.5px solid #22241F">單價${taxTag}</th>`;
    if(colDed) headCols += `<th style="padding:10px 8px;text-align:right;color:#6B6B63;font-weight:600;font-size:10.5px;border-bottom:1.5px solid #22241F">前標費</th>`;
    if(colLogo) headCols += `<th style="padding:10px 8px;text-align:right;color:#6B6B63;font-weight:600;font-size:10.5px;border-bottom:1.5px solid #22241F">LOGO</th>`;
    headCols += `<th style="padding:10px 8px;text-align:right;color:#6B6B63;font-weight:600;font-size:10.5px;border-bottom:1.5px solid #22241F">瓶數</th>
      <th style="padding:10px 8px;text-align:right;color:#6B6B63;font-weight:600;font-size:10.5px;border-bottom:1.5px solid #22241F">小計</th>`;
    theadStr = `<thead><tr>${headCols}</tr></thead>`;
    let cols = '<col>';
    if(showLotDoc) cols += '<col style="width:64px">';
    cols += '<col style="width:70px"><col style="width:84px">';
    if(colDed) cols += '<col style="width:70px">';
    if(colLogo) cols += '<col style="width:72px">';
    cols += '<col style="width:58px"><col style="width:104px">';
    colgroup = `<colgroup>${cols}</colgroup>`;
    botItems.forEach(id=>{
      const row=document.getElementById(`r-${id}`); if(!row) return;
      const n=escHtml(gs(row,'name')),lot=escHtml(gs(row,'lot')),vol=gv(row,'vol'),p=gv(row,'price'),d=colDed?gv(row,'ded'):0,l=colLogo?gv(row,'logo'):0,q=gv(row,'qty');
      const sub=(p+d+l)*q;
      if(!n&&!sub) return;
      const _gift = row.querySelector('[data-f="gift"]') && row.querySelector('[data-f="gift"]').checked;
      const _mk = colMark && row.querySelector('[data-f="mark"]') && row.querySelector('[data-f="mark"]').checked;
      const _mkLabel = (qType==='ownlabel') ? '客製標' : (_mk ? 'OEM' : '');
      const _mkTag = _mkLabel ? ` <span style="display:inline-block;font-size:10px;font-weight:700;color:#7A5A1E;background:#F3ECDD;border-radius:4px;padding:1px 6px;margin-left:4px;vertical-align:1px">${_mkLabel}</span>` : '';
      let cells = `<td style="padding:11px 12px;font-weight:600;color:#22241F">${n||'—'}${_mkTag}</td>`;
      if(showLotDoc) cells += `<td style="padding:11px 8px;text-align:center;color:#6B6B63">${lot}</td>`;
      cells += `<td style="padding:11px 8px;text-align:center;color:#6B6B63">${vol?vol+'ml':'—'}</td>
        <td style="padding:11px 8px;text-align:right;color:#6B6B63">${p?'$'+cvP(p).toLocaleString():'—'}</td>`;
      if(colDed) cells += `<td style="padding:11px 8px;text-align:right;color:#6B6B63">${d?d:''}</td>`;
      if(colLogo) cells += `<td style="padding:11px 8px;text-align:right;color:#6B6B63">${l?'$'+l:'—'}</td>`;
      const subCell = _gift
        ? `<span style="text-decoration:line-through;color:#9a968c">$${Math.round(cvA(sub)).toLocaleString()}</span> <span style="color:#A6824A;font-weight:700">贈</span>`
        : `$${Math.round(cvA(sub)).toLocaleString()}`;
      cells += `<td style="padding:11px 8px;text-align:right;color:#6B6B63">${q}</td>
        <td style="padding:11px 8px;text-align:right;font-weight:700;color:#22241F">${subCell}</td>`;
      rows.push(`<tr style="border-bottom:1px solid #EEEDE6">${cells}</tr>`);
    });
    if(extras.length){
      const colspan = 4 + (showLotDoc?1:0) + (colDed?1:0) + (colLogo?1:0);
      extras.forEach(e=>{
        rows.push(`<tr style="border-bottom:1px solid #EEEDE6">
          <td colspan="${colspan}" style="padding:9px 12px;color:#A6824A;font-style:italic;font-size:12px">${escHtml(e.n)}</td>
          <td style="padding:9px 8px;text-align:right;color:#6B6B63">${e.a?fmtMoney(cvA(e.a)):''}</td>
        </tr>`);
      });
    }
  } else {
    theadStr = `<thead><tr>
      <th style="padding:10px 12px;text-align:left;color:#6B6B63;font-weight:600;font-size:10.5px;border-bottom:1.5px solid #22241F">項目</th>
      <th style="padding:10px 8px;text-align:center;color:#6B6B63;font-weight:600;font-size:10.5px;border-bottom:1.5px solid #22241F">數量</th>
      <th style="padding:10px 8px;text-align:center;color:#6B6B63;font-weight:600;font-size:10.5px;border-bottom:1.5px solid #22241F">單位</th>
      <th style="padding:10px 8px;text-align:right;color:#6B6B63;font-weight:600;font-size:10.5px;border-bottom:1.5px solid #22241F">單價${taxTag}</th>
      <th style="padding:10px 8px;text-align:right;color:#6B6B63;font-weight:600;font-size:10.5px;border-bottom:1.5px solid #22241F">小計</th>
    </tr></thead>`;
    colgroup = `<colgroup><col><col style="width:64px"><col style="width:64px"><col style="width:92px"><col style="width:118px"></colgroup>`;

    // 兩組客製化調酒：2026-08-31 起每一款各自一列（各自數量／單價／手動小計），不再整組共用一個價
    const banGroupRow=(g)=>{
      const unit=(banUnitOf(g)==='ml')?'ml':'杯';
      banGroupItems(g).forEach(id=>{
        const row=document.getElementById(`bg-${g}-${id}`); if(!row) return;
        const n=escHtml(gs(row,'name')),p=gv(row,'price'),q=gv(row,'qty');
        const info=banGroupRowInfo(row);
        if(!n&&!info.sub) return;
        rows.push(`<tr style="border-bottom:1px solid #EEEDE6">
        <td style="padding:11px 12px;font-weight:600;color:#22241F">${n||'—'}</td>
        <td style="padding:11px 8px;text-align:center;color:#6B6B63">${q?q.toLocaleString():'—'}</td>
        <td style="padding:11px 8px;text-align:center;color:#6B6B63">${unit}</td>
        <td style="padding:11px 8px;text-align:right;color:#6B6B63">${p?'$'+cvP(p).toLocaleString():'—'}</td>
        <td style="padding:11px 8px;text-align:right;font-weight:700;color:#22241F">$${Math.round(cvA(info.sub)).toLocaleString()}</td>
      </tr>`);
      });
    };
    banGroupRow('g1');
    banGroupRow('g2');
    banFreeItems.forEach(id=>{
      const row=document.getElementById(`bf-${id}`); if(!row) return;
      const n=escHtml(gs(row,'name')),u=escHtml(gs(row,'unit')),p=gv(row,'price'),q=gv(row,'qty');
      const note=escHtml(gs(row,'note'));
      const info=banFreeRowInfo(row);
      if(!n&&!info.sub) return;
      const subCell=info.free
        ? `<span style="text-decoration:line-through;color:#9a968c">$${Math.round(cvA(info.sub)).toLocaleString()}</span> <span style="color:#A6824A;font-weight:700">免費</span>`
        : `$${Math.round(cvA(info.sub)).toLocaleString()}`;
      rows.push(`<tr style="border-bottom:1px solid #EEEDE6">
        <td style="padding:11px 12px;font-weight:600;color:#22241F">${n}${note?`<div style="font-size:10.5px;color:#A8A69C;font-weight:400;margin-top:2px">${note}</div>`:''}</td>
        <td style="padding:11px 8px;text-align:center;color:#6B6B63">${q?q.toLocaleString():'—'}</td>
        <td style="padding:11px 8px;text-align:center;color:#6B6B63">${u||'—'}</td>
        <td style="padding:11px 8px;text-align:right;color:#6B6B63">${p?'$'+cvP(p).toLocaleString():'—'}</td>
        <td style="padding:11px 8px;text-align:right;font-weight:700;color:#22241F">${subCell}</td>
      </tr>`);
    });
    // service fee
    const mode=document.getElementById('svc-mode').value;
    if(mode){
      const labelMap={basic:'調酒師服務費及運費（基礎運費）',equip:'調酒師費（含設備）',travel:'調酒師費＋車馬費及酒水運費',travelonly:'車馬費'};
      const a1=parseFloat(document.getElementById('svc-amt1').value)||0;
      const a2=parseFloat(document.getElementById('svc-amt2').value)||0;
      const q=parseFloat(document.getElementById('svc-qty').value)||1;
      const sub=(a1+(mode==='travel'?a2:0))*q;
      rows.push(`<tr style="border-bottom:1px solid #EEEDE6">
        <td style="padding:11px 12px;font-weight:600;color:#22241F">${labelMap[mode]}</td>
        <td style="padding:11px 8px;text-align:center;color:#6B6B63">${q}</td>
        <td style="padding:11px 8px;text-align:center;color:#6B6B63">位</td>
        <td style="padding:11px 8px;text-align:right;color:#6B6B63">$${cvP(a1+(mode==='travel'?a2:0)).toLocaleString()}</td>
        <td style="padding:11px 8px;text-align:right;font-weight:700;color:#22241F">$${Math.round(cvA(sub)).toLocaleString()}</td>
      </tr>`);
    }
    // addons
    banAddonItems.forEach(id=>{
      const row=document.getElementById(`ba-${id}`); if(!row) return;
      const n=escHtml(gs(row,'name')),u=escHtml(gs(row,'unit')),p=gv(row,'price'),q=gv(row,'qty');
      const sub=p*q;
      if(!n&&!sub) return;
      rows.push(`<tr style="border-bottom:1px solid #EEEDE6">
        <td style="padding:11px 12px;font-weight:600;color:#22241F">${n}</td>
        <td style="padding:11px 8px;text-align:center;color:#6B6B63">${q}</td>
        <td style="padding:11px 8px;text-align:center;color:#6B6B63">${u}</td>
        <td style="padding:11px 8px;text-align:right;color:#6B6B63">${p?'$'+cvP(p).toLocaleString():'—'}</td>
        <td style="padding:11px 8px;text-align:right;font-weight:700;color:#22241F">$${Math.round(cvA(sub)).toLocaleString()}</td>
      </tr>`);
    });
  }
  const mkTable = inner => `<table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:12.5px;margin-top:14px">${colgroup}${inner}</table>`;

  const venH=qType==='banquet'&&document.getElementById('f-ven').value?`
    <div style="display:flex;gap:28px;font-size:12px;color:#6B6B63;margin-bottom:18px">
      <span>佈置地點：<strong style="color:#22241F">${escHtml(document.getElementById('f-ven').value)}</strong></span>
      ${document.getElementById('f-svc').value?`<span>供酒時間：${escHtml(document.getElementById('f-svc').value)}</span>`:''}
    </div>`:'';

  /* 附加圖片（2026-08-27）：依大小排成一排排（小＝三張／中＝兩張／大＝一張，可混用），
     每一排是獨立的尾段區塊，分頁時可以一排一排塞，不會整組圖片一起被擠到下一頁。
     圖框有明確寬高（知道圖片比例就照比例縮進格子、不裁圖也不留白邊；量不到比例才用固定框＋contain），
     量測高度才不會受圖片載入時機影響。 */
  const IMG_BOX={s:{w:198,h:150,f:3}, m:{w:304,h:230,f:2}, l:{w:622,h:400,f:1}};
  const imgRows=[]; { let cur=[], fill=0;
    imgs.forEach(i=>{ const k=(typeof imgSizeOf==='function')?imgSizeOf(i):'m'; const b=IMG_BOX[k]||IMG_BOX.m; const u=1/b.f;
      if(cur.length && fill+u>1.0001){ imgRows.push(cur); cur=[]; fill=0; }
      let bw=b.w, bh=b.h;
      if(i.w>0&&i.h>0){ const sc=Math.min(b.w/i.w, b.h/i.h); bw=Math.max(1,Math.round(i.w*sc)); bh=Math.max(1,Math.round(i.h*sc)); }
      cur.push(`<div style="width:${bw}px;height:${bh}px;flex:0 0 auto;overflow:hidden;border-radius:4px;border:1px solid #E5E2D8;box-sizing:border-box"><img src="${i.url}" style="width:100%;height:100%;display:block;object-fit:contain"></div>`); fill+=u; });
    if(cur.length) imgRows.push(cur); }
  const imgBlocks=imgRows.map((r,k)=>`<div style="margin-top:${k?14:24}px;display:flex;gap:14px;align-items:flex-start">${r.join('')}</div>`);
  const hideTotals=!!(document.getElementById('f-hidetotals')&&document.getElementById('f-hidetotals').checked);

  const payH=getPayTerms();

  let cliRows='';
  const inv=escHtml(document.getElementById('f-inv')?document.getElementById('f-inv').value.trim():'');
  const cliFields=[[cli,'客戶名稱'],[con,'聯絡人'],[ph,'聯絡電話'],[ad,'地址'],[inv,'發票抬頭'],[tax,'統一編號']];
  cliFields.forEach(([v,l])=>{
    if(v) cliRows+=`<div style="display:flex;gap:8px;font-size:12.5px;margin-bottom:7px;line-height:1.6"><span style="color:#A8A69C;min-width:62px">${l}</span><span style="color:#22241F">${v}</span></div>`;
  });
  /* 出貨資訊：只在「與聯絡地址不同」且有填任一欄時才另外印出，避免同一組地址重複兩次 */
  const shipSame=document.getElementById('f-shipsame')?document.getElementById('f-shipsame').checked:true;
  const shipCon=escHtml(document.getElementById('f-shipcon')?document.getElementById('f-shipcon').value.trim():'');
  const shipPh=escHtml(document.getElementById('f-shipph')?document.getElementById('f-shipph').value.trim():'');
  const shipAd=escHtml(document.getElementById('f-shipad')?document.getElementById('f-shipad').value.trim():'');
  let shipRows='';
  if(!shipSame && (shipCon||shipPh||shipAd)){
    const shipFields=[[shipCon,'出貨收件人'],[shipPh,'收件人電話'],[shipAd,'出貨地址']];
    shipFields.forEach(([v,l])=>{
      if(v) shipRows+=`<div style="display:flex;gap:8px;font-size:12.5px;margin-bottom:7px;line-height:1.6"><span style="color:#A8A69C;min-width:62px">${l}</span><span style="color:#22241F">${v}</span></div>`;
    });
  }
  const shipBlock = shipRows ? `<div style="margin-top:6px;padding-top:10px;border-top:1px dashed #E5E2D8">
    <div style="font-size:10px;color:#A6824A;font-weight:600;letter-spacing:1px;margin-bottom:6px">出貨資訊（與發票／聯絡地址不同）</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px">${shipRows}</div>
  </div>` : '';

  /* 統一頁首（每頁相同） */
  const header=`
  <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;border-bottom:1.5px solid #22241F;margin-bottom:20px">
    <div>
      <img src="https://raw.githubusercontent.com/MollyLin-coding/quote-system/main/assets/logo.png" style="height:32px;width:auto;display:block">
      <div style="font-size:9px;letter-spacing:1.8px;color:#A6824A;margin-top:7px;text-transform:uppercase;line-height:1.7;font-weight:600">KEVIN NUMBER 1 TAILORED.COCKTAIL<br>EST. 2023. TAIWAN</div>
      <div style="font-size:11px;color:#A8A69C;margin-top:6px">新北市新莊區化成路554巷37號　(02)8991-0068　統編 92719710</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:22px;font-weight:700;color:#22241F;letter-spacing:6px;margin-bottom:10px">報 價 單</div>
      ${(tagLot||tagCli)?`<div style="font-size:11px;color:#A6824A;font-weight:600;letter-spacing:.5px;margin-bottom:10px">${[tagLot,tagCli].filter(Boolean).join('　・　')}</div>`:''}
      <div style="display:inline-grid;grid-template-columns:auto auto;gap:4px 12px;font-size:11.5px">
        <span style="color:#A8A69C;text-align:right">單號</span><span style="color:#22241F;font-weight:600;text-align:right">${no}</span>
        <span style="color:#A8A69C;text-align:right">報價日</span><span style="color:#22241F;text-align:right">${dtF}</span>
        <span style="color:#A8A69C;text-align:right">有效至</span><span style="color:#A6824A;font-weight:700;text-align:right">${exF}</span>
        ${(showShip&&shipDate)?`<span style="color:#A8A69C;text-align:right">預計出貨日</span><span style="color:#22241F;text-align:right">${shipF}</span>`:''}
      </div>
    </div>
  </div>`;

  const topFirst = venH + `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px;margin-bottom:4px">${cliRows}</div>${shipBlock}`;
  const contNote = `<div style="font-size:10.5px;color:#A8A69C;letter-spacing:.5px;margin:0">品項明細（承前頁）</div>`;

  /* 尾段區塊（總計／圖片／付款條件／備註條款） */
  /* 未稅顯示（taxDisplay='excl'）：總計區只印「合計（未稅）」＋稅額另計註記，不印營業稅／含稅總計 */
  const freeShipRow=freeShip>0?`<div style="display:flex;justify-content:space-between;font-size:12px;color:#A6824A;padding:5px 2px"><span>免運優惠</span><span>$${Math.round(cvA(freeShip)).toLocaleString()}<span style="color:#9a968c;font-size:10.5px">（本次免收運費，不列入應付）</span></span></div>`:'';
  const _ratePctTxt=_rate>0?`（${+( _rate*100).toFixed(2)}%）`:'';
  const totals=hideTotals?'':(taxDisp==='excl'?`
  <div style="display:flex;justify-content:flex-end;margin-top:18px">
    <div style="min-width:250px">
      ${freeShipRow}
      <div style="display:flex;justify-content:space-between;font-size:18px;color:#22241F;font-weight:700;border-top:1.5px solid #22241F;padding-top:10px;margin-top:4px;letter-spacing:.3px"><span>合計（未稅）</span><span style="color:#A6824A">${tsub}</span></div>
      <div style="text-align:right;font-size:11.5px;color:#6B6B63;margin-top:6px">以上金額為未稅價，營業稅${_ratePctTxt}另計。</div>
    </div>
  </div>`:`
  <div style="display:flex;justify-content:flex-end;margin-top:18px">
    <div style="min-width:250px">
      <div style="display:flex;justify-content:space-between;font-size:12px;color:#6B6B63;padding:5px 2px"><span>${lbsub}</span><span>${tsub}</span></div>
      ${taxVisible?`<div style="display:flex;justify-content:space-between;font-size:12px;color:#6B6B63;padding:5px 2px"><span>${lbtax}</span><span>${ttax}</span></div>`:''}
      ${extVisible?`<div style="display:flex;justify-content:space-between;font-size:12px;color:#6B6B63;padding:5px 2px"><span>額外費用</span><span>${text}</span></div>`:''}
      ${freeShipRow}
      <div style="display:flex;justify-content:space-between;font-size:18px;color:#22241F;font-weight:700;border-top:1.5px solid #22241F;padding-top:10px;margin-top:4px;letter-spacing:.3px"><span>總計</span><span style="color:#A6824A">${tot}</span></div>
    </div>
  </div>`);

  const payBlock = payH?`<div style="margin-top:18px;padding:14px 18px;background:#FAF9F5;border-left:2.5px solid #A6824A;font-size:12.5px;color:#22241F;line-height:1.7">
    <span style="font-weight:700;color:#7C5E32">付款條件</span><br>${payH}
  </div>`:'';

  /* 2026-08-28：開放客戶寄倉（代工／一次性採購／客製標 勾選才印）——條款文字可在表單改 */
  let storageBlock='';
  if((qType==='bottle'||qType==='ownbrand'||qType==='ownlabel') && document.getElementById('ob-storage') && document.getElementById('ob-storage').checked){
    const _ta=document.getElementById('ob-storage-terms');
    const _txt=((_ta?_ta.value:'').trim())||(typeof OB_STORAGE_DEFAULT!=='undefined'?OB_STORAGE_DEFAULT:'');
    if(_txt) storageBlock=`<div style="margin-top:12px;padding:14px 18px;background:#FAF9F5;border-left:2.5px solid #A6824A;font-size:12.5px;color:#22241F;line-height:1.7">
    <span style="font-weight:700;color:#7C5E32">寄倉條款</span><br>${escHtml(_txt).replace(/\n/g,'<br>')}
  </div>`;
  }

  const notesBlock=`
  <div style="margin-top:16px;padding-top:14px;border-top:1px solid #E5E2D8;font-size:11.5px;color:#6B6B63;line-height:1.7">
    ${note?`<p style="margin:0 0 10px">${note}</p>`:''}
    <p style="margin:0">以下客戶簡稱甲方，凱文南坡萬實業社簡稱乙方。雙方確認此報價單內容無誤並於雙方各執一份，以維雙方權利。</p>
    <p style="margin:6px 0 0">匯款資訊：陽信銀行中興分行 (108)　02142-00230-91　凱文南坡萬實業社黃彥愷</p>
    <p style="margin:4px 0 0">匯款完成後，敬請提供轉帳截圖或帳號後五碼，以便核對入帳，謝謝。</p>
  </div>`;

  /* 統一頁尾：每頁標示頁數 */
  const footer=(p,t)=>`
  <div style="margin-top:auto;border-top:1px solid #E5E2D8;padding:12px 0 14px;display:flex;justify-content:space-between;align-items:center;font-size:10.5px;color:#A8A69C;letter-spacing:.4px">
    <span>凱文南坡萬實業社　·　報價單 ${no}</span>
    <span style="color:#6B6B63;font-weight:600">第 <span style="color:#A6824A">${p}</span> 頁，共 <span style="color:#A6824A">${t}</span> 頁</span>
  </div>`;

  return {header, topFirst, contNote, thead:theadStr, rows,
          tailBlocks:[totals, ...imgBlocks, payBlock, storageBlock, notesBlock], footer, mkTable,
          font:"-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,'Microsoft JhengHei',sans-serif"};
}

function buildStdPagesHtml(extraPageStyle){
  return buildQuotePagesHtml(buildStdDocParts(), extraPageStyle);
}

/* ---- 標準模式：預覽（多頁時逐頁顯示，每頁統一頁首＋頁尾頁碼）---- */
/* 側邊「預覽報價單」：依目前頁面決定預覽標準單或自訂單 */
function previewCurrent(){
  closeMobileNav();
  if(currentPage==='custom'){ openCustomPreview(); }
  else { gotoPage('new'); openPreview(); }
}
function openPreview(){
  const pages = buildStdPagesHtml('margin:0 auto 18px;box-shadow:0 4px 18px rgba(40,38,30,.22);');
  document.getElementById('pcon').innerHTML = `<div style="background:#D6D4CC;padding:18px 0 1px">${pages}</div>`;
  previewKind = 'std';
  document.getElementById('pv-btn-secondary').innerHTML = '<i class="ti ti-file-text"></i>正式文件';
  document.getElementById('pov').style.display='block';
  closeMobileNav();
}

function closePreview(){document.getElementById('pov').style.display='none';}

/* ===== 正式版 API 層 ===== */
