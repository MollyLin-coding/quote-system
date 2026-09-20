// ===================================================================
// v6_contract.gs —— 合約產生模組（2026-09-15）
// 目的：從報價單／客戶主檔帶入資料，套 Google Docs 範本（佔位符 {{…}}）產出
//       「再製酒類委託生產契約書（代工）」與「自有品牌酒款寄售合作契約書（寄售，免保證金）」，
//       存 Google Doc（可再手改）＋ PDF ＋ docx 到 Drive 資料夾，並在 contracts 分頁留底。
// 範本：Drive 資料夾「報價系統_合約範本」（分享給執行帳號）。範本 ID 存 Script Properties
//       CONTRACT_TPL_OEM / CONTRACT_TPL_CONSIGN，沒設就用程式內預設值。
// actions（程式碼.gs doPost 轉來）：contractPrefill、listContracts、generateContract、setContractTemplate（owner）
// ===================================================================

var SHEET_CONTRACTS = 'contracts';
var CONTRACTS_HEADERS = ['contract_no', 'type', 'quote_no', 'client', 'sign_date', 'term_start', 'term_end',
  'doc_id', 'pdf_id', 'docx_id', 'params_json', 'created_by', 'created_at', 'status', 'note'];
var CONTRACT_OUTPUT_FOLDER_NAME = '合約檔案';
var CONTRACT_TPL_DEFAULT_ = {
  consign: '1osWmyecEZxEItRdJ2NLdPi5706RxAIcuYEdimoqCZgA',   // 寄售合約範本_佔位符（免保證金版）
  oem: ''                                                    // 代工合約範本_佔位符（Molly 上傳後填入或用 setContractTemplate）
};
var CONTRACT_TYPE_NAME_ = { oem: '再製酒類委託生產契約書', consign: '自有品牌酒款寄售合作契約書' };
var CONTRACT_TPL_FOLDER_NAME_ = '報價系統_合約範本';
var CONTRACT_TPL_FILE_NAME_ = { oem: '代工合約範本_佔位符', consign: '寄售合約範本_佔位符' };
var GDOC_MIME_ = 'application/vnd.google-apps.document';

/* 範本 ID 取得順序：Script Property → 程式內預設 → 自動到「報價系統_合約範本」資料夾找同名檔。
   自動找到的如果是 Word(.docx)，會自動轉成 Google 文件再用，並把新 ID 記回 Script Property，
   所以 Molly 之後換範本只要把新的 Word 檔丟進那個資料夾（同檔名）即可，不必自己轉檔。 */
function contractTplId_(type) {
  var key = type === 'oem' ? 'CONTRACT_TPL_OEM' : 'CONTRACT_TPL_CONSIGN';
  var id = '';
  try { id = PropertiesService.getScriptProperties().getProperty(key) || ''; } catch (e) {}
  if (!id) id = CONTRACT_TPL_DEFAULT_[type] || '';
  if (id) {
    // 存過的 ID 若檔案已被刪/沒權限，就退回自動尋找，不要整組壞掉
    try { DriveApp.getFileById(id); return id; } catch (e) { id = ''; }
  }
  try {
    id = contractTplAutoFind_(type);
    if (id) PropertiesService.getScriptProperties().setProperty(key, id);
  } catch (e) { id = ''; }
  return id;
}

/* 到範本資料夾找該型別的範本檔：已是 Google 文件就直接用；是 Word 就轉一份 Google 文件回來。 */
function contractTplAutoFind_(type) {
  var name = CONTRACT_TPL_FILE_NAME_[type];
  if (!name) return '';
  var fit = DriveApp.getFoldersByName(CONTRACT_TPL_FOLDER_NAME_);
  if (!fit.hasNext()) return '';
  var folder = fit.next();
  var gdoc = '', docx = null;
  var files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    var fname = f.getName();
    if (fname.indexOf(name) !== 0) continue;
    if (f.getMimeType() === GDOC_MIME_) { gdoc = f.getId(); break; }
    if (!docx) docx = f;
  }
  if (gdoc) return gdoc;
  if (!docx) return '';
  return contractConvertToDoc_(docx, folder, name);
}

/* Word → Google 文件（Drive API v3 multipart 上傳，會做格式轉換）。回傳新文件 ID。 */
function contractConvertToDoc_(file, folder, name) {
  var blob = file.getBlob();
  var boundary = '-------contracttpl' + Date.now();
  var meta = { name: name, mimeType: GDOC_MIME_, parents: [folder.getId()] };
  var head = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(meta) + '\r\n--' + boundary + '\r\nContent-Type: ' +
    (file.getMimeType() || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') + '\r\n\r\n';
  var tail = '\r\n--' + boundary + '--';
  var bytes = Utilities.newBlob(head).getBytes()
    .concat(blob.getBytes())
    .concat(Utilities.newBlob(tail).getBytes());
  var resp = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true', {
    method: 'post',
    contentType: 'multipart/related; boundary=' + boundary,
    payload: bytes,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) throw new Error('範本轉檔失敗（' + resp.getResponseCode() + '）：' + resp.getContentText().slice(0, 300));
  var id = JSON.parse(resp.getContentText()).id;
  // 轉好之後把原始 Word 檔改名備註，避免下次又被當成待轉檔重複轉
  try { file.setName(name + '_原始Word（已轉檔）'); } catch (e) {}
  return id;
}

function handleSetContractTemplate_(params) {
  var type = String(params.type || '');
  var id = String(params.fileId || '').trim();
  if (!CONTRACT_TYPE_NAME_[type]) throw new Error('type 只能是 oem 或 consign');
  if (!id) throw new Error('缺少 fileId');
  DriveApp.getFileById(id);   // 驗證存取得到
  PropertiesService.getScriptProperties().setProperty(type === 'oem' ? 'CONTRACT_TPL_OEM' : 'CONTRACT_TPL_CONSIGN', id);
  return { ok: true, type: type, fileId: id };
}

// ---------------------------------------------------------------- 帶入
function handleContractPrefill_(params) {
  var quoteNo = String(params.quoteNo || '').trim();
  var out = { ok: true, quote: null, customer: null, consignCustomer: null, templates: { oem: !!contractTplId_('oem'), consign: !!contractTplId_('consign') } };
  var clientName = String(params.clientName || '');
  if (quoteNo) {
    var q = getQuoteWithItems_(quoteNo);
    if (!q) throw new Error('找不到報價單 ' + quoteNo);
    out.quote = q;
    clientName = q.clientName || clientName;
    try { out.pay = orderPayFromQuote_(quoteNo, Number(q.grandTotal) || 0); } catch (e) { out.pay = null; }
  }
  if (clientName) {
    var k = custKey_(clientName);
    try {
      var cus = v2ReadAll_(SHEET_CUSTOMERS, CUSTOMERS_HEADERS).filter(function (c) { return custKey_(c.name) === k; });
      out.customer = cus.length ? cus[0] : null;
    } catch (e) {}
    try {
      var cc = v2ReadAll_(SHEET_CONSIGN_CUSTOMERS, CONSIGN_CUSTOMERS_HEADERS).filter(function (c) { return custKey_(c.name) === k; });
      out.consignCustomer = cc.length ? cc[0] : null;
    } catch (e) {}
  }
  return out;
}

