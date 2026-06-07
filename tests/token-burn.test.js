'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const {
  collectTokenBurnEvents,
  computeTokenBurnDashboard,
  normalizeTokenUsageEvent,
} = require(path.join(ROOT, 'scripts', 'token-burn'));

describe('token burn normalization', () => {
  test('normalizes provider usage shapes without sample data', () => {
    const event = normalizeTokenUsageEvent({
      timestamp: '2026-06-07T12:00:00.000Z',
      model: 'claude-sonnet-4-5',
      provider: 'anthropic',
      usage: {
        input_tokens: 1000,
        output_tokens: 250,
      },
    });

    assert.equal(event.dayKey, '2026-06-07');
    assert.equal(event.model, 'claude-sonnet-4-5');
    assert.equal(event.provider, 'anthropic');
    assert.equal(event.inputTokens, 1000);
    assert.equal(event.outputTokens, 250);
    assert.equal(event.totalTokens, 1250);
    assert.ok(event.estimatedCostUsd > 0);
    assert.equal(event.hasUsage, true);
  });

  test('accepts tokenEstimate/costUsd when provider tokens are unavailable', () => {
    const event = normalizeTokenUsageEvent({
      timestamp: '2026-06-07T12:00:00.000Z',
      tokenEstimate: 42000,
      costUsd: 0.42,
    });

    assert.equal(event.totalTokens, 42000);
    assert.equal(event.estimatedCostUsd, 0.42);
    assert.equal(event.model, 'unknown');
  });

  test('uses blended pricing for unlabeled prompt/completion tokens', () => {
    const event = normalizeTokenUsageEvent({
      timestamp: '2026-06-07T12:00:00.000Z',
      model: 'not-in-price-table',
      usage: {
        promptTokens: 2000,
        completionTokens: 1000,
      },
    });

    assert.equal(event.model, 'not-in-price-table');
    assert.equal(event.inputTokens, 2000);
    assert.equal(event.outputTokens, 1000);
    assert.equal(event.totalTokens, 3000);
    assert.ok(event.estimatedCostUsd > 0);
  });

  test('normalizes empty text and invalid timestamps without fake usage', () => {
    const event = normalizeTokenUsageEvent({
      timestamp: 'not-a-date',
      model: '   ',
      provider: null,
      usage: {},
    });

    assert.equal(event.timestamp, 'not-a-date');
    assert.equal(event.dayKey, null);
    assert.equal(event.model, 'unknown');
    assert.equal(event.provider, 'unknown');
    assert.equal(event.hasUsage, false);
  });
});

