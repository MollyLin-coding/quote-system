/* 行事曆時間輸入：5 分鐘為單位＋幾點到幾點 離線測試
   ・時間輸入框 step=300（5 分鐘）、有開始＋結束兩格
   ・存檔吸附 5 分鐘（14:03→14:05）；有頭有尾存 "14:05-15:30"、只填開始存 "14:05"
   ・結束早於開始 → 擋下不送；只填結束 → 擋下不送
   ・編輯 "09:00-10:30" 的舊資料 → 兩格正確帶回；全天 → time 空
   ・顯示（buildDayEvents 那條線）："14:00-15:30 標題" 原樣顯示 */
const { chromium } = require('/opt/node-tools/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  const isNoise = t => /Failed to load resource|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|favicon/i.test(t);
  page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) errors.push('CONSOLE: ' + m.text()); });

  await page.goto('http://localhost:8899/index.html');
  await page.evaluate(() => {
    document.getElementById('login-overlay').style.display = 'none';
    AUTH_TOKEN = 'test-token';
    window.CALLS = [];
    window.apiCall = async (p) => { window.CALLS.push(JSON.parse(JSON.stringify(p))); return { ok: true, items: [] }; };
    CAL_ITEMS = [
      { item_id: 'c1', kind: 'memo', date: '2026-07-30', title: '有頭有尾', category: '會議', all_day: 'N', time: '09:00-10:30', done: 'N' },
      { item_id: 'c2', kind: 'memo', date: '2026-07-30', title: '全天', category: '工作', all_day: 'Y', time: '', done: 'N' },
    ];
  });

  const results = [];
  const check = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);
  const val = id => page.evaluate(i => document.getElementById(i).value, id);

  check('開始/結束兩格都在且 step=300', await page.evaluate(() => {
    const a = document.getElementById('ce-time'), b = document.getElementById('ce-time-end');
    return !!a && !!b && a.step === '300' && b.step === '300' && a.type === 'time' && b.type === 'time';
  }));

  /* 新增：非全天、14:03〜15:32 → 吸附成 14:05-15:30 */
  await page.evaluate(() => {
    openCalAdd('2026-07-30', 'memo');
    document.getElementById('ce-title').value = '測試會議';
    document.getElementById('ce-allday').checked = false;
    onAllDayChange();
    document.getElementById('ce-time').value = '14:03';
    document.getElementById('ce-time-end').value = '15:32';
    window.CALLS = [];
    return saveCalItem();
  });
  await page.waitForTimeout(200);
  let c = await page.evaluate(() => window.CALLS.find(x => x.action === 'saveCalendarItem'));
  check('存檔吸附 5 分鐘且含頭尾：14:05-15:30', !!c && c.item.time === '14:05-15:30');
  check('all_day = N', !!c && c.item.all_day === 'N');

  /* 只填開始 */
  await page.evaluate(() => {
    openCalAdd('2026-07-30', 'memo');
    document.getElementById('ce-title').value = '只有開始';
    document.getElementById('ce-allday').checked = false;
    onAllDayChange();
    document.getElementById('ce-time').value = '08:00';
    window.CALLS = [];
    return saveCalItem();
  });
  await page.waitForTimeout(200);
  c = await page.evaluate(() => window.CALLS.find(x => x.action === 'saveCalendarItem'));
  check('只填開始 → 存 "08:00"', !!c && c.item.time === '08:00');

  /* 結束早於開始 → 擋下 */
  await page.evaluate(() => {
    openCalAdd('2026-07-30', 'memo');
    document.getElementById('ce-title').value = '順序錯誤';
    document.getElementById('ce-allday').checked = false;
    onAllDayChange();
    document.getElementById('ce-time').value = '15:00';
    document.getElementById('ce-time-end').value = '14:00';
    window.CALLS = [];
    return saveCalItem();
  });
  await page.waitForTimeout(200);
  check('結束早於開始 → 不送出', await page.evaluate(() => !window.CALLS.some(x => x.action === 'saveCalendarItem')));
  check('擋下後不會卡住（busy 旗標有還原）', await page.evaluate(() => _busy.calSave === false));

  /* 只填結束 → 擋下 */
  await page.evaluate(() => {
    document.getElementById('ce-time').value = '';
    document.getElementById('ce-time-end').value = '14:00';
    window.CALLS = [];
    return saveCalItem();
  });
  await page.waitForTimeout(200);
  check('只填結束 → 不送出', await page.evaluate(() => !window.CALLS.some(x => x.action === 'saveCalendarItem')));
  await page.evaluate(() => closeCalEdit());

  /* 編輯舊資料帶回（存檔後 loadCalendar 會用 stub 的空資料洗掉 CAL_ITEMS，先重設） */
  await page.evaluate(() => {
    CAL_ITEMS = [
      { item_id: 'c1', kind: 'memo', date: '2026-07-30', title: '有頭有尾', category: '會議', all_day: 'N', time: '09:00-10:30', done: 'N' },
      { item_id: 'c2', kind: 'memo', date: '2026-07-30', title: '全天', category: '工作', all_day: 'Y', time: '', done: 'N' },
    ];
  });
  await page.evaluate(() => openCalEdit('c1'));
  check('編輯帶回開始 09:00', (await val('ce-time')) === '09:00');
  check('編輯帶回結束 10:30', (await val('ce-time-end')) === '10:30');
  check('非全天時時間列有顯示', await page.evaluate(() => document.getElementById('ce-time-row').style.display !== 'none'));
  await page.evaluate(() => closeCalEdit());

  await page.evaluate(() => openCalEdit('c2'));
  check('全天事項：兩格皆空', (await val('ce-time')) === '' && (await val('ce-time-end')) === '');
  check('全天時時間列隱藏', await page.evaluate(() => document.getElementById('ce-time-row').style.display === 'none'));
  await page.evaluate(() => closeCalEdit());

  /* 顯示層：日曆事件文字含區間 */
  check('日曆顯示 "09:00-10:30 標題"', await page.evaluate(() => {
    const evs = eventsOn('2026-07-30');
    return evs.some(e => e.txt.includes('09:00-10:30') && e.txt.includes('有頭有尾'));
  }));

  /* calSnap5 純函式 */
  const snaps = await page.evaluate(() => [calSnap5('14:03'), calSnap5('14:58'), calSnap5('23:59'), calSnap5(''), calSnap5('14:05')]);
  check('calSnap5 14:03→14:05', snaps[0] === '14:05');
  check('calSnap5 14:58→15:00', snaps[1] === '15:00');
  check('calSnap5 23:59→00:00（跨日進位不爆）', snaps[2] === '00:00');
  check('calSnap5 空值→空', snaps[3] === '');
  check('calSnap5 已對齊不變', snaps[4] === '14:05');

  results.forEach(r => console.log(r[0], r[1]));
  const fails = results.filter(r => r[0] === 'FAIL').length;
  console.log(errors.length ? 'JS ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
  console.log(fails === 0 ? 'ALL PASS' : fails + ' FAIL');
  await browser.close();
  process.exit(fails === 0 && errors.length === 0 ? 0 : 1);
})();
