#!/usr/bin/env node
'use strict';

/**
 * Hugging Face Context Course Governance Proof Harness
 *
 * Validates that ThumbGate's context-engineering gate template, model candidates,
 * and adapter configs correctly integrate with the Hugging Face Context Course
 * (context engineering for AI code agents — Claude Code, Codex, OpenCode).
 *
 * Tests:
 *   1. Gate template pattern matches code-gen tool calls but the gate enforces context freshness.
 *   2. Model candidates for context-engineering workload are registered and recommendable.
 *   3. Adapter files pin the shipped version and are syntactically valid.
 *   4. Gate template follows the shared rollout metadata contract.
 *   5. HF_CONTEXT.md guide references all required integration points.
 *
 * Usage:
 *   node scripts/prove-hf-context.js
 *   THUMBGATE_HF_CONTEXT_PROOF_DIR=/tmp/hf-context-proof node scripts/prove-hf-context.js
 */

const fs = require('fs');
const path = require('path');

const { listGateTemplates } = require('./gate-templates');
const {
  loadCatalog,
  recommendCandidates,
} = require('./model-candidates');

const ROOT = path.join(__dirname, '..');
const DEFAULT_PROOF_DIR = path.join(ROOT, 'proof', 'hf-context-course');
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
function getHfContextTemplate(id) {
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
 * Test suite: validate-context-before-codegen gate covers code-gen tools.
 */
function proveGatePatternCoversCodeGen() {
  const results = [];

  const template = getHfContextTemplate('validate-context-before-codegen');
  check(template, 'validate-context-before-codegen gate template must exist');
  check(template.defaultAction === 'block', 'validate-context-before-codegen must default to block');
  check(template.category === 'AI Engineering Stack Safety', 'must be in correct category');

  const matchCases = [
    { command: 'Edit on path/to/file.js', description: 'Edit tool call' },
    { command: 'Write to path/to/file.js', description: 'Write tool call' },
    { command: 'MultiEdit on path/to/file.js', description: 'MultiEdit tool call' },
    { command: 'StrReplace in path/to/file.js', description: 'StrReplace tool call' },
  ];

  for (const testCase of matchCases) {
    const matched = patternMatches(template.pattern, testCase.command);
    results.push({
      name: `validate-context-before-codegen matches: ${testCase.description}`,
      passed: matched,
      details: { command: testCase.command, pattern: template.pattern, matched },
    });

    if (!matched) {
      throw new Error(`Gate template validate-context-before-codegen should match: "${testCase.command}"`);
    }
  }

  return results;
}

/**
 * Test suite: model candidates for context-engineering are registered and recommendable.
 */
function proveModelCandidates() {
  const results = [];

  const catalog = loadCatalog();
  const workload = catalog.workloads['context-engineering'];
  check(workload, 'context-engineering workload must exist in catalog');

  results.push({
    name: 'context-engineering workload exists',
    passed: !!workload,
    details: { metrics: workload.metrics },
  });

  const ids = new Set(catalog.candidates.map((c) => c.id));
  check(ids.has('huggingface/context-engineering-agent'), 'huggingface/context-engineering-agent candidate must exist');

  results.push({
    name: 'huggingface/context-engineering-agent candidate registered',
    passed: ids.has('huggingface/context-engineering-agent'),
    details: { id: 'huggingface/context-engineering-agent' },
  });

  const report = recommendCandidates({
    workload: 'context-engineering',
    provider: 'huggingface',
    maxCandidates: 1,
  });

  check(report.recommended.length >= 1, 'should recommend at least 1 candidate');
  check(report.recommended[0].id === 'huggingface/context-engineering-agent', 'top recommendation must be HF context-engineering-agent');

  results.push({
    name: 'recommendCandidates returns huggingface/context-engineering-agent',
    passed: report.recommended[0].id === 'huggingface/context-engineering-agent',
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
    'adapters/huggingface-context-course/HF_CONTEXT.md',
    'adapters/huggingface-context-course/config.toml',
    'adapters/huggingface-context-course/opencode.json',
    'adapters/huggingface-context-course/.mcp.json',
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
  const opencodeJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'adapters/huggingface-context-course/opencode.json'), 'utf-8'));
  check(!!opencodeJson.mcp?.thumbgate, 'opencode.json must have thumbgate MCP server');
  check(!!opencodeJson.mcp?.thumbgate.enabled, 'opencode.json must have thumbgate MCP enabled');
  results.push({ name: 'opencode.json is valid JSON with thumbgate MCP', passed: true });

  const mcpJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'adapters/huggingface-context-course/.mcp.json'), 'utf-8'));
  check(!!mcpJson.mcpServers?.thumbgate, '.mcp.json must have thumbgate MCP server');
  check(!!mcpJson.hooks?.preToolUse, '.mcp.json must have preToolUse hook');
  results.push({ name: '.mcp.json is valid JSON with MCP + hook', passed: true });

  // Verify config.toml has hooks
  const toml = fs.readFileSync(path.join(ROOT, 'adapters/huggingface-context-course/config.toml'), 'utf-8');
  check(toml.includes('[hooks.pre_tool_use]') || toml.includes('pre_tool_use'), 'config.toml must have pre_tool_use hook');
  results.push({ name: 'config.toml has gate-check hook', passed: true });

  return results;
}

