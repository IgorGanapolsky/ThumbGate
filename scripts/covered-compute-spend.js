'use strict';

/**
 * Refuse a GPU or credit purchase, and park an idle meter.
 *
 * Source: https://autoresearch.sfcompute.com/
 * That page tells an agent to add credit and start a node. The rates on
 * the page are theirs. This file does not sign up, does not add their MCP
 * server, does not top up, and does not start a node.
 */

const path = require('node:path');

const EXIT_BLOCK = 77;
const CATALOG = Object.freeze([
  ['ThumbGate Pro', 19, 'https://thumbgate.ai/go/pro-direct', 'a month'],
  ['ThumbGate Pro', 149, 'https://thumbgate.ai/go/pro-direct', 'a year'],
  ['ThumbGate Setup Sprint', 499, 'https://thumbgate.ai/diagnostic', 'once'],
]);
const REMOTE_MARKS = Object.freeze([
  'mcp add',
  'givemeanode',
  'autoresearch.sfcompute.com',
  'sfcompute.com/signup',
  'autor billing',
]);
const TOPUP_MARKS = Object.freeze(['topup', 'add credit']);
const CREATE_MARKS = Object.freeze(['node create', 'job submit', 'sandbox bake', 'sandbox fork']);
const IDLE_MARKS = Object.freeze([' idle', 'park', 'node stop', 'billing off', 'thinking']);

function cents(amount) {
  return Math.round(Number(amount) * 100);
}

function costCents(action) {
  const dollar = String(action).match(/\$(\d+(?:\.\d+)?)/);
  const topup = String(action).match(/\btopup\s+(\d+(?:\.\d+)?)/);
  const match = dollar || topup;
  if (!match) return null;
  return cents(match[1]);
}

function isSpend(lowered) {
  return REMOTE_MARKS.concat(TOPUP_MARKS, CREATE_MARKS).some((mark) => lowered.includes(mark));
}

function classifySpend(action, collectedUsd) {
  const collected = cents(collectedUsd || 0);
  const fields = {
    costUsd: 0,
    collectedUsd: collected / 100,
    purchased: false,
    chargeUsd: 0,
  };
  if (collected < 0) return { decision: 'block', rule: 'bad-collected', fields };
  const lowered = ` ${String(action || '').toLowerCase()} `;
  if (isSpend(lowered)) {
    const cost = costCents(lowered);
    if (cost == null) return { decision: 'block', rule: 'unpriced', fields };
    fields.costUsd = cost / 100;
    if (collected < cost) return { decision: 'block', rule: 'uncovered', fields };
    return { decision: 'hold', rule: 'not-purchased', fields };
  }
  if (IDLE_MARKS.some((mark) => lowered.includes(mark))) {
    return { decision: 'park', rule: 'stopped', fields };
  }
  return { decision: 'sell', rule: 'catalog', fields };
}

function formatLine(result) {
  const fields = result.fields;
  return `decision=${result.decision} rule=${result.rule} cost_usd=${fields.costUsd} collected_usd=${fields.collectedUsd} purchased=${fields.purchased} charge_usd=${fields.chargeUsd}`;
}

function catalogLines() {
  return CATALOG.map(([name, usd, url, period]) => `${name} $${usd} ${period} ${url}`);
}

function main(argv) {
  const args = argv || process.argv.slice(2);
  const command = args[0];
  if (command !== 'check' && command !== 'sell') {
    process.stderr.write('Usage: covered-compute-spend.js check --action "..." | sell\n');
    process.exitCode = 2;
    return;
  }
  const actionFlag = args.indexOf('--action');
  const collectedFlag = args.indexOf('--collected');
  const action = command === 'sell' ? 'sell' : (actionFlag >= 0 ? args[actionFlag + 1] : '');
  const collected = collectedFlag >= 0 ? Number(args[collectedFlag + 1]) : 0;
  const result = classifySpend(action, collected);
  process.stdout.write(`${formatLine(result)}\n`);
  if (result.decision === 'sell') {
    process.stdout.write(`Not purchased. Collected third-party cash on this sheet: $${result.fields.collectedUsd}.\n`);
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
  classifySpend,
  catalogLines,
  main,
};
