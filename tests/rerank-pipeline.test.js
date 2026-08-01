'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  PIPELINE_VERSION,
  rerankPipelineSync,
  rerankPipeline,
  computeRankDelta,
  scorePair,
} = require('../scripts/rerank-pipeline');
const { isCliEntrypoint } = require('../scripts/rerank-quality-eval');

const FORCE_LESSON = {
  id: 'lesson-force',
  title: 'Never force-push main',
  whatWentWrong: 'git push --force wiped protected main',
  whatToChange: 'use --force-with-lease or open a PR',
  tags: ['git', 'force-push', 'negative'],
  signal: 'negative',
  relevanceScore: 0.35,
  metadata: { toolsUsed: ['Bash'] },
};

const DECOY_LESSON = {
  id: 'lesson-decoy',
  title: 'Friday deploy tradition',
  content: 'Team ships every Friday afternoon for good luck',
  tags: ['deploy'],
  relevanceScore: 0.95,
};

const WEATHER = {
  id: 'lesson-weather',
  title: 'Weather chat',
  content: 'Small talk about Paris weather',
  relevanceScore: 0.5,
};

describe('A+ rerank pipeline', () => {
  it('exports a pinned pipeline version', () => {
    assert.match(PIPELINE_VERSION, /^2026-07-31/);
  });

  it('detects rerank evaluation CLI execution by resolved path', () => {
    assert.equal(isCliEntrypoint(['node', require.resolve('../scripts/rerank-quality-eval')]), true);
    assert.equal(isCliEntrypoint(['node', __filename]), false);
    assert.equal(isCliEntrypoint(['node']), false);
  });

  it('sync path runs BM25 + MaxSim + heuristic CE fusion', () => {
    const { results, meta } = rerankPipelineSync(
      'git push --force to main',
      [DECOY_LESSON, FORCE_LESSON, WEATHER],
      { topK: 2, toolName: 'Bash' },
    );
    assert.equal(results[0].id, 'lesson-force');
    assert.ok(meta.stages.includes('bm25f'));
    assert.ok(meta.stages.includes('colbert-style-maxsim'));
    assert.ok(meta.stages.includes('heuristic-pair-ce'));
    assert.ok(meta.stages.includes('score-fusion'));
    assert.equal(meta.useLLM, false);
    assert.equal(meta.llmApplied, false);
    assert.ok(typeof results[0].maxSimScore === 'number');
    assert.ok(typeof results[0].fusedScore === 'number');
    assert.equal(results[0].rerankPipelineVersion, PIPELINE_VERSION);
  });

  it('rank-delta reports flip when first-stage order is wrong', () => {
    const original = [DECOY_LESSON, FORCE_LESSON];
    const { results } = rerankPipelineSync('force push main', original, { topK: 1, toolName: 'Bash' });
    const delta = computeRankDelta(original, results);
    assert.equal(delta.originalTopId, 'lesson-decoy');
    assert.equal(delta.rerankedTopId, 'lesson-force');
    assert.equal(delta.flipped, true);
  });

  it('scorePair exposes MaxSim + heuristic components', () => {
    const pair = scorePair('never force push', 'Avoid force-push to main');
    assert.ok(pair.maxSim >= 0 && pair.maxSim <= 1);
    assert.ok(pair.heuristicCe >= 0 && pair.heuristicCe <= 1);
  });

  it('async path falls back when LLM unavailable', async () => {
    const { results, meta } = await rerankPipeline(
      'force push main',
      [DECOY_LESSON, FORCE_LESSON],
      { topK: 1, toolName: 'Bash', useLLM: true },
    );
    assert.equal(results[0].id, 'lesson-force');
    // Without API key: llm-fallback or no llm stage success
    assert.ok(meta.stages.includes('score-fusion'));
  });

  it('entity channel is non-zero when tags match query', () => {
    const { results } = rerankPipelineSync(
      'force-push git',
      [FORCE_LESSON, WEATHER],
      { topK: 1 },
    );
    assert.ok((results[0].entityScore || 0) > 0, 'entityScore should fire on tags');
  });
});
