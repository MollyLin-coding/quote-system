/* ===================================================================
   13_factory.js —— 廠務／酒譜 APP 連結（2026-09-08）
   後端：gas/v5_factory.gs（factoryPushOrder／factorySync／getFactoryLinks／getFactoryMap／saveFactoryMap）
   決議（Molly 2026-09-08）：出貨以廠務為主；金流以報價系統為主、不同時只提示；
   轉單由她按「轉廠務訂單」；廠務同仁建的有金流訂單自動匯成草稿報價單；寄售先不碰。
   2026-09-23 晚 深度複檢（配合後端「複檢 0923」）：
     ・「更新廠務訂單」後端改成先讀廠務再合併 → 這裡的確認文字講清楚「會改什麼／保留什麼」；
       廠務那張被刪（GONE）→ 問要不要重建；有衝突（CONFLICT）→ 列出來不推；合併提示（數量異動等）跳出來給她看
     ・連結資料還沒載到前按鈕不給按（原本會先顯示「轉廠務訂單」，按下去可能又建一張）；同一張單送出中不重複送
     ・同步結果判斷改看「真的有變」：出貨列／實際出貨日／匯入才清快取重抓；只是金額一直不符不再每 10 分鐘清一次
     ・自動同步只在老闆帳號＋訂單追蹤頁（其他頁靠後端每小時排程）；後端 10 分鐘內剛同步過就不再打
     ・驗收單帶入：酒名去 V2、挑最像的一列、同款多列依序分配；預設選「下一次」出貨
   =================================================================== */
let FX_LINKS = null;            // { quote_no: link }
let FX_LAST_SYNC_AT = 0;        // 這個分頁上一次自動同步的時間（毫秒）
let FX_LAST_SYNC_ISO = '';      // 後端最近一次同步時間（每小時排程或任何一次手動同步；getFactoryLinks 回 lastSync）
let FX_ERR_SIG = '';            // 背景同步的錯誤只在「跟上一次不一樣」時才跳提示，不每 10 分鐘嘮叨同一件事
const FX_PUSHING = {};          // 推單送出中（同一張單不重複送）
const FX_AUTO_SYNC_MS = 10 * 60 * 1000;   // 開訂單追蹤頁時最多每 10 分鐘自動同步一次（後端另有每小時排程）
const FX_PUSH_TYPES = ['bottle', 'ownbrand', 'ownlabel'];

function fxLinkOf(no){ return (FX_LINKS && FX_LINKS[String(no)]) || null; }
/* 2026-09-10 Molly：廠務標「南坡萬付運費」的運費＝公司成本（不進營收、不跟報價單比）。
   後端同步時寫進 factory_fin_json.shipCost；月報表用它算「本月公司付運費」與成交淨額。沒有就回 0 */
function fxShipCost(no){
  const l = fxLinkOf(no); if(!l) return 0;
  const fin = fxParse(l.factory_fin_json, {});
  const v = parseFloat(fin.shipCost); return (isFinite(v) && v > 0) ? v : 0;
}
function fxParse(s, dflt){ try{ return s ? (typeof s==='string' ? JSON.parse(s) : s) : dflt; }catch(e){ return dflt; } }

/* 讀 factory_links（走讀取快取；訂單追蹤頁每次 loadOrders 都會叫，快取內就 0 秒） */
async function loadFactoryLinks(force){
  try{
    if(!AUTH_TOKEN) return;
    const r = await readCall({ action:'getFactoryLinks', token:AUTH_TOKEN }, force);
    const m = {};
    ((r && r.links) || []).forEach(l => { m[String(l.quote_no)] = l; });
    FX_LINKS = m;
    FX_CONFIGURED = !!(r && r.configured);
    if(r && r.lastSync) FX_LAST_SYNC_ISO = String(r.lastSync);
    if(typeof renderOrders === 'function') renderOrders();
    // 複檢 0923：月報表「公司付運費」讀 FX_LINKS——報表先畫好、連結資料後到時要補畫，不然那欄一直是 0
    if(typeof currentPage !== 'undefined' && currentPage === 'report' && typeof renderReport === 'function') renderReport();
  }catch(_){}
}
let FX_CONFIGURED = false;

