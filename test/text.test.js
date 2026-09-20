/**
 * Regression tests for keyword matching and text helpers.
 *
 * Every case below corresponds to a real defect found against live sources —
 * the comments name the symptom so a future change that reintroduces it fails
 * loudly here instead of quietly polluting the digest.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normaliseTitle,
  normaliseGroups,
  termGroupHit,
  termHitRatio,
  matchesTopic,
  applyTopicMatch,
  cleanText,
  truncate,
  acceptedVenue,
  contentEvidence,
} from '../lib/core/text.js';
import { topicTerms } from '../lib/core/config.js';

function topic(name, zh, en) {
  const t = { id: 't1', name, zh, en };
  t.terms = topicTerms(t);
  return t;
}

test('normaliseTitle strips separators without mangling words starting with "a"', () => {
  // Regression: an earlier version stripped a leading article, turning "app"
  // into "pp" and "artificial" into "rtificial", which manufactured matches
  // between unrelated fields.
  assert.equal(normaliseTitle('Artificial Intelligence'), 'artificialintelligence');
  assert.equal(normaliseTitle('An App for Learning'), 'anappforlearning');
  assert.ok(normaliseTitle('The App').startsWith('theapp'));
  assert.equal(normaliseTitle('A B'), 'ab');
});

test('normaliseGroups keeps word boundaries for group splitting', () => {
  assert.equal(normaliseGroups('人工智能 教育'), '人工智能 教育');
  assert.equal(normaliseGroups('computer-assisted language learning'), 'computer assisted language learning');
});

test('English keyword is a phrase: every word is required', () => {
  const blob = normaliseTitle('AI-Driven Learning Analytics for Student Evaluations');
  // "learning" alone must not satisfy the whole phrase.
  assert.equal(termGroupHit('computer-assisted language learning', blob), 0);
  assert.ok(termGroupHit('learning analytics', blob) === 1);
});

test('Chinese keyword: a 3+ character alternative matches on its own', () => {
  const t = topic('人工智能教育', '人工智能 教育', '');
  const paper = { title: '人工智能赋能学习分析研究', abstract: '', keywords: [] };
  assert.ok(matchesTopic(paper, t));
});

test('a bare 2-character alternative is not enough on its own', () => {
  // Design decision, verified against live data: with the topic
  // "人工智能 教育" the word 教育 alone would pull every 义务教育/教育政策 paper
  // into an AI-in-education digest. Broad one-word alternatives are therefore
  // ignored; the report prints 命中关键词 so such a collision is visible and the
  // user can tighten the keyword instead.
  const t = topic('人工智能教育', '人工智能 教育', '');
  const paper = {
    title: '人口变动下乡村义务教育资源配置脆弱性测度与韧性治理',
    abstract: '基于脆弱性评价模型对义务教育资源配置状况进行系统测度',
    keywords: [],
  };
  assert.equal(matchesTopic(paper, t), null);
});

test('a single generic Chinese bigram is not topical evidence', () => {
  // Regression: 学习 alone pulled a nuclear-physics paper into a 语言学习 topic.
  const blob = normaliseTitle('fissionproductreleasebehaviorinlbecooledfastreactorfuel');
  assert.equal(termGroupHit('语言学习', blob), 0);
  const t = topic('语言学习技术', '语言学习 技术', '');
  const paper = { title: 'Fission Product Release Behavior in LBE-Cooled Fast Reactor Fuel', abstract: 'failure analysis and its application', keywords: [] };
  assert.equal(matchesTopic(paper, t), null);
});

test('an unrelated single shared word in the body is not enough', () => {
  // Body-tier matching needs more than one keyword to fire.
  const t = topic('学习分析', '学习分析; 教育数据挖掘; 学习者建模', '');
  const paper = {
    title: '高考作文中心理健康要素的融入特征及演变',
    abstract: '本文分析了近十年高考作文真题中的心理健康要素，采用内容分析方法。',
    keywords: [],
  };
  assert.equal(matchesTopic(paper, t), null);
});

test('an on-topic title is accepted outright', () => {
  const t = topic('学习分析', '学习分析; 教育数据挖掘', '');
  const paper = { title: '人工智能赋能学习分析：基于多模态数据的实证研究', abstract: '', keywords: [] };
  assert.ok(matchesTopic(paper, t));
});

test('applyTopicMatch records the keyword that caused the match', () => {
  const t = topic('人工智能教育', '人工智能 教育', '');
  const paper = { title: '人工智能赋能教育研究', abstract: '', keywords: [] };
  assert.ok(applyTopicMatch(paper, t));
  assert.equal(paper.topicId, 't1');
  assert.ok(Array.isArray(paper.matchedTerms) && paper.matchedTerms.length > 0);
});

test('termHitRatio is a real fraction, not a boolean', () => {
  const ratio = termHitRatio('人工智能 教育', normaliseTitle('人工智能赋能教育'));
  assert.ok(ratio > 0 && ratio <= 1);
});

test('cleanText unwraps CDATA, tags and entities', () => {
  assert.equal(cleanText('<![CDATA[<p>数字&nbsp;生产力</p>]]>'), '数字 生产力');
  assert.equal(cleanText('a &amp; b &#65;'), 'a & b A');
});

test('truncate cuts on a sentence boundary when one is nearby', () => {
  const text = `${'甲'.repeat(50)}。${'乙'.repeat(200)}`;
  const out = truncate(text, 80);
  assert.ok(out.length <= 81);
  assert.ok(out.endsWith('。') || out.endsWith('…'));
});

test('acceptedVenue reads arXiv comment metadata', () => {
  assert.equal(acceptedVenue('Accepted at EMNLP 2026. 20 pages'), 'EMNLP');
  assert.equal(acceptedVenue('39 pages'), '');
});

test('contentEvidence detects method/result/limitation/open-data hints', () => {
  const ev = contentEvidence({
    title: 'A study',
    abstract: '本研究采用问卷方法，样本为 500 名学生。结果表明显著提升。局限在于样本单一。代码已开源 https://github.com/x/y',
  });
  assert.equal(ev.method, true);
  assert.equal(ev.result, true);
  assert.equal(ev.limitation, true);
  assert.equal(ev.dataOpen, true);
});
