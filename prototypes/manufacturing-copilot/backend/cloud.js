'use strict';

const fs = require('node:fs');
const path = require('node:path');

const vectorIndex = require('./vector-index');

const DATA_DIR = path.join(__dirname, '../data');

const SOURCES = {
  safety: {
    id: 'plant-safety-cloud-bucket',
    file: 'safety-procedures.md',
    label: 'Safety Procedures',
  },
  maintenance: {
    id: 'maintenance-manual-cloud-bucket',
    file: 'maintenance-manual.md',
    label: 'Maintenance Manuals',
  },
  quality: {
    id: 'quality-standards-cloud-bucket',
    file: 'quality-standards.md',
    label: 'Quality Standards',
  },
};

const ROUTE_SYNONYMS = {
  safety: ['lockout', 'tagout', 'loto', 'confined', 'spill', 'ppe', 'permit', 'guard', 'interlock', 'safety', 'hazard', 'bypass'],
  maintenance: ['press', 'hydraulic', 'filter', 'belt', 'bearing', 'spindle', 'compressor', 'repair', 'service', 'replace', 'tracking', 'torque'],
  quality: ['quality', 'inspection', 'tolerance', 'gauge', 'ncr', 'nonconforming', 'defect', 'weld', 'coating', 'thickness', 'sample', 'reject'],
};

function readSource(route) {
  const source = SOURCES[route];
  if (!source) throw new Error(`Unknown document route: ${route}`);
  const text = fs.readFileSync(path.join(DATA_DIR, source.file), 'utf8');
  return { ...source, text };
}

function chunkMarkdown(route) {
  const source = readSource(route);
  const sections = source.text
    .split(/\n(?=##\s+)/)
    .map((section) => section.trim())
    .filter(Boolean);
  return sections.map((text, index) => {
    const title = text.match(/^##\s+(.+)$/m)?.[1] || source.label;
    const docId = title.match(/\b[A-Z]{2}-\d{3}\b/)?.[0] || `${route.toUpperCase()}-${index + 1}`;
    return {
      id: `${route}-${index + 1}`,
      docId,
      route,
      source: source.label,
      cloudSource: source.id,
      title,
      text,
    };
  });
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'you', 'your', 'what', 'when', 'where', 'which',
  'how', 'who', 'why', 'that', 'this', 'with', 'can', 'should', 'must', 'all',
  'any', 'has', 'have', 'does', 'need', 'before', 'after', 'into', 'about',
]);

function tokenize(text) {
  return new Set(
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2 && !STOPWORDS.has(token))
  );
}

function keywordScore(chunk, questionTokens, routeBoosts, question) {
  const chunkTokens = tokenize(chunk.text);
  let score = 0;
  for (const token of questionTokens) {
    if (chunkTokens.has(token)) score += 1;
    if (routeBoosts.has(token)) score += 1;
  }
  if (chunk.text.toLowerCase().includes('loto') && /\b(lockout|tagout|loto|press|bypass)\b/i.test(question)) score += 3;
  if (chunk.text.toLowerCase().includes('interlock') && /\b(interlock|guard|bypass)\b/i.test(question)) score += 3;
  return score;
}

// Hybrid retrieval: HNSW cosine similarity (semantic) + keyword overlap
// (exact part numbers / procedure IDs). Vector signal is scaled so the
// downstream confidence gate threshold (2) keeps its meaning; when the vector
// layer is unavailable the keyword score alone preserves old behavior.
const VECTOR_WEIGHT = 6;

async function retrieve(route, question, limit = 3) {
  const questionTokens = tokenize(question);
  const routeBoosts = new Set(ROUTE_SYNONYMS[route] || []);
  const chunks = chunkMarkdown(route);
  const sims = await vectorIndex.search(route, chunks, question);
  return chunks
    .map((chunk) => {
      const keyword = keywordScore(chunk, questionTokens, routeBoosts, question);
      const sim = sims ? sims.get(chunk.id) ?? 0 : null;
      const score = Number((keyword + (sim !== null ? sim * VECTOR_WEIGHT : 0)).toFixed(2));
      return {
        ...chunk,
        score,
        keywordScore: keyword,
        vectorSim: sim === null ? null : Number(sim.toFixed(3)),
        retrievalMode: sims ? 'hybrid-hnsw' : 'keyword',
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function warmupVectorIndex() {
  const chunksByRoute = Object.fromEntries(
    Object.keys(SOURCES).map((route) => [route, chunkMarkdown(route)])
  );
  return vectorIndex.warmup(chunksByRoute);
}

function buildCloudStatus() {
  return {
    provider: process.env.MANUFACTURING_CLOUD_PROVIDER || 'local-cloud-sim',
    storage: Object.fromEntries(
      Object.entries(SOURCES).map(([route, source]) => [route, source.id])
    ),
    retrieval: vectorIndex.status(),
    policyEngine: 'ThumbGate gate chain',
    observability: process.env.LANGSMITH_API_KEY ? 'LangSmith remote traces enabled' : 'LangSmith local trace mirror',
  };
}

module.exports = {
  SOURCES,
  retrieve,
  warmupVectorIndex,
  buildCloudStatus,
};
