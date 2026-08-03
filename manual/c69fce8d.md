---
title: 網頁型工具設定
notion_page_id: 105ccd367ae8806fa9d5d903c69fce8d
notion_url: https://app.notion.com/p/105ccd367ae8806fa9d5d903c69fce8d
last_edited_time: "2025-02-24T10:17:00.000Z"
breadcrumb:
  - OakMega 使用手冊
  - 網頁型工具設定
---

# 網頁型工具設定

**目錄**

> 💡 備註：
>
> OakMega Social CRM 從「授權頁面」功能開始，將後續開發的網頁型模組或功能統稱為網頁型工具，可能包含授權頁面、表單或其他模組。這些新開發的網頁型工具可以自由設定子網域或分頁圖標，讓網頁功能更具有品牌性，在未來也可以設定多種登入平台，讓同樣的功能可以無縫接軌於多個通訊平台。

[圖片]

- 點擊左下角的設定符號，選擇「網頁型工具設定」

# 1. 網域設定

- 點擊上方 Tab 選擇「網域設定」

## **Subdomain**

- Subdomain 可以讓你自訂部分網域，增強網址的品牌性，實際格式為：
https://**brandname**.oakmega.site/…
- 系統不會幫你設定預設的 Subdomain，在使用任何網頁型工具之前，請先設定 Subdomain

[圖片]

- 點擊「編輯 Subdomain」
- 系統會打開編輯 Subdomain 的彈窗

[圖片]

- 設定好子網域之後按下確認即可

> 💡 備註：
>
> - Subdomain 可使用小寫英文、數字以及「-」 連字號（連字號不可用於開頭或結尾）。
> - 更改 Subdomain 後，使用舊 Subdomain 的連接將全部失效。
> - Subdomain 具有唯一性，請使用自己的品牌名稱作為 Subdomain，避免使用常見的單詞例如 test 或 default，以免與別的品牌衝突。

---

## **Favicon**

- Favicon 為網頁上顯示的瀏覽器分頁圖標，建議可設定為品牌的 Logo

[圖片]

- 點擊 Favicon 右側的上傳檔案區塊，即可上傳圖檔
- Favicon 檔案格式限 PNG，32 x 32px，檔案上限 10MB

---

# 2. 登入平台

- 點擊上方 Tab 選擇「登入平台」
- 目前登入平台僅開放 LINE
- 由於新的網頁型工具需要綁定至新的網域，故需要在原本的 LINE Login 當中重新建立 LIFF 以供使用，詳細流程請參考：[[3. 建立網頁型工具專用 LIFF](./c69fce8d.md)](https://app.notion.com/p/105ccd367ae8806fa9d5d903c69fce8d#105ccd367ae880659385f92ecda62ce3)

[圖片]

- 點擊「編輯 LIFF ID」

[圖片]

- 將建立好的 LIFF ID 複製並貼上在彈窗中，並點擊確認

---

# 3. 建立網頁型工具專用 LIFF

[圖片]

- 至 [LINE Developer](https://developers.line.biz/console/) 後台，於官方帳號的 Provider 中，選擇已綁定至官方帳號 Messaging API 的 LINE login，即目前綁定至 OakMega Social CRM 的 LINE Login

[圖片]

- 切換至 LIFF 分頁，並點擊 Add 按鈕

[圖片]

- 依序填寫以下設定
  - LIFF app name：不限制，但建議寫 OakMega Login 或品牌名稱
  - Size：full
  - Endpoint URL：https://{subdomain}.oakmega.site/liff-login
    - 請把中間的 subdomain 置換為自己的 subdomain
    - 例如，subdomain 為 banana，則 Endpoint URL 應該設定為：https://banana.oakmega.site/liff-login
  - Scopes：profile, openid
  - Add friend option：on (aggressive)
  - Scan QR：關閉（不勾選）
  - Module mode：關閉（不勾選）
- 點擊 Add 按鈕

[圖片]

- 回到 LIFF 列表頁，找到剛剛新增的 LIFF，點擊複製 LIFF ID
- 複製 LIFF ID 之後，即可回到 OakMega Social CRM 後台進行設定，詳細流程可參考：[[2. 登入平台](./c69fce8d.md)](https://app.notion.com/p/105ccd367ae8806fa9d5d903c69fce8d#105ccd367ae880cd87e1cfe9c679410f)
