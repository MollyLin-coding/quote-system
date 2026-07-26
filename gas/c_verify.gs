/**
 * ===================================================================
 * 對話C —— 出貨 Lot 驗收單「客戶掃碼回報」後端（2026-07-24）
 * ===================================================================
 * 提供：
 *   - doGet(?page=verify&no=..&lot=..) 出的客戶回報頁（見 程式碼.gs 的 doGet hook）
 *   - submitVerification（公開、免 token）
 *   - getVerifications / updateVerificationStatus / addVerification（admin token）
 * 依賴共用：SHEET_ID、SHEET_MAIN、SHEET_ITEMS、MAIN_COLS、ITEM_COLS、
 *          MAIN_HEADERS、ITEM_HEADERS、jsonResponse_、requireAuth_
 * 照片沿用 b4 的 JSON 形狀 {folderId, files:[{id,name,mime}]}，可用 loadQuoteImages_ 讀回。
 */

const SHEET_VERIFY = '驗收紀錄';
const VERIFY_HEADERS = [
  '紀錄ID', '建立時間', '單號', 'Lot', '客戶', '品項', '類型',
  '描述', '照片', '回報人', '處理狀態', '處理備註', '處理金額', '結案日'
];
const VERIFY_COLS = {
  id: 1, created_at: 2, no: 3, lot: 4, client: 5, item: 6, type: 7,
  desc: 8, photos: 9, reporter: 10, status: 11, handle_note: 12, amount: 13, closed_date: 14
};
const VERIFY_TYPES = ['ok', '外觀', '瓶內異物', '數量不符', '其他'];
const VERIFY_MANUAL_TYPES_ = ['回報問題', '驗收無誤', '其他']; // 對話B 2026-07-25：手動登記客訴分類白名單，專供 addVerification 使用，不影響 VERIFY_TYPES（QR 掃碼回報用）
const VERIFY_IMG_ROOT = '驗收回報照片';
const VERIFY_MAX_IMAGES = 3;
const VERIFY_MAX_IMG_BYTES = 8 * 1024 * 1024; // 單張解碼後上限

// ---- 共用小工具 ----
function verifyClean_(s, max) {
  var out = String(s == null ? '' : s).replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  if (max && out.length > max) out = out.slice(0, max);
  return out;
}
function verifyGenId_() {
  return 'V' + (new Date().getTime()) + '-' + Math.floor(Math.random() * 9000 + 1000);
}
function verifyGetOrCreateFolder_(name, parent) {
  var it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent.createFolder(name);
}
function getOrCreateVerifySheet_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(SHEET_VERIFY);
  var needHeader = false;
  if (!sh) { sh = ss.insertSheet(SHEET_VERIFY); needHeader = true; }
  else if (sh.getLastRow() < 1) { needHeader = true; }
  if (needHeader) {
    sh.getRange(1, 1, 1, VERIFY_HEADERS.length).setValues([VERIFY_HEADERS])
      .setFontWeight('bold').setBackground('#1B4D2E').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  }
  return sh;
}

// ---- 依單號查報價單（客戶名 / 品名清單）----
function verifyFindQuoteRow_(no) {
  resolveColMaps_();
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(SHEET_MAIN);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return null;
  var data = sh.getRange(2, 1, lastRow - 1, effW_(sh, MAIN_HEADERS)).getValues();
  var target = String(no).trim();
  var idx = data.findIndex(function (r) {
    return String(r[MAIN_COLS.quoteNo - 1]).trim() === target;
  });
  if (idx === -1) return null;
  return { client: data[idx][MAIN_COLS.clientName - 1] };
}
function verifyGetItemNames_(no) {
  resolveColMaps_();
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(SHEET_ITEMS);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var data = sh.getRange(2, 1, lastRow - 1, effW_(sh, ITEM_HEADERS)).getValues();
  var target = String(no).trim();
  var names = [];
  data.forEach(function (r) {
    if (String(r[ITEM_COLS.quoteNo - 1]).trim() !== target) return;
    var nm = verifyClean_(r[ITEM_COLS.name - 1], 100);
    if (nm && names.indexOf(nm) === -1) names.push(nm);
  });
  return names;
}

