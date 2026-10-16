'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  THUMBGATE_SOURCE,
  resolveSafeJulesUrl,
  buildJulesCreateSessionPayload,
  unblockWaitingJulesSession,
  dispatchThumbGateJulesSession,
} = require('../scripts/jules-cloud-fleet-dispatcher');

test('buildJulesCreateSessionPayload & resolveSafeJulesUrl: enforces origin pinning and ThumbGate parity guardrails', () => {
  const payload = buildJulesCreateSessionPayload({
    title: 'Wire OpenRouter Armor & Profound CLI subcommands',
    taskInstructions: 'Add armor-compile and profound-aeo commands to bin/thumbgate.js.',
  });

  assert.equal(payload.sourceContext.source, THUMBGATE_SOURCE);
  assert.equal(payload.requirePlanApproval, false);
  assert.equal(payload.automationMode, 'AUTO_CREATE_PR');
  assert.throws(() => resolveSafeJulesUrl('https://evil.example.com/sessions'), /relative v1alpha path/);
});

test('dispatchThumbGateJulesSession & unblockWaitingJulesSession: routes AWAITING_PLAN_APPROVAL to approvePlan without duplicate sendMessage', async () => {
  const calls = [];
  const mockFetch = async (url, opts) => {
    calls.push({ url, method: opts.method, headers: opts.headers, body: opts.body ? JSON.parse(opts.body) : null });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ name: 'sessions/999', state: 'QUEUED', url: 'https://jules.google.com/session/999' }),
    };
  };

  const created = await dispatchThumbGateJulesSession({
    title: 'Audit S7727 array map callbacks',
    taskInstructions: 'Check scripts/ for multi-arg map callbacks.',
    apiKey: 'test_jules_key',
    fetchImpl: mockFetch,
  });
  assert.equal(created.name, 'sessions/999');

  await unblockWaitingJulesSession('sessions/111', 'Unused message', {
    sessionState: 'AWAITING_PLAN_APPROVAL',
    apiKey: 'test_jules_key',
    fetchImpl: mockFetch,
  });
  assert.equal(calls.filter((c) => c.url.includes('sessions/111')).length, 1);
  assert.ok(calls[1].url.endsWith('/sessions/111:approvePlan'));
});
