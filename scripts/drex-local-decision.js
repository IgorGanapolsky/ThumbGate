'use strict';

/**
 * Local typed decision. A state plus named questions, and a probability
 * only when the options are the local gate.
 *
 * Source: https://huggingface.co/nace-ai/drex-max-v1
 * and https://www.marktechpost.com/2026/11/01/nace-ai-open-sources-drex-max-v1-local-inference/
 * The MarkTechPost page says the article is sponsored. Their index scores
 * and hosted prices stay on those pages. This file does not download a
 * checkpoint and does not call a decision API.
 */

const fs = require('node:fs');
const path = require('node:path');

const GATES = Object.freeze(['allow', 'ask', 'block']);
const PROCEED = 'may the agent proceed';

const PROTECTED_REPOS = Object.freeze([
  'secure-yolo',
  'eci.obsidian',
  'eci-obsidian',
  'eci.psn',
  'eci-psn',
  'stockservice',
  'psn-ops',
]);

const SECRET = /\bprintenv\b|\bdump[- ]env\b|\bcat\s+\.env\b|\bcat\s+credentials\b|\bid_rsa\b/;
const SECRET_VERB = /\b(print|echo|cat|pbcopy|curl|paste)\b/;
const SECRET_NOUN = /\b(token|secret|password|apikey)\b|api[_-]key/;
const LIVE_PAYMENT = /\bstripe\b/;
const LIVE_PAYMENT_CREATE = /\b(charges|payment_intents)\b/;
const LIVE_ORDER = /\b(submit|place)\b/;
const ORDER = /\border\b/;
const FORCE = /--force\b|--force-with-lease|(?:^|\s)-f(?:\s|$)/;
const DEFAULT_BRANCH = /\b(main|master)\b/;
const REALESTATE = /real[\s-]?estate/;
const MERGE_OR_CLOSE = /\b(merge|close)\b/;
const REMOTE_DELETE = /\bgh\s+repo\s+delete\b|push\b.*--delete\b|--delete\b.*\bpush\b/;
const LEADING_LOCAL = /^(read|draft|status|diff|show|list|open|cat|grep|edit)\b/;
const OUTBOUND_INSIDE_LOCAL = /\b(send|publish|tweet|charge|pay|payment|buy|subscribe)\b/;
const OUTBOUND = /\b(send|publish|tweet|post|email|subscribe|pay|payment|buy)\b|^\s*charge\b/;
const MONEY_CHARGE = /\bcharge\b/;
const MONEY_CONTEXT = /\b(card|stripe|usd|invoice|customer)\b|\$/;

function wordsOf(text) {
  return new Set(String(text).match(/[a-z0-9]+/g) || []);
}

function isOutbound(low) {
  if (LEADING_LOCAL.test(low) && !OUTBOUND_INSIDE_LOCAL.test(low)) return false;
  if (OUTBOUND.test(low)) return true;
  return MONEY_CHARGE.test(low) && MONEY_CONTEXT.test(low);
}

function classifyAction(action, igorAsked) {
  const low = String(action || '').toLowerCase();
  const words = wordsOf(low);
  if (SECRET.test(low) || (SECRET_VERB.test(low) && SECRET_NOUN.test(low))) {
    return { decision: 'block', rule: 'secret' };
  }
  if (LIVE_PAYMENT.test(low) && LIVE_PAYMENT_CREATE.test(low) && /\bcreate\b/.test(low)) {
    return { decision: 'block', rule: 'live-payment' };
  }
  if (LIVE_ORDER.test(low) && ORDER.test(low) && !words.has('draft')) {
    return { decision: 'block', rule: 'live-order' };
  }
  if (REALESTATE.test(low) && MERGE_OR_CLOSE.test(low)) {
    return { decision: 'block', rule: 'realestate-operator' };
  }
  const protectedRepo = PROTECTED_REPOS.some((mark) => low.includes(mark));
  const personal = low.includes('igorganapolsky') || low.includes('personal github');
  if (words.has('push') && protectedRepo && personal) {
    return { decision: 'block', rule: 'personal-github' };
  }
  if (FORCE.test(low)) {
    if (DEFAULT_BRANCH.test(low)) return { decision: 'block', rule: 'force-push-default' };
    return { decision: igorAsked ? 'allow' : 'ask', rule: 'force-push' };
  }
  if (words.has('push') && protectedRepo) {
    return { decision: igorAsked ? 'allow' : 'ask', rule: 'protected-push' };
  }
  const remoteWords = new Set(['remote', 'origin', 'github', 'repo']);
  const mentionsRemote = [...words].some((word) => remoteWords.has(word));
  if ((words.has('delete') && mentionsRemote) || REMOTE_DELETE.test(low)) {
    return { decision: igorAsked ? 'allow' : 'ask', rule: 'remote-delete' };
  }
  if (isOutbound(low)) {
    return { decision: igorAsked ? 'allow' : 'ask', rule: 'outbound' };
  }
  return { decision: 'allow', rule: 'local' };
}

