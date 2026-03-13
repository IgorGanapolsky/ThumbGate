#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'gates', 'default.json');
const AUTO_CONFIG_PATH = path.join(__dirname, '..', 'config', 'gates', 'auto-promoted.json');
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
      mergedConfig.gates.push(...config.gates);
    } catch (e) {
      if (isPrimary) throw e;
      console.error(`Warning: failed to load gates from ${p}: ${e.message}`);
    }
  };

  loadOne(primaryPath, true);

  if (!configPath && fs.existsSync(AUTO_CONFIG_PATH)) {
    loadOne(AUTO_CONFIG_PATH, false);
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

function matchesGate(gate, toolName, toolInput) {
  // Build the text to match against: for Bash it's the command, for Edit it's the file path
  const text = toolInput.command || toolInput.file_path || toolInput.path || '';
  try {
    const regex = new RegExp(gate.pattern);
    return regex.test(text);
  } catch {
    return false;
  }
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
      return {
        decision: 'deny',
        gate: gate.id,
        message: gate.message,
        severity: gate.severity,
      };
    }

    if (gate.action === 'warn') {
      recordStat(gate.id, 'warn');
      return {
        decision: 'warn',
        gate: gate.id,
        message: gate.message,
        severity: gate.severity,
      };
    }
  }

  return null;
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

function run(input) {
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
  matchesGate,
  evaluateGates,
  formatOutput,
  run,
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
  process.stdin.on('end', () => {
    try {
      const input = JSON.parse(data);
      const output = run(input);
      process.stdout.write(output + '\n');
      process.exit(0);
    } catch (err) {
      process.stderr.write(`gates-engine error: ${err.message}\n`);
      process.stdout.write(JSON.stringify({}) + '\n');
      process.exit(0);
    }
  });
}
