#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { ensureParentDir } = require('./fs-utils');
const {
  SALES_STAGE_EVIDENCE_KINDS,
  evaluateLeadStageEvidence,
  loadSalesLeads,
  normalizeSalesStage,
} = require('./sales-pipeline');
const {
  BUYER_REPLY_FRESHNESS_MS,
  EVENT_CLOCK_SKEW_MS,
  evaluateRevenueActionEligibility,
  resolveLeadZeroSpendStatus,
} = require('./revenue-action-eligibility');

const PLACEHOLDER_PREFIX = 'REPLACE_WITH_ACTUAL_';
const STAGE_SIGNAL_FRESHNESS_MS = BUYER_REPLY_FRESHNESS_MS;
const STAGE_PRIORITY = Object.freeze({
  checkout_started: 100,
  sprint_intake: 95,
  replied: 85,
  call_booked: 80,
  contacted: 60,
  targeted: 40,
  paid: 30,
  lost: 0,
});
const PREFERRED_STAGE_EVIDENCE = Object.freeze({
  contacted: 'platform_send_receipt',
  replied: 'buyer_reply',
  call_booked: 'booking_confirmation',
  checkout_started: 'buyer_checkout_confirmation',
  sprint_intake: 'intake_submission',
  paid: 'provider_payment',
  lost: 'operator_disqualified',
});
const SAME_DAY_CLOSE_STAGES = new Set([
  'replied',
  'call_booked',
  'checkout_started',
  'sprint_intake',
]);

