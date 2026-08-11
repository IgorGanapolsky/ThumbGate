'use strict';

/**
 * Tests for the bulkCloud cost-saver tier.
 *
 * The tier routes steady high-output task types (bulk generation, batch
 * processing) to a cheap OpenAI-compatible cloud flagship (Qwen3.8-Max class)
 * instead of the frontier tier, and derives real per-token cost telemetry from
 * declared pricing. Modeled on managed token-plan economics where a capable
 * bulk model costs a fraction of frontier output pricing.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  TIERS,
  TIER_ROUTING_ORDER,
  classifyTask,
  estimateTierCostUsd,
  executeRoutedGeneration,
  shouldEscalate,
} = require('../scripts/model-tier-router');

describe('bulkCloud tier routing', () => {
  test('bulk task types route to bulkCloud without escalation', () => {
    for (const type of ['bulk-generation', 'batch-processing', 'high-output-coding']) {
      const result = classifyTask({ type });
      assert.equal(result.tier, 'bulkCloud', `${type} should route to bulkCloud`);
      assert.equal(result.escalated, false);
    }
  });

  test('existing tier mappings are unchanged', () => {
    assert.equal(classifyTask({ type: 'classification' }).tier, 'nano');
    assert.equal(classifyTask({ type: 'code-edit' }).tier, 'mini');
    assert.equal(classifyTask({ type: 'architecture' }).tier, 'frontier');
    assert.equal(classifyTask({ type: 'totally-unknown-type' }).tier, 'mini');
  });

  test('bulk tasks still escalate to frontier on architecture tags', () => {
    const result = classifyTask({ type: 'bulk-generation', tags: ['architecture'] });
    assert.equal(result.tier, 'frontier');
    assert.equal(result.escalated, true);
    // classifyTask folds tag escalation into classification, so shouldEscalate
    // reports the task already sitting on frontier with no further move needed.
    const escalation = shouldEscalate({ type: 'bulk-generation', tags: ['cross-file'] });
    assert.equal(escalation.escalate, false);
    assert.equal(escalation.from, 'frontier');
    assert.equal(escalation.to, 'frontier');
  });

  test('bulkCloud is declared in TIERS and routing order ahead of frontier', () => {
    assert.ok(TIERS.bulkCloud);
    assert.equal(TIERS.bulkCloud.costMultiplier < TIERS.frontier.costMultiplier, true);
    assert.ok(TIER_ROUTING_ORDER.indexOf('bulkCloud') > TIER_ROUTING_ORDER.indexOf('mini'));
    assert.ok(TIER_ROUTING_ORDER.indexOf('bulkCloud') < TIER_ROUTING_ORDER.indexOf('frontier'));
  });
});

describe('per-token cost estimation', () => {
  test('estimateTierCostUsd derives cost from declared pricing', () => {
    // bulkCloud declares $2/M input, $6/M output.
    assert.equal(estimateTierCostUsd('bulkCloud', 1_000_000, 1_000_000), 8);
    assert.equal(estimateTierCostUsd('bulkCloud', 500_000, 0), 1);
    assert.equal(estimateTierCostUsd('bulkCloud', 0, 0), 0);
  });

  test('tiers without declared pricing return null', () => {
    assert.equal(estimateTierCostUsd('nano', 1000, 1000), null);
    assert.equal(estimateTierCostUsd('does-not-exist', 1000, 1000), null);
  });
});

describe('routed generation through the bulkCloud endpoint', () => {
  const env = {
    THUMBGATE_BULK_CLOUD_BASE_URL: 'https://bulk.example.test/v1',
    THUMBGATE_BULK_CLOUD_API_KEY: 'test-credential-value',
  };

  test('bulk generation uses the tier endpoint and computes cost telemetry', async () => {
    let seenEndpoint = null;
    const adapters = {
      'openai-compatible': async ({ endpoint }) => {
        seenEndpoint = endpoint;
        return {
          text: 'ok',
          usage: { prompt_tokens: 1000, completion_tokens: 2000 },
        };
      },
    };
    const events = [];
    const result = await executeRoutedGeneration(
      { type: 'bulk-generation' },
      { prompt: 'generate the batch' },
      { env, adapters, telemetrySink: (event) => events.push(event) },
    );
    assert.equal(result.route.tier, 'bulkCloud');
    assert.equal(seenEndpoint.baseUrl, env.THUMBGATE_BULK_CLOUD_BASE_URL);
    // (1000 * $2/M + 2000 * $6/M) = $0.014 = 1.4 cents
    assert.equal(result.telemetry.costCents, 1.4);
    assert.equal(events.length, 1);
    assert.equal(events[0].costCents, 1.4);
    assert.equal(events[0].tier, 'bulkCloud');
  });

  test('routing a bulk task without endpoint config names the missing variables', async () => {
    await assert.rejects(
      () => executeRoutedGeneration({ type: 'bulk-generation' }, { prompt: 'x' }, { env: {} }),
      /THUMBGATE_BULK_CLOUD_BASE_URL/,
    );
  });

  test('adapter-reported cost is preserved over derived pricing', async () => {
    const adapters = {
      'openai-compatible': async () => ({
        text: 'ok',
        costCents: 9.9,
        usage: { prompt_tokens: 1000, completion_tokens: 1000 },
      }),
    };
    const result = await executeRoutedGeneration(
      { type: 'batch-processing' },
      { prompt: 'x' },
      { env, adapters },
    );
    assert.equal(result.telemetry.costCents, 9.9);
  });
});