// ---- 照片存 Drive（append，一單一資料夾，不清空既有）----
function verifySaveImages_(no, id, images) {
  if (!images || !images.length) return '';
  var root = verifyGetOrCreateFolder_(VERIFY_IMG_ROOT, DriveApp.getRootFolder());
  var sub = verifyGetOrCreateFolder_('verify_' + no, root);
  var files = [];
  for (var i = 0; i < images.length && i < VERIFY_MAX_IMAGES; i++) {
    var img = images[i];
    if (!img || !img.data) continue;
    var bytes;
    try { bytes = Utilities.base64Decode(img.data); } catch (e) { continue; }
    if (!bytes || bytes.length === 0 || bytes.length > VERIFY_MAX_IMG_BYTES) continue;
    var mime = img.mime || 'image/jpeg';
    var name = id + '_' + (i + 1) + '_' + verifyClean_(img.name || 'photo.jpg', 60);
    var blob = Utilities.newBlob(bytes, mime, name);
    var file = sub.createFile(blob);
    files.push({ id: file.getId(), name: name, mime: mime });
  }
  if (!files.length) return '';
  return JSON.stringify({ folderId: sub.getId(), files: files });
}
function verifyPhotoLinks_(photosJson) {
  if (!photosJson) return [];
  try {
    var meta = JSON.parse(photosJson);
    if (!meta || !meta.files) return [];
    return meta.files.map(function (f) {
      return { id: f.id, name: f.name, mime: f.mime, url: 'https://drive.google.com/file/d/' + f.id + '/view' };
    });
  } catch (e) { return []; }
}

// ---- 寫入一列 ----
function verifyAppendRecord_(rec) {
  var sh = getOrCreateVerifySheet_();
  var row = new Array(VERIFY_HEADERS.length).fill('');
  row[VERIFY_COLS.id - 1] = rec.id;
  row[VERIFY_COLS.created_at - 1] = rec.created_at;
  row[VERIFY_COLS.no - 1] = rec.no;
  row[VERIFY_COLS.lot - 1] = rec.lot;
  row[VERIFY_COLS.client - 1] = rec.client;
  row[VERIFY_COLS.item - 1] = rec.item;
  row[VERIFY_COLS.type - 1] = rec.type;
  row[VERIFY_COLS.desc - 1] = rec.desc;
  row[VERIFY_COLS.photos - 1] = rec.photos;
  row[VERIFY_COLS.reporter - 1] = rec.reporter;
  row[VERIFY_COLS.status - 1] = rec.status;
  sh.appendRow(row);
}

// ===================================================================
// Action handlers
// ===================================================================

// 公開：客戶回報（免 admin token）
function handleSubmitVerification_(params) {
  var no = verifyClean_(params.no, 40);
  if (!no) return { ok: false, error: '缺少單號' };
  var q = verifyFindQuoteRow_(no);
  if (!q) return { ok: false, error: '查無此單號' };

  var type = verifyClean_(params.type, 20) || 'ok';
  if (VERIFY_TYPES.indexOf(type) === -1) type = '其他';
  var isOk = (type === 'ok');

  var id = verifyGenId_();
  var images = Array.isArray(params.images) ? params.images.slice(0, VERIFY_MAX_IMAGES) : [];
  var photos = isOk ? '' : verifySaveImages_(no, id, images);

  var rec = {
    id: id,
    created_at: tpeNow_(),
    no: no,
    lot: verifyClean_(params.lot, 40),
    client: q.client,
    item: isOk ? '' : verifyClean_(params.item, 100),
    type: type,
    desc: verifyClean_(params.desc, 500),
    photos: photos,
    reporter: verifyClean_(params.reporter, 60),
    status: isOk ? '已驗收' : '待處理'
  };
  verifyAppendRecord_(rec);
  return { ok: true, id: id };
}

