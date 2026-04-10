#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, execFileSync } = require('child_process');

const { isProTier, FREE_TIER_MAX_GATES } = require('./rate-limiter');
const {
  DEFAULT_BASE_BRANCH,
  evaluateOperationalIntegrity,
} = require('./operational-integrity');
const {
  evaluateWorkflowSentinel,
} = require('./workflow-sentinel');
const {
  recordDecisionEvaluation,
  recordDecisionOutcome,
} = require('./decision-journal');

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
const {
  evaluateSecurityScan,
} = require('./security-scanner');
const { getAutoGatesPath } = require('./auto-promote-gates');
const { recordAuditEvent, auditToFeedback } = require('./audit-trail');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'gates', 'default.json');
const DEFAULT_CLAIM_GATES_PATH = path.join(__dirname, '..', 'config', 'gates', 'claim-verification.json');
const STATE_PATH = path.join(process.env.HOME || '/tmp', '.thumbgate', 'gate-state.json');
const CONSTRAINTS_PATH = path.join(process.env.HOME || '/tmp', '.thumbgate', 'session-constraints.json');
const STATS_PATH = path.join(process.env.HOME || '/tmp', '.thumbgate', 'gate-stats.json');
const SESSION_ACTIONS_PATH = path.join(process.env.HOME || '/tmp', '.thumbgate', 'session-actions.json');
const CUSTOM_CLAIM_GATES_PATH = path.join(process.env.HOME || '/tmp', '.thumbgate', 'claim-verification.json');
const GOVERNANCE_STATE_PATH = path.join(process.env.HOME || '/tmp', '.thumbgate', 'governance-state.json');
const TTL_MS = 5 * 60 * 1000; // 5 minutes
const SESSION_ACTION_TTL_MS = 60 * 60 * 1000; // 1 hour
const PROTECTED_APPROVAL_TTL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_PROTECTED_FILE_GLOBS = [
  'AGENTS.md',
  'CLAUDE.md',
  'CLAUDE.local.md',
  'GEMINI.md',
  'README.md',
  '.gitignore',
  '.husky/**',
  '.claude/**',
  'skills/**',
  'SKILL.md',
  'config/gates/**',
];
const EDIT_LIKE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);
const HIGH_RISK_BASH_PATTERN = /\b(?:git\s+(?:add|commit|push)|gh\s+pr\s+(?:create|merge)|npm\s+publish|yarn\s+publish|pnpm\s+publish|rm\s+-rf)\b/i;

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

