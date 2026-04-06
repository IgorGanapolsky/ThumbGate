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
  'track_action',
  'register_claim_gate',
]);

const BOOTSTRAP_FILES = [
  { id: 'agents', path: 'AGENTS.md', required: true },
  { id: 'claude', path: 'CLAUDE.md', required: true },
  { id: 'gemini', path: 'GEMINI.md', required: true },
  { id: 'mcp', path: '.mcp.json', required: true },
  { id: 'rlhfConfig', path: '.thumbgate/config.json', required: false },
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

function collectBootstrapFiles(projectRoot = PROJECT_ROOT) {
  const files = BOOTSTRAP_FILES.map((file) => {
    const absolutePath = path.join(projectRoot, file.path);
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
      : `Add missing bootstrap files: ${missingRequired.join(', ')}`,
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

function generateAgentReadinessReport({
  projectRoot = PROJECT_ROOT,
  mcpProfile = null,
} = {}) {
  const runtime = detectRuntimeIsolation();
  const bootstrap = collectBootstrapFiles(projectRoot);
  const permissions = summarizePermissionTier(mcpProfile || getActiveMcpProfile());

  const warnings = [];
  if (!runtime.isolated) warnings.push(runtime.recommendation);
  if (!bootstrap.ready) warnings.push(bootstrap.recommendation);
  if (!permissions.ready) warnings.push(permissions.recommendation);

  return {
    generatedAt: new Date().toISOString(),
    projectRoot,
    overallStatus: warnings.length === 0 ? 'ready' : 'needs_attention',
    runtime,
    bootstrap,
    permissions,
    articleAlignment: {
      runtimeIsolation: runtime.isolated,
      contextConditioning: bootstrap.ready,
      permissionEnvelope: permissions.ready,
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
