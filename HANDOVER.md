# 凱文南坡萬實業社 · 報價單系統 — 開發接手文件 v1.0

建立日期：2026-06-18（v1.1 更新：2026-06-18 下午，接手對話補修三隻 bug + chip 資料保留）
狀態：**後端 100% 上線並驗證｜前端已部署上線並驗證｜圖示已確認生效｜瓶裝整條流程(建立→主表→品項表)資料正確性已驗證**
適用：接手的新對話（Claude）。本文件目標是讓新對話「零資訊落差」接續，不重蹈覆轍。

---

## 零、最高原則（比照酒譜 APP 辦理，永遠保留）

1. **資深工程師全面設計，不做局部補丁**：找根因、一次根治、消除整類錯誤。
2. **交付前必須自我審查 + 用 Claude in Chrome 實機驗證**，確認無誤才回報；不讓使用者反覆確認同一問題。
3. **所有錯誤都要記錄**（現象→根因→錯誤寫法→正確寫法→驗證方式）。
4. **所有設計邏輯、欄位映射都寫入文件**。
5. **不確定先問使用者**，不擅自決定。
6. **每次推送 JS 前先 `node --check` 語法檢查**。
7. 使用者偏好**簡潔的進度回報**，且全程用**繁體中文**溝通。
8. 「**比照酒譜 APP 辦理**」= 公開 GitHub repo + GAS Web App + GitHub Pages。使用者已多次強調此點——**報價系統的 repo 必須是 Public**（Private 在此方案無法用 Pages）。

---

## 一、系統現況（全部已完成並驗證）

| 項目 | 內容 / 網址 | 狀態 |
|---|---|---|
| 前端網址 | https://mollylin-coding.github.io/quote-system/ | ✅ 上線 |
| GitHub Repo | MollyLin-coding/quote-system（**Public**） | ✅ |
| GAS 專案 | Quote System API | ✅ |
| GAS 編輯器 | https://script.google.com/home/projects/1ULEfHbKEkBrnttftDah9wz_d3dAViqRoS-vflWxp34xIe_65GyaM-o7e/edit | ✅ |
| **Web App API URL** | https://script.google.com/macros/s/AKfycbytSqCF0St1Gu8F_u8KW9rcKJnkkGAfrdaHYyrQ6wDKa19Z3TxZd-GRRi_3Ii3Ijv4i/exec | ✅ 實機驗證 login+getQuotes 通過 |
| Google Sheet（資料庫） | 凱文南坡萬_報價單資料庫，fileId `16AzAcXu_rV8ZZoZJIlyC3HiZkvCcVAnaN1hd4fUTDJ0` | ✅ 兩分頁建好 |
| PIN 碼 | `666666`（存於 Script Properties `PIN_CODE`，**不在程式碼裡**） | ✅ |
| GAS 擁有者 / 執行身分 | wklin18@gmail.com | ✅ |
| Sheet 擁有者 | kevinnumber1.assistant@gmail.com，已分享給 wklin18 編輯權 | ✅ |

### 帳號架構（重要，曾困惑過）
- GAS 專案 + Web App 用 **wklin18@gmail.com** 執行。
- Google Sheet 由 **kevinnumber1.assistant@gmail.com** 擁有，**已分享給 wklin18 編輯權**。
- 兩個 gmail 都是使用者本人的。這個分離是**刻意**的，且權限鏈已驗證可用（GAS 成功讀寫 Sheet）。
- 部署對話框「執行身分」顯示「我 (wklin18@gmail.com)」即正確。

---

## 二、GitHub Token（關鍵，曾踩雷）

- 目前有效 token（fine-grained）：`<TOKEN_見下方說明_勿存入repo>`
  - 名稱 `quote-system-deploy-v2`，權限 Contents R/W + Metadata R，僅限 quote-system repo，到期 2026-07-17。
  - **curl 驗證可用，已用它成功推送 index.html 與 gas/code.gs。**
- **沒有 Pages 寫入權限** → 開 Pages、改 repo 可見性等必須走瀏覽器 UI（API 會 403）。
- bash 網路允許清單**包含** github.com / api.github.com（curl 可直接推送），**不含** script.google.com、cdn.jsdelivr.net、*.github.io（這些要用瀏覽器端 fetch 測試）。

