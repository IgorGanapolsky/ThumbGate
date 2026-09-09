#!/usr/bin/env node
'use strict';

/**
 * AgentMinder FORMAT steal: identity is not enough. Declared intent must
 * sit inside authorized scope before a tool call reaches a backend.
 *
 * Public source (VMware Explore 2026 / Broadcom AgentMinder GA):
 *   https://www.broadcom.com/company/news/product-releases/64636
 *   https://x.com/VMware/status/2095772668393820338
 *
 * Steal the FORMAT (declare intent, match scope, intercept at runtime,
 * receipt the decision). Do not clone AgentMinder, VCF, AuthZEN, Tanzu,
 * or a certificate machine-identity gateway.
 *
 * Complementary to scripts/ai-identity-checklist.js (who) and
 * scripts/action-receipts.js (audit). Do not dual-edit those files.
 *
 * ECI: inventory/honesty doctor on pre-existing PreToolUse rails, not a
 * net-new agent-governance SKU.
 */

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 'thumbgate.intent-scope-runtime.v1';
const DEFAULT_ROOT = path.join(__dirname, '..');

const SURFACES = Object.freeze({
  gatesEngine: 'scripts/gates-engine.js',
  actionReceipts: 'scripts/action-receipts.js',
  sessionLease: 'scripts/session-lease.js',
  mcpAllowlists: 'config/mcp-allowlists.json',
  identityChecklist: 'scripts/ai-identity-checklist.js',
  guide: 'GUIDE.md',
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

function surfaceExists(root, rel) {
  return fs.existsSync(path.join(root, rel));
}

function evaluateIntentScope(input = {}) {
  const identity = String(input.identity || input.agentId || '').trim();
  const declaredIntent = normalized(input.declaredIntent || input.intent);
  const allowedIntents = asArray(input.allowedIntents || input.scope).map(normalized).filter(Boolean);
  const tool = String(input.tool || input.toolName || '').trim();
  const approvedTools = asArray(input.approvedTools).map((row) => String(row || '').trim()).filter(Boolean);
  const resource = String(input.resource || '').trim();
  const authorizedResources = asArray(input.authorizedResources).map((row) => String(row || '').trim()).filter(Boolean);
  const modelSaidSafe = input.modelSaidSafe === true;

  const issues = [];
  if (!identity) issues.push('missing_identity');
  if (!declaredIntent) issues.push('missing_declared_intent');
  if (allowedIntents.length === 0) issues.push('scope_inventory_unavailable');
  else if (declaredIntent && !allowedIntents.includes(declaredIntent)) issues.push('intent_out_of_scope');
  if (tool && approvedTools.length > 0 && !approvedTools.includes(tool)) issues.push('tool_not_approved');
  if (resource && authorizedResources.length > 0 && !authorizedResources.includes(resource)) {
    issues.push('resource_not_authorized');
  }
  if (modelSaidSafe) issues.push('model_cannot_grant_authority');

  const decision = issues.length ? 'deny' : 'allow';
  return {
    schemaVersion: SCHEMA_VERSION,
    decision,
    issues,
    identity: identity || null,
    declaredIntent: declaredIntent || null,
    tool: tool || null,
    resource: resource || null,
    redirectGateway: false,
    weAreNot: [
      'AgentMinder',
      'VMware Cloud Foundation',
      'AuthZEN',
      'Tanzu agent fabric',
      'certificate machine-identity gateway',
    ],
    claimBoundary: decision === 'deny'
      ? 'Declared intent is missing or outside authorized scope. PreToolUse deny is local ThumbGate, not AgentMinder runtime.'
      : 'Intent matched authorized scope on this local doctor. Not AgentMinder, not VCF, not a live enterprise gateway.',
  };
}

function item(id, status, detail) {
  return { id, status, detail };
}

function evaluateCheckout(input = {}) {
  const root = path.resolve(input.root || DEFAULT_ROOT);
  const claimLive = input.claimLive === true;
  const items = [];

  const identitySurface = surfaceExists(root, SURFACES.sessionLease)
    && surfaceExists(root, SURFACES.identityChecklist);
  items.push(item(
    'identity_surface',
    identitySurface ? 'pass' : 'fail',
    identitySurface
      ? 'Mapped to session-lease plus ai-identity-checklist (who). Intent is a separate check.'
      : 'Missing session-lease or identity checklist',
  ));

  const runtime = surfaceExists(root, SURFACES.gatesEngine)
    && surfaceExists(root, SURFACES.guide);
  items.push(item(
    'runtime_intercept',
    runtime ? 'pass' : 'fail',
    runtime
      ? 'Mapped to scripts/gates-engine.js + GUIDE.md PreToolUse. Not an AgentMinder sidecar gateway.'
      : 'Missing gates-engine or GUIDE PreToolUse docs',
  ));

  const audit = surfaceExists(root, SURFACES.actionReceipts);
  items.push(item(
    'audit_receipts',
    audit ? 'pass' : 'fail',
    audit
      ? 'Mapped to scripts/action-receipts.js. Not OpenTelemetry AgentMinder observability.'
      : 'action-receipts.js missing',
  ));

  const approvedTools = surfaceExists(root, SURFACES.mcpAllowlists);
  items.push(item(
    'approved_tools_allowlist',
    approvedTools ? 'pass' : 'fail',
    approvedTools
      ? 'Mapped to config/mcp-allowlists.json as the local approved-tool analog'
      : 'mcp-allowlists.json missing',
  ));

  items.push(item(
    'authzen_gateway',
    'not_wired',
    'AuthZEN / certificate machine identity / VCF fabric are not implemented.',
  ));
  items.push(item(
    'redirect_or_scope_down_gateway',
    'not_wired',
    'AgentMinder-style redirect/scope-down is not a ThumbGate SKU. Existing HITL is PreToolUse deny/allow.',
  ));

  const liveBlockedReasons = [];
  if (claimLive) {
    liveBlockedReasons.push('claimLive_refused_without_agentminder_gateway');
    for (const row of items.filter((entry) => entry.status === 'not_wired')) {
      liveBlockedReasons.push(`not_wired:${row.id}`);
    }
  }

  const fails = items.filter((row) => row.status === 'fail');
  let decision = 'allow';
  if (claimLive || fails.length > 0) decision = 'deny';

  return {
    schemaVersion: `${SCHEMA_VERSION}.checkout`,
    source: 'https://www.broadcom.com/company/news/product-releases/64636',
    affiliation: 'none',
    weAreNot: evaluateIntentScope().weAreNot,
    root,
    decision,
    livePromotionAllowed: false,
    claimLive,
    liveBlockedReasons,
    items,
    claimBoundary: claimLive
      ? 'Refused: this doctor cannot become AgentMinder, VCF Private AI Cloud, or an AuthZEN gateway.'
      : 'Local PreToolUse mapping of identity+intent+scope. Simulated controls are not Broadcom AgentMinder.',
  };
}

function formatText(report) {
  if (report.issues) {
    return `intent-scope-runtime  decision=${report.decision}  issues=${(report.issues || []).join(',')}\n${report.claimBoundary}\n`;
  }
  const lines = [
    `intent-scope-runtime  decision=${report.decision}  live=${report.livePromotionAllowed}`,
    `affiliation=${report.affiliation}  not: ${report.weAreNot.join(', ')}`,
  ];
  for (const row of report.items || []) {
    lines.push(`  [${row.status}] ${row.id} — ${row.detail}`);
  }
  lines.push(report.claimBoundary);
  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const options = {
    json: false,
    root: DEFAULT_ROOT,
    claimLive: false,
    decide: null,
    decideRequested: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--claim-live') options.claimLive = true;
    else if (arg === '--root') options.root = argv[++i];
    else if (arg.startsWith('--root=')) options.root = arg.slice('--root='.length);
    else if (arg === '--decide') {
      options.decideRequested = true;
      options.decide = argv[++i];
    } else if (arg.startsWith('--decide=')) {
      options.decideRequested = true;
      options.decide = arg.slice('--decide='.length);
    }
  }
  return options;
}

function missingDecideReport() {
  return {
    schemaVersion: SCHEMA_VERSION,
    decision: 'deny',
    issues: ['missing_decide_payload'],
    identity: null,
    declaredIntent: null,
    tool: null,
    resource: null,
    redirectGateway: false,
    weAreNot: evaluateIntentScope().weAreNot,
    claimBoundary: 'Empty --decide payload is not a checkout. Fail closed.',
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  let report;
  if (options.decideRequested) {
    if (!String(options.decide || '').trim()) {
      report = missingDecideReport();
    } else {
      const payload = JSON.parse(options.decide);
      report = evaluateIntentScope(payload);
    }
  } else {
    report = evaluateCheckout({ root: options.root, claimLive: options.claimLive });
  }
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(formatText(report));
  return report.decision === 'deny' ? 2 : 0;
}

module.exports = {
  SCHEMA_VERSION,
  SURFACES,
  evaluateCheckout,
  evaluateIntentScope,
  formatText,
  main,
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
