/* 2026-09-03：分批出貨要在行事曆／今日焦點／今日待辦上「先顯示」
   Molly 拍板：①有分批的單只顯示各批（主線那顆收起來）②月曆＋今日焦點＋今日待辦都要
   ③已出貨的批次照舊標 ✓（用實際出貨日那一天）
   1  orderShipPoints：沒分批＝主線一筆（行為不變）
   2  orderShipPoints：有分批＝每批一筆、主線那筆不再出現
   3  orderShipPoints：批次有實際出貨日 → 掛在實際那天並標 done
   4  月曆：三批分別出現在三天，各自標「第N批/共M批」
   5  月曆：有分批的單，主線預計出貨日那天不再長出 🚚
   6  月曆：已出貨的批次顯示 ✓
   7  今日焦點：逾期／今天的批次各列一行，帶批次標籤
   8  今日焦點：有分批時不再列主線那一行
   9  今日焦點：批次的打勾圈圈呼叫 calFocusShipBatch(批次id, 單號)
  10  calFocusShipBatch 會送 updateShipment 並把畫面即刻更新
  11  今日待辦：有分批的單換成「該出而還沒出的那幾批」
  12  今日待辦：主線還沒到期、但某一批到期的單也會被補進來
  13  今日待辦：完全沒有分批資料時，後端給什麼就顯示什麼（行為不變） */
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const results=[]; const check=(n,c,x)=>results.push([c?'PASS':'FAIL',n,x||'']);
const ymd=d=>{const t=new Date();t.setDate(t.getDate()+d);const p=n=>String(n).padStart(2,'0');return t.getFullYear()+'-'+p(t.getMonth()+1)+'-'+p(t.getDate());};

