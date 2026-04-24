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
const { getInterventionRecommendation } = require('./intervention-policy');
const {
  buildCostControl,
  normalizeProviderAction,
} = require('./provider-action-normalizer');

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
const HIGH_RISK_BASH_PATTERN = /\b(?:git\s+(?:add|commit|push)|gh\s+(?:pr\s+(?:create|merge)|workflow\s+run|release\s+create)|npm\s+publish|yarn\s+publish|pnpm\s+publish|rm\s+-rf)\b/i;

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
  learnedPolicy,
  blastRadius,
  taskScopeViolation,
  protectedSurface,
  costControl,
}) {
  const drivers = [];
  const commandInfo = classifyCommand(toolInput.command || '');

  if (isHighRiskAction(toolName, toolInput, affectedFiles)) {
    addDriver(drivers, 'high_risk_action', 0.18, 'Command or edit pattern is classified as high risk.');
  }
  if (commandInfo.isPrCreate
    || commandInfo.isPrMerge
    || commandInfo.isWorkflowRun
    || commandInfo.isPublish
    || commandInfo.isReleaseCreate
    || commandInfo.isTagCreate) {
    addDriver(drivers, 'governed_command', 0.16, 'Action touches PR, workflow dispatch, release, or publish workflow state.');
  }
  if (commandInfo.isWorkflowRun) {
    addDriver(
      drivers,
      'workflow_dispatch',
      0.2,
      'GitHub Actions workflow dispatch can trigger environment-specific builds or releases.',
      {
        workflowName: commandInfo.workflowName,
        workflowRef: commandInfo.workflowRef,
      }
    );
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
  if (costControl && costControl.mode && costControl.mode !== 'allow') {
    addDriver(
      drivers,
      'cost_control',
      costControl.mode === 'block' ? 0.5 : 0.18,
      costControl.mode === 'block'
        ? 'Estimated model usage exceeds the configured per-action budget.'
        : 'Estimated model usage is high enough to require review.',
      { mode: costControl.mode, reasons: costControl.reasons }
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
  if (learnedPolicy && learnedPolicy.enabled && learnedPolicy.prediction) {
    const confidence = learnedPolicy.prediction.confidence || 0;
    const label = learnedPolicy.prediction.label;
    if (label === 'deny' && confidence >= 0.6) {
      addDriver(
        drivers,
        'learned_policy_deny',
        Math.min(0.26, 0.16 + (confidence * 0.12)),
        'Learned intervention policy predicts a deny-worthy failure pattern.',
        { confidence, label }
      );
    } else if (label === 'warn' && confidence >= 0.3) {
      addDriver(
        drivers,
        'learned_policy_warn',
        Math.min(0.18, 0.1 + (confidence * 0.08)),
        'Learned intervention policy predicts elevated execution risk.',
        { confidence, label }
      );
    } else if (label === 'verify' && confidence >= 0.3) {
      addDriver(
        drivers,
        'learned_policy_verify',
        Math.min(0.16, 0.08 + (confidence * 0.06)),
        'Learned intervention policy predicts a verification gap before close-out.',
        { confidence, label }
      );
    } else if (label === 'recall' && confidence >= 0.3) {
      addDriver(
        drivers,
        'learned_policy_recall',
        Math.min(0.14, 0.06 + (confidence * 0.05)),
        'Learned intervention policy predicts prior lessons are needed before execution.',
        { confidence, label }
      );
    }
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
  learnedPolicy,
  blastRadius,
  taskScopeViolation,
  protectedSurface,
  normalizedAction,
  costControl,
}) {
  const evidence = [];
  if (normalizedAction && normalizedAction.provider !== 'unknown') {
    evidence.push(
      `Provider action normalized from ${normalizedAction.provider}: ${normalizedAction.actionType} / ${normalizedAction.intent}.`
    );
  }
  if (costControl && costControl.mode && costControl.mode !== 'allow') {
    evidence.push(`Cost control ${costControl.mode}: ${costControl.reasons.join(' ')}`);
  }
  if (memoryGuard && memoryGuard.mode && memoryGuard.mode !== 'allow') {
    evidence.push(`Memory guard predicted ${memoryGuard.mode}: ${memoryGuard.reason}`);
  }
  if (learnedPolicy && learnedPolicy.enabled && learnedPolicy.prediction) {
    const topTokens = Array.isArray(learnedPolicy.topTokens)
      ? learnedPolicy.topTokens.map((entry) => entry.token).slice(0, 3)
      : [];
    evidence.push(
      `Learned policy predicted ${learnedPolicy.prediction.label} (${Math.round((learnedPolicy.prediction.confidence || 0) * 100)}% confidence)`
      + (topTokens.length ? ` from ${topTokens.join(', ')}` : '')
      + '.'
    );
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

function addIntegrityRemediations(push, integrity) {
  if (!integrity || !Array.isArray(integrity.blockers)) {
    return;
  }

  const blockerCodes = new Set(integrity.blockers.map((blocker) => blocker.code));
  const remediationSpecs = [
    {
      codes: ['missing_branch_governance'],
      id: 'set_branch_governance',
      title: 'Declare branch governance',
      action: 'Call set_branch_governance with branchName, baseBranch, and PR/release expectations.',
      why: 'Release, merge, and PR workflows need explicit branch state.',
    },
    {
      codes: ['merge_requires_pr_context'],
      id: 'attach_pr_context',
      title: 'Attach PR context',
      action: 'Update branch governance with prNumber or prUrl before merging.',
      why: 'Merge actions should be tied to one explicit review surface.',
    },
    {
      codes: [
        'missing_workflow_dispatch_evidence',
        'missing_workflow_environment',
        'missing_workflow_name',
        'workflow_name_mismatch',
        'missing_workflow_ref',
        'workflow_ref_mismatch',
        'missing_workflow_sha',
        'workflow_sha_mismatch',
        'missing_workflow_job',
      ],
      id: 'verify_workflow_dispatch',
      title: 'Verify workflow dispatch target',
      action: 'Set branch governance workflowDispatch with environment, workflow, ref, sha, and expected job before running gh workflow run.',
      why: 'Environment-specific build dispatches must prove the workflow file, branch/ref, HEAD SHA, and job name before execution.',
    },
    {
      codes: ['missing_release_version', 'release_version_mismatch'],
      id: 'align_release_version',
      title: 'Align release version',
      action: 'Set branch governance releaseVersion and verify it matches package.json before publish.',
      why: 'Release metadata should match the artifact being published.',
    },
    {
      codes: ['publish_requires_base_branch', 'publish_requires_mainline_head'],
      id: 'switch_to_mainline',
      title: 'Run publish from mainline',
      action: `Move the action onto ${integrity.baseBranch || DEFAULT_BASE_BRANCH} after the merge commit exists.`,
      why: 'Publish and tag flows should execute from the protected mainline branch.',
    },
  ];

  for (const remediation of remediationSpecs) {
    if (!remediation.codes.some((code) => blockerCodes.has(code))) {
      continue;
    }
    push(remediation.id, remediation.title, remediation.action, remediation.why);
  }
}

function buildRemediations({
  integrity,
  taskScopeViolation,
  protectedSurface,
  blastRadius,
  memoryGuard,
  learnedPolicy,
  executionSurface,
  costControl,
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
  addIntegrityRemediations(push, integrity);
  if (memoryGuard && memoryGuard.mode && memoryGuard.mode !== 'allow') {
    push(
      'retrieve_lessons',
      'Inspect prior lessons',
      'Call retrieve_lessons or search_lessons for this tool context before retrying.',
      'The system already has evidence that this action pattern failed before.'
    );
  }
  if (learnedPolicy && learnedPolicy.enabled && learnedPolicy.prediction) {
    if (learnedPolicy.prediction.label === 'verify' && learnedPolicy.prediction.confidence >= 0.3) {
      push(
        'verify_before_closeout',
        'Raise verification before claiming success',
        'Run the relevant proof or test command and confirm the exact output before retrying or closing out.',
        'The learned policy predicts this path tends to fail at verification time.'
      );
    }
    if (learnedPolicy.prediction.label === 'recall' && learnedPolicy.prediction.confidence >= 0.3) {
      push(
        'retrieve_lessons',
        'Inspect prior lessons',
        'Call retrieve_lessons or search_lessons for this tool context before retrying.',
        'The learned policy predicts this action needs prior lessons and corrective context.'
      );
    }
  }
  if (blastRadius.fileCount >= 4 || blastRadius.surfaceCount >= 3) {
    push(
      'split_blast_radius',
      'Split the change',
      'Reduce the affected files or surfaces into smaller sequential steps before executing.',
      'Smaller blast radii are easier to verify and recover.'
    );
  }
  if (executionSurface?.shouldSandbox) {
    push(
      'route_to_docker_sandbox',
      'Route through Docker Sandboxes',
      `Launch the repo in Docker Sandboxes before retrying. Standalone: ${executionSurface.launchers.standalone}. Docker Desktop: ${executionSurface.launchers.dockerDesktop}.`,
      'Isolated execution limits host damage when a high-risk local action goes wrong.'
    );
  }
  if (costControl && costControl.mode && costControl.mode !== 'allow') {
    push(
      'reduce_model_budget',
      'Reduce model budget before execution',
      'Trim context, lower max output, batch the work, or split the action before retrying.',
      'High token or cost estimates should be reviewed before the model/tool loop continues.'
    );
  }

  return remediations;
}

function buildReasoning(report) {
  const lines = [
    `Workflow sentinel risk ${report.band} (${report.riskScore}) for ${report.toolName}.`,
    `Blast radius: ${report.blastRadius.summary}.`,
  ];
  if (report.decisionControl) {
    lines.push(
      `Decision control: ${report.decisionControl.decisionOwner} owns a ${report.decisionControl.reversibility} action via ${report.decisionControl.executionMode}.`
    );
    if (report.decisionControl.deliberation?.required) {
      lines.push(`Deliberation policy: ${report.decisionControl.deliberation.mode} before final approval.`);
    }
  }
  if (report.learnedPolicy && report.learnedPolicy.enabled && report.learnedPolicy.prediction) {
    lines.push(
      `Learned policy predicted ${report.learnedPolicy.prediction.label} (${report.learnedPolicy.prediction.confidence}).`
    );
  }
  if (report.executionSurface?.shouldSandbox) {
    lines.push(`Execution surface: ${report.executionSurface.summary}`);
  }
  if (report.costControl && report.costControl.mode !== 'allow') {
    lines.push(`Cost control: ${report.costControl.mode} — ${report.costControl.reasons.join(' ')}`);
  }
  for (const driver of report.drivers.slice(0, 4)) {
    lines.push(`Driver ${driver.key} (+${driver.weight}): ${driver.reason}`);
  }
  for (const remediation of report.remediations.slice(0, 3)) {
    lines.push(`Remediation: ${remediation.title} — ${remediation.action}`);
  }
  return lines;
}

function getSentinelActionType(toolName) {
  if (toolName === 'Bash') {
    return 'shell.exec';
  }
  if (EDIT_LIKE_TOOLS.has(toolName)) {
    return 'file.write';
  }
  return '';
}

function classifyReversibility({ command, blastRadius, integrity, protectedSurface }) {
  const text = String(command || '');
  const blockers = integrity && Array.isArray(integrity.blockers) ? integrity.blockers : [];
  const destructiveCommand = /\bgit\s+push\b.*(?:--force|-f)\b/i.test(text)
    || /\bgh\s+pr\s+merge\b.*--admin\b/i.test(text)
    || /\brm\s+-rf\b/i.test(text)
    || /\b(?:npm|yarn|pnpm)\s+publish\b/i.test(text)
    || /\bgh\s+release\s+create\b/i.test(text)
    || /\bgit\s+tag\b/i.test(text);
  const releaseSensitive = blastRadius && Array.isArray(blastRadius.releaseSensitiveFiles)
    ? blastRadius.releaseSensitiveFiles.length > 0
    : false;
  const unapprovedProtected = protectedSurface && Array.isArray(protectedSurface.unapprovedProtectedFiles)
    ? protectedSurface.unapprovedProtectedFiles.length > 0
    : false;
  const hardBlockers = blockers.some((blocker) => /publish|merge|release|protected/i.test(String(blocker.code || '')));

  if (destructiveCommand || releaseSensitive || unapprovedProtected || hardBlockers) {
    return 'one_way_door';
  }
  if ((blastRadius && blastRadius.fileCount >= 4) || (blastRadius && blastRadius.surfaceCount >= 2)) {
    return 'reviewable';
  }
  return 'two_way_door';
}

function buildDeliberationPolicy({
  executionMode,
  reversibility,
  risk,
  hasOperationalBlockers,
}) {
  const riskBand = risk && risk.band ? risk.band : 'very_low';
  const riskScore = risk && typeof risk.score === 'number' ? risk.score : 0;
  const needsConsistencyCheck = executionMode === 'blocked'
    || reversibility === 'one_way_door'
    || riskBand === 'very_high'
    || riskScore >= 0.72
    || hasOperationalBlockers;
  const required = executionMode !== 'auto_execute' || riskScore >= 0.45 || hasOperationalBlockers;
  const mode = needsConsistencyCheck
    ? 'reason_then_consistency_check'
    : required
      ? 'reason_then_decide'
      : 'brief_rationale';

  return {
    required,
    mode,
    minSentences: needsConsistencyCheck ? 4 : required ? 2 : 1,
    summarizeOnly: true,
    instruction: required
      ? 'Pause before answering, compare safety, reversibility, prior-failure, and evidence signals, then summarize only the decision evidence.'
      : 'Give a brief evidence summary before approving fast-path execution.',
    consistencyCheck: {
      required: needsConsistencyCheck,
      variants: needsConsistencyCheck
        ? [
          'Re-evaluate the same action from the failure-prevention perspective.',
          'Re-evaluate the same action from the reversibility and rollback perspective.',
          'Re-evaluate the same action from the user-intent and evidence perspective.',
        ]
        : [],
      requiredAgreement: needsConsistencyCheck ? 'all_variants_same_execution_mode' : 'not_required',
      onDisagreement: 'checkpoint_required',
      rationale: needsConsistencyCheck
        ? 'High-risk and one-way-door actions should be stable under paraphrased evaluation before an agent proceeds.'
        : 'Low-risk fast-path actions do not require paraphrase stability checks.',
    },
  };
}

function buildDecisionControl({
  decision,
  risk,
  command,
  blastRadius,
  integrity,
  protectedSurface,
  costControl,
}) {
  const reversibility = classifyReversibility({
    command,
    blastRadius,
    integrity,
    protectedSurface,
  });
  const hasOperationalBlockers = Boolean(integrity && Array.isArray(integrity.blockers) && integrity.blockers.length > 0);
  const hasCostWarning = Boolean(costControl && costControl.mode === 'warn');
  const hasCostBlock = Boolean(costControl && costControl.mode === 'block');
  const requiresCheckpoint = decision === 'warn'
    || (decision === 'allow' && (reversibility !== 'two_way_door' || hasOperationalBlockers || hasCostWarning));
  const executionMode = decision === 'deny'
    || hasCostBlock
    ? 'blocked'
    : requiresCheckpoint
      ? 'checkpoint_required'
      : 'auto_execute';
  const decisionOwner = executionMode === 'blocked'
    ? 'human'
    : executionMode === 'checkpoint_required'
      ? reversibility === 'two_way_door' && !hasOperationalBlockers
        ? 'shared'
        : 'human'
      : 'agent';
  const deliberation = buildDeliberationPolicy({
    executionMode,
    reversibility,
    risk,
    hasOperationalBlockers,
  });

  return {
    executionMode,
    decisionOwner,
    reversibility,
    deliberation,
    requiresHumanApproval: (executionMode === 'checkpoint_required' && decisionOwner !== 'agent') || hasCostBlock,
    recommendedAction: executionMode === 'blocked'
      ? 'halt'
      : executionMode === 'checkpoint_required'
        ? 'review'
        : 'proceed',
    summary: executionMode === 'blocked'
      ? 'Do not proceed until the remediation steps are completed.'
      : executionMode === 'checkpoint_required'
        ? 'Pause for explicit review before executing this action.'
        : 'Safe to execute quickly with standard evidence capture.',
  };
}

function chooseDecision({ riskScore, integrity, memoryGuard, learnedPolicy, blastRadius, command, costControl }) {
  const hasOperationalBlockers = Boolean(integrity && Array.isArray(integrity.blockers) && integrity.blockers.length > 0);
  if (costControl && costControl.mode === 'block') {
    return 'deny';
  }
  const destructiveBypass = /\bgit\s+push\b.*(?:--force|-f)\b/i.test(command) || /\bgh\s+pr\s+merge\b.*--admin\b/i.test(command);
  const learnedPrediction = learnedPolicy && learnedPolicy.enabled ? learnedPolicy.prediction : null;
  const learnedHardStop = Boolean(
    learnedPrediction
      && learnedPrediction.label === 'deny'
      && learnedPrediction.confidence >= 0.7
  );
  const learnedWarning = Boolean(
    learnedPrediction
      && ['warn', 'verify', 'deny'].includes(learnedPrediction.label)
      && learnedPrediction.confidence >= 0.3
  );
  const learnedRecall = Boolean(
    learnedPrediction
      && learnedPrediction.label === 'recall'
      && learnedPrediction.confidence >= 0.3
  );
  const lowBlastRadius = blastRadius.fileCount <= 1
    && blastRadius.surfaceCount <= 1
    && blastRadius.releaseSensitiveFiles.length === 0
    && blastRadius.unapprovedProtectedFiles === 0;
  const lowRiskHandoff = /\bgit\s+push\b|\bgh\s+pr\s+(?:create|merge)\b/i.test(command)
    && !destructiveBypass
    && !learnedHardStop
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
  if (destructiveBypass || learnedHardStop || repeatedHighBlast || (hasOperationalBlockers && riskScore >= 0.72) || riskScore >= 0.86) {
    return 'deny';
  }
  if ((costControl && costControl.mode === 'warn') || riskScore >= 0.45 || (learnedWarning && riskScore >= 0.3) || (learnedRecall && riskScore >= 0.34)) {
    return 'warn';
  }
  return 'allow';
}

function evaluateWorkflowSentinel(toolName, toolInput = {}, options = {}) {
  const normalizedAction = options.normalizedAction || normalizeProviderAction({
    provider: options.provider,
    model: options.model,
    toolName,
    toolInput,
    command: toolInput.command,
    filePath: toolInput.file_path || toolInput.filePath || toolInput.path,
    changedFiles: toolInput.changed_files || toolInput.changedFiles,
    usage: options.usage,
    tokenEstimate: options.tokenEstimate,
    costUsd: options.costUsd,
  });
  const normalizedToolName = normalizedAction.toolName || toolName;
  const normalizedToolInput = {
    ...toolInput,
    ...normalizedAction.toolInput,
  };
  if (normalizedAction.command && !normalizedToolInput.command) {
    normalizedToolInput.command = normalizedAction.command;
  }
  if (normalizedAction.affectedFiles.length > 0 && !normalizedToolInput.changed_files && !normalizedToolInput.changedFiles) {
    normalizedToolInput.changed_files = normalizedAction.affectedFiles;
  }
  const costControl = buildCostControl(normalizedAction, options.budget || toolInput.budget || {});
  const governanceState = options.governanceState || loadGovernanceState();
  const repoPath = options.repoPath || normalizedToolInput.repoPath || normalizedToolInput.cwd || process.cwd();
  const repoRoot = resolveRepoRoot(repoPath) || null;
  const affectedFiles = Array.isArray(options.affectedFiles)
    ? options.affectedFiles.map((filePath) => normalizePosix(filePath)).filter(Boolean)
    : collectAffectedFiles(normalizedToolName, normalizedToolInput, repoRoot);
  const highRiskAction = isHighRiskAction(normalizedToolName, normalizedToolInput, affectedFiles);
  const baseBranch = options.baseBranch
    || (governanceState.branchGovernance && governanceState.branchGovernance.baseBranch)
    || normalizedToolInput.baseBranch
    || DEFAULT_BASE_BRANCH;
  const integrity = evaluateOperationalIntegrity({
    repoPath,
    baseBranch,
    command: normalizedToolInput.command,
    changedFiles: affectedFiles,
    headSha: options.headSha || toolInput.headSha,
    requirePrForReleaseSensitive: options.requirePrForReleaseSensitive === true,
    requireVersionNotBehindBase: options.requireVersionNotBehindBase === true,
    branchGovernance: governanceState.branchGovernance,
  });
  const taskScopeViolation = buildTaskScopeViolation(governanceState.taskScope, affectedFiles);
  const protectedSurface = buildProtectedSurface(governanceState, affectedFiles);
  const protectedSurfaceForRisk = isProtectedApprovalRelevant(normalizedToolName, normalizedToolInput)
    ? protectedSurface
    : {
      ...protectedSurface,
      protectedFiles: [],
      unapprovedProtectedFiles: [],
    };
  const rawMemoryGuard = options.memoryGuard || evaluatePretool(normalizedToolName, JSON.stringify({
    toolName: normalizedToolName,
    command: normalizedToolInput.command || null,
    filePath: normalizedToolInput.file_path || normalizedToolInput.filePath || normalizedToolInput.path || null,
    affectedFiles,
  }), options.feedbackOptions || {});
  const memoryGuard = normalizeMemoryGuardForSentinel(rawMemoryGuard, highRiskAction);
  const learnedPolicy = getInterventionRecommendation({
    toolName: normalizedToolName,
    command: normalizedToolInput.command || '',
    affectedFiles,
    integrity,
    memoryGuard,
    riskBand: highRiskAction ? 'high' : 'low',
    taskScopeViolation,
    protectedSurface: protectedSurfaceForRisk,
  }, {
    feedbackDir: options.feedbackDir
      || process.env.THUMBGATE_FEEDBACK_DIR
      || (repoRoot ? path.join(repoRoot, '.thumbgate') : null),
  });
  const blastRadius = buildBlastRadius({
    affectedFiles,
    integrity,
    protectedSurface: protectedSurfaceForRisk,
  });
  const risk = scoreRisk({
    toolName: normalizedToolName,
    toolInput: normalizedToolInput,
    affectedFiles,
    integrity,
    memoryGuard,
    learnedPolicy,
    blastRadius,
    taskScopeViolation,
    protectedSurface: protectedSurfaceForRisk,
    costControl,
  });
  const executionSurface = buildDockerSandboxPlan({
    toolName: normalizedToolName,
    actionType: getSentinelActionType(normalizedToolName),
    command: normalizedToolInput.command,
    repoPath,
    affectedFiles,
    riskBand: risk.band,
    riskScore: risk.score,
    requiresNetwork: Boolean(
      /\b(?:curl|wget|gh\s+pr|git\s+push|npm\s+publish|yarn\s+publish|pnpm\s+publish)\b/i.test(normalizedToolInput.command || '')
    ),
  });
  const decision = chooseDecision({
    riskScore: risk.score,
    integrity,
    memoryGuard,
    learnedPolicy,
    blastRadius: {
      ...blastRadius,
      unapprovedProtectedFiles: protectedSurfaceForRisk.unapprovedProtectedFiles.length,
    },
    command: normalizedToolInput.command || '',
    costControl,
  });
  const evidence = buildEvidence({
    integrity,
    memoryGuard,
    learnedPolicy,
    blastRadius,
    taskScopeViolation,
    protectedSurface: protectedSurfaceForRisk,
    normalizedAction,
    costControl,
  });
  const remediations = buildRemediations({
    integrity,
    taskScopeViolation,
    protectedSurface: protectedSurfaceForRisk,
    blastRadius,
    memoryGuard,
    learnedPolicy,
    executionSurface,
    costControl,
  });
  const summary = decision === 'allow'
    ? 'No predictive workflow blockers detected.'
    : decision === 'warn'
      ? 'Predicted workflow risk is elevated before execution.'
      : 'Predicted workflow failure before execution.';
  const report = {
    sentinelVersion: 'workflow-sentinel-v2',
    toolName: normalizedToolName,
    normalizedAction,
    costControl,
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
    learnedPolicy,
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
  report.decisionControl = buildDecisionControl({
    decision,
    risk,
    command: normalizedToolInput.command || '',
    blastRadius: {
      ...blastRadius,
      unapprovedProtectedFiles: protectedSurfaceForRisk.unapprovedProtectedFiles.length,
    },
    integrity,
    protectedSurface: protectedSurfaceForRisk,
    costControl,
  });
  report.reasoning = buildReasoning(report);
  return report;
}

module.exports = {
  buildDecisionControl,
  buildDeliberationPolicy,
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
