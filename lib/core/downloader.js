/**
 * Open-access full-text download.
 *
 * Scope is deliberately narrow — only resources the source itself declares as
 * open access:
 *
 *   - arXiv preprints (author-deposited, always downloadable);
 *   - PubMed Central via Europe PMC (`pmcid` present);
 *   - the publisher's OA `pdf_url` that OpenAlex reports for a work.
 *
 * Chinese subscription databases (CNKI / 万方 / 维普) are **not** scraped. Their
 * terms prohibit bulk downloading, and doing it from a campus network puts the
 * whole institution's IP range at risk, so those entries keep their详情页 link
 * and the user opens them in a browser. Nothing here attempts to bypass a
 * paywall, and an optional Unpaywall lookup is only used to *locate* a legal OA
 * copy when the user supplies their own email.
 *
 * Every download is bounded (per-file byte cap, per-run count) and verified to
 * actually be a PDF before it is written, so a captcha page or an HTML error
 * page can never be saved as a `.pdf`.
 */
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { cleanText } from './text.js';

export const MAX_PDF_BYTES = 25 * 1024 * 1024;
const VERIFY_BYTES = 5; // "%PDF-"

function baseHeaders(extra = {}) {
  return {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    ...extra,
  };
}

/** Filesystem-safe, stable file name: `YYYY-MM-DD-<slug>-<hash8>.pdf`. */
export function pdfFileName(paper, contentHash) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(paper.publishedDate || '') ? paper.publishedDate : 'undated';
  const title = cleanText(paper.title)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Chinese titles survive length-bounded slicing acceptably; keep 80 chars.
  const slug = title.slice(0, 80).trim() || 'paper';
  return `${date}-${slug}-${contentHash}.pdf`;
}

