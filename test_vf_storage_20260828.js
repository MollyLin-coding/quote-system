/* 2026-08-28：驗收單 → 客戶寄倉自動登記 離線測試
   設計主軸：輸入一次同步所有（客戶/酒款/容量/數量/日期全部從驗收單帶）、聰明預設、防重複計 */
const { chromium } = require('/opt/node-tools/node_modules/playwright');

let STORAGE_MOVES = [];
const QUOTE_WITH_ST = {
  quoteNo:'20260828-05', clientName:'寄倉客戶A', quoteType:'ownbrand', quoteDate:'2026-08-28',
  items:[
    { itemType:'bottle', name:'琥珀琴酒', volume:'500', unitPrice:720, qty:100, subtotal:72000, flavorList:'' },
    { itemType:'bottle', name:'手作梅酒', volume:'750', unitPrice:600, qty:60,  subtotal:36000, flavorList:'' },
    { itemType:'docopts', name:'文件顯示設定', unitPrice:0, qty:1, subtotal:0,
      flavorList: JSON.stringify({hideTotals:0,imgSize:'m',storage:1}) }
  ]
};
const QUOTE_NO_ST = { quoteNo:'20260828-06', clientName:'一般客戶B', quoteType:'bottle', quoteDate:'2026-08-28',
  items:[{ itemType:'bottle', name:'測試酒', volume:'500', unitPrice:800, qty:20, subtotal:16000, flavorList:'' }] };

