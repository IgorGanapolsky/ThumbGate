#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  getActiveMcpProfile,
  getAllowedTools,
} = require('./mcp-policy');

const PROJECT_ROOT = path.join(__dirname, '..');

const WRITE_CAPABLE_TOOLS = new Set([
  'capture_feedback',
  'bootstrap_internal_agent',
  'prevention_rules',
  'export_dpo_pairs',
  'export_databricks_bundle',
  'construct_context_pack',
  'evaluate_context_pack',
  'generate_skill',
  'satisfy_gate',
  'set_task_scope',
  'approve_protected_action',
  'track_action',
  'register_claim_gate',
  'run_autoresearch',
]);

const BOOTSTRAP_FILES = [
  { id: 'agents', path: 'AGENTS.md', required: true },
  { id: 'claude', path: 'CLAUDE.md', required: true },
  { id: 'gemini', path: 'GEMINI.md', required: true },
  { id: 'mcp', path: '.mcp.json', required: true },
  { id: 'thumbgateConfig', path: '.thumbgate/config.json', required: false },
];

const MCP_PROFILE_TIERS = {
  default: {
    tier: 'builder',
    description: 'Full local-first reliability workflow with read, recall, guard, and context-pack writes.',
  },
  essential: {
    tier: 'learning',
    description: 'Feedback and recall only; suited for memory-heavy sessions without broader orchestration.',
  },
  commerce: {
    tier: 'commerce',
    description: 'Feedback plus commerce recall for revenue-sensitive workflows.',
  },
  readonly: {
    tier: 'review',
    description: 'Read-heavy review mode with no context-pack or memory writes.',
  },
  dispatch: {
    tier: 'dispatch',
    description: 'Phone-safe remote ops mode for metrics, diagnostics, planning, and recall without writes or handoffs.',
  },
  locked: {
    tier: 'locked',
    description: 'Minimal planning-only profile for constrained environments.',
  },
};

function readTextIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function detectRuntimeIsolation() {
  const cgroup = readTextIfExists('/proc/1/cgroup');
  const containerEnv = String(process.env.container || process.env.CONTAINER || '').trim();
  const isolated = Boolean(
    fs.existsSync('/.dockerenv')
      || containerEnv
      || /docker|containerd|kubepods|podman/i.test(cgroup),
  );

  return {
    isolated,
    mode: isolated ? 'container' : 'host',
    indicators: {
      dotDockerEnv: fs.existsSync('/.dockerenv'),
      containerEnv: Boolean(containerEnv),
      cgroupContainerHint: /docker|containerd|kubepods|podman/i.test(cgroup),
    },
    recommendation: isolated
      ? 'Runtime isolation is active.'
      : 'Consider a containerized or similarly isolated runtime for risky agent workflows.',
  };
}

function findProjectRoot(startDir = process.cwd()) {
  try {
    let curr = path.resolve(startDir);
    while (true) {
      const indicators = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.mcp.json', '.git'];
      if (indicators.some((f) => fs.existsSync(path.join(curr, f)))) {
        return curr;
      }
      const parent = path.dirname(curr);
      if (parent === curr) break;
      curr = parent;
    }
  } catch (_) { /* fallback to startDir */ }
  return startDir;
}

function collectBootstrapFiles(projectRoot) {
  const effectiveRoot = projectRoot || findProjectRoot();
  const files = BOOTSTRAP_FILES.map((file) => {
    const absolutePath = path.join(effectiveRoot, file.path);
    return {
      id: file.id,
      path: file.path,
      required: file.required,
      present: fs.existsSync(absolutePath),
    };
  });

  const required = files.filter((file) => file.required);
  const requiredPresent = required.filter((file) => file.present).length;
  const missingRequired = required.filter((file) => !file.present).map((file) => file.path);

  return {
    files,
    requiredCount: required.length,
    requiredPresent,
    score: Number((requiredPresent / required.length).toFixed(2)),
    ready: missingRequired.length === 0,
    missingRequired,
    recommendation: missingRequired.length === 0
      ? 'Bootstrap context is present.'
      : `Add missing bootstrap files to project root (${effectiveRoot}): ${missingRequired.join(', ')}`,
  };
}

function summarizePermissionTier(profileName = getActiveMcpProfile()) {
  const allowedTools = getAllowedTools(profileName);
  const metadata = MCP_PROFILE_TIERS[profileName] || {
    tier: 'custom',
    description: 'Custom MCP profile.',
  };
  const writeCapableTools = allowedTools.filter((toolName) => WRITE_CAPABLE_TOOLS.has(toolName));

  return {
    profile: profileName,
    tier: metadata.tier,
    description: metadata.description,
    allowedTools,
    writeCapableTools,
    writeCapable: writeCapableTools.length > 0,
    ready: profileName !== 'locked',
    recommendation: profileName === 'locked'
      ? 'Use readonly for review or default for active coding workflows that need memory and context writes.'
      : profileName === 'dispatch'
        ? 'Dispatch is safe for remote metrics, planning, and diagnosis. Switch to default in a dedicated worktree before making code or memory changes.'
      : profileName === 'readonly'
        ? 'Readonly is safe for analysis, but switch to default when you want the system to persist lessons or build context packs.'
        : 'Permission tier is sufficient for active workflows.',
  };
}


