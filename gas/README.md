# GAS 後端原始碼備份

來源：Apps Script 專案「Quote System API」
專案 ID: 1ULEfHbKEkBrnttftDah9wz_d3dAViqRoS-vflWxp34xIe_65GyaM-o7e
線上部署版本：**v45**（2026-08-03 17:37 部署，對話A：寄售鋪貨一次登記多酒款 `addConsignMovements`＋簡化版出貨驗收單——驗收單紀錄表新增「客戶」欄（表頭自動補）、`verifyFindQuoteRow_`／`verifyGetItemNames_` 查無報價單時改查驗收單留底，讓 `CS-` 開頭單號也能掃碼回報）
（v44＝2026-08-03 正式文件 generateQuoteDocument 對齊網頁預覽；v43＝2026-08-03 公式注入/單號互撞/鎖內寫品項/表頭自動補欄；v42＝2026-07-31 cust_lot＋有效狀態；v41＝寄售修正；v40＝客戶主檔）
部署作業 ID: AKfycbytSqCF0St1Gu8F_u8KW9rcKJnkkGAfrdaHYyrQ6wDKa19Z3TxZd-GRRi_3Ii3Ijv4i

本次快照時間：2026-08-03（v45＝repo commit a7f5148；線上以「字元數＋SHA-256」比對一致：程式碼.gs 57156／62fd57e3fe729c87、v3_ownbrand.gs 31796／bbb20458706bc487、c_verify.gs 24989／830ff40c533de84e；其餘檔與 v44 相同：v2_extensions.gs 62776／7cc5de8d65b13e54、v33_digest.gs 15425／73c643b5781fa556）

## 檔案

程式碼.gs
v2_extensions.gs
v3_ownbrand.gs
v3_1_customer_recipe.gs
b4_images.gs
c_verify.gs
v33_digest.gs

manifest（appsscript.json）未含在內，編輯器預設隱藏。

## 還原方式
1. 開啟 Apps Script 專案編輯器。
2. 逐檔全選貼上覆蓋（檔名須一致）。
3. 部署 ▸ 管理部署作業 ▸ 鉛筆 ▸ 版本「建立新版本」▸ 部署（沿用同一部署作業才能保住 exec URL）。
4. 打 ?action=verifyHeaders 確認 ok:true。
