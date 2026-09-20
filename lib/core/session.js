/**
 * Digest sessions.
 *
 * Why this exists: a digest written to a folder is easy to lose — the user asked
 * for it to show up as a session they can actually find in the sidebar. This
 * module creates a real session (the same live agent/session pair the API
 * controller mints), titles it, and attaches it to a workspace rooted at the
 * digest directory, so the daily report is one click away in the UI.
 *
 * The session's `setup` mounts the deployment's own agent preset, so the session
 * is not an inert shell: the user can ask follow-up questions about the papers
 * in it. Everything is optional — with no `agents` service available the digest
 * still runs and still writes its file.
 */
import { randomUUID } from 'node:crypto';

/** Matches the id shape the API controller mints (`session-<uuid>`). */
export function newSessionId() {
  return `session-${randomUUID()}`;
}

/**
 * Build the seed events that give a new session its content.
 *
 * Why this is necessary: a session created through `agents.create` starts as an
 * empty log (a 501-byte header, zero events), and the sidebar does not render a
 * zero-event session — expanding the workspace showed the folder but no
 * conversation inside it (verified in the live UI).
 *
 * The message uses `source: { kind: 'user' }` deliberately. A `plugin` source is
 * a *context injection*: it renders as a collapsed "上下文注入" row rather than
 * as conversation (verified against a screenshot of the first attempt), which is
 * not what a reader wants to open.
 *
 * Shape notes, from the session-log contract:
 *   - `turn/start` … `user/message` … `turn/end` is one completed turn;
 *   - `user/message` is a *surface* event, so it must carry `surfaceOp`
 *     (here `'append'`) and may cite the earlier events it derives from;
 *   - sequence numbers must be contiguous from 0;
 *   - the seed must not leave an open turn, hence the explicit `turn/end`.
 *
 * @param {string} text content to show (the digest Markdown)
 * @returns {object[]} seed events
 */
export function buildSeedEvents(text) {
  const now = Date.now();
  return [
    { type: 'turn/start', seq: 0, time: now, data: { turn: 0 } },
    {
      type: 'user/message',
      seq: 1,
      time: now,
      data: {
        id: `paper-digest-${randomUUID()}`,
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      },
      surfaceOp: 'append',
      sourceEventSeqs: [0],
    },
    { type: 'turn/end', seq: 2, time: now, data: { turn: 0, reason: { kind: 'completed' } } },
  ];
}

/**
 * The prompt that makes the agent produce a readable summary of the digest.
 *
 * Sent as a real turn (see `followup` in createDigestSession) so the session
 * ends with an assistant answer that links the report — the shape a reader
 * expects when opening it, rather than raw injected content.
 */
export function buildFollowupPrompt(file) {
  return [
    '今天的论文日报已经生成，文件在：',
    file,
    '',
    '请读取该文件，然后用中文给我一份便于快速浏览的总结：',
    '1. 先说今天一共几篇、中英文各几篇；',
    '2. 按主题分组，每个主题下逐条列出论文标题，每篇用一句话说明它研究什么；',
    '3. 如果某篇已下载开放获取全文，指出本地文件位置；',
    '4. 最后用一行说明这次运行有没有数据源失败。',
    '总结要简洁，不要复述整份报告，也不要把整份 Markdown 原样贴回来。',
    '',
    '另外：请用 present 工具把这份日报作为交付文件呈现出来，这样我可以直接点开，不必自己去找路径。',
  ].join('\n');
}

/**
 * Resolve the agent preset to mount.
 *
 * The deployment's default preset is the right choice: it is what a
 * user-created session gets, so the digest session has the same tools and
 * persona. An explicit id in config wins; a failure falls back to no preset
 * (the session is then still created and visible, just without tools).
 */
export async function resolvePreset(agentPresets, explicitId) {
  if (!agentPresets?.resolve || !agentPresets?.mount) return null;
  try {
    const resolved = await agentPresets.resolve(explicitId ? String(explicitId) : undefined);
    return resolved?.id ? { id: resolved.id } : null;
  } catch {
    return null;
  }
}

/**
 * Find the workspace rooted at `cwd`, reusing one that already exists.
 *
 * Two facts learned by inspecting the live objects — both were wrong in the
 * first implementation, which silently created a second workspace every run:
 *   - `workspaceRegistry.resolveByPath(path)` DOES exist; it is defined on the
 *     prototype, so it is easy to miss when listing the service's own methods;
 *   - a Workspace exposes its directory through the `path()` **method**, not a
 *     `cwd` property, so matching on `workspace.cwd` never succeeds.
 */
async function findWorkspaceByPath(registry, cwd) {
  if (!registry) return undefined;
  const target = normalisePath(cwd);
  try {
    if (typeof registry.resolveByPath === 'function') {
      const found = await registry.resolveByPath(cwd);
      if (found) return found;
    }
  } catch {
    /* fall through to the list scan */
  }
  if (typeof registry.list === 'function') {
    for (const workspace of registry.list()) {
      if (normalisePath(pathOf(workspace)) === target) return workspace;
    }
  }
  return typeof registry.create === 'function' ? await registry.create(cwd) : undefined;
}

/** A Workspace's directory: `path()` on the entity, `cwd` on plain views. */
function pathOf(workspace) {
  try {
    if (typeof workspace?.path === 'function') return workspace.path();
  } catch {
    /* ignore and try the plain field */
  }
  return workspace?.cwd ?? '';
}

function normalisePath(value) {
  return String(value ?? '').replace(/[\\/]+$/, '').toLowerCase();
}

