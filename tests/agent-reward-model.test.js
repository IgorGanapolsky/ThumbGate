'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  allocateTestTimeCompute,
  buildPreferencePairFromEpisodes,
  buildPreferencePairs,
  buildRewardReport,
  computeEpisodeReward,
  episodeToRlTuple,
  rankGateCandidatesByReward,
} = require('../scripts/agent-reward-model');

function makeEpisode(overrides = {}) {
  return {
    sessionId: overrides.sessionId || `episode_${Math.random().toString(16).slice(2)}`,
    recordedAt: new Date().toISOString(),
    hourOfDay: 10,
    dayOfWeek: 1,
    score: 90,
    grade: 'healthy',
    signals: [],
    recommendation: 'Verified before claiming done',
    feedbackCount: 1,
    negativeCount: 0,
    positiveCount: 1,
    categories: ['verification'],
    errorFingerprints: [],
    durationMs: 30 * 60 * 1000,
    tags: [],
    ...overrides,
  };
}

test('computeEpisodeReward scores verified healthy sessions positive', () => {
  const reward = computeEpisodeReward(makeEpisode({
    score: 96,
    positiveCount: 2,
    tags: ['tests'],
  }));

  assert.ok(reward.total > 1, `expected positive reward, got ${reward.total}`);
  assert.equal(reward.label, 'strong_positive');
  assert.equal(reward.evidence.positiveCount, 2);
});

test('computeEpisodeReward penalizes critical repeat mistakes and high-risk exposure', () => {
  const reward = computeEpisodeReward(makeEpisode({
    score: 18,
    grade: 'critical',
    negativeCount: 3,
    positiveCount: 0,
    tags: ['deploy-prod', 'secrets'],
    recommendation: 'Do not deploy with leaked token',
    errorFingerprints: [
      'claimed deployment complete before verifying health',
      'reused a token fixture that scanner treated as real',
    ],
  }));

  assert.ok(reward.total < -2, `expected strong negative reward, got ${reward.total}`);
  assert.equal(reward.label, 'strong_negative');
  assert.ok(reward.actionTags.includes('deploy-prod'));
  assert.ok(reward.actionTags.includes('secrets'));
});

test('episodeToRlTuple exposes state/action/outcome/reward structure', () => {
  const tuple = episodeToRlTuple(makeEpisode({
    sessionId: 'ep_tuple',
    categories: ['billing'],
    tags: ['stripe'],
  }));

  assert.equal(tuple.id, 'ep_tuple');
  assert.deepEqual(tuple.state.categories, ['billing']);
  assert.ok(tuple.action.tags.includes('stripe'));
  assert.equal(tuple.outcome.grade, 'healthy');
  assert.equal(typeof tuple.reward.total, 'number');
});

test('buildPreferencePairFromEpisodes chooses higher reward episode', () => {
  const good = makeEpisode({
    sessionId: 'good',
    score: 95,
    grade: 'healthy',
    positiveCount: 2,
  });
  const bad = makeEpisode({
    sessionId: 'bad',
    score: 20,
    grade: 'critical',
    negativeCount: 2,
    positiveCount: 0,
    errorFingerprints: ['same mistake repeated'],
  });

  const pair = buildPreferencePairFromEpisodes(bad, good);
  assert.equal(pair.metadata.chosenEpisodeId, 'good');
  assert.equal(pair.metadata.rejectedEpisodeId, 'bad');
  assert.ok(pair.metadata.rewardDelta > 0);
  assert.match(pair.prompt, /maximize verified outcomes/);
});

