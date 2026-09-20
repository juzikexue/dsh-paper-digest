/**
 * Tests for the open-access downloader's pure parts.
 *
 * The safety property under test is that a non-PDF response is never accepted:
 * a captcha page or an HTML error page must not be saved as a `.pdf`, which is
 * why the format is verified by magic bytes before any file is written.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pdfFileName, hashBytes, downloadPdf, MAX_PDF_BYTES } from '../lib/core/downloader.js';

const PDF_BYTES = Buffer.concat([
  Buffer.from('%PDF-1.7\n'),
  Buffer.from('1 0 obj\n<< /Type /Catalog >>\nendobj\n'),
  Buffer.from('%%EOF\n'),
]);

test('pdfFileName builds a dated, filesystem-safe, hashed name', () => {
  const name = pdfFileName({ title: 'A/B: Test*Paper? "quoted"', publishedDate: '2026-09-17' }, 'abcd1234');
  assert.equal(name, '2026-09-17-A B Test Paper quoted-abcd1234.pdf');
  // No path separators or Windows-reserved characters may survive.
  assert.ok(!/[\\/:*?"<>|]/.test(name));
});

test('pdfFileName tolerates a missing or malformed date', () => {
  assert.ok(pdfFileName({ title: 'X', publishedDate: '' }, 'deadbeef').startsWith('undated-'));
  assert.ok(pdfFileName({ title: 'X', publishedDate: '2026/09/17' }, 'deadbeef').startsWith('undated-'));
});

test('pdfFileName truncates a very long title instead of exceeding path limits', () => {
  const name = pdfFileName({ title: 'T'.repeat(500), publishedDate: '2026-01-01' }, 'cafebabe');
  assert.ok(name.length < 120, `name too long: ${name.length}`);
  assert.ok(name.endsWith('-cafebabe.pdf'));
});

test('hashBytes is stable and distinguishes different content', () => {
  const a = hashBytes(Buffer.from('%PDF-1.7 aaa'));
  const b = hashBytes(Buffer.from('%PDF-1.7 bbb'));
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.equal(a, hashBytes(Buffer.from('%PDF-1.7 aaa')));
  assert.notEqual(a, b);
});

test('downloadPdf refuses a non-PDF response and writes nothing', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pd-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response('<html>captcha required</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  const result = await downloadPdf({ title: 'T', publishedDate: '2026-09-17' }, 'https://example.test/x.pdf', { dir });
  assert.equal(result.ok, false);
  assert.match(result.reason, /不是 PDF/);
  assert.deepEqual(readdirSync(dir), [], 'nothing may be written for a non-PDF response');
});

test('downloadPdf succeeds on a real PDF and is idempotent', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pd-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(PDF_BYTES, { status: 200, headers: { 'content-type': 'application/pdf' } });
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  const paper = { title: 'Working Paper', publishedDate: '2026-09-17' };
  const first = await downloadPdf(paper, 'https://example.test/a.pdf', { dir });
  assert.equal(first.ok, true, first.reason);
  assert.equal(first.bytes, PDF_BYTES.length);
  assert.ok(readFileSync(first.path).subarray(0, 5).toString() === '%PDF-');

  // A second run must reuse the same file rather than duplicate it.
  const second = await downloadPdf(paper, 'https://example.test/a.pdf', { dir });
  assert.equal(second.ok, true);
  assert.equal(second.path, first.path);
  assert.equal(second.reused, true);
});

test('downloadPdf reports a missing directory instead of throwing', async () => {
  const result = await downloadPdf({ title: 'T' }, 'https://example.test/a.pdf', { dir: '' });
  assert.equal(result.ok, false);
  assert.match(result.reason, /目录/);
});

test('MAX_PDF_BYTES is a sane ceiling', () => {
  assert.ok(MAX_PDF_BYTES >= 5 * 1024 * 1024 && MAX_PDF_BYTES <= 100 * 1024 * 1024);
});
