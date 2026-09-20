/**
 * Token-based topic relevance, ported from wp-a/nature-academic-search's
 * `ranking.py` (MIT, Copyright (c) 2026 wp-a) and adapted to this plugin.
 *
 * Why this exists: the gate in `text.js` treats a keyword as a *contiguous*
 * token sequence, so `artificial intelligence education` fails against
 * "Artificial Intelligence **in** Education" and `AI in Education` matches
 * nothing at all. Measured on live retrieval for 「人工智能教育」: precision
 * 58.3%, recall 46.7%, F1 51.9% — every one of the 8 misses was a wording
 * variant, not an off-topic paper (see the benchmark in the PR description).
 *
 * What is taken from the ported design:
 *   - a query is decomposed into *tokens*, never matched as one literal string;
 *   - CJK runs become **overlapping bigrams**, so partial overlap scores
 *     instead of collapsing to zero;
 *   - hits are **accumulated with field weights** (title > abstract > subject
 *     terms) instead of a single boolean;
 *   - a whole-query phrase hit and an identifier match earn explicit bonuses.
 *
 * What is deliberately NOT taken, because this plugin measured the opposite:
 *   - `ranking.py` gives a +5.0 title bonus for a *single* shared token. That is
 *     how 「基于大模型…」 library-science papers enter an AI-in-education digest.
 *     Here a term only scores its full weight when **every** token of the term
 *     is present; partial coverage is scaled down and penalised.
 *   - a bare 2-character CJK alternative is never evidence on its own. The
 *     regression tests in test/text.test.js encode live misfires (教育 pulling
 *     义务教育 policy papers; 学习 pulling a nuclear-physics paper), so the
 *     minimum token length is enforced here too.
 *
 * The scorer returns a *continuous* score plus the human-readable reasons, so
 * the report can keep showing 命中关键词 and the user can audit any decision.
 */

/** Minimum length for a CJK token to count as evidence (mirrors text.js). */
const MIN_CJK_TOKEN = 3;
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const CJK_RUN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g;

/**
 * Field weights: where a token was found decides how much it is worth.
 *
 * The venue is deliberately absent: its evidence is the separate additive bonus
 * below, because it must never be the field that wins a term outright.
 */
export const FIELD_WEIGHT = { title: 5, keywords: 2.5, abstract: 2 };

/** Scale applied to a term when only part of its tokens were found. */
const PARTIAL_PENALTY = 2.5;

/** Awarded once when the whole query appears verbatim in the title. */
const PHRASE_BONUS = 3;

/**
 * Credit for a term that the venue name satisfies in full, plus its topical
 * bonus. Kept additive and small on purpose: venue evidence raises a paper's
 * score but cannot reach the acceptance threshold by itself, because publishers
 * do ship wrong or generic container titles. A venue never wins a term outright
 * (it is absent from FIELD_WEIGHT for the same reason).
 */
const VENUE_WEIGHT = 1;
const VENUE_BONUS = 2;

/**
 * Abbreviation and spelling equivalents. Ported design has no such table; it was
 * added here because the benchmark showed whole families of papers unreachable
 * without it: "AI in Education" scored 0 against `artificial intelligence
 * education`, and 大语言模型 scored nothing against 大模型.
 *
 * Only cross-form pairs belong here — never broader/narrower concepts. 智能导师
 * and 智能辅导 are kept apart on purpose: tutoring and mentoring are different
 * interventions, and merging them would admit papers the topic did not ask for.
 */
const EQUIVALENTS = [
  ['artificial intelligence', 'ai'],
  ['large language model', 'llm'],
  ['large language models', 'llms'],
  ['machine learning', 'ml'],
  ['kindergarten through twelfth grade', 'k-12'],
  ['大语言模型', '大模型'],
  ['人工智能', 'ai'],
];

/** Multiplied into the weight of an equivalent-form hit, to prefer the literal. */
const EQUIVALENT_DISCOUNT = 0.9;

/**
 * Extra credit when several *distinct* topic terms co-occur in the body but none
 * reaches the title. A paper whose abstract says 人工智能 and 教育 repeatedly is
 * plainly on topic even when the title is about measurement.
 */
const COOCCURRENCE_BONUS = 2;

