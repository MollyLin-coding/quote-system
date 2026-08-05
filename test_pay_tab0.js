/* 驗算：付款條件 Tab0「比例訂金＋尾款」改版（2026-08-05）
   訂金%只算酒款、其他費用正數全額進訂金、負數從尾款扣、稅金按比例分攤（訂金+尾款=總計）*/
const {chromium}=require('playwright');
const path=require('path');

const money=s=>parseFloat(String(s).replace(/[$,]/g,''))||0;

(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const p=await b.newPage();
  const errs=[];
  p.on('pageerror',e=>errs.push(String(e)));
  await p.goto('file://'+path.join(__dirname,'index.html'));
  await p.waitForTimeout(600);

  // 直接操作頁面內的資料結構，模擬使用者輸入品項與額外費用
  async function scenario({wine, ext, pct, taxMode, rate}){
    return await p.evaluate(({wine, ext, pct, taxMode, rate})=>{
      setTaxMode(taxMode);
      document.getElementById('taxrate').value=String(rate);
      // 酒款：塞一列品項，單價=wine、數量=1
      botItems=[]; document.getElementById('itbody-bot').innerHTML='';
      addBotRow({name:'測試酒款', price:wine, qty:1});
      // 額外費用
      extras=ext.map(e=>({n:e.n,a:e.a}));
      document.getElementById('dep-pct').value=String(pct);
      calc();
      return {
        tot: document.getElementById('t-tot').textContent,
        dep: document.getElementById('dep-amt').textContent,
        bal: document.getElementById('dep-bal').textContent,
        terms: getPayTerms(),
      };
    },{wine, ext, pct, taxMode, rate});
  }

  const results=[];
  const check=(name,cond,detail)=>{ results.push({name,ok:!!cond,detail}); };

  // --- 情境 A：你的參考單情境（酒款 80,000＋SGS 10,000＋GS1 5,000－運費折抵 3,000，未稅模式 5%）
  let r=await scenario({wine:80000, ext:[{n:'SGS檢驗費',a:10000},{n:'GS1條碼費',a:5000},{n:'運費折抵',a:-3000}], pct:50, taxMode:'exc', rate:5});
  {
    const tot=money(r.tot), dep=money(r.dep), bal=money(r.bal);
    // 未稅基數 92,000；訂金基數 = 80,000*50% + 15,000 = 55,000；尾款基數 37,000
    check('A 總計 = 92,000*1.05 = 96,600', tot===96600, `實得 ${tot}`);
    check('A 訂金 = 55,000 加稅 = 57,750', dep===57750, `實得 ${dep}`);
    check('A 尾款 = 37,000 加稅 = 38,850', bal===38850, `實得 ${bal}`);
    check('A 訂金＋尾款 = 總計', dep+bal===tot, `${dep}+${bal} vs ${tot}`);
    check('A 條款有寫出酒水總價50%之訂金', /酒水總價 50% 之訂金 \$42,000 元整/.test(r.terms), r.terms);
    check('A 條款有列出兩筆其他費用全額', /內含SGS檢驗費 \$10,500、GS1條碼費 \$5,250/.test(r.terms), r.terms);
    check('A 條款尾款有扣運費折抵', /減去運費折抵 \$3,150/.test(r.terms), r.terms);
    check('A 括號內明細加總 = 訂金總額', 10500+5250+42000===dep, `10500+5250+42000 vs ${dep}`);
    check('A 三段天數都出現', /製造前 15 日內/.test(r.terms)&&/到貨後 7 日內/.test(r.terms)&&/於 30 日內支付尾款/.test(r.terms), r.terms);
    console.log('\n【情境A 條款文字】\n'+r.terms.replace(/<br>/g,'\n'));
  }

  // --- 情境 B：無額外費用，須與改版前「總價×%」完全一致（含稅模式 30%）
  r=await scenario({wine:95500, ext:[], pct:30, taxMode:'inc', rate:5});
  {
    const tot=money(r.tot), dep=money(r.dep), bal=money(r.bal);
    check('B 總計 = 95,500（含稅模式原樣）', tot===95500, `實得 ${tot}`);
    check('B 訂金 = 95,500*30% = 28,650（同截圖、與改版前一致）', dep===28650, `實得 ${dep}`);
    check('B 尾款 = 66,850（同截圖）', bal===66850, `實得 ${bal}`);
    check('B 無額外費用時條款不出現「內含」字樣', !/內含/.test(r.terms), r.terms);
    check('B 無額外費用時訂金明細 = 訂金總額', /酒水總價 30% 之訂金 \$28,650 元整/.test(r.terms), r.terms);
    console.log('\n【情境B 條款文字】\n'+r.terms.replace(/<br>/g,'\n'));
  }

  // --- 情境 C：只有正數其他費用、含稅模式，檢查不會出現進位造成的 1 元誤差
  r=await scenario({wine:33333, ext:[{n:'SGS檢驗費',a:7777}], pct:50, taxMode:'inc', rate:5});
  {
    const tot=money(r.tot), dep=money(r.dep), bal=money(r.bal);
    check('C 訂金＋尾款 = 總計（無 1 元誤差）', dep+bal===tot, `${dep}+${bal} vs ${tot}`);
    check('C 訂金 > 其他費用全額', dep>7777, `實得 ${dep}`);
  }

  // --- 情境 D：訂金比例 0% → 訂金只剩其他費用
  r=await scenario({wine:50000, ext:[{n:'GS1條碼費',a:5000}], pct:0, taxMode:'exc', rate:5});
  {
    const dep=money(r.dep), bal=money(r.bal), tot=money(r.tot);
    check('D 0% 時訂金 = 其他費用 5,000 加稅 = 5,250', dep===5250, `實得 ${dep}`);
    check('D 訂金＋尾款 = 總計', dep+bal===tot, `${dep}+${bal} vs ${tot}`);
  }

  // --- 情境 E：稅率 0
  r=await scenario({wine:60000, ext:[{n:'SGS檢驗費',a:10000}], pct:50, taxMode:'exc', rate:0});
  {
    const dep=money(r.dep), bal=money(r.bal), tot=money(r.tot);
    check('E 稅率0：訂金 = 30,000+10,000 = 40,000', dep===40000, `實得 ${dep}`);
    check('E 稅率0：尾款 = 30,000', bal===30000, `實得 ${bal}`);
    check('E 訂金＋尾款 = 總計', dep+bal===tot, `${dep}+${bal} vs ${tot}`);
  }

  // --- 情境 F：付款 Tab 只剩 5 個、且第 6 個已不存在
  const tabs=await p.evaluate(()=>Array.from(document.querySelectorAll('.ptab')).map(b=>b.textContent.trim()));
  check('F 付款 Tab 只剩 5 個', tabs.length===5, JSON.stringify(tabs));
  check('F 已無「酒款訂金＋其他費用」分頁', !tabs.some(t=>t.includes('酒款訂金')), JSON.stringify(tabs));

  console.log('\n────── 驗算結果 ──────');
  let bad=0;
  for(const x of results){ if(!x.ok) bad++; console.log((x.ok?'✅':'❌')+' '+x.name+(x.ok?'':'  ← '+x.detail)); }
  if(errs.length){ bad++; console.log('\n❌ 頁面 JS 錯誤：'); errs.forEach(e=>console.log('   '+e)); }
  else console.log('\n✅ 頁面沒有任何 JS 錯誤');
  console.log(bad? `\n共 ${bad} 項未通過`:'\n全部通過');
  await b.close();
  process.exit(bad?1:0);
})();
