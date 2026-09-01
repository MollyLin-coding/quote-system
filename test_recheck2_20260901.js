/* 2026-09-01 複檢第二批的離線驗證（對應報告 #7 #8 #10 #11 #13 #15 #16）。 */
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const results=[]; const check=(n,c,x)=>results.push([c?'PASS':'FAIL',n,x||'']);

(async()=>{
  const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const errors=[]; let KEY_FAIL=true; let STORAGE=[]; const DELETED=[];
  const mk=async(role)=>{
    const p=await browser.newPage();
    p.on('pageerror',e=>errors.push('PAGEERROR: '+e.message));
    await p.route('**/script.google.com/**', async route=>{
      let b={}; try{ b=JSON.parse(route.request().postData()||'{}'); }catch(e){}
      let r;
      if(b.action==='login') r={ok:true, token:'tok-1', role:role||'owner', name:role==='general'?'阿軒':'Molly'};
      else if(b.action==='getLoginUsers') r={ok:true, users:['Molly','阿軒']};
      else if(b.action==='getVerifyKey') r=KEY_FAIL?{ok:false,error:'timeout'}:{ok:true,k:'KEY123'};
      else if(b.action==='getStorageData') r={ok:true, moves:STORAGE};
      else if(b.action==='deleteStorageMove'){ DELETED.push(b.move_id); STORAGE=STORAGE.filter(m=>m.move_id!==b.move_id); r={ok:true}; }
      else if(b.action==='batch') r={ok:true, results:(b.calls||[]).map(()=>({ok:true,quotes:[],orders:[],records:[],summary:{},shipments:[],customers:[],moves:[]}))};
      else r={ok:true, quotes:[], orders:[], records:[], items:[], shipments:[], summary:{}, customers:[], moves:[]};
      await route.fulfill({status:200, headers:{'Access-Control-Allow-Origin':'*'}, contentType:'application/json', body:JSON.stringify(r)});
    });
    await p.goto('http://localhost:8899/index.html');
    await p.waitForTimeout(900);
    await p.evaluate(async()=>{ document.getElementById('login-pin').value='123456'; await doLogin(); });
    await p.waitForTimeout(500);
    return p;
  };

  /* ---- #16 QR 驗證碼抓失敗要能重試 ---- */
  const p1=await mk();
  const r16=await p1.evaluate(async()=>{
    const a=await vfKeyFor('20260901-01');          // 這次後端回失敗
    const cachedAfterFail=Object.prototype.hasOwnProperty.call(VF_KEYS,'20260901-01');
    return {a, cachedAfterFail};
  });
  check('#16 抓失敗不會被記進快取（下次會重抓）', r16.a==='' && r16.cachedAfterFail===false, JSON.stringify(r16));
  KEY_FAIL=false;
  const r16b=await p1.evaluate(async()=>({ b:await vfKeyFor('20260901-01'), ready:vfKeyReady('20260901-01') }));
  check('#16 網路恢復後再按一次就拿得到驗證碼', r16b.b==='KEY123' && r16b.ready===true, JSON.stringify(r16b));

  /* ---- #15 驗收管理：VM_DATA 被清掉不會當掉 ---- */
  const p2=await mk();
  const r15=await p2.evaluate(()=>{
    VM_DATA=null;
    let threw=false;
    try{ openVmProc('abc'); }catch(e){ threw=true; }
    return {threw};
  });
  check('#15 VM_DATA 被清空時按「處理」不會當掉（會提示重新載入）', r15.threw===false, JSON.stringify(r15));

  /* ---- #11 員工的今日待辦列：內容留著、只拿掉點擊 ---- */
  const p3=await mk('general');
  const r11=await p3.evaluate(()=>{
    const box=document.createElement('div');
    box.innerHTML='<button type="button" class="td-row" onclick="tdOpenOrder(\'T-1\')">酒旺商行 逾期 3 天</button>'
                + '<button type="button" class="btn" onclick="openOrdEdit(\'T-1\')">編輯進度</button>';
    document.body.appendChild(box);
    roleSweep();
    const row=box.querySelector('.td-row'), btn=box.querySelector('.btn');
    return { rowVisible:getComputedStyle(row).display!=='none', rowHasClick:!!row.getAttribute('onclick'),
             rowText:row.textContent.trim(), btnHidden:getComputedStyle(btn).display==='none', isOwner:isOwner() };
  });
  check('#11 員工看得到今日待辦每一列的內容', r11.isOwner===false && r11.rowVisible===true && r11.rowText.includes('酒旺商行'), JSON.stringify(r11));
  check('#11 那一列不再可點（不會開到老闆專用視窗）', r11.rowHasClick===false);
  check('#11 真正的老闆專用按鈕仍然藏起來', r11.btnHidden===true);

  /* ---- #13 權限名單與第二道防線 ---- */
  const r13=await p3.evaluate(()=>{
    const inList=n=>OWNER_ONLY_FNS.indexOf(n)>=0;
    // 藏起來的鈕會不會被後續程式碼重新顯示
    const del=document.getElementById('ce-del');
    del.style.display='none';
    CAL_EDIT_ID='x';
    const guarded = (typeof needOwner==='function') && (needOwner('測試')===false);
    return { stDel:inList('stDeleteMove'), calShip:inList('calFocusShip'), calDone:inList('calFocusDone'), guarded };
  });
  check('#13 stDeleteMove／calFocusShip／calFocusDone 都已列入老闆專用', r13.stDel&&r13.calShip&&r13.calDone, JSON.stringify(r13));
  check('#13 needOwner() 對一般使用者會回 false（第二道防線已可用）', r13.guarded===true);

  const r13b=await p3.evaluate(async()=>{
    let called=false; const orig=window.apiCall;
    window.apiCall=async()=>{ called=true; return {ok:true}; };
    try{ await stDeleteMove('M-1'); }catch(e){}
    try{ await deleteRecord('T-1','客戶'); }catch(e){}
    window.apiCall=orig;
    return {called};
  });
  check('#13 員工按刪除時，前端就擋下來不會打後端', r13b.called===false, JSON.stringify(r13b));

  /* ---- #10 寄售驗收單：預覽不可以動到原始資料 ---- */
  const p4=await mk();
  const r10=await p4.evaluate(()=>{
    CONSIGN_VF_DATA={ no:'CS-TEST-1', client:'日光貳叁', shipDate:'2026-09-01', handler:'', note:'',
      rows:[{name:'A酒',vol:'500',qty:'6'},{name:'',vol:'',qty:''},{name:'C酒',vol:'700',qty:'12'}] };
    const before=CONSIGN_VF_DATA.rows.length;
    const collected=csVfCollect();                    // 相當於按了「預覽」
    const after=CONSIGN_VF_DATA.rows.length;
    // 預覽之後才回頭填第二列（畫面上的 data-i 仍然是 1）
    CONSIGN_VF_DATA.rows[1]={name:'桂花釀',vol:'500',qty:'24'};
    const final=csVfCollect();
    return { before, after, collectedRows:collected.rows.length,
             names:final.rows.map(r=>r.name).join('/') };
  });
  check('#10 按過預覽之後，原始資料的列數與順序不變', r10.before===3 && r10.after===3, JSON.stringify(r10));
  check('#10 之後補填的內容不會蓋掉別款酒', r10.names==='A酒/桂花釀/C酒', 'names='+r10.names);

  /* ---- #7 寄倉：同一支酒不分兩本帳 + 方向預設看這張單的酒款 ---- */
  const p5=await mk();
  const r7=await p5.evaluate(()=>{
    // 驗收單自動登記（沒有 sku_id）先入倉 100 瓶；手動選公版酒（有 sku_id）想提領 30 瓶
    ST_MOVES=[{move_id:'M1',customer:'南野子',sku_id:'',name:'梔子花琴酒',volume:'500ml',direction:'in',qty:100},
              {move_id:'M2',customer:'南野子',sku_id:'SKU-1',name:'梔子花琴酒',volume:'500',direction:'out',qty:20}];
    const balBySku=stBalanceFor('南野子','SKU-1','梔子花琴酒','500');
    const balByName=stBalanceFor('南野子','','梔子花琴酒','500ml');
    const rows=stSummary('南野子');
    // 這張驗收單只有另一支酒 → 預設應該是「入倉」
    const balOther=stBalanceForRows('南野子',[{name:'白玉伏特加',vol:'700'}]);
    const balSame=stBalanceForRows('南野子',[{name:'梔子花琴酒',vol:'500'}]);
    return { balBySku, balByName, rowCount:rows.length, balOther, balSame };
  });
  check('#7 同一支酒的自動登記與手動登記併成一本帳（100−20=80）', r7.balBySku===80 && r7.balByName===80, JSON.stringify(r7));
  check('#7 彙總表同一支酒只出現一列', r7.rowCount===1, 'rows='+r7.rowCount);
  check('#7 方向預設只看這張驗收單上的酒款（別支酒有貨不影響）', r7.balOther===0 && r7.balSame===80, JSON.stringify(r7));

  /* ---- #8 重印時會先刪掉舊的寄倉紀錄再重寫 ---- */
  const p6=await mk();
  STORAGE=[{move_id:'M-OLD-1', src:'VF:20260901-01:1:A酒:500ml', customer:'南野子', name:'A酒', volume:'500ml', direction:'in', qty:100},
           {move_id:'M-OTHER', src:'VF:20260901-01:2:A酒:500ml', customer:'南野子', name:'A酒', volume:'500ml', direction:'in', qty:5}];
  const r8=await p6.evaluate(async()=>{
    const n=await stRemoveMovesBySrc('20260901-01', 1);
    return {n};
  });
  check('#8 重印前只刪掉「同一張單同一次出貨」的舊紀錄', r8.n===1 && DELETED.length===1 && DELETED[0]==='M-OLD-1', JSON.stringify({r8, DELETED}));

  results.forEach(r=>console.log(r[0], r[1], r[2]?('  → '+r[2]):''));
  const fails=results.filter(r=>r[0]==='FAIL').length;
  console.log(errors.length?('JS ERRORS: '+errors.slice(0,4).join(' | ')):'NO JS ERRORS');
  console.log(fails?(fails+' FAIL / '+results.length):('ALL '+results.length+' PASS'));
  await browser.close();
})();
