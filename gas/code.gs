/**
 * ===================================================================
 * 凱文南坡萬實業社 - 報價單系統 GAS 後端
 * ===================================================================
 * Sheet ID: 16AzAcXu_rV8ZZoZJIlyC3HiZkvCcVAnaN1hd4fUTDJ0
 *
 * 部署方式：
 * 1. 先執行 setupDatabase() 一次，建立分頁結構
 * 2. 在 Script Properties 設定 PIN_CODE（部署 > 專案設定 > Script Properties）
 * 3. 部署為 Web App，執行身分：「我」，存取權限：「任何人」
 *
 * action 列表：
 * - login            驗證 PIN，回傳 token
 * - createQuote      建立新報價單
 * - getQuotes        取得報價單列表（可篩選）
 * - getQuoteById     取得單張報價單完整資料
 * - updateQuote      更新報價單
 * - deleteQuote       刪除報價單（軟刪除，標記狀態）
 * - generateQuoteDocument  產生正式 PDF/Word 文件（Google Doc 動態建立，不靠範本檔）
 * ===================================================================
 */

const SHEET_ID = '16AzAcXu_rV8ZZoZJIlyC3HiZkvCcVAnaN1hd4fUTDJ0';
const SHEET_MAIN = '報價單主表';
const SHEET_ITEMS = '報價單品項';

// 報價單主表欄位（A=1 開始）
const MAIN_COLS = {
  quoteNo: 1,           // A 報價單號
  quoteType: 2,         // B 報價類型 (bottle/banquet)
  clientName: 3,        // C 客戶名稱
  contactName: 4,       // D 聯絡人
  clientTaxId: 5,        // E 客戶統編
  contactPhone: 6,       // F 聯絡電話
  clientAddress: 7,      // G 聯絡地址
  quoteDate: 8,           // H 報價日期
  expiryDate: 9,          // I 有效日期
  handler: 10,             // J 處理人員
  itemsSubtotal: 11,       // K 品項合計
  taxAmount: 12,            // L 稅額
  extrasTotal: 13,          // M 額外費用合計
  grandTotal: 14,           // N 總計
  priceMode: 15,            // O 價格模式 (inc/exc)
  taxRate: 16,              // P 稅率
  paymentType: 17,          // Q 付款條件類型
  paymentDetail: 18,        // R 付款條件詳情
  remark: 19,               // S 備註
  imageLinks: 20,           // T 圖片連結
  status: 21,               // U 狀態
  createdAt: 22,            // V 建立時間
  updatedAt: 23,            // W 最後修改時間
  pdfUrl: 24,               // X PDF連結
  docUrl: 25,               // Y Word連結
  venue: 26,                // Z 佈置地點
  entryTime: 27,            // AA 進場時間
  serviceTime: 28,          // AB 供酒時間
  exitTime: 29,             // AC 撤場時間
  svcMode: 30,              // AD 調酒師服務費模式
  svcAmount: 31             // AE 調酒師服務費金額
};

const ITEM_COLS = {
  quoteNo: 1,      // A 報價單號
  itemType: 2,     // B 品項類型
  name: 3,         // C 品名
  lot: 4,          // D 批次
  volume: 5,       // E 容量ml
  unitPrice: 6,    // F 單價
  deduction: 7,    // G 標費扣除
  logoFee: 8,      // H LOGO印刷費
  qty: 9,          // I 數量
  unit: 10,         // J 單位
  subtotal: 11,     // K 小計
  flavorList: 12    // L 品名清單
};

const MAIN_HEADERS = [
  '報價單號','報價類型','客戶名稱','聯絡人','客戶統編','聯絡電話','聯絡地址',
  '報價日期','有效日期','處理人員','品項合計','稅額','額外費用合計','總計',
  '價格模式','稅率','付款條件類型','付款條件詳情','備註','圖片連結','狀態',
  '建立時間','最後修改時間','PDF連結','Word連結',
  '佈置地點','進場時間','供酒時間','撤場時間','調酒師服務費模式','調酒師服務費金額'
];

const ITEM_HEADERS = [
  '報價單號','品項類型','品名','批次','容量ml','單價','標費扣除','LOGO印刷費',
  '數量','單位','小計','品名清單'
];

