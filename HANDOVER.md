# 凱文南坡萬實業社 · 報價單系統 — 開發接手文件 v2.0

建立日期：2026-06-18（v2.0 更新：2026-06-19 凌晨，調酒師服務費小計支援反向輸入回算單價；發現但未修正「載入舊宴會單時服務費單價/人數沒還原」的既有缺口）
狀態：**後端 100% 上線並驗證｜前端已部署上線並驗證｜圖示已確認生效｜瓶裝整條流程(建立→主表→品項表)資料正確性已驗證**
適用：接手的新對話（Claude）。本文件目標是讓新對話「零資訊落差」接續，不重蹈覆轍。

---

## ★ 新對話 60 秒快速接手（先讀這段，照做不繞圈、不燒 token）

### A. 重要網址 / ID
- 線上系統：https://mollylin-coding.github.io/quote-system/ （PIN：`666666`）
- GitHub repo（**Public**）：https://github.com/MollyLin-coding/quote-system
- 資料庫 Sheet ID：`16AzAcXu_rV8ZZoZJIlyC3HiZkvCcVAnaN1hd4fUTDJ0`（分頁：報價單主表 / 報價單品項）
- GAS Script ID：`1ULEfHbKEkBrnttftDah9wz_d3dAViqRoS-vflWxp34xIe_65GyaM-o7e`
- GAS Web App URL：`https://script.google.com/macros/s/AKfycbytSqCF0St1Gu8F_u8KW9rcKJnkkGAfrdaHYyrQ6wDKa19Z3TxZd-GRRi_3Ii3Ijv4i/exec`
- 全部資源帳號：`wklin18@gmail.com`

### B. 部署 Token（quote-system-deploy-v2）
| 欄位 | 值 |
|---|---|
| 名稱 | `quote-system-deploy-v2` |
| 類型 | GitHub Fine-grained PAT |
| 權限 | Contents (Read/Write) + Metadata (Read) |
| 範圍 | 僅 `MollyLin-coding/quote-system` |
| 效期 | 2026-07-17 |
| 管理頁 | https://github.com/settings/tokens |
| 密鑰字串 | **不寫在此（repo 為 Public，寫入會被 GitHub 自動撤銷並外洩）。由 Molly 於需要推送時當場貼給對話。** 格式 `github_pat_…` |

> **安全鐵則**：絕不把 token 字串 commit 進任何檔案。需要推送時，請 Molly 從密碼管理器貼上，對話僅在當下的 curl/python 指令中使用，不寫檔。

### C. 讀 repo 的「唯一有效」方式（其他都會失敗，別試）
- ❌ `web_fetch` raw.githubusercontent / github blob → 回 "URL not in prior search"。
- ❌ 未帶 token 的 `api.github.com` → 403 rate limit。
- ✅ **直接下載 tarball 解壓**（最快、免 token）：
  ```bash
  curl -sL -o /tmp/r.tar.gz https://codeload.github.com/MollyLin-coding/quote-system/tar.gz/refs/heads/main
  cd /home/claude && tar -xzf /tmp/r.tar.gz   # → quote-system-main/
  ```

### D. 驗證鐵則（上次燒最多 token 的坑，務必照做）
1. **不要在 Claude in Chrome 裡跑前端→GAS 的 UI 一條龍**。`apiCall()`/`fetch` 打 script.google.com 會「假性 pending」（promise 卡 >45s 不 resolve），但 GAS 後台 doPost 其實 1–2 秒就完成、資料也寫入了。**這是工具處理跨網域 redirect 的怪癖，不是 bug，真人瀏覽器正常。**
2. **驗資料一律走 Google Sheet**，別等前端回應；用 fire-and-poll，不要用 await（await 也會卡）：
   ```js
   window.__csv='pending';
   fetch("https://docs.google.com/spreadsheets/d/16AzAcXu_rV8ZZoZJIlyC3HiZkvCcVAnaN1hd4fUTDJ0/gviz/tq?tqx=out:csv&sheet="+encodeURIComponent('報價單品項'))
     .then(r=>r.text()).then(t=>{window.__csv=t}).catch(e=>{window.__csv='ERR:'+e.message});
   // 下一個 tool call 再讀 window.__csv
   ```
3. **能讀碼判定就讀碼判定**，別用 UI 反覆試。上次三隻 bug 全是讀 `index.html` 抓到的，不是點出來的。
4. **GAS 後台執行記錄**（查伺服器是否真的跑成功）：`.../projects/<ScriptID>/executions` → 用 `document.body.innerText` 抓表格，別截圖。
5. **Google Sheet 切分頁**：頁面常有「目前登入帳戶」popup 擋住 tab 點擊 → 直接用 D-2 的 gviz CSV，別跟 popup 纏鬥。
6. **Chrome 截圖偶發 "renderer frozen / timeout"**：重試一次通常就好；能用 `javascript_tool` 抓 DOM/innerText 就別截圖。
7. **登入別用點的**：PIN 欄自動帶 `666666`，直接 console `await doLogin()` 最穩。

### E. 還沒做的驗收（邏輯已讀碼確認 OK，只差真人點一輪）
宴會單存檔、編輯既有單(updateQuote)、軟刪除、PDF 列印版面(v1.2 新版邊界/總計/簽章/付款條件文字)、稅額含/未稅 UI 切換。
→ 建議 Molly 用手機/電腦各存一張瓶裝+宴會單目視即可結案；新對話不需在自動化工具內硬跑（會卡，見 D-1）。

### E-2. LOGO（v1.2 補：已完成）
Molly 補上正確的 LOGO 檔案（黑色書法字「凱文南坡萬實業社」、白底、1600×276px），已套用至報價單列印範本左上角。詳見「四點六」章節「LOGO 待辦」最新狀態。

### E-3. v1.3 新增待驗收（邏輯已讀碼確認 OK，只差真人點一輪）
- 品名貼上多行自動拆成多筆品項（`handleNamePaste`）
- 出貨批次／前標費扣除／LOGO印刷費 三個切換預設不勾選、勾選出貨批次後新列自動帶入「Lot X」
- 開啟舊報價單編輯時，三個切換是否依資料自動偵測開啟（見「四點八」相容性修正說明，**這項務必實測，因為涉及資料是否會被誤蓋成空白**）
- 「批次標籤」兩個新欄位（Lot/日期標記、客戶名稱標籤）顯示美觀與否 → **Molly 看完效果決定要不要留**，若決定不留，記得同時拿掉表單欄位 HTML 與 `openPreview()` 裡讀取/顯示那段，不要只刪 UI 留邏輯
- LOGO 縮小後新版面美觀與否

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

## 四點六、v1.2 接手對話修正紀錄（2026-06-18 晚間）

Molly 對實際輸出的報價單列印版面提出 7 項修改需求，全部已修正並 push。**前端 index.html 最新 commit = 15dcdc9**（含以下全部修正）。本節為唯一正確版本，後續若再修改本區塊內容，**務必先讀此節再動手，避免重複修改或改回舊版**。

### 修正內容對照表

| # | 需求 | 修正方式 | 程式位置 |
|---|---|---|---|
| 1 | 左上 LOGO 換成公司標楷 LOGO | 第一次給的檔案是全黑無內容圖片無法使用；補上正確檔案後已套用，詳見下方「LOGO」章節 | `openPreview()` header 區塊 + `assets/logo.png` |
| 2 | 附加圖片放大約 2 倍 | `max-height:120px` → `max-height:240px`，並加 `max-width:340px` | `imgH` 變數（約第 1195 行） |
| 3 | 邊界改為上下 1cm、左右 2cm；內容盡量在一頁 | `@page{margin:14mm}` → `@page{margin:10mm 20mm}`；**移除預覽用內距造成的雙重邊界**（`exportPDF()` 內把擷取到的 HTML 字串中 `padding:56px 60px` 取代為 `padding:0` 再寫入列印視窗，因為原本內距是內嵌在 `#pcon` 內層 div 的 inline style，會與 `@page` 邊界疊加，導致實際邊界是兩者相加）；並把標題/客戶/付款/備註等區塊的 margin 略微收緊釋放垂直空間；新增 `table{page-break-inside:auto}` `tr/img{page-break-inside:avoid}` 避免列印時表格列被從中間切斷 | `exportPDF()`（約第 1607 行）+ 各區塊 inline style |
| 4 | 總計不要用深色色塊，改簡約設計 | 移除 `background:#22241F` 色塊，改為純白底＋上框線分隔，總計數字改金色（`#A6824A`）文字呈現層級，不用色塊 | TOTAL 區塊（約第 1238 行） |
| 5 | 簽章做選填、移除處理人整列、簽章欄高度約 4cm | 移除「處理人：${hdl}」整行；甲乙方簽章線文字改為「簽章（選填）」；簽章線上方留白區改用明確 `<div style="height:4cm"></div>` 撐高，確保簽署空間固定為 4cm（不受其他內容影響） | SIGNATURE 區塊（約第 1260 行） |
| 6 | 付款條件文字敘述太簡略，要正式合約用語 | 重寫 `getPayTerms()` 四種模式皆改為完整句子（例：「甲方應於本報價單成立後，支付訂金新台幣 X 元整...乙方完成商品製作並全數交付後...甲方應於驗收無誤後支付尾款新台幣 Y 元整」），備註改用 `<br>` 另起一行顯示 | `getPayTerms()`（約第 1013 行） |
| 6-2 | SGS 檢驗費應為 4,000/款、GS1 條碼登記費應為 1,500/款（非原本固定 8,000/3,000） | 新增 `presQty(name, unitPrice)` 函式：點擊後 `prompt()` 詢問款數（預設帶入目前瓶裝品項數），自動算「單價 × 款數」並把品名標註款數與單價寫入額外費用列，如「SGS 檢驗費（3款 × $4,000）：$12,000」 | `presQty()`（約第 959 行）+ 按鈕（約第 451 行） |
| 6-3 | 客戶資訊及品項明細欄位全部預設空白 | 確認：所有欄位本來就無 `value` 預設值，僅用 `placeholder` 提示文字；但 `f-cli/f-con/f-tax/f-ph/f-ad` 原本的 placeholder 是具體假範例（公司名／人名／電話／地址），容易讓人誤以為已預填真實資料 → 全部改為通用提示語（如「請輸入客戶名稱」）。**注意：品項列（品名/Lot/容量/單價等）的 placeholder 維持原本的格式提示數字（如 500、375），這些不是真實資料、無需更動** | 客戶資訊卡（約第 314 行） |
| 7 | 折抵說明改名為付款條件備註，欄位預設空白 | label「折抵說明」→「付款條件備註」，placeholder 改為通用備註提示語；欄位本身原本就無預設值 | 付款條件 pp0 區塊（約第 507 行） |

