#!/usr/bin/env node
'use strict';

const {
  evaluateLeadStageEvidence,
  normalizeSalesStage,
} = require('./sales-pipeline');

const FOLLOW_UP_COOLDOWN_MS = 48 * 60 * 60 * 1000;
const BUYER_REPLY_FRESHNESS_MS = 14 * 24 * 60 * 60 * 1000;
const EVENT_CLOCK_SKEW_MS = 5 * 60 * 1000;
const ZERO_SPEND_STATUSES = Object.freeze([
  'proceed_zero_cost',
  'hold_unverified_cost',
  'discarded_paid_requirement',
]);
const DIRECT_ZERO_COST_CHANNELS = new Set([
  'bluesky',
  'direct_email',
  'email',
  'github',
  'linkedin',
  'linkedin_comment',
  'manual',
  'owned',
  'reddit',
  'reddit_comment',
  'reddit_dm',
  'threads',
]);
const PAID_OR_AMBIGUOUS_CHANNEL_PATTERN = /\b(ad|ads|advertising|boost|credit|credits|inmail|lead database|marketplace|paid|pay-to-play|revenue share|sponsor|subscription)\b/i;

function normalizeText(value, maxLength = 1000) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

function parseTimestamp(value) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function toIsoStringOrNull(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function latestEvidenceEvent(lead = {}, kinds = []) {
  const accepted = new Set(kinds);
  const events = Array.isArray(lead.history) ? lead.history : [];
  return events
    .filter((event) => accepted.has(event?.evidence?.kind) && parseTimestamp(event.at) !== null)
    .sort((left, right) => parseTimestamp(right.at) - parseTimestamp(left.at))[0] || null;
}

function resolveZeroSpendStatus(target = {}) {
  if (
    target.requiresBuyerPaymentToAccessLead === true
    || target.requiresPaidAccess === true
    || target.requiresRevenueShare === true
    || target.requiresSellerPayment === true
    || target.requiresSubscription === true
  ) {
    return 'discarded_paid_requirement';
  }

  const explicit = normalizeText(target.zeroSpendStatus, 80);
  if (explicit === 'discarded_paid_requirement' || explicit === 'hold_unverified_cost') {
    return explicit;
  }

  const channelTokens = [target.source, target.channel, target.platform, target.distributionMethod]
    .map((value) => normalizeText(value, 120)?.toLowerCase())
    .filter(Boolean);
  const directZeroCostChannel = channelTokens.some((value) => DIRECT_ZERO_COST_CHANNELS.has(value));
  const costVerificationEvidence = normalizeText(target.costVerificationEvidence, 500);
  if (channelTokens.some((value) => PAID_OR_AMBIGUOUS_CHANNEL_PATTERN.test(value))) {
    if (
      explicit === 'proceed_zero_cost'
      && target.costVerifiedZero === true
      && costVerificationEvidence
    ) {
      return 'proceed_zero_cost';
    }
    return 'hold_unverified_cost';
  }
  if (explicit === 'proceed_zero_cost') {
    return directZeroCostChannel || (target.costVerifiedZero === true && costVerificationEvidence)
      ? 'proceed_zero_cost'
      : 'hold_unverified_cost';
  }
  if (directZeroCostChannel) return 'proceed_zero_cost';
  if (target.costVerifiedZero === true && costVerificationEvidence) return 'proceed_zero_cost';
  return 'hold_unverified_cost';
}

function resolveLeadZeroSpendStatus(lead = {}, target = {}) {
  const durableRouteStatus = resolveZeroSpendStatus({
    ...target,
    source: lead.source,
    channel: lead.channel,
  });
  const targetRouteStatus = resolveZeroSpendStatus({
    ...target,
    source: target.source || lead.source,
    channel: target.channel || lead.channel,
  });
  const statuses = [durableRouteStatus, targetRouteStatus];
  if (statuses.includes('discarded_paid_requirement')) return 'discarded_paid_requirement';
  if (statuses.includes('hold_unverified_cost')) return 'hold_unverified_cost';
  return 'proceed_zero_cost';
}

function approvalToken(value) {
  const token = String(value || 'LEAD')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96);
  return token || 'LEAD';
}

