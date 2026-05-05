#!/usr/bin/env node
'use strict';

/**
 * Single-Use Credential Gate
 *
 * Converts the Link CLI pattern into local ThumbGate policy: risky agent
 * actions should request narrow, one-time credentials with synchronous
 * approval instead of reusing long-lived secrets.
 */

const crypto = require('node:crypto');
const path = require('node:path');

const DEFAULT_TTL_SECONDS = 300;
const RISK_PATTERNS = [
  { tag: 'purchase', pattern: /\b(buy|buys|buying|purchase|purchases|checkout|payment|gumroad|stripe|card)\b/i },
  { tag: 'credential', pattern: /\b(token|secret|credential|api[_-]?key|oauth|login)\b/i },
  { tag: 'deploy', pattern: /\b(deploy|production|railway|release)\b/i },
  { tag: 'external-write', pattern: /\b(post|reply|send|email|upload|publish|create order)\b/i },
];

function planSingleUseCredentialRequest(action = {}, options = {}) {
  const text = buildActionText(action);
  const riskTags = RISK_PATTERNS.filter((item) => item.pattern.test(text)).map((item) => item.tag);
  const highRisk = riskTags.length > 0 || Boolean(action.requiresCredential);
  const scope = normalizeScope(action.scope || inferScope(text));
  const ttlSeconds = clamp(Number(action.ttlSeconds || options.ttlSeconds || DEFAULT_TTL_SECONDS), 30, 900);

  return {
    required: highRisk,
    riskTags,
    scope,
    ttlSeconds,
    singleUse: true,
    approvalMode: highRisk ? 'synchronous' : 'not-required',
    approvalPrompt: highRisk
      ? `Approve one-time credential for ${scope.resource} (${scope.operation})? Expires in ${ttlSeconds}s and cannot be reused.`
      : 'No credential approval required.',
    deniedReasons: buildDeniedReasons(action, scope),
  };
}

function mintCredentialGrant(request = {}, approval = {}) {
  const approved = Boolean(approval.approved);
  return {
    grantId: `cred_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    approved,
    singleUse: request.singleUse !== false,
    scope: normalizeScope(request.scope),
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + (Number(request.ttlSeconds || DEFAULT_TTL_SECONDS) * 1000)).toISOString(),
    approvedBy: approval.approvedBy || null,
    approvalEvidence: approval.evidence || null,
    usedAt: null,
  };
}

function evaluateCredentialUse(grant = {}, action = {}, now = new Date()) {
  const reasons = [];
  if (!grant.approved) reasons.push('credential_not_approved');
  if (!grant.singleUse) reasons.push('credential_not_single_use');
  if (grant.usedAt) reasons.push('credential_already_used');
  if (grant.expiresAt && new Date(grant.expiresAt).getTime() < now.getTime()) reasons.push('credential_expired');

  const actionScope = normalizeScope(action.scope || inferScope(buildActionText(action)));
  const grantScope = normalizeScope(grant.scope);
  if (!scopeAllows(grantScope, actionScope)) reasons.push('credential_scope_mismatch');

  return {
    allowed: reasons.length === 0,
    reasons,
    grantId: grant.grantId || null,
    requiredScope: actionScope,
    grantedScope: grantScope,
  };
}

function markCredentialUsed(grant = {}, now = new Date()) {
  return {
    ...grant,
    usedAt: now.toISOString(),
  };
}

function buildActionText(action = {}) {
  return [
    action.command,
    action.intent,
    action.description,
    action.url,
    ...(action.tags || []),
  ].filter(Boolean).join(' ');
}

function inferScope(text = '') {
  if (/\b(stripe|checkout|payment|card)\b/i.test(text)) return { resource: 'payments', operation: 'write' };
  if (/\b(gumroad|buy|buys|buying|purchase|purchases)\b/i.test(text)) return { resource: 'purchase', operation: 'create' };
  if (/\b(deploy|railway|production)\b/i.test(text)) return { resource: 'deployment', operation: 'write' };
  if (/\b(post|reply|email|send|publish)\b/i.test(text)) return { resource: 'external-message', operation: 'send' };
  return { resource: 'local', operation: 'read' };
}

function normalizeScope(scope = {}) {
  if (typeof scope === 'string') {
    const [resource, operation = 'use'] = scope.split(':');
    return { resource: resource || 'local', operation };
  }
  return {
    resource: String(scope.resource || 'local'),
    operation: String(scope.operation || 'read'),
  };
}

function scopeAllows(granted, required) {
  if (granted.resource === '*') return true;
  if (granted.resource !== required.resource) return false;
  return granted.operation === '*' || granted.operation === required.operation;
}

function buildDeniedReasons(action, scope) {
  const reasons = [];
  if (action.persistent === true) reasons.push('persistent_credentials_not_allowed');
  if (scope.resource === '*' || scope.operation === '*') reasons.push('credential_scope_too_broad');
  return reasons;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function formatCredentialPlan(plan = {}) {
  return [
    '# Single-Use Credential Plan',
    '',
    `Required: ${plan.required ? 'yes' : 'no'}`,
    `Approval mode: ${plan.approvalMode}`,
    `Scope: ${plan.scope?.resource}:${plan.scope?.operation}`,
    `TTL seconds: ${plan.ttlSeconds}`,
    `Denied reasons: ${(plan.deniedReasons || []).join(', ') || 'none'}`,
    '',
    plan.approvalPrompt || '',
    '',
  ].join('\n');
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = { command: argv[0] || 'plan', intent: '' };
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('--intent=')) args.intent = arg.slice('--intent='.length);
    if (arg.startsWith('--action=')) args.intent = arg.slice('--action='.length);
    if (arg.startsWith('--description=')) args.description = arg.slice('--description='.length);
    if (arg.startsWith('--scope=')) args.scope = arg.slice('--scope='.length);
  }
  return args;
}

function isCliInvocation(argv = process.argv) {
  return Boolean(argv[1] && path.resolve(argv[1]) === __filename);
}

if (isCliInvocation()) {
  const args = parseArgs();
  const plan = planSingleUseCredentialRequest(args);
  if (args.command === 'json') {
    console.log(JSON.stringify(plan, null, 2));
  } else if (args.command === 'plan') {
    console.log(formatCredentialPlan(plan));
  } else {
    console.error(`Unknown command: ${args.command}. Use: plan, json`);
    process.exit(1);
  }
}

module.exports = {
  evaluateCredentialUse,
  formatCredentialPlan,
  markCredentialUsed,
  mintCredentialGrant,
  planSingleUseCredentialRequest,
};
