/**
 * Plugin configuration: defaults, load/save, sanitising, and topic parsing.
 *
 * Storage is this plugin's own JSON file under <DSH_HOME>/storages/ — NOT the
 * DSH `settings` service, which is scope-isolated away from out-of-tree
 * profile plugins (same reason and same location as dsh-alarm).
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

export const CONFIG_VERSION = 1;

export function dshHome() {
  return process.env.DSH_HOME || join(os.homedir(), '.dsh');
}

/** Directory holding config.json and the digest status cache. */
export function storeDir() {
  return join(dshHome(), 'storages', 'dsh-paper-digest');
}

export function configFile() {
  return join(storeDir(), 'config.json');
}

export function statusFile() {
  return join(storeDir(), 'status.json');
}

/** Three editable starter topics. The user replaces these from the Settings page. */
function starterTopics() {
  return [
    {
      id: 't1',
      name: '人工智能教育',
      zh: '人工智能 教育; 大模型 教学; 智能导师系统',
      en: 'artificial intelligence education; large language model teaching',
    },
    {
      id: 't2',
      name: '语言学习技术',
      zh: '二语习得 技术; 计算机辅助语言学习; 语言学习 App',
      en: 'computer-assisted language learning; second language acquisition technology',
    },
    {
      id: 't3',
      name: '学习分析',
      zh: '学习分析; 教育数据挖掘; 学习者建模',
      en: 'learning analytics; educational data mining; student modeling',
    },
  ];
}

/**
 * Starter CNKI journals, each verified to return a live feed (2026-09-17).
 *
 * They exist so a fresh install produces a usable Chinese track: with zero
 * journals configured the Chinese side has only keyword-search sources, which
 * measured just 1 paper out of 10. Replace them with the journals of your own
 * field — the code appears in the CNKI journal page URL
 * (`navi.cnki.net/knavi/journals/<CODE>/detail`).
 *
 * Codes are verified, never guessed: `ZGJY` resolves to 《中国激光》 and `SHXZ`
 * to《史学集刊》, so a plausible-looking code can point at a different journal.
 */
function starterJournals() {
  return [
    { id: 'JYYJ', name: '教育研究', topicId: '' },
    { id: 'XLKX', name: '心理科学', topicId: '' },
    { id: 'TSQB', name: '图书情报工作', topicId: '' },
  ];
}

/**
 * Default locations for the digest and its downloaded PDFs.
 *
 * Anchored to a deterministic path rather than `process.cwd()`: the host
 * process runs from wherever dsh was launched, so cwd-derived defaults land in
 * an unpredictable directory (verified: a probe run wrote into the plugin's own
 * source tree). `DSH_PAPER_DIGEST_DIR` overrides, Documents is the fallback.
 */
function digestBaseDir() {
  const override = String(process.env.DSH_PAPER_DIGEST_DIR ?? '').trim();
  if (override) return override;
  return join(os.homedir(), 'Documents', 'dsh-paper-digest');
}

export function defaultConfig() {
  const outputDir = digestBaseDir();
  const pdfDir = join(outputDir, 'pdf');
  return {
    version: CONFIG_VERSION,
    enabled: true,
    time: '09:00',
    dailyCount: 10,
    // `zh` is a soft target: the English track backfills the remainder so the
    // digest still reaches `dailyCount` when a Chinese source degrades.
    mix: { zh: 6, en: 4 },
    lookbackDays: 14,
    outputDir,
    // Open-access full-text download. Only resources a source declares open
    // (arXiv, PubMed Central via Europe PMC, a publisher's OA pdf_url) are ever
    // fetched; Chinese subscription databases keep their详情页 link instead.
    pdfEnabled: true,
    pdfDir,
    pdfMaxPerRun: 10,
    // Optional: a real address lets the plugin ask Unpaywall for a legal OA copy
    // of a paywalled paper. Empty = feature off. Nothing else is sent anywhere.
    unpaywallEmail: '',
    // Chinese one-glance summaries, written by the deployment's own configured
    // model (read via agentDefaultModel). One short call per selected paper.
    summaryEnabled: true,
    // Reasoning models spend output budget on hidden reasoning first, and at the
    // deployment's default `max` effort the *reasoning alone* exceeded 3000
    // tokens (measured: 2 of 10 summaries were truncated even at a 3000-token
    // retry ceiling). 4000 leaves room for reasoning plus the ~120-char answer.
    // For speed and cost, lower `summaryReasoningEffort` instead of this cap.
    summaryMaxTokens: 4000,
    // Blank inherits the model's own default effort; one of minimal/low/medium/high/max.
    // Summarising needs no deep reasoning, so `minimal` is the recommended value.
    summaryReasoningEffort: '',
    // Blank = use the deployment default; set both to pin an exact model.
    summaryModelProvider: '',
    summaryModel: '',
    // Create a real session per digest, so the report is findable in the sidebar
    // instead of only on disk. The session is rooted at the digest directory and
    // mounts the deployment's default agent preset.
    sessionEnabled: true,
    // Blank = the deployment's default preset.
    sessionPreset: '',
    topics: starterTopics(),
    // CNKI journal RSS: { id: 'JJYJ', name: '经济研究', topicId: 't1' | '' }
    journals: starterJournals(),
    sources: {
      cnkiRss: true,
      chinaXiv: true,
      // Europe PMC's LANG:chi slice is a *biomedical* corpus (≈35 records per
      // fortnight, almost all Chinese medical journals). Off by default so a
      // general-topic digest is not padded with clinical papers; users working
      // in medicine can turn it on.
      europePmcZh: false,
      ncpssd: false, // needs a rendered browser; opt-in
      openalex: true,
      crossref: true,
      arxiv: true,
    },
    requestTimeoutMs: 20000,
    maxPerTopic: 60,
    lastRunDate: '',
    lastRunAt: '',
  };
}

