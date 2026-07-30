/**
 * ===================================================================
 * v3.0 擴充：自有品牌公版酒（通路買斷 ＋ 合作寄售）
 * 依據專案文件「規格_v3_自有品牌公版酒寄售.md」實作（2026-07-21，對話 B）
 *
 * 本檔只「新增」，不動 程式碼.gs / v2_extensions.gs 既有函式。
 * 程式碼.gs 僅修改 handleRequest_ 的 switch：新增本檔對應的 11 個 action 分派。
 *
 * A. 通路買斷（報價單模式，沿用 createQuote 等既有機制，quoteType='ownbrand'）：
 *    - getOwnbrandProducts   回傳 ownbrand_products（active=Y）
 *    - getOwnbrandTiers      回傳 ownbrand_tiers ＋ consign_terms（key-value 物件）
 *    - syncOwnbrandProducts  從來源試算表「南坡萬公版_v2」同步商品主檔
 *
 * B. 合作寄售（寄售管理，全新 consign_* 分頁）：
 *    - getConsignCustomers / saveConsignCustomer
 *    - saveConsignDiscount / deleteConsignDiscount（客戶×SKU 例外折）
 *    - addConsignMovement（寫 consign_ledger：in/out/return/adjust）
 *    - getConsignInventory（在客戶端庫存＋保證金餘額）
 *    - getConsignLedger（明細帳，可篩選）
 *    - getConsignMonthly（自然月結算：Σ out.qty×unit_price）
 *
 * 初始化順序（手動在編輯器執行一次）：
 * 1. setupOwnbrandSheets()        建立 6 個新分頁（含表頭＋種子資料）
 * 2. syncOwnbrandProducts_()      從來源試算表拉商品（或呼叫 action 也可）
 * 3. setupOwnbrandSyncTrigger()   建立每日自動同步觸發器
 *
 * 保證金餘額目前只做「鋪貨收、退貨退」（依在客戶端庫存 × volume 對應保證金單價
 * 加總）。「售出瓶的保證金確切處理方式」待 Molly 確認，屆時再補售出沖抵/退還邏輯，
 * 不影響本版其餘功能。
 * ===================================================================
 */

// ===================================================================
// 分頁名稱／表頭常數
// ===================================================================
const SHEET_OWNBRAND_PRODUCTS = 'ownbrand_products';
const SHEET_OWNBRAND_TIERS = 'ownbrand_tiers';
const SHEET_CONSIGN_TERMS = 'consign_terms';
const SHEET_CONSIGN_CUSTOMERS = 'consign_customers';
const SHEET_CONSIGN_DISCOUNTS = 'consign_discounts';
const SHEET_CONSIGN_LEDGER = 'consign_ledger';

const OWNBRAND_PRODUCTS_HEADERS = ['sku_id', 'name', 'abv', 'volume', 'list_price', 'cost', 'bottle_type', 'active', 'synced_at'];
const OWNBRAND_TIERS_HEADERS = ['channel', 'min_qty', 'discount', 'free_ship', 'note'];
const CONSIGN_TERMS_HEADERS = ['key', 'value', 'note'];
const CONSIGN_CUSTOMERS_HEADERS = ['customer_id', 'company_id', 'name', 'default_discount', 'billing_day', 'contact', 'phone', 'ship_address', 'active', 'note'];
const CONSIGN_DISCOUNTS_HEADERS = ['customer_id', 'sku_id', 'discount', 'note'];
const CONSIGN_LEDGER_HEADERS = ['movement_id', 'date', 'customer_id', 'sku_id', 'type', 'qty', 'unit_price', 'note', 'created_at'];

// 商品主檔來源：Molly 另一份試算表「南坡萬公版_v2」，與本系統同一 Google 帳號，
// GAS 以擁有者身分執行可直接 openById 讀取，無須額外授權/串接。本系統只讀不寫。
const OWNBRAND_SOURCE_SHEET_ID = '1816K_4KJ-YTX3102TMw58po5QVrUFzy3tGhQPFjQLdE';
const OWNBRAND_SOURCE_TAB = 'NO1.V2_報價';

