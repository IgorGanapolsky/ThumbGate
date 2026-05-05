'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const {
  buildLongRunningAgentContextGuardrailsPlan,
  formatLongRunningAgentContextGuardrailsPlan,
  normalizeOptions,
} = require('../scripts/long-running-agent-context-guardrails');

const CLI = path.resolve(__dirname, '..', 'bin', 'cli.js');

test('normalizeOptions extracts long-running context signals', () => {
  const options = normalizeOptions({
    workflow: 'revenue-loop',
    'request-count': '80',
    'output-mb': '3',
    'raw-chat-only': true,
    conflicts: 'yes',
  });

  assert.equal(options.workflow, 'revenue-loop');
  assert.equal(options.requestCount, 80);
  assert.equal(options.outputMb, 3);
  assert.equal(options.rawChatOnly, true);
  assert.equal(options.conflicts, true);
  assert.equal(options.directorJournal, false);
});

test('buildLongRunningAgentContextGuardrailsPlan recommends Slack-style structured memory gates', () => {
  const report = buildLongRunningAgentContextGuardrailsPlan({
    'request-count': '80',
    'output-mb': '3',
    'raw-chat-only': true,
    conflicts: true,
  });
  const recommendedIds = report.templates
    .filter((template) => template.recommended)
    .map((template) => template.id);

  assert.equal(report.name, 'thumbgate-long-running-agent-context-guardrails');
  assert.equal(report.status, 'actionable');
  assert.deepEqual(recommendedIds, [
    'require-director-journal-for-long-running-agent',
    'require-critic-review-for-agent-findings',
    'checkpoint-critic-timeline-conflict-resolution',
  ]);
  assert.ok(report.signals.some((signal) => signal.id === 'context_window_bloat'));
});

test('formatLongRunningAgentContextGuardrailsPlan renders operator next actions', () => {
  const report = buildLongRunningAgentContextGuardrailsPlan({
    'request-count': '80',
    'raw-chat-only': true,
  });
  const text = formatLongRunningAgentContextGuardrailsPlan(report);

  assert.match(text, /ThumbGate Long-Running Agent Context Guardrails/);
  assert.match(text, /Persist a director journal/);
  assert.match(text, /Run critic review/);
  assert.match(text, /npx thumbgate long-running-agent-context-guardrails/);
});

test('long-running-agent-context-guardrails CLI emits machine-readable recommendations', () => {
  const result = spawnSync(process.execPath, [
    CLI,
    'long-running-agent-context-guardrails',
    '--request-count=80',
    '--output-mb=3',
    '--raw-chat-only',
    '--json',
  ], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.name, 'thumbgate-long-running-agent-context-guardrails');
  assert.equal(payload.summary.recommendedTemplateCount, 3);
  assert.ok(payload.signals.some((signal) => signal.id === 'context_window_bloat'));
});
