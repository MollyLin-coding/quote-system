/**
 * ============================================================
 * v33 擴充：今日待辦彙總 API（getTodayDigest）＋ LINE 文字摘要
 * 對話B　2026-07-25
 * ------------------------------------------------------------
 * 原則：
 * 1. 純讀取，不寫任何資料；尾款金額推估「只算不寫回」。
 * 2. 各區塊重用既有讀表函式與既有門檻，避免與月報表／驗收管理數字對不上。
 * 3. 單一區塊失敗 → 該區塊回空陣列並記入 warnings，整趟仍回 ok:true。
 * 4. 日期一律台北在地日（c_verify 系欄位可能是 UTC 時間戳，用 dgYmd_ 統一轉回台北日）。
 * ============================================================
 */

var DIGEST_NOREPORT_DAYS_ = 7;      // 出貨後滿幾天仍未掃碼回報＝要催（與前端 VM_NOREPORT_DAYS 一致）
var DIGEST_NOINVOICE_DAYS_ = 7;     // 已出貨超過幾天仍未開發票
var DIGEST_FINAL_AHEAD_DAYS_ = 7;   // 預計尾款日往後看幾天

/* ---------- 小工具 ---------- */

function dgToday_() {
  return Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
}

/** 是不是「純日期字串 YYYY-MM-DD…」而且第 11 個字不是 T（＝不是時間戳） */
function dgIsPlainYmd_(s) {
  if (!s || s.length < 10) return false;
  if (s.charAt(4) !== '-' || s.charAt(7) !== '-') return false;
  for (var i = 0; i < 10; i++) {
    if (i === 4 || i === 7) continue;
    var c = s.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  if (s.length > 10 && s.charAt(10) === 'T') return false;
  return true;
}

/** 任何日期值 → 台北在地日 YYYY-MM-DD（沿用前端 vmLocalYmd 的規則） */
function dgYmd_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Taipei', 'yyyy-MM-dd');
  var s = String(v).trim();
  if (!s) return '';
  if (dgIsPlainYmd_(s)) return s.slice(0, 10);
  var d = new Date(s);
  if (isNaN(d.getTime())) return s.slice(0, 10);
  return Utilities.formatDate(d, 'Asia/Taipei', 'yyyy-MM-dd');
}

/** to - from，單位天；任一為空回 null */
function dgDiffDays_(from, to) {
  if (!from || !to) return null;
  var t1 = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  var t2 = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  if (isNaN(t1) || isNaN(t2)) return null;
  return Math.round((t2 - t1) / 86400000);
}

function dgNum_(v) {
  if (v === null || v === undefined || v === '') return 0;
  var n = parseFloat(v);
  return isFinite(n) ? n : 0;
}

function dgClientShort_(s) {
  return String(s === null || s === undefined ? '' : s).split('｜')[0];
}

/** 單號 → { client, grand_total }（報價單主表＋自訂報價單） */
function dgClientMap_() {
  var map = {};
  resolveColMaps_();
  var ss = ssApp_();
  var sh = ss.getSheetByName(SHEET_MAIN);
  if (sh && sh.getLastRow() >= 2) {
    var w = effW_(sh, MAIN_HEADERS);
    var data = sh.getRange(2, 1, sh.getLastRow() - 1, w).getValues();
    data.forEach(function (r) {
      var no = String(r[MAIN_COLS.quoteNo - 1] || '').trim();
      if (!no) return;
      map[no] = {
        client: dgClientShort_(r[MAIN_COLS.clientName - 1]),
        grand_total: dgNum_(r[MAIN_COLS.grandTotal - 1])
      };
    });
  }
  try {
    v2ReadAll_(SHEET_CUSTOM_QUOTES, CUSTOM_QUOTES_HEADERS).forEach(function (q) {
      var no = String(q.quote_no || '').trim();
      if (!no) return;
      var tot = 0;
      try { tot = dgNum_((JSON.parse(q.totals_json || '{}') || {}).total); } catch (e) { tot = 0; }
      map[no] = { client: dgClientShort_(q.client), grand_total: tot };
    });
  } catch (e) { /* 自訂報價單讀不到就算了，主表已足夠 */ }
  return map;
}

