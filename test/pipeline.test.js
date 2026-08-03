import { test } from 'node:test';
import assert from 'node:assert/strict';

import { collectPages } from '../scripts/lib/tree.js';
import { renderBlocks } from '../scripts/lib/render.js';
import { buildPageFile, extractSummary, relativeLink } from '../scripts/lib/page-file.js';
import { buildIndex, buildSearchIndex } from '../scripts/lib/index-builder.js';
import { extractPageId } from '../scripts/lib/notion.js';
import { FakeNotionClient, fakeId, block, para, text, childPage } from './fake-notion.js';

// --- 一份小型但涵蓋各種狀況的假手冊 -----------------------------------------

const ROOT = fakeId('aaaa0001');
const GUIDE = fakeId('bbbb0002');
const STEP1 = fakeId('cccc0003');
const TAGS = fakeId('dddd0004');
const GONE = fakeId('eeee0005');

function makeWorkspace() {
  return new FakeNotionClient({
    [ROOT]: {
      title: 'OakMega 使用手冊',
      lastEditedTime: '2026-02-01T00:00:00.000Z',
      blocks: [
        para(text('這是 OakMega 的產品說明手冊。')),
        childPage(GUIDE, '快速上手'),
        childPage(TAGS, '會員標籤管理'),
        childPage(GONE, '已下架的舊功能'),
      ],
    },
    [GUIDE]: {
      title: '快速上手',
      lastEditedTime: '2026-03-15T00:00:00.000Z',
      blocks: [
        para(text('依序完成以下步驟即可開始使用。')),
        block('numbered_list_item', { rich_text: [text('建立 Workspace')] }),
        block('numbered_list_item', { rich_text: [text('綁定 LINE 官方帳號')] }),
        // 指向手冊內另一頁的連結，應該被改寫成相對路徑
        para(text('接著請參考 '), text('會員標籤管理', {}, `https://www.notion.so/Tags-${TAGS}`)),
        // Notion 託管的圖片，必須被轉成佔位
        block('image', {
          type: 'file',
          file: { url: 'https://prod-files-secure.s3.us-west-2.amazonaws.com/x?X-Amz-Expires=3600' },
          caption: [text('後台首頁')],
        }),
        childPage(STEP1, '第一步：建立 Workspace'),
      ],
    },
    [STEP1]: {
      title: '第一步：建立 Workspace',
      lastEditedTime: '2026-03-20T00:00:00.000Z',
      blocks: [para(text('在後台點選右上角的「新增 Workspace」。'))],
    },
    [TAGS]: {
      title: '會員標籤管理',
      lastEditedTime: '2026-04-01T00:00:00.000Z',
      blocks: [
        block('heading_2', { rich_text: [text('標籤的用途')] }),
        para(text('標籤用來分眾，可以依標籤篩選會員並發送推播。')),
        block('heading_2', { rich_text: [text('批次匯入標籤')] }),
        para(text('支援 CSV 批次匯入，每次上限 10000 筆。')),
      ],
    },
    [GONE]: { title: '已下架的舊功能', archived: true, blocks: [] },
  });
}

/** 跑完整條管線，回傳寫檔前的所有中間結果。 */
async function runPipeline(client = makeWorkspace()) {
  const { pages, skipped } = await collectPages(client, ROOT);
  const pagesById = new Map(pages.map((page) => [page.id, page]));
  const warnings = [];

  const rendered = pages.map((page) => {
    const resolvePageLink = (targetId) => {
      const target = pagesById.get(targetId);
      return target ? relativeLink(page.filePath, target.filePath) : null;
    };
    const ctx = {
      resolvePageLink,
      resolveHref: (href) => {
        const id = extractPageId(href);
        return (id && resolvePageLink(id)) || href;
      },
      warnings,
    };
    const body = renderBlocks(page.blocks, ctx);
    return { page, body, contents: buildPageFile(page, body), summary: extractSummary(body) };
  });

  return { pages, skipped, rendered, warnings };
}

const byPath = (rendered, suffix) => rendered.find((entry) => entry.page.filePath.endsWith(suffix));

// --- 走訪與檔案配置 ----------------------------------------------------------

test('走訪抓到所有未封存頁面，封存頁被略過', async () => {
  const { pages, skipped } = await runPipeline();

  assert.deepEqual(
    pages.map((page) => page.title),
    ['OakMega 使用手冊', '快速上手', '第一步：建立 Workspace', '會員標籤管理'],
  );
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].reason, 'archived');
});