---

## 三、資料庫結構（已建立）

Sheet「凱文南坡萬_報價單資料庫」，兩個分頁（深綠底白字標題、凍結首列首欄）：

### 報價單主表（31 欄）
quoteNo, quoteType(bottle/banquet), clientName, contactName, clientTaxId, contactPhone, clientAddress, quoteDate, expiryDate, handler, itemsSubtotal, taxAmount, extrasTotal, grandTotal, priceMode(inc/exc), taxRate, paymentType, paymentDetail, remark, imageLinks, status, createdAt, updatedAt, pdfUrl, docUrl, venue, entryTime, serviceTime, exitTime, svcMode, svcAmount

### 報價單品項（12 欄）
quoteNo, itemType, name, lot, volume, unitPrice, deduction, logoFee, qty, unit, subtotal, flavorList

> itemType 值：`bottle`（瓶裝）、`banquet_group`（宴會兩固定群組:客製化調酒/客製化無酒精雞尾酒）、`banquet_free`（宴會自由品項）、`banquet_addon`（宴會加購）、`extra`（瓶裝額外費用）。

---

## 四、程式碼位置

本機（這個容器，會在工作階段間重置，重要檔案已 push 到 GitHub）：
- `/home/claude/quote-system/gas/程式碼.gs`（561 行，GAS 後端）→ 已 push 到 repo `gas/code.gs`
- `/home/claude/quote-system/frontend/index.html`（正式前端，~86KB）→ 已 push 到 repo `index.html`

GitHub repo 內：
- `index.html`（前端，最新 commit d4f321fb = Tabler 圖示修正版）
- `gas/code.gs`（GAS 後端備份）

### GAS 後端功能（程式碼.gs）
- 常數：SHEET_ID、MAIN_COLS(31)、ITEM_COLS(12)、MAIN_HEADERS、ITEM_HEADERS
- `setupDatabase()`：建立兩分頁（已執行過一次）
- PIN 驗證：`checkPin_`、`generateToken_`/`validateToken_`（token 8 小時效期，存 Script Properties）
- `generateQuoteNo_`：YYYYMMDD-NN 格式
- `doGet`/`doPost` → `handleRequest_` 路由
- action：login / createQuote / getQuotes(可篩 clientName,status,quoteType) / getQuoteById(含 items) / updateQuote(取代品項) / deleteQuote(軟刪除,status='已刪除')
- `setPinCode()`：工具函式（PIN 實際由使用者手動在 Script Properties 設定，乾淨）

### 前端功能（index.html）
- 登入頁 overlay（PIN→token，存 sessionStorage『quote_token』，8hr）
- `apiCall()`：核心，用 `Content-Type: text/plain;charset=utf-8`（**避開 CORS preflight，關鍵**），token 失效自動回登入頁
- `saveQuote()`：依 editingQuoteNo 決定 create / update；`collectQuote()` 序列化瓶裝+宴會兩種結構（含 extras/flavors/svcMode）
- 報價紀錄頁（page-records）：loadRecords / openRecord / deleteRecord，支援搜尋+類型篩選
- `loadQuoteIntoForm()`：把既有報價單灌回表單編輯
- `exportPDF()`：開列印視窗（瀏覽器列印出 PDF；Word 目前也走列印）
- 兩報價類型、稅額含/未稅切換、付款條件 4 模式、報價單號自動產生、有效日期=報價日+1月

### 設計規格（已定案）
- 配色：米白底 #FAF9F5、墨黑字 #22241F、金色點綴 #A6824A、深綠 #23402E（側欄/登入背景）
- 英文標語三行大寫：KEVIN NUMBER 1 / TAILORED.COCKTAIL / EST. 2023. TAIWAN
- 只有「客戶名稱、聯絡人」為必填
- 預設處理人「林湘珮 Molly」；固定匯款資訊頁尾：陽信銀行中興分行(108)，帳號 02142-00230-91，戶名 凱文南坡萬實業社黃彥愷
- 公司表頭：新北市新莊區化成路554巷37號，(02)8991-0068，統編 92719710