function str(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

/** Reasoning effort ids the deployment accepts; anything else inherits. */
const EFFORT_IDS = ['minimal', 'low', 'medium', 'high', 'max'];

function sanitiseEffort(value, fallback = '') {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return EFFORT_IDS.includes(raw) ? raw : fallback;
}

function int(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.round(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

/** `HH:MM`, 24h. Anything malformed falls back to the default. */
export function normaliseTime(value, fallback = '09:00') {
  const m = /^\s*(\d{1,2})\s*[:：]\s*(\d{1,2})\s*$/.exec(String(value ?? ''));
  if (!m) return fallback;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return fallback;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function sanitiseTopics(raw, fallback) {
  // An array that is present but empty is an ANSWER, not missing data: the user
  // deleted every starter topic and has not added their own yet. Falling back to
  // the shipped starters there made deletion impossible — the topic reappeared on
  // the very next read (reported from the settings panel). The fallback is for a
  // config with no `topics` field at all.
  if (!Array.isArray(raw)) return fallback;
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const name = str(item.name).trim();
    const zh = str(item.zh).trim();
    const en = str(item.en).trim();
    if (!name && !zh && !en) continue;
    // `name` is the user's own label and is allowed to be blank or to differ from
    // the keywords; only a completely empty row is dropped, above.
    out.push({
      id: str(item.id).trim() || `t${out.length + 1}`,
      name,
      zh,
      en,
    });
  }
  return out.slice(0, 20);
}

function sanitiseJournals(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    // CNKI RSS takes the journal's short code (e.g. JJYJ, GLSJ, XWYJ).
    const id = str(item.id).trim();
    if (!/^[A-Za-z][A-Za-z0-9]{1,15}$/.test(id)) continue;
    out.push({ id, name: str(item.name).trim() || id, topicId: str(item.topicId).trim() });
  }
  return out.slice(0, 40);
}

/** Coerce any partial/legacy section into a complete, valid config. */
export function sanitise(raw) {
  const d = defaultConfig();
  const input = raw && typeof raw === 'object' ? raw : {};
  const src = input.sources && typeof input.sources === 'object' ? input.sources : {};
  const mix = input.mix && typeof input.mix === 'object' ? input.mix : {};

  const dailyCount = int(input.dailyCount, d.dailyCount, 1, 50);
  let zh = int(mix.zh, d.mix.zh, 0, dailyCount);
  let en = int(mix.en, dailyCount - zh, 0, dailyCount);
  if (zh + en !== dailyCount) en = Math.max(0, dailyCount - zh);

  return {
    version: CONFIG_VERSION,
    enabled: bool(input.enabled, d.enabled),
    time: normaliseTime(input.time, d.time),
    dailyCount,
    mix: { zh, en },
    lookbackDays: int(input.lookbackDays, d.lookbackDays, 1, 120),
    outputDir: str(input.outputDir, '').trim() || d.outputDir,
    pdfEnabled: bool(input.pdfEnabled, d.pdfEnabled),
    pdfDir: str(input.pdfDir, '').trim() || d.pdfDir,
    pdfMaxPerRun: int(input.pdfMaxPerRun, d.pdfMaxPerRun, 1, 30),
    unpaywallEmail: str(input.unpaywallEmail, '').trim(),
    summaryEnabled: bool(input.summaryEnabled, d.summaryEnabled),
    summaryMaxTokens: int(input.summaryMaxTokens, d.summaryMaxTokens, 80, 8000),
    summaryReasoningEffort: sanitiseEffort(input.summaryReasoningEffort, d.summaryReasoningEffort),
    summaryModelProvider: str(input.summaryModelProvider, '').trim(),
    summaryModel: str(input.summaryModel, '').trim(),
    sessionEnabled: bool(input.sessionEnabled, d.sessionEnabled),
    sessionPreset: str(input.sessionPreset, '').trim(),
    topics: sanitiseTopics(input.topics, d.topics),
    journals: sanitiseJournals(input.journals),
    sources: {
      cnkiRss: bool(src.cnkiRss, d.sources.cnkiRss),
      chinaXiv: bool(src.chinaXiv, d.sources.chinaXiv),
      europePmcZh: bool(src.europePmcZh, d.sources.europePmcZh),
      ncpssd: bool(src.ncpssd, d.sources.ncpssd),
      openalex: bool(src.openalex, d.sources.openalex),
      crossref: bool(src.crossref, d.sources.crossref),
      arxiv: bool(src.arxiv, d.sources.arxiv),
    },
    requestTimeoutMs: int(input.requestTimeoutMs, d.requestTimeoutMs, 5000, 120000),
    maxPerTopic: int(input.maxPerTopic, d.maxPerTopic, 5, 200),
    lastRunDate: str(input.lastRunDate, ''),
    lastRunAt: str(input.lastRunAt, ''),
  };
}

export function readConfig() {
  try {
    return sanitise(JSON.parse(readFileSync(configFile(), 'utf8')));
  } catch {
    return defaultConfig();
  }
}

/** Atomic write: a crash mid-save must never leave a truncated config. */
export function writeConfig(cfg) {
  const dir = storeDir();
  mkdirSync(dir, { recursive: true });
  const clean = sanitise(cfg);
  const tmp = `${configFile()}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(clean, null, 2)}\n`, 'utf8');
  renameSync(tmp, configFile());
  return clean;
}

export function readStatus() {
  try {
    return JSON.parse(readFileSync(statusFile(), 'utf8'));
  } catch {
    return null;
  }
}

export function writeStatus(status) {
  try {
    mkdirSync(storeDir(), { recursive: true });
    const tmp = `${statusFile()}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
    renameSync(tmp, statusFile());
  } catch {
    /* status is best-effort telemetry; never fail a run over it */
  }
  return status;
}

/**
 * A topic's keyword field is free text whose separators carry the AND/OR
 * structure of the search:
 *
 *   `;` or newline   → **any of** these may match   (OR between probes)
 *   `,` `，` `、`     → synonyms inside one probe     (OR, as in every database)
 *   `+`              → **all of** these must match  (AND, the strict reading)
 *   space            → keyword-level operator, kept and interpreted later
 *                      (`text.js`: OR for Chinese, phrase match for English)
 *
 * Both readings are legitimate and the field has to express both, because
 * "any of" and "all of" are different intents that look identical when written
 * as separate lines:
 *
 *   机器学习; 深度学习            two ways to fish the same topic  → OR
 *   人工智能, AI + 语文教育, 阅读教学   AI *and* language education   → AND
 *
 * Forcing the academic AND onto every separator is wrong in practice: a user who
 * lists seven phrasings of one idea ("reinforcement learning for decision
 * making", "... control", "... policy optimization") would require all seven in
 * one paper, which no paper satisfies. Forcing OR is wrong in theory: it admits
 * any paper mentioning 人工智能 even when nobody studied 语文.
 *
 * @param {string} value
 * @returns {string[][]} one concept per `+`-separated requirement, each a list of
 *   synonymous probes
 */
export function splitConcepts(value) {
  return String(value ?? '')
    .split('+')
    .map((requirement) =>
      requirement
        .split(/[;；\n]+/)
        .map((s) =>
          s
            // Inner spacing is preserved: a space is a *keyword-level* operator
            // (Chinese OR, English phrase), so `人工智能 教育` stays one probe.
            .trim()
            .replace(/\s+/g, ' ')
            // Within one probe, commas and enumeration marks list synonyms.
            .split(/[,，、]+/)
            .map((x) => x.trim())
            .filter(Boolean),
        )
        .filter((list) => list.length > 0)
        .flat(),
    )
    .filter((list) => list.length > 0);
}

/** Flat probe list: every synonym of every requirement, for source queries. */
export function splitKeywords(value) {
  return splitConcepts(value).flat();
}

/**
 * A topic's concepts for both tracks.
 *
 * `all` stays flat on purpose: every synonym is an independent probe at the
 * source, so retrieval costs one request per keyword either way. The AND lives in
 * the relevance gate, where dropping a concept costs a paper rather than a probe.
 */
export function topicConcepts(topic) {
  const zh = splitConcepts(topic?.zh);
  const en = splitConcepts(topic?.en);
  return { zh, en, all: [...zh, ...en] };
}

/** A topic with no keyword at all is skipped rather than matching everything. */
export function topicTerms(topic) {
  const zh = splitKeywords(topic?.zh);
  const en = splitKeywords(topic?.en);
  return { zh, en, all: zh.concat(en) };
}

/** Local-time YYYY-MM-DD (never UTC — the schedule is wall-clock local). */
export function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Local-time { hour, minute } used by the scheduler tick. */
export function localClock(date = new Date()) {
  return { hour: date.getHours(), minute: date.getMinutes() };
}

export function parseTime(value) {
  const t = normaliseTime(value, '');
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return { hour: h, minute: m };
}

/**
 * Due when the configured wall-clock time has been reached today and the digest
 * has not already run today. The "already reached" form (rather than an exact
 * minute match) is what makes a missed schedule recoverable: if the machine was
 * asleep at 09:00, the first tick after wake-up still produces today's digest.
 */
export function isDue(cfg, now = new Date()) {
  if (!cfg.enabled) return false;
  const target = parseTime(cfg.time);
  if (!target) return false;
  const today = localDateKey(now);
  if (cfg.lastRunDate === today) return false;
  const { hour, minute } = localClock(now);
  return hour * 60 + minute >= target.hour * 60 + target.minute;
}