function detectStopHookRegistered(projectRoot, existsSync, readFileSync) {
  try {
    const settingsPath = path.join(projectRoot, '.claude', 'settings.json');
    if (!existsSync(settingsPath)) return false;
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    const stopHooks = settings?.hooks?.Stop || [];
    const flat = Array.isArray(stopHooks)
      ? stopHooks.flatMap((entry) => entry?.hooks || [entry])
      : [];
    return flat.some((hook) => String(hook?.command || '').includes('hook-stop-anti-claim'));
  } catch {
    return false;
  }
}

function detectPreToolUseHookRegistered(projectRoot, existsSync = fs.existsSync, readFileSync = fs.readFileSync) {
  try {
    const settingsPath = path.join(projectRoot, '.claude', 'settings.json');
    if (!existsSync(settingsPath)) return false;
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    const preToolUse = settings?.hooks?.PreToolUse || [];
    const flat = Array.isArray(preToolUse)
      ? preToolUse.flatMap((entry) => entry?.hooks || [entry])
      : [];
    return flat.some((hook) => {
      const command = String(hook?.command || '');
      return (
        command.includes('thumbgate') ||
        command.includes('gate-check') ||
        command.includes('hook-runtime') ||
        command.includes('hook-pre-tool-use')
      );
    });
  } catch {
    return false;
  }
}

function recommendationForClaimState({
  evaluatorReady,
  configLoadFailed,
  verifierCount,
  stopHookRegistered,
  configSource,
  loadErrorMessage,
}) {
  if (!evaluatorReady) {
    return 'Universal claim evaluator module is missing from this install.';
  }
  if (configLoadFailed) {
    return loadErrorMessage;
  }
  if (verifierCount === 0) {
    return 'No claim verifiers configured. Copy config/gates/claim-verifiers.example.json to .thumbgate/claim-verifiers.json and point subjects at your sources of truth.';
  }
  if (!stopHookRegistered) {
    return 'Claim verifiers are present, but the Claude Stop anti-claim hook is not registered in .claude/settings.json.';
  }
  return `Factual claim recheck is ready (${verifierCount} verifier(s) from ${configSource}).`;
}

function summarizeClaimVerification(projectRoot = PROJECT_ROOT, deps = {}) {
  const resolveEvaluator = deps.resolveEvaluator
    || (() => require.resolve('./universal-claim-evaluator'));
  const loadVerifierConfig = deps.loadVerifierConfig
    || (() => require('./universal-claim-evaluator').loadVerifierConfig);
  const readFileSync = deps.readFileSync || fs.readFileSync;
  const existsSync = deps.existsSync || fs.existsSync;

  let evaluatorReady = false;
  try {
    resolveEvaluator();
    evaluatorReady = true;
  } catch {
    evaluatorReady = false;
  }

  let verifierCount = 0;
  let configSource = 'none';
  let configLoadFailed = false;
  let loadErrorMessage = 'Install ThumbGate and configure claim verifiers under .thumbgate/claim-verifiers.json.';
  try {
    const loaded = loadVerifierConfig()({ cwd: projectRoot });
    verifierCount = Array.isArray(loaded.verifiers) ? loaded.verifiers.length : 0;
    configSource = loaded.source || 'none';
  } catch (error) {
    configLoadFailed = true;
    loadErrorMessage = `Claim verifier config failed to load: ${error?.message || 'unknown error'}`;
  }

  const stopHookRegistered = detectStopHookRegistered(projectRoot, existsSync, readFileSync);
  const recommendation = recommendationForClaimState({
    evaluatorReady,
    configLoadFailed,
    verifierCount,
    stopHookRegistered,
    configSource,
    loadErrorMessage,
  });

  return {
    ready: evaluatorReady && verifierCount > 0 && stopHookRegistered && !configLoadFailed,
    evaluatorReady,
    verifierCount,
    configSource,
    stopHookRegistered,
    configLoadFailed,
    recommendation,
  };
}

function summarizeGitScale(projectRoot) {
  try {
    const { getRepoRoot, getScaleScorecard } = require('./git-at-scale');
    getRepoRoot(projectRoot);
    const card = getScaleScorecard(projectRoot);
    return {
      ready: card.healthy === true,
      skipped: false,
      scorecard: card,
      recommendation: card.healthy
        ? 'Git scale indexes are present; origin is the source of truth and the local tree is a warm cache.'
        : `Git scale hygiene: ${card.unhealthyReasons.join(', ')}. Run npm run git:scale:tune && npm run git:scale:maintenance.`,
    };
  } catch {
    return {
      ready: true,
      skipped: true,
      scorecard: null,
      recommendation: 'Not a git repository; Git scale scorecard skipped.',
    };
  }
}