test('路徑是扁平的純 ASCII 短碼，母頁是 index.md', async () => {
  // 之所以不鏡射 Notion 階層、也不用中文檔名：主要消費方式是讓 Claude 直接 fetch 網址，
  // 中文經百分比編碼後一個字要 9 個字元，整份目錄的網址會吃掉上萬個 token。
  // 階層改由 INDEX.md 承載。
  const { pages } = await runPipeline();
  const paths = pages.map((page) => page.filePath);

  assert.deepEqual(paths, [
    'manual/index.md',
    'manual/bbbb0002.md',
    'manual/cccc0003.md',
    'manual/dddd0004.md',
  ]);
});

test('路徑不含任何需要編碼的字元', async () => {
  const { pages } = await runPipeline();
  for (const page of pages) {
    assert.equal(
      encodeURI(page.filePath),
      page.filePath,
      `${page.filePath} 含有需要百分比編碼的字元`,
    );
  }
});

test('檔名就是 page id 後 8 碼，改標題也追蹤得到是同一頁', async () => {
  const { pages } = await runPipeline();
  for (const page of pages.slice(1)) {
    assert.match(page.filePath, /^manual\/[0-9a-f]{8}\.md$/, `${page.filePath} 格式不對`);
  }
});

test('breadcrumb 從根累積到自己', async () => {
  const { pages } = await runPipeline();
  const step1 = pages.find((page) => page.title.startsWith('第一步'));
  assert.deepEqual(step1.breadcrumb, ['OakMega 使用手冊', '快速上手', '第一步：建立 Workspace']);
});

// --- 渲染結果 ----------------------------------------------------------------

test('內部 Notion 連結被改寫成相對路徑', async () => {
  const { rendered } = await runPipeline();
  const guide = byPath(rendered, 'bbbb0002.md');

  assert.match(guide.body, /\[會員標籤管理\]\(\.\/dddd0004\.md\)/);
  assert.doesNotMatch(guide.body, /notion\.so/, '站內連結不該留下 Notion 網址');
});

test('輸出裡沒有任何會過期的 S3 網址', async () => {
  const { rendered } = await runPipeline();
  for (const { page, contents } of rendered) {
    assert.doesNotMatch(contents, /amazonaws\.com/, `${page.filePath} 留下了會過期的網址`);
  }
});

test('圖片被轉成帶 caption 的佔位', async () => {
  const { rendered } = await runPipeline();
  assert.match(byPath(rendered, 'bbbb0002.md').body, /\[圖片：後台首頁\]/);
});

test('front-matter 欄位齊全且沒有會漂移的時間戳', async () => {
  const { rendered } = await runPipeline();
  const { contents } = byPath(rendered, 'dddd0004.md');

  assert.match(contents, /^---\n/);
  assert.match(contents, /\ntitle: 會員標籤管理\n/);
  assert.match(contents, new RegExp(`\\nnotion_page_id: ${TAGS}\\n`));
  assert.match(contents, /\nlast_edited_time: "2026-04-01T00:00:00\.000Z"\n/);
  assert.match(contents, /\nbreadcrumb:\n {2}- OakMega 使用手冊\n {2}- 會員標籤管理\n/);
  assert.doesNotMatch(contents, /synced_at/, 'synced_at 會讓每次同步都產生假 diff');
});

test('全形冒號的標題不需要引號，原樣寫入即可', async () => {
  const { rendered } = await runPipeline();
  const { contents } = byPath(rendered, 'cccc0003.md');
  // YAML 只把 ASCII 的「: 」當 key 分隔，全形「：」是普通字元。
  assert.match(contents, /\ntitle: 第一步：建立 Workspace\n/);
});

