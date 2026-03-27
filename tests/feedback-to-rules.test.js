'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { parseFeedbackFile, classifySignal, analyze, toRules, normalize } = require('../scripts/feedback-to-rules');

describe('feedback-to-rules', () => {
  it('classifySignal returns negative for known negative signals', () => {
    assert.strictEqual(classifySignal({ signal: 'down' }), 'negative');
    assert.strictEqual(classifySignal({ signal: 'thumbs_down' }), 'negative');
    assert.strictEqual(classifySignal({ signal: 'negative_strong' }), 'negative');
  });

  it('classifySignal returns positive for known positive signals', () => {
    assert.strictEqual(classifySignal({ signal: 'up' }), 'positive');
    assert.strictEqual(classifySignal({ signal: 'thumbs_up' }), 'positive');
  });

  it('classifySignal returns null for unknown signals', () => {
    assert.strictEqual(classifySignal({ signal: 'maybe' }), null);
    assert.strictEqual(classifySignal({}), null);
  });

  it('normalize strips user paths and port numbers', () => {
    const result = normalize('/Users/someuser/code/app:3000 error');
    assert.ok(!result.includes('/Users/someuser'));
    assert.ok(!result.includes(':3000'));
    assert.ok(result.includes('~/code/app'));
  });

  it('analyze computes correct positive/negative counts', () => {
    const entries = [
      { signal: 'up', context: 'good job' },
      { signal: 'down', context: 'this is a long enough context string to pass threshold', tool_name: 'Bash' },
      { signal: 'down', context: 'this is a long enough context string to pass threshold', tool_name: 'Bash' },
      { signal: 'up', context: 'nice' },
    ];
    const report = analyze(entries);
    assert.strictEqual(report.positiveCount, 2);
    assert.strictEqual(report.negativeCount, 2);
    assert.strictEqual(report.totalFeedback, 4);
    assert.strictEqual(report.negativeRate, '50.0%');
  });

  it('toRules generates markdown with recurring issues', () => {
    const report = {
      generatedAt: '2026-01-01T00:00:00.000Z',
      negativeRate: '50.0%',
      negativeCount: 2,
      totalFeedback: 4,
      recurringIssues: [
        { severity: 'high', count: 3, suggestedRule: 'NEVER do bad thing' },
      ],
    };
    const rules = toRules(report);
    assert.ok(rules.includes('# Suggested Rules'));
    assert.ok(rules.includes('[HIGH]'));
    assert.ok(rules.includes('NEVER do bad thing'));
  });
});
