#!/usr/bin/env node
'use strict';

/**
 * operator-spend-gate.js — ERP-lite spend control for agents (zero-cost local gate).
 *
 * Hard-blocks operator-money actions unless the *same message* explicitly
 * authorizes an exact amount. Refund/cancel/dispute are always allowed.
 *
 * Usage:
 *   node tools/operator-spend-gate.js check --action "upgrade Apollo Basic" --message "..."
 *   node tools/operator-spend-gate.js classify --text "buy more credits"
 *   node tools/operator-spend-gate.js authorize --message "I authorize spend $10 on X"
 *   node tools/operator-spend-gate.js log --limit 20
 *   node tools/operator-spend-gate.js --json check --action "..." --message "..."
 *
 * Exit: 0 ALLOW · 1 BLOCK · 2 usage/error
 *
 * Incident: 2026-08-02 Apollo Basic annual $588 — never-spend HARD BAN.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const GATE_ID = 'hard-ban-never-spend-operator-money';
const SCHEMA = 'operator-spend-gate/v1';
const DEFAULT_LEDGER = process.env.THUMBGATE_SPEND_LEDGER
  || path.join(os.homedir(), '.thumbgate', 'spend-ledger', 'commitments.jsonl');

/** Patterns that indicate a spend / paid upgrade intent (BLOCK without auth). */
const SPEND_PATTERNS = [
  { id: 'plan_upgrade', re: /\b(upgrade\s+(the\s+)?plan|plan\s+upgrade|upgrade\s+to\s+(basic|pro|professional|team|organization|enterprise|paid))\b/i },
  { id: 'buy_credits', re: /\b(buy|purchase|add)\s+(more\s+)?credits?\b|\bcredit\s+packs?\b|\badd-on\s+credits?\b/i },
  { id: 'checkout_pay', re: /\b(checkout|pay\s+now|subscribe|subscription\s+purchase|complete\s+purchase|place\s+order)\b/i },
  { id: 'payment_method', re: /\b(add|update|enter)\s+(a\s+)?(credit\s+card|payment\s+method|billing\s+card)\b|\bupdate\s+credit\s+card\b/i },
  { id: 'apollo_paid', re: /\bapollo\b.*\b(basic|professional|organization|enterprise|upgrade|paid\s+plan|annual)\b|\b(basic|professional)\s+(seat|plan)\b.*\bapollo\b/i },
  { id: 'saas_upsell', re: /\b(thumbgate\s+pro|upgrade\s+to\s+pro|paid\s+tier|billing\s+cycle|per\s+seat\s+per\s+month)\b/i },
  { id: 'reactivate_paid', re: /\breactivate\s+(your\s+)?plan\b|\brequest\s+upgrade\b/i },
  { id: 'dollar_spend', re: /\b(spend|pay|charge|purchase|buy)\s+(\$?\d[\d,]*(?:\.\d{1,2})?)\b/i },
  { id: 'due_today', re: /\bdue\s+today\b.*\$|\b\$\d+.*\b(upgrade|subscribe|checkout)\b/i },
];

/** Always allowed — money recovery / prevent further charges. */
const SAFE_PATTERNS = [
  { id: 'refund', re: /\brefund\b/i },
  { id: 'cancel_plan', re: /\bcancel\s+(the\s+)?(plan|subscription)\b|\bpending\s+cancellation\b/i },
  { id: 'dispute', re: /\b(chargeback|dispute|bank\s+dispute)\b/i },
  { id: 'remove_card', re: /\bremove\s+(credit\s+)?card\b|\bremove\s+payment\s+method\b/i },
  { id: 'read_only_billing', re: /\b(billing\s+page|invoice\s+history|read-?only|diagnose\s+billing)\b/i },
];

/**
 * Same-message authorization phrases.
 * Examples:
 *   "I authorize spend $588 on Apollo"
 *   "authorize paying $10 for X"
 *   "you may spend up to $5 on Y"
 */
const AUTH_PATTERNS = [
  /\bi\s+(?:explicitly\s+)?authorize\s+(?:spend(?:ing)?|pay(?:ing)?|payment|purchase)\s+(?:of\s+|up\s+to\s+)?\$?\s*([\d,]+(?:\.\d{1,2})?)/i,
  /\b(?:spend|pay|purchase)\s+(?:up\s+to\s+)?\$?\s*([\d,]+(?:\.\d{1,2})?)\s+(?:is\s+)?(?:authorized|approved|ok|allowed)\b/i,
  /\byou\s+may\s+(?:spend|pay|purchase)\s+(?:up\s+to\s+)?\$?\s*([\d,]+(?:\.\d{1,2})?)/i,
  /\bapproved\s+(?:to\s+)?(?:spend|pay|charge)\s+\$?\s*([\d,]+(?:\.\d{1,2})?)/i,
];

const AMOUNT_ANYWHERE = /\$\s*([\d,]+(?:\.\d{1,2})?)/g;

