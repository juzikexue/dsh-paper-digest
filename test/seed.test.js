/**
 * Tests for digest-session seeding.
 *
 * The seed is what makes the session visible: a session created through
 * `agents.create` starts with an empty log, and the sidebar renders no
 * conversation for it (verified in the live UI — expanding the workspace showed
 * only the folder). These tests pin the event shape the session log requires,
 * because a malformed seed is rejected by the log's validator and would leave
 * the user with an invisible session again.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSeedEvents, buildFollowupPrompt } from '../lib/core/session.js';

test('a seed is one completed turn: start → user message → end', () => {
  const events = buildSeedEvents('# 论文日报\n内容');
  assert.deepEqual(
    events.map((e) => e.type),
    ['turn/start', 'user/message', 'turn/end'],
  );
  assert.deepEqual(
    events.map((e) => e.seq),
    [0, 1, 2],
    'sequence numbers must be contiguous from 0',
  );
  assert.equal(events[0].data.turn, 0);
  assert.equal(events[2].data.turn, 0);
  assert.deepEqual(events[2].data.reason, { kind: 'completed' });
});

test('the user message is a well-formed surface event', () => {
  const [, message] = buildSeedEvents('正文');
  // A surface event without surfaceOp is rejected by the log.
  assert.equal(message.surfaceOp, 'append');
  assert.deepEqual(message.sourceEventSeqs, [0]);
  assert.equal(message.data.role, 'user');
  assert.deepEqual(message.data.content, [{ type: 'text', text: '正文' }]);
  // Regression: a `plugin` source marks the message as *context injection*, so it
  // renders as a collapsed "上下文注入" row instead of as conversation. The seed
  // must look like ordinary input.
  assert.deepEqual(message.data.source, { kind: 'user' });
  assert.match(String(message.data.id), /^paper-digest-/);
});

test('the follow-up prompt points the agent at the file and asks for a summary', () => {
  const prompt = buildFollowupPrompt('C:\\out\\2026-09-18-论文日报.md');
  assert.match(prompt, /2026-09-18-论文日报\.md/);
  assert.match(prompt, /读取该文件/);
  assert.match(prompt, /总结/);
  // It must ask for a summary rather than a copy of the report.
  assert.match(prompt, /不要复述整份报告/);
  // The report should arrive as a clickable card, not only as a path in prose.
  assert.match(prompt, /present/);
});

test('each seed gets a unique message id', () => {
  const a = buildSeedEvents('x')[1].data.id;
  const b = buildSeedEvents('x')[1].data.id;
  assert.notEqual(a, b);
});

test('the seed carries the digest text verbatim', () => {
  const text = '# 论文日报 · 2026-09-18\n\n- 一篇文章';
  assert.equal(buildSeedEvents(text)[1].data.content[0].text, text);
});

test('seed events are plain JSON, as the log requires', () => {
  const events = buildSeedEvents('正文');
  const roundTripped = JSON.parse(JSON.stringify(events));
  assert.deepEqual(roundTripped, events, 'no Dates, Maps or class instances');
});
