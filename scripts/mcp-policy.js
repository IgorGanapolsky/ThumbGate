#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_POLICY_PATH = path.join(PROJECT_ROOT, 'config', 'mcp-allowlists.json');
const DEFAULT_SUBAGENT_PROFILE_PATH = path.join(PROJECT_ROOT, 'config', 'subagent-profiles.json');

function getPolicyPath() {
  return process.env.RLHF_MCP_POLICY_PATH || DEFAULT_POLICY_PATH;
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
  const profilePath = process.env.RLHF_SUBAGENT_PROFILE_PATH || DEFAULT_SUBAGENT_PROFILE_PATH;
  const raw = fs.readFileSync(profilePath, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!parsed.profiles || typeof parsed.profiles !== 'object') {
    throw new Error('Invalid subagent profile config: missing profiles object');
  }
  return parsed;
}

function getActiveMcpProfile(toolName) {
  const explicitProfile = process.env.RLHF_MCP_PROFILE || null;
  const runtimeSubagentProfile = process.env.RLHF_SUBAGENT_PROFILE || null;
  const autoRoute = process.env.RLHF_AUTO_PROFILE_ROUTING !== 'false';

  if (!runtimeSubagentProfile) {
    // Auto-route when no explicit profile and auto-routing is enabled
    if (!explicitProfile && autoRoute && toolName) {
      const { routeProfile } = require('./profile-router');
      const routing = routeProfile({ toolName });
      return routing.profile;
    }
    return explicitProfile || 'default';
  }

  const config = loadSubagentProfiles();
  const subagent = config.profiles[runtimeSubagentProfile];
  if (!subagent || !subagent.mcpProfile) {
    throw new Error(`Unknown subagent profile: ${runtimeSubagentProfile}`);
  }

  if (explicitProfile && explicitProfile !== subagent.mcpProfile) {
    throw new Error(
      `MCP profile conflict: RLHF_MCP_PROFILE='${explicitProfile}' does not match subagent profile '${runtimeSubagentProfile}' (${subagent.mcpProfile})`,
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

module.exports = {
  DEFAULT_POLICY_PATH,
  getPolicyPath,
  loadMcpPolicy,
  loadSubagentProfiles,
  getActiveMcpProfile,
  getAllowedTools,
  isToolAllowed,
  assertToolAllowed,
  DEFAULT_SUBAGENT_PROFILE_PATH,
};

if (require.main === module) {
  const profile = getActiveMcpProfile();
  const tools = getAllowedTools(profile);
  console.log(JSON.stringify({ profile, tools }, null, 2));
}
