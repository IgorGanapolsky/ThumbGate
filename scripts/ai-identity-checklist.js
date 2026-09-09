#!/usr/bin/env node
'use strict';

/**
 * Okta-format AI identity checklist mapped onto existing ThumbGate surfaces.
 *
 * Public source (gated whitepaper blurb + public excerpts):
 *   https://www.okta.com/resources/whitepapers/ai-identity-security-compliance-checklist/
 *
 * Steal the FORMAT (register, owner, purpose, shadow-AI = unregistered
 * observed agent, least privilege, HITL, lifecycle, audit). Do not clone
 * Okta for AI Agents, Universal Directory, CIBA/RAR, or a token vault.
 *
 * Complementary to PR #3647 `buildAgentIdentitySecurityReport` (caller
 * metadata). This doctor scans the checkout. Do not dual-edit
 * scripts/org-dashboard.js or scripts/production-agent-readiness.js.
 *
 * ECI: inventory/honesty doctor on pre-existing files, not a net-new
 * identity-control SKU and not an enterprise claim expansion.
 */

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 'thumbgate.ai-identity-checklist.v1';
const DEFAULT_ROOT = path.join(__dirname, '..');
const DEFAULT_REGISTRY = path.join(
  DEFAULT_ROOT,
  'evals',
  'ai-identity-checklist',
  'registry.json',
);

const PILLARS = Object.freeze({
  secure: 'secure_production_ready_agents',
  govern: 'govern_via_control_plane',
});

