/**
 * Suggestions for the keyword gap: what did the gate reject that arguably
 * belonged?
 *
 * The insight this is built on: a digest run already *fetched* the near-misses.
 * `collect.js` drops them at the relevance gate and they vanish. The pool is the
 * evidence, and it costs nothing extra to keep.
 *
 * Because the gate accepts at `score >= DEFAULT_MIN_SCORE`, every rejected paper
 * has a score strictly below it — "how close" is therefore a real measurement,
 * not a guess, and near-misses can be ranked exactly.
 *
 * The model is given that pool and asked for phrases that occur **in the
 * supplied text**, never for concepts from its own knowledge. A model that
 * invents `AI in education` would propose what the user already has; a model
 * that invents `prompt engineering` would propose something the corpus never
 * contained. Both are filtered here (`parseSuggestions`), and the per-phrase
 * coverage count is recomputed locally rather than trusted from the reply.
 */

/** Rejected candidates handed to the model. */
export const NEAR_MISS_LIMIT = 40;
/** Low-scoring rejects, shown so the model can see what "off topic" looks like. */
export const CONTROL_LIMIT = 10;
/** Hard cap on returned suggestions, so the panel never becomes a wall. */
export const MAX_SUGGESTIONS = 8;

/** Strip punctuation/spacing for containment checks. */
function tight(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[._\-–—:：,，;；!！?？'"“”‘’()（）[\]【】《》<>/\\|+*#~`^%$@=]/g, '');
}

/** Normalise a phrase for de-duplication against existing keywords. */
function keyOf(phrase) {
  return String(phrase ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Split the rejected pool into near-misses and controls.
 *
 * Ties are common and meaningful: several distinct wordings land on the same
 * fractional score (measured: 3.25 for a dozen different papers), so score alone
 * leaves the sample arbitrary. Recency breaks the tie — a near-miss from this
 * week is more actionable than one from two years ago.
 *
 * The pool repeats itself (the same paper arrives from OpenAlex and Crossref),
 * and a duplicate burns prompt tokens twice for no extra signal, so near-misses
 * are de-duplicated by normalised title first.
 *
 * @param {Array<{paper: object, topicId: string, topicName: string, score: number}>} rejected
 * @param {object} [options] `nearMissLimit`, `controlLimit`
 * @returns {{nearMisses: object[], controls: object[], topicId: string}}
 */
export function mineGap(rejected, options = {}) {
  const nearMissLimit = options.nearMissLimit ?? NEAR_MISS_LIMIT;
  const controlLimit = options.controlLimit ?? CONTROL_LIMIT;
  const pool = (rejected ?? []).filter((r) => r?.paper?.title);
  if (pool.length === 0) return { nearMisses: [], controls: [], topicId: '' };

  // One topic per analysis: the biggest pool wins, so the suggestions address the
  // topic with the most unexploited material rather than being diluted across all.
  const counts = new Map();
  for (const r of pool) counts.set(r.topicId, (counts.get(r.topicId) ?? 0) + 1);
  const topicId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  const seen = new Set();
  const own = [];
  for (const r of pool) {
    if (r.topicId !== topicId) continue;
    const title = String(r.paper.title).replace(/\s+/g, ' ').trim().toLowerCase();
    if (seen.has(title)) continue;
    seen.add(title);
    own.push(r);
  }

  const byScore = [...own].sort((a, b) => {
    const delta = (b.score ?? 0) - (a.score ?? 0);
    if (Math.abs(delta) > 0.001) return delta;
    return String(b.paper.publishedDate ?? '').localeCompare(String(a.paper.publishedDate ?? ''));
  });
  const nearMisses = byScore.slice(0, nearMissLimit);
  // Controls come from the bottom, and must not overlap the near-miss window.
  const controls = byScore.slice(-Math.min(controlLimit, Math.max(0, byScore.length - nearMissLimit)));

  return { nearMisses, controls, topicId };
}

/** One line per candidate for the prompt: title, venue, and an abstract excerpt. */
function describe(entry, index) {
  const p = entry.paper;
  const abstract = String(p.abstract ?? '').replace(/\s+/g, ' ').slice(0, 260);
  const bits = [
    `${index + 1}. 《${String(p.title ?? '').replace(/\s+/g, ' ')}》`,
    p.venue ? `   来源: ${p.venue}` : '',
    p.publishedDate ? `   日期: ${p.publishedDate}` : '',
    abstract ? `   摘要: ${abstract}` : '',
  ].filter(Boolean);
  return bits.join('\n');
}

/**
 * Build the extraction prompt. Deliberately closed: the only permitted source of
 * a phrase is the text below, and "找不到" is an accepted answer.
 *
 * @param {object} args `topic`, `nearMisses`, `controls`
 * @returns {string}
 */
export function buildSuggestPrompt({ topic, nearMisses, controls }) {
  const existing = [topic.zh, topic.en].filter(Boolean).join('; ');
  const near = (nearMisses ?? []).map(describe).join('\n');
  const off = (controls ?? []).map(describe).join('\n');

  return [
    `主题名称：${topic.name}`,
    `当前已配置的关键词：${existing || '（无）'}`,
    '',
    '下面 A 组是"检索抓到了、但被判为不相关而丢弃"的论文。它们不代表一定相关，',
    '只是最接近当前判据的一批。B 组是明显不相关的对照。',
    '',
    '你的任务：从 A 组的标题或摘要里，找出**当前关键词覆盖不到的、反复出现的表述**。',
    '',
    '硬性要求：',
    '1. 只能从下面 A 组的文字里摘取短语，逐字使用，不得改写、不得翻译、不得凭常识补充。',
    '2. 不得提出已配置关键词或其近似写法（含缩写与单复数）。',
    '3. 短语必须足够具体：中文至少 4 个字且不是通用词（如"教学""素养""技术"都不合格）；',
    '   英文至少两个词，且不能只是 "education"、"learning" 这类单词。',
    '4. 每个短语给出 estimatedCoverage：A 组中有几篇的标题或摘要里**逐字**出现了它。',
    '5. 如果 A 组里找不到符合要求的短语，就返回空数组。不要为了凑数而降低标准。',
    '',
    '只输出 JSON，不要解释、不要 Markdown 代码块：',
    '{"suggestions":[{"phrase":"...","lang":"zh|en","reason":"为什么它能把 A 组里哪些论文捞回来","estimatedCoverage":0}]}',
    '',
    '=== A 组（被丢弃、但最接近判据）===',
    near || '（空）',
    '',
    '=== B 组（明显不相关的对照，仅供你判断边界）===',
    off || '（空）',
  ].join('\n');
}

/** Pull the JSON object out of a model reply (tolerates code fences and prose). */
function extractJson(text) {
  const raw = String(text ?? '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Latin-only phrases are English suggestions; anything with CJK is Chinese. */
function detectLang(phrase) {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(phrase) ? 'zh' : 'en';
}

/** Whether a phrase is specific enough to be worth proposing. */
function isSpecific(phrase) {
  const value = String(phrase ?? '').trim();
  if (!value) return false;
  if (detectLang(value) === 'zh') {
    const han = value.replace(/[^\u4e00-\u9fff]/g, '');
    return han.length >= 4;
  }
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  return words.some((w) => w.length >= 4 && !/^(education|learning|teaching|students?|research)$/i.test(w));
}

/**
 * Validate a model reply into accepted suggestions.
 *
 * Every guard here exists because a model cannot be trusted with it:
 *   - a phrase not present verbatim in the supplied corpus is dropped;
 *   - a phrase already covered by the configured keywords is dropped;
 *   - `estimatedCoverage` is recomputed locally, never taken from the reply;
 *   - duplicates (case/spacing variants) collapse.
 *
 * @param {string} text raw model output
 * @param {object} args `topic`, `corpus` (array of {title, abstract})
 * @returns {object[]}
 */
export function parseSuggestions(text, { topic, corpus }) {
  const parsed = extractJson(text);
  if (!parsed || !Array.isArray(parsed.suggestions)) return [];

  const blobs = (corpus ?? []).map((p) => tight(`${p.title} ${p.abstract ?? ''}`));
  const existing = [topic?.zh, topic?.en]
    .filter(Boolean)
    .flatMap((s) => String(s).split(/[;；\n]+/))
    .map(keyOf)
    .filter(Boolean);

  const out = [];
  const seen = new Set();
  for (const item of parsed.suggestions) {
    const phrase = String(item?.phrase ?? '').trim().replace(/\s+/g, ' ');
    if (!phrase) continue;
    const key = keyOf(phrase);
    if (seen.has(key)) continue;
    if (!isSpecific(phrase)) continue;
    // Reject a phrase the user already has, including as a substring of one.
    if (existing.some((e) => e.includes(key) || key.includes(e))) continue;
    // The phrase must actually occur in the corpus it claims to describe.
    const tightPhrase = tight(phrase);
    const coverage = blobs.filter((b) => b.includes(tightPhrase)).length;
    if (coverage === 0) continue;
    seen.add(key);
    out.push({
      phrase,
      lang: item?.lang === 'zh' || item?.lang === 'en' ? item.lang : detectLang(phrase),
      reason: String(item?.reason ?? '').slice(0, 200),
      coverage,
      claimedCoverage: Number(item?.estimatedCoverage) || 0,
    });
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out.sort((a, b) => b.coverage - a.coverage);
}

/**
 * Merge freshly parsed suggestions with the stored state: adopted ones leave,
 * dismissed ones stay gone, and the rest are refreshed.
 *
 * @param {object} state previous suggestion state
 * @param {object[]} suggestions accepted suggestions from this run
 * @param {string} topicId
 * @returns {object} next state
 */
export function mergeSuggestions(state, suggestions, topicId) {
  const dismissed = new Set(state?.dismissed ?? []);
  const pending = (suggestions ?? []).filter((s) => !dismissed.has(keyOf(s.phrase)));
  return {
    generatedAt: new Date().toISOString(),
    topicId,
    suggestions: pending,
    dismissed: [...dismissed],
  };
}

export const __test = { tight, keyOf, isSpecific, detectLang, extractJson };

/* ------------------------------------------------- keywords from a topic name -- */

/**
 * The user types a topic name; the model proposes the keyword groups the user
 * would otherwise have to invent. An accepted proposal writes the same shape the
 * manual editor writes, so it is an ordinary keyword and not a second kind of
 * configuration.
 *
 * The model is asked for a **translation pair** per group rather than two
 * independent lists: a Chinese group and its English counterpart are the same
 * probe in two indexes, and generating them separately is how the two halves of a
 * topic drift apart.
 */

/** Cap per language, so a proposal never becomes a wall of chips. */
export const MAX_KEYWORD_GROUPS = 6;

/**
 * Build the prompt for keyword generation from a topic name.
 *
 * The specificity rules mirror `isSpecific` and the plugin's own warning: a bare
 * 2-character Chinese word pulls unrelated papers, and a one-word English probe
 * matches everything.
 *
 * @param {{name: string, hint?: string}} args
 * @returns {string}
 */
export function buildKeywordPrompt({ name, hint = '' }) {
  return [
    `研究主题：${name}`,
    hint ? `补充说明：${hint}` : '',
    '',
    '请为这个主题给出检索关键词组，中英对照。每个词组是同一个检索意图的中文写法与英文写法。',
    '',
    '硬性要求：',
    '1. 中文词组至少 4 个字，不能是"教育""教学""技术""研究""素养"这类通用词单独成组；',
    '   需要带限定语，例如"人工智能 教育"而不是"教育"。',
    '2. 英文词组至少两个词，不能只有一个单词，也不能是 education / learning / research 之类。',
    '3. 中英文必须是同一检索意图的对应写法，不是两个不同方向。',
    '4. 给出 4 到 6 组，覆盖该主题下最主要的两三个方向，不要凑数、不要同义重复。',
    '5. 不要解释、不要给建议、不要写检索式语法，只给词组本身。',
    '',
    '只输出 JSON，不要 Markdown 代码块：',
    '{"groups":[{"zh":"中文词组（多组用分号分隔）","en":"the matching english phrase"}]}',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Chinese keyword group: at least one 4+ character run of Han characters. */
function hasSpecificZh(value) {
  const runs = String(value ?? '')
    .split(/[\s;,，；、]+/)
    .filter(Boolean);
  return runs.some((run) => (run.match(/[\u4e00-\u9fff]/g) ?? []).length >= 4);
}

/** English keyword group: at least two words. */
function hasSpecificEn(value) {
  return String(value ?? '').trim().split(/\s+/).filter(Boolean).length >= 2;
}

/**
 * Validate a keyword-generation reply.
 *
 * Same posture as `parseSuggestions`: the model is not trusted. A group is kept
 * only when both halves are specific and non-empty, groups are de-duplicated, and
 * the list is capped.
 *
 * @param {string} text raw model output
 * @returns {Array<{zh: string, en: string}>}
 */
export function parseKeywordGroups(text) {
  const parsed = extractJson(text);
  if (!parsed || !Array.isArray(parsed.groups)) return [];
  const out = [];
  const seen = new Set();
  for (const item of parsed.groups) {
    const zh = String(item?.zh ?? '').trim().replace(/\s+/g, ' ');
    const en = String(item?.en ?? '').trim().replace(/\s+/g, ' ');
    if (!zh || !en) continue;
    if (!hasSpecificZh(zh) || !hasSpecificEn(en)) continue;
    const key = `${keyOf(zh)}|${keyOf(en)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ zh, en });
    if (out.length >= MAX_KEYWORD_GROUPS) break;
  }
  return out;
}

/**
 * Count how many records each proposed keyword actually retrieves.
 *
 * This is what makes a proposal checkable rather than merely plausible: a phrase
 * the model invented from general knowledge usually retrieves nothing, and one
 * that is too broad retrieves hundreds of thousands. Both are worth showing the
 * user before they accept it.
 *
 * A failed lookup is reported as `null`, never 0 — "could not check" and "returns
 * nothing" are different facts.
 *
 * @param {string[]} keywords
 * @param {{timeoutMs?: number, mailto?: string, limit?: number}} [options]
 * @returns {Promise<Map<string, number|null>>}
 */
export async function checkKeywordCoverage(keywords, options = {}) {
  const timeoutMs = options.timeoutMs ?? 20000;
  const mailto = options.mailto ?? 'dsh-paper-digest@localhost';
  const limit = options.limit ?? MAX_KEYWORD_GROUPS;
  const out = new Map();
  for (const keyword of (keywords ?? []).slice(0, limit)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const params = new URLSearchParams({
        filter: `type:article,title.search:${keyword}`,
        'per-page': '1',
        mailto,
      });
      const res = await fetch(`https://api.openalex.org/works?${params.toString()}`, {
        signal: controller.signal,
      });
      if (!res.ok) {
        out.set(keyword, null);
        continue;
      }
      const json = await res.json();
      out.set(keyword, Number(json?.meta?.count ?? 0));
    } catch {
      out.set(keyword, null);
    } finally {
      clearTimeout(timer);
    }
  }
  return out;
}

/** Human-readable verdict shown on a proposal chip. */
export function coverageVerdict(count) {
  if (count === null || count === undefined) return '未能核验';
  if (count === 0) return '检索不到结果';
  if (count > 200000) return `命中 ${count} 条（过宽）`;
  return `命中 ${count} 条`;
}
