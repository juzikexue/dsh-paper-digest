/**
 * Regression tests for config normalisation, scheduling and digest selection.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  defaultConfig,
  sanitise,
  normaliseTime,
  parseTime,
  isDue,
  localDateKey,
  splitKeywords,
  topicTerms,
} from '../lib/core/config.js';
import { scorePaper, selectDigest, dedupe, passesGate, relevanceFactor } from '../lib/core/score.js';
import { renderMarkdown, digestFileName } from '../lib/core/render.js';

const NOW = new Date('2026-09-17T10:00:00');

function paper(over = {}) {
  return {
    title: 'A Study of Something',
    authors: ['A', 'B'],
    abstract: '本研究采用方法，结果表明显著。',
    venue: 'Some Journal',
    venueType: 'journal',
    track: 'en',
    source: 'openalex',
    sourceLabel: 'OpenAlex',
    publishedDate: '2026-09-16',
    doi: '10.1/x',
    url: 'https://doi.org/10.1/x',
    keywords: [],
    citedBy: 0,
    isCore: false,
    isRetracted: false,
    acceptedAt: '',
    preprint: false,
    isJournalFeed: false,
    topicId: 't1',
    topicName: '主题一',
    ...over,
  };
}

test('normaliseTime accepts loose input and rejects nonsense', () => {
  assert.equal(normaliseTime('9:5'), '09:05');
  assert.equal(normaliseTime(' 23：59 '), '23:59');
  assert.equal(normaliseTime('24:00', '09:00'), '09:00');
  assert.equal(normaliseTime('abc', '07:30'), '07:30');
  assert.equal(parseTime('09:00').hour, 9);
});

test('sanitise repairs a partial or hostile config', () => {
  const cfg = sanitise({
    time: '25:99',
    dailyCount: 999,
    mix: { zh: 500 },
    topics: [{ name: '', zh: '', en: '' }, { name: '有效', zh: '关键词' }],
    journals: [{ id: 'bad id!' }, { id: 'JJYJ', name: '经济研究' }],
    sources: { openalex: false },
  });
  assert.equal(cfg.time, '09:00');
  assert.equal(cfg.dailyCount, 50);
  assert.equal(cfg.mix.zh + cfg.mix.en, cfg.dailyCount);
  assert.equal(cfg.topics.length, 1);
  assert.equal(cfg.journals.length, 1);
  assert.equal(cfg.sources.openalex, false);
  assert.equal(cfg.sources.crossref, true);
});

test('default config is self-consistent', () => {
  const cfg = defaultConfig();
  assert.equal(cfg.mix.zh + cfg.mix.en, cfg.dailyCount);
  assert.ok(cfg.topics.length >= 3);
  assert.ok(cfg.outputDir.length > 0);
});

test('splitKeywords and topicTerms flatten separators', () => {
  assert.deepEqual(splitKeywords('a; b，c、d\ne'), ['a', 'b', 'c', 'd', 'e']);
  const terms = topicTerms({ name: 'x', zh: '甲;乙', en: 'one; two' });
  assert.deepEqual(terms.all, ['甲', '乙', 'one', 'two']);
});

test('isDue fires after the configured time and only once per day', () => {
  const base = { enabled: true, time: '09:00', lastRunDate: '' };
  assert.equal(isDue(base, new Date('2026-09-17T08:59:00')), false);
  assert.equal(isDue(base, new Date('2026-09-17T09:00:00')), true);
  // A machine asleep at 09:00 still produces today's digest when it wakes.
  assert.equal(isDue(base, new Date('2026-09-17T14:30:00')), true);
  assert.equal(isDue({ ...base, lastRunDate: localDateKey(NOW) }, NOW), false);
  assert.equal(isDue({ ...base, enabled: false }, NOW), false);
});

test('passesGate rejects retracted, untitled, linkless and stale records', () => {
  const opts = { lookbackDays: 14, now: NOW };
  assert.ok(passesGate(paper(), opts));
  assert.equal(passesGate(paper({ isRetracted: true }), opts), false);
  assert.equal(passesGate(paper({ title: '短' }), opts), false);
  assert.equal(passesGate(paper({ url: '', doi: '' }), opts), false);
  assert.equal(passesGate(paper({ publishedDate: '2026-01-01' }), opts), false);
  // Journal feeds carry the current issue and are exempt from the age window.
  assert.ok(passesGate(paper({ publishedDate: '2026-01-01', isJournalFeed: true }), opts));
});

test('dedupe collapses the same paper across sources, DOI or title', () => {
  // Same DOI, different title wording → one paper.
  const a = paper({ doi: '10.1/a', title: 'Same Paper', source: 'openalex' });
  const b = paper({ doi: '10.1/a', title: 'Same Paper (preprint)', source: 'arxiv' });
  // Same normalised title, different DOI (a common OpenAlex/Zenodo duplication)
  // → one paper.
  const c = paper({ doi: '10.9/other', title: 'Same Paper' });
  assert.equal(dedupe([a, b]).length, 1);
  assert.equal(dedupe([a, c]).length, 1);
  // Distinct on both keys → kept apart.
  const d = paper({ doi: '10.2/b', title: 'Different Paper' });
  assert.equal(dedupe([a, d]).length, 2);
});

test('dedupe keeps the richer record and refuses to overwrite with blanks', () => {
  const rich = paper({ doi: '10.5/r', title: 'Rich Record', abstract: '有摘要', authors: ['甲'], venue: '期刊' });
  const sparse = paper({ doi: '10.5/r', title: 'Rich Record', abstract: '', authors: [], venue: '' });
  const merged = dedupe([rich, sparse]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].abstract, '有摘要');
  assert.deepEqual(merged[0].authors, ['甲']);
  assert.equal(merged[0].venue, '期刊');
});

test('relevance: the topic keyword itself lifts an on-topic title', () => {
  const t = { id: 't1', name: '人工智能教育', terms: topicTerms({ zh: '人工智能 教育', en: '' }) };
  const onTopic = paper({ title: '人工智能赋能教育研究', abstract: '', venue: '某期刊' });
  const offTopic = paper({ title: '义务教育资源配置', abstract: '', venue: '某期刊' });
  const on = relevanceFactor(onTopic, t);
  const off = relevanceFactor(offTopic, t);
  assert.ok(on > off, `expected on-topic relevance (${on}) to exceed off-topic (${off})`);
});

test('scorePaper rewards venue authority over a bare preprint', () => {
  const t = { id: 't1', name: '学习分析', terms: topicTerms({ zh: '学习分析', en: '' }) };
  const opts = { lookbackDays: 14, now: NOW };
  const core = scorePaper(paper({ isCore: true, title: '学习分析研究' }), t, opts);
  const preprint = scorePaper(paper({ venueType: 'preprint', preprint: true, title: '学习分析研究' }), t, opts);
  assert.ok(core.score > preprint.score);
  assert.ok(core.reasons.length > 0);
  assert.ok(core.breakdown.venue > preprint.breakdown.venue);
});

test('selectDigest spreads slots across topics and honours the language mix', () => {
  const cfg = sanitise({
    ...defaultConfig(),
    dailyCount: 6,
    mix: { zh: 3, en: 3 },
    topics: [
      { id: 't1', name: '主题一', zh: 'a' },
      { id: 't2', name: '主题二', zh: 'b' },
    ],
    journals: [],
  });
  const mk = (id, track, n) =>
    Array.from({ length: n }, (_, i) =>
      // Distinct venues so the per-venue cap does not limit the pool.
      paper({ topicId: id, track, title: `${id}-${track}-${i}`, venue: `Journal ${id}-${track}-${i}`, doi: `10/${id}${track}${i}` }),
    );
  const scored = [...mk('t1', 'en', 5), ...mk('t2', 'en', 5)];
  const picked = selectDigest(scored, cfg);
  assert.equal(picked.length, 6);
  // Regression: a global top-N cap once returned every paper from one topic.
  const topics = new Set(picked.map((p) => p.topicId));
  assert.equal(topics.size, 2);
});

test('selectDigest can allocate slots to a caller-supplied extra group', () => {
  // Regression: journal items that matched no topic were scored but never
  // selected, because allocation only walked cfg.topics.
  const cfg = sanitise({
    ...defaultConfig(),
    dailyCount: 4,
    mix: { zh: 2, en: 2 },
    topics: [{ id: 't1', name: '主题一', zh: '学习分析' }],
    journals: [],
  });
  const scored = [
    paper({ topicId: 't1', track: 'zh', title: 't1-zh', venue: 'A', doi: '10/a' }),
    paper({ topicId: 't1', track: 'en', title: 't1-en', venue: 'B', doi: '10/b' }),
    paper({ topicId: '__journals__', track: 'zh', title: 'j-zh', venue: 'C', doi: '10/c' }),
    paper({ topicId: '__journals__', track: 'zh', title: 'j-zh-2', venue: 'D', doi: '10/d' }),
  ];
  const picked = selectDigest(scored, cfg, { extraTopics: [{ id: '__journals__', name: '最近一期目录' }] });
  assert.equal(picked.length, 4);
  assert.ok(
    picked.some((p) => p.topicId === '__journals__'),
    'extra-group papers must be selectable',
  );
});

test('renderMarkdown produces one grouped document with diagnostics', () => {
  const cfg = sanitise(defaultConfig());
  const digest = {
    groups: [{ topic: { id: 't1', name: '主题一' }, papers: [paper({ score: 42, reasons: ['同行评审期刊'], matchedTerms: ['学习分析'], breakdown: { venue: 20, content: 10, recency: 5, data: 2, community: 1, author: 4 } })] }],
    stats: [{ source: 'openalex', label: 'OpenAlex·主题一', fetched: 10, kept: 3 }],
    errors: [{ source: 'arxiv', label: 'arXiv·主题一', message: 'timeout' }],
    totals: { candidates: 10, droppedByGate: 1, duplicates: 2, scored: 7, selected: 1, zh: 0, en: 1 },
  };
  const md = renderMarkdown(digest, cfg, NOW);
  assert.match(md, /^# 论文日报 · 2026-09-17/);
  assert.match(md, /## 主题一/);
  assert.match(md, /命中关键词/);
  assert.match(md, /运行诊断/);
  assert.match(md, /arXiv·主题一/);
  assert.equal(digestFileName(NOW), '20260917-论文日报.md');
});

test('renderMarkdown states an empty result instead of an empty document', () => {
  const cfg = sanitise(defaultConfig());
  const md = renderMarkdown(
    { groups: [], stats: [], errors: [], totals: { candidates: 0, droppedByGate: 0, duplicates: 0, scored: 0, selected: 0, zh: 0, en: 0 } },
    cfg,
    NOW,
  );
  assert.match(md, /没有选出论文/);
});
