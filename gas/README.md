# GAS 後端原始碼備份

來源：Apps Script 專案「Quote System API」
專案 ID: 1ULEfHbKEkBrnttftDah9wz_d3dAViqRoS-vflWxp34xIe_65GyaM-o7e
線上部署版本：**v40**（2026-07-26 21:59 部署，客戶主檔 customers 四個 action；v39＝同一次請求共用試算表連線；v38＝登入一併回傳今日待辦；v37＝batch）
部署作業 ID: AKfycbytSqCF0St1Gu8F_u8KW9rcKJnkkGAfrdaHYyrQ6wDKa19Z3TxZd-GRRi_3Ii3Ijv4i

本次快照時間：2026-07-26（v40；本機與線上以「字元數＋SHA-256」逐檔比對一致：程式碼.gs 54396／175d0e81e199、v2_extensions.gs 61484／859d74152fd3）

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
