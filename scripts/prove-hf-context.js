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
const {
  check,
  patternMatches,
  createProofRunner,
  getGateTemplate,
  proveAdapterFilesExist,
  proveWorkloadRegistered,
  proveGateTemplateFields,
  proveContentReferences,
} = require('./proof-common');

const ROOT = path.join(__dirname, '..');
const DEFAULT_PROOF_DIR = path.join(ROOT, 'proof', 'hf-context-course');
const PACKAGE_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')).version;

/**
 * Returns the gate template matching the given id from the config catalog.
 */
function getHfContextTemplate(id) {
  return getGateTemplate(id);
}

/**
 * Test suite: validate-context-before-codegen gate covers code-gen tools.
 */
function proveGatePattern() {
  const results = [];

  const template = getHfContextTemplate('validate-context-before-codegen');
  check(template, 'validate-context-before-codegen gate template must exist');
  check(template.defaultAction === 'block', 'must default to block');
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
      name: `${template.id} matches: ${testCase.description}`,
      passed: matched,
      details: { command: testCase.command, pattern: template.pattern, matched },
    });
    if (!matched) throw new Error(`Gate ${template.id} should match: "${testCase.command}"`);
  }

  return results;
}

function proveModelCandidates() {
  return proveWorkloadRegistered(
    'context-engineering',
    ['huggingface/context-engineering-agent'],
    'huggingface',
    1,
    'huggingface/context-engineering-agent'
  );
}

function proveAdapterFiles() {
  return proveAdapterFilesExist(ROOT, PACKAGE_VERSION, [
    { file: 'adapters/huggingface-context-course/HF_CONTEXT.md' },
    { file: 'adapters/huggingface-context-course/config.toml' },
    {
      file: 'adapters/huggingface-context-course/opencode.json',
      extraChecks: (filePath) => {
        const json = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        check(!!json.mcp?.thumbgate, 'opencode.json must have thumbgate MCP server');
        check(!!json.mcp?.thumbgate.enabled, 'opencode.json must have thumbgate MCP enabled');
        return [{ name: 'opencode.json is valid JSON with thumbgate MCP', passed: true }];
      },
    },
    {
      file: 'adapters/huggingface-context-course/.mcp.json',
      extraChecks: (filePath) => {
        const json = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        check(!!json.mcpServers?.thumbgate, '.mcp.json must have thumbgate MCP server');
        check(!!json.hooks?.preToolUse, '.mcp.json must have preToolUse hook');
        return [{ name: '.mcp.json is valid JSON with MCP + hook', passed: true }];
      },
    },
    {
      file: 'adapters/huggingface-context-course/config.toml',
      extraChecks: (filePath, content) => {
        check(content.includes('pre_tool_use'), 'config.toml must have pre_tool_use hook');
        return [{ name: 'config.toml has gate-check hook', passed: true }];
      },
    },
  ]);
}

function proveGateTemplateContract() {
  const requiredFields = ['id', 'name', 'category', 'signal', 'defaultAction', 'severity', 'pattern', 'problem', 'roi', 'rollout'];
  const results = proveGateTemplateFields('validate-context-before-codegen', requiredFields);
  const template = getHfContextTemplate('validate-context-before-codegen');
  check(template.signal === '👎', 'must have 👎 signal');
  check(template.defaultAction === 'block', 'must default to block');
  check(['critical', 'high'].includes(template.severity), 'must have valid severity');
  return results;
}

function proveGuideContent() {
  const content = fs.readFileSync(path.join(ROOT, 'adapters/huggingface-context-course/HF_CONTEXT.md'), 'utf-8');
  return proveContentReferences(content, [
    { needle: 'https://huggingface.co/learn/context-course/unit0/introduction', label: 'course URL' },
    { needle: 'validate-context-before-codegen', label: 'gate template reference' },
    { needle: 'huggingface/context-engineering-agent', label: 'model candidate reference' },
    { needle: 'Unit 1', label: 'Unit 1 (Agent Skills) reference' },
    { needle: 'Unit 2', label: 'Unit 2 (MCP) reference' },
    { needle: 'Unit 4', label: 'Unit 4 (Sub-agents) reference' },
    { needle: 'Unit 5', label: 'Unit 5 (Hooks) reference' },
    { needle: 'context-engineering', label: 'context-engineering workload' },
    { needle: `thumbgate@${PACKAGE_VERSION}`, label: 'version pin' },
  ]);
}

const { runProof, main } = createProofRunner({
  envVar: 'THUMBGATE_HF_CONTEXT_PROOF_DIR',
  defaultProofDir: DEFAULT_PROOF_DIR,
  reportName: 'hf-context-course-proof-report.json',
  successLabel: 'HF Context Course',
  packageVersion: PACKAGE_VERSION,
  buildSuites: () => [
    { name: 'gate_pattern_covers_codegen', fn: proveGatePattern },
    { name: 'model_candidates', fn: proveModelCandidates },
    { name: 'adapter_files', fn: proveAdapterFiles },
    { name: 'gate_template_contract', fn: proveGateTemplateContract },
    { name: 'guide_content', fn: proveGuideContent },
  ],
});

if (require.main === module) {
  main();
}

module.exports = {
  runProof,
  proveGatePattern,
  proveModelCandidates,
  proveAdapterFiles,
  proveGateTemplateContract,
  proveGuideContent,
  patternMatches,
  getHfContextTemplate,
};
