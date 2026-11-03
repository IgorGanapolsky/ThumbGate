'use strict';

/**
 * An experiment is not a sale.
 *
 * Source: the ThumbGate workspace in Spotify Confidence, experiments list,
 * on 2026-11-03. The real row was a draft. The other rows and the metrics
 * were demo data. The one event had never been used. This file does not
 * launch that draft, does not upgrade their plan, and does not call them.
 */

const path = require('node:path');

const EXIT_BLOCK = 77;
const CATALOG = Object.freeze([
  ['ThumbGate Pro', 19, 'https://thumbgate.ai/go/pro-direct', 'a month'],
  ['ThumbGate Pro', 149, 'https://thumbgate.ai/go/pro-direct', 'a year'],
  ['ThumbGate Setup Sprint', 499, 'https://thumbgate.ai/diagnostic', 'once'],
]);
const WRONG_OFFERS = Object.freeze([
  'lifetime',
  'team-direct',
  'enterprise-direct',
  '149/mo',
  '499/mo',
  '9.99',
  'gumroad',
]);
const DEMO_MARKS = Object.freeze([
  'demo data',
  'tutorial-event',
  'sales amount',
  'time in checkout',
]);
const SPEND_MARKS = Object.freeze([
  'upgrade',
  'paid plan',
  'mcp.confidence',
  'buy a plan',
]);

function fields() {
  return {
    purchased: false,
    launched: false,
    outboundCashSpendUsd: 0,
    paidOrders: 0,
  };
}

function decide(input) {
  const action = String((input && input.action) || '').trim();
  const hypothesis = String((input && input.hypothesis) || '');
  const metric = String((input && input.metric) || '');
  const state = String((input && input.state) || '');
  const base = fields();
  if (action.toLowerCase() === 'sell') {
    return { decision: 'sell', rule: 'catalog', ...base };
  }
  if (!action && !hypothesis && !metric && !state) {
    return { decision: 'block', rule: 'missing-action', ...base };
  }
  const offerText = ` ${action} ${hypothesis} `.toLowerCase();
  const spendText = ` ${action} `.toLowerCase();
  const metricText = ` ${metric} ${action} `.toLowerCase();
  if (SPEND_MARKS.some((mark) => spendText.includes(mark))) {
    return { decision: 'block', rule: 'do-not-pay-them', ...base };
  }
  if (WRONG_OFFERS.some((mark) => offerText.includes(mark))) {
    return { decision: 'block', rule: 'wrong-offer', ...base };
  }
  if (DEMO_MARKS.some((mark) => metricText.includes(mark))) {
    return { decision: 'block', rule: 'demo-metric', ...base };
  }
  if (!metric.toLowerCase().includes('paid order')) {
    return { decision: 'block', rule: 'not-a-sale', ...base };
  }
  if (state.toLowerCase().includes('draft') || state.toLowerCase().includes('failing') || action.toLowerCase().includes('launch')) {
    return { decision: 'block', rule: 'not-launched', ...base };
  }
  return { decision: 'hold', rule: 'awaiting-paid-order', ...base };
}

function formatLine(result) {
  return [
    `decision=${result.decision}`,
    `rule=${result.rule}`,
    `purchased=${result.purchased}`,
    `launched=${result.launched}`,
    `outbound_cash_usd=${result.outboundCashSpendUsd}`,
    `paid_orders=${result.paidOrders}`,
  ].join(' ');
}

function catalogLines() {
  return CATALOG.map(([name, usd, url, period]) => `${name} $${usd} ${period} ${url}`);
}

function flag(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || args[index + 1] == null) return '';
  return args[index + 1];
}

function main(argv) {
  const args = argv || process.argv.slice(2);
  const command = args[0];
  if (command !== 'check' && command !== 'sell') {
    process.stderr.write('Usage: checkout-experiment.js check --action "..." --hypothesis "..." --metric "..." --state "..." | sell\n');
    process.exitCode = 2;
    return;
  }
  const result = decide({
    action: command === 'sell' ? 'sell' : flag(args, '--action'),
    hypothesis: flag(args, '--hypothesis'),
    metric: flag(args, '--metric'),
    state: flag(args, '--state'),
  });
  process.stdout.write(`${formatLine(result)}\n`);
  if (result.decision === 'sell') {
    process.stdout.write('Not purchased.\n');
    for (const line of catalogLines()) process.stdout.write(`${line}\n`);
  }
  process.exitCode = result.decision === 'block' ? EXIT_BLOCK : 0;
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  main();
}

module.exports = {
  EXIT_BLOCK,
  CATALOG,
  decide,
  catalogLines,
  main,
};
