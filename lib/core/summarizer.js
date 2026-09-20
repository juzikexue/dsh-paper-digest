/**
 * Chinese one-glance summaries.
 *
 * The digest's abstracts are long and often written in dense academic Chinese,
 * so each selected paper gets a 2–3 sentence plain-language Chinese summary
 * produced by the deployment's own configured model (read through
 * `agentDefaultModel.currentSelection()`), not by a separate API key.
 *
 * Notes on the design:
 *  - The model writes the summary; nothing here invents content. If the call
 *    fails, the paper simply keeps no summary and the reason is printed in the
 *    report's diagnostics — a failed summary never breaks the digest.
 *  - Summaries are generated for papers *in the digest only*, so a run costs a
 *    handful of short calls rather than one per candidate.
 *  - The prompt explicitly forbids adding information that is not in the title
 *    or abstract, because a plausible-but-invented "finding" is worse than no
 *    summary at all.
 */

/** How much abstract text to send. Long enough for methods, bounded for cost. */
const MAX_ABSTRACT_CHARS = 1800;

const SYSTEM_PROMPT = [
  '你是一位严谨的学术编辑，为中国研究者提炼论文要点。',
  '要求：',
  '1. 用简体中文写 2-3 句话，总长控制在 120 字以内；',
  '2. 依次说清：研究问题、所用方法或数据、主要结论；',
  '3. 只使用给定标题与摘要中的信息，绝对不要补充、推测或联想；',
  '4. 若摘要缺少方法或结论，就只概括已有的部分，不要编造；',
  '5. 直接输出总结正文，不要任何前缀、标题、引号或“本文”以外的客套语。',
].join('\n');

/** Compose the per-paper user prompt. */
export function buildSummaryPrompt(paper) {
  const parts = [`标题：${paper.title}`];
  if (paper.venue) parts.push(`出处：${paper.venue}`);
  if (paper.publishedDate) parts.push(`发表时间：${paper.publishedDate}`);
  if (paper.keywords?.length) parts.push(`关键词：${paper.keywords.slice(0, 8).join('、')}`);
  const abstract = String(paper.abstract ?? '').trim();
  parts.push(
    abstract
      ? `摘要：${abstract.slice(0, MAX_ABSTRACT_CHARS)}${abstract.length > MAX_ABSTRACT_CHARS ? '…' : ''}`
      : '摘要：（无摘要，请仅根据标题谨慎概括，并说明依据有限）',
  );
  return parts.join('\n');
}

