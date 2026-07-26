/**
 * ===================================================================
 * B4 附加圖片存後台（對話B 2026-07-24）
 * 前端送 quote.images = [{name, mime, data(base64)}...]（全量覆蓋語意）
 * 存到私有 Drive：報價單圖片/imgs_{單號}/，主表 imageLinks 欄存 JSON。
 * getQuoteById 回 base64；deleteQuote 連圖 trash。延續 v2.6 私有化（不 setSharing）。
 * ===================================================================
 */

var IMG_ROOT_FOLDER_NAME = '報價單圖片';

// 取得/建立圖片根資料夾
function getOrCreateImageRootFolder_() {
  var folders = DriveApp.getFoldersByName(IMG_ROOT_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(IMG_ROOT_FOLDER_NAME);
}

// 取得/建立某單的圖片子資料夾 imgs_{單號}
function getOrCreateQuoteImageFolder_(quoteNo) {
  var root = getOrCreateImageRootFolder_();
  var name = 'imgs_' + quoteNo;
  var it = root.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return root.createFolder(name);
}

// 全量覆蓋儲存圖片，回傳 imageLinks JSON 字串（空陣列或無圖回 ''）
function saveQuoteImages_(quoteNo, images) {
  var folder = getOrCreateQuoteImageFolder_(quoteNo);
  var existing = folder.getFiles();
  while (existing.hasNext()) {
    existing.next().setTrashed(true);
  }
  if (!images || images.length === 0) {
    return '';
  }
  var files = [];
  for (var i = 0; i < images.length; i++) {
    var img = images[i];
    if (!img || !img.data) continue;
    var mime = img.mime || 'image/jpeg';
    var name = img.name || ('image_' + (i + 1) + '.jpg');
    var bytes = Utilities.base64Decode(img.data);
    var blob = Utilities.newBlob(bytes, mime, name);
    var file = folder.createFile(blob);
    files.push({ id: file.getId(), name: name, mime: mime });
  }
  return JSON.stringify({ folderId: folder.getId(), files: files });
}

// 由 imageLinks JSON 讀回圖片 base64，回 [{name, mime, data}]（順序同儲存）
function loadQuoteImages_(imageLinks) {
  if (!imageLinks) return [];
  var meta;
  try {
    meta = JSON.parse(imageLinks);
  } catch (e) {
    return [];
  }
  if (!meta || !meta.files || !meta.files.length) return [];
  var out = [];
  for (var i = 0; i < meta.files.length; i++) {
    var f = meta.files[i];
    try {
      var file = DriveApp.getFileById(f.id);
      var blob = file.getBlob();
      out.push({
        name: f.name || file.getName(),
        mime: f.mime || blob.getContentType() || 'image/jpeg',
        data: Utilities.base64Encode(blob.getBytes())
      });
    } catch (e) {
    }
  }
  return out;
}

// 刪單時把該單圖片子資料夾 trash，避免孤兒圖片
function trashQuoteImages_(imageLinks) {
  if (!imageLinks) return;
  var meta;
  try {
    meta = JSON.parse(imageLinks);
  } catch (e) {
    return;
  }
  if (meta && meta.folderId) {
    try {
      DriveApp.getFolderById(meta.folderId).setTrashed(true);
    } catch (e) {
    }
  }
}
