#!/usr/bin/env node
'use strict';

/**
 * Isolated Verifier — the single secondary component that improves single-agent
 * reliability, per Anthropic (Oct 2026) and the MAST taxonomy (UC Berkeley, 2026).
 *
 *   "In the single-agent workflow, one agent writes both the feature and the
 *    tests because it already has the context, while a separate verifier only
 *    runs the tests and reports results." — The Decoder, 2026-10-25
 *
 * The Verifier is NOT an agent. It is a deterministic, isolated process that:
 *   1. Runs Level 1 (mechanical) checks: unit tests, coverage, perf budgets,
 *      self-heal, proof-pack integrity.
 *   2. Runs Level 2 (semantic) checks: goal alignment, edge-case coverage,
 *      regression check, design compliance — evaluating output against the
 *      ORIGINAL high-level objective, not just "did tests pass".
 *   3. Uses independent criteria from config/verifier-criteria.json that the
 *      primary agent NEVER sees during task execution.
 *   4. Reports results. It does NOT write code, does NOT modify files, does NOT
 *      make decisions about what to change. It only runs and reports.
 *
 * Usage:
 *   node scripts/isolated-verifier.js --goal "<original objective>" [--plan full|quick] [--json]
 *
 * The --goal text is the high-level objective the primary agent was tasked with.
 * The Verifier reads it independently and checks whether the actual repo state
 * achieves it.
 *
 * Exit codes:
 *   0 — all mustPass criteria satisfied
 *   1 — one or more mustPass checks failed
 *   2 — configuration or runtime error (fail closed)
 *
 * Integration:
 *   - Records a `verifier_passed` session action on success.
 *   - require-proof.js checks for this action before allowing completion claims.
 *   - pr-manager.js requires verifier_passed before trunk merge submission.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const crypto = require('node:crypto');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CRITERIA_PATH = path.join(PROJECT_ROOT, 'config', 'verifier-criteria.json');

// ---------------------------------------------------------------------------
// Configuration loading
// ---------------------------------------------------------------------------

function loadCriteria() {
  try {
    return JSON.parse(fs.readFileSync(CRITERIA_PATH, 'utf8'));
  } catch (error) {
    throw new Error(`Isolated Verifier: cannot load criteria from ${CRITERIA_PATH}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Isolation helpers
// ---------------------------------------------------------------------------

function createIsolatedTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-verifier-'));
  return dir;
}

// Risk classification stolen from Poolside's Auto-Mode pattern:
// "executing low-risk reads immediately, flagging medium-risk actions, and
// only popping an approval gate for destructive shell or subshell commands."
const RISK_PATTERNS = {
  destructive: [/^rm\s+-rf/, /^git\s+reset\s+--hard/, /^git\s+push\s+--force/, /^rm\s+-rf/, /^shutdown/, /^killall/],
  write: [/npm\s+test/, /npm\s+run/, /node\s+scripts/, /npx\s+thumbgate/],
  gitMining: [/^git\s+log/, /^git\s+show/, /^git\s+reflog/, /^git\s+blame/],
};

function classifyRisk(command, writesFlag) {
  const cmdStr = command.join(' ');

  // Poolside §4 guardrail: block git history mining
  // "RL-trained coding agents will instinctively run git log --all --grep
  //  to copy-paste historical fixes rather than solving the underlying bug."
  // This is ALWAYS blocked, regardless of the writes flag — it is a
  // reward-hacking prevention pattern.
  for (const pattern of RISK_PATTERNS.gitMining) {
    if (pattern.test(cmdStr)) {
      return { level: 'blocked', reason: 'Git history mining blocked by risk classification' };
    }
  }

  for (const pattern of RISK_PATTERNS.destructive) {
    if (pattern.test(cmdStr)) {
      return { level: 'denied', reason: 'Destructive command blocked by risk classification' };
    }
  }

  // If criteria explicitly marks this as non-writing, treat as read
  if (writesFlag === false) {
    return { level: 'read', reason: 'Criteria marks this as non-writing — no approval needed' };
  }

  for (const pattern of RISK_PATTERNS.write) {
    if (pattern.test(cmdStr)) {
      return { level: 'write', reason: 'Write-prone command requires approval' };
    }
  }

  // If criteria explicitly marks as writing (writes: true), treat as write
  // even if no pattern matched — the operator flagged it as potentially mutating.
  if (writesFlag === true) {
    return { level: 'write', reason: 'Criteria marks this as write-prone — approval required' };
  }

  return { level: 'read', reason: 'Read-only command — no approval needed' };
}

function runCommand(command, options = {}) {
  const [cmd, ...args] = command;
  const startedAt = Date.now();

  // Poolside Auto-Mode Risk Classification: classify each command by risk level.
  // Low-risk (reads): execute immediately.
  // Medium-risk (writes): require approveWrites callback.
  // High-risk (destructive/git-mining): always denied, fail closed.
  // The criteria JSON's `writes` flag overrides: if explicitly false,
  // the command is treated as read-only regardless of pattern match.
  const risk = classifyRisk(command, options.writes);

  if (risk.level === 'blocked') {
    return {
      command: command.join(' '),
      status: 'denied',
      durationMs: 0,
      stdout: '',
      stderr: risk.reason,
      timedOut: false,
      passed: false,
      riskLevel: 'blocked',
    };
  }

  if (risk.level === 'denied') {
    return {
      command: command.join(' '),
      status: 'denied',
      durationMs: 0,
      stdout: '',
      stderr: risk.reason,
      timedOut: false,
      passed: false,
      riskLevel: 'denied',
    };
  }

  // Write gate: fail closed if no approval callback for write-prone commands.
  // Steal from Anthropic's single-agent-loop-kit: "a missing gate must not mean
  // every write runs." Commands that modify the filesystem require explicit
  // approval via the approveWrites callback.
  if (risk.level === 'write' && !options.approveWrites) {
    return {
      command: command.join(' '),
      status: 'denied',
      durationMs: 0,
      stdout: '',
      stderr: 'Write gate denied: no approveWrites callback provided for write-prone command',
      timedOut: false,
      passed: false,
      riskLevel: 'write',
    };
  }

  if (risk.level === 'write' && options.approveWrites) {
    const approved = options.approveWrites(cmd, args);
    if (!approved) {
      return {
        command: command.join(' '),
        status: 'denied',
        durationMs: 0,
        stdout: '',
        stderr: 'Write gate: action declined by approval callback',
        timedOut: false,
        passed: false,
        riskLevel: 'write',
      };
    }
  }

  const result = spawnSync(cmd, args, {
    cwd: options.cwd || PROJECT_ROOT,
    env: {
      ...process.env,
      // Isolate proof artifacts into a temp dir so the Verifier never
      // touches the primary agent's proof/ cache.
      THUMBGATE_PROOF_DIR: options.isolateProofDir
        ? path.join(options.tempDir, 'proof-isolated')
        : process.env.THUMBGATE_PROOF_DIR,
      THUMBGATE_AUTOMATION_PROOF_DIR: path.join(options.tempDir, 'proof-automation'),
      THUMBGATE_HARNESSES_PROOF_DIR: path.join(options.tempDir, 'proof-harnesses'),
      THUMBGATE_RUNTIME_PROOF_DIR: path.join(options.tempDir, 'proof-runtime'),
      THUMBGATE_SETTINGS_PROOF_DIR: path.join(options.tempDir, 'proof-settings'),
    },
    encoding: 'utf-8',
    timeout: options.timeoutMs || 300000,
    maxBuffer: options.maxBuffer || 64 * 1024 * 1024,
    shell: false,
  });

  const durationMs = Date.now() - startedAt;
  return {
    command: command.join(' '),
    status: result.status,
    durationMs,
    stdout: (result.stdout || '').slice(0, 8000),
    stderr: (result.stderr || '').slice(0, 4000),
    timedOut: result.signal === 'SIGTERM' || result.signal === 'SIGKILL',
    passed: result.status === 0,
    riskLevel: risk.level,
  };
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function safeGit(args, cwd = PROJECT_ROOT) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf-8',
    timeout: 10000,
    shell: false,
  });
  return result.status === 0 ? result.stdout || '' : '';
}

function getChangedFiles() {
  return safeGit(['diff', '--name-only', '--diff-filter=ACM']).trim().split('\n').filter(Boolean);
}

function getStagedFiles() {
  return safeGit(['diff', '--cached', '--name-only', '--diff-filter=ACM']).trim().split('\n').filter(Boolean);
}

function getAllChangedFiles() {
  return safeGit(['diff', '--name-only', 'HEAD']).trim().split('\n').filter(Boolean);
}

function getGitDiff() {
  return safeGit(['diff', 'HEAD', '--', 'src/', 'scripts/', 'hooks/', 'config/', 'plugins/', 'adapters/']);
}

function getGitDiffStats() {
  const numstatOutput = safeGit(['diff', 'HEAD', '--numstat', '--', 'src/', 'scripts/', 'hooks/', 'config/', 'plugins/', 'adapters/']);
  const statLines = numstatOutput.trim().split('\n').filter(Boolean);
  let additions = 0;
  let deletions = 0;
  for (const line of statLines) {
    const parts = line.split(/[ \t]+/);
    if (parts.length >= 2) {
      const a = parseInt(parts[0], 10);
      const d = parseInt(parts[1], 10);
      if (!Number.isNaN(a)) additions += a;
      if (!Number.isNaN(d)) deletions += d;
    }
  }
  return { additions, deletions, files: getAllChangedFiles() };
}

// ---------------------------------------------------------------------------
// Level 1: Mechanical checks (deterministic)
// ---------------------------------------------------------------------------

/**
 * Evaluate whether a conditional check should run based on changed files.
 * Condition format: "changed-files.match('path1|path2|path3')"
 * Falls back to running the check if no condition or unparseable.
 */
