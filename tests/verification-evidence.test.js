'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const packageJson = require('../package.json');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE_PATH = path.join(ROOT, 'VERIFICATION_EVIDENCE.md');
const evidence = fs.readFileSync(EVIDENCE_PATH, 'utf8');

const systems = [
  'RAG system',
  'Agent with tools',
  'Multi-agent workflow',
  'MCP-based enterprise integration',
  'Production AI system with evaluation and observability',
];

const questions = [
  'Why this architecture?',
  'What can fail?',
  'How do we measure it?',
  'How do we secure it?',
  'How do we deploy it?',
  'How do we know it works?',
];

const referencedImplementation = [
  'scripts/lesson-db.js',
  'scripts/lesson-retrieval.js',
  'scripts/memory-firewall.js',
  'scripts/tool-registry.js',
  'scripts/tool-contract-validator.js',
  'adapters/mcp/server-stdio.js',
  'scripts/agent-design-governance.js',
  'scripts/parallel-workflow-orchestrator.js',
  'docs/GOAL_CONTRACTS.md',
  'scripts/mcp-oauth.js',
  'scripts/mcp-policy.js',
  'scripts/task-outcomes.js',
  'scripts/agent-outcome-monitor.js',
  'scripts/human-escalation.js',
  'config/evals/agent-outcomes-golden.json',
  'config/evals/agent-outcomes-baseline.json',
];

const proofScripts = [
  'test:lesson-db',
  'test:lesson-retrieval',
  'test:memory-firewall',
  'test:eval-rag',
  'test:tool-registry',
  'test:tool-contract-validator',
  'prove:adapters',
  'test:verified-agent-outcomes',
  'test:agent-design-governance',
  'test:swarm-coordinator',
  'prove:automation',
  'test:durability-step',
  'test:mcp-oauth',
  'test:mcp-oauth-flow',
  'test:mcp-policy',
  'test:mcp-tool-annotations',
  'test:pack-runtime-integrity',
  'test:prompt-eval',
  'eval:agent-outcomes',
  'test:async-eval-observability',
  'test:judge-reward',
  'monitor:agent-outcomes',
  'test:coverage',
  'test',
];

test('architecture evidence answers all six operational questions for all five systems', () => {
  for (const system of systems) {
    const sectionStart = evidence.indexOf(`## ${systems.indexOf(system) + 1}. ${system}`);
    assert.notEqual(sectionStart, -1, `missing architecture section: ${system}`);
    const nextSection = evidence.indexOf('\n## ', sectionStart + 4);
    const section = evidence.slice(sectionStart, nextSection === -1 ? undefined : nextSection);

    for (const question of questions) {
      assert.match(section, new RegExp(`### ${question.replace('?', '\\?')}`));
    }
  }
});

test('architecture evidence points only to implementation files that exist', () => {
  for (const relativePath of referencedImplementation) {
    assert.match(evidence, new RegExp(relativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(
      fs.existsSync(path.join(ROOT, relativePath)),
      true,
      `referenced implementation is missing: ${relativePath}`
    );
  }
});

test('every documented proof command is defined in package.json', () => {
  for (const script of proofScripts) {
    assert.equal(
      typeof packageJson.scripts[script],
      'string',
      `missing proof script: ${script}`
    );
    assert.match(evidence, new RegExp(`npm run ${script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|npm ${script}`));
  }
});

test('evidence keeps local, CI, and production claims separate', () => {
  assert.match(evidence, /A local or CI pass is not\s+production proof/);
  assert.match(evidence, /hosted team lesson sync is not general availability/);
  assert.match(evidence, /enterprise SSO and SIEM packaging are not general availability/);
  assert.match(evidence, /Self-heal integrity: `6\/6` protected checks healthy/);
  assert.doesNotMatch(evidence, /Production verified[^.\n]*\byes\b/i);
});
