/* 2026-09-01 複檢第三批的離線驗證（#9 #12 #17 #20 #22 #24 #25 #26 #27）。 */
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const results=[]; const check=(n,c,x)=>results.push([c?'PASS':'FAIL',n,x||'']);

(async()=>{
  const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const errors=[]; let CONFIRMS=[]; let CONFIRM_ANSWER=true;
  const mk=async(role)=>{
    const p=await browser.newPage();
    p.on('pageerror',e=>errors.push('PAGEERROR: '+e.message));
    await p.route('**/script.google.com/**', async route=>{
      let b={}; try{ b=JSON.parse(route.request().postData()||'{}'); }catch(e){}
      let r;
      if(b.action==='login') r={ok:true, token:'t', role:role||'owner', name:role==='general'?'阿軒':'Molly'};
      else if(b.action==='getLoginUsers') r={ok:true, users:['Molly','阿軒']};
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

  /* ---- #12 重複行程：兩邊共用同一份判斷，字串型別也要算得到 ---- */
  const p1=await mk();
  const r12=await p1.evaluate(()=>{
    const wed=new Date(2026,8,2);            // 2026-09-02 星期三
    const num={kind:'recur', recur_json:JSON.stringify({freq:'weekly', weekday:3})};
    const str={kind:'recur', recur_json:JSON.stringify({freq:'weekly', weekday:'3'})};
    const mon={kind:'recur', recur_json:JSON.stringify({freq:'monthly', day:'2'})};
    const yr ={kind:'recur', recur_json:JSON.stringify({freq:'yearly', month:'9', day:'2'})};
    const no ={kind:'recur', recur_json:JSON.stringify({freq:'weekly', weekday:5})};
    return { shared:typeof recurHitsOn==='function',
             num:recurHitsOn(num,wed), str:recurHitsOn(str,wed), mon:recurHitsOn(mon,wed),
             yr:recurHitsOn(yr,wed), no:recurHitsOn(no,wed) };
  });
  check('#12 月曆與今日待辦共用 recurHitsOn', r12.shared===true);
  check('#12 weekday 存成字串「3」也算得到（原本月曆會整條消失）', r12.str===true && r12.num===true, JSON.stringify(r12));
  check('#12 每月／每年也正確，非當天不誤判', r12.mon===true && r12.yr===true && r12.no===false, JSON.stringify(r12));

  /* ---- #9 匯出 PDF 未存檔會先問 ---- */
  const p2=await mk();
  await p2.evaluate(()=>{ window.__c=[]; window.confirm=(m)=>{ window.__c.push(m); return false; }; });
  const r9=await p2.evaluate(()=>{
    gotoPage('new'); setType('bottle'); editingQuoteNo=null;
    let opened=false; const ow=window.open; window.open=()=>{ opened=true; return null; };
    exportPDF();
    window.open=ow;
    return { asked:window.__c.length, msg:(window.__c[0]||'').slice(0,24), opened };
  });
  check('#9 沒存過就按匯出 PDF → 會先問（而且按取消就不會匯出）', r9.asked===1 && r9.opened===false, JSON.stringify(r9));
  check('#9 提示有講到「還沒儲存」', /還沒儲存/.test(r9.msg), 'msg='+r9.msg);

  const r9b=await p2.evaluate(()=>{
    window.__c=[]; editingQuoteNo='20260901-01'; if(typeof FORM_DIRTY!=='undefined') FORM_DIRTY=false;
    let opened=false; const ow=window.open; window.open=()=>{ opened=true; return {document:{write(){},close(){}}, focus(){}, print(){}, onload:null}; };
    try{ exportPDF(); }catch(e){}
    window.open=ow;
    return { asked:window.__c.length, opened };
  });
  check('#9 已存好且沒改動 → 不會多問，直接匯出', r9b.asked===0 && r9b.opened===true, JSON.stringify(r9b));

  /* ---- #25 編輯進度改過沒存，關閉會先問 ---- */
  const p3=await mk();
  const r25=await p3.evaluate(()=>{
    ORDERS_CACHE=[{no:'T-1', client:'測試客戶', type:'bottle', total:1000, quoteDate:'2026-09-01', st:{status:'quoted'}}];
    openOrdEdit('T-1');                               // 開啟時應該自己存下快照
    const snapSet=!!ORD_EDIT_SNAP;
    const asked=[]; const oc=window.confirm; window.confirm=(m)=>{ asked.push(m); return false; };
    closeOrdEdit();                                   // 沒改動 → 不該問
    const noChange=asked.length;
    openOrdEdit('T-1');                               // 重新開一次再改
    document.getElementById('oe-invoice_no').value='AB-12345678';
    closeOrdEdit();                                   // 改過 → 要問，而且按取消不關
    const changed=asked.length;
    const stillOpen=getComputedStyle(document.getElementById('oe-overlay')).display!=='none';
    window.confirm=()=>true;
    closeOrdEdit();
    const closedNow=getComputedStyle(document.getElementById('oe-overlay')).display==='none';
    window.confirm=oc;
    return { snapSet, noChange, changed, stillOpen, closedNow, msg:(asked[0]||'').slice(0,18) };
  });
  check('#25 開啟時會自己記下快照（原本沒接上，等於防呆沒作用）', r25.snapSet===true, JSON.stringify(r25));
  check('#25 沒改過就關 → 不會多問', r25.noChange===0, JSON.stringify(r25));
  check('#25 改過沒存要關 → 會問，按取消不會關掉', r25.changed===1 && r25.stillOpen===true, JSON.stringify(r25));
  check('#25 確認後才真的關閉', r25.closedNow===true);

  /* ---- #26 刪除重複行程要講清楚會刪整條 ---- */
  const p4=await mk();
  const r26=await p4.evaluate(async()=>{
    CAL_ITEMS=[{item_id:'C1', kind:'recur', title:'每月跟廠商對帳'},{item_id:'C2', kind:'memo', title:'一般備忘'}];
    const asked=[]; const oc=window.confirm; window.confirm=(m)=>{ asked.push(m); return false; };
    CAL_EDIT_ID='C1'; await deleteCalItem();
    CAL_EDIT_ID='C2'; await deleteCalItem();
    window.confirm=oc;
    return { recurMsg:asked[0]||'', memoMsg:asked[1]||'' };
  });
  check('#26 刪重複行程會說「刪掉的是整條」', /重複行程/.test(r26.recurMsg) && /整條/.test(r26.recurMsg), r26.recurMsg.slice(0,40));
  check('#26 一般備忘的訊息會帶出標題、不會誤嚇', /一般備忘/.test(r26.memoMsg) && !/整條/.test(r26.memoMsg), r26.memoMsg.slice(0,30));

  /* ---- #22 處理人員＝登入的人 ---- */
  const p5=await mk('general');
  const r22=await p5.evaluate(()=>({ hdl:document.getElementById('f-hdl').value, user:USER_NAME }));
  check('#22 阿軒登入時，報價單的處理人員不再寫死 Molly', r22.hdl==='阿軒', JSON.stringify(r22));

  /* ---- #22 驗收單 PM 記住上次 ---- */
  const r22b=await p5.evaluate(()=>{
    vfRememberPm('陳小姐');
    return { saved:VF_LAST_PM, ls:(function(){ try{ return localStorage.getItem('qs_vf_pm'); }catch(e){ return null; } })() };
  });
  check('#22 驗收單 PM 會被記住（下一張自動帶）', r22b.saved==='陳小姐' && r22b.ls==='陳小姐', JSON.stringify(r22b));

  /* ---- #24 客訴選單號帶客戶 ---- */
  const p6=await mk();
  const r24=await p6.evaluate(()=>{
    VM_DATA={ reports:[{no:'20260901-01', client:'日光貳叁'}], forms:[] };
    openVmManual();
    document.getElementById('vmm-no').value='20260901-01';
    vmManualNoChanged();
    const auto=document.getElementById('vmm-client').value;
    document.getElementById('vmm-client').value='我自己打的客戶';
    document.getElementById('vmm-client').dataset.auto='0';
    document.getElementById('vmm-no').value='20260901-01';
    vmManualNoChanged();
    return { auto, kept:document.getElementById('vmm-client').value };
  });
  check('#24 選了單號會自動帶出客戶', r24.auto==='日光貳叁', JSON.stringify(r24));
  check('#24 她自己打過的客戶名不會被蓋掉', r24.kept==='我自己打的客戶');

  /* ---- #20 入口 ---- */
  const p7=await mk();
  const r20=await p7.evaluate(()=>({
    tdFn: typeof tdOpenVerifyForm==='function',
    ordFn: typeof ordOpenVerifyForm==='function',
    ordBtn: !!Array.from(document.querySelectorAll('#oe-overlay button')).find(b=>/開驗收單/.test(b.textContent)),
    hint: /要開新的驗收單/.test(document.body.innerHTML)
  }));
  check('#20 今日待辦與編輯進度都有「開驗收單」的入口', r20.tdFn&&r20.ordFn&&r20.ordBtn, JSON.stringify(r20));
  check('#20 出貨驗收頁有指路說明', r20.hint===true);

  /* ---- #27 文案 ---- */
  const r27=await p7.evaluate(()=>{
    const html=document.body.innerHTML;
    return { cloud:/儲存到雲端/.test(html), oem:/代工／貼牌/.test(html),
             cusSync:/一起更新客戶管理/.test(html), forms:/已開過的驗收單/.test(String(renderVerifyMgmt)) };
  });
  check('#27 文案已改（儲存到雲端／代工貼牌／一起更新客戶管理）', r27.cloud&&r27.oem&&r27.cusSync, JSON.stringify(r27));
  check('#27 分頁名「驗收單留底」改成「已開過的驗收單」', r27.forms===true);

  results.forEach(r=>console.log(r[0], r[1], r[2]?('  → '+r[2]):''));
  const fails=results.filter(r=>r[0]==='FAIL').length;
  console.log(errors.length?('JS ERRORS: '+errors.slice(0,4).join(' | ')):'NO JS ERRORS');
  console.log(fails?(fails+' FAIL / '+results.length):('ALL '+results.length+' PASS'));
  await browser.close();
})();
