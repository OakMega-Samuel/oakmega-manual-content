/**
 * 一份規模與寫法都接近真實的假手冊。
 *
 * 用途有二：
 *   1. content repo 的管線測試
 *   2. 產生 worker repo 的搜尋品質 fixture（見 plugin/worker/test/fixtures/）
 *
 * 內容刻意設計成「topic 之間會互相干擾」——例如「標籤」同時出現在會員管理、
 * 分眾推播、API 三個地方——這樣搜尋排序才有東西可以測。全部命中同一頁的語料
 * 測不出排序好壞。
 */

import { FakeNotionClient, fakeId, block, para, text, childPage } from './fake-notion.js';

export const ID = {
  root: fakeId('a0000001'),
  start: fakeId('a0000002'),
  workspace: fakeId('a0000003'),
  lineBind: fakeId('a0000004'),
  members: fakeId('a0000005'),
  tags: fakeId('a0000006'),
  tagImport: fakeId('a0000007'),
  broadcast: fakeId('a0000008'),
  segment: fakeId('a0000009'),
  analytics: fakeId('a000000a'),
  api: fakeId('a000000b'),
  faq: fakeId('a000000c'),
};

const h2 = (title) => block('heading_2', { rich_text: [text(title)] });
const li = (content) => block('bulleted_list_item', { rich_text: [text(content)] });
const ol = (content) => block('numbered_list_item', { rich_text: [text(content)] });