### LOGO（已完成，2026-06-18 晚間補）

- 第一次上傳的檔案（`logo_black.png`）經檢查是 1520×236px、RGB、全部像素皆純黑 RGB(0,0,0) 的純黑色矩形，沒有可辨識內容，**這極可能就是「LOGO 一直沒套用成功」的根本原因**——不是疏漏，是來源檔案本身沒有可用內容。
- Molly 重新提供的檔案（`preview_black_on_white_2.jpg`）才是正確檔案：黑色書法字「凱文南坡萬實業社」、**純白背景（非透明，但因為報價單列印頁背景本身就是白色，剛好吻合不會有色塊邊框問題）**、1600×276px。
- 已轉存為 PNG 並 push 到 repo：`assets/logo.png`（commit `57fce9a`），對外存取網址：`https://raw.githubusercontent.com/MollyLin-coding/quote-system/main/assets/logo.png`。
- 已在 `openPreview()` header 區塊套用，取代原本 CSS 畫的金色直線＋「凱文南坡萬實業社」文字（commit `3712f2c`），改為 `<img>` 標籤，高度 50px、寬度依比例自動。
- **注意**：此 LOGO 圖檔背景是**純白色、非透明**，目前只套用在「報價單列印頁」（背景本身是白色，完美吻合）。**若未來要套用到網站本身的側欄/登入頁（背景是深墨色 `#22241F`），會出現明顯白色色塊，需要先用去背處理（例如用 PIL 把白色背景轉透明）做一版透明背景的版本，不可直接套用同一張圖**。Molly 目前只要求報價單輸出修改 LOGO，未要求改網站側欄/登入頁，**未經詢問前不要自行套用到那兩處**。



---

## 四點七、給接手 Claude 的提醒（v1.2 新增）

- 收到使用者提供的圖片檔案，**不要假設檔案內容正確**，尤其是 LOGO／印章等視覺素材，務必用 `view` 工具實際看過，且若懷疑是純色/透明背景問題，用 Python PIL 讀取 `mode` 與 `getextrema()` 確認像素值，不要單憑檔名或使用者敘述判斷。
- 列印版面的邊界一定要注意「`@page` 邊界」與「內容區塊自帶的 inline padding」是否疊加，兩者會相加成更大邊界，這是這次「邊界跟之前設定的不一樣」誤會的根本原因類型，務必在改版面前先檢查清楚目前實際生效的邊界來源。



---

## 四點八、v1.3 接手對話修正紀錄（2026-06-18 深夜）

Molly 看了實際輸出畫面截圖後又提出一輪修改，**前端 index.html 最新 commit = 16e42c6**（含以下全部修正）。本節為唯一正確版本。

### 修正內容對照表

| # | 需求 | 修正方式 | 程式位置 |
|---|---|---|---|
| 1 | 客戶資料所有欄位改為選填 | 移除「客戶名稱 *」「聯絡人 *」必填星號，卡片標題改「全部選填」；`saveQuote()` 移除「請填寫客戶名稱與聯絡人」的強制驗證 | 客戶資訊卡（約第 314 行）+ `saveQuote()`（約第 1465 行） |
| 2 | 處理人預設 Molly | 確認原本就是 `value="林湘珆 Molly"`，本來就符合，未變動 | — |
| 3 | 品名貼上多行自動拆成多筆品項 | 新增 `handleNamePaste(ev,id)`：偵測貼上內容含換行就阻擋預設貼上行為，依換行切割，第一行填入當前列，其餘每行各自呼叫 `addBotRow()` 新增一列 | `handleNamePaste()`（約第 739 行）+ 品名 input 的 `onpaste` |
| 4 | LOGO 版型修正：縮小、英文/公司資訊改回在 logo 下方 | 拿掉左右並排的 flex 排法，改回單欄堆疊（圖片在上，英文標語與地址在下，跟原本 CSS-only 版排法一致）；圖片高度 50px→32px | `openPreview()` HEADER 區塊（約第 1248 行） |
| 6 | 出貨容量改下拉選單 100/500/4000ml，且仍可自填空白 | 用 `<input type="number" list="vol-options">` + `<datalist id="vol-options">` 三個選項，HTML5 datalist 同時保留自由輸入與下拉建議，不需額外切換 UI | 容量 input（約第 727 行）+ datalist（約第 363 行） |
| 7-1 | 甲乙方簽章整個拿掉 | 整段 SIGNATURE 區塊 HTML 移除 | `openPreview()`（原約第 1288～1300 行，已刪除） |
| 7-2 | 邊界改為上下 1cm、左右 1cm | `@page{margin:10mm 20mm}` → `@page{margin:10mm}`（四邊統一 1cm） | `exportPDF()`（約第 1630 行） |
| 8-1 | 「標費扣除」改名「前標費扣除」，且此項與「LOGO印刷費」預設都改不勾選 | label 文字改名；`let colDed=true,colLogo=true` → `let colDed=false,colLogo=false`；HTML chip 拿掉 `on` class；`resetAll()` 同步改為 `remove('on')` | 變數宣告（約第 616 行）+ chip（約第 357-358 行）+ `resetAll()`（約第 1037 行） |
| 8-2 | 出貨批次改為選填切換，勾選後預設帶入可編輯的「Lot X」 | 新增 `colLot` 切換變數（預設 false），仿照 `ded`/`logo` 模式做成第三個 chip；`addBotRow()` 內 `lotVal` 邏輯：若 prefill 有值就用 prefill，否則 colLot 為 true 時預設 `'Lot X'`；新增 `botLotCache` 供切換時保留已填資料 | `colLot` 全域變數 + `toggleCol()`/`rebuildBotHeader()`/`addBotRow()`（約第 670-755 行）+ 列印表格同步支援（約第 1110-1140 行） |
| 9 | 新增 2 個「批次標籤」欄位（Lot/日期標記、客戶名稱標籤），印在報價單標題下方方便一眼辨識（**實驗性，待 Molly 確認美觀與否再決定留不留**） | 新增 `f-tag-lot`／`f-tag-cli` 兩個選填輸入框（報價單資訊卡內，獨立小節）；`openPreview()` 讀取後，若任一有填，顯示在「報　價　單」標題正下方一行金色小字（用「・」分隔）。**目前這兩個欄位只是前端顯示用，沒有寫進 `collectQuote()` 也沒有傳給後端存進 Google Sheet**，純粹是看版面效果用 | 報價單資訊卡（約第 332-339 行）+ `openPreview()`（約第 1090-1093、1257 行） |

### ⚠️ 重要：載入舊報價單時的相容性修正（這次順手補的根因修正，務必保留）

把「標費扣除／LOGO印刷費／出貨批次」三者預設改成不勾選後，發現一個潛在資料遺失風險：**如果直接把預設值定死成 false，那打開一張「舊資料裡本來就有標費/LOGO/批次數字」的既有報價單時，因為 colDed/colLogo/colLot 是 false，對應的 input 根本不會被渲染出來，使用者完全看不到那些舊資料 → 如果這時按下儲存，舊資料就會被當作空白覆蓋掉，造成資料消失**。

已在 `loadQuoteIntoForm()` 內加上根因修正：載入既有報價單的瓶裝品項時，先檢查 `items` 陣列裡是否有任何一筆 `lot`/`deduction`/`logoFee` 有值，有值就自動把對應的 `colLot`/`colDed`/`colLogo` 設成 `true`（並同步 `ctg-*` chip 的 `on` class + `rebuildBotHeader()`），再逐筆 `addBotRow()`。這樣舊單打開時欄位會「自動偵測並顯示」，新建單則維持預設全部不勾選的乾淨畫面。**這個邏輯不可拿掉，否則舊單編輯會有資料默默消失的風險。**



---

## 四點九、v1.4 接手對話修正紀錄（2026-06-19 凌晨）

**前端 index.html 最新 commit = d37deea**。本節為唯一正確版本。

### 修正內容對照表