// ===================================================================
// 初始化：建立 6 個新分頁＋種子資料（手動執行一次；可重複執行，不清掉既有資料）
// 沿用 v2_extensions.gs 的 v2Sheet_/v2IsEmpty_/v2Append_ 共用小工具。
// ===================================================================
function setupOwnbrandSheets() {
  const out = [];

  v2Sheet_(SHEET_OWNBRAND_PRODUCTS, OWNBRAND_PRODUCTS_HEADERS);
  out.push('ownbrand_products 表頭 OK（由 syncOwnbrandProducts 覆寫內容，勿手改）');

  v2Sheet_(SHEET_OWNBRAND_TIERS, OWNBRAND_TIERS_HEADERS);
  if (v2IsEmpty_(SHEET_OWNBRAND_TIERS)) {
    v2Append_(SHEET_OWNBRAND_TIERS, OWNBRAND_TIERS_HEADERS, [
      ['buyout', 200, 0.6, 'Y', ''],
      ['buyout', 500, 0.55, 'Y', ''],
      ['buyout', 1000, 0.5, 'Y', ''],
      ['consign', 0, 0.75, 'N', '']
    ]);
    out.push('ownbrand_tiers 種子資料 4 列已寫入');
  } else {
    out.push('ownbrand_tiers 已有資料，略過種子');
  }

  v2Sheet_(SHEET_CONSIGN_TERMS, CONSIGN_TERMS_HEADERS);
  if (v2IsEmpty_(SHEET_CONSIGN_TERMS)) {
    v2Append_(SHEET_CONSIGN_TERMS, CONSIGN_TERMS_HEADERS, [
      ['deposit_100ml', 50, '100ml 每瓶保證金'],
      ['deposit_500ml', 250, '500ml 每瓶保證金'],
      ['exchange_months', 6, '換貨期限（月，外觀完好）'],
      ['foq_100ml', 25, '100ml 每款最低鋪貨量（提醒用，不擋單）'],
      ['foq_500ml', 12, '500ml 每款最低鋪貨量'],
      ['ship_note', '運費買方負擔', '']
    ]);
    out.push('consign_terms 種子資料 6 列已寫入');
  } else {
    out.push('consign_terms 已有資料，略過種子');
  }

  v2Sheet_(SHEET_CONSIGN_CUSTOMERS, CONSIGN_CUSTOMERS_HEADERS);
  out.push('consign_customers 表頭 OK');

  v2Sheet_(SHEET_CONSIGN_DISCOUNTS, CONSIGN_DISCOUNTS_HEADERS);
  out.push('consign_discounts 表頭 OK');

  v2Sheet_(SHEET_CONSIGN_LEDGER, CONSIGN_LEDGER_HEADERS);
  out.push('consign_ledger 表頭 OK');

  return out.join(' / ');
}

// consign_terms 是 key-value 表，讀成 {key: value} 物件方便查詢
function getConsignTermsMap_() {
  const rows = v2ReadAll_(SHEET_CONSIGN_TERMS, CONSIGN_TERMS_HEADERS);
  const map = {};
  rows.forEach(function (r) { map[r.key] = r.value; });
  return map;
}

