/**
 * 檔名生成。
 *
 * 設計重點是**穩定性**：檔名結尾固定帶 page id 後 8 碼，所以作者在 Notion 改標題時，
 * 檔案會改名（diff 看得出來）但 id 後綴不變，很容易追蹤是同一頁；
 * 而純用標題當檔名的話，改個字就會變成「刪一個檔 + 新增一個檔」，連結全斷。
 *
 * 中文字保留不轉拼音：GitHub 上人看得懂，模型看到路徑也比較好判斷該讀哪一頁。
 * 代價是組 raw URL 時每段都要 encodeURIComponent，Worker 端有處理。
 */

/**
 * 白名單式清理：只保留字母與數字，其餘一律收斂成連字號。
 *
 * `\p{L}` 涵蓋中日韓等所有語言的文字，`\p{N}` 涵蓋各種數字。
 * 用白名單而非列黑名單，是因為標點種類多到列不完——光是破折號就有
 * `-` `—` `–` `―` `〜` `～` 好幾種，漏一個就會留在檔名裡。
 */
const NON_WORD = /[^\p{L}\p{N}]+/gu;

const MAX_SLUG_LENGTH = 60;

/**
 * 把標題轉成安全的 slug（不含 id 後綴）。
 * 全部被濾掉時回空字串，由 pageFileName 決定 fallback。
 */
export function slugify(title) {
  if (typeof title !== 'string') return '';

  return title
    .normalize('NFKC')
    .replace(NON_WORD, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, MAX_SLUG_LENGTH)
    // 截斷可能又在結尾留下連字號。
    .replace(/-+$/, '');
}

/** page id 後 8 碼，當作檔名的穩定後綴。 */
export function idSuffix(pageId) {
  return pageId.replace(/-/g, '').toLowerCase().slice(-8);
}

/**
 * 產生某一頁的檔名，例如「快速上手」→ `快速上手-1a2b3c4d.md`。
 * 標題全是特殊符號或空白時退回 `page-1a2b3c4d.md`。
 */
export function pageFileName(title, pageId) {
  const slug = slugify(title);
  return `${slug || 'page'}-${idSuffix(pageId)}.md`;
}

/** 檔名去掉 .md，用來當「這一頁的子頁面放哪個資料夾」。 */
export function pageDirName(title, pageId) {
  return pageFileName(title, pageId).replace(/\.md$/, '');
}
