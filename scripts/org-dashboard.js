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
const { readAuditLog, auditStats, skillAdherence } = require('./audit-trail');
const { isProTier } = require('./rate-limiter');
const {
  PRO_MONTHLY_PAYMENT_LINK,
  PRO_PRICE_LABEL,
  ENTERPRISE_PRICE_LABEL,
} = require('./commercial-offer');

// ---------------------------------------------------------------------------
// Agent Registry
// ---------------------------------------------------------------------------

const REGISTRY_FILENAME = 'agent-registry.jsonl';

function getRegistryPath() {
  return path.join(resolveFeedbackDir(), REGISTRY_FILENAME);
}

/**
 * Register an agent session. Called on MCP server startup or agent bootstrap.
 *
 * @param {object} params
 * @param {string} params.agentId - Unique agent identifier
 * @param {string} [params.source] - Where the agent was spawned from (cli, mcp, github, slack)
 * @param {string} [params.project] - Project/repo name
 * @param {string} [params.branch] - Git branch
 * @param {object} [params.metadata] - Arbitrary metadata
 * @returns {object} The registered agent record
 */
function registerAgent({ agentId, source, project, branch, metadata } = {}) {
  const id = agentId || `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const record = {
    id,
    registeredAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    source: source || 'unknown',
    project: project || path.basename(process.cwd()),
    branch: branch || null,
    toolCalls: 0,
    gateBlocks: 0,
    gateWarns: 0,
    metadata: metadata || {},
  };

  const registryPath = getRegistryPath();
  const dir = path.dirname(registryPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(registryPath, JSON.stringify(record) + '\n');
  return record;
}

/**
 * Record agent activity — called after each tool call evaluation.
 *
 * @param {string} agentId
 * @param {string} decision - 'allow' | 'deny' | 'warn'
 */
function recordAgentActivity(agentId, decision) {
  const registryPath = getRegistryPath();
  if (!fs.existsSync(registryPath)) return;

  const lines = fs.readFileSync(registryPath, 'utf-8').trim().split('\n');
  const updated = [];
  let found = false;

  for (const line of lines) {
    try {
      const record = JSON.parse(line);
      if (record.id === agentId && !found) {
        record.lastSeenAt = new Date().toISOString();
        record.toolCalls = (record.toolCalls || 0) + 1;
        if (decision === 'deny') record.gateBlocks = (record.gateBlocks || 0) + 1;
        if (decision === 'warn') record.gateWarns = (record.gateWarns || 0) + 1;
        found = true;
      }
      updated.push(JSON.stringify(record));
    } catch {
      updated.push(line);
    }
  }

  fs.writeFileSync(registryPath, updated.join('\n') + '\n');
}

/**
 * Load all registered agent sessions.
 */
function loadAgentRegistry() {
  const registryPath = getRegistryPath();
  if (!fs.existsSync(registryPath)) return [];
  const raw = fs.readFileSync(registryPath, 'utf-8').trim();
  if (!raw) return [];
  return raw.split('\n').map(line => {
    try { return JSON.parse(line); }
    catch { return null; }
  }).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Org Dashboard Aggregation
// ---------------------------------------------------------------------------

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function metadataFor(agent) {
  return agent && typeof agent.metadata === 'object' && agent.metadata !== null ? agent.metadata : {};
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
    : isProTier(opts.authContext);

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
  loadAgentRegistry,
  generateOrgDashboard,
  buildAgentRegistryGovernanceReport,
  getRegistryPath,
  REGISTRY_FILENAME,
};
