'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  captureFirstPartyAttribution,
  validateProgressiveStep,
  qualifyAndRouteFlowstateLead,
  buildMasterclassCalendarLockIn,
  getExitIntentRecoveryOffer,
} = require('../src/flowstate-conversion-steal');

test('FlowState 3-step progressive micro-commitment intake validates each step', () => {
  const s1Fail = validateProgressiveStep(1, { firstName: '', lastName: '' });
  assert.equal(s1Fail.ok, false);

  const s1Pass = validateProgressiveStep(1, { firstName: 'Igor', lastName: 'Ganapolsky' });
  assert.equal(s1Pass.ok, true);
  assert.equal(s1Pass.ctaLabel, "LET'S START");
  assert.equal(s1Pass.nextStep, 2);

  const s2Pass = validateProgressiveStep(2, {
    email: 'cto@acme.dev',
    phone: '+1 (305) 555-0199',
    role: 'CTO / VP Engineering',
  });
  assert.equal(s2Pass.ok, true);
  assert.equal(s2Pass.phoneStatus, 'Phone format looks right.');
  assert.equal(s2Pass.nextStep, 3);

  const s3Pass = validateProgressiveStep(3, {
    annualRevenueUsd: 2500000,
    teamSize: 18,
    isOwnerOrExec: true,
  });
  assert.equal(s3Pass.ok, true);
  assert.equal(s3Pass.nextStep, 'Confirmation');
});

test('FlowState qualification router separates $499 Intensive, $49 Corporate Kit, $9.99 Not-a-Fit boundary, and $100 RealEstate', () => {
  const highTicket = qualifyAndRouteFlowstateLead({
    email: 'cto@seriesb.io',
    role: 'CTO / VP Engineering',
    annualRevenueUsd: 5000000,
    teamSize: 25,
    isOwnerOrExec: true,
  });
  assert.equal(highTicket.qualificationTier, 'QUALIFIED_INTENSIVE_499');
  assert.equal(highTicket.fireConversionPixel, true);
  assert.equal(highTicket.primaryOffer.priceUsd, 499);
  assert.equal(highTicket.primaryOffer.checkoutUrl, 'https://thumbgate.ai/go/diagnostic-direct');

  const corpKit = qualifyAndRouteFlowstateLead({
    email: 'lead@startup.dev',
    role: 'Team leader',
    annualRevenueUsd: 120000,
    teamSize: 4,
    isOwnerOrExec: false,
  });
  assert.equal(corpKit.qualificationTier, 'CORPORATE_EXPENSE_KIT_49');
  assert.equal(corpKit.fireConversionPixel, true);
  assert.equal(corpKit.primaryOffer.priceUsd, 49);
  assert.equal(corpKit.primaryOffer.checkoutUrl, 'https://iganapolsky.gumroad.com/l/vcrho');

  const soloDownsell = qualifyAndRouteFlowstateLead({
    email: 'student@hobby.dev',
    role: 'Individual Builder',
    annualRevenueUsd: 0,
    teamSize: 1,
    isOwnerOrExec: false,
  });
  assert.equal(soloDownsell.qualificationTier, 'SELF_SERVE_NOT_A_FIT_DOWNSELL');
  assert.equal(soloDownsell.fireConversionPixel, false);
  assert.equal(soloDownsell.hardDocumentBoundary, true);
  assert.equal(soloDownsell.boundaryPath, '/intensive-not-a-fit');
  assert.equal(soloDownsell.primaryOffer.priceUsd, 9.99);

  const realEstate = qualifyAndRouteFlowstateLead({
    email: 'bidder@flfunds.com',
    role: 'Real Estate Investor',
    industry: 'realestate_tax_deed',
  });
  assert.equal(realEstate.qualificationTier, 'REALESTATE_TAX_DEED_BUYER');
  assert.equal(realEstate.primaryOffer.priceUsd, 100);
});

test('FlowState attribution persistence, VCALENDAR lock-in, and exit-intent downsell', () => {
  const attr = captureFirstPartyAttribution({
    gclid: 'gclid_123',
    utm_source: 'linkedin',
    utm_campaign: 'flowstate_steal',
  });
  assert.equal(attr.ok, true);
  assert.ok(attr.eventId.startsWith('pv_'));
  assert.equal(attr.persisted.attr_gclid, 'gclid_123');
  assert.equal(attr.persisted.attr_utm_source, 'linkedin');

  const cal = buildMasterclassCalendarLockIn();
  assert.ok(cal.ics.includes('BEGIN:VCALENDAR'));
  assert.ok(cal.googleCalendarUrl.includes('calendar.google.com'));

  const exitOffer = getExitIntentRecoveryOffer('QUALIFIED_INTENSIVE_499');
  assert.equal(exitOffer.offer.priceUsd, 49);
});
