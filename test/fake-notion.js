/**
 * 假的 Notion workspace，讓整條同步管線可以完全離線測試。
 *
 * 介面刻意跟 NotionClient 一模一樣（retrievePage / listBlockChildren / requestCount），
 * 所以 collectPages 分不出真假。丟出的錯誤也要是 NotionError 的實例——
 * `isDatabaseNotPageError` 會檢查 `instanceof NotionError`，丟一般 Error
 * 的話那個判斷式永遠是 false，測試會跟真實情境對不上。
 */

import { NotionError } from '../scripts/lib/notion.js';

/**
 * 把短代號補成 32 碼 page id，測試裡好讀。
 *
 * 往**左**補零，讓代號落在末 8 碼——檔名的 id 後綴取的正是末 8 碼，
 * 往右補的話每個假 id 的後綴都會是 00000000，全部撞在一起。
 * 傳 8 碼的代號時，後綴就剛好等於代號本身。
 */
export function fakeId(seed) {
  return seed.padStart(32, '0').slice(-32);
}

export const text = (content, annotations = {}, href = null) => ({
  type: 'text',
  plain_text: content,
  annotations: { bold: false, italic: false, strikethrough: false, code: false, ...annotations },
  href,
});

/**
 * 每個 block 都要有唯一 id。
 *
 * collectPages 抓子層時是拿 block.id 去 listBlockChildren 查的，
 * 所有 block 共用同一個 id 的話會撈到別人的小孩——表格之類的巢狀內容會整個消失，
 * 而且不報錯，只是默默不見。真實的 Notion block 本來就有唯一 id，
 * fixture 不比照辦理的話，測試就會對巢狀 block 形成盲區。
 */
let blockCounter = 0;

export const block = (type, data, children = [], id = null) => ({
  id: id ?? fakeId(`b${(blockCounter += 1).toString(16).padStart(7, '0')}`),
  type,
  [type]: data,
  ...(children.length ? { children } : {}),
  has_children: children.length > 0,
});

export const para = (...rich) => block('paragraph', { rich_text: rich });

/** child_page block —— 走訪時會被當成「這裡有個子頁面」。 */
export const childPage = (id, title) => block('child_page', { title }, [], id);

/**
 * @param {Record<string, {title: string, blocks: object[], lastEditedTime?: string, archived?: boolean}>} pages
 *   key 是 page id
 * @param {Record<string, {title: string, rows: string[], lastEditedTime?: string}>} [databases]
 *   key 是 database id，`rows` 是該 database 底下的 page id 列表（必須也出現在 `pages` 裡）。
 *   用來模擬「母頁其實是 database」的情境——對 database id 呼叫 `retrievePage`
 *   要拋出跟真實 API 一樣的「is a database, not a page」錯誤。
 */
export class FakeNotionClient {
  constructor(pages, databases = {}) {
    this.pages = pages;
    this.databases = databases;
    this.requestCount = 0;
  }

  async retrievePage(pageId) {
    this.requestCount += 1;

    if (this.databases[pageId]) {
      // 訊息文字照抄真實 Notion API 的錯誤格式（含連字號 UUID），
      // 確保 isDatabaseNotPageError 那條 regex 測的是真的會遇到的字串。
      const hyphenated = `${pageId.slice(0, 8)}-${pageId.slice(8, 12)}-${pageId.slice(12, 16)}-${pageId.slice(16, 20)}-${pageId.slice(20)}`;
      throw new NotionError(
        `Provided ID ${hyphenated} is a database, not a page. Use the retrieve database API instead.`,
        { status: 400, path: `/pages/${pageId}` },
      );
    }

    return this.#pageObject(pageId);
  }

  /** database 的中繼資料。 */
  async retrieveDatabase(databaseId) {
    this.requestCount += 1;
    const db = this.databases[databaseId];
    if (!db) {
      throw new NotionError(`Could not find database with ID: ${databaseId}`, { status: 404, path: `/databases/${databaseId}` });
    }

    return {
      id: databaseId,
      url: `https://www.notion.so/${databaseId}`,
      title: [{ plain_text: db.title }],
      last_edited_time: db.lastEditedTime ?? '2026-01-01T00:00:00.000Z',
    };
  }

  /** database 底下所有列，形狀跟 retrievePage 的回傳相同。 */
  async queryDatabase(databaseId) {
    this.requestCount += 1;
    const db = this.databases[databaseId];
    if (!db) {
      throw new NotionError(`Could not find database with ID: ${databaseId}`, { status: 404, path: `/databases/${databaseId}/query` });
    }

    return db.rows.map((rowId) => this.#pageObject(rowId));
  }

  #pageObject(pageId) {
    const page = this.pages[pageId];
    if (!page) {
      throw new NotionError(`Could not find page with ID: ${pageId}`, { status: 404, path: `/pages/${pageId}` });
    }

    return {
      id: pageId,
      url: `https://www.notion.so/${pageId}`,
      archived: page.archived ?? false,
      in_trash: page.archived ?? false,
      last_edited_time: page.lastEditedTime ?? '2026-01-01T00:00:00.000Z',
      properties: {
        title: { type: 'title', title: [{ plain_text: page.title }] },
      },
    };
  }

  async listBlockChildren(blockId) {
    this.requestCount += 1;

    // 先看是不是某一頁的根。
    if (this.pages[blockId]) return this.pages[blockId].blocks;

    // 否則是某個 block 的子層，從整棵樹裡找。
    for (const page of Object.values(this.pages)) {
      const found = findBlock(page.blocks, blockId);
      if (found) return found.children ?? [];
    }

    return [];
  }
}

function findBlock(blocks, id) {
  for (const block of blocks ?? []) {
    if (block.id === id) return block;
    const nested = findBlock(block.children, id);
    if (nested) return nested;
  }
  return null;
}
