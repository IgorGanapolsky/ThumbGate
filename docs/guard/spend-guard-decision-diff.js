#!/usr/bin/env node
'use strict';

/**
 * Sanity-gated OLD vs NEW spend-guard decision-surface census.
 *
 * Never trusts a zero-diff: aborts unless known-deny vectors still deny on
 * every surface under comparison. Report raw counts, not adjectives.
 *
 * Usage (from repo root):
 *   node docs/guard/spend-guard-decision-diff.js
 *   OUT_DIR=/tmp/spend-guard-census node docs/guard/spend-guard-decision-diff.js
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = process.env.OUT_DIR || path.join('/tmp', 'spend-guard-census');
const MAX_PAYLOADS = Number(process.env.MAX_PAYLOADS || 0) || Infinity;
const NEW_GUARD_PATH = path.join(ROOT, 'scripts', 'thumbgate-spend-guard.js');

// ─── Historical local surfaces (pattern-only; ERP runs the same on all) ─────
// Shared with scripts/thumbgate-spend-guard.js except where noted.

const DENY_REASON = 'ThumbGate HARD BLOCK: agent-initiated spend/upgrade is forbidden.';

const DIRECT_TOOL_RULES = [
  { id: 'purchase_tool', re: /(?:^|[_-])(?:domain_|email_account_)?purchase(?:[_-]|$)|buy[_-]credits?/i },
  { id: 'checkout_tool', re: /checkout.*(?:create|submit|complete)|(?:create|submit|complete).*checkout/i },
  {
    id: 'subscription_mutation_tool',
    re: /subscription.*(?:create|update|change|activate|upgrade|cancel)|(?:create|update|change|activate|upgrade|cancel).*subscription/i,
  },
  {
    id: 'payment_mutation_tool',
    re: /payment[_-]?(?:method|intent)?.*(?:create|attach|confirm|submit)|(?:create|attach|confirm|submit).*payment/i,
  },
  {
    id: 'billing_mutation_tool',
    re: /(?:billing|plan|seat|credits?).*(?:buy|purchase|upgrade|activate|change|update)|(?:buy|purchase|upgrade|activate|change|update).*(?:billing|plan|seat|credits?)/i,
  },
  { id: 'cost_confirmation_tool', re: /confirm[_-]?cost|approve[_-]?(?:spend|purchase|payment)/i },
];

const FINANCIAL_OBJECT =
  /\b(?:annual|monthly|paid)\s+(?:plan|seat|tier|subscription)|\b(?:billing|checkout|invoice|payment\s*method|subscription|credits?|credit\s*pack|paid\s*tier|pricing\s*tier|pro\s*plan|enterprise\s*plan)\b|\b(?:basic|professional|organization|business|team)\s+(?:plan|seat|tier)\b|\bapollo\s*pro\b|\bthumbgate\s*pro\b|\$\s*\d/i;

const MUTATION_ACTION =
  /\b(?:buy|purchase|upgrade|subscribe|activate|checkout|pay|charge|confirm|submit|create|attach|change|update|switch|cancel|refund|add\s+payment|enter\s+card|post|put|patch)\b/i;

// OLD: bare-word alternation (the defect that hard-denied ordinary text)
const DIRECT_CHECKOUT_PATH_OLD =
  /(?:checkout\.stripe\.com|buy\.stripe\.com|app\.apollo\.io|(?:\/|#|\b)(?:checkout|purchase|upgrade|subscribe|plans?(?:\/|#|\b)|billing(?:\/|#|\b)))/i;

// NEW/MID: path or fragment separator required + trailing word boundary
const DIRECT_CHECKOUT_PATH_NEW =
  /(?:checkout\.stripe\.com|buy\.stripe\.com|app\.apollo\.io|[\/#](?:checkout|purchase|upgrade|subscribe|plans?|billing)\b)/i;

const VENDOR_UPSELL =
  /\b(?:apollo|stripe|sendgrid|twilio|openai|anthropic|resend|mailgun|postmark|thumbgate)\b[\s\S]{0,100}\b(?:upgrade|pro\b|paid|checkout|billing|subscribe|credits?)\b|\b(?:upgrade|pro\b|paid|checkout|billing|subscribe|credits?)\b[\s\S]{0,100}\b(?:apollo|stripe|sendgrid|twilio|openai|anthropic|resend|thumbgate)\b/i;

const PROTECTED_GUARD_PATH =
  /(?:^|[\s"'])(?:~\/|\$(?:HOME|\{HOME\})["']?\/|\/Users\/[^/\s"']+\/)?\.(?:thumbgate\/(?:bin\/thumbgate-spend-guard(?:\.HARDENED)?\.js|financial\/)|claude\/settings\.json)(?:$|[\s"'])/i;

function flatten(value, depth = 0) {
  if (depth > 5 || value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) return value.map((item) => flatten(item, depth + 1)).join(' ');
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, item]) => `${key} ${flatten(item, depth + 1)}`)
      .join(' ');
  }
  return '';
}

/**
 * Local hard-deny surface only (no ERP). Mode:
 *  - 'old': bare-word path + self-deny action∧object
 *  - 'mid': path precision + self-deny action∧object
 *  - 'new': path precision + require non-overlapping action/object spans
 */
