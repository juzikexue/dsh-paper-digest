/**
 * Markdown rendering for the daily digest.
 *
 * One file per day, grouped by topic (user's choice). Each entry shows the
 * bibliographic basics, the abstract, a link, and — importantly — why it was
 * selected, including the score breakdown, so the ranking is auditable.
 */
import { truncate } from './text.js';

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Markdown link target for a local path: a file:// URL opens the PDF directly. */
function fileUrl(path) {
  const normalised = String(path).replace(/\\/g, '/');
  return encodeURI(`file:///${normalised.replace(/^\/+/, '')}`);
}

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function fileStamp(date = new Date()) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

export function digestFileName(date = new Date()) {
  return `${fileStamp(date)}-论文日报.md`;
}

function citation(paper) {
  const bits = [];
  if (paper.venue) bits.push(paper.venue);
  if (paper.publishedDate) bits.push(paper.publishedDate);
  if (paper.volume) bits.push(`第${paper.volume}卷`);
  if (paper.issue) bits.push(`第${paper.issue}期`);
  if (paper.pages) bits.push(`页 ${paper.pages}`);
  return bits.join('，');
}

function trackBadge(paper) {
  return paper.track === 'zh' ? '中文' : '英文';
}

function venueNote(paper) {
  if (paper.coreTag) return `🏅 核心期刊（${paper.coreTag}）`;
  if (paper.isCore) return '🏅 核心库收录期刊';
  if (paper.acceptedAt) return `✅ 已被 ${paper.acceptedAt} 录用`;
  if (paper.preprint) return '📄 预印本（未经同行评审）';
  if (paper.venueType === 'journal') return '同行评审期刊';
  return '来源未标注评审状态';
}

function entry(paper, index) {
  const lines = [];
  lines.push(`### ${index}. ${paper.title}`);
  lines.push('');
  const meta = [];
  if (paper.authors?.length) {
    const shown = paper.authors.slice(0, 6).join('、');
    meta.push(`**作者**：${shown}${paper.authors.length > 6 ? ' 等' : ''}`);
  }
  if (citation(paper)) meta.push(`**出处**：${citation(paper)}`);
  meta.push(`**语言**：${trackBadge(paper)}　**来源**：${paper.sourceLabel}${paper.topicName ? `　**主题**：${paper.topicName}` : ''}`);
  meta.push(`**质量评分**：${paper.score}/100　${venueNote(paper)}`);
  if (paper.matchedTerms?.length) {
    meta.push(`**命中关键词**：${paper.matchedTerms.map((t) => `「${t}」`).join('、')}`);
  }
  if (paper.reasons?.length) meta.push(`**入选理由**：${paper.reasons.join('；')}`);
  if (paper.breakdown) {
    const b = paper.breakdown;
    meta.push(
      `**评分构成**：期刊档次 ${b.venue} · 内容证据 ${b.content} · 时效 ${b.recency} · 数据开放 ${b.data} · 社区关注 ${b.community} · 作者机构 ${b.author}`,
    );
  }
  lines.push(meta.join('  \n'));
  lines.push('');
  // The one-glance Chinese summary leads; the original abstract is kept below,
  // collapsed, so a questionable summary can always be checked against source.
  if (paper.summary) {
    lines.push(`**📌 一句话速览**：${paper.summary}`);
    lines.push('');
  } else if (paper.summaryError) {
    lines.push(`<sub>中文速览生成失败：${paper.summaryError}</sub>`);
    lines.push('');
  }
  if (paper.abstract) {
    lines.push('<details><summary>原文摘要</summary>');
    lines.push('');
    lines.push(`> ${truncate(paper.abstract, 500).replace(/\n+/g, ' ')}`);
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }
  const links = [];
  if (paper.pdfPath) {
    // A downloaded open-access copy: point at the local file, which is the most
    // useful thing to click, and keep the source link beside it.
    links.push(`📄 **[本地全文](${fileUrl(paper.pdfPath)})**${paper.pdfBytes ? `（${formatBytes(paper.pdfBytes)}）` : ''}`);
  } else if (paper.pdfUrl && paper.isOpenAccess) {
    links.push(`📄 [开放获取 PDF](${paper.pdfUrl})`);
  }
  if (paper.url) links.push(`[原文/详情](${paper.url})`);
  if (paper.doi) links.push(`DOI: \`${paper.doi}\``);
  if (paper.issn) links.push(`ISSN: ${paper.issn}`);
  if (links.length) lines.push(links.join('　|　'));
  if (paper.pdfError) lines.push(`<sub>全文未获取：${paper.pdfError}</sub>`);
  lines.push('');
  lines.push('---');
  lines.push('');
  return lines.join('\n');
}

/**
 * @param {{groups: {topic: object, papers: object[]}[], stats: object[], errors: object[], totals: object}} digest
 * @param {object} cfg
 * @param {Date} now
 */
