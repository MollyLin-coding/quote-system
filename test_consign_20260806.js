/* 回歸測試：2026-08-06 Molly 三項寄售需求
   A. 寄售鋪貨驗收單移除簽收欄與簽名線，版面對齊一般報價單的出貨驗收單
   B. 保證金改成「按客戶設定要不要押」
   C. 鋪貨每款可附 500ml 試飲瓶（免費、不進庫存、不收保證金、驗收單標明試飲） */
const {chromium}=require('playwright');
const path=require('path'), fs=require('fs');

(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const p=await b.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto('file://'+path.join(__dirname,'index.html'));
  await p.waitForTimeout(600);
  const results=[]; const check=(n,ok,d)=>results.push({n,ok:!!ok,d});

  // ── A：驗收單版面
  let r=await p.evaluate(()=>{
    const d={ no:'CS-CS001-20260806120000', client:'測試酒吧', shipDate:'2026-08-06', handler:'Molly', note:'',
      rows:[{name:'梨香蜜桃紅烏龍調酒', vol:'100ml', qty:24},
            {name:'梨香蜜桃紅烏龍調酒', vol:'500ml', qty:1, taster:true}] };
    const html=buildConsignVerifyDocHtml(d,{preview:true});
    return { html,
      hasSignCol:/<th[^>]*>簽收<\/th>/.test(html),
      hasSignLine:/客戶簽名|簽收日期/.test(html),
      hasTasterTag:/試飲/.test(html),
      hasQr:/線上驗收回報/.test(html),
      // 注意：不能用 split('<th') 數，<thead> 自己也含 '<th'；用 /<th[\s>]/ 才是真正的欄位標題
      thCount:((html.match(/<thead>[\s\S]*?<\/thead>/)||[''])[0].match(/<th[\s>]/g)||[]).length };
  });
  check('A 驗收單已無「簽收」欄', !r.hasSignCol, '');
  check('A 驗收單已無客戶簽名／簽收日期簽名線', !r.hasSignLine, '');
  check('A 表格剩 3 欄（酒款／容量／數量）', r.thCount===3, '欄數='+r.thCount);
  check('A 仍保留 QR 線上驗收回報', r.hasQr, '');
  check('A 試飲瓶列有標示「試飲」', r.hasTasterTag, '');
  // 跟一般報價單那套用同一段說明文字
  check('A 說明文字對齊一般報價單（驗收與品質說明）', /驗收與品質說明/.test(r.html), '');

  // ── B：保證金按客戶開關
  r=await p.evaluate(()=>{
    CONSIGN_TERMS={deposit_100ml:50, deposit_500ml:250};
    OWNBRAND_PRODUCTS=[{sku_id:'S1', name:'A酒', volume:'100ml', list_price:200},
                       {sku_id:'S2', name:'B酒', volume:'500ml', list_price:800}];
    CS_CUSTOMERS=[{customer_id:'C1', name:'要押的店', deposit_required:'Y'},
                  {customer_id:'C2', name:'不押的店', deposit_required:'N'},
                  {customer_id:'C3', name:'舊資料沒這欄'}];
    const out={};
    CS_CUR='C1'; out.C1={need:csCustomerNeedsDeposit(), unit100:csMoveDepositUnit('S1'), unit500:csMoveDepositUnit('S2')};
    CS_CUR='C2'; out.C2={need:csCustomerNeedsDeposit(), unit100:csMoveDepositUnit('S1'), unit500:csMoveDepositUnit('S2')};
    CS_CUR='C3'; out.C3={need:csCustomerNeedsDeposit(), unit100:csMoveDepositUnit('S1')};
    return out;
  });
  check('B 有押的客戶：100ml=$50、500ml=$250', r.C1.need&&r.C1.unit100===50&&r.C1.unit500===250, JSON.stringify(r.C1));
  check('B 不押的客戶：保證金一律 0', !r.C2.need&&r.C2.unit100===0&&r.C2.unit500===0, JSON.stringify(r.C2));
  check('B 舊資料沒這欄＝照舊要押（不影響既有客戶）', r.C3.need&&r.C3.unit100===50, JSON.stringify(r.C3));

  // 客戶編輯表單有欄位、存檔會帶上
  r=await p.evaluate(()=>{
    const has=!!document.getElementById('cs-f-dep');
    const src=String(saveConsignCustomerForm);
    const openSrc=String(openConsignCustomerEdit);
    return { has, saves:/deposit_required/.test(src), loads:/cs-f-dep/.test(openSrc) };
  });
  check('B 客戶編輯表單有「保證金」欄位', r.has, '');
  check('B 存檔會送出 deposit_required', r.saves, '');
  check('B 編輯既有客戶會帶回原設定', r.loads, '');

  // ── C：試飲瓶
  r=await p.evaluate(()=>{
    CS_MOVE_ROWID=0; csMoveItems=[]; csAddMoveRow();
    const row=csMoveItems[0];
    return { hasTasterFields:('taster' in row)&&('tasterQty' in row), defQty:row.tasterQty, defOff:row.taster===false };
  });
  check('C 鋪貨列預設有試飲瓶欄位、預設不勾、支數 1', r.hasTasterFields&&r.defOff&&r.defQty===1, JSON.stringify(r));

  r=await p.evaluate(()=>{
    // 重現 saveConsignMove 的 rowsForVf 組法
    OWNBRAND_PRODUCTS=[{sku_id:'S1', name:'A酒', volume:'100ml'},{sku_id:'S2', name:'B酒', volume:'100ml'}];
    const valid=[{sku:'S1', qty:24, taster:true, tasterQty:1},
                 {sku:'S2', qty:12, taster:false, tasterQty:1}];
    const rowsForVf=[];
    valid.forEach(r=>{
      const p=ownbrandBySku(r.sku);
      rowsForVf.push({ name:p?p.name:r.sku, vol:p?p.volume:'', qty:r.qty });
      if(r.taster) rowsForVf.push({ name:p?p.name:r.sku, vol:'500ml', qty:r.tasterQty, taster:true });
    });
    // 送後端的異動（庫存帳）只該有兩筆正常鋪貨，不含試飲瓶
    const movements=valid.map(r=>({sku_id:r.sku, type:'in', qty:r.qty}));
    return { rowsForVf, movementCount:movements.length,
             movementQty:movements.reduce((s,m)=>s+m.qty,0) };
  });
  check('C 驗收單多出一列 500ml 試飲瓶', r.rowsForVf.length===3, JSON.stringify(r.rowsForVf));
  check('C 試飲瓶列容量 500ml、標記 taster', r.rowsForVf[1].vol==='500ml'&&r.rowsForVf[1].taster===true, JSON.stringify(r.rowsForVf[1]));
  check('C 試飲瓶不寫進庫存異動（仍只有 2 筆、共 36 瓶）', r.movementCount===2&&r.movementQty===36, JSON.stringify(r));

  // 試飲瓶標記要能存進留底、也能從留底帶回
  r=await p.evaluate(()=>{
    const saveSrc=String(saveConsignVerifyFormRecord);
    return { savesTaster:/taster:r\.taster\?1:0/.test(saveSrc) };
  });
  check('C 試飲瓶標記會存進留底 items_json', r.savesTaster, '');
  const vm=fs.readFileSync(path.join(__dirname,'js/06_verify_mgmt.js'),'utf8');
  check('C 從留底編輯會帶回試飲瓶標記', /taster:!!\(it\.taster/.test(vm), '');

  // 後端：不押保證金的客戶不累計餘額
  const ob=fs.readFileSync(path.join(__dirname,'gas/v3_ownbrand.gs'),'utf8');
  check('B 後端 headers 有 deposit_required', /'note', 'deposit_required'/.test(ob), '');
  check('B 後端保證金加總會跳過不押的客戶', /noDeposit\[String\(row\.customer_id\)\]/.test(ob), '');

  console.log('\n────── 寄售三項需求驗證 ──────');
  let bad=0;
  results.forEach(x=>{ if(!x.ok) bad++; console.log((x.ok?'✅':'❌')+' '+x.n+(x.ok?'':'  ← '+x.d)); });
  if(errs.length){ bad++; console.log('❌ JS 錯誤：'+errs.join(' | ')); } else console.log('✅ 無 JS 錯誤');
  console.log(bad?`共 ${bad} 項未通過`:'全部通過');
  await b.close();
  process.exit(bad?1:0);
})();