function evaluateLocal(toolName, toolInput, mode) {
  const name = String(toolName || '');
  const text = flatten(toolInput);
  const combined = `${name} ${text}`;
  const pathRe = mode === 'old' ? DIRECT_CHECKOUT_PATH_OLD : DIRECT_CHECKOUT_PATH_NEW;

  for (const rule of DIRECT_TOOL_RULES) {
    if (rule.re.test(name)) {
      return { decision: 'deny', ruleId: rule.id };
    }
  }

  const isReadOnlyTool = /^(?:read|read[_ ]?file)$/i.test(name.trim());
  if (PROTECTED_GUARD_PATH.test(text) && !isReadOnlyTool) {
    return { decision: 'deny', ruleId: 'guard_tampering' };
  }

  const isInteractiveUi = /(?:browser|chrome|computer[_-]?use|playwright)/i.test(name);
  const hasInteractiveAction =
    /\b(?:click|type|press|tap|fill|select|submit|interact|drag)\b/i.test(combined);
  if (
    isInteractiveUi
    && hasInteractiveAction
    && (FINANCIAL_OBJECT.test(combined) || pathRe.test(combined) || VENDOR_UPSELL.test(combined))
  ) {
    return { decision: 'deny', ruleId: 'interactive_spend_ui' };
  }

  if (mode === 'new') {
    const actionMatch = MUTATION_ACTION.exec(combined);
    const objectMatch = FINANCIAL_OBJECT.exec(combined);
    const spansOverlap = Boolean(actionMatch && objectMatch)
      && actionMatch.index < objectMatch.index + objectMatch[0].length
      && objectMatch.index < actionMatch.index + actionMatch[0].length;
    if (actionMatch && objectMatch && !spansOverlap) {
      return { decision: 'deny', ruleId: 'financial_action_and_object' };
    }
  } else if (MUTATION_ACTION.test(combined) && FINANCIAL_OBJECT.test(combined)) {
    return { decision: 'deny', ruleId: 'financial_action_and_object' };
  }

  if (VENDOR_UPSELL.test(combined)) {
    return { decision: 'deny', ruleId: 'vendor_upsell' };
  }

  if (pathRe.test(text) || pathRe.test(combined)) {
    return { decision: 'deny', ruleId: 'checkout_path' };
  }

  return { decision: 'allow', ruleId: null };
}

const KNOWN_DENY_VECTORS = [
  { tool: 'Bash', input: { command: 'open https://checkout.stripe.com/c/pay/cs_test_x' } },
  { tool: 'WebFetch', input: { url: 'https://buy.stripe.com/test' } },
  { tool: 'Bash', input: { command: 'curl https://app.apollo.io/#/settings/plans/upgrade' } },
  { tool: 'Bash', input: { command: 'open https://example.com/checkout' } },
  { tool: 'Bash', input: { command: 'open https://example.com/purchase' } },
  { tool: 'Bash', input: { command: 'open https://example.com/upgrade' } },
  { tool: 'Bash', input: { command: 'open https://example.com#billing' } },
  { tool: 'Bash', input: { command: 'open https://example.com/subscribe' } },
];

