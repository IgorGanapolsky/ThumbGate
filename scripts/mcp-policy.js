#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_POLICY_PATH = path.join(PROJECT_ROOT, 'config', 'mcp-allowlists.json');
const DEFAULT_SUBAGENT_PROFILE_PATH = path.join(PROJECT_ROOT, 'config', 'subagent-profiles.json');

function getPolicyPath() {
  return process.env.THUMBGATE_MCP_POLICY_PATH || DEFAULT_POLICY_PATH;
}

function getUserPolicyPath() {
  const feedbackDir = process.env.THUMBGATE_FEEDBACK_DIR || path.join(os.homedir(), '.thumbgate');
  return path.join(feedbackDir, 'mcp-allowlists.json');
}

function loadMcpPolicy() {
  const policyPath = getPolicyPath();
  const raw = fs.readFileSync(policyPath, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!parsed.profiles || typeof parsed.profiles !== 'object') {
    throw new Error('Invalid MCP policy: missing profiles object');
  }
  if (!process.env.THUMBGATE_MCP_POLICY_PATH) {
    const userPolicyPath = getUserPolicyPath();
    if (userPolicyPath !== policyPath && fs.existsSync(userPolicyPath)) {
      try {
        const userParsed = JSON.parse(fs.readFileSync(userPolicyPath, 'utf-8'));
        if (userParsed && userParsed.profiles && typeof userParsed.profiles === 'object') {
          for (const [profileKey, tools] of Object.entries(userParsed.profiles)) {
            if (!parsed.profiles[profileKey] && Array.isArray(tools)) {
              parsed.profiles[profileKey] = tools;
            }
          }
        }
      } catch {
        // Ignore malformed user policy fallback when default policy is valid.
      }
    }
  }
  return parsed;
}

function hydrateMcpEnvFromUserConfig(options = {}) {
  const env = options.env || process.env;
  if (env.THUMBGATE_MCP_PROFILE) {
    return { hydrated: false, profile: env.THUMBGATE_MCP_PROFILE, source: 'env' };
  }
  if (env.NODE_TEST_CONTEXT && !options.allowInTest) {
    return { hydrated: false, profile: null, source: null };
  }
  const homeDir = options.homeDir || env.HOME || env.USERPROFILE || os.homedir();
  if (!homeDir) {
    return { hydrated: false, profile: null, source: null };
  }
  const candidateFiles = [
    path.join(homeDir, '.claude.json'),
    path.join(homeDir, '.claude', 'settings.json'),
  ];
  for (const configFile of candidateFiles) {
    if (!fs.existsSync(configFile)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
      const serverEnv = parsed
        && parsed.mcpServers
        && parsed.mcpServers.thumbgate
        && parsed.mcpServers.thumbgate.env;
      if (!serverEnv || typeof serverEnv !== 'object') continue;
      const configuredProfile = String(serverEnv.THUMBGATE_MCP_PROFILE || '').trim();
      if (configuredProfile) {
        env.THUMBGATE_MCP_PROFILE = configuredProfile;
        if (!env.THUMBGATE_MCP_POLICY_PATH && serverEnv.THUMBGATE_MCP_POLICY_PATH) {
          env.THUMBGATE_MCP_POLICY_PATH = String(serverEnv.THUMBGATE_MCP_POLICY_PATH).trim();
        }
        if (!env.THUMBGATE_FEEDBACK_DIR && serverEnv.THUMBGATE_FEEDBACK_DIR) {
          env.THUMBGATE_FEEDBACK_DIR = String(serverEnv.THUMBGATE_FEEDBACK_DIR).trim();
        }
        return { hydrated: true, profile: configuredProfile, source: configFile };
      }
    } catch {
      // Best-effort config hydration.
    }
  }
  return { hydrated: false, profile: null, source: null };
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
  const explicitProfile = (process.env.THUMBGATE_MCP_PROFILE || '').trim() || null;
  const runtimeSubagentProfile = (process.env.THUMBGATE_SUBAGENT_PROFILE || '').trim() || null;
  const autoRoute = process.env.THUMBGATE_AUTO_PROFILE_ROUTING !== 'false';

  if (!runtimeSubagentProfile) {
    if (explicitProfile) {
      return explicitProfile;
    }
    // Auto-route only when no explicit profile and auto-routing is enabled
    if (autoRoute && toolName) {
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

module.exports = {
  DEFAULT_POLICY_PATH,
  getPolicyPath,
  getUserPolicyPath,
  loadMcpPolicy,
  loadSubagentProfiles,
  hydrateMcpEnvFromUserConfig,
  getActiveMcpProfile,
  getConfiguredDefaultProfile,
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