/* 訂單列徽章：廠務狀態／Lot／金額不符 */
function fxBadges(o){
  const l = fxLinkOf(o.no); if(!l) return '';
  let h = '';
  const st = String(l.factory_status || '').trim();
  const lot = String(l.factory_lot || '').trim();
  const cls = st === '已出貨' ? 'info' : (st === '已完成' ? 'info' : (st === '製作中' ? 'warn' : (st === '廠務已刪除' ? 'red' : '')));
  const tip = `廠務訂單 ${l.factory_order_no || ''}${FX_LAST_SYNC_ISO ? '｜最近同步 ' + String(FX_LAST_SYNC_ISO).replace('T', ' ').slice(5, 16) : ''}${l.last_sync ? '｜這張上次有變動 ' + String(l.last_sync).replace('T', ' ').slice(5, 16) : ''}${l.note ? '｜' + l.note : ''}`;
  if(l.factory_order_no) h += `<span class="ob ${cls}" title="${escAttr(tip)}">🏭 ${escHtml(st || '已轉廠務')}${lot ? ' · Lot ' + escHtml(lot) : ''}</span>`;
  const sc = fxShipCost(o.no);
  if(sc > 0) h += `<span class="ob" title="廠務標「南坡萬付運費」：這筆是公司成本，不算營收、不跟報價單比；月報表會扣在「成交淨額」">🚚 公司付運費 ${money(sc)}</span>`;
  const mis = String(l.fin_mismatch || '').trim();
  if(mis) h += `<span class="ob red" title="${escAttr(mis)}" style="cursor:help" data-no="${escAttr(o.no)}" onclick="fxShowMismatch(this.dataset.no)">⚠ 金額與廠務不符</span>`;
  return h;
}
function fxShowMismatch(no){
  const l = fxLinkOf(no); if(!l) return;
  const fin = fxParse(l.factory_fin_json, {});
  const lines = String(l.fin_mismatch || '').split('；').filter(Boolean).map(s => '• ' + s).join('\n');
  alert(`報價單 ${no} ／ 廠務訂單 ${l.factory_order_no}\n\n${lines}\n\n廠務目前：總額 ${fin.total ?? '—'}、訂金 ${fin.depositAmount === '' || fin.depositAmount == null ? '未填' : fin.depositAmount}、尾款 ${fin.finalAmount === '' || fin.finalAmount == null ? '未填' : fin.finalAmount}${fin.finalAdjusted ? '（調整後 ' + fin.finalAdjustedAmount + '）' : ''}\n\n金流以報價系統為主：若報價系統正確，按「更新廠務訂單」把金額推過去；若廠務才對，請到「編輯進度」改報價系統這邊。`);
}
/* 操作欄按鈕：轉廠務訂單／更新廠務訂單 */
function fxActionBtn(o){
  if(!FX_PUSH_TYPES.includes(o.typeKey) || o.src === 'custom') return '';
  // 複檢 0923：連結資料還沒載入前不知道這張轉過沒 → 先不給按（loadFactoryLinks 回來會重畫）
  if(FX_LINKS === null) return `<button class="rec-act-btn" type="button" disabled title="正在讀取廠務連結…">🏭 讀取中…</button>`;
  const l = fxLinkOf(o.no);
  const linked = !!(l && l.factory_order_no);
  const gone = linked && String(l.factory_status || '') === '廠務已刪除';
  const title = gone ? '廠務那張 ' + escAttr(l.factory_order_no) + ' 已經被刪掉了：按這裡用這張報價單在廠務重新建一張'
    : linked ? '把報價系統這邊的數量／出貨日／金流更新到廠務訂單 ' + escAttr(l.factory_order_no) + '（廠務的瓶型、酒譜、Lot、配送、備註會保留）'
    : '在廠務系統建一張訂單（客戶、酒款、數量、出貨日、金流、配送資訊都自動帶）';
  return `<button class="rec-act-btn" id="fx-push-${escAttr(o.no)}" data-no="${escAttr(o.no)}" onclick="fxPushOrder(this.dataset.no, this)" title="${title}">${gone ? '🏭 重新轉廠務訂單' : linked ? '🏭 更新廠務訂單' : '🏭 轉廠務訂單'}</button>`;
}
async function fxPushOrder(no, btn){
  if(!AUTH_TOKEN){ toast('請先登入', 'err'); return; }
  if(FX_LINKS === null){ toast('廠務連結資料還在讀取，請等一下再按', 'err'); loadFactoryLinks(true); return; }
  const l = fxLinkOf(no);
  const linked = !!(l && l.factory_order_no);
  if(!linked){ fxOpenLinkDialog(no); return; }   // 未連結：先問「建新的」還是「連結廠務已有的」
  return fxPushOrderDo(no, btn);
}
async function fxPushOrderDo(no, btn){
  if(FX_PUSHING[no]){ toast('這張單正在傳送中，請稍候', 'err'); return; }
  const l = fxLinkOf(no);
  const linked = !!(l && l.factory_order_no);
  const gone = linked && String(l.factory_status || '') === '廠務已刪除';
  const q = confirm(gone
    ? `廠務訂單 ${l.factory_order_no} 已經不在廠務系統（同仁刪掉了）。\n\n要用報價單 ${no} 在廠務重新建一張訂單嗎？`
    : linked
    ? `要把報價單 ${no} 的最新內容更新到廠務訂單 ${l.factory_order_no} 嗎？\n\n會更新：酒款數量、表訂出貨日、金額（總額／訂金／尾款／收款日）、客戶付的運費。\n會保留廠務那邊的：客戶名稱、瓶型、酒譜、Lot、試飲、製作狀態、配送方式、運費支付方、備註、出貨紀錄。\n\n廠務已經出貨或完成的酒款若對不上，會先列出來、不會硬推。`
    : `要用報價單 ${no} 在廠務系統建立一張訂單嗎？\n\n客戶、酒款、數量、出貨日、金流、配送資訊都會自動帶過去；同仁會在廠務系統看到這張單。`);
  if(!q) return;
  FX_PUSHING[no] = true;
  let wrote = false;
  try{
    btnBusy(btn, true, '傳送中…');
    const payload = { action:'factoryPushOrder', token:AUTH_TOKEN, quote_no:no };
    if(gone) payload.force_new = '1';
    wrote = true;
    let r = await apiCall(payload);
    if(r && !r.ok && r.code === 'FACTORY_ORDER_GONE'){
      if(!confirm(`${r.error}\n\n要用報價單 ${no} 在廠務重新建一張新的訂單嗎？`)) return;
      r = await apiCall(Object.assign({}, payload, { force_new:'1' }));
    }
    if(r && !r.ok && r.code === 'CONFLICT'){ alert(r.error); return; }
    if(!r || !r.ok) throw new Error((r && r.error) || '轉單失敗');
    toast(`${r.updated ? '已更新' : '已建立'}廠務訂單 ${r.factory_order_no}（客戶「${r.client}」，${r.items} 款）`, 'ok');
    if(r.notes && r.notes.length) alert(`廠務訂單 ${r.factory_order_no} ${r.updated ? '已更新' : '已建立'}，請留意：\n\n` + r.notes.map(x => '• ' + x).join('\n'));
  }catch(e){ toast(e.message || '轉單失敗', 'err'); }
  finally{
    delete FX_PUSHING[no]; btnBusy(btn, false);
    // 寫入類 API 會清掉整站讀取快取（訂單清單也被清成 null）→ 不管成功與否都重抓，畫面才不會停在舊資料、「編輯進度」也點得開
    if(wrote){ if(typeof loadOrders === 'function') loadOrders(true).catch(() => {}); else loadFactoryLinks(true); }
  }
}

