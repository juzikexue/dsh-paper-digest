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
  buildKeywordPrompt,
  parseKeywordGroups,
  coverageVerdict,
} from '../lib/core/suggest.js';
import { splitConcepts, splitKeywords, topicTerms } from '../lib/core/config.js';
import { matchesTopic } from '../lib/core/text.js';

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

/* ── keywords generated from a topic name ─────────────────────────────────── */

test('requirements become one AND string with OR-ed phrasings inside', () => {
  // The model returns AND-ed requirements; the field's syntax is `+` between
  // requirements and `,` between synonyms, so the two have to line up.
  const reply = JSON.stringify({
    requirements: [
      { zh: ['人工智能', '大模型'], en: ['artificial intelligence', 'large language model'] },
      { zh: ['语文教育', '阅读教学'], en: ['chinese language education', 'reading instruction'] },
    ],
  });
  const out = parseKeywordGroups(reply);
  assert.equal(out.length, 1, 'one keyword string covering every requirement');
  assert.equal(out[0].zh, '人工智能, 大模型 + 语文教育, 阅读教学');
  assert.equal(
    out[0].en,
    'artificial intelligence, large language model + chinese language education, reading instruction',
  );
  assert.equal(out[0].requirementCount, 2);
});

test('an unspecific phrasing is dropped, and an empty requirement with it', () => {
  const reply = JSON.stringify({
    requirements: [
      { zh: ['教育'], en: ['education'] },
      { zh: ['学习分析', '教育'], en: ['learning analytics'] },
    ],
  });
  const out = parseKeywordGroups(reply);
  assert.equal(out.length, 1);
  assert.equal(out[0].zh, '学习分析', 'the generic 教育 is dropped, not passed through');
  assert.equal(out[0].requirementCount, 1);
});

test('a reply with no usable requirement yields nothing', () => {
  for (const bad of [
    '',
    'nope',
    '{"requirements": 3}',
    '{"requirements":[{"zh":["教育"],"en":["education"]}]}',
    '{"other":[]}',
  ]) {
    assert.deepEqual(parseKeywordGroups(bad), []);
  }
});

test('the older flat groups shape is still accepted', () => {
  const reply = JSON.stringify({ groups: [{ zh: '学习分析', en: 'learning analytics' }] });
  const out = parseKeywordGroups(reply);
  assert.equal(out.length, 1);
  assert.equal(out[0].zh, '学习分析');
  assert.equal(out[0].en, 'learning analytics');
});

test('the keyword prompt asks for AND-ed requirements, not a flat list', () => {
  const prompt = buildKeywordPrompt({ name: '教育数据挖掘' });
  assert.ok(prompt.includes('教育数据挖掘'), 'carries the topic name');
  assert.ok(prompt.includes('必须同时满足'), 'states that requirements are ANDed');
  assert.ok(prompt.includes('任意一个即可'), 'states that phrasings are ORed');
  assert.ok(prompt.includes('至少 3 个字'), 'states the Chinese floor');
  assert.ok(prompt.includes('至少两个词'), 'states the English floor');
  assert.ok(prompt.includes('通常 1 到 3 个'), 'warns against inventing many requirements');
});

test('coverage verdicts distinguish "no results" from "could not check"', () => {
  assert.equal(coverageVerdict(0), '检索不到结果');
  assert.equal(coverageVerdict(null), '未能核验');
  assert.equal(coverageVerdict(undefined), '未能核验');
  assert.match(coverageVerdict(12610), /12610/);
  assert.match(coverageVerdict(9_000_000), /过宽/);
});

/* ── separator semantics the field has to express ─────────────────────────── */

test('separators: `;` and newline are alternatives, `+` is a requirement', () => {
  // Both readings are legitimate intents that look identical when written as
  // separate lines, so the field has to distinguish them.
  assert.deepEqual(splitConcepts('机器学习; 深度学习'), [['机器学习', '深度学习']]);
  assert.deepEqual(splitConcepts('机器学习\n深度学习'), [['机器学习', '深度学习']]);
  assert.deepEqual(splitConcepts('人工智能, AI + 语文教育, 阅读教学'), [
    ['人工智能', 'AI'],
    ['语文教育', '阅读教学'],
  ]);
  // Two `+` requirements, each with its own alternatives.
  assert.deepEqual(splitConcepts('a one; a two + b one; b two'), [
    ['a one', 'a two'],
    ['b one', 'b two'],
  ]);
});

test('a space inside a Chinese probe survives parsing', () => {
  // 人工智能 教育 means "AI or education" at the keyword level and must not be
  // split into two probes by the concept parser.
  assert.deepEqual(splitConcepts('人工智能 教育; 大模型 教学'), [['人工智能 教育', '大模型 教学']]);
  assert.deepEqual(splitKeywords('人工智能 教育; 大模型 教学'), ['人工智能 教育', '大模型 教学']);
});

test('concepts are ANDed: a paper must satisfy every `+` requirement', () => {
  const topic = {
    id: 't',
    name: 'AI 语文教学',
    zh: '人工智能, AI + 语文教育, 阅读教学',
    en: '',
    terms: topicTerms({ zh: '人工智能, AI + 语文教育, 阅读教学', en: '' }),
    concepts: splitConcepts('人工智能, AI + 语文教育, 阅读教学'),
  };
  const both = { title: '人工智能辅助语文教育写作教学研究', abstract: '', keywords: [] };
  const onlyAi = { title: '人工智能产品适应性创新演化博弈研究', abstract: '', keywords: [] };
  const onlyChinese = { title: '语文教育中的阅读教学策略研究', abstract: '', keywords: [] };
  assert.equal(topic.concepts.length, 2, 'two requirements');
  assert.ok(matchesTopic(both, topic), 'both requirements met → accepted');
  assert.equal(matchesTopic(onlyAi, topic), null, 'one requirement missing → rejected');
  assert.equal(matchesTopic(onlyChinese, topic), null, 'the other requirement missing → rejected');
});

test('a single requirement keeps the old OR reach (no regression)', () => {
  // `;` still means alternatives, so a user listing many phrasings of one idea
  // does not accidentally require all of them. This is the shape measured on the
  // real 「强化学习」 topic, where AND-requiring seven phrasings admitted 0 papers.
  const seven = Array.from({ length: 7 }, (_, i) => `reinforcement learning aspect ${i}`);
  const topic = {
    id: 't',
    name: '强化学习',
    zh: '',
    en: seven.join('; '),
    terms: topicTerms({ zh: '', en: seven.join('; ') }),
    concepts: splitConcepts(seven.join('; ')),
  };
  assert.equal(topic.concepts.length, 1, 'seven phrasings are ONE requirement');
  const hit = { title: 'A survey of reinforcement learning aspect 3 methods', abstract: '', keywords: [] };
  assert.ok(matchesTopic(hit, topic), 'matching one phrasing is enough');
});
