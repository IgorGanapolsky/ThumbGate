'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_SPRINT_DIAGNOSTIC_PRICE_DOLLARS,
  DEFAULT_WORKFLOW_SPRINT_PRICE_DOLLARS,
} = require('../scripts/hosted-config');
const {
  PRO_MONTHLY_PRICE_DOLLARS,
  PRO_ANNUAL_PRICE_DOLLARS,
} = require('../scripts/commercial-offer');
const { OFFER_CATALOG } = require('../scripts/revenue-offer-system');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const commercialTruth = read('docs/COMMERCIAL_TRUTH.md');
const ladder = read('docs/REVENUE_OFFER_LADDER.md');
const diagnostic = read('public/diagnostic.html');

test('commercial truth names one promoted public service offer', () => {
  assert.match(commercialTruth, /only promoted public offer.*Managed AI Agent Workflow Gate.*\$499 one-time/is);
  assert.match(commercialTruth, /\/go\/diagnostic-pay/);
  assert.match(commercialTruth, /\$1,500.*internal catalog\/scoping rail/i);
  assert.match(commercialTruth, /\$499.*only currently promoted public one-time service offer/i);
});

test('managed-gate page states a complete fixed-scope implementation contract', () => {
  assert.match(diagnostic, /Exactly what the \$499 Enterprise Workflow Gate includes/);
  assert.match(diagnostic, /one 60-minute working review/i);
  assert.match(diagnostic, /within two business days/i);
  assert.match(diagnostic, /workflow and failure map/i);
  assert.match(diagnostic, /one configured local gate/i);
  assert.match(diagnostic, /regression test/i);
  assert.match(diagnostic, /rollout, rollback, and verification proof/i);
  assert.match(diagnostic, /does not include multi-system implementation/i);
  assert.match(diagnostic, /guaranteed savings/i);
  assert.match(diagnostic, /order is refunded instead of being silently converted/i);
});

test('managed-gate fit mechanics prevent an open-ended upsell', () => {
  assert.match(diagnostic, /data-diagnostic-fit-terms/);
  assert.match(diagnostic, /order is refunded instead of being silently converted/i);
  assert.doesNotMatch(diagnostic, /public Workflow Hardening Sprint is/i);
  assert.match(commercialTruth, /refunded instead of silently upsold/i);
});

test('unverified marketplace obligations cannot receive a payment diversion', () => {
  assert.match(diagnostic, /Aiventyx payment path is paused/i);
  assert.match(diagnostic, /seller fees and downstream obligations remain unverified/i);
  assert.match(diagnostic, /without entering a marketplace payment or revenue-share commitment/i);
  assert.doesNotMatch(diagnostic, /Aiventyx will collect payment/);
});

test('offer ladder prices match the runtime catalog defaults', () => {
  assert.equal(DEFAULT_SPRINT_DIAGNOSTIC_PRICE_DOLLARS, 499);
  assert.equal(DEFAULT_WORKFLOW_SPRINT_PRICE_DOLLARS, 1500);
  assert.equal(PRO_MONTHLY_PRICE_DOLLARS, 19);
  assert.equal(PRO_ANNUAL_PRICE_DOLLARS, 149);
  assert.match(ladder, /price: \$499 one-time/);
  assert.match(ladder, /price: \$1,500 one-time/);
  assert.match(ladder, /price: \$19\/month or \$149\/year/);
  assert.equal(OFFER_CATALOG.workflow_reliability_operations.priceCents, 300000);
  assert.equal(OFFER_CATALOG.enterprise_governance_pilot.priceCents, 1500000);
  assert.equal(OFFER_CATALOG.enterprise_reliability_operations.priceCents, 1000000);
  assert.match(ladder, /price: \$3,000\/month/);
  assert.match(ladder, /price: \$15,000 one-time for a 30-day pilot/);
  assert.match(ladder, /price: \$10,000\/month/);
  assert.match(commercialTruth, /Workflow Reliability Operations at \$3,000\/month/i);
  assert.match(commercialTruth, /\$15,000 30-day Enterprise Governance Pilot/i);
  assert.match(commercialTruth, /Enterprise Reliability Operations at \$10,000\/month/i);
});

test('revenue target is explicit math and never presented as achieved traction', () => {
  assert.match(ladder, /\$24,000\/day/);
  assert.match(ladder, /\$8,760,000\/year/);
  assert.match(ladder, /49.*paid.*\$499.*diagnostics per day/i);
  assert.match(ladder, /16.*paid.*\$1,500.*internal sprint scopes per day/i);
  assert.match(ladder, /38,422.*active.*\$19\/month.*subscriptions/i);
  assert.match(ladder, /244.*active.*\$3,000\/month.*Workflow Reliability Operations/i);
  assert.match(ladder, /49.*paid.*\$15,000.*Enterprise Governance Pilots/i);
  assert.match(ladder, /73.*active.*\$10,000\/month.*Enterprise Reliability Operations/i);
  assert.match(ladder, /does not claim that ThumbGate has reached that rate/i);
  assert.match(ladder, /arithmetic requirements, not forecasts/i);
});

test('offer ladder keeps proof stages and Enterprise boundaries distinct', () => {
  assert.match(ladder, /Raw Stripe session creation is not buyer intent/i);
  assert.match(ladder, /a sent link is not checkout/i);
  assert.match(ladder, /checkout is not payment/i);
  assert.match(ladder, /payment is not a customer outcome/i);
  assert.match(ladder, /hosted team sync.*not general availability/i);
  assert.match(ladder, /Only provider-confirmed payments and active subscriptions count/i);
  assert.match(ladder, /requires accepted-scope evidence before `named_pilot`/i);
  assert.match(ladder, /cannot advance to `paid_team` until the linked sales-pipeline record/i);
  assert.match(ladder, /Stripe Checkout Session, Payment Link, price, product, or raw PayPal checkout URL is not payment evidence/i);
  assert.match(ladder, /exact offer, catalog value or documented.*SHA-256 agreement digest/i);
  assert.match(ladder, /same buyer's separate provider-paid `\$499` diagnostic/i);
  assert.match(ladder, /cannot be reused across multiple workflow contracts/i);
  assert.match(ladder, /generic Pro subscription.*cannot become recurring or Enterprise proof/i);
  assert.match(ladder, /completed-pilot reference and digest/i);
  assert.match(commercialTruth, /Productized recurring and Enterprise milestones are stricter than generic MRR/i);
});

test('offer ladder requires first-party buyer paths and blocks unverified distribution', () => {
  assert.match(ladder, /Every active buyer-facing link must land on `thumbgate\.ai` first/i);
  assert.match(ladder, /Raw provider Payment Links are server-side plumbing only/i);
  assert.match(ladder, /Aiventyx campaign remains `hold_unverified_cost`/i);
  assert.match(commercialTruth, /Raw Stripe or PayPal links are provider plumbing, not buyer-facing distribution assets/i);
  assert.match(commercialTruth, /Retired kit catalogs are archived/i);
  assert.match(commercialTruth, /Zernio is retired for ThumbGate publishing/i);
  assert.match(commercialTruth, /fails closed before a network request/i);
});
