/**
 * "论文日报" settings page.
 *
 * Plain React.createElement (the client half is bundled, not compiled from
 * JSX). All class names are namespaced `dshpd-`; colors come from theme CSS
 * variables with light/dark fallbacks defined in index.js.
 */
import React from 'react';

export const PANEL_CSS = `
  .dshpd-panel { max-width: 560px; padding: 2px 0 14px; color: inherit; }
  .dshpd-panel, .dshpd-panel button, .dshpd-panel input, .dshpd-panel textarea, .dshpd-panel select {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
      "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif;
  }
  .dshpd-group { margin-top: 16px; }
  .dshpd-group-label {
    margin: 0 0 7px 1px; font-size: 12px; font-weight: 620; color: var(--dshpd-text-3);
  }
  .dshpd-card {
    background: var(--dshpd-card); border: 1px solid var(--dshpd-hairline);
    border-radius: 12px; overflow: hidden;
  }
  .dshpd-row { display: flex; align-items: center; gap: 12px; padding: 12px 14px; min-height: 50px; }
  .dshpd-row + .dshpd-row { border-top: 1px solid var(--dshpd-hairline); }
  .dshpd-col { display: block; padding: 12px 14px; }
  .dshpd-col + .dshpd-col { border-top: 1px solid var(--dshpd-hairline); }
  .dshpd-rbody { flex: 1 1 auto; min-width: 0; }
  .dshpd-rlabel { font-size: 13.5px; font-weight: 550; line-height: 1.4; }
  .dshpd-rdesc { font-size: 11.5px; color: var(--dshpd-text-2); line-height: 1.5; margin-top: 2px; }
  .dshpd-rctrl { flex: 0 0 auto; display: flex; align-items: center; gap: 7px; }

  .dshpd-field {
    width: 100%; min-width: 0; padding: 7px 10px; font-size: 12.5px; color: inherit;
    background: var(--dshpd-card); border: 1px solid var(--dshpd-border); border-radius: 7px;
    transition: border-color .15s ease, box-shadow .15s ease;
  }
  .dshpd-field:focus {
    outline: none; border-color: var(--dshpd-accent);
    box-shadow: 0 0 0 3px var(--dshpd-accent-1);
  }
  .dshpd-field-mono { font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; }
  .dshpd-time { width: 104px; }
  .dshpd-num { width: 74px; }
  textarea.dshpd-field { resize: vertical; min-height: 52px; line-height: 1.5; }
  .dshpd-rowfields { display: flex; gap: 8px; align-items: center; }
  .dshpd-rowfields > .dshpd-grow { flex: 1 1 auto; min-width: 0; }

  .dshpd-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 5px;
    border: 1px solid transparent; border-radius: 8px; font-size: 12.5px; font-weight: 600;
    line-height: 1; padding: 8px 13px; cursor: pointer; white-space: nowrap;
    transition: background-color .15s ease, border-color .15s ease, color .15s ease, transform .1s ease;
  }
  .dshpd-btn:active { transform: scale(.97); }
  .dshpd-btn[disabled] { opacity: .55; cursor: default; transform: none; }
  .dshpd-btn-primary { background: var(--dshpd-btn-bg); color: var(--dshpd-btn-fg); }
  .dshpd-btn-ghost { background: transparent; color: inherit; border-color: var(--dshpd-border); }
  .dshpd-btn-sm { padding: 6.5px 11px; font-size: 12px; border-radius: 7px; }
  @media (hover: hover) {
    .dshpd-btn-primary:hover { background: var(--dshpd-btn-hover); }
    .dshpd-btn-ghost:hover { background: var(--dshpd-surface); border-color: var(--dshpd-text-3); }
  }

  .dshpd-toggle {
    position: relative; width: 38px; height: 22px; flex: 0 0 38px; border-radius: 11px;
    border: none; padding: 0; cursor: pointer; background: var(--dshpd-track);
    box-shadow: inset 0 0 0 1px var(--dshpd-border); transition: background-color .18s ease;
  }
  .dshpd-toggle::after {
    content: ''; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px;
    border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.24);
    transition: transform .22s cubic-bezier(.3,1.25,.4,1);
  }
  .dshpd-toggle[aria-checked='true'] { background: var(--dshpd-accent); box-shadow: none; }
  .dshpd-toggle[aria-checked='true']::after { transform: translateX(16px); }

  .dshpd-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .dshpd-chip {
    display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--dshpd-border);
    border-radius: 7px; background: transparent; color: var(--dshpd-text-2); font-size: 11.5px;
    font-weight: 540; padding: 5px 9px; cursor: pointer; line-height: 1.4; transition: all .15s ease;
  }
  .dshpd-chip[aria-pressed='true'] { color: var(--dshpd-accent); border-color: var(--dshpd-accent-2); background: var(--dshpd-accent-1); }
  @media (hover: hover) { .dshpd-chip:hover { border-color: var(--dshpd-text-3); color: var(--dshpd-text); } }

  /* A proposal waiting for a decision: dashed and dimmer than an applied keyword. */
  .dshpd-chip-suggest {
    border-style: dashed; color: var(--dshpd-text-2); cursor: pointer;
  }
  .dshpd-chip-suggest[aria-pressed='true'] { border-style: solid; }
  /* An applied keyword: solid, with an explicit remove affordance. */
  .dshpd-chip-on { color: var(--dshpd-text); border-color: var(--dshpd-text-3); background: transparent; cursor: default; }
  .dshpd-chip-x {
    border: 0; background: transparent; color: var(--dshpd-text-3); cursor: pointer;
    font-size: 13px; line-height: 1; padding: 0 0 0 2px;
  }
  @media (hover: hover) { .dshpd-chip-x:hover { color: var(--dshpd-err); } }
  .dshpd-chip-count { color: var(--dshpd-text-3); font-weight: 500; }
  .dshpd-kwadd { display: flex; gap: 6px; margin-top: 6px; }
  .dshpd-kwadd input { flex: 1 1 auto; min-width: 0; }

  .dshpd-status { font-size: 11.5px; line-height: 1.6; color: var(--dshpd-text-2); }
  .dshpd-status b { color: var(--dshpd-text); font-weight: 600; }
  .dshpd-status .dshpd-ok { color: var(--dshpd-ok); }
  .dshpd-status .dshpd-err { color: var(--dshpd-err); }
  .dshpd-path {
    font-family: ui-monospace, Consolas, monospace; font-size: 11px;
    word-break: break-all; color: var(--dshpd-text);
  }
  .dshpd-topic-head { display: flex; align-items: center; gap: 8px; }
  .dshpd-topic-head .dshpd-grow { flex: 1 1 auto; min-width: 0; }
  .dshpd-kwlabel { font-size: 11px; color: var(--dshpd-text-3); margin: 8px 0 3px; }
  .dshpd-spinner {
    width: 11px; height: 11px; border-radius: 50%; display: inline-block; vertical-align: -1px;
    border: 2px solid var(--dshpd-track); border-top-color: var(--dshpd-accent);
    animation: dshpd-spin .7s linear infinite; margin-right: 6px;
  }
  @keyframes dshpd-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    .dshpd-panel * { transition: none !important; animation: none !important; }
  }
`;