// ===================================================================
// 初始化：建立分頁結構（手動執行一次）
// ===================================================================
function setupDatabase() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  // 建立或取得「報價單主表」
  let mainSheet = ss.getSheetByName(SHEET_MAIN);
  if (!mainSheet) {
    mainSheet = ss.insertSheet(SHEET_MAIN);
  }
  mainSheet.clear();
  mainSheet.getRange(1, 1, 1, MAIN_HEADERS.length).setValues([MAIN_HEADERS]);
  mainSheet.getRange(1, 1, 1, MAIN_HEADERS.length)
    .setFontWeight('bold')
    .setBackground('#1B4D2E')
    .setFontColor('#FFFFFF');
  mainSheet.setFrozenRows(1);
  mainSheet.setFrozenColumns(1);

  // 建立或取得「報價單品項」
  let itemSheet = ss.getSheetByName(SHEET_ITEMS);
  if (!itemSheet) {
    itemSheet = ss.insertSheet(SHEET_ITEMS);
  }
  itemSheet.clear();
  itemSheet.getRange(1, 1, 1, ITEM_HEADERS.length).setValues([ITEM_HEADERS]);
  itemSheet.getRange(1, 1, 1, ITEM_HEADERS.length)
    .setFontWeight('bold')
    .setBackground('#1B4D2E')
    .setFontColor('#FFFFFF');
  itemSheet.setFrozenRows(1);
  itemSheet.setFrozenColumns(1);

  // 刪除預設的「工作表1」（如果存在且是空的）
  const defaultSheet = ss.getSheetByName('工作表1') || ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 2) {
    ss.deleteSheet(defaultSheet);
  }

  return 'Database setup complete. Sheets: ' + ss.getSheets().map(s => s.getName()).join(', ');
}

// ===================================================================
// PIN 驗證（簡單 token 機制，給內部單人使用）
// ===================================================================
function checkPin_(pin) {
  const props = PropertiesService.getScriptProperties();
  const correctPin = props.getProperty('PIN_CODE');
  if (!correctPin) {
    throw new Error('系統尚未設定 PIN_CODE，請在 Script Properties 中設定');
  }
  return String(pin) === String(correctPin);
}

function generateToken_() {
  // 簡單 token：時間戳 + 隨機碼，存入 Script Properties 並設定過期時間（8小時）
  const token = Utilities.getUuid();
  const props = PropertiesService.getScriptProperties();
  const expiry = new Date().getTime() + 8 * 60 * 60 * 1000; // 8小時
  props.setProperty('TOKEN_' + token, String(expiry));
  return token;
}

function validateToken_(token) {
  if (!token) return false;
  const props = PropertiesService.getScriptProperties();
  const expiryStr = props.getProperty('TOKEN_' + token);
  if (!expiryStr) return false;
  const expiry = parseInt(expiryStr, 10);
  if (new Date().getTime() > expiry) {
    props.deleteProperty('TOKEN_' + token);
    return false;
  }
  return true;
}

// ===================================================================
// 報價單號產生：YYYYMMDD-NN
// ===================================================================
function generateQuoteNo_(dateStr) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_MAIN);
  const datePart = dateStr.replace(/-/g, ''); // 2026-06-17 -> 20260617

  const lastRow = sheet.getLastRow();
  let maxSerial = 0;
  if (lastRow > 1) {
    const quoteNos = sheet.getRange(2, MAIN_COLS.quoteNo, lastRow - 1, 1).getValues();
    quoteNos.forEach(row => {
      const qn = row[0];
      if (qn && String(qn).startsWith(datePart + '-')) {
        const serial = parseInt(String(qn).split('-')[1], 10);
        if (serial > maxSerial) maxSerial = serial;
      }
    });
  }
  const nextSerial = String(maxSerial + 1).padStart(2, '0');
  return datePart + '-' + nextSerial;
}

// ===================================================================
// 主要 entry points
// ===================================================================
function doGet(e) {
  return handleRequest_(e);
}

function doPost(e) {
  return handleRequest_(e);
}

function handleRequest_(e) {
  let params;
  try {
    if (e.postData && e.postData.contents) {
      params = JSON.parse(e.postData.contents);
    } else {
      params = e.parameter;
    }
  } catch (err) {
    return jsonResponse_({ ok: false, error: 'Invalid request body: ' + err.message });
  }

  const action = params.action;

  try {
    switch (action) {
      case 'login':
        return jsonResponse_(handleLogin_(params));
      case 'createQuote':
        requireAuth_(params);
        return jsonResponse_(handleCreateQuote_(params));
      case 'getQuotes':
        requireAuth_(params);
        return jsonResponse_(handleGetQuotes_(params));
      case 'getQuoteById':
        requireAuth_(params);
        return jsonResponse_(handleGetQuoteById_(params));
      case 'updateQuote':
        requireAuth_(params);
        return jsonResponse_(handleUpdateQuote_(params));
      case 'deleteQuote':
        requireAuth_(params);
        return jsonResponse_(handleDeleteQuote_(params));
      case 'generateQuoteDocument':
        requireAuth_(params);
        return jsonResponse_(handleGenerateQuoteDocument_(params));
      default:
        return jsonResponse_({ ok: false, error: 'Unknown action: ' + action });
    }
  } catch (err) {
    return jsonResponse_({ ok: false, error: err.message });
  }
}

