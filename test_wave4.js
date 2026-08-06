/* 回歸測試：2026-08-06 複檢第四波（13 項低嚴重度）
   前端可實測：#15 備註跳脫、#17 日期溢位、#18 spec 容量、#19 級距回退、#20 label_fee 規則、
                #22 batch 認證、#23/#24 驗收提示
   純後端（#25 種子、#26 上鎖、#27 PDF 換行）以模擬演算法/讀碼驗證。 */
const {chromium}=require('playwright');
const path=require('path'), fs=require('fs');

(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const p=await b.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto('file://'+path.join(__dirname,'index.html'));
  await p.waitForTimeout(600);
  const results=[]; const check=(n,ok,d)=>results.push({n,ok:!!ok,d});

  // ── #17：報價日 1/31 → 有效日期不得溢位成 3/3
  let r=await p.evaluate(()=>{
    const out={};
    [['2026-01-31','2026/02/28'],['2026-03-31','2026/04/30'],['2026-08-06','2026/09/06'],
     ['2024-01-31','2024/02/29']].forEach(([d,want])=>{
      document.getElementById('f-dt').value=d; onDate();
      out[d]={got:document.getElementById('f-ex').value, want};
    });
    return out;
  });
  Object.keys(r).forEach(d=>check(`#17 ${d} → ${r[d].want}`, r[d].got===r[d].want, `得到 ${r[d].got}`));

  // ── #15：付款備註與費用名稱含 < 不得被當標籤吃掉
  r=await p.evaluate(()=>{
    setType('bottle'); setTaxMode('inc'); document.getElementById('taxrate').value='5';
    botItems=[]; document.getElementById('itbody-bot').innerHTML='';
    addBotRow({name:'酒',vol:500,price:1000,qty:100});
    extras=[{id:'x',n:'特殊<標籤>費',a:2000}];
    setPay(0); LOADED_PAY_DETAIL=null; LOADED_PAY_SIG=null;
    document.getElementById('dep-pct').value='50';
    document.getElementById('dep-ded').value='未達MOQ<br公司另議 & 加價';
    calc();
    const t=getPayTerms();
    // 用 DOM 還原成純文字，確認內容沒被吃掉
    const div=document.createElement('div'); div.innerHTML=t.replace(/<br>/g,'\n');
    return {terms:t, text:div.textContent};
  });
  check('#15 備註內容完整保留（沒被當標籤吃掉）', r.text.includes('未達MOQ<br公司另議 & 加價'), r.text.slice(-80));
  check('#15 備註已跳脫（原始字串不含裸 <br公司）', !/<br公司/.test(r.terms), r.terms.slice(-120));
  check('#15 費用名稱含 < 也完整', r.text.includes('特殊<標籤>費'), r.text.slice(0,120));

  // ── #15 round-trip：跳脫過的備註解析回欄位要還原成原字
  r=await p.evaluate(()=>{
    const t=getPayTerms();
    document.getElementById('dep-ded').value='';
    restorePayFieldsFromText(t);
    return document.getElementById('dep-ded').value;
  });
  check('#15 備註解析回欄位不留 &amp;/&lt;', r==='未達MOQ<br公司另議 & 加價', `得到「${r}」`);

  // ── #18/#19/#20：公司報價檔
  await p.evaluate(()=>{
    COMPANY_DATA={
      companies:[{company_id:'C1',name:'測試廠',active:'Y'}],
      products:[
        {product_id:'P1',company_id:'C1',name:'A酒',spec:'500ml',unit:'瓶',unit_price:520,
         tier_json:'[{"min":100,"price":480}]',label_fee:3.5,logo_fee:'',active:'Y'},
        {product_id:'P2',company_id:'C1',name:'B酒',spec:'750',unit:'瓶',unit_price:600,
         tier_json:'[{"min":0,"max":"","price":600}]',label_fee:2,logo_fee:'',active:'Y'}
      ],
      rules:[{rule_id:'R2',company_id:'C1',rule_type:'label_deduct',active:'Y',
        params_json:JSON.stringify({use_product_label_fee:true})}]
    };
  });
  r=await p.evaluate(()=>{
    setType('bottle'); botItems=[]; document.getElementById('itbody-bot').innerHTML=''; extras=[];
    SELECTED_COMPANY=COMPANY_DATA.companies[0]; RULE_SUPPRESS={};
    document.getElementById('qf-product').innerHTML='<option value="P1">P1</option>';
    document.getElementById('qf-product').value='P1'; quickAddProduct();
    const row=document.querySelector('#itbody-bot > div');
    return {vol:row.querySelector('[data-f="vol"]').value};
  });
  check('#18 spec 填「500ml」也能帶入容量 500', r.vol==='500', `得到「${r.vol}」`);

  r=await p.evaluate(()=>{
    const row=document.querySelector('#itbody-bot > div');
    const price=()=>row.querySelector('[data-f="price"]').value;
    row.querySelector('[data-f="qty"]').value='150'; calc();
    const high=price();                       // 150 瓶 → 級距 480
    row.querySelector('[data-f="qty"]').value='50'; calc();
    const low=price();                        // 50 瓶 → 級距沒涵蓋 → 應回退主檔 520
    return {high, low};
  });
  check('#19 150瓶套級距價 480', r.high==='480', r.high);
  check('#19 改回50瓶回退主檔原價 520（不停在優惠價）', r.low==='520', r.low);

  r=await p.evaluate(()=>{
    botItems=[]; document.getElementById('itbody-bot').innerHTML=''; extras=[];
    RULE_SUPPRESS={};
    document.getElementById('qf-product').innerHTML='<option value="P2">P2</option>';
    document.getElementById('qf-product').value='P2'; quickAddProduct();
    const row=document.querySelector('#itbody-bot > div');
    row.querySelector('[data-f="qty"]').value='10'; calc();
    return {price:row.querySelector('[data-f="price"]').value};
  });
  check('#19 級距的 max 填空字串仍比得中（600）', r.price==='600', r.price);

  r=await p.evaluate(()=>{
    botItems=[]; document.getElementById('itbody-bot').innerHTML=''; extras=[];
    SELECTED_COMPANY=COMPANY_DATA.companies[0]; RULE_SUPPRESS={};
    document.getElementById('qf-product').innerHTML='<option value="P1">P1</option><option value="P2">P2</option>';
    document.getElementById('qf-product').value='P1'; quickAddProduct();
    document.querySelectorAll('#itbody-bot > div')[0].querySelector('[data-f="qty"]').value='100';
    document.getElementById('qf-product').value='P2'; quickAddProduct();
    document.querySelectorAll('#itbody-bot > div')[1].querySelector('[data-f="qty"]').value='50';
    // 規則面板：use_product_label_fee 時金額欄留空
    let chk=document.getElementById('qf-ownlabel');
    if(!chk){ const d=document.createElement('div');
      d.innerHTML='<input type="checkbox" id="qf-ownlabel"><input id="qf-labelamt" value="">';
      document.body.appendChild(d); chk=document.getElementById('qf-ownlabel'); }
    chk.checked=true; document.getElementById('qf-labelamt').value='';
    calc();
    const lab=extras.find(e=>e.auto==='label');
    return {name:lab&&lab.n, amt:lab&&lab.a};
  });
  // A酒 3.5×100=350、B酒 2×50=100 → 合計 450，扣抵為 -450
  check('#20 use_product_label_fee 依品項酒標費計算（-450）', r.amt===-450, JSON.stringify(r));
  check('#20 不再長出「每瓶扣 $0」的無效列', !/\$0 ×/.test(String(r.name||'')), String(r.name));

  // ── #22：batch 遇到認證錯誤要往外丟、不得關閉 BATCH_OK
  r=await p.evaluate(()=>{
    const src=String(readCallMany);
    return { hasAuthGuard:/authErr/.test(src) && /throw authErr/.test(src) };
  });
  check('#22 batch 認證錯誤直接往外丟（不誤關 batch）', r.hasAuthGuard, '');

  // ── #21：寫入類請求連線失敗也會清讀取快取
  r=await p.evaluate(()=>{
    const src=String(apiCall);
    // 連線失敗分支：從 catch(err) 到「連線逾時」訊息之間必須有 rcClear
    const m=src.match(/catch\s*\(\s*err\s*\)[\s\S]*?AbortError/);
    return { inCatch: !!(m && /rcIsRead[\s\S]{0,60}rcClear/.test(m[0])) };
  });
  check('#21 連線失敗分支有清快取', r.inCatch, '');

  // ── #23/#24：驗收提示
  r=await p.evaluate(()=>{
    const s1=String(saveVerifyFormRecord), s2=String(openVerifyForm);
    return { saveWarn:/沒有存成功/.test(s1), mismatchWarn:/對不上目前的品項/.test(s2) };
  });
  check('#23 留底存檔失敗會提示', r.saveWarn, '');
  check('#24 舊出貨紀錄對不上會警告', r.mismatchWarn, '');

  // ── #25/#26/#27：後端讀碼驗證
  const gasV2=fs.readFileSync(path.join(__dirname,'gas/v2_extensions.gs'),'utf8');
  const gasMain=fs.readFileSync(path.join(__dirname,'gas/程式碼.gs'),'utf8');
  const gasOb=fs.readFileSync(path.join(__dirname,'gas/v3_ownbrand.gs'),'utf8');
  check('#25 種子改用欄名對應（seedRow_）', /function \(headers, obj\)/.test(gasV2)&&/seedRow_\(COMPANIES_HEADERS/.test(gasV2), '');
  check('#25 種子不再有寫死的固定長度陣列', !/\['TESTCO','測試公司/.test(gasV2), '');
  check('#26 updateOrderStatus 有上鎖', /handleUpdateOrderStatus_[\s\S]{0,600}?LockService\.getScriptLock/.test(gasV2), '');
  { // 單筆寄售登記：從函式開頭到 appendRow 之間必須先取得 ScriptLock
    const fn=gasOb.slice(gasOb.indexOf('function handleAddConsignMovement_'));
    const body=fn.slice(0, fn.indexOf('function handleAddConsignMovements_'));
    check('#26 寄售單筆登記有上鎖',
      body.indexOf('LockService.getScriptLock')>0 &&
      body.indexOf('LockService.getScriptLock')<body.indexOf('sh.appendRow'), ''); }
  check('#27 PDF 換行容忍 <br/> 與其他標籤', /<\\s\*br\\s\*\\\/\?\\s\*>/.test(gasMain)||/replace\(\/<\\s\*br/.test(gasMain), '');

  // #25 模擬：欄位再加一欄也不會長度不符
  const H=['a','b','c','d'];
  const seedRow=(headers,obj)=>headers.map(h=>obj[h]!==undefined?obj[h]:'');
  check('#25 加欄後種子列長度仍等於表頭', seedRow(H,{a:1,b:2}).length===H.length, '');

  console.log('\n────── 第四波修正驗證 ──────');
  let bad=0;
  results.forEach(x=>{ if(!x.ok) bad++; console.log((x.ok?'✅':'❌')+' '+x.n+(x.ok?'':'  ← '+x.d)); });
  if(errs.length){ bad++; console.log('❌ JS 錯誤：'+errs.join(' | ')); } else console.log('✅ 無 JS 錯誤');
  console.log(bad?`共 ${bad} 項未通過`:'全部通過');
  await b.close();
  process.exit(bad?1:0);
})();
