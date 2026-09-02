/* 2026-09-03 Molly：①訂單追蹤點得進報價單預覽 ②客戶名稱必填、空白的舊單要標出來
   1  訂單追蹤每一列都有「預覽報價單」按鈕（標準單／自訂單都有）
   2  按下去→標準單走 previewRecordQuote(no,'orders')、自訂單走 recPreviewCustom(no,'orders')
   3  預覽視窗真的打開（#pov）
   4  關掉預覽會自動回到訂單追蹤（不是留在報價單填寫頁）
   5  從報價紀錄開預覽（沒帶 backPage）關掉後不會亂跳頁
   6  客戶名稱空白時 saveQuote() 擋下來、不打後端
   7  客戶名稱有填就照常存
   8  自訂報價單客戶名稱空白也擋
   9  報價紀錄清單：客戶空白的單標「⚠ 未填客戶名稱」、有填的照常顯示
   10 訂單追蹤清單：同上 */
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const results=[]; const check=(n,c,x)=>results.push([c?'PASS':'FAIL',n,x||'']);

const QUOTES=[
  {quoteNo:'20260901-01', quoteType:'bottle', clientName:'有名字客戶', quoteDate:'2026-09-01', grandTotal:1000, status:'草稿'},
  {quoteNo:'20260829-01', quoteType:'bottle', clientName:'',         quoteDate:'2026-08-29', grandTotal:2000, status:'草稿'}
];
const CUSTOMS=[{quote_no:'CQ-001', client:'自訂客戶', quote_date:'2026-08-30', totals_json:JSON.stringify({total:500}), items_json:'[]', headers_json:'{}'}];

