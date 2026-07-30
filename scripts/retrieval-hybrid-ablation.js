#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  retrieveRelevantLessons,
  retrieveRelevantLessonsAsync,
} = require('./lesson-retrieval');
const { scoreRanking, aggregateRankingScores } = require('./ir-metrics');

const DEFAULT_FIXTURE_PATH = path.join(
  __dirname,
  '..',
  'config',
  'evals',
  'retrieval-hybrid-ablation.json',
);

function createFixtureEmbedder() {
  const concepts = [
    /(erase|directory|tree|rm|delete|folder|snapshot)/i,
    /(overwrite|remote|history|force|push|clobber|trunk|repository)/i,
    /(replay|purchase|twice|duplicate|payment|idempotency|charge)/i,
    /(phone|expired|conversation|session|identifier|mobile|resume)/i,
    /(dashboard|color|design|palette|visual|ui)/i,
  ];
  return async (text) => {
    const vector = concepts.map((pattern) => (pattern.test(String(text || '')) ? 1 : 0));
    if (vector.every((value) => value === 0)) vector.push(0.001);
    else vector.push(0);
    return vector;
  };
}

async function evaluateHybridAblation(options = {}) {
  const fixturePath = options.fixturePath || DEFAULT_FIXTURE_PATH;
  const fixture = options.fixture || JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-hybrid-ablation-'));
  try {
    fs.writeFileSync(
      path.join(tempDir, 'memory-log.jsonl'),
      `${fixture.corpus.map((row) => JSON.stringify({
        ...row,
        timestamp: row.timestamp || new Date().toISOString(),
      })).join('\n')}\n`,
    );
    const kValues = fixture.kValues || [1, 3];
    const embedder = options.embedder || createFixtureEmbedder();
    const lexicalRows = [];
    const hybridRows = [];
    for (const queryCase of fixture.queries) {
      const lexical = retrieveRelevantLessons(queryCase.toolName, queryCase.query, {
        feedbackDir: tempDir,
        maxResults: Math.max(...kValues),
        pragmatic: true,
      });
      const hybrid = await retrieveRelevantLessonsAsync(queryCase.toolName, queryCase.query, {
        feedbackDir: tempDir,
        maxResults: Math.max(...kValues),
        embedder,
        embedderId: options.embedderId || 'deterministic-semantic-fixture',
        includeRetrievalMeta: true,
      });
      lexicalRows.push({
        id: queryCase.id,
        rankedIds: lexical.map((row) => row.id),
        metrics: scoreRanking(lexical, queryCase.qrels, { kValues }),
      });
      hybridRows.push({
        id: queryCase.id,
        rankedIds: hybrid.map((row) => row.id),
        retrieval: hybrid[0]?.retrieval || null,
        metrics: scoreRanking(hybrid, queryCase.qrels, { kValues }),
      });
    }
    const lexical = aggregateRankingScores(lexicalRows.map((row) => row.metrics), { kValues });
    const hybrid = aggregateRankingScores(hybridRows.map((row) => row.metrics), { kValues });
    const summary = {
      mode: options.embedderId || 'deterministic-semantic-fixture',
      queries: fixture.queries.length,
      lexical,
      hybrid,
      lift: {
        mrr: hybrid.mrr - lexical.mrr,
        recallAt3: hybrid['recall@3'] - lexical['recall@3'],
        ndcgAt3: hybrid['ndcg@3'] - lexical['ndcg@3'],
      },
    };
    return {
      passed: hybrid['recall@3'] >= 0.9
        && hybrid.mrr >= lexical.mrr
        && hybrid['ndcg@3'] >= lexical['ndcg@3']
        && hybridRows.every((row) => row.retrieval?.densePool > 0),
      fixturePath,
      summary,
      lexicalRows,
      hybridRows,
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  evaluateHybridAblation().then((result) => {
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 1;
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_FIXTURE_PATH,
  createFixtureEmbedder,
  evaluateHybridAblation,
};