function handleListContracts_(params) {
  var rows = v2ReadAll_(SHEET_CONTRACTS, CONTRACTS_HEADERS);
  rows.forEach(function (r) {
    r.docUrl = r.doc_id ? 'https://docs.google.com/document/d/' + r.doc_id + '/edit' : '';
    r.pdfUrl = r.pdf_id ? 'https://drive.google.com/uc?export=download&id=' + r.pdf_id : '';
    r.docxUrl = r.docx_id ? 'https://drive.google.com/uc?export=download&id=' + r.docx_id : '';
    delete r.params_json;
  });
  rows.sort(function (a, b) { return String(b.contract_no).localeCompare(String(a.contract_no)); });
  return { ok: true, contracts: rows };
}

// ---------------------------------------------------------------- 產生
function handleGenerateContract_(params) {
  var type = String(params.type || '');
  if (!CONTRACT_TYPE_NAME_[type]) throw new Error('type 只能是 oem 或 consign');
  var p = params.params || {};
  if (typeof p === 'string') p = JSON.parse(p);
  var tplId = contractTplId_(type);
  if (!tplId) throw new Error('尚未設定' + CONTRACT_TYPE_NAME_[type] + '的範本（setContractTemplate）');
  if (!String(p.clientName || '').trim()) throw new Error('請填甲方／乙方（客戶）名稱');

  var contractNo = nextContractNo_();
  var map = (type === 'oem') ? oemPlaceholders_(p, contractNo) : consignPlaceholders_(p, contractNo);
  var baseName = sanitizeFileName_(String(p.clientName).trim() + '_' + contractNo + '_' + CONTRACT_TYPE_NAME_[type] + '_凱文南坡萬實業社');

  var folder = contractFolder_();
  var tplFile = DriveApp.getFileById(tplId);
  var docFile = tplFile.makeCopy(baseName, folder);
  var doc = DocumentApp.openById(docFile.getId());
  var body = doc.getBody();

  if (type === 'oem') {
    oemExpandAnnex2_(body, map.products);           // 附件二：每款一張
    oemFillQuoteTable_(body, map);                   // 附件三：代工報價單表格
    oemFillAcceptTable_(body, map);                  // 附件四：容量
  } else {
    consignFillPriceTable_(body, map.priceRows);     // 附件一：價目表
  }
  // 一般佔位符（本文＋頁首頁尾＋表格）
  var targets = [body];
  try { if (doc.getHeader()) targets.push(doc.getHeader()); } catch (e) {}
  try { if (doc.getFooter()) targets.push(doc.getFooter()); } catch (e) {}
  Object.keys(map.text).forEach(function (k) {
    var v = map.text[k] == null ? '' : String(map.text[k]);
    // 2026-09-20：replaceText 的取代字串是字面值，原本的 $ 轉義會讓 NT$1,500 印成 NT$$1,500
    targets.forEach(function (t) { t.replaceText(escRe_('{{' + k + '}}'), v); });
  });
  contractInsertImages_(doc);                         // {{附件一圖1}} 等（若範本用文字佔位＋Script Properties 有圖檔 ID）
  // 殘留佔位符一律清空，不讓 {{…}} 印在正式文件上
  targets.forEach(function (t) { t.replaceText('\\{\\{[^}]*\\}\\}', ''); });
  doc.saveAndClose();

  var file = DriveApp.getFileById(doc.getId());
  var pdfBlob = file.getAs('application/pdf').setName(baseName + '.pdf');
  var pdfFile = folder.createFile(pdfBlob);
  pdfFile.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  var docxFile = null;
  try {
    var resp = UrlFetchApp.fetch('https://docs.google.com/document/d/' + file.getId() + '/export?format=docx', {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true
    });
    if (resp.getResponseCode() === 200) {
      docxFile = folder.createFile(resp.getBlob().setName(baseName + '.docx'));
      docxFile.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    }
  } catch (e) {}

  var operator = '';
  try { if (CURRENT_USER_ && CURRENT_USER_.name) operator = CURRENT_USER_.name; } catch (e) {}
  var row = {
    contract_no: contractNo, type: type, quote_no: p.quoteNo || '', client: String(p.clientName).trim(),
    sign_date: p.signDate || '', term_start: p.termStart || '', term_end: p.termEnd || '',
    doc_id: file.getId(), pdf_id: pdfFile.getId(), docx_id: docxFile ? docxFile.getId() : '',
    params_json: JSON.stringify(p), created_by: operator, created_at: tpeNow_(), status: 'draft', note: p.note || ''
  };
  v2Append_(SHEET_CONTRACTS, CONTRACTS_HEADERS, [CONTRACTS_HEADERS.map(function (h) { return v2AsCell_(row[h]); })]);
  try { logChange_('generateContract', contractNo, { type: type, quoteNo: p.quoteNo || '', client: row.client }); } catch (e) {}

  return {
    ok: true, contractNo: contractNo, type: type,
    docUrl: 'https://docs.google.com/document/d/' + file.getId() + '/edit',
    pdfUrl: 'https://drive.google.com/uc?export=download&id=' + pdfFile.getId(),
    docxUrl: docxFile ? 'https://drive.google.com/uc?export=download&id=' + docxFile.getId() : '',
    fileNameBase: baseName,
    pdfBase64: Utilities.base64Encode(pdfBlob.getBytes())
  };
}

function nextContractNo_() {
  var ymd = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd');
  var prefix = 'CT-' + ymd + '-';
  var max = 0;
  v2ReadAll_(SHEET_CONTRACTS, CONTRACTS_HEADERS).forEach(function (r) {
    var s = String(r.contract_no || '');
    if (s.indexOf(prefix) === 0) { var n = parseInt(s.slice(prefix.length), 10); if (n > max) max = n; }
  });
  return prefix + ('0' + (max + 1)).slice(-2);
}

function contractFolder_() {
  var it = DriveApp.getFoldersByName(CONTRACT_OUTPUT_FOLDER_NAME);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(CONTRACT_OUTPUT_FOLDER_NAME);
}