/**
 * Test suite: validate-context-before-codegen gate template follows shared contract.
 */
function proveGateTemplateContract() {
  const results = [];

  const template = getHfContextTemplate('validate-context-before-codegen');
  check(template, 'validate-context-before-codegen gate template must exist');

  const requiredFields = ['id', 'name', 'category', 'signal', 'defaultAction', 'severity', 'pattern', 'problem', 'roi', 'rollout'];
  for (const field of requiredFields) {
    check(template[field], `validate-context-before-codegen must have ${field}`);
    results.push({
      name: `validate-context-before-codegen has ${field}`,
      passed: true,
    });
  }

  check(template.signal === '👎', 'must have 👎 signal');
  check(template.defaultAction === 'block', 'must default to block');
  check(['critical', 'high'].includes(template.severity), 'must have valid severity');

  return results;
}

/**
 * Test suite: HF_CONTEXT.md guide references all required integration points.
 */
function proveGuideContent() {
  const results = [];
  const content = fs.readFileSync(path.join(ROOT, 'adapters/huggingface-context-course/HF_CONTEXT.md'), 'utf-8');

  const requiredReferences = [
    { needle: 'https://huggingface.co/learn/context-course', label: 'course URL' },
    { needle: 'validate-context-before-codegen', label: 'gate template reference' },
    { needle: 'huggingface/context-engineering-agent', label: 'model candidate reference' },
    { needle: 'Unit 1', label: 'Unit 1 (Agent Skills) reference' },
    { needle: 'Unit 2', label: 'Unit 2 (MCP) reference' },
    { needle: 'Unit 4', label: 'Unit 4 (Sub-agents) reference' },
    { needle: 'Unit 5', label: 'Unit 5 (Hooks) reference' },
    { needle: 'context-engineering', label: 'context-engineering workload' },
    { needle: `thumbgate@${PACKAGE_VERSION}`, label: 'version pin' },
  ];

  for (const { needle, label } of requiredReferences) {
    const found = content.includes(needle);
    results.push({
      name: `HF_CONTEXT.md references ${label}`,
      passed: found,
      details: { needle, found },
    });
    if (!found) {
      throw new Error(`HF_CONTEXT.md must reference ${label}: "${needle}"`);
    }
  }

  return results;
}

/**
 * Main proof entry point.
 */
function runProof(options = {}) {
  const proofDir = options.proofDir || process.env.THUMBGATE_HF_CONTEXT_PROOF_DIR || DEFAULT_PROOF_DIR;
  const writeArtifacts = options.writeArtifacts !== false;
  if (writeArtifacts) ensureDir(proofDir);

  const allResults = [];

  const suites = [
    { name: 'gate_pattern_covers_codegen', fn: proveGatePatternCoversCodeGen },
    { name: 'model_candidates', fn: proveModelCandidates },
    { name: 'adapter_files', fn: proveAdapterFiles },
    { name: 'gate_template_contract', fn: proveGateTemplateContract },
    { name: 'guide_content', fn: proveGuideContent },
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
    const reportPath = path.join(proofDir, 'hf-context-course-proof-report.json');
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
  console.log(`\nAll ${report.summary.total} HF Context Course proof tests passed.`);
}

module.exports = {
  runProof,
  proveGatePatternCoversCodeGen,
  proveModelCandidates,
  proveAdapterFiles,
  proveGateTemplateContract,
  proveGuideContent,
  patternMatches,
  getHfContextTemplate,
};