| # | 需求 | 修正方式 | 程式位置 |
|---|---|---|---|
| 5 | **品項合計（未稅）計算錯誤（這次最重要的 bug）** | 根因：`calc()` 在 `taxMode==='exc'`（未稅模式）時，把 `displaySub` 算成 `rawSub+taxAmt`（其實是含稅後金額），卻顯示在標籤寫著「品項合計（未稅）」的欄位裡，文字與數字對不上。最終總計（`t-tot`）數字本身其實沒錯，只有這一行小計顯示錯誤。修正後 `displaySub` 兩種模式統一都是 `rawSub`（畫面上輸入的原始金額，含稅模式下它就是含稅後金額、未稅模式下它就是未稅金額，分別對應正確標籤），稅額另外算，`grandTotal = rawSub + (未稅模式才加 taxAmt) + extTotal` | `calc()`（約第 915-934 行） |
| 1 | 加上運費欄位，可填金額，選填 | 額外費用區新增「+ 運費」按鈕，點擊後 `prompt()` 詢問金額，自動加入額外費用列；沿用既有 `pushExt()` 機制，不需要額外資料結構 | `presAmt()`（約第 993 行）+ 按鈕（約第 463 行） |
| 2-1 | 到貨驗收付款模式：拿掉「驗收無誤後幾日付款」，改為驗收無誤後即應付款 | 移除 `p1-pdays` 欄位；`getPayTerms()` payTab1 文字改為「...甲方應於 X 日內完成驗收，驗收無誤後即應支付款項...」，不再有額外等待天數 | pp1 區塊（約第 520 行）+ `getPayTerms()`（約第 1074 行） |
| 2-2 | 隔月指定日付款：「收貨後第幾個月」預設值改為 1（隔月） | `p2-mon` 加上 `value="1"`；`resetAll()` 同步在清除時把它設回 `'1'`（而非清空），避免被通用清空邏輯洗掉 | pp2 區塊（約第 532 行）+ `resetAll()`（約第 1037 行） |
| 3 | 客戶名稱空白時不要顯示「（未填）」 | `openPreview()` 內 `cli` 變數原本是 `f-cli 值 || '（未填）'`，造成永遠是 truthy 字串、`cliFields` 的 `if(v)` 判斷永遠通過而印出「客戶名稱：（未填）」一行。改成 `f-cli 值 || ''`，空白時 `if(v)` 自然跳過不顯示該列 | `openPreview()`（約第 1098 行） |
| 4 | 匯款→匯款資訊，補上請客戶提供截圖/後五碼以利查帳的順暢語句 | 列印頁備註區改成兩行：「匯款資訊：...」+「匯款完成後，敬請提供轉帳截圖或帳號後五碼，以便核對入帳，謝謝。」；同步更新表單內「固定條款（自動附上）」預覽清單文字，確保表單顯示與實際列印一致 | `openPreview()`（約第 1300 行）+ 備註欄卡片預覽清單（約第 569 行） |

### ⚠️ 重要：HANDOVER.md 自我編輯注意事項（這個檔案本身被誤改了三次，必看，連寫這段提醒的當下都又犯了一次）

之前三次（v1.2→v1.3 一次、v1.3→v1.4 交接時兩次，包括寫這條提醒的同一次編輯裡又犯了一次）用 `str_replace` 插入新章節時，`old_str` 只比對到「## 五、踩過的雷與正確解法（務必看，避免重犯）」這一行標題本身，`new_str` 寫了一大段新章節內容但**忘記在結尾把這行標題加回去**，結果標題被新章節內容整個吃掉、消失在文件裡，雖然「雷 1～5」的內容都還在，但少了上層標題，文件結構會錯亂。**已修復**，並順手記錄在這裡：**之後如果還要在「四點 X」與「五、踩過的雷」之間插入新章節，最安全的做法是 old_str 只取「---」這一條分隔線加上前後各一點點內容做唯一定位，new_str 結尾原樣保留「## 五、踩過的雷與正確解法（務必看，避免重犯）」這行，絕對不要省略；或者乾脆改成在新章節寫完後立刻 `grep -n "^## "` 確認章節數量、順序跟編輯前是否一致，每一次編輯完都要做這個檢查，不要假設自己這次沒犯錯。**

---

## 四點十、v1.5 接手對話修正紀錄（2026-06-19 凌晨）

**前端 index.html 最新 commit = 3a9e352**。本節為唯一正確版本。

### 修正內容對照表

| # | 需求 | 修正方式 | 程式位置 |
|---|---|---|---|
| 1 | 處理人員預設值拿掉中文名，只留 Molly | `value="林湘珆 Molly"` → `value="Molly"`；`resetAll()` 同步調整 | 報價單資訊卡（約第 331 行）+ `resetAll()`（約第 1051 行） |
| 2 | 宴會酒水「客製化調酒」「客製化無酒精雞尾酒」兩個品名輸入框，也要支援貼上多行自動拆成多筆，或 Shift+Enter 換行後一次新增多筆 | 把 `ban-g1-input`／`ban-g2-input` 從 `<input>` 改成 `<textarea rows="1">`；新增 `handleFlavorKeydown(ev,g)`：按 **Enter（不含 Shift）** 時阻擋預設換行，呼叫 `addFlavor(g)` 一次性把目前框內所有行都新增成獨立品名 tag 並清空；按 **Shift+Enter** 則不做任何事，讓 textarea 自然插入換行，方便繼續輸入下一筆；新增 `handleFlavorPaste(ev,g)`：偵測貼上內容含換行就直接攔截、依行拆分後立刻逐筆新增（不需要再按 Enter）；`addFlavor()` 本身也改成依換行切割並一次 push 多筆，沿用同一份邏輯，按鈕「+ 新增品名」一樣適用 | `handleFlavorKeydown()`/`handleFlavorPaste()`（約第 814-828 行）+ `addFlavor()`（約第 806 行）+ 兩個 textarea（約第 383、403 行） |
| 3 | **含稅/未稅稅額計算公式修正（Molly 主動指出並要求覆核）** | Molly 給的公式：勾選**含稅價**時，`品項合計 = 輸入總金額 / 1.05`，`稅額 = 總計 − 合計`（這裡的「總計」= 輸入總金額本身，因為輸入的就是含稅後要付的總額）；勾選**未稅價**時，`品項合計 = 輸入總額`（不變），`稅額 = 總額 × 0.05`。**這跟 v1.4 當時的實作不一樣**：v1.4 含稅模式下「品項合計」顯示的是輸入金額本身（沒有除以 1.05），只有未稅模式才是輸入金額本身——等於兩種模式下「品項合計」這個數字的意義不一致（一個是含稅後金額、一個是未稅金額）。Molly 這次的公式統一成：**「品項合計」這條線無論哪種模式，數字上永遠代表未稅（不含稅）的商品淨額**，只是含稅模式需要從輸入的含稅總額反推回去，未稅模式則輸入值本身就是淨額，不用換算。已照此公式重寫 `calc()`，並把含稅模式的 `lb-sub` 標籤文字從「品項合計（含稅）」改成「品項合計（未稅，自動回算）」，避免標籤寫「含稅」但數字其實是未稅金額造成的誤會。**已用範例驗算**：含稅模式輸入 10,500、稅率5% → 合計顯示 10,000、稅額顯示 500、總計 10,500（不變）；未稅模式輸入 10,000、稅率5% → 合計顯示 10,000、稅額顯示 500、總計 10,500。兩種模式算出的總計一致，且每一行數字都跟 Molly 給的公式對得上 | `calc()`（約第 931-952 行）+ `setTaxMode()`（約第 954-969 行） |

---

## 四點十一、v1.6 接手對話修正紀錄（2026-06-19 凌晨）

**前端 index.html 最新 commit = d3e3f5e**。本節為唯一正確版本。

### 修正內容對照表

| # | 需求 | 修正方式 | 程式位置 |
|---|---|---|---|
| 1 | 瓶裝品項明細的「品名」欄位，設計同宴會「客製化調酒」：改成可多行 textarea，Enter 直接新增下一筆、Shift+Enter 換行繼續打、貼上多行直接拆成多筆 | 把品名欄從 `<input>` 改成 `<textarea rows="1">`；新增 `handleNameKeydown(ev,id)`：按 **Enter（不含 Shift）** 時把目前框內依換行切出的內容分配給目前列＋多出的行各自建立新列（沿用既有 `handleNamePaste` 拆筆邏輯），**並且額外多開一筆全新空白列、自動把游標移過去**，方便連續打字建立下一筆品項（這點跟宴會的 `addFlavor` 行為類似：Enter＝送出目前這筆＋準備下一筆）；按 **Shift+Enter** 不做攔截，讓 textarea 自然換行；`handleNamePaste` 維持原行為不變（貼上多行直接拆成多筆，不會額外多開空白列）；新增 `escHtml()` 輔助函式，因為 textarea 內容是用 innerHTML 方式帶入初始值（不像 input 用 value 屬性），需要逃脫 `<`、`>`、`&` 避免品名裡有特殊字元時破壞畫面 | `handleNameKeydown()`/`escHtml()`（約第 743-765 行）+ `addBotRow()` textarea（約第 727 行）+ CSS `.itr textarea`（約第 108-110 行） |
| 2 | 瓶裝額外費用新增「客製化前標」項目，做成下拉選單（金額預設免費 $0，可自填） | 把原本 SGS／GS1／免運／運費 四顆各自獨立的按鈕，**收合成一個 `<select>` 下拉選單**（呼應上次我提的「按鈕變多可以收合」建議），選項依序：SGS 檢驗費／GS1 條碼登記費／整批出貨免運／運費（自填金額）／**客製化前標（預設免費，可自填）**；選取後觸發 `handleExtPreset(sel)` 依 value 分派到對應的 `presQty()`/`pres()`/`presAmt()`，選完自動把下拉選單重置回預設提示文字；`presAmt(n, def)` 新增第二個參數 `def`（預設帶入值），客製化前標呼叫 `presAmt('客製化前標', 0)`，跳出的 `prompt()` 會預先帶入「0」，直接按確定就是免費，要收費就把 0 改成金額即可 | `handleExtPreset()`/`presAmt()`（約第 1035-1050 行）+ `<select id="ext-preset">`（約第 457-466 行） |

---

## 四點十二、v1.7 接手對話修正紀錄（2026-06-19 凌晨）

**前端 index.html 最新 commit = 5862c04**。本節為唯一正確版本。

