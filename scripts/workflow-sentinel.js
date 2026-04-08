#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  DEFAULT_BASE_BRANCH,
  DEFAULT_RELEASE_SENSITIVE_GLOBS,
  classifyCommand,
  evaluateOperationalIntegrity,
  findReleaseSensitiveFiles,
  normalizePosix,
  resolveRepoRoot,
} = require('./operational-integrity');
const { buildDockerSandboxPlan } = require('./docker-sandbox-planner');
const { evaluatePretool } = require('./hybrid-feedback-context');

const GOVERNANCE_STATE_PATH = path.join(process.env.HOME || '/tmp', '.thumbgate', 'governance-state.json');
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
const HIGH_RISK_BASH_PATTERN = /\b(?:git\s+(?:add|commit|push)|gh\s+pr\s+(?:create|merge)|gh\s+release\s+create|npm\s+publish|yarn\s+publish|pnpm\s+publish|rm\s+-rf)\b/i;

const SURFACE_RULES = [
  { key: 'policy', pattern: /^(?:AGENTS\.md|CLAUDE(?:\.local)?\.md|GEMINI\.md|config\/gates\/|config\/mcp-allowlists\.json|scripts\/tool-registry\.js)/ },
  { key: 'release', pattern: /^(?:package\.json|package-lock\.json|server\.json|\.github\/workflows\/|scripts\/publish-decision\.js|scripts\/pr-manager\.js)/ },
  { key: 'runtime', pattern: /^(?:scripts\/|src\/api\/|adapters\/mcp\/)/ },
  { key: 'tests', pattern: /^(?:tests\/|proof\/)/ },
  { key: 'docs', pattern: /^(?:docs\/|README\.md|CHANGELOG\.md|WORKFLOW\.md)/ },
  { key: 'public', pattern: /^(?:public\/|\.well-known\/)/ },
];

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function loadGovernanceState() {
  const raw = loadJson(GOVERNANCE_STATE_PATH);
  return {
    taskScope: raw && raw.taskScope && typeof raw.taskScope === 'object' ? raw.taskScope : null,
    protectedApprovals: Array.isArray(raw && raw.protectedApprovals) ? raw.protectedApprovals : [],
    branchGovernance: raw && raw.branchGovernance && typeof raw.branchGovernance === 'object'
      ? raw.branchGovernance
      : null,
  };
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
  for (let i = 0; i < normalized.length; i += 1) {
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

function matchesAnyGlob(filePath, globs) {
  const normalized = sanitizeGlobList(globs);
  if (!filePath || normalized.length === 0) return false;
  return normalized.some((glob) => {
    try {
      return globToRegExp(glob).test(normalizePosix(filePath));
    } catch {
      return false;
    }
  });
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

function collectAffectedFiles(toolName, toolInput = {}, repoRoot) {
  const files = new Set(collectInlineAffectedFiles(toolInput, repoRoot));
  const command = String(toolInput.command || '');
  const hasExplicitAffectedFiles = files.size > 0;

  if (toolName === 'Bash' && repoRoot && command) {
    if (hasExplicitAffectedFiles) {
      return [...files].filter(Boolean);
    }

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

  return [...files].filter(Boolean);
}

function isHighRiskAction(toolName, toolInput = {}, affectedFiles = []) {
  if (EDIT_LIKE_TOOLS.has(toolName) && affectedFiles.length > 0) return true;
  if (toolName !== 'Bash') return false;
  return HIGH_RISK_BASH_PATTERN.test(String(toolInput.command || ''));
}

function isProtectedApprovalRelevant(toolName, toolInput = {}) {
  if (EDIT_LIKE_TOOLS.has(toolName)) return true;
  if (toolName !== 'Bash') return false;
  const commandInfo = classifyCommand(toolInput.command || '');
  return commandInfo.isPublish || commandInfo.isReleaseCreate || commandInfo.isTagCreate;
}

function normalizeMemoryGuardForSentinel(memoryGuard, isHighRisk) {
  if (!memoryGuard || memoryGuard.mode === 'allow') return memoryGuard;
  const reason = String(memoryGuard.reason || '');
  const broadToolOnlySignal = /^Tool "[^"]+" has \d+ attributed negative\(s\), \d+ total negative\(s\)$/i.test(reason);
  if (!isHighRisk && broadToolOnlySignal) {
    return {
      ...memoryGuard,
      mode: 'warn',
      reason: `${reason}. Treating this as advisory because the current action is not in the high-risk command set.`,
    };
  }
  return memoryGuard;
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

function buildProtectedSurface(governanceState, affectedFiles) {
  const protectedGlobs = sanitizeGlobList(
    governanceState && governanceState.taskScope && Array.isArray(governanceState.taskScope.protectedPaths)
      ? governanceState.taskScope.protectedPaths
      : DEFAULT_PROTECTED_FILE_GLOBS
  );
  const protectedFiles = affectedFiles.filter((filePath) => matchesAnyGlob(filePath, protectedGlobs));
  const approvals = Array.isArray(governanceState && governanceState.protectedApprovals)
    ? governanceState.protectedApprovals
    : [];
  const unapprovedProtectedFiles = protectedFiles.filter((filePath) => {
    return !approvals.some((entry) => matchesAnyGlob(filePath, entry.pathGlobs || []));
  });
  return {
    protectedGlobs,
    protectedFiles,
    unapprovedProtectedFiles,
  };
}

function classifySurface(filePath) {
  const normalized = normalizePosix(filePath);
  for (const rule of SURFACE_RULES) {
    if (rule.pattern.test(normalized)) return rule.key;
  }
  return 'product';
}

function summarizeSurfaces(affectedFiles) {
  const buckets = new Map();
  for (const filePath of affectedFiles) {
    const key = classifySurface(filePath);
    if (!buckets.has(key)) {
      buckets.set(key, { key, fileCount: 0, files: [] });
    }
    const bucket = buckets.get(key);
    bucket.fileCount += 1;
    bucket.files.push(filePath);
  }
  return [...buckets.values()].sort((left, right) => {
    return right.fileCount - left.fileCount || left.key.localeCompare(right.key);
  });
}

function formatFileList(files, limit = 5) {
  const items = Array.isArray(files) ? files.filter(Boolean) : [];
  if (items.length === 0) return 'none';
  if (items.length <= limit) return items.join(', ');
  return `${items.slice(0, limit).join(', ')} (+${items.length - limit} more)`;
}

function severityFromScore(score) {
  if (score >= 0.8) return 'critical';
  if (score >= 0.55) return 'high';
  if (score >= 0.3) return 'medium';
  return 'low';
}

function buildBlastRadius({ affectedFiles, integrity, protectedSurface }) {
  const surfaces = summarizeSurfaces(affectedFiles);
  const surfaceCount = surfaces.length;
  const releaseSensitiveFiles = findReleaseSensitiveFiles(
    affectedFiles,
    integrity && Array.isArray(integrity.releaseSensitiveFiles) && integrity.releaseSensitiveFiles.length > 0
      ? integrity.releaseSensitiveFiles
      : DEFAULT_RELEASE_SENSITIVE_GLOBS
  );
  const severityScore = Math.min(1, (
    (affectedFiles.length >= 4 ? 0.22 : affectedFiles.length > 0 ? 0.12 : 0) +
    (affectedFiles.length >= 12 ? 0.18 : 0) +
    (surfaceCount >= 3 ? 0.18 : surfaceCount === 2 ? 0.1 : 0) +
    (releaseSensitiveFiles.length > 0 ? 0.22 : 0) +
    (protectedSurface.unapprovedProtectedFiles.length > 0 ? 0.22 : protectedSurface.protectedFiles.length > 0 ? 0.12 : 0)
  ));
  const severity = severityFromScore(severityScore);
  const summaryParts = [];
  if (affectedFiles.length > 0) {
    summaryParts.push(`${affectedFiles.length} files across ${surfaceCount || 1} surface${surfaceCount === 1 ? '' : 's'}`);
  } else {
    summaryParts.push('No explicit file blast radius detected');
  }
  if (releaseSensitiveFiles.length > 0) {
    summaryParts.push(`${releaseSensitiveFiles.length} release-sensitive`);
  }
  if (protectedSurface.unapprovedProtectedFiles.length > 0) {
    summaryParts.push(`${protectedSurface.unapprovedProtectedFiles.length} protected without approval`);
  }

  return {
    severity,
    severityScore: Number(severityScore.toFixed(4)),
    fileCount: affectedFiles.length,
    surfaceCount,
    affectedFiles,
    surfaces,
    protectedFiles: protectedSurface.protectedFiles,
    unapprovedProtectedFiles: protectedSurface.unapprovedProtectedFiles,
    releaseSensitiveFiles,
    summary: summaryParts.join(' · '),
  };
}

function addDriver(drivers, key, weight, reason, metadata = {}) {
  if (!weight || weight <= 0) return;
  drivers.push({
    key,
    weight: Number(weight.toFixed(4)),
    reason,
    metadata,
  });
}

function scoreRisk({
  toolName,
  toolInput,
  affectedFiles,
  integrity,
  memoryGuard,
  blastRadius,
  taskScopeViolation,
  protectedSurface,
}) {
  const drivers = [];
  const commandInfo = classifyCommand(toolInput.command || '');

  if (isHighRiskAction(toolName, toolInput, affectedFiles)) {
    addDriver(drivers, 'high_risk_action', 0.18, 'Command or edit pattern is classified as high risk.');
  }
  if (commandInfo.isPrCreate || commandInfo.isPrMerge || commandInfo.isPublish || commandInfo.isReleaseCreate || commandInfo.isTagCreate) {
    addDriver(drivers, 'governed_command', 0.16, 'Action touches PR, release, or publish workflow state.');
  }
  if (/\bgit\s+push\b.*(?:--force|-f)\b/i.test(commandInfo.text)) {
    addDriver(drivers, 'force_push', 0.5, 'Force push predicts destructive branch history rewrite.');
  }
  if (/\bgh\s+pr\s+merge\b.*--admin\b/i.test(commandInfo.text)) {
    addDriver(drivers, 'admin_merge_bypass', 0.45, 'Admin merge bypass skips the protected merge path.');
  }
  if (/\brm\s+-rf\b/i.test(commandInfo.text)) {
    addDriver(drivers, 'destructive_delete', 0.28, 'Recursive delete is destructive and difficult to recover from.');
  }
  if (taskScopeViolation) {
    addDriver(
      drivers,
      taskScopeViolation.reasonCode,
      taskScopeViolation.reasonCode === 'missing_task_scope' ? 0.14 : 0.18,
      taskScopeViolation.reasonCode === 'missing_task_scope'
        ? 'No explicit task scope is declared for the affected files.'
        : 'Action extends beyond the declared task scope.',
      { outsideFiles: taskScopeViolation.outsideFiles }
    );
  }
  if (protectedSurface.unapprovedProtectedFiles.length > 0) {
    addDriver(drivers, 'protected_without_approval', 0.22, 'Protected files are affected without an active approval.', {
      files: protectedSurface.unapprovedProtectedFiles,
    });
  }
  if (blastRadius.releaseSensitiveFiles.length > 0) {
    addDriver(drivers, 'release_sensitive', 0.2, 'Release-sensitive files are in the predicted blast radius.', {
      files: blastRadius.releaseSensitiveFiles,
    });
  }
  if (blastRadius.releaseSensitiveFiles.length > 0 && blastRadius.surfaceCount >= 3) {
    addDriver(
      drivers,
      'release_sensitive_multi_surface',
      0.08,
      'Release-sensitive changes span multiple workflow surfaces.'
    );
  }
  if (blastRadius.fileCount >= 4) {
    addDriver(
      drivers,
      'multi_file_change',
      blastRadius.fileCount >= 12 ? 0.18 : 0.1,
      `Change spans ${blastRadius.fileCount} files.`
    );
  }
  if (blastRadius.surfaceCount >= 2) {
    addDriver(
      drivers,
      'multi_surface_change',
      blastRadius.surfaceCount >= 4 ? 0.18 : 0.1,
      `Change spans ${blastRadius.surfaceCount} distinct workflow surfaces.`
    );
  }
  if (integrity && Array.isArray(integrity.blockers) && integrity.blockers.length > 0) {
    addDriver(
      drivers,
      'operational_blockers',
      Math.min(0.4, 0.18 + ((integrity.blockers.length - 1) * 0.08)),
      `Operational integrity surfaced ${integrity.blockers.length} blocker${integrity.blockers.length === 1 ? '' : 's'}.`,
      { blockers: integrity.blockers.map((blocker) => blocker.code) }
    );
  }
  if (memoryGuard && memoryGuard.mode && memoryGuard.mode !== 'allow') {
    addDriver(
      drivers,
      'memory_recurrence',
      memoryGuard.mode === 'block' ? 0.28 : 0.16,
      'Past failures predict recurrence for this tool/input combination.',
      { mode: memoryGuard.mode }
    );
  }

  const score = Math.min(1, drivers.reduce((sum, driver) => sum + driver.weight, 0));
  return {
    score: Number(score.toFixed(4)),
    band: severityFromScore(score) === 'critical'
      ? 'very_high'
      : severityFromScore(score) === 'high'
        ? 'high'
        : severityFromScore(score) === 'medium'
          ? 'medium'
          : score > 0
            ? 'low'
            : 'very_low',
    drivers: drivers.sort((left, right) => right.weight - left.weight || left.key.localeCompare(right.key)),
  };
}

function buildEvidence({
  integrity,
  memoryGuard,
  blastRadius,
  taskScopeViolation,
  protectedSurface,
}) {
  const evidence = [];
  if (memoryGuard && memoryGuard.mode && memoryGuard.mode !== 'allow') {
    evidence.push(`Memory guard predicted ${memoryGuard.mode}: ${memoryGuard.reason}`);
  }
  if (taskScopeViolation) {
    evidence.push(
      taskScopeViolation.reasonCode === 'missing_task_scope'
        ? 'No task scope is declared for the affected files.'
        : `Files outside task scope: ${formatFileList(taskScopeViolation.outsideFiles)}.`
    );
  }
  if (protectedSurface.unapprovedProtectedFiles.length > 0) {
    evidence.push(`Protected files without approval: ${formatFileList(protectedSurface.unapprovedProtectedFiles)}.`);
  }
  if (blastRadius.releaseSensitiveFiles.length > 0) {
    evidence.push(`Release-sensitive files in blast radius: ${formatFileList(blastRadius.releaseSensitiveFiles)}.`);
  }
  if (integrity && Array.isArray(integrity.blockers)) {
    for (const blocker of integrity.blockers.slice(0, 3)) {
      evidence.push(`Operational blocker ${blocker.code}: ${blocker.message}`);
    }
  }
  if (blastRadius.fileCount > 0) {
    evidence.push(`Blast radius summary: ${blastRadius.summary}.`);
  }
  return evidence;
}

function buildRemediations({
  integrity,
  taskScopeViolation,
  protectedSurface,
  blastRadius,
  memoryGuard,
  executionSurface,
}) {
  const remediations = [];
  const seen = new Set();

  function push(id, title, action, why) {
    if (seen.has(id)) return;
    seen.add(id);
    remediations.push({ id, title, action, why });
  }

  if (taskScopeViolation) {
    push(
      'declare_task_scope',
      'Declare task scope',
      'Call set_task_scope with allowedPaths covering only the intended files before retrying.',
      'High-risk changes should stay inside an explicit file boundary.'
    );
  }
  if (protectedSurface.unapprovedProtectedFiles.length > 0) {
    push(
      'approve_protected_files',
      'Get protected-file approval',
      `Call approve_protected_action for ${formatFileList(protectedSurface.unapprovedProtectedFiles)} before editing or publishing.`,
      'Protected policy files need an explicit time-bounded approval.'
    );
  }
  if (integrity && Array.isArray(integrity.blockers)) {
    const blockerCodes = new Set(integrity.blockers.map((blocker) => blocker.code));
    if (blockerCodes.has('missing_branch_governance')) {
      push(
        'set_branch_governance',
        'Declare branch governance',
        'Call set_branch_governance with branchName, baseBranch, and PR/release expectations.',
        'Release, merge, and PR workflows need explicit branch state.'
      );
    }
    if (blockerCodes.has('merge_requires_pr_context')) {
      push(
        'attach_pr_context',
        'Attach PR context',
        'Update branch governance with prNumber or prUrl before merging.',
        'Merge actions should be tied to one explicit review surface.'
      );
    }
    if (blockerCodes.has('missing_release_version') || blockerCodes.has('release_version_mismatch')) {
      push(
        'align_release_version',
        'Align release version',
        'Set branch governance releaseVersion and verify it matches package.json before publish.',
        'Release metadata should match the artifact being published.'
      );
    }
    if (blockerCodes.has('publish_requires_base_branch') || blockerCodes.has('publish_requires_mainline_head')) {
      push(
        'switch_to_mainline',
        'Run publish from mainline',
        `Move the action onto ${integrity.baseBranch || DEFAULT_BASE_BRANCH} after the merge commit exists.`,
        'Publish and tag flows should execute from the protected mainline branch.'
      );
    }
  }
  if (memoryGuard && memoryGuard.mode && memoryGuard.mode !== 'allow') {
    push(
      'retrieve_lessons',
      'Inspect prior lessons',
      'Call retrieve_lessons or search_lessons for this tool context before retrying.',
      'The system already has evidence that this action pattern failed before.'
    );
  }
  if (blastRadius.fileCount >= 4 || blastRadius.surfaceCount >= 3) {
    push(
      'split_blast_radius',
      'Split the change',
      'Reduce the affected files or surfaces into smaller sequential steps before executing.',
      'Smaller blast radii are easier to verify and recover.'
    );
  }
  if (executionSurface && executionSurface.shouldSandbox) {
    push(
      'route_to_docker_sandbox',
      'Route through Docker Sandboxes',
      `Launch the repo in Docker Sandboxes before retrying. Standalone: ${executionSurface.launchers.standalone}. Docker Desktop: ${executionSurface.launchers.dockerDesktop}.`,
      'Isolated execution limits host damage when a high-risk local action goes wrong.'
    );
  }

  return remediations;
}

function buildReasoning(report) {
  const lines = [
    `Workflow sentinel risk ${report.band} (${report.riskScore}) for ${report.toolName}.`,
    `Blast radius: ${report.blastRadius.summary}.`,
  ];
  if (report.executionSurface && report.executionSurface.shouldSandbox) {
    lines.push(`Execution surface: ${report.executionSurface.summary}`);
  }
  for (const driver of report.drivers.slice(0, 4)) {
    lines.push(`Driver ${driver.key} (+${driver.weight}): ${driver.reason}`);
  }
  for (const remediation of report.remediations.slice(0, 3)) {
    lines.push(`Remediation: ${remediation.title} — ${remediation.action}`);
  }
  return lines;
}

function chooseDecision({ riskScore, integrity, memoryGuard, blastRadius, command }) {
  const hasOperationalBlockers = Boolean(integrity && Array.isArray(integrity.blockers) && integrity.blockers.length > 0);
  const destructiveBypass = /\bgit\s+push\b.*(?:--force|-f)\b/i.test(command) || /\bgh\s+pr\s+merge\b.*--admin\b/i.test(command);
  const lowBlastRadius = blastRadius.fileCount <= 1
    && blastRadius.surfaceCount <= 1
    && blastRadius.releaseSensitiveFiles.length === 0
    && blastRadius.unapprovedProtectedFiles === 0;
  const lowRiskHandoff = /\bgit\s+push\b|\bgh\s+pr\s+(?:create|merge)\b/i.test(command)
    && !destructiveBypass
    && lowBlastRadius
    && !hasOperationalBlockers
    && memoryGuard
    && memoryGuard.mode !== 'allow'
    && riskScore <= 0.62;
  const repeatedHighBlast = Boolean(
    memoryGuard
      && memoryGuard.mode === 'block'
      && (
        blastRadius.severity === 'high'
        || blastRadius.severity === 'critical'
        || blastRadius.releaseSensitiveFiles.length > 0
        || blastRadius.unapprovedProtectedFiles > 0
      )
  );

  if (lowRiskHandoff) {
    return 'allow';
  }
  if (destructiveBypass || repeatedHighBlast || (hasOperationalBlockers && riskScore >= 0.72) || riskScore >= 0.86) {
    return 'deny';
  }
  if (riskScore >= 0.45) {
    return 'warn';
  }
  return 'allow';
}

function evaluateWorkflowSentinel(toolName, toolInput = {}, options = {}) {
  const governanceState = options.governanceState || loadGovernanceState();
  const repoPath = options.repoPath || toolInput.repoPath || toolInput.cwd || process.cwd();
  const repoRoot = resolveRepoRoot(repoPath) || null;
  const affectedFiles = Array.isArray(options.affectedFiles)
    ? options.affectedFiles.map((filePath) => normalizePosix(filePath)).filter(Boolean)
    : collectAffectedFiles(toolName, toolInput, repoRoot);
  const highRiskAction = isHighRiskAction(toolName, toolInput, affectedFiles);
  const baseBranch = options.baseBranch
    || (governanceState.branchGovernance && governanceState.branchGovernance.baseBranch)
    || toolInput.baseBranch
    || DEFAULT_BASE_BRANCH;
  const integrity = evaluateOperationalIntegrity({
    repoPath,
    baseBranch,
    command: toolInput.command,
    changedFiles: affectedFiles,
    requirePrForReleaseSensitive: options.requirePrForReleaseSensitive === true,
    requireVersionNotBehindBase: options.requireVersionNotBehindBase === true,
    branchGovernance: governanceState.branchGovernance,
  });
  const taskScopeViolation = buildTaskScopeViolation(governanceState.taskScope, affectedFiles);
  const protectedSurface = buildProtectedSurface(governanceState, affectedFiles);
  const protectedSurfaceForRisk = isProtectedApprovalRelevant(toolName, toolInput)
    ? protectedSurface
    : {
      ...protectedSurface,
      protectedFiles: [],
      unapprovedProtectedFiles: [],
    };
  const rawMemoryGuard = options.memoryGuard || evaluatePretool(toolName, JSON.stringify({
    toolName,
    command: toolInput.command || null,
    filePath: toolInput.file_path || toolInput.filePath || toolInput.path || null,
    affectedFiles,
  }), options.feedbackOptions || {});
  const memoryGuard = normalizeMemoryGuardForSentinel(rawMemoryGuard, highRiskAction);
  const blastRadius = buildBlastRadius({
    affectedFiles,
    integrity,
    protectedSurface: protectedSurfaceForRisk,
  });
  const risk = scoreRisk({
    toolName,
    toolInput,
    affectedFiles,
    integrity,
    memoryGuard,
    blastRadius,
    taskScopeViolation,
    protectedSurface: protectedSurfaceForRisk,
  });
  const executionSurface = buildDockerSandboxPlan({
    toolName,
    actionType: toolName === 'Bash'
      ? 'shell.exec'
      : EDIT_LIKE_TOOLS.has(toolName)
        ? 'file.write'
        : '',
    command: toolInput.command,
    repoPath,
    affectedFiles,
    riskBand: risk.band,
    riskScore: risk.score,
    requiresNetwork: Boolean(
      /\b(?:curl|wget|gh\s+pr|git\s+push|npm\s+publish|yarn\s+publish|pnpm\s+publish)\b/i.test(toolInput.command || '')
    ),
  });
  const decision = chooseDecision({
    riskScore: risk.score,
    integrity,
    memoryGuard,
    blastRadius: {
      ...blastRadius,
      unapprovedProtectedFiles: protectedSurfaceForRisk.unapprovedProtectedFiles.length,
    },
    command: toolInput.command || '',
  });
  const evidence = buildEvidence({
    integrity,
    memoryGuard,
    blastRadius,
    taskScopeViolation,
    protectedSurface: protectedSurfaceForRisk,
  });
  const remediations = buildRemediations({
    integrity,
    taskScopeViolation,
    protectedSurface: protectedSurfaceForRisk,
    blastRadius,
    memoryGuard,
    executionSurface,
  });
  const summary = decision === 'allow'
    ? 'No predictive workflow blockers detected.'
    : decision === 'warn'
      ? 'Predicted workflow risk is elevated before execution.'
      : 'Predicted workflow failure before execution.';
  const report = {
    sentinelVersion: 'workflow-sentinel-v1',
    toolName,
    decision,
    riskScore: risk.score,
    band: risk.band,
    summary,
    drivers: risk.drivers,
    blastRadius,
    evidence,
    remediations,
    executionSurface,
    memoryGuard,
    taskScopeViolation,
    operationalIntegrity: {
      ok: integrity.ok,
      currentBranch: integrity.currentBranch,
      baseBranch: integrity.baseBranch,
      blockers: integrity.blockers,
      releaseSensitiveFiles: integrity.releaseSensitiveFiles,
      openPr: integrity.openPr,
      commandInfo: integrity.commandInfo,
    },
  };
  report.reasoning = buildReasoning(report);
  return report;
}

module.exports = {
  DEFAULT_PROTECTED_FILE_GLOBS,
  buildBlastRadius,
  buildEvidence,
  buildProtectedSurface,
  buildReasoning,
  buildRemediations,
  buildTaskScopeViolation,
  classifySurface,
  collectAffectedFiles,
  evaluateWorkflowSentinel,
  isHighRiskAction,
  loadGovernanceState,
  scoreRisk,
};

if (require.main === module) {
  const report = evaluateWorkflowSentinel(process.argv[2] || 'Bash', {
    command: process.argv.slice(3).join(' '),
  });
  console.log(JSON.stringify(report, null, 2));
}
