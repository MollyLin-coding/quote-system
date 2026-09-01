/* 2026-09-02：驗收單「列印／另存為 PDF」的預設檔名（<title>）要有 單號＋客戶名稱＋LOT＋第幾次出貨。
   2026-08-31 已加 LOT 與第幾次出貨；這次 Molly 追加客戶名稱。 */
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const results=[]; const check=(n,c,x)=>results.push([c?'PASS':'FAIL',n,x||'']);

(async()=>{
  const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const errors=[];
  const p=await browser.newPage();
  p.on('pageerror',e=>errors.push('PAGEERROR: '+e.message));
  await p.route('**/script.google.com/**', async route=>{
    let b={}; try{ b=JSON.parse(route.request().postData()||'{}'); }catch(e){}
    let r;
    if(b.action==='login') r={ok:true, token:'t', role:'owner', name:'Molly'};
    else if(b.action==='getLoginUsers') r={ok:true, users:['Molly']};
    else if(b.action==='getVerifyKey') r={ok:true, k:'testkey'};
    else if(b.action==='batch') r={ok:true, results:(b.calls||[]).map(()=>({ok:true}))};
    else r={ok:true, quotes:[], orders:[], records:[], items:[], moves:[]};
    await route.fulfill({status:200, headers:{'Access-Control-Allow-Origin':'*'}, contentType:'application/json', body:JSON.stringify(r)});
  });
  await p.goto('http://localhost:8899/index.html');
  await p.waitForFunction(()=>{const e=document.getElementById('login-user');return e&&!/載入中/.test(e.textContent||'');},{timeout:15000}).catch(()=>{});
  await p.evaluate(async()=>{ window.confirm=()=>true; window.alert=()=>{}; document.getElementById('login-pin').value='1'; await doLogin(); });
  await p.waitForTimeout(400);

  const title=async(d)=>p.evaluate(o=>{
    const html=buildVerifyDocHtml(o,{preview:true});
    const m=html.match(/<title>([\s\S]*?)<\/title>/);
    return m?m[1]:'(沒有 title)';
  }, d);

  const base={ no:'20260902-01', client:'南野子', lot:'LOT-A1', shipSeq:2, shipDate:'2026-09-02',
               mode:'full', rows:[{name:'測試酒', vol:'700', thisShip:10, qty:10}] };

  const t1=await title(base);
  check('檔名有單號', /20260902-01/.test(t1), t1);
  check('檔名有客戶名稱（這次新加的）', /南野子/.test(t1), t1);
  check('檔名有客戶批號 LOT', /LOT-A1/.test(t1), t1);
  check('檔名有第幾次出貨', /第2次出貨/.test(t1), t1);
  check('順序＝驗收單_單號_客戶_LOT_第N次出貨', t1==='驗收單_20260902-01_南野子_LOT-A1_第2次出貨', t1);

  const t2=await title(Object.assign({}, base, {lot:''}));
  check('沒填 LOT 時不會多一段底線', t2==='驗收單_20260902-01_南野子_第1次出貨' || t2==='驗收單_20260902-01_南野子_第2次出貨', t2);
  check('沒填 LOT 時客戶名稱仍在', /南野子/.test(t2), t2);

  const t3=await title(Object.assign({}, base, {client:''}));
  check('沒有客戶名稱時不會多一段底線', t3==='驗收單_20260902-01_LOT-A1_第2次出貨', t3);

  /* 檔名不能出現 Windows/macOS 禁用字元，否則瀏覽器另存時會截斷或整個換掉 */
  const t4=await title(Object.assign({}, base, {client:'好野吧 / 台北店', lot:'A:B*C?D"E<F>G|H'}));
  check('客戶名稱含 / 會被換掉', !/[\\/:*?"<>|]/.test(t4), t4);
  check('LOT 含禁用字元也一起處理', !/[\\/:*?"<>|]/.test(t4), t4);
  check('客戶名稱中間的空白會拿掉（檔名比較好認）', /好野吧-台北店/.test(t4), t4);

  const t5=await title(Object.assign({}, base, {client:'一二三四五六七八九十'.repeat(5)}));
  check('客戶名稱過長會截斷（避免檔名爆掉）', t5.length<70, 'len='+t5.length+' '+t5);
  check('截斷後單號與第幾次出貨都還在', /20260902-01/.test(t5)&&/第2次出貨/.test(t5), t5);

  /* 寄售鋪貨驗收單那張也要做同樣的字元處理 */
  const t6=await p.evaluate(()=>{
    const html=buildConsignVerifyDocHtml
      ? buildConsignVerifyDocHtml({client:'好野吧 / 台北店', shipDate:'2026-09-02', rows:[]},{preview:true})
      : '(沒有這個函式)';
    const m=String(html).match(/<title>([\s\S]*?)<\/title>/);
    return m?m[1]:String(html).slice(0,40);
  }).catch(e=>'ERR '+e.message);
  check('寄售鋪貨驗收單檔名也不含禁用字元', typeof t6==='string' && !/[\\/:*?"<>|]/.test(t6.replace('寄售鋪貨驗收單','')), t6);

  results.forEach(r=>console.log(r[0], r[1], r[2]?('  → '+r[2]):''));
  const fails=results.filter(r=>r[0]==='FAIL').length;
  console.log(errors.length?('JS ERRORS: '+errors.slice(0,3).join(' | ')):'NO JS ERRORS');
  console.log(fails?(fails+' FAIL / '+results.length):('ALL '+results.length+' PASS'));
  await browser.close();
})();
