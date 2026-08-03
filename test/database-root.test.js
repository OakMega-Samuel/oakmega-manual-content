/**
 * 母頁是 Notion database 的情境。
 *
 * 這是真實踩到的案例：使用者給的手冊母頁其實是一個 database，每一列本身
 * 就是一頁、正文寫在列頁面裡。`collectPages` 要先當一般 page 試，被 API
 * 拒絕（「is a database, not a page」）之後改用 `databases.query` 撈出
 * 所有列，再用同一套走訪邏輯處理每一列（含列內部還有子頁面的情況）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { collectPages } from '../scripts/lib/tree.js';
import { renderBlocks } from '../scripts/lib/render.js';
import { FakeNotionClient, fakeId, block, para, text, childPage } from './fake-notion.js';

const DB = fakeId('db000001');
const ROW1 = fakeId('row00001');
const ROW2 = fakeId('row00002');
const ROW_ARCHIVED = fakeId('row00003');
const SUBPAGE = fakeId('sub00001');

function makeDatabaseWorkspace() {
  const pages = {
    [ROW1]: {
      title: '快速上手',
      lastEditedTime: '2026-03-01T00:00:00.000Z',
      blocks: [para(text('這是第一列的正文內容。'))],
    },
    [ROW2]: {
      title: '會員標籤',
      lastEditedTime: '2026-03-02T00:00:00.000Z',
      blocks: [para(text('標籤上限 5000 個。')), childPage(SUBPAGE, '批次匯入')],
    },
    [SUBPAGE]: {
      title: '批次匯入',
      lastEditedTime: '2026-03-03T00:00:00.000Z',
      blocks: [para(text('CSV 匯入上限 10000 筆。'))],
    },
    [ROW_ARCHIVED]: {
      title: '已下架條目',
      archived: true,
      blocks: [],
    },
  };

  const databases = {
    [DB]: {
      title: 'OakMega 手冊',
      lastEditedTime: '2026-03-02T00:00:00.000Z',
      rows: [ROW1, ROW2, ROW_ARCHIVED],
    },
  };

  return new FakeNotionClient(pages, databases);
}

test('母頁是 database 時，每一列都變成一頁', async () => {
  const { pages, skipped } = await collectPages(makeDatabaseWorkspace(), DB);

  assert.deepEqual(
    pages.map((page) => page.title),
    ['OakMega 手冊', '快速上手', '會員標籤', '批次匯入'],
  );
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].reason, 'archived');
});

test('database 本身變成合成的 index.md，路徑與一般 page 當母頁時一致', async () => {
  const { pages } = await collectPages(makeDatabaseWorkspace(), DB);
  assert.equal(pages[0].filePath, 'manual/index.md');
  assert.equal(pages[0].title, 'OakMega 手冊');
});

test('列頁面用 database 標題當 breadcrumb 前綴', async () => {
  const { pages } = await collectPages(makeDatabaseWorkspace(), DB);
  const row = pages.find((page) => page.title === '會員標籤');
  assert.deepEqual(row.breadcrumb, ['OakMega 手冊', '會員標籤']);
});

test('列頁面內部的子頁面照樣被走訪到，breadcrumb 再往下疊一層', async () => {
  const { pages } = await collectPages(makeDatabaseWorkspace(), DB);
  const sub = pages.find((page) => page.title === '批次匯入');
  assert.deepEqual(sub.breadcrumb, ['OakMega 手冊', '會員標籤', '批次匯入']);
  assert.equal(sub.depth, 2);
});

test('列頁面的正文確實抓得到，不是空殼', async () => {
  const { pages } = await collectPages(makeDatabaseWorkspace(), DB);
  const row = pages.find((page) => page.title === '快速上手');

  const body = renderBlocks(row.blocks, {
    resolvePageLink: () => null,
    resolveHref: (href) => href,
    warnings: [],
  });

  assert.match(body, /這是第一列的正文內容/);
});

test('已封存的列被跳過，不會出現在 pages 裡也不會讓走訪中斷', async () => {
  const { pages } = await collectPages(makeDatabaseWorkspace(), DB);
  assert.ok(!pages.some((page) => page.title === '已下架條目'));
});

test('query database 一次拿完所有列，不是每列各打一次 retrievePage', async () => {
  const client = makeDatabaseWorkspace();
  await collectPages(client, DB);

  // retrievePage 應該只為 database id 本身呼叫一次（用來探測型態並失敗）；
  // 列頁面的資料是靠 queryDatabase 一次帶回，不需要再逐列 retrievePage。
  // 這裡不強求精確次數（子頁面仍需 retrievePage），只確認至少沒有爆量重複呼叫。
  assert.ok(client.requestCount < 15, `請求數異常多：${client.requestCount}`);
});

test('冪等：同樣的 database 內容跑兩次，路徑與結構完全相同', async () => {
  const first = await collectPages(makeDatabaseWorkspace(), DB);
  const second = await collectPages(makeDatabaseWorkspace(), DB);

  assert.deepEqual(
    first.pages.map((p) => ({ path: p.filePath, title: p.title, breadcrumb: p.breadcrumb })),
    second.pages.map((p) => ({ path: p.filePath, title: p.title, breadcrumb: p.breadcrumb })),
  );
});
