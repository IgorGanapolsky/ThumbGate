'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeSalesLead } = require('../scripts/sales-pipeline');
const { digestBuyerEmail } = require('../scripts/provider-revenue-evidence');
const {
  BUYER_REPLY_FRESHNESS_MS,
  buildApprovalPhrase,
  evaluateRevenueActionEligibility,
  resolveLeadZeroSpendStatus,
  resolveZeroSpendStatus,
} = require('../scripts/revenue-action-eligibility');

const NOW = '2026-07-16T12:00:00.000Z';
const DIGEST = `sha256:${'a'.repeat(64)}`;

function evidence(kind, at, extra = {}) {
  return {
    fromStage: null,
    toStage: extra.toStage || 'targeted',
    at,
    evidence: {
      kind,
      source: extra.source || 'reddit',
      reference: extra.reference || `receipt:${kind}:${at}`,
      ...extra.evidence,
    },
  };
}

function lead(stage, history = [], extra = {}) {
  return sanitizeSalesLead({
    leadId: extra.leadId || `lead_${stage}`,
    source: extra.source || 'reddit',
    channel: extra.channel || 'reddit_comment',
    stage,
    offer: extra.offer,
    contact: extra.contact,
    revenue: extra.revenue,
    history,
  });
}

test('zero-spend screen discards paid access and holds ambiguous marketplaces', () => {
  assert.equal(resolveZeroSpendStatus({ source: 'reddit' }), 'proceed_zero_cost');
  assert.equal(resolveZeroSpendStatus({ source: 'marketplace' }), 'hold_unverified_cost');
  assert.equal(resolveZeroSpendStatus({ source: 'reddit', requiresRevenueShare: true }), 'discarded_paid_requirement');
  assert.equal(resolveZeroSpendStatus({ zeroSpendStatus: 'discarded_paid_requirement' }), 'discarded_paid_requirement');
  assert.equal(resolveZeroSpendStatus({ zeroSpendStatus: 'hold_unverified_cost' }), 'hold_unverified_cost');
  assert.equal(resolveZeroSpendStatus({}), 'hold_unverified_cost');
});

test('zero-spend declarations cannot override paid flags or ambiguous costs without evidence', () => {
  assert.equal(resolveZeroSpendStatus({
    source: 'reddit',
    zeroSpendStatus: 'proceed_zero_cost',
    requiresRevenueShare: true,
  }), 'discarded_paid_requirement');
  assert.equal(resolveZeroSpendStatus({
    source: 'marketplace',
    zeroSpendStatus: 'proceed_zero_cost',
  }), 'hold_unverified_cost');
  assert.equal(resolveZeroSpendStatus({
    source: 'marketplace',
    zeroSpendStatus: 'proceed_zero_cost',
    costVerifiedZero: true,
    costVerificationEvidence: 'Provider terms archived with no seller fee or future revenue share.',
  }), 'proceed_zero_cost');
  assert.equal(resolveZeroSpendStatus({
    source: 'unknown-partner',
    zeroSpendStatus: 'proceed_zero_cost',
    costVerifiedZero: true,
  }), 'hold_unverified_cost');
});

test('target metadata cannot relabel a durable ambiguous route into a zero-cost channel', () => {
  const marketplaceLead = lead('targeted', [], {
    source: 'marketplace',
    channel: 'marketplace',
  });
  assert.equal(resolveLeadZeroSpendStatus(marketplaceLead, {
    source: 'reddit',
    channel: 'reddit_comment',
  }), 'hold_unverified_cost');
  assert.equal(evaluateRevenueActionEligibility(marketplaceLead, {
    source: 'reddit',
    channel: 'reddit_comment',
  }, { now: NOW }).status, 'hold_unverified_cost');

  const verified = {
    source: 'reddit',
    channel: 'reddit_comment',
    zeroSpendStatus: 'proceed_zero_cost',
    costVerifiedZero: true,
    costVerificationEvidence: 'Archived terms prove no listing fee, subscription, commission, or revenue share.',
  };
  assert.equal(resolveLeadZeroSpendStatus(marketplaceLead, verified), 'proceed_zero_cost');
});

test('targeted organic lead requires an exact first-touch approval', () => {
  const result = evaluateRevenueActionEligibility(lead('targeted'), {}, { now: NOW });
  assert.equal(result.status, 'approval_required_first_touch');
  assert.equal(result.readyForOutbound, true);
  assert.equal(result.requiresApproval, true);
  assert.equal(result.approvalPhrase, 'APPROVE SEND THUMBGATE FIRST TOUCH TO LEAD_TARGETED');
});

test('stale targeted label with prior outbound evidence cannot create a duplicate first touch', () => {
  const targeted = lead('targeted', [evidence('platform_send_receipt', '2026-07-15T10:00:00.000Z', {
    toStage: 'contacted',
  })]);
  const result = evaluateRevenueActionEligibility(targeted, {}, { now: NOW });
  assert.equal(result.status, 'hold_pipeline_transition_missing');
  assert.equal(result.readyForOutbound, false);
});

