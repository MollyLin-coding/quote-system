/* 2026-09-24 Molly：付款條件改版
   ①「比例訂金＋尾款」的尾款時間可選「驗收後 N 日內」或「驗收後第 N 個月 N 號」
   ②「隔月指定日付款」併進 ①（分頁隱藏；0%＋驗收後第 N 個月 N 號＝原本的全額月結）
   ③ 到貨驗收後付款／自訂／不顯示 不動；舊單 paymentType 2 載入改走 Tab0 並解回月數與日期
   ④ 2026-09-24 二修：Molly 說「隔 N 個月」不夠明確，改成「驗收後第 N 個月 N 號」（N=1 也照寫，不再省略成「隔月」）；
      restorePayFieldsFromText 仍要吃得回舊單存的「隔月/隔 N 個月 N 號」與更早「收貨後第 N 個月 N 號」寫法 */
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('file://' + path.join(__dirname, 'index.html'));
  await p.waitForTimeout(600);
  const r = await p.evaluate(() => {
    const out = {};
    const $ = id => document.getElementById(id);
    const vis = el => !!el && getComputedStyle(el).display !== 'none';
    out.tabs = [...document.querySelectorAll('.ptab')].filter(vis).map(x => x.textContent.trim());
    const setup = (pct, ext) => {
      setTaxMode('inc'); $('taxrate').value = '5';
      botItems = []; $('itbody-bot').innerHTML = '';
      addBotRow({ name: '測試酒款', price: 10000, qty: 1 });
      extras = ext || []; $('dep-pct').value = String(pct); setPay(0); calc();
    };
    // 預設：驗收後 30 日內
    setup(50);
    out.defMode = $('dep-fmode').value; out.defDaysVis = vis($('dep-fm-days')); out.defMonVis = vis($('dep-fm-month'));
    out.t1 = getPayTerms();
    // 切成隔月 10 號
    $('dep-fmode').value = 'month'; depFModeSync(); $('dep-fmon').value = '1'; $('dep-fday').value = '10'; calcPay();
    out.monDaysVis = vis($('dep-fm-days')); out.monMonVis = vis($('dep-fm-month'));
    out.t2 = getPayTerms(); out.p2 = ordPayFromQuote({ payDetail: out.t2 }, 10000);
    $('dep-fmon').value = '2'; out.t3 = getPayTerms();
    // 0%：全額型
    setup(0); $('dep-fmode').value = 'month'; depFModeSync(); $('dep-fmon').value = '1'; $('dep-fday').value = '25';
    out.t4 = getPayTerms(); out.p4 = ordPayFromQuote({ payDetail: out.t4 }, 10000);
    // 0% 但有 SGS 費用 → 還是有訂金段
    setup(0, [{ n: 'SGS檢驗費', a: 3000 }]); out.t5 = getPayTerms();
    // 還原：現行寫法（驗收後第 2 個月 5 號）
    setup(50); $('dep-fmode').value = 'days'; depFModeSync();
    restorePayFieldsFromText('訂金支付：…<br>驗收與尾款：…甲方應於到貨後 7 日內完成驗收。驗收無誤後，甲方應於驗收後第 2 個月 5 號支付尾款新台幣 $5,000 元整（即酒水總價剩餘之 50%）。');
    out.r1 = { mode: $('dep-fmode').value, mon: $('dep-fmon').value, day: $('dep-fday').value, monVis: vis($('dep-fm-month')) };
    // 還原：舊版 30 日內
    restorePayFieldsFromText('…驗收無誤後，甲方應於 45 日內支付尾款新台幣 $5,000 元整');
    out.r2 = { mode: $('dep-fmode').value, days: $('dep-fdays').value };
    // 還原：20260924a 第一版寫法（隔 2 個月 5 號，已存的舊單要繼續吃得回來）
    restorePayFieldsFromText('…驗收無誤後，甲方應於隔 2 個月 5 號支付尾款新台幣 $5,000 元整');
    out.r1b = { mode: $('dep-fmode').value, mon: $('dep-fmon').value, day: $('dep-fday').value };
    // 還原：20260924a 第一版寫法 N=1 省略型（隔月 10 號）
    restorePayFieldsFromText('…驗收無誤後，甲方應於隔月 10 號支付尾款新台幣 $5,000 元整');
    out.r1c = { mode: $('dep-fmode').value, mon: $('dep-fmon').value, day: $('dep-fday').value };
    // 舊單 paymentType 2 載入
    const legacy = '甲方應於收貨後第 2 個月 30 號支付全額款項新台幣 $17,300 元整，預估付款日：2026/09/30。';
    let pt = parseInt('2') || 0; if (pt === 2) pt = 0;   // 同 loadQuoteIntoForm 的對應
    setPay(pt); LOADED_PAY_DETAIL = legacy; restorePayFieldsFromText(legacy);
    out.r3 = { tab: payTab, pct: $('dep-pct').value, mode: $('dep-fmode').value, mon: $('dep-fmon').value, day: $('dep-fday').value, terms: getPayTerms() };
    LOADED_PAY_DETAIL = null;
    // 清空
    resetAll(true);
    out.reset = { mode: $('dep-fmode').value, mon: $('dep-fmon').value, day: $('dep-fday').value, daysVis: vis($('dep-fm-days')), monVis: vis($('dep-fm-month')) };
    return out;
  });
  const T = [];
  const c = (n, ok, info) => T.push({ n, ok: !!ok, info });
  c('分頁剩 4 個且順序正確', JSON.stringify(r.tabs) === JSON.stringify(['比例訂金＋尾款', '到貨驗收後付款', '自訂', '不顯示此欄位']), JSON.stringify(r.tabs));
  c('預設「驗收後幾日內」，只顯示天數欄', r.defMode === 'days' && r.defDaysVis && !r.defMonVis);
  c('預設條款跟舊版一字不差（應於 30 日內支付尾款）', /驗收無誤後，甲方應於 30 日內支付尾款新台幣/.test(r.t1), r.t1);
  c('切「隔幾月幾號」→ 只顯示月／號欄', r.monMonVis && !r.monDaysVis);
  c('條款寫「應於驗收後第 1 個月 10 號支付尾款」（N=1 也明確標示，不省略）', /甲方應於驗收後第 1 個月 10 號支付尾款新台幣 \$5,000 元整/.test(r.t2), r.t2);
  c('訂單追蹤讀得出訂金＋尾款', r.p2 && r.p2.dep === 5000 && r.p2.bal === 5000, JSON.stringify(r.p2));
  c('2 個月寫成「驗收後第 2 個月 10 號」', /應於驗收後第 2 個月 10 號支付尾款/.test(r.t3), r.t3);
  c('0%＝全額型：不印訂金段', !/訂金/.test(r.t4) && /甲方應於驗收後第 1 個月 25 號支付全額款項新台幣 \$10,000 元整。/.test(r.t4), r.t4);
  c('全額型訂單追蹤讀成 訂金0／尾款全額', r.p4 && r.p4.dep === 0 && r.p4.bal === 10000, JSON.stringify(r.p4));
  c('0% 但有 SGS 費用 → 保留訂金段', /支付訂金總計新台幣/.test(r.t5), r.t5);
  c('還原現行寫法 → 第 2 月 5 號、顯示月／號欄', r.r1.mode === 'month' && r.r1.mon === '2' && r.r1.day === '5' && r.r1.monVis, JSON.stringify(r.r1));
  c('還原舊版 30 日內寫法 → 驗收後 45 日內', r.r2.mode === 'days' && r.r2.days === '45', JSON.stringify(r.r2));
  c('還原 20260924a 舊寫法「隔 2 個月 5 號」→ 第 2 月 5 號', r.r1b.mode === 'month' && r.r1b.mon === '2' && r.r1b.day === '5', JSON.stringify(r.r1b));
  c('還原 20260924a 舊寫法「隔月 10 號」(N=1省略) → 第 1 月 10 號', r.r1c.mode === 'month' && r.r1c.mon === '1' && r.r1c.day === '10', JSON.stringify(r.r1c));
  c('舊單「隔月指定日」→ Tab0、0%、隔 2 月 30 號', r.r3.tab === 0 && r.r3.pct === '0' && r.r3.mode === 'month' && r.r3.mon === '2' && r.r3.day === '30', JSON.stringify(r.r3));
  c('舊單沒改金額 → 條款沿用原文', r.r3.terms.startsWith('甲方應於收貨後第 2 個月 30 號'), r.r3.terms);
  c('清空 → 回「驗收後幾日內」、隔 1 月 10 號', r.reset.mode === 'days' && r.reset.mon === '1' && r.reset.day === '10' && r.reset.daysVis && !r.reset.monVis, JSON.stringify(r.reset));
  c('無 pageerror', errs.length === 0, errs.join(' | '));
  await b.close();
  let pass = 0; T.forEach(x => { console.log((x.ok ? '✅ ' : '❌ ') + x.n + (x.ok ? '' : '  → ' + (x.info || ''))); if (x.ok) pass++; });
  console.log(`\n${pass}/${T.length} 通過`); process.exit(pass === T.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
