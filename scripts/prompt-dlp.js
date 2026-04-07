#!/usr/bin/env node
'use strict';

/**
 * Prompt-Level DLP — real-time PII/secret scanning for agent tool call inputs.
 *
 * "Block the prompt, not the work" — scans the agent's proposed action
 * BEFORE it executes. If PII or secrets are detected in the tool call input,
 * the action is blocked or the content is redacted before reaching the tool.
 *
 * Integrates with PreToolUse hooks and the existing PII scanner.
 */

const { scanForPii, redactPii, sensitivityRank } = require('./pii-scanner');
const { SECRET_PATTERNS } = require('./secret-scanner');
const fs = require('fs');
const path = require('path');
const { resolveFeedbackDir } = require('./feedback-paths');

const DLP_LOG_FILE = 'dlp-events.jsonl';
const DEFAULT_MAX_SENSITIVITY = 'internal'; // block sensitive + restricted

function getDlpLogPath() {
  return path.join(resolveFeedbackDir(), DLP_LOG_FILE);
}

function ensureDir(fp) { const d = path.dirname(fp); if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

/**
 * Scan a tool call input for PII and secrets before execution.
 * Returns { allowed, findings, action, redactedInput }.
 *
 * @param {Object} opts
 * @param {string} opts.toolName - Name of the tool being called
 * @param {string} opts.input - The tool call input/arguments
 * @param {string} [opts.agentId] - Agent making the call
 * @param {string} [opts.maxSensitivity] - Max allowed sensitivity level
 */
function scanToolCallInput({ toolName, input, agentId, maxSensitivity } = {}) {
  const inputStr = typeof input === 'string' ? input : JSON.stringify(input || '');
  const maxSens = maxSensitivity || DEFAULT_MAX_SENSITIVITY;

  // Scan for PII
  const piiScan = scanForPii(inputStr);

  // Scan for secrets
  const secretFindings = [];
  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    const matches = inputStr.match(pattern.regex);
    if (matches && matches.length > 0) {
      secretFindings.push({ id: pattern.id, label: pattern.label, matchCount: matches.length, sensitivity: 'restricted' });
    }
  }

  const allFindings = [...piiScan.findings, ...secretFindings];
  const highestSensitivity = allFindings.length > 0
    ? allFindings.reduce((max, f) => sensitivityRank(f.sensitivity) > sensitivityRank(max) ? f.sensitivity : max, 'public')
    : 'public';

  const blocked = sensitivityRank(highestSensitivity) > sensitivityRank(maxSens);
  const action = blocked ? 'block' : allFindings.length > 0 ? 'redact' : 'allow';

  const event = {
    id: `dlp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    toolName: toolName || 'unknown',
    agentId: agentId || 'unknown',
    action,
    findingCount: allFindings.length,
    highestSensitivity,
    maxSensitivity: maxSens,
    findings: allFindings.map((f) => ({ id: f.id, label: f.label, sensitivity: f.sensitivity })),
  };

  // Log the event
  const logPath = getDlpLogPath();
  ensureDir(logPath);
  fs.appendFileSync(logPath, JSON.stringify(event) + '\n');

  return {
    allowed: !blocked,
    action,
    findings: allFindings,
    findingCount: allFindings.length,
    highestSensitivity,
    redactedInput: allFindings.length > 0 ? redactPii(inputStr) : inputStr,
    event,
  };
}

// ---------------------------------------------------------------------------
// Shadow Tool Detection
// ---------------------------------------------------------------------------

const KNOWN_GATED_TOOLS = new Set([
  'Bash', 'Edit', 'Write', 'Read', 'Glob', 'Grep',
  'capture_feedback', 'recall', 'search_lessons', 'prevention_rules',
  'feedback_stats', 'construct_context_pack', 'evaluate_context_pack',
  'set_task_scope', 'get_scope_state', 'approve_protected_action',
]);

const SHADOW_LOG_FILE = 'shadow-actions.jsonl';

function getShadowLogPath() {
  return path.join(resolveFeedbackDir(), SHADOW_LOG_FILE);
}

/**
 * Check if a tool call is going through a gated path or is a "shadow" action.
 */
function detectShadowAction({ toolName, source, agentId } = {}) {
  const isGated = KNOWN_GATED_TOOLS.has(toolName);
  const isShadow = !isGated && source !== 'mcp';

  if (isShadow) {
    const event = {
      id: `shadow_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      toolName: toolName || 'unknown',
      source: source || 'unknown',
      agentId: agentId || 'unknown',
      gated: false,
    };
    const logPath = getShadowLogPath();
    ensureDir(logPath);
    fs.appendFileSync(logPath, JSON.stringify(event) + '\n');
    return { isShadow: true, event };
  }

  return { isShadow: false, event: null };
}