// google.script.run 用（回報頁呼叫）— 非底線結尾才可被 client 呼叫
function submitVerificationRPC(payload) {
  return handleSubmitVerification_(payload || {});
}

// admin：列出/篩選驗收紀錄（照片回連結，不回 base64，保持輕量）
function handleGetVerifications_(params) {
  var sh = getOrCreateVerifySheet_();
  var lastRow = sh.getLastRow();
  var records = [];
  if (lastRow >= 2) {
    var data = sh.getRange(2, 1, lastRow - 1, VERIFY_HEADERS.length).getValues();
    var f = params.filters || {};
    var fno = f.no ? String(f.no).trim() : '';
    var fstatus = f.status ? String(f.status).trim() : '';
    data.forEach(function (r) {
      var no = String(r[VERIFY_COLS.no - 1] || '').trim();
      var status = String(r[VERIFY_COLS.status - 1] || '').trim();
      if (fno && no !== fno) return;
      if (fstatus && status !== fstatus) return;
      records.push({
        id: r[VERIFY_COLS.id - 1],
        created_at: r[VERIFY_COLS.created_at - 1],
        no: no,
        lot: r[VERIFY_COLS.lot - 1],
        client: r[VERIFY_COLS.client - 1],
        item: r[VERIFY_COLS.item - 1],
        type: r[VERIFY_COLS.type - 1],
        desc: r[VERIFY_COLS.desc - 1],
        photos: verifyPhotoLinks_(r[VERIFY_COLS.photos - 1]),
        reporter: r[VERIFY_COLS.reporter - 1],
        status: status,
        handle_note: r[VERIFY_COLS.handle_note - 1],
        amount: r[VERIFY_COLS.amount - 1],
        closed_date: r[VERIFY_COLS.closed_date - 1]
      });
    });
  }
  records.reverse(); // 最新在前
  var summary = {};
  records.forEach(function (rec) {
    var sno = String(rec.no || '');
    if (!summary[sno]) summary[sno] = { count: 0, unhandled: 0, last_at: '' };
    summary[sno].count++;
    var st = String(rec.status || '');
    if (st === '待處理' || st === '處理中') summary[sno].unhandled++;
    var atStr = String(rec.created_at || '');
    if (atStr > summary[sno].last_at) summary[sno].last_at = atStr;
  });
  // v33 選填 limit/since（不帶＝完全照舊）；summary 一律維持全量，計數才不會變
  var recOut = listHasOpts_(params) ? applyListOpts_(records, params, 'created_at') : records;
  return { ok: true, records: recOut, summary: summary };
}

// admin：更新處理狀態
function handleUpdateVerificationStatus_(params) {
  var id = params.id;
  if (!id) throw new Error('缺少 id');
  var fields = params.fields || {};
  var sh = getOrCreateVerifySheet_();
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: false, error: '查無紀錄' };
  var ids = sh.getRange(2, VERIFY_COLS.id, lastRow - 1, 1).getValues();
  var rowNum = -1;
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) { rowNum = i + 2; break; }
  }
  if (rowNum === -1) return { ok: false, error: '查無紀錄：' + id };
  if (fields.status !== undefined) sh.getRange(rowNum, VERIFY_COLS.status).setValue(verifyClean_(fields.status, 20));
  if (fields.handle_note !== undefined) sh.getRange(rowNum, VERIFY_COLS.handle_note).setValue(verifyClean_(fields.handle_note, 1000));
  if (fields.amount !== undefined) sh.getRange(rowNum, VERIFY_COLS.amount).setValue(fields.amount);
  if (fields.closed_date !== undefined) sh.getRange(rowNum, VERIFY_COLS.closed_date).setValue(verifyClean_(fields.closed_date, 40));
  return { ok: true };
}

