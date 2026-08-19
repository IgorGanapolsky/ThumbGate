'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sprawl = require('../scripts/rule-sprawl');
const { DEMO_RULES, DEFAULT_BUDGETS } = require('../scripts/budget-aware-gates-proof');

test('runRuleSprawl drops noise and refuses load-all', () => {
  const report = sprawl.runRuleSprawl({ solverOpts: { pythonBin: '/no/such/python' } });
  assert.equal(report.schema, sprawl.SCHEMA);
  assert.equal(report.summary.ok, true, report.summary.failures.join('; '));
  assert.equal(report.autoApply, false);
  assert.equal(report.humanOversightRequired, true);
  assert.equal(report.reviewVolumeIsNotTheControl, true);
  assert.equal(report.capturedRevenueUsd, 0);
  assert.equal(report.affiliation, 'none');
  assert.equal(report.process.unifiedAlertManager, false);
  assert.ok(report.overBudgetIfLoadAll);
  assert.ok(report.knapsackWithinBudget);
  assert.ok(report.sprawlRatio > 1);
  assert.ok(report.knapsack.count < report.loadAll.count);
  assert.ok(report.noiseDropped.includes('low-value-noise-rule'));
  assert.ok(!report.knapsack.selected.includes('low-value-noise-rule'));
});

test('costOf load-all exceeds the demo eval/token budget', () => {
  const all = sprawl.costOf(DEMO_RULES);
  assert.equal(all.count, DEMO_RULES.length);
  assert.ok(
    all.timeMs > DEFAULT_BUDGETS.maxEvalTimeMs
    || all.tokens > DEFAULT_BUDGETS.maxTokenFootprint
  );
});

test('report never claims OpenSearch, PPL, or New Stack affiliation', () => {
  const report = sprawl.runRuleSprawl({ solverOpts: { pythonBin: '/no/such/python' } });
  assert.equal(report.affiliation, 'none');
  assert.equal(report.process.unifiedAlertManager, false);
  assert.match(report.process.source, /not OpenSearch/i);
  assert.ok(
    report.disclaimers.some((d) => /not OpenSearch/i.test(d)),
    'disclaimer must say we are not OpenSearch'
  );
  const blob = JSON.stringify(report);
  assert.equal(
    /"unifiedAlertManager":\s*true/.test(blob),
    false,
    'must not claim Unified Alert Manager as a product'
  );
  assert.ok(!/"affiliation":\s*"(The New Stack|OpenSearch|AWS)"/i.test(blob));
  assert.ok(!/apache 2\.0 ingestion/i.test(blob));
  assert.ok(!/bugs (up|rose|increased) 54%/i.test(blob));
  assert.match(blob, /Review volume is not the control/);
});

test('formatReport and mainCli --json --write', () => {
  const report = sprawl.runRuleSprawl({ solverOpts: { pythonBin: '/no/such/python' } });
  const md = sprawl.formatReport(report);
  assert.match(md, /Rule sprawl vs eval budget/);
  assert.match(md, /Load-all/);
  assert.match(md, /Knapsack/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-sprawl-'));
  const out = path.join(dir, 'sprawl.json');
  const code = sprawl.mainCli(['--json', '--write', out]);
  assert.equal(code, 0);
  assert.ok(fs.existsSync(out));
  const parsed = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(parsed.summary.ok, true);
  assert.equal(parsed.capturedRevenueUsd, 0);
});

test('fixture that already fits the budget is not a sprawl pass', () => {
  const tiny = [
    { id: 'secret-egress', risk_mitigation: 9.5, eval_time_ms: 4, token_footprint: 80 },
  ];
  const report = sprawl.runRuleSprawl({
    rules: tiny,
    maxEvalTimeMs: 50,
    maxTokenFootprint: 1000,
    solverOpts: { pythonBin: '/no/such/python' },
  });
  assert.equal(report.summary.ok, false);
  assert.ok(report.summary.failures.some((f) => /not a sprawl case/.test(f)));
});