function escRe_(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ---------------------------------------------------------------- 文字工具
var CN_DIGIT_ = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
var CN_BIG_ = ['零', '壹', '貳', '參', '肆', '伍', '陸', '柒', '捌', '玖'];
function cnNum_(n, big) {   // 0～9999 → 中文（一百十五／貳拾萬 用法）
  n = Math.floor(Math.abs(Number(n) || 0));
  var d = big ? CN_BIG_ : CN_DIGIT_, u10 = big ? '拾' : '十', u100 = big ? '佰' : '百', u1000 = big ? '仟' : '千';
  if (n === 0) return d[0];
  var s = '';
  var th = Math.floor(n / 1000), h = Math.floor(n % 1000 / 100), t = Math.floor(n % 100 / 10), o = n % 10;
  if (th) s += d[th] + u1000;
  if (h) s += d[h] + u100; else if (th && (t || o)) s += d[0];
  if (t) s += ((t === 1 && !th && !h && !big) ? '' : d[t]) + u10; else if ((th || h) && o) s += d[0];
  if (o) s += d[o];
  return s;
}
function cnAmount_(n) {   // 200000 → 貳拾萬元；1500 → 壹仟伍佰元
  n = Math.round(Number(n) || 0);
  if (n === 0) return '零元';
  var yi = Math.floor(n / 100000000), wan = Math.floor(n % 100000000 / 10000), rest = n % 10000;
  var s = '';
  if (yi) s += cnNum_(yi, true) + '億';
  if (wan) s += cnNum_(wan, true) + '萬';
  if (rest) s += ((yi || wan) && rest < 1000 ? '零' : '') + cnNum_(rest, true);
  return s + '元';
}
function ntd_(n) { return 'NT$' + Math.round(Number(n) || 0).toLocaleString('en-US'); }
function moneyCn_(n) { return '新臺幣' + cnAmount_(n) + '（' + ntd_(n) + '）'; }   // 新臺幣貳拾萬元（NT$200,000）
function numFmt_(n) { return Math.round(Number(n) || 0).toLocaleString('en-US'); }
function litersCn_(ml) {   // 125000 ml → 一百二十五公升（125 L）
  var L = Math.round((Number(ml) || 0) / 1000);
  return cnNum_(L) + '公升（' + L + ' L）';
}
function rocDate_(ymd, style) {   // '2026-09-07' → 中華民國115年9月7日 | 一百十五年九月七日（西元2026年9月7日）
  var m = String(ymd || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return String(ymd || '');
  var y = +m[1], mo = +m[2], d = +m[3];
  if (style === 'cn') return cnNum_(y - 1911) + '年' + cnNum_(mo) + '月' + cnNum_(d) + '日（西元' + y + '年' + mo + '月' + d + '日）';
  return '中華民國' + (y - 1911) + '年' + mo + '月' + d + '日';
}
function ymCn_(ymd) { var m = String(ymd || '').match(/^(\d{4})-(\d{1,2})/); return m ? (+m[1]) + '年' + (+m[2]) + '月' : ''; }
function discountCn_(d) {   // 0.75 → 七五折
  var pct = Math.round((Number(d) || 0.75) * 100);
  var t = Math.floor(pct / 10), o = pct % 10;
  return CN_DIGIT_[t] + (o ? CN_DIGIT_[o] : '') + '折';
}
function abvText_(p) {
  var s = (p.abv !== '' && p.abv != null) ? (p.abv + ' 度') : '＿＿度';
  if (p.abvCalc !== '' && p.abvCalc != null) s += '（配方計算值 ' + p.abvCalc + ' 度）';
  return s;
}
function qtyText_(p) {   // 125,000 ml（250 瓶）
  var vol = Number(p.volume) || 0, qty = Number(p.qty) || 0;
  if (!vol || !qty) return (qty ? qty + ' 瓶' : '＿＿＿ 瓶');
  return numFmt_(vol * qty) + ' ml（' + numFmt_(qty) + ' 瓶）';
}

// ---------------------------------------------------------------- 代工：佔位符
function oemPlaceholders_(p, contractNo) {
  var products = (p.products || []).filter(function (x) { return String(x.name || '').trim(); });
  if (!products.length) throw new Error('至少要有一款委託製造產品');
  var n = products.length;
  var taxInc = (p.taxMode || 'inc') !== 'exc';

  // 第一條 1
  var c1;
  if (n === 1) {
    var a = products[0];
    c1 = '委託製造產品：品名「' + a.name + '」；酒精成分 ' + abvText_(a) + '；容量 ' + (a.volume || '＿＿＿') + ' ml；本批數量 ' + qtyText_(a) + '；產品類別：再製酒類。';
  } else {
    c1 = '委託製造產品共' + cnNum_(n) + '款，規格如下：' + products.map(function (x, i) {
      return '(' + (i + 1) + ')「' + x.name + '」：酒精成分 ' + abvText_(x) + '、容量 ' + (x.volume || '＿＿＿') + ' ml、本批數量 ' + qtyText_(x);
    }).join('；') + '。' + cnNum_(n) + '款產品之酒類品目均為再製酒類。';
  }
  var owner = { b: '本產品之配方由乙方研發並提供，其智慧財產權及營業秘密均歸乙方所有。',
    a: '本產品之配方由甲方提供，其智慧財產權及營業秘密歸甲方所有；乙方僅依甲方提供之配方及製程受託製造。',
    both: '本產品之配方由雙方共同開發，其智慧財產權及營業秘密之歸屬另以書面約定。' }[p.formulaOwner || 'b'];
  var annual = p.annualMinMl ? (cnNum_(Math.round(p.annualMinMl / 1000)) + '公升（' + numFmt_(p.annualMinMl) + ' ml）') : '＿＿＿＿ ml';

  // 第四條
  var c4t, c4a, c4b, c4c;
  if (p.clientSupplies) {
    c4t = '甲方提供之原酒及原料';
    c4a = '本產品由甲方提供之原酒或原料（品項：' + (p.supplyItems || '＿＿＿＿＿＿＿＿') + '），甲方應於投產日' + (p.supplyDays ? cnNum_(p.supplyDays) : '＿＿') + '日前交付至乙方指定地點，並同時提供合法進貨憑證及完稅證明。';
    c4b = '甲方擔保前項原酒或原料為合法產製或進口、已依法完稅，且符合食品安全衛生管理法及相關法令之規定。';
    c4c = '因甲方提供之原料遲延交付、數量短缺或品質瑕疵所生之損失、延誤及重製成本，由甲方負擔；乙方得順延交期而不負遲延責任，並就該原料本身之瑕疵不負品質保證責任。';
  } else {
    c4t = '原料供應';
    c4a = '本產品所需之原酒、原料、包材及專業設備，全部由乙方提供；甲方不提供任何原酒或原料。';
    c4b = '雙方日後如另以書面約定由甲方提供特定原酒或原料者，甲方應於投產日前十五日交付至乙方指定地點，並同時提供合法進貨憑證及完稅證明；甲方並擔保其為合法產製或進口、已依法完稅，且符合食品安全衛生管理法及相關法令之規定。';
    c4c = '前款情形，因甲方提供之原料遲延交付、數量短缺或品質瑕疵所生之損失、延誤及重製成本，由甲方負擔；乙方得順延交期而不負遲延責任，並就該原料本身之瑕疵不負品質保證責任。';
  }
  var c5 = '出貨運費由乙方負擔，配送地點限於臺中市（含）以北至臺北市、新北市之區域，並以單批一次全數配送完畢為原則；如需分批配送，其運費另計' +
    (p.splitShipFee ? '，每次' + moneyCn_(p.splitShipFee) : '') + '。指定地點逾前開區域者，運費由甲方負擔。';
  var gs1Fee = Number(p.gs1Fee) || 0;
  var gs1 = { b: '商品條碼（GS1）由乙方代為申請，並登記於甲方名下' + (gs1Fee ? '；申請費用每款' + moneyCn_(gs1Fee) + (n > 1 ? '，' + cnNum_(n) + '款合計' + moneyCn_(gs1Fee * n) : '') + '，由甲方負擔。' : '，申請費用由甲方負擔。'),
    a: '商品條碼（GS1）由甲方自行申請並提供乙方；其登記及費用由甲方負責。',
    none: '商品條碼（GS1）如由乙方代為申請，應登記於甲方名下，申請費用由甲方負擔。' }[p.gs1 || 'none'];
  var c7 = taxInc ? '前項代工單價已含菸酒稅及營業稅。' : '前項代工單價均為未稅價（已含菸酒稅），營業稅另行計收。';
  var note1 = taxInc ? '上列單價已含菸酒稅及營業稅（再製酒類酒精成分20度以下者，每公升按酒精成分每度課徵菸酒稅新臺幣7元）。'
    : '上列單價、檢驗費及條碼登記費均為未稅價，營業稅 5% 另行加計，如上表所列。';

  // 附件三金額
  var lines = [], sum = 0;
  products.forEach(function (x) {
    var st = Math.round((Number(x.unitPrice) || 0) * (Number(x.qty) || 0));
    sum += st;
    lines.push([x.name + '（再製酒類）', (x.volume || '') + ' ml', numFmt_(x.unitPrice || 0), numFmt_(x.qty || 0), numFmt_(st)]);
  });
  var fees = 0;
  if (p.sgs && Number(p.sgsFee)) { var sg = Math.round(Number(p.sgsFee) * n); fees += sg; lines.push(['SGS 檢驗費（' + n + ' 款 × ' + numFmt_(p.sgsFee) + '）', '', '', n + ' 款', numFmt_(sg)]); }
  if ((p.gs1 || 'none') === 'b' && gs1Fee) { var gf = Math.round(gs1Fee * n); fees += gf; lines.push(['GS1 條碼登記費（' + n + ' 款 × ' + numFmt_(gs1Fee) + '）', '', '', n + ' 款', numFmt_(gf)]); }
  var untaxed, tax, total;
  if (taxInc) { untaxed = Math.round(sum / 1.05) + fees; tax = (sum - Math.round(sum / 1.05)) + Math.round(fees * 0.05); total = sum + fees + Math.round(fees * 0.05); }
  else { untaxed = sum + fees; tax = Math.round(untaxed * 0.05); total = untaxed + tax; }
  var dep = Math.round(total / 2), bal = total - dep;
  if (p.depositAmt || p.balanceAmt) { dep = Math.round(Number(p.depositAmt) || 0); bal = Math.round(Number(p.balanceAmt) || 0); }
  var payNote = '付款方式依本契約第八條：製造前十五日內支付百分之五十訂金新臺幣' + numFmt_(dep) + '元，尾款新臺幣' + numFmt_(bal) + '元於驗收完成請款後十五日內支付。';

  var text = {
    '甲方名稱': p.clientName, '甲方代表人': p.clientRep || '', '甲方統編': p.clientTaxId || '', '甲方地址': p.clientAddr || '',
    '甲方電話': p.clientPhone || '', '甲方Email': p.clientEmail || '', '甲方聯絡人': p.clientContact || '',
    '乙方Email': p.ourEmail || '', '乙方聯絡人': p.ourContact || '',
    '發票抬頭': p.invoiceTitle || p.clientName, '報價單號': p.quoteNo || '', '報價有效期限': p.quoteExpiry || '',
    '簽約日期': rocDate_(p.signDate), '合約起日': rocDate_(p.termStart, 'cn'), '合約迄日': rocDate_(p.termEnd, 'cn'),
    '第一條產品': c1, '配方歸屬條款': owner, '年度最低下單量': annual,
    '首批最低批量': p.firstBatchL ? litersCn_(p.firstBatchL * 1000) : '＿＿＿ L ',
    '後續最低批量': p.laterBatchL ? litersCn_(p.laterBatchL * 1000) : '＿＿＿ L ',
    '第四條標題': c4t, '第四條第1款': c4a, '第四條第2款': c4b, '第四條第3款': c4c,
    '第五條第3款': c5, 'GS1條款': gs1, '代工單價稅別條款': c7,
    '保密違約金': p.secrecyPenalty ? cnAmount_(p.secrecyPenalty) + '（' + ntd_(p.secrecyPenalty) + '）' : '＿＿＿＿＿＿＿元',
    '附件三備註1': note1, '附件三付款備註': payNote,
    '附件四產品名稱': products.map(function (x) { return x.name; }).join('、'),
    '附件四容量': uniq_(products.map(function (x) { return String(x.volume || ''); })).join('／')
  };
  return { text: text, products: products, lines: lines, untaxed: untaxed, tax: tax, total: total, taxInc: taxInc, shipText: '乙方負擔' };
}
function uniq_(arr) { var o = {}, r = []; arr.forEach(function (x) { if (!o[x]) { o[x] = 1; r.push(x); } }); return r; }

// 附件二：{{#附件二}}…{{/附件二}} 之間的區塊，每款產品複製一份並各自替換
function oemExpandAnnex2_(body, products) {
  var n = products.length;
  var kids = body.getNumChildren(), startIdx = -1, endIdx = -1;
  for (var i = 0; i < kids; i++) {
    var c = body.getChild(i);
    if (c.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;
    var t = c.asParagraph().getText();
    if (t.indexOf('{{#附件二}}') >= 0) startIdx = i;
    else if (t.indexOf('{{/附件二}}') >= 0) { endIdx = i; break; }
  }
  var fill = function (elems, k) {
    var x = products[k];
    var vals = {
      '附件二序': n > 1 ? '之' + cnNum_(k + 1) : '', '附件二品名': n > 1 ? '　—　' + x.name : '',
      '產品名稱': x.name, '酒精成分': abvText_(x), '容量': String(x.volume || '＿＿＿'), '本批數量': qtyText_(x)
    };
    elems.forEach(function (e) {
      Object.keys(vals).forEach(function (key) { try { e.replaceText(escRe_('{{' + key + '}}'), String(vals[key])); } catch (err) {} });
      // 2026-09-16：附件二配方表（酒譜書／獨立 Run Card 帶入的 products[k].recipe）
      try {
        if (e.getType() === DocumentApp.ElementType.TABLE) oemFillRecipeTable_(e.asTable(), x);
        else if (e.getType() === DocumentApp.ElementType.PARAGRAPH && x.recipe && x.recipe.processNote &&
                 e.asParagraph().getText().indexOf('製程摘要') === 0) e.asParagraph().setText('製程摘要／特殊條件：' + x.recipe.processNote);
      } catch (err2) {}
    });
  };
  if (startIdx < 0 || endIdx < 0) {   // 範本沒有標記：整份當單一產品填
    fill([body], 0);
    return;
  }
  var block = [];
  for (var j = startIdx + 1; j < endIdx; j++) block.push(body.getChild(j));
  // 先複製 n-1 份接在結束標記後面（順序：第2款、第3款…）
  var insertAt = endIdx + 1;
  var copies = [];
  for (var k = 1; k < n; k++) {
    var set = [];
    for (var b = 0; b < block.length; b++) {
      var src = block[b], cp = src.copy(), ins;
      switch (src.getType()) {
        case DocumentApp.ElementType.PARAGRAPH: ins = body.insertParagraph(insertAt, cp); break;
        case DocumentApp.ElementType.TABLE: ins = body.insertTable(insertAt, cp); break;
        case DocumentApp.ElementType.LIST_ITEM: ins = body.insertListItem(insertAt, cp); break;
        case DocumentApp.ElementType.PAGE_BREAK: ins = body.insertPageBreak(insertAt, cp); break;
        default: ins = null;
      }
      if (ins) { set.push(ins); insertAt++; }
    }
    copies.push(set);
  }
  fill(block, 0);
  copies.forEach(function (set, idx) { fill(set, idx + 1); });
  // 移除標記段落（先後面的）
  var endEl = body.getChild(endIdx), startEl = body.getChild(startIdx);
  try { endEl.asParagraph().removeFromParent(); } catch (e) { endEl.asParagraph().setText(''); }
  try { startEl.asParagraph().removeFromParent(); } catch (e) { startEl.asParagraph().setText(''); }
}

function findTable_(body, firstCellText) {
  var ts = body.getTables();
  for (var i = 0; i < ts.length; i++) {
    try { if (ts[i].getCell(0, 0).getText().replace(/\s/g, '').indexOf(firstCellText) === 0) return ts[i]; } catch (e) {}
  }
  return null;
}
function setRowTexts_(row, vals) {
  for (var c = 0; c < row.getNumCells() && c < vals.length; c++) {
    var cell = row.getCell(c), v = vals[c] == null ? '' : String(vals[c]);
    var ps = cell.getNumChildren() ? cell.getChild(0) : null;
    if (ps && ps.getType() === DocumentApp.ElementType.PARAGRAPH) {
      // 2026-09-16：setText('') 會丟 "Cannot insert an empty text element"，空值改用 clear()
      if (v === '') ps.asParagraph().clear(); else ps.asParagraph().setText(v);
      for (var k = cell.getNumChildren() - 1; k >= 1; k--) { try { cell.removeChild(cell.getChild(k)); } catch (e) {} }
    } else cell.setText(v);
  }
}
// 附件三：表頭「品名／項目」；空白列填品項，其後「合計（未稅）／營業稅／運費／總計（含稅）」
function oemFillQuoteTable_(body, map) {
  var t = findTable_(body, '品名／項目') || findTable_(body, '品名/項目');
  if (!t) return;
  // 2026-09-20：表頭「單價」依報價單稅別自動切換（範本原本寫死「單價（含稅）」，未稅報價時會與內文矛盾）
  try {
    var hd = t.getRow(0);
    for (var hc = 0; hc < hd.getNumCells(); hc++) {
      if (hd.getCell(hc).getText().replace(/\s/g, '').indexOf('單價') === 0) {
        hd.getCell(hc).setText(map.taxInc ? '單價（含稅）' : '單價（未稅）');
        break;
      }
    }
  } catch (e) {}
  var rows = t.getNumRows(), tplRow = null, firstBlank = -1, blanks = [];
  for (var r = 1; r < rows; r++) {
    var c0 = t.getRow(r).getCell(0).getText().trim();
    if (c0 === '') { if (!tplRow) { tplRow = t.getRow(r).copy(); firstBlank = r; } blanks.push(r); }
  }
  for (var b = blanks.length - 1; b >= 0; b--) t.removeRow(blanks[b]);
  var at = firstBlank > 0 ? firstBlank : 1;
  map.lines.forEach(function (vals, i) {
    var row = tplRow ? t.insertTableRow(at + i, tplRow.copy()) : t.insertTableRow(at + i);
    if (!tplRow) for (var c = 0; c < vals.length; c++) row.appendTableCell('');
    setRowTexts_(row, vals);
  });
  for (var r2 = 0; r2 < t.getNumRows(); r2++) {
    var row2 = t.getRow(r2), label = row2.getCell(0).getText().replace(/\s/g, '');
    var last = row2.getNumCells() - 1;
    if (label.indexOf('合計') === 0) row2.getCell(last).setText(numFmt_(map.untaxed));
    else if (label.indexOf('營業稅') === 0) row2.getCell(last).setText(numFmt_(map.tax));
    else if (label.indexOf('運費') === 0) row2.getCell(last).setText(map.shipText || '乙方負擔');
    else if (label.indexOf('總計') === 0) row2.getCell(last).setText(numFmt_(map.total));
  }
}
function oemFillAcceptTable_(body, map) { /* 附件四容量已用 {{附件四容量}} 佔位符處理；保留函式供日後擴充 */ }

// ---------------------------------------------------------------- 寄售：佔位符
function consignPlaceholders_(p, contractNo) {
  var discount = Number(p.discount) || 0.75;
  var prods = [];
  try { prods = v2ReadAll_(SHEET_OWNBRAND_PRODUCTS, OWNBRAND_PRODUCTS_HEADERS).filter(function (x) { return String(x.active).toUpperCase() !== 'N' && String(x.name || '').trim(); }); } catch (e) {}
  if (p.products && p.products.length) prods = p.products;   // 前端可自行指定價目表內容
  prods.sort(function (a, b) {
    var d = (Number(a.abv) || 0) - (Number(b.abv) || 0); if (d) return d;
    var s = String(a.name).localeCompare(String(b.name), 'zh-Hant'); if (s) return s;
    return (Number(a.volume) || 0) - (Number(b.volume) || 0);
  });
  var seriesName = function (abv) { var v = Number(abv) || 0; return v >= 12 ? '典藏系列' : '經典系列'; };
  var priceRows = [], lastSeries = '';
  prods.forEach(function (x) {
    var sn = seriesName(x.abv) + '（ABV ' + (Number(x.abv) || 0) + '%）';
    if (sn !== lastSeries) { priceRows.push({ series: '▸ ' + sn }); lastSeries = sn; }
    var lp = Math.round(Number(x.list_price != null ? x.list_price : x.listPrice) || 0);
    priceRows.push({ name: x.name, spec: (x.volume || '') + 'ml', list: numFmt_(lp), settle: numFmt_(lp * discount), abv: (Number(x.abv) || 0) + '%' });
  });
  var text = {
    '乙方名稱': p.clientName, '乙方代表人': p.clientRep || '', '乙方統編': p.clientTaxId || '', '乙方地址': p.clientAddr || '', '乙方電話': p.clientPhone || '',
    '簽約日期': rocDate_(p.signDate), '價目表日期': ymCn_(p.signDate || Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd')),
    '結算折數': discountCn_(discount)
  };
  return { text: text, priceRows: priceRows };
}
// 附件一價目表：第 1 列表頭、第 2 列系列樣板（{{系列}}）、第 3 列酒款樣板
function consignFillPriceTable_(body, priceRows) {
  var t = findTable_(body, '酒款');
  if (!t) return;
  var seriesTpl = null, prodTpl = null;
  for (var r = 1; r < t.getNumRows(); r++) {
    var txt = t.getRow(r).getText();
    if (txt.indexOf('{{系列}}') >= 0 && !seriesTpl) seriesTpl = t.getRow(r).copy();
    if (txt.indexOf('{{酒款}}') >= 0 && !prodTpl) prodTpl = t.getRow(r).copy();
  }
  for (var r2 = t.getNumRows() - 1; r2 >= 1; r2--) t.removeRow(r2);
  priceRows.forEach(function (pr) {
    if (pr.series) {
      var row = seriesTpl ? t.appendTableRow(seriesTpl.copy()) : t.appendTableRow();
      if (!seriesTpl) row.appendTableCell(pr.series);
      row.replaceText(escRe_('{{系列}}'), pr.series);
      if (row.getText().indexOf(pr.series) < 0) row.getCell(0).setText(pr.series);
    } else {
      var row2 = prodTpl ? t.appendTableRow(prodTpl.copy()) : t.appendTableRow();
      if (!prodTpl) ['name', 'spec', 'list', 'settle', 'abv'].forEach(function (k) { row2.appendTableCell(String(pr[k])); });
      row2.replaceText(escRe_('{{酒款}}'), pr.name); row2.replaceText(escRe_('{{規格}}'), pr.spec);
      row2.replaceText(escRe_('{{建議零售價}}'), pr.list); row2.replaceText(escRe_('{{寄售結算價}}'), pr.settle);
      row2.replaceText(escRe_('{{酒精度}}'), pr.abv);
    }
  });
}

// ---------------------------------------------------------------- 圖片佔位符（範本以文字佔位時用）
// Script Properties：CONTRACT_IMG_附件一圖1 / CONTRACT_IMG_附件一圖2 / CONTRACT_IMG_頁首LOGO ＝ Drive 圖檔 ID
function contractInsertImages_(doc) {
  var props; try { props = PropertiesService.getScriptProperties().getProperties(); } catch (e) { return; }
  var sizes = { '附件一圖1': [340, 405], '附件一圖2': [300, 475], '頁首LOGO': [150, 33] };
  Object.keys(sizes).forEach(function (key) {
    var id = props['CONTRACT_IMG_' + key]; if (!id) return;
    var blob; try { blob = DriveApp.getFileById(id).getBlob(); } catch (e) { return; }
    var sections = [doc.getBody()];
    try { if (doc.getHeader()) sections.push(doc.getHeader()); } catch (e) {}
    sections.forEach(function (sec) {
      var el = sec.findText(escRe_('{{' + key + '}}'));
      while (el) {
        var textEl = el.getElement(), para = textEl.getParent();
        while (para && para.getType() !== DocumentApp.ElementType.PARAGRAPH) para = para.getParent();
        if (!para) break;
        textEl.asText().replaceText(escRe_('{{' + key + '}}'), '');
        var img = para.asParagraph().appendInlineImage(blob);
        img.setWidth(sizes[key][0]).setHeight(sizes[key][1]);
        el = sec.findText(escRe_('{{' + key + '}}'), el);
      }
    });
  });
}

// ===================================================================
// 附件二「產品配方及規格表」帶入（2026-09-16 Molly：A 酒譜書＋無訂單之獨立 Run Card；B 圖片辨識暫緩）
//   資料來源都在廠務／酒譜 APP（MollyLin-coding/recipe）的試算表：
//   ① 各客戶酒譜書（RECIPE_BOOKS_，與 APP 後端 CLIENTS 同一份 ID／前綴設定；新客戶轉正式時要同步加）
//      分頁版面：Row2 E=酒款名、I=ABV；Row4 起 A=原料 B=占比(小數) C=體積 D=原料ABV E=製作方式；「總體積」列 C=總體積 D=ABV
//   ② 主表 RunCard 分頁（B 訂單編號空白＝獨立卡）：K 欄資料JSON liquids[{name,pct,abv,vol,method,subs}] / solids[{name,ratio}]
//   actions：contractRecipeSources（清單）、contractRecipeFetch（單筆明細）。只讀，不寫回任何試算表。
//   產合約時 products[k].recipe = { source, totalVol, abvCalc, rows:[{name,pct,vol,abv,by,note}] } 由 oemFillRecipeTable_ 填進附件二表格。
// ===================================================================
var RECIPE_APP_MAIN_SHEET_ID_ = '1rXmA0ACRwy4jo3XEkXHZzNjJw8uZzX1jzVle-6k0V40';
var RECIPE_BOOKS_ = [
  { key: 'Feeling Bar',        id: '1WwCsC2SvLqWmGFPrwzM8pYLx3DpF3VM_3srfksWfza4', prefix: /^(0?FB_)/i,   strip: /^0?FB_/i },
  { key: '南坡萬公版',          id: '1X6euYjrRz72Fms8B3lvWjAhcJ81AlLp9BgnB_7zW1pU', prefix: /^NO1_/i,      strip: /^NO1_/i },
  { key: 'Feeling Bar Cafe',   id: '14vso62AkYRubqKVsgWBMpHS79KkEgbXFkdnPdrodckE', prefix: /^FBC_/i,      strip: /^FBC_/i },
  { key: '南坡萬v.2',           id: '1816K_4KJ-YTX3102TMw58po5QVrUFzy3tGhQPFjQLdE', prefix: /^NO1\.V2_/i,  strip: /^NO1\.V2_/i },
  { key: 'OEM-Babyface',       id: '1BLZREU_iCSij55jLApYZgPawISYF3reF2rsilqz3K6s', prefix: /^BF_/i,       strip: /^BF_/i },
  { key: '全客製-酒肉朋友',      id: '1GguVGe67xnq1GlMVqUSb1GUQrT-tzXTLXAl2yVpvh1Q', prefix: /調酒$/,       strip: /調酒$/ },
  { key: '全客製-昭和浪漫冰室',   id: '1OhqlXI7kDOH_SvwXblnx8ltzEXsGuFud2ZTNWQk39NA', prefix: /^SH_/i,       strip: /^SH_/i },
  { key: 'OEM-好野吧',          id: '1v8WSv-L5Ox-AOcqMBgXyj-HyXwYyIp4FRDVqhwodF1M', prefix: /^好野吧-/,     strip: /^好野吧-/ },
  { key: '全客製-日富一日',      id: '1hsava4Cq-Pu3ywS6ixlRQcQJDFRrD63leGJoeJ6pJKI', prefix: /^FUJI-/i,     strip: /^FUJI-/i },
  { key: '全客製-雋荖&拾山',     id: '1U-glkwgsCyYzzCbUdrHrxaYpsybe1ww5WD9dLr3nGqc', prefix: /^JL_/i,       strip: /^JL_/i },
  { key: 'OEM-Lane72',         id: '14efyPLxCCYolDfsTqcehUPU8JdxZoB9aB8RLjJB_7r8', prefix: /^L72_/i,      strip: /^L72_/i }
];
var RECIPE_SRC_CACHE_KEY_ = 'contractRecipeSources_v1';

function recipeClientKey_(s) {   // 客戶名稱正規化：去 全客製-/OEM- 前綴、去空白、小寫
  return String(s == null ? '' : s).replace(/^(全客製|OEM)[-－_]/i, '').replace(/[\s　]+/g, '').toLowerCase();
}
function recipeClientMatch_(a, b) {
  var x = recipeClientKey_(a), y = recipeClientKey_(b);
  if (!x || !y) return false;
  return x === y || x.indexOf(y) >= 0 || y.indexOf(x) >= 0;
}
function recipeNormAbv_(v) {
  var n = parseFloat(String(v == null ? '' : v).replace('%', '').trim());
  if (!(n > 0)) return 0;
  return n <= 1 ? Math.round(n * 10000) / 100 : n;
}
function recipeNum_(v, d) { var n = Number(v); if (!isFinite(n)) return 0; var m = Math.pow(10, d == null ? 2 : d); return Math.round(n * m) / m; }

/* 清單：所有酒譜書的酒款分頁 ＋ 主表 RunCard 的獨立卡。整份快取 10 分鐘（冷路徑要開 12 本試算表）。 */
function handleContractRecipeSources_(params) {
  var clientName = String(params.clientName || '');
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) {}
  var data = null;
  if (cache && !params.force) { try { var c = cache.get(RECIPE_SRC_CACHE_KEY_); if (c) data = JSON.parse(c); } catch (e) {} }
  if (!data) {
    data = { books: [], runcards: [], builtAt: tpeNow_() };
    RECIPE_BOOKS_.forEach(function (bk) {
      var entry = { key: bk.key, recipes: [] };
      try {
        var ss = SpreadsheetApp.openById(bk.id);
        ss.getSheets().forEach(function (ws) {
          var name = ws.getName();
          if (name.indexOf('毛利') >= 0 || name.indexOf('報價') >= 0 || !bk.prefix.test(name)) return;
          var recipeName = '';
          try { var r2 = ws.getRange(2, 1, 1, 9).getValues()[0]; recipeName = String(r2[4] || r2[3] || '').trim(); } catch (e) {}
          if (!recipeName) recipeName = name.replace(bk.strip, '');
          entry.recipes.push({ sheet: name, recipeName: recipeName });
        });
      } catch (e) { entry.error = String(e).slice(0, 120); }
      data.books.push(entry);
    });
    try {
      var rc = SpreadsheetApp.openById(RECIPE_APP_MAIN_SHEET_ID_).getSheetByName('RunCard');
      var v = rc ? rc.getDataRange().getValues() : [];
      for (var i = 1; i < v.length; i++) {
        var id = String(v[i][0] || '').trim();
        if (!id || String(v[i][1] || '').trim()) continue;   // 有訂單編號的不算獨立卡
        data.runcards.push({ id: id, client: String(v[i][2] || ''), product: String(v[i][3] || ''), sheet: String(v[i][4] || ''),
          bottle: String(v[i][5] || ''), date: v[i][6] ? Utilities.formatDate(new Date(v[i][6]), 'Asia/Taipei', 'yyyy-MM-dd') : '',
          status: String(v[i][11] || ''), updatedAt: v[i][15] ? String(v[i][15]) : '' });
      }
      data.runcards.reverse();   // 新的在前
    } catch (e) { data.runcardError = String(e).slice(0, 120); }
    if (cache) { try { cache.put(RECIPE_SRC_CACHE_KEY_, JSON.stringify(data), 600); } catch (e) {} }
  }
  data.books.forEach(function (b) { b.matched = recipeClientMatch_(b.key, clientName); });
  data.runcards.forEach(function (r) { r.matched = recipeClientMatch_(r.client, clientName); });
  return { ok: true, books: data.books, runcards: data.runcards, builtAt: data.builtAt };
}

/* 明細：src='sheet'（key＋sheet）或 src='runcard'（id）。回傳統一格式，不含任何成本欄位。 */
function handleContractRecipeFetch_(params) {
  var src = String(params.src || '');
  if (src === 'sheet') return recipeFromSheet_(String(params.key || ''), String(params.sheet || ''));
  if (src === 'runcard') return recipeFromRunCard_(String(params.id || ''));
  throw new Error('src 只能是 sheet 或 runcard');
}
function recipeFromSheet_(key, sheet) {
  var bk = null;
  RECIPE_BOOKS_.forEach(function (b) { if (b.key === key) bk = b; });
  if (!bk) throw new Error('沒有這本酒譜書：' + key);
  var ws = SpreadsheetApp.openById(bk.id).getSheetByName(sheet);
  if (!ws) throw new Error('酒譜書「' + key + '」找不到分頁 ' + sheet);
  var data = ws.getDataRange().getValues();
  var recipeName = '', abv = 0, totalVol = 0, processNote = '';
  if (data.length > 1) {
    recipeName = String(data[1][4] || '').trim();
    abv = recipeNormAbv_(data[1][8]);
    if (!abv) { var h = recipeNormAbv_(data[1][7]); if (h > 0 && h <= 100) abv = h; }
  }
  var totalVolRow = -1, subEndRow = -1;
  for (var i = 3; i < data.length; i++) {
    var a = String(data[i][0] || '').trim();
    if (totalVolRow < 0 && a === '總體積') { totalVolRow = i; continue; }
    if (totalVolRow >= 0 && (/ml版總食材成本/.test(a) || a === '製程備註')) { subEndRow = i; break; }
  }
  var ingEnd = totalVolRow >= 0 ? totalVolRow : data.length;
  var rows = [];
  for (var r = 3; r < ingEnd; r++) {
    var row = data[r], name = String(row[0] || '').trim();
    if (!name || name === '基礎原料') continue;
    var rawPct = parseFloat(row[1]) || 0;
    var pct = rawPct <= 1 ? rawPct * 100 : rawPct;
    var vol = parseFloat(row[2]) || 0;
    if (!(pct > 0 || vol > 0)) continue;
    var method = String(row[4] == null ? '' : row[4]).trim();
    rows.push({ name: name, pct: recipeNum_(pct, 2), vol: recipeNum_(vol, 1), abv: recipeNum_(parseFloat(row[3]) || 0, 2), method: method });
  }
  if (totalVolRow >= 0) { totalVol = parseFloat(data[totalVolRow][2]) || 0; abv = parseFloat(data[totalVolRow][3]) || abv; }
  for (var k = (subEndRow >= 0 ? subEndRow : ingEnd); k < data.length; k++) {
    if (String(data[k][0] || '').trim() === '製程備註') { if (k + 1 < data.length) processNote = String(data[k + 1][0] || data[k + 1][1] || '').trim(); break; }
  }
  return { ok: true, src: 'sheet', source: key + '／' + sheet, recipeName: recipeName || sheet.replace(bk.strip, ''),
    abv: recipeNum_(abv, 2), totalVol: totalVol, processNote: processNote, rows: rows };
}
function recipeFromRunCard_(id) {
  if (!id) throw new Error('缺少 Run Card 卡號');
  var rc = SpreadsheetApp.openById(RECIPE_APP_MAIN_SHEET_ID_).getSheetByName('RunCard');
  if (!rc) throw new Error('主表沒有 RunCard 分頁');
  var v = rc.getDataRange().getValues(), hit = null;
  for (var i = 1; i < v.length; i++) if (String(v[i][0] || '').trim() === id) { hit = v[i]; break; }
  if (!hit) throw new Error('找不到 Run Card ' + id);
  var d = {};
  try { d = JSON.parse(String(hit[10] || '{}')) || {}; } catch (e) { throw new Error('Run Card ' + id + ' 的資料 JSON 解析失敗'); }
  var rows = [], sumAbv = 0, sumPct = 0;
  (d.liquids || []).forEach(function (l) {
    var pct = Number(l.pct) || 0, abv = Number(l.abv) || 0;
    var note = (l.subs && l.subs.length) ? ('子料：' + l.subs.map(function (s) { return s.name + (s.ratio != null && s.ratio !== '' ? '×' + s.ratio : ''); }).join('、')) : '';
    rows.push({ name: String(l.name || ''), pct: recipeNum_(pct, 2), vol: recipeNum_(Number(l.vol) || 0, 1), abv: recipeNum_(abv, 2),
      method: String(l.method || ''), note: [note, String(l.note || '')].filter(Boolean).join('；') });
    sumAbv += pct * abv / 100; sumPct += pct;
  });
  (d.solids || []).forEach(function (s) {
    rows.push({ name: String(s.name || ''), pct: '', vol: '', abv: '', method: '', note: '固體原料' + (s.ratio != null && s.ratio !== '' ? '，比例 ' + s.ratio : '') + (s.note ? '；' + s.note : '') });
  });
  return { ok: true, src: 'runcard', source: 'Run Card ' + id + (hit[3] ? '／' + hit[3] : ''), recipeName: String(hit[3] || ''),
    client: String(hit[2] || ''), abv: recipeNum_(sumAbv, 2), pctSum: recipeNum_(sumPct, 2), totalVol: Number(d.totalVol) || 0,
    processNote: String(d.processNote || ''), rows: rows };
}

/* 附件二表格：表頭「項次」；1～10 為空白列（不夠會複製最後一列往下加）；末列「總體積／計算酒精度」。
   體積以「單瓶容量 × 占比」換算（表頭已寫容量），沒有單瓶容量才退回配方原體積。 */
function oemFillRecipeTable_(table, product) {
  var rcp = product && product.recipe;
  if (!rcp || !(rcp.rows || []).length) return;
  var rows = rcp.rows.filter(function (r) { return String(r.name || '').trim(); });
  var nRows = table.getNumRows();
  var totalIdx = -1;
  for (var r = 1; r < nRows; r++) { if (table.getRow(r).getCell(1).getText().indexOf('總體積') >= 0) { totalIdx = r; break; } }
  var dataStart = 1, dataEnd = (totalIdx > 0 ? totalIdx : nRows) - 1;   // inclusive
  var avail = dataEnd - dataStart + 1;
  var bottleVol = Number(product.volume) || 0;
  // 不夠列就在總體積列前面複製一列
  while (avail < rows.length) {
    var tplRow = table.getRow(dataEnd).copy();
    table.insertTableRow(dataEnd + 1, tplRow);
    dataEnd++; avail++; if (totalIdx > 0) totalIdx++;
  }
  for (var i = 0; i < avail; i++) {
    var row = table.getRow(dataStart + i);
    if (i < rows.length) {
      var x = rows[i];
      var pct = Number(x.pct), vol = Number(x.vol);
      var volTxt = '';
      if (pct > 0 && bottleVol > 0) volTxt = String(recipeNum_(bottleVol * pct / 100, 1));
      else if (vol > 0) volTxt = String(recipeNum_(vol, 1));
      var nameTxt = String(x.name || '') + (x.method ? '\n' + x.method : '') + (x.note ? '\n' + x.note : '');
      setRowTexts_(row, [String(i + 1), nameTxt, pct > 0 ? recipeNum_(pct, 2) + '%' : '', volTxt,
        (x.abv !== '' && x.abv != null && Number(x.abv) >= 0 && String(x.abv) !== '') ? (recipeNum_(x.abv, 2) + '%') : '',
        x.by === '甲' ? '甲方' : (x.by === '乙' ? '乙方' : '')]);
    } else {
      setRowTexts_(row, [String(i + 1), '', '', '', '', '']);   // 多餘的空白列保留（原本就是留給手寫）
    }
  }
  if (totalIdx > 0) {
    var tr = table.getRow(totalIdx);
    var sumPct = 0; rows.forEach(function (x) { sumPct += Number(x.pct) || 0; });
    setRowTexts_(tr, ['', '總體積／計算酒精度', (sumPct ? recipeNum_(sumPct, 1) : 100) + '%',
      bottleVol ? String(bottleVol) : (rcp.totalVol ? String(rcp.totalVol) : ''),
      (rcp.abvCalc !== '' && rcp.abvCalc != null) ? (recipeNum_(rcp.abvCalc, 2) + '%') : (product.abvCalc ? recipeNum_(product.abvCalc, 2) + '%' : ''), '']);
  }
}
