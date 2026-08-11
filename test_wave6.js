/* 回歸測試：2026-08-11 優化第二波
   #A 訂單列「停在〈某關卡〉N 天」徽章（ordStageSince／ordStuckBadge）
   #B 月報表未收尾款的帳齡（rptAgeDays）＋帳齡分組卡＋帳齡欄＋欠最久排最前面
   #C 後端每日待辦信（digestMailSubject_／digestMailBody_／setupDailyDigestMail 的形狀）

   跑法：node test_wave6.js（需要先起 http server：setsid python3 -m http.server 8899 &） */
const {chromium}=require('playwright');
const path=require('path');
const fs=require('fs');

const results=[]; const check=(n,ok,d)=>results.push({n,ok:!!ok,d});
const ymd=off=>{ const d=new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()+off); return d.toISOString().slice(0,10); };

/* ── #C：後端那幾支不開瀏覽器，直接抽出來跑 ── */
function testBackendMail(){
  const src=fs.readFileSync(path.join(__dirname,'gas','v33_digest.gs'),'utf8');
  const need=['function sendDailyDigestMail()','function setupDailyDigestMail()',
              'function previewDailyDigestMail()','function removeDailyDigestMail()',
              'function digestMailSubject_(','function digestMailBody_(','function digestMailTo_('];
  need.forEach(k=>check('#C 有 '+k.replace('function ','').replace('(',''), src.includes(k)));
  check('#C 觸發器進入點不帶底線（否則掛不上）', /ScriptApp\.newTrigger\('sendDailyDigestMail'\)/.test(src));
  check('#C 掛新的之前會先清舊的（不會長出第二個）',
        /getProjectTriggers\(\)[\s\S]{0,200}sendDailyDigestMail[\s\S]{0,200}deleteTrigger/.test(src));
  check('#C 有 DIGEST_MAIL_OFF 暫停開關', src.includes('DIGEST_MAIL_OFF'));
  check('#C 待辦讀取失敗時會另外寄一封通知（不會安靜不寄）',
        /catch \(e\) \{[\s\S]{0,300}MailApp\.sendEmail\([\s\S]{0,120}產生失敗/.test(src));
  check('#C preview 不會寄信', /function previewDailyDigestMail\(\)[\s\S]{0,300}\}/.test(src) &&
        !/function previewDailyDigestMail\(\)[\s\S]{0,300}MailApp\.sendEmail/.test(src));

  // 主旨組字：把 digestMailSubject_ 抽出來實跑
  const m=src.match(/function digestMailSubject_\(d\) \{[\s\S]*?\n\}/);
  check('#C 抽得出 digestMailSubject_', !!m);
  if(m){
    const fn=new Function('return ('+m[0].replace('function digestMailSubject_','function')+')')();
    const s1=fn({today:'2026-08-12', ship_due:[{urgent:true},{urgent:true}], final_due:[{urgent:true}],
                 no_invoice:[], no_scan:[], calendar:[]});
    check('#C 主旨帶出件數：該出貨 2、催尾款 1',
          s1.includes('08/12')&&s1.includes('該出貨 2')&&s1.includes('催尾款 1'), s1);
    check('#C 主旨不列出 0 件的類別', !s1.includes('未開發票')&&!s1.includes('行程'), s1);
    const s2=fn({today:'2026-08-12', ship_due:[], final_due:[], no_invoice:[], no_scan:[], calendar:[]});
    check('#C 沒事的日子主旨寫「今天沒事」', s2.includes('今天沒事'), s2);
    const s3=fn({today:'2026-08-12', ship_due:[{urgent:false},{urgent:true}], final_due:[], no_invoice:[], no_scan:[], calendar:[]});
    check('#C 非急件不計入主旨（該出貨 1 不是 2）', s3.includes('該出貨 1'), s3);
  }
}

(async()=>{
  testBackendMail();

  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const p=await b.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto('http://localhost:8899/index.html');
  await p.waitForTimeout(600);

  /* ── #A：卡關天數 ── */
  let r=await p.evaluate(([d3,d10,d20,d45])=>{
    const mk=(no,st,qd)=>({no, client:'測試客戶', type:'瓶裝', typeKey:'bottle', total:10000,
                           quoteDate:qd||d45, expiry:'', st, src:'std'});
    return {
      // 報價中 3 天前開的單 → 不顯示（7 天內是正常流程）
      fresh: ordStuckBadge(mk('A-1',{quote_no:'A-1',status:'quoted'},d3)),
      // 報價中 10 天 → 橘（>=7 <14 其實是 info；這裡用 20 天測 warn）
      quoted10: ordStuckBadge(mk('A-2',{quote_no:'A-2',status:'quoted'},d10)),
      quoted20: ordStuckBadge(mk('A-3',{quote_no:'A-3',status:'quoted'},d20)),
      quoted45: ordStuckBadge(mk('A-4',{quote_no:'A-4',status:'quoted'},d45)),
      // 排產中：以訂金日起算
      prod20: ordStuckBadge(mk('A-5',{quote_no:'A-5',status:'production',deposit_date:d20},d45)),
      // 已出貨：以實際出貨日起算（不是訂金日）
      ship10: ordStuckBadge(mk('A-6',{quote_no:'A-6',status:'shipped',deposit_date:d45,ship_date_actual:d10},d45)),
      // 結案／取消不算
      closed: ordStuckBadge(mk('A-7',{quote_no:'A-7',status:'closed',deposit_date:d45,closed_at:d45},d45)),
      cancelled: ordStuckBadge(mk('A-8',{quote_no:'A-8',status:'cancelled'},d45)),
      // 沒有可用日期 → 不顯示（注意這裡不能用 mk，它會補上預設報價日）
      nodate: ordStuckBadge({no:'A-9', client:'x', quoteDate:'', st:{quote_no:'A-9',status:'quoted'}, src:'std'}),
      days_prod20: ordStageSince(mk('A-5',{quote_no:'A-5',status:'production',deposit_date:d20},d45)),
      days_ship10: ordStageSince(mk('A-6',{quote_no:'A-6',status:'shipped',deposit_date:d45,ship_date_actual:d10},d45))
    };
  }, [ymd(-3), ymd(-10), ymd(-20), ymd(-45)]);
  check('#A 3 天內不顯示徽章（正常流程不吵）', r.fresh==='', r.fresh);
  check('#A 10 天顯示（藍色 info）', r.quoted10.includes('停在')&&r.quoted10.includes('10 天')&&r.quoted10.includes('ob info'), r.quoted10);
  check('#A 20 天轉橘（warn）', r.quoted20.includes('ob warn')&&r.quoted20.includes('20 天'), r.quoted20);
  check('#A 45 天轉紅（red）', r.quoted45.includes('ob red'), r.quoted45);
  check('#A 排產中以訂金日起算（20 天）', r.days_prod20===20 && r.prod20.includes('排產中'), JSON.stringify([r.days_prod20,r.prod20]));
  check('#A 已出貨以實際出貨日起算（10 天，不是訂金的 45 天）', r.days_ship10===10 && r.ship10.includes('已出貨'), JSON.stringify([r.days_ship10,r.ship10]));
  check('#A 結案不顯示', r.closed==='', r.closed);
  check('#A 取消不顯示', r.cancelled==='', r.cancelled);
  check('#A 沒日期不顯示（不會出現 NaN）', r.nodate==='', r.nodate);

  /* ── #B：帳齡 ── */
  r=await p.evaluate(([d10,d45,d75,d200])=>{
    const mk=(no,st,qd)=>({no, client:'客戶'+no, type:'瓶裝', typeKey:'bottle', total:10000,
                           quoteDate:qd||d10, expiry:'', st, src:'std'});
    const ageOf=o=>rptAgeDays(o);
    return {
      byInvoice: ageOf(mk('B-1',{quote_no:'B-1',status:'invoiced',invoice_date:d45,ship_date_actual:d75})),
      byShip:    ageOf(mk('B-2',{quote_no:'B-2',status:'shipped',ship_date_actual:d75})),
      byEst:     ageOf(mk('B-3',{quote_no:'B-3',status:'shipped',final_date_est:d10})),
      byQuote:   ageOf(mk('B-4',{quote_no:'B-4',status:'shipped'},d200)),
      none:      ageOf({no:'B-5', client:'x', quoteDate:'', st:{quote_no:'B-5',status:'shipped'}})
    };
  }, [ymd(-10), ymd(-45), ymd(-75), ymd(-200)]);
  check('#B 有發票日就用發票日（45 天，不是出貨的 75）', r.byInvoice===45, String(r.byInvoice));
  check('#B 沒發票用實際出貨日（75 天）', r.byShip===75, String(r.byShip));
  check('#B 都沒有才退回預計尾款日（10 天）', r.byEst===10, String(r.byEst));
  check('#B 再退回報價日（200 天）', r.byQuote===200, String(r.byQuote));
  check('#B 完全沒日期回 null（畫面顯示 —）', r.none===null, String(r.none));

  // 整張月報表渲染
  r=await p.evaluate(([d10,d45,d75,d200])=>{
    ORDERS_CACHE=[
      {no:'R-新', client:'新客戶', type:'瓶裝', typeKey:'bottle', total:10000, quoteDate:d10, expiry:'',
       st:{quote_no:'R-新', status:'shipped', grand_total:10000, deposit_amt:0, ship_date_actual:d10}, src:'std'},
      {no:'R-舊', client:'老賴客戶', type:'瓶裝', typeKey:'bottle', total:50000, quoteDate:d200, expiry:'',
       st:{quote_no:'R-舊', status:'invoiced', grand_total:50000, deposit_amt:0, invoice_no:'AB123', invoice_date:d200, ship_date_actual:d200}, src:'std'},
      {no:'R-中', client:'中間客戶', type:'瓶裝', typeKey:'bottle', total:20000, quoteDate:d75, expiry:'',
       st:{quote_no:'R-中', status:'shipped', grand_total:20000, deposit_amt:0, ship_date_actual:d45}, src:'std'}
    ];
    SHP_SUM=null; ORDER_VSUM=null;
    gotoPage('report'); renderReport();
    const box=document.getElementById('rpt-box').innerHTML;
    const order=['R-舊','R-中','R-新'].map(k=>box.indexOf(k));
    return {box, order, hasAgeCol:/<th[^>]*>帳齡<\/th>/.test(box)};
  }, [ymd(-10), ymd(-45), ymd(-75), ymd(-200)]);
  check('#B 表頭多了「帳齡」欄', r.hasAgeCol, String(r.hasAgeCol));
  check('#B 欠最久的排最前面（R-舊 → R-中 → R-新）',
        r.order[0]>0 && r.order[0]<r.order[1] && r.order[1]<r.order[2], JSON.stringify(r.order));
  check('#B 有帳齡分組卡', r.box.includes('rpt-age-box')&&r.box.includes('帳齡 超過 90 天'), '');
  check('#B 超過 90 天那組金額＝50,000', /帳齡 超過 90 天[\s\S]{0,160}\$50,000/.test(r.box), '');
  check('#B ≤30 天那組金額＝10,000', /帳齡 ≤30 天[\s\S]{0,160}\$10,000/.test(r.box), '');
  check('#B 統計卡仍然是 6 張（沒有動到既有版面）',
        (r.box.match(/class="rpt-stat"/g)||[]).length===6, String((r.box.match(/class="rpt-stat"/g)||[]).length));
  check('#B 合計列的 colspan 有跟著加欄（版面不跑掉）', r.box.includes('colspan="3"'), '');
  check('#B 舊單標紅、新單不標紅', /R-舊[\s\S]{0,600}ob red/.test(r.box) && !/R-新[\s\S]{0,600}ob red/.test(r.box), '');

  console.log('\n────── 2026-08-11 優化第二波驗證 ──────');
  let bad=0;
  results.forEach(x=>{ if(!x.ok) bad++; console.log((x.ok?'✅':'❌')+' '+x.n+(x.ok?'':'  ← '+x.d)); });
  if(errs.length){ bad++; console.log('❌ JS 錯誤：'+errs.join(' | ')); } else console.log('✅ 無 JS 錯誤');
  console.log(bad?`共 ${bad} 項未通過`:`全部通過（${results.length} 項）`);
  await b.close();
  process.exit(bad?1:0);
})();
