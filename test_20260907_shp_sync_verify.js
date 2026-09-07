/* 2026-09-07 Molly 回報「酒肉朋友分了好幾天出貨，行事曆都沒顯示」
   查證：她分批出貨用的是「產生Lot驗收單」，但行事曆／今日焦點／今日待辦看的分批出貨
   （order_shipments，藏在編輯進度裡標「例外時才用」的區塊）她從沒填過，全系統 0 筆紀錄。
   修法：產生 Lot 驗收單時，順便同步寫一筆分批出貨（js/05_orders.js shpSyncFromVerify，
   js/09_verify_form.js generateVerifyPdf 呼叫）。用 note 裡的 [VF:單號:第幾次出貨] 當標記防重複。

   1  shpVfTag：單號＋第幾次出貨 組出固定格式的標記
   2  shpSyncFromVerify：沒有配送日期就不動作（不會打一支空的 addShipment）
   3  shpSyncFromVerify：SHP_ALL 已有同標記的舊紀錄 → 呼叫 updateShipment（不是 addShipment）
   4  shpSyncFromVerify：SHP_ALL 沒有、但強制重查 listShipments 找得到 → 一樣 updateShipment（不重打 addShipment）
   5  shpSyncFromVerify：真的沒有舊紀錄 → 呼叫 addShipment，fields 帶 ship_date_actual／note
   6  shpSyncFromVerify：成功後清掉本地 SHP_ALL 快照、強制重抓 listShipments（不是只清 RC_STORE）
   7  shpSyncFromVerify：後端失敗不拋例外、跳錯誤 toast（不擋列印本身）
   8  generateVerifyPdf('full')：產生驗收單時會自動呼叫 shpSyncFromVerify（addShipment 真的被打了）
   9  generateVerifyPdf：同時 saveVerifyFormRecord 照常執行（沒有互相影響）
  10  重印（vf-shipseq 沒被改動）→ 算出同一個 tag → 走 update 不是 add
  11  shpPointLabel：只出過一次貨（total=1）不再顯示「第1批/共1批」
  12  shpPointLabel：total>1 才顯示批次標籤（行為不變）
  13  orderShipPoints：sync 完之後馬上查得到這一筆（date/done 對得上剛存的 ship_date_actual） */
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const results=[]; const check=(n,c,x)=>results.push([c?'PASS':'FAIL',n,x||'']);

const PRODUCTS_QUOTE = {
  quoteNo:'20260806-01', clientName:'酒肉朋友',
  items:[{ itemType:'bottle', name:'梨香蜜桃紅烏龍調酒', volume:'500', qty:224, lot:'' }]
};

