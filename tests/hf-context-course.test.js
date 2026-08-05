'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { listGateTemplates } = require('../scripts/gate-templates');
const { loadCatalog, recommendCandidates } = require('../scripts/model-candidates');
const { readFileSync } = require('node:fs');

const PACKAGE_VERSION = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;

test('HF Context Course: adapter files exist and pin shipped version', () => {
  const adapterDir = path.join(__dirname, '..', 'adapters', 'huggingface-context-course');
  const files = ['HF_CONTEXT.md', 'config.toml', 'opencode.json', '.mcp.json'];

  files.forEach((file) => {
    const filePath = path.join(adapterDir, file);
    assert.ok(fs.existsSync(filePath), `adapters/huggingface-context-course/${file} must exist`);
  });

  // config.toml pins version
  const toml = readFileSync(path.join(adapterDir, 'config.toml'), 'utf8');
  assert.ok(toml.includes(`thumbgate@${PACKAGE_VERSION}`), 'config.toml must pin shipped thumbgate version');

  // opencode.json pins version and is valid JSON
  const openCode = JSON.parse(readFileSync(path.join(adapterDir, 'opencode.json'), 'utf8'));
  assert.ok(openCode.notes.includes(`thumbgate@${PACKAGE_VERSION}`), 'opencode.json must pin shipped thumbgate version');

  // .mcp.json pins version and is valid JSON
  const mcp = JSON.parse(readFileSync(path.join(adapterDir, '.mcp.json'), 'utf8'));
  const mcpJson = JSON.stringify(mcp);
  assert.ok(mcpJson.includes(`thumbgate@${PACKAGE_VERSION}`), '.mcp.json must pin shipped thumbgate version');
});

test('HF Context Course: validate-context-before-codegen gate template exists', () => {
  const templates = listGateTemplates();
  const gate = templates.find((template) => template.id === 'validate-context-before-codegen');

  assert.ok(gate, 'validate-context-before-codegen gate template must exist');
  assert.equal(gate.category, 'AI Engineering Stack Safety');
  assert.equal(gate.signal, '👎');
  assert.equal(gate.defaultAction, 'block');
  assert.equal(gate.severity, 'high');
  assert.ok(gate.problem);
  assert.ok(gate.roi);
  assert.ok(gate.rollout);
});

test('HF Context Course: context-engineering workload is registered', () => {
  const catalog = loadCatalog();
  const workload = catalog.workloads['context-engineering'];

  assert.ok(workload, 'context-engineering workload must exist');
  assert.ok(workload.desiredStrengths.includes('context-structuring'));
  assert.ok(workload.desiredStrengths.includes('skill-synthesis'));
  assert.ok(workload.desiredStrengths.includes('MCP-governance'));
  assert.ok(workload.metrics.includes('contextFreshnessRate'));
  assert.ok(workload.metrics.includes('skillValidationAccuracy'));
  assert.ok(workload.metrics.includes('mcpToolSafetyRate'));
});

test('HF Context Course: huggingface/context-engineering-agent candidate is registered', () => {
  const catalog = loadCatalog();
  const candidate = catalog.candidates.find((entry) => entry.id === 'huggingface/context-engineering-agent');

  assert.ok(candidate, 'huggingface/context-engineering-agent must be registered');
  assert.equal(candidate.vendor, 'Hugging Face');
  assert.equal(candidate.provider, 'huggingface');
  assert.ok(candidate.strengths.includes('context-structuring'));
  assert.ok(candidate.strengths.includes('skill-synthesis'));
  assert.ok(candidate.strengths.includes('MCP-governance'));
  assert.equal(candidate.contextWindow, 200000);
});

test('HF Context Course: HF_CONTEXT.md references gate templates, model candidates, and course URL', () => {
  const content = readFileSync(
    path.join(__dirname, '..', 'adapters', 'huggingface-context-course', 'HF_CONTEXT.md'),
    'utf8',
  );

  assert.ok(content.includes('https://huggingface.co/learn/context-course'), 'must reference course URL');
  assert.ok(content.includes('validate-context-before-codegen'), 'must reference gate template');
  assert.ok(content.includes('huggingface/context-engineering-agent'), 'must reference model candidate');
  assert.ok(content.includes('context-engineering'), 'must reference context-engineering workload');
  assert.ok(content.includes(`thumbgate@${PACKAGE_VERSION}`), 'must pin shipped version');
  assert.ok(content.includes('Unit 1'), 'must reference Unit 1 (Agent Skills)');
  assert.ok(content.includes('Unit 5'), 'must reference Unit 5 (Hooks)');
});

test('HF Context Course: opencode.json includes context course notes', () => {
  const openCode = JSON.parse(
    readFileSync(path.join(__dirname, '..', 'adapters', 'huggingface-context-course', 'opencode.json'), 'utf8'),
  );

  assert.ok(openCode.notes, 'opencode.json must have notes field');
  assert.ok(openCode.notes.toLowerCase().includes('context course'), 'notes must reference the context course');
  assert.ok(openCode.mcp.thumbgate, 'must configure thumbgate MCP server');
  assert.ok(openCode.mcp.thumbgate.enabled, 'thumbgate MCP must be enabled');
});

test('HF Context Course: .mcp.json includes preToolUse gate-check hook', () => {
  const mcp = JSON.parse(
    readFileSync(path.join(__dirname, '..', 'adapters', 'huggingface-context-course', '.mcp.json'), 'utf8'),
  );

  assert.ok(mcp.mcpServers.thumbgate, 'must register thumbgate MCP server');
  assert.ok(mcp.hooks.preToolUse, 'must have preToolUse hook');
  assert.ok(mcp.hooks.preToolUse.args.includes('gate-check'), 'preToolUse must use gate-check');
});
