/**
 * HTTP + feed helpers.
 *
 * Uses the host's global fetch (Node 18+). Every request is bounded by a
 * timeout and retried once on a transport error, because the daily run must
 * never hang on one flaky upstream: a source that fails is recorded in the run
 * status and the digest backfills from the remaining sources.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

export class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

async function once(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        ...(options?.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** One retry on transport failure; HTTP status errors are returned, not thrown. */
export async function request(url, options = {}, timeoutMs = 20000, retries = 1) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await once(url, options, timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 400));
    }
  }
  throw new HttpError(`request failed: ${lastError?.message ?? lastError}`, 0);
}

export async function getJson(url, { headers, timeoutMs = 20000 } = {}) {
  const res = await request(url, { headers: { Accept: 'application/json', ...(headers ?? {}) } }, timeoutMs);
  if (!res.ok) throw new HttpError(`HTTP ${res.status} for ${url}`, res.status);
  return res.json();
}

export async function postJson(url, body, { headers, timeoutMs = 20000 } = {}) {
  const res = await request(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(headers ?? {}) },
      body: JSON.stringify(body),
    },
    timeoutMs,
  );
  if (!res.ok) throw new HttpError(`HTTP ${res.status} for ${url}`, res.status);
  return res.json();
}

export async function getText(url, { headers, timeoutMs = 20000 } = {}) {
  const res = await request(url, { headers: { Accept: 'application/xml, text/xml, text/html, */*', ...(headers ?? {}) } }, timeoutMs);
  if (!res.ok) throw new HttpError(`HTTP ${res.status} for ${url}`, res.status);
  return res.text();
}

/* ------------------------------------------------------------------ feeds -- */

function tag(block, name) {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? m[1] : '';
}

function attr(block, name, attribute) {
  const m = new RegExp(`<${name}\\b[^>]*\\b${attribute}\\s*=\\s*["']([^"']*)["'][^>]*>`, 'i').exec(block);
  return m ? m[1] : '';
}

/**
 * Minimal RSS 2.0 / Atom parser. Deliberately not a general XML parser: it only
 * needs the handful of leaf fields the digest displays, and staying regex-based
 * keeps the plugin dependency-free.
 */
export function parseFeed(xml) {
  const entries = [];
  const blocks = [
    ...String(xml ?? '').matchAll(/<item\b[\s\S]*?<\/item>/gi),
    ...String(xml ?? '').matchAll(/<entry\b[\s\S]*?<\/entry>/gi),
  ];
  for (const match of blocks) {
    const block = match[0];
    const linkHref = attr(block, 'link', 'href');
    entries.push({
      title: tag(block, 'title'),
      link: linkHref || tag(block, 'link') || tag(block, 'guid'),
      description: tag(block, 'description') || tag(block, 'summary') || tag(block, 'content'),
      pubDate: tag(block, 'pubDate') || tag(block, 'updated') || tag(block, 'published') || tag(block, 'dc:date'),
      author: tag(block, 'author') || tag(block, 'dc:creator'),
      category: tag(block, 'category'),
      // arXiv publishes the author's own note here ("Accepted at EMNLP 2026"),
      // which is the strongest free quality signal available on day zero.
      comment: tag(block, 'arxiv:comment') || tag(block, 'comment'),
    });
  }
  const channelTitle = tag(String(xml ?? '').slice(0, 4000), 'title');
  return { channelTitle, entries };
}

/** RFC-822 (`Sun, 19 Jul 2026 16:00:00 GMT`) or ISO-8601 → `YYYY-MM-DD`. */
export function parseFeedDate(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const direct = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (direct) return `${direct[1]}-${direct[2]}-${direct[3]}`;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** `YYYY-MM-DD` shifted back by `days`, in local time. */
export function dateDaysAgo(days, now = new Date()) {
  const d = new Date(now.getTime() - days * 86400000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