function requireAuth_(params) {
  if (!validateToken_(params.token)) {
    throw new Error('UNAUTHORIZED: token 無效或已過期，請重新登入');
  }
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===================================================================
// Action handlers
// ===================================================================
function handleLogin_(params) {
  if (!checkPin_(params.pin)) {
    return { ok: false, error: 'PIN 錯誤' };
  }
  const token = generateToken_();
  return { ok: true, token: token };
}

function handleCreateQuote_(params) {
  const quote = params.quote;
  if (!quote) throw new Error('缺少 quote 資料');

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const mainSheet = ss.getSheetByName(SHEET_MAIN);
  const itemSheet = ss.getSheetByName(SHEET_ITEMS);

  const quoteNo = quote.quoteNo || generateQuoteNo_(quote.quoteDate);
  const now = new Date().toISOString();

  const row = new Array(31).fill('');
  row[MAIN_COLS.quoteNo - 1] = quoteNo;
  row[MAIN_COLS.quoteType - 1] = quote.quoteType || '';
  row[MAIN_COLS.clientName - 1] = quote.clientName || '';
  row[MAIN_COLS.contactName - 1] = quote.contactName || '';
  row[MAIN_COLS.clientTaxId - 1] = quote.clientTaxId || '';
  row[MAIN_COLS.contactPhone - 1] = quote.contactPhone || '';
  row[MAIN_COLS.clientAddress - 1] = quote.clientAddress || '';
  row[MAIN_COLS.quoteDate - 1] = quote.quoteDate || '';
  row[MAIN_COLS.expiryDate - 1] = quote.expiryDate || '';
  row[MAIN_COLS.handler - 1] = quote.handler || '';
  row[MAIN_COLS.itemsSubtotal - 1] = quote.itemsSubtotal || 0;
  row[MAIN_COLS.taxAmount - 1] = quote.taxAmount || 0;
  row[MAIN_COLS.extrasTotal - 1] = quote.extrasTotal || 0;
  row[MAIN_COLS.grandTotal - 1] = quote.grandTotal || 0;
  row[MAIN_COLS.priceMode - 1] = quote.priceMode || 'inc';
  row[MAIN_COLS.taxRate - 1] = quote.taxRate || 5;
  row[MAIN_COLS.paymentType - 1] = quote.paymentType || '';
  row[MAIN_COLS.paymentDetail - 1] = quote.paymentDetail || '';
  row[MAIN_COLS.remark - 1] = quote.remark || '';
  row[MAIN_COLS.imageLinks - 1] = quote.imageLinks || '';
  row[MAIN_COLS.status - 1] = quote.status || '草稿';
  row[MAIN_COLS.createdAt - 1] = now;
  row[MAIN_COLS.updatedAt - 1] = now;
  row[MAIN_COLS.pdfUrl - 1] = quote.pdfUrl || '';
  row[MAIN_COLS.docUrl - 1] = quote.docUrl || '';
  row[MAIN_COLS.venue - 1] = quote.venue || '';
  row[MAIN_COLS.entryTime - 1] = quote.entryTime || '';
  row[MAIN_COLS.serviceTime - 1] = quote.serviceTime || '';
  row[MAIN_COLS.exitTime - 1] = quote.exitTime || '';
  row[MAIN_COLS.svcMode - 1] = quote.svcMode || '';
  row[MAIN_COLS.svcAmount - 1] = quote.svcAmount || 0;

  mainSheet.appendRow(row);

  // 寫入品項
  if (quote.items && quote.items.length > 0) {
    const itemRows = quote.items.map(item => [
      quoteNo,
      item.itemType || '',
      item.name || '',
      item.lot || '',
      item.volume || '',
      item.unitPrice || 0,
      item.deduction || 0,
      item.logoFee || 0,
      item.qty || 0,
      item.unit || '',
      item.subtotal || 0,
      item.flavorList || ''
    ]);
    itemSheet.getRange(itemSheet.getLastRow() + 1, 1, itemRows.length, ITEM_HEADERS.length)
      .setValues(itemRows);
  }

  return { ok: true, quoteNo: quoteNo };
}

function handleGetQuotes_(params) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const mainSheet = ss.getSheetByName(SHEET_MAIN);
  const lastRow = mainSheet.getLastRow();
  if (lastRow < 2) return { ok: true, quotes: [] };

  const data = mainSheet.getRange(2, 1, lastRow - 1, MAIN_HEADERS.length).getValues();
  let quotes = data.map(row => rowToQuoteObject_(row));

  // 篩選
  const filters = params.filters || {};
  if (filters.clientName) {
    quotes = quotes.filter(q => q.clientName && q.clientName.includes(filters.clientName));
  }
  if (filters.status) {
    quotes = quotes.filter(q => q.status === filters.status);
  }
  if (filters.quoteType) {
    quotes = quotes.filter(q => q.quoteType === filters.quoteType);
  }

  // 排序：最新建立時間在前
  quotes.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  return { ok: true, quotes: quotes };
}

