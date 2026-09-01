/* 2026-09-01 收尾三項的離線驗證：
   A 未稅顯示時「前標費／LOGO」也要換算成未稅（原本印含稅原值，客戶加總對不出小計）
   B 另存新單／複製時要解除「沿用原單付款條款文字」的凍結
   C 級距價要挑「符合條件裡門檻最大」的一段，不能靠陣列順序（只填 min 沒填 max 時會抓錯段） */
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const results=[]; const check=(n,c,x)=>results.push([c?'PASS':'FAIL',n,x||'']);

(async()=>{
  const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const errors=[];
  const mk=async()=>{
    const p=await browser.newPage();
    p.on('pageerror',e=>errors.push('PAGEERROR: '+e.message));
    await p.route('**/script.google.com/**', async route=>{
      let b={}; try{ b=JSON.parse(route.request().postData()||'{}'); }catch(e){}
      let r;
      if(b.action==='login') r={ok:true, token:'t', role:'owner', name:'Molly'};
      else if(b.action==='getLoginUsers') r={ok:true, users:['Molly']};
      else if(b.action==='batch') r={ok:true, results:(b.calls||[]).map(()=>({ok:true,quotes:[],orders:[],records:[],summary:{},shipments:[],customers:[],moves:[]}))};
      else r={ok:true, quotes:[], orders:[], records:[], items:[], shipments:[], summary:{}, customers:[], moves:[]};
      await route.fulfill({status:200, headers:{'Access-Control-Allow-Origin':'*'}, contentType:'application/json', body:JSON.stringify(r)});
    });
    await p.goto('http://localhost:8899/index.html');
    await p.waitForTimeout(900);
    await p.evaluate(async()=>{ document.getElementById('login-pin').value='1'; await doLogin(); });
    await p.waitForTimeout(500);
    return p;
  };

  /* ========== A：未稅顯示的前標費／LOGO ========== */
  const p1=await mk();
  const rA2=await p1.evaluate(()=>{
    gotoPage('new'); setType('bottle'); resetAll(); setType('bottle');
    if(!colDed) toggleCol('ded');
    if(!colLogo) toggleCol('logo');
    setTaxMode('inc');                       // 輸入含稅價
    document.getElementById('taxrate').value='5';
    addBotRow({name:'測試酒', vol:700, price:1050, ded:105, logo:210, qty:10});
    calc();
    const grab=(taxDisp)=>{
      document.getElementById('f-taxdisplay').value=taxDisp;
      return (buildStdDocParts().rows||[]).join('');
    };
    const excl=grab('excl'), inc=grab('');
    return { excl, inc, colDed, colLogo, taxMode };
  });
  const exclHtml=rA2.excl, incHtml=rA2.inc;
  const cellNums=h=>(h.match(/>\$?[\d,\.]+</g)||[]).map(x=>x.replace(/[><$]/g,''));
  // 含稅輸入 1050 / 105 / 210，稅率 5% → 未稅 1,000 / 100 / $200，小計 (1000+100+200)*10=13,000
  check('A 兩欄都有打開、確實是含稅輸入模式', rA2.colDed===true && rA2.colLogo===true && rA2.taxMode==='inc', JSON.stringify({d:rA2.colDed,l:rA2.colLogo,t:rA2.taxMode}));
  check('A 未稅顯示：單價換算成 1,000', exclHtml.indexOf('$1,000')>=0, cellNums(exclHtml).join('|'));
  check('A 未稅顯示：前標費換算成 100（原本印 105）', cellNums(exclHtml).indexOf('100')>=0, cellNums(exclHtml).join('|'));
  check('A 未稅顯示：LOGO 換算成 $200（原本印 $210）', exclHtml.indexOf('$200')>=0, cellNums(exclHtml).join('|'));
  check('A 未稅顯示：不再出現含稅原值 105／$210', cellNums(exclHtml).indexOf('105')<0 && exclHtml.indexOf('$210')<0, cellNums(exclHtml).join('|'));
  check('A 小計仍是 13,000（未稅）', exclHtml.indexOf('13,000')>=0, cellNums(exclHtml).join('|'));
  check('A 含稅顯示時完全不換算（105 / $210 照印）', cellNums(incHtml).indexOf('105')>=0 && incHtml.indexOf('$210')>=0, cellNums(incHtml).join('|'));
  check('A 未稅顯示：單價＋前標＋LOGO 加總 ×瓶數 ＝ 小計', (1000+100+200)*10===13000);

  /* ========== B：另存新單解除付款文字凍結 ========== */
  const p2=await mk();
  const rB=await p2.evaluate(async()=>{
    gotoPage('new'); setType('bottle'); resetAll(); setType('bottle');
    addBotRow({name:'酒', vol:700, price:1000, qty:10}); calc();
    editingQuoteNo='20260801-01';
    LOADED_PAY_DETAIL='【原單專用】訂金為酒水總價 50 %，到貨後 30 日內支付尾款。';
    LOADED_PAY_SIG=null;
    const before=getPayTerms();
    await detachAsNewQuote_();
    const after=getPayTerms();
    return { before, after, frozen:(typeof LOADED_PAY_DETAIL!=='undefined'?LOADED_PAY_DETAIL:'undef'),
             no:editingQuoteNo, days:(document.getElementById('dep-days')||{}).value,
             pct:(document.getElementById('dep-pct')||{}).value };
  });
  check('B 另存新單前：確實沿用原單凍結文字', /原單專用/.test(rB.before), rB.before);
  check('B 另存新單後：不再沿用原單那段文字', !/原單專用/.test(rB.after), rB.after);
  check('B 另存新單後：付款條款改回即時計算（凍結已清空）', rB.frozen===null, String(rB.frozen));
  check('B 原單的天數／比例有沿用回輸入欄，不用重打', String(rB.pct)==='50' && String(rB.days)==='30', JSON.stringify({pct:rB.pct,days:rB.days}));
  check('B 仍然有正常的付款條款文字（不是空的）', String(rB.after||'').length>10, String(rB.after||'').slice(0,40));
  check('B editingQuoteNo 已斷開（確定是新單）', !rB.no, String(rB.no));

  /* ========== C：級距價選段 ========== */
  const p3=await mk();
  const rC=await p3.evaluate(()=>{
    gotoPage('new'); setType('bottle'); resetAll(); setType('bottle');
    // 只填 min、沒填 max 的三段級距（Molly 的價目表就是這樣填的）
    COMPANY_DATA={ companies:[{company_id:'C1',name:'測試公司'}],
      products:[{ company_id:'C1', product_id:'P1', name:'測試酒', spec:'700ml', unit_price:1200,
                  tier_json:JSON.stringify([{min:100,price:1000},{min:500,price:900},{min:1000,price:800}]) }],
      rules:[] };
    const priceAt=(q)=>{
      resetAll(); setType('bottle');
      addBotRow({name:'測試酒', vol:700, price:1200, qty:q});
      const row=document.getElementById(`r-${rowId}`); row.dataset.pid='P1';
      const pi=row.querySelector('[data-f="price"]'); pi.dataset.src=1200;
      applyAutoRules();
      return parseFloat(row.querySelector('[data-f="price"]').value);
    };
    const outOfOrder=(q)=>{
      COMPANY_DATA.products[0].tier_json=JSON.stringify([{min:1000,price:800},{min:100,price:1000},{min:500,price:900}]);
      const v=priceAt(q);
      COMPANY_DATA.products[0].tier_json=JSON.stringify([{min:100,price:1000},{min:500,price:900},{min:1000,price:800}]);
      return v;
    };
    // 有正確 max 的級距：行為必須跟以前一模一樣
    const withMax=(q)=>{
      COMPANY_DATA.products[0].tier_json=JSON.stringify([{min:1,max:99,price:1200},{min:100,max:499,price:1000},{min:500,price:900}]);
      const v=priceAt(q);
      COMPANY_DATA.products[0].tier_json=JSON.stringify([{min:100,price:1000},{min:500,price:900},{min:1000,price:800}]);
      return v;
    };
    return { q50:priceAt(50), q150:priceAt(150), q600:priceAt(600), q1200:priceAt(1200),
             oo600:outOfOrder(600), wm50:withMax(50), wm200:withMax(200), wm900:withMax(900) };
  });
  check('C 600 瓶要吃 500 瓶↑ 的 900（原本抓到 100 瓶↑ 的 1000）', rC.q600===900, JSON.stringify(rC));
  check('C 1200 瓶要吃 1000 瓶↑ 的 800', rC.q1200===800, JSON.stringify(rC));
  check('C 150 瓶仍是 1000', rC.q150===1000, JSON.stringify(rC));
  check('C 50 瓶沒有任何級距 → 退回主檔原價 1200', rC.q50===1200, JSON.stringify(rC));
  check('C 級距在陣列裡順序亂填也選得對', rC.oo600===900, JSON.stringify(rC));
  check('C 有正確上下限的級距，行為完全不變', rC.wm50===1200 && rC.wm200===1000 && rC.wm900===900, JSON.stringify(rC));

  results.forEach(r=>console.log(r[0], r[1], r[2]?('  → '+r[2]):''));
  const fails=results.filter(r=>r[0]==='FAIL').length;
  console.log(errors.length?('JS ERRORS: '+errors.slice(0,4).join(' | ')):'NO JS ERRORS');
  console.log(fails?(fails+' FAIL / '+results.length):('ALL '+results.length+' PASS'));
  await browser.close();
})();