// ===================================================================
// 商品主檔同步：openById 讀來源試算表「NO1.V2_報價」，向下補品名/濃度
// （來源用合併儲存格，每支酒兩列 100ml/500ml，只有第一列有品名/濃度），
// upsert 進 ownbrand_products；來源移除的 SKU 標記 active=N（不刪列）。
// ===================================================================
function syncOwnbrandProducts_() {
  const srcSs = SpreadsheetApp.openById(OWNBRAND_SOURCE_SHEET_ID);
  const srcSh = srcSs.getSheetByName(OWNBRAND_SOURCE_TAB);
  if (!srcSh) throw new Error('來源試算表找不到分頁：' + OWNBRAND_SOURCE_TAB);

  const all = srcSh.getDataRange().getValues();
  if (all.length < 2) return { added: 0, updated: 0, deactivated: 0 };
  const data = all.slice(1); // 去掉表頭列

  let lastName = '', lastAbv = '';
  const sourceSkus = {};

  data.forEach(function (row) {
    const name = String(row[0] || '').trim();
    const abv = String(row[1] || '').trim();
    const volume = String(row[2] || '').trim();
    if (name) lastName = name;
    if (abv) lastAbv = abv;
    if (!volume) return; // 完全空白/分隔列略過

    const dPrice = row[3];
    const fPrice = row[5];
    const listPrice = (dPrice === '' || dPrice === null || dPrice === undefined) ? fPrice : dPrice;
    const cost = row[4] !== undefined ? row[4] : '';
    const bottleType = row[8] !== undefined ? row[8] : '';

    if (!lastName) return; // 理論上不會發生，保險略過避免髒資料

    const skuId = lastName + '|' + volume;
    sourceSkus[skuId] = {
      name: lastName,
      abv: lastAbv,
      volume: volume,
      list_price: listPrice,
      cost: cost,
      bottle_type: bottleType
    };
  });

  const sh = v2Sheet_(SHEET_OWNBRAND_PRODUCTS, OWNBRAND_PRODUCTS_HEADERS);
  const now = tpeNow_();
  let added = 0, updated = 0, deactivated = 0;

  const existingLastRow = sh.getLastRow();
  const existing = {};
  if (existingLastRow >= 2) {
    const idCol = OWNBRAND_PRODUCTS_HEADERS.indexOf('sku_id') + 1;
    const ids = sh.getRange(2, idCol, existingLastRow - 1, 1).getValues();
    ids.forEach(function (r, i) { existing[String(r[0])] = i + 2; });
  }

  Object.keys(sourceSkus).forEach(function (skuId) {
    const s = sourceSkus[skuId];
    const rowVals = [skuId, s.name, s.abv, s.volume, s.list_price, s.cost, s.bottle_type, 'Y', now];
    if (existing[skuId]) {
      sh.getRange(existing[skuId], 1, 1, OWNBRAND_PRODUCTS_HEADERS.length).setValues([rowVals]);
      updated++;
      delete existing[skuId]; // 留在 existing 裡的就是來源已移除的
    } else {
      sh.appendRow(rowVals);
      added++;
    }
  });

  const activeCol = OWNBRAND_PRODUCTS_HEADERS.indexOf('active') + 1;
  const syncedCol = OWNBRAND_PRODUCTS_HEADERS.indexOf('synced_at') + 1;
  Object.keys(existing).forEach(function (skuId) {
    const rowNum = existing[skuId];
    const curActive = String(sh.getRange(rowNum, activeCol).getValue());
    if (curActive !== 'N') {
      sh.getRange(rowNum, activeCol).setValue('N');
      deactivated++;
    }
    sh.getRange(rowNum, syncedCol).setValue(now);
  });

  logChange_('syncOwnbrandProducts', '', { added: added, updated: updated, deactivated: deactivated });
  return { added: added, updated: updated, deactivated: deactivated };
}

function handleSyncOwnbrandProducts_(params) {
  const r = syncOwnbrandProducts_();
  return {
    ok: true,
    summary: { added: r.added, updated: r.updated, deactivated: r.deactivated }
  };
}

// 每日觸發器目標（非底線函式，確保時間觸發器可掛）
function runOwnbrandSync() {
  return syncOwnbrandProducts_();
}

// 建立/重建每日同步觸發器（手動執行一次）
function setupOwnbrandSyncTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function (t) {
    if (t.getHandlerFunction() === 'runOwnbrandSync') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('runOwnbrandSync').timeBased().everyDays(1).atHour(3).create();
  return 'daily trigger (runOwnbrandSync, ~03:00 Asia/Taipei) created';
}

// ===================================================================
// action: getOwnbrandProducts / getOwnbrandTiers
// ===================================================================
function handleGetOwnbrandProducts_(params) {
  const isActive = function (o) { return String(o.active).toUpperCase() !== 'N'; };
  return { ok: true, products: v2ReadAll_(SHEET_OWNBRAND_PRODUCTS, OWNBRAND_PRODUCTS_HEADERS).filter(isActive) };
}

function handleGetOwnbrandTiers_(params) {
  return {
    ok: true,
    tiers: v2ReadAll_(SHEET_OWNBRAND_TIERS, OWNBRAND_TIERS_HEADERS),
    terms: getConsignTermsMap_()
  };
}

// ===================================================================
// action: getConsignCustomers / saveConsignCustomer
// ===================================================================
function handleGetConsignCustomers_(params) {
  // v41：改回傳「全部」客戶（含 active=N）。原本把停用客戶濾掉，導致「先停用再退保證金/
  // 產最後一期月結」的流程走不下去（客戶從前端下拉完全消失）。前端負責標示「（已停用）」。
  const all = v2ReadAll_(SHEET_CONSIGN_CUSTOMERS, CONSIGN_CUSTOMERS_HEADERS);
  const isActive = function (o) { return String(o.active).toUpperCase() !== 'N'; };
  all.sort(function (a, b) { return (isActive(a) ? 0 : 1) - (isActive(b) ? 0 : 1); }); // 啟用中排前面
  return {
    ok: true,
    customers: all,
    discounts: v2ReadAll_(SHEET_CONSIGN_DISCOUNTS, CONSIGN_DISCOUNTS_HEADERS)
  };
}

