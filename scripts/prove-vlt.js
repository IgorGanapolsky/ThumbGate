#!/usr/bin/env node
'use strict';

/**
 * vlt Registry Governance Proof Harness
 *
 * Validates that ThumbGate's vlt-specific gate templates, model candidates, and
 * adapter configs correctly govern the JavaScript package ecosystem that vlt
 * (launched Aug 2026) introduces — hosted registry, self-hosted VSR, and secure
 * npm mirror.
 *
 * Tests:
 *   1. Gate template patterns match dangerous vlt commands (block path).
 *   2. Gate template patterns do NOT match safe vlt commands (allow path).
 *   3. Model candidates for js-package-registry-governance workload are registered.
 *   4. Adapter files pin the shipped version and are syntactically valid.
 *   5. Gate templates follow the shared rollout metadata contract.
 *
 * Usage:
 *   node scripts/prove-vlt.js
 *   THUMBGATE_VLT_PROOF_DIR=/tmp/vlt-proof node scripts/prove-vlt.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  listGateTemplates,
} = require('./gate-templates');
const {
  loadCatalog,
  recommendCandidates,
} = require('./model-candidates');

const ROOT = path.join(__dirname, '..');
const DEFAULT_PROOF_DIR = path.join(ROOT, 'proof', 'vlt');
const PACKAGE_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')).version;

function check(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Returns the gate template matching the given id from the config catalog.
 */
function getVltTemplate(id) {
  const templates = listGateTemplates();
  return templates.find((template) => template.id === id);
}

/**
 * Tests that a regex pattern matches the expected input.
 */
function patternMatches(pattern, input) {
  if (!pattern) return false;
  try {
    const regex = new RegExp(pattern);
    return regex.test(input);
  } catch (e) {
    throw new Error(`Invalid regex pattern "${pattern}": ${e.message}`);
  }
}

/**
 * Test suite: gate template patterns match dangerous vlt commands.
 */
function proveGatePatternsBlockDangerousCommands() {
  const results = [];

  const blockCases = [
    {
      templateId: 'block-vlt-install-vulnerable-deps',
      command: 'vlt install left-pad@latest --audit critical',
      description: 'vlt install with "critical" keyword (CVE context)',
    },
    {
      templateId: 'block-vlt-install-vulnerable-deps',
      command: 'vlt add lodash --cve high-severity-vulnerabilities',
      description: 'vlt add referencing high-severity CVEs',
    },
    {
      templateId: 'require-review-vlt-registry-override',
      command: 'vlt config set registry https://evil-registry.com',
      description: 'vlt registry redirect to unapproved host',
    },
    {
      templateId: 'require-review-vlt-registry-override',
      command: 'vlt config set registry https://my-self-hosted-vsr.internal:443',
      description: 'vlt self-hosted VSR override',
    },
    {
      templateId: 'enforce-vlt-workspace-dep-pinning',
      command: 'vlt add express@*',
      description: 'vlt add with wildcard version',
    },
    {
      templateId: 'enforce-vlt-workspace-dep-pinning',
      command: 'vlt add lodash@^4.17.0',
      description: 'vlt add with caret version range',
    },
    {
      templateId: 'gate-vlt-package-publishing',
      command: 'vlt publish --no-provenance',
      description: 'vlt publish without provenance attestation',
    },
    {
      templateId: 'gate-vlt-package-publishing',
      command: 'vlt publish --access public --scope @mycompany/typosquat',
      description: 'vlt publish to suspicious scope',
    },
    {
      templateId: 'block-vlt-private-registry-bypass',
      command: 'NPM_CONFIG_REGISTRY=https://evil.com npm install',
      description: 'npmrc/env registry bypass to unapproved host',
    },
    {
      templateId: 'block-vlt-private-registry-bypass',
      command: 'vlt config set registry https://evil-registry.net',
      description: 'vlt registry override via config to unapproved host',
    },
  ];

  for (const testCase of blockCases) {
    const template = getVltTemplate(testCase.templateId);
    check(template, `gate template ${testCase.templateId} must exist`);
    check(template.defaultAction === 'block', `${testCase.templateId} must default to block`);

    const matched = patternMatches(template.pattern, testCase.command);
    const passed = matched;

    results.push({
      name: `${testCase.templateId} blocks: ${testCase.description}`,
      passed,
      details: {
        command: testCase.command,
        pattern: template.pattern,
        matched,
      },
    });

    if (!passed) {
      throw new Error(`Gate template ${testCase.templateId} should match: "${testCase.command}"`);
    }
  }

  return results;
}

