/* 驗證：容量填 550 是否完整走完流程（品項表→預覽/列印 HTML→送出給後端的品項資料） */
const {chromium}=require('playwright');
const path=require('path');

(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const p=await b.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto('file://'+path.join(__dirname,'index.html'));
  await p.waitForTimeout(600);

  const r=await p.evaluate(()=>{
    setType('bottle'); setTaxMode('inc');
    document.getElementById('taxrate').value='5';
    botItems=[]; document.getElementById('itbody-bot').innerHTML='';
    addBotRow({name:'梨香蜜桃紅烏龍調酒', vol:550, price:450, qty:200});
    extras=[];
    calc();
    const row=document.querySelector('#itbody-bot > div');
    const volInput=row.querySelector('[data-f="vol"]');
    const html=buildStdPagesHtml('');
    // 送出給後端的品項（存檔時真正寫進資料庫的內容）
    const payloadItems=(typeof collectItemsForSave==='function')?collectItemsForSave():null;
    return {
      欄位值: volInput.value,
      欄位型別: volInput.type,
      有沒有被限制在選單內: volInput.tagName+'/'+(volInput.getAttribute('list')||'無'),
      預覽是否出現550ml: /550ml/.test(html),
      預覽是否殘留500ml: /500ml/.test(html),
      小計: document.getElementById('t-tot').textContent,
      datalist選項: Array.from(document.querySelectorAll('#vol-options option')).map(o=>o.value).join('、'),
    };
  });

  console.log('\n──── 容量 550 測試 ────');
  for(const k of Object.keys(r)) console.log(k+'：'+r[k]);
  console.log(errs.length?('JS 錯誤：'+errs.join(' | ')):'無 JS 錯誤');
  await b.close();
})();
