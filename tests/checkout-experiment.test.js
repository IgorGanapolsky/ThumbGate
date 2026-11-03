'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { EXIT_BLOCK, decide } = require('../scripts/checkout-experiment');

const SCRIPT = path.join(__dirname, '../scripts/checkout-experiment.js');
const KEPT = 'Buyers who already mean to pay go to ThumbGate Pro at $19 a month or $149 a year, https://thumbgate.ai/go/pro-direct. The Setup Sprint stays $499 once, https://thumbgate.ai/diagnostic. The winner is the variant with more paid orders. A page view is not a sale. Both variants show the price.';
const OLD = 'Route buyers to /go/team-direct $149/mo, /go/lifetime-direct $149, and /go/enterprise-direct $499/mo.';

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

test('the old checkout hypothesis is a wrong offer', () => {
  const result = decide({ action: 'check', hypothesis: OLD, metric: 'paid orders', state: 'draft' });
  assert.equal(result.decision, 'block');
  assert.equal(result.rule, 'wrong-offer');
  assert.equal(result.purchased, false);
  assert.equal(result.launched, false);
  assert.equal(result.paidOrders, 0);
});

test('a demo metric and a page view are not sales', () => {
  const demo = decide({ action: 'check', hypothesis: KEPT, metric: 'Sales amount Demo data' });
  assert.equal(demo.rule, 'demo-metric');
  const view = decide({ action: 'check', hypothesis: KEPT, metric: 'page view' });
  assert.equal(view.rule, 'not-a-sale');
  assert.equal(view.purchased, false);
  assert.equal(view.outboundCashSpendUsd, 0);
});

test('a draft with a paid-order metric still has not launched', () => {
  const result = decide({
    action: 'check',
    hypothesis: KEPT,
    metric: 'paid orders',
    state: 'Draft w/ failing checks',
    paidOrders: 5,
  });
  assert.equal(result.decision, 'block');
  assert.equal(result.rule, 'not-launched');
  assert.equal(result.purchased, false);
  assert.equal(result.paidOrders, 0);
  const launch = decide({ action: 'launch', hypothesis: KEPT, metric: 'paid orders', state: 'ready' });
  assert.equal(launch.rule, 'not-launched');
  assert.equal(launch.launched, false);
});

test('upgrading their plan is refused', () => {
  const result = decide({ action: 'upgrade the confidence paid plan' });
  assert.equal(result.rule, 'do-not-pay-them');
  assert.equal(result.outboundCashSpendUsd, 0);
  assert.equal(result.purchased, false);
});

test('a finished design still waits for a paid order', () => {
  const result = decide({ action: 'check', hypothesis: KEPT, metric: 'paid orders', state: 'ready' });
  assert.equal(result.decision, 'hold');
  assert.equal(result.rule, 'awaiting-paid-order');
  assert.equal(result.purchased, false);
  assert.equal(result.launched, false);
  assert.equal(result.paidOrders, 0);
});

test('commands sell our checkout and refuse the draft', () => {
  const draft = run([
    'check',
    '--action', 'check',
    '--hypothesis', KEPT,
    '--metric', 'tutorial-event',
    '--state', 'Draft w/ failing checks',
  ]);
  assert.equal(draft.status, EXIT_BLOCK);
  assert.match(draft.stdout, /rule=demo-metric/);
  assert.match(draft.stdout, /purchased=false/);
  assert.match(draft.stdout, /paid_orders=0/);

  const sold = run(['sell']);
  assert.equal(sold.status, 0);
  assert.match(sold.stdout, /purchased=false/);
  assert.match(sold.stdout, /Not purchased\./);
  assert.match(sold.stdout, /ThumbGate Pro \$19 a month https:\/\/thumbgate\.ai\/go\/pro-direct/);
  assert.match(sold.stdout, /ThumbGate Pro \$149 a year https:\/\/thumbgate\.ai\/go\/pro-direct/);
  assert.match(sold.stdout, /ThumbGate Setup Sprint \$499 once https:\/\/thumbgate\.ai\/diagnostic/);
  assert.equal(sold.stdout.includes('lifetime'), false);
  assert.equal(sold.stdout.includes('buy.stripe.com'), false);
  assert.equal(sold.stdout.includes('mcp.confidence'), false);

  assert.equal(run([]).status, 2);
});

test('the script does not call them or list a wrong price as ours', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.equal(source.includes('fetch('), false);
  assert.equal(source.includes("require('http')"), false);
  assert.equal(source.includes('lifetime-direct'), false);
  assert.equal(source.includes('$499/mo'), false);
  assert.equal(source.includes('$149/mo'), false);
});
