/**
 * Tests for digest-session creation.
 *
 * Session creation is what makes the daily report findable, so these cover the
 * two things that would silently break it: a malformed session id (the factory
 * rejects ids that do not look like `session-<uuid>`) and a partial service set
 * (the plugin must degrade instead of throwing, because the Markdown is already
 * written by that point).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { newSessionId, resolvePreset, createDigestSession } from '../lib/core/session.js';

/** Minimal fakes for the host services the module reads. */
function fakeServices(over = {}) {
  const created = [];
  const renamed = [];
  const attached = [];
  const registryWorkspaces = [];
  const services = {
    agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
    agentPresets: {
      resolve: async (id) => ({ id: id ?? 'cordis' }),
      mount: async () => {},
    },
    agents: {
      create: async (options) => {
        created.push(options);
        return { agent: { id: options.sessionId, session: { header: { id: options.sessionId } } } };
      },
    },
    sessionTitle: {
      rename: (session, title) => {
        renamed.push({ session, title });
        return { title };
      },
    },
    workspaceRegistry: {
      // Mirrors the real service: lookup happens on each Workspace's own `cwd`,
      // because the registry itself exposes no path query.
      list: () => registryWorkspaces,
      create: async (cwd) => {
        const workspace = {
          id: `ws-${registryWorkspaces.length + 1}`,
          cwd,
          attachSession: async (id) => attached.push(id),
          setTitle: async (title) => {
            workspace.title = title;
          },
        };
        registryWorkspaces.push(workspace);
        return workspace;
      },
    },
    ...over,
  };
  return { services, created, renamed, attached, registryWorkspaces };
}

