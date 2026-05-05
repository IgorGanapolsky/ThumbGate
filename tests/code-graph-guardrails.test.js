'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const cliPath = path.join(root, 'bin', 'cli.js');

const {
  buildCodeGraphGuardrailsPlan,
  formatCodeGraphGuardrailsPlan,
  normalizeOptions,
} = require('../scripts/code-graph-guardrails');

test('normalizeOptions extracts graph signals from CLI-style flags', () => {
  const options = normalizeOptions({
    'graph-tool': 'understand-anything',
    'graph-path': '.understand-anything/graph.json',
    'central-files': 'src/api/server.js, src/billing.js',
    layers: 'api,data',
    'generated-artifacts': '.understand-anything/graph.json',
    'changed-files': '24',
  });

  assert.equal(options.graphTool, 'understand-anything');
  assert.equal(options.graphPath, '.understand-anything/graph.json');
  assert.deepEqual(options.centralFiles, ['src/api/server.js', 'src/billing.js']);
  assert.deepEqual(options.layersTouched, ['api', 'data']);
  assert.deepEqual(options.generatedArtifacts, ['.understand-anything/graph.json']);
  assert.equal(options.changedFiles, 24);
});

test('buildCodeGraphGuardrailsPlan recommends all concrete Knowledge Graph Safety gates', () => {
  const report = buildCodeGraphGuardrailsPlan({
    'graph-tool': 'code-graph-mcp',
    'central-files': 'src/api/server.js',
    layers: 'api,data,ui',
    'generated-artifacts': '.codegraph/index.json',
    'changed-files': '31',
  });
  const recommendedIds = report.templates
    .filter((template) => template.recommended)
    .map((template) => template.id);

  assert.equal(report.name, 'thumbgate-code-graph-guardrails');
  assert.equal(report.status, 'actionable');
  assert.equal(report.summary.recommendedTemplateCount, 3);
  assert.deepEqual(recommendedIds, [
    'require-diff-impact-before-central-edit',
    'checkpoint-cross-layer-refactor',
    'protect-graph-generated-artifacts',
  ]);
  assert.ok(report.signals.some((signal) => signal.id === 'large_blast_radius'));
});

test('formatCodeGraphGuardrailsPlan gives operator-readable rollout steps', () => {
  const report = buildCodeGraphGuardrailsPlan({
    'central-files': 'src/api/server.js',
  });
  const text = formatCodeGraphGuardrailsPlan(report);

  assert.match(text, /ThumbGate Code Graph Guardrails/);
  assert.match(text, /require-diff-impact-before-central-edit/);
  assert.match(text, /Enable the recommended Knowledge Graph Safety templates/);
  assert.match(text, /npx thumbgate code-graph-guardrails/);
});

test('code-graph-guardrails CLI emits machine-readable recommendations', () => {
  const result = spawnSync(process.execPath, [
    cliPath,
    'code-graph-guardrails',
    '--central-files=src/api/server.js',
    '--layers=api,data',
    '--generated-artifacts=.codegraph/index.json',
    '--json',
  ], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      THUMBGATE_NO_NUDGE: '1',
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.name, 'thumbgate-code-graph-guardrails');
  assert.equal(payload.summary.recommendedTemplateCount, 3);
  assert.ok(payload.templates.some((template) => template.id === 'checkpoint-cross-layer-refactor'));
});
