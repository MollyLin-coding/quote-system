/* 2026-09-01 複檢第一批修正的離線驗證。
   每一項都對應複檢報告裡的編號，而且都是「修好之前會 FAIL」的測法。 */
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const results=[]; const check=(n,c,x)=>results.push([c?'PASS':'FAIL',n,x||'']);

const COMPANY={ ok:true,
  companies:[
    {company_id:'C1', name:'甲酒商股份有限公司', brand:'甲酒商', tax_id:'11111111',
     default_pay_terms:'甲：出貨後 30 天付款'},
    {company_id:'C2', name:'乙酒商股份有限公司', brand:'乙酒商', tax_id:'22222222',
     default_pay_terms:'乙：月結 60 天'},
    {company_id:'C3', name:'丙酒商股份有限公司', brand:'丙酒商', tax_id:'33333333'}
  ],
  products:[{product_id:'P1', company_id:'C1', name:'A酒', spec:'500', unit_price:500, moq:12,
             tier_json:'[{"min":1,"max":99,"price":500},{"min":100,"price":400}]'}],
  rules:[] };

(async()=>{
  const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const errors=[];
  const mk=async()=>{
    const p=await browser.newPage();
    p.on('pageerror',e=>errors.push('PAGEERROR: '+e.message));
    p.on('console',m=>{ if(m.type()==='error' && !/Failed to load resource|favicon/i.test(m.text())) errors.push('CONSOLE: '+m.text()); });
    await p.route('**/script.google.com/**', async route=>{
      let b={}; try{ b=JSON.parse(route.request().postData()||'{}'); }catch(e){}
      let r;
      if(b.action==='login') r={ok:true, token:'tok-1', role:'owner', name:'Molly'};
      else if(b.action==='getCompanyData') r=COMPANY;
      else if(b.action==='getLoginUsers') r={ok:true, users:['Molly']};
      else if(b.action==='getVerifyKey') r={ok:true, k:'abc'};
      else if(b.action==='batch') r={ok:true, results:(b.calls||[]).map(()=>({ok:true,quotes:[],orders:[],records:[],summary:{},shipments:[],customers:[]}))};
      else r={ok:true, quotes:[], orders:[], records:[], items:[], shipments:[], summary:{}, customers:[]};
      await route.fulfill({status:200, headers:{'Access-Control-Allow-Origin':'*'}, contentType:'application/json', body:JSON.stringify(r)});
    });
    await p.goto('http://localhost:8899/index.html');
    await p.waitForTimeout(1000);
    await p.evaluate(async()=>{ document.getElementById('login-pin').value='123456'; await doLogin(); });
    await p.waitForTimeout(600);
    return p;
  };

  /* ---- #1 存過單之後，公司報價檔要能自己補回來 ---- */
  const p1=await mk();
  await p1.evaluate(async()=>{ gotoPage('new'); setType('bottle');
    try{ await apiCall({action:'deleteQuote', token:AUTH_TOKEN, quoteNo:'X-1'}); }catch(e){} });
  await p1.waitForTimeout(200);
  const r1a=await p1.evaluate(()=>!!COMPANY_DATA);
  check('#1 寫入後 COMPANY_DATA 確實被清掉（前提成立）', r1a===false, 'COMPANY_DATA='+r1a);
  await p1.evaluate(()=>{ document.getElementById('qf-company').value='C1'; onSelectCompany(true); });
  await p1.waitForTimeout(700);
  const r1=await p1.evaluate(()=>({ detail:getComputedStyle(document.getElementById('qf-detail')).display,
    prodOpts:document.getElementById('qf-product').options.length, sel:!!SELECTED_COMPANY, data:!!COMPANY_DATA }));
  check('#1 存過單之後再選公司，帶入區照常展開、酒款下拉有品項', r1.detail!=='none'&&r1.prodOpts>1&&r1.sel&&r1.data, JSON.stringify(r1));

  const r1b=await p1.evaluate(async()=>{ gotoPage('today'); COMPANY_DATA=null; gotoPage('new'); await new Promise(r=>setTimeout(r,600)); return !!COMPANY_DATA; });
  check('#1 進報價單頁時會自動補載公司報價檔', r1b===true, 'COMPANY_DATA='+r1b);

  /* ---- #2 純讀取不再清快取 ---- */
  const p2=await mk();
  const r2=await p2.evaluate(async()=>{
    await readCall({action:'getQuotes', token:AUTH_TOKEN, filters:{}});
    const before=Object.keys(RC_STORE).length, gen=RC_GEN, co=!!COMPANY_DATA;
    await apiCall({action:'getVerifyKey', token:AUTH_TOKEN, no:'20260901-01'});
    await apiCall({action:'calendarSelfCheck', token:AUTH_TOKEN});
    return {before, after:Object.keys(RC_STORE).length, gen, gen2:RC_GEN, co, co2:!!COMPANY_DATA};
  });
  check('#2 getVerifyKey／calendarSelfCheck 不再清掉快取與公司報價檔',
        r2.after===r2.before && r2.gen2===r2.gen && r2.co2===r2.co, JSON.stringify(r2));

  /* ---- #3 贈品欄收起來，總計與勾選都不變 ---- */
  const p3=await mk();
  const r3=await p3.evaluate(()=>{
    gotoPage('new'); setType('bottle');
    if(!colGift) toggleCol('gift');
    document.querySelectorAll('#itbody-bot .itr').forEach(r=>r.remove()); botItems=[];
    addBotRow({name:'招待酒', vol:'500', price:'1000', qty:'10', gift:1});
    calc(); const t1=document.getElementById('t-tot').textContent;
    toggleCol('gift'); calc(); const t2=document.getElementById('t-tot').textContent;
    const saved=collectQuote();
    toggleCol('gift'); calc(); const t3=document.getElementById('t-tot').textContent;
    const g=document.querySelector('#itbody-bot .itr [data-f="gift"]');
    return {t1,t2,t3, stillGift:!!(g&&g.checked), savedNoCharge:(saved.items.find(i=>i.itemType==='bottle')||{}).noCharge};
  });
  check('#3 收起贈品欄後總計不變（$0）', r3.t1===r3.t2 && r3.t2===r3.t3, JSON.stringify(r3));
  check('#3 再打開贈品欄，勾選還在', r3.stillGift===true);
  check('#3 欄位收起來時存檔，贈品仍存成不計價', r3.savedNoCharge==='Y', 'noCharge='+r3.savedNoCharge);

  /* ---- #4 宴會自訂品項手動小計 0 ---- */
  const p4=await mk();
  const r4=await p4.evaluate(()=>{
    gotoPage('new'); setType('banquet');
    const q={ items:[{itemType:'banquet_free', name:'招待酒水', unitPrice:500, qty:10,
                      subtotal:0, deduction:0, noCharge:'N', unit:'份', flavorList:''}] };
    banFreeItems.slice().forEach(id=>{ const el=document.getElementById(`bf-${id}`); if(el) el.remove(); });
    banFreeItems=[];
    q.items.forEach(it=>{
      const free=String(it.noCharge||'').toUpperCase()==='Y';
      const disp=free?(parseFloat(it.deduction)||0):(parseFloat(it.subtotal)||0);
      const auto=Math.round((parseFloat(it.unitPrice)||0)*(parseFloat(it.qty)||0));
      const _hasVal = free ? (it.deduction!=null && String(it.deduction).trim()!=='')
                           : (it.subtotal!=null && String(it.subtotal).trim()!=='');
      const manual=_hasVal && Math.round(disp)!==auto;
      addBanFreeRow({name:it.name, qty:it.qty, unit:it.unit, price:it.unitPrice,
        note:it.flavorList||'', free, manual, subval:(manual?Math.round(disp):'')});
    });
    calcBan(); calc();
    const row=document.getElementById(`bf-${banFreeItems[0]}`);
    const mchk=row.querySelector('[data-f="manual"]');
    return { manualChecked:!!(mchk&&mchk.checked), sub:row.querySelector('[data-f="subval"]')?row.querySelector('[data-f="subval"]').value:"(none)" };
  });
  check('#4 手動小計填 0 的宴會列，重開後仍是「手動小計 0」', r4.manualChecked===true && String(r4.sub)==='0', JSON.stringify(r4));

  /* ---- #5 切換單別後級距價連結還在 ---- */
  const p5=await mk();
  const r5=await p5.evaluate(()=>{
    gotoPage('new'); setType('bottle');
    document.getElementById('qf-company').value='C1'; onSelectCompany(true);
    document.querySelectorAll('#itbody-bot .itr').forEach(r=>r.remove()); botItems=[];
    document.getElementById('qf-product').value='P1'; quickAddProduct();
    setType('ownlabel'); setType('bottle');
    const row=document.querySelector('#itbody-bot .itr');
    const pid=row?row.dataset.pid:'';
    const qi=row.querySelector('[data-f="qty"]'); qi.value='100'; calc();
    return { pid, price:row.querySelector('[data-f="price"]').value };
  });
  check('#5 切換單別後仍保有報價檔連結，100 瓶自動換到級距價 400', r5.pid==='P1' && r5.price==='400', JSON.stringify(r5));

  /* ---- #6 換公司要換付款條款 ---- */
  const p6=await mk();
  const r6=await p6.evaluate(()=>{
    gotoPage('new'); setType('bottle');
    const t=()=>document.getElementById('p3-txt').value.trim();
    document.getElementById('qf-company').value='C1'; onSelectCompany(true); const a=t();
    document.getElementById('qf-company').value='C2'; onSelectCompany(true); const b=t();
    document.getElementById('qf-company').value='C3'; onSelectCompany(true); const c=t();
    // 使用者自己打的字不可以被覆蓋
    document.getElementById('p3-txt').value='我自己談的條件';
    document.getElementById('qf-company').value='C1'; onSelectCompany(true); const d=t();
    return {a,b,c,d};
  });
  check('#6 甲→乙 付款條款會跟著換', r6.a.indexOf('甲')===0 && r6.b.indexOf('乙')===0, JSON.stringify(r6));
  check('#6 換到沒設條款的公司，會清掉上一家的殘影', r6.c==='', 'c='+r6.c);
  check('#6 使用者自己打的條款不會被公司預設蓋掉', r6.d==='我自己談的條件', 'd='+r6.d);

  /* ---- #14 月報表匯出總計＝畫面總計 ---- */
  const p7=await mk();
  const r7=await p7.evaluate(()=>{
    const o={ no:'T-1', type:'bottle', client:'測試客戶', quoteDate:'2026-09-01', total:10000,
              st:{ status:'shipped', grand_total:12345 } };
    return { screen:ordGrandTotal(o), raw:Math.round(o.total) };
  });
  check('#14 ordGrandTotal 會用訂單追蹤的成交金額（匯出已改用同一支）', r7.screen===12345 && r7.raw===10000, JSON.stringify(r7));

  /* ---- #21 / #19 / #18 介面 ---- */
  const p8=await mk();
  const r8=await p8.evaluate(()=>({
    kkbar: !!Array.from(document.querySelectorAll('button')).find(b=>/KKBar 範例/.test(b.textContent)),
    ids: ['vmp-save','vmm-save','cs-cus-save','cs-mv-save','c-save-backend','st-f-save','ce-del']
           .filter(id=>!document.getElementById(id)),
    fgm2: document.querySelectorAll('.fgm2').length,
    hasBtnBusy: typeof btnBusy==='function'
  }));
  check('#19 「載入 KKBar 範例」按鈕已移除', r8.kkbar===false);
  check('#21 七顆按鈕都有 id 可顯示「儲存中…」', r8.ids.length===0, '缺:'+r8.ids.join(','));
  check('#18 四個彈窗改用可 RWD 的 .fgm2', r8.fgm2===4, 'count='+r8.fgm2);
  check('#21 btnBusy 共用函式存在', r8.hasBtnBusy===true);

  const r9=await p8.evaluate(()=>{
    const b=document.getElementById('st-f-save'); const before=b.innerHTML;
    btnBusy('st-f-save', true, '登記中…'); const busy={html:b.innerHTML, dis:b.disabled};
    btnBusy('st-f-save', false); return {before, busy, after:b.innerHTML, dis2:b.disabled};
  });
  check('#21 btnBusy 會變灰＋改字，做完會還原', r9.busy.dis===true && /登記中/.test(r9.busy.html) && r9.after===r9.before && r9.dis2===false, JSON.stringify(r9));

  results.forEach(r=>console.log(r[0], r[1], r[2]?('  → '+r[2]):''));
  const fails=results.filter(r=>r[0]==='FAIL').length;
  console.log(errors.length?('JS ERRORS: '+errors.slice(0,4).join(' | ')):'NO JS ERRORS');
  console.log(fails? (fails+' FAIL / '+results.length) : ('ALL '+results.length+' PASS'));
  await browser.close();
})();
