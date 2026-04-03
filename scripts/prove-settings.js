#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SETTINGS_PATH = require.resolve('./settings-hierarchy');
const PROFILE_ROUTER_PATH = require.resolve('./profile-router');
const HARNESS_PATH = require.resolve('./natural-language-harness');
const VERIFY_RUN_PATH = require.resolve('./verify-run');
const SERVER_STDIO_PATH = require.resolve('../adapters/mcp/server-stdio');
const DASHBOARD_PATH = require.resolve('./dashboard');
const TOOL_REGISTRY_PATH = require.resolve('./tool-registry');
const MCP_ALLOWLISTS_PATH = require.resolve('../config/mcp-allowlists.json');

function resolveProofPaths() {
  const proofDir = process.env.RLHF_SETTINGS_PROOF_DIR || process.env.RLHF_PROOF_DIR || path.join(ROOT, 'proof');
  return {
    proofDir,
    reportJson: path.join(proofDir, 'settings-report.json'),
    reportMd: path.join(proofDir, 'settings-report.md'),
  };
}

function resetModules() {
  [
    SETTINGS_PATH,
    PROFILE_ROUTER_PATH,
    HARNESS_PATH,
    VERIFY_RUN_PATH,
    SERVER_STDIO_PATH,
    DASHBOARD_PATH,
    TOOL_REGISTRY_PATH,
    MCP_ALLOWLISTS_PATH,
  ].forEach((modulePath) => {
    delete require.cache[modulePath];
  });
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function makeTempProject(structure = {}) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-settings-project-'));
  for (const [relativePath, payload] of Object.entries(structure)) {
    const fullPath = path.join(projectRoot, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    writeJson(fullPath, payload);
  }
  return projectRoot;
}

function writeReports(results, reportJson, reportMd) {
  fs.mkdirSync(path.dirname(reportJson), { recursive: true });
  fs.writeFileSync(reportJson, JSON.stringify(results, null, 2));

  const lines = [
    '# Settings Hierarchy Proof',
    '',
    `- Phase: ${results.phase}`,
    `- Timestamp: ${results.timestamp}`,
    `- ${results.passed} passed, ${results.failed} failed`,
    '',
    '## Requirements',
    '',
  ];

  for (const requirement of Object.values(results.requirements)) {
    lines.push(`- [${requirement.passed ? 'x' : ' '}] **${requirement.id}** ${requirement.desc}`);
  }

  fs.writeFileSync(reportMd, `${lines.join('\n')}\n`);
}

function withClearedEnv(keys, fn) {
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) {
    delete process.env[key];
  }

  try {
    return fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function run() {
  const results = {
    phase: '24-settings-hierarchy',
    timestamp: new Date().toISOString(),
    passed: 0,
    failed: 0,
    requirements: {},
  };
  const { reportJson, reportMd } = resolveProofPaths();

  const checks = [
    {
      id: 'SETTINGS-01',
      desc: 'managed > local > project > user > defaults precedence resolves correctly',
      fn: () => {
        const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-settings-home-'));
        const projectRoot = makeTempProject({
          'config/thumbgate-settings.managed.json': { mcp: { defaultProfile: 'locked' } },
          '.thumbgate/settings.json': { mcp: { defaultProfile: 'dispatch' } },
          '.thumbgate/settings.local.json': { mcp: { defaultProfile: 'readonly' } },
        });
        writeJson(path.join(homeDir, '.thumbgate', 'settings.json'), {
          mcp: { defaultProfile: 'commerce' },
        });
        const { getSetting } = require('./settings-hierarchy');
        const profile = getSetting('mcp.defaultProfile', { projectRoot, homeDir });
        if (profile !== 'locked') {
          throw new Error(`Expected managed profile override, got ${profile}`);
        }
        fs.rmSync(projectRoot, { recursive: true, force: true });
        fs.rmSync(homeDir, { recursive: true, force: true });
      },
    },
    {
      id: 'SETTINGS-02',
      desc: 'settings status returns origin metadata for resolved fields',
      fn: () => {
        const projectRoot = makeTempProject({
          'config/thumbgate-settings.managed.json': { dashboard: { showPolicyOrigins: true } },
        });
        const { getSettingsStatus } = require('./settings-hierarchy');
        const status = getSettingsStatus({ projectRoot, homeDir: projectRoot });
        const origin = status.origins.find((entry) => entry.path === 'dashboard.showPolicyOrigins');
        if (!origin || origin.scope !== 'managed') {
          throw new Error('Expected managed origin for dashboard.showPolicyOrigins');
        }
        fs.rmSync(projectRoot, { recursive: true, force: true });
      },
    },
    {
      id: 'SETTINGS-03',
      desc: 'profile routing uses settings fallback when env override is absent',
      fn: () => {
        const projectRoot = makeTempProject({
          'config/thumbgate-settings.managed.json': { mcp: { defaultProfile: 'dispatch' } },
        });
        try {
          const routed = withClearedEnv(
            ['RLHF_MCP_PROFILE', 'CI', 'GITHUB_EVENT_NAME', 'RLHF_SESSION_TYPE', 'RLHF_SUBAGENT_PROFILE'],
            () => {
              const { routeProfile } = require('./profile-router');
              return routeProfile({ settingsOptions: { projectRoot, homeDir: projectRoot } });
            },
          );
          if (routed.profile !== 'dispatch') {
            throw new Error(`Expected dispatch profile from settings, got ${routed.profile}`);
          }
        } finally {
          fs.rmSync(projectRoot, { recursive: true, force: true });
        }
      },
    },
    {
      id: 'SETTINGS-04',
      desc: 'harness execution is blocked when runtime execution is disabled by settings',
      fn: () => {
        const projectRoot = makeTempProject({
          '.thumbgate/settings.json': { harnesses: { allowRuntimeExecution: false } },
        });
        const { runHarness } = require('./natural-language-harness');
        let blocked = false;
        try {
          runHarness('repo-full-verification', {}, {
            settingsOptions: { projectRoot, homeDir: projectRoot },
          });
        } catch (error) {
          blocked = /disabled by the settings hierarchy/i.test(error.message);
        }
        if (!blocked) {
          throw new Error('Expected harness execution to be blocked by settings');
        }
        fs.rmSync(projectRoot, { recursive: true, force: true });
      },
    },
    {
      id: 'SETTINGS-05',
      desc: 'dashboard and MCP surfaces expose settings status visibility',
      fn: () => {
        const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-settings-dashboard-'));
        const { generateDashboard } = require('./dashboard');
        const dashboard = generateDashboard(feedbackDir);
        const { TOOLS } = require('./tool-registry');
        const mcpAllowlists = require('../config/mcp-allowlists.json');

        try {
          if (!dashboard.settingsStatus || !dashboard.settingsStatus.resolvedSettings) {
            throw new Error('Dashboard is missing settingsStatus');
          }

          const settingsTool = TOOLS.find((tool) => tool.name === 'settings_status');
          if (!settingsTool) {
            throw new Error('settings_status tool is missing from the registry');
          }

          const defaultAllowlist = mcpAllowlists.profiles && mcpAllowlists.profiles.default;
          if (!Array.isArray(defaultAllowlist) || !defaultAllowlist.includes('settings_status')) {
            throw new Error('settings_status is missing from the default MCP allowlist');
          }
        } finally {
          fs.rmSync(feedbackDir, { recursive: true, force: true });
        }
      },
    },
    {
      id: 'SETTINGS-06',
      desc: 'verify:full includes settings proof and materializes the artifact',
      fn: () => {
        const { buildVerifyPlan, recordVerifyWorkflowRun } = require('./verify-run');
        const plan = buildVerifyPlan('full');
        if (!plan.some((step) => Array.isArray(step.args) && step.args.includes('prove:settings'))) {
          throw new Error('verify:full is missing prove:settings');
        }
        const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-settings-proof-run-'));
        try {
          const workflowRun = recordVerifyWorkflowRun('full', ROOT, feedbackDir);
          if (!workflowRun.proofArtifacts.some((artifact) => artifact.endsWith(path.join('proof', 'settings-report.json')))) {
            throw new Error('Workflow run is missing settings proof artifact');
          }
        } finally {
          fs.rmSync(feedbackDir, { recursive: true, force: true });
        }
      },
    },
  ];

  for (const check of checks) {
    try {
      resetModules();
      await check.fn();
      results.passed += 1;
      results.requirements[check.id] = { id: check.id, desc: check.desc, passed: true };
    } catch (error) {
      results.failed += 1;
      results.requirements[check.id] = {
        id: check.id,
        desc: check.desc,
        passed: false,
        error: error.message,
      };
    } finally {
      resetModules();
    }
  }

  writeReports(results, reportJson, reportMd);
  console.log(`${results.passed} passed, ${results.failed} failed`);
  if (results.failed > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = {
  resolveProofPaths,
  run,
};
