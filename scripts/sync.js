#!/usr/bin/env node
/**
 * Notion → Markdown 同步。
 *
 *   node scripts/sync.js                     # 寫進 repo（CI 用）
 *   node scripts/sync.js --out /tmp/dry-run  # 寫到別處，供人工檢查
 *
 * 需要環境變數：
 *   NOTION_TOKEN         internal integration 的 token
 *   NOTION_ROOT_PAGE_ID  手冊母頁的 page id（也可用 --root 傳）
 *
 * 注意：「發布到網路」不等於 API 讀得到。母頁必須在 Notion 上 connect 給該 integration，
 * 子頁會自動繼承。少了這一步會拿到 404 object_not_found。
 *
 * 每次都是**全量重建**：先清空輸出目錄再寫入。手冊規模小，全量比增量乾淨，
 * 而且 Notion 上被刪掉的頁面會自動從 repo 消失，不需要另外處理刪除。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { NotionClient, extractPageId } from './lib/notion.js';
import { collectPages } from './lib/tree.js';
import { renderBlocks } from './lib/render.js';
import { buildPageFile, extractSummary, relativeLink } from './lib/page-file.js';
import { buildIndex, buildSearchIndex } from './lib/index-builder.js';
import { buildIndexMarkdown, buildManualBundle, totalContentChars } from './lib/web-index.js';

const MANUAL_DIR = 'manual';

function parseArgs(argv) {
  const args = {
    out: '.',
    root: process.env.NOTION_ROOT_PAGE_ID,
    baseUrl: process.env.CONTENT_BASE_URL,
    quiet: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') args.out = argv[++i];
    else if (arg === '--root') args.root = argv[++i];
    else if (arg === '--base-url') args.baseUrl = argv[++i];
    else if (arg === '--quiet') args.quiet = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`未知參數：${arg}`);
  }

  return args;
}

const USAGE = `
用法：node scripts/sync.js [選項]

  --out <dir>       輸出根目錄（預設 .）
  --root <id>       Notion 母頁 id 或網址（預設讀環境變數 NOTION_ROOT_PAGE_ID）
  --base-url <url>  raw.githubusercontent 的 repo 根網址，用來組 INDEX.md 裡的
                    絕對連結（預設讀環境變數 CONTENT_BASE_URL）
  --quiet           只印結果，不印逐頁進度
  --help            顯示這段說明
`.trim();

/** INDEX.md 的絕對網址要靠這個組出來；沒設就退回一個一看就知道要改的預設值。 */
const DEFAULT_BASE_URL = 'https://raw.githubusercontent.com/OakMega-Samuel/oakmega-manual-content/main';

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(USAGE);
    return;
  }

  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error('缺少環境變數 NOTION_TOKEN');

  if (!args.root) throw new Error('缺少母頁 id：請設 NOTION_ROOT_PAGE_ID 或傳 --root');
  const rootPageId = extractPageId(args.root);
  if (!rootPageId) throw new Error(`無法從「${args.root}」解析出 page id`);

  const log = args.quiet ? () => {} : (message) => console.log(message);
  const startedAt = Date.now();

  // --- 第一趟：走訪並抓取 ---------------------------------------------------
  const client = new NotionClient({ token });

  log(`從 ${rootPageId} 開始走訪…`);
  const { pages, skipped } = await collectPages(client, rootPageId, log);

  if (!pages.length) throw new Error('一頁都沒抓到——確認母頁已 connect 給 integration');

  // --- 第二趟：渲染 ---------------------------------------------------------
  // 到這裡才知道每一頁的最終位置，內部連結才有辦法改寫成相對路徑。
  const pagesById = new Map(pages.map((page) => [page.id, page]));
  const warnings = [];

  const rendered = pages.map((page) => {
    const resolvePageLink = (targetId) => {
      const target = pagesById.get(targetId);
      return target ? relativeLink(page.filePath, target.filePath) : null;
    };

    const ctx = {
      resolvePageLink,
      // 站內連結改寫成相對路徑；指向手冊範圍外的 Notion 頁面就原樣保留，
      // 至少讀者還點得進去，總比連到一個不存在的檔案好。
      resolveHref: (href) => {
        const targetId = extractPageId(href);
        return (targetId && resolvePageLink(targetId)) || href;
      },
      warnings,
    };

    const body = renderBlocks(page.blocks, ctx);
    return { page, body, contents: buildPageFile(page, body), summary: extractSummary(body) };
  });

  // --- 寫檔 -----------------------------------------------------------------
  const outRoot = path.resolve(args.out);
  const manualRoot = path.join(outRoot, MANUAL_DIR);

  // 全量重建：先清掉舊的，Notion 上刪掉的頁面才不會殘留。
  await fs.rm(manualRoot, { recursive: true, force: true });

  for (const { page, contents } of rendered) {
    const target = path.join(outRoot, page.filePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, 'utf8');
  }

  const index = buildIndex({ rootPageId, entries: rendered });
  await fs.writeFile(path.join(outRoot, 'INDEX.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');

  // --- 給 Claude 直接 fetch 的兩份檔（主要消費路徑）-------------------------
  const baseUrl = args.baseUrl || DEFAULT_BASE_URL;
  const totalChars = totalContentChars(rendered);

  await fs.writeFile(
    path.join(outRoot, 'INDEX.md'),
    buildIndexMarkdown({
      baseUrl,
      entries: rendered,
      contentLastEdited: index.content_last_edited,
      totalChars,
    }),
    'utf8',
  );

  await fs.writeFile(
    path.join(outRoot, 'MANUAL.md'),
    buildManualBundle({ entries: rendered, contentLastEdited: index.content_last_edited }),
    'utf8',
  );

  // --- 給 MCP server 用的索引（次要路徑，內部 Claude Code 使用者）-----------
  // search.json 不排版——它是給機器讀的，縮排只會讓檔案大一倍。
  const { index: searchIndex, stats } = buildSearchIndex({ entries: rendered });
  const searchJson = JSON.stringify(searchIndex);
  await fs.writeFile(path.join(outRoot, 'search.json'), `${searchJson}\n`, 'utf8');

  // --- 收尾回報 -------------------------------------------------------------
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const searchSizeMb = (Buffer.byteLength(searchJson) / 1024 / 1024).toFixed(2);

  console.log(
    `\n完成：${pages.length} 頁 / ${client.requestCount} 次 API 請求 / ${elapsed}s → ${outRoot}`,
  );
  console.log(`全文 ${totalChars.toLocaleString('en-US')} 字，約 ${Math.round(totalChars / 2.5).toLocaleString('en-US')} token`);
  console.log(
    `索引：${stats.tokenCount} 個 token（剔除 ${stats.stopwordsRemoved} 個停用詞）/ search.json ${searchSizeMb} MB`,
  );
  console.log(`INDEX.md 連結基底：${baseUrl}`);

  // Worker 會把整份索引載進記憶體，太大就要改策略（分片或改用摘要索引）。
  if (Number(searchSizeMb) > 8) {
    console.log('警告：search.json 超過 8 MB，Worker 記憶體可能吃緊，考慮分片');
  }

  if (skipped.length) {
    console.log(`略過 ${skipped.length} 頁（已封存）`);
  }

  const uniqueWarnings = [...new Set(warnings)];
  if (uniqueWarnings.length) {
    console.log(`\n警告（${uniqueWarnings.length} 種）：`);
    for (const warning of uniqueWarnings) console.log(`  - ${warning}`);
  }
}

main().catch((err) => {
  console.error(`\n同步失敗：${err.message}`);
  if (err.status === 404) {
    console.error('（404 多半是母頁沒有 connect 給 integration，或 page id 打錯）');
  }
  if (err.status === 401) {
    console.error('（401 代表 NOTION_TOKEN 無效或已撤銷）');
  }
  process.exitCode = 1;
});
