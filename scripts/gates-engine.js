#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const { isProTier, FREE_TIER_MAX_GATES } = require('./rate-limiter');

/**
 * Computes the SHA-256 hash of an executable binary to prevent path-based bypasses.
 * (Layer 5: Supply Chain / Layer 3: Execution)
 */
function computeExecutableHash(command) {
  try {
    if (!command) return null;
    const firstWord = command.trim().split(/\s+/)[0];
    if (!firstWord) return null;

    // Resolve absolute path using 'which'
    let fullPath;
    try {
      fullPath = execSync(`which ${firstWord}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch (e) {
      // If 'which' fails, it might be an absolute path or a non-existent command
      fullPath = path.isAbsolute(firstWord) ? firstWord : null;
    }
    
    if (!fullPath || !fs.existsSync(fullPath) || !fs.lstatSync(fullPath).isFile()) return null;

    const buffer = fs.readFileSync(fullPath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
  } catch (e) {
    return null;
  }
}
const {
  scanHookInput,
  buildSafeSummary,
  redactText,
} = require('./secret-scanner');
const { getAutoGatesPath } = require('./auto-promote-gates');
const { recordAuditEvent, auditToFeedback } = require('./audit-trail');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'gates', 'default.json');
const DEFAULT_CLAIM_GATES_PATH = path.join(__dirname, '..', 'config', 'gates', 'claim-verification.json');
const STATE_PATH = path.join(process.env.HOME || '/tmp', '.thumbgate', 'gate-state.json');
const CONSTRAINTS_PATH = path.join(process.env.HOME || '/tmp', '.thumbgate', 'session-constraints.json');
const STATS_PATH = path.join(process.env.HOME || '/tmp', '.thumbgate', 'gate-stats.json');
const SESSION_ACTIONS_PATH = path.join(process.env.HOME || '/tmp', '.thumbgate', 'session-actions.json');
const CUSTOM_CLAIM_GATES_PATH = path.join(process.env.HOME || '/tmp', '.thumbgate', 'claim-verification.json');
const TTL_MS = 5 * 60 * 1000; // 5 minutes
const SESSION_ACTION_TTL_MS = 60 * 60 * 1000; // 1 hour

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

function loadGatesConfig(configPath) {
  const primaryPath = configPath || process.env.THUMBGATE_GATES_CONFIG || DEFAULT_CONFIG_PATH;

  if (!fs.existsSync(primaryPath)) {
    throw new Error(`Gates config not found: ${primaryPath}`);
  }

  const mergedConfig = { version: 1, gates: [] };

  const loadOne = (p, isPrimary) => {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      const config = JSON.parse(raw);
      if (!config || !Array.isArray(config.gates)) {
        if (isPrimary) throw new Error('Invalid gates config: missing "gates" array');
        return;
      }
      return config.gates;
    } catch (e) {
      if (isPrimary) throw e;
      console.error(`Warning: failed to load gates from ${p}: ${e.message}`);
      return [];
    }
  };

  const primaryGates = loadOne(primaryPath, true).map(g => ({ ...g, layer: g.layer || 'Execution' }));
  mergedConfig.gates.push(...primaryGates);

  // Always preserve the full primary/default safety policy. Free tier limits apply
  // only to auto-promoted add-on gates so core protections never disappear.
  const autoConfigPath = getAutoGatesPath();
  if (!configPath && fs.existsSync(autoConfigPath)) {
    const autoGates = loadOne(autoConfigPath, false).map(g => ({ ...g, layer: g.layer || 'Execution' }));
    const limitedAutoGates = isProTier()
      ? autoGates
      : autoGates.slice(0, FREE_TIER_MAX_GATES);
    mergedConfig.gates.push(...limitedAutoGates);
  }

  return mergedConfig;
}

// ---------------------------------------------------------------------------
// State and Constraints management
// ---------------------------------------------------------------------------

function loadJSON(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function saveJSON(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function loadState() { return loadJSON(module.exports.STATE_PATH); }
function saveState(state) { saveJSON(module.exports.STATE_PATH, state); }

function loadConstraints() { return loadJSON(module.exports.CONSTRAINTS_PATH); }
function saveConstraints(constraints) { saveJSON(module.exports.CONSTRAINTS_PATH, constraints); }

function setConstraint(key, value) {
  const constraints = loadConstraints();
  constraints[key] = {
    value,
    timestamp: Date.now()
  };
  saveConstraints(constraints);
  return constraints[key];
}

function isConditionSatisfied(conditionId) {
  const state = loadState();
  const entry = state[conditionId];
  if (!entry) return false;
  const age = Date.now() - entry.timestamp;
  return age < TTL_MS;
}

function satisfyCondition(conditionId, evidence, structuredReasoning) {
  const state = loadState();
  const entry = {
    timestamp: Date.now(),
    evidence: evidence || '',
  };
  if (structuredReasoning && typeof structuredReasoning === 'object') {
    entry.structuredReasoning = {
      premise: structuredReasoning.premise || null,
      evidence: structuredReasoning.evidence || null,
      risk: structuredReasoning.risk || null,
      conclusion: structuredReasoning.conclusion || null,
    };
  }
  state[conditionId] = entry;
  saveState(state);
  return entry;
}

// ---------------------------------------------------------------------------
// Stats tracking
// ---------------------------------------------------------------------------

function loadStats() {
  const stats = loadJSON(module.exports.STATS_PATH);
  if (Object.keys(stats).length === 0) return { blocked: 0, warned: 0, passed: 0, byGate: {} };
  return stats;
}

function saveStats(stats) { saveJSON(module.exports.STATS_PATH, stats); }

function recordStat(gateId, action, gate) {
  const stats = loadStats();
  if (action === 'block') stats.blocked = (stats.blocked || 0) + 1;
  else if (action === 'warn') stats.warned = (stats.warned || 0) + 1;
  else stats.passed = (stats.passed || 0) + 1;
  if (!stats.byGate) stats.byGate = {};
  if (!stats.byGate[gateId]) stats.byGate[gateId] = { blocked: 0, warned: 0 };
  if (action === 'block') stats.byGate[gateId].blocked += 1;
  else if (action === 'warn') stats.byGate[gateId].warned += 1;
  saveStats(stats);
  // Track lesson freshness when an auto-promoted gate fires
  if (gate && gate.sourceLessonId) {
    try {
      const { recordTrigger } = require('./lesson-rotation');
      const { initDB } = require('./lesson-db');
      const db = initDB();
      recordTrigger(db, gate.sourceLessonId);
      db.close();
    } catch (_) { /* lesson DB may not be available */ }
  }
}

// ---------------------------------------------------------------------------
// Reasoning chain builder
// ---------------------------------------------------------------------------

/**
 * Build a human-readable reasoning chain explaining WHY a gate decision was made.
 * Returns an array of evidence steps — each a short sentence a developer can scan.
 *
 * @param {Object} gate - The matched gate definition
 * @param {string} toolName - The tool that was evaluated
 * @param {Object} toolInput - The tool input that was evaluated
 * @param {Object} [extras] - Optional extra context (metrics, constraints)
 * @returns {string[]} Array of reasoning steps
 */
function buildReasoning(gate, toolName, toolInput, extras = {}) {
  const steps = [];
  const text = toolInput.command || toolInput.file_path || toolInput.path || '';

  // 1. What matched
  steps.push(`Pattern /${gate.pattern}/ matched "${text.length > 80 ? text.slice(0, 80) + '…' : text}"`);

  // 2. Gate identity
  steps.push(`Gate ${gate.id} [${gate.action}] — layer: ${gate.layer || 'Execution'}, severity: ${gate.severity || 'medium'}`);

  // 3. Source (manual vs auto-promoted)
  if (gate.promotedAt || gate.source === 'auto-promote' || gate.source === 'force-promote') {
    const occText = gate.occurrences ? ` after ${gate.occurrences} failures` : '';
    steps.push(`Auto-promoted from feedback${occText} (${gate.promotedAt || 'unknown date'})`);
  } else {
    steps.push('Manual policy rule (default.json)');
  }

  // 4. Constraint context
  if (gate.when && gate.when.constraints) {
    const keys = Object.entries(gate.when.constraints).map(([k, v]) => `${k}=${v}`).join(', ');
    steps.push(`Active because constraint ${keys} is set`);
  }

  // 5. Unless condition status
  if (gate.unless) {
    steps.push(`Bypassable via satisfy_gate("${gate.unless}") — not currently satisfied`);
  }

  // 6. Metric condition
  if (extras.metricFailed) {
    const m = gate.metrics;
    steps.push(`Business metric "${m.name}" outside bounds [${m.min ?? '-∞'}, ${m.max ?? '∞'}]`);
  }

  // 7. Historical fire count
  const stats = loadStats();
  const gateStats = stats.byGate && stats.byGate[gate.id];
  if (gateStats) {
    steps.push(`History: blocked ${gateStats.blocked || 0}×, warned ${gateStats.warned || 0}×`);
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Matching engine
// ---------------------------------------------------------------------------

function checkWhenClause(when, constraints) {
  if (!when || !when.constraints) return true;
  
  for (const [key, expectedValue] of Object.entries(when.constraints)) {
    const constraint = constraints[key];
    if (!constraint || constraint.value !== expectedValue) {
      return false;
    }
  }
  return true;
}

function matchesGate(gate, _toolName, toolInput) {
  // Build the text to match against: for Bash it's the command, for Edit it's the file path
  const text = toolInput.command || toolInput.file_path || toolInput.path || '';
  
  // 1. Check Regex Pattern
  try {
    const regex = new RegExp(gate.pattern);
    if (!regex.test(text)) return false;
  } catch {
    return false;
  }

  // 2. Check Executable Hash (New: Layer 5 Anti-Bypass)
  // If a hash is specified, we must verify the content of the binary
  if (gate.executable_hash && toolInput.command) {
    const actualHash = computeExecutableHash(toolInput.command);
    if (actualHash !== gate.executable_hash) return false;
  }

  return true;
}

async function checkMetricCondition(metricCondition) {
  if (!metricCondition) return true;
  const { getBusinessMetrics } = require('./semantic-layer');
  const metrics = await getBusinessMetrics({ window: metricCondition.window || '30d' });
  const value = metrics.metrics[metricCondition.name];
  
  if (value === undefined) return true;

  if (metricCondition.min !== undefined && value < metricCondition.min) return false;
  if (metricCondition.max !== undefined && value > metricCondition.max) return false;
  
  return true;
}

async function evaluateGatesAsync(toolName, toolInput, configPath) {
  let config;
  try {
    config = loadGatesConfig(configPath);
  } catch {
    return null;
  }

  const constraints = loadConstraints();

  // Fast-path: feedback/recall tools skip metric gates entirely (avoids Stripe API calls)
  const METRIC_SKIP_TOOLS = ['capture_feedback', 'feedback_stats', 'recall', 'feedback_summary', 'prevention_rules'];
  const skipMetrics = METRIC_SKIP_TOOLS.includes(toolName);

  for (const gate of config.gates) {
    if (!matchesGate(gate, toolName, toolInput)) continue;

    // EvoSkill Hardening: check contextual 'when' clause
    if (gate.when && !checkWhenClause(gate.when, constraints)) {
      continue;
    }

    // Metric-aware gates: check business metrics from Semantic Layer
    let metricFailed = false;
    if (gate.metrics) {
      if (skipMetrics) {
        // Fast path: skip metric gates for feedback/recall tools
        continue;
      }
      const metricResult = await Promise.race([
        checkMetricCondition(gate.metrics),
        new Promise(resolve => setTimeout(() => resolve({ pass: true, reason: 'metric-timeout' }), 3000))
      ]);
      // checkMetricCondition returns a boolean; Promise.race timeout returns an object
      const metricsPassed = typeof metricResult === 'object' ? metricResult.pass : metricResult;
      if (!metricsPassed) {
        metricFailed = true;
      } else {
        continue;
      }
    }

    // Check unless condition
    if (gate.unless && isConditionSatisfied(gate.unless)) {
      continue;
    }

    const reasoning = buildReasoning(gate, toolName, toolInput, { metricFailed });

    if (gate.action === 'block') {
      recordStat(gate.id, 'block', gate);
      const result = { decision: 'deny', gate: gate.id, message: gate.message, severity: gate.severity, reasoning };
      const auditRecord = recordAuditEvent({ toolName, toolInput, decision: 'deny', gateId: gate.id, message: gate.message, severity: gate.severity, source: 'gates-engine' });
      auditToFeedback(auditRecord);
      return result;
    }

    if (gate.action === 'warn') {
      recordStat(gate.id, 'warn', gate);
      const result = { decision: 'warn', gate: gate.id, message: gate.message, severity: gate.severity, reasoning };
      const auditRecord = recordAuditEvent({ toolName, toolInput, decision: 'warn', gateId: gate.id, message: gate.message, severity: gate.severity, source: 'gates-engine' });
      auditToFeedback(auditRecord);
      return result;
    }
  }

  // Audit trail: record allow (no gate matched)
  recordAuditEvent({ toolName, toolInput, decision: 'allow', source: 'gates-engine' });
  return null;
}

function evaluateGates(toolName, toolInput, configPath) {
  let config;
  try {
    config = loadGatesConfig(configPath);
  } catch {
    // If config can't be loaded, pass through
    return null;
  }

  const constraints = loadConstraints();

  for (const gate of config.gates) {
    if (!matchesGate(gate, toolName, toolInput)) continue;

    // EvoSkill Hardening: check contextual 'when' clause
    if (gate.when && !checkWhenClause(gate.when, constraints)) {
      continue;
    }

    // Check unless condition
    if (gate.unless && isConditionSatisfied(gate.unless)) {
      continue;
    }

    const reasoning = buildReasoning(gate, toolName, toolInput);

    if (gate.action === 'block') {
      recordStat(gate.id, 'block', gate);
      const result = { decision: 'deny', gate: gate.id, message: gate.message, severity: gate.severity, reasoning };
      const auditRecord = recordAuditEvent({ toolName, toolInput, decision: 'deny', gateId: gate.id, message: gate.message, severity: gate.severity, source: 'gates-engine' });
      auditToFeedback(auditRecord);
      return result;
    }

    if (gate.action === 'warn') {
      recordStat(gate.id, 'warn', gate);
      const result = { decision: 'warn', gate: gate.id, message: gate.message, severity: gate.severity, reasoning };
      const auditRecord = recordAuditEvent({ toolName, toolInput, decision: 'warn', gateId: gate.id, message: gate.message, severity: gate.severity, source: 'gates-engine' });
      auditToFeedback(auditRecord);
      return result;
    }
  }

  // Audit trail: record allow
  recordAuditEvent({ toolName, toolInput, decision: 'allow', source: 'gates-engine' });
  return null;
}

function buildSecretGuardResult(scanResult) {
  return {
    decision: 'deny',
    gate: 'secret-exfiltration',
    message: buildSafeSummary(
      scanResult.findings,
      'Blocked because the action appears to expose secret material'
    ),
    severity: 'critical',
    secretScan: {
      provider: scanResult.provider,
      findings: scanResult.findings.map((finding) => ({
        id: finding.id,
        label: finding.label,
        line: finding.line || null,
        path: finding.path || null,
        source: finding.source || null,
        reason: finding.reason || null,
      })),
    },
  };
}

function getFeedbackLoopModule() {
  try {
    return require('./feedback-loop');
  } catch {
    return null;
  }
}

function recordSecretViolation(input, scanResult) {
  const feedbackLoop = getFeedbackLoopModule();
  if (!feedbackLoop || typeof feedbackLoop.appendDiagnosticRecord !== 'function') {
    return;
  }

  const toolName = input.tool_name || input.toolName || 'unknown';
  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const filePath = toolInput.file_path || toolInput.path || toolInput.filePath || null;
  const command = typeof toolInput.command === 'string' ? toolInput.command : '';
  const safeContext = redactText(
    filePath
      ? `${toolName} requested ${filePath}`
      : command
        ? `${toolName} requested command ${command}`
        : `${toolName} requested protected content`
  ).slice(0, 400);

  feedbackLoop.appendDiagnosticRecord({
    source: 'secret_guard',
    step: 'pre_tool_use',
    context: safeContext,
    metadata: {
      toolName,
      provider: scanResult.provider,
      filePath,
      commandHash: scanResult.commandHash || null,
      fileHashes: scanResult.fileHashes || [],
    },
    diagnosis: {
      diagnosed: true,
      rootCauseCategory: 'guardrail_triggered',
      criticalFailureStep: 'pre_tool_use',
      violations: scanResult.findings.map((finding) => ({
        constraintId: `security:${finding.id || 'secret_exfiltration'}`,
        description: finding.reason || finding.label || 'Secret exposure blocked',
        metadata: {
          label: finding.label || finding.id || 'secret',
          path: finding.path || null,
          line: finding.line || null,
          source: finding.source || null,
        },
      })),
      evidence: scanResult.findings.map((finding) => (
        `${finding.label || finding.id}${finding.path ? ` in ${finding.path}` : ''}${finding.line ? ` line ${finding.line}` : ''}`
      )),
    },
  });
}

function evaluateSecretGuard(input = {}) {
  const scanResult = scanHookInput(input);
  if (!scanResult.detected) {
    return null;
  }
  recordStat('secret-exfiltration', 'block');
  recordSecretViolation(input, scanResult);
  const result = buildSecretGuardResult(scanResult);
  // Audit trail: record secret guard denial
  const auditRecord = recordAuditEvent({
    toolName: input.tool_name || input.toolName || 'unknown',
    toolInput: input.tool_input || {},
    decision: 'deny',
    gateId: 'secret-exfiltration',
    message: 'Secret material detected in tool input',
    severity: 'critical',
    source: 'secret-guard',
  });
  auditToFeedback(auditRecord);
  return result;
}

// ---------------------------------------------------------------------------
// PreToolUse hook interface (stdin/stdout JSON)
// ---------------------------------------------------------------------------

function formatOutput(result) {
  if (!result) {
    // No gate matched — pass through
    return JSON.stringify({});
  }

  const reasoningSuffix = Array.isArray(result.reasoning) && result.reasoning.length
    ? '\n  Reasoning:\n  • ' + result.reasoning.join('\n  • ')
    : '';

  if (result.decision === 'deny') {
    return JSON.stringify({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason: `[GATE:${result.gate}] ${result.message}${reasoningSuffix}`,
      },
    });
  }

  if (result.decision === 'warn') {
    return JSON.stringify({
      hookSpecificOutput: {
        additionalContext: `[GATE:${result.gate}] WARNING: ${result.message}${reasoningSuffix}`,
      },
    });
  }

  return JSON.stringify({});
}

async function runAsync(input) {
  const secretGuard = evaluateSecretGuard(input);
  if (secretGuard) {
    return formatOutput(secretGuard);
  }

  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};
  const result = await evaluateGatesAsync(toolName, toolInput);
  return formatOutput(result);
}

function run(input) {
  const secretGuard = evaluateSecretGuard(input);
  if (secretGuard) {
    return formatOutput(secretGuard);
  }

  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};
  const result = evaluateGates(toolName, toolInput);
  return formatOutput(result);
}

// ---------------------------------------------------------------------------
// Session action tracking and claim verification
// ---------------------------------------------------------------------------

function loadSessionActions() {
  const actions = loadJSON(module.exports.SESSION_ACTIONS_PATH);
  const now = Date.now();
  const valid = {};

  for (const [key, entry] of Object.entries(actions)) {
    if (!entry || typeof entry !== 'object') continue;
    if (!entry.timestamp || (now - entry.timestamp) >= SESSION_ACTION_TTL_MS) continue;
    valid[key] = entry;
  }

  if (Object.keys(valid).length !== Object.keys(actions).length) {
    saveSessionActions(valid);
  }

  return valid;
}

function saveSessionActions(actions) {
  saveJSON(module.exports.SESSION_ACTIONS_PATH, actions);
}

function trackAction(actionId, metadata = {}) {
  const normalizedActionId = String(actionId || '').trim();
  if (!normalizedActionId) {
    throw new Error('actionId is required');
  }
  if (metadata !== null && typeof metadata !== 'object') {
    throw new Error('metadata must be an object when provided');
  }

  const actions = loadSessionActions();
  actions[normalizedActionId] = {
    timestamp: Date.now(),
    metadata: metadata || {},
  };
  saveSessionActions(actions);
  return actions[normalizedActionId];
}

function hasAction(actionId) {
  const normalizedActionId = String(actionId || '').trim();
  if (!normalizedActionId) return false;
  const actions = loadSessionActions();
  return Boolean(actions[normalizedActionId]);
}

function listSessionActions() {
  return loadSessionActions();
}

function clearSessionActions() {
  saveSessionActions({});
}

function loadClaimGateFile(filePath, { allowMissing = true } = {}) {
  if (!fs.existsSync(filePath)) {
    if (allowMissing) return { claims: [] };
    throw new Error(`Claim gates config not found: ${filePath}`);
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!parsed || !Array.isArray(parsed.claims)) {
    throw new Error(`Invalid claim gates config: ${filePath}`);
  }
  return parsed;
}

function saveCustomClaimGates(config) {
  fs.mkdirSync(path.dirname(module.exports.CUSTOM_CLAIM_GATES_PATH), { recursive: true });
  fs.writeFileSync(module.exports.CUSTOM_CLAIM_GATES_PATH, JSON.stringify(config, null, 2) + '\n');
}

function loadClaimGates() {
  const defaults = loadClaimGateFile(module.exports.DEFAULT_CLAIM_GATES_PATH, { allowMissing: false });
  const custom = loadClaimGateFile(module.exports.CUSTOM_CLAIM_GATES_PATH);
  const mergedByPattern = new Map();

  for (const claim of defaults.claims) {
    mergedByPattern.set(claim.pattern, claim);
  }
  for (const claim of custom.claims) {
    mergedByPattern.set(claim.pattern, claim);
  }

  return {
    version: Math.max(defaults.version || 1, custom.version || 1),
    claims: Array.from(mergedByPattern.values()),
  };
}

function registerClaimGate(claimPattern, requiredActions, blockMessage) {
  const normalizedPattern = String(claimPattern || '').trim();
  if (!normalizedPattern) {
    throw new Error('claimPattern is required');
  }
  if (!Array.isArray(requiredActions) || requiredActions.length === 0) {
    throw new Error('requiredActions must be a non-empty array');
  }

  const normalizedActions = requiredActions
    .map((actionId) => String(actionId || '').trim())
    .filter(Boolean);
  if (normalizedActions.length === 0) {
    throw new Error('requiredActions must contain at least one non-empty action id');
  }

  const custom = loadClaimGateFile(module.exports.CUSTOM_CLAIM_GATES_PATH);
  const existingIndex = custom.claims.findIndex((claim) => claim.pattern === normalizedPattern);
  const entry = {
    pattern: normalizedPattern,
    requiredActions: normalizedActions,
    message: blockMessage || `Claim "${normalizedPattern}" requires evidence: ${normalizedActions.join(', ')}`,
    createdAt: Date.now(),
  };

  if (existingIndex >= 0) {
    custom.claims[existingIndex] = entry;
  } else {
    custom.claims.push(entry);
  }

  saveCustomClaimGates(custom);
  return entry;
}

function verifyClaimEvidence(claimText) {
  const normalizedClaimText = String(claimText || '').trim();
  if (!normalizedClaimText) {
    throw new Error('claimText is required');
  }

  const config = loadClaimGates();
  const actions = loadSessionActions();
  const checks = [];

  for (const claim of config.claims) {
    let regex;
    try {
      regex = new RegExp(claim.pattern, 'i');
    } catch {
      continue;
    }
    if (!regex.test(normalizedClaimText)) continue;

    const missing = (claim.requiredActions || []).filter((actionId) => !actions[actionId]);
    checks.push({
      claim: claim.pattern,
      passed: missing.length === 0,
      missing,
      message: missing.length > 0 ? claim.message : 'All evidence present',
    });
  }

  return {
    verified: checks.every((check) => check.passed),
    checks,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  loadGatesConfig,
  loadState,
  saveState,
  loadConstraints,
  saveConstraints,
  setConstraint,
  isConditionSatisfied,
  satisfyCondition,
  loadStats,
  saveStats,
  recordStat,
  evaluateSecretGuard,
  buildSecretGuardResult,
  buildReasoning,
  matchesGate,
  evaluateGates,
  evaluateGatesAsync,
  computeExecutableHash,
  formatOutput,
  run,
  runAsync,
  trackAction,
  hasAction,
  listSessionActions,
  clearSessionActions,
  loadClaimGates,
  registerClaimGate,
  verifyClaimEvidence,
  DEFAULT_CONFIG_PATH,
  DEFAULT_CLAIM_GATES_PATH,
  STATE_PATH,
  CONSTRAINTS_PATH,
  STATS_PATH,
  SESSION_ACTIONS_PATH,
  CUSTOM_CLAIM_GATES_PATH,
  TTL_MS,
  SESSION_ACTION_TTL_MS,
};

// ---------------------------------------------------------------------------
// CLI: reads PreToolUse hook JSON from stdin
// ---------------------------------------------------------------------------

if (require.main === module) {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { data += chunk; });
  process.stdin.on('end', async () => {
    try {
      const input = JSON.parse(data);
      const output = await runAsync(input);
      process.stdout.write(output + '\n');
      process.exit(0);
    } catch (err) {
      process.stderr.write(`gates-engine error: ${err.message}\n`);
      process.stdout.write(JSON.stringify({}) + '\n');
      process.exit(0);
    }
  });
}