/** 月重複的「每 N 個月」判定（與前端 monthlyIntervalHit 同規則） */
function dgMonthlyIntervalHit_(r, ymIndex) {
  var iv = (r && r.interval) ? r.interval : 1;
  if (iv <= 1) return true;
  if (r.anchorYm === null || r.anchorYm === undefined) return true;
  var diff = ymIndex - r.anchorYm;
  return diff >= 0 && diff % iv === 0;
}

/* ---------- 主體：今日待辦彙總 ---------- */

/**
 * opts.urgentOnly === true 時只回「今天真的該動手」的（舊行為）。
 * 預設（Molly 2026-07-25 選 B）＝**全部都列**，每一筆帶 urgent 旗標，
 * 前端可把 urgent:false 的那幾列淡化成「不急」。
 */
function buildTodayDigest_(opts) {
  var urgentOnly = !!(opts && opts.urgentOnly);
  var today = dgToday_();
  var warnings = [];
  var out = {
    ok: true,
    today: today,
    ship_due: [],
    final_due: [],
    no_scan: [],
    no_invoice: [],
    calendar: [],
    warnings: warnings
  };

  var clients = {};
  try { clients = dgClientMap_(); }
  catch (e) { clients = {}; warnings.push('客戶名稱對照讀取失敗：' + e.message); }
  var nameOf = function (no) { return (clients[String(no)] || {}).client || ''; };

  var orders = [];
  try { orders = v2ReadAll_(SHEET_ORDER_STATUS, ORDER_STATUS_HEADERS) || []; }
  catch (e) { orders = []; warnings.push('訂單進度讀取失敗：' + e.message); }

  /* A. 逾期／今日該出貨：預計出貨日 ≦ 今天且尚未出貨 */
  try {
    var skipShip = ['cancelled', 'closed', 'paid', 'shipped', 'invoiced'];
    orders.forEach(function (o) {
      if (skipShip.indexOf(effOrdStatus_(o)) >= 0) return;
      if (o.ship_date_actual) return;
      var est = dgYmd_(o.ship_date_est);
      if (!est) return;
      var over = dgDiffDays_(est, today);
      if (over === null || over < 0) return;
      out.ship_due.push({
        quote_no: o.quote_no,
        client: nameOf(o.quote_no),
        plan_ship_date: est,
        overdue_days: over,
        urgent: true
      });
    });
    out.ship_due.sort(function (a, b) { return b.overdue_days - a.overdue_days; });
  } catch (e) { out.ship_due = []; warnings.push('逾期出貨清單失敗：' + e.message); }

  /* B. 待催尾款：已出貨/已開發票、尾款日期空白，且預計尾款日 ≦ 今天+7（沒填預計日的一律列出） */
  try {
    orders.forEach(function (o) {
      var st = effOrdStatus_(o);
      if (st !== 'shipped' && st !== 'invoiced') return;
      if (o.final_date) return;
      var planned = dgYmd_(o.final_date_est);
      var ahead = planned ? dgDiffDays_(today, planned) : null;
      // 預計尾款日 ≦ 今天+7、已逾期、或根本沒填 → 算「急」
      var urgent = (ahead === null) || (ahead <= DIGEST_FINAL_AHEAD_DAYS_);
      if (urgentOnly && !urgent) return;
      var amt, isEst = false;
      if (o.final_amt !== null && o.final_amt !== undefined && o.final_amt !== '') {
        amt = dgNum_(o.final_amt);
      } else {
        var gt = (o.grand_total !== null && o.grand_total !== undefined && o.grand_total !== '')
          ? dgNum_(o.grand_total)
          : dgNum_((clients[String(o.quote_no)] || {}).grand_total);
        amt = gt - dgNum_(o.deposit_amt);
        isEst = true;
      }
      var overDays = planned ? dgDiffDays_(planned, today) : null;
      out.final_due.push({
        quote_no: o.quote_no,
        client: nameOf(o.quote_no),
        final_amt: amt,
        is_estimated: isEst,
        plan_final_date: planned,
        overdue: (overDays !== null && overDays > 0),
        overdue_days: (overDays !== null && overDays > 0) ? overDays : 0,
        urgent: urgent,
        days_until: ahead
      });
    });
    // 急的排前面；同組內預計日近的在前，沒填日期的排該組最後
    out.final_due.sort(function (a, b) {
      if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
      var ad = a.plan_final_date || '9999-12-31';
      var bd = b.plan_final_date || '9999-12-31';
      return ad < bd ? -1 : (ad > bd ? 1 : 0);
    });
  } catch (e) { out.final_due = []; warnings.push('待催尾款清單失敗：' + e.message); }

  /* C. 出貨逾 7 天未掃碼回報（沿用驗收管理「未回報催單」既有邏輯與門檻） */
  try {
    var forms = handleListVerifyForms_({ filters: {} }) || {};
    var reps = handleGetVerifications_({ filters: {} }) || {};
    var shipped = {};
    var fSum = forms.summary || {};
    Object.keys(fSum).forEach(function (no) {
      shipped[no] = { base: (fSum[no] || {}).last_at || '', lot: '' };
    });
    (forms.records || []).forEach(function (f) {
      var no = String(f.no || '').trim();
      if (!no) return;
      if (!shipped[no]) shipped[no] = { base: '', lot: '' };
      if (!shipped[no].base) shipped[no].base = f.ship_date || f.created_at || '';
      if (!shipped[no].lot) shipped[no].lot = f.lot || '';
    });
    var reported = {};
    (reps.records || []).forEach(function (r) { if (r.no) reported[String(r.no)] = true; });
    Object.keys(reps.summary || {}).forEach(function (no) { reported[no] = true; });

    Object.keys(shipped).forEach(function (no) {
      if (reported[no]) return;
      var base = dgYmd_(shipped[no].base);
      var days = base ? dgDiffDays_(base, today) : null;
      if (days === null || days >= DIGEST_NOREPORT_DAYS_) {
        out.no_scan.push({
          quote_no: no,
          lot: shipped[no].lot || '',
          client: nameOf(no),
          ship_date: base,
          days_since: days,
          urgent: true
        });
      }
    });
    out.no_scan.sort(function (a, b) { return (b.days_since || 0) - (a.days_since || 0); });
  } catch (e) { out.no_scan = []; warnings.push('未回報清單失敗：' + e.message); }

  /* D. 已出貨超過 7 天仍未開發票 */
  try {
    orders.forEach(function (o) {
      var stD = effOrdStatus_(o);
      // 已出貨未開發票；尾款先收了（paid）但確實出過貨、發票沒開的也要追
      if (stD !== 'shipped' && !(stD === 'paid' && o.ship_date_actual)) return;
      if (o.invoice_no) return;
      var sd = dgYmd_(o.ship_date_actual);
      var days = sd ? dgDiffDays_(sd, today) : null;
      // 出貨超過 7 天、或根本沒填實際出貨日 → 算「急」
      var urgentInv = (days === null) || (days > DIGEST_NOINVOICE_DAYS_);
      if (urgentOnly && !urgentInv) return;
      out.no_invoice.push({
        quote_no: o.quote_no,
        client: nameOf(o.quote_no),
        ship_date: sd,
        days_since: days,
        urgent: urgentInv
      });
    });
    // 急的排前面；同組內出貨越久的在前
    out.no_invoice.sort(function (a, b) {
      if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
      return (b.days_since || 0) - (a.days_since || 0);
    });
  } catch (e) { out.no_invoice = []; warnings.push('未開發票清單失敗：' + e.message); }

  /* E. 今日行事曆（含重複行程展開後落在今日者；已完成的備忘不列） */
  try {
    var items = v2ReadAll_(SHEET_CALENDAR, CALENDAR_HEADERS) || [];
    var y = +today.slice(0, 4), mo = +today.slice(5, 7), da = +today.slice(8, 10);
    var dow = new Date(Date.UTC(y, mo - 1, da)).getUTCDay();
    var ymIndex = y * 12 + (mo - 1);
    items.forEach(function (it) {
      var kind = String(it.kind || '');
      var hit = false;
      if (kind === 'memo') {
        hit = (dgYmd_(it.date) === today) && String(it.done || '') !== 'Y';
      } else if (kind === 'recur') {
        var r = {};
        try { r = JSON.parse(it.recur_json || '{}') || {}; } catch (e2) { r = {}; }
        var f = String(r.freq || '');
        if (f === 'weekly') {
          hit = (r.weekday !== null && r.weekday !== undefined) && (dow === Number(r.weekday));
        } else if (f === 'monthly') {
          hit = (da === Number(r.day || 0)) && dgMonthlyIntervalHit_(r, ymIndex);
        } else if (f === 'yearly') {
          hit = (mo === Number(r.month || 0)) && (da === Number(r.day || 0));
        }
      }
      if (!hit) return;
      var allDay = String(it.all_day || '') === 'Y';
      out.calendar.push({
        item_id: it.item_id,
        title: it.title,
        category: it.category || '',
        time: (!allDay && it.time) ? String(it.time) : '',
        all_day: allDay
      });
    });
    out.calendar.sort(function (a, b) { return String(a.time || '').localeCompare(String(b.time || '')); });
  } catch (e) { out.calendar = []; warnings.push('今日行事曆失敗：' + e.message); }

  return out;
}

