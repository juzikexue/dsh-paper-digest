/**
 * Source adapters. Every adapter has the same shape:
 *
 *   fetch(topic, ctx) -> Promise<paper[]>
 *
 * `paper` is the plugin's own normalised record (see `blank` below) — never a
 * raw upstream object. Adapters throw on failure; `collect.js` isolates each
 * one so a broken source degrades the digest instead of failing it.
 *
 * Reliability, measured on this machine (2026-09-17):
 *   OpenAlex / Crossref / arXiv(https) / EuropePMC / ChinaXiv / CNKI RSS  → live
 *   NCPSSD search, PubScholar search → client-rendered SPA, no public JSON API.
 *   NCPSSD is therefore opt-in and best-effort (it can still resolve a paper's
 *   metadata by id via its real POST API), and the English track backfills.
 */
import { cleanText, normaliseDoi, normaliseTitle, acceptedVenue, looksLikeJournalRecord } from './text.js';
import { getJson, postJson, getText, parseFeed, parseFeedDate, dateDaysAgo } from './http.js';

export function blank() {
  return {
    title: '',
    authors: [],
    abstract: '',
    venue: '',
    venueType: '',
    track: '', // 'zh' | 'en'
    source: '', // adapter id, for attribution in the report
    sourceLabel: '',
    publishedDate: '',
    volume: '',
    issue: '',
    pages: '',
    doi: '',
    url: '',
    issn: '',
    keywords: [],
    citedBy: 0,
    isCore: false,
    isRetracted: false,
    acceptedAt: '',
    comment: '',
    preprint: false,
    isJournalFeed: false,
    // Set only when the source itself is open access, so the report can link
    // straight to a PDF. The plugin never downloads a file.
    pdfUrl: '',
    isOpenAccess: false,
    evidence: null,
    topicId: '',
    topicName: '',
    score: 0,
    reasons: [],
  };
}

function authorsFrom(value) {
  if (Array.isArray(value)) {
    return value.map((a) => cleanText(typeof a === 'string' ? a : a?.name ?? a?.literal ?? '')).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[;；,，、]/)
      .map((s) => cleanText(s))
      .filter(Boolean);
  }
  return [];
}

const CN_AUTHOR = /^[\u4e00-\u9fff·]{2,10}$/;

