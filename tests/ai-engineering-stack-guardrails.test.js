'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const {
  buildAiEngineeringStackGuardrailsPlan,
  formatAiEngineeringStackGuardrailsPlan,
  normalizeOptions,
} = require('../scripts/ai-engineering-stack-guardrails');

const CLI = path.resolve(__dirname, '..', 'bin', 'cli.js');

test('normalizeOptions extracts gateway, MCP, LLM wiki, reviewer, and sandbox signals', () => {
  const options = normalizeOptions({
    stack: 'thumbgate-prod',
    'direct-provider-keys': 'true',
    'mcp-tool-count': '182',
    'llm-wiki-pages': '24',
    'context-freshness-days': '30',
    'high-risk-workflows': 'deploy,billing',
    'background-agents': true,
  });

  assert.equal(options.stackName, 'thumbgate-prod');
  assert.equal(options.directProviderKeys, true);
  assert.equal(options.gateway, false);
  assert.equal(options.mcpToolCount, 182);
  assert.equal(options.codeMode, false);
  assert.equal(options.agentsMd, false);
  assert.equal(options.llmWikiPages, 24);
  assert.equal(options.contextFreshnessDays, 30);
  assert.deepEqual(options.highRiskWorkflows, ['deploy', 'billing']);
  assert.equal(options.backgroundAgents, true);
  assert.equal(options.sandbox, false);
});

test('buildAiEngineeringStackGuardrailsPlan recommends Cloudflare-style stack gates', () => {
  const report = buildAiEngineeringStackGuardrailsPlan({
    'direct-provider-keys': true,
    'mcp-tool-count': '182',
    'llm-wiki-pages': '24',
    'context-freshness-days': '30',
    'high-risk-workflows': 'deploy,billing',
    'background-agents': true,
  });

  const recommendedIds = report.templates
    .filter((template) => template.recommended)
    .map((template) => template.id);

  assert.equal(report.name, 'thumbgate-ai-engineering-stack-guardrails');
  assert.equal(report.status, 'actionable');
  assert.deepEqual(recommendedIds, [
    'require-ai-gateway-control-plane',
    'require-progressive-mcp-tool-discovery',
    'require-agent-context-freshness',
    'require-risk-tiered-ai-review',
    'require-sandboxed-background-agent-runtime',
  ]);
  assert.ok(report.signals.some((signal) => signal.id === 'agent_context_freshness'));
});

test('ready posture avoids recommendations when stack evidence is complete', () => {
  const report = buildAiEngineeringStackGuardrailsPlan({
    gateway: true,
    'mcp-tool-count': '12',
    'code-mode': true,
    'agents-md': true,
    'ai-reviewer': true,
    'codex-rules': true,
    sandbox: true,
  });

  assert.equal(report.status, 'ready');
  assert.equal(report.summary.recommendedTemplateCount, 0);
});

test('formatAiEngineeringStackGuardrailsPlan renders operator next actions', () => {
  const report = buildAiEngineeringStackGuardrailsPlan({
    'direct-provider-keys': true,
    'mcp-tool-count': '34',
    'llm-wiki-pages': '6',
    'background-agents': true,
  });
  const text = formatAiEngineeringStackGuardrailsPlan(report);

  assert.match(text, /ThumbGate AI Engineering Stack Guardrails/);
  assert.match(text, /Model gateway control plane/);
  assert.match(text, /LLM wiki/);
  assert.match(text, /npx thumbgate ai-engineering-stack-guardrails/);
});

test('ai-engineering-stack-guardrails CLI emits machine-readable recommendations', () => {
  const result = spawnSync(process.execPath, [
    CLI,
    'llm-wiki-guardrails',
    '--mcp-tool-count=182',
    '--direct-provider-keys',
    '--llm-wiki-pages=24',
    '--context-freshness-days=30',
    '--background-agents',
    '--json',
  ], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.name, 'thumbgate-ai-engineering-stack-guardrails');
  assert.equal(payload.summary.recommendedTemplateCount, 5);
  assert.ok(payload.templates.some((template) => template.id === 'require-agent-context-freshness'));
});