/** A discount target for a term satisfied only through an equivalent form. */
function equivalentsOf(term) {
  const lower = normSpaced(term);
  const out = [];
  for (const [a, b] of EQUIVALENTS) {
    if (lower.includes(a)) out.push(lower.split(a).join(b));
    else if (lower.includes(b)) out.push(lower.split(b).join(a));
  }
  return [...new Set(out)];
}

/**
 * Accepted match when the accumulated score reaches this. Calibrated on the
 * labelled benchmark (30 live + injected samples for 「人工智能教育」), where
 * 3.5 is the smallest threshold at which no off-topic paper is admitted:
 *
 *   baseline gate     precision 58.3%  recall 53.8%  F1 56.0%
 *   this scorer @3.5  precision 100%   recall 84.6%  F1 91.7%
 *
 * The threshold is deliberately inclusive. A false positive is visible in the
 * report (命中关键词 shows why) and fixable by tightening a keyword, while a
 * false negative is silent — that asymmetry is why 2.5 was not chosen despite a
 * higher recall (75.0% precision admits four off-topic papers).
 */
export const DEFAULT_MIN_SCORE = 3.5;

/** Normalisation that keeps word boundaries (token splitting needs them). */
function normSpaced(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[._\-–—:：,，;；!！?？'"“”‘’()（）[\]【】《》<>/\\|+*#~`^%$@=]/g, ' ')
    .replace(/[\s\u3000]+/g, ' ')
    .trim();
}

/** Normalisation that removes all separators (for contiguous phrase checks). */
function normTight(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[._\-–—:：,，;；!！?？'"“”‘’()（）[\]【】《》<>/\\|+*#~`^%$@=]/g, '');
}

/**
 * Split one keyword into independently-matchable tokens.
 *
 * Latin keywords yield whole words (`large language model teaching` becomes four
 * tokens, so partial overlap is measurable). CJK runs yield every 3+ character
 * token plus their overlapping bigrams — the bigram is what lets 人工智能教育
 * score against 人工智能赋能教育, while the 3-character floor is what keeps 教育
 * from matching 义务教育.
 *
 * @param {string} term one keyword, e.g. `人工智能 教育`
 * @returns {string[]} unique tokens
 */
export function termTokens(term) {
  const out = [];
  for (const word of normSpaced(term).split(' ')) {
    if (!word) continue;
    if (!CJK.test(word)) {
      if (word.length >= 2) out.push(word);
      continue;
    }
    // CJK run: every window of MIN_CJK_TOKEN characters, plus the full run.
    if (word.length >= MIN_CJK_TOKEN) out.push(word);
    for (let size = MIN_CJK_TOKEN; size <= word.length; size += 1) {
      for (let i = 0; i + size <= word.length; i += 1) out.push(word.slice(i, i + size));
    }
    if (word.length === 2) {
      // A 2-character alternative is a whole word on its own; it is recorded but
      // marked weak by the caller (see `termScore`), never dropped silently.
      out.push(word);
    }
  }
  return [...new Set(out)];
}

/** Whether a term's tokens are all shorter than the evidence floor. */
function isWeakTerm(term) {
  const tokens = termTokens(term);
  if (tokens.length === 0) return true;
  return tokens.every((t) => !CJK.test(t) ? t.length < 3 : t.length < MIN_CJK_TOKEN);
}

/**
 * Score one term against one field blob.
 * @returns {{ratio: number, hits: number, total: number}}
 */
function termFieldScore(term, blob) {
  const tokens = termTokens(term);
  if (tokens.length === 0 || !blob) return { ratio: 0, hits: 0, total: 0 };
  const hits = tokens.filter((t) => blob.includes(t)).length;
  return { ratio: hits / tokens.length, hits, total: tokens.length };
}

/**
 * Continuous relevance of one paper to one topic.
 *
 * @param {object} paper normalised paper record
 * @param {object} topic topic with `terms.all` / `terms.zh` / `terms.en`
 * @returns {{score: number, accepted: boolean, matchedTerms: string[], reasons: string[], fields: object}}
 */
export function scoreTopicMatch(paper, topic, options = {}) {
  const terms = topic?.terms?.all ?? [];
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const allowWeak = options.allowWeakTerms ?? false;

  if (terms.length === 0) {
    return { score: 0, accepted: true, matchedTerms: [], reasons: ['no-keywords'], fields: {} };
  }

  const fields = {
    title: normSpaced(paper?.title),
    keywords: normSpaced((paper?.keywords ?? []).join(' ')),
    abstract: normSpaced(paper?.abstract),
    venue: normSpaced(paper?.venue),
  };
  const tightTitle = normTight(paper?.title);

  let score = 0;
  const reasons = [];
  const matchedTerms = [];
  const bodyTermHits = new Set();
  const venueHits = new Set();

  for (const term of terms) {
    // A term whose every token is below the evidence floor is never used: the
    // regression tests in test/text.test.js encode the live misfires that rule
    // was bought with (教育 alone, a bare bigram alone).
    if (isWeakTerm(term)) continue;

    // Venue evidence is gathered FIRST and outside the content-field loop. It is
    // additive, so a term that only the venue satisfies must still be credited —
    // computing it after the `continue` below would silently drop it (bug found
    // by the venue regression test).
    if (fields.venue) {
      const venueRatio = termFieldScore(term, fields.venue).ratio;
      if (venueRatio >= 1) venueHits.add(term);
    }

    let best = 0;
    let bestField = '';
    let viaEquivalent = false;
    for (const [field, weight] of Object.entries(FIELD_WEIGHT)) {
      const { ratio } = termFieldScore(term, fields[field]);
      if (ratio === 0) continue;
      const fieldScore = weight * ratio;
      // Full coverage keeps its weight; a partial match is scaled down further so
      // one shared token cannot buy a whole term.
      const value = ratio >= 1 ? fieldScore : fieldScore - PARTIAL_PENALTY * (1 - ratio);
      if (value > best) {
        best = value;
        bestField = field;
        viaEquivalent = false;
      }
    }
    // Nothing literal matched: retry once through the equivalent table, at a
    // discount, so an abbreviation or spelling variant still counts.
    if (best <= 0) {
      for (const equivalent of equivalentsOf(term)) {
        for (const [field, weight] of Object.entries(FIELD_WEIGHT)) {
          const { ratio } = termFieldScore(equivalent, fields[field]);
          if (ratio < 1) continue;
          const value = weight * EQUIVALENT_DISCOUNT;
          if (value > best) {
            best = value;
            bestField = field;
            viaEquivalent = true;
          }
        }
      }
    }
    // A venue-only hit contributes its credit but no field score; it must not be
    // treated as a content match, which is why matchedTerms is only appended for
    // content hits and the venue is credited separately below.
    if (best <= 0) continue;
    score += best;
    matchedTerms.push(term);
    reasons.push(`${bestField}:${term}${viaEquivalent ? '≈' : '+'}${best.toFixed(1)}`);
    if (bestField === 'title' || bestField === 'abstract' || bestField === 'keywords') {
      bodyTermHits.add(term);
    }
  }

  for (const term of venueHits) {
    score += VENUE_WEIGHT + VENUE_BONUS;
    reasons.push(`venue:${term}+${(VENUE_WEIGHT + VENUE_BONUS).toFixed(1)}`);
  }

  const query = normTight(terms.join(''));
  if (query && tightTitle.includes(query)) {
    score += PHRASE_BONUS;
    reasons.push(`title:exact-phrase+${PHRASE_BONUS.toFixed(1)}`);
  }
  // Several distinct terms present, none in the title: topical, but say so and
  // keep the credit small so it can never rival a title hit.
  if (bodyTermHits.size >= 2 && !reasons.some((r) => r.startsWith('title:'))) {
    score += COOCCURRENCE_BONUS;
    reasons.push(`body-cooccurrence(${bodyTermHits.size})+${COOCCURRENCE_BONUS.toFixed(1)}`);
  }

  return {
    score: Number(score.toFixed(2)),
    accepted: score >= minScore,
    matchedTerms,
    reasons,
    fields: { title: Boolean(fields.title), abstract: Boolean(fields.abstract) },
  };
}

/**
 * Drop-in replacement for `matchesTopic`: same contract (array of hit terms, or
 * null), so every existing caller keeps working unchanged.
 *
 * @param {object} paper
 * @param {object} topic
 * @param {object} [options] `minScore`, plus anything the caller already passed
 * @returns {string[]|null}
 */
export function matchesTopicScored(paper, topic, options = {}) {
  const result = scoreTopicMatch(paper, topic, options);
  return result.accepted ? result.matchedTerms : null;
}