/* 同步：廠務 → 報價系統（狀態／Lot／出貨紀錄／金流比對／同仁新建單匯入） */
async function fxSyncNow(btn, silent){
  if(!AUTH_TOKEN) return null;
  try{
    if(btn) btnBusy(btn, true, '同步中…');
    const r = await apiCall({ action:'factorySync', token:AUTH_TOKEN });
    if(r && r.busy){ if(!silent) toast('廠務同步正在進行中（每小時排程或另一個視窗剛好在跑），等一下再按一次就好', 'ok'); return r; }
    if(!r || !r.ok) throw new Error((r && r.error) || '同步失敗');
    FX_LAST_SYNC_AT = Date.now();
    if(r.at) FX_LAST_SYNC_ISO = String(r.at);
    const imp = r.imported || [], mis = r.mismatches || [], errs = r.errors || [], paused = r.paused || [], gone = r.gone || [], healed = r.healed || [];
    /* 複檢 0923：只有「訂單追蹤／出貨紀錄／報價單」真的被寫了才清整站快取重抓（原本金額不符也算變化，
       一張單金額一直不符＝每 10 分鐘就把快取清光一次）；只有連結表變了（狀態／Lot／標刪除）→ 只重抓連結 */
    const dataChanged = !!(imp.length || r.shipChanged || r.shipRemoved || r.osChanged);
    const linkChanged = !!(r.linkChanged || gone.length || healed.length);
    const parts = [];
    if(imp.length) parts.push(`匯入廠務新訂單 ${imp.length} 張（${imp.map(x => x.quote_no + '／' + x.client).join('、')}）→ 已建成草稿報價單，請補單價確認`);
    if(r.shipChanged) parts.push(`出貨紀錄更新 ${r.shipChanged} 筆` + (r.shipRemoved ? `（其中 ${r.shipRemoved} 筆是廠務刪掉的出貨，這邊一併拿掉）` : ''));
    if(r.osChanged) parts.push(`實際出貨日跟著廠務更新 ${r.osChanged} 張`);
    if(gone.length) parts.push(`⚠ 廠務刪掉了 ${gone.length} 張已連結的訂單（報價單 ${gone.join('、')}）：列上標「廠務已刪除」，要的話按「重新轉廠務訂單」`);
    if(mis.length && (!silent || linkChanged)) parts.push(`⚠ ${mis.length} 張單金額與廠務不符（列上有紅色提示）`);
    if(paused.length && !silent) parts.push(`${paused.length} 張報價單已刪除或是純報價，已停止同步（廠務那邊 ${paused.map(x => x.factory_order_no).join('、')} 還在，要不要刪請跟同仁說）`);
    const sig = errs.join('|');
    const showErr = errs.length > 0 && (!silent || sig !== FX_ERR_SIG);
    FX_ERR_SIG = sig;
    if(showErr) parts.push(`有 ${errs.length} 件事要注意：` + errs.slice(0, 2).join('；'));
    if(!silent || parts.length) toast(parts.length ? parts.join('\n') : `已同步 ${r.synced} 張廠務訂單，沒有變化`, (showErr || gone.length) ? 'err' : 'ok');
    if(dataChanged){
      if(typeof rcClear === 'function') rcClear();
      if(typeof loadOrders === 'function') loadOrders(true).catch(() => {});
      else await loadFactoryLinks(true);
      if(typeof loadShipmentBadges === 'function') loadShipmentBadges(true);
    } else if(linkChanged || !silent){
      await loadFactoryLinks(true);
    }
    return r;
  }catch(e){ if(!silent) toast(e.message || '同步失敗', 'err'); return null; }
  finally{ if(btn) btnBusy(btn, false); }
}
/* 開訂單追蹤頁自動同步（10 分鐘內不重打；沒設定連結就不打）
   複檢 0923：只有老闆帳號、而且人停在「訂單追蹤」頁才打——今日待辦／行事曆／月報表也會載訂單資料，
   原本每一頁都會觸發一次 10～30 秒的同步；其他頁靠後端每小時排程。後端 10 分鐘內剛同步過（排程／別的視窗）也不再打。 */