function handleGetQuoteById_(params) {
  const quoteNo = params.quoteNo;
  if (!quoteNo) throw new Error('缺少 quoteNo');

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const mainSheet = ss.getSheetByName(SHEET_MAIN);
  const lastRow = mainSheet.getLastRow();
  if (lastRow < 2) return { ok: false, error: '找不到報價單' };

  const data = mainSheet.getRange(2, 1, lastRow - 1, MAIN_HEADERS.length).getValues();
  const rowIndex = data.findIndex(row => row[MAIN_COLS.quoteNo - 1] === quoteNo);
  if (rowIndex === -1) return { ok: false, error: '找不到報價單：' + quoteNo };

  const quote = rowToQuoteObject_(data[rowIndex]);

  // 取得品項
  const itemSheet = ss.getSheetByName(SHEET_ITEMS);
  const itemLastRow = itemSheet.getLastRow();
  quote.items = [];
  if (itemLastRow >= 2) {
    const itemData = itemSheet.getRange(2, 1, itemLastRow - 1, ITEM_HEADERS.length).getValues();
    quote.items = itemData
      .filter(row => row[ITEM_COLS.quoteNo - 1] === quoteNo)
      .map(row => ({
        itemType: row[ITEM_COLS.itemType - 1],
        name: row[ITEM_COLS.name - 1],
        lot: row[ITEM_COLS.lot - 1],
        volume: row[ITEM_COLS.volume - 1],
        unitPrice: row[ITEM_COLS.unitPrice - 1],
        deduction: row[ITEM_COLS.deduction - 1],
        logoFee: row[ITEM_COLS.logoFee - 1],
        qty: row[ITEM_COLS.qty - 1],
        unit: row[ITEM_COLS.unit - 1],
        subtotal: row[ITEM_COLS.subtotal - 1],
        flavorList: row[ITEM_COLS.flavorList - 1]
      }));
  }

  return { ok: true, quote: quote };
}

function handleUpdateQuote_(params) {
  const quoteNo = params.quoteNo;
  const quote = params.quote;
  if (!quoteNo || !quote) throw new Error('缺少 quoteNo 或 quote 資料');

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const mainSheet = ss.getSheetByName(SHEET_MAIN);
  const lastRow = mainSheet.getLastRow();
  const data = mainSheet.getRange(2, 1, lastRow - 1, MAIN_HEADERS.length).getValues();
  const rowIndex = data.findIndex(row => row[MAIN_COLS.quoteNo - 1] === quoteNo);
  if (rowIndex === -1) return { ok: false, error: '找不到報價單：' + quoteNo };

  const sheetRow = rowIndex + 2; // +2 因為 row 1 是標題，陣列從 0 開始
  const now = new Date().toISOString();

  // 更新所有欄位（除了 quoteNo, createdAt）
  const updates = {
    [MAIN_COLS.quoteType]: quote.quoteType,
    [MAIN_COLS.clientName]: quote.clientName,
    [MAIN_COLS.contactName]: quote.contactName,
    [MAIN_COLS.clientTaxId]: quote.clientTaxId,
    [MAIN_COLS.contactPhone]: quote.contactPhone,
    [MAIN_COLS.clientAddress]: quote.clientAddress,
    [MAIN_COLS.quoteDate]: quote.quoteDate,
    [MAIN_COLS.expiryDate]: quote.expiryDate,
    [MAIN_COLS.handler]: quote.handler,
    [MAIN_COLS.itemsSubtotal]: quote.itemsSubtotal,
    [MAIN_COLS.taxAmount]: quote.taxAmount,
    [MAIN_COLS.extrasTotal]: quote.extrasTotal,
    [MAIN_COLS.grandTotal]: quote.grandTotal,
    [MAIN_COLS.priceMode]: quote.priceMode,
    [MAIN_COLS.taxRate]: quote.taxRate,
    [MAIN_COLS.paymentType]: quote.paymentType,
    [MAIN_COLS.paymentDetail]: quote.paymentDetail,
    [MAIN_COLS.remark]: quote.remark,
    [MAIN_COLS.imageLinks]: quote.imageLinks,
    [MAIN_COLS.status]: quote.status,
    [MAIN_COLS.updatedAt]: now,
    [MAIN_COLS.pdfUrl]: quote.pdfUrl,
    [MAIN_COLS.docUrl]: quote.docUrl,
    [MAIN_COLS.venue]: quote.venue,
    [MAIN_COLS.entryTime]: quote.entryTime,
    [MAIN_COLS.serviceTime]: quote.serviceTime,
    [MAIN_COLS.exitTime]: quote.exitTime,
    [MAIN_COLS.svcMode]: quote.svcMode,
    [MAIN_COLS.svcAmount]: quote.svcAmount
  };

  Object.keys(updates).forEach(col => {
    if (updates[col] !== undefined) {
      mainSheet.getRange(sheetRow, parseInt(col, 10)).setValue(updates[col]);
    }
  });

  // 更新品項：先刪除舊的，再寫入新的
  if (quote.items) {
    const itemSheet = ss.getSheetByName(SHEET_ITEMS);
    const itemLastRow = itemSheet.getLastRow();
    if (itemLastRow >= 2) {
      const itemData = itemSheet.getRange(2, 1, itemLastRow - 1, ITEM_HEADERS.length).getValues();
      // 從下往上刪除符合的列，避免索引位移問題
      for (let i = itemData.length - 1; i >= 0; i--) {
        if (itemData[i][ITEM_COLS.quoteNo - 1] === quoteNo) {
          itemSheet.deleteRow(i + 2);
        }
      }
    }
    if (quote.items.length > 0) {
      const itemRows = quote.items.map(item => [
        quoteNo,
        item.itemType || '',
        item.name || '',
        item.lot || '',
        item.volume || '',
        item.unitPrice || 0,
        item.deduction || 0,
        item.logoFee || 0,
        item.qty || 0,
        item.unit || '',
        item.subtotal || 0,
        item.flavorList || ''
      ]);
      itemSheet.getRange(itemSheet.getLastRow() + 1, 1, itemRows.length, ITEM_HEADERS.length)
        .setValues(itemRows);
    }
  }

  return { ok: true, quoteNo: quoteNo };
}