function shouldRunConditionalCheck(check, changedFiles) {
  if (!check.condition) return true;
  const match = check.condition.match(/\.match\('([^']+)'/);
  if (!match) return true; // unparseable condition — run by default (fail safe)
  const paths = match[1].split('|');
  return changedFiles.some((file) => paths.some((p) => file.includes(p.trim())));
}

function runMechanicalChecks(criteria, tempDir, plan = 'full', opts = {}) {
  const level = criteria.levels.mechanical;
  const results = [];
  const changedFiles = opts.changedFiles || getAllChangedFiles();
  const runner = opts.runner || runCommand;
  const approveWrites = opts.approveWrites;

  // Budget tracking — steal from Anthropic's single-agent-loop-kit:
  // max_commands caps total check invocations; max_wall_time_ms caps total runtime.
  const budget = criteria.budget || { maxCommands: 10, maxWallTimeMs: 600000 };
  let commandsRun = 0;
  const wallStart = Date.now();

  // In quick plan, only run the essential checks (tests + proof-pack integrity).
  // In full plan, run everything.
  const checksToRun = plan === 'quick'
    ? level.checks.filter((c) => c.id === 'unit_tests' || c.id === 'proof_pack_integrity')
    : level.checks;

  for (const check of checksToRun) {
    // Budget: stop if we've exceeded the command cap or wall-clock budget.
    if (commandsRun >= (budget.maxCommands || 10)) {
      results.push({
        id: check.id,
        status: 'skipped',
        reason: 'Budget cap (maxCommands) exceeded',
        passed: false,
        mustPass: check.mustPass,
        durationMs: 0,
      });
      continue;
    }
    if (Date.now() - wallStart > (budget.maxWallTimeMs || 600000)) {
      results.push({
        id: check.id,
        status: 'skipped',
        reason: 'Budget cap (maxWallTimeMs) exceeded',
        passed: false,
        mustPass: check.mustPass,
        durationMs: 0,
      });
      continue;
    }

    // Evaluate conditional checks — skip if condition doesn't match
    if (!shouldRunConditionalCheck(check, changedFiles)) {
      results.push({
        id: check.id,
        status: 'skipped',
        reason: 'No changed files matching condition',
        passed: true,
        mustPass: check.mustPass,
        durationMs: 0,
      });
      continue;
    }

    // In quick plan, use a lighter test command for unit_tests (the verifier's own tests)
    const command = plan === 'quick' && check.id === 'unit_tests'
      ? ['node', '--test', 'tests/isolated-verifier.test.js']
      : check.command;

    commandsRun++;

    const commandResult = runner(command, {
      cwd: PROJECT_ROOT,
      timeoutMs: check.timeoutMs || 300000,
      tempDir,
      isolateProofDir: criteria.isolation?.isolateProofDir !== false,
      writes: check.writes || false,
      approveWrites,
    });

    results.push({
      id: check.id,
      status: commandResult.status === 'denied' ? 'denied' : (commandResult.passed ? 'pass' : 'fail'),
      passed: commandResult.passed,
      mustPass: check.mustPass,
      durationMs: commandResult.durationMs,
      command: commandResult.command,
      stdout: commandResult.stdout,
      stderr: commandResult.stderr,
      timedOut: commandResult.timedOut,
    });
  }

  // mabl-style budget envelope: track consumption within the maxCommands /
  // maxWallTimeMs envelope (Mastercard "authorize once, transact many times").
  results.budget = {
    maxCommands: budget.maxCommands,
    maxWallTimeMs: budget.maxWallTimeMs,
    commandsRun,
    wallTimeMs: Date.now() - wallStart,
    commandsRemaining: Math.max(0, (budget.maxCommands || 10) - commandsRun),
    timeRemainingMs: Math.max(0, (budget.maxWallTimeMs || 600000) - (Date.now() - wallStart)),
  };

  return results;
}

