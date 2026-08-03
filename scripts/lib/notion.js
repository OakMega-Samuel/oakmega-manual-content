/**
 * 最小的 Notion API client。
 *
 * 刻意不用 @notionhq/client：我們只打三種端點，而自己寫可以完全掌握限流與重試，
 * 也讓 CI 的 `npm ci` 沒有任何相依套件要裝。
 *
 * API 版本固定在 2022-06-28——我們只走巢狀 page tree，不碰 database，
 * 因此不需要 2025-09-03 引入的 data source 那套改動，用最穩定的版本即可。
 */

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

/** Notion 官方限制為「平均每秒 3 次請求」，350ms 間隔留一點餘裕。 */
const DEFAULT_MIN_INTERVAL_MS = 350;

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class NotionError extends Error {
  constructor(message, { status, code, path } = {}) {
    super(message);
    this.name = 'NotionError';
    this.status = status;
    this.code = code;
    this.path = path;
  }
}

export class NotionClient {
  #token;
  #minIntervalMs;
  #maxRetries;
  /** 所有請求排成一條鏈，確保間隔生效——併發打 Notion 只會換來一串 429。 */
  #queue = Promise.resolve();
  #lastRequestAt = 0;

  constructor({ token, minIntervalMs = DEFAULT_MIN_INTERVAL_MS, maxRetries = 5 } = {}) {
    if (!token) throw new NotionError('缺少 Notion token（環境變數 NOTION_TOKEN）');
    this.#token = token;
    this.#minIntervalMs = minIntervalMs;
    this.#maxRetries = maxRetries;
    this.requestCount = 0;
  }

  async #throttle() {
    const waitMs = this.#lastRequestAt + this.#minIntervalMs - Date.now();
    if (waitMs > 0) await sleep(waitMs);
    this.#lastRequestAt = Date.now();
  }

  async #send(path, { method = 'GET', body, searchParams } = {}) {
    const url = new URL(NOTION_API + path);
    if (searchParams) {
      for (const [key, value] of Object.entries(searchParams)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
    }

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.#token}`,
        'Notion-Version': NOTION_VERSION,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    this.requestCount += 1;
    return res;
  }

  /** 排隊 + 限流 + 重試地打一次 API。 */
  request(path, options = {}) {
    const run = async () => {
      let lastError;

      for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
        await this.#throttle();

        let res;
        try {
          res = await this.#send(path, options);
        } catch (err) {
          // 網路層失敗（DNS、連線中斷）也值得重試。
          lastError = new NotionError(`請求 ${path} 失敗：${err.message}`, { path });
          await sleep(backoffMs(attempt));
          continue;
        }

        if (res.ok) return res.json();

        const payload = await res.json().catch(() => ({}));

        if (RETRYABLE_STATUS.has(res.status) && attempt < this.#maxRetries) {
          // 429 會帶 Retry-After（秒）。有講就聽它的，沒講就指數退避。
          const retryAfter = Number(res.headers.get('Retry-After'));
          const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt);
          lastError = new NotionError(payload.message ?? `HTTP ${res.status}`, {
            status: res.status,
            code: payload.code,
            path,
          });
          await sleep(waitMs);
          continue;
        }

        throw new NotionError(payload.message ?? `HTTP ${res.status} on ${path}`, {
          status: res.status,
          code: payload.code,
          path,
        });
      }

      throw lastError ?? new NotionError(`請求 ${path} 重試 ${this.#maxRetries} 次後仍失敗`, { path });
    };

    // 串接到佇列尾端。用 .then(run, run) 讓前一個請求失敗不會卡死後面的。
    const result = this.#queue.then(run, run);
    this.#queue = result.catch(() => {});
    return result;
  }

  async retrievePage(pageId) {
    return this.request(`/pages/${pageId}`);
  }

  /** 自動翻頁抓完某個 block 的所有子 block。 */
  async listBlockChildren(blockId) {
    const blocks = [];
    let cursor;

    do {
      const page = await this.request(`/blocks/${blockId}/children`, {
        searchParams: { page_size: 100, start_cursor: cursor },
      });
      blocks.push(...page.results);
      cursor = page.has_more ? page.next_cursor : undefined;
    } while (cursor);

    return blocks;
  }
}

function backoffMs(attempt) {
  // 1s, 2s, 4s, 8s... 上限 30s。
  return Math.min(1000 * 2 ** attempt, 30_000);
}

/**
 * 從各種形態的 Notion 網址／ID 取出正規化的 32 碼 hex page id。
 *
 * 認得：
 *   https://www.notion.so/Some-Title-1a2b3c...           （標題後綴 id）
 *   https://www.notion.so/workspace/Title-1a2b3c...?pvs=4
 *   https://workspace.notion.site/Title-1a2b3c...
 *   https://app.notion.com/p/workspace/1a2b3c...?v=5e6f...（新版連結，見下方註解）
 *   1a2b3c4d-5e6f-...                                    （帶連字號的 id）
 *   1a2b3c4d5e6f...                                      （純 32 碼）
 *
 * 取不到就回 null。
 *
 * 陷阱：新版 app.notion.com/p/... 連結會在 query string 帶 `v=<view id>`，
 * 那也是一段 32 碼 hex，而且排在網址「更後面」。若對整條網址找「最後一段 32 碼」，
 * 抓到的會是 view id 而不是 page id——兩者長得一模一樣，錯了不會報錯，只會在
 * 呼叫 Notion API 時就是查到別的東西或 404。所以這裡**先切掉 query string**，
 * 只在路徑部分找 id；查詢字串等 path 裡真的找不到才當備援去翻。
 */
export function extractPageId(input) {
  if (typeof input !== 'string') return null;

  const [path, query] = splitOnFirstQuestionMark(input);

  return findIdIn(path) ?? findIdIn(query ?? '');
}

function splitOnFirstQuestionMark(input) {
  const i = input.indexOf('?');
  return i === -1 ? [input, null] : [input.slice(0, i), input.slice(i + 1)];
}

function findIdIn(segment) {
  if (!segment) return null;

  // 先試帶連字號的標準 UUID，避免被下面的「連續 32 碼」規則漏掉。
  const uuid = segment.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uuid) return normalizePageId(uuid[0]);

  // Notion 網址把 id 直接黏在標題後面，取最後一段連續 32 碼 hex。
  const matches = segment.match(/[0-9a-f]{32}/gi);
  if (matches?.length) return normalizePageId(matches[matches.length - 1]);

  return null;
}

/** 去掉連字號並轉小寫，方便當 Map 的 key。 */
export function normalizePageId(id) {
  return id.replace(/-/g, '').toLowerCase();
}

/** 從 page 物件的 properties 取標題。找不到就回空字串，交給呼叫端決定 fallback。 */
export function pageTitle(page) {
  const properties = page?.properties ?? {};
  const titleProp =
    properties.title ?? Object.values(properties).find((prop) => prop?.type === 'title');

  return (titleProp?.title ?? [])
    .map((part) => part.plain_text ?? '')
    .join('')
    .trim();
}
