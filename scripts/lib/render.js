/**
 * Notion block tree → Markdown。
 *
 * 這裡是**純函式**：呼叫端要先把整棵 block tree（含 children）抓好再傳進來。
 * 這樣渲染邏輯可以完全不碰網路就測試，也讓限流集中在 client 那一層。
 *
 * 兩個刻意的取捨：
 *
 * 1. **Notion 託管的圖片／檔案一律不留 URL。** API 回傳的是一小時就過期的 presigned
 *    S3 網址，寫進 markdown 隔天全是死連結。改成 `[圖片：caption]` 佔位，讓模型知道
 *    該處有視覺內容、可以請使用者去看 front-matter 裡的 notion_url 原文。
 *    但 `external` 型別的檔案網址是作者自己貼的、不會過期，予以保留。
 *
 * 2. **toggle 與可摺疊標題一律攤平。** 手冊作者常把細節塞在摺疊區塊裡，
 *    但對檢索來說那些正是最該被搜到的內容，藏起來沒有意義。
 */

/** Notion 的語言名稱對到 markdown code fence 的標示。沒列到的直接原樣用。 */
const CODE_LANGUAGE_ALIASES = {
  'plain text': '',
  'c++': 'cpp',
  'c#': 'csharp',
  'objective-c': 'objectivec',
  'f#': 'fsharp',
  'visual basic': 'vb',
  'shell': 'bash',
  docker: 'dockerfile',
};

/** 純導航用的 block，對模型只是雜訊。 */
const SKIPPED_TYPES = new Set(['table_of_contents', 'breadcrumb', 'unsupported']);

const LIST_TYPES = new Set(['bulleted_list_item', 'numbered_list_item', 'to_do']);

/**
 * @typedef {object} RenderContext
 * @property {(pageId: string) => string | null} resolvePageLink
 *   給定正規化的 page id，回傳相對於當前檔案的路徑；不在同步範圍內則回 null。
 * @property {(href: string) => string} resolveHref
 *   把 rich text 上的連結轉成最終要寫進 markdown 的位址（內部 Notion 連結會被改寫）。
 * @property {string[]} [warnings] 收集渲染過程中遇到的問題，供同步結束後彙報。
 */

/**
 * 渲染一串同層 block。
 * @param {object[]} blocks 已經帶好 `children` 的 block 陣列
 * @param {RenderContext} ctx
 * @returns {string} markdown（結尾不含多餘換行）
 */
export function renderBlocks(blocks, ctx) {
  /** @type {{type: string, text: string}[]} */
  const chunks = [];
  let numberedCounter = 0;

  for (const block of blocks) {
    const type = block?.type;
    if (!type || SKIPPED_TYPES.has(type)) continue;

    // 編號清單被任何其他型別打斷就重新從 1 開始。
    if (type === 'numbered_list_item') numberedCounter += 1;
    else numberedCounter = 0;

    const text = renderBlock(block, ctx, numberedCounter);
    if (text === null || text === '') continue;

    chunks.push({ type, text });
  }

  // 連續的同類清單項用單換行黏在一起（緊湊清單），其餘用空行隔開。
  let out = '';
  for (let i = 0; i < chunks.length; i += 1) {
    if (i > 0) {
      const prev = chunks[i - 1].type;
      const curr = chunks[i].type;
      const bothSameList = LIST_TYPES.has(prev) && prev === curr;
      out += bothSameList ? '\n' : '\n\n';
    }
    out += chunks[i].text;
  }

  return out;
}