function normalizeText(value, maxLength = 1000) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizeLimit(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseTimestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function isConcreteEvidenceValue(value, maxLength) {
  const normalized = normalizeText(value, maxLength);
  return Boolean(normalized && !/^REPLACE_WITH_/i.test(normalized));
}

function resolveCurrentStageEnteredAt(lead = {}) {
  const stage = normalizeSalesStage(lead.stage, 'targeted');
  const history = Array.isArray(lead.history) ? lead.history : [];
  const transition = history
    .filter((event) => (
      event?.toStage === stage
      && event?.fromStage !== stage
      && parseTimestamp(event?.at) !== null
    ))
    .reduce((latest, event) => {
      if (!latest) return event;
      return parseTimestamp(event.at) > parseTimestamp(latest.at) ? event : latest;
    }, null);
  return transition?.at || normalizeText(lead.createdAt, 64) || null;
}

function resolvePreferredStageEvidence(lead = {}) {
  const stage = normalizeSalesStage(lead.stage, 'targeted');
  const preferredKind = PREFERRED_STAGE_EVIDENCE[stage] || null;
  if (!preferredKind) return null;
  const history = Array.isArray(lead.history) ? lead.history : [];
  const supportingEvent = history
    .filter((event) => (
      event?.toStage === stage
      && event?.evidence?.kind === preferredKind
      && isConcreteEvidenceValue(event?.evidence?.source, 160)
      && isConcreteEvidenceValue(event?.evidence?.reference, 1000)
      && parseTimestamp(event?.at) !== null
    ))
    .reduce((latest, event) => {
      if (!latest) return event;
      return parseTimestamp(event.at) > parseTimestamp(latest.at) ? event : latest;
    }, null);
  if (!supportingEvent) return null;
  return {
    kind: preferredKind,
    at: supportingEvent.at,
    source: supportingEvent.evidence.source,
    reference: supportingEvent.evidence.reference,
  };
}

function buildPreferredStageEvidenceTiming(lead = {}, {
  now = new Date().toISOString(),
} = {}) {
  const nowMs = parseTimestamp(now) ?? Date.now();
  const preferredKind = PREFERRED_STAGE_EVIDENCE[normalizeSalesStage(lead.stage, 'targeted')] || null;
  const preferredEvidence = resolvePreferredStageEvidence(lead);
  const preferredEvidenceMs = parseTimestamp(preferredEvidence?.at);
  const preferredEvidenceExpiresAtMs = preferredEvidenceMs === null
    ? null
    : preferredEvidenceMs + STAGE_SIGNAL_FRESHNESS_MS;
  const preferredEvidenceTimestampValid = preferredEvidenceMs !== null
    && preferredEvidenceMs <= nowMs + EVENT_CLOCK_SKEW_MS;
  const preferredEvidenceFresh = preferredEvidenceMs !== null
    && preferredEvidenceTimestampValid
    && nowMs <= preferredEvidenceExpiresAtMs;
  return {
    preferredStageEvidenceKind: preferredKind,
    preferredStageEvidenceAt: preferredEvidence?.at || null,
    preferredStageEvidenceAgeMs: preferredEvidenceMs === null ? null : Math.max(0, nowMs - preferredEvidenceMs),
    preferredStageEvidenceExpiresAt: preferredEvidenceExpiresAtMs === null
      ? null
      : new Date(preferredEvidenceExpiresAtMs).toISOString(),
    preferredStageEvidenceTimestampValid: preferredEvidenceTimestampValid,
    preferredStageEvidenceFresh: preferredEvidenceFresh,
  };
}

function buildStageSignalTiming(lead = {}, stageEvidence = evaluateLeadStageEvidence(lead), {
  now = new Date().toISOString(),
} = {}) {
  const nowMs = parseTimestamp(now) ?? Date.now();
  const stageEnteredAt = resolveCurrentStageEnteredAt(lead);
  const stageSignalAt = stageEvidence.verified === true
    ? normalizeText(stageEvidence.evidenceAt, 64)
    : stageEnteredAt;
  const stageSignalMs = parseTimestamp(stageSignalAt);
  const stageSignalAgeMs = stageSignalMs === null ? null : Math.max(0, nowMs - stageSignalMs);
  const stageSignalExpiresAtMs = stageSignalMs === null
    ? null
    : stageSignalMs + STAGE_SIGNAL_FRESHNESS_MS;
  const stageSignalTimestampValid = stageSignalMs !== null
    && stageSignalMs <= nowMs + EVENT_CLOCK_SKEW_MS;
  const stageSignalFresh = stageSignalMs !== null
    && stageSignalTimestampValid
    && nowMs <= stageSignalExpiresAtMs;
  return {
    stageEnteredAt,
    stageSignalAt,
    stageSignalAgeMs,
    stageSignalExpiresAt: stageSignalExpiresAtMs === null
      ? null
      : new Date(stageSignalExpiresAtMs).toISOString(),
    stageSignalFreshnessMs: STAGE_SIGNAL_FRESHNESS_MS,
    stageSignalTimestampValid,
    stageSignalFresh,
  };
}

function shellQuote(value) {
  return `'${String(value ?? '').replaceAll("'", `'\\''`)}'`;
}

function formatArgv(argv = []) {
  return argv.map(shellQuote).join(' ');
}

function loadTargetRecords(targetsPath = null) {
  if (!targetsPath) return [];
  const resolved = path.resolve(targetsPath);
  const text = fs.readFileSync(resolved, 'utf8').trim();
  if (!text) return [];

  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed.targets)) return parsed.targets;
      if (Array.isArray(parsed.rows)) return parsed.rows;
    } catch {
      // Fall through to JSONL so one malformed aggregate does not hide valid rows.
    }
  }

  return text.split(/\n+/).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid target JSONL at line ${index + 1}: ${error.message}`);
    }
  });
}

function buildTargetMap(targets = []) {
  const map = new Map();
  for (const target of targets) {
    const leadId = normalizeText(target?.pipelineLeadId || target?.leadId, 160);
    if (leadId) map.set(leadId, target);
  }
  return map;
}

function evidenceRequirement(stage, preferredKind) {
  const requirements = {
    platform_send_receipt: 'A platform- or mail-origin delivery/send receipt with a stable message URL or message ID.',
    buyer_reply: 'A buyer-origin reply with a stable message URL or message ID; an operator note is not a reply.',
    booking_confirmation: 'A calendar or scheduling-provider confirmation tied to this buyer and call.',
    buyer_checkout_confirmation: 'A direct buyer confirmation tied to the checkout attempt; a provider session object alone is not buyer intent.',
    provider_checkout_session: 'A live provider session reference; this verifies the object only and does not prove buyer intent or payment.',
    intake_submission: 'A persisted first-party intake submission tied to this buyer and workflow.',
    workflow_materials_received: 'A durable reference proving the buyer supplied the agreed workflow materials.',
    provider_payment: 'A live provider API payment reconciled through sales:reconcile-payment with provider identity and digest proof.',
    buyer_declined: 'A buyer-origin decline receipt.',
    operator_disqualified: 'A durable operator review record with the concrete disqualification reason.',
    stale_closed: 'A durable operator closure record showing the staleness rule and evidence window.',
    provider_refund: 'A live provider API refund reconciled with provider identity and digest proof.',
  };
  return requirements[preferredKind]
    || `Stage ${stage} requires one of: ${(SALES_STAGE_EVIDENCE_KINDS[stage] || []).join(', ') || 'none'}.`;
}

