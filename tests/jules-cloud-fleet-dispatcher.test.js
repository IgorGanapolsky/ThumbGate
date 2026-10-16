'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  THUMBGATE_SOURCE,
  buildHardenedThumbGateJulesPrompt,
  buildJulesCreateSessionPayload,
  unblockWaitingJulesSession,
  dispatchThumbGateJulesSession,
} = require('../scripts/jules-cloud-fleet-dispatcher');

test('buildJulesCreateSessionPayload: sets requirePlanApproval=false, AUTO_CREATE_PR, and injects ThumbGate parity guardrails', () => {
  const payload = buildJulesCreateSessionPayload({
    title: 'Wire OpenRouter Armor & Profound CLI subcommands',
    taskInstructions: 'Add armor-compile and profound-aeo commands to bin/thumbgate.js.',
  });

  assert.equal(payload.sourceContext.source, THUMBGATE_SOURCE);
  assert.equal(payload.requirePlanApproval, false);
  assert.equal(payload.automationMode, 'AUTO_CREATE_PR');
  assert.ok(payload.prompt.includes('tests/test-suite-parity.test.js'));
  assert.ok(payload.prompt.includes('tests/package-boundary.test.js'));
  assert.ok(payload.prompt.includes('SonarCloud S7727'));
});

test('dispatchThumbGateJulesSession & unblockWaitingJulesSession: call Jules v1alpha REST endpoints with X-Goog-Api-Key', async () => {
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
  assert.equal(calls[0].headers['X-Goog-Api-Key'], 'test_jules_key');
  assert.equal(calls[0].body.automationMode, 'AUTO_CREATE_PR');

  await unblockWaitingJulesSession('sessions/6172228976209006178', 'Proceed with the plan.', {
    apiKey: 'test_jules_key',
    fetchImpl: mockFetch,
  });
  assert.ok(calls.some((c) => c.url.endsWith('/sessions/6172228976209006178:sendMessage')));
});