function handleGetTodayDigest_(params) {
  var p = params || {};
  // 預設全部都列；要舊的「只顯示急的」就帶 scope=urgent（或 urgentOnly=true）
  var urgentOnly = (String(p.scope) === 'urgent') ||
                   (p.urgentOnly === true || String(p.urgentOnly) === 'true');
  var d = buildTodayDigest_({ urgentOnly: urgentOnly });
  d.scope = urgentOnly ? 'urgent' : 'all';
  if (p.withText === true || String(p.withText) === 'true') {
    try { d.text = digestTextSummary_(d); } catch (e) { d.text = ''; }
  }
  return d;
}

/* ---------- LINE 每日推播用：文字摘要（本波只做函式，未接線） ---------- */

function dgMoney_(n) {
  var v = Math.round(dgNum_(n));
  var neg = v < 0;
  var s = String(Math.abs(v));
  var out = '';
  var c = 0;
  for (var i = s.length - 1; i >= 0; i--) {
    out = s.charAt(i) + out;
    c++;
    if (c % 3 === 0 && i > 0) out = ',' + out;
  }
  return (neg ? '-' : '') + out;
}

/**
 * 把今日待辦轉成純文字摘要（給 LINE push message 用）。
 * token 到位後：Script Properties 存 LINE_TOKEN／LINE_USER_ID，
 * 再加一支 time-driven trigger 每天 08:00（台北）呼叫 push 函式即可。
 */