describe('computeTokenBurnDashboard', () => {
  test('builds daily burn, top days, and model distribution', () => {
    const burn = computeTokenBurnDashboard([
      {
        timestamp: '2026-06-06T10:00:00.000Z',
        model: 'claude-sonnet-4-5',
        usage: { input_tokens: 1000, output_tokens: 500 },
      },
      {
        timestamp: '2026-06-07T10:00:00.000Z',
        model: 'gpt-4o',
        usage: { input_tokens: 3000, output_tokens: 1000 },
      },
    ], {
      now: new Date('2026-06-07T23:00:00.000Z'),
      windowDays: 2,
      tokenSavings: { blockedCalls: 0 },
    });

    assert.equal(burn.available, true);
    assert.equal(burn.windowDays, 2);
    assert.equal(burn.trackedEvents, 2);
    assert.equal(burn.totalTokens, 5500);
    assert.equal(burn.days.length, 2);
    assert.equal(burn.topDays[0].dayKey, '2026-06-07');
    assert.deepEqual(burn.modelDistribution.map((row) => row.model), ['gpt-4o', 'claude-sonnet-4-5']);
    assert.ok(burn.weeklyReview.recommendations.length > 0);
  });

  test('returns honest unavailable state when no token traces exist', () => {
    const burn = computeTokenBurnDashboard([], {
      now: new Date('2026-06-07T23:00:00.000Z'),
      windowDays: 3,
    });

    assert.equal(burn.available, false);
    assert.equal(burn.totalTokens, 0);
    assert.equal(burn.estimatedCostDisplay, '$0.00');
    assert.equal(burn.days.length, 3);
    assert.match(burn.weeklyReview.recommendations[0].action, /Instrument/);
  });

  test('recommends model labeling when unknown burn dominates', () => {
    const burn = computeTokenBurnDashboard([
      {
        timestamp: '2026-06-07T10:00:00.000Z',
        tokenEstimate: 9000,
      },
      {
        timestamp: '2026-06-07T11:00:00.000Z',
        model: 'claude-sonnet-4-5',
        usage: { input_tokens: 1000, output_tokens: 0 },
      },
    ], {
      now: new Date('2026-06-07T23:00:00.000Z'),
      windowDays: 1,
      tokenSavings: { blockedCalls: 1 },
    });

    assert.equal(burn.modelDistribution[0].model, 'unknown');
    assert.ok(
      burn.weeklyReview.recommendations.some((item) => item.action === 'Label model/provider usage'),
      'unknown-dominant burn should ask for model/provider labels',
    );
  });

  test('keeps weekly review low-severity when burn is labeled and distributed', () => {
    const burn = computeTokenBurnDashboard([
      {
        timestamp: '2026-06-05T10:00:00.000Z',
        model: 'claude-sonnet-4-5',
        usage: { input_tokens: 1000, output_tokens: 1000 },
      },
      {
        timestamp: '2026-06-06T10:00:00.000Z',
        model: 'claude-sonnet-4-5',
        usage: { input_tokens: 1000, output_tokens: 1000 },
      },
      {
        timestamp: '2026-06-07T10:00:00.000Z',
        model: 'claude-sonnet-4-5',
        usage: { input_tokens: 1000, output_tokens: 1000 },
      },
    ], {
      now: new Date('2026-06-07T23:00:00.000Z'),
      windowDays: 3,
      tokenSavings: { blockedCalls: 2 },
    });

    assert.deepEqual(burn.weeklyReview.recommendations, [{
      severity: 'low',
      action: 'Keep reviewing weekly',
      rationale: 'No obvious token-burn hotspot crossed the current thresholds.',
    }]);
  });
});

describe('collectTokenBurnEvents', () => {
  test('collects global and project token traces plus budget ledger entries', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-token-burn-'));
    const projectDir = path.join(tempDir, 'projects', 'repo-a');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'token-usage.jsonl'),
      `${JSON.stringify({ timestamp: '2026-06-07T12:00:00.000Z', tokenEstimate: 1000 })}\n`,
    );
    fs.writeFileSync(
      path.join(projectDir, 'delegation-log.jsonl'),
      `${JSON.stringify({ timestamp: '2026-06-07T13:00:00.000Z', tokenEstimate: 2000 })}\n`,
    );
    fs.writeFileSync(
      path.join(tempDir, 'budget-ledger.json'),
      JSON.stringify({
        months: {
          '2026-06': {
            totalUsd: 0.25,
            entries: [{ ts: '2026-06-07T14:00:00.000Z', amountUsd: 0.25, source: 'agent-tool:Bash' }],
          },
        },
      }),
    );

    const events = collectTokenBurnEvents(tempDir);
    assert.equal(events.length, 3);
    assert.ok(events.some((event) => event.__sourceFile === 'token-usage.jsonl'));
    assert.ok(events.some((event) => event.__sourceFile === 'delegation-log.jsonl'));
    assert.ok(events.some((event) => event.__sourceFile === 'budget-ledger.json'));

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('ignores malformed JSONL rows and malformed budget ledgers', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-token-burn-bad-'));
    fs.writeFileSync(
      path.join(tempDir, 'token-usage.jsonl'),
      [
        JSON.stringify({ timestamp: '2026-06-07T12:00:00.000Z', tokenEstimate: 1000 }),
        '{not-json',
      ].join('\n'),
    );
    fs.writeFileSync(path.join(tempDir, 'budget-ledger.json'), '{not-json');

    const events = collectTokenBurnEvents(tempDir);
    assert.equal(events.length, 1);
    assert.equal(events[0].tokenEstimate, 1000);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
