/**
 * INDEX.md 與 MANUAL.md 的產出。
 *
 * 這兩份是客戶路徑上唯一的東西——Claude 就是靠它們找內容，
 * 所以這裡測的每一條都直接對應「模型會不會拿錯資料」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildIndexMarkdown, buildManualBundle, totalContentChars } from '../scripts/lib/web-index.js';

const BASE = 'https://raw.githubusercontent.com/OakMega-Samuel/oakmega-manual-content/main';

const entry = (id, title, depth, body, breadcrumb) => ({
  page: {
    id,
    title,
    depth,
    breadcrumb: breadcrumb ?? [title],
    filePath: depth === 0 ? 'manual/index.md' : `manual/${id}.md`,
    notionUrl: `https://www.notion.so/${id}`,
  },
  body,
  summary: body.slice(0, 60),
});

const SMALL = [
  entry('a0000001', 'OakMega 使用手冊', 0, '本手冊說明各項功能。'),
  entry('a0000002', '會員標籤', 1, '標籤用來分眾。上限 5000 個。', ['OakMega 使用手冊', '會員標籤']),
];

// --- INDEX.md ---------------------------------------------------------------

test('每一頁都給完整可直接 fetch 的絕對網址', () => {
  const md = buildIndexMarkdown({ baseUrl: BASE, entries: SMALL, contentLastEdited: '', totalChars: 100 });

  assert.match(md, new RegExp(`${BASE}/manual/index\\.md`));
  assert.match(md, new RegExp(`${BASE}/manual/a0000002\\.md`));
});

test('網址不含需要編碼的字元，模型複製貼上就能用', () => {
  const md = buildIndexMarkdown({ baseUrl: BASE, entries: SMALL, contentLastEdited: '', totalChars: 100 });

  for (const url of md.match(/https:\/\/\S+/g) ?? []) {
    assert.equal(encodeURI(url), url, `${url} 含有需要編碼的字元`);
    assert.doesNotMatch(url, /%/, `${url} 已被編碼過，模型讀起來會混淆`);
  }
});

test('階層用縮排表現，模型看得出主題的從屬關係', () => {
  const md = buildIndexMarkdown({ baseUrl: BASE, entries: SMALL, contentLastEdited: '', totalChars: 100 });
  const lines = md.split('\n');

  assert.ok(lines.some((l) => l.startsWith('- **OakMega 使用手冊**')));
  assert.ok(lines.some((l) => l.startsWith('  - **會員標籤**')));
});

test('手冊夠小時明確叫模型直接抓全文', () => {
  const md = buildIndexMarkdown({ baseUrl: BASE, entries: SMALL, contentLastEdited: '', totalChars: 5_000 });

  assert.match(md, /直接抓全文最準/);
  assert.match(md, new RegExp(`${BASE}/MANUAL\\.md`));
});

test('手冊太大時改叫模型先挑頁，並明講不要抓全文', () => {
  const md = buildIndexMarkdown({ baseUrl: BASE, entries: SMALL, contentLastEdited: '', totalChars: 500_000 });

  assert.match(md, /先從下面的目錄挑出相關頁面/);
  assert.match(md, /不要抓全文合併檔/);
  assert.doesNotMatch(md, /直接抓全文最準/);
});

test('策略在建置期就決定好，不丟給模型自己判斷手冊大小', () => {
  // 同一份內容、不同字數 → 產出不同的指示。若把判斷留給模型，
  // 它每次的結論可能不一樣，行為就不穩定。
  const small = buildIndexMarkdown({ baseUrl: BASE, entries: SMALL, contentLastEdited: '', totalChars: 1_000 });
  const large = buildIndexMarkdown({ baseUrl: BASE, entries: SMALL, contentLastEdited: '', totalChars: 999_999 });

  assert.notEqual(small, large);
});

test('標明頁數與更新時間，讓人與模型都知道資料多新', () => {
  const md = buildIndexMarkdown({
    baseUrl: BASE,
    entries: SMALL,
    contentLastEdited: '2026-05-12T00:00:00.000Z',
    totalChars: 1234,
  });

  assert.match(md, /共 2 頁/);
  assert.match(md, /1,234 字/);
  assert.match(md, /2026-05-12/);
});

test('base URL 結尾多餘的斜線不會產生雙斜線網址', () => {
  const md = buildIndexMarkdown({
    baseUrl: `${BASE}/`,
    entries: SMALL,
    contentLastEdited: '',
    totalChars: 100,
  });

  assert.doesNotMatch(md, /main\/\/manual/);
});

// --- MANUAL.md --------------------------------------------------------------

test('全文合併檔包含每一頁的內容與 Notion 出處', () => {
  const bundle = buildManualBundle({ entries: SMALL, contentLastEdited: '2026-05-12T00:00:00.000Z' });

  assert.match(bundle, /本手冊說明各項功能。/);
  assert.match(bundle, /標籤用來分眾。上限 5000 個。/);
  assert.match(bundle, /https:\/\/www\.notion\.so\/a0000002/);
});

test('全文合併檔用 breadcrumb 當段落標題，模型知道現在讀到哪一節', () => {
  const bundle = buildManualBundle({ entries: SMALL, contentLastEdited: '' });

  assert.match(bundle, /## OakMega 使用手冊 › 會員標籤/);
});

test('totalContentChars 累加所有頁面的正文長度', () => {
  assert.equal(totalContentChars(SMALL), SMALL[0].body.length + SMALL[1].body.length);
  assert.equal(totalContentChars([]), 0);
});