function handleSaveConsignCustomer_(params) {
  const c = params.customer || params;
  let customerId = c.customer_id;
  if (!customerId) customerId = 'C-' + Utilities.getUuid().slice(0, 8);

  const sh = v2Sheet_(SHEET_CONSIGN_CUSTOMERS, CONSIGN_CUSTOMERS_HEADERS);
  let rowNum = v2FindRow_(SHEET_CONSIGN_CUSTOMERS, CONSIGN_CUSTOMERS_HEADERS, 'customer_id', customerId);

  if (rowNum === -1) {
    const newRow = CONSIGN_CUSTOMERS_HEADERS.map(function (h) {
      if (h === 'customer_id') return customerId;
      if (h === 'active') return c.active !== undefined ? v2AsCell_(c.active) : 'Y';
      if (h === 'default_discount') return c.default_discount !== undefined ? v2AsCell_(c.default_discount) : 0.75;
      return v2AsCell_(c[h]);
    });
    sh.appendRow(newRow);
    rowNum = sh.getLastRow();
  } else {
    CONSIGN_CUSTOMERS_HEADERS.forEach(function (h, i) {
      if (h === 'customer_id') return;
      if (c[h] !== undefined) {
        sh.getRange(rowNum, i + 1).setValue(v2AsCell_(c[h]));
      }
    });
  }

  const rowVals = sh.getRange(rowNum, 1, 1, CONSIGN_CUSTOMERS_HEADERS.length).getValues()[0];
  const saved = {};
  CONSIGN_CUSTOMERS_HEADERS.forEach(function (h, i) { saved[h] = rowVals[i]; });

  logChange_('saveConsignCustomer', customerId, saved);
  return { ok: true, customer: saved };
}

// ===================================================================
// action: saveConsignDiscount / deleteConsignDiscount（客戶×SKU 例外折）
// ===================================================================
function findConsignDiscountRow_(customerId, skuId) {
  const sh = v2Sheet_(SHEET_CONSIGN_DISCOUNTS, CONSIGN_DISCOUNTS_HEADERS);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return -1;
  const vals = sh.getRange(2, 1, lastRow - 1, 2).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i][0]) === String(customerId) && String(vals[i][1]) === String(skuId)) return i + 2;
  }
  return -1;
}

function handleSaveConsignDiscount_(params) {
  const d = params.discount || params;
  const customerId = d.customer_id, skuId = d.sku_id;
  if (!customerId || !skuId) throw new Error('缺少 customer_id 或 sku_id');
  if (d.discount === undefined || d.discount === null || d.discount === '') throw new Error('缺少 discount');

  const sh = v2Sheet_(SHEET_CONSIGN_DISCOUNTS, CONSIGN_DISCOUNTS_HEADERS);
  const rowNum = findConsignDiscountRow_(customerId, skuId);
  const rowVals = [customerId, skuId, Number(d.discount), d.note || ''];
  if (rowNum === -1) {
    sh.appendRow(rowVals);
  } else {
    sh.getRange(rowNum, 1, 1, CONSIGN_DISCOUNTS_HEADERS.length).setValues([rowVals]);
  }
  logChange_('saveConsignDiscount', customerId + '|' + skuId, { customer_id: customerId, sku_id: skuId, discount: Number(d.discount), note: d.note || '' });
  return { ok: true };
}

function handleDeleteConsignDiscount_(params) {
  const customerId = params.customer_id, skuId = params.sku_id;
  if (!customerId || !skuId) throw new Error('缺少 customer_id 或 sku_id');
  const sh = v2Sheet_(SHEET_CONSIGN_DISCOUNTS, CONSIGN_DISCOUNTS_HEADERS);
  const rowNum = findConsignDiscountRow_(customerId, skuId);
  if (rowNum === -1) return { ok: true };
  sh.deleteRow(rowNum);
  logChange_('deleteConsignDiscount', customerId + '|' + skuId, { customer_id: customerId, sku_id: skuId });
  return { ok: true };
}

