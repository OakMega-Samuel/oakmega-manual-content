# OakMega 手冊內容 repo

這個 repo 的內容**由機器產生，不要手動編輯**。

`manual/`、`INDEX.json`、`search.json` 都是從 Notion 同步出來的產物。
手動改的東西會在下一輪同步時被蓋掉。要改內容請改 Notion。

```
Notion（唯一真實來源）
  │  GitHub Actions：每小時 + 可手動觸發
  ▼
manual/**.md      每頁一檔，含 front-matter
INDEX.json        目錄樹與摘要
search.json       BM25 倒排索引（中文 bigram）
  │
  ▼
oakmega-manual-plugin 的 Worker 讀這裡，提供 MCP 搜尋給 Claude
```

---

## 初次設定

### 1. 建立 Notion integration

到 [Notion Integrations](https://www.notion.so/my-integrations) 建一個 internal integration，
取得 token（`ntn_` 開頭）。

### 2. 把手冊母頁 connect 給它

**這步最常被漏掉。**「發布到網路」不等於 API 讀得到——公開頁面和 API 存取是兩套權限。

在 Notion 開啟手冊母頁 → 右上 `⋯` → **連結** → 選擇剛剛建立的 integration。
子頁面會自動繼承，不用一頁一頁設。

漏了這步，同步會拿到 `404 object_not_found`。

### 3. 設定 repo

Settings → Secrets and variables → Actions：

| 類型 | 名稱 | 值 |
|---|---|---|
| Secret | `NOTION_TOKEN` | 步驟 1 的 token |
| Variable | `NOTION_ROOT_PAGE_ID` | 手冊母頁的 page id 或網址 |

### 4. 手動跑一次

Actions → **Sync from Notion** → **Run workflow**。

---

## 本機執行

```bash
export NOTION_TOKEN='ntn_...' NOTION_ROOT_PAGE_ID='https://www.notion.so/...'
```

先做 dry run，寫到別的目錄，人工檢查過再說：

```bash
npm run sync:dry
```

```bash
npm test
```

零相依套件，不需要 `npm install`。需要 Node 20 以上。

---

## 設計上的幾個決定

**圖片不同步，只留 `[圖片：caption]` 佔位。**
Notion API 回傳的圖片是一小時就過期的 presigned S3 網址，寫進 markdown 隔天全是死連結。
而且手冊是給 Claude 讀的，圖片對回答沒有貢獻。需要看圖時，front-matter 裡的
`notion_url` 可以連回原文。

**輸出必須是決定性的。**
front-matter 裡沒有 `synced_at` 這種每次都變的欄位。有的話每小時的 cron 都會製造出
「每個檔都動過」的假 diff，workflow 裡「沒變就不 commit」那道閘門就形同虛設。
想知道內容多新看 `last_edited_time`，想知道同步何時跑看 git commit 時間。

**每次都全量重建。**
先清空 `manual/` 再寫入。手冊規模小，全量比增量乾淨，而且 Notion 上刪掉的頁面
會自動從 repo 消失，不需要另外處理刪除。

**檔名固定帶 page id 後 8 碼。**
作者改標題時檔案會改名，但 id 後綴不變，追蹤得出是同一頁。
純用標題當檔名的話，改個字就變成「刪一個檔 + 新增一個檔」，連結全斷。

**中文用 bigram 斷詞。**
`scripts/lib/tokenize.js` 在 plugin repo 的 Worker 有一份完全相同的副本，
**兩邊必須逐字一致**，否則搜尋會靜默失效。改動時兩邊一起改並把
`TOKENIZER_VERSION` 加一——Worker 會比對版本，不一致時在回應裡明講。

---

## 產生測試 fixture

改了渲染或索引邏輯後，要重新產生 Worker 那邊的測試 fixture：

```bash
node scripts/make-fixtures.js ../oakmega-manual-plugin/worker/test/fixtures
```

然後在 plugin repo 跑 `npm test`，確認搜尋品質沒有退步。
