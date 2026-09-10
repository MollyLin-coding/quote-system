/* ===================================================================
   13_factory.js —— 廠務／酒譜 APP 連結（2026-09-08）
   後端：gas/v5_factory.gs（factoryPushOrder／factorySync／getFactoryLinks／getFactoryMap／saveFactoryMap）
   決議（Molly 2026-09-08）：出貨以廠務為主；金流以報價系統為主、不同時只提示；
   轉單由她按「轉廠務訂單」；廠務同仁建的有金流訂單自動匯成草稿報價單；寄售先不碰。
   =================================================================== */
let FX_LINKS = null;            // { quote_no: link }
let FX_LAST_SYNC_AT = 0;        // 這個分頁上一次自動同步的時間（毫秒）
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
    if(typeof renderOrders === 'function') renderOrders();
  }catch(_){}
}
let FX_CONFIGURED = false;

/* 訂單列徽章：廠務狀態／Lot／金額不符 */
function fxBadges(o){
  const l = fxLinkOf(o.no); if(!l) return '';
  let h = '';
  const st = String(l.factory_status || '').trim();
  const lot = String(l.factory_lot || '').trim();
  const cls = st === '已出貨' ? 'info' : (st === '已完成' ? 'info' : (st === '製作中' ? 'warn' : ''));
  const tip = `廠務訂單 ${l.factory_order_no || ''}${l.last_sync ? '｜上次同步 ' + String(l.last_sync).slice(5, 16) : ''}`;
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
  const l = fxLinkOf(o.no);
  const linked = !!(l && l.factory_order_no);
  return `<button class="rec-act-btn" id="fx-push-${escAttr(o.no)}" data-no="${escAttr(o.no)}" onclick="fxPushOrder(this.dataset.no, this)" title="${linked ? '把報價系統這邊的品項／出貨日／金流再推一次到廠務訂單 ' + escAttr(l.factory_order_no) : '在廠務系統建一張訂單（客戶、酒款、數量、出貨日、金流、配送資訊都自動帶）'}">${linked ? '🏭 更新廠務訂單' : '🏭 轉廠務訂單'}</button>`;
}
async function fxPushOrder(no, btn){
  if(!AUTH_TOKEN){ toast('請先登入', 'err'); return; }
  const l = fxLinkOf(no);
  const linked = !!(l && l.factory_order_no);
  if(!linked){ fxOpenLinkDialog(no); return; }   // 未連結：先問「建新的」還是「連結廠務已有的」
  return fxPushOrderDo(no, btn);
}
async function fxPushOrderDo(no, btn){
  const l = fxLinkOf(no);
  const linked = !!(l && l.factory_order_no);
  const q = confirm(linked
    ? `要把報價單 ${no} 的最新內容（品項、數量、出貨日、金流、配送資訊）更新到廠務訂單 ${l.factory_order_no} 嗎？\n\n廠務那邊已完成的酒款狀態會保留。`
    : `要用報價單 ${no} 在廠務系統建立一張訂單嗎？\n\n客戶、酒款、數量、出貨日、金流、配送資訊都會自動帶過去；同仁會在廠務系統看到這張單。`);
  if(!q) return;
  try{
    btnBusy(btn, true, '傳送中…');
    const r = await apiCall({ action:'factoryPushOrder', token:AUTH_TOKEN, quote_no:no });
    if(!r || !r.ok) throw new Error((r && r.error) || '轉單失敗');
    toast(`${r.updated ? '已更新' : '已建立'}廠務訂單 ${r.factory_order_no}（客戶「${r.client}」，${r.items} 款）`, 'ok');
    await loadFactoryLinks(true);
  }catch(e){ toast(e.message || '轉單失敗', 'err'); }
  finally{ btnBusy(btn, false); }
}