// admin：系統端手動補登一列（LINE 客訴一鍵登記用；可直接指定 client/status）
function handleAddVerification_(params) {
  var no = verifyClean_(params.no, 40);
  var q = no ? verifyFindQuoteRow_(no) : null;
  var type = verifyClean_(params.type, 20) || '其他';
  if (VERIFY_MANUAL_TYPES_.indexOf(type) === -1) type = '其他';
  var id = verifyGenId_();
  var images = Array.isArray(params.images) ? params.images.slice(0, VERIFY_MAX_IMAGES) : [];
  var photos = images.length ? verifySaveImages_(no || 'manual', id, images) : '';
  var rec = {
    id: id,
    created_at: tpeNow_(),
    no: no,
    lot: verifyClean_(params.lot, 40),
    client: verifyClean_(params.client, 100) || (q ? q.client : ''),
    item: verifyClean_(params.item, 100),
    type: type,
    desc: verifyClean_(params.desc, 500),
    photos: photos,
    reporter: verifyClean_(params.reporter, 60),
    status: verifyClean_(params.status, 20) || (type === 'ok' ? '已驗收' : '待處理')
  };
  verifyAppendRecord_(rec);
  return { ok: true, id: id };
}

// ===================================================================
// 客戶回報頁（doGet ?page=verify）
// ===================================================================
function renderVerifyPage_(params) {
  var no = verifyClean_((params && params.no) || '', 40);
  var lot = verifyClean_((params && params.lot) || '', 40);
  var data = { no: no, lot: lot, client: '', items: [], valid: false };
  if (no) {
    var q = verifyFindQuoteRow_(no);
    if (q) { data.valid = true; data.client = String(q.client || ''); data.items = verifyGetItemNames_(no); }
  }
  var out = HtmlService.createHtmlOutput(buildVerifyHtml_(data));
  out.setTitle('客戶驗收回報');
  out.addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
  return out;
}