function fxAutoSync(){
  if(!AUTH_TOKEN || !FX_CONFIGURED) return;
  if(typeof isOwner === 'function' && !isOwner()) return;
  if(typeof currentPage !== 'undefined' && currentPage !== 'orders') return;
  if(Date.now() - FX_LAST_SYNC_AT < FX_AUTO_SYNC_MS) return;
  const t = FX_LAST_SYNC_ISO ? Date.parse(FX_LAST_SYNC_ISO) : NaN;
  if(isFinite(t) && Date.now() - t < FX_AUTO_SYNC_MS){ FX_LAST_SYNC_AT = t; return; }
  FX_LAST_SYNC_AT = Date.now();   // 先佔住，避免同時多次
  setTimeout(() => { fxSyncNow(null, true); }, 1500);
}

/* ── 驗收單：從廠務出貨紀錄一鍵帶入 ──────────────────────── */
function fxVerifyBar(no){
  const body = document.getElementById('vf-body'); if(!body) return;
  const l = fxLinkOf(no); if(!l) return;
  const sj = fxParse(l.ship_json, null);
  const batches = ((sj && sj.batches) || []).slice().sort((a, b) => Number(a.seq) - Number(b.seq));
  if(!batches.length) return;
  // 複檢 0923：預設選「下一次」出貨（前面已經產生過 N 張驗收單 → 第 N+1 次），沒有那一次就選最後一次
  const want = ((typeof VERIFY_DATA !== 'undefined' && VERIFY_DATA && Number(VERIFY_DATA.priorCount)) || 0) + 1;
  const defSeq = batches.some(b => Number(b.seq) === want) ? want : Number(batches[batches.length - 1].seq);
  const opts = batches.map(b => `<option value="${b.seq}"${Number(b.seq) === defSeq ? ' selected' : ''}>第 ${b.seq} 次出貨 ${escHtml(b.date || '')}（${escHtml(b.lines.map(x => x.product + '×' + x.qty).join('、'))}）</option>`).join('');
  const bar = document.createElement('div');
  bar.id = 'fx-vf-bar';
  bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:#EEF6F2;border:1px solid #BFE0CF;border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:12px';
  bar.innerHTML = `<span style="font-weight:600">🏭 廠務訂單 ${escHtml(sj.orderNo || l.factory_order_no || '')} 已有 ${batches.length} 次出貨紀錄</span>
    <select id="fx-vf-batch" style="border:1px solid var(--bd);border-radius:5px;padding:4px 6px;font-size:12px;font-family:inherit">${opts}</select>
    <button class="btn btn-g" type="button" data-no="${escAttr(no)}" onclick="fxVerifyFill(this.dataset.no)">帶入這次出貨</button>
    <span style="color:var(--hint)">會填：配送日期、第幾次出貨、本次出貨數、已出貨（前幾次加總）、PM</span>`;
  body.insertBefore(bar, body.firstChild);
}
function fxVerifyFill(no){
  const l = fxLinkOf(no); if(!l || !VERIFY_DATA) return;
  const sj = fxParse(l.ship_json, null); if(!sj) return;
  const sel = document.getElementById('fx-vf-batch');
  const seq = Number(sel && sel.value) || 0;
  const b = (sj.batches || []).find(x => Number(x.seq) === seq); if(!b){ toast('找不到這次出貨', 'err'); return; }
  const key = s => String(s || '').replace(/[\s　]+/g, '').toLowerCase();
  const bare = s => key(s).replace(/v\d+$/, '');
  const rows = VERIFY_DATA.rows || [];
  /* 複檢 0923：酒名對報價單品項 ①完全一樣 ②去掉廠務的 V2 ③互相包含時挑名字最長的那個
     （原本「第一個包含的」：「蜜香紅茶」會把「蜜香紅茶荔枝琴酒」的量搶走） */
  const candidates = (product) => {
    const k = key(product), kb = bare(product);
    let idx = rows.map((r, i) => i).filter(i => key(rows[i].name) === k);
    if(!idx.length) idx = rows.map((r, i) => i).filter(i => bare(rows[i].name) === kb);
    if(!idx.length){
      const hit = rows.map((r, i) => ({ i, n: bare(r.name) })).filter(x => x.n && (kb.indexOf(x.n) >= 0 || x.n.indexOf(kb) >= 0));
      if(hit.length){ const mx = Math.max(...hit.map(x => x.n.length)); idx = hit.filter(x => x.n.length === mx).map(x => x.i); }
    }
    return idx;
  };
  // 同一款分好幾列（例：同酒兩個 Lot）→ 依序分配、每列最多分到自己的訂購量（多出來的放最後一列，總數不變）；前幾次出貨先分
  const cap = rows.map(r => parseFloat(r.ordered) || 0);
  const prevQ = rows.map(() => 0), thisQ = rows.map(() => 0), unmatched = [];
  const alloc = (idx, qty, arr) => {
    let left = qty;
    idx.forEach((i, n) => {
      if(left <= 0) return;
      const room = Math.max(0, cap[i] - prevQ[i] - thisQ[i]);
      const give = (n === idx.length - 1) ? left : Math.min(left, room);
      arr[i] += give; left -= give;
    });
  };
  (sj.batches || []).slice().sort((a, c) => Number(a.seq) - Number(c.seq)).forEach(bb => {
    if(Number(bb.seq) > seq) return;
    (bb.lines || []).forEach(ln => {
      const idx = candidates(ln.product);
      if(!idx.length){ if(Number(bb.seq) === seq) unmatched.push(ln.product); return; }
      alloc(idx, Number(ln.qty) || 0, Number(bb.seq) === seq ? thisQ : prevQ);
    });
  });
  rows.forEach((r, i) => {
    const ts = document.querySelector(`#vf-body .vfi[data-i="${i}"][data-k="thisShip"]`);
    const sh = document.querySelector(`#vf-body .vfi[data-i="${i}"][data-k="shipped"]`);
    if(sh){ sh.value = prevQ[i] || 0; }
    if(ts){ ts.value = thisQ[i] || 0; ts.dataset.manual = '1'; }
  });
  const sd = document.getElementById('vf-shipdate'); if(sd && b.date) sd.value = b.date;
  const sq = document.getElementById('vf-shipseq'); if(sq) sq.value = seq;
  const pm = document.getElementById('vf-shipper'); if(pm && !pm.value.trim() && sj.pm) pm.value = sj.pm;
  // 產生驗收單時（shpSyncFromVerify）認得這是廠務哪一趟，接在同步寫好的那筆出貨後面、不另長一筆
  VERIFY_DATA.fxShipSeq = seq; VERIFY_DATA.fxOrderNo = String(sj.orderNo || l.factory_order_no || '');
  if(typeof recalcVerify === 'function') recalcVerify();
  toast(unmatched.length ? `已帶入第 ${seq} 次出貨；有 ${unmatched.length} 款對不上報價單品項（${unmatched.join('、')}），請手動填` : `已帶入廠務第 ${seq} 次出貨（${b.date || ''}）`, unmatched.length ? 'err' : 'ok');
}