function buildReceiptCommandTemplate(lead = {}, preferredKind) {
  const stage = normalizeSalesStage(lead.stage, 'targeted');
  if (stage === 'targeted') return null;
  if (stage === 'paid' || preferredKind === 'provider_payment') {
    const argv = [
      'npm', 'run', 'sales:reconcile-payment', '--',
      '--provider', `${PLACEHOLDER_PREFIX}PAYMENT_PROVIDER`,
      '--payment', `${PLACEHOLDER_PREFIX}PROVIDER_PAYMENT_ID`,
      '--lead', lead.leadId,
    ];
    return {
      executable: false,
      reason: 'Payment state is provider-controlled; replace the payment ID only after a live provider readback.',
      argv,
      display: formatArgv(argv),
    };
  }

  const argv = [
    'node', 'scripts/sales-pipeline.js', 'advance',
    '--lead', lead.leadId,
    '--stage', stage,
    '--evidence-kind', preferredKind,
    '--evidence-source', `${PLACEHOLDER_PREFIX}SOURCE`,
    '--evidence-ref', `${PLACEHOLDER_PREFIX}RECEIPT`,
    '--timestamp', `${PLACEHOLDER_PREFIX}TIMESTAMP`,
  ];
  return {
    executable: false,
    reason: 'The source, receipt, and timestamp placeholders make this template fail closed until real read-only evidence is inspected.',
    argv,
    display: formatArgv(argv),
  };
}

function buildStageEvidenceRepair(lead = {}, stageEvidence = evaluateLeadStageEvidence(lead)) {
  if (stageEvidence.verified === true) return null;
  const stage = normalizeSalesStage(lead.stage, 'targeted');
  const allowedEvidenceKinds = SALES_STAGE_EVIDENCE_KINDS[stage] || [];
  const preferredKind = PREFERRED_STAGE_EVIDENCE[stage] || allowedEvidenceKinds[0] || null;
  if (!preferredKind) return null;
  return {
    kind: 'stage_evidence_repair',
    stage,
    preferredEvidenceKind: preferredKind,
    allowedEvidenceKinds,
    requirement: evidenceRequirement(stage, preferredKind),
    safeAction: `Inspect the authoritative ${preferredKind} source read-only. Record it only if the receipt exists and belongs to this lead; otherwise keep the lead held.`,
    commandTemplate: buildReceiptCommandTemplate(lead, preferredKind),
  };
}

