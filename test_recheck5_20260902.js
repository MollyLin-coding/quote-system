/* 2026-09-02 這一批的離線驗證：
   1 寄倉「都須留底」：刪除改成作廢，作廢列不算餘額、仍留在明細；員工也能操作
   2 重印驗收單只作廢還沒作廢的舊紀錄
   3 行事曆分類／事件 onclick 用 escAttr（名稱含單引號不會壞掉）
   4 待開發票判斷改成 invoice_no || invoice_date
   5 私人分類整個從系統移除（下拉沒有、月曆不顯示、今日待辦不列）
   6 自訂報價單有刪除鈕（老闆專用）
   7 存檔後背景補打 syncCalendarNow */
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const results=[]; const check=(n,c,x)=>results.push([c?'PASS':'FAIL',n,x||'']);

(async()=>{
  const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const errors=[];
  const mk=async(role, calls)=>{
    const p=await browser.newPage();
    p.on('pageerror',e=>errors.push('PAGEERROR: '+e.message));
    await p.route('**/script.google.com/**', async route=>{
      let b={}; try{ b=JSON.parse(route.request().postData()||'{}'); }catch(e){}
      if(calls) calls.push(b);
      let r;
      if(b.action==='login') r={ok:true, token:'t', role:role||'owner', name:role==='general'?'阿軒':'Molly'};
      else if(b.action==='getLoginUsers') r={ok:true, users:['Molly','阿軒']};
      else if(b.action==='batch') r={ok:true, results:(b.calls||[]).map(()=>({ok:true,quotes:[],orders:[],records:[],summary:{},shipments:[],customers:[],moves:[]}))};
      else if(b.action==='createQuote'||b.action==='updateQuote') r={ok:true, quoteNo:'20260902-01'};
      else r={ok:true, quotes:[], orders:[], records:[], items:[], shipments:[], summary:{}, customers:[], moves:[]};
      await route.fulfill({status:200, headers:{'Access-Control-Allow-Origin':'*'}, contentType:'application/json', body:JSON.stringify(r)});
    });
    await p.goto('http://localhost:8899/index.html');
    await p.waitForFunction(()=>{const e=document.getElementById('login-user');return e&&!/載入中/.test(e.textContent||'');},{timeout:15000}).catch(()=>{});
    await p.waitForTimeout(300);
    await p.evaluate(async()=>{ window.confirm=()=>true; window.alert=()=>{}; document.getElementById('login-pin').value='1'; await doLogin(); });
    await p.waitForTimeout(400);
    return p;
  };

  /* ===== 1 寄倉作廢制 ===== */
  const p1=await mk('owner');
  const r1=await p1.evaluate(()=>{
    ST_MOVES=[
      {move_id:'M1', date:'2026-09-01', customer:'甲客戶', sku_id:'', name:'測試酒', volume:'700', direction:'in',  qty:100, quote_no:'A', note:'', void_at:'', void_by:'', void_note:''},
      {move_id:'M2', date:'2026-09-01', customer:'甲客戶', sku_id:'', name:'測試酒', volume:'700', direction:'out', qty:30,  quote_no:'A', note:'', void_at:'2026-09-02T10:00:00+08:00', void_by:'阿軒', void_note:'登記錯誤'},
      {move_id:'M3', date:'2026-09-01', customer:'甲客戶', sku_id:'', name:'測試酒', volume:'700', direction:'out', qty:10,  quote_no:'A', note:'', void_at:'', void_by:'', void_note:''}
    ];
    gotoPage('consign'); stRender();
    const sum=stSummary('');
    const lg=document.getElementById('st-ledger-body').innerHTML;
    return { bal:stBalanceFor('甲客戶','','測試酒','700'), sumIn:sum[0]&&sum[0].in, sumOut:sum[0]&&sum[0].out,
             rows:(lg.match(/<tr/g)||[]).length, hasVoidTag:/已作廢/.test(lg), hasWho:/阿軒/.test(lg),
             hasWhy:/登記錯誤/.test(lg), btn:/作廢<\/button>/.test(lg), noX:!/>✕</.test(lg),
             total:stCustomerTotal('甲客戶') };
  });
  check('1 作廢的那筆不算進餘額（100−10＝90，不是 60）', r1.bal===90, JSON.stringify(r1));
  check('1 彙總表也不算作廢的（入 100／出 10）', r1.sumIn===100 && r1.sumOut===10, JSON.stringify(r1));
  check('1 客戶總餘額同樣跳過作廢', r1.total===90, JSON.stringify(r1));
  check('1 作廢的紀錄仍留在明細裡（三列都在）', r1.rows===3, JSON.stringify(r1));
  check('1 明細看得到「已作廢」＋是誰＋原因', r1.hasVoidTag&&r1.hasWho&&r1.hasWhy, JSON.stringify(r1));
  check('1 按鈕文字是「作廢」，不再是刪除的 ✕', r1.btn&&r1.noX, JSON.stringify(r1));

  /* 員工也能作廢（不再是老闆專用） */
  const p2=await mk('general');
  const r2=await p2.evaluate(()=>({
    notOwnerOnly: OWNER_ONLY_FNS.indexOf('stDeleteMove')<0,
    canSave: OWNER_ONLY_FNS.indexOf('stSaveMove')<0,
    isGeneral: !isOwner()
  }));
  check('1 員工身分確實是 general', r2.isGeneral===true);
  check('1 作廢寄倉紀錄不再是老闆專用', r2.notOwnerOnly===true);
  check('1 員工仍可登記（stSaveMove 沒被列管）', r2.canSave===true);

  /* ===== 2 重印只作廢還沒作廢的 ===== */
  const calls2=[];
  const p3=await mk('owner', calls2);
  await p3.route('**/script.google.com/**', async route=>{
    let b={}; try{ b=JSON.parse(route.request().postData()||'{}'); }catch(e){}
    calls2.push(b);
    let r={ok:true};
    if(b.action==='getStorageData') r={ok:true, moves:[
      {move_id:'V1', src:'VF:20260901-01:1:酒A:700', void_at:''},
      {move_id:'V2', src:'VF:20260901-01:1:酒B:700', void_at:'2026-09-02T09:00:00+08:00'},
      {move_id:'V3', src:'VF:20260901-01:2:酒A:700', void_at:''}
    ]};
    await route.fulfill({status:200, headers:{'Access-Control-Allow-Origin':'*'}, contentType:'application/json', body:JSON.stringify(r)});
  });
  const r3=await p3.evaluate(async()=>{ const n=await stRemoveMovesBySrc('20260901-01','1'); return n; });
  const voidCalls=calls2.filter(c=>c.action==='deleteStorageMove');
  check('2 重印只作廢「這一次出貨、且還沒作廢」的那筆（1 筆，不是 2 筆）', r3===1 && voidCalls.length===1, 'n='+r3+' calls='+voidCalls.length);
  check('2 作廢時有帶原因，明細才看得出為什麼', /重印/.test(voidCalls[0]&&voidCalls[0].note||''), JSON.stringify(voidCalls[0]||{}));
  check('2 不會碰到別次出貨的紀錄（V3 沒被作廢）', !voidCalls.some(c=>c.move_id==='V3'), JSON.stringify(voidCalls));

  /* ===== 3 + 5 行事曆 ===== */
  const p4=await mk('owner');
  const r4=await p4.evaluate(()=>{
    CAL_ITEMS=[
      {item_id:"it'1", kind:'memo', date:'2026-09-02', title:'含單引號的事項', category:"Molly's 私帳", done:'N', all_day:'Y'},
      {item_id:'it2',  kind:'memo', date:'2026-09-02', title:'私人的事',       category:'私人',        done:'N', all_day:'Y'},
      {item_id:'it3',  kind:'memo', date:'2026-09-02', title:'工作的事',       category:'工作',        done:'N', all_day:'Y'}
    ];
    CAL_KINDS={order:true,memo:true,recur:true}; CAL_CATS={};
    renderCalendar();
    const evs=eventsOn('2026-09-02');
    const bar=document.getElementById('cal-catbar').innerHTML;
    const html=evs.map(e=>calEvHtml(e)).join('');
    return { n:evs.length, titles:evs.map(e=>e.txt).join('|'),
             barHasPrivate:/私人/.test(bar),
             /* 讀 innerHTML 會把 &#39; 還原成 '，分不出有沒有跳脫 → 直接按下去看有沒有作用（這才是使用者感受到的） */
             barHasQuote:(function(){
               const b=Array.from(document.querySelectorAll('#cal-catbar button')).find(x=>/私帳/.test(x.textContent));
               if(!b) return 'chip 不見了';
               const before=calCatOn("Molly's 私帳");
               b.click();
               return calCatOn("Molly's 私帳")!==before;
             })(),
             evHasQuote:(function(){
               document.getElementById('cal-root').innerHTML=html;
               const el=document.querySelector('#cal-root .cev');
               if(!el) return '事件標籤不見了';
               let opened=null; const orig=window.openCalEdit;
               window.openCalEdit=(id)=>{ opened=id; };
               el.click();
               window.openCalEdit=orig;
               return opened==="it'1" ? true : ('opened='+opened);
             })(),
             optHasPrivate:/私人/.test(document.getElementById('ce-category').innerHTML),
             colorHasPrivate: typeof CAL_CATEGORY_COLORS!=='undefined' && ('私人' in CAL_CATEGORY_COLORS) };
  });
  check('5 月曆上看不到「私人」分類的行程', r4.n===2 && !/私人的事/.test(r4.titles), JSON.stringify(r4));
  check('5 其他分類照常顯示', /含單引號的事項/.test(r4.titles) && /工作的事/.test(r4.titles), r4.titles);
  check('5 分類篩選列不再出現「私人」', r4.barHasPrivate===false, JSON.stringify(r4));
  check('5 新增事項的分類下拉也拿掉「私人」', r4.optHasPrivate===false);
  check('5 配色表不再有「私人」', r4.colorHasPrivate===false);
  check('3 分類名稱含單引號：chip 按下去真的會開關（原本語法壞掉、完全沒反應）', r4.barHasQuote===true, JSON.stringify(r4.barHasQuote));
  check('3 事項 id 含單引號：點事件標籤真的開得了編輯視窗', r4.evHasQuote===true, JSON.stringify(r4.evHasQuote));

  /* ===== 4 待開發票 ===== */
  const r5=await p4.evaluate(()=>{
    const mkOrd=(st)=>({no:'20260801-0'+Math.random().toString().slice(2,4), client:'客戶A｜x', total:1000, st:st});
    const base={status:'paid', ship_date_actual:'2026-08-01', final_date:'2026-08-10', deposit_date:'2026-07-01'};
    const run=(st)=>{ ORDERS_CACHE=[mkOrd(st)]; CAL_ITEMS=[]; renderTodayFocus();
      return /待開發票/.test(document.getElementById('cal-focus').innerHTML); };
    return {
      noneFilled: run(Object.assign({}, base)),
      onlyDate:   run(Object.assign({}, base, {invoice_date:'2026-08-11'})),
      onlyNo:     run(Object.assign({}, base, {invoice_no:'AB12345678'}))
    };
  });
  check('4 發票號碼與日期都沒填 → 有「待開發票」提醒', r5.noneFilled===true, JSON.stringify(r5));
  check('4 只填了發票日期（沒登號碼）→ 提醒消失（原本會一直掛著）', r5.onlyDate===false, JSON.stringify(r5));
  check('4 只填發票號碼 → 提醒也消失', r5.onlyNo===false, JSON.stringify(r5));

  /* ===== 6 自訂單刪除鈕 ===== */
  const p5=await mk('owner');
  const r6=await p5.evaluate(()=>{
    REC_QUOTES=[]; REC_CUSTOM=[{quote_no:'20260902-99', client:'自訂客戶', quote_date:'2026-09-02', totals_json:'{"grandTotal":5000}'}];
    gotoPage('records'); renderRecords();
    const html=document.getElementById('rec-body').innerHTML;
    return { hasDel:/deleteCustomRecord\(/.test(html), fnExists:typeof deleteCustomRecord==='function',
             ownerOnly:OWNER_ONLY_FNS.indexOf('deleteCustomRecord')>=0 };
  });
  check('6 自訂報價單那列有刪除鈕', r6.hasDel===true, JSON.stringify(r6));
  check('6 deleteCustomRecord 函式存在', r6.fnExists===true);
  check('6 刪除自訂單列為老闆專用', r6.ownerOnly===true);

  const p6=await mk('general');
  const r6b=await p6.evaluate(()=>{
    REC_QUOTES=[]; REC_CUSTOM=[{quote_no:'20260902-99', client:'自訂客戶', quote_date:'2026-09-02', totals_json:'{}'}];
    gotoPage('records'); renderRecords(); if(typeof roleSweep==='function') roleSweep();
    const btns=Array.from(document.querySelectorAll('#rec-body button')).filter(b=>/刪除/.test(b.textContent));
    return { shown:btns.filter(b=>b.offsetParent!==null).length };
  });
  check('6 員工看不到自訂單的刪除鈕', r6b.shown===0, JSON.stringify(r6b));

  /* ===== 7 存檔後補打日曆同步 ===== */
  const calls7=[];
  const p7=await mk('owner', calls7);
  await p7.evaluate(async()=>{
    gotoPage('new'); setType('bottle'); resetAll(true); setType('bottle');
    document.getElementById('f-cli').value='測試客戶';
    addBotRow({name:'酒', vol:700, price:1000, qty:10}); calc();
    editingQuoteNo=null;
    await saveQuote();
  });
  await p7.waitForTimeout(600);
  const acts=calls7.map(c=>c.action);
  check('7 存檔後有背景補打 Google 日曆同步', acts.indexOf('syncCalendarNow')>=0, acts.join(','));
  check('7 存檔本身照常送出（createQuote）', acts.indexOf('createQuote')>=0, acts.join(','));

  results.forEach(r=>console.log(r[0], r[1], r[2]?('  → '+r[2]):''));
  const fails=results.filter(r=>r[0]==='FAIL').length;
  console.log(errors.length?('JS ERRORS: '+errors.slice(0,4).join(' | ')):'NO JS ERRORS');
  console.log(fails?(fails+' FAIL / '+results.length):('ALL '+results.length+' PASS'));
  await browser.close();
})();