test('子頁面在母頁裡只留連結，內容不重複展開', async () => {
  const { rendered } = await runPipeline();
  const guide = byPath(rendered, 'bbbb0002.md');

  assert.match(guide.body, /- \[第一步：建立 Workspace\]\(/);
  assert.doesNotMatch(guide.body, /新增 Workspace/, '子頁內容不該被灌進母頁');
});

// --- 決定性（決定「沒變就不 commit」能不能成立）------------------------------

test('同樣的內容跑兩次產生完全相同的輸出', async () => {
  const first = await runPipeline();
  const second = await runPipeline();

  assert.deepEqual(
    first.rendered.map((entry) => entry.contents),
    second.rendered.map((entry) => entry.contents),
  );

  const indexOf = (run) => JSON.stringify(buildIndex({ rootPageId: ROOT, entries: run.rendered }));
  assert.equal(indexOf(first), indexOf(second));

  const searchOf = (run) => JSON.stringify(buildSearchIndex({ entries: run.rendered }).index);
  assert.equal(searchOf(first), searchOf(second));
});

// --- 索引 --------------------------------------------------------------------

test('INDEX.json 的 content_last_edited 取所有頁面的最新值', async () => {
  const { rendered } = await runPipeline();
  const index = buildIndex({ rootPageId: ROOT, entries: rendered });

  assert.equal(index.page_count, 4);
  assert.equal(index.content_last_edited, '2026-04-01T00:00:00.000Z');
});

test('INDEX.json 的 tree 還原出巢狀結構', async () => {
  const { rendered } = await runPipeline();
  const { tree } = buildIndex({ rootPageId: ROOT, entries: rendered });

  assert.equal(tree.length, 1);
  assert.equal(tree[0].title, 'OakMega 使用手冊');
  assert.deepEqual(
    tree[0].children.map((node) => node.title),
    ['快速上手', '會員標籤管理'],
  );
  assert.deepEqual(
    tree[0].children[0].children.map((node) => node.title),
    ['第一步：建立 Workspace'],
  );
});

test('摘要是去掉 markdown 記號的純文字', async () => {
  const { rendered } = await runPipeline();
  const tags = byPath(rendered, 'dddd0004.md');

  assert.match(tags.summary, /標籤的用途/);
  assert.doesNotMatch(tags.summary, /[#*|]/);
});

test('search.json 帶齊 BM25 打分需要的參數', async () => {
  const { rendered } = await runPipeline();
  const { index } = buildSearchIndex({ entries: rendered });

  assert.equal(index.doc_count, 4);
  assert.ok(index.avg_doc_length > 0);
  assert.equal(index.k1, 1.2);
  assert.equal(index.b, 0.75);
  assert.equal(index.docs.length, 4);
});

test('postings 是扁平的 [docIdx, tf, ...]，中文查得到', async () => {
  const { rendered } = await runPipeline();
  const { index } = buildSearchIndex({ entries: rendered });

  // 「標籤」是 bigram 切出來的 token，必須存在且指到「會員標籤管理」那頁
  const posting = index.postings['標籤'];
  assert.ok(posting, 'bigram「標籤」必須進得了索引');
  assert.equal(posting.length % 2, 0, 'postings 必須是成對的扁平陣列');

  const docIndexes = posting.filter((_, i) => i % 2 === 0);
  const tagsDoc = index.docs.findIndex((doc) => doc.title === '會員標籤管理');
  assert.ok(docIndexes.includes(tagsDoc));
});

test('標題命中的權重高於內文命中', async () => {
  const { rendered } = await runPipeline();
  const { index } = buildSearchIndex({ entries: rendered });

  const tagsDoc = index.docs.findIndex((doc) => doc.title === '會員標籤管理');
  const posting = index.postings['標籤'];

  let tfInTagsPage = 0;
  for (let i = 0; i < posting.length; i += 2) {
    if (posting[i] === tagsDoc) tfInTagsPage = posting[i + 1];
  }

  // 標題 ×3 + breadcrumb ×2 + 內文若干，一定超過純內文出現一次的權重
  assert.ok(tfInTagsPage >= 5, `標題頁的加權詞頻應該明顯偏高，實際 ${tfInTagsPage}`);
});

// --- 巢狀 block 走完整條管線（曾經是盲區）------------------------------------

test('表格內容經過 fetchBlockTree 之後仍然存在', async () => {
  // 表格的儲存格是 table_row 子 block，必須靠 block.id 去撈。
  // 這條路徑一度沒被測到，導致表格默默從輸出中消失卻沒人發現。
  const { makeSampleManual, ID } = await import('./sample-manual.js');
  const { pages } = await collectPages(makeSampleManual(), ID.root);

  const importPage = pages.find((page) => page.title === '批次匯入標籤');
  const body = renderBlocks(importPage.blocks, {
    resolvePageLink: () => null,
    resolveHref: (href) => href,
    warnings: [],
  });

  assert.match(body, /\| 欄位 \| 必填 \| 說明 \|/, '表頭必須存在');
  assert.match(body, /member_id/, '表格內容必須存在');
  assert.match(body, /tag_name/);
});

test('多層巢狀清單不會因為抓錯子層而遺失內容', async () => {
  const { makeSampleManual, ID } = await import('./sample-manual.js');
  const { pages } = await collectPages(makeSampleManual(), ID.root);

  const segment = pages.find((page) => page.title === '分眾推播');
  const body = renderBlocks(segment.blocks, {
    resolvePageLink: () => null,
    resolveHref: (href) => href,
    warnings: [],
  });

  for (const expected of ['標籤：包含或不包含指定標籤', '會員欄位', '預估受眾']) {
    assert.match(body, new RegExp(expected), `遺失內容：${expected}`);
  }
});
