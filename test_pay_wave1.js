/* 回歸測試：2026-08-06 複檢第一波修正（付款條款狀態機 #1/#2/#12/#16）
   A. 載入舊單（30%／製造前20日）→ 只編輯付款備註 → 原單比例/天數保留，不被預設值蓋掉（#1）
   B. 連開兩張舊單 → 不誤跳「金額有異動」、A 的設定不污染 B（#2）
   C. 折抵超過尾款額度 → 尾款封頂 $0，條款不出現負數（#12）
   D. 小數比例 12.5% → 解凍重算後保留 12.5（#16）
   模擬 loadQuoteIntoForm 的付款段：照 02_core_api.js 的實際順序（載入頭清凍結→setPay→設DETAIL→restore→calc） */
const {chromium}=require('playwright');
const path=require('path');
const money=s=>parseFloat(String(s).replace(/[$,]/g,''))||0;

(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const p=await b.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto('file://'+path.join(__dirname,'index.html'));
  await p.waitForTimeout(600);

  const results=[]; const check=(n,ok,d)=>results.push({n,ok:!!ok,d});
  const toasts=[];
  await p.exposeFunction('__logToast',m=>toasts.push(m));
  await p.evaluate(()=>{ const _t=window.toast; window.toast=(m,ty)=>{ window.__logToast(m); return _t?_t(m,ty):undefined; }; });

  // 依 02_core_api.js loadQuoteIntoForm 的實際順序模擬「載入一張舊單的付款段」
  const simulateLoad=q=>p.evaluate(q=>{
    LOADED_PAY_DETAIL=null; LOADED_PAY_SIG=null;            // 載入頭（#2 修正）
    setType(q.type); setTaxMode(q.taxMode);                 // 載入中途會觸發 calc 的動作
    document.getElementById('taxrate').value=String(q.rate);
    botItems=[]; document.getElementById('itbody-bot').innerHTML='';
    q.items.forEach(it=>addBotRow(it));
    extras=(q.extras||[]).map(e=>({n:e.n,a:e.a}));
    calc();
    let pt=q.paymentType||0; if(pt<0||pt>4) pt=0;
    setPay(pt);
    LOADED_PAY_DETAIL=(q.paymentDetail!=null&&q.paymentDetail!=='')?q.paymentDetail:null;
    if(LOADED_PAY_DETAIL!=null){ try{ restorePayFieldsFromText(LOADED_PAY_DETAIL); }catch(e){} }
    calc();
  },q);

  // ── 先造一張「30%／製造前20日／驗收10日／尾款45日」的原單文字
  await p.evaluate(()=>{
    setType('bottle'); setTaxMode('inc'); document.getElementById('taxrate').value='5';
    botItems=[]; document.getElementById('itbody-bot').innerHTML='';
    addBotRow({name:'測試酒', vol:500, price:450, qty:200});
    extras=[{n:'SGS 檢驗費',a:4000}];
    setPay(0);
    document.getElementById('dep-pct').value='30';
    document.getElementById('dep-days1').value='20';
    document.getElementById('dep-days').value='10';
    document.getElementById('dep-fdays').value='45';
    calc();
  });
  const quoteA_text=await p.evaluate(()=>getPayTerms());
  check('前置：原單文字含 30%／20日', /30% /.test(quoteA_text)&&/製造前 20 日/.test(quoteA_text), quoteA_text);

  // ── A（#1）：載入這張單 → 面板欄位應立即還原成原單設定，編輯備註後條款仍是 30%/20日
  await simulateLoad({type:'bottle',taxMode:'inc',rate:5,
    items:[{name:'測試酒',vol:500,price:450,qty:200}], extras:[{n:'SGS 檢驗費',a:4000}],
    paymentType:0, paymentDetail:quoteA_text});
  let r=await p.evaluate(()=>({pct:document.getElementById('dep-pct').value,
    d1:document.getElementById('dep-days1').value, vd:document.getElementById('dep-days').value,
    fd:document.getElementById('dep-fdays').value, frozen:LOADED_PAY_DETAIL!=null}));
  check('A 載入後欄位＝原單 30/20/10/45（非預設）', r.pct==='30'&&r.d1==='20'&&r.vd==='10'&&r.fd==='45', JSON.stringify(r));
  check('A 載入後仍凍結', r.frozen, '');
  // 編輯付款備註（PAY_FIELDS 路徑解凍）
  r=await p.evaluate(()=>{
    const el=document.getElementById('dep-ded'); el.value='貨到請先驗酒標';
    el.dispatchEvent(new Event('input',{bubbles:true}));
    return {terms:getPayTerms(), frozen:LOADED_PAY_DETAIL!=null};
  });
  check('A 編輯備註後解凍', !r.frozen, '');
  check('A 條款保留 30%（不是預設50）', /30% /.test(r.terms)&&!/50% /.test(r.terms), r.terms);
  check('A 條款保留 製造前20日／45日尾款', /製造前 20 日/.test(r.terms)&&/45 日內支付尾款/.test(r.terms), r.terms);
  check('A 備註有進條款', /貨到請先驗酒標/.test(r.terms), r.terms);

  // ── B（#2）：接著載入另一張單 B（不同金額/比例），不得誤跳提示、欄位不得殘留 A 的值
  await p.evaluate(()=>{
    setPay(0); document.getElementById('dep-pct').value='50';
    document.getElementById('dep-days1').value='15'; document.getElementById('dep-days').value='7';
    document.getElementById('dep-fdays').value='30'; document.getElementById('dep-ded').value='';
  });
  const quoteB_text=await p.evaluate(()=>{
    botItems=[]; document.getElementById('itbody-bot').innerHTML='';
    addBotRow({name:'B酒',vol:750,price:800,qty:100}); extras=[]; calc();
    return getPayTerms();
  });
  // 先載回 A（造成「上一張單的凍結還掛著」的狀態），再載 B
  await simulateLoad({type:'bottle',taxMode:'inc',rate:5,
    items:[{name:'測試酒',vol:500,price:450,qty:200}], extras:[{n:'SGS 檢驗費',a:4000}],
    paymentType:0, paymentDetail:quoteA_text});
  toasts.length=0;
  await simulateLoad({type:'bottle',taxMode:'inc',rate:5,
    items:[{name:'B酒',vol:750,price:800,qty:100}], extras:[],
    paymentType:0, paymentDetail:quoteB_text});
  r=await p.evaluate(()=>({pct:document.getElementById('dep-pct').value,
    d1:document.getElementById('dep-days1').value, frozen:LOADED_PAY_DETAIL!=null,
    terms:getPayTerms()}));
  check('B 連開兩張不誤跳「金額有異動」', !toasts.some(m=>/金額有異動/.test(m)), JSON.stringify(toasts));
  check('B 欄位是 B 的 50/15，不是 A 的 30/20', r.pct==='50'&&r.d1==='15', JSON.stringify(r));
  check('B 條款＝B 原文（仍凍結）', r.frozen && r.terms===quoteB_text, r.terms);

  // ── C（#12）：折抵超過尾款額度 → 封頂
  r=await p.evaluate(()=>{
    setPay(0); LOADED_PAY_DETAIL=null; LOADED_PAY_SIG=null;
    setTaxMode('exc'); document.getElementById('taxrate').value='5';
    botItems=[]; document.getElementById('itbody-bot').innerHTML='';
    addBotRow({name:'C酒',vol:500,price:10000,qty:1});
    extras=[{n:'商會特別優惠',a:-6000}];
    document.getElementById('dep-pct').value='50'; calc();
    return {tot:document.getElementById('t-tot').textContent,
            dep:document.getElementById('dep-amt').textContent,
            bal:document.getElementById('dep-bal').textContent, terms:getPayTerms()};
  });
  // 未稅基數 4,000、總計 4,200；訂金基數 5,000 > 4,000 → 封頂 dep=4,200、bal=0
  check('C 總計 $4,200', money(r.tot)===4200, r.tot);
  check('C 訂金封頂＝總計 $4,200', money(r.dep)===4200, r.dep);
  check('C 尾款 $0 不為負', money(r.bal)===0, r.bal);
  check('C 條款無負數金額', !/\$-|-\$?\d/.test(r.terms.replace(/-\d+ 日/g,'')), r.terms);
  check('C 條款寫「無須另付尾款」', /無須另付尾款/.test(r.terms), r.terms);
  check('C 訂金＋尾款＝總計', money(r.dep)+money(r.bal)===money(r.tot), '');

  // ── D（#16）：小數比例 12.5% 存檔→載入→改金額 → 保留 12.5
  const decText=await p.evaluate(()=>{
    setPay(0); LOADED_PAY_DETAIL=null; LOADED_PAY_SIG=null;
    setTaxMode('inc'); document.getElementById('taxrate').value='5';
    botItems=[]; document.getElementById('itbody-bot').innerHTML='';
    addBotRow({name:'D酒',vol:500,price:1000,qty:100}); extras=[];
    document.getElementById('dep-pct').value='12.5'; calc();
    return getPayTerms();
  });
  check('D 前置：條款印 12.5%', /12\.5%/.test(decText), decText);
  await simulateLoad({type:'bottle',taxMode:'inc',rate:5,
    items:[{name:'D酒',vol:500,price:1000,qty:100}], extras:[],
    paymentType:0, paymentDetail:decText});
  r=await p.evaluate(()=>{
    const row=document.querySelector('#itbody-bot > div');
    row.querySelector('[data-f="qty"]').value='120'; calc();   // 改金額 → 解凍
    return {pct:document.getElementById('dep-pct').value, terms:getPayTerms()};
  });
  check('D 解凍後比例保留 12.5', r.pct==='12.5', r.pct);
  check('D 重算條款印 12.5%', /12\.5%/.test(r.terms), r.terms);

  console.log('\n────── 第一波修正驗證 ──────');
  let bad=0;
  results.forEach(x=>{ if(!x.ok) bad++; console.log((x.ok?'✅':'❌')+' '+x.n+(x.ok?'':'  ← '+x.d)); });
  if(errs.length){ bad++; console.log('❌ JS 錯誤：'+errs.join(' | ')); } else console.log('✅ 無 JS 錯誤');
  console.log(bad?`共 ${bad} 項未通過`:'全部通過');
  await b.close();
  process.exit(bad?1:0);
})();
