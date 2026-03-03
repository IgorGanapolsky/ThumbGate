#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { loadMcpPolicy } = require('./mcp-policy');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_SUBAGENT_PROFILE_PATH = path.join(PROJECT_ROOT, 'config', 'subagent-profiles.json');

function getSubagentProfilePath() {
  return process.env.RLHF_SUBAGENT_PROFILE_PATH || DEFAULT_SUBAGENT_PROFILE_PATH;
}

function loadSubagentProfiles() {
  const raw = fs.readFileSync(getSubagentProfilePath(), 'utf-8');
  const parsed = JSON.parse(raw);
  if (!parsed.profiles || typeof parsed.profiles !== 'object') {
    throw new Error('Invalid subagent profile config: missing profiles object');
  }
  return parsed;
}

function listSubagentProfiles() {
  const parsed = loadSubagentProfiles();
  return Object.keys(parsed.profiles);
}

function getSubagentProfile(name) {
  const parsed = loadSubagentProfiles();
  const profile = parsed.profiles[name];
  if (!profile) {
    throw new Error(`Unknown subagent profile: ${name}`);
  }
  return profile;
}

function validateSubagentProfiles() {
  const parsed = loadSubagentProfiles();
  const policy = loadMcpPolicy();
  const issues = [];

  for (const [name, profile] of Object.entries(parsed.profiles)) {
    if (!profile.mcpProfile) {
      issues.push(`${name}: missing mcpProfile`);
    } else if (!policy.profiles[profile.mcpProfile]) {
      issues.push(`${name}: unknown mcpProfile '${profile.mcpProfile}'`);
    }

    if (!profile.context || typeof profile.context !== 'object') {
      issues.push(`${name}: missing context settings`);
    } else {
      if (!Number.isFinite(profile.context.maxItems) || profile.context.maxItems <= 0) {
        issues.push(`${name}: invalid context.maxItems`);
      }
      if (!Number.isFinite(profile.context.maxChars) || profile.context.maxChars <= 0) {
        issues.push(`${name}: invalid context.maxChars`);
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

module.exports = {
  DEFAULT_SUBAGENT_PROFILE_PATH,
  getSubagentProfilePath,
  loadSubagentProfiles,
  listSubagentProfiles,
  getSubagentProfile,
  validateSubagentProfiles,
};

if (require.main === module) {
  const result = validateSubagentProfiles();
  console.log(JSON.stringify({ profiles: listSubagentProfiles(), ...result }, null, 2));
  process.exit(result.valid ? 0 : 1);
}
