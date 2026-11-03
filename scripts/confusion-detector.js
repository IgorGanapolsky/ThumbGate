#!/usr/bin/env node
'use strict';

/**
 * Confusion Detector — agent confusion detection module for ThumbGate.
 *
 * Stolen from the Supabase co-founders' "explicit agent guardrail skills"
 * pattern (Latent Space interview, 2026-10-28):
 *
 *   "Confused agents are bad agents." The fix is to detect confusion in
 *   agents before it leads to bad decisions. Ambiguous context, conflicting
 *   data, and unclear tool boundaries show up as measurable inconsistency
 *   before a bad decision happens.
 *
 * Architecture (mirrors Supabase's OLTP/OLAP separation):
 *
 *   OLTP (sync):  runConfusionPreCheck() — <5ms gate, runs in PreToolUse hook
 *                 before the action executes. Returns { risk, signals } fast.
 *
 *   OLAP (async): runConfusionAsyncReview() — post-action batch analysis.
 *                 Scores completed sessions for recurring confusion patterns
 *                 and auto-generates prevention rules.
 *
 * Rules are declarative (config/confusion-detector.json) so agents iterate
 * on the file system, not by parsing migration chains.
 */

const fs = require('node:fs');
const path = require('node:path');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'confusion-detector.json');
const SESSION_HISTORY_DIR = path.join(__dirname, '..', '.thumbgate', 'session-history');

// ---------------------------------------------------------------------------
// Config loading (declarative schema, like pg-delta)
// ---------------------------------------------------------------------------

let cachedConfig = null;
let configMtime = 0;

/**
 * Load the declarative confusion-detection config.
 * Cache is invalidated on file mtime change so agents see live updates.
 * Fail-open: if config can't be read, returns a default with no rules.
 */
