#!/usr/bin/env node
'use strict';

/**
 * Profile Router — OpenShell-inspired auto MCP profile selection
 *
 * Instead of manually setting RLHF_MCP_PROFILE, this module analyzes the
 * current context (tool name, input, session state) and automatically selects
 * the most restrictive profile that still permits the required operation.
 *
 * Principle: deny-by-default, least-privilege, context-aware routing.
 */

const path = require('path');

// ---------------------------------------------------------------------------
// Context classifiers
// ---------------------------------------------------------------------------

/**
 * Classifies the current operation context to determine the appropriate
 * MCP profile. Returns the most restrictive profile that still allows
 * the needed tools.
 *
 * @param {object} params
 * @param {string} params.toolName     — MCP tool being requested
 * @param {object} [params.toolInput]  — tool input payload
 * @param {string} [params.sessionType] — 'review' | 'execute' | 'debug' | null
 * @param {boolean} [params.hasWriteIntent] — whether the session involves writes
 * @returns {{ profile: string, reason: string }}
 */
function routeProfile(params = {}) {
  const { toolName, sessionType, hasWriteIntent } = params;
  const explicitProfile = process.env.RLHF_MCP_PROFILE;

  // Explicit override always wins — but we still audit the decision
  if (explicitProfile) {
    return {
      profile: explicitProfile,
      reason: `explicit override via RLHF_MCP_PROFILE=${explicitProfile}`,
      wasAutoRouted: false,
    };
  }

  // Session-type routing
  if (sessionType === 'review' || isReadOnlySession()) {
    return {
      profile: 'readonly',
      reason: 'read-only session detected — routing to readonly profile',
      wasAutoRouted: true,
    };
  }

  // Tool-level routing: if the tool is only available in certain profiles,
  // select the most restrictive one that includes it
  if (toolName) {
    const profile = findMostRestrictiveProfile(toolName);
    if (profile) {
      return {
        profile,
        reason: `auto-routed to "${profile}" — most restrictive profile containing "${toolName}"`,
        wasAutoRouted: true,
      };
    }
  }

  // Write-intent routing
  if (hasWriteIntent === false) {
    return {
      profile: 'readonly',
      reason: 'no write intent — routing to readonly profile',
      wasAutoRouted: true,
    };
  }

  // Default: use 'essential' instead of 'default' for least-privilege
  return {
    profile: 'essential',
    reason: 'default auto-routing — essential profile (least privilege)',
    wasAutoRouted: true,
  };
}

// ---------------------------------------------------------------------------
// Profile analysis helpers
// ---------------------------------------------------------------------------

function loadProfilesLazy() {
  try {
    const mcpPolicy = require('./mcp-policy');
    return mcpPolicy.loadMcpPolicy();
  } catch {
    return null;
  }
}

/**
 * Find the most restrictive (smallest) profile that includes the given tool.
 * Profile restrictiveness = fewer tools allowed = more restricted.
 */
function findMostRestrictiveProfile(toolName) {
  const policy = loadProfilesLazy();
  if (!policy || !policy.profiles) return null;

  // Sort profiles by number of tools (most restrictive first)
  const candidates = Object.entries(policy.profiles)
    .filter(([, tools]) => tools.includes(toolName))
    .sort((a, b) => a[1].length - b[1].length);

  if (candidates.length === 0) return null;
  return candidates[0][0]; // most restrictive profile that has this tool
}

/**
 * Detect read-only session from environment signals.
 */
function isReadOnlySession() {
  // CI review context
  if (process.env.CI && process.env.GITHUB_EVENT_NAME === 'pull_request') return true;
  // Explicit read-only marker
  if (process.env.RLHF_SESSION_TYPE === 'review') return true;
  // Subagent review profile
  if (process.env.RLHF_SUBAGENT_PROFILE === 'review_workflow') return true;
  return false;
}

// ---------------------------------------------------------------------------
// Sensitive data routing (privacy router)
// ---------------------------------------------------------------------------

/**
 * Determines whether a tool input should be routed to a local model
 * (privacy-sensitive) or can go to a frontier model.
 *
 * @param {object} params
 * @param {string} params.toolName
 * @param {object} params.toolInput
 * @returns {{ route: 'local' | 'frontier', reason: string }}
 */
function routePrivacy(params = {}) {
  const { toolName, toolInput } = params;
  const inputStr = JSON.stringify(toolInput || {});

  // Patterns that should stay local
  const sensitivePatterns = [
    /\.env\b/i,
    /credentials?\b/i,
    /secret[_-]?key/i,
    /api[_-]?key/i,
    /password/i,
    /token/i,
    /private[_-]?key/i,
    /\.pem\b/i,
    /\.p12\b/i,
    /auth[_-]?config/i,
  ];

  // Check if input references sensitive material
  for (const pattern of sensitivePatterns) {
    if (pattern.test(inputStr) || pattern.test(toolName || '')) {
      return {
        route: 'local',
        reason: `sensitive pattern detected: ${pattern.source}`,
      };
    }
  }

  // Sensitive tools that should always route locally
  const localOnlyTools = [
    'capture_feedback',
    'export_dpo_pairs',
    'export_databricks_bundle',
    'track_action',
    'verify_claim',
    'register_claim_gate',
  ];
  if (localOnlyTools.includes(toolName)) {
    return {
      route: 'local',
      reason: `tool "${toolName}" contains training data — routing locally`,
    };
  }

  return {
    route: 'frontier',
    reason: 'no sensitive content detected — frontier routing allowed',
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  routeProfile,
  routePrivacy,
  findMostRestrictiveProfile,
  isReadOnlySession,
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (require.main === module) {
  const toolName = process.argv[2] || null;
  const result = routeProfile({ toolName });
  const privacy = toolName ? routePrivacy({ toolName, toolInput: {} }) : null;

  console.log(JSON.stringify({ routing: result, privacy }, null, 2));
}
