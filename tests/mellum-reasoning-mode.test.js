'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { recommendReasoningMode, recommendExecutionPlan } = require('../scripts/model-tier-router');
const { resolveModelRole, MELLUM_MODEL_ROLES, VALID_MODEL_ROLES } = require('../scripts/local-model-profile');

test('routine agent work runs without a reasoning step', () => {
  for (const type of ['code-edit', 'tool-use', 'extraction', 'classification', 'unknown-thing']) {
    const r = recommendReasoningMode({ type });
    assert.equal(r.mode, 'instruct', type);
    assert.equal(r.modelRole, 'normal', type);
  }
});

test('investigation and hard problems keep thinking', () => {
  for (const type of ['debugging', 'complex-debugging', 'architecture', 'algorithmic', 'math']) {
    assert.equal(recommendReasoningMode({ type }).mode, 'thinking', type);
  }
  assert.equal(recommendReasoningMode({ type: 'code-edit', tags: ['hard'] }).mode, 'thinking');
});

test('repeated instruct failures switch to thinking', () => {
  assert.equal(recommendReasoningMode({ type: 'code-edit', retryCount: 1 }).mode, 'instruct');
  assert.equal(recommendReasoningMode({ type: 'code-edit', retryCount: 2 }).mode, 'thinking');
});

test('an explicit routine or sub-agent tag wins over thinking signals', () => {
  const r = recommendReasoningMode({ type: 'architecture', tags: ['sub-agent'] });
  assert.equal(r.mode, 'instruct');
});

test('execution plan carries the reasoning mode', () => {
  const plan = recommendExecutionPlan({ type: 'code-edit' }, {});
  assert.equal(plan.reasoningMode, 'instruct');
  assert.equal(plan.reasoningModelRole, 'normal');
  assert.match(plan.reasoningReason, /routine/);
  assert.equal(recommendExecutionPlan({ type: 'complex-debugging' }, {}).reasoningMode, 'thinking');
});

test('mellum family maps roles to open-weights Instruct and Thinking models', () => {
  for (const role of VALID_MODEL_ROLES) assert.ok(MELLUM_MODEL_ROLES[role], role);
  const env = { THUMBGATE_LOCAL_MODEL_FAMILY: 'mellum' };
  const normal = resolveModelRole('normal', env);
  assert.equal(normal.provider, 'local');
  assert.equal(normal.model, 'JetBrains/Mellum2.1-12B-A2.5B-Instruct');
  assert.equal(resolveModelRole('thinking', env).model, 'JetBrains/Mellum2.1-12B-A2.5B-Thinking');
  assert.equal(resolveModelRole('normal', { ...env, THUMBGATE_MODEL_ROLE_NORMAL: 'my-gguf' }).model, 'my-gguf');
});

test('mellum is not selected without the family env', () => {
  assert.notEqual(resolveModelRole('normal', {}).model, MELLUM_MODEL_ROLES.normal);
});

test('local generation dispatches the Instruct or Thinking model the plan picked', async () => {
  const { executeRoutedGeneration } = require('../scripts/model-tier-router');
  const env = {
    THUMBGATE_PROVIDER_MODE: 'local',
    THUMBGATE_LOCAL_MODEL_FAMILY: 'mellum',
    THUMBGATE_LOCAL_MODEL_BASE_URL: 'http://127.0.0.1:9000/v1',
  };
  const sent = [];
  const fetchImpl = async (_url, options) => {
    sent.push(JSON.parse(options.body).model);
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
  };
  await executeRoutedGeneration({ type: 'code-edit', privacyRoute: 'local' }, { userPrompt: 'x' }, { env, fetchImpl });
  await executeRoutedGeneration({ type: 'code-edit', privacyRoute: 'local', retryCount: 2 }, { userPrompt: 'x' }, { env, fetchImpl });
  assert.deepEqual(sent, [
    'JetBrains/Mellum2.1-12B-A2.5B-Instruct',
    'JetBrains/Mellum2.1-12B-A2.5B-Thinking',
  ]);
});