function generateAgentReadinessReport({
  projectRoot = PROJECT_ROOT,
  mcpProfile = null,
} = {}) {
  const runtime = detectRuntimeIsolation();
  const bootstrap = collectBootstrapFiles(projectRoot);
  const permissions = summarizePermissionTier(mcpProfile || getActiveMcpProfile());
  const claimVerification = summarizeClaimVerification(projectRoot);

  const preToolUseHookRegistered = detectPreToolUseHookRegistered(projectRoot);
  const gitScale = summarizeGitScale(projectRoot);

  const warnings = [];
  if (!runtime.isolated) warnings.push(runtime.recommendation);
  if (!bootstrap.ready) warnings.push(bootstrap.recommendation);
  if (!permissions.ready) warnings.push(permissions.recommendation);
  // Missing operator verifiers is advisory (not every project asserts SQL row counts).
  // A missing evaluator module or a broken claim-verifier config is not advisory —
  // both make factual recheck fail closed at runtime and must surface here.
  if (!claimVerification.evaluatorReady || claimVerification.configLoadFailed) {
    warnings.push(claimVerification.recommendation);
  }
  if (!preToolUseHookRegistered) {
    warnings.push(
      'No ThumbGate PreToolUse hook found in .claude/settings.json. Run `npx thumbgate init --wire-hooks` before expecting gates to fire.'
    );
  }
  if (!gitScale.skipped && !gitScale.ready) {
    warnings.push(gitScale.recommendation);
  }

  return {
    generatedAt: new Date().toISOString(),
    projectRoot,
    overallStatus: warnings.length === 0 ? 'ready' : 'needs_attention',
    runtime,
    bootstrap,
    permissions,
    claimVerification,
    preToolUseHookRegistered,
    gitScale,
    articleAlignment: {
      runtimeIsolation: runtime.isolated,
      contextConditioning: bootstrap.ready,
      permissionEnvelope: permissions.ready,
      factualClaimRecheck: claimVerification.ready,
      preToolUseHook: preToolUseHookRegistered,
    },
    warnings,
  };
}

function reportToText(report) {
  const lines = [];
  lines.push(`Agent Readiness @ ${report.generatedAt}`);
  lines.push(`Overall: ${report.overallStatus.toUpperCase()}`);
  lines.push('');
  lines.push(`Runtime: ${report.runtime.mode}`);
  lines.push(`  Recommendation: ${report.runtime.recommendation}`);
  lines.push(`Bootstrap: ${report.bootstrap.requiredPresent}/${report.bootstrap.requiredCount} required files present`);
  if (report.bootstrap.missingRequired.length > 0) {
    lines.push(`  Missing: ${report.bootstrap.missingRequired.join(', ')}`);
  }
  if (report.gitScale && !report.gitScale.skipped) {
    lines.push(`Git scale: ${report.gitScale.ready ? 'healthy' : 'needs_attention'}`);
    lines.push(`  Recommendation: ${report.gitScale.recommendation}`);
  }
  lines.push(`Permissions: ${report.permissions.profile} (${report.permissions.tier})`);
  lines.push(`  Write-capable tools: ${report.permissions.writeCapableTools.length}`);
  lines.push(`  Recommendation: ${report.permissions.recommendation}`);
  if (report.claimVerification) {
    lines.push(
      `Claim verification: ${report.claimVerification.ready ? 'ready' : 'needs_attention'}`,
      `  Evaluator: ${report.claimVerification.evaluatorReady ? 'present' : 'missing'}`,
      `  Verifiers: ${report.claimVerification.verifierCount} (${report.claimVerification.configSource})`,
      `  Stop hook: ${report.claimVerification.stopHookRegistered ? 'registered' : 'missing'}`,
      `  Recommendation: ${report.claimVerification.recommendation}`,
    );
  }

  if (report.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    report.warnings.forEach((warning) => {
      lines.push(`- ${warning}`);
    });
  }

  return `${lines.join('\n')}\n`;
}

module.exports = {
  BOOTSTRAP_FILES,
  MCP_PROFILE_TIERS,
  detectRuntimeIsolation,
  collectBootstrapFiles,
  summarizePermissionTier,
  summarizeClaimVerification,
  recommendationForClaimState,
  detectStopHookRegistered,
  detectPreToolUseHookRegistered,
  generateAgentReadinessReport,
  summarizeGitScale,
  reportToText,
};

if (require.main === module) {
  const report = generateAgentReadinessReport();
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(reportToText(report));
  }
}