/** 渲染單一 block。回傳 null 代表這個 block 不產出任何內容。 */
function renderBlock(block, ctx, numberedIndex) {
  const { type } = block;
  const data = block[type] ?? {};
  const children = block.children ?? [];

  switch (type) {
    case 'paragraph': {
      const text = richText(data.rich_text, ctx);
      const body = renderChildren(children, ctx);
      if (!text && !body) return null;
      return joinWithChildren(text, body);
    }

    case 'heading_1':
    case 'heading_2':
    case 'heading_3': {
      const level = Number(type.slice(-1));
      const text = richText(data.rich_text, ctx);
      const heading = `${'#'.repeat(level)} ${text}`;
      // 可摺疊標題的內容攤平接在標題後面。
      const body = renderChildren(children, ctx);
      return body ? `${heading}\n\n${body}` : heading;
    }

    case 'bulleted_list_item':
      return listItem('-', richText(data.rich_text, ctx), children, ctx);

    case 'numbered_list_item':
      return listItem(`${numberedIndex}.`, richText(data.rich_text, ctx), children, ctx);

    case 'to_do': {
      const marker = data.checked ? '- [x]' : '- [ ]';
      return listItem(marker, richText(data.rich_text, ctx), children, ctx);
    }

    case 'toggle': {
      // 攤平：摘要當一行粗體，內容照常展開。藏起來對檢索沒好處。
      const summary = richText(data.rich_text, ctx);
      const body = renderChildren(children, ctx);
      if (!summary) return body || null;
      return body ? `**${summary}**\n\n${body}` : `**${summary}**`;
    }

    case 'code': {
      const code = plainText(data.rich_text);
      const rawLang = (data.language ?? '').toLowerCase();
      const lang = CODE_LANGUAGE_ALIASES[rawLang] ?? rawLang;
      const caption = richText(data.caption, ctx);
      // 內容本身含 ``` 時把圍籬加長，否則會提早收尾。
      const fence = '`'.repeat(Math.max(3, longestBacktickRun(code) + 1));
      const fenced = `${fence}${lang}\n${code}\n${fence}`;
      return caption ? `${fenced}\n\n${caption}` : fenced;
    }

    case 'quote': {
      const text = richText(data.rich_text, ctx);
      const body = renderChildren(children, ctx);
      return blockquote(joinWithChildren(text, body));
    }

    case 'callout': {
      const icon = calloutIcon(data.icon);
      const text = richText(data.rich_text, ctx);
      const body = renderChildren(children, ctx);
      const combined = joinWithChildren(icon ? `${icon} ${text}`.trim() : text, body);
      return blockquote(combined);
    }

    case 'divider':
      return '---';

    case 'equation':
      return data.expression ? `$$\n${data.expression}\n$$` : null;

    case 'image':
      return mediaPlaceholder('圖片', data, ctx);

    case 'video':
      return mediaPlaceholder('影片', data, ctx);

    case 'audio':
      return mediaPlaceholder('音訊', data, ctx);

    case 'pdf':
      return mediaPlaceholder('PDF', data, ctx);

    case 'file':
      return mediaPlaceholder('檔案', data, ctx);

    case 'bookmark':
    case 'embed':
    case 'link_preview': {
      // 這些都是作者自己貼的外部網址，不會過期，直接保留。
      const url = data.url;
      if (!url) return null;
      const caption = richText(data.caption, ctx);
      return caption ? `[${caption}](${url})` : `<${url}>`;
    }

    case 'child_page': {
      // 子頁面各自是一個檔案，這裡只留一個連往它的連結，內容不重複展開。
      const title = data.title ?? '';
      const target = ctx.resolvePageLink(normalizeId(block.id));
      return target ? `- [${title}](${target})` : `- ${title}`;
    }

    case 'child_database':
      return data.title ? `[資料庫：${data.title}]` : '[資料庫]';

    case 'link_to_page': {
      const targetId = data.page_id ?? data.database_id;
      if (!targetId) return null;
      const target = ctx.resolvePageLink(normalizeId(targetId));
      return target ? `- [${linkLabel(target)}](${target})` : null;
    }

    case 'table':
      return renderTable(block, ctx);

    // 版面容器：本身沒內容，把小孩攤平就好。
    case 'column_list':
    case 'column':
    case 'synced_block':
      return renderChildren(children, ctx) || null;

    case 'table_row':
      // 只會由 renderTable 處理，單獨出現代表資料有問題。
      return null;

    default:
      ctx.warnings?.push(`未支援的 block 型別：${type}`);
      return null;
  }
}

/** 把子 block 渲染成一段 markdown。 */
function renderChildren(children, ctx) {
  if (!children?.length) return '';
  return renderBlocks(children, ctx);
}

/** 清單項：第一行帶標記，子內容縮排兩格。 */
function listItem(marker, text, children, ctx) {
  const head = `${marker} ${text}`.trimEnd();
  const body = renderChildren(children, ctx);
  if (!body) return head;
  return `${head}\n${indent(body, '  ')}`;
}

/** 本文與子內容之間空一行；任一邊為空就只回另一邊。 */
function joinWithChildren(text, body) {
  if (text && body) return `${text}\n\n${body}`;
  return text || body;
}

function blockquote(text) {
  if (!text) return null;
  return text
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');
}

function indent(text, prefix) {
  return text
    .split('\n')
    .map((line) => (line ? prefix + line : line))
    .join('\n');
}

/**
 * 媒體佔位。
 * Notion 託管（type === 'file'）的網址一小時過期，只留佔位文字；
 * 外部網址是作者貼的，保留成連結。
 */