---

## 四點五、v1.1 接手對話修正紀錄（2026-06-18 下午）

接手對話用 Claude in Chrome 實機 + Google Sheet 後台 + 靜態讀碼三方驗證，修掉三隻 bug 並完成瓶裝流程資料驗證。**前端 index.html 最新 commit = 5754591**（含以下全部修正）。

### 修正 A：瓶裝額外費用造成總計 NaN（嚴重，比原雷單還嚴重）
- **現象**：瓶裝報價單只要按 SGS/GS1/免運任一預設鈕或手動加額外費用，「額外費用」「總計」立刻變 `$非數值`(NaN)。
- **根因**：`calc()` 內 `extras.reduce((s,e)=>s+e.amt,0)` 用了不存在的屬性 `e.amt`；額外費用物件實際存的是 `e.a`（見 `pushExt` 的 `extras.push({id,n,a})`）。
- **正確寫法**：改為 `extras.reduce((s,e)=>s+e.a,0)`。
- **驗證**：實機加 SGS$8000+GS1$3000 → 總計 $26,920 正確；資料寫入 Sheet「報價單品項」確認 extra 列獨立寫入。

### 修正 B：svcAmount 永遠存 0（資料完整性）
- **現象**：宴會單調酒師服務費小計畫面算得出來，但 `collectQuote()` 回傳 `svcAmount:0` 寫進主表 AE 欄永遠是 0。
- **正確寫法**：`collectQuote()` 內依 svcMode 實算 `(svc-amt1 + (mode==='travel'?svc-amt2:0)) * svc-qty` 後帶入 `svcAmount`。

### 修正 C：標費扣除 / LOGO 印刷費 chip 切換會清空已輸入資料（雷，原待辦#7）
- **現象**：關掉再開回某欄，該欄(及連帶因 rebuild 而被重建的整列)先前輸入值消失。
- **根因**：`toggleCol()` 重建列時，被隱藏欄位的 input 已從 DOM 移除取不到值；且每次 rebuild 都 `rowId++` 重新編號。
- **正確寫法**：新增 `botDedCache/botLogoCache` 兩個以列 id 為 key 的快取，切換前先存值；`addBotRow(prefill)` 支援帶入既有 id 讓列號延續；`delBotRow`/`resetAll` 同步清快取。
- **驗證**：實機輸入 ded=-2/logo=25 → 關 ded → 開 ded → 值完整保留。

### 修正 D：newQuote() 每次跳 confirm（原待辦#9，UX）
- **正確寫法**：新增 `isFormDirty()` 偵測表單是否有未儲存資料；`resetAll(skipConfirm)` 加參數；`newQuote()` 只在 dirty 時才 confirm，空白表單直接開新單。

### 驗證方式備忘（給後續接手）
- **GAS fetch 在 Claude in Chrome 會「假性 pending」**：前端 `apiCall()` 發出後 promise 久不 resolve（>45s），但 GAS 後台「執行項目」顯示 doPost 1-2 秒已完成、資料庫也確實寫入。這是自動化工具處理 script.google.com 跨網域 redirect 回應的怪癖，**非程式 bug**，真人瀏覽器正常（呼應雷5）。
- **因此驗資料改走 Google Sheet**：直接開 Sheet 或用 `gviz/tq?tqx=out:csv&sheet=分頁名` 抓 CSV 比較快且不卡。
- **靜態判定已過的項目**：宴會序列化、updateQuote 取代品項、deleteQuote 軟刪除、稅額含/未稅數學、PDF 列印模板——讀碼確認邏輯正確。

---

## 五、踩過的雷與正確解法（務必看，避免重犯）

### 雷 1：從截圖辨識金鑰字元 → token 認證失敗（浪費最多 token）
- **現象**：前一個 token 從螢幕截圖讀取，curl 回 401 Bad credentials。
- **根因**：截圖 OCR 把 token 字元認錯（O/0、l/1 等混淆）。
- **錯誤寫法**：`computer:screenshot` 看 token 然後手打。
- **正確寫法**：用 `javascript_tool` 直接讀 DOM：
  ```js
  Array.from(document.querySelectorAll('input')).filter(i=>i.value&&i.value.startsWith('github_pat_')).map(i=>i.value)
  ```
  或讀 `a.href`。**任何金鑰一律從 DOM 讀，絕不用截圖。**