/* ── 對照表（客戶／酒款名稱：報價系統 ↔ 廠務）──────────────── */
function fxEnsureMapOverlay(){
  if(document.getElementById('fx-map-overlay')) return;
  const ov = document.createElement('div');
  ov.className = 'v2ov'; ov.id = 'fx-map-overlay';
  ov.innerHTML = `<div class="v2box" style="max-width:760px">
    <div class="v2h"><span>廠務對照設定</span><button class="v2x" onclick="fxCloseMap()">✕</button></div>
    <div id="fx-map-body"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
      <button class="btn btn-g" onclick="fxCloseMap()">關閉</button>
      <button class="btn btn-gold" id="fx-map-save" onclick="fxSaveMap()">儲存對照</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
}
function fxCloseMap(){ const o = document.getElementById('fx-map-overlay'); if(o) o.style.display = 'none'; }
async function fxOpenMap(){
  if(!AUTH_TOKEN){ toast('請先登入', 'err'); return; }
  fxEnsureMapOverlay();
  const body = document.getElementById('fx-map-body');
  body.innerHTML = '<div class="skl" style="width:60%"></div>';
  document.getElementById('fx-map-overlay').style.display = 'flex';
  try{
    const [mr, cr, ping] = await Promise.all([
      readCall({ action:'getFactoryMap', token:AUTH_TOKEN }, true),
      readCall({ action:'getCustomers', token:AUTH_TOKEN }).catch(() => ({ customers: [] })),
      apiCall({ action:'factoryPing', token:AUTH_TOKEN }).catch(e => ({ ok:false, error:e.message }))
    ]);
    const map = (mr && mr.map) || [];
    const byC = {}; map.filter(m => m.kind === 'client').forEach(m => { byC[String(m.qs_name)] = m.factory_name; });
    const custs = ((cr && cr.customers) || []).filter(c => String(c.active).toUpperCase() !== 'N').map(c => c.name).filter(Boolean);
    Object.keys(byC).forEach(n => { if(!custs.includes(n)) custs.push(n); });
    custs.sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    const inS = 'border:1px solid var(--bd);border-radius:5px;padding:5px 7px;font-size:12px;font-family:inherit;width:100%';
    const cRows = custs.map(n => `<tr><td style="padding:4px 6px;font-weight:600">${escHtml(n)}</td><td style="padding:4px 6px"><input class="fx-map-c" style="${inS}" data-qs="${escAttr(n)}" value="${escAttr(byC[n] || '')}" placeholder="廠務系統的客戶名（例：OEM-Babyface）"></td></tr>`).join('');
    const pRows = map.filter(m => m.kind === 'product').map(m => fxMapPRowHtml(m.qs_name, m.factory_name)).join('');
    body.innerHTML = `
      <div style="font-size:12px;margin-bottom:10px;padding:8px 10px;border-radius:8px;background:${ping && ping.ok ? '#EEF6F2' : '#FDECEC'}">
        ${ping && ping.ok ? `✅ 廠務連線正常（${escHtml(ping.env || '')}，${escHtml(ping.time || '')}）` : `❌ 廠務連線失敗：${escHtml((ping && ping.error) || '未設定')}`}
      </div>
      <p style="font-size:12px;color:var(--hint);margin-bottom:8px;line-height:1.6">兩邊系統都用「名字」認客戶和酒款，名字不一樣就對不上。<b>沒填的＝兩邊同名</b>。廠務的客戶名可到廠務系統建單畫面的客戶下拉看（例：<code>OEM-Babyface</code>、<code>全客製-酒肉朋友</code>、<code>經銷商－島羽</code>，注意全形破折號）。</p>
      <div style="font-weight:600;font-size:13px;margin:8px 0 4px">客戶</div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:var(--gold-pale);color:var(--gold-deep)"><th style="padding:6px;text-align:left">報價系統客戶名</th><th style="padding:6px;text-align:left">廠務系統客戶名</th></tr></thead><tbody>${cRows || '<tr><td colspan="2" style="padding:8px;color:var(--hint)">客戶主檔是空的</td></tr>'}</tbody></table></div>
      <div style="font-weight:600;font-size:13px;margin:14px 0 4px">酒款（只有名字不同的才需要填；廠務系統名通常帶 V2）</div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px" id="fx-map-ptable"><thead><tr style="background:var(--gold-pale);color:var(--gold-deep)"><th style="padding:6px;text-align:left">報價單上的酒款名</th><th style="padding:6px;text-align:left">廠務系統酒款名</th><th style="width:36px"></th></tr></thead><tbody id="fx-map-pbody">${pRows}</tbody></table></div>
      <button class="rec-act-btn" type="button" style="margin-top:6px" onclick="fxMapAddProduct()">＋ 加一列酒款對照</button>`;
  }catch(e){ body.innerHTML = `<div class="rec-empty">${escHtml(e.message || '讀取失敗')}</div>`; }
}
function fxMapPRowHtml(q, f){
  const inS = 'border:1px solid var(--bd);border-radius:5px;padding:5px 7px;font-size:12px;font-family:inherit;width:100%';
  return `<tr data-orig="${escAttr(q || '')}"><td style="padding:4px 6px"><input class="fx-map-pq" style="${inS}" value="${escAttr(q || '')}" placeholder="報價單上的酒款名"></td><td style="padding:4px 6px"><input class="fx-map-pf" style="${inS}" value="${escAttr(f || '')}" placeholder="廠務系統酒款名"></td><td style="padding:4px 2px;text-align:center"><button class="rec-act-btn" type="button" title="刪掉這列對照（按儲存才生效）" onclick="fxMapDelRow(this)">✕</button></td></tr>`;
}
function fxMapAddProduct(){
  const tb = document.getElementById('fx-map-pbody'); if(!tb) return;
  tb.insertAdjacentHTML('beforeend', fxMapPRowHtml('', ''));
}
// 複檢 0923：酒款對照原本刪不掉（清空報價單那格＝整列被略過、後端那筆還在）→ 每列一顆 ✕
function fxMapDelRow(btn){ const tr = btn && btn.closest('tr'); if(!tr) return; tr.dataset.del = '1'; tr.style.display = 'none'; }
async function fxSaveMap(){
  const rows = [];
  document.querySelectorAll('#fx-map-body .fx-map-c').forEach(el => { rows.push({ kind:'client', qs_name:el.dataset.qs, factory_name:el.value.trim() }); });
  document.querySelectorAll('#fx-map-pbody tr').forEach(tr => {
    const orig = String(tr.dataset.orig || '').trim();
    const qEl = tr.querySelector('.fx-map-pq'), fEl = tr.querySelector('.fx-map-pf');
    const q = qEl ? qEl.value.trim() : '', f = fEl ? fEl.value.trim() : '';
    if(tr.dataset.del === '1'){ if(orig) rows.push({ kind:'product', qs_name:orig, factory_name:'' }); return; }   // factory_name 空＝後端刪掉這筆
    if(orig && q !== orig) rows.push({ kind:'product', qs_name:orig, factory_name:'' });                           // 改了報價單那邊的名字＝舊的那筆刪掉
    if(q) rows.push({ kind:'product', qs_name:q, factory_name:f });
  });
  try{
    btnBusy('fx-map-save', true, '儲存中…');
    const r = await apiCall({ action:'saveFactoryMap', token:AUTH_TOKEN, rows });
    if(!r || !r.ok) throw new Error((r && r.error) || '儲存失敗');
    toast(`對照已儲存（${r.saved} 筆${r.removed ? '、刪掉 ' + r.removed + ' 筆' : ''}）`, 'ok');
    fxCloseMap();
  }catch(e){ toast(e.message || '儲存失敗', 'err'); }
  finally{ btnBusy('fx-map-save', false); }
}

/* ── 未連結的單：建新廠務訂單 or 連結廠務已有的訂單（上線前同仁建好的舊單）── */
function fxEnsureLinkOverlay(){
  if(document.getElementById('fx-link-overlay')) return;
  const ov = document.createElement('div');
  ov.className = 'v2ov'; ov.id = 'fx-link-overlay';
  ov.innerHTML = `<div class="v2box" style="max-width:720px">
    <div class="v2h"><span id="fx-link-title">轉廠務訂單</span><button class="v2x" onclick="fxCloseLink()">✕</button></div>
    <div id="fx-link-body"></div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:14px">
      <button class="btn btn-g" onclick="fxCloseLink()">取消</button>
      <button class="btn btn-g" id="fx-link-existing-btn" onclick="fxLinkExisting()">連結選取的廠務訂單</button>
      <button class="btn btn-gold" id="fx-link-create-btn" onclick="fxLinkCreateNew()">🏭 在廠務建新訂單</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
}
function fxCloseLink(){ const o = document.getElementById('fx-link-overlay'); if(o) o.style.display = 'none'; }
let FX_LINK_NO = null;
async function fxOpenLinkDialog(no){
  fxEnsureLinkOverlay();
  FX_LINK_NO = no;
  const o = (ORDERS_CACHE || []).find(x => String(x.no) === String(no)) || {};
  document.getElementById('fx-link-title').textContent = `轉廠務訂單：${no}（${o.client || ''}）`;
  const body = document.getElementById('fx-link-body');
  body.innerHTML = `<p style="font-size:12px;line-height:1.6;margin-bottom:8px">如果廠務系統裡<b>同仁已經建過這張單</b>，請在下面勾選它來連結（不會再建一張）；如果還沒有，按右下「在廠務建新訂單」。</p><div class="skl" style="width:60%"></div>`;
  document.getElementById('fx-link-overlay').style.display = 'flex';
  try{
    const r = await apiCall({ action:'factoryUnlinkedOrders', token:AUTH_TOKEN });
    if(!r || !r.ok) throw new Error((r && r.error) || '讀取失敗');
    const key = s => String(s || '').replace(/[\s　]+/g, '').toLowerCase().replace(/^(oem-|全客製-|換前標-|經銷商[－-]?)/, '');
    const mine = key(o.client), list = r.orders || [];
    const same = list.filter(x => key(x.client) === mine), other = list.filter(x => key(x.client) !== mine);
    const row = x => `<label style="display:flex;gap:8px;align-items:flex-start;padding:6px 8px;border:1px solid var(--bd);border-radius:6px;margin-bottom:6px;cursor:pointer;font-size:12px">
      <input type="radio" name="fx-link-pick" value="${escAttr(x.orderNo)}" style="margin-top:3px">
      <span><b>${escHtml(x.orderNo)}</b> ${escHtml(x.client)}｜${escHtml(x.status)}${x.lot ? '｜Lot ' + escHtml(x.lot) : ''}｜出貨 ${escHtml(x.deliveryDate || '—')}｜NT$${Number(x.total || 0).toLocaleString()}<br><span style="color:var(--hint)">${escHtml(x.items)}｜建單 ${escHtml(x.createdAt || '')}</span></span></label>`;
    body.innerHTML = `<p style="font-size:12px;line-height:1.6;margin-bottom:8px">如果廠務系統裡<b>同仁已經建過這張單</b>，請勾選它來連結（不會再建一張）；如果還沒有，按右下「在廠務建新訂單」。<br><span style="color:var(--hint)">上線（${escHtml(r.since || '')}）之後同仁新建的單會自動匯進來，這裡只會列出還沒對上的。</span></p>
      ${same.length ? `<div style="font-weight:600;font-size:12px;margin:6px 0">同一位客戶（${same.length}）</div>` + same.map(row).join('') : '<div style="font-size:12px;color:var(--hint);margin:6px 0">廠務裡沒有這位客戶未連結的訂單</div>'}
      ${other.length ? `<details style="margin-top:8px"><summary style="font-size:12px;cursor:pointer">其他客戶的未連結訂單（${other.length}）</summary><div style="margin-top:6px">${other.map(row).join('')}</div></details>` : ''}`;
  }catch(e){ body.innerHTML = `<div class="rec-empty">${escHtml(e.message || '讀取失敗')}</div>`; }
}
async function fxLinkExisting(){
  const pick = document.querySelector('input[name="fx-link-pick"]:checked');
  if(!pick){ toast('請先勾選一張廠務訂單', 'err'); return; }
  const no = FX_LINK_NO, fx = pick.value;
  if(!confirm(`把報價單 ${no} 連結到廠務訂單 ${fx}？\n\n之後這張單的製作狀態、出貨紀錄都會從廠務同步過來。`)) return;
  try{
    btnBusy('fx-link-existing-btn', true, '連結中…');
    const r = await apiCall({ action:'factoryLinkExisting', token:AUTH_TOKEN, quote_no:no, factory_order_no:fx });
    if(!r || !r.ok) throw new Error((r && r.error) || '連結失敗');
    toast(`已連結廠務訂單 ${fx}，正在把廠務狀態抓回來…`, 'ok');
    fxCloseLink();
    if(typeof loadOrders === 'function') await loadOrders(true).catch(() => {}); else await loadFactoryLinks(true);
    if(typeof loadShipmentBadges === 'function') loadShipmentBadges(true);
    // 複檢 0923：後端不再在連結時順便跑整個同步（10～30 秒會逾時、明明連好了卻顯示失敗）→ 這裡接著背景同步一次
    fxSyncNow(null, true);
  }catch(e){ toast(e.message || '連結失敗', 'err'); }
  finally{ btnBusy('fx-link-existing-btn', false); }
}
async function fxLinkCreateNew(){
  const no = FX_LINK_NO; fxCloseLink();
  const btn = document.getElementById('fx-push-' + no);
  return fxPushOrderDo(no, btn);
}
