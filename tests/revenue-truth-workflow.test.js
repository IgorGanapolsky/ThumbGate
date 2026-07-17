'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const WORKFLOW_PATH = path.resolve(__dirname, '..', '.github', 'workflows', 'revenue-truth-audit.yml');

function workflowText() {
  return fs.readFileSync(WORKFLOW_PATH, 'utf8');
}

test('revenue truth audit stays manual on a standard runner with read-only permissions', () => {
  const source = workflowText();

  assert.match(source, /workflow_dispatch:/);
  assert.doesNotMatch(source, /^\s{2}schedule:\s*$/m);
  assert.match(source, /permissions:\s*\n\s+contents:\s+read/);
  assert.match(source, /runs-on:\s+ubuntu-latest/);
  assert.doesNotMatch(source, /runs-on:\s+(?:ubuntu|windows|macos)-\d+-core|larger-runner/i);
});

test('revenue truth audit fails closed on exact catalog or attribution drift', () => {
  const source = workflowText();

  assert.match(source, /stripe-revenue-catalog-audit\.js --json --out reports\/revenue\/stripe-revenue-catalog-audit\.json/);
  assert.match(source, /productAttribution\.verified/);
  assert.match(source, /Exact ThumbGate Stripe attribution is not verified/);
  assert.match(source, /productAttribution\.catalogVersion/);
  assert.doesNotMatch(source, /charges\.external\.uniqueCustomerCount/);
  assert.doesNotMatch(source, /subscriptions\.activeExternal/);
});

test('revenue truth audit reports only exact ThumbGate revenue fields', () => {
  const source = workflowText();

  assert.match(source, /productAttribution\.thumbgate\.uniquePayingCustomerCount/);
  assert.match(source, /productAttribution\.thumbgate\.netRevenueCents/);
  assert.match(source, /productAttribution\.thumbgate\.activeSubscriptionCount/);
  assert.match(source, /productAttribution\.thumbgate\.mrrCents/);
  assert.match(source, /revenueWindows\.todayNetRevenueCents/);
  assert.match(source, /account-wide Stripe activity, checkout views, intakes, and stage labels are not ThumbGate revenue/);
  assert.doesNotMatch(source, /Real non-owner (?:paying customers|active subscriptions|net revenue)/);
});

test('revenue truth audit covers the intake close queue and target controller without authorizing outreach', () => {
  const source = workflowText();

  assert.match(source, /workflow-intake-queue\.js --json/);
  assert.match(source, /discoveryReadyTotal/);
  assert.match(source, /approvalReadyTotal/);
  assert.match(source, /revenue-target-control\.js --json --no-provider-api --expected-sha="\$GITHUB_SHA"/);
  assert.doesNotMatch(source, /--export-private|send|post|publish|deploy/i);
});

test('revenue truth audit keeps transient artifacts to one day', () => {
  const source = workflowText();
  assert.match(source, /retention-days:\s+1/);
});
