'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { EXIT_BLOCK, decide } = require('../scripts/personalize-one-store');

const SCRIPT = path.join(__dirname, '../scripts/personalize-one-store.js');

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
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

test('a free trial does not start their cloud', () => {
  const result = decide({ action: 'Start a free VeloDB trial' });
  assert.equal(result.decision, 'block');
  assert.equal(result.rule, 'do-not-start-their-cloud');
  assert.equal(result.nodes, 0);
  assert.equal(result.purchased, false);
  assert.equal(result.provisioned, false);
  assert.equal(result.outboundCashSpendUsd, 0);
  assert.equal(result.offer, 'none');
});

test('provisioning a node is the same refusal', () => {
  const result = decide({ action: 'provision 1 node 4 vCPU' });
  assert.equal(result.decision, 'block');
  assert.equal(result.rule, 'do-not-start-their-cloud');
  assert.equal(result.nodes, 0);
  assert.equal(result.provisioned, false);
  assert.equal(result.purchased, false);
  assert.equal(result.outboundCashSpendUsd, 0);
});

test('a second database stays one store', () => {
  const result = decide({ action: 'add Elasticsearch and a vector database' });
  assert.equal(result.decision, 'block');
  assert.equal(result.rule, 'one-store');
  assert.equal(result.nodes, 0);
  assert.equal(result.purchased, false);
  const pinecone = decide({ action: 'add pinecone' });
  assert.equal(pinecone.rule, 'one-store');
});

test('their speed is not our measurement', () => {
  const result = decide({ action: 'publish sub-second analytics' });
  assert.equal(result.decision, 'block');
  assert.equal(result.rule, 'not-our-speed');
  assert.equal(result.nodes, 0);
  const latency = decide({ action: 'publish low-latency queries' });
  assert.equal(latency.rule, 'not-our-speed');
});

test('a company proof of concept offers the setup sprint', () => {
  const result = decide({ action: 'personalize', intent: 'company RAG proof of concept' });
  assert.equal(result.decision, 'hold');
  assert.equal(result.rule, 'offer-sprint');
  assert.equal(result.offer, 'sprint');
  assert.equal(result.url, 'https://thumbgate.ai/diagnostic');
  assert.equal(result.nodes, 0);
  assert.equal(result.purchased, false);
  assert.equal(result.outboundCashSpendUsd, 0);
  assert.equal(namesHost(JSON.stringify(result), 'buy.stripe.com'), false);
});

test('a personal use offers pro', () => {
  const result = decide({ action: 'personalize', intent: 'personal learning' });
  assert.equal(result.decision, 'hold');
  assert.equal(result.rule, 'offer-pro');
  assert.equal(result.offer, 'pro');
  assert.equal(result.url, 'https://thumbgate.ai/go/pro-direct');
  assert.equal(result.purchased, false);
  assert.equal(result.nodes, 0);
});

test('commands refuse the trial and sell our prices', () => {
  const trial = run(['check', '--action', 'start a free velodb trial', '--intent', 'sign up']);
  assert.equal(trial.status, EXIT_BLOCK);
  assert.match(trial.stdout, /rule=do-not-start-their-cloud/);
  assert.match(trial.stdout, /nodes=0/);
  assert.match(trial.stdout, /purchased=false/);
  assert.match(trial.stdout, /provisioned=false/);
  assert.equal(namesHost(trial.stdout, 'buy.stripe.com'), false);

  const sold = run(['sell']);
  assert.equal(sold.status, 0);
  assert.match(sold.stdout, /purchased=false/);
  assert.match(sold.stdout, /Not purchased\./);
  assert.match(sold.stdout, /ThumbGate Pro \$19 a month https:\/\/thumbgate\.ai\/go\/pro-direct/);
  assert.match(sold.stdout, /ThumbGate Pro \$149 a year https:\/\/thumbgate\.ai\/go\/pro-direct/);
  assert.match(sold.stdout, /ThumbGate Setup Sprint \$499 once https:\/\/thumbgate\.ai\/diagnostic/);
  assert.equal(sold.stdout.toLowerCase().includes('velodb'), false);
  assert.equal(sold.stdout.toLowerCase().includes('free trial'), false);
  assert.equal(namesHost(sold.stdout, 'buy.stripe.com'), false);

  assert.equal(run([]).status, 2);
});

test('the script does not call them or name their billing', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.equal(source.includes('fetch('), false);
  assert.equal(source.includes("require('http')"), false);
  assert.equal(source.includes('FreePaid'), false);
  assert.equal(namesHost(source, 'buy.stripe.com'), false);
  assert.equal(namesHost(source, 'velodb.cloud'), false);
});
