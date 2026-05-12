'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const cliPath = path.join(root, 'bin', 'cli.js');

const {
  buildProxyPointerRagGuardrailsPlan,
  formatProxyPointerRagGuardrailsPlan,
  normalizeOptions,
} = require('../scripts/proxy-pointer-rag-guardrails');

test('normalizeOptions extracts proxy-pointer RAG signals from CLI flags', () => {
  const options = normalizeOptions({
    'rag-tool': 'proxy-pointer-rag',
    'tree-path': '.rag/tree.json',
    'section-ids': 'paper-1:methods,paper-1:results',
    'image-pointers': 'paper-1/figures/fig2.png,paper-1/tables/table1.png',
    documents: 'paper-1,paper-2',
    'candidate-images': '6',
    'cross-doc-policy': 'strict',
    'vision-filter': 'true',
    'visual-claims': true,
  });

  assert.equal(options.ragTool, 'proxy-pointer-rag');
  assert.equal(options.treePath, '.rag/tree.json');
  assert.deepEqual(options.sectionIds, ['paper-1:methods', 'paper-1:results']);
  assert.deepEqual(options.imagePointers, ['paper-1/figures/fig2.png', 'paper-1/tables/table1.png']);
  assert.deepEqual(options.documentIds, ['paper-1', 'paper-2']);
  assert.equal(options.candidateImages, 6);
  assert.equal(options.crossDocumentPolicy, 'strict');
  assert.equal(options.visionFilter, true);
  assert.equal(options.visualClaims, true);
});

test('buildProxyPointerRagGuardrailsPlan recommends all concrete Document RAG Safety gates', () => {
  const report = buildProxyPointerRagGuardrailsPlan({
    'tree-path': '.rag/tree.json',
    'image-pointers': 'paper-1/figures/fig2.png',
    documents: 'paper-1,paper-2',
    'candidate-images': '3',
    'visual-claims': true,
  });
  const recommendedIds = report.templates
    .filter((template) => template.recommended)
    .map((template) => template.id);

  assert.equal(report.name, 'thumbgate-proxy-pointer-rag-guardrails');
  assert.equal(report.status, 'actionable');
  assert.equal(report.summary.recommendedTemplateCount, 4);
  assert.deepEqual(recommendedIds, [
    'require-section-tree-before-multimodal-answer',
    'require-image-pointer-grounding',
    'block-cross-document-image-leakage',
    'checkpoint-vision-filter-for-visual-claims',
  ]);
  assert.ok(report.signals.some((signal) => signal.id === 'cross_document_leakage'));
});

test('formatProxyPointerRagGuardrailsPlan gives operator-readable rollout steps', () => {
  const report = buildProxyPointerRagGuardrailsPlan({
    'tree-path': '.rag/tree.json',
    'image-pointers': 'paper-1/figures/fig2.png',
  });
  const text = formatProxyPointerRagGuardrailsPlan(report);

  assert.match(text, /ThumbGate Proxy-Pointer RAG Guardrails/);
  assert.match(text, /require-section-tree-before-multimodal-answer/);
  assert.match(text, /Enable the recommended Document RAG Safety templates/);
  assert.match(text, /npx thumbgate proxy-pointer-rag-guardrails/);
});

test('proxy-pointer-rag-guardrails CLI emits machine-readable recommendations', () => {
  const result = spawnSync(process.execPath, [
    cliPath,
    'proxy-pointer-rag-guardrails',
    '--tree-path=.rag/tree.json',
    '--image-pointers=paper-1/figures/fig2.png',
    '--documents=paper-1,paper-2',
    '--visual-claims',
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
  assert.equal(payload.name, 'thumbgate-proxy-pointer-rag-guardrails');
  assert.equal(payload.summary.recommendedTemplateCount, 4);
  assert.ok(payload.templates.some((template) => template.id === 'block-cross-document-image-leakage'));
});
