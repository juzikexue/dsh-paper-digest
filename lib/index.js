/**
 * Host half of dsh-paper-digest.
 *
 * Responsibilities:
 *  - own the plugin's config and run status (JSON under <DSH_HOME>/storages/);
 *  - expose them to the browser half over its own HTTP routes;
 *  - run the daily scheduler and write the Markdown digest into the workspace.
 *
 * Config does NOT use the DSH `settings` service: that service is
 * scope-isolated away from out-of-tree profile plugins, so a third-party plugin
 * cannot register into it (same finding, and same workaround, as dsh-alarm).
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  readConfig,
  writeConfig,
  readStatus,
  writeStatus,
  isDue,
  localDateKey,
  storeDir,
  defaultConfig,
} from './core/config.js';
import { buildDigest } from './core/collect.js';
import { renderMarkdown, digestFileName } from './core/render.js';
import { createDigestSession } from './core/session.js';

export const name = 'dsh-paper-digest';
// `webServer` is the only hard dependency (routes + scheduler). The model
// services are read optionally: without them the digest still runs, it just
// carries no Chinese summaries.
export const inject = ['webServer'];

const ROUTE_PREFIX = '/dsh-paper-digest';
const TICK_MS = 60 * 1000;
const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------ core journal -- */

/**
 * Optional user-maintained core-journal list. Each line is
 * `刊名关键词 = 核心等级`, e.g. `教育研究 = CSSCI`. This is how the Chinese
 * track gets a real core-journal signal without the plugin shipping a copy of
 * 《中文核心期刊要目总览》 (which is a copyrighted book, reissued every few
 * years). Absence simply means no core tag — never an error.
 */
function coreListFile() {
  return join(storeDir(), 'core-journals.txt');
}

function loadCoreTags() {
  const map = new Map();
  try {
    const text = readFileSync(coreListFile(), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [name, tag] = trimmed.split('=').map((s) => s.trim());
      if (name) map.set(name, tag || '核心');
    }
  } catch {
    /* no list configured */
  }
  return map;
}

/* --------------------------------------------------------------- run state -- */

let running = false;

/** @type {{lastRunAt: string, lastRunDate: string, ok: boolean, file: string, totals: object|null, errors: object[], startedAt: string, finishedAt: string, durationMs: number}|null} */
let lastRun = readStatus();

function statusPayload(cfg) {
  return {
    running,
    enabled: cfg.enabled,
    time: cfg.time,
    lastRunDate: cfg.lastRunDate || '',
    outputDir: cfg.outputDir,
    coreListFile: coreListFile(),
    coreJournalCount: loadCoreTags().size,
    lastRun,
  };
}

/**
 * Title for a digest session, e.g. "2026-09-17 论文日报（10 篇）".
 * A dated, content-bearing title is what makes the session findable in a list.
 */
function digestSessionTitle(now, digest) {
  const date = localDateKey(now);
  const count = digest?.totals?.selected ?? 0;
  return `${date} 论文日报（${count} 篇）`;
}

/**
 * Create the session for a finished digest. Never throws: a failure here is
 * reported in the run status but must not lose the Markdown that was already
 * written.
 */
async function openDigestSession(cfg, dir, now, digest, services, seedText, followupFile) {
  if (!cfg.sessionEnabled) return { ok: false, reason: '已在设置中关闭会话创建' };
  try {
    return await createDigestSession({
      services,
      cwd: dir,
      title: digestSessionTitle(now, digest),
      workspaceTitle: `论文日报 ${dir}`,
      presetId: cfg.sessionPreset || undefined,
      seedText,
      followupFile,
    });
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) };
  }
}

/**
 * Produce one digest and write it into the workspace.
 * @param {object} cfg
 * @param {string} trigger 'schedule' | 'manual'
 * @param {{llm?: object, agentDefaultModel?: object}} services host services
 *   resolved by the caller; the model pair is optional and only affects the
 *   Chinese summaries.
 */