function handleDeleteQuote_(params) {
  const quoteNo = params.quoteNo;
  if (!quoteNo) throw new Error('缺少 quoteNo');

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const mainSheet = ss.getSheetByName(SHEET_MAIN);
  const lastRow = mainSheet.getLastRow();
  const data = mainSheet.getRange(2, 1, lastRow - 1, MAIN_HEADERS.length).getValues();
  const rowIndex = data.findIndex(row => row[MAIN_COLS.quoteNo - 1] === quoteNo);
  if (rowIndex === -1) return { ok: false, error: '找不到報價單：' + quoteNo };

  // 軟刪除：標記狀態為「已刪除」，保留歷史資料
  const sheetRow = rowIndex + 2;
  mainSheet.getRange(sheetRow, MAIN_COLS.status).setValue('已刪除');
  mainSheet.getRange(sheetRow, MAIN_COLS.updatedAt).setValue(new Date().toISOString());

  return { ok: true };
}

function rowToQuoteObject_(row) {
  return {
    quoteNo: row[MAIN_COLS.quoteNo - 1],
    quoteType: row[MAIN_COLS.quoteType - 1],
    clientName: row[MAIN_COLS.clientName - 1],
    contactName: row[MAIN_COLS.contactName - 1],
    clientTaxId: row[MAIN_COLS.clientTaxId - 1],
    contactPhone: row[MAIN_COLS.contactPhone - 1],
    clientAddress: row[MAIN_COLS.clientAddress - 1],
    quoteDate: formatDateValue_(row[MAIN_COLS.quoteDate - 1]),
    expiryDate: formatDateValue_(row[MAIN_COLS.expiryDate - 1]),
    handler: row[MAIN_COLS.handler - 1],
    itemsSubtotal: row[MAIN_COLS.itemsSubtotal - 1],
    taxAmount: row[MAIN_COLS.taxAmount - 1],
    extrasTotal: row[MAIN_COLS.extrasTotal - 1],
    grandTotal: row[MAIN_COLS.grandTotal - 1],
    priceMode: row[MAIN_COLS.priceMode - 1],
    taxRate: row[MAIN_COLS.taxRate - 1],
    paymentType: row[MAIN_COLS.paymentType - 1],
    paymentDetail: row[MAIN_COLS.paymentDetail - 1],
    remark: row[MAIN_COLS.remark - 1],
    imageLinks: row[MAIN_COLS.imageLinks - 1],
    status: row[MAIN_COLS.status - 1],
    createdAt: row[MAIN_COLS.createdAt - 1],
    updatedAt: row[MAIN_COLS.updatedAt - 1],
    pdfUrl: row[MAIN_COLS.pdfUrl - 1],
    docUrl: row[MAIN_COLS.docUrl - 1],
    venue: row[MAIN_COLS.venue - 1],
    entryTime: row[MAIN_COLS.entryTime - 1],
    serviceTime: row[MAIN_COLS.serviceTime - 1],
    exitTime: row[MAIN_COLS.exitTime - 1],
    svcMode: row[MAIN_COLS.svcMode - 1],
    svcAmount: row[MAIN_COLS.svcAmount - 1]
  };
}

function formatDateValue_(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'Asia/Taipei', 'yyyy-MM-dd');
  }
  return val;
}

// ===================================================================
// 正式文件產生（PDF / Word）— generateQuoteDocument
// 設計原則：不靠額外「範本 Google Doc」檔案，整份文件由程式碼直接建構，
// 單一真實來源（這份 .gs），避免日後範本檔被手動改壞、或範本與程式碼對不上。
// ===================================================================

const DOC_OUTPUT_FOLDER_NAME = '報價單檔案';
const LOGO_URL = 'https://raw.githubusercontent.com/MollyLin-coding/quote-system/main/assets/logo.png';

const SVC_LABEL_MAP_ = {
  basic: '調酒師服務費及運費（基礎運費）',
  equip: '調酒師費（含設備）',
  travel: '調酒師費＋車馬費及酒水運費',
  travelonly: '車馬費'
};

