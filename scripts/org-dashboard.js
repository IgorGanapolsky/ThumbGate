#!/usr/bin/env node
'use strict';

/**
 * Org Dashboard — Multi-Agent Orchestration Visibility
 *
 * Aggregates gate decisions, audit trails, and session data across
 * multiple agent sessions into a single org-wide view. CIOs want to
 * see what ALL their agents are doing, not just one at a time.
 *
 * "I'm not going to have 10,000 agents running in the environment
 *  that I don't know what they're doing" — CIO.com, March 2026
 *
 * Pro feature: free tier gets single-agent dashboard only.
 */

const fs = require('fs');
const path = require('path');
const { resolveFeedbackDir } = require('./feedback-paths');
const {
  readAuditLog,
  auditStats,
  skillAdherence,
  registerAgent,
  recordAgentActivity,
  loadAgentRegistry,
  retireAgent,
  recordObservedAgent,
  loadObservedAgents,
  getRegistryPath,
  getObservedAgentsPath,
  REGISTRY_FILENAME,
  OBSERVED_FILENAME,
} = require('./audit-trail');
const { isProTier } = require('./rate-limiter');
const {
  PRO_MONTHLY_PAYMENT_LINK,
  PRO_PRICE_LABEL,
  ENTERPRISE_PRICE_LABEL,
} = require('./commercial-offer');

// ---------------------------------------------------------------------------
// Agent Registry
// ---------------------------------------------------------------------------

// Agent identity store (registry, observed-agent stream, retirement) lives
// in ./audit-trail so the public gates-engine runtime can require it while
// this Pro dashboard module stays out of the npm tarball. Re-exported below.

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function metadataFor(agent) {
  return agent && typeof agent.metadata === 'object' && agent.metadata !== null ? agent.metadata : {};
}

function isRecentTimestamp(value, now, maximumAgeDays) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) && timestamp >= now - maximumAgeDays * 24 * 60 * 60 * 1000;
}

/** Okta-style non-human identity posture over the runtime registry. This does
 * not trust an agent self-claim alone: every control is backed by explicit
 * registry metadata, and observed-but-unregistered agents are shadow agents. */
function buildAgentIdentitySecurityReport(agents = loadAgentRegistry(), observedAgents = [], opts = {}) {
  const now = opts.now ? new Date(opts.now).getTime() : Date.now();
  const reviewDays = Number(opts.identityReviewDays || 90);
  const rotationDays = Number(opts.privilegedRotationDays || 90);
  const registeredIds = new Set(agents.map((agent) => agent.id));
  const gaps = [];

  function add(agentId, control, severity = 'high') {
    gaps.push({ agentId, control, severity });
  }

  for (const agent of agents) {
    const metadata = metadataFor(agent);
    const agentId = agent.id || 'unknown-agent';
    const protocol = String(metadata.authProtocol || '').toLowerCase();
    const tokenTtlMinutes = Number(metadata.accessTokenTtlMinutes);
    const scopes = asArray(metadata.scopes || metadata.permissions);
    const sensitiveActions = asArray(metadata.sensitiveActions);
    const downstreamServices = asArray(metadata.downstreamServices);
    const revocation = metadata.revocation && typeof metadata.revocation === 'object'
      ? metadata.revocation
      : {};

    if (!metadata.owner) add(agentId, 'missing_owner', 'critical');
    if (!metadata.purpose) add(agentId, 'missing_purpose');
    if (metadata.userBound !== false && !metadata.humanPrincipalId) {
      add(agentId, 'missing_verified_human_principal', 'critical');
    }
    if (!['oauth2.1', 'oauth2', 'oidc'].includes(protocol)) add(agentId, 'missing_oidc_or_oauth');
    if (metadata.credentialsVaulted !== true) add(agentId, 'credentials_not_vaulted', 'critical');
    if (!Number.isFinite(tokenTtlMinutes) || tokenTtlMinutes <= 0 || tokenTtlMinutes > 60) {
      add(agentId, 'access_token_not_short_lived');
    }
    if (scopes.length === 0) add(agentId, 'missing_least_privilege_scopes');
    if (metadata.ragEnabled === true && metadata.retrievalAuthorization !== 'user_permissions') {
      add(agentId, 'rag_not_filtered_by_user_permissions', 'critical');
    }
    if (
      sensitiveActions.length > 0
      && !['CIBA', 'RAR'].includes(String(metadata.humanApprovalProtocol || '').toUpperCase())
    ) {
      add(agentId, 'sensitive_action_missing_ciba_or_rar', 'critical');
    }
    if (downstreamServices.length > 0 && metadata.tokenExchangePreservesUser !== true) {
      add(agentId, 'downstream_token_exchange_loses_user_identity', 'critical');
    }
    if (!metadata.lifecycleStatus) add(agentId, 'missing_lifecycle_status');
    if (!isRecentTimestamp(metadata.lastIdentityReviewAt, now, reviewDays)) {
      add(agentId, 'identity_review_overdue');
    }
    if (
      metadata.universalLogout !== true
      || revocation.propagates !== true
      || revocation.logged !== true
    ) {
      add(agentId, 'universal_logout_not_proven', 'critical');
    }
    if (metadata.privileged === true && !isRecentTimestamp(metadata.credentialRotatedAt, now, rotationDays)) {
      add(agentId, 'privileged_credential_rotation_overdue', 'critical');
    }
  }

  const shadowAgents = [...new Set(asArray(observedAgents)
    .map((entry) => typeof entry === 'string' ? entry : entry?.agentId)
    .filter((id) => id && !registeredIds.has(id)))];
  for (const agentId of shadowAgents) add(agentId, 'shadow_agent_unregistered', 'critical');
  const criticalGapCount = gaps.filter((gap) => gap.severity === 'critical').length;

  return {
    name: 'thumbgate-agent-identity-security',
    status: gaps.length === 0 ? 'ready' : criticalGapCount > 0 ? 'blocked' : 'review',
    decision: criticalGapCount > 0 ? 'deny' : gaps.length > 0 ? 'warn' : 'allow',
    registeredAgents: agents.length,
    observedAgents: asArray(observedAgents).length,
    shadowAgents,
    gapCount: gaps.length,
    criticalGapCount,
    gaps,
    controls: [
      'verified_human_oidc_or_oauth_session',
      'vaulted_short_lived_credentials',
      'user_permission_filtered_rag',
      'ciba_or_rar_sensitive_action_approval',
      'user_preserving_token_exchange',
      'unique_agent_registry_owner_and_purpose',
      'least_privilege_scopes_and_lifecycle_reviews',
      'universal_logout_and_privileged_rotation',
    ],
  };
}