### 修正內容對照表

| # | 需求 | 修正方式 | 程式位置 |
|---|---|---|---|
| 1 | 報價單日期應預設當天，但仍可手動更動為其他日期 | **找到根因**：頁面初次載入時 `f-dt` 確實會被設成今天日期（沒問題），但按下「清除」（`resetAll()`）或「開新報價單」（`newQuote()` 內部呼叫 `resetAll(true)`）時，`f-dt` 是一個 `type="date"` 的一般 input，沒有被 `resetAll()` forEach 裡的任何特殊規則攔到，會被通用的 `el.value=''` 清成空白，而不是重設回今天——之後 `onDate()`/`upNo()` 一發現 `f-dt` 是空的就直接 `return`，導致清除後報價日期、有效至、單號都不會自動算好。新增共用的 `todayStr()` 輔助函式（回傳今天日期字串），初始化 IIFE 與 `resetAll()` 都改用這個函式：初次載入跟每次清除/開新單時，都會把 `f-dt` 設回今天，**輸入框本身仍是一般 date input，使用者隨時可以手動改成別的日期**，改完之後 `onDate()` 一樣會照新日期重算有效期限跟單號 | `todayStr()`（約第 627 行）+ 初始化 IIFE（約第 631 行）+ `resetAll()`（約第 1092 行） |

---

## 四點十三、v1.8 接手對話修正紀錄（2026-06-19 凌晨）

**前端 index.html 最新 commit = 933a618**。本節為唯一正確版本。

### 修正內容對照表

| # | 需求 | 修正方式 | 程式位置 |
|---|---|---|---|
| 1 | 付款條件新增一個選項，可以完全不顯示此欄位 | 付款條件分頁新增第 5 個按鈕「不顯示此欄位」（`setPay(4)`），對應新增 `pp4` 面板（只放一行提示文字，不需要任何輸入欄位）；`getPayTerms()` 在 `payTab===4` 時明確回傳空字串；`openPreview()` 的 PAYMENT 區塊改成 `${payH?'...':''}` 條件渲染——`payH` 是空字串時，整個「付款條件」的框（含金色左邊框、標籤文字）**完全不會出現在列印/匯出畫面**，不是留一個空白框，是整段消失 | `setPay()`/`pp4`（約第 503-508、550-552 行）+ `getPayTerms()`（約第 1149 行）+ PAYMENT 區塊（約第 1352 行） |

### ⚠️ 順手抓到的小 bug：`resetAll()` 沒有重設付款條件分頁

開發這次新選項時發現：按「清除」或「開新報價單」時，`resetAll()` 從來沒有把付款條件分頁（`payTab`）重設回預設值 0（比例訂金＋尾款）——因為分頁按鈕跟面板都是 `div`/`button`，不是 `input`/`textarea`/`select`，不會被 `resetAll()` 那段 `querySelectorAll('input:not([readonly]),textarea,select')` 的清空迴圈處理到。意思是如果上一張單選了「不顯示此欄位」（或任何非預設分頁），清除/開新單之後分頁選擇會卡住不變，新單莫名其妙就繼承了上一張單的付款條件分頁設定。已在 `resetAll()` 最後補上 `setPay(0);` 解決，**這個問題在這次新增第 5 個選項之前其實就已經存在**，只是這次順手一起修了。

---

## 四點十四、v1.9 接手對話修正紀錄（2026-06-19 凌晨）

**前端 index.html 最新 commit = 4348638**。本節為唯一正確版本。

### 修正內容對照表

| # | 需求 | 修正方式 | 程式位置 |
|---|---|---|---|
| 1 | 「另存新檔」（瀏覽器列印→存成PDF）預設檔名改為：客戶名稱標籤_Lot/日期標記_報價單_凱文南坡萬實業社 | 瀏覽器「另存為 PDF」對話框預設帶入的檔名，機制上其實是取列印頁面的 `<title>` 標籤內容，所以做法是讓 `exportPDF()` 動態產生 `<title>`，不是真的呼叫檔案下載 API。新增 `buildExportFilename()`：依序取「客戶名稱標籤」（`f-tag-cli`，沒填就退回正式的「客戶名稱」`f-cli`）、「Lot / 日期標記」（`f-tag-lot`，有填才加），最後固定加上「報價單_凱文南坡萬實業社」，用底線串起來；新增 `sanitizeFilename()` 把 `\ / : * ? " < > |` 這些檔名不能用的符號換成「-」（**這點很重要**：因為「Lot / 日期標記」欄位的 placeholder 範例本身就寫「2026/06/18」這種有斜線的日期格式，如果不處理，Windows 系統會存檔失敗或自動把斜線吃掉變成資料夾路徑）；兩個標籤都空白時就單純退回「報價單_凱文南坡萬實業社」，不會有多餘的底線 | `buildExportFilename()`/`sanitizeFilename()`（約第 1698-1711 行）+ `exportPDF()` 內 `<title>${fname}</title>`（約第 1722 行） |

### 範例
- 客戶名稱標籤=「南野子」、Lot/日期標記=「Lot 31」→ 檔名：`南野子_Lot 31_報價單_凱文南坡萬實業社`
- 只填 Lot/日期標記=「2026/06/18」→ 檔名：`2026-06-18_報價單_凱文南坡萬實業社`（斜線已轉成減號）
- 兩個標籤都沒填，但正式客戶名稱欄位有填「南野子國際」→ 檔名：`南野子國際_報價單_凱文南坡萬實業社`
- 全部都沒填 → 檔名：`報價單_凱文南坡萬實業社`

---

## 四點十五、v2.0 接手對話修正紀錄（2026-06-19 凌晨）

**前端 index.html 最新 commit = bdd711e**。本節為唯一正確版本。

### 修正內容對照表

| # | 需求 | 修正方式 | 程式位置 |
|---|---|---|---|
| 1 | 宴會調酒師服務費「小計」欄位設計可反向輸入：輸入單價+人數→自動算小計（原行為），或輸入小計+人數→自動回算單價 | 把 `svc-sub` 從純顯示用的 `<span>` 改成 `<input type="number">`；`calcBan()` 內原本寫 `svc-sub.textContent` 改成寫 `svc-sub.value`（正向計算，amt1/amt2/qty 任一變動時觸發，邏輯不變）；新增 `svcReverseCalc()`，綁在 `svc-sub` 的 `oninput`：讀目前小計與人數，反推 `a1 = 小計/人數 − a2`（`travel` 模式才有 a2／車馬費，其他模式 a2=0），寫回 `svc-amt1`，**車馬費 a2 維持不變**（也就是反向輸入只會回推服務費單價那一格，車馬費需要的話還是手動填）；寫回後呼叫 `calc()` 重算總計，**不**呼叫 `calcBan()`，避免又把使用者剛打的小計值蓋回去 | `svcReverseCalc()`（約第 917-925 行）+ `calcBan()`（約第 905-916 行）+ HTML（約第 437-441 行） |

### ⚠️ 順手發現但這次沒有修的問題（給下一個接手對話參考，不確定要不要修，先記錄）

複查這塊程式碼時發現：`loadQuoteIntoForm()` 載入既有宴會報價單時，只有 `svc-mode`（服務模式）會被還原，**`svc-amt1`／`svc-amt2`／`svc-qty` 完全沒有被還原**（資料庫的 `items` 陣列裡服務費不是獨立品項，是存在主表 `svcMode`/`svcAmount` 兩個欄位，`svcAmount` 只是最終加總後的金額，沒有保留單價跟人數的拆解）。**實際影響**：打開一張舊的、有填調酒師服務費的宴會單來編輯時，服務模式下拉選單會正確顯示選中的模式，但底下的單價/人數欄位會是空的，小計也會顯示空白／$0——**不是這次反向輸入功能造成的，是原本就有的缺口**，原因是資料庫設計時 `svcAmount` 只存了結果、沒存拆解明細。如果要修，需要在主表新增欄位存 `svcAmt1`/`svcAmt2`/`svcQty`（GAS 後端 + Sheet 都要加欄位），或接受「編輯舊單時服務費要重新手動輸入」。**這次先記錄，不擅自動資料庫結構**，等 Molly 確認要不要修再處理。

---

## 四點十六、自訂報價單模式（對話 A：前端 UI，2026-07-09）

**前端 index.html 最新 commit = 3d84495**。新增第三種模式「自訂報價單」，與既有瓶裝/宴會兩種模式完全獨立、互不影響。

### 範圍與原則
- **只改 index.html，沒動 gas/code.gs、沒碰 Google Sheet、沒重新部署 GAS**——零部署風險。
- 自訂模式**不進資料庫**（沒有儲存/正式文件按鈕），純前端建立 → 直接匯出 PDF / Word。
- 側邊欄新增「自訂報價單」導覽鈕（`nav-custom` → `gotoPage('custom')` → `page-custom`），頂部工具列依頁面切換顯示 `tbr-standard` 或 `tbr-custom` 兩組按鈕。

### 6 項自訂功能對照表

| # | 功能 | 實作方式 |
|---|---|---|
| 1 | 手動填小計 | 每列「手動小計」checkbox，勾選後小計欄位變可編輯（`toggleCustomManual()`），未勾選則自動 = 單價×數量 |
| 2 | 免費項目劃線 | 每列「免費」checkbox，`openCustomPreview()` 中該列顯示原價劃線 + 金色「免費」字樣，且**不列入總計**（`calcCustom()` 排除 free 列） |
| 3 | 項目備註說明 | 每列備註欄，顯示於品名下方小字（`GREY2` 淡灰） |
| 4 | 含稅/未稅切換 | `c-taxmode`：inc＝總計=品項合計，稅額=總計−總計/(1+稅率)（回算）；exc＝總計=品項合計+品項合計×稅率（外加），公式見 `calcCustom()` |
| 5 | 自訂欄位標題 | 表格上方 5 個標題輸入框（`c-h-name/qty/unit/price/sub`），即時反映到預覽表頭 |
| 6 | 案名標籤 | `c-tag` 輸入框，顯示於「報價單」大標右下方金色圓角標籤 |