function buildBlockers({ zeroSpendStatus, stageEvidence, actionEligibility, stageSignalTiming, stage }) {
  const blockers = [];
  if (zeroSpendStatus === 'discarded_paid_requirement') {
    blockers.push({
      code: 'paid_requirement',
      reason: 'This route requires seller payment, paid access, subscription, or revenue share.',
    });
  } else if (zeroSpendStatus === 'hold_unverified_cost') {
    blockers.push({
      code: 'cost_unverified',
      reason: 'The complete funnel is not proven free of present or future seller obligations.',
    });
  }
  if (stageEvidence.verified !== true) {
    blockers.push({
      code: 'stage_evidence_missing',
      reason: stageEvidence.reason || 'Current stage lacks stage-appropriate evidence.',
    });
  }
  if (actionEligibility.status === 'hold_pipeline_transition_missing') {
    blockers.push({
      code: 'pipeline_transition_missing',
      reason: actionEligibility.reason,
    });
  }
  if (actionEligibility.status === 'hold_follow_up_cooldown') {
    blockers.push({
      code: 'follow_up_cooldown',
      reason: actionEligibility.reason,
    });
  }
  if (actionEligibility.status === 'hold_already_followed_up') {
    blockers.push({
      code: 'follow_up_exhausted',
      reason: actionEligibility.reason,
    });
  }
  if (actionEligibility.status === 'hold_checkout_intent_unverified') {
    blockers.push({
      code: 'checkout_intent_unverified',
      reason: actionEligibility.reason,
    });
  }
  if (actionEligibility.status === 'hold_stale_buyer_reply') {
    blockers.push({
      code: 'buyer_reply_stale',
      reason: actionEligibility.reason,
    });
  }
  if (actionEligibility.status === 'hold_buyer_reply_time_invalid') {
    blockers.push({
      code: 'buyer_reply_time_invalid',
      reason: actionEligibility.reason,
    });
  }
  if (
    SAME_DAY_CLOSE_STAGES.has(stage)
    && stageSignalTiming.stageSignalTimestampValid === false
    && actionEligibility.status !== 'hold_buyer_reply_time_invalid'
  ) {
    blockers.push({
      code: stageSignalTiming.stageSignalAt ? 'stage_signal_time_invalid' : 'stage_signal_time_missing',
      reason: stageSignalTiming.stageSignalAt
        ? 'The current-stage signal is more than five minutes in the future and cannot receive same-day priority.'
        : 'The current-stage signal has no valid timestamp and cannot receive same-day priority.',
    });
  } else if (
    SAME_DAY_CLOSE_STAGES.has(stage)
    && stageSignalTiming.stageSignalFresh === false
    && actionEligibility.status !== 'hold_stale_buyer_reply'
  ) {
    blockers.push({
      code: stageEvidence.verified === true ? 'stage_signal_stale' : 'stage_label_stale',
      reason: stageEvidence.verified === true
        ? 'The latest stage-appropriate signal is older than 14 days and is not a same-day revenue signal.'
        : 'The unverified high-intent stage label was entered more than 14 days ago and is not a same-day revenue signal.',
    });
  }
  return blockers;
}

function resolveRemediationQueueClass({ zeroSpendStatus, stageEvidence, actionEligibility }) {
  if (zeroSpendStatus === 'discarded_paid_requirement') return 'discarded';
  if (zeroSpendStatus === 'hold_unverified_cost' || stageEvidence.verified !== true) return 'remediation';
  if (actionEligibility.queueClass === 'approval_ready') return 'approval_ready';
  if (actionEligibility.queueClass === 'internal_ready') return 'internal_ready';
  if (actionEligibility.queueClass === 'terminal') return 'terminal';
  return 'monitor';
}

function scoreRemediationRow(row = {}) {
  if (row.queueClass === 'discarded') return -1000;
  let score = STAGE_PRIORITY[row.stage] || 0;
  if (row.queueClass === 'remediation') score += 10;
  // A verified buyer conversation must outrank repair work. Evidence repair is
  // important, but it is not intent and must never displace a real warm reply.
  if (row.queueClass === 'approval_ready') score += 30;
  if (row.queueClass === 'internal_ready') score += 15;
  if (row.zeroSpendStatus === 'hold_unverified_cost') score -= 20;
  if (row.actionStatus === 'hold_already_followed_up') score -= 30;
  if (row.actionStatus === 'hold_follow_up_cooldown') score -= 10;
  if (row.actionStatus === 'hold_stale_buyer_reply') score -= 25;
  if (row.actionStatus === 'hold_buyer_reply_time_invalid') score -= 40;
  if (SAME_DAY_CLOSE_STAGES.has(row.stage) && row.stageSignalFresh === false) score -= 35;
  if (row.stage === 'paid') score -= 20;
  return score;
}

function buildSafeNextAction({ zeroSpendStatus, stageEvidenceRepair, actionEligibility }) {
  if (zeroSpendStatus === 'discarded_paid_requirement') {
    return actionEligibility.zeroCostReplacement
      || 'Discard the paid route and use an existing warm conversation, owned intake, or direct organic channel.';
  }
  if (zeroSpendStatus === 'hold_unverified_cost') {
    return 'Inspect the complete downstream terms read-only. If zero cost cannot be proven, discard the route and use a direct organic replacement.';
  }
  if (stageEvidenceRepair) return stageEvidenceRepair.safeAction;
  return actionEligibility.nextAction;
}