(async()=>{
  const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const errors=[]; const posted=[];
  const p=await browser.newPage();
  p.on('pageerror',e=>errors.push('PAGEERROR: '+e.message));
  const answer=(b)=>{
    if(b.action==='login') return {ok:true, token:'t', role:'owner', name:'Molly'};
    if(b.action==='getLoginUsers') return {ok:true, users:['Molly']};
    if(b.action==='updateShipment') return {ok:true};
    return {ok:true, quotes:[], orders:[], records:[], items:[], shipments:[], summary:{}, customers:[], moves:[], rows:[]};
  };
  await p.route('**/script.google.com/**', async route=>{
    let b={}; try{ b=JSON.parse(route.request().postData()||'{}'); }catch(e){}
    posted.push(b);
    let r=(b.action==='batch')?{ok:true, results:(b.calls||[]).map(c=>answer(c||{}))}:answer(b);
    await route.fulfill({status:200, headers:{'Access-Control-Allow-Origin':'*'}, contentType:'application/json', body:JSON.stringify(r)});
  });
  await p.goto('http://localhost:8899/index.html');
  await p.waitForFunction(()=>{const e=document.getElementById('login-user');return e&&!/載入中/.test(e.textContent||'');},{timeout:15000}).catch(()=>{});
  await p.waitForTimeout(300);
  await p.evaluate(async()=>{ window.confirm=()=>true; window.alert=()=>{}; document.getElementById('login-pin').value='1'; await doLogin(); });
  await p.waitForTimeout(400);

  const D=await p.evaluate(y=>{ window.__Y=y; return true; }, {d0:ymd(0), dm3:ymd(-3), d5:ymd(5), d20:ymd(20), d40:ymd(40)});

  /* ---------- 共用規則 orderShipPoints ---------- */
  const r1=await p.evaluate(()=>{
    const Y=window.__Y;
    if(typeof orderShipPoints!=='function') return {missing:true, plain:[], done:[], batch:[{},{},{}]};
    SHP_ALL=[];   // 沒有任何分批
    const plain=orderShipPoints({no:'A-1', st:{ship_date_est:Y.d5}});
    const done =orderShipPoints({no:'A-1', st:{ship_date_est:Y.d5, ship_date_actual:Y.d0}});
    SHP_ALL=[
      {id:'S1', quote_no:'B-1', seq:1, ship_date_est:Y.dm3, ship_date_actual:''},
      {id:'S3', quote_no:'B-1', seq:3, ship_date_est:Y.d40, ship_date_actual:''},
      {id:'S2', quote_no:'B-1', seq:2, ship_date_est:Y.d20, ship_date_actual:Y.d5}
    ];
    const batch=orderShipPoints({no:'B-1', st:{ship_date_est:Y.d40}});
    return {plain, done, batch};
  });
  check('1 沒分批＝主線一筆（行為不變）',
    r1.plain.length===1 && r1.plain[0].batch===false && r1.plain[0].date===ymd(5) && r1.plain[0].done===false, JSON.stringify(r1.plain));
  check('1b 主線填了實際出貨日 → 掛在實際那天並標 done',
    r1.done.length===1 && r1.done[0].date===ymd(0) && r1.done[0].done===true, JSON.stringify(r1.done));
  check('2 有分批＝三筆、依批次序號排好、主線那筆不再出現',
    r1.batch.length===3 && r1.batch.map(x=>x.seq).join(',')==='1,2,3' && r1.batch.every(x=>x.batch&&x.total===3), JSON.stringify(r1.batch.map(x=>[x.seq,x.date,x.done])));
  check('3 批次填了實際出貨日 → 掛在實際那天並標 done',
    r1.batch[1].date===ymd(5) && r1.batch[1].done===true && r1.batch[0].done===false, JSON.stringify(r1.batch.map(x=>[x.seq,x.date,x.done])));

  /* ---------- 月曆 ---------- */
  const r4=await p.evaluate(()=>{
    const Y=window.__Y;
    ORDERS_CACHE=[{no:'B-1', client:'滿枝枒｜華山', typeKey:'bottle', total:1, quoteDate:'2026-09-01', src:'std',
                   st:{status:'deposit', ship_date_est:Y.d40}}];
    CAL_ITEMS=[];
    CAL_KINDS={order:true,memo:true,recur:true};
    const on=d=>eventsOn(d).map(e=>e.txt);
    return { dm3:on(Y.dm3), d5:on(Y.d5), d40:on(Y.d40), d20:on(Y.d20) };
  });
  check('4 三批各自出現在自己那一天、帶「第N批/共M批」',
    r4.dm3.some(t=>/第1批\/共3批/.test(t)) && r4.d5.some(t=>/第2批\/共3批/.test(t)) && r4.d40.some(t=>/第3批\/共3批/.test(t)),
    JSON.stringify(r4));
  check('5 主線預計出貨日那天只剩第3批那一顆（沒有多一顆沒標批次的）',
    r4.d40.filter(t=>/出貨/.test(t)).length===1, JSON.stringify(r4.d40));
  check('6 已出貨的第2批標 ✓、未出貨的第1批不標',
    r4.d5.some(t=>/第2批\/共3批.*✓/.test(t)) && !r4.dm3.some(t=>/✓/.test(t)), JSON.stringify({d5:r4.d5, dm3:r4.dm3}));
  check('6b 第2批已出貨 → 它的預計日那天不再出現',
    !r4.d20.some(t=>/出貨/.test(t)), JSON.stringify(r4.d20));

  /* ---------- 今日焦點 ---------- */
  const r7=await p.evaluate(()=>{
    renderTodayFocus();
    const html=document.getElementById('cal-focus').innerHTML;
    return { html,
      b1:/第1批\/共3批/.test(html), b3:/第3批\/共3批/.test(html),
      overdue:/出貨逾期 3 天/.test(html),
      plainRow:/🚚 [^<]*滿枝枒 出貨（B-1）/.test(html),
      boxCall:/calFocusShipBatch\(this\.dataset\.sid,this\.dataset\.no\)/.test(html),
      sid:/data-sid="S1"/.test(html) };
  });
  check('7 逾期的第1批列在今日焦點、帶批次標籤與逾期天數', r7.b1 && r7.overdue, r7.html.slice(0,260));
  check('7b 40 天後的第3批不列（超出 7 天內的範圍）', !r7.b3, String(r7.b3));
  check('8 有分批時不再列主線那一行', !r7.plainRow, String(r7.plainRow));
  check('9 批次打勾圈圈呼叫 calFocusShipBatch(批次id, 單號)', r7.boxCall && r7.sid, JSON.stringify({boxCall:r7.boxCall, sid:r7.sid}));

  const r10=await p.evaluate(async()=>{
    if(typeof calFocusShipBatch!=='function') return {missing:true, actual:'', focus:''};
    await calFocusShipBatch('S1','B-1');
    const s=(SHP_ALL||[]).find(x=>x.id==='S1');
    return { actual:s&&s.ship_date_actual, focus:document.getElementById('cal-focus').innerHTML };
  });
  const upd=posted.filter(b=>b.action==='updateShipment');
  check('10 送出 updateShipment（帶批次 id 與今天的實際出貨日）',
    upd.length===1 && upd[0].id==='S1' && upd[0].fields && upd[0].fields.ship_date_actual===ymd(0), JSON.stringify(upd));
  check('10b 畫面即刻更新：那一批不再出現在今日焦點',
    r10.actual===ymd(0) && !/第1批\/共3批/.test(r10.focus), JSON.stringify({actual:r10.actual}));

  /* ---------- 今日待辦 ---------- */
  const r11=await p.evaluate(()=>{
    const Y=window.__Y;
    if(typeof tdShipDueRows!=='function') return {missing:true, rows:[], untouched:[]};
    SHP_ALL=[
      {id:'S1', quote_no:'B-1', seq:1, ship_date_est:Y.dm3, ship_date_actual:''},        // 逾期 3 天、還沒出
      {id:'S2', quote_no:'B-1', seq:2, ship_date_est:Y.d20, ship_date_actual:''},        // 還沒到期
      {id:'S9', quote_no:'C-9', seq:1, ship_date_est:Y.d0,  ship_date_actual:''},        // 今天、但後端沒送來
      {id:'S8', quote_no:'D-8', seq:1, ship_date_est:Y.dm3, ship_date_actual:Y.dm3}      // 已經出貨了
    ];
    ORDERS_CACHE=[{no:'C-9', client:'囍酒工藝｜台北'},{no:'B-1', client:'滿枝枒｜華山'},{no:'D-8', client:'好野吧'}];
    const back=[{quote_no:'B-1', client:'滿枝枒', plan_ship_date:Y.d40, overdue_days:0, urgent:true},
                {quote_no:'Z-0', client:'沒分批的單', plan_ship_date:Y.d0, overdue_days:0, urgent:true},
                {quote_no:'D-8', client:'好野吧', plan_ship_date:Y.dm3, overdue_days:3, urgent:true}];
    const rows=tdShipDueRows(back);
    SHP_ALL=[];
    const untouched=tdShipDueRows(back);
    return {rows, untouched};
  });
  const rows=r11.rows;
  check('11 有分批的單換成「該出而還沒出的那幾批」（未到期的第2批不列）',
    rows.filter(r=>r.quote_no==='B-1').length===1 && rows.find(r=>r.quote_no==='B-1').batch_label==='（第1批/共2批）'
    && rows.find(r=>r.quote_no==='B-1').overdue_days===3, JSON.stringify(rows));
  check('11b 已經出貨的批次不再催（D-8 從清單消失）', !rows.some(r=>r.quote_no==='D-8'), JSON.stringify(rows.map(r=>r.quote_no)));
  check('11c 沒有分批的單原樣保留', rows.some(r=>r.quote_no==='Z-0'&&!r.batch_label), JSON.stringify(rows.map(r=>[r.quote_no,r.batch_label||''])));
  check('12 主線還沒到期、但某一批到期的單會被補進來（含客戶名）',
    rows.some(r=>r.quote_no==='C-9'&&r.client==='囍酒工藝'&&r.batch_label==='（第1批/共1批）'), JSON.stringify(rows));
  check('13 沒有任何分批資料時，後端給什麼就顯示什麼（行為不變）',
    JSON.stringify(r11.untouched)===JSON.stringify([{quote_no:'B-1', client:'滿枝枒', plan_ship_date:ymd(40), overdue_days:0, urgent:true},
      {quote_no:'Z-0', client:'沒分批的單', plan_ship_date:ymd(0), overdue_days:0, urgent:true},
      {quote_no:'D-8', client:'好野吧', plan_ship_date:ymd(-3), overdue_days:3, urgent:true}]), JSON.stringify(r11.untouched));

  const r14=await p.evaluate(()=>{
    const Y=window.__Y;
    SHP_ALL=[{id:'S1', quote_no:'B-1', seq:1, ship_date_est:Y.dm3, ship_date_actual:''},
             {id:'S2', quote_no:'B-1', seq:2, ship_date_est:Y.d20, ship_date_actual:''}];
    ORDERS_CACHE=[{no:'B-1', client:'滿枝枒｜華山'}];
    gotoPage('today');
    TD_DATA={ ship_due:[{quote_no:'B-1', client:'滿枝枒', plan_ship_date:Y.d40, overdue_days:0, urgent:true}],
              final_due:[], no_scan:[], no_invoice:[], calendar:[] };
    renderToday();
    return document.getElementById('td-body').innerText;
  });
  check('14 今日待辦畫面上真的看得到批次標籤', /第1批\/共2批/.test(r14) && !/第2批/.test(r14), r14.replace(/\n/g,' | ').slice(0,220));

  await browser.close();
  results.forEach(x=>console.log(x[0], x[1], x[2]?'   → '+x[2]:''));
  console.log(errors.length?('JS ERRORS: '+errors.join(' | ')):'NO JS ERRORS');
  const f=results.filter(x=>x[0]==='FAIL').length;
  console.log(f?`${f} FAIL`:`ALL ${results.length} PASS`);
})();