function sanityGate() {
  const report = { ok: true, modes: {} };
  for (const mode of ['old', 'mid', 'new']) {
    const results = KNOWN_DENY_VECTORS.map((v) => evaluateLocal(v.tool, v.input, mode));
    const denies = results.filter((r) => r.decision === 'deny').length;
    report.modes[mode] = { denies, total: KNOWN_DENY_VECTORS.length };
    if (denies === 0) {
      report.ok = false;
      report.failReason = `sanity: mode=${mode} produced 0 known denials (broken harness signature or emptied rules)`;
    }
    if (denies < KNOWN_DENY_VECTORS.length) {
      report.ok = false;
      report.failReason = `sanity: mode=${mode} only denied ${denies}/${KNOWN_DENY_VECTORS.length} known vectors`;
    }
  }

  const bare = evaluateLocal(
    'Bash',
    { command: 'echo Never trust a dirty primary checkout for final verification' },
    'new',
  );
  const git = evaluateLocal('Bash', { command: 'git checkout -b feature/x' }, 'new');
  report.bareProseNew = bare;
  report.gitCheckoutNew = git;
  if (bare.decision !== 'allow' || git.decision !== 'allow') {
    report.ok = false;
    report.failReason = 'sanity: NEW still denies bare checkout prose or git checkout';
  }

  // Live process of the shipped guard must also deny the 8 vectors.
  if (fs.existsSync(NEW_GUARD_PATH)) {
    let liveDenies = 0;
    for (const v of KNOWN_DENY_VECTORS) {
      try {
        execFileSync(process.execPath, [NEW_GUARD_PATH], {
          input: JSON.stringify({ tool_name: v.tool, tool_input: v.input }),
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err) {
        if (err && err.status === 2) liveDenies += 1;
      }
    }
    report.liveProcessDenies = liveDenies;
    if (liveDenies !== KNOWN_DENY_VECTORS.length) {
      report.ok = false;
      report.failReason = `sanity: live guard process denied ${liveDenies}/${KNOWN_DENY_VECTORS.length}`;
    }
  }

  return report;
}

function listTextFiles() {
  const out = execFileSync('git', ['-C', ROOT, 'ls-files'], {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
  return out.split('\n').filter(Boolean).filter((f) => {
    if (f.startsWith('node_modules/') || f.startsWith('dist/')) return false;
    if (/\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|eot|zip|gz|tgz|bin|sqlite3?|wasm|map|lock)$/i.test(f)) {
      return false;
    }
    return true;
  });
}

function payloadsFromFile(rel) {
  let body;
  try {
    body = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch {
    return [];
  }
  if (!body || body.length > 2_000_000 || body.includes('\0')) return [];
  const lines = body.split(/\r?\n/);
  const payloads = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.length > 4000 || !/\S/.test(line)) continue;
    payloads.push({
      id: `${rel}:${i + 1}`,
      file: rel,
      line: i + 1,
      tool: 'Bash',
      input: { command: line },
      text: line,
    });
  }
  return payloads;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const sanity = sanityGate();
  fs.writeFileSync(path.join(OUT_DIR, 'sanity.json'), `${JSON.stringify(sanity, null, 2)}\n`);
  console.log('SANITY', JSON.stringify(sanity, null, 2));
  if (!sanity.ok) {
    console.error('SANITY GATE FAILED — refusing to report corpus diff');
    process.exit(2);
  }

  const files = listTextFiles();
  let payloads = 0;
  let oldDenies = 0;
  let midDenies = 0;
  let newDenies = 0;
  let loosened = 0;
  let tightened = 0;
  const loosenedByRule = Object.create(null);
  const byOldRule = Object.create(null);
  const byNewRule = Object.create(null);
  const spanChange = [];
  let spanSelfToken = 0;
  let spanAnomaly = 0;

  for (const rel of files) {
    for (const p of payloadsFromFile(rel)) {
      if (payloads >= MAX_PAYLOADS) break;
      payloads += 1;
      const o = evaluateLocal(p.tool, p.input, 'old');
      const m = evaluateLocal(p.tool, p.input, 'mid');
      const n = evaluateLocal(p.tool, p.input, 'new');

      if (o.decision === 'deny') {
        oldDenies += 1;
        byOldRule[o.ruleId] = (byOldRule[o.ruleId] || 0) + 1;
      }
      if (m.decision === 'deny') midDenies += 1;
      if (n.decision === 'deny') {
        newDenies += 1;
        byNewRule[n.ruleId] = (byNewRule[n.ruleId] || 0) + 1;
      }
      if (o.decision === 'allow' && n.decision === 'deny') tightened += 1;
      if (o.decision === 'deny' && n.decision === 'allow') {
        loosened += 1;
        loosenedByRule[o.ruleId] = (loosenedByRule[o.ruleId] || 0) + 1;
        if (m.decision === 'deny' && m.ruleId === 'financial_action_and_object') {
          const combined = `${p.tool} ${p.text}`;
          const a = MUTATION_ACTION.exec(combined);
          const obj = FINANCIAL_OBJECT.exec(combined);
          const same = Boolean(a && obj
            && a[0].toLowerCase() === obj[0].toLowerCase()
            && a.index === obj.index);
          if (same) spanSelfToken += 1;
          else spanAnomaly += 1;
          spanChange.push({
            id: p.id,
            action: a ? a[0] : null,
            object: obj ? obj[0] : null,
            sameTokenSelfDeny: same,
            text: p.text.slice(0, 240),
          });
        }
      }
    }
    if (payloads >= MAX_PAYLOADS) break;
  }

  const summary = {
    payloads,
    files: files.length,
    oldDenies,
    midDenies,
    newDenies,
    loosened,
    tightened,
    loosenedByRule,
    byOldRule,
    byNewRule,
    spanChange: {
      count: spanChange.length,
      selfDenySharedToken: spanSelfToken,
      anomaly: spanAnomaly,
    },
  };

  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  fs.writeFileSync(
    path.join(OUT_DIR, 'span-change-all.jsonl'),
    `${spanChange.map((c) => JSON.stringify(c)).join('\n')}${spanChange.length ? '\n' : ''}`,
  );
  // also refresh the checked-in summary snapshot
  const snapshotPath = path.join(__dirname, 'spend-guard-decision-diff-summary.json');
  fs.writeFileSync(snapshotPath, `${JSON.stringify(summary, null, 2)}\n`);

  console.log('SUMMARY');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Wrote ${OUT_DIR}`);
  if (summary.tightened !== 0) {
    console.error('UNEXPECTED: tightened > 0');
    process.exit(3);
  }
  if (summary.spanChange.anomaly !== 0) {
    console.error('UNEXPECTED: span-change anomalies > 0');
    process.exit(4);
  }
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  main();
}

module.exports = { evaluateLocal, sanityGate, DENY_REASON };