/**
 * Test suite: gate template patterns do NOT block safe vlt commands.
 */
function proveGatePatternsAllowSafeCommands() {
  const results = [];

  const allowCases = [
    {
      templateId: 'block-vlt-install-vulnerable-deps',
      command: 'vlt install lodash@4.17.21',
      description: 'vlt install with pinned version (no CVE keyword)',
    },
    {
      templateId: 'require-review-vlt-registry-override',
      command: 'vlt config get registry',
      description: 'vlt config read (non-mutating)',
    },
    {
      templateId: 'enforce-vlt-workspace-dep-pinning',
      command: 'vlt install express@4.18.2',
      description: 'vlt install with exact pinned version',
    },
    {
      templateId: 'gate-vlt-package-publishing',
      command: 'vlt publish --access public',
      description: 'vlt publish with access flag only (no provenance flag)',
    },
    {
      templateId: 'block-vlt-private-registry-bypass',
      command: 'vlt install --registry https://registry.npmjs.org',
      description: 'vlt install from approved npm registry',
    },
  ];

  for (const testCase of allowCases) {
    const template = getVltTemplate(testCase.templateId);
    check(template, `gate template ${testCase.templateId} must exist`);

    const matched = patternMatches(template.pattern, testCase.command);
    const passed = !matched;

    results.push({
      name: `${testCase.templateId} allows: ${testCase.description}`,
      passed,
      details: {
        command: testCase.command,
        pattern: template.pattern,
        matched,
      },
    });

    // Note: Some "safe" commands may still match due to pattern broadness.
    // The key assertion is that clearly blocked commands match (tested above).
    // Here we test that clearly safe commands don't match unnecessarily.
    if (!passed && testCase.description.includes('pinned version')) {
      // Only enforce strict non-matching for pinned version installs
      throw new Error(`Gate template ${testCase.templateId} should NOT match safe command: "${testCase.command}"`);
    }
  }

  return results;
}

/**
 * Test suite: model candidates for js-package-registry-governance are registered.
 */
function proveModelCandidates() {
  const results = [];

  const catalog = loadCatalog();
  const workload = catalog.workloads['js-package-registry-governance'];
  check(workload, 'js-package-registry-governance workload must exist in catalog');

  results.push({
    name: 'js-package-registry-governance workload exists',
    passed: !!workload,
    details: { metrics: workload.metrics },
  });

  const ids = new Set(catalog.candidates.map((c) => c.id));
  check(ids.has('vlt/vlt-registry-hosted'), 'vlt/vlt-registry-hosted candidate must exist');
  check(ids.has('vlt/vlt-vsr-self-hosted'), 'vlt/vlt-vsr-self-hosted candidate must exist');

  results.push({
    name: 'vlt model candidates registered',
    passed: ids.has('vlt/vlt-registry-hosted') && ids.has('vlt/vlt-vsr-self-hosted'),
    details: { ids: [...ids].filter((id) => id.startsWith('vlt/')) },
  });

  const report = recommendCandidates({
    workload: 'js-package-registry-governance',
    provider: 'vlt',
    maxCandidates: 2,
  });

  check(report.recommended.length === 2, 'should recommend 2 vlt candidates');

  results.push({
    name: 'recommendCandidates returns vlt candidates for js-package-registry-governance',
    passed: report.recommended.length === 2,
    details: { recommended: report.recommended.map((r) => r.id) },
  });

  return results;
}

/**
 * Test suite: adapter files are valid and pin the shipped version.
 */
function proveAdapterFiles() {
  const results = [];

  const adapterFiles = [
    'adapters/vlt/VLT.md',
    'adapters/vlt/config.toml',
    'adapters/vlt/opencode.json',
    'adapters/vlt/.mcp.json',
  ];

  for (const file of adapterFiles) {
    const filePath = path.join(ROOT, file);
    check(fs.existsSync(filePath), `${file} must exist`);
    const content = fs.readFileSync(filePath, 'utf-8');
    check(content.includes(`thumbgate@${PACKAGE_VERSION}`), `${file} must pin thumbgate@${PACKAGE_VERSION}`);
    results.push({
      name: `${file} exists and pins thumbgate@${PACKAGE_VERSION}`,
      passed: true,
      details: { file, version: PACKAGE_VERSION },
    });
  }

  // Verify JSON configs are valid
  const opencodeJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'adapters/vlt/opencode.json'), 'utf-8'));
  check(!!opencodeJson.mcp?.thumbgate, 'vlt opencode.json must have thumbgate MCP server');
  results.push({ name: 'vlt opencode.json is valid JSON with thumbgate MCP', passed: true });

  const mcpJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'adapters/vlt/.mcp.json'), 'utf-8'));
  check(!!mcpJson.mcpServers?.thumbgate, 'vlt .mcp.json must have thumbgate MCP server');
  check(!!mcpJson.hooks?.preToolUse, 'vlt .mcp.json must have preToolUse hook');
  results.push({ name: 'vlt .mcp.json is valid JSON with MCP + hook', passed: true });

  return results;
}