/** ChinaXiv interleaves titles/honorifics ("Zhang, Dr. Xueheng"); trim those. */
function tidyAuthor(name) {
  const n = cleanText(name);
  if (CN_AUTHOR.test(n)) return n;
  return n
    .replace(/\b(Dr|Prof|Mr|Ms|Mrs|Miss)\.?\s*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/* ------------------------------------------------------- Chinese sources -- */

/**
 * CNKI journal RSS — the reliable, ToS-clean Chinese channel.
 *
 * A per-journal "latest issue" feed (max 20 entries, no pagination), which is
 * exactly the right shape for a daily "what is new in my field" digest, and it
 * needs no captcha, no login, and no scraping of search result pages.
 */
export async function fetchCnkiRss(journal, ctx) {
  const url = `https://rss.cnki.net/kns/rss.aspx?Journal=${encodeURIComponent(journal.id)}&Virtual=knavi`;
  const xml = await getText(url, { timeoutMs: ctx.timeoutMs });
  const { channelTitle, entries } = parseFeed(xml);
  const venue = journal.name || cleanText(channelTitle).replace(/[-－]CNKI$/, '') || journal.id;
  return entries
    .map((entry) => {
      const title = cleanText(entry.title);
      if (!title) return null;
      const paper = blank();
      paper.title = title;
      paper.authors = authorsFrom(cleanText(entry.author));
      paper.abstract = cleanText(entry.description).replace(/\.{3}$/, '…');
      paper.venue = venue;
      paper.venueType = 'journal';
      paper.track = 'zh';
      paper.source = 'cnkiRss';
      paper.sourceLabel = 'CNKI 期刊 RSS';
      paper.publishedDate = parseFeedDate(entry.pubDate);
      paper.url = cleanText(entry.link);
      paper.topicId = journal.topicId || '';
      // Journal feeds list the latest issue, which may be weeks old; they are
      // exempt from the recency gate (see passesGate) so the Chinese track is
      // not emptied whenever a journal is between issues.
      paper.isJournalFeed = true;
      // CNKI full text is subscription-only: the 知网 link is the deliverable and
      // no PDF is fetched (see lib/core/downloader.js for why).
      return paper;
    })
    .filter(Boolean);
}

/** ChinaXiv (中科院预印本) — public POST JSON API. */
export async function fetchChinaXiv(topic, ctx) {
  const out = [];
  for (const keyword of topic.terms.zh.slice(0, 3)) {
    const json = await postJson(
      'https://chinaxiv.org/api/search',
      { page: 1, size: ctx.maxPerTopic, keyword },
      { timeoutMs: ctx.timeoutMs, headers: { Referer: 'https://chinaxiv.org/' } },
    );
    const items = json?.data?.content ?? [];
    for (const item of items) {
      const title = cleanText(item.title_str || item.title || item.entitle);
      if (!title) continue;
      const paper = blank();
      paper.title = title;
      paper.authors = (item.authors ?? []).map(tidyAuthor).filter(Boolean);
      paper.abstract = cleanText(item.abstracts_str || item.abstracts || item.enabstracts);
      paper.venue = cleanText(item.journalref) || 'ChinaXiv 预印本';
      paper.venueType = item.journalref ? 'journal' : 'repository';
      paper.track = 'zh';
      paper.source = 'chinaXiv';
      paper.sourceLabel = 'ChinaXiv（中科院预印本）';
      paper.publishedDate = parseFeedDate(item.day || item.month || '');
      paper.doi = normaliseDoi(item.doi);
      paper.url = item.uuid ? `https://chinaxiv.org/abs/${item.csoaid || item.uuid}` : 'https://chinaxiv.org/';
      paper.keywords = Array.isArray(item.keywords) ? item.keywords.map(cleanText).filter(Boolean) : [];
      paper.citedBy = Number(item.hits) || 0;
      paper.preprint = !item.journalref;
      paper.acceptedAt = cleanText(item.comment);
      out.push(paper);
    }
  }
  return out;
}

/**
 * Europe PMC restricted to Chinese-language records.
 *
 * Honest scope note: Europe PMC is a *biomedical* index, so `LANG:chi` yields
 * roughly 30–40 records per fortnight and they are overwhelmingly Chinese
 * medical journals (中华医学会系列 etc.). It is therefore a useful source for
 * medicine/life sciences and near-useless for education or social science —
 * the settings page says so. The query deliberately does NOT require the
 * keyword to appear in a Chinese abstract (that matched 0 records); relevance
 * is enforced afterwards by `matchesTopic`.
 */
export async function fetchEuropePmcZh(topic, ctx) {
  const q = `LANG:chi AND (FIRST_PDATE:[${dateDaysAgo(ctx.lookbackDays)} TO ${dateDaysAgo(0)}])`;
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(q)}&format=json&pageSize=100&resultType=core`;
  const json = await getJson(url, { timeoutMs: ctx.timeoutMs });
  const out = [];
  for (const item of json?.resultList?.result ?? []) {
    const title = cleanText(item.title);
    if (!title) continue;
    const paper = blank();
    paper.title = title;
    paper.authors = authorsFrom(item.authorString);
    paper.abstract = cleanText(item.abstractText);
    paper.venue = cleanText(item.journalInfo?.journal?.title) || cleanText(item.bookOrReportDetails?.publisher) || '';
    paper.venueType = 'journal';
    paper.track = 'zh';
    paper.source = 'europePmcZh';
    paper.sourceLabel = 'Europe PMC（中文·医学）';
    paper.publishedDate = cleanText(item.firstPublicationDate || item.journalInfo?.printPublicationDate);
    paper.doi = normaliseDoi(item.doi);
    paper.url = item.pmid
      ? `https://europepmc.org/article/MED/${item.pmid}`
      : item.doi
        ? `https://doi.org/${normaliseDoi(item.doi)}`
        : '';
    paper.issn = cleanText(item.journalInfo?.journal?.issn);
    paper.citedBy = Number(item.citedByCount) || 0;
    paper.keywords = Array.isArray(item.keywordList?.keyword) ? item.keywordList.keyword.map(cleanText) : [];
    out.push(paper);
  }
  return out;
}

/**
 * NCPSSD (国家哲学社会科学文献中心) — opt-in.
 *
 * The search page is a Vue app with no public JSON search endpoint, so a bare
 * fetch cannot list results. What does work over plain HTTP is the article
 * metadata handler, which the plugin uses to enrich a paper the user pasted in.
 * Kept behind a config flag so the default digest never depends on it.
 */
export async function fetchNcpssd() {
  throw new Error('NCPSSD 检索接口需浏览器渲染，当前未启用（可在设置中关闭该源）');
}

