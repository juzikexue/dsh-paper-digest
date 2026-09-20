/**
 * Run orchestration: fan out across enabled sources for each topic, isolate
 * failures, dedupe, score, and select the final digest.
 *
 * Error isolation is the point of this file. A digest that silently drops a
 * source is worse than one that says so, so every adapter outcome (count or
 * error) is returned in `stats` and rendered into the report footer.
 */
import { SOURCES, fetchCnkiRss } from './sources.js';
import { dedupe, passesGate, scorePaper, selectDigest, relevanceFactor } from './score.js';
import { matchesTopic, applyTopicMatch } from './text.js';
import { attachFullTexts } from './downloader.js';
import { summarizePapers } from './summarizer.js';
import { topicTerms } from './config.js';

/** Attach resolved keyword terms to a topic once per run. */
function withTerms(topic) {
  return { ...topic, terms: topicTerms(topic) };
}

function ctxFor(cfg, now) {
  return {
    timeoutMs: cfg.requestTimeoutMs,
    lookbackDays: cfg.lookbackDays,
    maxPerTopic: cfg.maxPerTopic,
    mailto: 'dsh-paper-digest@localhost',
    now,
  };
}

/**
 * Which topic a CNKI RSS entry belongs to.
 *
 * A pinned topic always wins; otherwise the entry goes to the topic it matches
 * best. An entry that matches *no* topic is deliberately left unassigned rather
 * than pushed into an arbitrary one — the earlier "fall back to the first topic"
 * rule filled 语言学习技术 with a nuclear-engineering paper and a science-
 * education theory paper, which the session summary then had to flag as
 * misclustered. Unassigned entries are reported under a "最新目录" group.
 */
function assignTopic(paper, topics) {
  if (paper.topicId) {
    const pinned = topics.find((t) => t.id === paper.topicId);
    if (pinned) {
      paper.topicName = pinned.name;
      return paper;
    }
  }
  let best = null;
  let bestScore = 0;
  for (const topic of topics) {
    const r = relevanceFactor(paper, topic);
    if (r > bestScore) {
      bestScore = r;
      best = topic;
    }
  }
  // A journal entry must fit the topic reasonably well: 0.5 means at least half
  // of a keyword's tokens are present. The looser 0.25 let a nuclear-engineering
  // paper whose abstract merely says "技术" join 语言学习技术 (verified in the
  // session summary, which flagged the misclustering). Items below the bar go to
  // the "最近一期目录" group rather than into a wrong topic.
  if (best && bestScore >= 0.5) {
    paper.topicId = best.id;
    paper.topicName = best.name;
    return paper;
  }
  return null;
}

/** Group id for journal items that matched no configured topic. */
export const UNMATCHED_TOPIC_ID = '__journals__';
const UNMATCHED_TOPIC = {
  id: UNMATCHED_TOPIC_ID,
  name: '最近一期目录（未匹配主题）',
  zh: '',
  en: '',
};

/**
 * Collect candidates for every topic.
 * @returns {Promise<{papers: object[], stats: object[], errors: object[]}>}
 */
export async function collectCandidates(cfg, now = new Date()) {
  const topics = cfg.topics.map(withTerms);
  const ctx = ctxFor(cfg, now);
  const stats = [];
  const errors = [];
  const all = [];

  // --- Chinese track: CNKI journal RSS (per journal, then matched to a topic).
  if (cfg.sources.cnkiRss && cfg.journals.length > 0) {
    for (const journal of cfg.journals) {
      try {
        const papers = await fetchCnkiRss(journal, ctx);
        let kept = 0;
        for (const paper of papers) {
          const assigned = assignTopic(paper, topics);
          if (assigned) {
            all.push(assigned);
          } else {
            // Keep the item but label it honestly: the user listed this journal,
            // so its content belongs in the report, just not under a topic it
            // does not match.
            paper.topicId = UNMATCHED_TOPIC_ID;
            paper.topicName = UNMATCHED_TOPIC.name;
            paper.unmatchedTopic = true;
            all.push(paper);
          }
          kept += 1;
        }
        stats.push({ source: 'cnkiRss', label: `CNKI·${journal.name || journal.id}`, fetched: papers.length, kept });
      } catch (error) {
        errors.push({ source: 'cnkiRss', label: `CNKI·${journal.name || journal.id}`, message: String(error?.message ?? error) });
      }
    }
  } else if (cfg.sources.cnkiRss && cfg.journals.length === 0) {
    errors.push({ source: 'cnkiRss', label: 'CNKI 期刊 RSS', message: '未配置期刊（设置页可添加，如 JJYJ=经济研究）' });
  }

  // --- Keyword-search sources, run per topic, all in parallel and isolated.
  const jobs = [];
  for (const topic of topics) {
    if (topic.terms.all.length === 0) continue;
    for (const [id, meta] of Object.entries(SOURCES)) {
      if (meta.kind !== 'search') continue;
      if (!cfg.sources[id]) continue;
      if (meta.track === 'zh' && topic.terms.zh.length === 0) continue;
      if (meta.track === 'en' && topic.terms.en.length === 0) continue;
      jobs.push({ id, meta, topic });
    }
  }

  const settled = await Promise.all(
    jobs.map(async ({ id, meta, topic }) => {
      try {
        const papers = await meta.fetch(topic, ctx);
        return { ok: true, id, label: meta.label, topic, papers };
      } catch (error) {
        return { ok: false, id, label: meta.label, topic, message: String(error?.message ?? error) };
      }
    }),
  );

  for (const result of settled) {
    if (!result.ok) {
      errors.push({ source: result.id, label: `${result.label}·${result.topic.name}`, message: result.message });
      continue;
    }
    let kept = 0;
    for (const paper of result.papers) {
      // Endpoint keyword search RANKS rather than filters — ChinaXiv happily
      // returns nuclear physics for an education query (verified 2026-09-17),
      // so relevance is enforced here before anything reaches the scorer.
      if (!applyTopicMatch(paper, result.topic)) continue;
      all.push(paper);
      kept += 1;
    }
    stats.push({ source: result.id, label: `${result.label}·${result.topic.name}`, fetched: result.papers.length, kept });
  }

  return { papers: all, stats, errors };
}

