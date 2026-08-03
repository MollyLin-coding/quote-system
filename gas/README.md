# GAS 後端原始碼備份

來源：Apps Script 專案「Quote System API」
專案 ID: 1ULEfHbKEkBrnttftDah9wz_d3dAViqRoS-vflWxp34xIe_65GyaM-o7e
線上部署版本：**v44**（2026-08-03 13:16 部署，對話A：正式文件 generateQuoteDocument 對齊網頁預覽——批次標籤頁首、免運優惠列、宴會免費列印「免費（原價）」＋備註、服務費拆項單價×人數、額外費用合計不再只限 bottle 型）
（v43＝2026-08-03 公式注入/單號互撞/鎖內寫品項/表頭自動補欄；v42＝2026-07-31 cust_lot＋有效狀態；v41＝寄售修正；v40＝客戶主檔）
部署作業 ID: AKfycbytSqCF0St1Gu8F_u8KW9rcKJnkkGAfrdaHYyrQ6wDKa19Z3TxZd-GRRi_3Ii3Ijv4i

本次快照時間：2026-08-03（v44＝repo commit 608d4ef；線上程式碼.gs 以「字元數＋SHA-256」比對一致：57026／ddfe3913ebe0306c；其餘檔與 v43 相同：v2_extensions.gs 62776／7cc5de8d65b13e54、c_verify.gs 22938／289813371f55b895、v33_digest.gs 15425／73c643b5781fa556、v3_ownbrand.gs 28384／33bb4197e1d36369）

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
