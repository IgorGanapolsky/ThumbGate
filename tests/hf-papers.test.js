'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-hf-papers-test-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpFeedbackDir;

const {
  CONTEXTFS_ROOT,
  NAMESPACES,
  constructContextPack,
  constructTemplatedPack,
} = require('../scripts/contextfs');
const {
  buildResearchBrief,
  buildSearchUrls,
  ingestPaperSearch,
  normalizePaper,
  paperToMarkdown,
  searchPapers,
} = require('../scripts/hf-papers');

const SAMPLE_PAPER = {
  paper: {
    id: '2603.01896',
    title: 'Agentic Rank Fusion for Research Systems',
    summary: 'Combines semantic search with citation-aware ranking for better paper retrieval.',
    authors: [{ name: 'Ada Lovelace' }, { name: 'Alan Turing' }],
    tags: ['retrieval', 'agents'],
    url: 'https://arxiv.org/abs/2603.01896',
    publishedAt: '2026-03-25T13:07:00.000Z',
  },
};

test.after(() => {
  fs.rmSync(tmpFeedbackDir, { recursive: true, force: true });
  delete process.env.THUMBGATE_FEEDBACK_DIR;
});

test('buildSearchUrls returns documented-first fallback order', () => {
  const urls = buildSearchUrls({ query: 'rank fusion', limit: 3, baseUrl: 'https://huggingface.co/api' });
  assert.equal(urls.length, 3);
  assert.match(urls[0], /daily_papers/);
  assert.match(urls[1], /papers\/search/);
  assert.match(urls[2], /papers\?/);
});

test('searchPapers falls back across payload shapes and normalizes results', async () => {
  const payloads = [
    { papers: [] },
    { papers: [SAMPLE_PAPER] },
  ];
  let callCount = 0;
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    async json() {
      return payloads[callCount++];
    },
  });

  const papers = await searchPapers({
    query: 'rank fusion',
    limit: 3,
    fetchImpl,
  });

  assert.equal(callCount, 2);
  assert.equal(papers.length, 1);
  assert.equal(papers[0].paperId, '2603.01896');
  assert.deepEqual(papers[0].authors, ['Ada Lovelace', 'Alan Turing']);
});

test('paperToMarkdown produces dense markdown with citation fields', () => {
  const markdown = paperToMarkdown(normalizePaper(SAMPLE_PAPER));
  assert.match(markdown, /# Agentic Rank Fusion for Research Systems/);
  assert.match(markdown, /Paper ID: 2603\.01896/);
  assert.match(markdown, /Authors: Ada Lovelace, Alan Turing/);
  assert.match(markdown, /## Abstract/);
});

test('ingestPaperSearch writes deduped research records into ContextFS', async () => {
  const searchPapersImpl = async () => [normalizePaper(SAMPLE_PAPER)];

  const first = await ingestPaperSearch({
    query: 'rank fusion',
    searchPapersImpl,
  });
  const second = await ingestPaperSearch({
    query: 'rank fusion',
    searchPapersImpl,
  });

  const researchDir = path.join(CONTEXTFS_ROOT, NAMESPACES.research);
  const files = fs.readdirSync(researchDir).filter((file) => file.endsWith('.json'));

  assert.equal(first.ingested.length, 1);
  assert.equal(second.ingested[0].deduped, true);
  assert.equal(files.length, 1);
});

test('buildResearchBrief keeps research out of default packs and available in explicit research packs', async () => {
  const brief = await buildResearchBrief({
    query: 'rank fusion',
    template: 'research-brief',
    searchPapersImpl: async () => [normalizePaper(SAMPLE_PAPER)],
  });

  const defaultPack = constructContextPack({
    query: 'rank fusion retrieval',
    maxItems: 5,
    maxChars: 4000,
  });
  const researchPack = constructTemplatedPack({
    template: 'research-brief',
    query: 'rank fusion retrieval',
  });

  assert.equal(brief.query, 'rank fusion');
  assert.equal(brief.citations.length, 1);
  assert.ok(brief.packId);
  assert.equal(defaultPack.items.some((item) => item.namespace === NAMESPACES.research), false);
  assert.ok(researchPack.items.some((item) => item.namespace === NAMESPACES.research));
});
