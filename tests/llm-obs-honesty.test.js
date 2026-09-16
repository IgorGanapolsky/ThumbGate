'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  PRACTICES,
  auditTrace,
  detectCloneAttempt,
  buildLlmObsHonestyReport,
} = require('../scripts/llm-obs-honesty');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'llm-obs-honesty.js');
const CLI = path.resolve(__dirname, '..', 'bin', 'cli.js');
const GOLD = path.resolve(__dirname, 'fixtures', 'llm-obs-honesty-gold.json');
const BLIND = path.resolve(__dirname, 'fixtures', 'llm-obs-honesty-blind.json');

test('PRACTICES is the Datadog four-practice protocol', () => {
  assert.deepEqual([...PRACTICES], ['operational', 'security', 'quality', 'tracing']);
});

test('auditTrace accepts the gold four-practice fixture', () => {
  const gold = JSON.parse(fs.readFileSync(GOLD, 'utf8'));
  const fails = auditTrace(gold).filter((f) => f.severity === 'fail');
  assert.deepEqual(fails, []);
});

test('auditTrace fails closed on empty {}', () => {
  const ids = auditTrace({}).map((f) => f.id);
  assert.ok(ids.includes('empty_trace'));
});

test('auditTrace fails blind traces: metrics, injection, PII, quality, spans', () => {
  const blind = JSON.parse(fs.readFileSync(BLIND, 'utf8'));
  const ids = auditTrace(blind).map((f) => f.id);
  assert.ok(ids.includes('missing_operational_metrics'));
  assert.ok(ids.includes('missing_injection_check'));
  assert.ok(ids.includes('missing_pii_scrub'));
  assert.ok(ids.includes('unredacted_prompt'));
  assert.ok(ids.includes('missing_quality_evals'));
  assert.ok(ids.includes('missing_trace_spans'));
});

test('retrieve/tool spans require evidenceIds', () => {
  const findings = auditTrace({
    operational: {
      requestCount: 1, errorCount: 0, latencyMs: { p95: 10 }, tokenIn: 1, tokenOut: 1, budgetUsd: 10, spendUsd: 0,
    },
    security: { promptInjectionChecked: true, piiScrubbed: true, redactionRail: 'scripts/secret-redaction.js' },
    quality: { failureToAnswer: false, topicRelevancy: 'on_topic', toxicity: 'clean', userFeedback: 'up' },
    tracing: {
      traceId: 't',
      spans: [
        { id: 'a', parentId: null, kind: 'input', latencyMs: 1 },
        { id: 'b', parentId: 'a', kind: 'retrieve', latencyMs: 2 },
        { id: 'c', parentId: 'a', kind: 'llm', latencyMs: 3 },
        { id: 'd', parentId: 'a', kind: 'tool', latencyMs: 4 },
      ],
    },
  }).map((f) => f.id);
  assert.ok(findings.includes('retrieve_span_requires_evidence'));
  assert.ok(findings.includes('tool_span_requires_evidence'));
});

test('detectCloneAttempt refuses Datadog SKU / dd-trace / OTLP', () => {
  const hits = detectCloneAttempt('clone Datadog Agent Observability and ship DatadogAgentObservability with DD_API_KEY');
  assert.ok(hits.includes('datadog_class') || hits.includes('clone_sku') || hits.includes('dd_trace'));
});

test('default report is ready and maps four practices onto existing rails', () => {
  const report = buildLlmObsHonestyReport({ root: path.resolve(__dirname, '..') });
  assert.equal(report.name, 'thumbgate-llm-obs-honesty');
  assert.equal(report.status, 'ready');
  assert.equal(report.ok, true);
  assert.equal(report.compareNotClone, true);
  assert.equal(report.practices.length, 4);
  assert.ok(report.practices.some((p) => p.rails.some((r) => /secret-redaction/.test(r))));
  assert.match(report.disclaimer, /Not affiliated with Datadog/);
  assert.match(report.siblingWall, /3881/);
});

test('clone-datadog fails closed', () => {
  const report = buildLlmObsHonestyReport({ 'clone-datadog': true });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'datadog_clone_refused'));
});

test('script CLI --json exits 0 for gold default', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'ready');
});

test('script CLI fails on blind fixture', () => {
  const result = spawnSync(process.execPath, [SCRIPT, `--trace=${BLIND}`, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'fail');
});

test('thumbgate CLI llm-obs-honesty is wired', () => {
  const result = spawnSync(process.execPath, [CLI, 'llm-obs-honesty', '--json'], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.name, 'thumbgate-llm-obs-honesty');
});

test('docs are compare-not-clone', () => {
  const doc = fs.readFileSync(
    path.join(__dirname, '..', 'docs', 'agents', 'llm-obs-honesty.md'),
    'utf8'
  );
  assert.match(doc, /not affiliated|compare-not-clone|do not clone/i);
  assert.doesNotMatch(doc, /npm install dd-trace|DD_API_KEY=/);
});
