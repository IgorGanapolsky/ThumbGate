'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  advanceSalesLead,
  sanitizeSalesLead,
} = require('../scripts/sales-pipeline');
const {
  STAGE_SIGNAL_FRESHNESS_MS,
  buildRemediationRow,
  buildRevenueEvidenceRemediationQueue,
  isCliInvocation,
  loadTargetRecords,
  parseArgs,
  renderRevenueEvidenceRemediationMarkdown,
  runCli,
  shellQuote,
} = require('../scripts/revenue-evidence-remediation');

const NOW = '2026-07-16T12:00:00.000Z';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-revenue-remediation-'));
}

function event(kind, at, toStage, {
  source = 'reddit',
  reference = null,
  evidence = {},
  fromStage = null,
} = {}) {
  return {
    fromStage,
    toStage,
    at,
    actor: 'test-fixture',
    channel: source,
    evidence: {
      kind,
      source,
      reference: reference || `receipt:${kind}:${at}`,
      ...evidence,
    },
  };
}

function lead(stage, history = [], extra = {}) {
  return sanitizeSalesLead({
    leadId: extra.leadId || `lead_${stage}`,
    source: extra.source || 'reddit',
    channel: extra.channel || 'reddit_comment',
    stage,
    history,
    outbound: extra.outbound,
    revenue: extra.revenue,
  });
}