/**
 * Test suite: vlt gate templates follow the shared rollout metadata contract.
 */
function proveGateTemplateContract() {
  const results = [];
  const vltIds = [
    'block-vlt-install-vulnerable-deps',
    'require-review-vlt-registry-override',
    'enforce-vlt-workspace-dep-pinning',
    'gate-vlt-package-publishing',
    'block-vlt-private-registry-bypass',
  ];

  for (const id of vltIds) {
    const template = getVltTemplate(id);
    check(template, `vlt gate template ${id} must exist`);
    check(template.category === 'JavaScript Package Registry Governance', `${id} must have correct category`);
    check(template.signal === '👎', `${id} must have 👎 signal`);
    check(template.defaultAction === 'block', `${id} must default to block`);
    check(['critical', 'high'].includes(template.severity), `${id} must have valid severity`);
    check(template.problem && template.problem.length > 0, `${id} must have a problem statement`);
    check(template.roi && template.roi.length > 0, `${id} must have an ROI statement`);
    check(template.rollout && template.rollout.length > 0, `${id} must have rollout guidance`);
    results.push({
      name: `${id} satisfies gate template contract`,
      passed: true,
      details: { severity: template.severity, category: template.category },
    });
  }

  return results;
}

/**
 * Main proof entry point.
 */
function runProof(options = {}) {
  const proofDir = options.proofDir || process.env.THUMBGATE_VLT_PROOF_DIR || DEFAULT_PROOF_DIR;
  const writeArtifacts = options.writeArtifacts !== false;
  if (writeArtifacts) ensureDir(proofDir);

  const allResults = [];

  const suites = [
    { name: 'gate_patterns_block', fn: proveGatePatternsBlockDangerousCommands },
    { name: 'gate_patterns_allow', fn: proveGatePatternsAllowSafeCommands },
    { name: 'model_candidates', fn: proveModelCandidates },
    { name: 'adapter_files', fn: proveAdapterFiles },
    { name: 'gate_template_contract', fn: proveGateTemplateContract },
  ];

  const summary = { total: 0, passed: 0, failed: 0, suites: {} };

  for (const suite of suites) {
    let suiteResults;
    let suitePassed = true;
    try {
      suiteResults = suite.fn();
      suitePassed = suiteResults.every((r) => r.passed);
    } catch (e) {
      suiteResults = [{ name: `${suite.name} threw`, passed: false, error: e.message }];
      suitePassed = false;
    }

    allResults.push(...suiteResults);
    summary.suites[suite.name] = {
      passed: suitePassed,
      tests: suiteResults.length,
    };
    summary.total += suiteResults.length;
    summary.passed += suiteResults.filter((r) => r.passed).length;
    summary.failed += suiteResults.filter((r) => !r.passed).length;
  }

  const report = {
    proofDir,
    packageVersion: PACKAGE_VERSION,
    summary,
    results: allResults,
  };

  if (writeArtifacts) {
    const reportPath = path.join(proofDir, 'vlt-proof-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  }

  return report;
}

if (require.main === module) {
  const report = runProof();
  console.log(JSON.stringify(report.summary, null, 2));
  if (report.summary.failed > 0) {
    console.error(`\n${report.summary.failed} test(s) failed:`);
    for (const result of report.results) {
      if (!result.passed) {
        console.error(`  ✗ ${result.name}`);
        if (result.error) console.error(`    ${result.error}`);
      }
    }
    process.exit(1);
  }
  console.log(`\nAll ${report.summary.total} vlt proof tests passed.`);
}

module.exports = {
  runProof,
  proveGatePatternsBlockDangerousCommands,
  proveGatePatternsAllowSafeCommands,
  proveModelCandidates,
  proveAdapterFiles,
  proveGateTemplateContract,
  patternMatches,
  getVltTemplate,
};
