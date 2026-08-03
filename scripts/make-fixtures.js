#!/usr/bin/env node
/**
 * 用假手冊跑一次完整管線，把產物寫成 worker repo 的測試 fixture。
 *
 *   node scripts/make-fixtures.js ../plugin/worker/test/fixtures
 *
 * 這是**開發期工具**，不在 CI 跑。產物要 commit 進 worker repo，
 * 這樣 worker 的測試不必依賴 content repo 在旁邊。
 *
 * 每次改動渲染或索引邏輯後記得重跑，否則 worker 那邊測的是過期的索引格式。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { collectPages } from './lib/tree.js';
import { renderBlocks } from './lib/render.js';
import { buildPageFile, extractSummary, relativeLink } from './lib/page-file.js';
import { buildIndex, buildSearchIndex } from './lib/index-builder.js';
import { extractPageId } from './lib/notion.js';
import { makeSampleManual, ID } from '../test/sample-manual.js';

const outDir = process.argv[2];
if (!outDir) {
  console.error('用法：node scripts/make-fixtures.js <輸出目錄>');
  process.exit(1);
}

const client = makeSampleManual();
const { pages } = await collectPages(client, ID.root);
const pagesById = new Map(pages.map((page) => [page.id, page]));

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
    warnings: [],
  };
  const body = renderBlocks(page.blocks, ctx);
  return { page, body, contents: buildPageFile(page, body), summary: extractSummary(body) };
});

const index = buildIndex({ rootPageId: ID.root, entries: rendered });
const { index: searchIndex } = buildSearchIndex({ entries: rendered });

// 每頁的原文也一起輸出——worker 擷取片段時要讀。
const pageContents = Object.fromEntries(rendered.map(({ page, contents }) => [page.filePath, contents]));

const target = path.resolve(outDir);
await fs.mkdir(target, { recursive: true });
await fs.writeFile(path.join(target, 'INDEX.json'), `${JSON.stringify(index, null, 2)}\n`);
await fs.writeFile(path.join(target, 'search.json'), `${JSON.stringify(searchIndex, null, 2)}\n`);
await fs.writeFile(path.join(target, 'pages.json'), `${JSON.stringify(pageContents, null, 2)}\n`);

console.log(`寫出 ${rendered.length} 頁的 fixture → ${target}`);
console.log(`  INDEX.json    ${index.page_count} 頁`);
console.log(`  search.json   ${Object.keys(searchIndex.postings).length} 個 token`);
for (const { page } of rendered) console.log(`    ${page.filePath}`);