function parseUsd(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function classifySpendIntent(text) {
  const t = String(text || '');
  const safeHits = SAFE_PATTERNS.filter((p) => p.re.test(t)).map((p) => p.id);
  const spendHits = SPEND_PATTERNS.filter((p) => p.re.test(t)).map((p) => p.id);
  // Safe recovery language alone → not a spend intent
  const isSafeOnly = safeHits.length > 0 && spendHits.length === 0;
  // Mixed: "cancel and also upgrade" still spend
  const isSpend = spendHits.length > 0 && !isSafeOnly;
  return {
    schema: SCHEMA,
    isSpendIntent: isSpend,
    isSafeRecovery: safeHits.length > 0 && !isSpend,
    spendHits,
    safeHits,
    risk: isSpend ? 'high' : safeHits.length ? 'recovery' : 'none',
  };
}

function parseAuthorization(message) {
  const m = String(message || '');
  const amounts = [];
  for (const re of AUTH_PATTERNS) {
    const match = m.match(re);
    if (match) {
      const usd = parseUsd(match[1]);
      if (usd != null) amounts.push(usd);
    }
  }
  // Explicit phrase without relying only on first pattern
  const authorized = amounts.length > 0 || /\bi\s+authorize\s+spend\b/i.test(m);
  // If "I authorize spend" without amount, still need amount for money
  let maxAuthorizedUsd = amounts.length ? Math.max(...amounts) : null;
  if (authorized && maxAuthorizedUsd == null) {
    // try any $ in authorize sentence
    const sentence = m.split(/[.!?\n]/).find((s) => /authorize/i.test(s)) || '';
    const dollar = [...sentence.matchAll(AMOUNT_ANYWHERE)].map((x) => parseUsd(x[1])).filter((n) => n != null);
    if (dollar.length) maxAuthorizedUsd = Math.max(...dollar);
  }
  return {
    authorized: Boolean(authorized && maxAuthorizedUsd != null && maxAuthorizedUsd > 0),
    maxAuthorizedUsd,
    phrasesMatched: amounts.length,
    raw: m.slice(0, 500),
  };
}

function extractActionAmountUsd(actionText) {
  const t = String(actionText || '');
  const found = [...t.matchAll(AMOUNT_ANYWHERE)].map((x) => parseUsd(x[1])).filter((n) => n != null);
  return found.length ? Math.max(...found) : null;
}

/**
 * Evaluate whether an agent may proceed with an action given operator message.
 * @param {{ action?: string, message?: string, text?: string, log?: boolean, ledgerPath?: string, agentId?: string }} input
 */
function evaluateSpendGate(input = {}) {
  const action = String(input.action || input.text || '');
  const message = String(input.message || input.operatorMessage || '');
  const combined = `${action}\n${message}`;
  const classification = classifySpendIntent(combined);
  const auth = parseAuthorization(message);
  const actionAmount = extractActionAmountUsd(action) ?? extractActionAmountUsd(message);

  let decision = 'ALLOW';
  let reason = 'no_spend_intent';
  const reasons = [];

  if (classification.isSafeRecovery && !classification.isSpendIntent) {
    decision = 'ALLOW';
    reason = 'safe_recovery_path';
    reasons.push('refund/cancel/dispute/remove-card allowed without spend auth');
  } else if (classification.isSpendIntent) {
    if (!auth.authorized) {
      decision = 'BLOCK';
      reason = 'spend_intent_without_same_message_authorization';
      reasons.push('spend intent detected; missing "I authorize spend $N" in same message');
      reasons.push(`spendHits=${classification.spendHits.join(',')}`);
    } else if (actionAmount != null && auth.maxAuthorizedUsd != null && actionAmount > auth.maxAuthorizedUsd + 1e-9) {
      decision = 'BLOCK';
      reason = 'amount_exceeds_authorization';
      reasons.push(`actionAmount=${actionAmount} > authorized=${auth.maxAuthorizedUsd}`);
    } else {
      decision = 'ALLOW';
      reason = 'explicit_same_message_authorization';
      reasons.push(`authorized maxUsd=${auth.maxAuthorizedUsd}`);
    }
  }

  const result = {
    schema: SCHEMA,
    gateId: GATE_ID,
    ok: decision === 'ALLOW',
    decision,
    reason,
    reasons,
    classification,
    authorization: {
      authorized: auth.authorized,
      maxAuthorizedUsd: auth.maxAuthorizedUsd,
    },
    actionAmountUsd: actionAmount,
    checkedAt: new Date().toISOString(),
  };

  if (input.log !== false) {
    try {
      appendCommitment(
        {
          decision: result.decision,
          reason: result.reason,
          action: action.slice(0, 400),
          message: message.slice(0, 400),
          spendHits: classification.spendHits,
          maxAuthorizedUsd: auth.maxAuthorizedUsd,
          actionAmountUsd: actionAmount,
          agentId: input.agentId || process.env.HERMES_AGENT_ID || 'unknown',
        },
        input.ledgerPath || DEFAULT_LEDGER,
      );
    } catch {
      /* ledger failures must not flip allow→block incorrectly; keep decision */
      result.ledgerError = true;
    }
  }

  return result;
}

function ensureLedgerDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
}