function loadConfig() {
  try {
    const stat = fs.statSync(CONFIG_PATH);
    if (cacheMtime === stat.mtimeMs && cachedConfig) {
      return cachedConfig;
    }
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    cachedConfig = JSON.parse(raw);
    configMtime = stat.mtimeMs;
    return cachedConfig;
  } catch (err) {
    // Fail-open: empty rules, default thresholds
    return {
      thresholds: {
        immediateBlock: 0.8,
        warnOnAmbiguity: 0.5,
        asyncReviewThreshold: 0.3,
        maxLatencyMs: 5,
      },
      rules: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Detectors — each is a pure function: (toolName, toolInput, sessionActions) => signals[]
// ---------------------------------------------------------------------------

/**
 * DETECTOR: ambiguousTargetPath
 * Detects when a write/edit/read/delete tool references multiple, contradictory,
 * or wildcard paths without explicit disambiguation.
 */
function ambiguousTargetPath(toolName, toolInput, sessionActions) {
  const signals = [];
  const isWriteTool = /^(Edit|Write|edit|write)$/.test(toolName);
  const isReadTool = /^(Read|read|grep)$/.test(toolName);
  const isFileTool = isWriteTool || isReadTool;

  if (!isFileTool) return signals;

  const filePath = toolInput?.filePath || toolInput?.path;
  if (!filePath || typeof filePath !== 'string') return signals;

  // Wildcard paths (file globbing) = ambiguity
  if (/[?*{}\[\]]/.test(filePath)) {
    signals.push({
      detector: 'ambiguousTargetPath',
      signal: 'wildcard_path',
      risk: 0.3,
      detail: `Tool "${toolName}" targets wildcard path "${filePath}". Be explicit about which file to operate on.`,
    });
  }

  // Multiple paths in a single string
  const pathLikeSegments = filePath.split(/[\s,]+/).filter((s) => s && (s.includes('/') && s.includes('.')));
  if (pathLikeSegments.length > 1) {
    signals.push({
      detector: 'ambiguousTargetPath',
      signal: 'multiple_paths',
      risk: 0.3,
      detail: `Tool "${toolName}" references ${pathLikeSegments.length} paths in a single argument. Use explicit tool calls per file.`,
    });
  }

  return signals;
}

/**
 * DETECTOR: conflictingParallelActions
 * Detects when a new action conflicts with a recently-staked claim on the
 * same surface (e.g., two agents editing the same file).
 */
function conflictingParallelActions(toolName, toolInput, sessionActions) {
  const signals = [];
  const isFileTool = /^(Edit|Write|edit|write|Bash|bash|shell)$/.test(toolName);
  if (!isFileTool) return signals;

  const filePath = toolInput?.filePath || toolInput?.path;
  const command = toolInput?.command || toolInput?.cmd;

  // Look at the last 5 actions for conflicts
  const recentActions = sessionActions || [];
  const recent = recentActions.slice(-5);

  for (const action of recent) {
    if (action === undefined || action === null) continue;
    const otherPath = action.path || (action.input && (action.input.filePath || action.input.path));
    const otherCmd = action.command || (action.input && (action.input.command || action.input.cmd));

    // Same file being edited by different sessions
    if (filePath && otherPath && filePath === otherPath && action.tool !== toolName) {
      signals.push({
        detector: 'conflictingParallelActions',
        signal: 'surface_conflict',
        risk: 0.9,
        detail: `Action "${toolName}" on "${filePath}" conflicts with recent "${action.tool}" on the same file. Check the surface lease.`,
      });
    }

    // Destructive command while another read is pending
    if (command && isDestructiveBash(command) && otherCmd && isDestructiveBash(otherCmd)) {
      signals.push({
        detector: 'conflictingParallelActions',
        signal: 'destructive_overlap',
        risk: 0.9,
        detail: `Destructive command "${command.slice(0, 80)}" may conflict with recent destructive command "${String(otherCmd).slice(0, 80)}".`,
      });
    }
  }

  return signals;
}

function isDestructiveBash(cmd) {
  if (!cmd || typeof cmd !== 'string') return false;
  return /rm\s+-rf|git\s+push\s+-f|git\s+reset\s+--hard|\.\/.*\b--delete\b|sudo\s+rm/i.test(cmd);
}

/**
 * DETECTOR: vagueCommandIntent
 * Detects bash/shell commands that mix read, write, and destructive
 * operations without clear boundaries.
 */
function vagueCommandIntent(toolName, toolInput, sessionActions) {
  const signals = [];
  if (!/^(Bash|bash|shell|exec)$/.test(toolName)) return signals;

  const command = toolInput?.command || toolInput?.cmd || toolInput?.input;
  if (!command || typeof command !== 'string') return signals;

  // Count categories of operations in the command
  const hasRead = /(cat|head|tail|grep|ls|find|wc|less|more)\b/.test(command);
  const hasWrite = /(echo|sed|>\s|tee|touch|>\|)>/.test(command);
  const hasDestructive = isDestructiveBash(command);

  const categories = [hasRead, hasWrite, hasDestructive].filter(Boolean).length;
  if (categories >= 2 && command.length > 60) {
    signals.push({
      detector: 'vagueCommandIntent',
      signal: 'mixed_intent',
      risk: 0.4,
      detail: `Command mixes ${hasRead ? 'read' : ''}${hasWrite ? (hasRead ? ', write' : 'write') : ''}${hasDestructive ? (hasRead || hasWrite ? ', destructive' : 'destructive') : ''} operations (${command.length} chars). Split into smaller, single-purpose commands.`,
    });
  }

  return signals;
}

/**
 * DETECTOR: contradictoryInputArgs
 * Detects when tool input contains arguments that directly contradict
 * each other (e.g., both clear=true and clear=false).
 */
function contradictoryInputArgs(toolName, toolInput, sessionActions) {
  const signals = [];
  if (!toolInput || typeof toolInput !== 'object') return signals;

  const entries = Object.entries(toolInput);
  const argMap = new Map();

  for (const [key, value] of entries) {
    const normalized = key.toLowerCase().replace(/[-_]/g, '');
    const strValue = String(value).toLowerCase();
    const existing = argMap.get(normalized);

    if (existing !== undefined && existing !== strValue) {
      signals.push({
        detector: 'contradictoryInputArgs',
        signal: 'contradiction',
        risk: 0.6,
        detail: `Contradictory values for "${key}": got "${strValue}" but also "${existing}". Resolve the ambiguity before proceeding.`,
      });
    } else {
      argMap.set(normalized, strValue);
    }
  }

  return signals;
}

/**
 * DETECTOR: missingRequiredContext
 * Detects when tool input is missing fields required for safe execution.
 */
function missingRequiredContext(toolName, toolInput, sessionActions) {
  const signals = [];

  const requiredFields = {
    Edit: ['filePath', 'old_string'],
    Write: ['filePath', 'content'],
    read: ['filePath'],
    bash: ['command'],
    shell: ['command'],
  };

  const checker = requiredFields[toolName];
  if (!checker) return signals;

  for (const field of checker) {
    if (!toolInput?.[field] && !toolInput?.[field.toLowerCase()]) {
      signals.push({
        detector: 'missingRequiredContext',
        signal: 'missing_field',
        risk: 0.5,
        detail: `Tool "${toolName}" is missing required field "${field}".`,
      });
    }
  }

  return signals;
}

/**
 * DETECTOR: destructivePatternMismatch
 * Detects commands that mix destructive operations with non-destructive
 * ones without clear boundaries.
 */
function destructivePatternMismatch(toolName, toolInput, sessionActions) {
  const signals = [];
  if (!/^(Bash|bash|shell)$/.test(toolName)) return signals;

  const command = toolInput?.command || toolInput?.cmd;
  if (!command || typeof command !== 'string') return signals;

  if (isDestructiveBash(command) && command.split(/\s+/).length > 3) {
    const hasSafeCo = /(2>\s*\/dev\/null|&&|;|\|\|)/.test(command);
    if (!hasSafeCo) {
      signals.push({
        detector: 'destructivePatternMismatch',
        signal: 'unguarded_destructive',
        risk: 0.7,
        detail: `Destructive command lacks error isolation (no &&/; / null guards). Consider splitting or adding guard clauses.`,
      });
    }
  }

  return signals;
}

/**
 * DETECTOR: inconsistentWithRecentHistory
 * Detects when an action contradicts recently-staked claims, lessons,
 * or session actions within the same agent session.
 */
function inconsistentWithRecentHistory(toolName, toolInput, sessionActions) {
  const signals = [];
  const recent = (sessionActions || []).slice(-10);

  // Track the last claimed surface
  const lastClaim = recent.find((a) => a.type === 'claim' || a.type === 'surface_claim');
  if (lastClaim) {
    const filePath = toolInput?.filePath || toolInput?.path;
    if (filePath && lastClaim.path && !filePath.startsWith(path.dirname(lastClaim.path || ''))) {
      // Not a hard block — could be legitimate multi-file work
      // Only flag if the paths are clearly related
      signals.push({
        detector: 'inconsistentWithRecentHistory',
        signal: 'scope_drift',
        risk: 0.4,
        detail: `Action on "${filePath}" is outside the recently-claimed surface "${lastClaim.path}". Verify intent.`,
      });
    }
  }

  return signals;
}

// Map detector names to functions
const DETECTORS = {
  ambiguousTargetPath,
  conflictingParallelActions,
  vagueCommandIntent,
  contradictoryInputArgs,
  missingRequiredContext,
  destructivePatternMismatch,
  inconsistentWithRecentHistory,
};

// ---------------------------------------------------------------------------
// OLTP path: fast synchronous pre-check (<5ms)
// ---------------------------------------------------------------------------

/**
 * Run a fast synchronous confusion pre-check before the tool executes.
 * This is the "OLTP" gate — must complete in <5ms.
 *
 * @param {Object} params
 * @param {string} params.toolName - The tool being called (e.g., "Edit", "Bash")
 * @param {Object} params.toolInput - The tool's input arguments
 * @param {Array}  [params.sessionActions=[]] - Recent session actions for conflict detection
 * @returns {{ riskScore: number, signals: Array, decision: string }}
 */
function runConfusionPreCheck({ toolName, toolInput, sessionActions = [] }) {
  const startTime = Date.now();
  const config = loadConfig();
  const signals = [];

  for (const rule of config.rules) {
    const detector = DETECTORS[rule.detector];
    if (!detector) continue;

    const ruleSignals = detector(toolName, toolInput, sessionActions);
    for (const signal of ruleSignals) {
      signal.ruleId = rule.id;
      signal.severity = rule.severity;
      signal.category = rule.category;
      signals.push(signal);
    }
  }

  // Aggregate risk score (max-risk-wins, not sum — avoids amplification)
  const riskScore = signals.reduce((max, s) => Math.max(max, s.risk), 0);

  const decision = riskScore >= config.thresholds.immediateBlock
    ? 'block'
    : riskScore >= config.thresholds.warnOnAmbiguity
      ? 'warn'
      : 'allow';

  const latency = Date.now() - startTime;

  // Fail-open if the gate itself is too slow (defensive)
  if (latency > config.thresholds.maxLatencyMs) {
    return { riskScore, signals, decision: 'allow', latencyMs: latency, note: 'fail-open: latency exceeded' };
  }

  return { riskScore, signals, decision, latencyMs: latency };
}

/**
 * Get the confusion detection signals as a human-readable message.
 * @param {{ riskScore: number, signals: Array, decision: string }} result
 * @returns {string|null} Human-readable message, or null if no action needed.
 */
function confusionMessage(result) {
  if (result.decision === 'allow' && result.signals.length === 0) return null;

  const lines = [];
  if (result.decision === 'block') {
    lines.push('ThumbGate confusion gate: BLOCKED');
  } else if (result.decision === 'warn') {
    lines.push('ThumbGate confusion gate: WARNING — agent context may be ambiguous');
  }

  for (const signal of result.signals) {
    lines.push(`  • [${signal.severity}] ${signal.detail}`);
  }

  if (result.latencyMs && result.note) {
    lines.push(`  • [note] ${result.note}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// OLAP path: async batch review (post-action analysis)
// ---------------------------------------------------------------------------

/**
 * Run an async confusion review on a completed session. This is the "OLAP"
 * path — operates on batches, scores for recurring patterns, and can
 * auto-generate prevention rules.
 *
 * Mirrors Supabase's pattern of separating OLTP (fast local) from OLAP
 * (analytical post-processing).
 */
function runConfusionAsyncReview(sessionActions) {
  const config = loadConfig();
  const findings = [];

  for (const action of sessionActions) {
    const toolName = action.tool || action.toolName || '';
    const toolInput = action.input || action.toolInput || {};
    const context = (sessionActions || []).filter((a) => a !== action);

    const result = runConfusionPreCheck({ toolName, toolInput, sessionActions: context });

    if (result.riskScore >= config.thresholds.asyncReviewThreshold) {
      findings.push({
        actionId: action.id || action.timestamp || 'unknown',
        toolName,
        riskScore: result.riskScore,
        signals: result.signals,
        timestamp: action.timestamp || new Date().toISOString(),
      });
    }
  }

  return findings;
}

/**
 * Generate prevention rules from async review findings.
 * High-frequency confusion patterns become declarative prevention rules.
 */
function generatePreventRules(findings) {
  const ruleCounts = {};
  const detectorStats = {};

  for (const finding of findings) {
    for (const signal of finding.signals) {
      const key = `${signal.detector}:${signal.signal}`;
      ruleCounts[key] = (ruleCounts[key] || 0) + 1;
    }
    const det = finding.toolName || 'unknown';
    detectorStats[det] = (detectorStats[det] || 0) + 1;
  }

  const rules = [];
  for (const [key, count] of Object.entries(ruleCounts)) {
    if (count >= 3) {
      const [detector, signal] = key.split(':');
      rules.push({
        pattern: `${detector} → ${signal}`,
        occurrences: count,
        recommendation: `Add explicit guardrail for ${detector} ${signal} pattern`,
      });
    }
  }

  return {
    summary: {
      totalActionsReviewed: findings.length,
      patternsDetected: Object.keys(ruleCounts).length,
      topDetectors: Object.entries(detectorStats)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5),
    },
    preventionRules: rules,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point (for async batch review)
// ---------------------------------------------------------------------------

function runCli() {
  const args = process.argv.slice(2);
  const mode = args[0] || 'precheck';

  if (mode === 'precheck') {
    // Read tool action from stdin JSON: { "toolName": "Edit", "toolInput": {...}, "sessionActions": [...] }
    const raw = fs.readFileSync(0, 'utf8').trim();
    if (!raw) {
      console.error('Usage: echo \'{"toolName":"Edit","toolInput":{...}}\' | node scripts/confusion-detector.js precheck');
      process.exit(1);
    }
    const params = JSON.parse(raw);
    const result = runConfusionPreCheck({
      toolName: params.toolName,
      toolInput: params.toolInput,
      sessionActions: params.sessionActions || [],
    });
    console.log(JSON.stringify(result, null, 2));
  }

  if (mode === 'async') {
    // Read session actions from stdin JSON array
    const raw = fs.readFileSync(0, 'utf8').trim();
    if (!raw) {
      console.error('Usage: cat session.json | node scripts/confusion-detector.js async');
      process.exit(1);
    }
    const actions = JSON.parse(raw);
    const findings = runConfusionAsyncReview(actions);
    const rules = generatePreventRules(findings);
    console.log(JSON.stringify({ findings, preventionRules: rules }, null, 2));
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  loadConfig,
  runConfusionPreCheck,
  runConfusionAsyncReview,
  generatePreventRules,
  confusionMessage,
  DETECTORS,
  ambiguousTargetPath,
  conflictingParallelActions,
  vagueCommandIntent,
  contradictoryInputArgs,
  missingRequiredContext,
  destructivePatternMismatch,
  inconsistentWithRecentHistory,
};