export function makeSampleManual() {
  return new FakeNotionClient({
    [ID.root]: {
      title: 'OakMega 使用手冊',
      lastEditedTime: '2026-05-01T00:00:00.000Z',
      blocks: [
        para(text('本手冊說明 OakMega SCRM 平台的各項功能與操作方式。')),
        childPage(ID.start, '快速上手'),
        childPage(ID.members, '會員管理'),
        childPage(ID.broadcast, '推播訊息'),
        childPage(ID.analytics, '成效分析'),
        childPage(ID.api, 'API 與 Webhook'),
        childPage(ID.faq, '常見問題'),
      ],
    },

    [ID.start]: {
      title: '快速上手',
      lastEditedTime: '2026-05-02T00:00:00.000Z',
      blocks: [
        para(text('第一次使用 OakMega 時，依序完成下列三個步驟即可開始經營會員。')),
        ol('建立 Workspace'),
        ol('綁定 LINE 官方帳號'),
        ol('匯入既有會員名單'),
        childPage(ID.workspace, '建立 Workspace'),
        childPage(ID.lineBind, '綁定 LINE 官方帳號'),
      ],
    },

    [ID.workspace]: {
      title: '建立 Workspace',
      lastEditedTime: '2026-05-03T00:00:00.000Z',
      blocks: [
        para(text('Workspace 是 OakMega 的最上層單位，一個品牌對應一個 Workspace。')),
        h2('建立步驟'),
        ol('登入後點選右上角頭像，選擇「新增 Workspace」。'),
        ol('填寫品牌名稱與所屬產業。'),
        ol('選擇方案並完成付款。'),
        h2('注意事項'),
        para(text('Workspace 建立後名稱可以修改，但無法刪除，只能停用。')),
        para(text('一組 API key 只綁定一個 Workspace，切換 Workspace 需要換 key。')),
      ],
    },

    [ID.lineBind]: {
      title: '綁定 LINE 官方帳號',
      lastEditedTime: '2026-05-04T00:00:00.000Z',
      blocks: [
        para(text('綁定後才能收發 LINE 訊息、取得好友資料與推播成效。')),
        h2('綁定步驟'),
        ol('在 LINE Developers 建立 Messaging API channel。'),
        ol('複製 Channel ID 與 Channel Secret 貼到 OakMega 後台。'),
        ol('把 OakMega 提供的 Webhook URL 填回 LINE Developers。'),
        h2('常見錯誤'),
        para(text('若 Webhook 驗證失敗，多半是 LINE 後台的「使用 Webhook」開關沒有打開。')),
        para(text('一個 Workspace 只能綁定一個 LINE 官方帳號。')),
      ],
    },

    [ID.members]: {
      title: '會員管理',
      lastEditedTime: '2026-05-05T00:00:00.000Z',
      blocks: [
        para(text('會員是所有功能的核心，包含基本資料、渠道綁定與標籤三個部分。')),
        h2('會員來源'),
        li('LINE 加好友時自動建立'),
        li('CSV 手動匯入'),
        li('透過 API 建立'),
        h2('會員合併'),
        para(text('同一個人從不同渠道進來時，可以用手機號碼或 Email 進行會員合併。')),
        childPage(ID.tags, '會員標籤'),
      ],
    },

    [ID.tags]: {
      title: '會員標籤',
      lastEditedTime: '2026-05-06T00:00:00.000Z',
      blocks: [
        para(text('標籤用來標記會員的特徵與行為，是分眾的基礎。')),
        h2('標籤類型'),
        li('手動標籤：由人員在後台手動貼上'),
        li('自動標籤：由旅程或自動化規則觸發'),
        li('系統標籤：平台依行為自動產生，不可編輯'),
        h2('標籤上限'),
        para(text('每個 Workspace 最多可以建立 5000 個標籤，單一會員最多貼 200 個標籤。')),
        childPage(ID.tagImport, '批次匯入標籤'),
      ],
    },

    [ID.tagImport]: {
      title: '批次匯入標籤',
      lastEditedTime: '2026-05-07T00:00:00.000Z',
      blocks: [
        para(text('需要一次為大量會員貼標時，使用 CSV 批次匯入功能。')),
        h2('CSV 格式'),
        block('table', { has_column_header: true }, [
          block('table_row', { cells: [[text('欄位')], [text('必填')], [text('說明')]] }),
          block('table_row', { cells: [[text('member_id')], [text('是')], [text('會員編號')]] }),
          block('table_row', { cells: [[text('tag_name')], [text('是')], [text('標籤名稱，不存在會自動建立')]] }),
        ]),
        h2('限制'),
        para(text('單次匯入上限 10000 筆，超過請分批。檔案大小上限 10 MB。')),
        para(text('匯入為非同步作業，筆數多時需要數分鐘，完成後會寄送通知信。')),
      ],
    },

    [ID.broadcast]: {
      title: '推播訊息',
      lastEditedTime: '2026-05-08T00:00:00.000Z',
      blocks: [
        para(text('推播用來主動對會員發送訊息，支援文字、圖片、圖文選單與彈性訊息。')),
        h2('推播類型'),
        li('立即推播：建立後馬上送出'),
        li('排程推播：指定時間送出'),
        li('循環推播：依週期重複送出'),
        h2('推播費用'),
        para(text('推播則數依 LINE 官方帳號的方案計費，超量會被 LINE 擋下。')),
        childPage(ID.segment, '分眾推播'),
      ],
    },

    [ID.segment]: {
      title: '分眾推播',
      lastEditedTime: '2026-05-09T00:00:00.000Z',
      blocks: [
        para(text('分眾推播讓你只對符合條件的會員發送訊息，避免打擾不相關的人。')),
        h2('可用的分眾條件'),
        li('標籤：包含或不包含指定標籤'),
        li('會員欄位：性別、生日、註冊時間等'),
        li('行為：最近是否開啟訊息、是否點擊連結'),
        h2('預估受眾'),
        para(text('設定條件後系統會即時估算受眾人數，送出前務必確認。')),
        para(text('受眾為零時無法送出，請放寬條件。')),
      ],
    },

    [ID.analytics]: {
      title: '成效分析',
      lastEditedTime: '2026-05-10T00:00:00.000Z',
      blocks: [
        para(text('分析頁提供好友成長、訊息互動與轉換三大類數據。')),
        h2('好友成長'),
        para(text('顯示每日新增與封鎖人數，可切換週期比較。')),
        h2('訊息互動'),
        para(text('推播的送達率、開封率與點擊率，資料在送出後六小時內陸續回填。')),
        h2('資料延遲'),
        para(text('LINE 的成效資料有延遲，當日數據約在隔日凌晨才會完整。')),
      ],
    },

    [ID.api]: {
      title: 'API 與 Webhook',
      lastEditedTime: '2026-05-11T00:00:00.000Z',
      blocks: [
        para(text('OakMega 提供 REST API 讓你把會員資料串接到自家系統。')),
        h2('認證方式'),
        para(text('所有請求都要在 header 帶上 Authorization: Bearer <API key>。')),
        block('code', { rich_text: [text('curl -H "Authorization: Bearer $KEY" https://api.oakmega.com/v1/members')], language: 'bash' }),
        h2('速率限制'),
        para(text('每分鐘 600 次請求，超過回傳 429，請依 Retry-After 重試。')),
        h2('Webhook 事件'),
        li('member.created：會員建立'),
        li('member.tagged：會員被貼上標籤'),
        li('message.delivered：訊息送達'),
      ],
    },

    [ID.faq]: {
      title: '常見問題',
      lastEditedTime: '2026-05-12T00:00:00.000Z',
      blocks: [
        h2('忘記密碼怎麼辦'),
        para(text('在登入頁點選「忘記密碼」，系統會寄送重設連結到註冊信箱，連結一小時內有效。')),
        h2('可以匯出會員資料嗎'),
        para(text('可以，在會員列表點選「匯出」，系統會產生 CSV 並寄到你的信箱。')),
        h2('為什麼推播沒有送達'),
        para(text('最常見的原因是對方已封鎖官方帳號，其次是 LINE 推播額度用盡。')),
      ],
    },
  });
}
