/* 回歸測試：載入舊單後改金額，付款條件必須跟著重算（Molly 2026-08-06 回報）
   情境完全比照回報的截圖：原單 550ml/$475/200瓶 存好 → 重新載入 → 改成 510ml/$460/220瓶
   期望：條款裡的訂金/尾款要變成新金額，而不是停在舊的 $53,000 / $47,500 */
const {chromium}=require('playwright');
const path=require('path');
const money=s=>parseFloat(String(s).replace(/[$,]/g,''))||0;

(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const p=await b.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto('file://'+path.join(__dirname,'index.html'));
  await p.waitForTimeout(600);

  const results=[];
  const check=(n,ok,d)=>results.push({n,ok:!!ok,d});

  // ── 1. 先做出「原單」並取得它存檔時的付款文字
  const orig=await p.evaluate(()=>{
    setType('bottle'); setTaxMode('inc');
    document.getElementById('taxrate').value='5';
    botItems=[]; document.getElementById('itbody-bot').innerHTML='';
    addBotRow({name:'梨香蜜桃紅烏龍調酒', vol:550, price:475, qty:200});
    extras=[{n:'SGS 檢驗費（1款 × $4,000）',a:4000},{n:'GS1條碼登記費（1款 × $1,500）',a:1500}];
    setPay(0);
    document.getElementById('dep-pct').value='50';
    document.getElementById('dep-days1').value='15';
    document.getElementById('dep-days').value='7';
    document.getElementById('dep-fdays').value='30';
    calc();
    return {terms:getPayTerms(), dep:document.getElementById('dep-amt').textContent,
            bal:document.getElementById('dep-bal').textContent, tot:document.getElementById('t-tot').textContent};
  });
  check('原單訂金 $53,000', money(orig.dep)===53000, orig.dep);
  check('原單尾款 $47,500', money(orig.bal)===47500, orig.bal);

  // ── 2. 模擬「重新載入這張舊單」：付款文字凍結成存檔當下的版本
  await p.evaluate(t=>{
    setPay(0);
    document.getElementById('dep-pct').value='50';
    document.getElementById('dep-days1').value='15';
    document.getElementById('dep-days').value='7';
    document.getElementById('dep-fdays').value='30';
    calc();
    LOADED_PAY_DETAIL=t;   // loadQuote() 就是這樣把存檔文字塞回來的
    calc();                // 載入後的第一次 calc（記錄金額基準）
  }, orig.terms);

  const frozen=await p.evaluate(()=>getPayTerms());
  check('沒改任何東西 → 條款一字不差沿用原文', frozen===orig.terms, '重印文字被改掉了');

  // ── 3. 改容量/單價/瓶數（都不是付款欄位）→ 條款必須跟著重算
  const after=await p.evaluate(()=>{
    const row=document.querySelector('#itbody-bot > div');
    row.querySelector('[data-f="vol"]').value='510';
    row.querySelector('[data-f="price"]').value='460';
    row.querySelector('[data-f="qty"]').value='220';
    calc();
    return {terms:getPayTerms(), dep:document.getElementById('dep-amt').textContent,
            bal:document.getElementById('dep-bal').textContent, tot:document.getElementById('t-tot').textContent,
            frozen:(LOADED_PAY_DETAIL!=null)};
  });

  // 460×220=101,200（含稅）＋4,000＋1,500 = 106,700
  // 訂金 = 101,200×50% + 5,500 = 56,100 ／ 尾款 = 50,600
  check('總計 $106,700', money(after.tot)===106700, after.tot);
  check('訂金欄 $56,100', money(after.dep)===56100, after.dep);
  check('尾款欄 $50,600', money(after.bal)===50600, after.bal);
  check('凍結已解除', after.frozen===false, '仍然凍結');
  check('條款不再出現舊金額 $53,000', !/53,000/.test(after.terms), after.terms);
  check('條款不再出現舊金額 $47,500', !/47,500/.test(after.terms), after.terms);
  check('條款出現新訂金 $56,100', /56,100/.test(after.terms), after.terms);
  check('條款出現新尾款 $50,600', /50,600/.test(after.terms), after.terms);
  check('原單的天數設定有保留（15/7/30）',
        /製造前 15 日內/.test(after.terms)&&/到貨後 7 日內/.test(after.terms)&&/於 30 日內支付尾款/.test(after.terms), after.terms);
  check('訂金＋尾款＝總計', money(after.dep)+money(after.bal)===money(after.tot),
        `${after.dep}+${after.bal} vs ${after.tot}`);

  console.log('\n【改動前 條款】\n'+orig.terms.replace(/<br>/g,'\n'));
  console.log('\n【改動後 條款】\n'+after.terms.replace(/<br>/g,'\n'));

  console.log('\n────── 結果 ──────');
  let bad=0;
  results.forEach(x=>{ if(!x.ok) bad++; console.log((x.ok?'✅':'❌')+' '+x.n+(x.ok?'':'  ← '+x.d)); });
  if(errs.length){ bad++; console.log('❌ JS 錯誤：'+errs.join(' | ')); } else console.log('\n✅ 無 JS 錯誤');
  console.log(bad?`\n共 ${bad} 項未通過`:'\n全部通過');
  await b.close();
  process.exit(bad?1:0);
})();