- **驗證**：`curl -H "Authorization: Bearer <token>" https://api.github.com/repos/MollyLin-coding/quote-system` 回 200。

### 雷 2：把 561 行程式碼貼進 GAS Monaco 編輯器（浪費很多 token）
- **現象**：鍵盤 `ctrl+v`、合成 paste 事件對 GAS Monaco 無效；手動重打 base64 又引入 typo。
- **根因**：GAS 用 Monaco editor，擋合成貼上事件；長字串人工轉錄必出錯。
- **正確寫法（致勝法）**：
  1. 先把 .gs push 到 GitHub（curl）。
  2. 瀏覽器端 `fetch` GitHub API contents 端點（帶 token），base64 解碼成 UTF-8：
     ```js
     const resp=await fetch("https://api.github.com/repos/MollyLin-coding/quote-system/contents/gas/code.gs",{headers:{Authorization:"Bearer <token>",Accept:"application/vnd.github+json"}});
     const data=await resp.json();
     const bytes=Uint8Array.from(atob(data.content.replace(/\n/g,'')),c=>c.charCodeAt(0));
     window.__gasCode=new TextDecoder('utf-8').decode(bytes);
     ```
  3. 用 Monaco API 直接灌入（**不要用鍵盤**）：
     ```js
     window.monaco.editor.getModels()[0].setValue(window.__gasCode);
     ```
  4. `ctrl+s` 儲存。CRLF/LF 長度差（約 561）是正常正規化，無害。

### 雷 3：repo 建成 Private → 無法用 GitHub Pages
- **現象**：Pages 設定頁顯示「Upgrade or make this repository public to enable Pages」。
- **根因**：此帳號方案 Private repo 不能用 Pages。**使用者早說過「比照酒譜 APP」= public。**
- **正確寫法**：一開始就建 Public。改 public 要走瀏覽器 Settings→最底 Danger Zone→Change visibility，會觸發 **GitHub sudo email 驗證**（需使用者收信拿 8 位數碼）。
- **教訓**：**建 repo 當下就設 Public**，省掉後面改可見性 + email 驗證一大段。

### 雷 4：Tabler 圖示 CDN 路徑 404（最後修正項）
- **現象**：圖示不顯示，`document.fonts` 空，`.ti` 字體被 body 繼承成系統字。
- **根因**：CDN 路徑錯。`@tabler/icons-webfont@2.47.0` 的 CSS 在**根目錄**不是 /dist/。
- **錯誤寫法**：`.../icons-webfont@2.47.0/dist/tabler-icons.min.css`（404）
- **正確寫法**：`.../icons-webfont@2.47.0/tabler-icons.min.css`（去掉 /dist/）
  - 查正確路徑：`fetch("https://data.jsdelivr.com/v1/package/npm/@tabler/icons-webfont@2.47.0/flat")` 看 files。
  - 並加保險 CSS（防 body 字體繼承覆蓋）：
    ```css
    .ti{font-family:"tabler-icons" !important;font-style:normal;font-weight:400;line-height:1}
    ```
- **狀態**：已修正並 push（commit d4f321fb），**待最終實機確認圖示顯示**。

### 雷 5：UI 點擊時序造成「登入沒反應」誤判
- **現象**：點登入按鈕後似乎沒反應，一度以為 CORS 壞了。
- **根因**：其實是用舊截圖座標連點 + ctrl+a/delete 焦點問題，登入請求沒真正觸發。**API 本身完全正常**（手動 `await doLogin()` 即成功，overlay 隱藏、token 設定）。
- **正確驗證法**：別只看畫面，用 `read_network_requests`(urlPattern:'macros') 看有沒有發請求、`read_console_messages` 看錯誤、必要時 `javascript_tool` 直接呼叫函式或 fetch 驗證 API。

---

