/**
 * Tests for the Chinese summary stage.
 *
 * The property that matters most: a model failure must never break the digest.
 * Each paper is isolated, the failure is recorded on that paper, and every other
 * paper still gets its summary.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSummaryPrompt,
  cleanSummary,
  resolveRoute,
  summarizePapers,
} from '../lib/core/summarizer.js';

/** Minimal fake llm service: streams the configured text back for each call. */
function fakeLlm(reply, onCall) {
  return {
    async *stream(options) {
      if (onCall) onCall(options);
      const text = typeof reply === 'function' ? reply(options) : reply;
      yield { type: 'text-delta', index: 0, text };
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
  };
}

function fakeLlmError(message) {
  return {
    async *stream() {
      yield { type: 'finish', reason: { kind: 'error', failure: { message, code: 'x' } } };
    },
  };
}

const paper = (over = {}) => ({
  title: 'A Study of Learning Analytics',
  abstract: '本文采用问卷方法，样本 500 人，结果表明显著提升。',
  venue: 'Journal of X',
  publishedDate: '2026-09-17',
  keywords: ['learning analytics'],
  ...over,
});

const defaultModel = { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-flash' }) };

test('resolveRoute prefers an explicit override, then the deployment default', () => {
  assert.deepEqual(resolveRoute(defaultModel, { provider: 'p', model: 'm' }), { provider: 'p', model: 'm' });
  assert.deepEqual(resolveRoute(defaultModel, {}), { provider: 'deepseek-official', model: 'deepseek-flash' });
  // Half an override is not a route; fall back rather than break.
  assert.deepEqual(resolveRoute(defaultModel, { provider: 'p' }), { provider: 'deepseek-official', model: 'deepseek-flash' });
  assert.equal(resolveRoute(null, {}), null);
  assert.equal(resolveRoute({ currentSelection: () => ({ provider: '' }) }, {}), null);
});

test('buildSummaryPrompt includes the evidence and truncates a huge abstract', () => {
  const prompt = buildSummaryPrompt(paper({ abstract: '甲'.repeat(5000) }));
  assert.match(prompt, /标题：A Study of Learning Analytics/);
  assert.match(prompt, /出处：Journal of X/);
  assert.match(prompt, /关键词：learning analytics/);
  assert.ok(prompt.length < 2200, `prompt should stay bounded, was ${prompt.length}`);
});

test('buildSummaryPrompt says so when there is no abstract', () => {
  const prompt = buildSummaryPrompt(paper({ abstract: '' }));
  assert.match(prompt, /无摘要/);
});

test('cleanSummary strips labels, quotes and newlines', () => {
  assert.equal(cleanSummary('中文总结：本文研究了……'), '本文研究了……');
  assert.equal(cleanSummary('“本文研究了……”'), '本文研究了……');
  assert.equal(cleanSummary('第一行\n第二行'), '第一行 第二行');
  assert.equal(cleanSummary('  '), '');
});

test('summarizePapers attaches a summary to every paper', async () => {
  const papers = [paper(), paper({ title: 'Second' })];
  const stats = await summarizePapers(papers, {
    llm: fakeLlm('  摘要：本文用问卷法研究学习分析。  '),
    agentDefaultModel: defaultModel,
    enabled: true,
    maxTokens: 300,
    timeoutMs: 5000,
    concurrency: 2,
  });
  assert.equal(stats.ok, 2);
  assert.equal(stats.failed, 0);
  assert.equal(papers[0].summary, '本文用问卷法研究学习分析。');
  assert.deepEqual(stats.route, { provider: 'deepseek-official', model: 'deepseek-flash' });
});

test('one failing paper does not stop the others', async () => {
  const papers = [paper({ title: 'Good' }), paper({ title: 'Bad' }), paper({ title: 'AlsoGood' })];
  let call = 0;
  const llm = {
    async *stream() {
      call += 1;
      if (call === 2) {
        yield { type: 'finish', reason: { kind: 'error', failure: { message: 'rate limited', code: 'x' } } };
        return;
      }
      yield { type: 'text-delta', index: 0, text: '正常总结。' };
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
  };
  const stats = await summarizePapers(papers, {
    llm,
    agentDefaultModel: defaultModel,
    enabled: true,
    maxTokens: 300,
    timeoutMs: 5000,
    concurrency: 1, // deterministic ordering so exactly one call fails
  });
  assert.equal(stats.ok, 2);
  assert.equal(stats.failed, 1);
  assert.equal(papers[0].summary, '正常总结。');
  assert.equal(papers[1].summary, undefined);
  assert.match(papers[1].summaryError, /rate limited/);
  assert.equal(papers[2].summary, '正常总结。');
});

test('an empty or whitespace-only model reply counts as a failure', async () => {
  const papers = [paper()];
  const stats = await summarizePapers(papers, {
    llm: fakeLlm('   '),
    agentDefaultModel: defaultModel,
    enabled: true,
    maxTokens: 300,
    timeoutMs: 5000,
  });
  assert.equal(stats.ok, 0);
  assert.equal(stats.failed, 1);
  assert.match(papers[0].summaryError, /空内容/);
});

test('an empty first output is retried once with a larger token budget', async () => {
  // Regression: a reasoning model can spend the whole output budget thinking and
  // emit no text at all — with a 300-token cap that hit 9 of 10 papers live.
  const papers = [paper()];
  const budgets = [];
  let call = 0;
  const llm = {
    async *stream(options) {
      call += 1;
      budgets.push(options.maxTokens);
      if (call === 1) {
        yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 300, reasoningTokens: 300 } };
        yield { type: 'finish', reason: { kind: 'max-tokens' } };
        return;
      }
      yield { type: 'text-delta', index: 0, text: '重试后正常产出。' };
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
  };

  const stats = await summarizePapers(papers, {
    llm,
    agentDefaultModel: defaultModel,
    enabled: true,
    maxTokens: 300,
    timeoutMs: 5000,
    concurrency: 1,
  });

  assert.equal(call, 2, 'should call the model twice');
  assert.deepEqual(budgets, [300, 600], 'retry must use a doubled budget');
  assert.equal(stats.ok, 1);
  assert.equal(stats.retried, 1);
  assert.equal(papers[0].summary, '重试后正常产出。');
});

test('a still-empty retry reports why, including the truncated finish', async () => {
  const papers = [paper()];
  const llm = {
    async *stream() {
      yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 300, reasoningTokens: 300 } };
      yield { type: 'finish', reason: { kind: 'max-tokens' } };
    },
  };
  const stats = await summarizePapers(papers, {
    llm,
    agentDefaultModel: defaultModel,
    enabled: true,
    maxTokens: 300,
    timeoutMs: 5000,
    concurrency: 1,
  });
  assert.equal(stats.ok, 0);
  assert.equal(stats.failed, 1);
  assert.match(papers[0].summaryError, /maxTokens 截断/);
  assert.match(papers[0].summaryError, /300 tokens/);
});