export async function runDigest(cfg, trigger = 'manual', services = {}) {
  if (running) throw new Error('已有一次运行在进行中');
  running = true;
  const started = Date.now();
  const now = new Date();
  const startedAt = now.toISOString();
  try {
    const digest = await buildDigest(cfg, now, {
      coreTags: loadCoreTags(),
      // Read at run time so the summary uses whatever model is configured now.
      llm: services.llm,
      agentDefaultModel: services.agentDefaultModel,
    });

    const dir = resolve(cfg.outputDir);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, digestFileName(now));

    // The session opens with the reader's own request, then a real agent turn
    // summarises the report — so the session ends with an assistant answer plus
    // the report file, which is what a reader expects to see when opening it.
    const seedText = `生成今天的论文日报（${localDateKey(now)}）`;
    digest.session = await openDigestSession(cfg, dir, now, digest, services, seedText, file);
    const markdown = renderMarkdown(digest, cfg, now);
    writeFileSync(file, markdown, 'utf8');

    const session = digest.session;

    const summary = {
      lastRunAt: now.toISOString(),
      lastRunDate: localDateKey(now),
      ok: digest.totals.selected > 0,
      trigger,
      file,
      session,
      totals: digest.totals,
      errors: digest.errors,
      stats: digest.stats,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
    };
    lastRun = summary;

    const next = writeConfig({
      ...cfg,
      lastRunDate: summary.lastRunDate,
      lastRunAt: summary.lastRunAt,
    });
    writeStatus(summary);
    return { summary, config: next, markdown };
  } catch (error) {
    const failure = {
      lastRunAt: new Date().toISOString(),
      lastRunDate: cfg.lastRunDate || '',
      ok: false,
      trigger,
      file: '',
      totals: null,
      errors: [{ source: 'run', label: '运行', message: String(error?.message ?? error) }],
      stats: [],
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
    };
    lastRun = failure;
    writeStatus(failure);
    throw error;
  } finally {
    running = false;
  }
}