function mediaPlaceholder(label, data, ctx) {
  const caption = richText(data.caption, ctx);
  const isExternal = data.type === 'external';
  const url = isExternal ? data.external?.url : null;

  if (isExternal && url) {
    return caption ? `[${label}：${caption}](${url})` : `[${label}](${url})`;
  }

  return caption ? `[${label}：${caption}]` : `[${label}]`;
}

function calloutIcon(icon) {
  if (!icon) return '';
  if (icon.type === 'emoji') return icon.emoji ?? '';
  // 自訂圖示是檔案，同樣會過期，不留網址。
  return '';
}

function renderTable(block, ctx) {
  const rows = (block.children ?? []).filter((child) => child.type === 'table_row');
  if (!rows.length) return null;

  const hasColumnHeader = block.table?.has_column_header ?? false;

  const matrix = rows.map((row) =>
    (row.table_row?.cells ?? []).map((cell) => richText(cell, ctx).replace(/\|/g, '\\|').replace(/\n/g, ' ')),
  );

  const width = Math.max(...matrix.map((row) => row.length));
  const pad = (row) => [...row, ...Array(width - row.length).fill('')];

  const lines = [];
  const [first, ...rest] = matrix;

  if (hasColumnHeader) {
    lines.push(`| ${pad(first).join(' | ')} |`);
    lines.push(`| ${Array(width).fill('---').join(' | ')} |`);
    for (const row of rest) lines.push(`| ${pad(row).join(' | ')} |`);
  } else {
    // 沒有表頭時仍需補一列分隔線，否則不會被當成表格；用空表頭。
    lines.push(`| ${Array(width).fill('').join(' | ')} |`);
    lines.push(`| ${Array(width).fill('---').join(' | ')} |`);
    for (const row of matrix) lines.push(`| ${pad(row).join(' | ')} |`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Rich text
// ---------------------------------------------------------------------------

/** 只取純文字，不套任何 markdown 標記（給程式碼區塊用）。 */
export function plainText(richTextParts) {
  return (richTextParts ?? []).map((part) => part.plain_text ?? '').join('');
}

/** rich text 陣列 → inline markdown。 */
export function richText(parts, ctx) {
  return (parts ?? []).map((part) => renderRichTextPart(part, ctx)).join('');
}

function renderRichTextPart(part, ctx) {
  let text;

  if (part.type === 'equation') {
    text = part.equation?.expression ? `$${part.equation.expression}$` : '';
  } else if (part.type === 'mention') {
    text = renderMention(part, ctx);
  } else {
    text = part.plain_text ?? '';
  }

  if (!text) return '';

  text = applyAnnotations(text, part.annotations ?? {});

  if (part.href) {
    const target = ctx.resolveHref(part.href);
    if (target) text = `[${text}](${target})`;
  }

  return text;
}

/**
 * 套用粗體／斜體等標記。
 *
 * 前後空白要移到標記外面——Notion 常常把尾隨空白包進粗體區段裡，
 * 直接輸出 `**粗體 **` 在多數 markdown 實作下不會被當成粗體。
 */
function applyAnnotations(text, annotations) {
  const match = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const [, leading, core, trailing] = match;
  if (!core) return text;

  let out = core;

  // inline code 先套，其他標記在外層——反過來的話標記會被當成程式碼內容。
  if (annotations.code) out = `\`${out}\``;
  if (annotations.bold) out = `**${out}**`;
  if (annotations.italic) out = `*${out}*`;
  if (annotations.strikethrough) out = `~~${out}~~`;
  // underline 在 markdown 沒有對應語法，維持原樣。

  return leading + out + trailing;
}

function renderMention(part, ctx) {
  const mention = part.mention ?? {};

  switch (mention.type) {
    case 'page': {
      const target = ctx.resolvePageLink(normalizeId(mention.page?.id ?? ''));
      const label = part.plain_text || '（未命名頁面）';
      return target ? `[${label}](${target})` : label;
    }
    case 'user':
      return part.plain_text || '@使用者';
    case 'date':
    case 'database':
    case 'link_preview':
    case 'template_mention':
    default:
      return part.plain_text ?? '';
  }
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function normalizeId(id) {
  return String(id).replace(/-/g, '').toLowerCase();
}

function longestBacktickRun(text) {
  let longest = 0;
  for (const run of text.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
  return longest;
}

/** 從相對路徑猜一個顯示用標籤（link_to_page 沒有給標題）。 */
function linkLabel(relativePath) {
  const file = relativePath.split('/').pop() ?? relativePath;
  return file.replace(/-[0-9a-f]{8}\.md$/, '').replace(/\.md$/, '');
}