test('approval phrases are bounded and deterministic', () => {
  assert.equal(
    buildApprovalPhrase('reddit/coffeedrum exa', 'qualification_reply'),
    'APPROVE SEND THUMBGATE QUALIFICATION REPLY TO REDDIT_COFFEEDRUM_EXA'
  );
  assert.equal(buildApprovalPhrase('x', 'internal'), null);
});

test('legacy stage labels without receipts cannot enter the send queue', () => {
  const result = evaluateRevenueActionEligibility(lead('replied'), {}, { now: NOW });
  assert.equal(result.status, 'hold_unverified_stage_evidence');
  assert.equal(result.operatorReady, false);
  assert.equal(result.readyForOutbound, false);
});

test('contacted lead observes a 48-hour single-follow-up cooldown', () => {
  const contacted = lead('contacted', [evidence('platform_send_receipt', '2026-07-15T12:01:00.000Z', {
    toStage: 'contacted',
  })]);
  const result = evaluateRevenueActionEligibility(contacted, {}, { now: NOW });
  assert.equal(result.status, 'hold_follow_up_cooldown');
  assert.equal(result.nextEligibleAt, '2026-07-17T12:01:00.000Z');
});

test('contacted lead becomes approval-ready once cooldown elapses', () => {
  const contacted = lead('contacted', [evidence('platform_send_receipt', '2026-07-13T11:00:00.000Z', {
    toStage: 'contacted',
  })]);
  const result = evaluateRevenueActionEligibility(contacted, {}, { now: NOW });
  assert.equal(result.status, 'approval_required_follow_up');
  assert.equal(result.readyForOutbound, true);
  assert.match(result.approvalPhrase, /FOLLOW UP/);
});

test('contacted label with a newer buyer reply requires pipeline reconciliation', () => {
  const contacted = lead('contacted', [
    evidence('platform_send_receipt', '2026-07-13T11:00:00.000Z', { toStage: 'contacted' }),
    evidence('buyer_reply', '2026-07-14T11:00:00.000Z', { toStage: 'replied' }),
  ]);
  const result = evaluateRevenueActionEligibility(contacted, {}, { now: NOW });
  assert.equal(result.status, 'hold_pipeline_transition_missing');
  assert.equal(result.readyForOutbound, false);
});

test('contacted lead cannot receive more than one follow-up without new buyer input', () => {
  const contacted = lead('contacted', [
    evidence('platform_send_receipt', '2026-07-12T11:00:00.000Z', { toStage: 'contacted' }),
    evidence('platform_send_receipt', '2026-07-13T11:00:00.000Z', { toStage: 'contacted' }),
  ]);
  const result = evaluateRevenueActionEligibility(contacted, {}, { now: NOW });
  assert.equal(result.status, 'hold_already_followed_up');
  assert.equal(result.evidence.outboundReceiptCount, 2);
  assert.equal(result.readyForOutbound, false);
});

test('stale contacted lead with an answered buyer reply stays held', () => {
  const contacted = lead('contacted', [
    evidence('platform_send_receipt', '2026-07-12T11:00:00.000Z', { toStage: 'contacted' }),
    evidence('buyer_reply', '2026-07-13T11:00:00.000Z', { toStage: 'replied' }),
    evidence('platform_send_receipt', '2026-07-14T11:00:00.000Z', { toStage: 'replied' }),
  ]);
  const result = evaluateRevenueActionEligibility(contacted, {}, { now: NOW });
  assert.equal(result.status, 'hold_already_followed_up');
  assert.equal(result.readyForOutbound, false);
});

test('caller cannot shorten the 48-hour follow-up cooldown', () => {
  const contacted = lead('contacted', [evidence('platform_send_receipt', '2026-07-15T11:00:00.000Z', {
    toStage: 'contacted',
  })]);
  const result = evaluateRevenueActionEligibility(contacted, {}, {
    now: NOW,
    followUpCooldownMs: -1,
  });
  assert.equal(result.status, 'hold_follow_up_cooldown');
  assert.equal(result.evidence.followUpCooldownMs, 48 * 60 * 60 * 1000);
});

test('extreme caller cooldown values hold safely instead of crashing date rendering', () => {
  const contacted = lead('contacted', [evidence('platform_send_receipt', '2026-07-15T11:00:00.000Z', {
    toStage: 'contacted',
  })]);
  const result = evaluateRevenueActionEligibility(contacted, {}, {
    now: NOW,
    followUpCooldownMs: Number.MAX_VALUE,
  });
  assert.equal(result.status, 'hold_follow_up_cooldown');
  assert.equal(result.nextEligibleAt, null);
});

