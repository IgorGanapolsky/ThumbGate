'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateCredentialUse,
  formatCredentialPlan,
  markCredentialUsed,
  mintCredentialGrant,
  planSingleUseCredentialRequest,
} = require('../scripts/single-use-credential-gate');

test('planSingleUseCredentialRequest requires synchronous approval for purchases', () => {
  const plan = planSingleUseCredentialRequest({
    intent: 'Ask the agent to buy a gift on Gumroad.',
  });

  assert.equal(plan.required, true);
  assert.equal(plan.approvalMode, 'synchronous');
  assert.equal(plan.singleUse, true);
  assert.equal(plan.scope.resource, 'purchase');
  assert.ok(plan.riskTags.includes('purchase'));
});

test('planSingleUseCredentialRequest rejects persistent or broad credentials', () => {
  const plan = planSingleUseCredentialRequest({
    intent: 'Create a reusable token for all writes.',
    persistent: true,
    scope: '*:*',
  });

  assert.ok(plan.deniedReasons.includes('persistent_credentials_not_allowed'));
  assert.ok(plan.deniedReasons.includes('credential_scope_too_broad'));
});

test('mintCredentialGrant creates a narrow one-time approved grant', () => {
  const request = planSingleUseCredentialRequest({
    intent: 'Create a Stripe checkout session.',
  });
  const grant = mintCredentialGrant(request, {
    approved: true,
    approvedBy: 'operator',
    evidence: 'approval-card-1',
  });

  assert.equal(grant.approved, true);
  assert.equal(grant.singleUse, true);
  assert.equal(grant.scope.resource, 'payments');
  assert.equal(grant.approvalEvidence, 'approval-card-1');
});

test('evaluateCredentialUse blocks unapproved, reused, expired, and mismatched grants', () => {
  const request = planSingleUseCredentialRequest({ intent: 'Create a Stripe checkout session.' });
  const grant = mintCredentialGrant(request, { approved: true });
  const now = new Date('2026-05-04T12:00:00.000Z');
  const expired = {
    ...grant,
    expiresAt: '2026-05-04T11:59:00.000Z',
  };
  const reused = markCredentialUsed(grant, now);

  assert.equal(evaluateCredentialUse(grant, { scope: 'payments:write' }, now).allowed, true);
  assert.ok(evaluateCredentialUse({ ...grant, approved: false }, { scope: 'payments:write' }, now).reasons.includes('credential_not_approved'));
  assert.ok(evaluateCredentialUse(reused, { scope: 'payments:write' }, now).reasons.includes('credential_already_used'));
  assert.ok(evaluateCredentialUse(expired, { scope: 'payments:write' }, now).reasons.includes('credential_expired'));
  assert.ok(evaluateCredentialUse(grant, { scope: 'deployment:write' }, now).reasons.includes('credential_scope_mismatch'));
});

test('formatCredentialPlan renders operator approval copy', () => {
  const markdown = formatCredentialPlan(planSingleUseCredentialRequest({
    intent: 'Post an approved reply.',
  }));

  assert.match(markdown, /Single-Use Credential Plan/);
  assert.match(markdown, /Approval mode: synchronous/);
});