/* 同步：廠務 → 報價系統（狀態／Lot／出貨紀錄／金流比對／同仁新建單匯入） */
async function fxSyncNow(btn, silent){
  if(!AUTH_TOKEN) return null;
  try{
    if(btn) btnBusy(btn, true, '同步中…');
    const r = await apiCall({ action:'factorySync', token:AUTH_TOKEN });
    if(!r || !r.ok) throw new Error((r && r.error) || '同步失敗');
    FX_LAST_SYNC_AT = Date.now();
    const parts = [];
    if(r.imported && r.imported.length) parts.push(`匯入廠務新訂單 ${r.imported.length} 張（${r.imported.map(x => x.quote_no + '／' + x.client).join('、')}）→ 已建成草稿報價單，請補單價確認`);
    if(r.mismatches && r.mismatches.length) parts.push(`⚠ ${r.mismatches.length} 張單金額與廠務不符（列上有紅色提示）`);
    if(r.shipChanged) parts.push(`出貨紀錄更新 ${r.shipChanged} 筆`);
    if(r.errors && r.errors.length) parts.push(`有 ${r.errors.length} 筆錯誤：` + r.errors.slice(0, 2).join('；'));
    if(!silent || parts.length) toast(parts.length ? parts.join('\n') : `已同步 ${r.synced} 張廠務訂單，沒有變化`, (r.errors && r.errors.length) ? 'err' : 'ok');
    // 有寫入就整批重抓（apiCall 非讀取 action 已把讀取快取清掉）
    if(typeof loadOrders === 'function') loadOrders(true).catch(() => {});
    else await loadFactoryLinks(true);
    if(typeof loadShipmentBadges === 'function') loadShipmentBadges(true);
    return r;
  }catch(e){ if(!silent) toast(e.message || '同步失敗', 'err'); return null; }
  finally{ if(btn) btnBusy(btn, false); }
}
/* 開訂單追蹤頁自動同步（10 分鐘內不重打；沒設定連結就不打） */
function fxAutoSync(){
  if(!AUTH_TOKEN || !FX_CONFIGURED) return;
  if(Date.now() - FX_LAST_SYNC_AT < FX_AUTO_SYNC_MS) return;
  FX_LAST_SYNC_AT = Date.now();   // 先佔住，避免同時多次
  setTimeout(() => { fxSyncNow(null, true); }, 1500);
}