export function renderMarkdown(digest, cfg, now = new Date()) {
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const out = [];

  out.push(`# 论文日报 · ${dateStr}`);
  out.push('');
  const pdfNote = digest.totals.pdf ? `　|　已下载开放获取全文 ${digest.totals.pdf} 篇` : '';
  out.push(
    `> 生成时间 ${timeStr}　|　共 ${digest.totals.selected} 篇（中文 ${digest.totals.zh} · 英文 ${digest.totals.en}）　|　回溯 ${cfg.lookbackDays} 天　|　候选 ${digest.totals.candidates} 篇${pdfNote}`,
  );
  out.push('');

  if (digest.totals.selected === 0) {
    out.push('## ⚠️ 本次没有选出论文');
    out.push('');
    out.push('可能原因：所有数据源都失败，或主题关键词过窄。请在设置页检查主题关键词，并查看下方「运行诊断」。');
    out.push('');
  } else {
    out.push('## 目录');
    out.push('');
    for (const group of digest.groups) {
      out.push(`- **${group.topic.name}**（${group.papers.length} 篇）：${group.papers.map((p) => p.title).join('；')}`);
    }
    out.push('');
  }

  for (const group of digest.groups) {
    out.push(`## ${group.topic.name}`);
    out.push('');
    group.papers.forEach((paper, i) => {
      out.push(entry(paper, i + 1));
    });
  }

  // Diagnostics — the honest, auditable part of the report.
  out.push('## 运行诊断');
  out.push('');
  out.push('### 数据源');
  out.push('');
  out.push('| 数据源 | 抓取 | 入库 |');
  out.push('| --- | ---: | ---: |');
  for (const s of digest.stats) {
    out.push(`| ${s.label} | ${s.fetched} | ${s.kept} |`);
  }
  if (digest.errors.length) {
    out.push('');
    out.push('### 失败的数据源');
    out.push('');
    for (const e of digest.errors) {
      out.push(`- **${e.label}**：${e.message}`);
    }
  }
  out.push('');
  out.push('### 筛选统计');
  out.push('');
  out.push(
    `- 候选 ${digest.totals.candidates} 篇 → 硬性过滤（撤稿/缺字段/超期）剔除 ${digest.totals.droppedByGate} 篇 → 跨源去重 ${digest.totals.duplicates} 篇 → 参与打分 ${digest.totals.scored} 篇 → 入选 ${digest.totals.selected} 篇`,
  );
  out.push('');
  out.push('### 全文获取');
  out.push('');
  if (digest.fullText) {
    const ft = digest.fullText;
    out.push(
      `- 已下载 ${ft.downloaded ?? 0} 篇开放获取全文` +
        (ft.bytes ? `（合计 ${formatBytes(ft.bytes)}）` : '') +
        `，未获取 ${ft.failed ?? 0} 篇，无需获取 ${ft.skipped ?? 0} 篇`,
    );
  } else {
    out.push('- 本次未执行全文下载（已在设置中关闭）');
  }
  out.push('');
  out.push(
    '> 只下载**开放获取**全文（arXiv、PubMed Central、出版商的 OA 版本）。' +
      '中文订阅库（知网/万方/维普）不抓取全文，仅给出详情页链接——批量下载违反其服务条款，' +
      '且校园网 IP 被风控会影响全校。',
  );
  out.push('');
  out.push('### 中文速览');
  out.push('');
  if (digest.summaries) {
    const s = digest.summaries;
    const route = s.route ? `${s.route.provider} / ${s.route.model}` : '未确定';
    out.push(
      `- 生成 ${s.ok ?? 0} 篇，失败 ${s.failed ?? 0} 篇，跳过 ${s.skipped ?? 0} 篇（模型：${route}）` +
        (s.retried ? `；其中 ${s.retried} 篇首次输出为空、已自动加大预算重试` : ''),
    );
    if (s.errors?.length) {
      out.push(`- 明细：${s.errors.slice(0, 5).map((e) => `${e.label}（${e.message}）`).join('；')}`);
    }
  } else {
    out.push('- 本次未生成中文速览');
  }
  out.push('');
  out.push(
    '> 速览由本机已配置的模型根据**标题与摘要**生成，可能存在归纳偏差；' +
      '原文摘要保留在每篇下方（可展开）以便核对。',
  );
  out.push('');
  out.push('### 日报会话');
  out.push('');
  if (digest.session) {
    const s = digest.session;
    if (s.ok) {
      out.push(
        `- 已创建会话 \`${s.sessionId}\`${s.preset ? `（预设 ${s.preset}）` : ''}` +
          `${s.titled ? '' : '，标题未能设置'}，可在左侧会话列表中直接打开`,
      );
      if (s.workspace) out.push(`- 已挂到工作区：${s.workspace}`);
      if (s.workspaceError) out.push(`- 注意：未能加入工作区（${s.workspaceError}），会话本身可用`);
    } else {
      out.push(`- 未创建会话：${s.reason ?? '未知原因'}`);
    }
  } else {
    out.push('- 本次未创建会话');
  }
  out.push('');
  out.push('### 评分口径');
  out.push('');
  out.push(
    '总分 = （期刊档次 30 + 内容证据 25 + 时效 15 + 数据开放 10 + 社区关注 10 + 作者机构 10）× 主题相关度系数。' +
      '新发表论文尚无引用，社区关注分天然接近 0，因此排序主要看期刊档次与内容证据；' +
      '撤稿记录、缺失标题/链接、超出回溯窗口的条目在打分前即被剔除。',
  );
  out.push('');
  out.push(`*由 dsh-paper-digest 插件生成 · 数据源：${Object.entries(cfg.sources).filter(([, v]) => v).map(([k]) => k).join(', ')}*`);
  out.push('');

  return out.join('\n');
}