test('buildPreferencePairs creates DPO-style pairs from reward extremes', () => {
  const pairs = buildPreferencePairs([
    makeEpisode({ sessionId: 'bad_1', score: 15, grade: 'critical', negativeCount: 2, positiveCount: 0 }),
    makeEpisode({ sessionId: 'bad_2', score: 35, grade: 'degraded', negativeCount: 1, positiveCount: 0 }),
    makeEpisode({ sessionId: 'good_1', score: 92, grade: 'healthy', positiveCount: 2 }),
    makeEpisode({ sessionId: 'good_2', score: 88, grade: 'healthy', positiveCount: 1 }),
  ]);

  assert.equal(pairs.length, 2);
  assert.ok(pairs.every((pair) => pair.metadata.rewardDelta > 0));
});

test('rankGateCandidatesByReward prioritizes recurring low-reward errors', () => {
  const candidates = rankGateCandidatesByReward([
    makeEpisode({
      sessionId: 'e1',
      score: 10,
      grade: 'critical',
      negativeCount: 2,
      positiveCount: 0,
      errorFingerprints: ['posted public reply without approval'],
      tags: ['public-post'],
    }),
    makeEpisode({
      sessionId: 'e2',
      score: 20,
      grade: 'critical',
      negativeCount: 1,
      positiveCount: 0,
      errorFingerprints: ['posted public reply without approval'],
      tags: ['public-post'],
    }),
    makeEpisode({ sessionId: 'ok', score: 95, grade: 'healthy', positiveCount: 2 }),
  ]);

  assert.ok(candidates.length > 0);
  assert.equal(candidates[0].key, 'error:posted public reply without approval');
  assert.ok(candidates[0].priorityScore > 2);
  assert.match(candidates[0].recommendation, /pre-action prevention rule/);
});

test('allocateTestTimeCompute escalates payments, secrets, and production actions', () => {
  const policy = allocateTestTimeCompute({
    intent: 'Rotate Stripe webhook secret and deploy production billing fix',
    tags: ['billing'],
  });

  assert.equal(policy.budget, 'xhigh');
  assert.ok(policy.maxVerifierSteps >= 8);
  assert.ok(policy.riskTags.includes('payments'));
  assert.ok(policy.riskTags.includes('secrets'));
  assert.ok(policy.riskTags.includes('deploy-prod'));
});

test('allocateTestTimeCompute marks public posting as approval-gated', () => {
  const policy = allocateTestTimeCompute({
    intent: 'Reply to a Bluesky comment promoting ThumbGate',
  });

  assert.equal(policy.budget, 'deep');
  assert.equal(policy.requiresHumanApproval, true);
  assert.ok(policy.riskTags.includes('public-post'));
});

test('allocateTestTimeCompute keeps read-only validation fast', () => {
  const policy = allocateTestTimeCompute({
    command: 'npm run test:agent-reward-model',
    tags: ['tests'],
  });

  assert.equal(policy.budget, 'fast');
  assert.equal(policy.requiresHumanApproval, false);
});

test('buildRewardReport summarizes rewards, preference pairs, and gate candidates', () => {
  const report = buildRewardReport([
    makeEpisode({
      sessionId: 'bad_a',
      score: 12,
      grade: 'critical',
      negativeCount: 2,
      positiveCount: 0,
      errorFingerprints: ['forgot to verify deploy'],
      tags: ['deploy-prod'],
    }),
    makeEpisode({
      sessionId: 'bad_b',
      score: 20,
      grade: 'critical',
      negativeCount: 1,
      positiveCount: 0,
      errorFingerprints: ['forgot to verify deploy'],
      tags: ['deploy-prod'],
    }),
    makeEpisode({ sessionId: 'good_a', score: 98, grade: 'healthy', positiveCount: 2 }),
    makeEpisode({ sessionId: 'good_b', score: 90, grade: 'healthy', positiveCount: 1 }),
  ]);

  assert.equal(report.episodesAnalyzed, 4);
  assert.ok(report.averageReward < 1);
  assert.equal(report.preferencePairs.length, 2);
  assert.ok(report.gateCandidates.some((candidate) => candidate.key === 'error:forgot to verify deploy'));
  assert.equal(report.computePolicy.xhigh, 'payments, secrets, deploy-prod, data-loss, force-push-main');
});
