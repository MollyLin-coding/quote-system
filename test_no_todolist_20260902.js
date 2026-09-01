/* 2026-09-02 Molly：工作行事曆的「待辦清單（不指定日期）」拿掉。
   1 行事曆頁沒有 #cal-todos 卡片、畫面上沒有「待辦清單」字樣
   2 新增事項的「類型」下拉只剩 備忘／重複行程，沒有「☑ 待辦」
   3 就算 CAL_ITEMS 裡有舊的 todo 資料，畫面也不會壞、也不會顯示
   4 今日焦點的「打勾＝完成」（calFocusDone → toggleTodoDone）仍在，沒被連坐拿掉 */
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const results=[]; const check=(n,c,x)=>results.push([c?'PASS':'FAIL',n,x||'']);

(async()=>{
  const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const errors=[];
  const p=await browser.newPage();
  p.on('pageerror',e=>errors.push('PAGEERROR: '+e.message));
  await p.route('**/script.google.com/**', async route=>{
    let b={}; try{ b=JSON.parse(route.request().postData()||'{}'); }catch(e){}
    let r;
    if(b.action==='login') r={ok:true, token:'t', role:'owner', name:'Molly'};
    else if(b.action==='getLoginUsers') r={ok:true, users:['Molly']};
    else if(b.action==='batch') r={ok:true, results:(b.calls||[]).map(()=>({ok:true,quotes:[],orders:[],records:[],summary:{},shipments:[],customers:[],moves:[],items:[]}))};
    else r={ok:true, quotes:[], orders:[], records:[], items:[], shipments:[], summary:{}, customers:[], moves:[]};
    await route.fulfill({status:200, headers:{'Access-Control-Allow-Origin':'*'}, contentType:'application/json', body:JSON.stringify(r)});
  });
  await p.goto('http://localhost:8899/index.html');
  await p.waitForFunction(()=>{const e=document.getElementById('login-user');return e&&!/載入中/.test(e.textContent||'');},{timeout:15000}).catch(()=>{});
  await p.waitForTimeout(300);
  await p.evaluate(async()=>{ window.confirm=()=>true; window.alert=()=>{}; document.getElementById('login-pin').value='1'; await doLogin(); });
  await p.waitForTimeout(400);

  const r=await p.evaluate(async()=>{
    gotoPage('cal');
    await new Promise(r=>setTimeout(r,800));   // 等頁面自己那趟 loadCalendar 回來（mock 回空陣列），再塞測試資料
    CAL_ITEMS=[
      {item_id:'T1', kind:'todo', title:'舊的待辦資料', done:'N', priority:'high', category:'會議', all_day:'Y'},
      {item_id:'M1', kind:'memo', title:'今天的備忘', date:fmtD(new Date()), done:'N', category:'會議', all_day:'Y'}
    ];
    renderCalendar();
    const pg=document.getElementById('page-cal');
    const kinds=Array.from(document.querySelectorAll('#ce-kind option')).map(o=>o.value);
    return {
      noCard: !document.getElementById('cal-todos'),
      noTitle: !/待辦清單/.test(pg.innerText||''),
      pageShown: pg && pg.offsetParent!==null,
      noOldTodo: !/舊的待辦資料/.test(pg.innerText||''),
      memoShown: /今天的備忘/.test(pg.innerText||''),
      kinds,
      noRender: typeof renderTodoList==='undefined',
      focusDoneKept: typeof calFocusDone==='function' && typeof toggleTodoDone==='function'
    };
  });
  check('1 行事曆頁沒有待辦清單卡片', r.noCard && r.noTitle, JSON.stringify(r));
  check('2 類型下拉沒有「待辦」', Array.isArray(r.kinds) && r.kinds.length===2 && !r.kinds.includes('todo') && r.kinds.includes('memo') && r.kinds.includes('recur'), JSON.stringify(r.kinds));
  check('3 舊的 todo 資料不顯示、備忘照常顯示、畫面不壞', r.pageShown && r.noOldTodo && r.memoShown, JSON.stringify(r));
  check('3b renderTodoList 已移除', r.noRender, JSON.stringify(r));
  check('4 今日焦點打勾完成仍在', r.focusDoneKept, JSON.stringify(r));

  await browser.close();
  results.forEach(x=>console.log(x[0], x[1], x[2]?'   → '+x[2]:''));
  console.log(errors.length?('JS ERRORS: '+errors.join(' | ')):'NO JS ERRORS');
  const f=results.filter(x=>x[0]==='FAIL').length;
  console.log(f?`${f} FAIL`:`ALL ${results.length} PASS`);
})();
