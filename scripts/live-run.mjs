/**
 * Manual end-to-end check: build a real digest against the live sources and
 * print a summary. Not part of the plugin runtime.
 *
 *   node scripts/live-run.mjs            # default config + 2 sample CNKI journals
 *   node scripts/live-run.mjs <outfile>  # also write the Markdown to <outfile>
 */
import { buildDigest } from '../lib/core/collect.js';
import { renderMarkdown } from '../lib/core/render.js';
import { defaultConfig, sanitise } from '../lib/core/config.js';
import { writeFileSync } from 'node:fs';

const out = process.argv[2];

const cfg = sanitise({
  ...defaultConfig(),
  // Sample CNKI journal codes, purely to exercise the RSS channel.
  journals: [
    { id: 'JYYJ', name: '教育研究', topicId: 't1' },
    { id: 'XLKX', name: '心理科学', topicId: 't3' },
    { id: 'XWYJ', name: '新闻与传播研究', topicId: '' },
    { id: 'WYJYYJ', name: '外语教学与研究', topicId: 't2' },
  ],
});

console.log('topics:', cfg.topics.map((t) => t.name).join(' | '));
console.log('sources:', Object.entries(cfg.sources).filter(([, v]) => v).map(([k]) => k).join(', '));
console.log('lookback:', cfg.lookbackDays, 'days · target:', cfg.dailyCount, `(zh ${cfg.mix.zh} / en ${cfg.mix.en})`);
console.log('running…\n');

const t0 = Date.now();
const digest = await buildDigest(cfg, new Date());
const ms = Date.now() - t0;

console.log('=== 数据源 ===');
for (const s of digest.stats) console.log(`  ${s.label.padEnd(34)} fetched=${String(s.fetched).padStart(4)} kept=${s.kept}`);
if (digest.errors.length) {
  console.log('=== 失败 ===');
  for (const e of digest.errors) console.log(`  ${e.label}: ${e.message}`);
}
console.log('\n=== 统计 ===');
console.log(' ', JSON.stringify(digest.totals));
console.log(`  用时 ${(ms / 1000).toFixed(1)}s`);

console.log('\n=== 入选论文 ===');
for (const g of digest.groups) {
  console.log(`\n【${g.topic.name}】${g.papers.length} 篇`);
  for (const p of g.papers) {
    console.log(`  [${String(p.score).padStart(3)}] (${p.track}) ${p.title.slice(0, 64)}`);
    console.log(`        ${p.venue || '(无刊名)'} · ${p.publishedDate || '无日期'} · ${p.sourceLabel}`);
  }
}

const md = renderMarkdown(digest, cfg, new Date());
console.log(`\nMarkdown ${md.length} chars`);
if (out) {
  writeFileSync(out, md, 'utf8');
  console.log('written:', out);
}