// ===================================================================
// 套價規則：先查 consign_discounts 例外折，否則用 consign_customers.default_discount，
// 都沒有則退回標準 0.75。折後單價 = Math.round(list_price × 折數)（含稅）。
// ===================================================================
function resolveConsignDiscount_(customerId, skuId) {
  const rowNum = findConsignDiscountRow_(customerId, skuId);
  if (rowNum !== -1) {
    const sh = v2Sheet_(SHEET_CONSIGN_DISCOUNTS, CONSIGN_DISCOUNTS_HEADERS);
    const v = sh.getRange(rowNum, CONSIGN_DISCOUNTS_HEADERS.indexOf('discount') + 1).getValue();
    if (v !== '' && v !== null && v !== undefined) return Number(v);
  }
  const custRowNum = v2FindRow_(SHEET_CONSIGN_CUSTOMERS, CONSIGN_CUSTOMERS_HEADERS, 'customer_id', customerId);
  if (custRowNum !== -1) {
    const csh = v2Sheet_(SHEET_CONSIGN_CUSTOMERS, CONSIGN_CUSTOMERS_HEADERS);
    const v = csh.getRange(custRowNum, CONSIGN_CUSTOMERS_HEADERS.indexOf('default_discount') + 1).getValue();
    if (v !== '' && v !== null && v !== undefined) return Number(v);
  }
  return 0.75;
}

function getOwnbrandProductBySku_(skuId) {
  const rowNum = v2FindRow_(SHEET_OWNBRAND_PRODUCTS, OWNBRAND_PRODUCTS_HEADERS, 'sku_id', skuId);
  if (rowNum === -1) return null;
  const sh = v2Sheet_(SHEET_OWNBRAND_PRODUCTS, OWNBRAND_PRODUCTS_HEADERS);
  const rowVals = sh.getRange(rowNum, 1, 1, OWNBRAND_PRODUCTS_HEADERS.length).getValues()[0];
  const o = {};
  OWNBRAND_PRODUCTS_HEADERS.forEach(function (h, i) { o[h] = rowVals[i]; });
  return o;
}

function resolveConsignUnitPrice_(customerId, skuId) {
  const product = getOwnbrandProductBySku_(skuId);
  if (!product) throw new Error('找不到公版商品 SKU：' + skuId);
  const discount = resolveConsignDiscount_(customerId, skuId);
  const unitPrice = Math.round(Number(product.list_price || 0) * discount);
  return { unitPrice: unitPrice, discount: discount, listPrice: Number(product.list_price || 0), volume: product.volume, name: product.name };
}

// ===================================================================
// action: addConsignMovement —— 寫 consign_ledger（in/out/return/adjust）
// out 未帶 unit_price 時，依套價規則自動算並鎖入（其餘型別 unit_price 選填）。
// ===================================================================
function generateConsignMovementId_(dateStr) {
  const datePart = String(dateStr).replace(/-/g, '');
  const sh = v2Sheet_(SHEET_CONSIGN_LEDGER, CONSIGN_LEDGER_HEADERS);
  const lastRow = sh.getLastRow();
  let maxSerial = 0;
  if (lastRow >= 2) {
    const ids = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    const prefix = 'CM-' + datePart + '-';
    ids.forEach(function (r) {
      const id = String(r[0] || '');
      if (id.indexOf(prefix) === 0) {
        const serial = parseInt(id.substring(prefix.length), 10);
        if (serial > maxSerial) maxSerial = serial;
      }
    });
  }
  return 'CM-' + datePart + '-' + String(maxSerial + 1).padStart(4, '0');
}

function handleAddConsignMovement_(params) {
  const m = params.movement || params;
  const customerId = m.customer_id, skuId = m.sku_id, type = m.type;
  if (!customerId || !skuId || !type) throw new Error('缺少 customer_id / sku_id / type');
  if (['in', 'out', 'return', 'adjust', 'deposit_refund'].indexOf(type) === -1) throw new Error('type 必須是 in/out/return/adjust/deposit_refund 其中之一');

  const qty = Number(m.qty);
  if (isNaN(qty)) throw new Error('qty 格式錯誤');
  if (type !== 'adjust' && qty <= 0) throw new Error('qty 必須為正整數（僅 adjust 可正負）');

  let unitPrice = m.unit_price;
  if (type === 'out') {
    if (unitPrice === undefined || unitPrice === null || unitPrice === '') {
      unitPrice = resolveConsignUnitPrice_(customerId, skuId).unitPrice;
    }
  } else {
    unitPrice = unitPrice !== undefined && unitPrice !== null ? unitPrice : '';
  }

  const now = new Date();
  const dateStr = m.date || Utilities.formatDate(now, 'Asia/Taipei', 'yyyy-MM-dd');
  const movementId = generateConsignMovementId_(dateStr);

  const sh = v2Sheet_(SHEET_CONSIGN_LEDGER, CONSIGN_LEDGER_HEADERS);
  const rowVals = [movementId, dateStr, customerId, skuId, type, qty, unitPrice, m.note || '', Utilities.formatDate(now, 'Asia/Taipei', "yyyy-MM-dd'T'HH:mm:ss'+08:00'")];
  sh.appendRow(rowVals);

  const saved = {};
  CONSIGN_LEDGER_HEADERS.forEach(function (h, i) { saved[h] = rowVals[i]; });

  logChange_('addConsignMovement', movementId, saved);
  return { ok: true, movement: saved };
}