function loadGatesConfig(configPath, harnessPath) {
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

  // Load workflow-specific harness gates (always additive, never replaces default).
  // Resolved by harness-selector based on tool name + command context.
  const resolvedHarness = harnessPath || process.env.THUMBGATE_HARNESS_CONFIG;
  if (resolvedHarness && fs.existsSync(resolvedHarness)) {
    const harnessGates = (loadOne(resolvedHarness, false) || [])
      .map(g => ({ ...g, layer: g.layer || 'Execution', source: g.source || 'harness' }));
    mergedConfig.gates.push(...harnessGates);
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

function normalizePosix(filePath) {
  return String(filePath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .trim();
}

function normalizeGlob(glob) {
  return normalizePosix(glob).replace(/\/+$/, '');
}

function sanitizeGlobList(globs) {
  if (!Array.isArray(globs)) return [];
  return [...new Set(globs.map((glob) => normalizeGlob(glob)).filter(Boolean))];
}

function globToRegExp(glob) {
  const normalized = normalizeGlob(glob);
  let pattern = '^';
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const next = normalized[i + 1];
    if (char === '*') {
      if (next === '*') {
        pattern += '.*';
        i += 1;
      } else {
        pattern += '[^/]*';
      }
      continue;
    }
    if ('\\^$+?.()|{}[]'.includes(char)) {
      pattern += `\\${char}`;
      continue;
    }
    pattern += char;
  }
  pattern += '$';
  return new RegExp(pattern);
}

function matchesGlob(filePath, glob) {
  if (!glob) return false;
  try {
    return globToRegExp(glob).test(normalizePosix(filePath));
  } catch {
    return false;
  }
}

function matchesAnyGlob(filePath, globs) {
  return sanitizeGlobList(globs).some((glob) => matchesGlob(filePath, glob));
}

function clampTtlMs(value, fallbackMs) {
  const fallback = Number.isFinite(fallbackMs) ? fallbackMs : PROTECTED_APPROVAL_TTL_MS;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(Math.max(numeric, 60 * 1000), 24 * 60 * 60 * 1000);
}

function loadGovernanceState() {
  const raw = loadJSON(module.exports.GOVERNANCE_STATE_PATH);
  const state = {
    taskScope: raw && raw.taskScope && typeof raw.taskScope === 'object' ? raw.taskScope : null,
    protectedApprovals: Array.isArray(raw && raw.protectedApprovals) ? raw.protectedApprovals : [],
    branchGovernance: raw && raw.branchGovernance && typeof raw.branchGovernance === 'object'
      ? raw.branchGovernance
      : null,
  };
  const now = Date.now();
  const activeApprovals = state.protectedApprovals.filter((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    if (!entry.timestamp || !entry.expiresAt) return false;
    return now < entry.expiresAt;
  });
  if (activeApprovals.length !== state.protectedApprovals.length) {
    state.protectedApprovals = activeApprovals;
    saveGovernanceState(state);
  }
  return state;
}

function saveGovernanceState(state) {
  const next = {
    taskScope: state && state.taskScope ? state.taskScope : null,
    protectedApprovals: Array.isArray(state && state.protectedApprovals) ? state.protectedApprovals : [],
    branchGovernance: state && state.branchGovernance ? state.branchGovernance : null,
  };
  saveJSON(module.exports.GOVERNANCE_STATE_PATH, next);
}

function setTaskScope(scopeInput = {}) {
  if (scopeInput && scopeInput.clear === true) {
    const currentState = loadGovernanceState();
    const cleared = {
      taskScope: null,
      protectedApprovals: currentState.protectedApprovals,
      branchGovernance: currentState.branchGovernance,
    };
    saveGovernanceState(cleared);
    return null;
  }

  const allowedPaths = sanitizeGlobList(scopeInput.allowedPaths);
  if (allowedPaths.length === 0) {
    throw new Error('allowedPaths must be a non-empty array');
  }

  const protectedPaths = sanitizeGlobList(
    Array.isArray(scopeInput.protectedPaths) && scopeInput.protectedPaths.length > 0
      ? scopeInput.protectedPaths
      : DEFAULT_PROTECTED_FILE_GLOBS
  );
  const taskScope = {
    taskId: String(scopeInput.taskId || '').trim() || null,
    summary: String(scopeInput.summary || '').trim() || null,
    allowedPaths,
    protectedPaths,
    localOnly: scopeInput.localOnly === true,
    repoPath: String(scopeInput.repoPath || '').trim() || null,
    createdAt: new Date().toISOString(),
    timestamp: Date.now(),
  };
  const state = loadGovernanceState();
  state.taskScope = taskScope;
  saveGovernanceState(state);
  if (taskScope.localOnly) {
    setConstraint('local_only', true);
  }
  return taskScope;
}

function approveProtectedAction(input = {}) {
  const pathGlobs = sanitizeGlobList(input.pathGlobs);
  if (pathGlobs.length === 0) {
    throw new Error('pathGlobs must be a non-empty array');
  }
  const reason = String(input.reason || '').trim();
  if (!reason) {
    throw new Error('reason is required');
  }

  const ttlMs = clampTtlMs(input.ttlMs, PROTECTED_APPROVAL_TTL_MS);
  const now = Date.now();
  const entry = {
    id: `approval_${now}_${Math.random().toString(36).slice(2, 8)}`,
    pathGlobs,
    reason,
    evidence: String(input.evidence || '').trim() || null,
    taskId: String(input.taskId || '').trim() || null,
    timestamp: now,
    expiresAt: now + ttlMs,
  };

  const state = loadGovernanceState();
  state.protectedApprovals.push(entry);
  saveGovernanceState(state);
  return entry;
}

function setBranchGovernance(input = {}) {
  if (input && input.clear === true) {
    const state = loadGovernanceState();
    state.branchGovernance = null;
    saveGovernanceState(state);
    return null;
  }

  const branchName = String(input.branchName || '').trim() || null;
  const baseBranch = String(input.baseBranch || '').trim() || DEFAULT_BASE_BRANCH;
  const releaseSensitiveGlobs = sanitizeGlobList(
    Array.isArray(input.releaseSensitiveGlobs) ? input.releaseSensitiveGlobs : []
  );
  const governance = {
    branchName,
    baseBranch,
    prRequired: input.prRequired !== false,
    prNumber: String(input.prNumber || '').trim() || null,
    prUrl: String(input.prUrl || '').trim() || null,
    queueRequired: input.queueRequired === true,
    localOnly: input.localOnly === true,
    releaseVersion: String(input.releaseVersion || '').trim() || null,
    releaseEvidence: String(input.releaseEvidence || '').trim() || null,
    releaseSensitiveGlobs,
    timestamp: Date.now(),
    createdAt: new Date().toISOString(),
  };

  const state = loadGovernanceState();
  state.branchGovernance = governance;
  saveGovernanceState(state);
  if (governance.localOnly) {
    setConstraint('local_only', true);
  }
  return governance;
}

function getScopeState() {
  return loadGovernanceState();
}

function getBranchGovernanceState() {
  return loadGovernanceState().branchGovernance;
}

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
  else if (action === 'approve') stats.pendingApproval = (stats.pendingApproval || 0) + 1;
  else if (action === 'log') stats.logged = (stats.logged || 0) + 1;
  else stats.passed = (stats.passed || 0) + 1;
  if (!stats.byGate) stats.byGate = {};
  if (!stats.byGate[gateId]) stats.byGate[gateId] = { blocked: 0, warned: 0, pendingApproval: 0, logged: 0 };
  if (action === 'block') stats.byGate[gateId].blocked += 1;
  else if (action === 'warn') stats.byGate[gateId].warned += 1;
  else if (action === 'approve') stats.byGate[gateId].pendingApproval = (stats.byGate[gateId].pendingApproval || 0) + 1;
  else if (action === 'log') stats.byGate[gateId].logged = (stats.byGate[gateId].logged || 0) + 1;
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

function getHybridFeedbackModule() {
  try {
    return require('./hybrid-feedback-context');
  } catch {
    return null;
  }
}

function safeExecFileLines(binary, args, cwd) {
  try {
    const output = execFileSync(binary, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!output) return [];
    return output.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function resolveRepoRoot(toolInput = {}) {
  const candidates = [
    toolInput.repoPath,
    toolInput.cwd,
    process.cwd(),
  ]
    .filter(Boolean)
    .map((value) => path.resolve(String(value)));

  for (const cwd of candidates) {
    try {
      const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (root) return root;
    } catch {
      continue;
    }
  }

  return null;
}

function toRepoRelativePath(filePath, repoRoot) {
  const value = String(filePath || '').trim();
  if (!value) return '';
  if (repoRoot && path.isAbsolute(value)) {
    const relative = path.relative(repoRoot, value);
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
      return normalizePosix(relative);
    }
  }
  return normalizePosix(value);
}

function collectInlineAffectedFiles(toolInput = {}, repoRoot) {
  const collected = [];
  const arrayFields = [
    toolInput.changed_files,
    toolInput.changedFiles,
    toolInput.files,
    toolInput.file_paths,
    toolInput.filePaths,
    toolInput.paths,
  ];

  for (const field of arrayFields) {
    if (!Array.isArray(field)) continue;
    for (const entry of field) {
      const normalized = toRepoRelativePath(entry, repoRoot);
      if (normalized) collected.push(normalized);
    }
  }

  const scalarFields = [
    toolInput.file_path,
    toolInput.filePath,
    toolInput.path,
  ];
  for (const field of scalarFields) {
    const normalized = toRepoRelativePath(field, repoRoot);
    if (normalized) collected.push(normalized);
  }

  return [...new Set(collected)];
}

function getUpstreamRef(repoRoot) {
  const upstream = safeExecFileLines('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], repoRoot)[0];
  if (upstream) return upstream;
  const remoteHead = safeExecFileLines('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], repoRoot)[0];
  if (remoteHead) return remoteHead.replace(/^refs\/remotes\//, '');
  return null;
}

function getBranchDiffFiles(repoRoot) {
  const upstream = getUpstreamRef(repoRoot);
  if (upstream) {
    return safeExecFileLines('git', ['diff', '--name-only', `${upstream}...HEAD`], repoRoot);
  }
  const headParent = safeExecFileLines('git', ['rev-parse', '--verify', 'HEAD~1'], repoRoot)[0];
  if (headParent) {
    return safeExecFileLines('git', ['diff', '--name-only', 'HEAD~1..HEAD'], repoRoot);
  }
  return safeExecFileLines('git', ['diff', '--name-only'], repoRoot);
}

function extractAffectedFiles(toolName, toolInput = {}) {
  const repoRoot = resolveRepoRoot(toolInput);
  const files = new Set(collectInlineAffectedFiles(toolInput, repoRoot));
  const command = String(toolInput.command || '');

  if (toolName === 'Bash' && repoRoot && command) {
    if (/\bgit\s+commit\b/i.test(command)) {
      for (const filePath of safeExecFileLines('git', ['diff', '--cached', '--name-only'], repoRoot)) {
        files.add(normalizePosix(filePath));
      }
    }

    if (/\bgit\s+add\b/i.test(command)) {
      for (const filePath of safeExecFileLines('git', ['diff', '--name-only'], repoRoot)) {
        files.add(normalizePosix(filePath));
      }
      for (const filePath of safeExecFileLines('git', ['ls-files', '--others', '--exclude-standard'], repoRoot)) {
        files.add(normalizePosix(filePath));
      }
    }

    if (/\bgit\s+push\b/i.test(command) || /\bgh\s+pr\s+(?:create|merge)\b/i.test(command)) {
      for (const filePath of getBranchDiffFiles(repoRoot)) {
        files.add(normalizePosix(filePath));
      }
    }
  }

  return {
    repoRoot,
    files: [...files].filter(Boolean),
  };
}

function isHighRiskAction(toolName, toolInput = {}, affectedFiles = []) {
  if (EDIT_LIKE_TOOLS.has(toolName) && affectedFiles.length > 0) return true;
  if (toolName !== 'Bash') return false;
  const command = String(toolInput.command || '');
  return HIGH_RISK_BASH_PATTERN.test(command);
}

function isScopeEnforcedAction(toolName, toolInput = {}, affectedFiles = []) {
  if (EDIT_LIKE_TOOLS.has(toolName) && affectedFiles.length > 0) return true;
  if (toolName !== 'Bash') return false;
  const command = String(toolInput.command || '');
  if (!HIGH_RISK_BASH_PATTERN.test(command)) return false;
  return affectedFiles.length > 0;
}

function shouldEnforceTaskScope(gate, governanceState, toolName, toolInput = {}, affectedFiles = []) {
  if (gate.scopeMode === 'declared-only') {
    return Boolean(governanceState && governanceState.taskScope) &&
      EDIT_LIKE_TOOLS.has(toolName) &&
      affectedFiles.length > 0;
  }
  return isScopeEnforcedAction(toolName, toolInput, affectedFiles);
}

function formatFileList(files, limit = 5) {
  const items = Array.isArray(files) ? files.filter(Boolean) : [];
  if (items.length === 0) return 'none';
  if (items.length <= limit) return items.join(', ');
  return `${items.slice(0, limit).join(', ')} (+${items.length - limit} more)`;
}

function buildTaskScopeViolation(taskScope, affectedFiles) {
  if (!Array.isArray(affectedFiles) || affectedFiles.length === 0) return null;
  if (!taskScope || !Array.isArray(taskScope.allowedPaths) || taskScope.allowedPaths.length === 0) {
    return {
      reasonCode: 'missing_task_scope',
      outsideFiles: affectedFiles.slice(),
      allowedPaths: [],
      summary: null,
    };
  }
  const outsideFiles = affectedFiles.filter((filePath) => !matchesAnyGlob(filePath, taskScope.allowedPaths));
  if (outsideFiles.length === 0) return null;
  return {
    reasonCode: 'outside_declared_scope',
    outsideFiles,
    allowedPaths: taskScope.allowedPaths.slice(),
    summary: taskScope.summary || null,
  };
}

function buildProtectedApprovalViolation(protectedGlobs, approvals, affectedFiles) {
  const normalizedProtected = sanitizeGlobList(protectedGlobs);
  if (normalizedProtected.length === 0 || !Array.isArray(affectedFiles) || affectedFiles.length === 0) {
    return null;
  }
  const protectedFiles = affectedFiles.filter((filePath) => matchesAnyGlob(filePath, normalizedProtected));
  if (protectedFiles.length === 0) return null;

  const activeApprovals = Array.isArray(approvals) ? approvals : [];
  const missingApprovalFiles = protectedFiles.filter((filePath) => {
    return !activeApprovals.some((entry) => matchesAnyGlob(filePath, entry.pathGlobs || []));
  });
  if (missingApprovalFiles.length === 0) return null;

  return {
    protectedFiles,
    missingApprovalFiles,
    protectedGlobs: normalizedProtected,
  };
}

function buildBranchGovernanceViolation(governanceState, toolInput = {}, affectedFiles = [], repoRoot = null, requireReleaseReadiness = false) {
  const command = String(toolInput.command || '').trim();
  if (!command) return null;

  const integrity = evaluateOperationalIntegrity({
    repoPath: repoRoot || (governanceState && governanceState.taskScope && governanceState.taskScope.repoPath) || process.cwd(),
    branchGovernance: governanceState ? governanceState.branchGovernance : null,
    changedFiles: affectedFiles,
    command,
    requireVersionNotBehindBase: requireReleaseReadiness,
  });

  if (!integrity || integrity.blockers.length === 0) {
    return null;
  }

  return {
    blockers: integrity.blockers,
    currentBranch: integrity.currentBranch,
    baseBranch: integrity.baseBranch,
    releaseSensitiveFiles: integrity.releaseSensitiveFiles,
    packageVersion: integrity.packageVersion,
    baseVersion: integrity.baseVersion,
  };
}

function buildGateMessage(gate, matchDetails) {
  if (matchDetails && matchDetails.taskScopeViolation) {
    const violation = matchDetails.taskScopeViolation;
    if (violation.reasonCode === 'missing_task_scope') {
      return `No task scope is declared for this high-risk action. Affected files: ${formatFileList(violation.outsideFiles)}.`;
    }
    return `Action touches files outside the declared task scope: ${formatFileList(violation.outsideFiles)}. Allowed paths: ${formatFileList(violation.allowedPaths)}.`;
  }

  if (matchDetails && matchDetails.protectedApprovalViolation) {
    const violation = matchDetails.protectedApprovalViolation;
    return `Protected files require explicit approval before editing or publishing. Missing approval for: ${formatFileList(violation.missingApprovalFiles)}.`;
  }

  if (matchDetails && matchDetails.branchGovernanceViolation) {
    const [firstBlocker] = matchDetails.branchGovernanceViolation.blockers || [];
    if (firstBlocker && firstBlocker.message) {
      return firstBlocker.message;
    }
  }

  return gate.message;
}

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
  const text = extras.matchText || toolInput.command || toolInput.file_path || toolInput.path || '';

  // 1. What matched
  if (gate.pattern) {
    steps.push(`Pattern /${gate.pattern}/ matched "${text.length > 80 ? text.slice(0, 80) + '…' : text}"`);
  } else {
    steps.push(`Structural gate ${gate.id} matched requested action on "${text.length > 80 ? text.slice(0, 80) + '…' : text}"`);
  }

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

  if (extras.affectedFiles && extras.affectedFiles.length > 0) {
    steps.push(`Affected files: ${formatFileList(extras.affectedFiles)}`);
  }

  if (extras.taskScopeViolation) {
    if (extras.taskScopeViolation.reasonCode === 'missing_task_scope') {
      steps.push('No active task scope is declared for this high-risk action');
    } else {
      steps.push(`Outside declared task scope: ${formatFileList(extras.taskScopeViolation.outsideFiles)}`);
      steps.push(`Declared scope: ${formatFileList(extras.taskScopeViolation.allowedPaths)}`);
    }
  }

  if (extras.protectedApprovalViolation) {
    steps.push(`Protected files without approval: ${formatFileList(extras.protectedApprovalViolation.missingApprovalFiles)}`);
  }

  if (extras.branchGovernanceViolation) {
    if (extras.branchGovernanceViolation.currentBranch || extras.branchGovernanceViolation.baseBranch) {
      steps.push(`Branch governance context: ${extras.branchGovernanceViolation.currentBranch || 'unknown'} -> ${extras.branchGovernanceViolation.baseBranch || 'unknown'}`);
    }
    if (extras.branchGovernanceViolation.releaseSensitiveFiles && extras.branchGovernanceViolation.releaseSensitiveFiles.length > 0) {
      steps.push(`Release-sensitive files: ${formatFileList(extras.branchGovernanceViolation.releaseSensitiveFiles)}`);
    }
    for (const blocker of extras.branchGovernanceViolation.blockers || []) {
      steps.push(`Branch governance blocker: ${blocker.code} — ${blocker.message}`);
    }
  }

  if (extras.memoryGuard && extras.memoryGuard.reason) {
    steps.push(`Memory guard matched (${extras.memoryGuard.source}): ${extras.memoryGuard.reason}`);
  }

  if (extras.workflowSentinel) {
    steps.push(`Workflow sentinel risk: ${extras.workflowSentinel.band} (${extras.workflowSentinel.riskScore})`);
    if (extras.workflowSentinel.blastRadius && extras.workflowSentinel.blastRadius.summary) {
      steps.push(`Workflow sentinel blast radius: ${extras.workflowSentinel.blastRadius.summary}`);
    }
    for (const remediation of (extras.workflowSentinel.remediations || []).slice(0, 3)) {
      steps.push(`Workflow sentinel remediation: ${remediation.title} — ${remediation.action}`);
    }
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

function matchGate(gate, toolName, toolInput = {}) {
  const matchText = toolInput.command || toolInput.file_path || toolInput.path || '';
  const affected = extractAffectedFiles(toolName, toolInput);
  const affectedFiles = affected.files;
  const repoRoot = affected.repoRoot;
  const governanceState = loadGovernanceState();

  if (Array.isArray(gate.toolNames) && gate.toolNames.length > 0 && !gate.toolNames.includes(toolName)) {
    return { matched: false, matchText, affectedFiles };
  }

  if (gate.pattern) {
    try {
      const regex = new RegExp(gate.pattern);
      if (!regex.test(matchText)) return { matched: false, matchText, affectedFiles };
    } catch {
      return { matched: false, matchText, affectedFiles };
    }
  }

  if (gate.executable_hash && toolInput.command) {
    const actualHash = computeExecutableHash(toolInput.command);
    if (actualHash !== gate.executable_hash) return { matched: false, matchText, affectedFiles };
  }

  if (Array.isArray(gate.fileGlobs) && gate.fileGlobs.length > 0) {
    const scopedFiles = affectedFiles.filter((filePath) => matchesAnyGlob(filePath, gate.fileGlobs));
    if (scopedFiles.length === 0) return { matched: false, matchText, affectedFiles };
  }

  let taskScopeViolation = null;
  if (gate.requireTaskScope) {
    if (!shouldEnforceTaskScope(gate, governanceState, toolName, toolInput, affectedFiles)) {
      return { matched: false, matchText, affectedFiles };
    }
    taskScopeViolation = buildTaskScopeViolation(governanceState.taskScope, affectedFiles);
    if (!taskScopeViolation) return { matched: false, matchText, affectedFiles };
  }

  let protectedApprovalViolation = null;
  if (gate.requireProtectedApproval) {
    const protectedGlobs = sanitizeGlobList(
      Array.isArray(gate.protectedGlobs) && gate.protectedGlobs.length > 0
        ? gate.protectedGlobs
        : (governanceState.taskScope && governanceState.taskScope.protectedPaths) || DEFAULT_PROTECTED_FILE_GLOBS
    );
    protectedApprovalViolation = buildProtectedApprovalViolation(
      protectedGlobs,
      governanceState.protectedApprovals,
      affectedFiles,
    );
    if (!protectedApprovalViolation) return { matched: false, matchText, affectedFiles };
  }

  let branchGovernanceViolation = null;
  if (gate.requireBranchGovernance || gate.requireReleaseReadiness) {
    branchGovernanceViolation = buildBranchGovernanceViolation(
      governanceState,
      toolInput,
      affectedFiles,
      repoRoot,
      gate.requireReleaseReadiness === true,
    );
    if (!branchGovernanceViolation) return { matched: false, matchText, affectedFiles };
  }

  return {
    matched: true,
    matchText,
    affectedFiles,
    taskScopeViolation,
    protectedApprovalViolation,
    branchGovernanceViolation,
  };
}

function matchesGate(gate, toolName, toolInput) {
  return matchGate(gate, toolName, toolInput).matched;
}

function evaluateMemoryGuard(toolName, toolInput = {}) {
  const affected = extractAffectedFiles(toolName, toolInput);
  const affectedFiles = affected.files;
  if (!isHighRiskAction(toolName, toolInput, affectedFiles)) {
    return null;
  }
  const governanceState = loadGovernanceState();

  if (isScopeEnforcedAction(toolName, toolInput, affectedFiles)) {
    const scopeViolation = buildTaskScopeViolation(governanceState.taskScope, affectedFiles);
    if (!scopeViolation) {
      return null;
    }
  }

  const command = String(toolInput.command || '');
  if (toolName === 'Bash' && /\bgh\s+pr\s+create\b/i.test(command) && isConditionSatisfied('pr_create_allowed')) {
    const branchGovernanceViolation = buildBranchGovernanceViolation(
      governanceState,
      toolInput,
      affectedFiles,
      affected.repoRoot,
      /\b(?:npm|yarn|pnpm)\s+publish\b|\bgh\s+release\s+create\b|\bgit\s+tag\b/i.test(command),
    );
    if (!branchGovernanceViolation) {
      return null;
    }
  }

  if (toolName === 'Bash' && /\b(?:gh\s+pr\s+(?:create|merge)|gh\s+release\s+create|git\s+tag\b|(?:npm|yarn|pnpm)\s+publish\b)\b/i.test(command)) {
    const branchGovernanceViolation = buildBranchGovernanceViolation(
      governanceState,
      toolInput,
      affectedFiles,
      affected.repoRoot,
      /\b(?:npm|yarn|pnpm)\s+publish\b|\bgh\s+release\s+create\b|\bgit\s+tag\b/i.test(command),
    );
    if (!branchGovernanceViolation) {
      return null;
    }
  }

  const protectedGlobs = sanitizeGlobList(
    (governanceState.taskScope && governanceState.taskScope.protectedPaths) || DEFAULT_PROTECTED_FILE_GLOBS
  );
  if (affectedFiles.length > 0 && protectedGlobs.length > 0) {
    const protectedApprovalViolation = buildProtectedApprovalViolation(
      protectedGlobs,
      governanceState.protectedApprovals,
      affectedFiles,
    );
    if (!protectedApprovalViolation && affectedFiles.some((filePath) => matchesAnyGlob(filePath, protectedGlobs))) {
      return null;
    }
  }

  const hybrid = getHybridFeedbackModule();
  if (!hybrid || typeof hybrid.evaluatePretool !== 'function') {
    return null;
  }

  const serializedInput = JSON.stringify({
    toolName,
    command: toolInput.command || null,
    filePath: toolInput.file_path || toolInput.path || null,
    affectedFiles,
  });
  const guard = hybrid.evaluatePretool(toolName, serializedInput);
  if (!guard || guard.mode === 'allow') {
    return null;
  }

  const message = `Recurring negative memory matched a high-risk action. Denied by default until scope/approval is made explicit. ${guard.reason}`;
  return {
    decision: 'deny',
    gate: 'memory-high-risk-default-deny',
    message,
    severity: 'critical',
    reasoning: buildReasoning({
      id: 'memory-high-risk-default-deny',
      action: 'block',
      layer: 'Memory',
      severity: 'critical',
      message,
    }, toolName, toolInput, {
      matchText: toolInput.command || toolInput.file_path || toolInput.path || '',
      affectedFiles,
      memoryGuard: guard,
    }),
  };
}

function buildSentinelGateResult(report) {
  return {
    decision: report.decision,
    gate: 'workflow-sentinel',
    message: `${report.summary} ${report.blastRadius.summary}`,
    severity: report.decision === 'deny' ? 'critical' : 'high',
    reasoning: Array.isArray(report.reasoning) ? report.reasoning.slice() : [],
    sentinel: report,
  };
}

function recordSentinelDecision(report, toolName, toolInput) {
  if (!report) return null;
  const entry = recordDecisionEvaluation(report, {
    source: 'gates-engine',
    toolName,
    toolInput,
    changedFiles: report && report.blastRadius && Array.isArray(report.blastRadius.affectedFiles)
      ? report.blastRadius.affectedFiles
      : [],
  });
  report.actionId = entry.actionId;
  if (report.decisionControl && !report.decisionControl.actionId) {
    report.decisionControl.actionId = entry.actionId;
  }
  return entry;
}

function recordMemoryGuardDecision(sentinelDecision, enrichedMemoryGuard) {
  if (!sentinelDecision) return;
  recordDecisionOutcome({
    actionId: sentinelDecision.actionId,
    outcome: 'blocked',
    actualDecision: 'deny',
    actor: 'system',
    source: 'gates-engine',
    notes: enrichedMemoryGuard.message,
  });
}

function recordSentinelBlockDecision(sentinelDecision, sentinelResult) {
  if (!sentinelDecision) return;
  recordDecisionOutcome({
    actionId: sentinelDecision.actionId,
    outcome: sentinelResult.decision === 'deny' ? 'blocked' : 'warned',
    actualDecision: sentinelResult.decision,
    actor: 'system',
    source: 'workflow-sentinel',
    notes: sentinelResult.message,
  });
}

function enrichResultWithSentinel(result, report) {
  if (!result || !report || report.decision === 'allow') {
    return result;
  }

  const next = {
    ...result,
    reasoning: Array.isArray(result.reasoning) ? result.reasoning.slice() : [],
    sentinel: report,
  };

  if (report.blastRadius && report.blastRadius.summary) {
    next.message = `${result.message} Workflow sentinel: ${report.blastRadius.summary}`;
  }

  next.reasoning = next.reasoning.concat(
    Array.isArray(report.reasoning) ? report.reasoning : []
  );

  return next;
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
    let harnessPath;
    try {
      const { selectHarness } = require('./harness-selector');
      harnessPath = selectHarness(toolName, toolInput);
    } catch { /* harness-selector is optional */ }
    config = loadGatesConfig(configPath, harnessPath);
  } catch {
    return null;
  }

  const constraints = loadConstraints();

  // Fast-path: feedback/recall tools skip metric gates entirely (avoids Stripe API calls)
  const METRIC_SKIP_TOOLS = ['capture_feedback', 'feedback_stats', 'recall', 'feedback_summary', 'prevention_rules'];
  const skipMetrics = METRIC_SKIP_TOOLS.includes(toolName);

  for (const gate of config.gates) {
    const matchDetails = matchGate(gate, toolName, toolInput);
    if (!matchDetails.matched) continue;

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

    const message = buildGateMessage(gate, matchDetails);
    const reasoning = buildReasoning(gate, toolName, toolInput, {
      metricFailed,
      ...matchDetails,
    });

    if (gate.action === 'block') {
      recordStat(gate.id, 'block', gate);
      const result = { decision: 'deny', gate: gate.id, message, severity: gate.severity, reasoning };
      const auditRecord = recordAuditEvent({ toolName, toolInput, decision: 'deny', gateId: gate.id, message, severity: gate.severity, source: 'gates-engine' });
      auditToFeedback(auditRecord);
      return result;
    }

    if (gate.action === 'approve') {
      recordStat(gate.id, 'approve', gate);
      const result = { decision: 'approve', gate: gate.id, message, severity: gate.severity, reasoning, requiresApproval: true };
      const auditRecord = recordAuditEvent({ toolName, toolInput, decision: 'approve', gateId: gate.id, message, severity: gate.severity, source: 'gates-engine' });
      auditToFeedback(auditRecord);
      return result;
    }

    if (gate.action === 'log') {
      recordStat(gate.id, 'log', gate);
      const result = { decision: 'log', gate: gate.id, message, severity: gate.severity, reasoning, logged: true };
      const auditRecord = recordAuditEvent({ toolName, toolInput, decision: 'log', gateId: gate.id, message, severity: gate.severity, source: 'gates-engine' });
      auditToFeedback(auditRecord);
      // 'log' action allows the tool call to proceed — do not return early, continue to next gate
      continue;
    }

    if (gate.action === 'warn') {
      recordStat(gate.id, 'warn', gate);
      const result = { decision: 'warn', gate: gate.id, message, severity: gate.severity, reasoning };
      const auditRecord = recordAuditEvent({ toolName, toolInput, decision: 'warn', gateId: gate.id, message, severity: gate.severity, source: 'gates-engine' });
      auditToFeedback(auditRecord);
      return result;
    }
  }

  const sentinelReport = evaluateWorkflowSentinel(toolName, toolInput, {
    governanceState: loadGovernanceState(),
  });
  const sentinelDecision = recordSentinelDecision(sentinelReport, toolName, toolInput);
  const memoryGuard = evaluateMemoryGuard(toolName, toolInput);
  if (memoryGuard) {
    const enrichedMemoryGuard = enrichResultWithSentinel(memoryGuard, sentinelReport);
    recordStat(enrichedMemoryGuard.gate, 'block');
    recordMemoryGuardDecision(sentinelDecision, enrichedMemoryGuard);
    const auditRecord = recordAuditEvent({
      toolName,
      toolInput,
      decision: 'deny',
      gateId: enrichedMemoryGuard.gate,
      message: enrichedMemoryGuard.message,
      severity: enrichedMemoryGuard.severity,
      source: 'gates-engine',
    });
    auditToFeedback(auditRecord);
    return enrichedMemoryGuard;
  }

  if (sentinelReport && sentinelReport.decision !== 'allow') {
    const sentinelResult = buildSentinelGateResult(sentinelReport);
    recordStat(sentinelResult.gate, sentinelResult.decision === 'deny' ? 'block' : 'warn');
    recordSentinelBlockDecision(sentinelDecision, sentinelResult);
    const auditRecord = recordAuditEvent({
      toolName,
      toolInput,
      decision: sentinelResult.decision,
      gateId: sentinelResult.gate,
      message: sentinelResult.message,
      severity: sentinelResult.severity,
      source: 'workflow-sentinel',
    });
    auditToFeedback(auditRecord);
    return sentinelResult;
  }

  // Audit trail: record allow (no gate matched)
  recordAuditEvent({ toolName, toolInput, decision: 'allow', source: 'gates-engine' });
  return null;
}

function evaluateGates(toolName, toolInput, configPath) {
  let config;
  try {
    let harnessPath;
    try {
      const { selectHarness } = require('./harness-selector');
      harnessPath = selectHarness(toolName, toolInput);
    } catch { /* harness-selector is optional */ }
    config = loadGatesConfig(configPath, harnessPath);
  } catch {
    // If config can't be loaded, pass through
    return null;
  }

  const constraints = loadConstraints();

  for (const gate of config.gates) {
    const matchDetails = matchGate(gate, toolName, toolInput);
    if (!matchDetails.matched) continue;

    // EvoSkill Hardening: check contextual 'when' clause
    if (gate.when && !checkWhenClause(gate.when, constraints)) {
      continue;
    }

    // Check unless condition
    if (gate.unless && isConditionSatisfied(gate.unless)) {
      continue;
    }

    const message = buildGateMessage(gate, matchDetails);
    const reasoning = buildReasoning(gate, toolName, toolInput, matchDetails);

    if (gate.action === 'block') {
      recordStat(gate.id, 'block', gate);
      const result = { decision: 'deny', gate: gate.id, message, severity: gate.severity, reasoning };
      const auditRecord = recordAuditEvent({ toolName, toolInput, decision: 'deny', gateId: gate.id, message, severity: gate.severity, source: 'gates-engine' });
      auditToFeedback(auditRecord);
      return result;
    }

    if (gate.action === 'approve') {
      recordStat(gate.id, 'approve', gate);
      const result = { decision: 'approve', gate: gate.id, message, severity: gate.severity, reasoning, requiresApproval: true };
      const auditRecord = recordAuditEvent({ toolName, toolInput, decision: 'approve', gateId: gate.id, message, severity: gate.severity, source: 'gates-engine' });
      auditToFeedback(auditRecord);
      return result;
    }

    if (gate.action === 'log') {
      recordStat(gate.id, 'log', gate);
      const auditRecord = recordAuditEvent({ toolName, toolInput, decision: 'log', gateId: gate.id, message, severity: gate.severity, source: 'gates-engine' });
      auditToFeedback(auditRecord);
      // 'log' action allows the tool call to proceed — continue to next gate
      continue;
    }

    if (gate.action === 'warn') {
      recordStat(gate.id, 'warn', gate);
      const result = { decision: 'warn', gate: gate.id, message, severity: gate.severity, reasoning };
      const auditRecord = recordAuditEvent({ toolName, toolInput, decision: 'warn', gateId: gate.id, message, severity: gate.severity, source: 'gates-engine' });
      auditToFeedback(auditRecord);
      return result;
    }
  }

  const sentinelReport = evaluateWorkflowSentinel(toolName, toolInput, {
    governanceState: loadGovernanceState(),
  });
  const sentinelDecision = recordSentinelDecision(sentinelReport, toolName, toolInput);
  const memoryGuard = evaluateMemoryGuard(toolName, toolInput);
  if (memoryGuard) {
    const enrichedMemoryGuard = enrichResultWithSentinel(memoryGuard, sentinelReport);
    recordStat(enrichedMemoryGuard.gate, 'block');
    recordMemoryGuardDecision(sentinelDecision, enrichedMemoryGuard);
    const auditRecord = recordAuditEvent({
      toolName,
      toolInput,
      decision: 'deny',
      gateId: enrichedMemoryGuard.gate,
      message: enrichedMemoryGuard.message,
      severity: enrichedMemoryGuard.severity,
      source: 'gates-engine',
    });
    auditToFeedback(auditRecord);
    return enrichedMemoryGuard;
  }

  if (sentinelReport && sentinelReport.decision !== 'allow') {
    const sentinelResult = buildSentinelGateResult(sentinelReport);
    recordStat(sentinelResult.gate, sentinelResult.decision === 'deny' ? 'block' : 'warn');
    recordSentinelBlockDecision(sentinelDecision, sentinelResult);
    const auditRecord = recordAuditEvent({
      toolName,
      toolInput,
      decision: sentinelResult.decision,
      gateId: sentinelResult.gate,
      message: sentinelResult.message,
      severity: sentinelResult.severity,
      source: 'workflow-sentinel',
    });
    auditToFeedback(auditRecord);
    return sentinelResult;
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

  // Security vulnerability scan (Tier 1: pattern match, Tier 2: supply chain)
  const securityScan = evaluateSecurityScan(input);
  if (securityScan && securityScan.decision === 'deny') {
    return formatOutput(securityScan);
  }

  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};
  const result = await evaluateGatesAsync(toolName, toolInput);

  // Attach security warnings to allow/warn results
  if (securityScan && securityScan.decision === 'warn') {
    if (result) {
      result.securityWarnings = securityScan.securityScan.findings;
      result.reasoning = (result.reasoning || []).concat(securityScan.reasoning);
    } else {
      return formatOutput(securityScan);
    }
  }

  return formatOutput(result);
}

function run(input) {
  const secretGuard = evaluateSecretGuard(input);
  if (secretGuard) {
    return formatOutput(secretGuard);
  }

  // Security vulnerability scan (Tier 1: pattern match, Tier 2: supply chain)
  const securityScan = evaluateSecurityScan(input);
  if (securityScan && securityScan.decision === 'deny') {
    return formatOutput(securityScan);
  }

  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};
  const result = evaluateGates(toolName, toolInput);

  // Attach security warnings to allow/warn results
  if (securityScan && securityScan.decision === 'warn') {
    if (result) {
      result.securityWarnings = securityScan.securityScan.findings;
      result.reasoning = (result.reasoning || []).concat(securityScan.reasoning);
    } else {
      return formatOutput(securityScan);
    }
  }

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
  loadGovernanceState,
  saveGovernanceState,
  setTaskScope,
  setBranchGovernance,
  approveProtectedAction,
  getScopeState,
  getBranchGovernanceState,
  isConditionSatisfied,
  satisfyCondition,
  loadStats,
  saveStats,
  recordStat,
  evaluateSecretGuard,
  evaluateSecurityScan,
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
  GOVERNANCE_STATE_PATH,
  TTL_MS,
  SESSION_ACTION_TTL_MS,
  PROTECTED_APPROVAL_TTL_MS,
  DEFAULT_PROTECTED_FILE_GLOBS,
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