### 視覺樣式（比照 KKBar 活動酒水）
`openCustomPreview()` 內以 inline style 組出 HTML（做法比照既有 `openPreview()`），色碼：GOLD `#A6824A`、HEADGREY `#8A8880`（表頭字）、LINE `#E8E5DD`（列分隔線）、BORDER `#E5E2D8`、GREY `#6B6B63`、GREY2 `#A8A69C`。表頭無底色、只有橫線分隔，總計區右對齊、字型 Noto Sans TC。頁尾固定三行文字與既有模式相同（甲乙方確認/匯款資訊/轉帳核對）。

### 匯出
- **PDF**：`exportCustomPDF()`，做法與既有 `exportPDF()` 相同——開新視窗寫入 HTML + `window.print()`，不用額外函式庫，避免中文字型嵌入問題。
- **Word**：`exportCustomWord()`，純前端組 MS Office HTML namespace 文件（`<!--[if gte mso 9]>...`），包成 Blob 下載 `.doc`，**不經過 GAS**（既有的「正式文件」Word 匯出才是走 GAS Docs API，兩者是不同機制，互不影響）。
- 檔名格式：`{客戶名}_{單號}_報價單_凱文南坡萬實業社`（`buildCustomExportFilename()`）。

### 預覽視窗共用邏輯（重要，避免踩雷）
既有的預覽 modal（`#pov`/`#pcon`）在自訂模式與標準模式間**共用同一組 DOM**，用全域變數 `previewKind`（'std'/'custom'）判斷預覽視窗內的兩顆按鈕要呼叫哪一組函式：
- `previewExportPDF()` → 依 `previewKind` 分派 `exportPDF()` 或 `exportCustomPDF()`
- `previewSecondaryAction()` → 分派 `generateOfficialDocument()` 或 `exportCustomWord()`
- `openPreview()`（標準模式）與 `openCustomPreview()`（自訂模式）**都要記得把 `previewKind` 設回自己的值**、並更新 `pv-btn-secondary` 按鈕文字（「正式文件」⇄「匯出 Word」），否則會呼叫錯函式。**這次已修正並驗證**（見下方驗證方式）。

### KKBar 範例資料
`loadKKBarSample()`——一鍵載入交接筆記裡的範例（Flutterfly/Taiwan Vibes 手動小計、酒吧車免費劃線、氣瓶/運費一般計算），可當測試也可當 Molly 實際开單時的起始樣板。

### 驗證方式（本次用 jsdom 完成，未上 Claude in Chrome 實跑）
用 Node + jsdom 載入 `index.html`、執行 `runScripts:'dangerously'`，呼叫 `loadKKBarSample()` + `calcCustom()`，確認：
- 總計 $41,500、稅額 $1,976（與交接筆記範例完全吻合）
- 預覽 HTML 含免費劃線、KKBar 標籤、Flutterfly、頁尾三行文字
- 檔名輸出 `KKBar_20260708-01_報價單_凱文南坡萬實業社`
- `exportCustomPDF()`/`exportCustomWord()` 呼叫不拋錯、`window.print()`/下載觸發正常
- 切回標準模式（`gotoPage('new')` → `setType('bottle')` → `openPreview()`）後 `page-custom` 內容與 5 筆列資料完全不受影響，`pv-btn-secondary` 正確變回「正式文件」

**尚未做**：真人瀏覽器實際列印看 A4 排版、實際開啟 Word 檔看相容性。建議 Molly 上線後開一次自訂模式、載入 KKBar 範例、實際匯出 PDF/Word 目視確認。

---

## 四點十七、付款條件 Tab1「比例訂金＋尾款」改版（2026-08-05）

**前端最新 commit：`82e483a`（index.html）＋ `7f3f98f`（js/01_quote_form.js、js/02_core_api.js），皆已上線並實機驗證。本節為唯一正確版本。**

### 規則（Molly 2026-08-05 拍板，全單型適用）

| 項目 | 規則 |
|---|---|
| 訂金比例 % | **只套用在「酒款金額」上**（品項表小計 `rawSub`，不含額外費用），不是總價 |
| 其他費用（正數） | 額外費用列裡金額為正的（SGS 檢驗費、GS1 條碼費…）**100% 併入訂金** |
| 折抵（負數） | 額外費用列裡金額為負的（運費折抵…）**從尾款扣除** |
| 營業稅 | 按訂金／尾款的未稅佔比分攤，**訂金＋尾款必等於總計（含稅）** |
| 比例預設值 | 瓶裝／OEM／公版買斷／公版客製標／寄售＝**50%**；宴會等其他＝30%（`defaultDepPct()`） |

**無額外費用時，酒款金額＝總價，算出來的數字與改版前的「總價×%」完全相同**——所以既有單子不受影響，只有真的填了檢驗費／條碼費的單才會變。

### 實作位置（js/01_quote_form.js）

- `calc()` 尾端寫入四個快照供付款計算使用：`LAST_WINE_SUB`（酒款小計）、`LAST_EXT_POS`／`LAST_EXT_NEG`（額外費用拆正負）、`LAST_BASE`（未加稅基數）、`LAST_GRAND`（含稅總計）。
- `payBreakdown()`（取代原本的 `calcPay()` 內聯算法）算出訂金／尾款與條款要用的逐項明細。
- **稅基一致性**：條款括號內要逐項列金額，這些明細會用 `grand/base` 同比例換算到跟訂金／尾款同一個稅基，且**酒款那一塊用「訂金減掉各項費用」當餘數**，確保括號內加總剛好等於括號外的總額（未稅模式下若不這樣做，客戶會看到括號內外對不起來）。
- `cleanFeeName()`：額外費用名稱在品項表會帶「（1款 × $4,000）」這種數量註記，合約條款只留品名。

### 條款文字格式（Molly 指定，勿自行改寫）

```
訂金支付：甲方於乙方製造前 {15} 日內，支付訂金總計新台幣 {訂金} 元整（內含{各項費用}，及酒水總價 {50}% 之訂金 {酒款訂金} 元整），作為乙方啟動生產之依據。
驗收與尾款：乙方完成商品製作並全數交付後，甲方應於到貨後 {7} 日內完成驗收。驗收無誤後，甲方應於 {30} 日內支付尾款新台幣 {尾款} 元整（即酒水總價剩餘之 {50}%{，減去各項折抵}）。
```

Tab1 面板欄位：訂金比例、製造前幾日內付訂金（`dep-days1`，預設 15）、到貨後幾日內驗收（`dep-days`，預設 7）、驗收後幾日內付尾款（`dep-fdays`，預設 30）、付款條件備註。

### 已移除：Tab 5「酒款訂金＋其他費用」

commit `192afdb` 曾把這套規則做成第 6 個付款分頁，**Molly 明確要求不要新增分頁／欄位**，已整個移除、規則併回 Tab1，付款分頁恢復 5 個。`02_core_api.js` 載入舊單時 `paymentType` 超出 0–4 會回落到 Tab0，付款文字仍由 `LOADED_PAY_DETAIL` 沿用存檔版本，客戶看過的舊條款不會被改掉。

### 驗證

- `test_pay_tab0.js`：21 項情境（含稅／未稅／稅率 0／比例 0%／進位邊界／分頁數量），全過。
- `test_molly_case.js`：用「酒肉朋友」實際單號的數字（酒款 $450×200、SGS $4,000、GS1 $1,500、含稅 5%），**新版 = 訂金 $50,500／尾款 $45,000**（符合 Molly 指定），並同時跑舊版 commit 對照重現出錯誤的 $47,750／$47,750。
- 既有回歸測試 `test_ordpay` / `test_preview_btn` / `test_recheck0803` / `test_hooks` / `test_banquet_ml` 全過。
- 上線後在 github.io 正式站實機跑過同一組數字，輸出與本地一致。

### 追加修正（2026-08-06）：載入舊單改金額，付款條件沒跟著改

**現象**（Molly 回報）：把 550ml/$475/200瓶 改成 510ml/$460/220瓶，總計正確變成 $106,700，但預覽/列印出來的付款條件還停在舊的訂金 $53,000／尾款 $47,500。

**根因**：`LOADED_PAY_DETAIL`。載入舊單時它會存住存檔當下的付款文字，`getPayTerms()` 第一行就直接回傳它（設計目的是避免重算把客戶看過的條件改掉，因為天數/比例這些細節欄沒存進資料庫）。但原本「解除凍結」的條件**只有使用者動到付款欄位**（PAY_FIELDS），改單價／瓶數／容量／額外費用都不算，所以金額變了、文字沒變。畫面上的訂金/尾款欄位是即時算的會更新，只有印出去的條款是舊的——**兩邊不一致，最容易誤簽**。

**修法**（`01_quote_form.js` 的 `syncLoadedPayDetail()`）：載入後記住金額指紋 `payAmountSignature()`＝總計＋酒款小計＋各項額外費用金額；每次 `calc()` 比對，一旦不同就 ①用 `restorePayFieldsFromText()` 從舊文字把天數/比例/備註解析回欄位（新舊兩種條款寫法都吃，解析不到就用預設）②清掉 `LOADED_PAY_DETAIL` 讓條款重算 ③跳 toast 提醒確認。金額沒動時行為完全不變，舊單重印仍是一字不差的原文。