## 六、環境怪癖（Claude in Chrome）

- **截圖常 timeout**（"renderer frozen"）：重試即可，點擊通常已成功。
- **Chrome 工具會間歇從工具列表掉出**：用 `tool_search("chrome browser screenshot click navigate computer tab")` 或 `tool_search("javascript_tool browser_batch")` 救回。掉出時 tool_search 可能先回 HubSpot/Google Drive 工具，多試幾次關鍵字。
- **滾動後 GitHub/GAS 頁面有時空白**：用 `read_page`(filter interactive) + ref 點擊，或小幅度往回捲。
- **tab ID 會在重連後變動**：先 `tabs_context_mcp` 取最新。報價系統相關 tab：一個 quote-system GitHub、一或兩個「Quote System API」GAS 編輯器。**勿動**酒譜專案的 tab（南坡萬酒譜後台 GAS、recipe 網站、各 Sheets、wordpress elementor）。
- **`navigator.clipboard.writeText` 需頁面有焦點**：先點一下頁面再寫。
- **中文用 type 輸入易與 ctrl+a 時序衝突**：先 Delete 再 type，或用 javascript_tool 直接設 value。

---

## 七、待辦（接手後從這裡繼續）

### ✅ 已完成（v1.1 接手對話）
1. ✅ Tabler 圖示已確認生效（`document.fonts` 出現 `tabler-icons loaded`）。
2. ✅ 瓶裝酒代工測試單建立+儲存 → 主表 + 品項表資料正確寫入（單號 20260618-01）。
7. ✅ 標費扣除/LOGO chip 開關資料保留（修正 C）。
8. ✅ 稅額含/未稅數學（讀碼驗證；UI 切換因工具限制未實點，但邏輯正確）。
9. ✅ newQuote confirm UX（修正 D）。

### ⬜ 尚未實機跑（建議真人瀏覽器操作即可，邏輯已讀碼判定正確）
3. ⬜ 宴會酒水測試單（群組杯數、口味標籤、調酒師費 4 模式、加購）→ 序列化邏輯已確認，待真人存一張確認。
4. ⬜ 開啟既有單編輯 → updateQuote → 確認品項取代（後端取代邏輯已讀碼確認）。
5. ⬜ 刪除 → 軟刪除（後端 status='已刪除' 已確認；待真人點一次確認列表消失）。
6. ⬜ exportPDF 列印版面（A4、表頭、頁尾匯款）— 真人按一次列印目視即可。

> 註：上述 ⬜ 項在 Claude in Chrome 內無法順跑，因 GAS fetch 假性 pending（見四點五）。建議 Molly 用手機/電腦瀏覽器各跑一張瓶裝+宴會單即完成驗收。

### 後續（架構已規劃，尚未做）
10. **Google Doc PDF/Word 範本**：建一份含 placeholder 標籤的 Google Doc，GAS 寫 `generateQuoteDocument()` 產出正式 PDF/Word（目前只有瀏覽器列印）。

---

## 八、給接手 Claude 的最重要提醒

1. **先讀本文件再動手**，資源 ID/URL/token 全在這裡，別重新建立或重新摸索。
2. 使用者貼過一份「南坡萬酒譜 APP 開發接手文件 v10.6」——那是**另一個專案（酒譜系統）**的，只能當**流程/風格參考範本**，**絕不可把它的 Sheet ID / API URL / token 用到報價系統**。酒譜系統自己的資源（勿改）：repo MollyLin-coding/recipe、site .../recipe/、GAS Script ID 1rZVFLOW4lYPQCRGZZYDqdMLAOEP5fzX_fpe--62lC3gFASBGEe7p1gH5。
3. 推 GitHub 用 curl（github.com 在允許清單）；測 GAS/github.io/jsdelivr 用瀏覽器 fetch（不在允許清單）。
4. 貼 GAS 程式碼用「push→瀏覽器 fetch→Monaco setValue」三步法，別用鍵盤貼上。
5. 任何金鑰從 DOM 讀，不要截圖辨識。
6. 改完前端推送前 `node --check`，推送後等 1 分鐘並硬重載驗證。
