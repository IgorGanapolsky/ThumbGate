'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  EXIT_BLOCK,
  actionHash,
  decide,
} = require('../scripts/pre-execution-authorization');

const SCRIPT = path.join(__dirname, '../scripts/pre-execution-authorization.js');
const FORCE_PUSH = 'git push --force origin feature';

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

function mentionsBuyStripeHost(text) {
  return String(text).split(/\s+/).some((token) => {
    const trimmed = token.replace(/^[^A-Za-z0-9]+/, '').replace(/[),.;]+$/g, '');
    if (!trimmed) {
      return false;
    }
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
      return new URL(candidate).hostname === 'buy.stripe.com';
    } catch {
      return false;
    }
  });
}

function receipt(action, enteredBy, authorizedBy) {
  return {
    action,
    enteredBy,
    authorizedBy,
    authorizationHash: actionHash(action),
  };
}

test('requesting their trial is blocked and nothing is purchased', () => {
  const result = decide({ action: 'request a trial of gatekeeper' });
  assert.equal(result.decision, 'block');
  assert.equal(result.rule, 'do-not-pay-them');
  assert.equal(result.purchased, false);
  assert.equal(result.outboundCashSpendUsd, 0);
  assert.equal(result.executed, false);
  assert.equal(result.modelInsideGate, false);
});

test('installing their package is blocked even with a matching hash', () => {
  const action = 'npm i @oak-sparrow/gatekeeper';
  const result = decide(receipt(action, 'Igor', 'Maria'));
  assert.equal(result.decision, 'block');
  assert.equal(result.rule, 'do-not-pay-them');
  assert.equal(result.executed, false);
});

test('an outbound payment stays blocked with a human receipt', () => {
  const action = 'wire 499 to a vendor';
  const result = decide(receipt(action, 'Igor', 'Maria'));
  assert.equal(result.decision, 'block');
  assert.equal(result.rule, 'zero-outbound');
  assert.equal(result.purchased, false);
  assert.equal(result.outboundCashSpendUsd, 0);
});

test('a force-push without a human authorizer is blocked', () => {
  const missing = decide({ action: FORCE_PUSH, enteredBy: 'Igor' });
  assert.equal(missing.decision, 'block');
  assert.equal(missing.rule, 'missing-authorizer');
  const model = decide({
    action: FORCE_PUSH,
    enteredBy: 'model',
    authorizedBy: 'assistant',
    authorizationHash: actionHash(FORCE_PUSH),
  });
  assert.equal(model.decision, 'block');
  assert.equal(model.rule, 'model-cannot-authorize');
});

test('the receipt names both people and matches this action only', () => {
  const unnamed = decide({
    action: FORCE_PUSH,
    authorizedBy: 'Maria',
    authorizationHash: actionHash(FORCE_PUSH),
  });
  assert.equal(unnamed.rule, 'missing-entered-by');
  const wrong = decide({
    action: FORCE_PUSH,
    enteredBy: 'model',
    authorizedBy: 'Maria',
    authorizationHash: actionHash('git push --force origin other'),
  });
  assert.equal(wrong.rule, 'hash-mismatch');
  assert.equal(wrong.actionHash, actionHash(FORCE_PUSH));
  const ok = decide(receipt(FORCE_PUSH, 'model', 'Maria'));
  assert.equal(ok.decision, 'authorized');
  assert.equal(ok.rule, 'human-receipt');
  assert.equal(ok.executed, false);
  assert.equal(ok.modelInsideGate, false);
  assert.equal(ok.actionHash.length, 64);
});

test('a routine read is not treated as a sensitive action', () => {
  const result = decide({ action: 'git status' });
  assert.equal(result.decision, 'allow');
  assert.equal(result.rule, 'not-sensitive');
  assert.equal(result.executed, false);
});

test('commands refuse their trial, refuse a model authorizer, and sell our checkout', () => {
  const trial = run(['check', '--action', 'request their trial']);
  assert.equal(trial.status, EXIT_BLOCK);
  assert.match(trial.stdout, /rule=do-not-pay-them/);
  assert.match(trial.stdout, /purchased=false/);
  assert.match(trial.stdout, /executed=false/);

  const reply = run(['check', '--action', 'reply all to the november newsletter']);
  assert.equal(reply.status, EXIT_BLOCK);
  assert.match(reply.stdout, /rule=missing-authorizer/);

  const hashed = actionHash(FORCE_PUSH);
  const blockedModel = run([
    'check',
    '--action', FORCE_PUSH,
    '--entered-by', 'model',
    '--authorized-by', 'gatekeeper',
    '--authorization-hash', hashed,
  ]);
  assert.equal(blockedModel.status, EXIT_BLOCK);
  assert.match(blockedModel.stdout, /rule=model-cannot-authorize/);

  const allowed = run([
    'check',
    '--action', FORCE_PUSH,
    '--entered-by', 'model',
    '--authorized-by', 'Maria',
    '--authorization-hash', hashed,
  ]);
  assert.equal(allowed.status, 0);
  assert.match(allowed.stdout, /decision=authorized/);
  assert.match(allowed.stdout, /executed=false/);
  assert.match(allowed.stdout, new RegExp(`action_hash=${hashed}`));

  const sold = run(['sell']);
  assert.equal(sold.status, 0);
  assert.match(sold.stdout, /purchased=false/);
  assert.match(sold.stdout, /Not purchased\./);
  assert.match(sold.stdout, /ThumbGate Pro \$19 a month https:\/\/thumbgate\.ai\/go\/pro-direct/);
  assert.match(sold.stdout, /ThumbGate Pro \$149 a year https:\/\/thumbgate\.ai\/go\/pro-direct/);
  assert.match(sold.stdout, /ThumbGate Setup Sprint \$499 once https:\/\/thumbgate\.ai\/diagnostic/);
  assert.equal(mentionsBuyStripeHost(sold.stdout), false);
  assert.equal(sold.stdout.includes('oakandsparrow'), false);

  const usage = run([]);
  assert.equal(usage.status, 2);
});

test('a stripe buy host matches only that hostname', () => {
  assert.equal(mentionsBuyStripeHost('pay at https://buy.stripe.com/pay'), true);
  assert.equal(mentionsBuyStripeHost('pay at buy.stripe.com'), true);
  assert.equal(mentionsBuyStripeHost('https://notbuy.stripe.com/pay'), false);
  assert.equal(mentionsBuyStripeHost('https://buy.stripe.com.evil.example/pay'), false);
  assert.equal(mentionsBuyStripeHost('https://thumbgate.ai/go/pro-direct'), false);
});

test('the script quotes none of their speed figures and does not call them', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.equal(source.includes('0.4ms'), false);
  assert.equal(source.includes('100% compute'), false);
  assert.equal(source.includes('fetch('), false);
  assert.equal(source.includes("require('http')"), false);
  assert.equal(source.includes("require('node:fs')"), false);
  assert.equal(source.includes('process.env'), false);
  assert.equal(source.includes('npm install'), false);
});
