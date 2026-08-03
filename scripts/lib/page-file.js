/**
 * 組出最終要寫進 repo 的 .md 檔內容，以及索引要用的摘要。
 *
 * **輸出必須是決定性的**：同樣的 Notion 內容一定要產生位元組完全相同的檔案。
 * 所以 front-matter 裡沒有 `synced_at` 這種每次都變的欄位——加了的話每小時的
 * cron 都會製造出「每個檔都動過」的假 diff，`git diff --cached --quiet` 那道
 * 「沒變就不 commit」的閘門就形同虛設。
 *
 * 想知道「內容多新」看 `last_edited_time`（Notion 給的，有意義）；
 * 想知道「同步跑於何時」看 git commit 時間，那才是它該待的地方。
 */

import path from 'node:path/posix';

/** YAML 純量：能裸寫就裸寫，有疑慮就用雙引號包起來。 */
function yamlScalar(value) {
  const text = String(value ?? '');
  const needsQuoting =
    text === '' ||
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(text) ||
    // 只有 ASCII 的「冒號 + 空白」會被 YAML 當成 key 分隔；全形「：」是普通字元，不用引號。
    /: |\t|\n|#/.test(text) ||
    /^\s|\s$/.test(text) ||
    /^(true|false|null|~|-?\d+(\.\d+)?)$/i.test(text) ||
    // 日期樣式在 YAML 1.1 會被自動轉成 Date 物件，加引號釘死成字串比較安全。
    /^\d{4}-\d{2}-\d{2}/.test(text);

  if (!needsQuoting) return text;
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * 組出完整檔案內容（front-matter + 正文）。
 * @param {import('./tree.js').ManualPage} page
 * @param {string} body 已渲染好的 markdown 正文
 */
export function buildPageFile(page, body) {
  const lines = [
    '---',
    `title: ${yamlScalar(page.title)}`,
    `notion_page_id: ${page.id}`,
    `notion_url: ${yamlScalar(page.notionUrl)}`,
    `last_edited_time: ${yamlScalar(page.lastEditedTime)}`,
    'breadcrumb:',
    ...page.breadcrumb.map((crumb) => `  - ${yamlScalar(crumb)}`),
    '---',
    '',
    `# ${page.title}`,
    '',
  ];

  const content = body.trim();
  if (content) lines.push(content, '');

  return lines.join('\n');
}

/**
 * 從渲染後的 markdown 抽一段純文字摘要，給 INDEX.json 與搜尋結果用。
 * 目的是讓模型光看索引就能判斷「這頁是不是我要的」，所以要把 markdown 記號清掉。
 */
export function extractSummary(markdown, maxLength = 200) {
  const plain = markdown
    // 「整行只是一個連往子頁面的連結」的行先拿掉。
    // 這些是 child_page 產生的導覽連結，剝掉 markdown 後只剩一串子頁標題，
    // 而那些標題在 INDEX.md 的下一層本來就會列出來，留在摘要裡純粹是重複佔位。
    .replace(/^\s*-\s*\[[^\]]*\]\([^)]*\.md\)\s*$/gm, '')
    // 程式碼區塊整段拿掉——摘要出現半截程式碼沒有幫助。
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    // 連結只留文字。
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<https?:\/\/[^>]*>/g, ' ')
    // 各種行首記號與強調符號。
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+(\[[ x]\]\s*)?/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/^\s*-{3,}\s*$/gm, ' ')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (plain.length <= maxLength) return plain;
  return `${plain.slice(0, maxLength).trimEnd()}…`;
}

/**
 * 算出從 `fromFile` 連到 `toFile` 的相對路徑，並確保結果是 markdown 認得的相對連結
 * （同目錄的檔案要有 `./` 前綴，否則某些渲染器會當成別的東西）。
 */
export function relativeLink(fromFile, toFile) {
  const rel = path.relative(path.dirname(fromFile), toFile);
  return rel.startsWith('.') ? rel : `./${rel}`;
}
