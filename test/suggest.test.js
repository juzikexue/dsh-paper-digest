/**
 * Tests for the keyword-gap suggestion engine (lib/core/suggest.js).
 *
 * These cover the guards, not the model. Every guard exists because a language
 * model cannot be trusted with it: it will happily propose a phrase that appears
 * nowhere in the corpus, re-propose a keyword the user already has, or claim a
 * coverage count it made up. The parser is what makes the feature safe to expose.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mineGap,
  buildSuggestPrompt,
  parseSuggestions,
  mergeSuggestions,
  MAX_SUGGESTIONS,
} from '../lib/core/suggest.js';

const topic = { id: 't1', name: '人工智能教育', zh: '人工智能 教育', en: 'artificial intelligence education' };

const corpus = [
  { title: 'AI literacy for K-12 students: a systematic review', abstract: 'We review ai literacy frameworks.' },
  { title: 'Teaching ai literacy in secondary schools', abstract: 'A curriculum for ai literacy.' },
  { title: 'Fission product release in LBE-cooled fast reactors', abstract: 'Nuclear fuel behaviour.' },
];

test('a phrase absent from the corpus is rejected, however plausible', () => {
  // The model's most likely failure: proposing something real in the world but
  // not present in the papers it was given.
  const out = parseSuggestions(
    JSON.stringify({ suggestions: [{ phrase: 'prompt engineering', lang: 'en', reason: 'x', estimatedCoverage: 5 }] }),
    { topic, corpus },
  );
  assert.deepEqual(out, []);
});

test('coverage is recomputed locally, never taken from the reply', () => {
  const out = parseSuggestions(
    JSON.stringify({ suggestions: [{ phrase: 'ai literacy', lang: 'en', reason: 'x', estimatedCoverage: 99 }] }),
    { topic, corpus },
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].coverage, 2, 'two of the three corpus titles contain it');
  assert.equal(out[0].claimedCoverage, 99, 'the model claim is kept for audit but not trusted');
});

test('a phrase the user already configured is rejected', () => {
  const out = parseSuggestions(
    JSON.stringify({
      suggestions: [
        { phrase: 'artificial intelligence education', lang: 'en', reason: 'x', estimatedCoverage: 1 },
        { phrase: '人工智能 教育', lang: 'zh', reason: 'x', estimatedCoverage: 1 },
      ],
    }),
    { topic, corpus },
  );
  assert.deepEqual(out, []);
});

test('a generic single word is rejected', () => {
  const wide = [{ title: 'Education and social structure', abstract: 'education research' }];
  const out = parseSuggestions(
    JSON.stringify({ suggestions: [{ phrase: 'education', lang: 'en', reason: 'x', estimatedCoverage: 1 }] }),
    { topic, corpus: wide },
  );
  assert.deepEqual(out, []);
});

test('a short Chinese generic phrase is rejected', () => {
  const zh = [{ title: '义务教育资源配置研究', abstract: '教育政策分析' }];
  const out = parseSuggestions(
    JSON.stringify({ suggestions: [{ phrase: '教育', lang: 'zh', reason: 'x', estimatedCoverage: 1 }] }),
    { topic, corpus: zh },
  );
  assert.deepEqual(out, [], 'under the 4-character floor');
});

test('duplicate phrases collapse and results are ranked by coverage', () => {
  const out = parseSuggestions(
    JSON.stringify({
      suggestions: [
        { phrase: 'ai literacy', lang: 'en', reason: 'a', estimatedCoverage: 1 },
        { phrase: 'AI Literacy', lang: 'en', reason: 'b', estimatedCoverage: 1 },
        { phrase: 'systematic review', lang: 'en', reason: 'c', estimatedCoverage: 1 },
      ],
    }),
    { topic, corpus },
  );
  assert.equal(out.length, 2, 'case variants collapse');
  assert.equal(out[0].phrase, 'ai literacy');
});

test('a fenced or chatty reply still parses', () => {
  const reply = 'Sure!\n```json\n{"suggestions":[{"phrase":"ai literacy","lang":"en","reason":"r","estimatedCoverage":2}]}\n```\n';
  const out = parseSuggestions(reply, { topic, corpus });
  assert.equal(out.length, 1);
  assert.equal(out[0].phrase, 'ai literacy');
});

test('a malformed reply yields no suggestions instead of throwing', () => {
  for (const bad of ['', 'not json at all', '{"suggestions": "nope"}', '{"other": 1}']) {
    assert.deepEqual(parseSuggestions(bad, { topic, corpus }), []);
  }
});

test('the suggestion list is capped', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({
    phrase: `ai literacy review part ${i}`,
    lang: 'en',
    reason: 'r',
    estimatedCoverage: 1,
  }));
  const wide = many.map((s) => ({ title: s.phrase, abstract: '' }));
  const out = parseSuggestions(JSON.stringify({ suggestions: many }), { topic, corpus: wide });
  assert.ok(out.length <= MAX_SUGGESTIONS, `capped at ${MAX_SUGGESTIONS}, got ${out.length}`);
});

test('mineGap splits near-misses from controls and picks the largest topic', () => {
  const rejected = [
    ...Array.from({ length: 12 }, (_, i) => ({
      paper: { title: `t1-${i}`, abstract: '' },
      topicId: 't1',
      topicName: 'A',
      score: 3.4 - i * 0.1,
    })),
    ...Array.from({ length: 5 }, (_, i) => ({
      paper: { title: `t2-${i}`, abstract: '' },
      topicId: 't2',
      topicName: 'B',
      score: 1 - i * 0.1,
    })),
  ];
  const { nearMisses, controls, topicId } = mineGap(rejected, { nearMissLimit: 5, controlLimit: 2 });
  assert.equal(topicId, 't1', 'the topic with the largest pool wins');
  assert.equal(nearMisses.length, 5);
  assert.ok(nearMisses[0].score >= nearMisses[4].score, 'near-misses are ranked by score');
  assert.equal(controls.length, 2);
  assert.ok(controls[0].score <= nearMisses[4].score, 'controls come from the bottom');
});

test('mineGap on an empty pool is safe', () => {
  assert.deepEqual(mineGap([]), { nearMisses: [], controls: [], topicId: '' });
  assert.deepEqual(mineGap(null).nearMisses, []);
});

test('the prompt forbids inventing and allows "found nothing"', () => {
  const prompt = buildSuggestPrompt({ topic, nearMisses: [{ paper: corpus[0], score: 3 }], controls: [] });
  assert.ok(prompt.includes('只能从'), 'must constrain the source of phrases');
  assert.ok(prompt.includes('不得凭常识补充'));
  assert.ok(prompt.includes('返回空数组'), 'must permit an empty answer');
  assert.ok(prompt.includes(corpus[0].title), 'must carry the candidate text');
});

test('mineGap deduplicates repeated titles and breaks score ties by recency', () => {
  // Measured problem: a dozen different papers land on the same fractional
  // score, so score alone left the sample arbitrary; and the same paper arrives
  // from two sources, burning prompt tokens twice.
  const rejected = [
    { paper: { title: 'Same Paper', publishedDate: '2026-09-01' }, topicId: 't1', score: 3.25 },
    { paper: { title: 'same   paper', publishedDate: '2026-09-01' }, topicId: 't1', score: 3.25 },
    { paper: { title: 'Older Tie', publishedDate: '2024-01-01' }, topicId: 't1', score: 3.25 },
    { paper: { title: 'Newer Tie', publishedDate: '2026-09-19' }, topicId: 't1', score: 3.25 },
  ];
  const { nearMisses } = mineGap(rejected, { nearMissLimit: 10, controlLimit: 0 });
  assert.equal(nearMisses.length, 3, 'the duplicate collapses');
  assert.equal(nearMisses[0].paper.title, 'Newer Tie', 'the most recent tie comes first');
  assert.equal(nearMisses[2].paper.title, 'Older Tie');
});

test('mergeSuggestions drops dismissed phrases and keeps the list', () => {
  const state = { dismissed: ['ai literacy'] };
  const merged = mergeSuggestions(state, [
    { phrase: 'ai literacy', coverage: 2 },
    { phrase: 'intelligent tutoring', coverage: 1 },
  ], 't1');
  assert.equal(merged.suggestions.length, 1);
  assert.equal(merged.suggestions[0].phrase, 'intelligent tutoring');
  assert.deepEqual(merged.dismissed, ['ai literacy']);
  assert.ok(merged.generatedAt, 'stamps a generation time');
});
