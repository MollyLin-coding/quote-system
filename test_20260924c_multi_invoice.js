/* 2026-09-24 Molly：「訂單追蹤裡的發票紀錄有時不會只有開立一張發票」→ 選「讓一張訂單能記錄多張發票」。
   ①「編輯進度」上原本的發票號碼/日期/末五碼/明細/照片維持不動＝發票①（效期推進、今日待辦、月報表都繼續讀那幾欄）
   ②新增「其他發票（不只一張時才用）」子表——跟分批出貨（shp*）同一套寫法：加/存/刪一張各自的號碼/日期/末五碼/明細/照片連結
   ③ listInvoices 是純讀取，要在 RC_READ_ACTIONS 白名單，開一次不會把整站快取洗光
   ④ addInvoice/updateInvoice/deleteInvoice 才是寫入，會清快取（沿用 apiCall 既有規則，不用另外測） */
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('file://' + path.join(__dirname, 'index.html'));
  await p.waitForTimeout(600);
  const r = await p.evaluate(async () => {
    const out = {};
    AUTH_TOKEN = 'x';
    ORDERS_CACHE = [{ no: '20260901-01', client: '測試客戶', total: 10000,
      st: { status: 'shipped', invoice_no: 'AB12345678', invoice_date: '2026-09-01', updated_at: '2026-09-01T00:00:00Z' } }];

    const calls = [];
    const origApi = window.apiCall;
    window.apiCall = async (p) => {
      calls.push(p);
      if (p.action === 'listInvoices') return { ok: true, invoices: [
        { id: 'INV-1', quote_no: '20260901-01', seq: 2, invoice_no: 'AB99999999', invoice_date: '2026-09-05', invoice_last5: '54321', invoice_detail: '追加訂單', photos: '' }
      ] };
      if (p.action === 'addInvoice') return { ok: true, id: 'INV-NEW' };
      if (p.action === 'updateInvoice') return { ok: true, id: p.id };
      if (p.action === 'deleteInvoice') return { ok: true, id: p.id };
      return { ok: true };
    };

    // 開單：發票①欄位照舊帶入，「其他發票」重置為收合／未載入
    openOrdEdit('20260901-01');
    out.inv1 = document.getElementById('oe-invoice_no').value;
    out.toggleTextClosed = document.getElementById('inv-toggle').textContent;
    out.boxHiddenOnOpen = document.getElementById('inv-box').style.display === 'none';

    // 展開 → 應該打 listInvoices、渲染出既有那一張
    await invToggle();
    out.toggleTextOpen = document.getElementById('inv-toggle').textContent;
    out.listInvoicesCalled = calls.some(c => c.action === 'listInvoices' && c.quote_no === '20260901-01');
    out.rowCount = document.querySelectorAll('#inv-body tr[data-invid]').length;
    out.row1No = document.querySelector('#inv-body tr[data-invid="INV-1"] input[data-f="invoice_no"]').value;
    out.row1Seq = document.querySelector('#inv-body tr[data-invid="INV-1"] td').textContent.trim();

    // rcIsRead 白名單：listInvoices 是純讀取
    out.rcIsReadListInvoices = rcIsRead('listInvoices');

    // 新增一列 → 存空白列應該擋下（不送出）
    invAddRow();
    out.newRowExists = !!document.querySelector('#inv-body tr[data-invid=""]');
    const newTr = document.querySelector('#inv-body tr[data-invid=""]');
    const saveBtn = newTr.querySelector('button.rec-act-btn:not(.del)');
    await invSaveRow(saveBtn);
    out.emptySaveBlocked = !calls.some(c => c.action === 'addInvoice');

    // 填末五碼但格式錯 → 也擋下
    newTr.querySelector('input[data-f="invoice_no"]').value = 'CD11111111';
    newTr.querySelector('input[data-f="invoice_last5"]').value = 'abc12';
    await invSaveRow(saveBtn);
    out.badLast5Blocked = !calls.some(c => c.action === 'addInvoice');

    // 填對的資料 → 送出 addInvoice
    newTr.querySelector('input[data-f="invoice_last5"]').value = '11111';
    newTr.querySelector('input[data-f="invoice_detail"]').value = '第三張';
    await invSaveRow(saveBtn);
    const addCall = calls.find(c => c.action === 'addInvoice');
    out.addCalled = !!addCall;
    out.addQuoteNo = addCall && addCall.quote_no;
    out.addFieldsNo = addCall && addCall.fields && addCall.fields.invoice_no;

    // 刪除既有那一張（INV-1）→ deleteInvoice
    const delBtn = document.querySelector('#inv-body tr[data-invid="INV-1"] button.del');
    window.confirm = () => true;
    await invDelRow(delBtn);
    const delCall = calls.find(c => c.action === 'deleteInvoice');
    out.delCalled = !!delCall;
    out.delId = delCall && delCall.id;

    // 關窗重開：其他發票要重置回收合／未載入（不會殘留上一張單的展開狀態或資料）
    closeOrdEdit(true);
    openOrdEdit('20260901-01');
    out.reopenClosed = document.getElementById('inv-box').style.display === 'none';
    out.reopenToggleText = document.getElementById('inv-toggle').textContent;

    window.apiCall = origApi;
    return out;
  });
  const T = [];
  const c = (n, ok, info) => T.push({ n, ok: !!ok, info });
  c('開單：發票①欄位（oe-invoice_no）照舊帶入', r.inv1 === 'AB12345678', r.inv1);
  c('開單：其他發票預設收合', r.boxHiddenOnOpen && r.toggleTextClosed.includes('▸'), r.toggleTextClosed);
  c('展開後按鈕文字變▾', r.toggleTextOpen.includes('▾'), r.toggleTextOpen);
  c('展開會打 listInvoices(quote_no)', r.listInvoicesCalled);
  c('listInvoices 在 RC_READ_ACTIONS 白名單（純讀取不洗快取）', r.rcIsReadListInvoices);
  c('既有一張正確渲染（第②張）', r.rowCount === 1 && r.row1No === 'AB99999999' && r.row1Seq === '2', JSON.stringify(r));
  c('新增列：空白列存檔被擋下', r.newRowExists && r.emptySaveBlocked);
  c('末五碼格式錯被擋下', r.badLast5Blocked);
  c('資料正確 → 送出 addInvoice(quote_no, fields.invoice_no)', r.addCalled && r.addQuoteNo === '20260901-01' && r.addFieldsNo === 'CD11111111', JSON.stringify(r));
  c('刪除送出 deleteInvoice(id)', r.delCalled && r.delId === 'INV-1', JSON.stringify(r));
  c('關窗重開：其他發票重置為收合', r.reopenClosed && r.reopenToggleText.includes('▸'), r.reopenToggleText);
  c('無 pageerror', errs.length === 0, errs.join(' | '));
  await b.close();
  let pass = 0; T.forEach(x => { console.log((x.ok ? '✅ ' : '❌ ') + x.n + (x.ok ? '' : '  → ' + (x.info || ''))); if (x.ok) pass++; });
  console.log(`\n${pass}/${T.length} 通過`); process.exit(pass === T.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