/**
 * Get shadow action stats.
 */
function getShadowStats({ periodHours = 24 } = {}) {
  const logPath = getShadowLogPath();
  if (!fs.existsSync(logPath)) return { total: 0, byTool: {}, byAgent: {} };
  const raw = fs.readFileSync(logPath, 'utf-8').trim();
  if (!raw) return { total: 0, byTool: {}, byAgent: {} };
  const cutoff = Date.now() - periodHours * 60 * 60 * 1000;
  const entries = raw.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
    .filter((e) => new Date(e.timestamp).getTime() > cutoff);

  const byTool = {};
  const byAgent = {};
  for (const e of entries) {
    byTool[e.toolName] = (byTool[e.toolName] || 0) + 1;
    byAgent[e.agentId] = (byAgent[e.agentId] || 0) + 1;
  }
  return { total: entries.length, byTool, byAgent };
}

// ---------------------------------------------------------------------------
// Governance Score
// ---------------------------------------------------------------------------

/**
 * Compute a governance score for an agent session.
 * Aggregates: gate decisions, DLP scans, access checks, shadow actions.
 * Returns 0-100 score.
 */
function computeGovernanceScore({ gateDecisions = [], dlpEvents = [], shadowActions = 0, accessAttempts = { authorized: 0, failed: 0 } } = {}) {
  let score = 100;

  // Gate decisions: each block = -2, each warn = -1
  const blocks = gateDecisions.filter((d) => d === 'deny' || d === 'block').length;
  const warns = gateDecisions.filter((d) => d === 'warn').length;
  score -= blocks * 2;
  score -= warns * 1;

  // DLP events: each blocked finding = -5, each redacted = -1
  const dlpBlocks = dlpEvents.filter((e) => e.action === 'block').length;
  const dlpRedacts = dlpEvents.filter((e) => e.action === 'redact').length;
  score -= dlpBlocks * 5;
  score -= dlpRedacts * 1;

  // Shadow actions: each = -3
  score -= shadowActions * 3;

  // Failed access: each = -2
  score -= (accessAttempts.failed || 0) * 2;

  return {
    score: Math.max(0, Math.min(100, score)),
    breakdown: {
      gateBlocks: blocks,
      gateWarns: warns,
      dlpBlocks,
      dlpRedacts,
      shadowActions,
      failedAccess: accessAttempts.failed || 0,
    },
    grade: score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F',
  };
}

/**
 * Get DLP event stats for a time period.
 */
function getDlpStats({ periodHours = 24 } = {}) {
  const logPath = getDlpLogPath();
  if (!fs.existsSync(logPath)) return { total: 0, blocked: 0, redacted: 0, allowed: 0 };
  const raw = fs.readFileSync(logPath, 'utf-8').trim();
  if (!raw) return { total: 0, blocked: 0, redacted: 0, allowed: 0 };
  const cutoff = Date.now() - periodHours * 60 * 60 * 1000;
  const entries = raw.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
    .filter((e) => new Date(e.timestamp).getTime() > cutoff);
  return {
    total: entries.length,
    blocked: entries.filter((e) => e.action === 'block').length,
    redacted: entries.filter((e) => e.action === 'redact').length,
    allowed: entries.filter((e) => e.action === 'allow').length,
  };
}

module.exports = {
  scanToolCallInput, detectShadowAction, getShadowStats,
  computeGovernanceScore, getDlpStats, getDlpLogPath, getShadowLogPath,
  KNOWN_GATED_TOOLS, DEFAULT_MAX_SENSITIVITY,
};
