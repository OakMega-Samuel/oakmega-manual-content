/**
 * 走訪 Notion page tree，把每一頁的 block 內容抓齊。
 *
 * 分成兩趟是刻意的：要把某頁的內部連結改寫成相對路徑，得先知道**所有**頁面的
 * 最終檔案位置，所以第一趟只負責走訪與抓取，第二趟才渲染。
 */

import { NotionClient, normalizePageId, pageTitle } from './notion.js';
import { idSuffix } from './slug.js';

/**
 * @typedef {object} ManualPage
 * @property {string} id            正規化的 32 碼 page id
 * @property {string} title
 * @property {string[]} breadcrumb  從根到自己（含自己）的標題陣列
 * @property {string} filePath      相對於輸出根目錄，例如 `manual/aaaa1111.md`
 * @property {string} notionUrl
 * @property {string} lastEditedTime
 * @property {object[]} blocks      已展開 children 的 block tree
 * @property {number} depth
 */

const MANUAL_DIR = 'manual';

/**
 * 從 root page 出發走完整棵樹。
 *
 * @param {NotionClient} client
 * @param {string} rootPageId
 * @param {(message: string) => void} [log]
 * @returns {Promise<{pages: ManualPage[], skipped: {id: string, title: string, reason: string}[]}>}
 */
export async function collectPages(client, rootPageId, log = () => {}) {
  /** @type {ManualPage[]} */
  const pages = [];
  const skipped = [];
  const visited = new Set();

  /**
   * @param {string} pageId
   * @param {string[]} parentBreadcrumb
   * @param {number} depth
   * @param {string} [knownTitle] 來自 child_page block 的標題，省一次比對
   */
  async function visit(pageId, parentBreadcrumb, depth, knownTitle) {
    const id = normalizePageId(pageId);

    // Notion 允許同一頁被多處引用，走過就不再走，否則會無限遞迴。
    if (visited.has(id)) return;
    visited.add(id);

    const page = await client.retrievePage(id);

    if (page.archived || page.in_trash) {
      skipped.push({ id, title: knownTitle ?? '(已封存)', reason: 'archived' });
      return;
    }

    const title = pageTitle(page) || knownTitle || '未命名頁面';
    const breadcrumb = [...parentBreadcrumb, title];

    // 扁平、純 ASCII 的短路徑。
    //
    // 之前是「鏡射 Notion 階層 + 中文檔名」，repo 好瀏覽，但主要消費方式改成
    // 由 Claude 直接 fetch 網址之後就不划算了：中文檔名百分比編碼後，一個中文字
    // 要 9 個字元，150 頁的網址光是列進 INDEX.md 就要上萬個 token。
    // 階層與標題改由 INDEX.md 承載，那本來就是進入點。
    const isRoot = depth === 0;
    const filePath = isRoot ? `${MANUAL_DIR}/index.md` : `${MANUAL_DIR}/${idSuffix(id)}.md`;

    log(`${'  '.repeat(depth)}↳ ${title}`);

    const blocks = await fetchBlockTree(client, id);

    pages.push({
      id,
      title,
      breadcrumb,
      filePath,
      notionUrl: page.url ?? `https://www.notion.so/${id}`,
      lastEditedTime: page.last_edited_time ?? '',
      blocks,
      depth,
    });

    // 子頁面照它們在文件中出現的順序走訪，輸出的目錄結構才跟 Notion 一致。
    for (const child of findChildPages(blocks)) {
      await visit(child.id, breadcrumb, depth + 1, child.title);
    }
  }

  await visit(rootPageId, [], 0);
  return { pages, skipped };
}

/**
 * 遞迴抓某個 block 底下的所有內容。
 *
 * 遇到 child_page 就停——子頁面是獨立檔案，內容不該被灌進母頁，
 * 否則同一段文字會在索引裡出現兩次，搜尋結果也會互相打架。
 */
async function fetchBlockTree(client, blockId) {
  const blocks = await client.listBlockChildren(blockId);

  for (const block of blocks) {
    if (block.type === 'child_page' || block.type === 'child_database') continue;
    if (block.has_children) {
      block.children = await fetchBlockTree(client, block.id);
    }
  }

  return blocks;
}

/** 深入巢狀結構找出所有 child_page（作者可能把子頁放在 column 或 toggle 裡）。 */
function findChildPages(blocks) {
  const found = [];

  const walk = (list) => {
    for (const block of list ?? []) {
      if (block.type === 'child_page') {
        found.push({ id: normalizePageId(block.id), title: block.child_page?.title ?? '' });
        continue;
      }
      if (block.children) walk(block.children);
    }
  };

  walk(blocks);
  return found;
}