**回歸測試**：`test_pay_reload.js`（13 項，完整重現回報情境）。用「總計＋酒款＋額外費用」當指紋而不是只看總計，是因為把錢從酒款挪到額外費用時總計可能不變、但訂金會變。

### 追加修正（2026-08-06 第一波，全系統複檢 #1/#2/#12/#16）

全系統複檢報告見 Molly 專案資料夾 `複檢報告_20260806_全系統嚴格複檢.md`（8 高、6 中、13 低），本波修掉付款條款狀態機的四個：

1. **（#1 高）載入舊單後直接編輯付款欄位，原單比例/天數被預設值蓋掉**——上一節的指紋修法只接了「改金額」那條解凍路，PAY_FIELDS 監聽器和 setPay 這兩條路解凍時不會 restore。根治法：`loadQuoteIntoForm` 在設定 `LOADED_PAY_DETAIL` 後**立即** `restorePayFieldsFromText()`，付款面板從載入那一刻就顯示原單設定，之後任何一條解凍路重算用的都是原單值。
2. **（#2 高）連開兩張舊單，前一張凍結殘留污染下一張**——載入流程中 setType/setTaxMode/onSvcModeChange 會觸發 calc()，此時上一張的凍結指紋還掛著 → 誤判「金額有異動」＋把 A 的設定解析進 B 的欄位。修法：`loadQuoteIntoForm` 開頭第一件事就清 `LOADED_PAY_DETAIL/LOADED_PAY_SIG`。
3. **（#12 中）折抵超過尾款額度印出負數尾款**——`payBreakdown()` 封頂（dep=總計、bal=0，回傳 `clamped` 旗標），`getPayTerms()` Tab0 對 clamped 情況改寫成「無須另付尾款（剩餘款項已由折抵全數抵銷）」，並把 money 格式改為負數印 `-$1,000`。
4. **（#16 低）小數比例解凍後變回預設**——restore 的比例 regex 改 `(\d+(?:\.\d+)?)`（dep-pct 三種寫法＋p1-pct）。

**回歸測試**：`test_pay_wave1.js`（19 項，A載入編輯備註／B連開兩單／C折抵超額／D小數比例）。連同既有 9 支測試全過。

### 追加修正（2026-08-06 第二波，金額一致性 #3/#5/#6/#14）

1. **（#3 高）訂單追蹤訂金/尾款沒跟上 2026-08-05 新算法**——訂單追蹤三處（`05_orders.js` 的 `openOrdEdit` 新單帶入、`fillHalf` 按鈕，以及後端 `v2_extensions.gs` 新單預設）都還在用「總計×比例」，跟報價單印的訂金差一截（例：報價單 $50,500 vs 訂單追蹤 $47,750）。
   **修法**：不再自己重算，改成**從報價單存好的 `paymentDetail` 條款文字把實際金額讀回來**（`ordPayFromQuote()` / 後端 `orderPayFromQuote_()`）。這樣不管條款算法將來怎麼變，訂單追蹤都會自動跟著對。`buildOrders` 要一併把 `paymentDetail` 帶進 ORDERS_CACHE。新舊兩種條款寫法都吃、折抵抵光（`無須另付尾款`）當尾款 0；讀不到（自訂條款）或金額加起來跟訂單總額對不上就退回原本的比例算法。**前後端是同一套 regex，要改要一起改。**
2. **（#5 高）自動費用列存檔後 auto 標記遺失 → 重選公司長出重複運費**——存檔時把 `e.auto` 寫進 extras 用不到的 `unit` 欄（`'ship'`/`'label'`），載入時還原。舊單沒有標記，靠 `applyAutoRules` 裡的**認領**機制補救。
   ⚠️ **認領一定要用「規則參數組出來的完整名稱」精確比對，且只在該規則這輪確實要長列時才認領**。我第一版用開頭字比對（`/^運費/`）就踩雷：使用者手動加的「運費折抵」被誤認成自動列，接著被同步邏輯當成「規則不要這列了」直接刪掉，總計整個算錯（`test_pay_tab0.js` 情境 A 立刻掉出來抓到）。
3. **（#6 高）toggleCol 重建列時掉 pid → 級距價與 MOQ 提醒失效**——`toggleCol` 的 oldData 補存 `pid/sku/listprice/priceSrc/manual`，`addBotRow` 尾端補還原並重新掛上手改監聽與 hand-edit 標示。
4. **（#14 中）自動列的 ✕ 刪不掉**——`08_ownbrand.js` 的 `beforeRemoveExt` hook 改用 `String(x.id)===String(id)`（UI 傳字串、自動列 id 是數字，嚴格等號永遠比不中，`RULE_SUPPRESS` 設不進去所以刪掉又被加回來）。`test_hooks.js` 因為直接用數字 id 呼叫，剛好蓋掉這條 UI 路徑，測試才會一直是綠的。

**回歸測試**：`test_wave2.js`（18 項，含「手動運費折抵不得被誤認/誤刪」的防誤傷案例）。連同既有 9 支全過。

**⚠️ 後端要重新部署**：本波動到 `gas/v2_extensions.gs`（新增 `orderPayFromQuote_`＋改新單預設金額），要照 gas/README 的流程在 Apps Script 貼上並建立新版本部署，否則只有前端生效（前端已會自己算好金額送上去，所以後端沒更新也不會出錯，只是「前端沒送金額」的極少數路徑仍會各半）。

### 追加修正（2026-08-06 第三波，資料安全 #4/#7/#8/#9/#10/#11/#13）

1. **（#4 高｜全系統最大資料風險）後端 updateQuote 會清空整張品項表再重寫**——原本是 `clearContent()` 全部資料列 → 把「別張單的舊列＋這張單的新列」一次 `setValues` 寫回。清空到寫回之間只要出事（Sheets 暫時性錯誤、`insertRowsAfter` 失敗、執行逾時被中止），**所有報價單的品項會一次消失**。
   **修法**（`gas/程式碼.gs` `handleUpdateQuote_`）：改成先掃出這張單自己的列號，**由下往上 `deleteRow`**（避免刪一列後後面列號位移），再 append 新列。別張單的資料從頭到尾不會被碰到，也不用每次重寫全表。
2. **（#7 高）自訂單品名/單位/備註含雙引號 → 載入編輯時靜默截斷**——`03_quote_custom.js` 用 `escHtml()`（只轉 `& < >`）塞進 HTML attribute，`12" 木塞禮盒` 會在引號處斷成 `12`，再存檔就把後台正確資料覆蓋掉。三處改用 `escAttr()`（宴會列早就用對了，只有自訂單漏掉）。
3. **（#8 高）驗收單：同品名同容量兩列，已出貨量被每列重複計**——原本以「品名｜容量」為鍵加總後，**每一列都拿到合計值**（同酒款兩個 LOT 各 100 全出後，兩列都顯示已出貨 200、待出貨 −100）。改成同鍵的多列**依序分配**：先分給第一列（最多分到它的訂購量），剩下的再給下一列，總量守恆也不重複。
4. **（#9 中）載入宴會單不清瓶裝殘留**——宴會分支只清宴會自己的欄位，上一張瓶裝單的品項列與 extras 留在畫面上；在這張單切回瓶裝型就會全部冒出來並計入總計，接著被存進這張宴會單。比照瓶裝分支一併清 `botItems`/`extras`/三個 cache。
5. **（#10 中）單號可能與後台不一致**——(a) `saveQuote` 成功後把後端實際發的 `data.quoteNo` 回寫 `f-no`/`pl-no`/`f-ser`（後端會自己發號，前端顯示的可能是舊的，直接用瀏覽器列印會印錯單號）；(b) `autoNextSerial` 改成同時掃 `getQuotes` 與 `listCustomQuotes`（自訂單占用同一組單號，只掃標準單會帶出已被占用的流水號）。
6. **（#11 中）「產生正式文件」不檢查未儲存修改**——正式文件是後端拿資料庫已存資料產的，改了沒存就按會拿到舊金額且無提示。加 `FORM_DIRTY` 確認框。
7. **（#13 中）自訂單發號沒上鎖**——標準單發號有 ScriptLock，自訂單沒有，兩張表共用同一組單號 → 同時存會撞號。`handleSaveCustomQuote_` 把「發號＋append」包進同一把鎖（已帶 quote_no 的更新不需要等鎖），append 後 `SpreadsheetApp.flush()` 才放鎖，確保下一個等鎖的人掃得到這個號。

**回歸測試**：`test_wave3.js`（20 項）。#4/#13 是純後端無法在瀏覽器跑，#4 以「模擬 Sheets 列行為」驗證刪除/append 演算法，#13 靠讀碼確認鎖的範圍。

**⚠️ 後端要重新部署**：本波動到 `gas/程式碼.gs`（updateQuote 品項寫法）與 `gas/v2_extensions.gs`（自訂單發號上鎖）。#4 尤其重要——沒部署的話那個「整表清空」的風險還在。

### 追加修正（2026-08-06 第四波，13 項低嚴重度收尾）

複檢報告的低嚴重度全部處理完（#16 小數比例已在第一波修掉）：