(async()=>{
  const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const errors=[]; const posted=[];
  const p=await browser.newPage();
  p.on('pageerror',e=>errors.push('PAGEERROR: '+e.message));
  const answer=(b)=>{
    if(b.action==='login') return {ok:true, token:'t', role:'owner', name:'Molly'};
    if(b.action==='getLoginUsers') return {ok:true, users:['Molly']};
    if(b.action==='getQuotes') return {ok:true, quotes:QUOTES};
    if(b.action==='listCustomQuotes') return {ok:true, quotes:CUSTOMS};
    if(b.action==='getOrderStatusList') return {ok:true, orders:[]};
    if(b.action==='getQuoteById') return {ok:true, quote:Object.assign({items:[]}, QUOTES.find(q=>q.quoteNo===b.quoteNo)||{})};
    if(b.action==='createQuote'||b.action==='updateQuote') return {ok:true, quoteNo:b.quote&&b.quote.quoteNo||'X'};
    if(b.action==='saveCustomQuote') return {ok:true, quote:b.quote};
    return {ok:true, quotes:[], orders:[], records:[], items:[], shipments:[], summary:{}, customers:[], moves:[]};
  };
  await p.route('**/script.google.com/**', async route=>{
    let b={}; try{ b=JSON.parse(route.request().postData()||'{}'); }catch(e){}
    posted.push(b.action||'');
    let r = (b.action==='batch') ? {ok:true, results:(b.calls||[]).map(c=>answer(c||{}))} : answer(b);
    await route.fulfill({status:200, headers:{'Access-Control-Allow-Origin':'*'}, contentType:'application/json', body:JSON.stringify(r)});
  });
  await p.goto('http://localhost:8899/index.html');
  await p.waitForFunction(()=>{const e=document.getElementById('login-user');return e&&!/載入中/.test(e.textContent||'');},{timeout:15000}).catch(()=>{});
  await p.waitForTimeout(300);
  await p.evaluate(async()=>{ window.confirm=()=>true; window.alert=()=>{}; document.getElementById('login-pin').value='1'; await doLogin(); });
  await p.waitForTimeout(400);

  /* ---------- 訂單追蹤：按鈕存在 ---------- */
  const r1=await p.evaluate(async()=>{
    gotoPage('orders');
    await loadOrders(true);
    const rows=Array.from(document.querySelectorAll('#ord-body tr'));
    const btns=Array.from(document.querySelectorAll('#ord-body button')).filter(b=>/預覽報價單/.test(b.textContent||''));
    return { rowCount:rows.length, btnCount:btns.length,
             datasets:btns.map(b=>[b.dataset.no,b.dataset.src]),
             cliText:document.getElementById('ord-body').innerText };
  });
  check('1 訂單追蹤每一列都有「預覽報價單」按鈕', r1.rowCount===3 && r1.btnCount===3, JSON.stringify(r1.datasets));
  check('1b 按鈕帶對單號與來源（標準單 std／自訂單 custom）',
    JSON.stringify(r1.datasets.slice().sort())===JSON.stringify([['20260829-01','std'],['20260901-01','std'],['CQ-001','custom']].sort()),
    JSON.stringify(r1.datasets));
  check('10 訂單追蹤清單：客戶空白標紅、有填的照常', /未填客戶名稱/.test(r1.cliText) && /有名字客戶/.test(r1.cliText) && /自訂客戶/.test(r1.cliText), r1.cliText.replace(/\n/g,' | ').slice(0,220));

  /* ---------- 按下去會呼叫對的函式 ---------- */
  const r2=await p.evaluate(()=>{
    const calls=[];
    const o1=window.previewRecordQuote, o2=window.recPreviewCustom;
    window.previewRecordQuote=(no,bp)=>{calls.push(['std',no,bp]);};
    window.recPreviewCustom=(no,bp)=>{calls.push(['custom',no,bp]);};
    Array.from(document.querySelectorAll('#ord-body button')).filter(b=>/預覽報價單/.test(b.textContent||'')).forEach(b=>b.click());
    window.previewRecordQuote=o1; window.recPreviewCustom=o2;
    return calls;
  });
  check('2 標準單帶 backPage=orders 走 previewRecordQuote',
    r2.some(c=>c[0]==='std'&&c[1]==='20260901-01'&&c[2]==='orders'), JSON.stringify(r2));
  check('2b 自訂單帶 backPage=orders 走 recPreviewCustom',
    r2.some(c=>c[0]==='custom'&&c[1]==='CQ-001'&&c[2]==='orders'), JSON.stringify(r2));

  /* ---------- 真的開預覽＋關掉回訂單追蹤 ---------- */
  const r3=await p.evaluate(async()=>{
    gotoPage('orders');
    await previewRecordQuote('20260901-01','orders');
    const opened=document.getElementById('pov').style.display;
    const pageWhileOpen=currentPage;
    const hasCli=/有名字客戶/.test(document.getElementById('pcon').innerText||'');
    closePreview();
    return { opened, pageWhileOpen, hasCli, pageAfter:currentPage,
             ordersOn:document.getElementById('page-orders').classList.contains('on'),
             povClosed:document.getElementById('pov').style.display==='none' };
  });
  check('3 預覽視窗打開、印出客戶名稱', r3.opened==='block' && r3.hasCli, JSON.stringify(r3));
  check('4 關掉預覽自動回訂單追蹤', r3.povClosed && r3.pageAfter==='orders' && r3.ordersOn, JSON.stringify(r3));

  /* ---------- 從報價紀錄開（沒帶 backPage）關掉不亂跳 ---------- */
  const r4=await p.evaluate(async()=>{
    gotoPage('records');
    await previewRecordQuote('20260901-01');
    const pageWhileOpen=currentPage;   // previewRecordQuote 本來就會切到 new
    closePreview();
    return { pageWhileOpen, pageAfter:currentPage };
  });
  check('5 從報價紀錄開預覽，關掉後留在原地（不會被帶回訂單追蹤）',
    r4.pageWhileOpen==='new' && r4.pageAfter==='new', JSON.stringify(r4));

  /* ---------- 客戶名稱必填 ---------- */
  const r5=await p.evaluate(async()=>{
    gotoPage('new'); resetAll(true);
    document.getElementById('f-cli').value='';
    addBotRow({name:'測試酒', vol:'500', price:100, qty:1}); calc();
    const before=window.__posted?0:0;
    let toastMsg=''; const ot=window.toast; window.toast=(m,k)=>{ toastMsg=m; };
    const n0=performance.now();
    await saveQuote();
    window.toast=ot;
    return { toastMsg, editing: (typeof editingQuoteNo!=='undefined'?editingQuoteNo:null) };
  });
  check('6 客戶名稱空白時擋下來、給提示', /客戶名稱/.test(r5.toastMsg||'') && !r5.editing, JSON.stringify(r5));
  const postedAfter6 = posted.filter(a=>a==='createQuote'||a==='updateQuote').length;
  check('6b 客戶名稱空白時完全不打後端', postedAfter6===0, 'createQuote/updateQuote 次數='+postedAfter6);

  const r6=await p.evaluate(async()=>{
    document.getElementById('f-cli').value='正常客戶';
    let toastMsg=''; const ot=window.toast; window.toast=(m,k)=>{ toastMsg=m; };
    await saveQuote();
    window.toast=ot;
    return { toastMsg, editing:(typeof editingQuoteNo!=='undefined'?editingQuoteNo:null) };
  });
  const postedAfter7 = posted.filter(a=>a==='createQuote'||a==='updateQuote').length;
  check('7 客戶名稱有填就照常存得下去', postedAfter7===1 && !!r6.editing, JSON.stringify(r6)+' 次數='+postedAfter7);

  const r7=await p.evaluate(async()=>{
    gotoPage('custom'); resetCustom(true);
    document.getElementById('c-cli').value='';
    let toastMsg=''; const ot=window.toast; window.toast=(m,k)=>{ toastMsg=m; };
    await saveCustomToBackend();
    window.toast=ot;
    return { toastMsg };
  });
  const postedCustom = posted.filter(a=>a==='saveCustomQuote').length;
  check('8 自訂報價單客戶名稱空白也擋', /客戶名稱/.test(r7.toastMsg||'') && postedCustom===0, JSON.stringify(r7)+' saveCustomQuote 次數='+postedCustom);

  /* ---------- 報價紀錄清單標紅 ---------- */
  const r8=await p.evaluate(async()=>{
    gotoPage('records');
    await loadRecords(true);
    const t=document.getElementById('rec-body').innerText;
    return { t, warn:(document.getElementById('rec-body').innerHTML.match(/未填客戶名稱/g)||[]).length };
  });
  check('9 報價紀錄清單：空白客戶標「⚠ 未填客戶名稱」、只標那一張',
    r8.warn===1 && /有名字客戶/.test(r8.t) && /自訂客戶/.test(r8.t), JSON.stringify({warn:r8.warn}));

  await browser.close();
  results.forEach(x=>console.log(x[0], x[1], x[2]?'   → '+x[2]:''));
  console.log(errors.length?('JS ERRORS: '+errors.join(' | ')):'NO JS ERRORS');
  const f=results.filter(x=>x[0]==='FAIL').length;
  console.log(f?`${f} FAIL`:`ALL ${results.length} PASS`);
})();