test('newSessionId produces the id shape the factory validates', () => {
  const id = newSessionId();
  assert.match(id, /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.notEqual(id, newSessionId());
});

test('resolvePreset returns the deployment default when no id is pinned', async () => {
  const preset = await resolvePreset({ resolve: async (id) => ({ id: id ?? 'cordis' }), mount: async () => {} });
  assert.deepEqual(preset, { id: 'cordis' });
});

test('resolvePreset honours an explicit id and survives a failure', async () => {
  const withExplicit = await resolvePreset(
    { resolve: async (id) => ({ id }), mount: async () => {} },
    'standard',
  );
  assert.deepEqual(withExplicit, { id: 'standard' });

  const broken = await resolvePreset({ resolve: async () => { throw new Error('nope'); }, mount: async () => {} });
  assert.equal(broken, null);
  assert.equal(await resolvePreset(undefined), null);
  // An incomplete service must not be treated as usable.
  assert.equal(await resolvePreset({ resolve: async () => ({ id: 'x' }) }), null);
});

test('createDigestSession creates, titles and attaches a session', async () => {
  const { services, created, renamed, attached } = fakeServices();
  const result = await createDigestSession({
    services,
    cwd: 'C:\\out',
    title: '2026-09-17 论文日报（10 篇）',
  });

  assert.equal(result.ok, true);
  assert.match(result.sessionId, /^session-/);
  assert.equal(result.preset, 'cordis');
  assert.equal(result.titled, true);
  assert.equal(created.length, 1);
  assert.equal(created[0].meta.cwd, 'C:\\out');
  assert.equal(created[0].meta.agentPreset, 'cordis');
  assert.deepEqual(created[0].agentOptions, { provider: 'p', model: 'm' });
  assert.equal(renamed.length, 1);
  assert.equal(renamed[0].title, '2026-09-17 论文日报（10 篇）');
  assert.deepEqual(attached, [created[0].sessionId]);
});

test('createDigestSession mounts the resolved preset during setup', async () => {
  const mounted = [];
  const { services, created } = fakeServices({
    agentPresets: {
      resolve: async (id) => ({ id: id ?? 'cordis' }),
      mount: async (_agentCtx, id) => mounted.push(id),
    },
  });
  await createDigestSession({ services, cwd: 'C:\\out', title: 't' });
  await created[0].setup({}, {});
  assert.deepEqual(mounted, ['cordis']);
});

test('an explicit preset id is used when configured', async () => {
  const { services } = fakeServices();
  const result = await createDigestSession({ services, cwd: 'C:\\out', title: 't', presetId: 'standard' });
  assert.equal(result.preset, 'standard');
});

test('createDigestSession reports failure instead of throwing', async () => {
  const { services } = fakeServices({
    agents: { create: async () => { throw new Error('factory exploded'); } },
  });
  const result = await createDigestSession({ services, cwd: 'C:\\out', title: 't' });
  assert.equal(result.ok, false);
  assert.match(result.reason, /factory exploded/);
});

test('a missing agents service is reported, not thrown', async () => {
  const result = await createDigestSession({ services: {}, cwd: 'C:\\out', title: 't' });
  assert.equal(result.ok, false);
  assert.match(result.reason, /agents/);
});

test('a workspace failure still returns a usable session', async () => {
  const { services } = fakeServices({
    workspaceRegistry: {
      list: () => {
        throw new Error('registry down');
      },
      create: async () => {
        throw new Error('registry down');
      },
    },
  });
  const result = await createDigestSession({ services, cwd: 'C:\\out', title: 't' });
  assert.equal(result.ok, true);
  assert.match(result.sessionId, /^session-/);
  // The failure must stay visible — an earlier version returned early and the
  // missing workspace was silently dropped from the reported result.
  assert.equal(result.workspace, undefined);
  assert.match(result.workspaceError, /registry down/);
});

test('a missing workspace service is reported as a workspace error', async () => {
  const { services } = fakeServices({ workspaceRegistry: undefined });
  const result = await createDigestSession({ services, cwd: 'C:\\out', title: 't' });
  assert.equal(result.ok, true);
  assert.match(result.workspaceError, /workspaceRegistry/);
});

test('an existing workspace for the directory is reused, not duplicated', async () => {
  const attached = [];
  const existing = {
    id: 'ws-existing',
    path: () => 'C:\\out',
    attachSession: async (id) => attached.push(id),
    setTitle: async () => {},
  };
  const { services, created } = fakeServices({
    workspaceRegistry: {
      resolveByPath: async () => existing,
      list: () => [existing],
      create: async () => {
        throw new Error('must not create a second workspace');
      },
    },
  });
  const result = await createDigestSession({ services, cwd: 'C:\\out', title: 't' });
  assert.equal(result.ok, true);
  assert.equal(result.workspace, 'ws-existing');
  assert.deepEqual(attached, [created[0].sessionId]);
});

test('the list scan matches on path(), case- and separator-insensitively', async () => {
  // Regression: the first implementation matched a `cwd` property, but a real
  // Workspace exposes `path()` — so the match never fired and a duplicate
  // workspace was created on every run.
  const attached = [];
  const other = { id: 'ws-other', path: () => 'D:\\somewhere-else', attachSession: async () => {} };
  const match = {
    id: 'ws-match',
    path: () => 'c:\\OUT\\',
    attachSession: async (id) => attached.push(id),
    setTitle: async () => {},
  };
  const { services, created } = fakeServices({
    workspaceRegistry: {
      // No resolveByPath here, to force the list scan.
      list: () => [other, match],
      create: async () => {
        throw new Error('must reuse the trailing-separator match');
      },
    },
  });
  const result = await createDigestSession({ services, cwd: 'C:\\out', title: 't' });
  assert.equal(result.workspace, 'ws-match');
  assert.deepEqual(attached, [created[0].sessionId]);
});

test('a failing resolveByPath falls back to the list scan instead of creating', async () => {
  const match = {
    id: 'ws-fallback',
    path: () => 'C:\\out',
    attachSession: async () => {},
    setTitle: async () => {},
  };
  const { services } = fakeServices({
    workspaceRegistry: {
      resolveByPath: async () => {
        throw new Error('lookup broke');
      },
      list: () => [match],
      create: async () => {
        throw new Error('must not create');
      },
    },
  });
  const result = await createDigestSession({ services, cwd: 'C:\\out', title: 't' });
  assert.equal(result.workspace, 'ws-fallback');
});

test('a missing title service leaves the session usable', async () => {
  const { services } = fakeServices({ sessionTitle: undefined });
  const result = await createDigestSession({ services, cwd: 'C:\\out', title: 't' });
  assert.equal(result.ok, true);
  assert.equal(result.titled, false);
});