function buildRemediationRow(lead = {}, target = {}, { now } = {}) {
  const evaluatedAt = now || new Date().toISOString();
  const stage = normalizeSalesStage(lead.stage, 'targeted');
  const zeroSpendStatus = resolveLeadZeroSpendStatus(lead, target);
  const stageEvidence = evaluateLeadStageEvidence(lead);
  const actionEligibility = evaluateRevenueActionEligibility(lead, target, { now: evaluatedAt });
  const stageSignalTiming = buildStageSignalTiming(lead, stageEvidence, { now: evaluatedAt });
  const preferredStageEvidenceTiming = buildPreferredStageEvidenceTiming(lead, { now: evaluatedAt });
  const stageEvidenceRepair = buildStageEvidenceRepair(lead, stageEvidence);
  const blockers = buildBlockers({
    zeroSpendStatus,
    stageEvidence,
    actionEligibility,
    stageSignalTiming,
    stage,
  });
  const queueClass = resolveRemediationQueueClass({ zeroSpendStatus, stageEvidence, actionEligibility });
  const sameDayPriorityEligible = SAME_DAY_CLOSE_STAGES.has(stage)
    && zeroSpendStatus === 'proceed_zero_cost'
    && actionEligibility.status !== 'hold_stale_buyer_reply'
    && actionEligibility.status !== 'hold_buyer_reply_time_invalid';
  const row = {
    leadId: lead.leadId,
    stage,
    source: normalizeText(target.source || lead.source, 80) || 'manual',
    channel: normalizeText(target.channel || lead.channel, 80) || 'manual',
    offer: normalizeText(lead.offer, 120) || 'workflow_hardening_sprint',
    queueClass,
    actionStatus: actionEligibility.status,
    zeroSpendStatus,
    stageEvidenceVerified: stageEvidence.verified === true,
    stageEvidenceKind: stageEvidence.evidence?.kind || null,
    ...stageSignalTiming,
    ...preferredStageEvidenceTiming,
    sameDayEvidencePriority: sameDayPriorityEligible
      && preferredStageEvidenceTiming.preferredStageEvidenceFresh === true,
    sameDayReviewPriority: sameDayPriorityEligible
      && stageSignalTiming.stageSignalFresh === true
      && preferredStageEvidenceTiming.preferredStageEvidenceFresh !== true
      && !['discarded', 'terminal'].includes(queueClass),
    readyForOutbound: actionEligibility.readyForOutbound === true,
    requiresApproval: actionEligibility.requiresApproval === true,
    approvalPhrase: actionEligibility.approvalPhrase || null,
    nextEligibleAt: actionEligibility.nextEligibleAt || null,
    blockers,
    stageEvidenceRepair,
    zeroCostReplacement: actionEligibility.zeroCostReplacement || null,
    safeNextAction: buildSafeNextAction({ zeroSpendStatus, stageEvidenceRepair, actionEligibility }),
    reason: actionEligibility.reason,
  };
  row.priorityScore = scoreRemediationRow(row);
  return row;
}

function summarizeRows(rows = []) {
  const byQueueClass = {};
  const byActionStatus = {};
  const byStage = {};
  for (const row of rows) {
    byQueueClass[row.queueClass] = (byQueueClass[row.queueClass] || 0) + 1;
    byActionStatus[row.actionStatus] = (byActionStatus[row.actionStatus] || 0) + 1;
    byStage[row.stage] = (byStage[row.stage] || 0) + 1;
  }
  return {
    total: rows.length,
    byQueueClass,
    byActionStatus,
    byStage,
    sameDayEvidencePriority: rows.filter((row) => row.sameDayEvidencePriority).length,
    sameDayReviewPriority: rows.filter((row) => row.sameDayReviewPriority).length,
    approvalReady: rows.filter((row) => row.queueClass === 'approval_ready').length,
    internalReady: rows.filter((row) => row.queueClass === 'internal_ready').length,
    remediationRequired: rows.filter((row) => row.queueClass === 'remediation').length,
    discardedPaidRequirement: rows.filter((row) => row.queueClass === 'discarded').length,
  };
}

