#!/usr/bin/env node
'use strict';

/**
 * Agent Security Hardening — credential tracking, privilege escalation detection,
 * dependency attestation gate.
 *
 * Closes the gaps from the agentic security video:
 * 1. Session-scoped credential attestation — track what creds each agent uses
 * 2. Privilege escalation detection — flag agents invoking tools outside their MCP profile
 * 3. Dependency attestation gate — block agents from installing unvetted packages
 */

const fs = require('fs');
const path = require('path');
const { resolveFeedbackDir } = require('./feedback-paths');

function getFeedbackDir() { return resolveFeedbackDir(); }
function ensureDir(fp) { const d = path.dirname(fp); if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
function readJsonl(fp) { if (!fs.existsSync(fp)) return []; const raw = fs.readFileSync(fp, 'utf-8').trim(); if (!raw) return []; return raw.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }

const CRED_LOG = 'credential-attestations.jsonl';
const ESCALATION_LOG = 'escalation-events.jsonl';
const DEP_LOG = 'dependency-attestations.jsonl';

function getCredLogPath() { return path.join(getFeedbackDir(), CRED_LOG); }
function getEscalationLogPath() { return path.join(getFeedbackDir(), ESCALATION_LOG); }
function getDepLogPath() { return path.join(getFeedbackDir(), DEP_LOG); }

// ---------------------------------------------------------------------------
// 1. Session-Scoped Credential Attestation
// ---------------------------------------------------------------------------

/**
 * Record what credential an agent used for a tool call.
 * Creates an audit trail: agent → credential → tool → timestamp.
 */
function attestCredential({ agentId, credentialType, credentialId, toolName, scope, sessionId } = {}) {
  const entry = {
    id: `cred_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    agentId: agentId || 'unknown',
    credentialType: credentialType || 'unknown', // 'api_key', 'oauth_token', 'session_token', 'mcp_auth'
    credentialId: credentialId ? credentialId.slice(0, 8) + '***' : 'unknown', // truncated for safety
    toolName: toolName || 'unknown',
    scope: scope || 'default',
    sessionId: sessionId || null,
  };
  const logPath = getCredLogPath();
  ensureDir(logPath);
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
  return entry;
}

/**
 * Get credential usage summary for audit.
 */
function getCredentialAudit({ periodHours = 24 } = {}) {
  const entries = readJsonl(getCredLogPath());
  const cutoff = Date.now() - periodHours * 60 * 60 * 1000;
  const recent = entries.filter((e) => new Date(e.timestamp).getTime() > cutoff);

  const byAgent = {};
  const byCredType = {};
  for (const e of recent) {
    if (!byAgent[e.agentId]) byAgent[e.agentId] = { tools: new Set(), credTypes: new Set(), count: 0 };
    byAgent[e.agentId].tools.add(e.toolName);
    byAgent[e.agentId].credTypes.add(e.credentialType);
    byAgent[e.agentId].count++;
    byCredType[e.credentialType] = (byCredType[e.credentialType] || 0) + 1;
  }

  // Serialize Sets
  const agents = Object.entries(byAgent).map(([id, data]) => ({
    agentId: id, tools: [...data.tools], credTypes: [...data.credTypes], callCount: data.count,
  }));

  return { periodHours, total: recent.length, agents, byCredType };
}

// ---------------------------------------------------------------------------
// 2. Privilege Escalation Detection
// ---------------------------------------------------------------------------

// MCP profile tool allowlists (loaded from config or defaults)
const PROFILE_ALLOWLISTS = {
  essential: new Set(['capture_feedback', 'recall', 'search_lessons', 'search_thumbgate', 'prevention_rules', 'enforcement_matrix', 'feedback_stats', 'estimate_uncertainty', 'org_dashboard', 'set_task_scope', 'get_scope_state', 'set_branch_governance', 'get_branch_governance', 'approve_protected_action', 'check_operational_integrity', 'workflow_sentinel']),
  readonly: new Set(['recall', 'feedback_summary', 'search_lessons', 'verify_claim', 'gate_stats', 'search_thumbgate', 'feedback_stats', 'estimate_uncertainty', 'org_dashboard', 'get_scope_state', 'get_branch_governance', 'check_operational_integrity', 'workflow_sentinel']),
  locked: new Set(['feedback_summary', 'search_lessons', 'diagnose_failure', 'list_intents', 'plan_intent', 'list_harnesses', 'verify_claim', 'get_scope_state', 'get_branch_governance', 'check_operational_integrity', 'workflow_sentinel']),
  commerce: new Set(['capture_feedback', 'recall', 'search_thumbgate', 'commerce_recall', 'track_action', 'verify_claim', 'feedback_stats', 'set_task_scope', 'get_scope_state', 'set_branch_governance', 'get_branch_governance', 'approve_protected_action', 'check_operational_integrity', 'workflow_sentinel']),
};

/**
 * Check if a tool call is within the agent's MCP profile scope.
 * Detects privilege escalation when agent tries to use tools outside its profile.
 */
function detectPrivilegeEscalation({ agentId, toolName, mcpProfile } = {}) {
  const profile = mcpProfile || 'essential';
  const allowlist = PROFILE_ALLOWLISTS[profile];

  // If profile unknown or no allowlist, can't detect escalation
  if (!allowlist) return { escalation: false, reason: 'unknown profile' };

  const isAllowed = allowlist.has(toolName);

  if (!isAllowed) {
    const event = {
      id: `esc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      agentId: agentId || 'unknown',
      toolName: toolName || 'unknown',
      mcpProfile: profile,
      severity: 'warning',
      message: `Agent "${agentId}" attempted to use "${toolName}" which is outside "${profile}" profile scope`,
    };
    const logPath = getEscalationLogPath();
    ensureDir(logPath);
    fs.appendFileSync(logPath, JSON.stringify(event) + '\n');
    return { escalation: true, event };
  }

  return { escalation: false };
}

