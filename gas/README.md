# GAS 後端原始碼備份

來源：Apps Script 專案「Quote System API」
專案 ID: 1ULEfHbKEkBrnttftDah9wz_d3dAViqRoS-vflWxp34xIe_65GyaM-o7e
線上部署版本：**v43**（2026-08-03 11:12 部署，對話A：驗收回報公式注入防護＋標準/自訂單同日單號互撞修正＋createQuote 品項寫入移進鎖內＋order_status 表頭自動補欄——cust_lot 之後不用再手動跑 setupOrderStatusV30Columns）
（v42＝2026-07-31 對話B：cust_lot＋有效狀態＋結案日修正；v41＝寄售修正；v40＝客戶主檔；v39＝共用試算表連線）
部署作業 ID: AKfycbytSqCF0St1Gu8F_u8KW9rcKJnkkGAfrdaHYyrQ6wDKa19Z3TxZd-GRRi_3Ii3Ijv4i

本次快照時間：2026-08-03（v43＝repo commit b687e5b；線上三檔以「字元數＋SHA-256」比對一致：程式碼.gs 55296／a35dfdb14f4932c9、v2_extensions.gs 62776／7cc5de8d65b13e54、c_verify.gs 22938／289813371f55b895；v33_digest.gs 15425／73c643b5781fa556 線上原本就與 repo 一致）

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
