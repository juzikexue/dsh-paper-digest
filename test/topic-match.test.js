/**
 * Regression tests for the scored topic matcher (lib/core/topic-match.js).
 *
 * Every case here is drawn from a live run against the real sources for the
 * topic 「人工智能教育」; the topic fixture uses the exact configured keywords.
 * The two groups matter equally:
 *
 *   - the ACCEPT cases are wording variants the strict gate scored 0 on, i.e.
 *     the false negatives that motivated the port;
 *   - the REJECT cases are false positives that a naive "any shared token" port
 *     would have introduced — the same failure mode the older tests already
 *     document for 教育 and for a bare bigram.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { topicTerms } from '../lib/core/config.js';
import { matchesTopic } from '../lib/core/text.js';
import { scoreTopicMatch, termTokens, DEFAULT_MIN_SCORE } from '../lib/core/topic-match.js';

function topic(name, zh, en) {
  return { id: 't1', name, zh, en, terms: topicTerms({ zh, en }) };
}

const AI_EDU = topic(
  '人工智能教育',
  '人工智能 教育; 大模型 教学; 智能导师系统',
  'artificial intelligence education; large language model teaching',
);

const paper = (title, abstract = '', venue = '', keywords = []) => ({
  title,
  abstract,
  venue,
  keywords,
});

test('an inserted word no longer collapses the match to zero', () => {
  // The exact failure the port fixes: strict tier scores this 0 because the
  // keyword is a contiguous token sequence.
  const strict = matchesTopic(
    paper('Artificial Intelligence in Education: A Systemic Scoping Review'),
    AI_EDU,
    { mode: 'strict' },
  );
  const scored = matchesTopic(
    paper('Artificial Intelligence in Education: A Systemic Scoping Review'),
    AI_EDU,
  );
  assert.equal(strict, null);
  assert.ok(scored, 'the scored tier must accept it');
});

test('an abbreviation is reachable through the equivalent table', () => {
  const p = paper('AI in Education: A Review');
  assert.equal(matchesTopic(p, AI_EDU, { mode: 'strict' }), null);
  const result = scoreTopicMatch(p, AI_EDU);
  assert.ok(result.accepted, `expected accepted, score=${result.score}`);
  // The equivalent form is discounted, so it must sit below a literal hit.
  assert.ok(result.score < 5, `equivalent hit must be discounted, got ${result.score}`);
  assert.ok(result.reasons.some((r) => r.includes('≈')), 'reasons must mark the equivalent hit');
});

test('a CJK partial overlap scores in the same family as a full one', () => {
  // 大语言模型 vs the configured 大模型: the strict tier cannot see it at all.
  const p = paper('大语言模型在教育教学中的应用综述');
  assert.equal(matchesTopic(p, AI_EDU, { mode: 'strict' }), null);
  const result = scoreTopicMatch(p, AI_EDU);
  assert.ok(result.score > 0, 'a CJK partial overlap must score above zero');
  assert.ok(result.matchedTerms.includes('大模型 教学'));
});

test('CJK terms produce overlapping windows, not one literal string', () => {
  const tokens = termTokens('人工智能教育');
  assert.ok(tokens.includes('人工智能'), 'the configured form itself');
  assert.ok(tokens.includes('工智能'), 'overlapping 3-char windows are what enable partial matches');
  // The full run is present too, so an exact hit still scores highest.
  assert.ok(tokens.includes('人工智能教育'));
  // 2-character windows are deliberately absent: the evidence floor is 3 chars.
  assert.equal(tokens.includes('工智'), false);
  assert.equal(tokens.includes('能教'), false);
});

test('a bare 2-character term is still not evidence', () => {
  // Same design decision the strict tier encodes, kept intact by the scorer.
  const t = topic('人工智能教育', '人工智能 教育', '');
  const p = paper(
    '人口变动下乡村义务教育资源配置脆弱性测度与韧性治理',
    '基于脆弱性评价模型对义务教育资源配置状况进行系统测度',
  );
  assert.equal(matchesTopic(p, t), null);
  assert.equal(scoreTopicMatch(p, t).score, 0);
});

test('a single shared CJK token does not carry a term *in the scored tier*', () => {
  // 人工智能 is present but 教育 is not: half a keyword is not the keyword.
  //
  // NOTE: the strict tier accepts this anyway, and that is by design, not a bug
  // in either tier. A space in a Chinese keyword means OR (README: 人工智能 教育
  // = "AI" *or* "education"), so `termGroupHit` is satisfied by 人工智能 alone.
  // This is exactly how a 「基于人工智能技术的图书情报」 paper reaches an
  // AI-in-education digest — and the report prints 命中关键词 so the user can see
  // it and split the keyword. The scored tier is deliberately stricter here so it
  // does not widen that door while adding recall elsewhere.
  const t = topic('人工智能教育', '人工智能 教育', '');
  const p = paper('人工智能产品适应性创新演化博弈研究');
  const result = scoreTopicMatch(p, t);
  assert.ok(
    result.score < DEFAULT_MIN_SCORE,
    `one shared half must stay under the threshold, got ${result.score}`,
  );
  assert.equal(result.accepted, false);
  // and document the strict tier's OR behaviour explicitly
  assert.deepEqual(matchesTopic(p, t, { mode: 'strict' }), ['人工智能 教育']);
});

test('an off-topic paper sharing one English word is rejected', () => {
  // Shares "large language model" but is about teaching vision models, not
  // about teaching students with LLMs.
  const p = paper('Large Language Model Teaches Visual Students: Cross-Modality Transfer');
  assert.equal(matchesTopic(p, AI_EDU), null);
});

test('a library-science AI paper does not pass the scored tier', () => {
  // Real case from 图书情报工作. The strict tier admits it through the OR
  // keyword (人工智能 alone satisfies 人工智能 教育); the scored tier keeps it at
  // 3.13, under the 3.5 threshold, so a paper whose only anchor is 人工智能
  // without any education term does not get in on the scored path.
  const p = paper('基于图神经网络的技术融合识别与预测研究——以人工智能技术为例', '', '图书情报工作');
  assert.equal(scoreTopicMatch(p, AI_EDU).accepted, false);
});

test('a venue hit is recorded and earns a bonus, but cannot carry a paper alone', () => {
  const t = topic('学习分析', '学习分析; 教育数据挖掘', '');
  const p = paper('实证研究', '', '学习分析杂志');
  const result = scoreTopicMatch(p, t);
  assert.ok(result.reasons.some((r) => r.startsWith('venue:')), 'venue hit must be recorded');
  assert.ok(result.score, 'venue must contribute to the score');
  // Venue evidence alone lands at 3.0, under the 3.5 bar. Publishers do ship
  // wrong or generic container titles, so the venue stays additive evidence: it
  // raises a score but must not single-handedly admit a paper.
  assert.equal(result.accepted, false);
  assert.equal(result.score, 3);
});

test('a venue hit tips a paper that also matches on content', () => {
  const t = topic('学习分析', '学习分析; 教育数据挖掘', '');
  const p = paper('学习分析视角下的多模态数据研究', '', '学习分析杂志');
  const result = scoreTopicMatch(p, t);
  assert.ok(result.accepted, `title + venue must clear the bar, got ${result.score}`);
  assert.equal(result.score, 8, 'title hit (5.0) plus venue credit (1.0) and bonus (2.0)');
  assert.ok(result.reasons.some((r) => r.startsWith('venue:')), 'venue credit must be recorded');
});

test('reasons stay human-readable so the report can print 命中关键词', () => {
  const result = scoreTopicMatch(
    paper('Visualization analysis of artificial intelligence education research'),
    AI_EDU,
  );
  assert.deepEqual(result.matchedTerms, ['artificial intelligence education']);
  assert.ok(result.reasons.some((r) => r.startsWith('title:')));
});

test('strict mode reproduces the old behaviour exactly', () => {
  // The pre-port decision path must remain reachable and unchanged.
  const onTopic = paper('人工智能赋能学习分析研究');
  assert.ok(matchesTopic(onTopic, AI_EDU, { mode: 'strict' }));
  assert.equal(matchesTopic(paper('AI in Education: A Review'), AI_EDU, { mode: 'strict' }), null);
});

test('a topic with no keywords accepts everything, as before', () => {
  assert.equal(matchesTopic(paper('anything'), topic('空', '', '')), true);
});
