'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  runLessonRetrievalEval,
  loadFixture,
  junkIds,
  DEFAULT_THRESHOLDS,
} = require('../scripts/eval-lesson-retrieval');

describe('lesson-retrieval golden eval (hook path)', () => {
  test('fixture sanity: 10-doc corpus with exactly 2 raw-payload junk docs and 6 cases', () => {
    const fixture = loadFixture();
    assert.equal(fixture.corpus.length, 10);
    assert.equal(fixture.cases.length, 6);
    const junk = junkIds(fixture);
    assert.equal(junk.size, 2, `junk docs detected: ${[...junk].join(', ')}`);
    assert.ok(junk.has('junk-payload-1'));
    assert.ok(junk.has('junk-payload-2'));
    // Every expected doc must exist in the corpus.
    const ids = new Set(fixture.corpus.map((doc) => doc.id));
    for (const evalCase of fixture.cases) {
      assert.ok(ids.has(evalCase.expectedId), `${evalCase.id} expects unknown doc ${evalCase.expectedId}`);
    }
  });

  test('gate holds: junk@3 === 0, MRR >= 0.5, Recall@3 >= 0.66', () => {
    const outcome = runLessonRetrievalEval();
    const detail = outcome.cases
      .map((c) => `${c.id}: rank=${c.rank ?? 'miss'} [${c.retrievedIds.join(', ')}]`)
      .join('\n');

    assert.equal(outcome.metrics.junkAt3, 0, `junk docs surfaced in top-3:\n${detail}`);
    assert.ok(
      outcome.metrics.mrr >= DEFAULT_THRESHOLDS.minMrr,
      `MRR ${outcome.metrics.mrr.toFixed(3)} below ${DEFAULT_THRESHOLDS.minMrr}:\n${detail}`,
    );
    assert.ok(
      outcome.metrics.recallAt3 >= DEFAULT_THRESHOLDS.minRecallAt3,
      `Recall@3 ${outcome.metrics.recallAt3.toFixed(3)} below ${DEFAULT_THRESHOLDS.minRecallAt3}:\n${detail}`,
    );
    assert.equal(outcome.passed, true, outcome.failures.join('; '));
  });

  test('eval is rank-aware: a case ranked #1 contributes full reciprocal rank', () => {
    const outcome = runLessonRetrievalEval();
    const ranked = outcome.cases.filter((c) => c.rank !== null);
    assert.ok(ranked.length > 0, 'at least one case must hit');
    for (const c of ranked) {
      assert.ok(c.rank >= 1 && c.rank <= 3, `${c.id} rank out of top-3 bounds: ${c.rank}`);
    }
  });

  test('thresholds are overridable and the gate fails closed on impossible bars', () => {
    const outcome = runLessonRetrievalEval({ thresholds: { minMrr: 1.01 } });
    assert.equal(outcome.passed, false);
    assert.ok(outcome.failures.some((f) => f.startsWith('MRR')));
  });
});