export async function ncpssdArticleById(lngid, ctx) {
  const json = await postJson(
    'https://www.ncpssd.cn/articleinfoHandler/getjournalarticletable',
    { lngid: String(lngid), type: '中文期刊文章' },
    { timeoutMs: ctx?.timeoutMs ?? 20000, headers: { Referer: 'https://www.ncpssd.cn/' } },
  );
  const d = json?.data ?? {};
  const paper = blank();
  paper.title = cleanText(d.titlec);
  paper.authors = authorsFrom(cleanText(d.showwriter));
  paper.abstract = cleanText(d.remarkc);
  paper.venue = cleanText(d.mediac);
  paper.venueType = 'journal';
  paper.track = 'zh';
  paper.source = 'ncpssd';
  paper.sourceLabel = 'NCPSSD';
  paper.volume = cleanText(d.vol);
  paper.issue = cleanText(d.num);
  paper.pages = [cleanText(d.beginpage), cleanText(d.endpage)].filter(Boolean).join('-');
  paper.publishedDate = cleanText(d.publishdate);
  paper.issn = cleanText(d.issn);
  paper.keywords = cleanText(d.keywordc).split(/[;；]/).map((s) => s.trim()).filter(Boolean);
  paper.url = lngid ? `https://www.ncpssd.cn/Literature/articleinfo?id=${lngid}&type=journalArticle` : '';
  return paper;
}

/* ------------------------------------------------------- English sources -- */

/** OpenAlex — `is_core` venue flag is the free stand-in for WoS/Scopus indexing. */
export async function fetchOpenAlex(topic, ctx) {
  const out = [];
  for (const keyword of topic.terms.en.slice(0, 3)) {
    const params = new URLSearchParams({
      // `type:article` is mandatory: without it OpenAlex returns whole-journal
      // records, which then dominate any citation sort (verified 2026-09-17).
      filter: [
        'type:article',
        'is_retracted:false',
        'language:en',
        `from_publication_date:${dateDaysAgo(ctx.lookbackDays)}`,
        // Title-only search on purpose: `title_and_abstract.search` also hits
        // full text, which returns papers whose *body* mentions the phrase while
        // the title/abstract never does — noise that the relevance gate then has
        // to reject anyway (verified 2026-09-17).
        `title.search:${keyword}`,
      ].join(','),
      'per-page': String(Math.min(ctx.maxPerTopic, 50)),
      sort: 'publication_date:desc',
      select:
        'id,doi,title,publication_date,authorships,primary_location,cited_by_count,type,language,abstract_inverted_index,open_access,best_oa_location',
      mailto: ctx.mailto,
    });
    const json = await getJson(`https://api.openalex.org/works?${params.toString()}`, { timeoutMs: ctx.timeoutMs });
    for (const item of json?.results ?? []) {
      const title = cleanText(item.title);
      if (looksLikeJournalRecord(title, item.type)) continue;
      const src = item.primary_location?.source ?? {};
      const paper = blank();
      paper.title = title;
      paper.authors = (item.authorships ?? [])
        .map((a) => cleanText(a?.author?.display_name))
        .filter(Boolean);
      paper.abstract = fromInvertedIndex(item.abstract_inverted_index);
      paper.venue = cleanText(src.display_name);
      paper.venueType = src.type === 'journal' ? 'journal' : 'repository';
      paper.track = 'en';
      paper.source = 'openalex';
      paper.sourceLabel = 'OpenAlex';
      paper.publishedDate = cleanText(item.publication_date);
      paper.doi = normaliseDoi(item.doi);
      paper.url = item.doi ? `https://doi.org/${normaliseDoi(item.doi)}` : cleanText(item.id);
      paper.issn = cleanText(src.issn_l);
      paper.citedBy = Number(item.cited_by_count) || 0;
      paper.isCore = src.is_core === true;
      paper.isRetracted = item.is_retracted === true;
      // Only an explicitly open location is eligible for download.
      const oa = item.best_oa_location ?? null;
      if (item.open_access?.is_oa && oa?.pdf_url) {
        paper.pdfUrl = cleanText(oa.pdf_url);
        paper.isOpenAccess = true;
      }
      out.push(paper);
    }
  }
  return out;
}

/** OpenAlex stores abstracts as an inverted index; rebuild plain text. */
function fromInvertedIndex(index) {
  if (!index || typeof index !== 'object') return '';
  const slots = [];
  for (const [word, positions] of Object.entries(index)) {
    if (!Array.isArray(positions)) continue;
    for (const p of positions) slots[p] = word;
  }
  return cleanText(slots.filter(Boolean).join(' '));
}