// ---------------------------------------------------------------------------
// Level 2: Semantic checks (high-level objective alignment)
// ---------------------------------------------------------------------------

function evaluateGoalAlignment(goal, changedFiles, gitDiff) {
  if (!goal || goal.trim().length === 0) {
    return { id: 'goal_alignment', score: 0, passed: false, detail: 'No goal provided for verification' };
  }

  const normalizedGoal = goal.toLowerCase().replace(/[-_]+/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const goalTokens = normalizedGoal.split(' ').filter((t) => t.length > 3);

  if (goalTokens.length === 0) {
    return { id: 'goal_alignment', score: 0, passed: false, detail: 'Goal contains no meaningful tokens' };
  }

  // If no files changed and no diff, goal alignment is trivially satisfied
  if (!changedFiles || changedFiles.length === 0) {
    return {
      id: 'goal_alignment',
      score: 1.0,
      passed: true,
      threshold: 0.8,
      detail: 'No changed files to evaluate — goal alignment trivially satisfied',
      evidence: {
        relevanceRatio: 1.0,
        coverageRatio: 1.0,
        goalTokens,
        goalTokenMatches: 0,
        relevantFiles: 0,
        totalFiles: 0,
        unrelatedFiles: [],
      },
    };
  }

  // Check that changed files relate to the goal.
  // mabl/Delos steal: verify against the goal, not just filename keyword overlap.
  // A file is relevant if its filename OR its diff content contains goal tokens.
  // Files are split from the git diff by hunk headers to associate diff content.
  const fileDiffMap = {};
  if (gitDiff) {
    const fileBlocks = gitDiff.split(/^diff --git /m).filter(Boolean);
    for (const block of fileBlocks) {
      const fileMatch = block.match(/^[^\n]*\n(?:---\s+\S+\n\+\+\+\s+\S+)/);
      if (fileMatch) {
        const filePath = block.split('\n')[0].replace('diff --git ', '').split(' ')[0];
        fileDiffMap[filePath] = block || '';
      }
    }
  }

  const relevantFiles = changedFiles.filter((file) => {
    if (file.endsWith('.test.js') || file.includes('/tests/')) return true; // tests always relevant
    const fileLower = file.toLowerCase();
    if (goalTokens.some((token) => fileLower.includes(token))) return true;
    // Also check diff content for this file
    const fileDiff = Object.keys(fileDiffMap).find((f) => f.includes(file) || file.includes(f));
    if (fileDiff && fileDiffMap[fileDiff]) {
      const diffContent = fileDiffMap[fileDiff].toLowerCase();
      return goalTokens.some((token) => diffContent.includes(token));
    }
    return false;
  });

  const unrelatedFiles = changedFiles.filter((file) => !relevantFiles.includes(file));
  const relevanceRatio = changedFiles.length > 0 ? relevantFiles.length / changedFiles.length : 1.0;

  // Check that the git diff contains content related to the goal
  const diffTokens = gitDiff.toLowerCase().match(/\w+/g) || [];
  const goalTokenMatches = goalTokens.filter((token) =>
    diffTokens.some((diffToken) => diffToken === token || diffToken.includes(token))
  );
  const coverageRatio = goalTokens.length > 0 ? goalTokenMatches.length / goalTokens.length : 0;

  // Score: weighted average of relevance ratio and coverage ratio.
  // Delos steal: resist complexity — if diff content covers the goal tokens
  // (>0.5 coverageRatio), unrelated files are acceptable up to 50% of changes.
  const score = Math.round((relevanceRatio * 0.4 + coverageRatio * 0.6) * 100) / 100;

  const threshold = 0.8;
  const maxUnrelatedRatio = coverageRatio >= 0.5 ? 0.5 : 0.3;
  const passed = score >= threshold && unrelatedFiles.length <= changedFiles.length * maxUnrelatedRatio;

  return {
    id: 'goal_alignment',
    score,
    passed,
    threshold,
    detail: `Goal tokens in diff: ${goalTokenMatches.length}/${goalTokens.length}, relevant files: ${relevantFiles.length}/${changedFiles.length}`,
    evidence: {
      relevanceRatio,
      coverageRatio,
      goalTokens,
      goalTokenMatches: goalTokenMatches.length,
      relevantFiles: relevantFiles.length,
      totalFiles: changedFiles.length,
      unrelatedFiles: unrelatedFiles.slice(0, 10),
    },
  };
}

function evaluateEdgeCaseCoverage(changedFiles, gitDiff, opts = {}) {
  const baseDir = opts.baseDir || PROJECT_ROOT;
  const testFiles = changedFiles.filter((f) => f.includes('/tests/') || f.endsWith('.test.js'));

  if (testFiles.length === 0) {
    return {
      id: 'edge_case_coverage',
      score: 0,
      passed: false,
      threshold: 0.7,
      detail: 'No test files changed; edge case coverage cannot be verified',
    };
  }

  // Look for edge-case keywords in test files
  const testContent = testFiles
    .map((f) => {
      const fullPath = path.join(baseDir, f);
      try {
        return fs.readFileSync(fullPath, 'utf8');
      } catch {
        return '';
      }
    })
    .join('\n');

  const edgeCasePatterns = [
    /boundary/i,
    /edge.?case/i,
    /empty/i,
    /null|undefined/i,
    /invalid/i,
    /error/i,
    /throw/i,
    /reject/i,
    /timeout/i,
    /concurrent/i,
    /race/i,
    /large/i,
  ];

  const matchedPatterns = edgeCasePatterns.filter((p) => testContent.match(p));
  const coverageRatio = matchedPatterns.length / edgeCasePatterns.length;

  // Also check that test files have descriptive names indicating coverage intent
  const descriptiveTests = testFiles.filter((f) => {
    const basename = path.basename(f);
    return basename.includes('test') || basename.includes('spec');
  });
  const nameCoverage = descriptiveTests.length / testFiles.length;

  const score = Math.round((coverageRatio * 0.7 + nameCoverage * 0.3) * 100) / 100;
  const threshold = 0.7;
  const passed = score >= threshold;

  return {
    id: 'edge_case_coverage',
    score,
    passed,
    threshold,
    detail: `Edge-case patterns matched: ${matchedPatterns.length}/${edgeCasePatterns.length}, test files: ${testFiles.length}`,
    evidence: {
      matchedPatterns: matchedPatterns.map((p) => p.toString()),
      testFileCount: testFiles.length,
      coverageRatio,
      nameCoverage,
    },
  };
}

function evaluateRegressionCheck(changedFiles, gitDiff) {
  // Check for patterns that commonly cause regressions:
  // - Changed production code without corresponding test changes
  // - Removed tests
  // - Modified public API signatures

  const testFiles = changedFiles.filter((f) => f.includes('/tests/') || f.endsWith('.test.js'));
  const sourceFiles = changedFiles.filter((f) => !f.includes('/tests/') && !f.endsWith('.test.js'));

  const issues = [];

  // Check if source files were changed without test files
  if (sourceFiles.length > 0 && testFiles.length === 0) {
    issues.push('Source files changed without corresponding test changes');
  }

  // Check for removed lines — a high volume of deletions may indicate
  // accidental deletions of important code.
  const removedLines = gitDiff.split('\n').filter((line) => line.startsWith('-') && line.length > 1);

  if (removedLines.length > sourceFiles.length * 5) {
    issues.push(`High volume of removed lines (${removedLines.length}) — check for accidental deletions`);
  }

  // Check diff doesn't contain common anti-patterns
  const antiPatterns = [
    { pattern: /console\.(log|debug|error)\(/g, message: 'console statements in production code' },
    { pattern: /TODO|FIXME|HACK|XXX/g, message: 'TODO/FIXME markers' },
    { pattern: /debugger/g, message: 'debugger statements' },
  ];

  for (const { pattern, message } of antiPatterns) {
    if (gitDiff.match(pattern)) {
      issues.push(`Found ${message} in diff`);
    }
  }

  // Check for var declarations and eval() — regression-prone patterns
  if (gitDiff.includes('var ')) {
    issues.push('Uses var declarations — codebase uses const/let');
  }
  if (gitDiff.includes('eval(')) {
    issues.push('Uses eval() — prohibited by security policy');
  }

  const score = issues.length === 0 ? 1.0 : Math.max(0, 1.0 - issues.length * 0.3);
  const passed = score >= 1.0;

  return {
    id: 'regression_check',
    score,
    passed,
    threshold: 1.0,
    detail: `Changed files: ${sourceFiles.length} source, ${testFiles.length} tests; issues: ${issues.length}`,
    evidence: {
      issues,
      sourceFiles: sourceFiles.length,
      testFiles: testFiles.length,
    },
  };
}

function evaluateDesignCompliance(changedFiles, gitDiff) {
  // Check if changed files follow existing codebase patterns
  const sourceFiles = changedFiles.filter(
    (f) => (f.endsWith('.js') || f.endsWith('.ts')) && !f.includes('/tests/') && !f.endsWith('.test.js')
  );

  if (sourceFiles.length === 0) {
    return {
      id: 'design_compliance',
      score: 1.0,
      passed: true,
      threshold: 0.8,
      detail: 'No source files to check',
    };
  }

  const issues = [];
  const conventions = [];

  // Check for consistent require patterns
  const usesRequire = gitDiff.includes('require(');
  const usesImport = gitDiff.includes('import ');
  if (usesImport && usesRequire) {
    issues.push('Mixed CommonJS and ESM import styles');
  }

  // Check for consistent quote style
  const doubleQuoteCount = (gitDiff.match(/"/g) || []).length;
  const singleQuoteCount = (gitDiff.match(/'/g) || []).length;
  if (doubleQuoteCount > singleQuoteCount * 2) {
    conventions.push('Double quotes detected — existing codebase uses single quotes per AGENTS.md operational standards');
  }

  // Check for consistent indentation (2 spaces per AGENTS.md). Diff added lines
  // start with '+', so we look for tabs after the '+' prefix.
  const tabLines = gitDiff
    .split('\n')
    .filter((line) => line.startsWith('+\t') && !line.startsWith('+\t\t'));
  if (tabLines.length > 0) {
    conventions.push(`Tab indentation detected in ${tabLines.length} lines — AGENTS.md mandates 2-space indentation`);
  }

  // Check for JSDoc on new functions
  const functionDefs = gitDiff.match(/function\s+\w+|const\s+\w+\s*=\s*(?:async\s*)?\(.*?\)\s*=>/g) || [];
  const addedLines = gitDiff.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++')).length;
  const jsdocBlocks = gitDiff.match(/\/\*\*/g) || [];
  if (functionDefs.length > 0 && jsdocBlocks.length < functionDefs.length * 0.3 && addedLines > 50) {
    conventions.push('New functions lack JSDoc documentation');
  }

  const weight = issues.length * 0.3 + conventions.length * 0.1;
  const score = Math.max(0, 1.0 - weight);
  const passed = score >= 0.8;

  return {
    id: 'design_compliance',
    score,
    passed,
    threshold: 0.8,
    detail: `Source files: ${sourceFiles.length}, issues: ${issues.length}, convention notes: ${conventions.length}`,
    evidence: {
      issues,
      conventions,
      sourceFileCount: sourceFiles.length,
    },
  };
}

function runSemanticChecks(criteria, goal, tempDir, opts = {}) {
  const level = criteria.levels.semantic;
  const changedFiles = opts.changedFiles || getAllChangedFiles();
  const gitDiff = opts.gitDiff || getGitDiff();
  const results = [];

  const rubric = criteria.semanticRubric;
  const weights = level.checks.reduce((acc, c) => {
    acc[c.id] = c.weight || 0;
    return acc;
  }, {});

  const alignmentCheck = evaluateGoalAlignment(goal, changedFiles, gitDiff);
  results.push({ ...alignmentCheck, rubric: rubric?.goal_alignment, weight: weights.goal_alignment });

  const edgeCheck = evaluateEdgeCaseCoverage(changedFiles, gitDiff, { baseDir: opts.baseDir });
  results.push({ ...edgeCheck, rubric: rubric?.edge_case_coverage, weight: weights.edge_case_coverage });

  const regressionCheck = evaluateRegressionCheck(changedFiles, gitDiff);
  results.push({ ...regressionCheck, rubric: rubric?.regression_check, weight: weights.regression_check });

  const designCheck = evaluateDesignCompliance(changedFiles, gitDiff);
  results.push({ ...designCheck, rubric: rubric?.design_compliance, weight: weights.design_compliance });

  return results;
}

// ---------------------------------------------------------------------------
// Session action recording
// ---------------------------------------------------------------------------

function getSessionActionsPath() {
  // Same resolution as gates-engine.js
  if (process.env.THUMBGATE_STATE_DIR) return path.join(process.env.THUMBGATE_STATE_DIR, 'session-actions.json');
  const home = process.env.HOME || os.homedir();
  return path.join(home, '.thumbgate', 'session-actions.json');
}

function recordSessionAction(actionId, metadata = {}) {
  try {
    const actionsPath = getSessionActionsPath();
    fs.mkdirSync(path.dirname(actionsPath), { recursive: true });
    let actions = {};
    if (fs.existsSync(actionsPath)) {
      try {
        actions = JSON.parse(fs.readFileSync(actionsPath, 'utf8'));
      } catch {
        actions = {};
      }
    }
    actions[actionId] = {
      ...metadata,
      timestamp: Date.now(),
    };
    fs.writeFileSync(actionsPath, JSON.stringify(actions, null, 2));
  } catch (error) {
    // Non-fatal: the Verifier should still report results even if
    // session-action recording fails.
    console.warn(`Isolated Verifier: could not record session action: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Blast Radius Assessment (Muller/Trevillion "blast radius control" steal)
// ---------------------------------------------------------------------------

/**
 * Assesses the operational scope of changes before checks run.
 * Maps changed files to risk tiers: local, shared, production-critical.
 * Surfaces blast radius so a human can decide whether to escalate.
 */
function assessBlastRadius(changedFiles, stats) {
  const riskTiers = {
    production_critical: [
      'src/api/server.js',
      'hooks/hooks.json',
      'src/latency-budget.js',
      'config/main-branch-ruleset.json',
      'config/performance-budgets.json',
      'src/gates-engine.js',
      'src/hybrid-feedback-context.js',
      'src/feedback-loop.js',
    ],
    shared: [
      'scripts/',
      'src/',
      'hooks/',
      'plugins/',
      'adapters/',
      'config/',
      'docs/',
    ],
    local: [
      'tests/',
      '.claude/',
      'proof/',
      '*.md',
    ],
  };

  const categorized = { production_critical: 0, shared: 0, local: 0, other: 0 };
  let maxRisk = 'local';

  for (const file of changedFiles) {
    let classified = false;
    for (const critical of riskTiers.production_critical) {
      if (file === critical || file.startsWith(critical)) {
        categorized.production_critical++;
        classified = true;
        break;
      }
    }
    if (classified) {
      maxRisk = 'production_critical';
      continue;
    }
    for (const shared of riskTiers.shared) {
      if (file.startsWith(shared)) {
        categorized.shared++;
        classified = true;
        if (maxRisk === 'local') maxRisk = 'shared';
        break;
      }
    }
    if (classified) continue;
    for (const local of riskTiers.local) {
      if (file.startsWith(local) || file.endsWith(local.replace(/^\*\./, '.').replace(/\//g, ''))) {
        categorized.local++;
        classified = true;
        break;
      }
    }
    if (!classified) categorized.other++;
  }

  const totalLines = Math.abs(stats.additions) + Math.abs(stats.deletions);
  const riskScore =
    categorized.production_critical * 10 +
    categorized.shared * 3 +
    categorized.local * 1 +
    categorized.other * 2;

  let escalationRequired = false;
  let escalationReason = null;
  if (maxRisk === 'production_critical') {
    escalationRequired = true;
    escalationReason = 'Production-critical files modified — human review required';
  } else if (riskScore > 50) {
    escalationRequired = true;
    escalationReason = `High blast radius (${riskScore} risk points across ${changedFiles.length} files)`;
  }

  return {
    maxRisk,
    riskScore,
    fileCount: changedFiles.length,
    changedLines: totalLines,
    categorized,
    escalationRequired,
    escalationReason,
  };
}

/**
 * Sima/Rajan steal: "monitor for agent drift."
 * Wraps checkCanaryDrift in a try/catch so the verifier never crashes
 * if canaries aren't deployed. Returns a safe status object.
 */
function checkCanaryDriftSafe() {
  try {
    const canaryModule = require('./audit-privileges.js');
    return canaryModule.checkCanaryDrift();
  } catch {
    return { status: 'unavailable', message: 'Canary drift check not available' };
  }
}

// ---------------------------------------------------------------------------
// Main verification flow
// ---------------------------------------------------------------------------

async function runVerification(options = {}) {
  const { goal, plan = 'full', json = false, approveWrites } = options;
  const criteria = loadCriteria();
  const tempDir = createIsolatedTempDir();
  const changedFiles = getAllChangedFiles();
  const gitDiff = getGitDiff();
  const stats = getGitDiffStats();

  // Delos steal: "clear hand-off contracts" — propagate a trace ID from the
  // primary agent so the verifier's signed receipt links back to the originating
  // session. This is the "end-to-end tracing" prescription.
  const traceId = options.traceId || process.env.THUMBGATE_TRACE_ID || null;

  const reportId = `verify_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  const report = {
    reportId,
    verifier: 'isolated-verifier',
    criteriaVersion: criteria.version,
    timestamp: new Date().toISOString(),
    goal,
    plan,
    isolation: {
      tempDir,
      isolateProofDir: criteria.isolation?.isolateProofDir !== false,
    },
    input: {
      changedFiles,
      changedFileCount: changedFiles.length,
      gitDiffStats: {
        additions: stats.additions,
        deletions: stats.deletions,
        files: changedFiles,
      },
    },
    // Muller/Trevillion blast-radius assessment: quantify the operational
    // scope of changes before checks run. "Keep a human in the loop for
    // rogue actions" — assess blast radius and surface it in the report.
    blastRadius: assessBlastRadius(changedFiles, stats),
    // Sima/Rajan steal: "deploy deception for crowd control" + "monitor for agent drift".
    // Canary tokens in the proof dir detect when an agent bypasses governance gates
    // or accesses unauthorized files — a sign of drift or compromise.
    canary: checkCanaryDriftSafe(),
    levels: {
      mechanical: {},
      semantic: {},
    },
  };

  // Level 1: Mechanical checks
  const mechanicalResults = runMechanicalChecks(criteria, tempDir, plan, { changedFiles, approveWrites });
  report.levels.mechanical = {
    checks: mechanicalResults,
    passed: mechanicalResults.every((r) => r.passed),
    mustPassViolations: mechanicalResults.filter((r) => r.mustPass && !r.passed).map((r) => r.id),
    budget: mechanicalResults.budget,
  };

  // Level 2: Semantic checks
  // DeepInfer steal: "confidence-scheduled verification" — if mechanical checks
  // pass with high quality score, skip non-critical semantic checks. This is
  // the verifier's equivalent of DSpark's confidence-scheduled verification
  // that accelerates decoding by skipping verification steps when confidence
  // is sufficient. Only run goal_alignment (the cheapest, most critical
  // semantic check) to verify objective alignment; skip the rest.
  const asyncConfig = criteria.asyncExecution;
  const confidenceThreshold = asyncConfig?.confidenceThreshold || 0.9;
  const mechanicalQuality = report.levels.mechanical.passed
    ? (mechanicalResults.filter((r) => r.passed).length / mechanicalResults.length)
    : 0;

  let semanticResults;
  let fastTrack = false;
  if (goal && mechanicalQuality >= confidenceThreshold && asyncConfig?.enabled !== false) {
    // High confidence — fast-track: run only goal_alignment (the cheapest,
    // most critical semantic check) and mark the rest as skipped.
    // DeepInfer steal: confidence-scheduled verification skips low-value checks.
    fastTrack = true;
    const semanticCheckIds = criteria.levels.semantic.checks.map((c) => c.id);
    const semanticWeights = criteria.levels.semantic.checks.reduce((acc, c) => {
      acc[c.id] = c.weight || 0;
      return acc;
    }, {});

    semanticResults = semanticCheckIds.map((checkId) => {
      if (checkId === 'goal_alignment') {
        const check = evaluateGoalAlignment(goal, changedFiles, gitDiff);
        // DeepInfer steal: fast-track sets weight + criteria metadata.
        // mustPass not set on semantic results to match runSemanticChecks behavior.
        return { ...check, weight: semanticWeights[checkId], fastTrack: true };
      }
      // Skip non-critical checks under confidence scheduling
      return {
        id: checkId,
        status: 'skipped',
        reason: 'Confidence-scheduled: mechanical quality met threshold',
        passed: true,
        weight: semanticWeights[checkId],
        durationMs: 0,
        score: 1.0,
        fastTrack: true,
      };
    });
  } else {
    semanticResults = runSemanticChecks(criteria, goal, tempDir, { changedFiles, gitDiff });
  }

  report.levels.semantic = {
    checks: semanticResults,
    passed: semanticResults.every((r) => r.passed),
    mustPassViolations: semanticResults.filter((r) => r.mustPass && !r.passed).map((r) => r.id),
    weightedScore: Math.round(
      semanticResults.reduce((sum, r) => sum + (r.score || 0) * (r.weight || 0), 0) * 100
    ) / 100,
  };

  // Annotate fast-track in the report
  if (fastTrack) {
    report.confidenceScheduled = {
      fastTrack: true,
      mechanicalQuality,
      confidenceThreshold,
      skippedChecks: ['edge_case_coverage', 'regression_check', 'design_compliance'],
      reason: 'Mechanical checks passed with sufficient confidence — semantic analysis fast-tracked',
    };
  }

  // Overall verdict
  const allMustPass = [
    ...report.levels.mechanical.checks.filter((c) => c.mustPass),
    ...report.levels.semantic.checks.filter((c) => c.mustPass),
  ];
  const failedMustPass = allMustPass.filter((c) => !c.passed);

  // mabl-style quality score: composite gate health
  // Each must-pass check contributes equally; skipped checks reduce the score.
  const totalMustPass = allMustPass.length;
  const passedMustPass = allMustPass.filter((c) => c.passed && c.status !== 'skipped').length;
  const skippedMustPass = allMustPass.filter((c) => c.status === 'skipped').length;
  const qualityScore = totalMustPass > 0 ? Math.round((passedMustPass / totalMustPass) * 100) : 100;

  report.overall = {
    verdict: failedMustPass.length === 0 ? 'PASS' : 'FAIL',
    failedMustPassCount: failedMustPass.length,
    failedMustPassChecks: failedMustPass.map((c) => c.id),
    mechanicalPassed: report.levels.mechanical.passed,
    semanticPassed: report.levels.semantic.passed,
    qualityScore,
    skippedChecks: skippedMustPass,
    totalChecks: totalMustPass,
  };

  // Stanford §5.1 + §7.4 steals: actual budget consumption vs. declared, plus latency profiling.
  // "Declared budget is not actual compute. You have to measure what was actually spent."
  const budget = report.levels.mechanical.budget || {};
  const totalDuration = mechanicalResults.reduce((sum, r) => sum + (r.durationMs || 0), 0);
  const slowestRun = mechanicalResults
    .filter((r) => r.status !== 'skipped')
    .reduce((max, r) => (r.durationMs > (max?.durationMs || 0) ? r : max), null);
  report.budgetMetrics = {
    declared: {
      maxCommands: budget.maxCommands,
      maxWallTimeMs: budget.maxWallTimeMs,
    },
    actual: {
      commandsRun: budget.commandsRun,
      wallTimeMs: budget.wallTimeMs,
      commandUtilization: budget.maxCommands > 0
        ? Math.round((budget.commandsRun / budget.maxCommands) * 100)
        : 0,
      timeUtilization: budget.maxWallTimeMs > 0
        ? Math.round((budget.wallTimeMs / budget.maxWallTimeMs) * 100)
        : 0,
    },
  };
  report.latencyProfile = {
    totalMechanicalMs: totalDuration,
    slowestCheck: slowestRun ? slowestRun.id : null,
    slowestCheckMs: slowestRun ? slowestRun.durationMs : 0,
  };
  // Mastercard-style signed gate receipt: deterministic proof that this
  // verification ran independently with immutable evidence of inputs + outcome.
  const receiptPayload = {
    reportId,
    timestamp: report.timestamp,
    goal: (goal || '').slice(0, 200),
    changedFiles,
    verdict: report.overall.verdict,
    qualityScore,
    criteriaVersion: criteria.version,
    traceId,
  };
  const receiptHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(receiptPayload))
    .digest('hex');
  report.receipt = {
    hash: receiptHash,
    payload: receiptPayload,
    algorithm: 'sha256-iso8601',
  };

  // Record session action on success
  if (report.overall.verdict === 'PASS') {
    recordSessionAction('verifier_passed', {
      reportId,
      goal: goal?.slice(0, 200),
      changedFiles,
      mechanicalChecks: mechanicalResults.length,
      semanticChecks: semanticResults.length,
    });
  }

  // Clean up temp dir
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Non-fatal
  }

  return report;
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = { plan: 'full' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--goal') {
      options.goal = argv[++i];
    } else if (arg.startsWith('--goal=')) {
      options.goal = arg.slice('--goal='.length);
    } else if (arg === '--plan') {
      options.plan = argv[++i];
    } else if (arg.startsWith('--plan=')) {
      options.plan = arg.slice('--plan='.length);
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--approve-writes') {
      options.approveWrites = () => true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Isolated Verifier — independent verification of agent output.

Usage:
  node scripts/isolated-verifier.js --goal "<objective>" [--plan full|quick] [--json] [--approve-writes]

The Verifier runs Level 1 (mechanical) and Level 2 (semantic) checks in an
isolated process and reports results. It does NOT modify code or make
decisions — it only runs and reports.

  --approve-writes    Auto-approve write-prone commands (npm test, npm run, etc.).
                      Without this flag, write commands are denied (fail-closed).

Exit codes: 0 = PASS, 1 = FAIL, 2 = config/runtime error
`);
      process.exit(0);
    }
  }
  return options;
}

async function main() {
  const options = parseArgs();
  if (!options.goal) {
    console.error('Isolated Verifier: --goal is required.');
    console.error('Usage: node scripts/isolated-verifier.js --goal "<objective>" [--plan full|quick] [--json]');
    process.exit(2);
  }

  try {
    const report = await runVerification(options);

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`\n┌─ Isolated Verifier ───────────────────────────────────────────┐`);
      console.log(`│ Report:  ${report.reportId}`);
      console.log(`│ Goal:    ${report.goal.slice(0, 60)}${report.goal.length > 60 ? '...' : ''}`);
      console.log(`│ Plan:    ${report.plan}`);
      console.log(`│ Changed: ${report.input.changedFileCount} files (+${report.input.gitDiffStats.additions}/-${report.input.gitDiffStats.deletions})`);
      console.log(`├─────────────────────────────────────────────────────────────────┤`);

      console.log(`│ Level 1 (Mechanical):`);
      for (const check of report.levels.mechanical.checks) {
        const status = check.status === 'pass' ? '✓ PASS' : check.status === 'skipped' ? '⊘ SKIP' : '✗ FAIL';
        console.log(`│   ${status.padEnd(10)} ${check.id} (${check.durationMs}ms)`);
      }
      console.log(`│   ${report.levels.mechanical.passed ? 'ALL PASS' : 'FAILURES'}                                   │`);
      const budget = report.levels.mechanical.budget || {};
      console.log(`│   Budget: ${budget.commandsRun}/${budget.maxCommands} cmds, ${Math.round((budget.wallTimeMs||0)/1000)}s/${Math.round((budget.maxWallTimeMs||0)/1000)}s wall`);
      console.log(`├─────────────────────────────────────────────────────────────────┤`);

      console.log(`│ Level 2 (Semantic):`);
      for (const check of report.levels.semantic.checks) {
        const status = check.passed ? '✓ PASS' : '✗ FAIL';
        const scoreStr = check.score !== undefined ? `${Math.round(check.score * 100)}%` : 'N/A';
        console.log(`│   ${status.padEnd(10)} ${check.id} (score: ${scoreStr})`);
        if (!check.passed) {
          console.log(`│              → ${check.detail}`);
        }
      }
      console.log(`│   Weighted: ${report.levels.semantic.weightedScore}                      │`);
      console.log(`├─────────────────────────────────────────────────────────────────┤`);

      if (report.overall.verdict === 'PASS') {
        console.log(`│ ✅ VERDICT: PASS — Isolated Verifier approves`);
        console.log(`│    Session action 'verifier_passed' recorded.`);
        console.log(`│    Quality Score: ${report.overall.qualityScore}/100 (${report.overall.totalChecks - report.overall.skippedChecks}/${report.overall.totalChecks} checks ran)`);
      } else {
        console.log(`│ ❌ VERDICT: FAIL — Isolated Verifier rejects`);
        console.log(`│    Failed must-pass checks: ${report.overall.failedMustPassChecks.join(', ')}`);
        console.log(`│    Address these before claiming completion.`);
      }
      console.log(`└─────────────────────────────────────────────────────────────────┘\n`);
    }

    process.exitCode = report.overall.verdict === 'PASS' ? 0 : 1;
  } catch (error) {
    if (options.json) {
      console.error(JSON.stringify({ error: true, message: error.message, verifier: 'isolated-verifier' }));
    } else {
      console.error(`Isolated Verifier: FATAL — ${error.message}`);
    }
    process.exit(2);
  }

  // Clean exit
  if (process.stdout.bufferSize === 0) {
    process.stdout.write('');
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Isolated Verifier: unexpected error — ${error.message}`);
    process.exit(2);
  });
}

module.exports = {
  loadCriteria,
  runCommand,
  getChangedFiles,
  getStagedFiles,
  getAllChangedFiles,
  getGitDiff,
  getGitDiffStats,
  runMechanicalChecks,
  runSemanticChecks,
  evaluateGoalAlignment,
  evaluateEdgeCaseCoverage,
  evaluateRegressionCheck,
  evaluateDesignCompliance,
  classifyRisk,
  assessBlastRadius,
  shouldRunConditionalCheck,
  recordSessionAction,
  runVerification,
  parseArgs,
  CRITERIA_PATH,
  PROJECT_ROOT,
};
