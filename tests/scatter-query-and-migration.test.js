'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ScatterQueryLinter } = require('../src/scatter-query-linter');
const { ZeroDowntimeMigrationGuard } = require('../src/zero-downtime-migration-guard');
const { LazyCiPipeline } = require('../src/lazy-ci-pipeline');

test('ScatterQueryLinter catches queries missing sharding keys', () => {
  const linter = new ScatterQueryLinter();

  // Query missing channel_id
  const badQuery = 'SELECT * FROM messages WHERE user_id = 42;';
  const resBad = linter.lintQuery(badQuery);
  assert.equal(resBad.clean, false);
  assert.equal(resBad.findings.length, 1);
  assert.equal(resBad.findings[0].rule, 'NO_SCATTER_QUERIES');

  // Query with proper channel_id partition key
  const goodQuery = 'SELECT * FROM messages WHERE channel_id = 99 AND user_id = 42;';
  const resGood = linter.lintQuery(goodQuery);
  assert.equal(resGood.clean, true);
});

test('ZeroDowntimeMigrationGuard enforces transition order and entry invariants', () => {
  const guard = new ZeroDowntimeMigrationGuard({
    name: 'migrate-messages-v2',
    sourceTable: 'messages_old',
    targetTable: 'messages_new',
    featureFlagKey: 'ff_messages_v2',
  });

  assert.equal(guard.currentPhase, 'ISOLATE');

  // Cannot skip directly to CUTOVER
  assert.throws(() => {
    guard.advancePhase('CUTOVER', {});
  }, /Invalid transition/);

  // Advance to DOUBLE_WRITE requires wrapper isolation
  assert.throws(() => {
    guard.advancePhase('DOUBLE_WRITE', { wrapperIsolated: false });
  }, /wrapper isolation/);

  const step1 = guard.advancePhase('DOUBLE_WRITE', { wrapperIsolated: true });
  assert.equal(step1.currentPhase, 'DOUBLE_WRITE');

  // Advance to BACKFILL
  const step2 = guard.advancePhase('BACKFILL', {});
  assert.equal(step2.currentPhase, 'BACKFILL');

  // Advance to SHADOW_READ requires backfillComplete
  assert.throws(() => {
    guard.advancePhase('SHADOW_READ', { backfillComplete: false });
  }, /backfill is 100% verified complete/);

  const step3 = guard.advancePhase('SHADOW_READ', { backfillComplete: true });
  assert.equal(step3.currentPhase, 'SHADOW_READ');
});

test('LazyCiPipeline cancels superseded builds and evaluates execution tiers', () => {
  const pipeline = new LazyCiPipeline();

  // Initial build on branch feature-x
  const b1 = pipeline.enqueueBuild({
    prNumber: 42,
    branch: 'feature-x',
    commitSha: 'sha1',
    changedFiles: ['README.md'],
  });
  assert.equal(b1.build.status, 'RUNNING');
  assert.equal(b1.build.tier, 'FAST_DIFF');

  // Fast push of commit sha2 on same PR/branch
  const b2 = pipeline.enqueueBuild({
    prNumber: 42,
    branch: 'feature-x',
    commitSha: 'sha2',
    changedFiles: ['src/core-engine.js'],
  });

  assert.equal(b2.supersededBuildsCancelled.length, 1);
  assert.equal(b2.build.tier, 'FULL_SUITE');

  const active = pipeline.getActiveBuilds();
  const oldBuild = active.find((b) => b.commitSha === 'sha1');
  assert.equal(oldBuild.status, 'CANCELLED_SUPERSEDED');
});
