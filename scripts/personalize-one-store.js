'use strict';

/**
 * One store. Their personalize step is a use case and a role, then a
 * deployment. This file does not start that trial, does not provision a
 * node, and does not call them.
 *
 * Source: the public personalize bundle and the Towards Data Science mail
 * "Build real-time analytics on AWS", both read on 2026-11-03.
 */

const path = require('node:path');

const EXIT_BLOCK = 77;
const CATALOG = Object.freeze([
  ['ThumbGate Pro', 19, 'https://thumbgate.ai/go/pro-direct', 'a month'],
  ['ThumbGate Pro', 149, 'https://thumbgate.ai/go/pro-direct', 'a year'],
  ['ThumbGate Setup Sprint', 499, 'https://thumbgate.ai/diagnostic', 'once'],
]);
const CLOUD_MARKS = Object.freeze([
  'free trial',
  'trial',
  'sign up',
  'signup',
  'velodb',
  'provision',
  'vcpu',
  'marketplace',
  'no credit card',
]);
const SECOND_STORE_MARKS = Object.freeze([
  'elasticsearch',
  'second database',
  'vector database',
  'pinecone',
]);
const SPEED_MARKS = Object.freeze([
  'sub-second',
  'subsecond',
  'low-latency',
  'low latency',
]);
const COMPANY_MARKS = Object.freeze([
  'company',
  'proof of concept',
  'rag',
]);
const PERSONAL_MARKS = Object.freeze([
  'personal',
  'learning',
  'personalize',
]);

function words(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function hasPhrase(list, phrase) {
  const want = String(phrase).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (want.length === 0) return false;
  for (let i = 0; i <= list.length - want.length; i += 1) {
    let same = true;
    for (let j = 0; j < want.length; j += 1) {
      if (list[i + j] !== want[j]) {
        same = false;
        break;
      }
    }
    if (same) return true;
  }
  return false;
}

function hasAny(list, phrases) {
  return phrases.some((phrase) => hasPhrase(list, phrase));
}

function fields(offer) {
  const url = offer === 'pro'
    ? 'https://thumbgate.ai/go/pro-direct'
    : offer === 'sprint'
      ? 'https://thumbgate.ai/diagnostic'
      : '';
  return {
    purchased: false,
    provisioned: false,
    nodes: 0,
    outboundCashSpendUsd: 0,
    offer,
    url,
  };
}

function decide(input) {
  const action = String((input && input.action) || '').trim();
  const intent = String((input && input.intent) || '').trim();
  if (action.toLowerCase() === 'sell') {
    return { decision: 'sell', rule: 'catalog', ...fields('none') };
  }
  if (!action && !intent) {
    return { decision: 'block', rule: 'missing-action', ...fields('none') };
  }
  const list = words(`${action} ${intent}`);
  if (hasAny(list, CLOUD_MARKS)) {
    return { decision: 'block', rule: 'do-not-start-their-cloud', ...fields('none') };
  }
  if (hasAny(list, SECOND_STORE_MARKS)) {
    return { decision: 'block', rule: 'one-store', ...fields('none') };
  }
  if (hasAny(list, SPEED_MARKS)) {
    return { decision: 'block', rule: 'not-our-speed', ...fields('none') };
  }
  if (hasAny(list, COMPANY_MARKS)) {
    return { decision: 'hold', rule: 'offer-sprint', ...fields('sprint') };
  }
  if (hasAny(list, PERSONAL_MARKS)) {
    return { decision: 'hold', rule: 'offer-pro', ...fields('pro') };
  }
  return { decision: 'block', rule: 'missing-action', ...fields('none') };
}

function formatLine(result) {
  const parts = [
    `decision=${result.decision}`,
    `rule=${result.rule}`,
    `offer=${result.offer}`,
    `purchased=${result.purchased}`,
    `provisioned=${result.provisioned}`,
    `nodes=${result.nodes}`,
    `outbound_cash_usd=${result.outboundCashSpendUsd}`,
  ];
  if (result.url) parts.push(`url=${result.url}`);
  return parts.join(' ');
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
    process.stderr.write('Usage: personalize-one-store.js check --action "..." --intent "..." | sell\n');
    process.exitCode = 2;
    return;
  }
  const result = decide({
    action: command === 'sell' ? 'sell' : flag(args, '--action'),
    intent: flag(args, '--intent'),
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