function buildPrimaryAction(rows = []) {
  const row = rows.find((candidate) => !['discarded', 'terminal'].includes(candidate.queueClass));
  if (!row) return null;
  return {
    leadId: row.leadId,
    stage: row.stage,
    queueClass: row.queueClass,
    actionStatus: row.actionStatus,
    priorityScore: row.priorityScore,
    sameDayEvidencePriority: row.sameDayEvidencePriority,
    sameDayReviewPriority: row.sameDayReviewPriority,
    safeAction: row.safeNextAction,
    proofRequired: row.stageEvidenceRepair?.requirement || row.reason,
    approvalPhrase: row.approvalPhrase,
    externalSideEffectAuthorized: false,
  };
}

function buildRevenueEvidenceRemediationQueue({ leads = [], targets = [], now = new Date().toISOString() } = {}) {
  const targetMap = buildTargetMap(targets);
  const rows = leads
    .map((lead) => buildRemediationRow(lead, targetMap.get(lead.leadId) || {}, { now }))
    .sort((left, right) => (
      right.priorityScore - left.priorityScore
      || String(left.leadId).localeCompare(String(right.leadId))
    ));
  return {
    generatedAt: now,
    claimBoundary: 'This queue proves local action/remediation eligibility only. A fresh-label review row is not verified buyer evidence. The queue does not prove a send, reply, checkout, payment, revenue, or customer outcome.',
    zeroSpendRule: 'No paid access, seller fee, subscription, credit purchase, card-required trial, or revenue share may be used to reach a buyer.',
    summary: summarizeRows(rows),
    primaryAction: buildPrimaryAction(rows),
    rows,
  };
}

function renderRowMarkdown(row, index) {
  const blockerLines = row.blockers.length
    ? row.blockers.map((blocker) => `  - ${blocker.code}: ${blocker.reason}`)
    : ['  - none'];
  const repair = row.stageEvidenceRepair;
  return [
    `### ${index + 1}. ${row.leadId}`,
    `- Stage: ${row.stage}`,
    `- Queue: ${row.queueClass}`,
    `- Priority score: ${row.priorityScore}`,
    `- Action status: ${row.actionStatus}`,
    `- Zero-spend status: ${row.zeroSpendStatus}`,
    `- Current-stage evidence verified: ${row.stageEvidenceVerified}`,
    `- Preferred same-day evidence kind: ${row.preferredStageEvidenceKind || 'none'}`,
    `- Preferred same-day evidence at: ${row.preferredStageEvidenceAt || 'none'}`,
    `- Preferred same-day evidence fresh: ${row.preferredStageEvidenceFresh}`,
    `- Verified same-day evidence priority: ${row.sameDayEvidencePriority}`,
    `- Fresh-label read-only review priority: ${row.sameDayReviewPriority}`,
    `- Ready for outbound: ${row.readyForOutbound}`,
    `- Approval phrase: ${row.approvalPhrase || 'none'}`,
    '- Blockers:',
    ...blockerLines,
    `- Safe next action: ${row.safeNextAction}`,
    ...(repair ? [
      `- Preferred evidence: ${repair.preferredEvidenceKind}`,
      `- Proof required: ${repair.requirement}`,
      '- Non-executable repair template:',
      '```text',
      repair.commandTemplate?.display || 'none',
      '```',
    ] : []),
    '',
  ];
}

