'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { URL, URLSearchParams } = require('node:url');
const {
  CONTEXTFS_ROOT,
  NAMESPACES,
  writeContextObject,
  recordProvenance,
  constructTemplatedPack,
} = require('./contextfs');

const DEFAULT_HF_PAPERS_API_BASE = process.env.HF_PAPERS_API_BASE || 'https://huggingface.co/api';
const DEFAULT_LIMIT = 5;

function normalizeAuthors(authors) {
  if (!Array.isArray(authors)) return [];
  return authors
    .map((author) => {
      if (typeof author === 'string') return author.trim();
      if (author && typeof author.name === 'string') return author.name.trim();
      return '';
    })
    .filter(Boolean);
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags
    .map((tag) => {
      if (typeof tag === 'string') return tag.trim();
      if (tag && typeof tag.label === 'string') return tag.label.trim();
      if (tag && typeof tag.name === 'string') return tag.name.trim();
      return '';
    })
    .filter(Boolean))];
}

function normalizePaper(record = {}) {
  const paper = record && typeof record.paper === 'object' ? record.paper : record;
  const paperId = String(
    paper.id
      || paper.paper_id
      || paper.paperId
      || paper.arxiv_id
      || paper.arxivId
      || record.id
      || record.paper_id
      || record.paperId
      || record.arxiv_id
      || record.arxivId
      || ''
  ).trim();
  const title = String(
    paper.title
      || record.title
      || (paperId ? `Paper ${paperId}` : 'Untitled paper')
  ).trim();
  const summary = String(
    paper.summary
      || paper.abstract
      || record.summary
      || record.abstract
      || ''
  ).trim();
  const url = String(
    paper.url
      || paper.paper_url
      || record.url
      || record.paper_url
      || (paperId ? `https://arxiv.org/abs/${paperId}` : '')
  ).trim();

  return {
    paperId,
    title,
    summary,
    url: url || null,
    authors: normalizeAuthors(paper.authors || record.authors),
    tags: normalizeTags(paper.tags || paper.categories || record.tags || record.categories),
    publishedAt: paper.publishedAt || paper.published_at || record.publishedAt || record.published_at || null,
    source: 'huggingface-papers',
  };
}

function extractPaperItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.papers)) return payload.papers;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.dailyPapers)) return payload.dailyPapers;
  if (payload.paper && typeof payload.paper === 'object') return [payload.paper];
  return [];
}

function buildSearchUrls({ query, limit = DEFAULT_LIMIT, baseUrl = DEFAULT_HF_PAPERS_API_BASE }) {
  const normalizedBase = String(baseUrl || DEFAULT_HF_PAPERS_API_BASE).replace(/\/+$/, '');
  const routes = [
    ['/daily_papers', { query, limit: String(limit) }],
    ['/papers/search', { q: query, limit: String(limit) }],
    ['/papers', { query, limit: String(limit) }],
  ];

  return routes.map(([pathname, params]) => {
    const url = new URL(`${normalizedBase}${pathname}`);
    url.search = new URLSearchParams(params).toString();
    return url.toString();
  });
}

async function readJson(url, fetchImpl = global.fetch) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required');
  }

  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/json',
    },
  });

  if (!response.ok) {
    const error = new Error(`HF papers request failed: ${response.status} ${response.statusText}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

async function searchPapers({
  query,
  limit = DEFAULT_LIMIT,
  baseUrl = DEFAULT_HF_PAPERS_API_BASE,
  fetchImpl = global.fetch,
} = {}) {
  const normalizedQuery = String(query || '').trim();
  if (!normalizedQuery) {
    throw new Error('searchPapers requires query');
  }

  const urls = buildSearchUrls({
    query: normalizedQuery,
    limit: Math.max(1, Number(limit) || DEFAULT_LIMIT),
    baseUrl,
  });

  let lastError = null;
  for (const url of urls) {
    try {
      const payload = await readJson(url, fetchImpl);
      const papers = extractPaperItems(payload)
        .map(normalizePaper)
        .filter((paper) => paper.paperId || paper.title);

      if (papers.length > 0) {
        return papers.slice(0, limit);
      }
    } catch (error) {
      lastError = error;
      if (error && error.status === 404) {
        continue;
      }
    }
  }

  if (lastError) throw lastError;
  return [];
}

function paperToMarkdown(paper) {
  const normalized = normalizePaper(paper);
  const lines = [
    `# ${normalized.title}`,
    '',
    `Paper ID: ${normalized.paperId || 'unknown'}`,
    `Source: ${normalized.source}`,
  ];

  if (normalized.url) {
    lines.push(`URL: ${normalized.url}`);
  }
  if (normalized.publishedAt) {
    lines.push(`Published: ${normalized.publishedAt}`);
  }
  if (normalized.authors.length > 0) {
    lines.push(`Authors: ${normalized.authors.join(', ')}`);
  }
  if (normalized.tags.length > 0) {
    lines.push(`Tags: ${normalized.tags.join(', ')}`);
  }

  lines.push('', '## Abstract', '', normalized.summary || 'No abstract available.', '');
  return lines.join('\n');
}