test('unanswered verified buyer reply qualifies for one approval-gated response', () => {
  const replied = lead('replied', [
    evidence('platform_send_receipt', '2026-07-13T10:00:00.000Z', { toStage: 'contacted' }),
    evidence('buyer_reply', '2026-07-14T10:00:00.000Z', { toStage: 'replied' }),
  ]);
  const result = evaluateRevenueActionEligibility(replied, {}, { now: NOW });
  assert.equal(result.status, 'approval_required_qualification_reply');
  assert.equal(result.readyForOutbound, true);
  assert.equal(result.evidence.buyerReplyFresh, true);
  assert.equal(result.evidence.buyerReplyFreshnessMs, BUYER_REPLY_FRESHNESS_MS);
});

test('verified buyer reply expires as a warm same-day signal after 14 days', () => {
  const replied = lead('replied', [
    evidence('buyer_reply', '2026-06-19T16:29:29.419Z', { toStage: 'replied' }),
  ]);
  const result = evaluateRevenueActionEligibility(replied, {}, { now: NOW });

  assert.equal(result.status, 'hold_stale_buyer_reply');
  assert.equal(result.queueClass, 'monitor');
  assert.equal(result.readyForOutbound, false);
  assert.equal(result.requiresApproval, false);
  assert.equal(result.approvalPhrase, null);
  assert.equal(result.evidence.buyerReplyFresh, false);
  assert.equal(result.evidence.buyerReplyExpiresAt, '2026-07-03T16:29:29.419Z');
  assert.match(result.reason, /older than the 14-day warm-signal window/i);
});

test('buyer-reply freshness boundary includes exactly 14 days and excludes the next millisecond', () => {
  const exactlyAtBoundary = evaluateRevenueActionEligibility(lead('replied', [
    evidence('buyer_reply', '2026-07-02T12:00:00.000Z', { toStage: 'replied' }),
  ]), {}, { now: NOW });
  const oneMillisecondStale = evaluateRevenueActionEligibility(lead('replied', [
    evidence('buyer_reply', '2026-07-02T11:59:59.999Z', { toStage: 'replied' }),
  ]), {}, { now: NOW });

  assert.equal(exactlyAtBoundary.status, 'approval_required_qualification_reply');
  assert.equal(exactlyAtBoundary.evidence.buyerReplyFresh, true);
  assert.equal(exactlyAtBoundary.evidence.buyerReplyAgeMs, BUYER_REPLY_FRESHNESS_MS);
  assert.equal(oneMillisecondStale.status, 'hold_stale_buyer_reply');
  assert.equal(oneMillisecondStale.evidence.buyerReplyFresh, false);
  assert.equal(oneMillisecondStale.evidence.buyerReplyAgeMs, BUYER_REPLY_FRESHNESS_MS + 1);
});

test('future-dated buyer reply fails closed beyond clock-skew allowance', () => {
  const replied = lead('replied', [
    evidence('buyer_reply', '2026-07-16T12:06:00.000Z', { toStage: 'replied' }),
  ]);
  const result = evaluateRevenueActionEligibility(replied, {}, { now: NOW });

  assert.equal(result.status, 'hold_buyer_reply_time_invalid');
  assert.equal(result.queueClass, 'monitor');
  assert.equal(result.readyForOutbound, false);
  assert.equal(result.evidence.buyerReplyTimestampValid, false);
  assert.equal(result.evidence.buyerReplyFresh, false);
});

test('buyer-reply clock-skew boundary permits five minutes and rejects the next millisecond', () => {
  const exactlyAtBoundary = evaluateRevenueActionEligibility(lead('replied', [
    evidence('buyer_reply', '2026-07-16T12:05:00.000Z', { toStage: 'replied' }),
  ]), {}, { now: NOW });
  const oneMillisecondInvalid = evaluateRevenueActionEligibility(lead('replied', [
    evidence('buyer_reply', '2026-07-16T12:05:00.001Z', { toStage: 'replied' }),
  ]), {}, { now: NOW });

  assert.equal(exactlyAtBoundary.status, 'approval_required_qualification_reply');
  assert.equal(exactlyAtBoundary.evidence.buyerReplyTimestampValid, true);
  assert.equal(exactlyAtBoundary.evidence.buyerReplyFresh, true);
  assert.equal(oneMillisecondInvalid.status, 'hold_buyer_reply_time_invalid');
  assert.equal(oneMillisecondInvalid.evidence.buyerReplyTimestampValid, false);
  assert.equal(oneMillisecondInvalid.evidence.buyerReplyFresh, false);
});

