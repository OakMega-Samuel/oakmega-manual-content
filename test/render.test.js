import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBlocks } from '../scripts/lib/render.js';

// --- fixture 小工具，讓測試讀起來像 Notion 的內容而不是一堆 JSON ---------------

/** 一段普通文字。傳 annotations 可加粗體等標記。 */
const t = (content, annotations = {}, href = null) => ({
  type: 'text',
  plain_text: content,
  annotations: { bold: false, italic: false, strikethrough: false, code: false, ...annotations },
  href,
});

const block = (type, data, children = [], id = '0'.repeat(32)) => ({
  id,
  type,
  [type]: data,
  children,
  has_children: children.length > 0,
});

const para = (...rich) => block('paragraph', { rich_text: rich });

/** 預設 context：所有內部連結都解析不到，等於「不在同步範圍內」。 */
const ctx = () => ({
  resolvePageLink: () => null,
  resolveHref: (href) => href,
  warnings: [],
});

// --- 基本區塊 ---------------------------------------------------------------

test('段落之間用空行隔開', () => {
  const md = renderBlocks([para(t('第一段')), para(t('第二段'))], ctx());
  assert.equal(md, '第一段\n\n第二段');
});

test('標題層級正確', () => {
  const md = renderBlocks(
    [
      block('heading_1', { rich_text: [t('大標')] }),
      block('heading_2', { rich_text: [t('中標')] }),
      block('heading_3', { rich_text: [t('小標')] }),
    ],
    ctx(),
  );
  assert.equal(md, '# 大標\n\n## 中標\n\n### 小標');
});

test('heading_4 等 h1~h3 之外的標題層級也支援，而非默默消失', () => {
  // 真實 Notion 資料裡遇到過 heading_4——這在寫渲染器當下的官方文件裡沒有，
  // 但 API 就是會回傳。渲染器必須靠 heading_N 這個型別家族通用處理，
  // 而不是列舉固定幾層，否則新層級的內容會整段消失且只留一則警告。
  const md = renderBlocks([block('heading_4', { rich_text: [t('第四層')] })], ctx());
  assert.equal(md, '#### 第四層');
});

test('heading 層級超過 markdown 的 h6 上限時夾住，不會產生壞掉的語法', () => {
  const md = renderBlocks([block('heading_9', { rich_text: [t('極端情況')] })], ctx());
  assert.equal(md, '###### 極端情況');
});

test('連續清單項緊湊排列，被打斷後重新編號', () => {
  const md = renderBlocks(
    [
      block('numbered_list_item', { rich_text: [t('一')] }),
      block('numbered_list_item', { rich_text: [t('二')] }),
      para(t('插話')),
      block('numbered_list_item', { rich_text: [t('重新開始')] }),
    ],
    ctx(),
  );
  assert.equal(md, '1. 一\n2. 二\n\n插話\n\n1. 重新開始');
});

test('巢狀清單縮排兩格', () => {
  const md = renderBlocks(
    [
      block('bulleted_list_item', { rich_text: [t('外層')] }, [
        block('bulleted_list_item', { rich_text: [t('內層')] }),
      ]),
    ],
    ctx(),
  );
  assert.equal(md, '- 外層\n  - 內層');
});

test('to_do 呈現勾選狀態', () => {
  const md = renderBlocks(
    [
      block('to_do', { rich_text: [t('已完成')], checked: true }),
      block('to_do', { rich_text: [t('未完成')], checked: false }),
    ],
    ctx(),
  );
  assert.equal(md, '- [x] 已完成\n- [ ] 未完成');
});

// --- 攤平行為 ---------------------------------------------------------------

test('toggle 內容被攤平而非藏起來', () => {
  const md = renderBlocks(
    [block('toggle', { rich_text: [t('點開看細節')] }, [para(t('這段必須被搜尋得到'))])],
    ctx(),
  );
  assert.equal(md, '**點開看細節**\n\n這段必須被搜尋得到');
});

test('可摺疊標題的內容一樣攤平', () => {
  const md = renderBlocks(
    [block('heading_2', { rich_text: [t('進階設定')], is_toggleable: true }, [para(t('藏起來的內容'))])],
    ctx(),
  );
  assert.equal(md, '## 進階設定\n\n藏起來的內容');
});

test('column_list 攤平成一般內容', () => {
  const md = renderBlocks(
    [block('column_list', {}, [block('column', {}, [para(t('左欄'))]), block('column', {}, [para(t('右欄'))])])],
    ctx(),
  );
  assert.equal(md, '左欄\n\n右欄');
});

// --- 圖片與檔案（本專案最關鍵的行為）----------------------------------------

test('Notion 託管的圖片只留佔位，絕不留會過期的 URL', () => {
  const md = renderBlocks(
    [
      block('image', {
        type: 'file',
        file: { url: 'https://prod-files-secure.s3.us-west-2.amazonaws.com/xxx?X-Amz-Expires=3600' },
        caption: [t('後台設定畫面')],
      }),
    ],
    ctx(),
  );

  assert.equal(md, '[圖片：後台設定畫面]');
  assert.doesNotMatch(md, /amazonaws/, '過期網址不得出現在輸出中');
});

test('沒有 caption 的圖片仍留佔位，讓模型知道此處有視覺內容', () => {
  const md = renderBlocks([block('image', { type: 'file', file: { url: 'https://s3...' } })], ctx());
  assert.equal(md, '[圖片]');
});