function renderRevenueEvidenceRemediationMarkdown(queue = {}, { limit = null } = {}) {
  const rows = Array.isArray(queue.rows) ? queue.rows : [];
  const displayedRows = normalizeLimit(limit, null) ? rows.slice(0, normalizeLimit(limit, null)) : rows;
  const summary = queue.summary || summarizeRows(rows);
  const primary = queue.primaryAction;
  return [
    '# Revenue Evidence Remediation Queue',
    '',
    `Generated: ${queue.generatedAt || new Date().toISOString()}`,
    '',
    queue.claimBoundary,
    '',
    `Zero-spend rule: ${queue.zeroSpendRule}`,
    '',
    '## Summary',
    '',
    `- Total leads: ${summary.total || 0}`,
    `- Verified same-day evidence-priority rows: ${summary.sameDayEvidencePriority || 0}`,
    `- Fresh-label read-only review rows: ${summary.sameDayReviewPriority || 0}`,
    `- Remediation required: ${summary.remediationRequired || 0}`,
    `- Approval ready: ${summary.approvalReady || 0}`,
    `- Internal ready: ${summary.internalReady || 0}`,
    `- Discarded paid requirement: ${summary.discardedPaidRequirement || 0}`,
    '',
    '## Primary Safe Action',
    '',
    ...(primary ? [
      `- Lead: ${primary.leadId}`,
      `- Stage: ${primary.stage}`,
      `- Queue: ${primary.queueClass}`,
      `- Verified same-day evidence priority: ${primary.sameDayEvidencePriority}`,
      `- Fresh-label read-only review priority: ${primary.sameDayReviewPriority}`,
      `- Action: ${primary.safeAction}`,
      `- Proof required: ${primary.proofRequired}`,
      `- Approval phrase: ${primary.approvalPhrase || 'none'}`,
      `- External side effect authorized: ${primary.externalSideEffectAuthorized}`,
    ] : ['- No non-terminal action is available.']),
    '',
    '## Ranked Rows',
    '',
    ...(displayedRows.length ? displayedRows.flatMap(renderRowMarkdown) : ['- No leads loaded.', '']),
  ].join('\n').trimEnd() + '\n';
}

function parseArgs(argv = []) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const eqIndex = arg.indexOf('=', 2);
    const rawKey = eqIndex === -1 ? arg.slice(2) : arg.slice(2, eqIndex);
    const key = rawKey.replaceAll(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (eqIndex !== -1) {
      options[key] = arg.slice(eqIndex + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return options;
}

function writeArtifact(outPath, content) {
  if (!outPath) return null;
  const resolved = path.resolve(outPath);
  ensureParentDir(resolved);
  fs.writeFileSync(resolved, content, 'utf8');
  return resolved;
}

function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const leads = loadSalesLeads({ statePath: options.state, feedbackDir: options.feedbackDir });
  const targets = loadTargetRecords(options.targets || null);
  const queue = buildRevenueEvidenceRemediationQueue({
    leads,
    targets,
    now: options.now || new Date().toISOString(),
  });
  const markdown = renderRevenueEvidenceRemediationMarkdown(queue, { limit: options.limit });
  const markdownPath = writeArtifact(options.out, markdown);
  const jsonPath = writeArtifact(options.jsonOut, `${JSON.stringify(queue, null, 2)}\n`);
  return {
    queue,
    markdown,
    output: options.json === true ? `${JSON.stringify(queue, null, 2)}\n` : markdown,
    markdownPath,
    jsonPath,
  };
}

function isCliInvocation(argv = process.argv) {
  const invokedPath = argv[1];
  if (!invokedPath) return false;
  try {
    return fs.realpathSync(path.resolve(invokedPath)) === fs.realpathSync(__filename);
  } catch {
    return path.resolve(invokedPath) === path.resolve(__filename);
  }
}

if (isCliInvocation()) {
  try {
    const result = runCli();
    process.stdout.write(result.output);
  } catch (error) {
    console.error(error?.message || error);
    process.exitCode = 1;
  }
}

module.exports = {
  PLACEHOLDER_PREFIX,
  PREFERRED_STAGE_EVIDENCE,
  SAME_DAY_CLOSE_STAGES,
  STAGE_SIGNAL_FRESHNESS_MS,
  STAGE_PRIORITY,
  buildPrimaryAction,
  buildReceiptCommandTemplate,
  buildRemediationRow,
  buildRevenueEvidenceRemediationQueue,
  buildPreferredStageEvidenceTiming,
  buildStageEvidenceRepair,
  buildStageSignalTiming,
  formatArgv,
  isCliInvocation,
  loadTargetRecords,
  parseArgs,
  resolvePreferredStageEvidence,
  resolveCurrentStageEnteredAt,
  renderRevenueEvidenceRemediationMarkdown,
  runCli,
  scoreRemediationRow,
  shellQuote,
  summarizeRows,
  writeArtifact,
};
