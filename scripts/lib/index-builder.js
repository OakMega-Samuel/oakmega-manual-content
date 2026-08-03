/**
 * 產生 INDEX.json（目錄與摘要）與 search.json（BM25 倒排索引）。
 *
 * 搜尋的重活在**建置期**做完，Worker 只負責打分——這樣 MCP server 不需要
 * 讀任何一份 markdown 全文就能排序，回給模型的是已篩選過的片段而不是一大包內容。
 * 這是整個方案精準度與 token 效率的來源。
 */

import { accumulate, TOKENIZER_VERSION } from './tokenize.js';

/** 各欄位的權重。標題與標題階層命中，比內文出現一次有意義得多。 */
const WEIGHTS = {
  title: 3,
  heading: 3,
  breadcrumb: 2,
  body: 1,
};

/**
 * 出現在超過這個比例的文件裡就當停用詞剔除。
 * 中文 bigram 會產生大量「的一」「一個」這類無鑑別度的 token，
 * 留著只是讓索引變大、打分變糊。
 */
const STOPWORD_DOC_RATIO = 0.85;

/**
 * @typedef {object} RenderedEntry
 * @property {import('./tree.js').ManualPage} page
 * @property {string} body      渲染後的 markdown 正文
 * @property {string} summary
 */

/**
 * 目錄索引：給人看、也給 list_manual_sections 用。
 * @param {{rootPageId: string, entries: RenderedEntry[]}} input
 */
export function buildIndex({ rootPageId, entries }) {
  const pages = entries.map(({ page, summary }) => ({
    path: page.filePath,
    title: page.title,
    breadcrumb: page.breadcrumb,
    depth: page.depth,
    summary,
    notion_url: page.notionUrl,
    last_edited_time: page.lastEditedTime,
  }));

  // 「內容最後更新於何時」比「同步跑於何時」有意義，而且它是決定性的——
  // 用後者會讓每次 cron 都產生 diff，破壞「沒變就不 commit」。
  const contentLastEdited = pages
    .map((page) => page.last_edited_time)
    .filter(Boolean)
    .sort()
    .at(-1) ?? '';

  return {
    version: 1,
    root_page_id: rootPageId,
    content_last_edited: contentLastEdited,
    page_count: pages.length,
    tree: buildTree(entries),
    pages,
  };
}

/** 依 depth 還原巢狀結構（entries 是深度優先順序，所以一趟就能組回來）。 */
function buildTree(entries) {
  const roots = [];
  /** @type {{node: object, depth: number}[]} */
  const stack = [];

  for (const { page, summary } of entries) {
    const node = { path: page.filePath, title: page.title, summary, children: [] };

    while (stack.length && stack.at(-1).depth >= page.depth) stack.pop();

    if (stack.length) stack.at(-1).node.children.push(node);
    else roots.push(node);

    stack.push({ node, depth: page.depth });
  }

  return roots;
}

/**
 * BM25 倒排索引。
 *
 * postings 用扁平陣列 `[docIdx, tf, docIdx, tf, ...]` 而不是 `[[docIdx, tf], ...]`，
 * 是為了讓 Worker 少配置幾十萬個小陣列——同樣的資料，記憶體與 JSON 體積都小很多。
 *
 * @param {{entries: RenderedEntry[]}} input
 */
export function buildSearchIndex({ entries }) {
  const docs = [];
  /** @type {Map<string, number[]>} */
  const postings = new Map();
  /** @type {Map<string, number>} */
  const docFrequency = new Map();

  entries.forEach(({ page, body, summary }, docIndex) => {
    /** @type {Map<string, number>} */
    const termFrequencies = new Map();
    let length = 0;

    length += accumulate(termFrequencies, page.title, WEIGHTS.title);
    length += accumulate(termFrequencies, page.breadcrumb.join(' '), WEIGHTS.breadcrumb);
    length += accumulate(termFrequencies, extractHeadings(body).join(' '), WEIGHTS.heading);
    length += accumulate(termFrequencies, stripMarkdown(body), WEIGHTS.body);

    docs.push({
      path: page.filePath,
      title: page.title,
      breadcrumb: page.breadcrumb,
      summary,
      notion_url: page.notionUrl,
      len: length,
    });

    for (const [token, tf] of termFrequencies) {
      if (!postings.has(token)) postings.set(token, []);
      postings.get(token).push(docIndex, tf);
      docFrequency.set(token, (docFrequency.get(token) ?? 0) + 1);
    }
  });

  // 剔除幾乎每篇都有的 token。
  const stopwordThreshold = docs.length * STOPWORD_DOC_RATIO;
  let removed = 0;
  for (const [token, df] of docFrequency) {
    if (df > stopwordThreshold && docs.length > 4) {
      postings.delete(token);
      removed += 1;
    }
  }

  const totalLength = docs.reduce((sum, doc) => sum + doc.len, 0);

  return {
    index: {
      version: 1,
      // Worker 會拿自己那份 tokenizer 的版本跟這個比對。對不上代表兩邊斷詞規則已經漂移，
      // 索引 token 與查詢 token 不再相容——那會是「不報錯但搜不到」的靜默失效。
      tokenizer_version: TOKENIZER_VERSION,
      // 這兩個常數 Worker 端打分要用，寫在索引裡才不會兩邊各寫一份、改了一邊忘了另一邊。
      k1: 1.2,
      b: 0.75,
      doc_count: docs.length,
      avg_doc_length: docs.length ? totalLength / docs.length : 0,
      docs,
      // Map 直接 JSON.stringify 會變成 {}，要先轉物件。
      postings: Object.fromEntries(postings),
    },
    stats: { tokenCount: postings.size, stopwordsRemoved: removed },
  };
}

/** 取出所有標題文字，用來加權。 */
function extractHeadings(markdown) {
  return [...markdown.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => match[1]);
}

/**
 * 把 markdown 記號清掉再進索引。
 * 不清的話 `**` `##` `|` 這些符號會被當成分隔，把詞切碎。
 */
function stripMarkdown(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~|-]/g, ' ');
}