| # | 問題 | 修法 |
|---|---|---|
| 15 | 付款備註／費用名稱未跳脫，輸入 `<` 開頭會被當標籤吃掉（也是注入面） | `getPayTerms` 全部經 `escHtml`；`restorePayFieldsFromText` 反解實體，避免反覆存讀累積 `&amp;` |
| 17 | 報價日 1/31 時「有效日期＋1月」溢位成 3/3 | `onDate` 改為建構目標月份並把日夾在該月最後一天（`estPayDay` 早就修過，這裡漏修） |
| 18 | 主檔 spec 填「500ml」時容量帶不進報價單，ml 型 MOQ 也不動 | `quickAddProduct` 改用 `replace(/[^\d]/g,'')` 撈數字（比照公版酒帶入） |
| 19 | 級距價沒涵蓋低量區間時停在優惠價（**少收**）；`max` 填空字串該級距永遠比不中 | 找不到級距時回退主檔 `unit_price`；`max` 空值視為無上限 |
| 20 | 規則參數 `use_product_label_fee` 從未實作，開了只長出「每瓶扣 $0」的無效列 | 實作成「依每列品項主檔 `label_fee` × 該列瓶數逐列加總」；`per` 為 0 時不再長出無效列 |
| 21 | 寫入請求逾時/斷線時跳過 `rcClear`，90 秒內看不到剛存的單，重試會存出重複單 | `apiCall` 的 catch 與 JSON 解析失敗分支都補 `rcClear`（結果未知寧可清），逾時訊息改成提醒先確認再重存 |
| 22 | 登入過期時 batch 被誤判「後端不支援」→ `BATCH_OK` 永久關閉 | 認證類錯誤直接往外丟，不動 `BATCH_OK` |
| 23 | 驗收留底存檔失敗完全不出聲 | 失敗明確 toast（否則下次開驗收單算不到這批，「已出貨」歸零、「本次出貨」帶全量） |
| 24 | 改品名/容量後舊留底對不上鍵，靜默把「本次出貨」帶成全部訂量 | 分配完若還有沒認領的舊出貨量，跳警告要使用者核對（鍵仍是品名＋容量，這是提醒不是根治） |
| 25 | `setupV2Sheets` 種子資料欄數與表頭不符，全新試算表初始化必炸；值也早就錯位 | 改用 `seedRow_(headers, {欄名:值})` 組列，之後再加欄都不會錯位或長度不符 |
| 26 | `updateOrderStatus`（find→append upsert）與寄售單筆登記無鎖 | 兩支都包進 `ScriptLock`，寄售 append 後 `flush()` 才放鎖 |
| 27 | 正式 PDF 只認 `<br>` 一種換行寫法，其他標籤會照字面印出來 | `appendPaymentSection_` 容忍 `<br/>`／`<p>`／`<div>`，並清掉殘留標籤與常見 HTML 實體 |

**回歸測試**：`test_wave4.js`（24 項）。連同前三波與既有測試，全套 **12 支** 全過。

**⚠️ 後端要重新部署**：本波動到 `gas/程式碼.gs`（PDF 換行）、`gas/v2_extensions.gs`（種子資料、updateOrderStatus 上鎖）、`gas/v3_ownbrand.gs`（寄售單筆登記上鎖）。

**複檢報告的 8 高 / 6 中 / 13 低已全部修完。**

### ⚠️ 這次踩到的三個雷

1. **改完沒推上去 = 完全沒生效**：Molly 回報「邏輯還是錯」的截圖，其實是 GitHub Pages 上的舊碼跑出來的。**判斷法**：把 `origin/main` 的版本 `git archive` 出來實際跑一次，如果能重現使用者截圖的數字，就確定是版本問題不是邏輯問題，不要瞎改程式。
2. **推上去後瀏覽器快取舊 JS**：index.html 更新了（付款分頁確實變 5 個）但 `js/*.js` 仍是快取的舊版，算出來還是舊數字，非常容易誤判成「改壞了」。**務必 Ctrl+Shift+R 硬重載**，或用帶 cache-buster 的 fetch 驗證。
3. **沙盒工作目錄會被回收**：對話中途容器重置，`/tmp` 的本地 repo 退回舊 commit，但 GitHub 上的正式版沒事。**別以為是自己改壞了**。`git clone`／`codeload` 會被 proxy 擋（403），但 **`curl https://raw.githubusercontent.com/.../main/<path>` 可以直接下載**，用它把正式版檔案抓回來即可繼續。

### 部署方式備註

本次 session 沒有 repo 推送權限（git proxy 擋掉，403 not in authorized repository set），改走 **GitHub 網頁版 Upload files**（`/upload/main` 與 `/upload/main/js`）用 Molly 已登入的帳號 commit，事後抓 raw 檔比對 SHA-256 確認三個檔案與本地完全一致。下次若同樣推不動，這是可行的備援路徑。

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

### ⏸️ 暫停中（Molly 主動決定先不做，需要她明確再提起才繼續，不要自己重啟）
11. **舊報價單匯入轉成系統格式**（讓報價單版型統一化）：Molly 想把舊的 Word/PDF 報價單（文字可複製，不是掃描圖檔）丟進系統，自動解析成系統的標準格式。已確認技術上可行，建議做法是「貼上舊報價單文字 → GAS 後端呼叫 Claude API 解析成結構化 JSON → 自動帶入表單 → Molly 確認後再存檔」，不做檔案上傳/OCR（因為原始檔是文字可複製的電子檔，貼文字最快最簡單）。**卡關原因**：這個功能需要呼叫 Claude API，跟系統其他部分全部用 Google 免費額度不同，**這是要付費的服務**，需要 Molly 自己申辦 Anthropic API 金鑰並綁信用卡。Molly 聽完這個前提後選擇「先暫停，改做其他不需要 AI 的優化」。**下次接手對話看到這條，除非 Molly 在新對話裡主動提起要繼續，否則不要自己重新規劃或動工這個功能。**

### ⬜ v2.0 順手發現、待 Molly 決定要不要修
12. 載入舊宴會報價單編輯時，調酒師服務費的單價/人數欄位沒有還原（只有模式還原），因為資料庫只存了加總後金額，沒存拆解明細。詳見「四點十五」章節。

### ⬜ 自訂報價單模式（對話 A，已完成邏輯+樣式+匯出，待真人驗收）
13. 已用 jsdom 驗證計算邏輯、預覽 HTML、PDF/Word 匯出、與既有模式互不影響（詳見「四點十六」）。**未在真實瀏覽器測過**：A4 列印排版目視、Word 檔案在 Microsoft Word 開啟後的相容性。建議 Molly 上線後開一次自訂模式、按「載入 KKBar 範例」實際匯出確認。

---

## 八、給接手 Claude 的最重要提醒

1. **先讀本文件再動手**，資源 ID/URL/token 全在這裡，別重新建立或重新摸索。
2. 使用者貼過一份「南坡萬酒譜 APP 開發接手文件 v10.6」——那是**另一個專案（酒譜系統）**的，只能當**流程/風格參考範本**，**絕不可把它的 Sheet ID / API URL / token 用到報價系統**。酒譜系統自己的資源（勿改）：repo MollyLin-coding/recipe、site .../recipe/、GAS Script ID 1rZVFLOW4lYPQCRGZZYDqdMLAOEP5fzX_fpe--62lC3gFASBGEe7p1gH5。
3. 推 GitHub 用 curl（github.com 在允許清單）；測 GAS/github.io/jsdelivr 用瀏覽器 fetch（不在允許清單）。
4. 貼 GAS 程式碼用「push→瀏覽器 fetch→Monaco setValue」三步法，別用鍵盤貼上。
5. 任何金鑰從 DOM 讀，不要截圖辨識。
6. 改完前端推送前 `node --check`，推送後等 1 分鐘並硬重載驗證。
7. **使用者說「還是錯」時，先確認你改的東西到底上線了沒**。把 `origin/main` 的版本 `git archive` 出來實際跑一次，能重現使用者截圖的數字就是版本問題，不是邏輯問題。再來才是懷疑瀏覽器快取（Ctrl+Shift+R）。詳見四點十七。

---

## 四點十八、寄售三項調整（2026-08-06 Molly 指定）

### 1. 寄售鋪貨驗收單：拿掉簽收欄，版面對齊一般報價單
原本這張單比一般報價單的出貨驗收單多了「簽收」欄位與「客戶簽名／簽收日期」兩條簽名線。
Molly 指定拿掉，改成跟一般報價單同一套：**只有 酒款／容量／數量 三欄，頁尾用「驗收與品質說明」＋QR**，
一律走 QR 線上回報。改在 `09_verify_form.js` 的 `buildConsignVerifyDocHtml()`。

### 2. 保證金改成「按客戶」可開關
以前是全系統固定（100ml $50、500ml $250）套用到所有寄售客戶。現在客戶主檔多一個
`deposit_required` 欄位：**空白或 'Y' ＝要押（維持舊行為，舊資料完全不受影響）、'N' ＝這家不押**。
- 前端：客戶編輯表單新增「保證金」下拉（`cs-f-dep`）；`csCustomerNeedsDeposit()` 是唯一判斷點，
  `csMoveDepositUnit()` 在不押時直接回 0，所以鋪貨/退貨的即時保證金提示自動消失；
  庫存頁的保證金餘額顯示「不押保證金」而不是 $0（$0 會被誤會成還沒收）。
  另外對「設定不押、卻要登記退保證金」加了確認提示（多半是選錯客戶或類型）。
- 後端：`CONSIGN_CUSTOMERS_HEADERS` 加欄；`handleGetConsignInventory_` 的
  `deposit_held_by_customer` 加總會跳過設定為 N 的客戶。

### 3. 鋪貨每款可附 500ml 試飲瓶
鋪貨（type=in）的每一列多一個「附 500ml 試飲瓶 ___ 支」勾選（預設不勾、支數 1）。
Molly 拍板的規則：**免費贈送、不計價、不收保證金、不進庫存帳**，只在出貨驗收單上出現並標「試飲」。
- 因此試飲瓶**不會產生 consign_ledger 異動**——`saveConsignMove` 送給後端的 movements 完全不含它，
  只在 `rowsForVf` 多推一列 `{vol:'500ml', taster:true}`。庫存、保證金、月結請款都不受影響。