function handleGenerateQuoteDocument_(params) {
  const quoteNo = params.quoteNo;
  if (!quoteNo) throw new Error('缺少 quoteNo');

  const quote = getQuoteWithItems_(quoteNo);
  if (!quote) return { ok: false, error: '找不到報價單：' + quoteNo };

  const built = buildQuoteDoc_(quote);

  // 把連結寫回主表 pdfUrl / docUrl，供之後查詢/分享
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const mainSheet = ss.getSheetByName(SHEET_MAIN);
  const lastRow = mainSheet.getLastRow();
  const data = mainSheet.getRange(2, 1, lastRow - 1, MAIN_HEADERS.length).getValues();
  const rowIndex = data.findIndex(row => row[MAIN_COLS.quoteNo - 1] === quoteNo);
  if (rowIndex !== -1) {
    const sheetRow = rowIndex + 2;
    mainSheet.getRange(sheetRow, MAIN_COLS.pdfUrl).setValue(built.pdfUrl);
    mainSheet.getRange(sheetRow, MAIN_COLS.docUrl).setValue(built.docUrl);
    mainSheet.getRange(sheetRow, MAIN_COLS.updatedAt).setValue(new Date().toISOString());
  }

  return {
    ok: true,
    quoteNo: quoteNo,
    pdfUrl: built.pdfUrl,
    docUrl: built.docUrl,
    fileNameBase: built.fileNameBase,
    pdfBase64: built.pdfBase64,
    docxBase64: built.docxBase64
  };
}

// 與 handleGetQuoteById_ 邏輯類似但獨立一份，刻意不共用／不改動已驗證過的
// handleGetQuoteById_，降低改動既有已驗證功能的風險。
function getQuoteWithItems_(quoteNo) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const mainSheet = ss.getSheetByName(SHEET_MAIN);
  const lastRow = mainSheet.getLastRow();
  if (lastRow < 2) return null;

  const data = mainSheet.getRange(2, 1, lastRow - 1, MAIN_HEADERS.length).getValues();
  const rowIndex = data.findIndex(row => row[MAIN_COLS.quoteNo - 1] === quoteNo);
  if (rowIndex === -1) return null;

  const quote = rowToQuoteObject_(data[rowIndex]);

  const itemSheet = ss.getSheetByName(SHEET_ITEMS);
  const itemLastRow = itemSheet.getLastRow();
  quote.items = [];
  if (itemLastRow >= 2) {
    const itemData = itemSheet.getRange(2, 1, itemLastRow - 1, ITEM_HEADERS.length).getValues();
    quote.items = itemData
      .filter(row => row[ITEM_COLS.quoteNo - 1] === quoteNo)
      .map(row => ({
        itemType: row[ITEM_COLS.itemType - 1],
        name: row[ITEM_COLS.name - 1],
        lot: row[ITEM_COLS.lot - 1],
        volume: row[ITEM_COLS.volume - 1],
        unitPrice: row[ITEM_COLS.unitPrice - 1],
        deduction: row[ITEM_COLS.deduction - 1],
        logoFee: row[ITEM_COLS.logoFee - 1],
        qty: row[ITEM_COLS.qty - 1],
        unit: row[ITEM_COLS.unit - 1],
        subtotal: row[ITEM_COLS.subtotal - 1],
        flavorList: row[ITEM_COLS.flavorList - 1]
      }));
  }
  return quote;
}