function buildAgentRegistryGovernanceReport(agents = loadAgentRegistry(), opts = {}) {
  const staleAfterHours = Number(opts.staleAfterHours || 168);
  const now = opts.now ? new Date(opts.now).getTime() : Date.now();
  const staleCutoff = now - staleAfterHours * 60 * 60 * 1000;
  const unknownOwners = [];
  const missingToolInventory = [];
  const missingMcpServerInventory = [];
  const missingAccessPolicy = [];
  const staleAgents = [];
  const highCostAgents = [];
  const monthlyBudgetCents = Number(opts.monthlyBudgetCents || 50000);

  for (const agent of agents) {
    const metadata = metadataFor(agent);
    if (!metadata.owner) unknownOwners.push(agent.id);
    if (asArray(metadata.tools).length === 0) missingToolInventory.push(agent.id);
    if (asArray(metadata.mcpServers).length === 0) missingMcpServerInventory.push(agent.id);
    if (!metadata.accessPolicy && !metadata.permissions) missingAccessPolicy.push(agent.id);
    if (new Date(agent.lastSeenAt || agent.registeredAt || 0).getTime() < staleCutoff) staleAgents.push(agent.id);
    if (Number(metadata.monthlyBudgetCents || 0) > monthlyBudgetCents) highCostAgents.push(agent.id);
  }

  const totalAgents = agents.length;
  const gapCount = unknownOwners.length +
    missingToolInventory.length +
    missingMcpServerInventory.length +
    missingAccessPolicy.length +
    staleAgents.length +
    highCostAgents.length;
  const status = gapCount === 0 ? 'managed' : gapCount <= Math.max(2, totalAgents) ? 'watch' : 'fragmented';

  return {
    name: 'thumbgate-agent-registry-governance',
    status,
    totalAgents,
    staleAfterHours,
    counts: {
      unknownOwners: unknownOwners.length,
      missingToolInventory: missingToolInventory.length,
      missingMcpServerInventory: missingMcpServerInventory.length,
      missingAccessPolicy: missingAccessPolicy.length,
      staleAgents: staleAgents.length,
      highCostAgents: highCostAgents.length,
    },
    samples: {
      unknownOwners: unknownOwners.slice(0, 5),
      missingToolInventory: missingToolInventory.slice(0, 5),
      missingMcpServerInventory: missingMcpServerInventory.slice(0, 5),
      missingAccessPolicy: missingAccessPolicy.slice(0, 5),
      staleAgents: staleAgents.slice(0, 5),
      highCostAgents: highCostAgents.slice(0, 5),
    },
    recommendations: [
      'Register every agent with owner, project, runtime, tool inventory, MCP server inventory, and access policy metadata.',
      'Block unowned agents from production tools until identity, permissions, and budget are explicit.',
      'Review stale agents and high-budget agents before granting cross-agent orchestration or autonomous write access.',
    ],
    identitySecurity: buildAgentIdentitySecurityReport(
      agents,
      opts.observedAgents !== undefined
        ? asArray(opts.observedAgents)
        : loadObservedAgents().map((row) => row.id),
      opts,
    ),
  };
}

