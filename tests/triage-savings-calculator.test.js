'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PRICING_TIERS,
  calculateEnterpriseRoi,
} = require('../scripts/triage-savings-calculator');

test('calculateEnterpriseRoi calculates positive ROI for Pro tier with modest interdictions', () => {
  const result = calculateEnterpriseRoi(
    { vulnerabilities: 1, general: 10 },
    { tier: 'pro', hourlyRate: 125, months: 12 }
  );

  assert.equal(result.tier, 'Pro Firewall');
  assert.equal(result.hoursSaved.fromVulnerabilities, 96);
  assert.equal(result.hoursSaved.fromGeneralRegressions, 45); // 10 * 4.5
  assert.equal(result.hoursSaved.totalHours, 141);

  // 141 * $125 = $17,625 gross savings
  assert.equal(result.economics.grossSavingsDollars, 17625);
  // Pro tier = 19 * 12 = $228
  assert.equal(result.economics.totalCostDollars, 228);
  assert.equal(result.economics.netSavingsDollars, 17625 - 228); // $17,397
  assert.ok(result.economics.roiMultiplier > 70.0);
  assert.ok(result.economics.vulnsToBreakEven < 0.1); // Less than 0.1 vulnerability pays for entire year!
});

test('calculateEnterpriseRoi handles zero interdictions gracefully', () => {
  const result = calculateEnterpriseRoi(
    { vulnerabilities: 0, general: 0 },
    { tier: 'pro', months: 12 }
  );

  assert.equal(result.hoursSaved.totalHours, 0);
  assert.equal(result.economics.grossSavingsDollars, 0);
  assert.equal(result.economics.roiMultiplier, 0);
  assert.ok(result.economics.netSavingsDollars < 0);
});

test('calculateEnterpriseRoi validates Enterprise Gateway tier with WHOOP baseline', () => {
  const result = calculateEnterpriseRoi(
    { vulnerabilities: 4, general: 24 },
    { tier: 'enterprise', months: 12, hourlyRate: 125 }
  );

  assert.equal(result.tier, 'Enterprise Gateway');
  assert.equal(result.hoursSaved.totalHours, 492);
  assert.equal(result.economics.grossSavingsDollars, 61500);
  assert.ok(result.economics.roiMultiplier >= 2.0);
  assert.ok(result.economics.vulnsToBreakEven <= 2.5);
  assert.ok(result.pitchSummary.includes('$61,500'));
});