/** 8-hex-char content hash, used both for naming and de-duplication. */
export function hashBytes(bytes) {
  // FNV-1a over the first 64 KB is plenty to distinguish papers and to detect
  // an already-downloaded file without keeping a full digest.
  let h = 0x811c9dc5;
  const limit = Math.min(bytes.length, 65536);
  for (let i = 0; i < limit; i += 1) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function isPdfMagic(bytes) {
  return (
    bytes.length >= VERIFY_BYTES &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 && // F
    bytes[4] === 0x2d //   -
  );
}

async function fetchWithTimeout(url, { timeoutMs, headers, range } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: baseHeaders(range ? { Range: `bytes=0-${range - 1}`, ...headers } : headers),
      redirect: 'follow',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Download one paper's OA PDF.
 * @returns {Promise<{ok: true, path: string, bytes: number, hash: string}|{ok: false, reason: string}>}
 */
export async function downloadPdf(paper, pdfUrl, options = {}) {
  const dir = options.dir;
  const timeoutMs = options.timeoutMs ?? 60000;
  const maxBytes = options.maxBytes ?? MAX_PDF_BYTES;
  if (!dir) return { ok: false, reason: '未配置 PDF 目录' };
  if (!pdfUrl) return { ok: false, reason: '无开放获取地址' };

  try {
    mkdirSync(dir, { recursive: true });
  } catch (error) {
    return { ok: false, reason: `目录不可用: ${error?.message ?? error}` };
  }

  // 1) Cheap probe: fetch the first bytes and require the %PDF- signature, so an
  // HTML landing/captcha page is never stored as a PDF.
  let probe;
  try {
    probe = await fetchWithTimeout(pdfUrl, { timeoutMs: Math.min(timeoutMs, 30000), range: VERIFY_BYTES });
  } catch (error) {
    return { ok: false, reason: `探测失败: ${error?.message ?? error}` };
  }
  if (!probe.ok && probe.status !== 206) {
    return { ok: false, reason: `HTTP ${probe.status}` };
  }
  const head = new Uint8Array(await probe.arrayBuffer());
  if (!isPdfMagic(head)) {
    return { ok: false, reason: '不是 PDF（可能是落地页或验证页）' };
  }

  // 2) Full download, bounded.
  let res;
  try {
    res = await fetchWithTimeout(pdfUrl, { timeoutMs });
  } catch (error) {
    return { ok: false, reason: `下载失败: ${error?.message ?? error}` };
  }
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };

  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > maxBytes) return { ok: false, reason: `文件过大（${Math.round(declared / 1048576)}MB）` };

  let bytes;
  try {
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (error) {
    return { ok: false, reason: `读取失败: ${error?.message ?? error}` };
  }
  if (bytes.length > maxBytes) return { ok: false, reason: `文件过大（${Math.round(bytes.length / 1048576)}MB）` };
  if (!isPdfMagic(bytes)) return { ok: false, reason: '下载内容不是 PDF' };

  const hash = hashBytes(bytes);
  const path = join(dir, pdfFileName(paper, hash));
  // Re-running the digest must not duplicate files.
  if (existsSync(path) && statSync(path).size === bytes.length) {
    return { ok: true, path, bytes: bytes.length, hash, reused: true };
  }
  try {
    writeFileSync(path, bytes);
  } catch (error) {
    return { ok: false, reason: `写入失败: ${error?.message ?? error}` };
  }
  return { ok: true, path, bytes: bytes.length, hash };
}

/**
 * Ask Unpaywall for a legal OA copy. Optional and off unless the user supplies
 * their own email — Unpaywall rejects placeholder addresses (verified: HTTP 422
 * "Please use your own email address").
 */
export async function unpaywallPdfUrl(doi, email, timeoutMs = 20000) {
  const clean = String(doi ?? '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim();
  if (!clean || !email) return '';
  try {
    const res = await fetchWithTimeout(
      `https://api.unpaywall.org/v2/${encodeURIComponent(clean)}?email=${encodeURIComponent(email)}`,
      { timeoutMs, headers: { Accept: 'application/json' } },
    );
    if (!res.ok) return '';
    const json = await res.json();
    const best = json?.best_oa_location;
    return cleanText(best?.url_for_pdf || best?.url || '');
  } catch {
    return '';
  }
}

/**
 * Download full texts for the papers selected into the digest.
 * Mutates each paper with `pdfPath` / `pdfBytes` / `pdfError`.
 * @returns {Promise<{downloaded: number, failed: number, skipped: number, bytes: number}>}
 */
export async function attachFullTexts(papers, cfg, options = {}) {
  const summary = { downloaded: 0, failed: 0, skipped: 0, bytes: 0 };
  if (!cfg.pdfEnabled || !cfg.pdfDir) return summary;

  const limit = Math.max(1, cfg.pdfMaxPerRun ?? 10);
  let attempts = 0;
  // Fetch the optional OA copy only for papers that have no direct PDF link.
  const email = String(cfg.unpaywallEmail ?? '').trim();
  const timeoutMs = cfg.requestTimeoutMs ?? 20000;

  for (const paper of papers) {
    if (attempts >= limit) {
      summary.skipped += 1;
      continue;
    }
    // Chinese subscription sources keep their link — never bulk-downloaded.
    if (paper.track === 'zh' && !paper.pdfUrl) {
      summary.skipped += 1;
      continue;
    }
    let url = paper.pdfUrl || '';
    if (!url && email && paper.doi) {
      url = await unpaywallPdfUrl(paper.doi, email, timeoutMs);
      if (url) paper.isOpenAccess = true;
    }
    if (!url) {
      summary.skipped += 1;
      continue;
    }
    attempts += 1;
    const result = await downloadPdf(paper, url, {
      dir: cfg.pdfDir,
      timeoutMs: Math.max(timeoutMs, 60000),
    });
    if (result.ok) {
      paper.pdfUrl = url;
      paper.pdfPath = result.path;
      paper.pdfBytes = result.bytes;
      summary.downloaded += 1;
      summary.bytes += result.bytes;
    } else {
      paper.pdfError = result.reason;
      summary.failed += 1;
    }
  }
  return summary;
}