const SURFACES = Object.freeze({
  mcpAllowlists: 'config/mcp-allowlists.json',
  identityBoundary: 'src/agent-identity-boundary.js',
  gatesEngine: 'scripts/gates-engine.js',
  actionReceipts: 'scripts/action-receipts.js',
  sessionLease: 'scripts/session-lease.js',
  mcpOauth: 'scripts/mcp-oauth.js',
  ragIdentity: 'scripts/rag-embedding-identity.js',
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function surfaceExists(root, rel) {
  return fs.existsSync(path.join(root, rel));
}

function discoverObservedAdapters(root) {
  const adaptersDir = path.join(root, 'adapters');
  if (!fs.existsSync(adaptersDir) || !fs.statSync(adaptersDir).isDirectory()) {
    return [];
  }
  return fs.readdirSync(adaptersDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => `adapter:${entry.name}`)
    .sort();
}

function normalizeAgent(row, defaults = {}) {
  if (!row || typeof row !== 'object') return null;
  const id = String(row.id || '').trim();
  if (!id) return null;
  return {
    id,
    owner: String(row.owner || defaults.owner || '').trim() || null,
    purpose: String(row.purpose || '').trim() || null,
    humanPrincipalId: String(row.humanPrincipalId || defaults.humanPrincipalId || '').trim() || null,
    lifecycleStatus: String(row.lifecycleStatus || 'active').trim(),
  };
}

function loadRegistry(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { agents: [], source: filePath || null, missing: true };
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const defaults = {
    owner: raw.owner || null,
    humanPrincipalId: raw.humanPrincipalId || null,
  };
  const agents = asArray(raw.agents)
    .map((row) => normalizeAgent(row, defaults))
    .filter(Boolean);
  return {
    schemaVersion: raw.schemaVersion || null,
    note: raw.note || null,
    agents,
    source: filePath,
    missing: false,
  };
}

function item(id, pillar, title, status, detail, extra = {}) {
  return {
    id,
    pillar,
    title,
    status,
    detail,
    ...extra,
  };
}

function evaluateChecklist(input = {}) {
  const root = path.resolve(input.root || DEFAULT_ROOT);
  const claimLive = input.claimLive === true;
  const registry = input.registry
    || loadRegistry(input.registryPath || DEFAULT_REGISTRY);
  const observed = asArray(input.observedAgentIds).length
    ? asArray(input.observedAgentIds).map(String)
    : discoverObservedAdapters(root);

  const registeredIds = new Set(registry.agents.map((agent) => agent.id));
  const duplicateIds = registry.agents
    .map((agent) => agent.id)
    .filter((id, index, all) => all.indexOf(id) !== index);
  const missingOwner = registry.agents.filter((agent) => !agent.owner).map((agent) => agent.id);
  const missingPurpose = registry.agents.filter((agent) => !agent.purpose).map((agent) => agent.id);
  const missingHuman = registry.agents.filter((agent) => !agent.humanPrincipalId).map((agent) => agent.id);
  const shadowAgents = observed.filter((id) => !registeredIds.has(id));
  const orphanedRegistry = registry.agents
    .map((agent) => agent.id)
    .filter((id) => observed.length > 0 && !observed.includes(id) && String(id).startsWith('adapter:'));

  const items = [];
  const hasRegistry = !registry.missing && registry.agents.length > 0 && duplicateIds.length === 0;
  items.push(item(
    'registration',
    PILLARS.govern,
    'Register every observed agent with a unique identifier',
    hasRegistry ? 'pass' : 'fail',
    hasRegistry
      ? `Local inventory ${registry.agents.length} identities (not Okta Universal Directory)`
      : registry.missing
        ? 'Registry file missing'
        : duplicateIds.length
          ? `duplicate_ids:${duplicateIds.join(',')}`
          : 'Registry is empty',
    { surface: 'evals/ai-identity-checklist/registry.json' },
  ));

  items.push(item(
    'human_owner',
    PILLARS.govern,
    'Map every registered agent to a responsible human owner',
    missingOwner.length === 0 && hasRegistry ? 'pass' : 'fail',
    missingOwner.length ? `missing_owner:${missingOwner.join(',')}` : 'Every registered adapter names an owner',
  ));

  items.push(item(
    'documented_purpose',
    PILLARS.govern,
    'Document purpose before treating the adapter as sanctioned',
    missingPurpose.length === 0 && hasRegistry ? 'pass' : 'fail',
    missingPurpose.length ? `missing_purpose:${missingPurpose.join(',')}` : 'Every registered adapter has a purpose',
  ));

  items.push(item(
    'human_principal',
    PILLARS.secure,
    'Bind the agent to a human principal id (attribution, not impersonation)',
    missingHuman.length === 0 && hasRegistry ? 'pass' : 'fail',
    missingHuman.length ? `missing_human_principal:${missingHuman.join(',')}` : 'humanPrincipalId present on registered agents',
  ));

  const inventoryUnavailable = observed.length === 0;
  items.push(item(
    'shadow_ai',
    PILLARS.govern,
    'Observed adapters missing from the inventory are shadow AI',
    inventoryUnavailable ? 'fail' : (shadowAgents.length === 0 ? 'pass' : 'fail'),
    inventoryUnavailable
      ? 'adapter inventory unavailable (0 observed directories)'
      : shadowAgents.length
        ? `unregistered:${shadowAgents.join(',')}`
        : `0 shadow adapters among ${observed.length} observed`,
    { shadowAgents, observedCount: observed.length, inventoryUnavailable },
  ));

  const leastPrivilege = surfaceExists(root, SURFACES.mcpAllowlists)
    && surfaceExists(root, SURFACES.identityBoundary);
  items.push(item(
    'least_privilege',
    PILLARS.secure,
    'Least-privilege scopes exist as MCP allowlists plus identity-boundary roles',
    leastPrivilege ? 'pass' : 'fail',
    leastPrivilege
      ? 'Mapped to config/mcp-allowlists.json and src/agent-identity-boundary.js'
      : 'Missing MCP allowlists or identity boundary',
    { surface: `${SURFACES.mcpAllowlists}, ${SURFACES.identityBoundary}` },
  ));

  const hitl = surfaceExists(root, SURFACES.gatesEngine);
  items.push(item(
    'hitl_sensitive_actions',
    PILLARS.secure,
    'Sensitive actions require human-gated pre-action checks',
    hitl ? 'mapped_not_ciba' : 'fail',
    hitl
      ? 'Mapped to scripts/gates-engine.js floors. Not CIBA/RAR, not a mobile backchannel.'
      : 'gates-engine.js missing',
    { surface: SURFACES.gatesEngine, notWired: ['CIBA', 'RAR'] },
  ));

  const audit = surfaceExists(root, SURFACES.actionReceipts);
  items.push(item(
    'audit_trail',
    PILLARS.secure,
    'Keep an action receipt trail for tool attempts',
    audit ? 'pass' : 'fail',
    audit ? 'Mapped to scripts/action-receipts.js' : 'action-receipts.js missing',
    { surface: SURFACES.actionReceipts },
  ));

  const lifecycle = surfaceExists(root, SURFACES.sessionLease);
  items.push(item(
    'lifecycle_session_lease',
    PILLARS.govern,
    'Single-writer session lease covers checkout lifecycle (not agent UD offboarding)',
    lifecycle ? 'mapped_not_agent_ud' : 'fail',
    lifecycle
      ? 'Mapped to scripts/session-lease.js. Not Okta lifecycle deprovision of agent identities.'
      : 'session-lease.js missing',
    { surface: SURFACES.sessionLease },
  ));

  items.push(item(
    'token_vaulting',
    PILLARS.secure,
    'Dedicated token vault for third-party OAuth / MCP tokens',
    'not_wired',
    'ThumbGate does not ship Okta token vaulting. Do not store live tokens in the repo.',
    { modeledNotMeasured: true },
  ));

  items.push(item(
    'ciba_rar',
    PILLARS.secure,
    'Async out-of-band approval via CIBA with Rich Authorization Requests',
    'not_wired',
    'CIBA/RAR are not implemented. Existing HITL is PreToolUse gates, not a mobile backchannel.',
    { modeledNotMeasured: true },
  ));

  items.push(item(
    'universal_logout',
    PILLARS.govern,
    'Universal logout that revokes agent sessions and tokens across systems',
    'not_wired',
    'Not implemented. Session lease release is checkout-local only.',
    { modeledNotMeasured: true },
  ));

  const oauthSurface = surfaceExists(root, SURFACES.mcpOauth);
  items.push(item(
    'oauth_mcp_surface',
    PILLARS.secure,
    'MCP OAuth helper exists for connector auth (not agent OIDC at org scale)',
    oauthSurface ? 'mapped_not_agent_oidc' : 'fail',
    oauthSurface
      ? 'scripts/mcp-oauth.js is a connector helper, not Okta OIDC for every agent identity'
      : 'mcp-oauth.js missing',
    { surface: SURFACES.mcpOauth },
  ));

  const liveClaimAttempted = claimLive === true;
  const liveBlockedReasons = [];
  if (liveClaimAttempted) {
    liveBlockedReasons.push('claimLive_refused_without_ciba_vault_ud');
    const liveItems = items.filter((row) => row.status === 'not_wired');
    for (const row of liveItems) liveBlockedReasons.push(`not_wired:${row.id}`);
  }

  const criticalFails = items.filter((row) => (
    ['registration', 'human_owner', 'documented_purpose', 'human_principal', 'shadow_ai'].includes(row.id)
    && row.status === 'fail'
  ));
  const mappedOk = items.filter((row) => (
    ['pass', 'mapped_not_ciba', 'mapped_not_agent_ud', 'mapped_not_agent_oidc', 'not_wired'].includes(row.status)
  ));

  let decision = 'allow';
  if (liveClaimAttempted || criticalFails.length > 0) decision = 'deny';
  else if (items.some((row) => row.status === 'fail')) decision = 'warn';

  return {
    schemaVersion: SCHEMA_VERSION,
    source: 'https://www.okta.com/resources/whitepapers/ai-identity-security-compliance-checklist/',
    affiliation: 'none',
    weAreNot: [
      'Okta for AI Agents',
      'Universal Directory',
      'CIBA',
      'RAR',
      'token vault',
      'universal logout',
    ],
    root,
    decision,
    modeledNotMeasured: true,
    livePromotionAllowed: false,
    claimLive: liveClaimAttempted,
    liveBlockedReasons,
    counts: {
      registered: registry.agents.length,
      observed: observed.length,
      shadow: shadowAgents.length,
      orphanedRegistry: orphanedRegistry.length,
      mappedOk: mappedOk.length,
      criticalFails: criticalFails.length,
    },
    shadowAgents,
    items,
    claimBoundary: liveClaimAttempted
      ? 'Refused: this doctor cannot become a live identity control plane. CIBA, token vaulting, and universal logout stay not_wired.'
      : 'Local inventory doctor. Simulated or mapped controls are not observed Okta-grade identity enforcement and not a production identity winner.',
  };
}

function formatText(report) {
  const lines = [
    `ai-identity-checklist  decision=${report.decision}  live=${report.livePromotionAllowed}`,
    `registered=${report.counts.registered} observed=${report.counts.observed} shadow=${report.counts.shadow}`,
    `affiliation=${report.affiliation}  not: ${report.weAreNot.join(', ')}`,
  ];
  for (const row of report.items) {
    lines.push(`  [${row.status}] ${row.id} — ${row.detail}`);
  }
  lines.push(report.claimBoundary);
  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const options = { json: false, root: DEFAULT_ROOT, registryPath: DEFAULT_REGISTRY, claimLive: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--claim-live') options.claimLive = true;
    else if (arg === '--root') options.root = argv[++i];
    else if (arg.startsWith('--root=')) options.root = arg.slice('--root='.length);
    else if (arg === '--registry') options.registryPath = argv[++i];
    else if (arg.startsWith('--registry=')) options.registryPath = arg.slice('--registry='.length);
  }
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = evaluateChecklist({
    root: options.root,
    registryPath: options.registryPath,
    claimLive: options.claimLive,
  });
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(formatText(report));
  return report.decision === 'deny' ? 2 : 0;
}

module.exports = {
  DEFAULT_REGISTRY,
  DEFAULT_ROOT,
  PILLARS,
  SCHEMA_VERSION,
  SURFACES,
  discoverObservedAdapters,
  evaluateChecklist,
  formatText,
  loadRegistry,
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