/** Trim model noise: leading labels, wrapping quotes, stray whitespace. */
export function cleanSummary(text) {
  return String(text ?? '')
    .replace(/^\s*(总结|摘要|概括|中文总结)\s*[:：]\s*/i, '')
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * One streaming call, accumulating text deltas.
 * @returns {Promise<{text: string, finish: object|null, usage: object|null}>}
 */
async function callModel(llm, route, options) {
  const { prompt, system, maxTokens, timeoutMs, reasoningEffort } = options;
  const messages = [
    {
      // A plain user message; the id only has to be unique within this call.
      id: `paper-digest-summary-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      role: 'user',
      content: [{ type: 'text', text: prompt }],
      source: { kind: 'plugin', plugin: 'dsh-paper-digest' },
    },
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let text = '';
  let finish = null;
  let usage = null;
  let failure = '';
  try {
    const request = {
      provider: route.provider,
      model: route.model,
      messages,
      system,
      maxTokens,
      signal: controller.signal,
    };
    // Only send the effort when the user pinned one; otherwise inherit the
    // deployment's own default for this model.
    if (reasoningEffort) request.reasoningEffort = reasoningEffort;

    for await (const chunk of llm.stream(request)) {
      if (chunk?.type === 'text-delta') text += chunk.text;
      else if (chunk?.type === 'usage') usage = chunk.usage;
      else if (chunk?.type === 'finish') {
        finish = chunk.reason;
        if (chunk.reason?.kind === 'error') failure = chunk.reason.failure?.message ?? 'model error';
        else if (chunk.reason?.kind === 'aborted') failure = '调用被中断（可能超时）';
      }
    }
  } finally {
    clearTimeout(timer);
  }
  if (failure) throw new Error(failure);
  return { text, finish, usage };
}

/**
 * Why an empty result happened. A reasoning model can spend the whole output
 * budget on hidden reasoning and emit no text at all — that is exactly what
 * happened on the first live run (9 of 10 summaries empty with a 300-token
 * budget), and reporting only "empty" would have hidden the real cause.
 */
function emptyReason(result) {
  const kind = result?.finish?.kind ?? 'unknown';
  const reasoning = result?.usage?.reasoningTokens;
  const used = reasoning ? `（其中思考占用 ${reasoning} tokens）` : '';
  if (kind === 'max-tokens') return `模型输出被 maxTokens 截断${used}，未产出正文`;
  return `模型返回空内容（finish=${kind}${used}）`;
}

/**
 * Resolve which model to use: the explicit override first, then the
 * deployment's configured default.
 */
export function resolveRoute(agentDefaultModel, override = {}) {
  const explicitProvider = String(override.provider ?? '').trim();
  const explicitModel = String(override.model ?? '').trim();
  if (explicitProvider && explicitModel) return { provider: explicitProvider, model: explicitModel };
  try {
    const sel = agentDefaultModel?.currentSelection?.();
    if (sel?.provider && sel?.model) return { provider: sel.provider, model: sel.model };
  } catch {
    /* fall through to the failure below */
  }
  return null;
}

/**
 * One-off text completion through the same plumbing the summaries use.
 *
 * Exported for the keyword-gap analysis (`lib/core/suggest.js`), which needs a
 * single JSON-shaped answer rather than per-paper summaries — but the same route
 * resolution, streaming accumulation, timeout and empty-reply retry.
 *
 * @param {object} args `llm`, `agentDefaultModel`, `prompt`, `system`,
 *   `maxTokens`, `timeoutMs`, `reasoningEffort`, `override`
 * @returns {Promise<{ok: boolean, text: string, route: object|null, error: string}>}
 */
export async function completeOnce(args) {
  const { llm, agentDefaultModel, prompt, system, maxTokens, timeoutMs, reasoningEffort, override } = args;
  if (!llm || typeof llm.stream !== 'function') {
    return { ok: false, text: '', route: null, error: '宿主未提供 llm 服务' };
  }
  const route = resolveRoute(agentDefaultModel, override);
  if (!route) return { ok: false, text: '', route: null, error: '无法确定模型（未配置默认模型）' };

  const base = { prompt, system, maxTokens, timeoutMs, reasoningEffort };
  let attempt = await callModel(llm, route, base);
  if (String(attempt.text ?? '').trim()) {
    return { ok: true, text: attempt.text, route, error: '' };
  }
  // Same finding as the summaries: a thinking model can spend the whole budget
  // on reasoning and return no text, so retry once with more room.
  attempt = await callModel(llm, route, { ...base, maxTokens: Math.min(maxTokens * 2, 16000) });
  const text = String(attempt.text ?? '').trim();
  return text
    ? { ok: true, text, route, error: '' }
    : { ok: false, text: '', route, error: `模型返回空内容（finish=${attempt.finish?.type ?? 'unknown'}）` };
}

/**
 * Attach `summary` to every paper in the digest.
 *
 * Runs with a small concurrency so a 10-paper digest finishes quickly without
 * hammering the provider; each paper is isolated, so one failure never affects
 * the others.
 *
 * @returns {Promise<{ok: number, failed: number, skipped: number, route: object|null, errors: object[]}>}
 */
export async function summarizePapers(papers, options) {
  const { llm, agentDefaultModel, enabled, maxTokens, timeoutMs, concurrency, override, reasoningEffort } = options;
  const stats = { ok: 0, failed: 0, skipped: 0, route: null, errors: [], retried: 0 };

  if (!enabled) {
    stats.skipped = papers.length;
    stats.errors.push({ label: '中文总结', message: '已在设置中关闭' });
    return stats;
  }
  if (!llm || typeof llm.stream !== 'function') {
    stats.skipped = papers.length;
    stats.errors.push({ label: '中文总结', message: '宿主未提供 llm 服务' });
    return stats;
  }
  const route = resolveRoute(agentDefaultModel, override);
  if (!route) {
    stats.skipped = papers.length;
    stats.errors.push({ label: '中文总结', message: '无法确定模型（未配置默认模型）' });
    return stats;
  }
  stats.route = route;

  const base = { prompt: '', system: SYSTEM_PROMPT, maxTokens, timeoutMs, reasoningEffort };

  /** One paper: try, and if the model produced no text, retry once with more room. */
  async function summarizeOne(paper) {
    const prompt = buildSummaryPrompt(paper);
    let attempt = await callModel(llm, route, { ...base, prompt });
    let summary = cleanSummary(attempt.text);
    if (summary) return summary;

    // Empty output: a reasoning model most likely burned the budget thinking.
    // Retry once with double the allowance before giving up on this paper.
    const retryTokens = Math.min((maxTokens ?? 1500) * 2, 8000);
    if (retryTokens > (maxTokens ?? 0)) {
      stats.retried += 1;
      attempt = await callModel(llm, route, { ...base, prompt, maxTokens: retryTokens });
      summary = cleanSummary(attempt.text);
      if (summary) return summary;
    }
    throw new Error(emptyReason(attempt));
  }

  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency ?? 2, papers.length)) }, async () => {
    while (cursor < papers.length) {
      const index = cursor;
      cursor += 1;
      const paper = papers[index];
      try {
        paper.summary = await summarizeOne(paper);
        stats.ok += 1;
      } catch (error) {
        paper.summaryError = String(error?.message ?? error);
        stats.failed += 1;
        stats.errors.push({ label: paper.title.slice(0, 40), message: paper.summaryError });
      }
    }
  });
  await Promise.all(workers);
  return stats;
}