function digestTextSummary_(digest) {
  var full = digest || buildTodayDigest_();
  // 推播訊息只講「急的」，不然每天一長串沒人看
  var onlyUrgent = function (arr) {
    return (arr || []).filter(function (x) { return x.urgent !== false; });
  };
  var d = {
    today: full.today,
    ship_due: onlyUrgent(full.ship_due),
    final_due: onlyUrgent(full.final_due),
    no_scan: onlyUrgent(full.no_scan),
    no_invoice: onlyUrgent(full.no_invoice),
    calendar: full.calendar || [],
    warnings: full.warnings || []
  };
  var L = [];
  L.push('【南坡萬 今日待辦】' + d.today);

  if (d.ship_due.length) {
    L.push('');
    L.push('🚚 該出貨（' + d.ship_due.length + '）');
    d.ship_due.slice(0, 8).forEach(function (o) {
      L.push('・' + (o.client || o.quote_no) + ' ' + o.quote_no +
        (o.overdue_days > 0 ? '（逾期 ' + o.overdue_days + ' 天）' : '（今天）'));
    });
    if (d.ship_due.length > 8) L.push('・…還有 ' + (d.ship_due.length - 8) + ' 筆');
  }
  if (d.final_due.length) {
    L.push('');
    L.push('💰 該催尾款（' + d.final_due.length + '）');
    d.final_due.slice(0, 8).forEach(function (o) {
      L.push('・' + (o.client || o.quote_no) + ' ' + dgMoney_(o.final_amt) + ' 元' +
        (o.is_estimated ? '（推估）' : '') + (o.overdue ? '（逾期 ' + o.overdue_days + ' 天）' : ''));
    });
    if (d.final_due.length > 8) L.push('・…還有 ' + (d.final_due.length - 8) + ' 筆');
  }
  if (d.no_invoice.length) {
    L.push('');
    L.push('🧾 已出貨未開發票（' + d.no_invoice.length + '）');
    d.no_invoice.slice(0, 5).forEach(function (o) {
      L.push('・' + (o.client || o.quote_no) + '（出貨 ' + (o.days_since === null ? '？' : o.days_since) + ' 天）');
    });
  }
  if (d.no_scan.length) {
    L.push('');
    L.push('📮 客戶還沒回報驗收（' + d.no_scan.length + '）');
    d.no_scan.slice(0, 5).forEach(function (o) {
      L.push('・' + (o.client || o.quote_no) + '（出貨 ' + (o.days_since === null ? '？' : o.days_since) + ' 天）');
    });
  }
  if (d.calendar.length) {
    L.push('');
    L.push('📅 今日行程');
    d.calendar.forEach(function (c) {
      L.push('・' + (c.time ? c.time + ' ' : '') + c.title);
    });
  }
  if (!d.ship_due.length && !d.final_due.length && !d.no_invoice.length && !d.no_scan.length && !d.calendar.length) {
    L.push('');
    L.push('今天沒有待辦，輕鬆一下 ☕');
  }
  if (d.warnings && d.warnings.length) {
    L.push('');
    L.push('⚠ 部分資料讀取異常：' + d.warnings.join('；'));
  }
  return L.join(String.fromCharCode(10));
}

