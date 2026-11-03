'use strict';

/**
 * Before a sensitive action, require the person who entered it and a
 * human authorizer for that exact action.
 *
 * Source: Oak & Sparrow Gatekeeper, November 2026 newsletter. Their public
 * launch note names who entered the input, who authorized it, and a SHA-256
 * record, with the gate written in code. Their latency and savings figures
 * stay theirs. This file does not install their package, set their key,
 * request a trial, or send the newsletter a reply.
 */

const crypto = require('node:crypto');
const path = require('node:path');

const EXIT_BLOCK = 77;
const CATALOG = Object.freeze([
  ['ThumbGate Pro', 19, 'https://thumbgate.ai/go/pro-direct', 'a month'],
  ['ThumbGate Pro', 149, 'https://thumbgate.ai/go/pro-direct', 'a year'],
  ['ThumbGate Setup Sprint', 499, 'https://thumbgate.ai/diagnostic', 'once'],
]);
const THEIR_MARKS = Object.freeze([
  '@oak-sparrow/gatekeeper',
  'gatekeeper_key',
  'oakandsparrow',
  'request a trial',
  'request their trial',
]);
const CASH_MARKS = Object.freeze([' pay ', ' wire ', ' buy ', ' spend ', ' purchase ']);
const SENSITIVE_MARKS = Object.freeze([
  ' send ',
  ' delete ',
  ' rm ',
  ' unlink ',
  ' force-push ',
  ' force push ',
  ' push --force ',
  ' push -f ',
  ' install ',
  ' reply ',
]);
const MODEL_AUTHORIZERS = Object.freeze([
  'model',
  'the model',
  'assistant',
  'llm',
  'ai',
  'agent',
  'gatekeeper',
  'claude',
  'gpt',
  'gemini',
  'grok',
  'jev',
]);

function actionHash(action) {
  return crypto.createHash('sha256').update(String(action), 'utf8').digest('hex');
}

function pad(action) {
  return ` ${String(action || '').toLowerCase()} `;
}

function isModelAuthorizer(name) {
  return MODEL_AUTHORIZERS.includes(String(name || '').trim().toLowerCase());
}

function baseFields(action) {
  return {
    actionHash: actionHash(action),
    purchased: false,
    outboundCashSpendUsd: 0,
    executed: false,
    modelInsideGate: false,
  };
}

function decide(input) {
  const action = String((input && input.action) || '');
  const enteredBy = String((input && input.enteredBy) || '').trim();
  const authorizedBy = String((input && input.authorizedBy) || '').trim();
  const presented = String((input && input.authorizationHash) || '').trim().toLowerCase();
  const fields = baseFields(action);
  if (action.trim().toLowerCase() === 'sell') {
    return { decision: 'sell', rule: 'catalog', ...fields };
  }
  if (!action.trim()) {
    return { decision: 'block', rule: 'missing-action', ...fields };
  }
  const lowered = pad(action);
  if (THEIR_MARKS.some((mark) => lowered.includes(mark))) {
    return { decision: 'block', rule: 'do-not-pay-them', ...fields };
  }
  if (CASH_MARKS.some((mark) => lowered.includes(mark))) {
    return { decision: 'block', rule: 'zero-outbound', ...fields };
  }
  if (!SENSITIVE_MARKS.some((mark) => lowered.includes(mark))) {
    return { decision: 'allow', rule: 'not-sensitive', ...fields };
  }
  if (!authorizedBy || authorizedBy.length < 2) {
    return { decision: 'block', rule: 'missing-authorizer', ...fields };
  }
  if (isModelAuthorizer(authorizedBy)) {
    return { decision: 'block', rule: 'model-cannot-authorize', ...fields };
  }
  if (!enteredBy) return { decision: 'block', rule: 'missing-entered-by', ...fields };
  if (!/^[0-9a-f]{64}$/.test(presented)) {
    return { decision: 'block', rule: 'missing-hash', ...fields };
  }
  if (presented !== fields.actionHash) {
    return { decision: 'block', rule: 'hash-mismatch', ...fields };
  }
  return { decision: 'authorized', rule: 'human-receipt', ...fields };
}

function formatLine(result) {
  return [
    `decision=${result.decision}`,
    `rule=${result.rule}`,
    `action_hash=${result.actionHash}`,
    `purchased=${result.purchased}`,
    `outbound_cash_usd=${result.outboundCashSpendUsd}`,
    `executed=${result.executed}`,
    `model_inside_gate=${result.modelInsideGate}`,
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
  if (command !== 'check' && command !== 'sell' && command !== 'hash') {
    process.stderr.write('Usage: pre-execution-authorization.js check --action "..." --entered-by NAME --authorized-by NAME --authorization-hash HEX | sell | hash --action "..."\n');
    process.exitCode = 2;
    return;
  }
  if (command === 'hash') {
    process.stdout.write(`${actionHash(flag(args, '--action'))}\n`);
    process.exitCode = 0;
    return;
  }
  const action = command === 'sell' ? 'sell' : flag(args, '--action');
  const result = decide({
    action,
    enteredBy: flag(args, '--entered-by'),
    authorizedBy: flag(args, '--authorized-by'),
    authorizationHash: flag(args, '--authorization-hash'),
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
  actionHash,
  decide,
  catalogLines,
  main,
};