function buildQuoteDoc_(quote) {
  const baseName = sanitizeFileName_(
    (quote.clientName || '客戶') + '_' + quote.quoteNo + '_報價單_凱文南坡萬實業社'
  );

  const doc = DocumentApp.create(baseName);
  const body = doc.getBody();
  body.setMarginTop(28).setMarginBottom(28).setMarginLeft(40).setMarginRight(40);
  body.clear();

  appendHeader_(body, quote);
  appendClientInfo_(body, quote);
  if (quote.quoteType === 'bottle') {
    appendBottleTable_(body, quote);
  } else {
    appendBanquetTable_(body, quote);
  }
  appendTotals_(body, quote);
  appendPaymentSection_(body, quote);
  appendNotesSection_(body, quote);

  doc.saveAndClose();

  const file = DriveApp.getFileById(doc.getId());
  const folder = getOrCreateOutputFolder_();
  folder.addFile(file);
  try { DriveApp.getRootFolder().removeFile(file); } catch (e) { /* 忽略：不影響主要流程 */ }

  const pdfBlob = file.getAs('application/pdf').setName(baseName + '.pdf');
  const pdfFile = folder.createFile(pdfBlob);
  pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  // Google Doc 無法用 getAs() 轉成 .docx，需透過 Drive export endpoint 取得。
  const docxExportUrl = 'https://docs.google.com/document/d/' + file.getId() +
    '/export?format=docx';
  const docxResponse = UrlFetchApp.fetch(docxExportUrl, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  const docxBlob = docxResponse.getBlob().setName(baseName + '.docx');
  const docxFile = folder.createFile(docxBlob);
  docxFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  // 原始 Google Doc 僅為中繼產物，PDF/docx 都產出後即可刪除，避免 Drive 累積垃圾。
  try { file.setTrashed(true); } catch (e) { /* 忽略：不影響主要流程 */ }

  return {
    pdfUrl: 'https://drive.google.com/uc?export=download&id=' + pdfFile.getId(),
    docUrl: 'https://drive.google.com/uc?export=download&id=' + docxFile.getId(),
    fileNameBase: baseName,
    pdfBase64: Utilities.base64Encode(pdfBlob.getBytes()),
    docxBase64: Utilities.base64Encode(docxBlob.getBytes())
  };
}

function getOrCreateOutputFolder_() {
  const folders = DriveApp.getFoldersByName(DOC_OUTPUT_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(DOC_OUTPUT_FOLDER_NAME);
}

function sanitizeFileName_(s) {
  return String(s).replace(/[\\/:*?"<>|]/g, '-');
}

function fmtMoney_(n) {
  n = Math.round(Number(n) || 0);
  const neg = n < 0;
  n = Math.abs(n);
  const s = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-$' : '$') + s;
}

function appendHeader_(body, quote) {
  const table = body.appendTable([['', '']]);
  table.setBorderWidth(0);
  const leftCell = table.getCell(0, 0);
  const rightCell = table.getCell(0, 1);
  leftCell.setWidth(330);
  rightCell.setWidth(190);

  leftCell.clear();
  let logoInserted = false;
  try {
    const imgBlob = UrlFetchApp.fetch(LOGO_URL).getBlob();
    const img = leftCell.appendImage(imgBlob);
    const ratio = img.getWidth() / img.getHeight();
    img.setHeight(26);
    img.setWidth(Math.round(26 * ratio));
    logoInserted = true;
  } catch (e) { /* 抓圖失敗就退回純文字標題 */ }
  if (!logoInserted) {
    leftCell.appendParagraph('凱文南坡萬實業社').editAsText().setBold(true).setFontSize(13);
  }
  leftCell.appendParagraph('KEVIN NUMBER 1 TAILORED.COCKTAIL')
    .editAsText().setFontSize(8).setForegroundColor('#A6824A');
  leftCell.appendParagraph('EST. 2023. TAIWAN')
    .editAsText().setFontSize(8).setForegroundColor('#A6824A');
  leftCell.appendParagraph('新北市新莊區化成路554巷37號　(02)8991-0068　統編 92719710')
    .editAsText().setFontSize(8).setForegroundColor('#A8A69C');

  rightCell.clear();
  const title = rightCell.appendParagraph('報　價　單');
  title.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
  title.editAsText().setBold(true).setFontSize(18);

  [
    '單號：' + (quote.quoteNo || '-'),
    '報價日：' + (quote.quoteDate || '-'),
    '有效至：' + (quote.expiryDate || '-')
  ].forEach(line => {
    const p = rightCell.appendParagraph(line);
    p.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
    p.editAsText().setFontSize(9).setForegroundColor('#6B6B63');
  });

  body.appendHorizontalRule();
}

function appendClientInfo_(body, quote) {
  if (quote.quoteType === 'banquet' && quote.venue) {
    const line = '佈置地點：' + quote.venue + (quote.serviceTime ? '　供酒時間：' + quote.serviceTime : '');
    body.appendParagraph(line).editAsText().setFontSize(9).setForegroundColor('#6B6B63');
  }

  const fields = [
    ['客戶名稱', quote.clientName],
    ['聯絡人', quote.contactName],
    ['統一編號', quote.clientTaxId],
    ['聯絡電話', quote.contactPhone],
    ['地址', quote.clientAddress]
  ];
  fields.forEach(pair => {
    const label = pair[0], value = pair[1];
    if (value) {
      body.appendParagraph(label + '：' + value).editAsText().setFontSize(10);
    }
  });
  body.appendParagraph('');
}

function appendBottleTable_(body, quote) {
  const items = quote.items || [];
  const bottleItems = items.filter(i => i.itemType === 'bottle');
  const extraItems = items.filter(i => i.itemType === 'extra');

  const hasLot = bottleItems.some(i => i.lot);
  const hasDed = bottleItems.some(i => Number(i.deduction));
  const hasLogo = bottleItems.some(i => Number(i.logoFee));

  const header = ['品名'];
  if (hasLot) header.push('批次');
  header.push('容量', '單價');
  if (hasDed) header.push('前標費扣除');
  if (hasLogo) header.push('LOGO印刷費');
  header.push('瓶數', '小計');

  const rows = [header];

  bottleItems.forEach(it => {
    const r = [it.name || '-'];
    if (hasLot) r.push(it.lot || '-');
    r.push(it.volume ? (it.volume + 'ml') : '-', it.unitPrice ? fmtMoney_(it.unitPrice) : '-');
    if (hasDed) r.push(Number(it.deduction) ? fmtMoney_(it.deduction) : '-');
    if (hasLogo) r.push(Number(it.logoFee) ? fmtMoney_(it.logoFee) : '-');
    r.push(String(it.qty || 0), fmtMoney_(it.subtotal));
    rows.push(r);
  });

  extraItems.forEach(it => {
    const r = new Array(header.length).fill('');
    r[0] = it.name || '-';
    r[header.length - 1] = fmtMoney_(it.subtotal);
    rows.push(r);
  });

  styleItemsTable_(body.appendTable(rows));
}

function appendBanquetTable_(body, quote) {
  const items = quote.items || [];
  const header = ['項目', '數量', '單位', '單價', '小計'];
  const rows = [header];

  items.filter(i => i.itemType === 'banquet_group').forEach(it => {
    const name = it.flavorList ? (it.name + '（' + it.flavorList + '）') : it.name;
    rows.push([
      name || '-', String(it.qty || 0), it.unit || '杯',
      it.unitPrice ? fmtMoney_(it.unitPrice) : '-', fmtMoney_(it.subtotal)
    ]);
  });

  items.filter(i => i.itemType === 'banquet_free').forEach(it => {
    rows.push([
      it.name || '-', String(it.qty || 0), it.unit || '-',
      it.unitPrice ? fmtMoney_(it.unitPrice) : '-', fmtMoney_(it.subtotal)
    ]);
  });

  if (quote.svcMode) {
    const label = SVC_LABEL_MAP_[quote.svcMode] || '調酒師服務費';
    rows.push([label, '1', '-', fmtMoney_(quote.svcAmount), fmtMoney_(quote.svcAmount)]);
  }

  items.filter(i => i.itemType === 'banquet_addon').forEach(it => {
    rows.push([
      it.name || '-', String(it.qty || 0), it.unit || '-',
      it.unitPrice ? fmtMoney_(it.unitPrice) : '-', fmtMoney_(it.subtotal)
    ]);
  });

  styleItemsTable_(body.appendTable(rows));
}

function styleItemsTable_(table) {
  table.setBorderColor('#E5E2D8').setBorderWidth(1);
  const headerRow = table.getRow(0);
  for (let c = 0; c < headerRow.getNumCells(); c++) {
    const cell = headerRow.getCell(c);
    cell.setBackgroundColor('#22241F');
    cell.editAsText().setForegroundColor('#FFFFFF').setBold(true).setFontSize(9);
  }
  for (let r = 1; r < table.getNumRows(); r++) {
    const row = table.getRow(r);
    for (let c = 0; c < row.getNumCells(); c++) {
      row.getCell(c).editAsText().setFontSize(10);
    }
  }
}

function appendTotals_(body, quote) {
  body.appendParagraph('');
  const subLabel = quote.priceMode === 'inc' ? '品項合計（未稅，自動回算）' : '品項合計（未稅）';
  addTotalLine_(body, subLabel, quote.itemsSubtotal, false);

  if (Number(quote.taxRate) > 0) {
    const taxLabel = quote.priceMode === 'inc' ? '其中稅額' : ('加計稅額（' + quote.taxRate + '%）');
    addTotalLine_(body, taxLabel, quote.taxAmount, false);
  }

  if (quote.quoteType === 'bottle' && Number(quote.extrasTotal)) {
    addTotalLine_(body, '額外費用', quote.extrasTotal, false);
  }

  addTotalLine_(body, '總計', quote.grandTotal, true);
}

function addTotalLine_(body, label, amount, isGrand) {
  const p = body.appendParagraph(label + '：' + fmtMoney_(amount));
  p.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
  if (isGrand) {
    p.editAsText().setBold(true).setFontSize(13).setForegroundColor('#A6824A');
  } else {
    p.editAsText().setFontSize(10).setForegroundColor('#6B6B63');
  }
}

function appendPaymentSection_(body, quote) {
  const detail = quote.paymentDetail;
  if (!detail) return;
  body.appendParagraph('');
  body.appendParagraph('付款條件').editAsText().setBold(true).setForegroundColor('#7C5E32').setFontSize(11);
  String(detail).split('<br>').forEach(line => {
    line = line.trim();
    if (!line) return;
    body.appendParagraph(line).editAsText().setFontSize(10);
  });
}

function appendNotesSection_(body, quote) {
  body.appendParagraph('');
  if (quote.remark) {
    body.appendParagraph(quote.remark).editAsText().setFontSize(9).setForegroundColor('#6B6B63');
  }
  [
    '以下客戶簡稱甲方，凱文南坡萬實業社簡稱乙方。雙方確認此報價單內容無誤並於雙方各執一份，以維雙方權利。',
    '匯款資訊：陽信銀行中興分行 (108)　02142-00230-91　凱文南坡萬實業社黃彥愷',
    '匯款完成後，敬請提供轉帳截圖或帳號後五碼，以便核對入帳，謝謝。'
  ].forEach(line => {
    body.appendParagraph(line).editAsText().setFontSize(9).setForegroundColor('#6B6B63');
  });
}

// ===================================================================
// 工具函式：手動在 Apps Script 編輯器執行，設定 PIN 碼
// 使用方式：把下面 'YOUR_PIN_HERE' 換成你自己的 PIN，執行此函式一次即可
// ===================================================================
function setPinCode() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('PIN_CODE', 'YOUR_PIN_HERE'); // <-- 在這裡填入你的 PIN，執行一次後可以把這行刪掉或改回佔位字
  return 'PIN code set.';
}
