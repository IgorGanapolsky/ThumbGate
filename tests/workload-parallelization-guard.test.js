'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WorkloadParallelizationGuard } = require('../src/workload-parallelization-guard');
const { CentralizedTraceSampler } = require('../src/centralized-trace-sampler');

test('WorkloadParallelizationGuard rejects parallelization when bottleneck dominates or traffic is low', () => {
  const guard = new WorkloadParallelizationGuard({
    bottleneckDominanceThreshold: 0.70,
    minTrafficDistributionThreshold: 0.05,
  });

  // Scenario 1: Dominant bottleneck (e.g. 900ms task with two 50ms tasks)
  const dominatedProposal = {
    name: 'fetch-user-and-metadata',
    tasks: [
      { name: 'fetch-heavy-db-record', durationMs: 900, trafficFraction: 1.0 },
      { name: 'fetch-user-avatar', durationMs: 50, trafficFraction: 1.0 },
      { name: 'fetch-cached-flags', durationMs: 50, trafficFraction: 1.0 },
    ],
  };

  const eval1 = guard.evaluateParallelizationProposal(dominatedProposal);
  assert.equal(eval1.approved, false);
  assert.equal(eval1.verdict, 'REJECT_PARALLELIZATION');
  assert.ok(eval1.warnings.some((w) => w.includes('Bottleneck Dominance')));

  // Scenario 2: Low-traffic task (triggered by 1% of users)
  const lowTrafficProposal = {
    name: 'enrich-order',
    tasks: [
      { name: 'calc-tax', durationMs: 150, trafficFraction: 1.0 },
      { name: 'calc-custom-shipping', durationMs: 120, trafficFraction: 0.01 }, // only 1%
    ],
  };

  const eval2 = guard.evaluateParallelizationProposal(lowTrafficProposal);
  assert.equal(eval2.approved, false);
  assert.ok(eval2.warnings.some((w) => w.includes('Low Traffic Distribution')));

  // Scenario 3: Healthy balanced parallelization
  const goodProposal = {
    name: 'parallel-doc-parsers',
    tasks: [
      { name: 'parse-pdf-text', durationMs: 300, trafficFraction: 0.8 },
      { name: 'extract-ocr-images', durationMs: 280, trafficFraction: 0.8 },
      { name: 'index-metadata', durationMs: 250, trafficFraction: 0.8 },
    ],
  };

  const eval3 = guard.evaluateParallelizationProposal(goodProposal);
  assert.equal(eval3.approved, true);
  assert.equal(eval3.verdict, 'APPROVE_PARALLELIZATION');
  assert.ok(eval3.theoreticalSpeedupPct > 40);
});

test('CentralizedTraceSampler lints scattered sampling and evaluates root decisions', () => {
  const sampler = new CentralizedTraceSampler({ samplingRate: 0.5 });

  // Critical path override
  const critical = sampler.shouldSampleTrace('trace-123', '/api/checkout');
  assert.equal(critical.sample, true);
  assert.equal(critical.reason, 'CRITICAL_PATH_OVERRIDE');

  // Linting scattered sampling right before export
  const dirtyCode = `
function exportSpans(spans) {
  if (Math.random() < 0.1) {
    datadog.sendTrace(spans);
  }
}
`;
  const lintResult = sampler.lintInstrumentation(dirtyCode);
  assert.equal(lintResult.clean, false);
  assert.equal(lintResult.findings.length, 1);
  assert.equal(lintResult.findings[0].severity, 'ERROR');
});