/** 編輯器裡按「執行」可預覽今天的 LINE 摘要長什麼樣（不會送出任何訊息） */
function previewDigestText() {
  Logger.log(digestTextSummary_(null));
}

/* ============================================================
   每日推播（2026-08-11 優化建議 #2）
   LINE 還沒申辦，先用 Gmail 版把今日待辦每天早上寄出來。
   摘要文字沿用上面的 digestTextSummary_，之後要接 LINE 只要換掉送出那一行。

   Molly 只需要做一次：
     編輯器上方函式下拉選「setupDailyDigestMail」→ 按「執行」→ 首次會問權限，按允許。
     跑完看「執行記錄」會寫「已設定每天 8:00 前後寄出到 xxx@gmail.com」。
   想先看看信長什麼樣：改選「previewDailyDigestMail」執行，只寫進記錄，不會寄信。

   Script Properties（不設也能跑，只是留彈性）：
     DIGEST_MAIL_TO  ：要寄給誰（不設＝寄給這個 Apps Script 的擁有者本人）
     DIGEST_MAIL_OFF ：設成 YES 就暫停寄送（觸發器還在，只是不寄；刪掉這個屬性即恢復）
   ============================================================ */

var DIGEST_MAIL_HOUR_ = 8;                                        // 每天幾點寄（跟著專案時區＝台北）
var DIGEST_APP_URL_ = 'https://mollylin-coding.github.io/quote-system/';

function digestMailTo_() {
  var p = PropertiesService.getScriptProperties().getProperty('DIGEST_MAIL_TO');
  if (p && String(p).indexOf('@') > 0) return String(p).trim();
  return Session.getEffectiveUser().getEmail();   // 預設寄給自己
}

/** 主旨要在手機通知列一眼看完，所以把「幾件事」直接寫進去 */
function digestMailSubject_(d) {
  var n = function (a) { return ((a || []).filter(function (x) { return x.urgent !== false; })).length; };
  var parts = [];
  if (n(d.ship_due)) parts.push('該出貨 ' + n(d.ship_due));
  if (n(d.final_due)) parts.push('催尾款 ' + n(d.final_due));
  if (n(d.no_invoice)) parts.push('未開發票 ' + n(d.no_invoice));
  if (n(d.no_scan)) parts.push('未回報 ' + n(d.no_scan));
  if ((d.calendar || []).length) parts.push('行程 ' + d.calendar.length);
  var md = String(d.today || '').slice(5).replace('-', '/');
  return '【南坡萬】' + md + ' 今日待辦' + (parts.length ? '：' + parts.join('、') : '：今天沒事 ☕');
}

