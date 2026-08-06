/* 回歸測試：2026-08-06 複檢第二波（金額一致性 #3/#5/#6/#14）
   #3  訂單追蹤訂金/尾款＝報價單條款上的實際金額（不再是總計×比例）
   #5  自動運費列存檔→載入→重選公司，不得長出重複列
   #6  切換欄位開關後級距價仍有效（pid/src/manual 不遺失）
   #14 自動列的 ✕ 刪得掉（不會馬上自動長回來）
   註：#5/#6/#14 需要公司報價檔資料，用假的 COMPANY_DATA 注入測試。 */
const {chromium}=require('playwright');
const path=require('path');

(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const p=await b.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto('file://'+path.join(__dirname,'index.html'));
  await p.waitForTimeout(600);

  const results=[]; const check=(n,ok,d)=>results.push({n,ok:!!ok,d});

  // 注入假的公司報價檔：一個有級距價的品項＋一條「未達30瓶收運費150」的規則
  await p.evaluate(()=>{
    COMPANY_DATA={
      companies:[{company_id:'C1', name:'測試酒廠', active:'Y'}],
      products:[{product_id:'P1', company_id:'C1', name:'測試酒', spec:'500', unit:'瓶',
        unit_price:520, tier_json:JSON.stringify([{min:0,max:99,price:520},{min:100,price:480}]),
        label_fee:'', logo_fee:'', moq:'', active:'Y'}],
      rules:[{rule_id:'R1', company_id:'C1', rule_type:'free_ship_threshold', active:'Y',
        display_text:'整批出貨免運', params_json:JSON.stringify({min_qty:30, ship_fee:150})}]
    };
    SELECTED_COMPANY=COMPANY_DATA.companies[0]; RULE_SUPPRESS={};
  });

  // ── #6：帶入品項 → 切換欄位開關 → 改瓶數跨級距，單價要跟著換
  let r=await p.evaluate(()=>{
    setType('bottle'); setTaxMode('inc'); document.getElementById('taxrate').value='5';
    botItems=[]; document.getElementById('itbody-bot').innerHTML=''; extras=[];
    SELECTED_COMPANY=COMPANY_DATA.companies[0]; RULE_SUPPRESS={};
    document.getElementById('qf-product').innerHTML='<option value="P1">P1</option>';
    document.getElementById('qf-product').value='P1';
    quickAddProduct();
    const row=()=>document.querySelector('#itbody-bot > div');
    row().querySelector('[data-f="qty"]').value='50'; calc();
    const before={price:row().querySelector('[data-f="price"]').value, pid:row().dataset.pid||''};
    toggleCol('lot');                       // 切換「出貨批次」欄 → 整批重建列
    const afterToggle={price:row().querySelector('[data-f="price"]').value, pid:row().dataset.pid||''};
    row().querySelector('[data-f="qty"]').value='150'; calc();   // 跨到 100+ 級距（480）
    const afterTier={price:row().querySelector('[data-f="price"]').value, pid:row().dataset.pid||''};
    return {before, afterToggle, afterTier};
  });
  check('#6 帶入時 50瓶＝520、有 pid', r.before.price==='520'&&r.before.pid==='P1', JSON.stringify(r.before));
  check('#6 切換欄位後 pid 還在', r.afterToggle.pid==='P1', JSON.stringify(r.afterToggle));
  check('#6 切換後改150瓶仍自動換級距→480', r.afterTier.price==='480', JSON.stringify(r.afterTier));

  // ── #14：自動運費列的 ✕ 要刪得掉
  r=await p.evaluate(()=>{
    botItems=[]; document.getElementById('itbody-bot').innerHTML=''; extras=[];
    SELECTED_COMPANY=COMPANY_DATA.companies[0]; RULE_SUPPRESS={};
    addBotRow({name:'酒',vol:500,price:500,qty:20}); calc();   // 20瓶 < 30 → 長出運費 150
    const grew=extras.filter(e=>e.auto==='ship').length;
    const shipRow=extras.find(e=>e.auto==='ship');
    if(shipRow) removeExt(String(shipRow.id));                 // 照 UI 的方式傳「字串」id
    calc();
    return {grew, after:extras.filter(e=>e.auto==='ship').length, suppressed:!!RULE_SUPPRESS.ship};
  });
  check('#14 前置：自動長出運費列', r.grew===1, JSON.stringify(r));
  check('#14 用字串 id 刪除後不再長回來', r.after===0, JSON.stringify(r));
  check('#14 RULE_SUPPRESS.ship 有設起來', r.suppressed, JSON.stringify(r));

  // ── #5：自動列存檔→載入→重選公司，不得重複
  r=await p.evaluate(()=>{
    botItems=[]; document.getElementById('itbody-bot').innerHTML=''; extras=[];
    SELECTED_COMPANY=COMPANY_DATA.companies[0]; RULE_SUPPRESS={};
    addBotRow({name:'酒',vol:500,price:500,qty:20}); calc();
    const saved=collectQuote();                                  // 模擬存檔
    const extraItems=(saved.items||[]).filter(i=>i.itemType==='extra');
    // 模擬載入：照 02_core_api.js 的還原方式重建 extras
    extras=[]; let seq=0;
    extraItems.forEach(it=>{
      const _auto=(it.unit==='ship'||it.unit==='label')?it.unit:null;
      const _e={id:`ext${++seq}`,n:it.name,a:it.unitPrice||it.subtotal||0};
      if(_auto) _e.auto=_auto;
      extras.push(_e);
    });
    SELECTED_COMPANY=null; RULE_SUPPRESS={};
    const restored=extras.length, restoredAuto=extras.filter(e=>e.auto).length;
    SELECTED_COMPANY=COMPANY_DATA.companies[0];                  // 使用者重選同一家公司
    calc();
    return {savedAutoUnit:extraItems.map(i=>i.unit), restored, restoredAuto,
            afterReselect:extras.length, names:extras.map(e=>e.n)};
  });
  check('#5 存檔時 auto 標記有寫進去', r.savedAutoUnit.includes('ship'), JSON.stringify(r.savedAutoUnit));
  check('#5 載入還原後仍帶 auto 標記', r.restoredAuto===1, JSON.stringify(r));
  check('#5 重選公司後沒有變兩列運費', r.afterReselect===1, JSON.stringify(r.names));

  // ── #5 相容性：2026-08-06 之前存的舊單（沒有 auto 標記）也要能認領、不重複
  r=await p.evaluate(()=>{
    botItems=[]; document.getElementById('itbody-bot').innerHTML='';
    extras=[{id:'ext1', n:'運費（未達 30 瓶免運門檻）', a:150}];   // 舊資料：沒有 auto
    SELECTED_COMPANY=COMPANY_DATA.companies[0]; RULE_SUPPRESS={};
    addBotRow({name:'酒',vol:500,price:500,qty:20}); calc();
    return {n:extras.length, adopted:!!extras[0].auto, names:extras.map(e=>e.n)};
  });
  check('#5 舊單無標記的運費列被認領（不重複）', r.n===1&&r.adopted, JSON.stringify(r));

  // ── #5 防誤傷：使用者自己加的「運費折抵」不得被認領成自動列，更不得被刪掉
  r=await p.evaluate(()=>{
    botItems=[]; document.getElementById('itbody-bot').innerHTML='';
    extras=[{id:'ext1', n:'運費折抵', a:-3000}];      // 名稱以「運費」開頭，但不是規則產生的
    SELECTED_COMPANY=COMPANY_DATA.companies[0]; RULE_SUPPRESS={};
    addBotRow({name:'酒',vol:500,price:500,qty:20}); calc();
    const mine=extras.find(e=>e.n==='運費折抵');
    return {kept:!!mine, adopted:!!(mine&&mine.auto), total:document.getElementById('t-tot').textContent,
            names:extras.map(e=>e.n)};
  });
  check('#5 手動「運費折抵」沒被刪掉', r.kept, JSON.stringify(r.names));
  check('#5 手動「運費折抵」沒被誤標成自動列', !r.adopted, JSON.stringify(r.names));

  // 沒選公司時（無規則）也不能動使用者的列
  r=await p.evaluate(()=>{
    botItems=[]; document.getElementById('itbody-bot').innerHTML='';
    extras=[{id:'ext1', n:'運費折抵', a:-3000}];
    SELECTED_COMPANY=null; RULE_SUPPRESS={};
    addBotRow({name:'酒',vol:500,price:500,qty:20}); calc();
    return {kept:extras.some(e=>e.n==='運費折抵'), names:extras.map(e=>e.n)};
  });
  check('#5 未選公司時手動費用列原封不動', r.kept, JSON.stringify(r.names));

  // ── #3：訂單追蹤讀報價單條款的實際金額
  r=await p.evaluate(()=>{
    // 造一張「酒肉朋友」情境的條款：酒款90,000＋SGS4,000＋GS1,500，訂金50,500／尾款45,000
    const terms='訂金支付：甲方於乙方製造前 15 日內，支付訂金總計新台幣 $50,500 元整（內含SGS 檢驗費 $4,000、GS1條碼登記費 $1,500，及酒水總價 50% 之訂金 $45,000 元整），作為乙方啟動生產之依據。<br>驗收與尾款：乙方完成商品製作並全數交付後，甲方應於到貨後 7 日內完成驗收。驗收無誤後，甲方應於 30 日內支付尾款新台幣 $45,000 元整（即酒水總價剩餘之 50%）。';
    const okCase=ordPayFromQuote({payDetail:terms}, 95500);
    const oldFmt='甲方應於本報價單成立後，支付訂金新台幣 $28,650 元整（總價之 30%），作為乙方開始製造之依據。乙方完成商品製作並全數交付後，甲方應於驗收無誤後支付尾款新台幣 $66,850 元整（總價之 70%）。';
    const oldCase=ordPayFromQuote({payDetail:oldFmt}, 95500);
    const clamped='訂金支付：甲方於乙方製造前 15 日內，支付訂金總計新台幣 $4,200 元整（酒水款項 $4,200 元整），作為乙方啟動生產之依據。<br>驗收與尾款：驗收無誤後無須另付尾款（酒水總價剩餘款項已由優惠 $6,300 全數抵銷）。';
    const clampCase=ordPayFromQuote({payDetail:clamped}, 4200);
    const custom=ordPayFromQuote({payDetail:'貨到付款，詳如雙方另訂之協議。'}, 95500);
    const mismatch=ordPayFromQuote({payDetail:terms}, 106700);   // 總額對不上 → 不硬套
    return {okCase, oldCase, clampCase, custom, mismatch};
  });
  check('#3 新版條款讀出 訂金50,500／尾款45,000',
        r.okCase&&r.okCase.dep===50500&&r.okCase.bal===45000, JSON.stringify(r.okCase));
  check('#3 舊版條款也讀得出 28,650／66,850',
        r.oldCase&&r.oldCase.dep===28650&&r.oldCase.bal===66850, JSON.stringify(r.oldCase));
  check('#3 折抵抵光的單：尾款 0', r.clampCase&&r.clampCase.dep===4200&&r.clampCase.bal===0, JSON.stringify(r.clampCase));
  check('#3 自訂條款讀不到 → 回退舊算法（null）', r.custom===null, JSON.stringify(r.custom));
  check('#3 金額與總額對不上 → 不硬套（null）', r.mismatch===null, JSON.stringify(r.mismatch));

  console.log('\n────── 第二波修正驗證 ──────');
  let bad=0;
  results.forEach(x=>{ if(!x.ok) bad++; console.log((x.ok?'✅':'❌')+' '+x.n+(x.ok?'':'  ← '+x.d)); });
  if(errs.length){ bad++; console.log('❌ JS 錯誤：'+errs.join(' | ')); } else console.log('✅ 無 JS 錯誤');
  console.log(bad?`共 ${bad} 項未通過`:'全部通過');
  await b.close();
  process.exit(bad?1:0);
})();
