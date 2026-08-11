/* 回歸測試：2026-08-11 複檢第一級 5 項（會直接少收錢的那批）
   #1 載入舊單不得把自動運費／扣標列刪掉（8/6 #5 的修法造成的反效果）
   #2 舊單重開後仍接得回公司報價檔：pid 存得回去、載入還原、改瓶數才換級距價
   #3 非訂金型付款條款（Tab1 驗收後付 100%／Tab2 月結全額）不得被硬帶 50/50
   #4 月報表要用完整清單（不再只看最近 300 張報價單）
   #5 後端 c_verify.gs 的 items 白名單要保留 taster（試飲瓶標示）

   跑法：node test_wave5.js（前端部分用 Playwright 開 index.html；#5 直接抽後端那段 map 驗證） */
const {chromium}=require('playwright');
const path=require('path');
const fs=require('fs');

const results=[]; const check=(n,ok,d)=>results.push({n,ok:!!ok,d});

/* ── #5：後端 handleSaveVerifyForm_ 的 items 白名單（不開瀏覽器，直接抽那段 map 來跑）── */
function testBackendTaster(){
  const src=fs.readFileSync(path.join(__dirname,'gas','c_verify.gs'),'utf8');
  const m=src.match(/var items = srcItems\.map\(function \(it\) \{[\s\S]*?\n  \}\);/);
  if(!m){ check('#5 找得到 handleSaveVerifyForm_ 的 items map', false, '沒比對到那段程式碼'); return; }
  check('#5 找得到 handleSaveVerifyForm_ 的 items map', true);
  const fn=new Function('srcItems','verifyClean_', m[0]+'\n return items;');
  const clean=(v,n)=>String(v==null?'':v).slice(0,n);
  const out=fn([
    {name:'南坡萬琴酒', vol:'500ml', thisShip:1, ordered:1, shipped:0, taster:1},
    {name:'南坡萬琴酒', vol:'700ml', thisShip:12, ordered:12, shipped:0, taster:0},
    {name:'舊資料沒有這個欄位', vol:'700ml', thisShip:6, ordered:6, shipped:0}
  ], clean);
  check('#5 試飲瓶 taster=1 存得進留底', out[0].taster===1, JSON.stringify(out[0]));
  check('#5 一般品項 taster=0', out[1].taster===0, JSON.stringify(out[1]));
  check('#5 舊資料沒帶 taster 也不會壞（補 0）', out[2].taster===0, JSON.stringify(out[2]));
  check('#5 原有欄位沒被動到', out[1].name==='南坡萬琴酒'&&out[1].thisShip===12&&out[1].ordered===12, JSON.stringify(out[1]));
}