function verifyEsc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildVerifyHtml_(data) {
  var dataJson = JSON.stringify(data).replace(/</g, '\\u003c');
  var head =
    '<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8">' +
    '<style>' +
    '*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}' +
    'body{margin:0;font-family:-apple-system,"Noto Sans TC","Microsoft JhengHei",sans-serif;background:#f2f4f3;color:#1c2321;font-size:17px;line-height:1.5}' +
    '.wrap{max-width:520px;margin:0 auto;padding:18px 16px 40px}' +
    '.card{background:#fff;border-radius:14px;box-shadow:0 1px 4px rgba(0,0,0,.08);padding:18px;margin-bottom:16px}' +
    '.brand{font-size:15px;color:#1B4D2E;font-weight:700;letter-spacing:1px}' +
    'h1{font-size:20px;margin:4px 0 14px}' +
    '.meta{background:#f6f9f7;border:1px solid #e2ece6;border-radius:10px;padding:12px 14px;margin-bottom:6px}' +
    '.meta div{display:flex;justify-content:space-between;padding:3px 0;font-size:15px}' +
    '.meta .k{color:#6b7a72}.meta .v{font-weight:600;text-align:right}' +
    '.btn{display:block;width:100%;border:0;border-radius:12px;padding:18px;font-size:19px;font-weight:700;margin-top:12px;cursor:pointer}' +
    '.btn-ok{background:#1B4D2E;color:#fff}' +
    '.btn-issue{background:#fff;color:#b3401a;border:2px solid #e6a892}' +
    '.btn-sub{background:#b3401a;color:#fff}' +
    '.btn:disabled{opacity:.5}' +
    'label{display:block;font-weight:600;margin:16px 0 6px;font-size:15px}' +
    'select,textarea,input[type=text]{width:100%;padding:12px;font-size:16px;border:1px solid #cdd6d1;border-radius:10px;background:#fff}' +
    'textarea{min-height:76px;resize:vertical}' +
    '.types{display:flex;flex-wrap:wrap;gap:8px}' +
    '.types button{flex:1 0 40%;padding:12px;border:1px solid #cdd6d1;background:#fff;border-radius:10px;font-size:15px;cursor:pointer}' +
    '.types button.sel{background:#1B4D2E;color:#fff;border-color:#1B4D2E}' +
    '.filebox{border:1px dashed #cdd6d1;border-radius:10px;padding:12px;text-align:center;color:#6b7a72;font-size:14px}' +
    '.thumbs{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}' +
    '.thumbs img{width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid #ddd}' +
    '.hint{color:#8a968f;font-size:13px;margin-top:6px}' +
    '.hidden{display:none}' +
    '.result{text-align:center;padding:26px 8px}' +
    '.result .ico{font-size:52px}' +
    '.result h2{margin:10px 0 6px}' +
    '.err{color:#b3401a;margin-top:10px;font-size:14px}' +
    '</style></head><body><div class="wrap">';

  var body;
  if (!data.valid) {
    body =
      '<div class="card"><div class="brand">凱文南坡萬實業社</div>' +
      '<h1>客戶驗收回報</h1>' +
      '<p>找不到單號「' + verifyEsc_(data.no) + '」。請確認 QR 是否正確，或直接於 LINE 群聯絡我們，謝謝！</p></div>';
    return head + body + '</div></body></html>';
  }

  body =
    '<div class="card" id="main">' +
    '<div class="brand">凱文南坡萬實業社</div>' +
    '<h1>客戶驗收回報</h1>' +
    '<div class="meta">' +
    '<div><span class="k">單號</span><span class="v">' + verifyEsc_(data.no) + '</span></div>' +
    (data.lot ? '<div><span class="k">Lot</span><span class="v">' + verifyEsc_(data.lot) + '</span></div>' : '') +
    '<div><span class="k">客戶</span><span class="v">' + verifyEsc_(data.client) + '</span></div>' +
    '</div>' +
    '<button class="btn btn-ok" id="btnOk">✅ 驗收無誤</button>' +
    '<button class="btn btn-issue" id="btnIssue">⚠️ 回報問題</button>' +
    // 問題表單
    '<div id="form" class="hidden">' +
    '<label>是哪個品項？</label>' +
    '<select id="fItem"><option value="">（整批／未指定）</option></select>' +
    '<label>問題類型</label>' +
    '<div class="types" id="fTypes">' +
    '<button type="button" data-t="外觀">外觀</button>' +
    '<button type="button" data-t="瓶內異物">瓶內異物</button>' +
    '<button type="button" data-t="數量不符">數量不符</button>' +
    '<button type="button" data-t="其他">其他</button>' +
    '</div>' +
    '<label>拍照上傳（最多 3 張，可略過）</label>' +
    '<div class="filebox"><input type="file" id="fFiles" accept="image/*" capture="environment" multiple></div>' +
    '<div class="thumbs" id="thumbs"></div>' +
    '<label>簡短描述（選填）</label>' +
    '<textarea id="fDesc" placeholder="例：其中兩瓶標籤有刮痕"></textarea>' +
    '<label>您的稱呼／聯絡（選填）</label>' +
    '<input type="text" id="fReporter" placeholder="例：陳先生 0912...">' +
    '<button class="btn btn-sub" id="btnSubmit">送出回報</button>' +
    '<div class="err" id="err"></div>' +
    '</div>' +
    '</div>' +
    // 結果畫面
    '<div class="card hidden" id="done"><div class="result">' +
    '<div class="ico" id="doneIco">✅</div>' +
    '<h2 id="doneTitle"></h2>' +
    '<p id="doneMsg"></p>' +
    '</div></div>';

  var script =
    '<script>' +
    'var VDATA=' + dataJson + ';' +
    'var selType="";var photos=[];' +
    'function $(id){return document.getElementById(id);}' +
    'function show(el,on){el.classList[on?"remove":"add"]("hidden");}' +
    '(function(){var sel=$("fItem");VDATA.items.forEach(function(n){var o=document.createElement("option");o.value=n;o.textContent=n;sel.appendChild(o);});})();' +
    '$("btnIssue").onclick=function(){show($("form"),true);this.classList.add("hidden");window.scrollTo(0,document.body.scrollHeight);};' +
    'Array.prototype.forEach.call($("fTypes").children,function(b){b.onclick=function(){selType=b.getAttribute("data-t");Array.prototype.forEach.call($("fTypes").children,function(x){x.classList.remove("sel");});b.classList.add("sel");};});' +
    // 壓縮圖片
    'function compress(file){return new Promise(function(res){var r=new FileReader();r.onload=function(){var img=new Image();img.onload=function(){var mx=1600;var w=img.width,h=img.height;if(w>mx||h>mx){if(w>h){h=Math.round(h*mx/w);w=mx;}else{w=Math.round(w*mx/h);h=mx;}}var c=document.createElement("canvas");c.width=w;c.height=h;c.getContext("2d").drawImage(img,0,0,w,h);var d=c.toDataURL("image/jpeg",0.82);res({name:(file.name||"photo.jpg").replace(/[^\\w.\\-]+/g,"_"),mime:"image/jpeg",data:d.split(",")[1],preview:d});};img.onerror=function(){res(null);};img.src=r.result;};r.readAsDataURL(file);});}' +
    '$("fFiles").onchange=function(){var fs=Array.prototype.slice.call(this.files,0,3);photos=[];$("thumbs").innerHTML="";Promise.all(fs.map(compress)).then(function(arr){arr.filter(Boolean).forEach(function(p){photos.push({name:p.name,mime:p.mime,data:p.data});var im=document.createElement("img");im.src=p.preview;$("thumbs").appendChild(im);});});};' +
    'function lock(on){$("btnSubmit").disabled=on;$("btnOk").disabled=on;$("btnIssue").disabled=on;}' +
    'function done(ico,title,msg){show($("main"),false);show($("done"),true);$("doneIco").textContent=ico;$("doneTitle").textContent=title;$("doneMsg").textContent=msg;window.scrollTo(0,0);}' +
    'function send(payload){lock(true);$("err").textContent="";google.script.run.withSuccessHandler(function(r){lock(false);if(r&&r.ok){done("✅","已收到，謝謝您！",payload.type==="ok"?"您的驗收確認已送出。":"我們已收到您回報的問題，會盡快與您聯繫。");}else{$("err").textContent=(r&&r.error)||"送出失敗，請再試一次";}}).withFailureHandler(function(e){lock(false);$("err").textContent="送出失敗，請檢查網路後再試一次";}).submitVerificationRPC(payload);}' +
    '$("btnOk").onclick=function(){send({no:VDATA.no,lot:VDATA.lot,type:"ok"});};' +
    '$("btnSubmit").onclick=function(){if(!selType){$("err").textContent="請先選擇問題類型";return;}send({no:VDATA.no,lot:VDATA.lot,item:$("fItem").value,type:selType,desc:$("fDesc").value,reporter:$("fReporter").value,images:photos});};' +
    '</script>';

  return head + body + script + '</body></html>';
}