/**
 * Create one session for a finished digest.
 *
 * @param {object} args
 * @param {object} args.services host services (`agents`, `agentPresets`, `agentDefaultModel`, `sessionTitle`, `workspaceRegistry`)
 * @param {string} args.cwd directory the session is rooted at (the digest dir)
 * @param {string} args.title session title, e.g. "2026-09-17 论文日报（10 篇）"
 * @param {string} [args.workspaceTitle] optional label applied to the workspace
 * @param {string} [args.presetId] explicit agent preset id
 * @param {string} [args.seedText] content for the session's first message (the digest)
 * @param {string} [args.followupFile] digest path the agent should read and summarise
 * @returns {Promise<{ok: boolean, sessionId?: string, preset?: string|null, workspace?: string, workspaceError?: string, titled?: boolean, seeded?: boolean, reason?: string}>}
 */
export async function createDigestSession(args) {
  const { services = {}, cwd, title, workspaceTitle, presetId, seedText, followupFile } = args;
  const agents = services.agents;
  if (!agents?.create) return { ok: false, reason: '宿主未提供 agents 服务' };

  const sessionId = newSessionId();
  const preset = await resolvePreset(services.agentPresets, presetId);
  // Seeding is what makes the session visible; see buildSeedEvents.
  const seed = typeof seedText === 'string' && seedText.trim() ? buildSeedEvents(seedText) : undefined;
  let seedError = '';

  // The model comes from the deployment default so the session matches whatever
  // the user would get by hand.
  let agentOptions;
  try {
    const sel = services.agentDefaultModel?.currentSelection?.();
    if (sel?.provider && sel?.model) agentOptions = { provider: sel.provider, model: sel.model };
  } catch {
    /* an omitted agentOptions lets the factory apply its own default */
  }

  let handle;
  try {
    handle = await agents.create({
      sessionId,
      meta: { cwd, ...(preset ? { agentPreset: preset.id } : {}) },
      ...(agentOptions ? { agentOptions } : {}),
      ...(seed ? { seed } : {}),
      setup: async (agentCtx) => {
        if (preset) await services.agentPresets.mount(agentCtx, preset.id);
      },
    });
  } catch (error) {
    // A rejected seed must not cost the user the session: retry without it and
    // report the seeding failure, since the session is still better than none.
    if (seed) {
      try {
        handle = await agents.create({
          sessionId: newSessionId(),
          meta: { cwd, ...(preset ? { agentPreset: preset.id } : {}) },
          ...(agentOptions ? { agentOptions } : {}),
          setup: async (agentCtx) => {
            if (preset) await services.agentPresets.mount(agentCtx, preset.id);
          },
        });
        seedError = `会话内容写入失败（${String(error?.message ?? error)}），已创建空会话`;
      } catch (retryError) {
        return { ok: false, reason: `创建会话失败: ${retryError?.message ?? retryError}` };
      }
    } else {
      return { ok: false, reason: `创建会话失败: ${error?.message ?? error}` };
    }
  }

  const agent = handle?.agent ?? handle;
  const actualId = agent?.id ?? sessionId;

  // Title: a bare session id in the sidebar is barely better than no session.
  let titled = false;
  try {
    const session = agent?.session;
    if (session && services.sessionTitle?.rename && title) {
      services.sessionTitle.rename(session, title);
      titled = true;
    }
  } catch {
    /* a missing title is cosmetic; keep the session */
  }

  // Start one real turn so the session ends with an assistant summary that
  // links the report — the shape a reader expects, instead of only the raw
  // digest text sitting there as a prompt.
  let followup = '';
  if (followupFile && agent) {
    try {
      const message = {
        id: `paper-digest-followup-${randomUUID()}`,
        role: 'user',
        content: [{ type: 'text', text: buildFollowupPrompt(followupFile) }],
        source: { kind: 'plugin', plugin: 'dsh-paper-digest', form: 'notice', summary: '请总结今日论文日报' },
      };
      // `followup` queues a next-turn message and wakes the driver; `send` with
      // an explicit wakeup is the same thing, so either works.
      if (typeof agent.followup === 'function') agent.followup(message);
      else if (typeof agent.send === 'function') agent.send(message, 'next-turn', true);
      else followup = '宿主 Agent 不支持自动开启轮次';
    } catch (error) {
      followup = `未能自动开始总结轮次: ${String(error?.message ?? error)}`;
    }
  }

  // Attach to a workspace rooted at the digest directory so it is browsable.
  // A failure here is reported but must not discard the session: it is already
  // live and titled, which is what the user asked for.
  let workspaceId;
  let workspaceError;
  try {
    const registry = services.workspaceRegistry;
    if (!registry) {
      workspaceError = '宿主未提供 workspaceRegistry 服务';
    } else if (!cwd) {
      workspaceError = '未提供 cwd';
    } else {
      const workspace = await findWorkspaceByPath(registry, cwd);
      if (workspace?.attachSession) await workspace.attachSession(actualId);
      workspaceId = workspace?.id ? String(workspace.id) : undefined;
      if (!workspaceId) {
        workspaceError = '工作区对象缺少 id';
      } else if (workspaceTitle && workspace.setTitle) {
        // Best-effort label so the sidebar shows what this workspace is.
        try {
          await workspace.setTitle(workspaceTitle);
        } catch {
          /* a title is cosmetic */
        }
      }
    }
  } catch (error) {
    workspaceError = String(error?.message ?? error);
  }

  return {
    ok: true,
    sessionId: String(actualId),
    preset: preset?.id ?? null,
    titled,
    seeded: Boolean(seed) && !seedError,
    followup: followup ? followup : 'started',
    ...(workspaceId ? { workspace: workspaceId } : {}),
    // Kept visible instead of silently dropped: an earlier version returned
    // early on failure and the missing workspace was impossible to notice.
    ...(workspaceError ? { workspaceError } : {}),
    ...(seedError ? { seedError } : {}),
  };
}
