/* 用 Molly 截圖那張「酒肉朋友」報價單的實際數字，比對新舊版算出來的訂金/尾款
   酒款 $450 × 200 = $90,000（單價含稅）、SGS 檢驗費 $4,000、GS1條碼登記費 $1,500、含稅模式 5%
   Molly 期望：訂金 $50,500、尾款 $45,000 */
const {chromium}=require('playwright');
const {execSync}=require('child_process');
const path=require('path'), fs=require('fs');

const money=s=>parseFloat(String(s).replace(/[$,]/g,''))||0;

async function run(dir,label){
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const p=await b.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto('file://'+path.join(dir,'index.html'));
  await p.waitForTimeout(500);
  const out=await p.evaluate(()=>{
    setTaxMode('inc');
    document.getElementById('taxrate').value='5';
    botItems=[]; document.getElementById('itbody-bot').innerHTML='';
    addBotRow({name:'梨香蜜桃紅烏龍調酒', vol:500, price:450, qty:200});
    extras=[{n:'SGS 檢驗費（1款 × $4,000）',a:4000},{n:'GS1條碼登記費（1款 × $1,500）',a:1500}];
    setPay(0);
    document.getElementById('dep-pct').value='50';
    const dd=document.getElementById('dep-days'); if(dd) dd.value='7';
    calc();
    return {
      tot:document.getElementById('t-tot').textContent,
      dep:document.getElementById('dep-amt').textContent,
      bal:document.getElementById('dep-bal').textContent,
      terms:getPayTerms(),
    };
  });
  await b.close();
  console.log(`\n──────── ${label} ────────`);
  console.log(`總計 ${out.tot}　訂金 ${out.dep}　尾款 ${out.bal}`);
  console.log('條款：'+out.terms.replace(/<br>/g,'\n      '));
  if(errs.length) console.log('JS 錯誤：'+errs.join(' | '));
  return {dep:money(out.dep), bal:money(out.bal), tot:money(out.tot)};
}

(async()=>{
  // 目前工作目錄＝改版後的新版
  const now=await run(__dirname,'新版（本次改好、尚未上線）');
  // 從 git 取出線上那版（origin/main = 192afdb）到暫存目錄比對
  const old='/tmp/old-deployed';
  fs.rmSync(old,{recursive:true,force:true}); fs.mkdirSync(old,{recursive:true});
  execSync(`cd ${__dirname} && git archive 192afdb | tar -x -C ${old}`);
  const was=await run(old,'線上版（origin/main 192afdb，Molly 截圖跑的就是這版）');

  console.log('\n──────── 對照 Molly 期望 ────────');
  const want={dep:50500, bal:45000, tot:95500};
  const chk=(label,got)=>console.log(
    `${got.dep===want.dep&&got.bal===want.bal&&got.tot===want.tot?'✅':'❌'} ${label}：`+
    `總計 ${got.tot}（期望 ${want.tot}）、訂金 ${got.dep}（期望 ${want.dep}）、尾款 ${got.bal}（期望 ${want.bal}）`);
  chk('新版', now);
  chk('線上版', was);
})();