// ===================================================================
// 對話B 追加（2026-07-25）—— 第三批 A：出貨驗收單「產生紀錄」
//   新 sheet「驗收單紀錄」＋ saveVerifyForm / listVerifyForms（admin token）
//   時間戳用 tpeNow_()（台北 +08:00，與全系統一致）
// ===================================================================
const SHEET_VERIFY_FORM = '驗收單紀錄';
const VERIFY_FORM_HEADERS = [
  '紀錄ID', '建立時間', '單號', 'Lot', '配送日期', '專案經理', '箱數', '品項明細JSON'
];
const VERIFY_FORM_COLS = {
  id: 1, created_at: 2, no: 3, lot: 4, ship_date: 5, pm: 6, boxes: 7, items_json: 8
};
function getOrCreateVerifyFormSheet_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(SHEET_VERIFY_FORM);
  var needHeader = false;
  if (!sh) { sh = ss.insertSheet(SHEET_VERIFY_FORM); needHeader = true; }
  else if (sh.getLastRow() < 1) { needHeader = true; }
  if (needHeader) {
    sh.getRange(1, 1, 1, VERIFY_FORM_HEADERS.length).setValues([VERIFY_FORM_HEADERS])
      .setFontWeight('bold').setBackground('#1B4D2E').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  }
  return sh;
}
function verifyFormGenId_() {
  return 'VF' + (new Date().getTime()) + '-' + Math.floor(Math.random() * 9000 + 1000);
}
function handleSaveVerifyForm_(params) {
  var rec = (params && params.record) || {};
  var no = verifyClean_(rec.no, 40);
  if (!no) return { ok: false, error: '缺少單號' };
  var srcItems = Array.isArray(rec.items) ? rec.items : [];
  var items = srcItems.map(function (it) {
    it = it || {};
    return {
      name: verifyClean_(it.name, 100),
      lot: verifyClean_(it.lot, 40),
      vol: verifyClean_(it.vol, 40),
      mfg: verifyClean_(it.mfg, 40),
      thisShip: Number(it.thisShip) || 0,
      ordered: Number(it.ordered) || 0,
      shipped: Number(it.shipped) || 0
    };
  });
  var id = verifyFormGenId_();
  var sh = getOrCreateVerifyFormSheet_();
  var row = new Array(VERIFY_FORM_HEADERS.length).fill('');
  row[VERIFY_FORM_COLS.id - 1] = id;
  row[VERIFY_FORM_COLS.created_at - 1] = tpeNow_();
  row[VERIFY_FORM_COLS.no - 1] = no;
  row[VERIFY_FORM_COLS.lot - 1] = verifyClean_(rec.lot, 40);
  row[VERIFY_FORM_COLS.ship_date - 1] = verifyClean_(rec.shipDate, 40);
  row[VERIFY_FORM_COLS.pm - 1] = verifyClean_(rec.pm, 60);
  row[VERIFY_FORM_COLS.boxes - 1] = Number(rec.boxes) || 0;
  row[VERIFY_FORM_COLS.items_json - 1] = JSON.stringify(items);
  sh.appendRow(row);
  return { ok: true, id: id };
}
function handleListVerifyForms_(params) {
  var sh = getOrCreateVerifyFormSheet_();
  var lastRow = sh.getLastRow();
  var records = [];
  var summary = {};
  if (lastRow >= 2) {
    var data = sh.getRange(2, 1, lastRow - 1, VERIFY_FORM_HEADERS.length).getValues();
    var f = (params && params.filters) || {};
    var fno = f.no ? String(f.no).trim() : '';
    data.forEach(function (r) {
      var no = String(r[VERIFY_FORM_COLS.no - 1] || '').trim();
      if (fno && no !== fno) return;
      var items = [];
      try { items = JSON.parse(r[VERIFY_FORM_COLS.items_json - 1] || '[]'); } catch (e) { items = []; }
      var createdAt = r[VERIFY_FORM_COLS.created_at - 1];
      records.push({
        id: r[VERIFY_FORM_COLS.id - 1],
        created_at: createdAt,
        no: no,
        lot: r[VERIFY_FORM_COLS.lot - 1],
        ship_date: r[VERIFY_FORM_COLS.ship_date - 1],
        pm: r[VERIFY_FORM_COLS.pm - 1],
        boxes: r[VERIFY_FORM_COLS.boxes - 1],
        items: items
      });
      if (!summary[no]) summary[no] = { count: 0, last_at: '' };
      summary[no].count++;
      var atStr = String(createdAt || '');
      if (atStr > summary[no].last_at) summary[no].last_at = atStr;
    });
  }
  records.reverse();
  // v33 選填 limit/since（不帶＝完全照舊）；summary 一律維持全量，計數才不會變
  var recOut = listHasOpts_(params) ? applyListOpts_(records, params, 'created_at') : records;
  return { ok: true, records: recOut, summary: summary };
}