const SOURCE_LABELS = {
  cnkiRss: 'CNKI 期刊 RSS（中文主力）',
  chinaXiv: 'ChinaXiv 预印本（中文）',
  europePmcZh: 'Europe PMC 中文（仅医学）',
  ncpssd: 'NCPSSD（实验性）',
  openalex: 'OpenAlex（英文·含核心库标记）',
  crossref: 'Crossref（英文）',
  arxiv: 'arXiv（英文·含录用信息）',
};

const TRACK_SOURCES = {
  zh: ['cnkiRss', 'chinaXiv', 'europePmcZh', 'ncpssd'],
  en: ['openalex', 'crossref', 'arxiv'],
};

function Toggle(props) {
  return React.createElement('button', {
    type: 'button',
    role: 'switch',
    className: 'dshpd-toggle',
    'aria-checked': !!props.checked,
    'aria-label': props.label,
    onClick: () => props.onChange(!props.checked),
  });
}

function newTopicId(topics) {
  let i = topics.length + 1;
  const taken = new Set(topics.map((t) => t.id));
  while (taken.has(`t${i}`)) i += 1;
  return `t${i}`;
}

/** "12 秒" / "1 分 05 秒" — elapsed time reads better than a start timestamp. */
function formatElapsed(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes} 分 ${String(seconds).padStart(2, '0')} 秒` : `${seconds} 秒`;
}

export function PaperDigestPanel(props) {
  const store = props.store;
  const [cfg, setCfg] = React.useState(() => store.get() || null);
  const [status, setStatus] = React.useState(() => store.getStatus() || null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [showCore, setShowCore] = React.useState(false);
  const [coreText, setCoreText] = React.useState('');
  const [coreFile, setCoreFile] = React.useState('');

  // Keyword-gap suggestions: proposals mined from the last run's rejected pool.
  const [suggestions, setSuggestions] = React.useState([]);
  const [suggestPoolSize, setSuggestPoolSize] = React.useState(0);
  const [suggestionTopicId, setSuggestionTopicId] = React.useState('');
  const [analysing, setAnalysing] = React.useState(false);
  const [suggestMsg, setSuggestMsg] = React.useState('');
  const [manualKw, setManualKw] = React.useState({});
  // Keyword groups proposed from a topic name, keyed by topic index, plus the
  // per-topic "generating" flag so one topic's spinner is not another's.
  const [kwProposals, setKwProposals] = React.useState({});
  const [generating, setGenerating] = React.useState({});
  const [genMsg, setGenMsg] = React.useState({});

  React.useEffect(() => {
    return store.subscribe(() => {
      setCfg(store.get() ? { ...store.get() } : null);
      setStatus(store.getStatus() ? { ...store.getStatus() } : null);
    });
  }, [store]);

  React.useEffect(() => {
    store.load();
    // Suggestions are advisory and survive page reloads; fetch once on mount.
    store.loadSuggestions().then((data) => {
      setSuggestions((data?.state?.suggestions) ?? []);
      setSuggestPoolSize(data?.poolSize ?? 0);
      setSuggestionTopicId((data?.state?.topicId) ?? '');
    });
  }, [store]);

  // Never leave a poll running after the panel goes away.
  React.useEffect(
    () => () => {
      if (runPollRef.current) clearInterval(runPollRef.current);
    },
    [],
  );

  // Which run this panel is tracking, and how it started. Shared by the button
  // (which starts one) and by the mount-time discovery below (which finds one
  // already in flight) — that sharing is the point: previously only a click
  // started polling, so the scheduler's boot catch-up stayed invisible.
  const runPollRef = React.useRef(null);

  // Poll until the host reports the run finished, then report the outcome. One
  // code path for both ways a run becomes visible: a click here, or a run the
  // host had already started.
  function startStatusPoll() {
    if (runPollRef.current) return;
    let ticks = 0;
    runPollRef.current = setInterval(() => {
      ticks += 1;
      store.refreshStatus().then((s) => {
        if (!((s && !s.running) || ticks > 120)) return;
        clearInterval(runPollRef.current);
        runPollRef.current = null;
        setBusy(false);
        if (s && s.lastRun) {
          setMessage(
            s.lastRun.ok
              ? `完成：${s.lastRun.totals.selected} 篇，已写入 ${s.lastRun.file}`
              : '完成但未选出论文，请查看下方诊断',
          );
        } else {
          setMessage('运行结束');
        }
      });
    }, 2500);
  }

  // A daily run is triggered host-side (the scheduler's boot catch-up fires 8s
  // after the plugin loads and can hold its lock for minutes). Nothing told the
  // panel, so the button looked idle and the first click came back as a refusal.
  // Adopt any in-flight run instead, and show which one it is.
  React.useEffect(() => {
    if (!status || !status.running) return;
    setBusy(true);
    if (runPollRef.current) return;
    const run = status.currentRun;
    setMessage(
      run
        ? `已有一次${run.trigger === 'schedule' ? '定时补跑' : ''}运行在进行中，正在跟踪…`
        : '已有一次运行在进行中，正在跟踪…',
    );
    startStatusPoll();
  }, [store, status && status.running]);

  if (!cfg) {
    return React.createElement(
      'div',
      { className: 'dshpd-panel' },
      React.createElement('div', { className: 'dshpd-group-label' }, '论文日报'),
      React.createElement('div', { className: 'dshpd-rdesc' }, '配置加载中…'),
    );
  }

  function patch(next) {
    store.save(next);
  }

  function setTopic(index, field, value) {
    const topics = cfg.topics.map((t, i) => (i === index ? { ...t, [field]: value } : t));
    patch({ topics });
  }

  function addTopic() {
    const topics = cfg.topics.concat([{ id: newTopicId(cfg.topics), name: '新主题', zh: '', en: '' }]);
    patch({ topics });
  }

  function removeTopic(index) {
    patch({ topics: cfg.topics.filter((_, i) => i !== index) });
  }

  function setJournal(index, field, value) {
    const journals = cfg.journals.map((j, i) => (i === index ? { ...j, [field]: value } : j));
    patch({ journals });
  }

  function addJournal() {
    patch({ journals: cfg.journals.concat([{ id: '', name: '', topicId: '' }]) });
  }

  function removeJournal(index) {
    patch({ journals: cfg.journals.filter((_, i) => i !== index) });
  }

  function setSource(key, value) {
    patch({ sources: { ...cfg.sources, [key]: value } });
  }

  function setMix(field, value) {
    const n = Math.max(0, Math.min(cfg.dailyCount, Math.round(Number(value) || 0)));
    const other = field === 'zh' ? cfg.dailyCount - n : cfg.dailyCount - n;
    const mix = field === 'zh' ? { zh: n, en: other } : { en: n, zh: other };
    patch({ mix });
  }

  function setDailyCount(value) {
    const n = Math.max(1, Math.min(50, Math.round(Number(value) || 10)));
    const zh = Math.min(cfg.mix.zh, n);
    patch({ dailyCount: n, mix: { zh, en: Math.max(0, n - zh) } });
  }

  function runNow() {
    setBusy(true);
    setMessage('已提交，正在检索多个数据源…');
    store.runNow().then((res) => {
      if (!res.data || res.data.ok === false) {
        setBusy(false);
        setMessage(`启动失败：${(res.data && res.data.error) || '未知错误'}`);
        return;
      }
      // The host reports which run the click joined. It is never a new one when
      // a daily run is already in flight, and saying so beats pretending.
      setMessage(
        res.data.alreadyRunning
          ? res.data.message || '已有一次运行在进行中，正在跟踪这一次运行'
          : '运行中，完成后会写入工作区（可离开本页）',
      );
      startStatusPoll();
    });
  }

  /**
   * Split a topic's keyword string into chip-sized entries.
   *
   * The separator is `;` only — inside an entry a comma lists synonyms and a
   * space means OR (Chinese) or AND (English), so a comma must never split here.
   */
  function kwEntries(text) {
    return String(text ?? '')
      .split(/[;；\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function setKeywords(topicIndex, field, entries) {
    setTopic(topicIndex, field, entries.join('; '));
  }

  function addKeyword(topicIndex, field) {
    const key = `${topicIndex}:${field}`;
    const value = String(manualKw[key] ?? '').trim();
    if (!value) return;
    const topic = cfg.topics[topicIndex];
    const entries = kwEntries(topic[field]);
    // A multi-group paste is allowed:分号 is the entry separator, so split it too.
    const added = value.split(/[;；]+/).map((s) => s.trim()).filter(Boolean);
    const next = [...entries];
    for (const item of added) if (!next.includes(item)) next.push(item);
    setKeywords(topicIndex, field, next);
    setManualKw((prev) => ({ ...prev, [key]: '' }));
  }

  function removeKeyword(topicIndex, field, entry) {
    const entries = kwEntries(cfg.topics[topicIndex][field]).filter((e) => e !== entry);
    setKeywords(topicIndex, field, entries);
  }

  /**
   * Adopt a proposal: append it to the matching topic's keyword string. An
   * accepted chip becomes a normal keyword, editable and removable like any
   * other — the suggestion store is not a second source of truth.
   */
  function adoptSuggestion(suggestion) {
    const index = cfg.topics.findIndex((t) => t.id === suggestionTopicId);
    const topicIndex = index >= 0 ? index : 0;
    const topic = cfg.topics[topicIndex];
    if (!topic) return;
    const field = suggestion.lang === 'en' ? 'en' : 'zh';
    const entries = kwEntries(topic[field]);
    if (!entries.includes(suggestion.phrase)) entries.push(suggestion.phrase);
    setKeywords(topicIndex, field, entries);
    setSuggestions((prev) => prev.filter((s) => s.phrase !== suggestion.phrase));
    setSuggestMsg(`已加入「${topic.name}」的${field === 'en' ? '英文' : '中文'}关键词`);
  }

  function dismissSuggestion(phrase) {
    setSuggestions((prev) => prev.filter((s) => s.phrase !== phrase));
    store.dismissSuggestion(phrase).then((res) => {
      if (res && res.ok === false) setSuggestMsg(`丢弃记录保存失败：${res.error || '未知错误'}`);
    });
  }

  function analyseGap() {
    setAnalysing(true);
    setSuggestMsg('正在用模型分析被过滤掉的候选…');
    store.analyseSuggestions().then((res) => {
      setAnalysing(false);
      const data = res?.data ?? {};
      if (!data.ok) {
        setSuggestMsg(data.error || '分析失败');
        if (data.poolSize !== undefined) setSuggestPoolSize(data.poolSize);
        return;
      }
      setSuggestions(data.state?.suggestions ?? []);
      setSuggestPoolSize(data.poolSize ?? 0);
      setSuggestionTopicId(data.topic?.id ?? '');
      const n = (data.state?.suggestions ?? []).length;
      setSuggestMsg(
        n === 0
          ? `分析完成：从 ${data.nearMissCount ?? 0} 条接近判据的论文里没找到符合要求的表述（这本身是个结论）`
          : `分析完成：${n} 条建议，来自 ${data.nearMissCount ?? 0} 条接近判据的论文`,
      );
    });
  }

  /**
   * Ask the model for keyword groups matching this topic's name.
   *
   * Unlike the gap analysis this needs no prior run — it works on a name the user
   * just typed. Each proposal is returned with a coverage count from OpenAlex, so
   * a phrase the model invented can be told apart from one that actually
   * retrieves papers before it is accepted.
   */
  function generateForTopic(topic, index) {
    const name = String(topic.name ?? '').trim();
    if (!name) {
      setGenMsg((prev) => ({ ...prev, [index]: '请先填写主题名' }));
      return;
    }
    setGenerating((prev) => ({ ...prev, [index]: true }));
    setGenMsg((prev) => ({ ...prev, [index]: '正在生成关键词…' }));
    store.generateKeywords(topic.id, name).then((res) => {
      setGenerating((prev) => ({ ...prev, [index]: false }));
      const data = res?.data ?? {};
      if (!data.ok) {
        setGenMsg((prev) => ({ ...prev, [index]: data.error || '生成失败' }));
        return;
      }
      const groups = data.groups ?? [];
      setKwProposals((prev) => ({ ...prev, [index]: groups }));
      setGenMsg((prev) => ({
        ...prev,
        [index]: groups.length
          ? `${groups.length} 组建议，点击采纳（会同时写入中英文关键词）`
          : '模型没有给出符合要求的词组，可换个更具体的主题名再试',
      }));
    });
  }

  /** Adopt one proposed group: write both halves into the topic's keywords. */
  function adoptKeywordGroup(index, group) {
    const topic = cfg.topics[index];
    if (!topic) return;
    const zhEntries = kwEntries(topic.zh);
    const enEntries = kwEntries(topic.en);
    for (const part of String(group.zh).split(/[;；]+/).map((s) => s.trim()).filter(Boolean)) {
      if (!zhEntries.includes(part)) zhEntries.push(part);
    }
    for (const part of String(group.en).split(/[;；]+/).map((s) => s.trim()).filter(Boolean)) {
      if (!enEntries.includes(part)) enEntries.push(part);
    }
    const topics = cfg.topics.map((t, i) =>
      i === index ? { ...t, zh: zhEntries.join('; '), en: enEntries.join('; ') } : t,
    );
    patch({ topics });
    setKwProposals((prev) => ({
      ...prev,
      [index]: (prev[index] ?? []).filter((g) => g.zh !== group.zh || g.en !== group.en),
    }));
  }

  /** Applied keywords as removable chips, plus a free-form add box. */
  const keywordEditor = (topic, index, field, label, placeholder) => {
    const entries = kwEntries(topic[field]);
    const key = `${index}:${field}`;
    return React.createElement(
      'div',
      null,
      React.createElement(
        'div',
        { className: 'dshpd-kwlabel' },
        `${label}（${entries.length}）· 空格=或，逗号=同义词，分号=分组`,
      ),
      entries.length
        ? React.createElement(
            'div',
            { className: 'dshpd-chips' },
            entries.map((entry) =>
              React.createElement(
                'span',
                { className: 'dshpd-chip dshpd-chip-on', key: entry },
                entry,
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'dshpd-chip-x',
                    title: '删除这个关键词',
                    'aria-label': `删除关键词 ${entry}`,
                    onClick: () => removeKeyword(index, field, entry),
                  },
                  '×',
                ),
              ),
            ),
          )
        : React.createElement('div', { className: 'dshpd-status' }, '（还没有关键词，下面直接输入即可）'),
      React.createElement(
        'div',
        { className: 'dshpd-kwadd' },
        React.createElement('input', {
          type: 'text',
          className: 'dshpd-field',
          value: manualKw[key] ?? '',
          placeholder,
          'aria-label': `添加${label}`,
          onChange: (e) => setManualKw((prev) => ({ ...prev, [key]: e.target.value })),
          onKeyDown: (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addKeyword(index, field);
            }
          },
        }),
        React.createElement(
          'button',
          { type: 'button', className: 'dshpd-btn dshpd-btn-sm', onClick: () => addKeyword(index, field) },
          '添加',
        ),
      ),
      React.createElement('textarea', {
        className: 'dshpd-field',
        value: topic[field],
        placeholder,
        'aria-label': `${label}（文本编辑）`,
        onChange: (e) => setTopic(index, field, e.target.value),
      }),
    );
  };

  const last = status && status.lastRun ? status.lastRun : null;

  function row(label, desc, control) {
    return React.createElement(
      'div',
      { className: 'dshpd-row' },
      React.createElement(
        'div',
        { className: 'dshpd-rbody' },
        React.createElement('div', { className: 'dshpd-rlabel' }, label),
        desc ? React.createElement('div', { className: 'dshpd-rdesc' }, desc) : null,
      ),
      React.createElement('div', { className: 'dshpd-rctrl' }, control),
    );
  }

  const sourceChips = (track) =>
    React.createElement(
      'div',
      { className: 'dshpd-chips' },
      TRACK_SOURCES[track].map((key) =>
        React.createElement(
          'button',
          {
            key,
            type: 'button',
            className: 'dshpd-chip',
            'aria-pressed': !!cfg.sources[key],
            onClick: () => setSource(key, !cfg.sources[key]),
          },
          SOURCE_LABELS[key],
        ),
      ),
    );

  return React.createElement(
    'div',
    { className: 'dshpd-panel' },

    // ---- schedule ----
    React.createElement(
      'div',
      { className: 'dshpd-group' },
      React.createElement('div', { className: 'dshpd-group-label' }, '定时与产出'),
      React.createElement(
        'div',
        { className: 'dshpd-card' },
        row(
          '启用每日自动检索',
          '到点自动运行；若运行时刻机器休眠，唤醒后会自动补跑',
          React.createElement(Toggle, { label: '启用每日自动检索', checked: cfg.enabled, onChange: (v) => patch({ enabled: v }) }),
        ),
        row(
          '发送时间',
          '每天此刻之后首次检查时生成日报',
          React.createElement('input', {
            type: 'time',
            className: 'dshpd-field dshpd-time',
            value: cfg.time,
            'aria-label': '发送时间',
            onChange: (e) => patch({ time: e.target.value }),
          }),
        ),
        row(
          '每日篇数',
          `中文 ${cfg.mix.zh} 篇 + 英文 ${cfg.mix.en} 篇（中文不足时英文自动补齐）`,
          React.createElement('input', {
            type: 'number',
            min: 1,
            max: 50,
            className: 'dshpd-field dshpd-num',
            value: cfg.dailyCount,
            'aria-label': '每日篇数',
            onChange: (e) => setDailyCount(e.target.value),
          }),
        ),
        row(
          '中英配比',
          '中文目标篇数（其余由英文承担）',
          React.createElement('input', {
            type: 'number',
            min: 0,
            max: cfg.dailyCount,
            className: 'dshpd-field dshpd-num',
            value: cfg.mix.zh,
            'aria-label': '中文篇数',
            onChange: (e) => setMix('zh', e.target.value),
          }),
        ),
        row(
          '回溯天数',
          '只收最近这些天内发表的论文',
          React.createElement('input', {
            type: 'number',
            min: 1,
            max: 120,
            className: 'dshpd-field dshpd-num',
            value: cfg.lookbackDays,
            'aria-label': '回溯天数',
            onChange: (e) => patch({ lookbackDays: Number(e.target.value) || 14 }),
          }),
        ),
        React.createElement(
          'div',
          { className: 'dshpd-col' },
          React.createElement('div', { className: 'dshpd-rlabel' }, '输出目录'),
          React.createElement('div', { className: 'dshpd-rdesc' }, 'Markdown 日报写入此处（建议填会话工作区）'),
          React.createElement('input', {
            type: 'text',
            className: 'dshpd-field dshpd-field-mono',
            style: { marginTop: 7 },
            value: cfg.outputDir,
            spellCheck: false,
            'aria-label': '输出目录',
            onChange: (e) => patch({ outputDir: e.target.value }),
          }),
        ),
      ),
    ),

    // ---- manual run ----
    React.createElement(
      'div',
      { className: 'dshpd-group' },
      React.createElement('div', { className: 'dshpd-group-label' }, '立即运行'),
      React.createElement(
        'div',
        { className: 'dshpd-card' },
        React.createElement(
          'div',
          { className: 'dshpd-col' },
          React.createElement(
            'div',
            { className: 'dshpd-rowfields' },
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dshpd-btn dshpd-btn-primary',
                disabled: busy,
                onClick: runNow,
              },
              busy
                ? status && status.currentRun && status.currentRun.trigger === 'schedule'
                  ? '定时补跑进行中…'
                  : '运行中…'
                : '立即生成日报',
            ),
            React.createElement(
              'span',
              { className: 'dshpd-status' },
              message
                ? message
                : last
                  ? `上次：${last.ok ? '成功' : '未选出'} · ${last.lastRunAt ? new Date(last.lastRunAt).toLocaleString() : ''}`
                  : '尚未运行过',
            ),
          ),
          // While a run is in flight, show what it is, since when, and that it is
          // still moving — a silent multi-minute lock is what made this look hung.
          status && status.running
            ? React.createElement(
                'div',
                { className: 'dshpd-status', style: { marginTop: 8 } },
                `${
                  status.currentRun && status.currentRun.trigger === 'schedule' ? '定时补跑' : '本次运行'
                }已用时 ${formatElapsed(status.currentRun ? status.currentRun.elapsedMs : 0)}`,
              )
            : null,
          last && last.file
            ? React.createElement(
                'div',
                { className: 'dshpd-status', style: { marginTop: 8 } },
                React.createElement('b', null, '产出文件：'),
                React.createElement('span', { className: 'dshpd-path' }, last.file),
              )
            : null,
          last && last.totals
            ? React.createElement(
                'div',
                { className: 'dshpd-status', style: { marginTop: 4 } },
                `候选 ${last.totals.candidates} · 去重 ${last.totals.duplicates} · 入选 ${last.totals.selected}（中 ${last.totals.zh} / 英 ${last.totals.en}）`,
              )
            : null,
          last && last.errors && last.errors.length
            ? React.createElement(
                'div',
                { className: 'dshpd-status dshpd-err', style: { marginTop: 4 } },
                `有 ${last.errors.length} 个数据源失败：${last.errors.map((e) => e.label).join('、')}`,
              )
            : null,
        ),
      ),
    ),

    // ---- topics ----
    React.createElement(
      'div',
      { className: 'dshpd-group' },
      React.createElement(
        'div',
        { className: 'dshpd-group-label' },
        `研究主题（${cfg.topics.length}）· 关键词用分号分隔，同组内可用逗号列同义词`,
      ),
      React.createElement(
        'div',
        { className: 'dshpd-card' },
        cfg.topics.map((topic, index) =>
          React.createElement(
            'div',
            { className: 'dshpd-col', key: topic.id || index },
            React.createElement(
              'div',
              { className: 'dshpd-topic-head' },
              React.createElement('input', {
                type: 'text',
                className: 'dshpd-field dshpd-grow',
                value: topic.name,
                placeholder: '主题名（如：人工智能教育）',
                'aria-label': '主题名',
                onChange: (e) => setTopic(index, 'name', e.target.value),
              }),
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'dshpd-btn dshpd-btn-sm',
                  disabled: !!generating[index],
                  title: '按主题名生成中英对照的关键词组，可逐条采纳',
                  onClick: () => generateForTopic(topic, index),
                },
                generating[index] ? '生成中…' : 'AI 生成关键词',
              ),
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'dshpd-btn dshpd-btn-ghost dshpd-btn-sm',
                  onClick: () => removeTopic(index),
                },
                '删除',
              ),
            ),
            genMsg[index]
              ? React.createElement('div', { className: 'dshpd-status' }, genMsg[index])
              : null,
            (kwProposals[index] ?? []).length
              ? React.createElement(
                  'div',
                  { className: 'dshpd-chips' },
                  (kwProposals[index] ?? []).map((group) =>
                    React.createElement(
                      'span',
                      {
                        className: 'dshpd-chip dshpd-chip-suggest',
                        key: `${group.zh}|${group.en}`,
                        title: `${group.zh}\n${group.en}\n${group.verdict || ''}`,
                        role: 'button',
                        tabIndex: 0,
                        'aria-pressed': false,
                        onClick: () => adoptKeywordGroup(index, group),
                        onKeyDown: (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            adoptKeywordGroup(index, group);
                          }
                        },
                      },
                      group.zh,
                      React.createElement(
                        'span',
                        { className: 'dshpd-chip-count' },
                        group.coverage === 0 ? ' 检索不到' : ` +${group.coverage ?? '?'}`,
                      ),
                      React.createElement(
                        'button',
                        {
                          type: 'button',
                          className: 'dshpd-chip-x',
                          title: '不采纳这组',
                          'aria-label': `不采纳 ${group.zh}`,
                          onClick: (e) => {
                            e.stopPropagation();
                            setKwProposals((prev) => ({
                              ...prev,
                              [index]: (prev[index] ?? []).filter((g) => g !== group),
                            }));
                          },
                        },
                        '×',
                      ),
                    ),
                  ),
                )
              : null,
            keywordEditor(topic, index, 'zh', '中文关键词', '例：人工智能 教育; 大模型 教学'),
            keywordEditor(
              topic,
              index,
              'en',
              '英文关键词',
              'e.g. artificial intelligence education; large language model teaching',
            ),
          ),
        ),
        React.createElement(
          'div',
          { className: 'dshpd-row' },
          React.createElement(
            'button',
            { type: 'button', className: 'dshpd-btn dshpd-btn-ghost dshpd-btn-sm', onClick: addTopic },
            '＋ 添加主题',
          ),
        ),
      ),
    ),

    // ---- keyword gap: what did the gate throw away? ----
    React.createElement(
      'div',
      { className: 'dshpd-group' },
      React.createElement('div', { className: 'dshpd-group-label' }, '关键词缺口（AI 分析漏检）'),
      React.createElement(
        'div',
        { className: 'dshpd-card' },
        React.createElement(
          'div',
          { className: 'dshpd-col' },
          React.createElement(
            'div',
            { className: 'dshpd-status' },
            suggestPoolSize > 0
              ? `上次运行中被判为不相关而丢弃 ${suggestPoolSize} 条，其中"接近判据"的会送进分析。`
              : '还没有可分析的候选：先运行一次日报，被过滤掉的论文才会进入分析池。',
          ),
          React.createElement(
            'div',
            { className: 'dshpd-rowfields' },
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dshpd-btn dshpd-btn-primary',
                disabled: analysing || suggestPoolSize === 0,
                onClick: analyseGap,
              },
              analysing ? '分析中…' : '分析漏检，给我候选关键词',
            ),
            React.createElement(
              'span',
              { className: 'dshpd-status' },
              suggestMsg || '模型只从被丢弃的论文原文里摘取表述，不会凭空生成概念。',
            ),
          ),
          suggestions.length
            ? React.createElement(
                'div',
                { className: 'dshpd-col' },
                React.createElement(
                  'div',
                  { className: 'dshpd-kwlabel' },
                  `${suggestions.length} 条建议（点击采纳；× 丢弃后不再重复出现）`,
                ),
                React.createElement(
                  'div',
                  { className: 'dshpd-chips' },
                  suggestions.map((s) =>
                    React.createElement(
                      'span',
                      {
                        className: 'dshpd-chip dshpd-chip-suggest',
                        key: s.phrase,
                        title: `${s.reason || '模型未给出理由'}\n预计可多召回 ${s.coverage} 篇`,
                        onClick: () => adoptSuggestion(s),
                        onKeyDown: (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            adoptSuggestion(s);
                          }
                        },
                        role: 'button',
                        tabIndex: 0,
                        'aria-pressed': false,
                      },
                      s.phrase,
                      React.createElement('span', { className: 'dshpd-chip-count' }, ` +${s.coverage}`),
                      React.createElement(
                        'button',
                        {
                          type: 'button',
                          className: 'dshpd-chip-x',
                          title: '丢弃这条建议',
                          'aria-label': `丢弃建议 ${s.phrase}`,
                          onClick: (e) => {
                            e.stopPropagation();
                            dismissSuggestion(s.phrase);
                          },
                        },
                        '×',
                      ),
                    ),
                  ),
                ),
              )
            : null,
        ),
      ),
    ),

    // ---- CNKI journals ----
    React.createElement(
      'div',
      { className: 'dshpd-group' },
      React.createElement('div', { className: 'dshpd-group-label' }, 'CNKI 期刊监控（中文主力通道）'),
      React.createElement(
        'div',
        { className: 'dshpd-card' },
        React.createElement(
          'div',
          { className: 'dshpd-col' },
          React.createElement(
            'div',
            { className: 'dshpd-rdesc' },
            '填知网期刊代码（如 JJYJ=经济研究、GLSJ=管理世界、XWYJ=新闻与传播研究），每日抓取该刊最新目录（每刊最多 20 条）。留空则只走关键词检索源。',
          ),
        ),
        cfg.journals.map((journal, index) =>
          React.createElement(
            'div',
            { className: 'dshpd-col', key: index },
            React.createElement(
              'div',
              { className: 'dshpd-rowfields' },
              React.createElement('input', {
                type: 'text',
                className: 'dshpd-field dshpd-field-mono',
                style: { width: 110, flex: '0 0 110px' },
                value: journal.id,
                placeholder: '代码',
                'aria-label': '期刊代码',
                onChange: (e) => setJournal(index, 'id', e.target.value),
              }),
              React.createElement('input', {
                type: 'text',
                className: 'dshpd-field dshpd-grow',
                value: journal.name,
                placeholder: '刊名',
                'aria-label': '刊名',
                onChange: (e) => setJournal(index, 'name', e.target.value),
              }),
              React.createElement(
                'select',
                {
                  className: 'dshpd-field',
                  style: { width: 128, flex: '0 0 128px' },
                  value: journal.topicId || '',
                  'aria-label': '归属主题',
                  onChange: (e) => setJournal(index, 'topicId', e.target.value),
                },
                React.createElement('option', { value: '' }, '自动匹配'),
                cfg.topics.map((t) => React.createElement('option', { key: t.id, value: t.id }, t.name)),
              ),
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'dshpd-btn dshpd-btn-ghost dshpd-btn-sm',
                  onClick: () => removeJournal(index),
                },
                '删除',
              ),
            ),
          ),
        ),
        React.createElement(
          'div',
          { className: 'dshpd-row' },
          React.createElement(
            'button',
            { type: 'button', className: 'dshpd-btn dshpd-btn-ghost dshpd-btn-sm', onClick: addJournal },
            '＋ 添加期刊',
          ),
        ),
      ),
    ),

    // ---- sources ----
    React.createElement(
      'div',
      { className: 'dshpd-group' },
      React.createElement('div', { className: 'dshpd-group-label' }, '数据源'),
      React.createElement(
        'div',
        { className: 'dshpd-card' },
        React.createElement(
          'div',
          { className: 'dshpd-col' },
          React.createElement('div', { className: 'dshpd-rlabel' }, '中文源'),
          sourceChips('zh'),
        ),
        React.createElement(
          'div',
          { className: 'dshpd-col' },
          React.createElement('div', { className: 'dshpd-rlabel' }, '英文源'),
          sourceChips('en'),
        ),
      ),
    ),

    // ---- full text ----
    React.createElement(
      'div',
      { className: 'dshpd-group' },
      React.createElement('div', { className: 'dshpd-group-label' }, '全文获取'),
      React.createElement(
        'div',
        { className: 'dshpd-card' },
        row(
          '自动下载开放获取全文',
          '仅下载标注为开放获取的 PDF（arXiv / PubMed Central / 出版商 OA 版本）；中文订阅库不抓取，只给详情页链接',
          React.createElement(Toggle, {
            label: '自动下载开放获取全文',
            checked: cfg.pdfEnabled,
            onChange: (v) => patch({ pdfEnabled: v }),
          }),
        ),
        row(
          '每轮最多下载',
          '避免一次抓取过多',
          React.createElement('input', {
            type: 'number',
            min: 1,
            max: 30,
            className: 'dshpd-field dshpd-num',
            value: cfg.pdfMaxPerRun,
            'aria-label': '每轮最多下载篇数',
            onChange: (e) => patch({ pdfMaxPerRun: Number(e.target.value) || 10 }),
          }),
        ),
        React.createElement(
          'div',
          { className: 'dshpd-col' },
          React.createElement('div', { className: 'dshpd-rlabel' }, 'PDF 保存目录'),
          React.createElement('input', {
            type: 'text',
            className: 'dshpd-field dshpd-field-mono',
            style: { marginTop: 7 },
            value: cfg.pdfDir,
            spellCheck: false,
            'aria-label': 'PDF 保存目录',
            onChange: (e) => patch({ pdfDir: e.target.value }),
          }),
        ),
        React.createElement(
          'div',
          { className: 'dshpd-col' },
          React.createElement('div', { className: 'dshpd-rlabel' }, 'Unpaywall 邮箱（可选）'),
          React.createElement(
            'div',
            { className: 'dshpd-rdesc' },
            '留空即关闭。填入后插件会用它向 Unpaywall 查询付费论文的合法开放获取副本（Unpaywall 要求真实邮箱，占位邮箱会被拒）。该邮箱不用于其他任何用途。',
          ),
          React.createElement('input', {
            type: 'email',
            className: 'dshpd-field dshpd-field-mono',
            style: { marginTop: 7 },
            value: cfg.unpaywallEmail || '',
            placeholder: 'you@example.com',
            spellCheck: false,
            autoComplete: 'off',
            'aria-label': 'Unpaywall 邮箱',
            onChange: (e) => patch({ unpaywallEmail: e.target.value }),
          }),
        ),
      ),
    ),

    // ---- Chinese summaries ----
    React.createElement(
      'div',
      { className: 'dshpd-group' },
      React.createElement('div', { className: 'dshpd-group-label' }, '中文速览'),
      React.createElement(
        'div',
        { className: 'dshpd-card' },
        row(
          '生成一句话中文速览',
          '用本机已配置的模型把每篇的标题与摘要精炼成 2-3 句中文，便于快速判断讲的是什么；原文摘要仍保留可展开核对',
          React.createElement(Toggle, {
            label: '生成一句话中文速览',
            checked: cfg.summaryEnabled,
            onChange: (v) => patch({ summaryEnabled: v }),
          }),
        ),
        React.createElement(
          'div',
          { className: 'dshpd-col' },
          React.createElement('div', { className: 'dshpd-rlabel' }, '指定模型（可选）'),
          React.createElement(
            'div',
            { className: 'dshpd-rdesc' },
            '留空即用当前默认模型。两侧都填才生效，可把速览固定到更便宜或更强的模型。',
          ),
          React.createElement(
            'div',
            { className: 'dshpd-rowfields', style: { marginTop: 7 } },
            React.createElement('input', {
              type: 'text',
              className: 'dshpd-field dshpd-field-mono dshpd-grow',
              value: cfg.summaryModelProvider || '',
              placeholder: 'provider（如 deepseek-official）',
              spellCheck: false,
              'aria-label': '速览模型 provider',
              onChange: (e) => patch({ summaryModelProvider: e.target.value }),
            }),
            React.createElement('input', {
              type: 'text',
              className: 'dshpd-field dshpd-field-mono dshpd-grow',
              value: cfg.summaryModel || '',
              placeholder: 'model（如 deepseek-flash）',
              spellCheck: false,
              'aria-label': '速览模型名',
              onChange: (e) => patch({ summaryModel: e.target.value }),
            }),
          ),
        ),
        React.createElement(
          'div',
          { className: 'dshpd-col' },
          React.createElement('div', { className: 'dshpd-rlabel' }, '思考档位'),
          React.createElement(
            'div',
            { className: 'dshpd-rdesc' },
            '速览只需归纳，不必深度思考。继承（默认）会走模型自身的档位；若你发现速览偏慢或消耗大，可调到「minimal」，并相应调低下面的 token 上限。',
          ),
          React.createElement(
            'select',
            {
              className: 'dshpd-field',
              style: { marginTop: 7, width: 160 },
              value: cfg.summaryReasoningEffort || '',
              'aria-label': '思考档位',
              onChange: (e) => patch({ summaryReasoningEffort: e.target.value }),
            },
            React.createElement('option', { value: '' }, '继承模型默认'),
            React.createElement('option', { value: 'minimal' }, 'minimal'),
            React.createElement('option', { value: 'low' }, 'low'),
            React.createElement('option', { value: 'medium' }, 'medium'),
            React.createElement('option', { value: 'high' }, 'high'),
            React.createElement('option', { value: 'max' }, 'max'),
          ),
        ),
        row(
          '输出 token 上限',
          '思考型模型会先消耗预算思考：上限太低会导致速览为空（插件会自动加倍预算重试一次）',
          React.createElement('input', {
            type: 'number',
            min: 80,
            max: 8000,
            step: 100,
            className: 'dshpd-field dshpd-num',
            value: cfg.summaryMaxTokens,
            'aria-label': '速览输出 token 上限',
            onChange: (e) => patch({ summaryMaxTokens: Number(e.target.value) || 1500 }),
          }),
        ),
      ),
    ),

    // ---- digest session ----
    React.createElement(
      'div',
      { className: 'dshpd-group' },
      React.createElement('div', { className: 'dshpd-group-label' }, '日报会话'),
      React.createElement(
        'div',
        { className: 'dshpd-card' },
        row(
          '生成日报时自动新建会话',
          '每次生成后自动创建一个以日期命名的会话（挂在日报目录下），可直接在左侧会话列表里打开，不必去翻文件夹',
          React.createElement(Toggle, {
            label: '生成日报时自动新建会话',
            checked: cfg.sessionEnabled,
            onChange: (v) => patch({ sessionEnabled: v }),
          }),
        ),
        React.createElement(
          'div',
          { className: 'dshpd-col' },
          React.createElement('div', { className: 'dshpd-rlabel' }, '会话预设（可选）'),
          React.createElement(
            'div',
            { className: 'dshpd-rdesc' },
            '留空即用部署默认预设，这样新会话和你手动建的会话能力一致，可以在里面继续追问论文细节。',
          ),
          React.createElement('input', {
            type: 'text',
            className: 'dshpd-field dshpd-field-mono',
            style: { marginTop: 7, maxWidth: 240 },
            value: cfg.sessionPreset || '',
            placeholder: '留空 = 默认预设',
            spellCheck: false,
            'aria-label': '会话预设',
            onChange: (e) => patch({ sessionPreset: e.target.value }),
          }),
        ),
        React.createElement(
          'div',
          { className: 'dshpd-row' },
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'dshpd-btn dshpd-btn-ghost dshpd-btn-sm',
              onClick: () => {
                setMessage('正在创建会话…');
                store.openSession().then((res) => {
                  setMessage(
                    res && res.ok
                      ? '已创建会话，请查看左侧会话列表'
                      : `创建失败：${(res && res.error) || '未知错误'}`,
                  );
                  store.refreshStatus();
                });
              },
            },
            '为上次日报新建会话',
          ),
          React.createElement(
            'span',
            { className: 'dshpd-status' },
            last && last.session && last.session.ok
              ? `上次已创建会话 ${String(last.session.sessionId).slice(0, 22)}…`
              : last && last.session && last.session.reason
                ? `上次未创建：${last.session.reason}`
                : '用于补救：日报已生成但当时没建会话',
          ),
        ),
      ),
    ),

    // ---- core journal list ----
    React.createElement(
      'div',
      { className: 'dshpd-group' },
      React.createElement('div', { className: 'dshpd-group-label' }, '核心期刊表（可选，用于中文质量加权）'),
      React.createElement(
        'div',
        { className: 'dshpd-card' },
        React.createElement(
          'div',
          { className: 'dshpd-row' },
          React.createElement(
            'div',
            { className: 'dshpd-rbody' },
            React.createElement('div', { className: 'dshpd-rlabel' }, '本地核心期刊名单'),
            React.createElement(
              'div',
              { className: 'dshpd-rdesc' },
              status && status.coreJournalCount
                ? `已配置 ${status.coreJournalCount} 条，命中即标记核心期刊并提高评分`
                : '未配置。每行“刊名关键词 = 核心等级”，如“教育研究 = CSSCI”',
            ),
          ),
          React.createElement(
            'div',
            { className: 'dshpd-rctrl' },
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dshpd-btn dshpd-btn-ghost dshpd-btn-sm',
                onClick: () => {
                  const next = !showCore;
                  setShowCore(next);
                  if (next) {
                    store.loadCoreList().then((res) => {
                      setCoreText((res && res.content) || '');
                      setCoreFile((res && res.file) || '');
                    });
                  }
                },
              },
              showCore ? '收起' : '编辑',
            ),
          ),
        ),
        showCore
          ? React.createElement(
              'div',
              { className: 'dshpd-col' },
              React.createElement('textarea', {
                className: 'dshpd-field dshpd-field-mono',
                style: { minHeight: 120 },
                value: coreText,
                placeholder: '# 每行一条：刊名关键词 = 等级\n教育研究 = CSSCI\n管理世界 = CSSCI\n心理学报 = CSSCI',
                'aria-label': '核心期刊名单',
                onChange: (e) => setCoreText(e.target.value),
              }),
              React.createElement(
                'div',
                { className: 'dshpd-rowfields', style: { marginTop: 8 } },
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'dshpd-btn dshpd-btn-primary dshpd-btn-sm',
                    onClick: () =>
                      store.saveCoreList(coreText).then((res) => {
                        setMessage(res && res.ok ? `核心期刊表已保存（${res.count} 条）` : '保存失败');
                        store.refreshStatus();
                      }),
                  },
                  '保存名单',
                ),
                coreFile
                  ? React.createElement('span', { className: 'dshpd-status dshpd-path' }, coreFile)
                  : null,
              ),
            )
          : null,
      ),
    ),

    React.createElement(
      'div',
      { className: 'dshpd-group' },
      React.createElement(
        'div',
        { className: 'dshpd-rdesc' },
        '说明：中文检索依赖各站点公开页面，站点改版可能导致某个源失效——此时日报会在「运行诊断」里列出失败源，并用英文源补齐篇数，不会中断。',
      ),
    ),
  );
}
