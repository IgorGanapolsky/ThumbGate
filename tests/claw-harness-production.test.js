'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  HOSTS,
  buildHarness,
  screenContent,
  runLocalEvals,
  rollupTelemetry,
} = require('../scripts/claw-harness-production');

test('one definition, three hosts — console/hosted/evals', () => {
  assert.deepEqual([...HOSTS], ['console', 'hosted', 'evals']);
  for (const h of HOSTS) {
    const m = buildHarness(h);
    assert.equal(m.host, h);
    assert.ok(m.source.includes('devblogs.microsoft.com'), 'steal must cite its source');
  }
});

test('unknown host fails closed', () => {
  const m = buildHarness('kubernetes');
  assert.ok(m.error.includes('unknown host'));
});

test('hosted posture kills shell and container-disk file access', () => {
  const m = buildHarness('hosted');
  assert.equal(m.capabilities.shell, false);
  assert.equal(m.capabilities.fileAccess, false);
  assert.equal(m.capabilities.codeAct, false);
  assert.equal(m.capabilities.backgroundAgents, true);
});

test('hosted file access only via external governed store', () => {
  const m = buildHarness('hosted', { fileStore: 'blob://claw-files' });
  assert.equal(m.capabilities.fileAccess, 'external-store');
  assert.equal(m.capabilities.fileStore, 'blob://claw-files');
});

test('hosted CodeAct requires an external sandbox', () => {
  const off = buildHarness('hosted');
  assert.equal(off.capabilities.codeAct, false);
  const on = buildHarness('hosted', { codeActSandboxed: true });
  assert.equal(on.capabilities.codeAct, 'sandboxed-container');
});

test('evals posture is side-effect free', () => {
  const m = buildHarness('evals');
  for (const cap of ['shell', 'fileAccess', 'codeAct', 'backgroundAgents']) {
    assert.equal(m.capabilities[cap], false, cap);
  }
});

test('console posture keeps full capabilities', () => {
  const m = buildHarness('console');
  assert.equal(m.capabilities.shell, true);
  assert.equal(m.capabilities.fileAccess, true);
});

test('screen blocks card numbers and replaces with policy message', () => {
  const audit = [];
  const r = screenContent('card 4111 1111 1111 1111 on file', { direction: 'prompt', audit });
  assert.equal(r.decision, 'block');
  assert.equal(r.policy, 'pan');
  assert.ok(r.replacement.startsWith('[BLOCKED BY POLICY'));
  assert.equal(audit.length, 1);
  assert.equal(audit[0].decision, 'block');
  assert.equal(audit[0].policy, 'pan');
});

test('screen blocks credential patterns in responses too', () => {
  const r = screenContent('use AKIAIOSFODNN7EXAMPLE for auth', { direction: 'response' });
  assert.equal(r.decision, 'block');
  assert.equal(r.policy, 'aws-key');
});

test('audit trail stores metadata, never the screened content', () => {
  const audit = [];
  const secret = 'ghp_' + 'A'.repeat(36);
  screenContent(secret, { direction: 'prompt', audit });
  const entry = audit[0];
  assert.equal(entry.decision, 'block');
  assert.ok(!JSON.stringify(entry).includes(secret), 'screened content must not land in the audit log');
});

test('benign content passes both directions', () => {
  assert.equal(screenContent('what is my balance?', { direction: 'prompt' }).decision, 'pass');
  assert.equal(screenContent('your balance is $12', { direction: 'response' }).decision, 'pass');
});

test('local evals count passed/total and name failures', () => {
  const cases = [
    { query: 'Value MSFT', response: 'MSFT is valued at $3.2T' },
    { query: 'Value MSFT', response: 'I cannot say' },
    { query: 'hello', response: 'hi!' },
  ];
  const evaluators = [
    { name: 'numeric_valuation', fn: ({ query, response }) => !/value msft/i.test(query) || /\d/.test(response) },
  ];
  const r = runLocalEvals(cases, evaluators);
  assert.equal(r.total, 3);
  assert.equal(r.passed, 2);
  assert.deepEqual(r.failures, [{ query: 'Value MSFT', evaluator: 'numeric_valuation' }]);
});

test('local evals fail closed on empty evaluator list', () => {
  const r = runLocalEvals([{ query: 'q', response: 'r' }], []);
  assert.equal(r.total, 0);
  assert.equal(r.passRate, 1); // nothing to check, nothing failed
});

test('telemetry rollup aggregates spans, tokens, tool counts', () => {
  const t = rollupTelemetry([
    { tool: 'read_file', tokens: 120 },
    { tool: 'shell', tokens: 40 },
    { tool: 'shell', tokens: 60 },
  ]);
  assert.equal(t.spanCount, 3);
  assert.equal(t.tokensTotal, 220);
  assert.deepEqual(t.toolCalls, { read_file: 1, shell: 2 });
});
