'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  appendInteractionEvents,
  loadInteractionEvents,
  buildInteractionState,
  evaluateInteractionForegroundGate,
  reviewInteractionState,
} = require('../scripts/workflow-gate-checkpoint');

function tempFeedbackDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-interaction-e2e-'));
}

test('interaction model replays queue churn into conservative claim gates end to end', () => {
  const feedbackDir = tempFeedbackDir();

  appendInteractionEvents([
    {
      type: 'pr_state',
      occurredAt: '2026-05-13T15:23:30Z',
      payload: {
        prNumber: 1982,
        state: 'OPEN',
        mergeStateStatus: 'BEHIND',
        headRefName: 'fix/remaining-log-injection-alerts',
      },
    },
    {
      type: 'ci_check',
      occurredAt: '2026-05-13T15:35:13Z',
      payload: {
        prNumber: 1982,
        name: 'test',
        status: 'COMPLETED',
        conclusion: 'SUCCESS',
      },
    },
    {
      type: 'pr_state',
      occurredAt: '2026-05-13T15:45:39Z',
      payload: {
        prNumber: 1991,
        state: 'OPEN',
        headRefName: 'trunk-merge/pr-1982/eaa19b8d',
      },
    },
    {
      type: 'ci_check',
      occurredAt: '2026-05-13T15:58:11Z',
      payload: {
        prNumber: 1991,
        name: 'test',
        status: 'COMPLETED',
        conclusion: 'SUCCESS',
      },
    },
    {
      type: 'pr_state',
      occurredAt: '2026-05-13T15:58:15Z',
      payload: {
        prNumber: 1991,
        state: 'CLOSED',
        mergedAt: null,
        headRefName: 'trunk-merge/pr-1982/eaa19b8d',
      },
    },
    {
      type: 'publish_verification',
      occurredAt: '2026-05-13T15:59:00Z',
      payload: {
        packageName: 'thumbgate',
        version: '1.18.0',
        latest: '1.18.0',
      },
    },
    {
      type: 'security_verification',
      occurredAt: '2026-05-13T15:59:10Z',
      payload: {
        codeScanningOpen: 0,
        dependabotOpen: 0,
        secretScanningOpen: 0,
      },
    },
  ], { feedbackDir, source: 'e2e-test' });

  const events = loadInteractionEvents({ feedbackDir });
  const state = buildInteractionState(events, { targetPr: 1982 });

  assert.equal(events.length, 7);
  assert.equal(state.phase, 'queue_recycled');
  assert.equal(state.claims.canClaimPublished, true);
  assert.equal(state.claims.canClaimSecurityClear, true);
  assert.equal(state.claims.canClaimMerged, false);
  assert.equal(state.claims.canClaimComplete, false);

  const gate = evaluateInteractionForegroundGate({
    kind: 'claim',
    text: 'Everything is merged, published, security clear, and complete.',
  }, state);
  assert.equal(gate.decision, 'block');
  assert.deepEqual(gate.blocked.map((entry) => entry.id).sort(), [
    'complete_claim_requires_all_verifications',
    'merged_claim_requires_merge_commit',
  ]);

  const review = reviewInteractionState(state);
  assert.ok(review.recommendations.some((entry) => entry.id === 'summarize_queue_recycle'));
  assert.equal(review.recommendations.some((entry) => entry.id === 'wait_for_protected_queue'), false);
});
