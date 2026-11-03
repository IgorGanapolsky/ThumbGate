'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROTECTED_REPOS = [
  'secure-yolo',
  'eci.obsidian',
  'eci-obsidian',
  'eci.psn',
  'eci-psn',
  'stockservice',
  'psn-ops',
];

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

const ENABLEMENT_SOURCE = 'WorkOS email 2026-11-02 ~/Downloads/workos.pdf';

function defaultLogPath() {
  if (process.env.THUMBGATE_AIRLOCK_LOG) return process.env.THUMBGATE_AIRLOCK_LOG;
  return path.join(os.homedir(), '.thumbgate', 'airlock.jsonl');
}

function wordsOf(low) {
  return new Set(low.match(/[a-z0-9]+/g) || []);
}

function repoProtected(cwd) {
  const low = String(cwd || '').toLowerCase();
  return PROTECTED_REPOS.some((mark) => low.includes(mark));
}

function actionText(toolName, toolInput) {
  if (typeof toolInput === 'string') return toolInput;
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  if (typeof input.command === 'string' && input.command.trim()) return input.command;
  if (typeof input.cmd === 'string' && input.cmd.trim()) return input.cmd;
  const name = String(toolName || '').trim().toLowerCase();
  const verb = { read: 'read', grep: 'grep', edit: 'edit', write: 'edit' }[name];
  const target = [input.path, input.file_path, input.filePath].find((value) => typeof value === 'string');
  if (verb) return target ? `${verb} ${target}` : verb;
  return String(toolName || '');
}

function isOutbound(low) {
  if (LEADING_LOCAL.test(low) && !OUTBOUND_INSIDE_LOCAL.test(low)) return false;
  if (OUTBOUND.test(low)) return true;
  return MONEY_CHARGE.test(low) && MONEY_CONTEXT.test(low);
}

function classify(action, igorAsked = false, protectedHint = false) {
  const low = String(action || '').toLowerCase();
  const words = wordsOf(low);
  const asked = Boolean(igorAsked);

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

  const protectedRepo = protectedHint || PROTECTED_REPOS.some((mark) => low.includes(mark));
  const personal = low.includes('igorganapolsky') || low.includes('personal github');
  if (words.has('push') && protectedRepo && personal) {
    return { decision: 'block', rule: 'personal-github' };
  }
  if (FORCE.test(low)) {
    if (DEFAULT_BRANCH.test(low)) return { decision: 'block', rule: 'force-push-default' };
    return { decision: asked ? 'allow' : 'ask', rule: 'force-push' };
  }
  if (words.has('push') && protectedRepo) {
    return { decision: asked ? 'allow' : 'ask', rule: 'protected-push' };
  }
  if (words.has('delete') && ['remote', 'origin', 'github', 'repo'].some((mark) => words.has(mark))) {
    return { decision: asked ? 'allow' : 'ask', rule: 'remote-delete' };
  }
  if (REMOTE_DELETE.test(low)) {
    return { decision: asked ? 'allow' : 'ask', rule: 'remote-delete' };
  }
  if (isOutbound(low)) {
    return { decision: asked ? 'allow' : 'ask', rule: 'outbound' };
  }
  return { decision: 'allow', rule: 'local' };
}

function reasonFor(decision, rule) {
  if (decision === 'allow') return rule;
  const blocked = {
    secret: 'Airlock blocked this. The action would print a secret.',
    'live-payment': 'Airlock blocked this. Creating a live charge stays stopped.',
    'live-order': 'Airlock blocked this. A live order stays stopped.',
    'realestate-operator': 'Airlock blocked this. Merging or closing RealEstate stays stopped.',
    'personal-github': 'Airlock blocked this. That push would put a work repo on a personal GitHub account.',
    'force-push-default': 'Airlock blocked this. Force-push of main or master stays stopped.',
  };
  const asked = {
    'force-push': 'Airlock asked a person. Force-push waits for Igor.',
    'protected-push': 'Airlock asked a person. A push of this repo waits for Igor.',
    'remote-delete': 'Airlock asked a person. Deleting a remote waits for Igor.',
    outbound: 'Airlock asked a person. Sending or paying waits for Igor.',
  };
  if (decision === 'block') return blocked[rule] || 'Airlock blocked this.';
  return asked[rule] || 'Airlock asked a person. This action waits for Igor.';
}

function publicAction(action, rule) {
  if (rule === 'secret') return '[redacted]';
  return String(action || '').replace(/[A-Za-z0-9_-]{32,}/g, '[redacted-token]').slice(0, 180);
}

function appendDecision({ action, decision, rule, igorAsked, logPath }) {
  const file = logPath || defaultLogPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const first = !fs.existsSync(file) || fs.statSync(file).size === 0;
  const ts = new Date().toISOString();
  let payload = '';
  if (first) {
    payload += `${JSON.stringify({ ts, event: 'enabled', source: ENABLEMENT_SOURCE })}\n`;
  }
  payload += `${JSON.stringify({
    ts,
    action: publicAction(action, rule),
    decision,
    rule,
    igor_asked: Boolean(igorAsked),
  })}\n`;
  fs.appendFileSync(file, payload, { encoding: 'utf8', mode: 0o600 });
}

function decideSharedAction({ toolName, toolInput, cwd, igorAsked = false, logPath } = {}) {
  const action = actionText(toolName, toolInput);
  const result = classify(action, igorAsked, repoProtected(cwd));
  try {
    appendDecision({
      action,
      decision: result.decision,
      rule: result.rule,
      igorAsked,
      logPath,
    });
  } catch {
    // A missing or unwritable log does not change allow, ask, or block.
  }
  return {
    decision: result.decision,
    rule: result.rule,
    reason: reasonFor(result.decision, result.rule),
  };
}

function runCli(argv) {
  const actionIndex = argv.indexOf('--action');
  const action = actionIndex === -1 ? '' : argv[actionIndex + 1];
  if (!action) {
    process.stderr.write('usage: node scripts/airlock-decision.js --action "..." [--igor-asked]\n');
    return 2;
  }
  const result = decideSharedAction({
    toolName: 'Bash',
    toolInput: { command: action },
    igorAsked: argv.includes('--igor-asked'),
    logPath: process.env.THUMBGATE_AIRLOCK_LOG,
  });
  process.stdout.write(`decision=${result.decision} rule=${result.rule}\n`);
  if (result.decision === 'ask') return 75;
  if (result.decision === 'block') return 77;
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  process.exit(runCli(process.argv.slice(2)));
}

module.exports = {
  PROTECTED_REPOS,
  ENABLEMENT_SOURCE,
  defaultLogPath,
  actionText,
  classify,
  decideSharedAction,
  reasonFor,
  runCli,
};