test('newer send receipt after buyer reply blocks duplicate follow-up', () => {
  const replied = lead('replied', [
    evidence('buyer_reply', '2026-07-14T10:00:00.000Z', { toStage: 'replied' }),
    evidence('platform_send_receipt', '2026-07-15T10:00:00.000Z', { toStage: 'replied' }),
  ]);
  const result = evaluateRevenueActionEligibility(replied, {}, { now: NOW });
  assert.equal(result.status, 'hold_already_followed_up');
  assert.equal(result.readyForOutbound, false);
});

test('ambiguous equal-timestamp reply and send fails closed', () => {
  const replied = lead('replied', [
    evidence('buyer_reply', '2026-07-14T10:00:00.000Z', { toStage: 'replied' }),
    evidence('platform_send_receipt', '2026-07-14T10:00:00.000Z', { toStage: 'replied' }),
  ]);
  const result = evaluateRevenueActionEligibility(replied, {}, { now: NOW });
  assert.equal(result.status, 'hold_already_followed_up');
  assert.equal(result.readyForOutbound, false);
});

test('provider checkout object alone is not treated as buyer intent', () => {
  const checkout = lead('checkout_started', [evidence('provider_checkout_session', '2026-07-16T10:00:00.000Z', {
    toStage: 'checkout_started',
    source: 'stripe',
  })]);
  const result = evaluateRevenueActionEligibility(checkout, {}, { now: NOW });
  assert.equal(result.status, 'hold_checkout_intent_unverified');
  assert.equal(result.queueClass, 'monitor');
});

test('buyer-confirmed checkout is monitored for payment rather than closed again', () => {
  const checkout = lead('checkout_started', [evidence('buyer_checkout_confirmation', '2026-07-16T10:00:00.000Z', {
    toStage: 'checkout_started',
    source: 'buyer_email',
  })]);
  const result = evaluateRevenueActionEligibility(checkout, {}, { now: NOW });
  assert.equal(result.status, 'monitor_provider_payment');
  assert.equal(result.readyForOutbound, false);
});

test('verified call booking routes to internal preparation only', () => {
  const booked = lead('call_booked', [evidence('booking_confirmation', '2026-07-16T09:00:00.000Z', {
    toStage: 'call_booked',
  })]);
  const result = evaluateRevenueActionEligibility(booked, {}, { now: NOW });
  assert.equal(result.status, 'prepare_call_internal');
  assert.equal(result.queueClass, 'internal_ready');
  assert.equal(result.readyForOutbound, false);
});

test('verified intake routes to internal review and not the send queue', () => {
  const intake = lead('sprint_intake', [evidence('intake_submission', '2026-07-16T10:00:00.000Z', {
    toStage: 'sprint_intake',
    source: 'thumbgate_hosted',
  })]);
  const result = evaluateRevenueActionEligibility(intake, {}, { now: NOW });
  assert.equal(result.status, 'review_intake_internal');
  assert.equal(result.queueClass, 'internal_ready');
  assert.equal(result.readyForOutbound, false);
});

test('provider-verified payment routes to delivery and expansion review only', () => {
  const buyerEmail = 'buyer@example.com';
  const paid = lead('paid', [evidence('provider_payment', '2026-07-16T10:00:00.000Z', {
    toStage: 'paid',
    source: 'provider_api_live:paypal',
    evidence: {
      provider: 'paypal',
      verified: true,
      digest: DIGEST,
      offerId: 'workflow_hardening_diagnostic',
      buyerDigest: digestBuyerEmail(buyerEmail),
    },
  })], {
    offer: 'workflow_hardening_diagnostic',
    contact: { email: buyerEmail },
    revenue: { amountCents: 49900, currency: 'usd' },
  });
  const result = evaluateRevenueActionEligibility(paid, {}, { now: NOW });
  assert.equal(result.status, 'delivery_and_expansion_review');
  assert.equal(result.queueClass, 'internal_ready');
  assert.equal(result.readyForOutbound, false);
});

test('verified lost lead is terminal until a new inbound evidence chain exists', () => {
  const lost = lead('lost', [evidence('buyer_declined', '2026-07-16T10:00:00.000Z', {
    toStage: 'lost',
  })]);
  const result = evaluateRevenueActionEligibility(lost, {}, { now: NOW });
  assert.equal(result.status, 'terminal_lost');
  assert.equal(result.queueClass, 'terminal');
  assert.equal(result.operatorReady, false);
});

test('paid or ambiguous channel is replaced with a first-party zero-cost route', () => {
  const discarded = evaluateRevenueActionEligibility(lead('targeted'), {
    requiresPaidAccess: true,
  }, { now: NOW });
  assert.equal(discarded.status, 'discarded_paid_requirement');
  assert.match(discarded.zeroCostReplacement, /warm conversation|first-party intake/i);

  const held = evaluateRevenueActionEligibility(lead('targeted', [], { source: 'marketplace', channel: 'marketplace' }), {}, { now: NOW });
  assert.equal(held.status, 'hold_unverified_cost');
  assert.match(held.zeroCostReplacement, /direct organic/i);
});