function actionText(state) {
  if (typeof state === 'string') return state;
  if (state && typeof state === 'object') return String(state.action || '');
  return '';
}

function igorAsked(state) {
  return Boolean(state && typeof state === 'object' && state.igor_asked);
}

function optionNames(criteria) {
  if (Array.isArray(criteria) && criteria.every((item) => typeof item === 'string')) return criteria.slice();
  if (criteria && typeof criteria === 'object') return Object.keys(criteria);
  return null;
}

function abstain(type, reason) {
  return { type, abstain: true, reason, source: 'none' };
}

function answerQuestion(state, question) {
  const qtype = question && question.type;
  if (qtype === 'choice') {
    const names = optionNames(question.criteria);
    if (!names || names.some((name) => !GATES.includes(name))) {
      return abstain('choice', 'options are not the local gate');
    }
    const gate = classifyAction(actionText(state), igorAsked(state));
    if (!names.includes(gate.decision)) {
      return abstain('choice', 'the local gate is outside these options');
    }
    const probabilities = {};
    for (const name of names) probabilities[name] = name === gate.decision ? 1 : 0;
    return {
      type: 'choice',
      choice: gate.decision,
      rule: gate.rule,
      probabilities,
      confidence: 1,
      source: 'airlock',
    };
  }
  if (qtype === 'noul') {
    const instructions = String((question && question.instructions) || '').toLowerCase();
    if (question.id !== 'proceed' && !instructions.includes(PROCEED)) {
      return abstain('noul', 'no local yes or no for this question');
    }
    const gate = classifyAction(actionText(state), igorAsked(state));
    return {
      type: 'noul',
      noul: gate.decision === 'allow' ? 1 : 0,
      rule: gate.rule,
      source: 'airlock',
    };
  }
  if (qtype === 'score') return abstain('score', 'no local score');
  return abstain(String(qtype || 'unknown'), 'unknown question type');
}

function answerRequest(payload) {
  const questions = payload && payload.questions;
  if (!questions || typeof questions !== 'object' || Array.isArray(questions)) {
    throw new Error('questions must be an object of named questions');
  }
  const state = Object.prototype.hasOwnProperty.call(payload, 'state') ? payload.state : '';
  const answers = {};
  for (const [name, spec] of Object.entries(questions)) {
    answers[name] = answerQuestion(state, spec || {});
  }
  return { model: 'local-rules', weights: 'none', answers };
}

function gateQuestion() {
  return {
    type: 'choice',
    instructions: 'Which gate applies?',
    criteria: { allow: 'do it', ask: 'wait for Igor', block: 'do not do it' },
  };
}

function checkAction(action, asked) {
  return answerRequest({
    state: { action, igor_asked: Boolean(asked) },
    questions: {
      gate: gateQuestion(),
      proceed: { type: 'noul', id: 'proceed', instructions: PROCEED },
    },
  });
}

function main(argv) {
  const args = argv || process.argv.slice(2);
  if (args[0] === 'check') {
    const actionFlag = args.indexOf('--action');
    const action = actionFlag >= 0 ? args[actionFlag + 1] : '';
    process.stdout.write(`${JSON.stringify(checkAction(action, args.includes('--igor-asked')), null, 2)}\n`);
    return;
  }
  if (args[0] === 'answer') {
    const requestFlag = args.indexOf('--request');
    const file = requestFlag >= 0 ? args[requestFlag + 1] : '';
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    process.stdout.write(`${JSON.stringify(answerRequest(payload), null, 2)}\n`);
    return;
  }
  process.stderr.write('Usage: drex-local-decision.js check --action "..." | answer --request file.json\n');
  process.exitCode = 2;
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  main();
}

module.exports = {
  classifyAction,
  answerQuestion,
  answerRequest,
  checkAction,
  main,
};