(async()=>{
  testBackendTaster();

  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const p=await b.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto('file://'+path.join(__dirname,'index.html'));
  await p.waitForTimeout(600);

  // 假的公司報價檔：一個有級距價的品項（<100 瓶 $520、>=100 瓶 $480）＋「未達 30 瓶收運費 150」的規則
  await p.evaluate(()=>{
    COMPANY_DATA={
      companies:[{company_id:'C1', name:'測試酒廠', active:'Y'}],
      products:[{product_id:'P1', company_id:'C1', name:'測試酒', spec:'500', unit:'瓶',
        unit_price:520, tier_json:JSON.stringify([{min:0,max:99,price:520},{min:100,price:480}]),
        label_fee:'', logo_fee:'', moq:'', active:'Y'}],
      rules:[{rule_id:'R1', company_id:'C1', rule_type:'free_ship_threshold', active:'Y',
        display_text:'整批出貨免運', params_json:JSON.stringify({min_qty:30, ship_fee:150})}]
    };
  });

  /* ── #1＋#2：開一張「有自動運費列＋有 pid」的瓶裝單 → collectQuote → loadQuoteIntoForm ── */
  let r=await p.evaluate(()=>{
    setType('bottle'); setTaxMode('inc'); document.getElementById('taxrate').value='5';
    botItems=[]; document.getElementById('itbody-bot').innerHTML=''; extras=[];
    SELECTED_COMPANY=COMPANY_DATA.companies[0]; RULE_SUPPRESS={};
    document.getElementById('qf-product').innerHTML='<option value="P1">P1</option>';
    document.getElementById('qf-product').value='P1';
    quickAddProduct();
    const row=document.querySelector('#itbody-bot > div');
    row.querySelector('[data-f="qty"]').value='20';      // 20 瓶 → 未達 30 瓶免運門檻 → 長出運費 $150
    calc();
    const saved=collectQuote();
    return {
      extrasCount: extras.length,
      shipRow: extras.find(e=>e.auto==='ship')||null,
      grandTotal: saved.grandTotal,
      bottleItem: saved.items.find(i=>i.itemType==='bottle')||null,
      extraItems: saved.items.filter(i=>i.itemType==='extra'),
      saved: JSON.stringify(saved)
    };
  });
  check('前置：存檔前有自動運費列 $150', !!r.shipRow && r.shipRow.a===150, JSON.stringify(r.shipRow));
  check('#2 存檔時 pid 有跟著存進 flavorList 欄',
        r.bottleItem && String(r.bottleItem.flavorList)==='P1', JSON.stringify(r.bottleItem));
  check('#2 運費列的 auto 標記照舊存在 unit 欄',
        r.extraItems.length===1 && r.extraItems[0].unit==='ship', JSON.stringify(r.extraItems));
  const savedTotal=r.grandTotal;

  // 把剛剛存的那張單當成「舊單」載入（loadQuoteIntoForm 會先把 SELECTED_COMPANY 清成 null）
  r=await p.evaluate((savedJson)=>{
    const q=JSON.parse(savedJson);
    q.quoteNo='20260811-01';
    loadQuoteIntoForm(q);
    const row=document.querySelector('#itbody-bot > div');
    return {
      selectedCompany: SELECTED_COMPANY,
      extrasCount: extras.length,
      shipRow: extras.find(e=>e.auto==='ship')||null,
      grandTotal: parseFloat(String(document.getElementById('t-tot').textContent||'').replace(/[^\d.-]/g,''))||0,
      pid: row?row.dataset.pid:null,
      tierBaseQty: row?row.dataset.tierBaseQty:null,
      price: row?row.querySelector('[data-f="price"]').value:null
    };
  }, r.saved);
  check('#1 載入舊單後 SELECTED_COMPANY 是空的（前提沒變）', r.selectedCompany===null, JSON.stringify(r.selectedCompany));
  check('#1 ⭐ 載入舊單後自動運費列還在（$150 沒被刪掉）',
        !!r.shipRow && r.shipRow.a===150, JSON.stringify({extras:r.extrasCount, ship:r.shipRow}));
  check('#1 ⭐ 載入舊單後總計與存檔時一致',
        Math.round(r.grandTotal)===Math.round(savedTotal), `載入後 ${r.grandTotal} / 存檔時 ${savedTotal}`);
  check('#2 載入舊單後 pid 有還原', String(r.pid)==='P1', String(r.pid));
  check('#2 剛載入、瓶數沒動過 → 單價維持原單的 $520（級距不介入）',
        String(r.price)==='520' && String(r.tierBaseQty)==='20', JSON.stringify({price:r.price, base:r.tierBaseQty}));

  // 改瓶數跨級距 → 這時級距價才該作用
  r=await p.evaluate(()=>{
    const row=document.querySelector('#itbody-bot > div');
    row.querySelector('[data-f="qty"]').value='120';
    calc();
    const after=row.querySelector('[data-f="price"]').value;
    row.querySelector('[data-f="qty"]').value='20';
    calc();
    return {after, back:row.querySelector('[data-f="price"]').value, base:row.dataset.tierBaseQty};
  });
  check('#2 ⭐ 改成 120 瓶 → 單價自動換成級距價 $480', String(r.after)==='480', String(r.after));
  check('#2 再改回 20 瓶 → 單價回到 $520（不會停在低價少收）', String(r.back)==='520', String(r.back));
  check('#2 動過瓶數後保護解除', r.base==null||r.base===undefined||r.base==='', String(r.base));

  // #1 的另一面：使用者主動把公司選成「不指定」時，自動列仍然要被清掉
  r=await p.evaluate(()=>{
    SELECTED_COMPANY=COMPANY_DATA.companies[0]; RULE_SUPPRESS={};
    extras=[{id:9001, n:'運費（未達 30 瓶免運門檻）', a:150, auto:'ship'}];
    document.getElementById('qf-company').value='';
    onSelectCompany(true);
    return {extras:extras.slice(), n:extras.length};
  });
  check('#1 選「不指定」時自動列仍然清得掉（沒有誤擋）', r.n===0, JSON.stringify(r.extras));

  /* ── #3：付款條款反解 ── */
  r=await p.evaluate(()=>{
    const tab1='乙方交付商品後，甲方應於 7 日內完成驗收，驗收無誤後即應支付款項新台幣 95,500 元整之 100%。';
    const tab2='甲方應於收貨後第 1 個月 15 號支付全額款項新台幣 95,500 元整，預估付款日：2026-09-15。';
    const tab1part='乙方交付商品後，甲方應於 7 日內完成驗收，驗收無誤後即應支付款項新台幣 95,500 元整之 70%。';
    const dep='訂金支付：甲方於乙方製造前 15 日內，支付訂金總計新台幣 $50,500 元整（SGS 檢驗費 $5,500、酒水總價 50% 之訂金 $45,000 元整），作為乙方啟動生產之依據。<br>驗收與尾款：乙方完成商品製作並全數交付後，甲方應於到貨後 7 日內完成驗收。驗收無誤後，甲方應於 30 日內支付尾款新台幣 $45,000 元整（即酒水總價剩餘之 50%）。';
    return {
      tab1: ordPayFromQuote({payDetail:tab1}, 95500),
      tab2: ordPayFromQuote({payDetail:tab2}, 95500),
      tab1part: ordPayFromQuote({payDetail:tab1part}, 95500),
      tab1bad: ordPayFromQuote({payDetail:tab1}, 88000),
      dep: ordPayFromQuote({payDetail:dep}, 95500),
      custom: ordPayFromQuote({payDetail:'貨到付款，詳如雙方另訂之協議。'}, 95500),
      empty: ordPayFromQuote({payDetail:''}, 95500)
    };
  });
  check('#3 ⭐ Tab1 驗收後付 100% → 訂金 0、尾款全額',
        r.tab1 && r.tab1.dep===0 && r.tab1.bal===95500, JSON.stringify(r.tab1));
  check('#3 ⭐ Tab2 月結全額 → 訂金 0、尾款全額',
        r.tab2 && r.tab2.dep===0 && r.tab2.bal===95500, JSON.stringify(r.tab2));
  check('#3 只付部分比例（70%）→ 不猜（null）', r.tab1part===null, JSON.stringify(r.tab1part));
  check('#3 全額型但金額與總額對不上 → 不硬套（null）', r.tab1bad===null, JSON.stringify(r.tab1bad));
  check('#3 訂金型條款照舊讀得出 50,500／45,000',
        r.dep && r.dep.dep===50500 && r.dep.bal===45000, JSON.stringify(r.dep));
  check('#3 自訂條款仍回 null（呼叫端留空不猜）', r.custom===null, JSON.stringify(r.custom));
  check('#3 沒有條款回 null', r.empty===null, JSON.stringify(r.empty));

  /* ── #4：月報表要完整清單 ── */
  r=await p.evaluate(()=>{
    AUTH_TOKEN='TESTTOKEN';
    const before=ordPayloads()[0];
    const first=ordSetLoadAll();      // 第一次進月報表 → true（要強制重抓）
    const after=ordPayloads()[0];
    const second=ordSetLoadAll();     // 之後再進 → false（不用再重抓）
    return {beforeLimit:before.limit, afterLimit:after.limit, first, second,
            action:after.action, keeps:ordPayloads().length};
  });
  check('#4 平常仍只抓最近 300 筆（速度不變）', r.beforeLimit===300, String(r.beforeLimit));
  check('#4 ⭐ 進月報表後改抓完整清單（不帶 limit）', r.afterLimit===undefined, String(r.afterLimit));
  check('#4 第一次進月報表會強制重抓、之後不會', r.first===true && r.second===false, JSON.stringify([r.first,r.second]));
  check('#4 三份 payload 結構沒被動到', r.keeps===3 && r.action==='getQuotes', JSON.stringify([r.keeps,r.action]));

  console.log('\n────── 2026-08-11 第一級 5 項修正驗證 ──────');
  let bad=0;
  results.forEach(x=>{ if(!x.ok) bad++; console.log((x.ok?'✅':'❌')+' '+x.n+(x.ok?'':'  ← '+x.d)); });
  if(errs.length){ bad++; console.log('❌ JS 錯誤：'+errs.join(' | ')); } else console.log('✅ 無 JS 錯誤');
  console.log(bad?`共 ${bad} 項未通過`:`全部通過（${results.length} 項）`);
  await b.close();
  process.exit(bad?1:0);
})();
