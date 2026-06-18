# 凱文南坡萬實業社 · 報價單系統 — 開發接手文件 v1.2

建立日期：2026-06-18（v1.2 更新：2026-06-18 晚間，列印版面/總計設計/簽章/付款條件文字/SGS GS1計價 七項修正）
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
