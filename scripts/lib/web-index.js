/**
 * 產生給「Claude 直接 fetch」用的兩份檔案。
 *
 * 這條路取代了原本的 MCP server：Team 方案要加 custom connector 得過 owner 審核，
 * 對一份要推廣給客戶的手冊而言等於死路，所以改成讓 Claude 用 web fetch 直接讀公開 repo。
 *
 * 代價是失去 server 端的 BM25 排序，改由模型自己看目錄挑。因此這裡的重點全在
 * **讓模型一次就挑對**：
 *
 *   - INDEX.md 直接寫**完整可抓的絕對網址**，模型只要複製，永遠不用自己拼網址
 *   - 每頁附一句摘要與所在階層，讓「挑哪一頁」有依據
 *   - 頁面路徑是純 ASCII 短碼（見 tree.js），網址短，整份目錄才塞得進 context
 *   - 另外產一份 MANUAL.md 全文合併檔：手冊夠小的話，一次抓完比任何檢索都準
 */

/** 超過這個字數就不建議整本抓，改走「先讀 INDEX 再抓單頁」。 */
const BUNDLE_CHAR_LIMIT = 120_000;

/**
 * 把 repo 內路徑轉成可直接 fetch 的絕對網址。
 * 路徑本身已經是純 ASCII，不需要編碼，但仍保險處理一次。
 */
function rawUrl(baseUrl, repoPath) {
  const encoded = repoPath.split('/').map(encodeURIComponent).join('/');
  return `${baseUrl.replace(/\/+$/, '')}/${encoded}`;
}

/**
 * 目錄檔。這是模型的進入點，也是人在 GitHub 上瀏覽的進入點。
 *
 * @param {object} input
 * @param {string} input.baseUrl        raw.githubusercontent 的 repo 根網址
 * @param {import('./index-builder.js').RenderedEntry[]} input.entries
 * @param {string} input.contentLastEdited
 * @param {number} input.totalChars     全文總字數，用來判斷能不能整本抓
 */
export function buildIndexMarkdown({ baseUrl, entries, contentLastEdited, totalChars }) {
  const bundleFits = totalChars <= BUNDLE_CHAR_LIMIT;
  const bundleUrl = rawUrl(baseUrl, 'MANUAL.md');

  const lines = [
    '# OakMega 手冊目錄',
    '',
    '> 這個檔案是自動產生的，內容來源是 Notion，每小時同步一次。不要手動編輯。',
    '',
    `共 ${entries.length} 頁，約 ${totalChars.toLocaleString('en-US')} 字。`,
    `內容最後更新：${contentLastEdited || '未知'}`,
    '',
    '## 給 Claude 的取用方式',
    '',
  ];

  // 建議策略在建置期就算好寫死，不要讓模型自己判斷手冊大小——它判斷不了，
  // 而且每次判斷結果可能不一樣。
  if (bundleFits) {
    lines.push(
      `這份手冊夠小，**直接抓全文最準**，不需要先挑頁面：`,
      '',
      `    ${bundleUrl}`,
      '',
      '若只想針對單一主題，也可以從下面的目錄挑一頁抓。',
    );
  } else {
    lines.push(
      '這份手冊較大，請**先從下面的目錄挑出相關頁面，再抓那一頁的網址**。',
      '不要抓全文合併檔，會塞爆 context。',
      '',
      `真的需要全文時（例如要做整體盤點）才用：${bundleUrl}`,
    );
  }

  lines.push('', '## 目錄', '');

  for (const { page, summary } of entries) {
    const indent = '  '.repeat(page.depth);
    const url = rawUrl(baseUrl, page.filePath);

    lines.push(`${indent}- **${page.title}** — ${url}`);
    if (summary) lines.push(`${indent}  ${summary}`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * 全文合併檔。每頁之間用分隔線與標題隔開，並附上原始 Notion 連結，
 * 讓模型引用時仍能指回出處。
 */
export function buildManualBundle({ entries, contentLastEdited }) {
  const lines = [
    '# OakMega 使用手冊（全文）',
    '',
    '> 自動產生，來源為 Notion，每小時同步。不要手動編輯。',
    `> 內容最後更新：${contentLastEdited || '未知'}`,
    '',
  ];

  for (const { page, body } of entries) {
    lines.push(
      '---',
      '',
      `## ${page.breadcrumb.join(' › ')}`,
      '',
      `原文：${page.notionUrl}`,
      '',
      body.trim(),
      '',
    );
  }

  return lines.join('\n');
}

/** 全文總字數，決定要不要建議整本抓。 */
export function totalContentChars(entries) {
  return entries.reduce((sum, entry) => sum + entry.body.length, 0);
}
