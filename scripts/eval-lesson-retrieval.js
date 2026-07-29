#!/usr/bin/env node
'use strict';

/**
 * Rank-aware golden eval of the hook lesson-retrieval path.
 *
 * scripts/eval-rag.js evaluates the ContextFS pack subsystem; nothing guarded
 * the path PreToolUse actually runs. This eval exercises exactly that chain:
 * hook-pre-tool-use.extractActionContext → retrieveWithRerankingSync →
 * lesson-hygiene.filterRetrievedLessons, against a fixture corpus injected
 * through the existing feedbackDir option (a temp dir memory-log.jsonl), so
 * it never touches ~/.thumbgate or repo operator data.
 *
 * Metrics: Recall@3, MRR (reciprocal rank of the expected doc in the top-3),
 * junk@3 (raw-payload docs surfacing in top-3).
 * Gate: junk@3 === 0, MRR >= 0.5, Recall@3 >= 0.66.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const FIXTURE_PATH = path.join(__dirname, '..', 'tests', 'fixtures', 'lesson-retrieval-golden.json');
const TOP_K = 3;

const DEFAULT_THRESHOLDS = Object.freeze({
  maxJunkAt3: 0,
  minMrr: 0.5,
  minRecallAt3: 0.66,
});

function loadFixture(fixturePath = FIXTURE_PATH) {
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function junkIds(fixture) {
  const { isRawHookPayload } = require('./lesson-hygiene');
  return new Set(
    fixture.corpus
      .filter((doc) => isRawHookPayload(`${doc.title || ''}\n${doc.content || ''}`))
      .map((doc) => doc.id),
  );
}

function materializeCorpus(fixture) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-lesson-eval-'));
  fs.writeFileSync(
    path.join(dir, 'memory-log.jsonl'),
    fixture.corpus.map((doc) => JSON.stringify(doc)).join('\n') + '\n',
  );
  return dir;
}

function runLessonRetrievalEval(options = {}) {
  const fixture = options.fixture || loadFixture(options.fixturePath);
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds || {}) };
  const { extractActionContext } = require('./hook-pre-tool-use');
  const { retrieveWithRerankingSync } = require('./cross-encoder-reranker');
  const { filterRetrievedLessons } = require('./lesson-hygiene');
  const junk = junkIds(fixture);

  const feedbackDir = materializeCorpus(fixture);
  const cases = [];
  let junkAt3 = 0;
  let reciprocalSum = 0;
  let hits = 0;

  try {
    for (const evalCase of fixture.cases) {
      const actionContext = extractActionContext(evalCase.toolName, evalCase.toolInput);
      const retrieved = retrieveWithRerankingSync(evalCase.toolName, actionContext, {
        candidateCount: 20,
        maxResults: TOP_K,
        feedbackDir,
      });
      // Mirror the hook: hygiene filter runs before anything is rendered.
      const top3 = filterRetrievedLessons(
        Array.isArray(retrieved) ? retrieved : [],
        (lesson) => `${lesson.title || ''}\n${lesson.content || ''}`,
      ).slice(0, TOP_K);

      const ids = top3.map((l) => l.id);
      const rank = ids.indexOf(evalCase.expectedId); // 0-based; -1 = miss
      const caseJunk = ids.filter((id) => junk.has(id)).length;
      junkAt3 += caseJunk;
      if (rank >= 0) {
        hits += 1;
        reciprocalSum += 1 / (rank + 1);
      }
      cases.push({
        id: evalCase.id,
        actionContext,
        expectedId: evalCase.expectedId,
        retrievedIds: ids,
        rank: rank >= 0 ? rank + 1 : null,
        junkAt3: caseJunk,
      });
    }
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }

  const total = fixture.cases.length;
  const recallAt3 = total > 0 ? hits / total : 0;
  const mrr = total > 0 ? reciprocalSum / total : 0;

  const failures = [];
  if (junkAt3 > thresholds.maxJunkAt3) failures.push(`junk@3 ${junkAt3} > ${thresholds.maxJunkAt3}`);
  if (mrr < thresholds.minMrr) failures.push(`MRR ${mrr.toFixed(3)} < ${thresholds.minMrr}`);
  if (recallAt3 < thresholds.minRecallAt3) failures.push(`Recall@3 ${recallAt3.toFixed(3)} < ${thresholds.minRecallAt3}`);

  return {
    cases,
    metrics: { recallAt3, mrr, junkAt3, casesEvaluated: total, junkDocsInCorpus: junk.size },
    thresholds,
    passed: failures.length === 0,
    failures,
  };
}

// SonarCloud S3403: require.main === module misfires under strict inference.
if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  const outcome = runLessonRetrievalEval();
  for (const c of outcome.cases) {
    const rank = c.rank === null ? 'miss' : `rank ${c.rank}`;
    console.log(`${c.id}: expected ${c.expectedId} -> ${rank} [${c.retrievedIds.join(', ')}]${c.junkAt3 ? ` junk=${c.junkAt3}` : ''}`);
  }
  const m = outcome.metrics;
  console.log(`Recall@3 ${m.recallAt3.toFixed(3)} | MRR ${m.mrr.toFixed(3)} | junk@3 ${m.junkAt3} | cases ${m.casesEvaluated}`);
  console.log(outcome.passed ? 'GATE: PASS' : `GATE: FAIL (${outcome.failures.join('; ')})`);
  if (!outcome.passed) process.exitCode = 1;
}

module.exports = {
  runLessonRetrievalEval,
  loadFixture,
  junkIds,
  DEFAULT_THRESHOLDS,
  FIXTURE_PATH,
  TOP_K,
};
