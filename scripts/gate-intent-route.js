'use strict';

// Route a tool call before lexical gates run.
// read  = diagnose / inspect. Transaction and filename self-protect rules do not apply.
// mutate / transact / unknown still reach every lexical rule.
// Hard floors (secrets, self-protect kill) stay outside this router.

const PAYMENT_URL = /https?:\/\/(?:checkout\.stripe\.com|buy\.stripe\.com|gumroad\.com\/l\/|paypal\.com\/cgi-bin|(?:[\w.-]+\.)?stripe\.com\/(?:c\/pay|pay))/i;

const TRANSACT_COMMAND = /\b(?:git\s+push\b|gh\s+pr\s+(?:merge|create)\b|gh\s+release\s+create\b|(?:npm|yarn|pnpm)\s+publish\b|railway\s+(?:up|deploy)\b|stripe\s+\w+\s+create\b|git\s+tag\b)/i;

const MUTATE_TOOLS = new Set([
  'Write',
  'Edit',
  'StrReplace',
  'MultiEdit',
  'Delete',
  'NotebookEdit',
]);

const MUTATE_COMMAND = /\b(?:git\s+(?:commit|add|checkout|switch|reset|clean|rebase|merge|stash\s+(?:push|pop|apply))\b|rm\s+|mv\s+|mkdir\s+|chmod\s+|npm\s+(?:install|uninstall|update|ci)\b|tee\s+|sed\s+-i\b)/i;

const READ_TOOLS = new Set([
  'Read',
  'Grep',
  'Glob',
  'WebFetch',
  'WebSearch',
]);

const READ_COMMAND = /^(?:git\s+(?:status|log|diff|show|blame|rev-parse|ls-files|branch|remote|stash\s+list)\b|gh\s+(?:pr\s+(?:view|list|checks|diff)|issue\s+(?:view|list)|run\s+(?:view|list))\b|npm\s+(?:view|ls|outdated|test)\b|npm\s+run\s+test\b|node\s+--test\b|curl\s+|rg\b|ls\b|cat\b|head\b|tail\b|wc\b)/i;

const READ_SKIP_GATE = /^(?:production-deploy|schema-migration|outbound-email|supply-chain|financial|spend|purchase|checkout|billing|gh-pr-merge|protected-branch-push|admin-merge|self-protect-)/;

function commandText(toolInput) {
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  return [
    input.command,
    input.cmd,
    input.url,
    input.uri,
    input.href,
  ].filter((value) => typeof value === 'string' && value).join('\n');
}

function isReadOnlyGhApi(command) {
  if (!/\bgh\s+api\b/i.test(command)) return false;
  if (/\s(?:-X|--method)\s*(?:POST|PUT|PATCH|DELETE)\b/i.test(command)) return false;
  if (/\b(?:POST|PUT|PATCH|DELETE)\s+\//i.test(command)) return false;
  return true;
}

function classifyGateIntent(toolName, toolInput = {}) {
  const name = String(toolName || '');
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  const text = commandText(input);
  const command = String(input.command || input.cmd || '').trim();

  if (input.economicAction === true) {
    return { intent: 'transact', confidence: 0.95, reasons: ['explicit economicAction'] };
  }
  if (PAYMENT_URL.test(text) || TRANSACT_COMMAND.test(text)) {
    return { intent: 'transact', confidence: 0.9, reasons: ['transact verb or payment url'] };
  }
  if (MUTATE_TOOLS.has(name) || MUTATE_COMMAND.test(command)) {
    return { intent: 'mutate', confidence: 0.85, reasons: ['write tool or mutate verb'] };
  }
  if (READ_TOOLS.has(name) || READ_COMMAND.test(command) || isReadOnlyGhApi(command)) {
    return { intent: 'read', confidence: 0.85, reasons: ['read-only diagnose'] };
  }
  return { intent: 'unknown', confidence: 0.4, reasons: ['unclassified; lexical rules still apply'] };
}

function isReadSkippedLexicalGate(gate) {
  if (!gate || typeof gate !== 'object') return false;
  if (gate.route === 'always' || gate.hardFloor === true) return false;
  if (gate.route === 'transact' || gate.intentClass === 'transact') return true;
  return READ_SKIP_GATE.test(String(gate.id || ''));
}

function lexicalGateApplies(gate, classification) {
  if (!classification || classification.intent !== 'read') return true;
  return !isReadSkippedLexicalGate(gate);
}

module.exports = {
  classifyGateIntent,
  lexicalGateApplies,
  isReadSkippedLexicalGate,
};