/** Mark papers whose venue appears in the user's core-journal list. */
export function tagCoreVenues(papers, coreTags) {
  if (!coreTags || coreTags.size === 0) return papers;
  for (const paper of papers) {
    const venue = String(paper.venue ?? '');
    if (!venue) continue;
    for (const [name, tag] of coreTags) {
      if (name && venue.includes(name)) {
        paper.coreTag = tag;
        break;
      }
    }
  }
  return papers;
}

/**
 * Full pipeline: collect → core-tag → gate → dedupe → score → select → group.
 * @returns {Promise<{groups: {topic: object, papers: object[]}[], stats: object[], errors: object[], totals: object}>}
 */
export async function buildDigest(cfg, now = new Date(), options = {}) {
  const { papers, stats, errors } = await collectCandidates(cfg, now);

  // Core-journal tagging must happen BEFORE scoring: venue authority is the
  // heaviest weight, and the user's own list is its strongest evidence.
  tagCoreVenues(papers, options.coreTags);

  const gated = papers.filter((p) => passesGate(p, { lookbackDays: cfg.lookbackDays, now }));
  const droppedByGate = papers.length - gated.length;

  const unique = dedupe(gated);
  const duplicates = gated.length - unique.length;

  const topicsById = new Map(cfg.topics.map((t) => [t.id, withTerms(t)]));
  const scored = unique
    .map((paper) => {
      // Fall back to a term-carrying copy so a paper whose topicId is unknown
      // still gets sane relevance instead of scoring under an empty topic.
      const topic = topicsById.get(paper.topicId) ?? {
        name: paper.topicName ?? '',
        terms: topicTerms({ zh: paper.topicName ?? '', en: '' }),
      };
      return scorePaper(paper, topic, { lookbackDays: cfg.lookbackDays, now });
    })
    .sort((a, b) => b.score - a.score);

  const selected = selectDigest(scored, cfg, { extraTopics: [UNMATCHED_TOPIC] });

  // Full-text stage, after selection so the download budget is spent only on
  // papers that actually appear in the report. Failures are recorded per paper
  // (`pdfError`) and never abort the run.
  const fullText = await attachFullTexts(selected, cfg).catch((error) => ({
    downloaded: 0,
    failed: 0,
    skipped: selected.length,
    bytes: 0,
    error: String(error?.message ?? error),
  }));

  // Chinese one-glance summaries, also only for selected papers.
  const summaries = await summarizePapers(selected, {
    llm: options.llm,
    agentDefaultModel: options.agentDefaultModel,
    enabled: cfg.summaryEnabled,
    maxTokens: cfg.summaryMaxTokens,
    reasoningEffort: cfg.summaryReasoningEffort || undefined,
    timeoutMs: Math.max(cfg.requestTimeoutMs, 30000),
    concurrency: 2,
    override: { provider: cfg.summaryModelProvider, model: cfg.summaryModel },
  }).catch((error) => ({
    ok: 0,
    failed: 0,
    skipped: selected.length,
    route: null,
    errors: [{ label: '中文总结', message: String(error?.message ?? error) }],
  }));

  const groups = [];
  for (const topic of cfg.topics) {
    const items = selected.filter((p) => p.topicId === topic.id);
    if (items.length > 0) groups.push({ topic, papers: items });
  }
  // Journal items that matched no topic are reported separately rather than
  // being disguised as topic members.
  const unmatched = selected.filter((p) => p.topicId === UNMATCHED_TOPIC_ID);
  if (unmatched.length > 0) groups.push({ topic: UNMATCHED_TOPIC, papers: unmatched });

  return {
    groups,
    stats,
    errors,
    fullText,
    summaries,
    totals: {
      candidates: papers.length,
      droppedByGate,
      duplicates,
      scored: scored.length,
      selected: selected.length,
      zh: selected.filter((p) => p.track === 'zh').length,
      en: selected.filter((p) => p.track === 'en').length,
      pdf: fullText.downloaded ?? 0,
      summarized: summaries.ok ?? 0,
    },
  };
}
