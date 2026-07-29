'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  parseFeedbackFile, classifySignal, analyze, toRules, normalize,
  isConcreteRule, writeRulesMarkdown,
} = require('../scripts/feedback-to-rules');

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

  it('isConcreteRule rejects placeholder and clause-free rules', () => {
    assert.strictEqual(isConcreteRule({ suggestedRule: 'NEVER push directly to main' }), true);
    assert.strictEqual(isConcreteRule({ suggestedRule: 'ALWAYS run gh pr view before claiming done' }), true);
    assert.strictEqual(isConcreteRule({ suggestedRule: 'Investigate and prevent recurrence' }), false);
    assert.strictEqual(isConcreteRule({ suggestedRule: 'NEVER Investigate and prevent recurrence' }), false);
    assert.strictEqual(isConcreteRule({ suggestedRule: 'something vague happened' }), false);
    assert.strictEqual(isConcreteRule({}), false);
  });

  it('writeRulesMarkdown persists rules to the injected dir and excludes placeholders', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-rules-'));
    try {
      const report = {
        generatedAt: '2026-01-01T00:00:00.000Z',
        negativeRate: '50.0%',
        negativeCount: 2,
        totalFeedback: 4,
        recurringIssues: [
          { severity: 'critical', count: 3, suggestedRule: 'NEVER force push to main' },
          { severity: 'high', count: 2, suggestedRule: 'Investigate and prevent recurrence' },
        ],
      };
      const written = writeRulesMarkdown(report, dir);
      assert.strictEqual(written, path.join(dir, 'prevention-rules.md'));
      const content = fs.readFileSync(written, 'utf8');
      assert.ok(content.includes('NEVER force push to main'));
      assert.ok(!content.includes('Investigate and prevent recurrence'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--rules CLI writes prevention-rules.md next to the log and prints the path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-rules-cli-'));
    try {
      const logPath = path.join(dir, 'feedback-log.jsonl');
      const entries = [
        { signal: 'down', context: 'agent pushed force to main branch destroying history', tool_name: 'Bash', tags: ['force-push'] },
      ];
      fs.writeFileSync(logPath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');

      const script = path.join(__dirname, '..', 'scripts', 'feedback-to-rules.js');
      const result = spawnSync(process.execPath, [script, logPath, '--rules'], {
        encoding: 'utf8',
        env: { ...process.env, THUMBGATE_FEEDBACK_DIR: dir },
      });
      assert.strictEqual(result.status, 0, result.stderr);
      const rulesPath = path.join(dir, 'prevention-rules.md');
      assert.ok(result.stdout.includes(`wrote ${rulesPath}`), `stdout missing wrote line: ${result.stdout}`);
      assert.ok(fs.existsSync(rulesPath), 'prevention-rules.md should be written');
      assert.ok(fs.readFileSync(rulesPath, 'utf8').includes('# Suggested Rules'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