/**
 * Generate org-wide dashboard aggregating all agent sessions.
 * Pro feature — returns limited data on free tier.
 *
 * @param {object} [opts]
 * @param {number} [opts.windowHours=24] - Lookback window in hours
 * @returns {object} Org dashboard data
 */
function generateOrgDashboard(opts = {}) {
  const windowHours = opts.windowHours || 24;
  const cutoff = Date.now() - windowHours * 60 * 60 * 1000;
  const pro = typeof opts.proOverride === 'boolean'
    ? opts.proOverride
    : true; // CEO directive 2026-06-02: local dashboard for everyone (was: isProTier(opts.authContext))

  // Load all agents
  const allAgents = loadAgentRegistry();
  const activeAgents = allAgents.filter(a => new Date(a.lastSeenAt).getTime() > cutoff);

  // Aggregate audit trail
  const audit = auditStats();
  const adherence = skillAdherence();

  // Per-agent summary
  const agentSummaries = activeAgents.map(a => ({
    id: a.id,
    source: a.source,
    project: a.project,
    branch: a.branch,
    registeredAt: a.registeredAt,
    lastSeenAt: a.lastSeenAt,
    toolCalls: a.toolCalls || 0,
    gateBlocks: a.gateBlocks || 0,
    gateWarns: a.gateWarns || 0,
    owner: metadataFor(a).owner || null,
    runtime: metadataFor(a).runtime || null,
    toolCount: asArray(metadataFor(a).tools).length,
    mcpServerCount: asArray(metadataFor(a).mcpServers).length,
    adherenceRate: a.toolCalls > 0
      ? Math.round(((a.toolCalls - (a.gateBlocks || 0) - (a.gateWarns || 0)) / a.toolCalls) * 10000) / 100
      : 100,
  }));

  // Top blocked gates across all agents
  const topBlockedGates = Object.entries(audit.byGate || {})
    .map(([gateId, counts]) => ({ gateId, blocked: counts.deny || 0, warned: counts.warn || 0 }))
    .sort((a, b) => b.blocked - a.blocked)
    .slice(0, 10);

  // Risk agents — those with lowest adherence
  const riskAgents = agentSummaries
    .filter(a => a.toolCalls >= 3)
    .sort((a, b) => a.adherenceRate - b.adherenceRate)
    .slice(0, 5);

  const summary = {
    windowHours,
    totalAgents: allAgents.length,
    activeAgents: activeAgents.length,
    totalToolCalls: audit.total,
    totalBlocked: audit.deny,
    totalWarned: audit.warn,
    totalAllowed: audit.allow,
    orgAdherenceRate: adherence.overall,
    topBlockedGates,
    riskAgents: pro ? riskAgents : riskAgents.slice(0, 1),
    agents: pro ? agentSummaries : agentSummaries.slice(0, 3),
    registryGovernance: buildAgentRegistryGovernanceReport(allAgents, opts),
    proRequired: !pro,
  };

  if (!pro) {
    summary.upgradeMessage = `Pro checkout: ${PRO_PRICE_LABEL} — ${PRO_MONTHLY_PAYMENT_LINK} | Enterprise: ${ENTERPRISE_PRICE_LABEL} after workflow qualification.`;
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  registerAgent,
  recordAgentActivity,
  recordObservedAgent,
  loadObservedAgents,
  retireAgent,
  loadAgentRegistry,
  generateOrgDashboard,
  buildAgentRegistryGovernanceReport,
  buildAgentIdentitySecurityReport,
  getRegistryPath,
  getObservedAgentsPath,
  REGISTRY_FILENAME,
  OBSERVED_FILENAME,
};
