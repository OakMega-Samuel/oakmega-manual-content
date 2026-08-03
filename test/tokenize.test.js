import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, accumulate } from '../scripts/lib/tokenize.js';

test('中文切成 bigram', () => {
  assert.deepEqual(tokenize('會員標籤'), ['會員', '員標', '標籤']);
});

test('查詢的子字串命中文件的 bigram —— 這正是不用 bigram 就會壞掉的地方', () => {
  const docTokens = new Set(tokenize('會員標籤管理與批次匯入'));
  // 使用者只打「標籤」，必須要能對上長句裡的片段
  for (const token of tokenize('標籤')) {
    assert.ok(docTokens.has(token), `文件應包含 token「${token}」`);
  }
});

test('英數字以整個詞為單位，不做 bigram', () => {
  assert.deepEqual(tokenize('LINE webhook v2'), ['line', 'webhook', 'v2']);
});

test('中英交界處斷開，不會黏成一段', () => {
  assert.deepEqual(tokenize('LINE官方帳號'), ['line', '官方', '方帳', '帳號']);
});

test('標點與空白只當分隔，不產生 token', () => {
  assert.deepEqual(tokenize('設定，權限。'), ['設定', '權限']);
});

test('單一中文字沒有 bigram 可組，原樣保留', () => {
  assert.deepEqual(tokenize('讚'), ['讚']);
  assert.deepEqual(tokenize('按 讚 數'), ['按', '讚', '數']);
});

test('大小寫正規化', () => {
  assert.deepEqual(tokenize('API Key'), ['api', 'key']);
});

test('日文與韓文一併走 bigram', () => {
  assert.deepEqual(tokenize('設定する'), ['設定', '定す', 'する']);
  assert.deepEqual(tokenize('설정'), ['설정']);
});

test('空輸入與非字串安全回傳空陣列', () => {
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize(null), []);
  assert.deepEqual(tokenize(undefined), []);
  assert.deepEqual(tokenize('   ~!@#   '), []);
});

test('accumulate 依權重累加詞頻並回傳加權長度', () => {
  const counts = new Map();

  const bodyLength = accumulate(counts, '標籤', 1);
  assert.equal(bodyLength, 1);
  assert.equal(counts.get('標籤'), 1);

  const titleLength = accumulate(counts, '標籤', 3);
  assert.equal(titleLength, 3);
  assert.equal(counts.get('標籤'), 4, '同一個 token 在不同欄位的權重要累加');
});

test('索引端與查詢端用同一支斷詞，結果必然一致', () => {
  const phrase = 'LINE 官方帳號 2.0 設定';
  assert.deepEqual(tokenize(phrase), tokenize(phrase));
});
