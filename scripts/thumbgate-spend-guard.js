#!/usr/bin/env node
'use strict';

/**
 * ThumbGate financial mutation guard (HARD DENY).
 *
 * Locked after CEO $588 Apollo annual charge (2026-08-02):
 * agent-initiated spend/upgrade must be mechanically refused, not soft-warned.
 * No env-var bypass. Free Apollo search/usage remains allowed.
 *
 * If this file keeps getting weakened by another agent, restore from:
 *   ~/.thumbgate/bin/thumbgate-spend-guard.HARDENED.js
 * and re-apply: chflags uchg ~/.thumbgate/bin/thumbgate-spend-guard.js
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DENY_REASON =
  'ThumbGate HARD BLOCK: agent-initiated spend/upgrade is forbidden. '
  + 'Do not buy credits, open checkout, change billing, or recommend a paid upgrade. '
  + 'A human must complete purchases outside the agent runtime. Free-tier Apollo search/usage remains allowed.';

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

// Matches plans/upgrade, /checkout, billing portals, stripe checkout hosts, etc.
const DIRECT_CHECKOUT_PATH =
  /(?:checkout\.stripe\.com|buy\.stripe\.com|app\.apollo\.io|(?:\/|#|\b)(?:checkout|purchase|upgrade|subscribe|plans?(?:\/|#|\b)|billing(?:\/|#|\b)))/i;

const VENDOR_UPSELL =
  /\b(?:apollo|stripe|sendgrid|twilio|openai|anthropic|resend|mailgun|postmark|thumbgate)\b[\s\S]{0,100}\b(?:upgrade|pro\b|paid|checkout|billing|subscribe|credits?)\b|\b(?:upgrade|pro\b|paid|checkout|billing|subscribe|credits?)\b[\s\S]{0,100}\b(?:apollo|stripe|sendgrid|twilio|openai|anthropic|resend|thumbgate)\b/i;

const PROTECTED_GUARD_PATH =
  /(?:^|[\s"'])(?:~\/|\$(?:HOME|\{HOME\})["']?\/|\/Users\/[^/\s"']+\/)?\.(?:thumbgate\/bin\/thumbgate-spend-guard(?:\.HARDENED)?\.js|claude\/settings\.json)(?:$|[\s"'])/i;

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

function evaluateSpend(toolName, toolInput) {
  const name = String(toolName || '');
  const text = flatten(toolInput);
  const combined = `${name} ${text}`;

  for (const rule of DIRECT_TOOL_RULES) {
    if (rule.re.test(name)) {
      return { decision: 'deny', ruleId: rule.id, reason: DENY_REASON };
    }
  }

  const isReadOnlyTool = /^(?:read|read[_ ]?file)$/i.test(name.trim());
  if (PROTECTED_GUARD_PATH.test(text) && !isReadOnlyTool) {
    return { decision: 'deny', ruleId: 'guard_tampering', reason: DENY_REASON };
  }

  // Interactive browser spend UIs
  const isInteractiveUi = /(?:browser|chrome|computer[_-]?use|playwright)/i.test(name);
  const hasInteractiveAction =
    /\b(?:click|type|press|tap|fill|select|submit|interact|drag)\b/i.test(combined);
  if (
    isInteractiveUi
    && hasInteractiveAction
    && (FINANCIAL_OBJECT.test(combined) || DIRECT_CHECKOUT_PATH.test(combined) || VENDOR_UPSELL.test(combined))
  ) {
    return { decision: 'deny', ruleId: 'interactive_spend_ui', reason: DENY_REASON };
  }

  if (MUTATION_ACTION.test(combined) && FINANCIAL_OBJECT.test(combined)) {
    return { decision: 'deny', ruleId: 'financial_action_and_object', reason: DENY_REASON };
  }

  if (VENDOR_UPSELL.test(combined)) {
    return { decision: 'deny', ruleId: 'vendor_upsell', reason: DENY_REASON };
  }

  // ANY tool payload with a checkout/upgrade path (WebFetch url, Bash open/curl, MCP, …)
  if (DIRECT_CHECKOUT_PATH.test(text) || DIRECT_CHECKOUT_PATH.test(combined)) {
    return { decision: 'deny', ruleId: 'checkout_path', reason: DENY_REASON };
  }

  return { decision: 'allow' };
}

function safeToolName(toolName) {
  return String(toolName || 'unknown')
    .replace(/[^a-zA-Z0-9_.:-]/g, '_')
    .slice(0, 120);
}

function writeDenyReceipt(toolName, ruleId) {
  try {
    const directory =
      process.env.THUMBGATE_SPEND_GUARD_RECEIPT_DIR ||
      path.join(process.env.HOME || os.homedir(), '.thumbgate', 'receipts', 'spend-guard');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.appendFileSync(
      path.join(directory, 'denies.jsonl'),
      `${JSON.stringify({
        at: new Date().toISOString(),
        event: 'financial_mutation_denied',
        ruleId,
        toolName: safeToolName(toolName),
      })}\n`,
      { mode: 0o600 },
    );
  } catch {
    // never fail open because of receipt I/O
  }
}

function output(verdict) {
  const payload =
    verdict.decision === 'deny'
      ? {
          decision: 'deny',
          reason: verdict.reason,
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: verdict.reason,
          },
        }
      : { decision: 'allow' };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function main() {
  let event;
  try {
    event = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch {
    output({ decision: 'allow' });
    return 0;
  }

  const toolName = event.toolName || event.tool_name || '';
  const toolInput = event.toolInput || event.tool_input || {};
  const verdict = evaluateSpend(toolName, toolInput);
  if (verdict.decision === 'deny') {
    writeDenyReceipt(toolName, verdict.ruleId);
    output(verdict);
    process.stderr.write(`${verdict.reason}\n`);
    return 2;
  }

  output(verdict);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  process.exitCode = main();
}

module.exports = {
  DENY_REASON,
  DIRECT_TOOL_RULES,
  evaluateSpend,
  flatten,
  safeToolName,
};