function buildApprovalPhrase(leadId, action) {
  const actions = {
    first_touch: 'FIRST TOUCH',
    follow_up: 'FOLLOW UP',
    qualification_reply: 'QUALIFICATION REPLY',
  };
  const label = actions[action];
  return label ? `APPROVE SEND THUMBGATE ${label} TO ${approvalToken(leadId)}` : null;
}

function decision({
  status,
  queueClass = 'hold',
  readyForOutbound = false,
  requiresApproval = false,
  approvalPhrase = null,
  nextAction,
  reason,
  nextEligibleAt = null,
  evidence,
  zeroCostReplacement = null,
}) {
  return {
    status,
    queueClass,
    operatorReady: queueClass === 'approval_ready' || queueClass === 'internal_ready',
    readyForOutbound,
    requiresApproval,
    approvalPhrase,
    nextAction,
    reason,
    nextEligibleAt,
    zeroCostReplacement,
    evidence,
  };
}

function evaluateRevenueActionEligibility(lead = {}, target = {}, {
  now = new Date().toISOString(),
  followUpCooldownMs = FOLLOW_UP_COOLDOWN_MS,
} = {}) {
  const stage = normalizeSalesStage(lead.stage, 'targeted');
  const zeroSpendStatus = resolveLeadZeroSpendStatus(lead, target);
  const stageEvidence = evaluateLeadStageEvidence({ ...lead, stage });
  const latestSend = latestEvidenceEvent(lead, ['platform_send_receipt']);
  const latestBuyerReply = latestEvidenceEvent(lead, ['buyer_reply']);
  const history = Array.isArray(lead.history) ? lead.history : [];
  const outboundReceiptCount = history.filter((event) => event?.evidence?.kind === 'platform_send_receipt').length;
  const nowMs = parseTimestamp(now) ?? Date.now();
  const requestedCooldownMs = Number(followUpCooldownMs);
  const enforcedCooldownMs = Number.isFinite(requestedCooldownMs)
    ? Math.max(FOLLOW_UP_COOLDOWN_MS, requestedCooldownMs)
    : FOLLOW_UP_COOLDOWN_MS;
  const evidence = {
    stage,
    stageVerified: stageEvidence.verified === true,
    stageEvidenceKind: stageEvidence.evidence?.kind || null,
    stageEvidenceAt: stageEvidence.evidenceAt || null,
    latestSendAt: latestSend?.at || null,
    latestBuyerReplyAt: latestBuyerReply?.at || null,
    outboundReceiptCount,
    followUpCooldownMs: enforcedCooldownMs,
    zeroSpendStatus,
  };

  if (zeroSpendStatus === 'discarded_paid_requirement') {
    return decision({
      status: 'discarded_paid_requirement',
      nextAction: 'Discard this acquisition path and replace it with an owned or direct organic route.',
      reason: 'The route requires seller payment, paid access, a subscription, or revenue share.',
      evidence,
      zeroCostReplacement: 'Use an existing warm conversation, owned first-party intake, or a direct organic channel.',
    });
  }
  if (zeroSpendStatus === 'hold_unverified_cost') {
    return decision({
      status: 'hold_unverified_cost',
      nextAction: 'Verify the complete downstream cost terms before preparing outreach or routing checkout traffic.',
      reason: 'The complete acquisition path is not proven free of present or future seller obligations.',
      evidence,
      zeroCostReplacement: 'Use an existing warm conversation, owned first-party intake, or a direct organic channel.',
    });
  }

  if (stage !== 'targeted' && !stageEvidence.verified) {
    return decision({
      status: 'hold_unverified_stage_evidence',
      nextAction: `Reconcile a real ${stage} receipt before any new message or offer.`,
      reason: stageEvidence.reason || `The ${stage} label has no stage-appropriate receipt.`,
      evidence,
    });
  }

  const leadId = lead.leadId || target.pipelineLeadId || 'lead';
  if (stage === 'targeted') {
    if (outboundReceiptCount > 0 || latestBuyerReply) {
      return decision({
        status: 'hold_pipeline_transition_missing',
        nextAction: 'Reconcile the existing send or buyer-reply evidence and advance the pipeline before preparing another first touch.',
        reason: 'The lead is labeled targeted even though its history already contains outbound or buyer-reply evidence.',
        evidence,
      });
    }
    return decision({
      status: 'approval_required_first_touch',
      queueClass: 'approval_ready',
      readyForOutbound: true,
      requiresApproval: true,
      approvalPhrase: buildApprovalPhrase(leadId, 'first_touch'),
      nextAction: 'Request exact action-time approval for the evidence-backed first touch; send nothing before approval.',
      reason: 'The direct organic route is zero-cost and no prior send receipt exists.',
      evidence,
    });
  }

  const latestSendMs = parseTimestamp(latestSend?.at);
  const latestReplyMs = parseTimestamp(latestBuyerReply?.at);
  const buyerReplyAgeMs = latestReplyMs === null ? null : Math.max(0, nowMs - latestReplyMs);
  const buyerReplyExpiresAtMs = latestReplyMs === null ? null : latestReplyMs + BUYER_REPLY_FRESHNESS_MS;
  const buyerReplyTimestampValid = latestReplyMs === null || latestReplyMs <= nowMs + EVENT_CLOCK_SKEW_MS;
  const buyerReplyFresh = latestReplyMs !== null
    && buyerReplyTimestampValid
    && nowMs <= buyerReplyExpiresAtMs;
  Object.assign(evidence, {
    buyerReplyAgeMs,
    buyerReplyFreshnessMs: BUYER_REPLY_FRESHNESS_MS,
    buyerReplyExpiresAt: buyerReplyExpiresAtMs === null ? null : toIsoStringOrNull(buyerReplyExpiresAtMs),
    buyerReplyTimestampValid,
    buyerReplyFresh,
  });
  if (stage === 'contacted') {
    if (latestReplyMs !== null) {
      if (latestSendMs === null || latestReplyMs >= latestSendMs) {
        return decision({
          status: 'hold_pipeline_transition_missing',
          nextAction: 'Record the verified buyer reply and advance the pipeline before preparing another message.',
          reason: 'Buyer-reply evidence is newer than the recorded send, but the lead is still labeled contacted.',
          evidence,
        });
      }
      return decision({
        status: 'hold_already_followed_up',
        queueClass: 'monitor',
        nextAction: 'Reconcile the stale contacted label and wait for new buyer input; do not send another follow-up.',
        reason: 'The history contains a buyer reply followed by a later outbound receipt while the lead is still labeled contacted.',
        evidence,
      });
    }
    if (outboundReceiptCount >= 2) {
      return decision({
        status: 'hold_already_followed_up',
        queueClass: 'monitor',
        nextAction: 'Wait for buyer input; the one-follow-up allowance is already exhausted.',
        reason: 'Two or more outbound receipts exist without a newer buyer reply.',
        evidence,
      });
    }
    const eligibleAtMs = (latestSendMs ?? parseTimestamp(stageEvidence.evidenceAt) ?? nowMs) + enforcedCooldownMs;
    if (nowMs < eligibleAtMs) {
      return decision({
        status: 'hold_follow_up_cooldown',
        queueClass: 'monitor',
        nextAction: 'Wait for buyer input or the single-follow-up eligibility time; do not send during the cooldown.',
        reason: 'A verified send exists and the default 48-hour single-follow-up cooldown has not elapsed.',
        nextEligibleAt: toIsoStringOrNull(eligibleAtMs),
        evidence,
      });
    }
    return decision({
      status: 'approval_required_follow_up',
      queueClass: 'approval_ready',
      readyForOutbound: true,
      requiresApproval: true,
      approvalPhrase: buildApprovalPhrase(leadId, 'follow_up'),
      nextAction: 'Request exact action-time approval for one value-first follow-up; do not send a second follow-up without new buyer input.',
      reason: 'The verified first send is older than the cooldown and no newer buyer reply is recorded.',
      evidence,
    });
  }

  if (stage === 'replied') {
    if (latestSendMs !== null && latestReplyMs !== null && latestSendMs >= latestReplyMs) {
      return decision({
        status: 'hold_already_followed_up',
        queueClass: 'monitor',
        nextAction: 'Wait for a new buyer reply; do not send another follow-up.',
        reason: 'A verified outbound receipt is newer than the latest verified buyer reply.',
        evidence,
      });
    }
    if (!buyerReplyTimestampValid) {
      return decision({
        status: 'hold_buyer_reply_time_invalid',
        queueClass: 'monitor',
        nextAction: 'Reconcile the buyer-reply timestamp from the authoritative source before preparing a response.',
        reason: 'The latest buyer-reply receipt is more than five minutes in the future and cannot prove current intent.',
        evidence,
      });
    }
    if (!buyerReplyFresh) {
      return decision({
        status: 'hold_stale_buyer_reply',
        queueClass: 'monitor',
        nextAction: 'Do not treat this as a warm same-day signal. Wait for new buyer evidence or separately review a low-pressure reactivation after checking the current thread state.',
        reason: 'The latest verified buyer reply is older than the 14-day warm-signal window.',
        evidence,
      });
    }
    return decision({
      status: 'approval_required_qualification_reply',
      queueClass: 'approval_ready',
      readyForOutbound: true,
      requiresApproval: true,
      approvalPhrase: buildApprovalPhrase(leadId, 'qualification_reply'),
      nextAction: 'Request exact approval for one qualification reply asking for workflow, consequence, authority, and proof target.',
      reason: 'A verified buyer reply exists and no later outbound receipt is recorded.',
      evidence,
    });
  }

  if (stage === 'call_booked') {
    return decision({
      status: 'prepare_call_internal',
      queueClass: 'internal_ready',
      nextAction: 'Prepare the diagnostic agenda and evidence questions; do not claim attendance or payment.',
      reason: 'The booking is verified and the next step is internal preparation.',
      evidence,
    });
  }

  if (stage === 'checkout_started') {
    if (stageEvidence.evidence?.kind !== 'buyer_checkout_confirmation') {
      return decision({
        status: 'hold_checkout_intent_unverified',
        queueClass: 'monitor',
        nextAction: 'Reconcile credible buyer identity or direct buyer checkout confirmation before treating the session as intent.',
        reason: 'A provider checkout object alone may be a probe, bot, owner test, or abandoned session.',
        evidence,
      });
    }
    return decision({
      status: 'monitor_provider_payment',
      queueClass: 'monitor',
      nextAction: 'Monitor provider payment evidence; do not resend the payment link or call checkout revenue.',
      reason: 'Buyer checkout confirmation exists, but provider-confirmed payment does not.',
      evidence,
    });
  }

  if (stage === 'sprint_intake') {
    return decision({
      status: 'review_intake_internal',
      queueClass: 'internal_ready',
      nextAction: 'Review the intake against the deterministic offer qualification and prepare signed scope only if it fits.',
      reason: 'The intake is verified; scope and payment remain separate future states.',
      evidence,
    });
  }

  if (stage === 'paid') {
    return decision({
      status: 'delivery_and_expansion_review',
      queueClass: 'internal_ready',
      nextAction: 'Deliver the paid scope, capture outcome evidence, and evaluate recurring or Enterprise fit only after delivery proof.',
      reason: 'Provider-verified payment exists; delivery and expansion are not yet implied.',
      evidence,
    });
  }

  return decision({
    status: 'terminal_lost',
    queueClass: 'terminal',
    nextAction: 'Take no further revenue action unless a new inbound buyer signal opens a new evidence chain.',
    reason: 'The lead is closed or disqualified.',
    evidence,
  });
}

module.exports = {
  BUYER_REPLY_FRESHNESS_MS,
  DIRECT_ZERO_COST_CHANNELS,
  EVENT_CLOCK_SKEW_MS,
  FOLLOW_UP_COOLDOWN_MS,
  ZERO_SPEND_STATUSES,
  buildApprovalPhrase,
  evaluateRevenueActionEligibility,
  latestEvidenceEvent,
  resolveLeadZeroSpendStatus,
  resolveZeroSpendStatus,
  toIsoStringOrNull,
};
