import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPageId, normalizePageId } from '../scripts/lib/notion.js';

test('新版 app.notion.com 連結：抓路徑裡的 page id，不是 query string 的 view id', () => {
  // 這兩段是真實遇到的案例：view id 排在網址「更後面」，
  // 對整條網址找「最後一段 32 碼 hex」會抓錯，且不會報錯——查到的會是別的東西。
  const url =
    'https://app.notion.com/p/oakmega/ac043939ff4c4f45b5044bd669a23909?v=acb5f3a34192469c916cfe770e67e2a9&source=copy_link';

  assert.equal(extractPageId(url), 'ac043939ff4c4f45b5044bd669a23909');
});

test('經典 notion.so 連結：標題後綴的 id', () => {
  assert.equal(
    extractPageId('https://www.notion.so/Quick-Start-1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d'),
    '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d',
  );
});

test('經典連結帶 workspace 與 ?pvs= 參數', () => {
  assert.equal(
    extractPageId('https://www.notion.so/oakmega/Title-1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d?pvs=4'),
    '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d',
  );
});

test('notion.site 公開連結', () => {
  assert.equal(
    extractPageId('https://oakmega.notion.site/Handbook-1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d'),
    '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d',
  );
});

test('帶連字號的標準 UUID 格式', () => {
  assert.equal(
    extractPageId('1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d'),
    '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d',
  );
});

test('純 32 碼 hex，不帶任何網址', () => {
  assert.equal(
    extractPageId('1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d'),
    '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d',
  );
});

test('找不到 id 時回 null，不是拋錯或回傳垃圾值', () => {
  assert.equal(extractPageId('https://example.com/not-a-notion-link'), null);
  assert.equal(extractPageId(''), null);
  assert.equal(extractPageId(null), null);
  assert.equal(extractPageId(undefined), null);
  assert.equal(extractPageId(123), null);
});

test('大小寫不影響解析結果', () => {
  assert.equal(
    extractPageId('https://www.notion.so/Title-AC043939FF4C4F45B5044BD669A23909'),
    'ac043939ff4c4f45b5044bd669a23909',
  );
});

test('normalizePageId 去連字號並轉小寫', () => {
  assert.equal(normalizePageId('1A2B3C4D-5E6F-7A8B-9C0D-1E2F3A4B5C6D'), '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d');
});
