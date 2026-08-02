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

function summarizeClaimVerification(projectRoot = PROJECT_ROOT, deps = {}) {
  let evaluatorReady = false;
  let verifierCount = 0;
  let configSource = 'none';
  let stopHookRegistered = false;
  let recommendation = 'Install ThumbGate and configure claim verifiers under .thumbgate/claim-verifiers.json.';

  const resolveEvaluator = deps.resolveEvaluator
    || (() => require.resolve('./universal-claim-evaluator'));
  const loadVerifierConfig = deps.loadVerifierConfig
    || (() => require('./universal-claim-evaluator').loadVerifierConfig);
  const readFileSync = deps.readFileSync || fs.readFileSync;
  const existsSync = deps.existsSync || fs.existsSync;

  try {
    resolveEvaluator();
    evaluatorReady = true;
  } catch {
    evaluatorReady = false;
  }

  let configLoadFailed = false;
  try {
    const loaded = loadVerifierConfig()({ cwd: projectRoot });
    verifierCount = Array.isArray(loaded.verifiers) ? loaded.verifiers.length : 0;
    configSource = loaded.source || 'none';
  } catch (error) {
    configLoadFailed = true;
    recommendation = `Claim verifier config failed to load: ${error && error.message ? error.message : 'unknown error'}`;
  }

  try {
    const settingsPath = path.join(projectRoot, '.claude', 'settings.json');
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      const stopHooks = (((settings.hooks || {}).Stop) || []);
      const flat = Array.isArray(stopHooks)
        ? stopHooks.flatMap((entry) => (entry && entry.hooks) || [entry])
        : [];
      stopHookRegistered = flat.some((hook) => {
        const command = String((hook && hook.command) || '');
        return command.includes('hook-stop-anti-claim');
      });
    }
  } catch {
    stopHookRegistered = false;
  }

  const ready = evaluatorReady && verifierCount > 0 && stopHookRegistered && !configLoadFailed;
  if (!evaluatorReady) {
    recommendation = 'Universal claim evaluator module is missing from this install.';
  } else if (configLoadFailed) {
    // keep the load-error recommendation set above
  } else if (verifierCount === 0) {
    recommendation = 'No claim verifiers configured. Copy config/gates/claim-verifiers.example.json to .thumbgate/claim-verifiers.json and point subjects at your sources of truth.';
  } else if (!stopHookRegistered) {
    recommendation = 'Claim verifiers are present, but the Claude Stop anti-claim hook is not registered in .claude/settings.json.';
  } else {
    recommendation = `Factual claim recheck is ready (${verifierCount} verifier(s) from ${configSource}).`;
  }

  return {
    ready,
    evaluatorReady,
    verifierCount,
    configSource,
    stopHookRegistered,
    recommendation,
  };
}

function generateAgentReadinessReport({
  projectRoot = PROJECT_ROOT,
  mcpProfile = null,
} = {}) {
  const runtime = detectRuntimeIsolation();
  const bootstrap = collectBootstrapFiles(projectRoot);
  const permissions = summarizePermissionTier(mcpProfile || getActiveMcpProfile());
  const claimVerification = summarizeClaimVerification(projectRoot);

  const warnings = [];
  if (!runtime.isolated) warnings.push(runtime.recommendation);
  if (!bootstrap.ready) warnings.push(bootstrap.recommendation);
  if (!permissions.ready) warnings.push(permissions.recommendation);
  // Missing operator verifiers is advisory (not every project asserts SQL row counts).
  // A missing evaluator module is a packaging failure and must surface as needs_attention.
  if (!claimVerification.evaluatorReady) warnings.push(claimVerification.recommendation);

  return {
    generatedAt: new Date().toISOString(),
    projectRoot,
    overallStatus: warnings.length === 0 ? 'ready' : 'needs_attention',
    runtime,
    bootstrap,
    permissions,
    claimVerification,
    articleAlignment: {
      runtimeIsolation: runtime.isolated,
      contextConditioning: bootstrap.ready,
      permissionEnvelope: permissions.ready,
      factualClaimRecheck: claimVerification.ready,
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
  lines.push(`Permissions: ${report.permissions.profile} (${report.permissions.tier})`);
  lines.push(`  Write-capable tools: ${report.permissions.writeCapableTools.length}`);
  lines.push(`  Recommendation: ${report.permissions.recommendation}`);
  if (report.claimVerification) {
    lines.push(`Claim verification: ${report.claimVerification.ready ? 'ready' : 'needs_attention'}`);
    lines.push(`  Evaluator: ${report.claimVerification.evaluatorReady ? 'present' : 'missing'}`);
    lines.push(`  Verifiers: ${report.claimVerification.verifierCount} (${report.claimVerification.configSource})`);
    lines.push(`  Stop hook: ${report.claimVerification.stopHookRegistered ? 'registered' : 'missing'}`);
    lines.push(`  Recommendation: ${report.claimVerification.recommendation}`);
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
  generateAgentReadinessReport,
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