let lastMoves=null;
function respond(action, body){
  switch(action){
    case 'getQuoteById': return { ok:true, quote:(body.quoteNo==='20260828-05')?QUOTE_WITH_ST:QUOTE_NO_ST };
    case 'listVerifyForms': return { ok:true, records:[], summary:{} };
    case 'getStorageData': return { ok:true, moves:STORAGE_MOVES };
    case 'addStorageMoves': { lastMoves=body.moves||[]; return { ok:true, saved:lastMoves.map(m=>({move_id:'X',name:m.name,direction:m.direction,qty:m.qty,src:m.src})), skipped:[] }; }
    case 'getVerifyKey': return { ok:true, k:'testkey' };   // 欄位是 k 不是 key（vfKeyFor 讀 d.k）
    case 'saveVerifyForm': return { ok:true };
    case 'getOwnbrandProducts': return { ok:true, products:[] };
    case 'getOwnbrandTiers': return { ok:true, tiers:[], terms:{} };
    case 'getConsignCustomers': return { ok:true, customers:[], discounts:[] };
    case 'getTodayDigest': return { ok:true, today:'2026-08-28', ship_due:[], final_due:[], no_scan:[], no_invoice:[], calendar:[], warnings:[] };
    default: return { ok:true, quotes:[], orders:[], records:[], summary:{}, shipments:[], items:[], companies:[], products:[], rules:[], customers:[] };
  }
}
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errors=[], results=[], posted=[];
  const check=(n,c)=>results.push([c?'PASS':'FAIL', n]);
  const isNoise=t=>/Failed to load resource|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|favicon|raw.githubusercontent/i.test(t);
  const page = await browser.newPage();
  page.on('pageerror', e=>errors.push('PAGEERROR: '+e.message));
  page.on('console', m=>{ if(m.type()==='error' && !isNoise(m.text())) errors.push('CONSOLE: '+m.text()); });
  page.on('dialog', d=>d.accept());
  await page.route('**/script.google.com/**', async route => {
    let body={}; try{ body=JSON.parse(route.request().postData()||'{}'); }catch(e){}
    posted.push(body);
    let payload;
    if(body.action==='batch') payload={ok:true, results:(body.calls||[]).map(c=>respond(c.action,c))};
    else payload=respond(body.action, body);
    await route.fulfill({status:200, headers:{'Access-Control-Allow-Origin':'*'}, contentType:'application/json', body:JSON.stringify(payload)});
  });
  await page.goto('http://localhost:8899/index.html');
  await page.waitForTimeout(1200);
  await page.evaluate(()=>{ document.getElementById('login-overlay').style.display='none'; AUTH_TOKEN='t'; PREFETCH_DONE=true; });

  /* ---- 1. 沒庫存 → 聰明預設「入倉」 ---- */
  await page.evaluate(()=>openVerifyForm('20260828-05'));
  await page.waitForTimeout(700);
  let r = await page.evaluate(()=>({
    box: !!document.getElementById('vf-storage-box'),
    on: document.getElementById('vf-st-on').checked,
    dir: (document.querySelector('input[name="vf-st-dir"]:checked')||{}).value,
    note: document.getElementById('vf-st-opts').innerText
  }));
  check('勾寄倉的單：驗收單出現寄倉區塊、預設打勾', r.box===true && r.on===true);
  check('客戶寄倉沒庫存 → 聰明預設「入倉」', r.dir==='in' && /沒有庫存/.test(r.note));

  /* ---- 2. 產生驗收單 → 自動帶入全部欄位（不用重打） ---- */
  await page.evaluate(()=>{
    document.getElementById('vf-shipdate').value='2026-08-29';
    document.querySelectorAll('[data-k="thisShip"]').forEach((el,i)=>{ el.value=(i===0?40:25); el.dispatchEvent(new Event('input',{bubbles:true})); });
    window.open=()=>({document:{open(){},write(){},close(){}}});   // 擋列印視窗
    generateVerifyPdf('partial');
  });
  await page.waitForTimeout(700);
  {
    const call=posted.find(b=>b.action==='addStorageMoves');
    const mv=(call&&call.moves)||[];
    check('產生驗收單 → 自動打 addStorageMoves', !!call);
    check('兩個品項各一筆、數量沿用「本次出貨」（40／25）', mv.length===2 && mv[0].qty===40 && mv[1].qty===25);
    if(mv.length!==2) console.log('DEBUG moves=', JSON.stringify(mv));
    check('客戶／單號／容量／日期全部自動帶（不用重打）',
      mv.length===2 && mv.every(m=>m.customer==='寄倉客戶A' && m.quote_no==='20260828-05' && m.date==='2026-08-29')
      && mv[0].name==='琥珀琴酒' && mv[0].volume==='500ml' && mv[1].volume==='750ml');
    check('方向＝入倉、且每筆有防重複的來源碼 src', mv.length===2 && mv.every(m=>m.direction==='in' && /^VF:20260828-05:1:/.test(m.src)));
  }

  /* ---- 3. 已有庫存 → 聰明預設改成「提領」 ---- */
  STORAGE_MOVES=[{move_id:'ST1',date:'2026-08-29',customer:'寄倉客戶A',sku_id:'',name:'琥珀琴酒',volume:'500ml',direction:'in',qty:40,quote_no:'20260828-05',note:'',operator:'M',created_at:''}];
  await page.evaluate(()=>{ ST_MOVES=null; });
  await page.evaluate(()=>openVerifyForm('20260828-05'));
  await page.waitForTimeout(700);
  r = await page.evaluate(()=>({ dir:(document.querySelector('input[name="vf-st-dir"]:checked')||{}).value,
                                 note:document.getElementById('vf-st-opts').innerText }));
  check('客戶寄倉有庫存 → 聰明預設改成「提領」＋顯示剩餘瓶數', r.dir==='out' && /還有/.test(r.note) && /40/.test(r.note));

  /* ---- 4. 沒勾寄倉的單：驗收單完全不變 ---- */
  posted.length=0;
  await page.evaluate(()=>openVerifyForm('20260828-06'));
  await page.waitForTimeout(700);
  r = await page.evaluate(()=>{
    const box=document.getElementById('vf-storage-box');
    document.querySelectorAll('[data-k="thisShip"]').forEach(el=>{ el.value=10; el.dispatchEvent(new Event('input',{bubbles:true})); });
    window.open=()=>({document:{open(){},write(){},close(){}}});
    generateVerifyPdf('full');
    return { box: !!box };
  });
  await page.waitForTimeout(600);
  check('沒勾寄倉的單：不出現寄倉區塊、也不會打寄倉 API',
    r.box===false && !posted.some(b=>b.action==='addStorageMoves') && posted.some(b=>b.action==='saveVerifyForm'));

  /* ---- 5. 取消勾選就不同步 ---- */
  STORAGE_MOVES=[];
  posted.length=0;
  await page.evaluate(()=>{ ST_MOVES=null; });
  await page.evaluate(()=>openVerifyForm('20260828-05'));
  await page.waitForTimeout(700);
  await page.evaluate(()=>{
    document.getElementById('vf-st-on').checked=false;
    document.querySelectorAll('[data-k="thisShip"]').forEach(el=>{ el.value=5; el.dispatchEvent(new Event('input',{bubbles:true})); });
    window.open=()=>({document:{open(){},write(){},close(){}}});
    generateVerifyPdf('partial');
  });
  await page.waitForTimeout(600);
  check('取消「同步更新寄倉」→ 只存留底、不動寄倉',
    !posted.some(b=>b.action==='addStorageMoves') && posted.some(b=>b.action==='saveVerifyForm'));
  await browser.close();
  results.forEach(([s,n])=>console.log(s+'  '+n));
  errors.forEach(e=>console.log('ERROR  '+e));
  const pass=results.filter(x=>x[0]==='PASS').length, fail=results.length-pass;
  console.log(`\n${pass} PASS / ${fail} FAIL / ${errors.length} errors`);
  process.exit(fail||errors.length?1:0);
})();
