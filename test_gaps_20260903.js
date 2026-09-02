/* 2026-09-03 第二批：全系統「同類問題」修正
   A 防呆（存得下去、之後就看不到）
     1 行事曆備忘沒填日期 → 擋下來、不打後端
     2 分批出貨全空白列 → 擋下來、不打後端
     3 客訴登記：沒填問題說明 → 擋；只有說明、沒單號也沒客戶 → 擋；有單號就放行
     4 vmClientOf 不再把顯示用的「—」當成真的客戶名回傳
   B 看得到卻打不開
     5 行事曆訂單事件（🚚 出貨）點下去會開那張單，不再只是跳頁
     6 今日焦點的訂單提醒同上
     7 今日待辦「客戶還沒回報驗收」整列點下去＝開那張單的驗收單
     8 客戶管理往來報價單 → 標準單走預覽、自訂單不再是死路
     9 驗收管理待處理回報／未回報催單有「驗收單」鈕，CS- 單號不給鈕
    10 編輯進度視窗有「預覽報價單」，關掉會回到打開它時的那一頁
    11 自訂報價單備份清單有「預覽」 */
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const results=[]; const check=(n,c,x)=>results.push([c?'PASS':'FAIL',n,x||'']);

const QUOTES=[{quoteNo:'20260901-01', quoteType:'bottle', clientName:'甲客戶', quoteDate:'2026-09-01', grandTotal:1000, status:'草稿'}];
const CUSTOMS=[{quote_no:'CQ-001', client:'自訂客戶', quote_date:'2026-08-30', tag:'案名A', totals_json:JSON.stringify({total:500}), items_json:'[]', headers_json:'{}', updated_at:'2026-08-30T10:00:00+08:00'}];

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
    if(b.action==='getVerifyKey') return {ok:true, k:'kkk'};
    return {ok:true, quotes:[], orders:[], records:[], items:[], shipments:[], summary:{}, customers:[], moves:[], rows:[]};
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

  /* ---------- 1 行事曆備忘必填日期 ---------- */
  const r1=await p.evaluate(async()=>{
    gotoPage('cal'); await new Promise(r=>setTimeout(r,900));
    openCalAdd(''); 
    document.getElementById('ce-kind').value='memo'; onCalKindChange();
    document.getElementById('ce-title').value='沒日期的備忘';
    document.getElementById('ce-date').value='';
    let msg=''; const ot=window.toast; window.toast=m=>{msg=m;};
    await saveCalItem();
    window.toast=ot;
    return {msg};
  });
  const savedCal = posted.filter(a=>a==='saveCalendarItem').length;
  check('1 備忘沒填日期就擋下來、不打後端', /日期/.test(r1.msg||'') && savedCal===0, JSON.stringify(r1)+' saveCalendarItem='+savedCal);

  const r1b=await p.evaluate(async()=>{
    document.getElementById('ce-date').value='2026-09-10';
    let msg=''; const ot=window.toast; window.toast=m=>{msg=m;};
    await saveCalItem();
    window.toast=ot; return {msg};
  });
  check('1b 補上日期就存得下去', posted.filter(a=>a==='saveCalendarItem').length===1, JSON.stringify(r1b));

  /* ---------- 2 分批出貨全空白列 ---------- */
  const r2=await p.evaluate(async()=>{
    gotoPage('orders'); await loadOrders(true);
    openOrdEdit('20260901-01');
    shpToggle();                      // 展開分批區
    await new Promise(r=>setTimeout(r,300));
    shpAddRow();
    const btn=document.querySelector('#shp-body tr[data-shpid=""] button.rec-act-btn');
    let msg=''; const ot=window.toast; window.toast=m=>{msg=m;};
    await shpSaveRow(btn);
    window.toast=ot;
    const dis=btn.disabled, txt=btn.textContent;
    closeOrdEdit(true);
    return {msg, dis, txt};
  });
  const addShp = posted.filter(a=>a==='addShipment').length;
  check('2 分批出貨空白列擋下來、不打後端、按鈕沒卡住',
    /還沒填/.test(r2.msg||'') && addShp===0 && r2.dis===false && r2.txt==='儲存', JSON.stringify(r2)+' addShipment='+addShp);

  /* ---------- 3 客訴登記防呆 ---------- */
  const r3=await p.evaluate(async()=>{
    gotoPage('verify'); await new Promise(r=>setTimeout(r,600));
    const out={};
    const run=async(no,cli,desc)=>{
      document.getElementById('vmm-no').value=no;
      document.getElementById('vmm-client').value=cli;
      document.getElementById('vmm-desc').value=desc;
      let msg=''; const ot=window.toast; window.toast=m=>{msg=m;};
      await saveVmManual(); window.toast=ot; return msg;
    };
    openVmManual&&openVmManual();
    out.noDesc=await run('20260901-01','甲客戶','');
    out.noNoNoCli=await run('','','客人說瓶身有刮痕');
    out.dashCli=await run('','—','客人說瓶身有刮痕');
    out.ok=await run('20260901-01','','客人說瓶身有刮痕');
    return out;
  });
  const addVer = posted.filter(a=>a==='addVerification').length;
  check('3 沒填問題說明 → 擋', /問題說明/.test(r3.noDesc||''), JSON.stringify(r3.noDesc));
  check('3b 只有說明、沒單號也沒客戶 → 擋', /單號/.test(r3.noNoNoCli||''), JSON.stringify(r3.noNoNoCli));
  check('3c 客戶欄是「—」不算有填 → 擋', /單號/.test(r3.dashCli||''), JSON.stringify(r3.dashCli));
  check('3d 有單號就放行（只送出這一筆）', addVer===1, 'addVerification='+addVer+' msg='+JSON.stringify(r3.ok));

  /* ---------- 4 vmClientOf 不回「—」 ---------- */
  const r4=await p.evaluate(()=>{
    const snapV=(typeof VM_DATA!=='undefined')?VM_DATA:null;
    VM_DATA={reports:[],forms:[]};
    ORDERS_CACHE=[{no:'X-1', client:'—'},{no:'X-2', client:'真客戶'},{no:'X-3', client:'自訂客戶｜案名A'}];
    const out=[vmClientOf('X-1'), vmClientOf('X-2'), vmClientOf('X-3')];
    VM_DATA=snapV;
    return out;
  });
  check('4 「—」不再被當成客戶名，正常客戶照樣回得到',
    r4[0]==='' && r4[1]==='真客戶' && r4[2]==='自訂客戶', JSON.stringify(r4));

  /* ---------- 5 行事曆訂單事件點得開那張單 ---------- */
  const r5=await p.evaluate(()=>{
    if(typeof calEvHtml!=='function') return {h:'', h2:''};
    const h=calEvHtml({t:'ship', txt:'🚚 甲客戶 出貨', no:'20260901-01'});
    const h2=calEvHtml({t:'memo', txt:'📌 備忘', item:{item_id:'M1'}});
    return {h, h2};
  });
  check('5 行事曆出貨事件改成開那張單（不再只是 gotoPage）',
    /tdOpenOrder\(this\.dataset\.no\)/.test(r5.h) && /data-no="20260901-01"/.test(r5.h) && !/gotoPage\('orders'\)/.test(r5.h), r5.h);
  check('5b 備忘事件的行為沒被動到', /openCalEdit\(this\.dataset\.id\)/.test(r5.h2), r5.h2);

  /* ---------- 6 今日焦點 ---------- */
  const r6=await p.evaluate(async()=>{
    ORDERS_CACHE=[{no:'20260901-01', client:'甲客戶', st:{status:'shipped', ship_date_actual:'2026-09-01'}}];
    CAL_ITEMS=[];
    renderTodayFocus();
    const html=document.getElementById('cal-focus').innerHTML;
    return {html, hasOpen:/tdOpenOrder\('20260901-01'\)/.test(html), hasOld:/onclick="gotoPage\('orders'\)"/.test(html)};
  });
  check('6 今日焦點的訂單提醒點得開那張單', r6.hasOpen && !r6.hasOld, r6.html.slice(0,200));

  /* ---------- 7 今日待辦「還沒回報驗收」 ---------- */
  const r7=await p.evaluate(async()=>{
    gotoPage('today');
    TD_DATA={ ship_due:[], final_due:[], no_invoice:[], calendar:[],
      no_scan:[{quote_no:'20260901-01', client:'甲客戶', days_since:9, ship_date:'2026-08-25', lot:'L1'}] };
    renderToday();
    const card=document.getElementById('td-body').innerHTML;
    return { openForm:/tdOpenVerifyForm\('20260901-01'\)/.test(card), stillHasList:/tdOpenVerify\(\)/.test(card),
             keepsCopy:/tdCopyReminder/.test(card), rowIsButton:/class="td-row[^"]*"[^>]*onclick="tdOpenVerifyForm/.test(card) };
  });
  check('7 整列點下去＝開那張單的驗收單（催單鈕與整列可點都保留）',
    r7.openForm && r7.keepsCopy && r7.rowIsButton, JSON.stringify(r7));
  check('7b 仍留一個入口去驗收管理總表', r7.stillHasList, JSON.stringify(r7));

  /* ---------- 8 客戶管理往來報價單 ---------- */
  const r8=await p.evaluate(async()=>{
    const calls=[];
    const o1=window.previewRecordQuote, o2=window.recPreviewCustom, o3=window.openRecord;
    window.previewRecordQuote=(no,bp)=>calls.push(['std',no,bp]);
    window.recPreviewCustom=(no,bp)=>calls.push(['custom',no,bp]);
    window.openRecord=(no)=>calls.push(['openRecord',no]);
    cusOpenQuote('20260901-01','std');
    cusOpenQuote('CQ-001','custom');
    window.previewRecordQuote=o1; window.recPreviewCustom=o2; window.openRecord=o3;
    return calls;
  });
  check('8 標準單走預覽、回客戶管理頁', r8.some(c=>c[0]==='std'&&c[1]==='20260901-01'&&c[2]==='customer'), JSON.stringify(r8));
  check('8b 自訂單不再是死路，直接開預覽', r8.some(c=>c[0]==='custom'&&c[1]==='CQ-001'&&c[2]==='customer'), JSON.stringify(r8));

  /* ---------- 9 驗收管理的「驗收單」鈕 ---------- */
  const r9=await p.evaluate(()=> (typeof vmViewBtn!=='function') ? {missing:true, normal:'', cs:'', empty:''} : ({
    normal: vmViewBtn('20260901-01'),
    cs: vmViewBtn('CS-2-20260810183902'),
    empty: vmViewBtn('')
  }));
  check('9 一般單號有「驗收單」鈕', /openVerifyForm\(this\.dataset\.no\)/.test(r9.normal) && /data-no="20260901-01"/.test(r9.normal), r9.normal);
  check('9b 寄售 CS- 單號與空單號不給鈕（避免點了查無此單）', !r9.missing && r9.cs==='' && r9.empty==='', JSON.stringify(r9));

  /* ---------- 10 編輯進度視窗的「預覽報價單」 ---------- */
  const r10=await p.evaluate(async()=>{
    gotoPage('report');                 // 故意從月報表打開，驗證關掉會回月報表而不是訂單追蹤
    await loadOrders(true);
    openOrdEdit('20260901-01');
    const btn=Array.from(document.querySelectorAll('#oe-overlay button')).find(b=>/預覽報價單/.test(b.textContent||''));
    if(!btn){ closeOrdEdit(true); return {btn:false, pov:'', oe:'', back:currentPage}; }
    btn.click();
    await new Promise(r=>setTimeout(r,2500));
    const pov=document.getElementById('pov').style.display;
    const oe=document.getElementById('oe-overlay').style.display;
    closePreview();
    await new Promise(r=>setTimeout(r,400));
    return {btn:true, pov, oe, back:currentPage};
  });
  check('10 編輯進度視窗有「預覽報價單」、會關掉進度視窗再開預覽', r10.btn && r10.pov==='block' && r10.oe==='none', JSON.stringify(r10));
  check('10b 關掉預覽回到打開它時那一頁（月報表，不是訂單追蹤）', r10.back==='report', JSON.stringify(r10));

  /* ---------- 11 自訂報價單備份清單的「預覽」 ---------- */
  const r11=await p.evaluate(async()=>{
    gotoPage('custom');
    await loadMyCustomQuotes();
    const html=document.getElementById('cq-list').innerHTML;
    return { hasPreview:/recPreviewCustom\(this\.dataset\.no,'custom'\)/.test(html), keepsLoad:/loadCustomQuoteByNo/.test(html) };
  });
  check('11 自訂單備份清單有「預覽」、原本的載入編輯還在', r11.hasPreview && r11.keepsLoad, JSON.stringify(r11));

  await browser.close();
  results.forEach(x=>console.log(x[0], x[1], x[2]?'   → '+x[2]:''));
  console.log(errors.length?('JS ERRORS: '+errors.join(' | ')):'NO JS ERRORS');
  const f=results.filter(x=>x[0]==='FAIL').length;
  console.log(f?`${f} FAIL`:`ALL ${results.length} PASS`);
})();