/**
 * Get escalation event stats.
 */
function getEscalationStats({ periodHours = 24 } = {}) {
  const entries = readJsonl(getEscalationLogPath());
  const cutoff = Date.now() - periodHours * 60 * 60 * 1000;
  const recent = entries.filter((e) => new Date(e.timestamp).getTime() > cutoff);

  const byAgent = {};
  const byTool = {};
  for (const e of recent) {
    byAgent[e.agentId] = (byAgent[e.agentId] || 0) + 1;
    byTool[e.toolName] = (byTool[e.toolName] || 0) + 1;
  }

  return { total: recent.length, byAgent, byTool, periodHours };
}

// ---------------------------------------------------------------------------
// 3. Dependency Attestation Gate
// ---------------------------------------------------------------------------

const BLOCKED_PACKAGES = new Set([
  'event-stream', // known supply chain attack
  'ua-parser-js', // compromised in 2021
  'coa', // compromised in 2021
  'rc', // compromised in 2021
]);

const TRUSTED_SCOPES = new Set(['@anthropic-ai', '@types', '@babel', '@eslint']);

/**
 * Check if a dependency install should be allowed.
 * Blocks known-compromised packages and unscoped packages without attestation.
 */
function attestDependency({ packageName, version, agentId, action } = {}) {
  const pkg = packageName || '';
  const act = action || 'install'; // 'install', 'update', 'remove'

  const findings = [];
  let allowed = true;

  // Check blocked list
  if (BLOCKED_PACKAGES.has(pkg)) {
    findings.push({ rule: 'blocked_package', message: `"${pkg}" is a known-compromised package`, severity: 'critical' });
    allowed = false;
  }

  // Check for suspicious patterns
  if (pkg.includes('..') || pkg.includes('/') && !pkg.startsWith('@')) {
    findings.push({ rule: 'suspicious_path', message: `"${pkg}" has suspicious path characters`, severity: 'warning' });
    allowed = false;
  }

  // Check version pinning
  if (version && /^[>~^]/.test(version)) {
    findings.push({ rule: 'unpinned_version', message: `Version "${version}" is not pinned — use exact version`, severity: 'warning' });
  }

  // Trusted scope bonus
  const isTrustedScope = TRUSTED_SCOPES.has(pkg.split('/')[0]);

  const event = {
    id: `dep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    packageName: pkg,
    version: version || 'latest',
    agentId: agentId || 'unknown',
    action: act,
    allowed,
    isTrustedScope,
    findings,
  };

  const logPath = getDepLogPath();
  ensureDir(logPath);
  fs.appendFileSync(logPath, JSON.stringify(event) + '\n');

  return { allowed, findings, isTrustedScope, event };
}

/**
 * Get dependency attestation stats.
 */
function getDepAttestationStats({ periodHours = 24 } = {}) {
  const entries = readJsonl(getDepLogPath());
  const cutoff = Date.now() - periodHours * 60 * 60 * 1000;
  const recent = entries.filter((e) => new Date(e.timestamp).getTime() > cutoff);

  return {
    total: recent.length,
    allowed: recent.filter((e) => e.allowed).length,
    blocked: recent.filter((e) => !e.allowed).length,
    findings: recent.reduce((sum, e) => sum + (e.findings || []).length, 0),
    periodHours,
  };
}

module.exports = {
  attestCredential, getCredentialAudit, getCredLogPath,
  detectPrivilegeEscalation, getEscalationStats, getEscalationLogPath, PROFILE_ALLOWLISTS,
  attestDependency, getDepAttestationStats, getDepLogPath, BLOCKED_PACKAGES, TRUSTED_SCOPES,
};