function digestMailBody_(d) {
  var nl = String.fromCharCode(10);
  return digestTextSummary_(d) + nl + nl +
    '────────────' + nl +
    '打開系統：' + DIGEST_APP_URL_ + nl +
    '（這封信是系統每天早上自動寄的。想停掉或改時間，跟 Claude 說一聲就好。）';
}

/** 觸發器的進入點。名稱不帶底線，觸發器才掛得上（跟 runCalendarSync 同一個慣例）。 */
function sendDailyDigestMail() {
  var props = PropertiesService.getScriptProperties();
  if (String(props.getProperty('DIGEST_MAIL_OFF') || '').toUpperCase() === 'YES') {
    Logger.log('DIGEST_MAIL_OFF=YES，本次不寄。');
    return 'off';
  }
  var to = digestMailTo_();
  if (!to) { Logger.log('找不到收件人，沒有寄出。'); return 'no-recipient'; }
  var d;
  try {
    d = buildTodayDigest_();
  } catch (e) {
    // 待辦讀不出來也要讓 Molly 知道，不然「今天沒收到信」會被誤會成「今天沒事」
    MailApp.sendEmail(to, '【南坡萬】今日待辦產生失敗', '系統今天早上讀不到待辦資料：' + e +
      String.fromCharCode(10) + String.fromCharCode(10) + '請打開系統確認：' + DIGEST_APP_URL_);
    Logger.log('buildTodayDigest_ 失敗：' + e);
    return 'error';
  }
  MailApp.sendEmail(to, digestMailSubject_(d), digestMailBody_(d));
  Logger.log('已寄出到 ' + to + '：' + digestMailSubject_(d));
  return 'sent';
}

/** 只看不寄：把收件人、主旨與內文寫進執行記錄 */
function previewDailyDigestMail() {
  var d = buildTodayDigest_();
  Logger.log('收件人：' + digestMailTo_());
  Logger.log('主旨：' + digestMailSubject_(d));
  Logger.log(String.fromCharCode(10) + digestMailBody_(d));
}

/** 掛（或重掛）每天早上的觸發器。重複執行不會長出第二個。 */
function setupDailyDigestMail() {
  var olds = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'sendDailyDigestMail';
  });
  olds.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sendDailyDigestMail').timeBased().everyDays(1).atHour(DIGEST_MAIL_HOUR_).create();
  var msg = '已設定每天 ' + DIGEST_MAIL_HOUR_ + ':00 前後寄出到 ' + digestMailTo_() +
    '（順便清掉舊的 ' + olds.length + ' 個）。⚠ Google 的時間觸發器是「那個小時內」，不會分秒不差。';
  Logger.log(msg);
  return msg;
}

/** 想停掉每日信：執行這支（要恢復再跑一次 setupDailyDigestMail） */
function removeDailyDigestMail() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDailyDigestMail') { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log('已移除 ' + n + ' 個每日待辦信觸發器。');
  return n;
}

/* ---------- list 類 action 共用：選填 limit / since ---------- */

function listOptNum_(v) {
  var n = parseInt(v, 10);
  return (isFinite(n) && n > 0) ? n : 0;
}

/** params 或 params.filters 裡有沒有帶 limit／since */
function listHasOpts_(params) {
  var p = params || {};
  var f = p.filters || {};
  return !!(p.limit || p.since || f.limit || f.since);
}

/**
 * 對「已排序好（新的在前）」的陣列套用選填 since／limit。
 * 不帶參數 → 原樣回傳，既有前端零影響。
 */
function applyListOpts_(arr, params, dateKey) {
  var p = params || {};
  var f = p.filters || {};
  var sinceRaw = (p.since !== undefined && p.since !== '') ? p.since : f.since;
  var limitRaw = (p.limit !== undefined && p.limit !== '') ? p.limit : f.limit;
  var since = dgYmd_(sinceRaw);
  var limit = listOptNum_(limitRaw);
  var out = arr || [];
  if (since) {
    out = out.filter(function (o) {
      var d = dgYmd_(o ? o[dateKey] : '');
      return d && d >= since;
    });
  }
  if (limit) out = out.slice(0, limit);
  return out;
}