// ===================================================================
// action: getConsignInventory —— 在客戶端庫存（in-out-return+adjust）＋保證金餘額
// ===================================================================
function handleGetConsignInventory_(params) {
  const filterCustomerId = params.customer_id;
  const rows = v2ReadAll_(SHEET_CONSIGN_LEDGER, CONSIGN_LEDGER_HEADERS);
  const productsById = {};
  v2ReadAll_(SHEET_OWNBRAND_PRODUCTS, OWNBRAND_PRODUCTS_HEADERS).forEach(function (p) { productsById[p.sku_id] = p; });
  const terms = getConsignTermsMap_();

  const agg = {};
  rows.forEach(function (r) {
    if (filterCustomerId && String(r.customer_id) !== String(filterCustomerId)) return;
    const key = r.customer_id + '|' + r.sku_id;
    if (!agg[key]) agg[key] = { customer_id: r.customer_id, sku_id: r.sku_id, in: 0, out: 0, return: 0, adjust: 0, deposit_refund: 0 };
    const qty = Number(r.qty) || 0;
    if (r.type === 'in') agg[key].in += qty;
    else if (r.type === 'out') agg[key].out += qty;
    else if (r.type === 'return') agg[key].return += qty;
    else if (r.type === 'adjust') agg[key].adjust += qty;
    else if (r.type === 'deposit_refund') agg[key].deposit_refund += qty;
  });

  // 實體庫存＝in－out－return＋adjust；保證金在池瓶數＝in－return－deposit_refund（售出不影響保證金）
  const inventory = Object.keys(agg).map(function (key) {
    const a = agg[key];
    const balance = a.in - a.out - a.return + a.adjust;
    const depositPoolQty = a.in - a.return - a.deposit_refund;
    const p = productsById[a.sku_id] || {};
    return {
      customer_id: a.customer_id,
      sku_id: a.sku_id,
      name: p.name || '',
      volume: p.volume || '',
      in: a.in, out: a.out, return: a.return, adjust: a.adjust, deposit_refund: a.deposit_refund,
      balance: balance,
      deposit_pool_qty: depositPoolQty
    };
  });

  const depositByCustomer = {};
  inventory.forEach(function (row) {
    if (row.deposit_pool_qty <= 0) return;
    const depKey = row.volume === '100ml' ? 'deposit_100ml' : (row.volume === '500ml' ? 'deposit_500ml' : null);
    const depUnit = depKey ? Number(terms[depKey] || 0) : 0;
    depositByCustomer[row.customer_id] = (depositByCustomer[row.customer_id] || 0) + row.deposit_pool_qty * depUnit;
  });

  return { ok: true, inventory: inventory, deposit_held_by_customer: depositByCustomer };
}

// ===================================================================
// action: getConsignLedger —— 明細帳，可帶 customer_id / date_from / date_to
// ===================================================================
function handleGetConsignLedger_(params) {
  let rows = v2ReadAll_(SHEET_CONSIGN_LEDGER, CONSIGN_LEDGER_HEADERS);
  if (params.customer_id) {
    rows = rows.filter(function (r) { return String(r.customer_id) === String(params.customer_id); });
  }
  if (params.date_from) {
    rows = rows.filter(function (r) { return String(r.date) >= String(params.date_from); });
  }
  if (params.date_to) {
    rows = rows.filter(function (r) { return String(r.date) <= String(params.date_to); });
  }
  rows.sort(function (a, b) {
    return String(b.date).localeCompare(String(a.date)) || String(b.created_at).localeCompare(String(a.created_at));
  });
  return { ok: true, rows: rows };
}

