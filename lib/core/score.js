/**
 * Transparency-first quality scoring.
 *
 * Two rules drive this file:
 *
 * 1. At T+0 citations and FWCI are meaningless (a paper published today has
 *    none — verified: OpenAlex returns `fwci: null` for the current window).
 *    So venue authority and *content evidence* carry the score, and citation
 *    velocity is only a small bonus that becomes meaningful for older items.
 * 2. The report must explain itself. Every paper carries a `reasons` list built
 *    from named signals with their weights, so a ranking can always be audited
 *    instead of trusted blindly.
 */
import { contentEvidence, normaliseDoi, normaliseTitle, termHitRatio, termGroupHit } from './text.js';

export const WEIGHTS = {
  venue: 30,
  content: 25,
  recency: 15,
  data: 10,
  community: 10,
  author: 10,
};

/** Journal venues the user marked as 北大核心 / CSSCI / CSCD in their own list. */
const CORE_HINTS = /\b(北大核心|中文核心|CSSCI|CSCD|南大核心|AMI核心|科技核心)\b/i;

function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/** 0–1 recency falloff: today = 1, `lookbackDays` old = 0. */
export function recencyFactor(publishedDate, lookbackDays, now = new Date()) {
  const d = new Date(`${publishedDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return 0.35; // unknown date: middling, not zero
  const age = Math.max(0, daysBetween(d, now));
  if (age >= lookbackDays) return 0;
  return 1 - age / lookbackDays;
}

/**
 * Venue authority, 0–1, from signals available before any citation exists:
 * an explicit core-journal tag the user supplied, OpenAlex's `is_core`
 * (WoS/Scopus-grade indexing), a peer-reviewed journal, an accepted-at venue,
 * or a bare preprint.
 */
export function venueFactor(paper) {
  if (paper.coreTag && CORE_HINTS.test(paper.coreTag)) return 1;
  if (paper.isCore) return 0.95;
  if (paper.acceptedAt) return 0.8;
  if (paper.venueType === 'journal') return 0.62;
  if (paper.preprint || paper.venueType === 'preprint') return 0.34;
  if (paper.venueType === 'repository') return 0.3;
  return 0.4;
}

/** How many of the four content probes hit (method / result / limitation / open data). */
export function contentFactor(paper) {
  const ev = paper.evidence ?? contentEvidence(paper);
  const hits = [ev.method, ev.result, ev.limitation].filter(Boolean).length;
  // 3/3 → 1.0, 2/3 → 0.72, 1/3 → 0.42, 0/3 → 0.15 (abstract-only, no method signal)
  const base = [0.15, 0.42, 0.72, 1][hits] ?? 0.15;
  return { value: base, evidence: ev, hits };
}

/** Early-traction proxy. Nearly zero on day zero by construction — by design. */
export function communityFactor(paper) {
  const cited = Number(paper.citedBy) || 0;
  if (cited <= 0) return 0.12;
  // log-ish curve: 1 cite ≈ 0.45, 5 ≈ 0.72, 25 ≈ 0.9, 100+ ≈ 1
  return Math.min(1, 0.3 + Math.log10(cited + 1) / 2.2);
}

/** Institutional/author signal. Deliberately the smallest weight: it must not
 *  turn the digest into a big-lab leaderboard. */
export function authorFactor(paper) {
  const n = Array.isArray(paper.authors) ? paper.authors.length : 0;
  const hasAffiliation = Array.isArray(paper.affiliations) && paper.affiliations.length > 0;
  let v = 0.4;
  if (hasAffiliation) v += 0.3;
  if (n >= 2 && n <= 12) v += 0.2; // a normal research team, not a 60-author mega-list
  else if (n === 1) v += 0.05;
  if (paper.isCorresponding) v += 0.1;
  return Math.min(1, v);
}

/**
 * Keyword overlap between the paper and its topic, 0–1.
 *
 * A topic term appearing in the **venue** counts as strong evidence: a paper
 * in 《教育研究》 is education research even when its title does not repeat the
 * word. Without this the relevant Chinese core-journal items scored below
 * generic English ones (verified 2026-09-17).
 */
export function relevanceFactor(paper, topic) {
  // Concept-level AND, the same rule the gate applies: a paper has to speak to
  // every concept the user listed, and the weakest concept decides the score. On
  // the flat list a paper covering one concept out of three scored as if it
  // covered all of them.
  const concepts = Array.isArray(topic?.concepts) ? topic.concepts : null;
  if (concepts && concepts.length > 0) {
    return Math.min(...concepts.map((concept) => flatRelevance(paper, { ...topic, terms: { all: concept } })));
  }
  return flatRelevance(paper, topic);
}

/** Best single-term overlap for one flat term list (the pre-concept rule). */
function flatRelevance(paper, topic) {
  const terms = topic?.terms?.all ?? [];
  if (!terms.length) return 0.5;
  const blob = normaliseTitle(`${paper.title} ${paper.abstract} ${(paper.keywords ?? []).join(' ')}`);
  const venueBlob = normaliseTitle(paper.venue ?? '');
  let best = 0;
  for (const term of terms) {
    best = Math.max(best, termHitRatio(term, blob));
    // A topical journal name is strong evidence: a paper in 《教育研究》 is
    // education research even when its title never repeats the word.
    if (venueBlob && termGroupHit(term, venueBlob) === 1) best = Math.max(best, 0.85);
  }
  // The topic's own name is a first-class probe (it is what the user typed).
  if (topic.name) {
    best = Math.max(best, termHitRatio(topic.name, blob));
    if (venueBlob && termGroupHit(topic.name, venueBlob) === 1) best = Math.max(best, 0.85);
  }
  return best;
}

/**
 * Hard gates. A paper failing any of these is dropped before scoring rather
 * than scored low, so the digest never lists a retracted or untitled record.
 *
 * Journal-feed items (`isJournalFeed`) skip the age window on purpose: a CNKI
 * RSS feed carries the current issue, so between issues its entries are
 * legitimately older than `lookbackDays` while still being the newest work in
 * that journal. Applying the window to them emptied the entire Chinese track
 * (verified: 40 fetched, 0 kept).
 */
export function passesGate(paper, { lookbackDays, now = new Date() } = {}) {
  if (!paper?.title || paper.title.trim().length < 6) return false;
  if (paper.isRetracted === true) return false;
  if (!paper.url && !paper.doi) return false;
  if (!paper.isJournalFeed && paper.publishedDate) {
    const d = new Date(`${paper.publishedDate}T00:00:00`);
    if (!Number.isNaN(d.getTime())) {
      const age = daysBetween(d, now);
      if (age > lookbackDays + 7) return false; // tolerate clock/issueless skew
      if (age < -2) return false; // future-dated placeholder
    }
  }
  return true;
}

/**
 * Score one paper. Returns the paper with `score` (0–100), `reasons` (human
 * readable, weight-annotated) and normalised `evidence` attached.
 */
export function scorePaper(paper, topic, options = {}) {
  const lookbackDays = options.lookbackDays ?? 14;
  const now = options.now ?? new Date();

  const venue = venueFactor(paper);
  const content = contentFactor(paper);
  const recency = recencyFactor(paper.publishedDate, lookbackDays, now);
  const data = content.evidence.dataOpen ? 1 : 0.15;
  const community = communityFactor(paper);
  const author = authorFactor(paper);
  const relevance = relevanceFactor(paper, topic);

  const raw =
    venue * WEIGHTS.venue +
    content.value * WEIGHTS.content +
    recency * WEIGHTS.recency +
    data * WEIGHTS.data +
    community * WEIGHTS.community +
    author * WEIGHTS.author;

  // Relevance gates the score instead of adding to it: an off-topic paper with
  // a perfect venue must not outrank an on-topic one.
  const score = Math.round(raw * (0.45 + 0.55 * relevance));

  const reasons = [];
  if (paper.coreTag && CORE_HINTS.test(paper.coreTag)) reasons.push(`核心期刊（${paper.coreTag}）`);
  else if (paper.isCore) reasons.push('期刊被核心库收录');
  if (paper.acceptedAt) reasons.push(`已被 ${paper.acceptedAt} 录用`);
  if (paper.venueType === 'journal' && !paper.isCore && !paper.acceptedAt) reasons.push('同行评审期刊');
  if (paper.preprint) reasons.push('预印本（未同行评审）');
  const evHits = [];
  if (content.evidence.method) evHits.push('方法');
  if (content.evidence.result) evHits.push('结果');
  if (content.evidence.limitation) evHits.push('局限');
  if (evHits.length) reasons.push(`摘要含${evHits.join('/')}要素`);
  if (content.evidence.dataOpen) reasons.push('有数据/代码公开线索');
  if ((paper.citedBy ?? 0) > 0) reasons.push(`已获 ${paper.citedBy} 次引用`);
  if (recency >= 0.85) reasons.push('最新发布');
  reasons.push(`主题相关度 ${(relevance * 100).toFixed(0)}%`);

  return {
    ...paper,
    evidence: content.evidence,
    relevance,
    score,
    reasons,
    breakdown: {
      venue: Math.round(venue * WEIGHTS.venue),
      content: Math.round(content.value * WEIGHTS.content),
      recency: Math.round(recency * WEIGHTS.recency),
      data: Math.round(data * WEIGHTS.data),
      community: Math.round(community * WEIGHTS.community),
      author: Math.round(author * WEIGHTS.author),
    },
  };
}

/**
 * Collapse duplicates across sources, keeping the richer record.
 *
 * Two records are the same paper when they share a DOI **or** a normalised
 * title — matching on both keys matters (verified: the same OpenAlex paper can
 * appear twice under different DOIs, which a DOI-only check leaves in the
 * report).
 */
export function dedupe(papers) {
  const byKey = new Map();
  const richness = (p) =>
    (p.abstract ? 2 : 0) + (p.doi ? 1 : 0) + (p.venue ? 1 : 0) + (p.authors?.length ? 1 : 0) + (p.isCore ? 1 : 0);

  for (const paper of papers) {
    const doi = normaliseDoi(paper.doi);
    const title = normaliseTitle(paper.title);
    const keys = [];
    if (doi) keys.push(`doi:${doi}`);
    if (title) keys.push(`title:${title}`);
    if (keys.length === 0) keys.push(`raw:${paper.url ?? ''}`);

    const existing = keys.map((k) => byKey.get(k)).find(Boolean);
    if (!existing) {
      for (const k of keys) byKey.set(k, paper);
      continue;
    }
    // Field-wise merge, preferring whichever side actually has a value. A
    // whole-record spread would let a sparse duplicate's title overwrite the
    // richer record's (verified: a preprint title replaced the DOI-of-record
    // title during a same-DOI merge).
    const merged = { ...existing };
    for (const [field, value] of Object.entries(paper)) {
      const current = merged[field];
      const currentEmpty =
        current === undefined ||
        current === null ||
        current === '' ||
        (Array.isArray(current) && current.length === 0);
      if (currentEmpty) merged[field] = value;
    }
    // Keep whichever signals are present on either side.
    merged.isCore = existing.isCore || paper.isCore;
    merged.isRetracted = existing.isRetracted || paper.isRetracted;
    merged.acceptedAt = existing.acceptedAt || paper.acceptedAt;
    merged.coreTag = existing.coreTag || paper.coreTag;
    merged.matchedTerms = [...new Set([...(existing.matchedTerms ?? []), ...(paper.matchedTerms ?? [])])];
    merged.citedBy = Math.max(existing.citedBy ?? 0, paper.citedBy ?? 0);
    merged.isJournalFeed = existing.isJournalFeed || paper.isJournalFeed;
    // Re-index every key so a later record matching either key finds this one.
    const mergedDoi = normaliseDoi(merged.doi);
    const mergedTitle = normaliseTitle(merged.title);
    if (mergedDoi) byKey.set(`doi:${mergedDoi}`, merged);
    if (mergedTitle) byKey.set(`title:${mergedTitle}`, merged);
    for (const k of keys) byKey.set(k, merged);
  }

  return [...new Set(byKey.values())];
}

/**
 * Pick the final digest.
 *
 * Allocation is round-robin across topics, because anything that lets the
 * highest-scoring topic consume the whole budget starves the others (verified:
 * a global cap produced ten papers from one topic, and two per-topic passes
 * still left the third topic empty). Each round takes one Chinese quota slot
 * then one English slot, so every topic with candidates is represented whenever
 * a slot remains. The Chinese shortfall is backfilled in English within the
 * same topic.
 */
export function selectDigest(scored, cfg, options = {}) {
  const byTopic = new Map();
  for (const paper of scored) {
    const id = paper.topicId || 'unknown';
    if (!byTopic.has(id)) byTopic.set(id, []);
    byTopic.get(id).push(paper);
  }

  // Configured topics plus any extra grouping the caller passes (e.g. journal
  // items that matched no topic). Without this the extra papers would be scored
  // and then silently dropped, since allocation only walked `cfg.topics`.
  const allTopics = [...cfg.topics, ...(options.extraTopics ?? [])];

  const seen = new Set();
  const picks = [];
  const topicCount = Math.max(1, allTopics.length);
  // Share one venue's presence across topics so a single prolific journal
  // cannot occupy a topic, while still allowing it to fill its own topics.
  const venueCap = Math.max(2, Math.ceil(cfg.dailyCount / (topicCount * 2)));

  const states = allTopics
    .map((topic) => ({ topic, pool: (byTopic.get(topic.id) ?? []).sort((a, b) => b.score - a.score), venueUse: new Map() }))
    .filter((s) => s.pool.length > 0);

  function take(state, track) {
    for (const paper of state.pool) {
      if (paper.track !== track) continue;
      const doi = normaliseDoi(paper.doi);
      const title = normaliseTitle(paper.title);
      if ((doi && seen.has(`doi:${doi}`)) || (title && seen.has(`title:${title}`))) continue;
      const venue = paper.venue || paper.sourceLabel || 'unknown';
      const used = state.venueUse.get(venue) ?? 0;
      if (used >= venueCap) continue;
      state.venueUse.set(venue, used + 1);
      if (doi) seen.add(`doi:${doi}`);
      if (title) seen.add(`title:${title}`);
      return paper;
    }
    return null;
  }

  let zhCount = 0;
  let enCount = 0;
  let progressed = true;
  while (picks.length < cfg.dailyCount && progressed) {
    progressed = false;
    for (const state of states) {
      if (picks.length >= cfg.dailyCount) break;
      if (zhCount < cfg.mix.zh) {
        const paper = take(state, 'zh');
        if (paper) {
          picks.push(paper);
          zhCount += 1;
          progressed = true;
          continue;
        }
      }
      if (enCount < cfg.mix.en) {
        const paper = take(state, 'en');
        if (paper) {
          picks.push(paper);
          enCount += 1;
          progressed = true;
        }
      }
    }
  }

  // Backfill: if a whole track under-delivered, top up from whatever is left.
  progressed = true;
  while (picks.length < cfg.dailyCount && progressed) {
    progressed = false;
    for (const track of ['zh', 'en']) {
      for (const state of states) {
        if (picks.length >= cfg.dailyCount) break;
        const paper = take(state, track);
        if (paper) {
          picks.push(paper);
          progressed = true;
        }
      }
    }
  }

  return picks.slice(0, cfg.dailyCount);
}
