#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_POLICY_PATH = path.join(PROJECT_ROOT, 'config', 'mcp-allowlists.json');
const DEFAULT_SUBAGENT_PROFILE_PATH = path.join(PROJECT_ROOT, 'config', 'subagent-profiles.json');

function getPolicyPath() {
  return process.env.THUMBGATE_MCP_POLICY_PATH || DEFAULT_POLICY_PATH;
}

function loadMcpPolicy() {
  const policyPath = getPolicyPath();
  const raw = fs.readFileSync(policyPath, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!parsed.profiles || typeof parsed.profiles !== 'object') {
    throw new Error('Invalid MCP policy: missing profiles object');
  }
  return parsed;
}

function loadSubagentProfiles() {
  const profilePath = process.env.THUMBGATE_SUBAGENT_PROFILE_PATH || DEFAULT_SUBAGENT_PROFILE_PATH;
  const raw = fs.readFileSync(profilePath, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!parsed.profiles || typeof parsed.profiles !== 'object') {
    throw new Error('Invalid subagent profile config: missing profiles object');
  }
  return parsed;
}

function getConfiguredDefaultProfile() {
  const { getSetting } = require('./settings-hierarchy');
  return String(getSetting('mcp.defaultProfile') || 'essential');
}

function getActiveMcpProfile(toolName) {
  const explicitProfile = process.env.THUMBGATE_MCP_PROFILE || null;
  const runtimeSubagentProfile = process.env.THUMBGATE_SUBAGENT_PROFILE || null;
  const autoRoute = process.env.THUMBGATE_AUTO_PROFILE_ROUTING !== 'false';

  if (!runtimeSubagentProfile) {
    // Auto-route when no explicit profile and auto-routing is enabled
    if (!explicitProfile && autoRoute && toolName) {
      const { routeProfile } = require('./profile-router');
      const routing = routeProfile({ toolName });
      return routing.profile;
    }
    return explicitProfile || getConfiguredDefaultProfile();
  }

  const config = loadSubagentProfiles();
  const subagent = config.profiles[runtimeSubagentProfile];
  if (!subagent || !subagent.mcpProfile) {
    throw new Error(`Unknown subagent profile: ${runtimeSubagentProfile}`);
  }

  if (explicitProfile && explicitProfile !== subagent.mcpProfile) {
    throw new Error(
      `MCP profile conflict: THUMBGATE_MCP_PROFILE='${explicitProfile}' does not match subagent profile '${runtimeSubagentProfile}' (${subagent.mcpProfile})`,
    );
  }

  return subagent.mcpProfile;
}

function getAllowedTools(profileName = getActiveMcpProfile()) {
  const policy = loadMcpPolicy();
  const tools = policy.profiles[profileName];
  if (!tools) {
    throw new Error(`Unknown MCP profile: ${profileName}`);
  }
  return tools;
}

function isToolAllowed(toolName, profileName = getActiveMcpProfile()) {
  const allowed = getAllowedTools(profileName);
  return allowed.includes(toolName);
}

function assertToolAllowed(toolName, profileName = getActiveMcpProfile()) {
  if (!isToolAllowed(toolName, profileName)) {
    throw new Error(`Tool '${toolName}' is not allowed in MCP profile '${profileName}'`);
  }
}

const DEFAULT_SCOPED_PACKS_PATH = path.join(PROJECT_ROOT, 'config', 'scoped-connector-packs.json');
const SCOPED_PACK_MAX_TOOLS = 5;
const SCOPED_PACK_SPEND_TOOLS = new Set([
  'create_purchase_requisition',
  'reserve_purchase_requisition',
  'settle_purchase_requisition',
]);

function scopedPacksPath() {
  return process.env.THUMBGATE_SCOPED_PACKS_PATH || DEFAULT_SCOPED_PACKS_PATH;
}

function loadScopedConnectorPacks() {
  const raw = fs.readFileSync(scopedPacksPath(), 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed.packs || typeof parsed.packs !== 'object') {
    throw new Error('Invalid scoped connector packs: missing packs object');
  }
  return parsed;
}

function activeScopedPackName() {
  const name = String(process.env.THUMBGATE_SCOPED_PACK || '').trim();
  return name || null;
}

function evaluateScopedConnectorPack(packName, toolName, packsDoc = null) {
  const doc = packsDoc || loadScopedConnectorPacks();
  const pack = doc.packs && doc.packs[packName];
  const base = {
    pack: packName,
    tool: toolName || null,
    visibleTools: [],
    packSize: 0,
    maxTools: SCOPED_PACK_MAX_TOOLS,
  };
  if (!pack || !Array.isArray(pack.tools)) {
    return { ...base, decision: 'deny', reason: 'unknown_pack' };
  }
  const maxTools = Number.isInteger(pack.maxTools) ? pack.maxTools : Number(doc.maxTools);
  const cap = Number.isInteger(maxTools) ? maxTools : SCOPED_PACK_MAX_TOOLS;
  base.packSize = pack.tools.length;
  base.maxTools = cap;
  if (cap > SCOPED_PACK_MAX_TOOLS || pack.tools.length > cap) {
    return { ...base, decision: 'deny', reason: 'pack_too_wide' };
  }
  if (Number(pack.outboundCashSpendUsd) !== 0) {
    return { ...base, decision: 'deny', reason: 'outbound_spend_not_zero' };
  }
  if (pack.tools.some((name) => SCOPED_PACK_SPEND_TOOLS.has(name))) {
    return { ...base, decision: 'deny', reason: 'spend_tool_in_pack' };
  }
  const visibleTools = pack.tools.slice();
  base.visibleTools = visibleTools;
  if (!toolName) {
    return { ...base, decision: 'allow', reason: 'pack_visible' };
  }
  if (!visibleTools.includes(toolName)) {
    return { ...base, decision: 'deny', reason: 'tool_not_in_pack' };
  }
  return { ...base, decision: 'allow', reason: 'in_pack' };
}

function applyScopedPack(toolNames, packName = activeScopedPackName(), packsDoc = null) {
  if (!packName) {
    return { applied: false, toolNames };
  }
  const decision = evaluateScopedConnectorPack(packName, null, packsDoc);
  if (decision.decision !== 'allow') {
    return { applied: true, toolNames: [], decision };
  }
  const visible = new Set(decision.visibleTools);
  return {
    applied: true,
    decision,
    toolNames: toolNames.filter((name) => visible.has(name)),
  };
}

module.exports = {
  DEFAULT_POLICY_PATH,
  DEFAULT_SCOPED_PACKS_PATH,
  SCOPED_PACK_MAX_TOOLS,
  getPolicyPath,
  loadMcpPolicy,
  loadSubagentProfiles,
  loadScopedConnectorPacks,
  getActiveMcpProfile,
  getConfiguredDefaultProfile,
  getAllowedTools,
  isToolAllowed,
  assertToolAllowed,
  activeScopedPackName,
  evaluateScopedConnectorPack,
  applyScopedPack,
  DEFAULT_SUBAGENT_PROFILE_PATH,
};

if (require.main === module) {
  const profile = getActiveMcpProfile();
  const tools = getAllowedTools(profile);
  console.log(JSON.stringify({ profile, tools }, null, 2));
}