// ===================================================================
// action: getConsignMonthly {customer_id, year, month} —— 自然月結算
// 金額 = Σ 該月 type=out 列的 qty × unit_price（unit_price 為下單當時鎖定的折後價）
// ===================================================================
function handleGetConsignMonthly_(params) {
  const customerId = params.customer_id;
  const year = parseInt(params.year, 10);
  const month = parseInt(params.month, 10);
  if (!customerId || !year || !month) throw new Error('缺少 customer_id / year / month');

  const from = year + '-' + String(month).padStart(2, '0') + '-01';
  const lastDay = new Date(year, month, 0).getDate();
  const to = year + '-' + String(month).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0');

  const rows = v2ReadAll_(SHEET_CONSIGN_LEDGER, CONSIGN_LEDGER_HEADERS).filter(function (r) {
    return String(r.customer_id) === String(customerId) && r.type === 'out' &&
      String(r.date) >= from && String(r.date) <= to;
  });

  const productsById = {};
  v2ReadAll_(SHEET_OWNBRAND_PRODUCTS, OWNBRAND_PRODUCTS_HEADERS).forEach(function (p) { productsById[p.sku_id] = p; });

  // v41：改按「SKU＋單價」分組。原本只按 SKU 分組、unit_price 取最後一筆，
  // 同月同品項若出現兩種售價（改折數/單筆促銷價），列上的 qty×unit_price 會對不上 amount，
  // 前端「轉為報價單」再用 qty×unit_price 重算就會算錯總額。分開列後每列金額都自洽。
  const byKey = {};
  rows.forEach(function (r) {
    const qty = Number(r.qty) || 0;
    const unitPrice = Number(r.unit_price) || 0;
    const key = r.sku_id + '|' + unitPrice;
    if (!byKey[key]) byKey[key] = { sku_id: r.sku_id, qty: 0, amount: 0, unit_price: unitPrice };
    byKey[key].qty += qty;
    byKey[key].amount += qty * unitPrice;
  });

  const lines = Object.keys(byKey).map(function (key) {
    const b = byKey[key];
    const p = productsById[b.sku_id] || {};
    return { sku_id: b.sku_id, name: p.name || '', volume: p.volume || '', qty: b.qty, unit_price: b.unit_price, amount: b.amount };
  });
  lines.sort(function (a, b) { return String(a.sku_id).localeCompare(String(b.sku_id)) || a.unit_price - b.unit_price; });

  const total = lines.reduce(function (sum, l) { return sum + l.amount; }, 0);

  return { ok: true, lines: lines, total: total, period: { from: from, to: to } };
}