function appendCommitment(entry, ledgerPath = DEFAULT_LEDGER) {
  const file = ledgerPath || DEFAULT_LEDGER;
  ensureLedgerDir(file);
  const row = {
    schema: 'operator-spend-commitment/v1',
    id: `spd-${crypto.randomBytes(6).toString('hex')}`,
    ts: new Date().toISOString(),
    ...entry,
  };
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* ignore */
  }
  return row;
}

function readCommitments(limit = 20, ledgerPath = DEFAULT_LEDGER) {
  const file = ledgerPath || DEFAULT_LEDGER;
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const slice = lines.slice(-Math.max(1, limit));
  return slice.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { parseError: true, line: line.slice(0, 200) };
    }
  });
}

/**
 * PreToolUse helper: given a tool name + serialized input + operator message.
 */
function evaluateToolCall({ toolName, toolInput, message, log = true, agentId } = {}) {
  const blob = [
    toolName || '',
    typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput || {}),
  ].join(' ');
  return evaluateSpendGate({ action: blob, message: message || '', log, agentId });
}

function parseArgs(argv) {
  const args = {
    cmd: '',
    action: '',
    message: '',
    text: '',
    json: false,
    log: true,
    limit: 20,
    ledgerPath: DEFAULT_LEDGER,
    help: false,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--json') args.json = true;
    else if (a === '--no-log') args.log = false;
    else if (a === '--action') args.action = argv[++i] || '';
    else if (a === '--message' || a === '--operator-message') args.message = argv[++i] || '';
    else if (a === '--text') args.text = argv[++i] || '';
    else if (a === '--limit') args.limit = Number(argv[++i] || 20);
    else if (a === '--ledger') args.ledgerPath = path.resolve(argv[++i] || DEFAULT_LEDGER);
    else if (!a.startsWith('-') && !args.cmd) args.cmd = a;
    else rest.push(a);
  }
  args.rest = rest;
  return args;
}

const usage = `Usage:
  node tools/operator-spend-gate.js check --action "..." --message "..."
  node tools/operator-spend-gate.js classify --text "..."
  node tools/operator-spend-gate.js authorize --message "..."
  node tools/operator-spend-gate.js log [--limit N]
  node tools/operator-spend-gate.js tool --action '{"tool":"..."}' --message "..."

Exit 0 ALLOW · 1 BLOCK · 2 error

ERP-lite: same-message authorization with amount required for any spend intent.
Safe: refund | cancel plan | chargeback | remove card.
Ledger: ~/.thumbgate/spend-ledger/commitments.jsonl`;

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || !args.cmd) {
    console.log(usage);
    process.exit(args.help ? 0 : 2);
  }

  if (args.cmd === 'classify') {
    const c = classifySpendIntent(args.text || args.action || args.message);
    if (args.json) console.log(JSON.stringify(c, null, 2));
    else console.log(`${c.risk} spend=${c.isSpendIntent} hits=${c.spendHits.join(',') || '-'} safe=${c.safeHits.join(',') || '-'}`);
    process.exit(0);
  }

  if (args.cmd === 'authorize') {
    const a = parseAuthorization(args.message || args.text);
    if (args.json) console.log(JSON.stringify(a, null, 2));
    else console.log(`authorized=${a.authorized} maxUsd=${a.maxAuthorizedUsd}`);
    process.exit(a.authorized ? 0 : 1);
  }

  if (args.cmd === 'log') {
    const rows = readCommitments(args.limit, args.ledgerPath);
    if (args.json) console.log(JSON.stringify({ ledger: args.ledgerPath, rows }, null, 2));
    else {
      console.log(`ledger ${args.ledgerPath} (last ${rows.length})`);
      for (const r of rows) {
        console.log(`${r.ts || '?'} ${r.decision || '?'} ${r.reason || ''} ${(r.action || '').slice(0, 60)}`);
      }
    }
    process.exit(0);
  }

  if (args.cmd === 'check' || args.cmd === 'tool') {
    const result = evaluateSpendGate({
      action: args.action || args.text,
      message: args.message,
      log: args.log,
      ledgerPath: args.ledgerPath,
    });
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`${result.decision} reason=${result.reason}`);
      for (const r of result.reasons) console.log(`  - ${r}`);
    }
    process.exit(result.ok ? 0 : 1);
  }

  console.error(`Unknown command: ${args.cmd}`);
  console.error(usage);
  process.exit(2);
}

module.exports = {
  GATE_ID,
  SCHEMA,
  DEFAULT_LEDGER,
  SPEND_PATTERNS,
  SAFE_PATTERNS,
  classifySpendIntent,
  parseAuthorization,
  extractActionAmountUsd,
  evaluateSpendGate,
  evaluateToolCall,
  appendCommitment,
  readCommitments,
  parseArgs,
  main,
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  }
}
