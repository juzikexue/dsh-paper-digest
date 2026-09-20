/**
 * Small text helpers shared by every source adapter: HTML/entity cleanup,
 * title normalisation, dedupe keys, and abstract quality probes.
 */

import { matchesTopicScored } from './topic-match.js';

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  middot: '·',
};

export function decodeEntities(input) {
  return String(input ?? '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (all, body) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return all;
        }
      }
      return all;
    }
    const named = ENTITIES[body] ?? ENTITIES[body.toLowerCase()];
    return named === undefined ? all : named;
  });
}

/** Strip tags/CDATA/entities and collapse whitespace — feed and page text alike. */
export function cleanText(input) {
  return decodeEntities(
    String(input ?? '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cancels the "row is a whole journal, not an article" shape OpenAlex emits. */
export function looksLikeJournalRecord(title, kind) {
  if (kind && kind !== 'article') return true;
  const t = String(title ?? '').trim();
  if (!t) return true;
  // Journal records carry no sentence punctuation and are usually title-case
  // or ALL-CAPS journal names; a real title almost always has a separator.
  if (/^(the\s+)?[A-Z][A-Za-z&\s:-]{6,80}$/.test(t) && !/[:.,;?]/.test(t)) return true;
  return false;
}

/**
 * Key used to collapse the same paper arriving from several sources.
 *
 * NOTE: this form is for equality/substring comparison only. It removes every
 * separator, so it must never be used to split a keyword into groups — use
 * `normaliseGroups` for that. It also deliberately does NOT strip leading
 * articles: an earlier version did, which silently mangled any word starting
 * with "a" ("app" → "pp", "artificial" → "rtificial") and manufactured matches
 * across unrelated fields.
 */
export function normaliseTitle(title) {
  return String(title ?? '')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[._\-–—:：,，;；!！?？'"“”‘’()（）[\]【】《》<>/\\|+*#~`^%$@=]/g, '');
}

/**
 * Like `normaliseTitle`, but keeps word/group boundaries as single spaces —
 * the form used to split a keyword into its independently-matchable groups.
 */
export function normaliseGroups(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[._\-–—:：,，;；!！?？'"“”‘’()（）[\]【】《》<>/\\|+*#~`^%$@=]/g, ' ')
    .replace(/[\s\u3000]+/g, ' ')
    .trim();
}

export function dedupeKey(paper) {
  const doi = normaliseDoi(paper?.doi);
  if (doi) return `doi:${doi}`;
  const title = normaliseTitle(paper?.title);
  if (title) return `title:${title}`;
  return `raw:${String(paper?.url ?? '')}`;
}

export function normaliseDoi(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return raw
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .toLowerCase();
}

/** Cap an abstract for the report without cutting mid-word English text. */
export function truncate(text, max = 420) {
  const s = String(text ?? '').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const boundary = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('；'), cut.lastIndexOf('. '));
  if (boundary > max * 0.6) return cut.slice(0, boundary + 1);
  return `${cut}…`;
}

/**
 * Fraction of a keyword's tokens that appear in a blob — token-based rather
 * than raw substring, so "ai" cannot match inside "training".
 */
const CJK = /[\u4e00-\u9fff]/;

/**
 * Tokens worth matching on, and the groups they belong to.
 *
 * Each whitespace-separated group is tokenised on its own: a CJK run
 * contributes itself plus its 2-character bigrams, a Latin word is kept whole.
 * Bigrams are never formed *across* group boundaries, and text extraction is
 * done directly on the raw string rather than through `normaliseTitle`, whose
 * space removal would fuse separate words into one token.
 */
function groupsOf(term) {
  const raw = String(term ?? '');
  // A Latin keyword is one phrase: tokens are the whole phrase plus (for a
  // multi-word phrase) its individual words, all required. Splitting an English
  // phrase on spaces would turn "and" into "or" and let one shared word carry it.
  if (!CJK.test(raw)) {
    const phrase = normaliseTitle(raw);
    if (!phrase) return [];
    const words = phrase.match(/[a-z0-9]+/g) ?? [];
    const tokens = [...new Set(words.filter((w) => w.length >= 2))];
    if (tokens.length === 0) return [];
    // `modeOf` returns 'all', so one group requires every word while still
    // allowing the phrase to match as a contiguous string.
    return [{ tokens: tokens.includes(phrase) ? tokens : [phrase, ...tokens], minHits: 1 }];
  }

  // A Chinese keyword lists alternatives: each space-separated group is its own
  // candidate. Chinese has no spaces, so a run that is not a whole keyword is
  // decomposed into 2-character bigrams — but a 2-character run is usually
  // generic vocabulary, so it is not evidence on its own (verified: 教育 alone
  // matched 义务教育, and 学习 alone pulled a nuclear-physics paper into a
  // 语言学习 topic). Such a run still matches as part of a longer phrase.
  const groups = [];
  for (const group of normaliseGroups(raw).split(' ').filter(Boolean)) {
    const runs = group.match(/[\u4e00-\u9fff]+|[a-z0-9]+/g) ?? [];
    const tokens = [];
    let minHits = 1;
    for (const run of runs) {
      if (CJK.test(run)) {
        // A 2-character run is generic vocabulary (教育, 学习, 技术) and is not
        // evidence on its own — verified: 教育 alone matched 义务教育, and 学习
        // alone pulled a nuclear-physics paper into a 语言学习 topic. Longer
        // keywords that contain it still match through their own bigrams.
        if (run.length < 3) continue;
        tokens.push(run);
        const bigrams = [];
        for (let i = 0; i + 2 <= run.length; i += 1) bigrams.push(run.slice(i, i + 2));
        tokens.push(...bigrams);
        // A run of 3+ characters yields 2+ bigrams; requiring two hits keeps a
        // single generic bigram from carrying a topical phrase.
        if (bigrams.length >= 2) minHits = Math.max(minHits, 2);
      } else if (run.length >= 2) {
        tokens.push(run);
      }
    }
    const unique = [...new Set(tokens.filter((t) => !/^\d+$/.test(t)))];
    if (unique.length > 0) groups.push({ tokens: unique, minHits });
  }
  return groups;
}

/** Hits needed for a group to count: **all** its tokens (see termGroupHit). */
function hitsNeeded(tokenCount, ratio = 1) {
  return Math.max(1, Math.ceil(tokenCount * ratio));
}

/**
 * Matching mode for one keyword.
 *
 * Space means different things in the two languages the user writes:
 *   - a Chinese keyword lists alternatives ("人工智能 教育" = AI *or* education),
 *     so any group may satisfy it;
 *   - an English keyword is a phrase whose words are all required
 *     ("computer-assisted language learning"), so every group must be present.
 * Treating both as "any" let a single shared word carry a whole English phrase
 * (verified: "learning" alone matched "computer-assisted language learning").
 */
function modeOf(term) {
  return CJK.test(String(term ?? '')) ? 'any' : 'all';
}

/**
 * 1 when the keyword is satisfied by the blob, using the keyword's own mode and
 * requiring every token of a participating group.
 */
export function termGroupHit(term, blob, ratio = 1) {
  const groups = groupsOf(term);
  if (groups.length === 0) return 0;
  const hits = groups.map((group) => {
    const hit = group.tokens.filter((t) => blob.includes(t)).length;
    return hit >= Math.max(group.minHits, hitsNeeded(group.tokens.length, ratio));
  });
  return (modeOf(term) === 'all' ? hits.every(Boolean) : hits.some(Boolean)) ? 1 : 0;
}

/** Best per-group token coverage of a keyword, 0–1 (a real fraction). */
export function termHitRatio(term, blob) {
  const groups = groupsOf(term);
  if (groups.length === 0) return 0;
  let best = 0;
  for (const group of groups) {
    const hit = group.tokens.filter((t) => blob.includes(t)).length;
    best = Math.max(best, hit / group.tokens.length);
  }
  return best;
}

/**
 * Whether a paper plausibly belongs to a topic.
 *
 * Two tiers, because a single incidental word in a long abstract is not evidence
 * of a topic (verified: a Chinese paediatric paper about spinal muscular atrophy
 * matched "学习分析" purely because its abstract used the word 学习, and was then
 * selected for a learning-analytics digest):
 *
 *   1. **strict** — the title satisfies any keyword group, else the body
 *      satisfies at least `abstractGroups` distinct keywords. A keyword here is a
 *      *contiguous* token sequence, which is exact but brittle: a single inserted
 *      word defeats it ("Artificial Intelligence **in** Education" scored 0).
 *   2. **scored** — `scoreTopicMatch` decomposes each keyword into tokens and
 *      accumulates field-weighted hits, so wording variants still count while a
 *      lone generic word still cannot. Threshold calibrated on a labelled
 *      benchmark; see lib/core/topic-match.js.
 *
 * Tier 1 is kept as-is and runs first, so every decision the old gate made is
 * preserved exactly; tier 2 can only add recall, never remove it. Set
 * `options.mode` to `'strict'` or `'scored'` to pin one tier.
 *
 * @param {object} paper
 * @param {object} topic
 * @param {object} [options] `mode`, plus `ratio` / `abstractGroups` (strict) and
 *   `minScore` (scored)
 * @returns {string[]|true|null} matched keywords, `true` when the topic has no
 *   keywords at all, or null when the paper does not belong
 */
export function matchesTopic(paper, topic, options = {}) {
  const terms = topic?.terms?.all ?? [];
  if (terms.length === 0) return true;
  const mode = options.mode ?? 'mixed';

  if (mode !== 'scored') {
    const ratio = options.ratio ?? 1;
    const minGroups = options.abstractGroups ?? Math.min(2, terms.length);
    const titleBlob = normaliseTitle(`${paper.title} ${(paper.keywords ?? []).join(' ')}`);
    const titleHits = terms.filter((term) => termGroupHit(term, titleBlob, ratio) === 1);
    if (titleHits.length > 0) return titleHits;
    const body = normaliseTitle(`${paper.title} ${paper.abstract} ${(paper.keywords ?? []).join(' ')}`);
    const bodyHits = terms.filter((term) => termGroupHit(term, body, ratio) === 1);
    if (bodyHits.length >= minGroups) return bodyHits;
    if (mode === 'strict') return null;
  }

  return matchesTopicScored(paper, topic, options);
}

/**
 * Record WHY a paper matched so the report can show it. Without this the digest
 * silently mixes in keyword collisions — the user sees a nuclear-physics paper
 * under 语言学习技术 and cannot tell that the word 技术 alone caused it, nor
 * refine the keyword that did.
 */
export function applyTopicMatch(paper, topic, options = {}) {
  const hit = matchesTopic(paper, topic, options);
  if (!hit) return false;
  paper.topicId = topic.id;
  paper.topicName = topic.name;
  paper.matchedTerms = hit;
  return true;
}

const METHOD_HINTS =
  /(方法|方法学|实验|问卷|访谈|样本|数据|模型|算法|评估|实证|回归|编码|method|experiment|dataset|sample|survey|interview|evaluat|regression|we\s+(?:train|test|measure|collect))/i;
const RESULT_HINTS =
  /(结果|发现|表明|显示|结论|显著|提升|表明|result|finding|we\s+find|shows?|demonstrat|outperform|improv|significan)/i;
const LIMIT_HINTS = /(局限|不足|未来研究|limitation|future\s+work|caveat)/i;
const DATA_HINTS =
  /(https?:\/\/[^\s)]*(?:github|gitlab|zenodo|osf\.io|figshare|dataverse|huggingface)[^\s)]*|数据(?:已)?公开|代码(?:已)?开源|open\s+data|code\s+is\s+available|data\s+availability)/i;

/**
 * Content-level quality probes, evaluated on title+abstract only. These are the
 * signals that still work at T+0, when citations and FWCI are necessarily
 * meaningless — see lib/core/score.js.
 */
export function contentEvidence(paper) {
  const blob = `${paper?.title ?? ''} ${paper?.abstract ?? ''}`;
  return {
    method: METHOD_HINTS.test(blob),
    result: RESULT_HINTS.test(blob),
    limitation: LIMIT_HINTS.test(blob),
    dataOpen: DATA_HINTS.test(blob),
  };
}

/** `Accepted at EMNLP 2026` / `CVPR 2025 camera-ready` in an arXiv comment. */
const VENUE_HINT =
  /(accepted|to\s+appear|published|conditionally\s+accepted)\s+(?:at|in|to)?\s*([A-Za-z][A-Za-z0-9&.\- ]{1,48}?)(?:\s*(?:20\d{2}|\d{4}))?(?:[.,;)]|$)/i;

export function acceptedVenue(comment) {
  const m = VENUE_HINT.exec(String(comment ?? ''));
  if (!m) return '';
  const venue = m[2].trim().replace(/\s+/g, ' ');
  return venue.length >= 2 ? venue : '';
}