test('an explicit reasoning effort is forwarded to the model call', async () => {
  const papers = [paper()];
  let seen = null;
  const stats = await summarizePapers(papers, {
    llm: fakeLlm('正常。', (options) => {
      seen = options;
    }),
    agentDefaultModel: defaultModel,
    enabled: true,
    maxTokens: 800,
    reasoningEffort: 'minimal',
    timeoutMs: 5000,
  });
  assert.equal(stats.ok, 1);
  assert.equal(seen.reasoningEffort, 'minimal');
  assert.equal(seen.provider, 'deepseek-official');
  assert.equal(seen.model, 'deepseek-flash');
});

test('no reasoning effort is sent when none is configured', async () => {
  const papers = [paper()];
  let seen = null;
  await summarizePapers(papers, {
    llm: fakeLlm('正常。', (options) => {
      seen = options;
    }),
    agentDefaultModel: defaultModel,
    enabled: true,
    maxTokens: 800,
    timeoutMs: 5000,
  });
  assert.equal('reasoningEffort' in seen, false, 'must inherit rather than force a default');
});

test('summarisation degrades cleanly when disabled or unconfigured', async () => {
  const papers = [paper()];
  const off = await summarizePapers(papers, { enabled: false, llm: fakeLlm('x'), agentDefaultModel: defaultModel });
  assert.equal(off.skipped, 1);
  assert.equal(off.ok, 0);

  const noLlm = await summarizePapers(papers, { enabled: true, llm: undefined, agentDefaultModel: defaultModel });
  assert.equal(noLlm.skipped, 1);
  assert.match(noLlm.errors[0].message, /llm/);

  const noModel = await summarizePapers(papers, { enabled: true, llm: fakeLlm('x'), agentDefaultModel: null });
  assert.equal(noModel.skipped, 1);
  assert.match(noModel.errors[0].message, /模型/);
});

test('an aborted stream surfaces as a failure, not a hang', async () => {
  const papers = [paper()];
  const stats = await summarizePapers(papers, {
    llm: {
      async *stream() {
        yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'aborted', code: 'a' } } };
      },
    },
    agentDefaultModel: defaultModel,
    enabled: true,
    maxTokens: 300,
    timeoutMs: 5000,
  });
  assert.equal(stats.failed, 1);
  assert.match(papers[0].summaryError, /中断|aborted/);
});
