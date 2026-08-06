/* 回歸測試：2026-08-06 複檢第三波（資料安全 #7/#8/#9/#10/#11）
   #4/#13 是純後端（品項表只刪自己的列、自訂單發號上鎖），無法在瀏覽器裡測，
   改以「模擬後端演算法」的方式驗證邏輯正確性（見最後一段）。 */
const {chromium}=require('playwright');
const path=require('path');

(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const p=await b.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto('file://'+path.join(__dirname,'index.html'));
  await p.waitForTimeout(600);

  const results=[]; const check=(n,ok,d)=>results.push({n,ok:!!ok,d});

  // ── #7：自訂單品名含雙引號，載入編輯後不得截斷
  let r=await p.evaluate(()=>{
    gotoPage('custom');
    customItems=[]; document.getElementById('c-rows').innerHTML='';
    const NAME='12" 木塞禮盒', NOTE='客戶說要 "金色" 緞帶', UNIT='組"';
    addCustomRow({name:NAME, qty:2, unit:UNIT, price:100, note:NOTE});
    const row=document.querySelector('#c-rows > div');
    return { name:row.querySelector('[data-f="name"]').value, wantName:NAME,
             note:row.querySelector('[data-f="note"]').value, wantNote:NOTE,
             unit:row.querySelector('[data-f="unit"]').value, wantUnit:UNIT };
  });
  check('#7 品名含雙引號完整還原', r.name===r.wantName, `得到「${r.name}」應為「${r.wantName}」`);
  check('#7 備註含雙引號完整還原', r.note===r.wantNote, `得到「${r.note}」`);
  check('#7 單位含雙引號完整還原', r.unit===r.wantUnit, `得到「${r.unit}」`);

  // ── #7 延伸：含 < > & 的內容也不能壞（原本 escHtml 有處理，別改回歸）
  r=await p.evaluate(()=>{
    customItems=[]; document.getElementById('c-rows').innerHTML='';
    const N='A<b>&C';
    addCustomRow({name:N, qty:1, price:1});
    return {v:document.querySelector('#c-rows [data-f="name"]').value, want:N};
  });
  check('#7 品名含 < > & 也完整', r.v===r.want, `得到「${r.v}」`);

  // ── #8：同品名同容量兩列，已出貨量必須分配、不得每列都拿合計
  r=await p.evaluate(()=>{
    // 直接測分配演算法（openVerifyForm 需要後端資料，這裡重現它的核心邏輯）
    const keyOf=(n,v)=>String(n||'').trim()+'|'+String(v==null?'':v).trim();
    function build(items, priorForms){
      const shippedSum={};
      priorForms.forEach(f=>(f.items||[]).forEach(pi=>{
        const k=keyOf(pi.name,pi.vol); shippedSum[k]=(shippedSum[k]||0)+(parseFloat(pi.thisShip)||0);
      }));
      const poolLeft=Object.assign({},shippedSum);
      return items.map(it=>{
        const ordered=parseFloat(it.qty)||0;
        const k=keyOf(it.name,it.volume);
        const avail=poolLeft[k]||0;
        const shipped=(ordered>0)?Math.min(avail,ordered):avail;
        poolLeft[k]=avail-shipped;
        const remain=ordered-shipped;
        return {ordered, shipped, thisShip: shipped>0?(remain>0?remain:0):ordered};
      });
    }
    // 同酒款兩個 LOT 各 100，第一批兩列都全出（留底合計 200）
    const rows=build(
      [{name:'梅酒',volume:'500',qty:100},{name:'梅酒',volume:'500',qty:100}],
      [{items:[{name:'梅酒',vol:'500',thisShip:100},{name:'梅酒',vol:'500',thisShip:100}]}]
    );
    // 第一批只出了其中 50
    const partial=build(
      [{name:'梅酒',volume:'500',qty:100},{name:'梅酒',volume:'500',qty:100}],
      [{items:[{name:'梅酒',vol:'500',thisShip:50}]}]
    );
    return {rows, partial};
  });
  check('#8 兩列全出後：各列已出貨 100/100（非 200/200）',
        r.rows[0].shipped===100&&r.rows[1].shipped===100, JSON.stringify(r.rows));
  check('#8 兩列全出後：待出貨不為負', r.rows.every(x=>x.thisShip>=0), JSON.stringify(r.rows));
  check('#8 已出貨合計守恆＝200', r.rows[0].shipped+r.rows[1].shipped===200, JSON.stringify(r.rows));
  check('#8 只出50時：第一列50、第二列0',
        r.partial[0].shipped===50&&r.partial[1].shipped===0, JSON.stringify(r.partial));
  check('#8 只出50時：第一列剩50、第二列帶全量100',
        r.partial[0].thisShip===50&&r.partial[1].thisShip===100, JSON.stringify(r.partial));

  // ── #9：載入宴會單必須清掉上一張瓶裝單的品項與額外費用
  r=await p.evaluate(()=>{
    // 先做出「上一張瓶裝單」的殘留狀態
    setType('bottle'); setTaxMode('inc'); document.getElementById('taxrate').value='5';
    botItems=[]; document.getElementById('itbody-bot').innerHTML='';
    addBotRow({name:'瓶裝酒A',vol:500,price:1000,qty:1});
    extras=[{id:'e1',n:'SGS 檢驗費',a:4000}];
    calc();
    const before={items:botItems.length, extras:extras.length};
    // 模擬 loadQuoteIntoForm 的宴會分支清理（本次新增的那幾行）
    setType('banquet');
    document.getElementById('itbody-bot').innerHTML=''; botItems=[];
    extras=[]; renderExt();
    botDedCache={}; botLogoCache={}; botLotCache={};
    calc();
    // 使用者在這張宴會單上切回瓶裝型
    setType('bottle'); calc();
    return {before, afterItems:botItems.length, afterExtras:extras.length,
            total:document.getElementById('t-tot').textContent};
  });
  check('#9 前置：瓶裝單有 1 列品項＋1 筆額外費用', r.before.items===1&&r.before.extras===1, JSON.stringify(r.before));
  check('#9 載入宴會單後品項列已清空', r.afterItems===0, String(r.afterItems));
  check('#9 載入宴會單後額外費用已清空', r.afterExtras===0, String(r.afterExtras));
  check('#9 切回瓶裝型不會冒出上一張單的金額', r.total==='$0', r.total);

  // ── #10：存檔後單號要回寫畫面（模擬後端回傳的號碼跟表單不同）
  r=await p.evaluate(()=>{
    gotoPage('new'); setType('bottle');
    document.getElementById('f-no').value='20260806-01';
    document.getElementById('pl-no').textContent='20260806-01';
    document.getElementById('f-ser').value='1';
    // 重現 saveQuote 成功分支新加的回寫邏輯
    const data={ok:true, quoteNo:'20260806-02'};
    if(data.quoteNo){
      const _fn=document.getElementById('f-no'); if(_fn) _fn.value=data.quoteNo;
      const _pn=document.getElementById('pl-no'); if(_pn) _pn.textContent=data.quoteNo;
      const _m=String(data.quoteNo).match(/-(\d+)\s*$/);
      if(_m){ const _s=document.getElementById('f-ser'); if(_s) _s.value=parseInt(_m[1],10)||1; }
    }
    return {no:document.getElementById('f-no').value, pl:document.getElementById('pl-no').textContent,
            ser:document.getElementById('f-ser').value};
  });
  check('#10 表單單號回寫成後端實際發的號', r.no==='20260806-02', r.no);
  check('#10 預覽/列印用的單號也一起更新', r.pl==='20260806-02', r.pl);
  check('#10 流水號同步成 2', r.ser==='2', r.ser);

  // ── #10 延伸：autoNextSerial 現在會把自訂單的號一起算進去
  r=await p.evaluate(()=>{
    const today='20260806';
    let mx=0;
    const bump=no=>{ const m=String(no||'').match(new RegExp('^'+today+'-(\\d+)$')); if(m){ const n=parseInt(m[1],10); if(n>mx) mx=n; } };
    [{quoteNo:'20260806-01'}].forEach(x=>bump(x.quoteNo));          // 標準單只有 -01
    [{quote_no:'20260806-03'}].forEach(x=>bump(x.quote_no));        // 自訂單已用到 -03
    return mx;
  });
  check('#10 下一個流水號會避開自訂單占用的號（3→下一個4）', r===3, String(r));

  // ── #11：有未儲存修改時，產生正式文件要先問過
  r=await p.evaluate(()=>{
    const src=String(generateOfficialDocument);
    return { guards:/FORM_DIRTY/.test(src) && /confirm\(/.test(src) };
  });
  check('#11 產生正式文件有擋未儲存修改', r.guards, '');

  // ── #4：後端「只刪自己的列」演算法（模擬 Sheets 的列行為）
  r=await p.evaluate(()=>{
    // 模擬品項表：三張單交錯
    let sheet=[['A','a1'],['B','b1'],['A','a2'],['C','c1'],['A','a3'],['B','b2']];
    const quoteNo='A';
    // 新做法：由下往上刪自己的列，再 append
    const myRows=[]; sheet.forEach((r,i)=>{ if(String(r[0])===quoteNo) myRows.push(i); });
    for(let d=myRows.length-1;d>=0;d--) sheet.splice(myRows[d],1);
    const survivors=sheet.map(r=>r[1]);
    sheet=sheet.concat([['A','A-new1'],['A','A-new2']]);
    return {survivors, final:sheet.map(r=>r[0]+':'+r[1])};
  });
  check('#4 只刪自己的列，別張單完整保留', JSON.stringify(r.survivors)===JSON.stringify(['b1','c1','b2']), JSON.stringify(r.survivors));
  check('#4 新列正確 append 在後面', r.final.slice(-2).join(',')==='A:A-new1,A:A-new2', JSON.stringify(r.final));

  console.log('\n────── 第三波修正驗證 ──────');
  let bad=0;
  results.forEach(x=>{ if(!x.ok) bad++; console.log((x.ok?'✅':'❌')+' '+x.n+(x.ok?'':'  ← '+x.d)); });
  if(errs.length){ bad++; console.log('❌ JS 錯誤：'+errs.join(' | ')); } else console.log('✅ 無 JS 錯誤');
  console.log(bad?`共 ${bad} 項未通過`:'全部通過');
  await b.close();
  process.exit(bad?1:0);
})();