// ===================================================================
// 內部測試：在編輯器手動執行，直接呼叫各 handler（不經過 token）。
// 若 ownbrand_products 尚無資料會自動先同步一次。測試寫入的 consign_*
// 資料（客戶/例外折/明細帳）執行完會自行清掉；change_log 依慣例永不清除。
// ===================================================================
function runV3Tests() {
  const out = [];

  let products = handleGetOwnbrandProducts_({}).products;
  if (!products.length) {
    syncOwnbrandProducts_();
    products = handleGetOwnbrandProducts_({}).products;
  }
  out.push('getOwnbrandProducts: ok=true count=' + products.length);

  const tiersResp = handleGetOwnbrandTiers_({});
  out.push('getOwnbrandTiers: ok=' + tiersResp.ok + ' tiers=' + tiersResp.tiers.length + ' terms.deposit_100ml=' + tiersResp.terms.deposit_100ml);

  if (!products.length) {
    out.push('⚠ ownbrand_products 為空，無法繼續寄售相關測試（請確認來源試算表 NO1.V2_報價 是否有資料）');
    Logger.log(out.join('\n'));
    return out.join('\n');
  }

  const testSku = products[0].sku_id;
  const testCustomerId = 'TEST-V3-CUST-01';

  const custResp = handleSaveConsignCustomer_({ customer: { customer_id: testCustomerId, name: '測試寄售客戶', default_discount: 0.75, billing_day: 5, active: 'Y' } });
  out.push('saveConsignCustomer: ok=' + custResp.ok + ' id=' + custResp.customer.customer_id);

  const inMove = handleAddConsignMovement_({ movement: { customer_id: testCustomerId, sku_id: testSku, type: 'in', qty: 30, note: '測試鋪貨' } });
  out.push('addConsignMovement(in): ok=' + inMove.ok + ' movement_id=' + inMove.movement.movement_id);

  const expectedUnitPrice1 = resolveConsignUnitPrice_(testCustomerId, testSku).unitPrice;
  const outMove = handleAddConsignMovement_({ movement: { customer_id: testCustomerId, sku_id: testSku, type: 'out', qty: 5, note: '測試銷售' } });
  out.push('addConsignMovement(out): ok=' + outMove.ok + ' unit_price=' + outMove.movement.unit_price + ' 自動套價正確=' + (Number(outMove.movement.unit_price) === expectedUnitPrice1));

  const inv = handleGetConsignInventory_({ customer_id: testCustomerId });
  const invRow = inv.inventory.filter(function (r) { return r.sku_id === testSku; })[0];
  out.push('getConsignInventory: ok=' + inv.ok + ' balance=' + (invRow ? invRow.balance : 'N/A') + ' 應為25=' + (!!invRow && invRow.balance === 25));
  out.push('deposit_held_by_customer[' + testCustomerId + ']=' + inv.deposit_held_by_customer[testCustomerId]);

out.push('deposit_pool_qty(售出不應影響，應為30)=' + (invRow ? invRow.deposit_pool_qty : 'N/A') + ' 正確=' + (!!invRow && invRow.deposit_pool_qty === 30));

const returnMove = handleAddConsignMovement_({ movement: { customer_id: testCustomerId, sku_id: testSku, type: 'return', qty: 5, note: '測試退貨' } });
const invAfterReturn = handleGetConsignInventory_({ customer_id: testCustomerId }).inventory.filter(function (r) { return r.sku_id === testSku; })[0];
out.push('addConsignMovement(return): ok=' + returnMove.ok + ' deposit_pool_qty應為25=' + (!!invAfterReturn && invAfterReturn.deposit_pool_qty === 25));

const refundMove = handleAddConsignMovement_({ movement: { customer_id: testCustomerId, sku_id: testSku, type: 'deposit_refund', qty: invAfterReturn.deposit_pool_qty, note: '測試終止合約退保證金' } });
const invAfterRefund = handleGetConsignInventory_({ customer_id: testCustomerId });
const invRowAfterRefund = invAfterRefund.inventory.filter(function (r) { return r.sku_id === testSku; })[0];
out.push('addConsignMovement(deposit_refund): ok=' + refundMove.ok + ' deposit_pool_qty應為0=' + (!!invRowAfterRefund && invRowAfterRefund.deposit_pool_qty === 0) + ' deposit_held應歸零=' + (!invAfterRefund.deposit_held_by_customer[testCustomerId]));

  const ledger = handleGetConsignLedger_({ customer_id: testCustomerId });
  out.push('getConsignLedger: ok=' + ledger.ok + ' rows=' + ledger.rows.length);

  const now = new Date();
  const monthly = handleGetConsignMonthly_({ customer_id: testCustomerId, year: now.getFullYear(), month: now.getMonth() + 1 });
  const expectedAmount = 5 * expectedUnitPrice1;
  out.push('getConsignMonthly: ok=' + monthly.ok + ' total=' + monthly.total + ' 應為' + expectedAmount + '=' + (monthly.total === expectedAmount));

  const discResp = handleSaveConsignDiscount_({ discount: { customer_id: testCustomerId, sku_id: testSku, discount: 0.6, note: '測試例外折' } });
  const overriddenPrice = resolveConsignUnitPrice_(testCustomerId, testSku);
  out.push('saveConsignDiscount: ok=' + discResp.ok + ' 例外折生效=' + (overriddenPrice.discount === 0.6));

  const delDiscResp = handleDeleteConsignDiscount_({ customer_id: testCustomerId, sku_id: testSku });
  const revertedPrice = resolveConsignUnitPrice_(testCustomerId, testSku);
  out.push('deleteConsignDiscount: ok=' + delDiscResp.ok + ' 已還原標準折=' + (revertedPrice.discount === 0.75));

  // 清掉測試寫入的資料（change_log 依慣例永不清除）
  const ss = ssApp_();
  const ledgerRows = v2ReadAll_(SHEET_CONSIGN_LEDGER, CONSIGN_LEDGER_HEADERS);
  const ledgerSh = ss.getSheetByName(SHEET_CONSIGN_LEDGER);
  for (let i = ledgerRows.length - 1; i >= 0; i--) {
    if (ledgerRows[i].customer_id === testCustomerId) {
      ledgerSh.deleteRow(i + 2);
    }
  }
  const custRowNum = v2FindRow_(SHEET_CONSIGN_CUSTOMERS, CONSIGN_CUSTOMERS_HEADERS, 'customer_id', testCustomerId);
  if (custRowNum !== -1) ss.getSheetByName(SHEET_CONSIGN_CUSTOMERS).deleteRow(custRowNum);
  const discRowNum = findConsignDiscountRow_(testCustomerId, testSku);
  if (discRowNum !== -1) ss.getSheetByName(SHEET_CONSIGN_DISCOUNTS).deleteRow(discRowNum);

  Logger.log(out.join('\n'));
  return out.join('\n');
}
