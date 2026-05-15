'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  appendInteractionEvent,
  getInteractionEventsPath,
  loadInteractionEvents,
  normalizeInteractionEvent,
  normalizeInteractionCheckKey,
  buildInteractionState,
  evaluateInteractionForegroundGate,
  reviewInteractionState,
} = require('../scripts/workflow-gate-checkpoint');

function tempFeedbackDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-interaction-'));
}

function event(type, payload, occurredAt = '2026-05-13T15:00:00.000Z') {
  return normalizeInteractionEvent({ type, payload, occurredAt, source: 'test' });
}

test('normalizeInteractionCheckKey trims separators without backtracking-prone regex', () => {
  assert.equal(normalizeInteractionCheckKey('  SonarCloud Code Analysis  '), 'sonarcloud_code_analysis');
  assert.equal(normalizeInteractionCheckKey('___'), 'unknown');
});

test('interaction event store appends sanitized JSONL events', () => {
  const feedbackDir = tempFeedbackDir();
  const written = appendInteractionEvent({
    type: 'tool_intent',
    payload: {
      command: 'gh pr merge 1982\n--squash',
    },
    occurredAt: '2026-05-13T15:10:00Z',
  }, { feedbackDir, source: 'unit-test' });

  assert.match(written.id, /^evt_/);
  assert.equal(written.payload.command, 'gh pr merge 1982\\n--squash');
  assert.equal(getInteractionEventsPath({ feedbackDir }), path.join(feedbackDir, 'interaction-events.jsonl'));

  const loaded = loadInteractionEvents({ feedbackDir });
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].type, 'tool_intent');
});

test('state reducer treats closed synthetic queue PR as recycled, not merged', () => {
  const state = buildInteractionState([
    event('pr_state', {
      prNumber: 1982,
      state: 'OPEN',
      mergeStateStatus: 'BEHIND',
      headRefName: 'fix/remaining-log-injection-alerts',
    }, '2026-05-13T15:00:00Z'),
    event('pr_state', {
      prNumber: 1991,
      state: 'OPEN',
      headRefName: 'trunk-merge/pr-1982/eaa19b8d',
    }, '2026-05-13T15:05:00Z'),
    event('ci_check', {
      prNumber: 1991,
      name: 'test',
      status: 'COMPLETED',
      conclusion: 'SUCCESS',
    }, '2026-05-13T15:10:00Z'),
    event('pr_state', {
      prNumber: 1991,
      state: 'CLOSED',
      mergedAt: null,
      headRefName: 'trunk-merge/pr-1982/eaa19b8d',
    }, '2026-05-13T15:11:00Z'),
  ]);

  assert.equal(state.phase, 'queue_recycled');
  assert.equal(state.queueRecycleCount, 1);
  assert.equal(state.claims.canClaimMerged, false);
  assert.equal(state.claims.canClaimComplete, false);
});

test('foreground gate blocks completion claims until merge publish and security are verified', () => {
  const state = buildInteractionState([
    event('pr_state', {
      prNumber: 1982,
      state: 'OPEN',
      mergeStateStatus: 'BEHIND',
      headRefName: 'fix/remaining-log-injection-alerts',
    }),
    event('publish_verification', {
      packageName: 'thumbgate',
      version: '1.18.0',
      latest: '1.18.0',
      ok: true,
    }),
  ]);

  const result = evaluateInteractionForegroundGate({
    kind: 'claim',
    text: 'Everything is complete, merged, published, and no GitHub security issues remain.',
  }, state);

  assert.equal(result.decision, 'block');
  assert.deepEqual(result.blocked.map((entry) => entry.id).sort(), [
    'complete_claim_requires_all_verifications',
    'merged_claim_requires_merge_commit',
    'security_clear_claim_requires_alert_counts',
  ]);
});

test('verified merged published security-clear state allows completion claim', () => {
  const state = buildInteractionState([
    event('pr_state', {
      prNumber: 1982,
      state: 'CLOSED',
      mergedAt: '2026-05-13T16:30:00Z',
      mergeCommit: 'abc123',
      headRefName: 'fix/remaining-log-injection-alerts',
    }),
    event('publish_verification', {
      packageName: 'thumbgate',
      version: '1.18.0',
      latest: '1.18.0',
    }),
    event('security_verification', {
      codeScanningOpen: 0,
      dependabotOpen: 0,
      secretScanningOpen: 0,
    }),
  ]);

  assert.equal(state.phase, 'complete_verified');
  assert.equal(state.claims.canClaimComplete, true);

  const result = evaluateInteractionForegroundGate({
    kind: 'claim',
    text: 'Everything is complete, merged, published, and security clear.',
  }, state);
  assert.equal(result.decision, 'allow');
});

test('background reviewer proposes high-ROI rules for queue churn and missing verification', () => {
  const state = buildInteractionState([
    event('pr_state', {
      prNumber: 1993,
      state: 'CLOSED',
      mergedAt: null,
      headRefName: 'trunk-merge/pr-1982/80ccd9',
    }),
  ]);

  const review = reviewInteractionState(state);
  const ids = review.recommendations.map((entry) => entry.id);

  assert.ok(ids.includes('summarize_queue_recycle'));
  assert.ok(ids.includes('verify_npm_before_release_claim'));
  assert.ok(ids.includes('verify_security_alert_counts'));
  assert.ok(review.proposedRules.every((rule) => typeof rule === 'string' && rule.length > 20));
});
