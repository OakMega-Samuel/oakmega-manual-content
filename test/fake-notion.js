/**
 * 假的 Notion workspace，讓整條同步管線可以完全離線測試。
 *
 * 介面刻意跟 NotionClient 一模一樣（retrievePage / listBlockChildren / requestCount），
 * 所以 collectPages 分不出真假。
 */

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
 */
export class FakeNotionClient {
  constructor(pages) {
    this.pages = pages;
    this.requestCount = 0;
  }

  async retrievePage(pageId) {
    this.requestCount += 1;
    const page = this.pages[pageId];
    if (!page) {
      const err = new Error(`Could not find page with ID: ${pageId}`);
      err.status = 404;
      throw err;
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