function writeState(statePath, leads) {
  fs.writeFileSync(statePath, `${leads.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8');
}

test('ranks a verified unanswered buyer reply above every unverified repair row', () => {
  const replied = lead('replied', [
    event('platform_send_receipt', '2026-07-13T10:00:00.000Z', 'contacted'),
    event('buyer_reply', '2026-07-14T10:00:00.000Z', 'replied'),
  ], { leadId: 'verified_warm_reply' });
  const checkout = lead('checkout_started', [], { leadId: 'unverified_checkout' });
  const intake = lead('sprint_intake', [], { leadId: 'unverified_intake' });
  const queue = buildRevenueEvidenceRemediationQueue({ leads: [checkout, intake, replied], now: NOW });

  assert.equal(queue.rows[0].leadId, 'verified_warm_reply');
  assert.equal(queue.rows[0].queueClass, 'approval_ready');
  assert.equal(queue.rows[0].actionStatus, 'approval_required_qualification_reply');
  assert.equal(queue.rows[0].readyForOutbound, true);
  assert.equal(queue.rows[0].requiresApproval, true);
  assert.equal(queue.rows[0].sameDayEvidencePriority, true);
  assert.equal(queue.rows[0].sameDayReviewPriority, false);
  assert.equal(queue.summary.sameDayEvidencePriority, 1);
  assert.equal(queue.rows[0].approvalPhrase, 'APPROVE SEND THUMBGATE QUALIFICATION REPLY TO VERIFIED_WARM_REPLY');
  assert.equal(queue.primaryAction.externalSideEffectAuthorized, false);
  assert.ok(queue.rows[0].priorityScore > queue.rows[1].priorityScore);
});

test('stale buyer reply is not approval-ready or same-day evidence priority', () => {
  const staleReply = lead('replied', [
    event('buyer_reply', '2026-06-19T16:29:29.419Z', 'replied'),
  ], { leadId: 'stale_buyer_reply' });
  const row = buildRemediationRow(staleReply, {}, { now: NOW });

  assert.equal(row.actionStatus, 'hold_stale_buyer_reply');
  assert.equal(row.queueClass, 'monitor');
  assert.equal(row.readyForOutbound, false);
  assert.equal(row.requiresApproval, false);
  assert.equal(row.approvalPhrase, null);
  assert.equal(row.sameDayEvidencePriority, false);
  assert.equal(row.sameDayReviewPriority, false);
  assert.ok(row.blockers.some((blocker) => blocker.code === 'buyer_reply_stale'));
});

test('future-dated reply cannot become approval-ready', () => {
  const futureReply = lead('replied', [
    event('buyer_reply', '2026-07-16T12:06:00.000Z', 'replied'),
  ], { leadId: 'future_buyer_reply' });
  const row = buildRemediationRow(futureReply, {}, { now: NOW });

  assert.equal(row.actionStatus, 'hold_buyer_reply_time_invalid');
  assert.equal(row.queueClass, 'monitor');
  assert.equal(row.sameDayEvidencePriority, false);
  assert.equal(row.sameDayReviewPriority, false);
  assert.ok(row.blockers.some((blocker) => blocker.code === 'buyer_reply_time_invalid'));
});

test('stale unverified high-intent label loses same-day priority without hiding evidence debt', () => {
  const staleCheckout = lead('checkout_started', [
    event('operator_note', '2026-06-30T15:21:27.059Z', 'checkout_started'),
  ], { leadId: 'stale_unverified_checkout' });
  const row = buildRemediationRow(staleCheckout, {}, { now: NOW });

  assert.equal(row.queueClass, 'remediation');
  assert.equal(row.actionStatus, 'hold_unverified_stage_evidence');
  assert.equal(row.stageEvidenceVerified, false);
  assert.equal(row.stageEnteredAt, '2026-06-30T15:21:27.059Z');
  assert.equal(row.stageSignalAt, '2026-06-30T15:21:27.059Z');
  assert.equal(row.stageSignalFresh, false);
  assert.equal(row.sameDayEvidencePriority, false);
  assert.equal(row.sameDayReviewPriority, false);
  assert.ok(row.blockers.some((blocker) => blocker.code === 'stage_label_stale'));
});

test('stage-signal freshness includes exactly 14 days and excludes the next millisecond', () => {
  const boundary = buildRemediationRow(lead('checkout_started', [
    event('operator_note', '2026-07-02T12:00:00.000Z', 'checkout_started'),
  ], { leadId: 'boundary_checkout' }), {}, { now: NOW });
  const stale = buildRemediationRow(lead('checkout_started', [
    event('operator_note', '2026-07-02T11:59:59.999Z', 'checkout_started'),
  ], { leadId: 'stale_boundary_checkout' }), {}, { now: NOW });

  assert.equal(boundary.stageSignalFresh, true);
  assert.equal(boundary.stageSignalAgeMs, STAGE_SIGNAL_FRESHNESS_MS);
  assert.equal(boundary.sameDayEvidencePriority, false);
  assert.equal(boundary.sameDayReviewPriority, true);
  assert.equal(stale.stageSignalFresh, false);
  assert.equal(stale.stageSignalAgeMs, STAGE_SIGNAL_FRESHNESS_MS + 1);
  assert.equal(stale.sameDayEvidencePriority, false);
  assert.equal(stale.sameDayReviewPriority, false);
});

test('same-stage outbound activity does not refresh an old unverified buyer-intent label', () => {
  const staleCheckout = lead('checkout_started', [
    event('operator_note', '2026-06-30T15:21:27.059Z', 'checkout_started'),
    event('platform_send_receipt', '2026-07-15T12:00:00.000Z', 'checkout_started', {
      fromStage: 'checkout_started',
    }),
  ], { leadId: 'stale_checkout_with_new_send' });
  const row = buildRemediationRow(staleCheckout, {}, { now: NOW });

  assert.equal(row.stageEnteredAt, '2026-06-30T15:21:27.059Z');
  assert.equal(row.stageSignalAt, '2026-06-30T15:21:27.059Z');
  assert.equal(row.stageSignalFresh, false);
  assert.equal(row.sameDayEvidencePriority, false);
  assert.equal(row.sameDayReviewPriority, false);
});

test('future-dated unverified stage signal fails closed beyond clock skew', () => {
  const futureCheckout = lead('checkout_started', [
    event('operator_note', '2026-07-16T12:05:00.001Z', 'checkout_started'),
  ], { leadId: 'future_checkout' });
  const row = buildRemediationRow(futureCheckout, {}, { now: NOW });

  assert.equal(row.stageSignalTimestampValid, false);
  assert.equal(row.stageSignalFresh, false);
  assert.equal(row.sameDayEvidencePriority, false);
  assert.equal(row.sameDayReviewPriority, false);
  assert.ok(row.blockers.some((blocker) => blocker.code === 'stage_signal_time_invalid'));
});

test('every verified high-intent stage expires after the same 14-day window', () => {
  const cases = [
    ['call_booked', 'booking_confirmation'],
    ['checkout_started', 'buyer_checkout_confirmation'],
    ['sprint_intake', 'intake_submission'],
  ];

  for (const [stage, evidenceKind] of cases) {
    const row = buildRemediationRow(lead(stage, [
      event(evidenceKind, '2026-07-02T11:59:59.999Z', stage),
    ], { leadId: `stale_verified_${stage}` }), {}, { now: NOW });

    assert.equal(row.stageEvidenceVerified, true, stage);
    assert.equal(row.stageSignalFresh, false, stage);
    assert.equal(row.sameDayEvidencePriority, false, stage);
    assert.equal(row.sameDayReviewPriority, false, stage);
    assert.ok(row.blockers.some((blocker) => blocker.code === 'stage_signal_stale'), stage);
  }
});

test('current-stage entry is selected by timestamp even when history is out of order', () => {
  const checkout = lead('checkout_started', [
    event('operator_note', '2026-07-15T12:00:00.000Z', 'checkout_started', {
      fromStage: 'replied',
    }),
    event('operator_note', '2026-06-30T15:21:27.059Z', 'checkout_started', {
      fromStage: 'replied',
    }),
  ], { leadId: 'out_of_order_checkout' });
  const row = buildRemediationRow(checkout, {}, { now: NOW });

  assert.equal(row.stageEnteredAt, '2026-07-15T12:00:00.000Z');
  assert.equal(row.stageSignalFresh, true);
  assert.equal(row.sameDayEvidencePriority, false);
  assert.equal(row.sameDayReviewPriority, true);
});

test('future stage signals inside the five-minute skew allowance remain valid', () => {
  const checkout = lead('checkout_started', [
    event('operator_note', '2026-07-16T12:05:00.000Z', 'checkout_started'),
  ], { leadId: 'within_skew_checkout' });
  const row = buildRemediationRow(checkout, {}, { now: NOW });

  assert.equal(row.stageSignalTimestampValid, true);
  assert.equal(row.stageSignalAgeMs, 0);
  assert.equal(row.stageSignalFresh, true);
  assert.equal(row.sameDayEvidencePriority, false);
  assert.equal(row.sameDayReviewPriority, true);
});

test('verified same-day evidence, fresh-label review, and unknown-cost holds are counted separately', () => {
  const verifiedReply = lead('replied', [
    event('platform_send_receipt', '2026-07-15T10:00:00.000Z', 'contacted'),
    event('buyer_reply', '2026-07-15T11:00:00.000Z', 'replied'),
  ], { leadId: 'verified_same_day_reply' });
  const reviewOnlyCheckout = lead('checkout_started', [
    event('operator_note', '2026-07-15T12:00:00.000Z', 'checkout_started'),
  ], { leadId: 'fresh_label_review_only' });
  const costHeldReply = lead('replied', [
    event('buyer_reply', '2026-07-15T11:00:00.000Z', 'replied', {
      source: 'marketplace',
    }),
  ], {
    leadId: 'verified_reply_unknown_cost',
    source: 'marketplace',
    channel: 'marketplace',
  });
  const queue = buildRevenueEvidenceRemediationQueue({
    leads: [reviewOnlyCheckout, costHeldReply, verifiedReply],
    targets: [{ leadId: costHeldReply.leadId, source: 'marketplace', channel: 'marketplace' }],
    now: NOW,
  });
  const byId = new Map(queue.rows.map((row) => [row.leadId, row]));
  const markdown = renderRevenueEvidenceRemediationMarkdown(queue);

  assert.equal(byId.get('verified_same_day_reply').sameDayEvidencePriority, true);
  assert.equal(byId.get('verified_same_day_reply').sameDayReviewPriority, false);
  assert.equal(byId.get('fresh_label_review_only').sameDayEvidencePriority, false);
  assert.equal(byId.get('fresh_label_review_only').sameDayReviewPriority, true);
  assert.equal(byId.get('verified_reply_unknown_cost').stageEvidenceVerified, true);
  assert.equal(byId.get('verified_reply_unknown_cost').zeroSpendStatus, 'hold_unverified_cost');
  assert.equal(byId.get('verified_reply_unknown_cost').sameDayEvidencePriority, false);
  assert.equal(byId.get('verified_reply_unknown_cost').sameDayReviewPriority, false);
  assert.equal(queue.summary.sameDayEvidencePriority, 1);
  assert.equal(queue.summary.sameDayReviewPriority, 1);
  assert.equal(queue.primaryAction.sameDayEvidencePriority, true);
  assert.equal(queue.primaryAction.sameDayReviewPriority, false);
  assert.match(markdown, /Verified same-day evidence-priority rows: 1/);
  assert.match(markdown, /Fresh-label read-only review rows: 1/);
});

test('unverified high-intent stages expose exact receipt repairs without inventing intent', () => {
  const queue = buildRevenueEvidenceRemediationQueue({
    leads: [
      lead('contacted', [], { leadId: 'missing_send' }),
      lead('replied', [], { leadId: 'missing_reply' }),
      lead('sprint_intake', [], { leadId: 'missing_intake' }),
      lead('checkout_started', [], { leadId: 'missing_checkout_confirmation' }),
    ],
    now: NOW,
  });
  const byId = new Map(queue.rows.map((row) => [row.leadId, row]));

  assert.equal(byId.get('missing_send').stageEvidenceRepair.preferredEvidenceKind, 'platform_send_receipt');
  assert.equal(byId.get('missing_reply').stageEvidenceRepair.preferredEvidenceKind, 'buyer_reply');
  assert.equal(byId.get('missing_intake').stageEvidenceRepair.preferredEvidenceKind, 'intake_submission');
  assert.equal(byId.get('missing_checkout_confirmation').stageEvidenceRepair.preferredEvidenceKind, 'buyer_checkout_confirmation');
  for (const row of queue.rows) {
    assert.equal(row.queueClass, 'remediation');
    assert.equal(row.readyForOutbound, false);
    assert.equal(row.stageEvidenceRepair.commandTemplate.executable, false);
    assert.match(row.stageEvidenceRepair.commandTemplate.display, /REPLACE_WITH_ACTUAL_/);
    assert.ok(row.blockers.some((blocker) => blocker.code === 'stage_evidence_missing'));
  }
});

test('ambiguous cost and missing stage evidence remain independent blockers', () => {
  const row = buildRemediationRow(
    lead('replied', [], { leadId: 'ambiguous_marketplace', source: 'marketplace', channel: 'marketplace' }),
    { source: 'marketplace', channel: 'marketplace' },
    { now: NOW }
  );

  assert.equal(row.zeroSpendStatus, 'hold_unverified_cost');
  assert.equal(row.queueClass, 'remediation');
  assert.deepEqual(row.blockers.map((blocker) => blocker.code), [
    'cost_unverified',
    'stage_evidence_missing',
    'stage_label_stale',
  ]);
  assert.match(row.safeNextAction, /complete downstream terms read-only/i);
  assert.equal(row.readyForOutbound, false);
});

test('target enrichment cannot disguise the durable lead acquisition route', () => {
  const row = buildRemediationRow(
    lead('targeted', [], { leadId: 'route_relabel', source: 'marketplace', channel: 'marketplace' }),
    { source: 'reddit', channel: 'reddit_comment' },
    { now: NOW }
  );

  assert.equal(row.zeroSpendStatus, 'hold_unverified_cost');
  assert.equal(row.queueClass, 'remediation');
  assert.equal(row.readyForOutbound, false);
  assert.ok(row.blockers.some((blocker) => blocker.code === 'cost_unverified'));
});

test('paid or revenue-share acquisition is discarded and replaced with a zero-cost route', () => {
  const queue = buildRevenueEvidenceRemediationQueue({
    leads: [lead('targeted', [], { leadId: 'paid_lead_access' })],
    targets: [{ leadId: 'paid_lead_access', requiresRevenueShare: true }],
    now: NOW,
  });

  assert.equal(queue.rows[0].queueClass, 'discarded');
  assert.equal(queue.rows[0].zeroSpendStatus, 'discarded_paid_requirement');
  assert.match(queue.rows[0].safeNextAction, /warm conversation|owned intake|direct organic/i);
  assert.equal(queue.summary.discardedPaidRequirement, 1);
  assert.equal(queue.primaryAction, null);
});

test('repair templates fail closed when someone tries to execute placeholders', () => {
  const tempDir = makeTempDir();
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');
  const staleReply = lead('replied', [], { leadId: 'placeholder_attack' });
  writeState(statePath, [staleReply]);
  const row = buildRemediationRow(staleReply, {}, { now: NOW });

  assert.equal(row.stageEvidenceRepair.commandTemplate.executable, false);
  assert.throws(() => advanceSalesLead({
    leadId: staleReply.leadId,
    stage: 'replied',
    evidenceKind: 'buyer_reply',
    evidenceSource: 'REPLACE_WITH_ACTUAL_SOURCE',
    evidenceRef: 'REPLACE_WITH_ACTUAL_RECEIPT',
    timestamp: NOW,
  }, { statePath }), /Replace evidence placeholders/);
  assert.equal(fs.readFileSync(statePath, 'utf8').trim().split('\n').length, 1);

  const tampered = lead('replied', [
    event('buyer_reply', '2026-07-15T12:00:00.000Z', 'replied', {
      evidence: {
        source: 'REPLACE_WITH_PLATFORM',
        reference: 'REPLACE_WITH_PLATFORM_RECEIPT',
      },
    }),
  ], { leadId: 'stored_placeholder_attack' });
  const tamperedRow = buildRemediationRow(tampered, {}, { now: NOW });

  assert.equal(tamperedRow.stageEvidenceVerified, false);
  assert.equal(tamperedRow.preferredStageEvidenceAt, null);
  assert.equal(tamperedRow.sameDayEvidencePriority, false);
  assert.equal(tamperedRow.sameDayReviewPriority, true);
  assert.equal(tamperedRow.actionStatus, 'hold_unverified_stage_evidence');
});

test('payment repair uses authenticated reconciliation and never a manual paid transition', () => {
  const row = buildRemediationRow(lead('paid', [], {
    leadId: 'unverified_paid',
    revenue: { amountCents: 99900, currency: 'usd' },
  }), {}, { now: NOW });
  const template = row.stageEvidenceRepair.commandTemplate;

  assert.equal(template.executable, false);
  assert.deepEqual(template.argv.slice(0, 4), ['npm', 'run', 'sales:reconcile-payment', '--']);
  assert.ok(template.argv.includes('--provider'));
  assert.ok(template.argv.includes('REPLACE_WITH_ACTUAL_PAYMENT_PROVIDER'));
  assert.ok(template.argv.includes('--payment'));
  assert.ok(!template.argv.includes('--payment-id'));
  assert.ok(!template.argv.includes('scripts/sales-pipeline.js'));
  assert.match(template.display, /REPLACE_WITH_ACTUAL_PROVIDER_PAYMENT_ID/);
});

test('buyer-confirmed checkout is monitored for provider payment without claiming revenue', () => {
  const checkout = lead('checkout_started', [
    event('buyer_checkout_confirmation', '2026-07-16T10:00:00.000Z', 'checkout_started', {
      source: 'buyer_email',
    }),
  ], { leadId: 'buyer_confirmed_checkout' });
  const row = buildRemediationRow(checkout, {}, { now: NOW });

  assert.equal(row.stageEvidenceVerified, true);
  assert.equal(row.queueClass, 'monitor');
  assert.equal(row.actionStatus, 'monitor_provider_payment');
  assert.equal(row.preferredStageEvidenceFresh, true);
  assert.equal(row.preferredStageEvidenceAt, '2026-07-16T10:00:00.000Z');
  assert.equal(row.sameDayEvidencePriority, true);
  assert.equal(row.sameDayReviewPriority, false);
  assert.equal(row.readyForOutbound, false);
  assert.equal(row.stageEvidenceRepair, null);
  assert.match(row.safeNextAction, /provider payment/i);
});

test('provider checkout object alone is not upgraded to buyer intent', () => {
  const checkout = lead('checkout_started', [
    event('provider_checkout_session', '2026-07-16T10:00:00.000Z', 'checkout_started', {
      source: 'paypal',
    }),
  ], { leadId: 'provider_object_only' });
  const row = buildRemediationRow(checkout, {}, { now: NOW });

  assert.equal(row.stageEvidenceVerified, true);
  assert.equal(row.actionStatus, 'hold_checkout_intent_unverified');
  assert.equal(row.preferredStageEvidenceFresh, false);
  assert.equal(row.preferredStageEvidenceAt, null);
  assert.equal(row.sameDayEvidencePriority, false);
  assert.equal(row.sameDayReviewPriority, true);
  assert.equal(row.queueClass, 'monitor');
  assert.equal(row.readyForOutbound, false);
  assert.ok(row.blockers.some((blocker) => blocker.code === 'checkout_intent_unverified'));
});

test('a newer provider object cannot hide a fresh buyer checkout confirmation', () => {
  const checkout = lead('checkout_started', [
    event('buyer_checkout_confirmation', '2026-07-15T10:00:00.000Z', 'checkout_started', {
      source: 'buyer_email',
    }),
    event('provider_checkout_session', '2026-07-15T11:00:00.000Z', 'checkout_started', {
      source: 'paypal',
      fromStage: 'checkout_started',
    }),
  ], { leadId: 'buyer_confirmation_then_provider_object' });
  const row = buildRemediationRow(checkout, {}, { now: NOW });

  assert.equal(row.stageEvidenceKind, 'provider_checkout_session');
  assert.equal(row.preferredStageEvidenceKind, 'buyer_checkout_confirmation');
  assert.equal(row.preferredStageEvidenceAt, '2026-07-15T10:00:00.000Z');
  assert.equal(row.preferredStageEvidenceFresh, true);
  assert.equal(row.sameDayEvidencePriority, true);
  assert.equal(row.sameDayReviewPriority, false);
});

test('preferred buyer evidence selection uses event time instead of history order', () => {
  const checkout = lead('checkout_started', [
    event('buyer_checkout_confirmation', '2026-07-16T11:00:00.000Z', 'checkout_started', {
      source: 'latest_buyer_email',
    }),
    event('buyer_checkout_confirmation', '2026-07-15T09:00:00.000Z', 'checkout_started', {
      source: 'oldest_buyer_email',
    }),
    event('buyer_checkout_confirmation', '2026-07-16T09:00:00.000Z', 'checkout_started', {
      source: 'older_buyer_email',
    }),
  ], { leadId: 'out_of_order_buyer_confirmation' });
  const row = buildRemediationRow(checkout, {}, { now: NOW });

  assert.equal(row.preferredStageEvidenceAt, '2026-07-16T11:00:00.000Z');
  assert.equal(row.preferredStageEvidenceFresh, true);
  assert.equal(row.sameDayEvidencePriority, true);
  assert.equal(row.sameDayReviewPriority, false);
});

test('a fresh provider object does not revive a stale buyer checkout confirmation', () => {
  const checkout = lead('checkout_started', [
    event('buyer_checkout_confirmation', '2026-07-01T10:00:00.000Z', 'checkout_started', {
      source: 'buyer_email',
    }),
    event('provider_checkout_session', '2026-07-15T11:00:00.000Z', 'checkout_started', {
      source: 'paypal',
      fromStage: 'checkout_started',
    }),
  ], { leadId: 'stale_buyer_confirmation_fresh_provider_object' });
  const row = buildRemediationRow(checkout, {}, { now: NOW });

  assert.equal(row.stageSignalFresh, true);
  assert.equal(row.preferredStageEvidenceAt, '2026-07-01T10:00:00.000Z');
  assert.equal(row.preferredStageEvidenceFresh, false);
  assert.equal(row.sameDayEvidencePriority, false);
  assert.equal(row.sameDayReviewPriority, true);
});

test('verified intake is internal-only and exhausted follow-up stays in monitor', () => {
  const intake = lead('sprint_intake', [
    event('intake_submission', '2026-07-16T10:00:00.000Z', 'sprint_intake', {
      source: 'thumbgate_hosted',
    }),
  ], { leadId: 'verified_intake' });
  const exhausted = lead('contacted', [
    event('platform_send_receipt', '2026-07-12T10:00:00.000Z', 'contacted'),
    event('platform_send_receipt', '2026-07-13T10:00:00.000Z', 'contacted'),
  ], { leadId: 'exhausted_follow_up' });
  const queue = buildRevenueEvidenceRemediationQueue({ leads: [intake, exhausted], now: NOW });
  const byId = new Map(queue.rows.map((row) => [row.leadId, row]));

  assert.equal(byId.get('verified_intake').queueClass, 'internal_ready');
  assert.equal(byId.get('verified_intake').actionStatus, 'review_intake_internal');
  assert.equal(byId.get('verified_intake').readyForOutbound, false);
  assert.equal(byId.get('exhausted_follow_up').queueClass, 'monitor');
  assert.equal(byId.get('exhausted_follow_up').actionStatus, 'hold_already_followed_up');
  assert.equal(byId.get('exhausted_follow_up').readyForOutbound, false);
});

test('stale pipeline labels and cooldowns remain visible as distinct blockers', () => {
  const staleTargeted = lead('targeted', [
    event('platform_send_receipt', '2026-07-15T10:00:00.000Z', 'contacted'),
  ], { leadId: 'stale_targeted' });
  const coolingDown = lead('contacted', [
    event('platform_send_receipt', '2026-07-15T12:01:00.000Z', 'contacted'),
  ], { leadId: 'cooling_down' });
  const queue = buildRevenueEvidenceRemediationQueue({ leads: [staleTargeted, coolingDown], now: NOW });
  const byId = new Map(queue.rows.map((row) => [row.leadId, row]));

  assert.ok(byId.get('stale_targeted').blockers.some((blocker) => blocker.code === 'pipeline_transition_missing'));
  assert.equal(byId.get('stale_targeted').readyForOutbound, false);
  assert.ok(byId.get('cooling_down').blockers.some((blocker) => blocker.code === 'follow_up_cooldown'));
  assert.equal(byId.get('cooling_down').nextEligibleAt, '2026-07-17T12:01:00.000Z');
});

test('CLI writes a proof packet without mutating pipeline state or leaking stored drafts', () => {
  const tempDir = makeTempDir();
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');
  const outPath = path.join(tempDir, 'queue.md');
  const jsonPath = path.join(tempDir, 'queue.json');
  const fixture = lead('replied', [], {
    leadId: 'read_only_cli',
    outbound: {
      draft: 'DO_NOT_LEAK_PRIVATE_DRAFT',
      cta: 'https://example.invalid/private-checkout',
    },
  });
  writeState(statePath, [fixture]);
  const before = fs.readFileSync(statePath);

  const result = runCli([
    '--state', statePath,
    '--now', NOW,
    '--out', outPath,
    '--json-out', jsonPath,
  ]);
  const after = fs.readFileSync(statePath);
  const markdown = fs.readFileSync(outPath, 'utf8');
  const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  assert.deepEqual(after, before);
  assert.equal(result.markdownPath, outPath);
  assert.equal(result.jsonPath, jsonPath);
  assert.match(markdown, /proves local action\/remediation eligibility only/i);
  assert.match(markdown, /External side effect authorized: false/);
  assert.doesNotMatch(markdown, /DO_NOT_LEAK_PRIVATE_DRAFT/);
  assert.doesNotMatch(markdown, /example\.invalid\/private-checkout/);
  assert.equal(json.primaryAction.externalSideEffectAuthorized, false);
  assert.equal(json.summary.remediationRequired, 1);
});

test('markdown renders only the requested row limit while retaining full summary counts', () => {
  const queue = buildRevenueEvidenceRemediationQueue({
    leads: [
      lead('replied', [
        event('operator_note', '2026-06-01T12:00:00.000Z', 'replied'),
      ], { leadId: 'old_high_intent_row' }),
      lead('contacted', [], { leadId: 'current_contact_repair' }),
    ],
    now: NOW,
  });
  const markdown = renderRevenueEvidenceRemediationMarkdown(queue, { limit: 1 });

  assert.match(markdown, /Total leads: 2/);
  assert.match(markdown, /current_contact_repair/);
  assert.doesNotMatch(markdown, /### 2\. old_high_intent_row/);
});

test('empty queue and CLI argument edge paths are deterministic', () => {
  const queue = buildRevenueEvidenceRemediationQueue({ leads: [], now: NOW });
  const markdown = renderRevenueEvidenceRemediationMarkdown(queue);
  const options = parseArgs(['ignored', '--json', '--json-out=queue.json', '--limit', '5']);

  assert.match(markdown, /No non-terminal action is available/);
  assert.match(markdown, /No leads loaded/);
  assert.deepEqual(options, { json: true, jsonOut: 'queue.json', limit: '5' });
  assert.equal(isCliInvocation(['node']), false);
  assert.equal(isCliInvocation(['node', path.join(makeTempDir(), 'missing-script.js')]), false);
});

test('target loader accepts arrays, aggregate JSON, and JSONL and rejects malformed data', () => {
  const tempDir = makeTempDir();
  const arrayPath = path.join(tempDir, 'array.json');
  const aggregatePath = path.join(tempDir, 'aggregate.json');
  const rowsPath = path.join(tempDir, 'rows.json');
  const jsonlPath = path.join(tempDir, 'targets.jsonl');
  const malformedPath = path.join(tempDir, 'malformed.jsonl');
  fs.writeFileSync(arrayPath, JSON.stringify([{ leadId: 'array' }]), 'utf8');
  fs.writeFileSync(aggregatePath, JSON.stringify({ targets: [{ leadId: 'aggregate' }] }), 'utf8');
  fs.writeFileSync(rowsPath, JSON.stringify({ rows: [{ leadId: 'rows' }] }), 'utf8');
  fs.writeFileSync(jsonlPath, '{"leadId":"one"}\n{"leadId":"two"}\n', 'utf8');
  fs.writeFileSync(malformedPath, '{"leadId":"one"}\nnot-json\n', 'utf8');

  assert.equal(loadTargetRecords(arrayPath)[0].leadId, 'array');
  assert.equal(loadTargetRecords(aggregatePath)[0].leadId, 'aggregate');
  assert.equal(loadTargetRecords(rowsPath)[0].leadId, 'rows');
  assert.deepEqual(loadTargetRecords(jsonlPath).map((target) => target.leadId), ['one', 'two']);
  assert.throws(() => loadTargetRecords(malformedPath), /Invalid target JSONL at line 2/);
});

test('shell quoting keeps hostile lead IDs inert in displayed templates', () => {
  const tempDir = makeTempDir();
  const markerPath = path.join(tempDir, 'pwned');
  const hostileLeadId = `lead'; touch ${markerPath}; '`;
  assert.equal(shellQuote(hostileLeadId), `'lead'\\''; touch ${markerPath}; '\\'''`);
  const row = buildRemediationRow(lead('replied', [], {
    leadId: hostileLeadId,
  }), {}, { now: NOW });

  assert.equal(row.stageEvidenceRepair.commandTemplate.executable, false);
  assert.match(row.stageEvidenceRepair.commandTemplate.display, /^'node' 'scripts\/sales-pipeline\.js'/);
  assert.match(row.stageEvidenceRepair.commandTemplate.display, /'lead'\\''; touch \/.*\/pwned; '\\'''/);
  assert.equal(fs.existsSync(markerPath), false);
});

test('real CLI process succeeds read-only and reports malformed target input fail-closed', () => {
  const tempDir = makeTempDir();
  const statePath = path.join(tempDir, 'sales-pipeline.jsonl');
  const malformedPath = path.join(tempDir, 'malformed-targets.jsonl');
  const scriptPath = path.resolve(__dirname, '../scripts/revenue-evidence-remediation.js');
  writeState(statePath, [lead('targeted', [], { leadId: 'cli_process' })]);
  fs.writeFileSync(malformedPath, 'not-json\n', 'utf8');
  const before = fs.readFileSync(statePath);

  const success = spawnSync(process.execPath, [scriptPath, '--state', statePath, '--now', NOW, '--json'], {
    encoding: 'utf8',
  });
  const failure = spawnSync(process.execPath, [
    scriptPath,
    '--state', statePath,
    '--targets', malformedPath,
  ], { encoding: 'utf8' });

  assert.equal(success.status, 0, success.stderr);
  assert.equal(JSON.parse(success.stdout).summary.approvalReady, 1);
  assert.deepEqual(fs.readFileSync(statePath), before);
  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /Invalid target JSONL at line 1/);
  assert.equal(failure.stdout, '');
  assert.deepEqual(fs.readFileSync(statePath), before);
});
