'use strict';

// Tiny retrieval layer: markdown sections as chunks, keyword-overlap scoring.
// Deliberately simple — the demo's point is the governance around retrieval,
// not the retriever. Swappable for LanceDB/embeddings in production.

const fs = require('node:fs');
const path = require('node:path');

const DOC_FILES = {
  safety: 'safety-procedures.md',
  maintenance: 'maintenance-manual.md',
  quality: 'quality-standards.md',
};

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'do', 'does', 'how', 'what', 'when', 'where',
  'i', 'we', 'to', 'for', 'of', 'on', 'in', 'and', 'or', 'my', 'me', 'can', 'should',
]);

function loadChunks(route) {
  const file = DOC_FILES[route];
  const raw = fs.readFileSync(path.join(__dirname, 'data', file), 'utf8');
  return raw
    .split(/\n(?=## )/)
    .map((section) => section.trim())
    .filter((section) => section.startsWith('## '))
    .map((text) => ({
      source: file,
      heading: text.split('\n')[0].replace(/^## /, ''),
      text,
    }));
}

function tokenize(text) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function retrieve(route, question, topK = 2) {
  const queryTokens = new Set(tokenize(question));
  return loadChunks(route)
    .map((chunk) => {
      const chunkTokens = tokenize(chunk.text);
      const score = chunkTokens.filter((t) => queryTokens.has(t)).length;
      return { ...chunk, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

module.exports = { retrieve, loadChunks, DOC_FILES };
