'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  EXIT_BLOCK,
  classifySpend,
} = require('../scripts/covered-compute-spend');

const SCRIPT = path.join(__dirname, '../scripts/covered-compute-spend.js');

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

test('a top-up is refused when nothing has been collected', () => {
  const result = classifySpend('autor billing topup 25', 0);
  assert.equal(result.decision, 'block');
  assert.equal(result.rule, 'uncovered');
  assert.equal(result.fields.costUsd, 25);
  assert.equal(result.fields.purchased, false);
  assert.equal(result.fields.chargeUsd, 0);
});

test('a covered quote is still not purchased', () => {
  const result = classifySpend('autor billing topup 25', 25);
  assert.equal(result.decision, 'hold');
  assert.equal(result.rule, 'not-purchased');
  assert.equal(result.fields.purchased, false);
  assert.equal(result.fields.chargeUsd, 0);
});

test('an unpriced node and their remote meter are refused', () => {
  assert.equal(classifySpend('autor node create --chip h100').decision, 'block');
  assert.equal(classifySpend('autor node create --chip h100').rule, 'unpriced');
  const remote = 'claude mcp add --transport http givemeanode https://mcp.autoresearch.sfcompute.com';
  assert.equal(classifySpend(remote).rule, 'unpriced');
  assert.equal(classifySpend(remote).fields.purchased, false);
});

test('an idle node parks with no charge', () => {
  const result = classifySpend('node tulip idle');
  assert.equal(result.decision, 'park');
  assert.equal(result.rule, 'stopped');
  assert.equal(result.fields.chargeUsd, 0);
});

test('commands exit without purchasing', () => {
  const blocked = run(['check', '--action', 'autor billing topup 25']);
  assert.equal(blocked.status, EXIT_BLOCK);
  assert.match(blocked.stdout, /purchased=false/);
  const parked = run(['check', '--action', 'autor node stop tulip']);
  assert.equal(parked.status, 0);
  assert.match(parked.stdout, /rule=stopped/);
  const sold = run(['sell']);
  assert.equal(sold.status, 0);
  assert.match(sold.stdout, /purchased=false/);
  assert.match(sold.stdout, /ThumbGate Setup Sprint \$499 once https:\/\/thumbgate\.ai\/diagnostic/);
  assert.match(sold.stdout, /ThumbGate Pro \$19 a month https:\/\/thumbgate\.ai\/go\/pro-direct/);
  assert.match(sold.stdout, /ThumbGate Pro \$149 a year https:\/\/thumbgate\.ai\/go\/pro-direct/);
  assert.equal(sold.stdout.includes('buy.stripe.com'), false);
});

test('the script does not quote their machine rates or buy credit', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.equal(source.includes('0.084'), false);
  assert.equal(source.includes('0.672'), false);
  assert.equal(source.includes('buy.stripe.com'), false);
  assert.equal(source.includes("require('http')"), false);
  assert.equal(source.includes('fetch('), false);
});
