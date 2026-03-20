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
const STATE_PATH = path.join(process.env.HOME || '/tmp', '.rlhf', 'gate-state.json');
const CONSTRAINTS_PATH = path.join(process.env.HOME || '/tmp', '.rlhf', 'session-constraints.json');
const STATS_PATH = path.join(process.env.HOME || '/tmp', '.rlhf', 'gate-stats.json');
const TTL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

function loadGatesConfig(configPath) {
  const primaryPath = configPath || process.env.RLHF_GATES_CONFIG || DEFAULT_CONFIG_PATH;

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

function satisfyCondition(conditionId, evidence) {
  const state = loadState();
  state[conditionId] = {
    timestamp: Date.now(),
    evidence: evidence || '',
  };
  saveState(state);
  return state[conditionId];
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

function recordStat(gateId, action) {
  const stats = loadStats();
  if (action === 'block') stats.blocked = (stats.blocked || 0) + 1;
  else if (action === 'warn') stats.warned = (stats.warned || 0) + 1;
  else stats.passed = (stats.passed || 0) + 1;
  if (!stats.byGate) stats.byGate = {};
  if (!stats.byGate[gateId]) stats.byGate[gateId] = { blocked: 0, warned: 0 };
  if (action === 'block') stats.byGate[gateId].blocked += 1;
  else if (action === 'warn') stats.byGate[gateId].warned += 1;
  saveStats(stats);
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

  for (const gate of config.gates) {
    if (!matchesGate(gate, toolName, toolInput)) continue;

    // EvoSkill Hardening: check contextual 'when' clause
    if (gate.when && !checkWhenClause(gate.when, constraints)) {
      continue;
    }

    // Metric-aware gates: check business metrics from Semantic Layer
    if (gate.metrics) {
      const metricsPassed = await checkMetricCondition(gate.metrics);
      if (!metricsPassed) {
        // If metrics don't pass, the gate matches and we take the action (block/warn)
      } else {
        // If metrics pass, the gate doesn't apply
        continue;
      }
    }

    // Check unless condition
    if (gate.unless && isConditionSatisfied(gate.unless)) {
      continue;
    }

    if (gate.action === 'block') {
      recordStat(gate.id, 'block');
      const result = { decision: 'deny', gate: gate.id, message: gate.message, severity: gate.severity };
      // Audit trail: record + auto-feed into RLHF pipeline
      const auditRecord = recordAuditEvent({ toolName, toolInput, decision: 'deny', gateId: gate.id, message: gate.message, severity: gate.severity, source: 'gates-engine' });
      auditToFeedback(auditRecord);
      return result;
    }

    if (gate.action === 'warn') {
      recordStat(gate.id, 'warn');
      const result = { decision: 'warn', gate: gate.id, message: gate.message, severity: gate.severity };
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

    if (gate.action === 'block') {
      recordStat(gate.id, 'block');
      const result = { decision: 'deny', gate: gate.id, message: gate.message, severity: gate.severity };
      const auditRecord = recordAuditEvent({ toolName, toolInput, decision: 'deny', gateId: gate.id, message: gate.message, severity: gate.severity, source: 'gates-engine' });
      auditToFeedback(auditRecord);
      return result;
    }

    if (gate.action === 'warn') {
      recordStat(gate.id, 'warn');
      const result = { decision: 'warn', gate: gate.id, message: gate.message, severity: gate.severity };
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

  if (result.decision === 'deny') {
    return JSON.stringify({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason: `[GATE:${result.gate}] ${result.message}`,
      },
    });
  }

  if (result.decision === 'warn') {
    return JSON.stringify({
      hookSpecificOutput: {
        additionalContext: `[GATE:${result.gate}] WARNING: ${result.message}`,
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
  matchesGate,
  evaluateGates,
  evaluateGatesAsync,
  computeExecutableHash,
  formatOutput,
  run,
  runAsync,
  DEFAULT_CONFIG_PATH,
  STATE_PATH,
  CONSTRAINTS_PATH,
  STATS_PATH,
  TTL_MS,
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
