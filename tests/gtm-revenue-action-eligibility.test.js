'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  applyPipelineStateToTargets,
  buildOperatorHandoffPayload,
  buildOperatorSendNowPayload,
  renderOperatorSendNowMarkdown,
  renderTeamOutreachMessagesMarkdown,
} = require('../scripts/gtm-revenue-loop');
const {
  addSalesLead,
  advanceSalesLead,
  buildLeadFromRevenueTarget,
} = require('../scripts/sales-pipeline');

const NOW = '2026-07-16T12:00:00.000Z';

function tempStatePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-gtm-eligibility-')), 'sales-pipeline.jsonl');
}

function target(overrides = {}) {
  return {
    temperature: 'warm',
    source: 'reddit',
    channel: 'reddit_comment',
    username: 'buyer',
    accountName: 'r/agents',
    evidenceScore: 12,
    evidence: ['workflow pain named: repeated paid-search overrun'],
    motion: 'sprint',
    motionLabel: 'Workflow Hardening Diagnostic',
    motionReason: 'Repeated paid-search overrun needs a pre-call cost gate.',
    firstTouchDraft: 'I can sketch the pre-call cost gate for this workflow.',
    painConfirmedFollowUpDraft: 'If the overrun is active, share the trigger and rough spend band.',
    ...overrides,
  };
}

function emptyReport(targets) {
  return {
    generatedAt: NOW,
    directive: { state: 'pipeline-active-no-revenue', headline: 'No verified payment.' },
    verification: { label: 'local evidence only' },
    snapshot: { paidOrders: 0, checkoutStarts: 0 },
    targets,
  };
}

test('new direct-organic target is approval-ready but never pre-approved', () => {
  const statePath = tempStatePath();
  const [result] = applyPipelineStateToTargets([target()], { salesStatePath: statePath, now: NOW });
  assert.equal(result.actionEligibility.status, 'approval_required_first_touch');
  assert.equal(result.actionEligibility.readyForOutbound, true);
  assert.match(result.actionEligibility.approvalPhrase, /^APPROVE SEND THUMBGATE FIRST TOUCH/);

  const handoff = buildOperatorHandoffPayload(emptyReport([result]));
  assert.equal(handoff.summary.warmTargetsReadyNow, 1);
  assert.equal(buildOperatorSendNowPayload(emptyReport([result])).rows.length, 1);
});

test('raw replied label without receipt is held and excluded from send-now', () => {
  const statePath = tempStatePath();
  const candidate = buildLeadFromRevenueTarget(target());
  fs.writeFileSync(statePath, `${JSON.stringify({ ...candidate, stage: 'replied', updatedAt: NOW })}\n`, 'utf8');

  const [result] = applyPipelineStateToTargets([target()], { salesStatePath: statePath, now: NOW });
  assert.equal(result.actionEligibility.status, 'hold_unverified_stage_evidence');
  const report = emptyReport([result]);
  const handoff = buildOperatorHandoffPayload(report);
  assert.equal(handoff.summary.activeFollowUps, 0);
  assert.equal(handoff.summary.heldTargets, 1);
  assert.equal(buildOperatorSendNowPayload(report).rows.length, 0);
  assert.doesNotMatch(renderOperatorSendNowMarkdown(report), /First-touch draft:/);
  assert.doesNotMatch(renderTeamOutreachMessagesMarkdown(report), /I can sketch the pre-call cost gate/);
  assert.match(renderTeamOutreachMessagesMarkdown(report), /No approval-ready warm discovery targets/);
});

test('verified unanswered reply enters approval-ready follow-up section', () => {
  const statePath = tempStatePath();
  const candidate = buildLeadFromRevenueTarget(target());
  addSalesLead({
    leadId: candidate.leadId,
    source: candidate.source,
    channel: candidate.channel,
    username: candidate.contact.username,
    timestamp: '2026-07-13T10:00:00.000Z',
  }, { statePath });
  advanceSalesLead({
    leadId: candidate.leadId,
    stage: 'contacted',
    evidenceKind: 'platform_send_receipt',
    evidenceSource: 'reddit',
    evidenceRef: 'https://reddit.example/send-1',
    timestamp: '2026-07-13T10:00:00.000Z',
  }, { statePath });
  advanceSalesLead({
    leadId: candidate.leadId,
    stage: 'replied',
    evidenceKind: 'buyer_reply',
    evidenceSource: 'reddit',
    evidenceRef: 'https://reddit.example/reply-1',
    timestamp: '2026-07-14T10:00:00.000Z',
  }, { statePath });

  const [result] = applyPipelineStateToTargets([target()], { salesStatePath: statePath, now: NOW });
  assert.equal(result.actionEligibility.status, 'approval_required_qualification_reply');
  const report = emptyReport([result]);
  assert.equal(buildOperatorHandoffPayload(report).summary.activeFollowUps, 1);
  assert.equal(buildOperatorSendNowPayload(report).rows[0].approvalPhrase, result.actionEligibility.approvalPhrase);
  assert.match(renderTeamOutreachMessagesMarkdown(report), new RegExp(result.actionEligibility.approvalPhrase));
  assert.match(renderTeamOutreachMessagesMarkdown(report), /First-touch draft:/);
});

test('newer send after a reply is held as already followed up', () => {
  const statePath = tempStatePath();
  const candidate = buildLeadFromRevenueTarget(target());
  addSalesLead({ leadId: candidate.leadId, source: 'reddit', username: 'buyer' }, { statePath });
  advanceSalesLead({
    leadId: candidate.leadId,
    stage: 'contacted',
    evidenceKind: 'platform_send_receipt',
    evidenceSource: 'reddit',
    evidenceRef: 'send-1',
    timestamp: '2026-07-13T10:00:00.000Z',
  }, { statePath });
  advanceSalesLead({
    leadId: candidate.leadId,
    stage: 'replied',
    evidenceKind: 'buyer_reply',
    evidenceSource: 'reddit',
    evidenceRef: 'reply-1',
    timestamp: '2026-07-14T10:00:00.000Z',
  }, { statePath });
  advanceSalesLead({
    leadId: candidate.leadId,
    stage: 'replied',
    evidenceKind: 'platform_send_receipt',
    evidenceSource: 'reddit',
    evidenceRef: 'send-2',
    timestamp: '2026-07-15T10:00:00.000Z',
  }, { statePath });

  const [result] = applyPipelineStateToTargets([target()], { salesStatePath: statePath, now: NOW });
  assert.equal(result.actionEligibility.status, 'hold_already_followed_up');
  assert.equal(buildOperatorSendNowPayload(emptyReport([result])).rows.length, 0);
});

test('unknown-cost marketplace is held and carries a zero-cost replacement', () => {
  const statePath = tempStatePath();
  const [result] = applyPipelineStateToTargets([target({
    source: 'marketplace',
    channel: 'marketplace',
    username: 'listing-partner',
  })], { salesStatePath: statePath, now: NOW });
  assert.equal(result.actionEligibility.status, 'hold_unverified_cost');
  assert.match(result.actionEligibility.zeroCostReplacement, /first-party intake|direct organic/i);
  assert.equal(buildOperatorSendNowPayload(emptyReport([result])).rows.length, 0);
});