/* ── 驗收單：從廠務出貨紀錄一鍵帶入 ──────────────────────── */
function fxVerifyBar(no){
  const body = document.getElementById('vf-body'); if(!body) return;
  const l = fxLinkOf(no); if(!l) return;
  const sj = fxParse(l.ship_json, null);
  const batches = (sj && sj.batches) || [];
  if(!batches.length) return;
  const opts = batches.map(b => `<option value="${b.seq}">第 ${b.seq} 次出貨 ${escHtml(b.date || '')}（${escHtml(b.lines.map(x => x.product + '×' + x.qty).join('、'))}）</option>`).join('');
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
  const rows = VERIFY_DATA.rows || [];
  const matchRow = (product) => {
    const k = key(product);
    let i = rows.findIndex(r => key(r.name) === k);
    if(i < 0) i = rows.findIndex(r => k.indexOf(key(r.name)) >= 0 || key(r.name).indexOf(k) >= 0);
    return i;
  };
  const thisQ = {}, prevQ = {}, unmatched = [];
  (sj.batches || []).forEach(bb => {
    (bb.lines || []).forEach(ln => {
      const i = matchRow(ln.product);
      if(i < 0){ if(Number(bb.seq) === seq) unmatched.push(ln.product); return; }
      if(Number(bb.seq) === seq) thisQ[i] = (thisQ[i] || 0) + (Number(ln.qty) || 0);
      else if(Number(bb.seq) < seq) prevQ[i] = (prevQ[i] || 0) + (Number(ln.qty) || 0);
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
    const pRows = map.filter(m => m.kind === 'product').map(m => `<tr><td style="padding:4px 6px"><input class="fx-map-pq" style="${inS}" value="${escAttr(m.qs_name)}"></td><td style="padding:4px 6px"><input class="fx-map-pf" style="${inS}" value="${escAttr(m.factory_name)}"></td></tr>`).join('');
    body.innerHTML = `
      <div style="font-size:12px;margin-bottom:10px;padding:8px 10px;border-radius:8px;background:${ping && ping.ok ? '#EEF6F2' : '#FDECEC'}">
        ${ping && ping.ok ? `✅ 廠務連線正常（${escHtml(ping.env || '')}，${escHtml(ping.time || '')}）` : `❌ 廠務連線失敗：${escHtml((ping && ping.error) || '未設定')}`}
      </div>
      <p style="font-size:12px;color:var(--hint);margin-bottom:8px;line-height:1.6">兩邊系統都用「名字」認客戶和酒款，名字不一樣就對不上。<b>沒填的＝兩邊同名</b>。廠務的客戶名可到廠務系統建單畫面的客戶下拉看（例：<code>OEM-Babyface</code>、<code>全客製-酒肉朋友</code>、<code>經銷商－島羽</code>，注意全形破折號）。</p>
      <div style="font-weight:600;font-size:13px;margin:8px 0 4px">客戶</div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:var(--gold-pale);color:var(--gold-deep)"><th style="padding:6px;text-align:left">報價系統客戶名</th><th style="padding:6px;text-align:left">廠務系統客戶名</th></tr></thead><tbody>${cRows || '<tr><td colspan="2" style="padding:8px;color:var(--hint)">客戶主檔是空的</td></tr>'}</tbody></table></div>
      <div style="font-weight:600;font-size:13px;margin:14px 0 4px">酒款（只有名字不同的才需要填；廠務系統名通常帶 V2）</div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px" id="fx-map-ptable"><thead><tr style="background:var(--gold-pale);color:var(--gold-deep)"><th style="padding:6px;text-align:left">報價單上的酒款名</th><th style="padding:6px;text-align:left">廠務系統酒款名</th></tr></thead><tbody id="fx-map-pbody">${pRows}</tbody></table></div>
      <button class="rec-act-btn" type="button" style="margin-top:6px" onclick="fxMapAddProduct()">＋ 加一列酒款對照</button>`;
  }catch(e){ body.innerHTML = `<div class="rec-empty">${escHtml(e.message || '讀取失敗')}</div>`; }
}
function fxMapAddProduct(){
  const tb = document.getElementById('fx-map-pbody'); if(!tb) return;
  const inS = 'border:1px solid var(--bd);border-radius:5px;padding:5px 7px;font-size:12px;font-family:inherit;width:100%';
  const tr = document.createElement('tr');
  tr.innerHTML = `<td style="padding:4px 6px"><input class="fx-map-pq" style="${inS}" placeholder="報價單上的酒款名"></td><td style="padding:4px 6px"><input class="fx-map-pf" style="${inS}" placeholder="廠務系統酒款名"></td>`;
  tb.appendChild(tr);
}
async function fxSaveMap(){
  const rows = [];
  document.querySelectorAll('#fx-map-body .fx-map-c').forEach(el => { rows.push({ kind:'client', qs_name:el.dataset.qs, factory_name:el.value.trim() }); });
  const pq = [...document.querySelectorAll('#fx-map-body .fx-map-pq')], pf = [...document.querySelectorAll('#fx-map-body .fx-map-pf')];
  pq.forEach((el, i) => { const q = el.value.trim(); if(q) rows.push({ kind:'product', qs_name:q, factory_name:(pf[i] ? pf[i].value.trim() : '') }); });
  try{
    btnBusy('fx-map-save', true, '儲存中…');
    const r = await apiCall({ action:'saveFactoryMap', token:AUTH_TOKEN, rows });
    if(!r || !r.ok) throw new Error((r && r.error) || '儲存失敗');
    toast(`對照已儲存（${r.saved} 筆）`, 'ok');
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
    toast(`已連結廠務訂單 ${fx}`, 'ok');
    fxCloseLink();
    if(typeof loadOrders === 'function') loadOrders(true).catch(() => {}); else loadFactoryLinks(true);
    if(typeof loadShipmentBadges === 'function') loadShipmentBadges(true);
  }catch(e){ toast(e.message || '連結失敗', 'err'); }
  finally{ btnBusy('fx-link-existing-btn', false); }
}
async function fxLinkCreateNew(){
  const no = FX_LINK_NO; fxCloseLink();
  const btn = document.getElementById('fx-push-' + no);
  return fxPushOrderDo(no, btn);
}