test('外部圖片網址是作者貼的、不會過期，予以保留', () => {
  const md = renderBlocks(
    [block('image', { type: 'external', external: { url: 'https://oakmega.com/a.png' }, caption: [t('架構圖')] })],
    ctx(),
  );
  assert.equal(md, '[圖片：架構圖](https://oakmega.com/a.png)');
});

test('Notion 託管的 PDF 同樣不留網址', () => {
  const md = renderBlocks([block('pdf', { type: 'file', file: { url: 'https://s3...' }, caption: [t('規格書')] })], ctx());
  assert.equal(md, '[PDF：規格書]');
});

// --- rich text --------------------------------------------------------------

test('粗體的尾隨空白移到標記外，否則不會被算成粗體', () => {
  const md = renderBlocks([para(t('注意 ', { bold: true }), t('事項'))], ctx());
  assert.equal(md, '**注意** 事項');
});

test('多重標記由內而外套用，inline code 在最裡層', () => {
  const md = renderBlocks([para(t('api_key', { code: true, bold: true }))], ctx());
  assert.equal(md, '**`api_key`**');
});

test('連結透過 resolveHref 改寫', () => {
  const context = { ...ctx(), resolveHref: () => './other-page-1a2b3c4d.md' };
  const md = renderBlocks([para(t('看這頁', {}, 'https://www.notion.so/Other-abc123'))], context);
  assert.equal(md, '[看這頁](./other-page-1a2b3c4d.md)');
});

test('page mention 解析得到就變連結，解析不到就退回純文字', () => {
  const linked = renderBlocks(
    [para({ type: 'mention', mention: { type: 'page', page: { id: 'aaaa' } }, plain_text: '設定指南', annotations: {} })],
    { ...ctx(), resolvePageLink: () => '../設定指南-1a2b3c4d.md' },
  );
  assert.equal(linked, '[設定指南](../設定指南-1a2b3c4d.md)');

  const bare = renderBlocks(
    [para({ type: 'mention', mention: { type: 'page', page: { id: 'aaaa' } }, plain_text: '外部頁', annotations: {} })],
    ctx(),
  );
  assert.equal(bare, '外部頁');
});

// --- 程式碼、引用、表格 ------------------------------------------------------

test('程式碼區塊帶語言標示，語言別名有對應', () => {
  const md = renderBlocks([block('code', { rich_text: [t('print(1)')], language: 'plain text' })], ctx());
  assert.equal(md, '```\nprint(1)\n```');

  const cpp = renderBlocks([block('code', { rich_text: [t('int x;')], language: 'c++' })], ctx());
  assert.equal(cpp, '```cpp\nint x;\n```');
});

test('程式碼內含反引號圍籬時自動加長，不會提早收尾', () => {
  const md = renderBlocks([block('code', { rich_text: [t('用 ``` 圍起來')], language: 'markdown' })], ctx());
  assert.match(md, /^````markdown\n/);
  assert.match(md, /\n````$/);
});

test('callout 帶 emoji 並渲染成引用', () => {
  const md = renderBlocks([block('callout', { rich_text: [t('這很重要')], icon: { type: 'emoji', emoji: '⚠️' } })], ctx());
  assert.equal(md, '> ⚠️ 這很重要');
});

test('多行引用每一行都加前綴', () => {
  const md = renderBlocks([block('quote', { rich_text: [t('第一行')] }, [para(t('第二行'))])], ctx());
  assert.equal(md, '> 第一行\n>\n> 第二行');
});

test('表格有表頭時第一列當標題', () => {
  const md = renderBlocks(
    [
      block('table', { has_column_header: true }, [
        block('table_row', { cells: [[t('欄位')], [t('說明')]] }),
        block('table_row', { cells: [[t('name')], [t('會員姓名')]] }),
      ]),
    ],
    ctx(),
  );
  assert.equal(md, '| 欄位 | 說明 |\n| --- | --- |\n| name | 會員姓名 |');
});

test('表格內容的直線被跳脫，不會拆壞欄位', () => {
  const md = renderBlocks(
    [
      block('table', { has_column_header: true }, [
        block('table_row', { cells: [[t('型別')]] }),
        block('table_row', { cells: [[t('a|b')]] }),
      ]),
    ],
    ctx(),
  );
  assert.match(md, /a\\\|b/);
});

// --- 子頁面與雜項 -----------------------------------------------------------

test('child_page 只留連結，內容不重複展開', () => {
  const md = renderBlocks(
    [block('child_page', { title: '快速上手' }, [], 'aaaabbbbccccddddeeeeffff11112222')],
    { ...ctx(), resolvePageLink: () => './快速上手-11112222.md' },
  );
  assert.equal(md, '- [快速上手](./快速上手-11112222.md)');
});

test('導航型 block 被略過', () => {
  const md = renderBlocks([block('table_of_contents', {}), para(t('內容')), block('breadcrumb', {})], ctx());
  assert.equal(md, '內容');
});

test('未知 block 型別不會炸掉，但會記進 warnings', () => {
  const context = ctx();
  const md = renderBlocks([para(t('前')), block('some_future_block', {}), para(t('後'))], context);
  assert.equal(md, '前\n\n後');
  assert.equal(context.warnings.length, 1);
  assert.match(context.warnings[0], /some_future_block/);
});

test('空段落不產生多餘空行', () => {
  const md = renderBlocks([para(t('前')), para(), para(t('後'))], ctx());
  assert.equal(md, '前\n\n後');
});
