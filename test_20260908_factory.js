/* 2026-09-08：廠務／酒譜 APP 連結（13_factory.js）。
   驗：①訂單列徽章（廠務狀態／Lot／金額不符）＋轉單／更新按鈕 ②轉單呼叫 factoryPushOrder ③同步後重抓
   ④驗收單「帶入這次出貨」把配送日／第幾次／本次出貨／已出貨／PM 填好 ⑤對照設定視窗開得起來。
   切回未修版本會 FAIL（fxBadges／fxActionBtn／fxVerifyFill 不存在）。 */
const { chromium } = require('playwright');
async function run(){
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.route('**/script.google.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, users: [], list: [] }) }));
  await page.goto('http://localhost:8899/index.html');
  await page.waitForFunction(() => { const s=document.getElementById('login-user'); return s && s.options && s.options.length>0 && s.options[0].textContent.indexOf('載入中')===-1; }, { timeout: 15000 }).catch(()=>{});
  const results=[]; const check=(name,cond,info)=>results.push({name,pass:!!cond,info});

  const r = await page.evaluate(async () => {
    const g = f => typeof window[f]==='function';
    if(!g('fxBadges')||!g('fxActionBtn')||!g('fxVerifyFill')||!g('fxPushOrder')) return { missing:true };
    const calls=[];
    window.AUTH_TOKEN='t'; AUTH_TOKEN='t';
    window.apiCall = async p => { calls.push(p); if(p.action==='factoryPushOrder') return { ok:true, factory_order_no:'260908-001', updated:false, client:'OEM-Babyface', items:1 }; if(p.action==='factorySync') return { ok:true, synced:2, imported:[], mismatches:[], shipChanged:0, errors:[] }; return { ok:true }; };
    window.readCall = async p => { calls.push(p); if(p.action==='getFactoryLinks') return { ok:true, configured:true, links:[
      { quote_no:'Q-A', factory_order_no:'260908-001', factory_status:'製作中', factory_lot:'15', fin_mismatch:'訂金：報價 30000 ≠ 廠務 25000', factory_fin_json:'{"total":75000,"depositAmount":25000}', last_sync:'2026-09-08 10:00',
        ship_json: JSON.stringify({ orderNo:'260908-001', pm:'小李', batches:[ {seq:1,date:'2026-09-14',lines:[{product:'烏龍茶酒',qty:60}]}, {seq:2,date:'2026-09-16',lines:[{product:'烏龍茶酒',qty:40},{product:'不存在的酒',qty:3}]} ] }) } ] }; return { ok:true }; };
    window.confirm=()=>true; window.alert=()=>{};
    window.loadOrders = async()=>{}; window.loadShipmentBadges=()=>{};
    await loadFactoryLinks(true);
    const oA={no:'Q-A',typeKey:'bottle',src:'std',st:{}}, oB={no:'Q-B',typeKey:'bottle',src:'std',st:{}}, oC={no:'Q-C',typeKey:'banquet',src:'std',st:{}};
    const out={ badgesA: fxBadges(oA), badgesB: fxBadges(oB), btnA: fxActionBtn(oA), btnB: fxActionBtn(oB), btnC: fxActionBtn(oC) };
    // 轉單
    const btn=document.createElement('button'); document.body.appendChild(btn);
    await fxPushOrderDo('Q-B', btn);
    out.pushCall = calls.find(c=>c.action==='factoryPushOrder');
    // 未連結 → 先開連結對話框（列出同客戶未連結的廠務訂單）
    window.apiCall = async p => { calls.push(p); if(p.action==='factoryUnlinkedOrders') return { ok:true, since:'2026-09-09 12:00', orders:[{orderNo:'260905-001',client:'全客製-酒肉朋友',status:'待製作',lot:'1',deliveryDate:'2026-09-20',total:106700,items:'烏龍茶酒×100',createdAt:'2026-09-05 10:00'},{orderNo:'260908-001',client:'經銷商－島羽',status:'待製作',lot:'1',total:0,items:'A×1',createdAt:''}] }; if(p.action==='factoryLinkExisting') return { ok:true }; if(p.action==='factorySync') return { ok:true, synced:2, imported:[], mismatches:[], shipChanged:0, errors:[] }; return { ok:true }; };
    ORDERS_CACHE=[{no:'Q-B',client:'酒肉朋友',typeKey:'bottle',src:'std',st:{}}];
    await fxPushOrder('Q-B', btn);
    out.dlgOpen = document.getElementById('fx-link-overlay').style.display==='flex';
    out.dlgSame = document.querySelectorAll('#fx-link-body input[name="fx-link-pick"]').length;
    out.dlgSameFirst = (document.querySelector('#fx-link-body input[name="fx-link-pick"]')||{}).value;
    document.querySelector('#fx-link-body input[name="fx-link-pick"]').checked=true;
    await fxLinkExisting();
    const lk = calls.find(c=>c.action==='factoryLinkExisting'); out.linkCall = lk ? [lk.quote_no, lk.factory_order_no] : null;
    out.dlgClosed = document.getElementById('fx-link-overlay').style.display==='none';
    // 同步
    await fxSyncNow(null,false);
    out.syncCall = !!calls.find(c=>c.action==='factorySync');
    // 驗收單帶入
    VERIFY_DATA={ no:'Q-A', client:'Babyface', priorCount:0, rows:[{name:'烏龍茶酒',lot:'',vol:'700',ordered:100,mfg:'',thisShip:100,shipped:0}] };
    if(typeof buildVerifyModal==='function'){ buildVerifyModal(''); }
    out.barExists = !!document.getElementById('fx-vf-bar');
    out.opts = document.querySelectorAll('#fx-vf-batch option').length;
    document.getElementById('fx-vf-batch').value='2';
    fxVerifyFill('Q-A');
    out.fill = { thisShip: document.querySelector('#vf-body .vfi[data-k="thisShip"]').value, shipped: document.querySelector('#vf-body .vfi[data-k="shipped"]').value,
      date: document.getElementById('vf-shipdate').value, seq: document.getElementById('vf-shipseq').value, pm: document.getElementById('vf-shipper').value,
      remain: document.getElementById('vf-remain-0').textContent };
    // 對照視窗
    window.readCall = async p => { if(p.action==='getFactoryMap') return { ok:true, map:[{kind:'client',qs_name:'Babyface',factory_name:'OEM-Babyface'},{kind:'product',qs_name:'A',factory_name:'A V2'}] }; if(p.action==='getCustomers') return { ok:true, customers:[{name:'Babyface',active:'Y'},{name:'島羽',active:'Y'}] }; return {ok:true}; };
    window.apiCall = async p => { calls.push(p); if(p.action==='factoryPing') return { ok:true, env:'PROD', time:'now' }; return { ok:true, saved:3 }; };
    await fxOpenMap();
    out.mapInputs = document.querySelectorAll('#fx-map-body .fx-map-c').length;
    out.mapPrefill = document.querySelector('#fx-map-body .fx-map-c[data-qs="Babyface"]').value;
    out.mapPing = document.getElementById('fx-map-body').textContent.indexOf('廠務連線正常')>=0;
    await fxSaveMap();
    const sv = calls.find(c=>c.action==='saveFactoryMap');
    out.saveRows = sv ? sv.rows : null;
    return out;
  });

  check('1 徽章：廠務狀態＋Lot', !r.missing && /製作中/.test(r.badgesA) && /Lot 15/.test(r.badgesA), r.badgesA);
  check('2 徽章：金額不符紅字（含明細 title）', !r.missing && /金額與廠務不符/.test(r.badgesA) && /25000/.test(r.badgesA), r.badgesA);
  check('3 沒連結的單沒有徽章', !r.missing && r.badgesB==='', r.badgesB);
  check('4 已連結顯示「更新廠務訂單」、未連結顯示「轉廠務訂單」、宴會單沒有按鈕', !r.missing && /更新廠務訂單/.test(r.btnA) && /轉廠務訂單/.test(r.btnB) && r.btnC==='', JSON.stringify([r.btnA.slice(0,40),r.btnB.slice(0,40),r.btnC]));
  check('5 轉單打 factoryPushOrder 且帶 token＋quote_no', !r.missing && r.pushCall && r.pushCall.token==='t' && r.pushCall.quote_no==='Q-B', JSON.stringify(r.pushCall));
  check('6 同步打 factorySync', !r.missing && r.syncCall);
  check('6b 未連結的單按轉單先開對話框，同客戶的廠務單排前面（前綴剝掉比對）', !r.missing && r.dlgOpen && r.dlgSame===2 && r.dlgSameFirst==='260905-001', JSON.stringify([r.dlgOpen,r.dlgSame,r.dlgSameFirst]));
  check('6c 勾選後連結：打 factoryLinkExisting 帶兩個單號並關閉對話框', !r.missing && r.linkCall && r.linkCall[0]==='Q-B' && r.linkCall[1]==='260905-001' && r.dlgClosed, JSON.stringify(r.linkCall));
  check('7 驗收單上方出現廠務出貨條（2 個批次）', !r.missing && r.barExists && r.opts===2, JSON.stringify([r.barExists,r.opts]));
  check('8 帶入第 2 次：本次 40、已出貨 60、日期／第幾次／PM 都填、待出貨 0', !r.missing && r.fill.thisShip==='40' && r.fill.shipped==='60' && r.fill.date==='2026-09-16' && r.fill.seq==='2' && r.fill.pm==='小李' && r.fill.remain==='0', JSON.stringify(r.fill));
  check('9 對照視窗：客戶列＝主檔 2 筆、預填、連線正常', !r.missing && r.mapInputs===2 && r.mapPrefill==='OEM-Babyface' && r.mapPing, JSON.stringify([r.mapInputs,r.mapPrefill,r.mapPing]));
  check('10 儲存對照送出 client×2＋product×1', !r.missing && r.saveRows && r.saveRows.filter(x=>x.kind==='client').length===2 && r.saveRows.filter(x=>x.kind==='product').length===1 && r.saveRows.find(x=>x.qs_name==='A').factory_name==='A V2', JSON.stringify(r.saveRows));
  check('11 沒有 JS 錯誤', errors.length===0, errors.join(' | '));
  results.forEach(x=>console.log((x.pass?'PASS':'FAIL')+' '+x.name+(x.pass?'':'  ← '+(x.info||''))));
  console.log(`${results.filter(x=>x.pass).length}/${results.length} PASS`);
  await browser.close();
}
run().catch(e=>{ console.error(e); process.exit(1); });
