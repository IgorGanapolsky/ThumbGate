'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { EXIT_BLOCK, MIXTURE_VARIANCE, mixturePValue, decide } = require('../scripts/peeking-safe-p-value');

const SCRIPT = path.join(__dirname, '../scripts/peeking-safe-p-value.js');

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

function independentP(nC, xC, nT, xT) {
  const delta = (xT / nT) - (xC / nC);
  const pooled = (xC + xT) / (nC + nT);
  const variance = pooled * (1 - pooled) * ((1 / nC) + (1 / nT));
  const root = Math.sqrt(variance / (variance + MIXTURE_VARIANCE));
  const exponent = (MIXTURE_VARIANCE * delta * delta) / (2 * variance * (variance + MIXTURE_VARIANCE));
  const likelihoodRatio = root * Math.exp(exponent);
  return { pValue: Math.min(1, 1 / likelihoodRatio), delta };
}

function namesHost(text, host) {
  return String(text).split(/[^A-Za-z0-9.-]+/).some((part) => {
    if (!part) return false;
    try {
      return new URL(`https://${part}`).hostname === host;
    } catch {
      return false;
    }
  });
}

test('the large lift matches the mixture p-value and is not a sale', () => {
  const expected = independentP(400, 8, 400, 28);
  const result = decide({
    action: 'check',
    controlVisitors: 400,
    controlConversions: 8,
    treatmentVisitors: 400,
    treatmentConversions: 28,
  });
  assert.ok(Math.abs(result.pValue - expected.pValue) < 1e-12);
  assert.ok(result.pValue < 0.05);
  assert.ok(result.delta > 0);
  assert.equal(result.peekingSafe, true);
  assert.equal(result.decision, 'hold');
  assert.equal(result.rule, 'significant-not-a-sale');
  assert.equal(result.purchased, false);
  assert.equal(result.paidOrders, 0);
  assert.equal(result.outboundCashSpendUsd, 0);
});

test('a small lift stays not significant', () => {
  const result = decide({
    action: 'check',
    controlVisitors: 400,
    controlConversions: 10,
    treatmentVisitors: 400,
    treatmentConversions: 12,
  });
  assert.equal(result.rule, 'not-significant');
  assert.ok(result.pValue > 0.05);
  assert.equal(result.purchased, false);
});

test('a paid-order metric still has not been purchased', () => {
  const result = decide({
    action: 'check',
    metric: 'paid orders',
    controlVisitors: 400,
    controlConversions: 8,
    treatmentVisitors: 400,
    treatmentConversions: 28,
  });
  assert.equal(result.rule, 'awaiting-paid-order');
  assert.equal(result.purchased, false);
  assert.equal(result.paidOrders, 0);
});

test('a broken design rolls back', () => {
  const result = decide({
    action: 'check',
    hypothesis: 'Let us try a new button color',
    metrics: ['clicks', 'scrolls'],
    postHoc: true,
    guardrailObserved: 0.09,
    guardrailMax: 0.02,
  });
  assert.equal(result.decision, 'block');
  assert.equal(result.rule, 'guardrail-breach');
  assert.ok(result.blockers.includes('spotify_confidence_missing_structured_if_then_because_hypothesis'));
  assert.ok(result.blockers.includes('spotify_confidence_post_hoc_metric_selection_forbidden'));
  assert.ok(result.blockers.includes('spotify_confidence_requires_exactly_one_primary_success_metric'));
  assert.ok(result.blockers.includes('spotify_confidence_guardrail_metric_breached_auto_rollback_triggered'));
  assert.equal(result.purchased, false);
});

test('commands print the mixture result and sell our prices', () => {
  const check = run([
    'check',
    '--control-visitors', '400',
    '--control-conversions', '8',
    '--treatment-visitors', '400',
    '--treatment-conversions', '28',
  ]);
  assert.equal(check.status, 0);
  assert.match(check.stdout, /rule=significant-not-a-sale/);
  assert.match(check.stdout, /peeking_safe=true/);
  assert.match(check.stdout, /purchased=false/);
  const reported = Number(check.stdout.match(/p_value=([0-9.]+)/)[1]);
  assert.ok(Math.abs(reported - independentP(400, 8, 400, 28).pValue) < 1e-6);

  const broken = run([
    'check',
    '--hypothesis', 'Let us try a new button color',
    '--metrics', 'clicks,scrolls',
    '--post-hoc', 'true',
    '--guardrail-observed', '0.09',
    '--guardrail-max', '0.02',
  ]);
  assert.equal(broken.status, EXIT_BLOCK);
  assert.match(broken.stdout, /rule=guardrail-breach/);

  const sold = run(['sell']);
  assert.equal(sold.status, 0);
  assert.match(sold.stdout, /Not purchased\./);
  assert.match(sold.stdout, /ThumbGate Pro \$19 a month https:\/\/thumbgate\.ai\/go\/pro-direct/);
  assert.match(sold.stdout, /ThumbGate Pro \$149 a year https:\/\/thumbgate\.ai\/go\/pro-direct/);
  assert.match(sold.stdout, /ThumbGate Setup Sprint \$499 once https:\/\/thumbgate\.ai\/diagnostic/);
  assert.equal(namesHost(sold.stdout, 'buy.stripe.com'), false);

  assert.equal(run([]).status, 2);
  assert.equal(mixturePValue(400, 8, 400, 28).pValue < 0.05, true);
});

test('the script does not call them or hardcode a safe flag', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.equal(source.includes('fetch('), false);
  assert.equal(source.includes("require('http')"), false);
  assert.equal(source.includes('peekingSafe: true,'), false);
  assert.equal(namesHost(source, 'buy.stripe.com'), false);
  assert.equal(namesHost(source, 'confidence.spotify.com'), false);
});