/* --------------------------------------------------------------- HTTP glue -- */

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readJsonBody(req, limitBytes = 256 * 1024) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolvePromise({});
        return;
      }
      try {
        resolvePromise(JSON.parse(raw));
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * `/dsh-paper-digest/<action>` — exact match, so a typo 404s instead of hitting
 * the SPA fallback and confusing the client with an HTML body.
 */
function handleRoute(req, res, services) {
  const url = new URL(req.url, 'http://localhost');
  const action = url.pathname.slice(ROUTE_PREFIX.length).replace(/^\/+/, '');
  const method = (req.method || 'GET').toUpperCase();

  if (action === 'config') {
    if (method === 'GET') {
      const cfg = readConfig();
      sendJson(res, 200, { ok: true, config: cfg, status: statusPayload(cfg) });
      return;
    }
    if (method === 'POST') {
      readJsonBody(req)
        .then((patch) => {
          const current = readConfig();
          const merged = { ...current, ...patch };
          // A patch that changes the schedule must not inherit yesterday's
          // "already ran" marker, or the new time would be skipped today.
          if (patch && typeof patch === 'object' && 'time' in patch && patch.time !== current.time) {
            merged.lastRunDate = '';
          }
          const saved = writeConfig(merged);
          sendJson(res, 200, { ok: true, config: saved, status: statusPayload(saved) });
        })
        .catch((error) => sendJson(res, 400, { ok: false, error: String(error?.message ?? error) }));
      return;
    }
  }

  if (action === 'status' && method === 'GET') {
    const cfg = readConfig();
    sendJson(res, 200, { ok: true, status: statusPayload(cfg) });
    return;
  }

  if (action === 'run' && method === 'POST') {
    if (running) {
      sendJson(res, 409, { ok: false, error: '已有一次运行在进行中，请稍候' });
      return;
    }
    const cfg = readConfig();
    sendJson(res, 202, { ok: true, message: '已开始检索，完成后写入工作区', running: true });
    // Fire and forget: the browser polls /status for the outcome.
    runDigest(cfg, 'manual', services).catch((error) => {
      console.error('[dsh-paper-digest] manual run failed:', error?.message ?? error);
    });
    return;
  }

  if (action === 'open-session' && method === 'POST') {
    // Manual escape hatch: create a session for the most recent digest without
    // running a whole new collection pass.
    const cfg = readConfig();
    const last = lastRun;
    if (!last?.file) {
      sendJson(res, 409, { ok: false, error: '还没有生成过日报，请先运行一次' });
      return;
    }
    const dir = resolve(cfg.outputDir);
    const now = new Date();
    // Mirror the automatic flow: a short request, then a real turn that reads the
    // report already on disk and summarises it.
    const seedText = `生成今天的论文日报（${localDateKey(now)}）`;
    sendJson(res, 200, { ok: true, message: '正在创建会话…' });
    openDigestSession(cfg, dir, now, { totals: last.totals ?? { selected: 0 } }, services, seedText, last.file)
      .then((session) => {
        lastRun = { ...last, session };
        writeStatus(lastRun);
        console.log('[dsh-paper-digest] manual session:', JSON.stringify(session));
      })
      .catch((error) => console.error('[dsh-paper-digest] manual session failed:', error?.message ?? error));
    return;
  }

  if (action === 'defaults' && method === 'GET') {
    sendJson(res, 200, { ok: true, config: defaultConfig() });
    return;
  }

  if (action === 'core-list' && method === 'GET') {
    const file = coreListFile();
    sendJson(res, 200, {
      ok: true,
      file,
      exists: existsSync(file),
      content: existsSync(file) ? readFileSync(file, 'utf8') : '',
    });
    return;
  }

  if (action === 'core-list' && method === 'POST') {
    readJsonBody(req)
      .then((body) => {
        const content = typeof body?.content === 'string' ? body.content : '';
        mkdirSync(storeDir(), { recursive: true });
        writeFileSync(coreListFile(), content, 'utf8');
        sendJson(res, 200, { ok: true, count: loadCoreTags().size, file: coreListFile() });
      })
      .catch((error) => sendJson(res, 400, { ok: false, error: String(error?.message ?? error) }));
    return;
  }

  sendJson(res, 404, { ok: false, error: `未知接口：${action}` });
}

/* --------------------------------------------------------------- scheduler -- */

/**
 * 60-second tick. `isDue` is "the configured time has passed today and we have
 * not run today", so a machine asleep at the scheduled minute still produces the
 * digest on the first tick after it wakes.
 */
function startScheduler(ctx, services) {
  const tick = () => {
    try {
      const cfg = readConfig();
      if (!isDue(cfg)) return;
      console.log(`[dsh-paper-digest] scheduled run due (${cfg.time})`);
      runDigest(cfg, 'schedule', services).catch((error) => {
        console.error('[dsh-paper-digest] scheduled run failed:', error?.message ?? error);
      });
    } catch (error) {
      console.error('[dsh-paper-digest] scheduler tick failed:', error?.message ?? error);
    }
  };
  const timer = setInterval(tick, TICK_MS);
  ctx.effect(() => () => clearInterval(timer), 'dsh-paper-digest: scheduler');
  // Catch up immediately on load (e.g. dsh restarted after the digest time).
  const startup = setTimeout(tick, 8000);
  ctx.effect(() => () => clearTimeout(startup), 'dsh-paper-digest: startup tick');
}

export function apply(ctx) {
  // Services are exposed through lazy getters, NOT read once at activation.
  // A service mounted after this plugin activated stays undefined forever if it
  // is only read once, and `ctx.get()` never re-activates the fiber —
  // `workspaceRegistry` was missing for exactly that reason (the plugin loads
  // early, the workspace plane mounts later), which silently cost the session
  // its workspace.
  const services = {
    get llm() {
      return ctx.get('llm');
    },
    get agentDefaultModel() {
      return ctx.get('agentDefaultModel');
    },
    get agents() {
      return ctx.get('agents');
    },
    get agentPresets() {
      return ctx.get('agentPresets');
    },
    get sessionTitle() {
      return ctx.get('sessionTitle');
    },
    get workspaceRegistry() {
      return ctx.get('workspaceRegistry');
    },
  };

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_PREFIX,
        handler: (req, res) => handleRoute(req, res, services),
      }),
    'dsh-paper-digest: routes',
  );

  // Also serve the sub-paths, since an exact route only matches the bare path.
  for (const sub of ['/config', '/status', '/run', '/defaults', '/core-list', '/open-session']) {
    ctx.effect(
      () =>
        ctx.webServer.register({
          kind: 'exact',
          path: `${ROUTE_PREFIX}${sub}`,
          handler: (req, res) => handleRoute(req, res, services),
        }),
      `dsh-paper-digest: route ${sub}`,
    );
  }

  startScheduler(ctx, services);
  console.log(
    `[dsh-paper-digest] host ready · store=${storeDir()} · summaries=${services.llm && services.agentDefaultModel ? 'on' : 'off'} · sessions=${services.agents ? 'on' : 'off'} (services re-read per run)`,
  );
}

export { storeDir, PLUGIN_DIR, resolve, sep };