(async()=>{
  const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const p=await browser.newPage();
  const errors=[]; const posted=[];
  p.on('pageerror',e=>errors.push('PAGEERROR: '+e.message));
  const isNoise=t=>/Failed to load resource|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|favicon/i.test(t);
  p.on('console', m=>{ if(m.type()==='error' && !isNoise(m.text())) errors.push('CONSOLE: '+m.text()); });
  p.on('dialog', d=>d.accept());

  await p.goto('http://localhost:8899/index.html');
  await p.waitForFunction(()=>{const e=document.getElementById('login-user');return e&&!/載入中/.test(e.textContent||'');},{timeout:15000}).catch(()=>{});
  await p.evaluate(({q})=>{
    document.getElementById('login-overlay').style.display='none';
    AUTH_TOKEN='test-token';
    window.confirm=()=>true; window.alert=()=>{};
    window.CALLS=[]; window.OPENED=[];
    window.open=()=>({document:{open(){},write(h){window.OPENED.push(h);},close(){}}});
    window.QUOTE=q;
    window.SHP_STORE=[];   // 這條測試自己模擬的 order_shipments 表
    window.apiCall=async(payload)=>{
      window.CALLS.push(JSON.parse(JSON.stringify(payload)));
      switch(payload.action){
        case 'getQuoteById': return { ok:true, quote:window.QUOTE };
        case 'listVerifyForms': return { ok:true, records:[] };
        case 'getVerifyKey': return { ok:true, k:'TESTKEY' };
        case 'saveVerifyForm': return { ok:true, id:'VF-NEW' };
        case 'deleteVerifyForm': return { ok:true };
        case 'listShipments': {
          const list=payload.quote_no ? window.SHP_STORE.filter(s=>s.quote_no===payload.quote_no) : window.SHP_STORE;
          return { ok:true, shipments:list };
        }
        case 'addShipment': {
          const rec=Object.assign({ id:'SHP-'+(window.SHP_STORE.length+1), quote_no:payload.quote_no, seq:window.SHP_STORE.length+1 }, payload.fields);
          window.SHP_STORE.push(rec);
          return { ok:true, id:rec.id };
        }
        case 'updateShipment': {
          const rec=window.SHP_STORE.find(s=>s.id===payload.id);
          if(rec) Object.assign(rec, payload.fields);
          return { ok:true };
        }
        default: return { ok:true, quotes:[], orders:[], records:[], shipments:[], rows:[] };
      }
    };
  }, { q: PRODUCTS_QUOTE });

  /* ---------- 1 shpVfTag ---------- */
  check('1 shpVfTag 格式固定', await p.evaluate(()=>
    typeof shpVfTag==='function' && shpVfTag('20260806-01', 2)==='[VF:20260806-01:2]' && shpVfTag('X', undefined)==='[VF:X:1]'));

  /* ---------- 2 沒有配送日期就不動作 ---------- */
  await p.evaluate(async()=>{ window.CALLS.length=0; await shpSyncFromVerify({no:'X', shipDate:''}); });
  const c2=await p.evaluate(()=>window.CALLS.map(c=>c.action));
  check('2 沒配送日期不打任何 API', c2.length===0, JSON.stringify(c2));

  /* ---------- 5 真的沒有舊紀錄 → addShipment ---------- */
  await p.evaluate(()=>{ window.SHP_STORE=[]; SHP_ALL=[]; window.CALLS.length=0; });
  await p.evaluate(async()=>{ await shpSyncFromVerify({no:'20260806-01', shipDate:'2026-09-07', shipSeq:1, boxes:'6', shipper:'Vic'}); });
  const r5=await p.evaluate(()=>({calls:window.CALLS.map(c=>c.action), store:window.SHP_STORE}));
  check('5 真的沒有舊紀錄 → 呼叫 addShipment', r5.calls.filter(a=>a==='addShipment').length===1, JSON.stringify(r5.calls));
  check('5b addShipment 帶 ship_date_actual／note（含 tag、箱數、PM）',
    r5.store.length===1 && r5.store[0].ship_date_actual==='2026-09-07' && /\[VF:20260806-01:1\]/.test(r5.store[0].note)
    && /6 箱/.test(r5.store[0].note) && /Vic/.test(r5.store[0].note), JSON.stringify(r5.store));

  /* ---------- 3 SHP_ALL 已有同標記舊紀錄 → updateShipment ---------- */
  await p.evaluate(()=>{ window.CALLS.length=0; });
  await p.evaluate(async()=>{ await shpSyncFromVerify({no:'20260806-01', shipDate:'2026-09-08', shipSeq:1, boxes:'8'}); });
  const r3=await p.evaluate(()=>({calls:window.CALLS.map(c=>c.action), store:window.SHP_STORE}));
  check('3 同一 tag 重印 → 呼叫 updateShipment 不是 addShipment',
    r3.calls.includes('updateShipment') && !r3.calls.includes('addShipment'), JSON.stringify(r3.calls));
  check('3b 只有一筆紀錄（沒有重複新增）、日期已更新成新的配送日',
    r3.store.length===1 && r3.store[0].ship_date_actual==='2026-09-08', JSON.stringify(r3.store));

  /* ---------- 4 本地快照沒有、但強制重查 listShipments 找得到 → 仍是 update ---------- */
  await p.evaluate(()=>{ SHP_ALL=null; window.CALLS.length=0; });   // 模擬本地快照被清掉但後端資料還在
  await p.evaluate(async()=>{ await shpSyncFromVerify({no:'20260806-01', shipDate:'2026-09-09', shipSeq:1}); });
  const r4=await p.evaluate(()=>({calls:window.CALLS.map(c=>c.action), store:window.SHP_STORE}));
  check('4 快照清空但強制重查找得到 → 仍是 updateShipment、不重複新增',
    r4.calls.includes('listShipments') && r4.calls.includes('updateShipment') && !r4.calls.includes('addShipment') && r4.store.length===1,
    JSON.stringify(r4));

  /* ---------- 不同 seq → 各自一筆（不會互相覆蓋） ---------- */
  await p.evaluate(()=>{ window.CALLS.length=0; });
  await p.evaluate(async()=>{ await shpSyncFromVerify({no:'20260806-01', shipDate:'2026-09-10', shipSeq:2}); });
  const rSeq2=await p.evaluate(()=>window.SHP_STORE);
  check('不同「第幾次出貨」各自算一筆，兩筆並存', rSeq2.length===2 && rSeq2.some(s=>/:2\]/.test(s.note)), JSON.stringify(rSeq2));

  /* ---------- 6 清掉本地 SHP_ALL、強制重抓 ---------- */
  await p.evaluate(()=>{ SHP_ALL=[{id:'stale'}]; });
  await p.evaluate(async()=>{ await shpSyncFromVerify({no:'20260806-01', shipDate:'2026-09-11', shipSeq:3}); });
  const r6=await p.evaluate(()=>SHP_ALL);
  check('6 同步完後 SHP_ALL 已經是新抓回來的內容（不是還停在 stale）',
    Array.isArray(r6) && !r6.some(s=>s.id==='stale') && r6.length===3, JSON.stringify(r6));

  /* ---------- 7 後端失敗不拋例外 ---------- */
  await p.evaluate(()=>{
    window.__origApiCall=window.apiCall;
    window.apiCall=async(payload)=>{ if(payload.action==='addShipment') throw new Error('network down'); return window.__origApiCall(payload); };
  });
  const r7=await p.evaluate(async()=>{
    try{ await shpSyncFromVerify({no:'NEW-NO', shipDate:'2026-09-12', shipSeq:1}); return {threw:false}; }
    catch(e){ return {threw:true, msg:e.message}; }
  });
  check('7 addShipment 失敗不拋例外（不擋列印流程）', r7.threw===false, JSON.stringify(r7));
  await p.evaluate(()=>{ window.apiCall=window.__origApiCall; });

  /* ---------- 11 / 12 shpPointLabel ---------- */
  const labels=await p.evaluate(()=>[
    shpPointLabel({batch:true, seq:1, total:1}),
    shpPointLabel({batch:true, seq:2, total:3}),
    shpPointLabel({batch:false}),
  ]);
  check('11 只出過一次貨（total=1）不顯示批次標籤', labels[0]==='', JSON.stringify(labels));
  check('12 total>1 才顯示「第N批/共M批」', labels[1]==='（第2批/共3批）' && labels[2]==='', JSON.stringify(labels));

  /* ---------- 13 sync 完馬上能被 orderShipPoints 查到 ---------- */
  await p.evaluate(()=>{ window.SHP_STORE=[]; SHP_ALL=[]; window.CALLS.length=0; });
  await p.evaluate(async()=>{ await shpSyncFromVerify({no:'ORD-Z', shipDate:'2026-09-13', shipSeq:1, boxes:'3'}); });
  const r13=await p.evaluate(()=>{
    const pts=orderShipPoints({no:'ORD-Z', st:{}});
    return pts;
  });
  check('13 sync 完之後 orderShipPoints 立刻查得到、標 done、日期對得上',
    r13.length===1 && r13[0].date==='2026-09-13' && r13[0].done===true, JSON.stringify(r13));

  /* ---------- 8/9/10：走完整的「產生 Lot 驗收單」流程 ---------- */
  await p.evaluate(()=>{ window.SHP_STORE=[]; SHP_ALL=[]; window.CALLS.length=0; });
  await p.evaluate(async()=>{ await openVerifyForm('20260806-01'); });
  await p.waitForTimeout(300);
  await p.evaluate(()=>{
    document.getElementById('vf-shipdate').value='2026-09-07';
    document.getElementById('vf-shipper').value='Vic';
    document.getElementById('vf-boxes').value='6';
    // 本次出貨數已經是預設帶滿；直接產生整批
  });
  await p.evaluate(async()=>{ await generateVerifyPdf('full'); });
  await p.waitForTimeout(300);
  const r8=await p.evaluate(()=>({calls:window.CALLS.map(c=>c.action), store:window.SHP_STORE}));
  check('8 產生 Lot 驗收單會自動呼叫 addShipment（同步進行事曆）', r8.calls.includes('addShipment'), JSON.stringify(r8.calls));
  check('9 saveVerifyForm 照常執行（沒有互相影響）', r8.calls.includes('saveVerifyForm'), JSON.stringify(r8.calls));
  check('8b 存進去的是這張單這次的配送日期', r8.store.length===1 && r8.store[0].ship_date_actual==='2026-09-07', JSON.stringify(r8.store));

  // 10：模擬「編輯／重印」——重新開一次同一張單、shipseq 沒被動過，直接再產生一次
  await p.evaluate(()=>{ window.CALLS.length=0; });
  await p.evaluate(async()=>{ await openVerifyForm('20260806-01'); });
  await p.waitForTimeout(300);
  await p.evaluate(()=>{
    document.getElementById('vf-shipdate').value='2026-09-07';
    document.getElementById('vf-shipseq').value='1';   // 跟上一次同一批
  });
  await p.evaluate(async()=>{ await generateVerifyPdf('full'); });
  await p.waitForTimeout(300);
  const r10=await p.evaluate(()=>({calls:window.CALLS.map(c=>c.action), store:window.SHP_STORE}));
  check('10 同一次出貨重印 → updateShipment，不是又新增一筆 addShipment',
    r10.calls.includes('updateShipment') && !r10.calls.includes('addShipment') && r10.store.length===1, JSON.stringify(r10));

  await browser.close();
  const fail=results.filter(r=>r[0]==='FAIL');
  results.forEach(r=>console.log(r[0]+'  '+r[1]+(r[0]==='FAIL'?'  '+r[2]:'')));
  if(errors.length){ console.log('\n--- JS 錯誤 ---'); errors.forEach(e=>console.log(e)); }
  console.log('\n合計 '+results.length+' 項，FAIL '+fail.length+' 項'+(errors.length?'，另有 '+errors.length+' 個 JS 錯誤':''));
  process.exit((fail.length||errors.length)?1:0);
})();