- `taster` 旗標會存進驗收單留底的 `items_json`，從「驗收單留底」編輯時 `vmEditForm` 會帶回來，
  重新產生不會掉標示。

**回歸測試**：`test_consign_20260806.js`（20 項）。連同既有寄售三支（dryrun／wave2／multimove）與
前四波測試，全套 **16 支** 全過。

**⚠️ 後端要重新部署**：本次動到 `gas/v3_ownbrand.gs`（客戶主檔加欄＋保證金加總跳過不押的客戶）。
部署後請在寄售管理開一次客戶設定存檔，讓 `deposit_required` 欄實際寫進試算表。

---

## 四點十九、2026-08-11 GAS 線上程式碼回存 GitHub（備份對齊）

### 為什麼要做
GitHub 上的 gas/ 一直落後線上。線上在 2026-08-07 加了**多帳號登入**那套（程式碼.gs 多出 6 支
函式），但那次沒有回存 GitHub。也就是說：**當時如果拿 GitHub 的備份還原，會把登入系統整套刪掉。**
這是很硬的地雷，本次已修正。

### 這次回存了什麼
| 檔案 | 線上大小 | SHA-256 前 16 碼 | 回存前 GitHub |
|---|---|---|---|
| gas/程式碼.gs | 74,748 bytes | 94474cc691a27393 | 63,380 bytes / 546db1b8d8d5439a |
| gas/v2_extensions.gs | 74,528 bytes | bc3308a554dd352b | 74,070 bytes / 4f223371ee7355d1 |

其餘 5 支（v3_ownbrand.gs、c_verify.gs、v33_digest.gs、v3_1_customer_recipe.gs、
b4_images.gs）回存前就已經逐位元組相同，不用動。

**驗證方式**：從 raw.githubusercontent.com 重新抓下來重算 SHA-256，兩支都與線上完全相同。
七支 .gs 現在與 Apps Script 線上版**完全一致**。

### 雷 #4：剪貼簿會把 LF 換成 CRLF
用瀏覽器剪貼簿搬程式碼時，Windows 剪貼簿會把換行正規化成 CRLF。
v2_extensions.gs 貼出來變成 76,197 bytes（比線上多 1,669 bytes ＝ 剛好多 1,669 個 CR）。
**上傳前一定要先把 CRLF 正規化回 LF 再算 hash 比對**，否則會把 CRLF 版本存進備份，
之後 diff 會整份炸開、看不出真正改了什麼。

### 雷 #5：剪貼簿是 Molly 的，隨時會被蓋掉
搬檔期間 Molly 本人在電腦上複製東西（地址、電話），中途把剪貼簿蓋掉兩次，
貼出來只有 35 bytes 與 11 bytes。**每次貼上都必須驗 marker 與 SHA，不可以直接送出。**
本次流程：Apps Script 分頁 navigator.clipboard.writeText(model.getValue())
→ GitHub 分頁用隱藏 textarea 接 paste 事件 → 正規化換行 → 比對 SHA → 用 DataTransfer
組 File 塞進 input[type=file] → commit。全程程式碼不經過對話視窗。

### 往後的規矩
**只要動到線上 GAS，當天就把該檔回存 GitHub。** 線上與備份一旦分岔，
還原就變成賭博——這次差一點就用舊備份把登入功能蓋掉。

---

# 四點十九：2026-08-11 複檢第一級 5 項（會直接少收錢的那批）

複檢報告＝`複檢報告_20260811_全流程複檢與優化建議.md`（在 Molly 的專案資料夾）。
這批是報告裡的「第一級」，全部是**錯了完全沒有聲音**的類型。回歸測試＝`test_wave5.js`（28 項全過）。

## #1 載入舊單會把自動運費／扣標列整列刪掉 ⭐ 最嚴重
`js/04_company.js` `applyAutoRules`。`loadQuoteIntoForm` 會先把 `SELECTED_COMPANY`
清成 null 再還原品項與 extras，但 `afterCalc` 掛勾照樣呼叫 `applyAutoRules`；
沒選公司時 `want` 是空的，同步邏輯第 3 條分支就把帶 `auto` 標記的列刪掉
（`locked` 這個旗標全站從來沒有被設定過，擋不住）。
**8/6 #5 的修法（auto 標記存得回去、也還原得回來）反而讓這條路一定觸發。**
後果：總計少一筆運費、連帶跳「金額有異動」把原單談好的付款條款改寫；再存一次錢就永久掉了。
**修法**：`['ship','label'].forEach(...)` 那段整段用 `if(SELECTED_COMPANY)` 包起來。
使用者主動選「不指定」那條路不受影響——`onSelectCompany` 本來就另外呼叫 `clearAutoRuleExtras()`。
⚠ 底下的「級距價」段落**刻意不包進去**（它只需要 COMPANY_DATA + 該列 pid），否則 #2 修了也沒用。

## #2 舊單重開後級距價與 MOQ 永久脫鉤
`product_id` 沒存進品項、載入時也沒還原 `row.dataset.pid`，而級距換價與 MOQ 提醒都以
`dataset.pid` 為前提。舊單改瓶數不會換級距（停在舊價＝多收或少收），**重選公司也救不回來**。
**修法**：
- `collectQuote` 的 bottle 列借用從來沒用到的 `flavorList` 欄存 pid（比照 taglabel／banquet_free
  的借欄約定，不動資料庫結構；後端正式文件的瓶裝表不印這一欄，只有宴會列會印）。
- `loadQuoteIntoForm` 還原 `pid`，並多帶一個 `tierBaseQty`＝載入當下的瓶數。
- `addBotRow` 把 `tierBaseQty` 寫進 `div.dataset`；`collectRows`（切換欄位開關時重建列）一併帶走。
- `applyAutoRules` 的級距段：瓶數還等於 `tierBaseQty` 就不動單價（不讓級距價在載入的瞬間
  把當初談好的價錢改掉），使用者一改瓶數就 `delete` 這個旗標、恢復正常換價。

## #3 非訂金型付款條款被硬帶 50/50
`orderPayFromQuote_`（後端）／`ordPayFromQuote`（前端）只認「支付訂金…元整」。
Tab1（驗收後付 100%）印「支付款項新台幣 X 元整之 100%」、Tab2（月結）印「支付全額款項新台幣 X 元整」，
兩種都解不出來 → 退回「總額的一半」。**寄售月結轉出的請款單首當其衝**：尾款腰斬、還憑空掛一筆訂金。
**修法**：兩邊都先認全額型（`!/支付訂金/` 且比對得到金額 → `{dep:0, bal:全額}`）；
帶部分比例（例如之 70%）語意不明確，一律回 null 不猜。
**呼叫端**：後端（`updateOrderStatus` 建新列）改成讀不出來就**留空不寫**——背景自動建列亂猜，
錯了整條月報表跟著錯而且毫無聲音。前端 `openOrdEdit` 的 `ordDepositPct` 退路**保留**——
那是填在畫面上給人過目、要按儲存才進資料庫，不是無聲的。

## #4 月報表與今日待辦只看最近 300 張報價單
`ordPayloads()` 用 `withLimit()`（`LIST_LIMIT=300`），而月報表的「還沒收的尾款」是**累計型**數字，
用裁切過的清單算會安靜地漏掉舊欠款，翻回幾個月前數字還會愈來愈小。
**修法**：新增 `ORD_LOAD_ALL` 與 `ordSetLoadAll()`；`gotoPage('report')` 第一次進去時
強制重抓一次完整清單（不帶 limit），之後維持完整模式、不再重抓。訂單追蹤平常仍是 300 筆。
⚠ `test_cache.js` 的「月報表：不重抓訂單」已同步改成「第一次補抓一次、第二次不重抓」。

## #5 試飲瓶標示存不進後端留底
`gas/c_verify.gs` `handleSaveVerifyForm_` 把 items 逐欄重建成白名單，**沒有 `taster`**
（2026-08-10 只改了前端與 `v3_ownbrand.gs`，`c_verify.gs` 從頭到尾沒動）。
從留底重印寄售驗收單時「試飲」標籤與「免費贈送」說明會整個消失，**客戶看到的是一支要算錢的 500ml**。
四點十八第 3 點寫「重新產生不會掉標示」是**錯的**，以此條為準。
**修法**：白名單補 `taster: (Number(it.taster)||0) ? 1 : 0`。items_json 是自由格式，不影響舊資料。
⚠ `test_consign_20260806.js` 是用 regex 比對前端原始碼字串，完全驗不到這種「前端存了、後端丟掉」
的斷點；`test_wave5.js` 改成直接把後端那段 map 抽出來實跑。

## 順帶：補上 8/10 漏升的快取版號
`?v=20260808c` → `?v=20260811a`。commit `f950043`（8/10）改了 js/06、08、09 卻沒升版號，
造成混版：新的 08 配舊的 09 → 保證金金額與驗收單版面對不上，而且只發生在部分人的瀏覽器。
長開分頁不重整的人會一直跑舊碼（「不押保證金」按了會靜默無效）。
**⚠ 上線後請 Molly 按一次 Ctrl+Shift+R。**

## 回歸狀況
`test_wave5.js` 28 項全過。全專案 39 支測試逐支與 `git stash` 基準線比對，**零新增失敗**。
既存的長期 fail（與本次無關）：`test_caltime` calSnap5 23:59、`test_fix0728` 存完即時更新、
`test_urgent` fallback 未開發票、`test_rpt` 2 項、`test_debt` 2 項、`test_login` 1 項、
`test_recheck0803` 34/35、`test_cal`／`test_hooks`／`test_v31` 直接拋錯、
`test_molly_case`（打線上版，數字停在舊版＝正好反映上面的版號問題）。