function buildCitation(paper) {
  return {
    paperId: paper.paperId || null,
    title: paper.title,
    url: paper.url,
  };
}

function ingestNormalizedPapers(papers, query) {
  const researchDir = path.join(CONTEXTFS_ROOT, NAMESPACES.research);
  const existing = fs.existsSync(researchDir)
    ? fs.readdirSync(researchDir).filter((f) => f.endsWith('.json'))
        .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(researchDir, f), 'utf-8')); } catch { return null; } })
        .filter(Boolean)
    : [];
  const existingTitles = new Set(existing.map((e) => e.title));

  const ingested = papers.map((paper) => {
    const title = `Paper: ${paper.title}`;
    if (existingTitles.has(title)) {
      return { title, deduped: true };
    }
    const result = writeContextObject({
      namespace: NAMESPACES.research,
      title,
      content: paperToMarkdown(paper),
      tags: ['research', 'paper', 'hf-papers', ...paper.tags],
      source: 'hf-papers',
      metadata: {
        provider: 'huggingface',
        paperId: paper.paperId || null,
        url: paper.url,
        authors: paper.authors,
        publishedAt: paper.publishedAt,
        query,
      },
    });
    existingTitles.add(title);
    return result;
  });

  recordProvenance({
    type: 'hf_papers_ingested',
    query,
    count: ingested.length,
    paperIds: papers.map((paper) => paper.paperId).filter(Boolean),
  });

  return ingested;
}

async function ingestPaperSearch({
  query,
  limit = DEFAULT_LIMIT,
  baseUrl = DEFAULT_HF_PAPERS_API_BASE,
  fetchImpl = global.fetch,
  searchPapersImpl = searchPapers,
} = {}) {
  const papers = await searchPapersImpl({
    query,
    limit,
    baseUrl,
    fetchImpl,
  });
  const ingested = ingestNormalizedPapers(papers, query);

  return {
    query,
    limit,
    papers,
    ingested,
  };
}

async function buildResearchBrief({
  query,
  limit = DEFAULT_LIMIT,
  template = 'research-brief',
  baseUrl = DEFAULT_HF_PAPERS_API_BASE,
  fetchImpl = global.fetch,
  searchPapersImpl = searchPapers,
} = {}) {
  const result = await ingestPaperSearch({
    query,
    limit,
    baseUrl,
    fetchImpl,
    searchPapersImpl,
  });
  const pack = constructTemplatedPack({ template, query });
  const citations = result.papers.map(buildCitation);
  const brief = pack.items
    .map((item, index) => {
      const digest = String(item.structuredContext && item.structuredContext.rawContent || '')
        .split('\n')
        .slice(0, 6)
        .join(' ')
        .trim();
      return `${index + 1}. ${item.title} ${digest}`.trim();
    })
    .join('\n');

  return {
    query,
    limit,
    source: 'huggingface-papers',
    template,
    ingestedCount: result.ingested.length,
    packId: pack.packId,
    citations,
    brief,
    pack,
  };
}

module.exports = {
  DEFAULT_HF_PAPERS_API_BASE,
  buildResearchBrief,
  buildSearchUrls,
  extractPaperItems,
  ingestNormalizedPapers,
  ingestPaperSearch,
  normalizeAuthors,
  normalizePaper,
  normalizeTags,
  paperToMarkdown,
  searchPapers,
};