/** Crossref — journal metadata and DOI-of-record, queried by title keywords. */
export async function fetchCrossref(topic, ctx) {
  const out = [];
  for (const keyword of topic.terms.en.slice(0, 2)) {
    const params = new URLSearchParams({
      // `query.bibliographic` searches the whole record; `query.title` keeps the
      // candidates aligned with the title/abstract relevance gate.
      'query.title': keyword,
      filter: `from-pub-date:${dateDaysAgo(ctx.lookbackDays)},type:journal-article`,
      rows: String(Math.min(ctx.maxPerTopic, 50)),
      sort: 'published',
      order: 'desc',
      select: 'DOI,title,author,container-title,issued,abstract,ISSN,is-referenced-by-count,URL,type',
      mailto: ctx.mailto,
    });
    const json = await getJson(`https://api.crossref.org/works?${params.toString()}`, { timeoutMs: ctx.timeoutMs });
    for (const item of json?.message?.items ?? []) {
      const title = cleanText(Array.isArray(item.title) ? item.title[0] : item.title);
      if (!title) continue;
      const paper = blank();
      paper.title = title;
      paper.authors = (item.author ?? [])
        .map((a) => cleanText([a.given, a.family].filter(Boolean).join(' ') || a.name))
        .filter(Boolean);
      paper.abstract = cleanText(item.abstract);
      paper.venue = cleanText(Array.isArray(item['container-title']) ? item['container-title'][0] : item['container-title']);
      paper.venueType = 'journal';
      paper.track = 'en';
      paper.source = 'crossref';
      paper.sourceLabel = 'Crossref';
      const parts = item.issued?.['date-parts']?.[0];
      paper.publishedDate = Array.isArray(parts) && parts.length
        ? `${parts[0]}-${String(parts[1] ?? 1).padStart(2, '0')}-${String(parts[2] ?? 1).padStart(2, '0')}`
        : '';
      paper.doi = normaliseDoi(item.DOI);
      paper.url = cleanText(item.URL) || (paper.doi ? `https://doi.org/${paper.doi}` : '');
      paper.issn = Array.isArray(item.ISSN) ? cleanText(item.ISSN[0]) : '';
      paper.citedBy = Number(item['is-referenced-by-count']) || 0;
      out.push(paper);
    }
  }
  return out;
}

/** arXiv — the `comment` field carries "Accepted at <venue>", a strong T+0 signal. */
export async function fetchArxiv(topic, ctx) {
  const out = [];
  const terms = topic.terms.en.slice(0, 2);
  for (const keyword of terms) {
    const q = `all:"${keyword}"`;
    const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(q)}&sortBy=submittedDate&sortOrder=descending&max_results=${Math.min(ctx.maxPerTopic, 50)}`;
    const xml = await getText(url, { timeoutMs: Math.max(ctx.timeoutMs, 25000) });
    const { entries } = parseFeed(xml);
    for (const entry of entries) {
      const title = cleanText(entry.title);
      if (!title) continue;
      const paper = blank();
      paper.title = title;
      paper.authors = authorsFrom(cleanText(entry.author));
      paper.abstract = cleanText(entry.description);
      paper.venue = 'arXiv';
      paper.venueType = 'preprint';
      paper.track = 'en';
      paper.source = 'arxiv';
      paper.sourceLabel = 'arXiv';
      paper.publishedDate = parseFeedDate(entry.pubDate);
      paper.url = cleanText(entry.link);
      paper.preprint = true;
      paper.isOpenAccess = true;
      // Author-deposited preprints are always downloadable; derive the PDF URL
      // from the abstract id rather than trusting a possibly-absent link rel.
      const absMatch = /arxiv\.org\/abs\/([^v\s]+)(v\d+)?/.exec(paper.url);
      if (absMatch) paper.pdfUrl = `https://arxiv.org/pdf/${absMatch[1]}${absMatch[2] ?? ''}`;
      const comment = cleanText(entry.comment);
      paper.keywords = [];
      paper.acceptedAt = acceptedVenue(comment);
      paper.comment = comment;
      out.push(paper);
    }
  }
  return out;
}

/* ------------------------------------------------------------- registry -- */

export const SOURCES = {
  cnkiRss: { label: 'CNKI 期刊 RSS', track: 'zh', kind: 'journal' },
  chinaXiv: { label: 'ChinaXiv', track: 'zh', kind: 'search', fetch: fetchChinaXiv },
  europePmcZh: { label: 'Europe PMC（中文）', track: 'zh', kind: 'search', fetch: fetchEuropePmcZh },
  ncpssd: { label: 'NCPSSD', track: 'zh', kind: 'search', fetch: fetchNcpssd },
  openalex: { label: 'OpenAlex', track: 'en', kind: 'search', fetch: fetchOpenAlex },
  crossref: { label: 'Crossref', track: 'en', kind: 'search', fetch: fetchCrossref },
  arxiv: { label: 'arXiv', track: 'en', kind: 'search', fetch: fetchArxiv },
};

export { normaliseTitle };
