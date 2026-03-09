const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createTrace,
  addStep,
  addEdgeCase,
  computeControllability,
  finalizeTrace,
  traceForSelfHealFix,
  traceForDpoPair,
  traceForProofCheck,
  aggregateTraces,
  DEFAULT_CONFIDENCE_THRESHOLD,
} = require('../scripts/code-reasoning');

test('createTrace produces valid structure', () => {
  const trace = createTrace('self-heal', 'lint:fix');
  assert.ok(trace.traceId.startsWith('trace-'));
  assert.equal(trace.type, 'self-heal');
  assert.equal(trace.subject, 'lint:fix');
  assert.deepEqual(trace.steps, []);
  assert.deepEqual(trace.edgeCases, []);
  assert.equal(trace.summary, null);
});

test('addStep validates required fields', () => {
  const trace = createTrace('verification', 'test');
  assert.throws(() => addStep(trace, { claim: 'no location' }), /location/);
  assert.throws(() => addStep(trace, { location: 'file.js:1' }), /claim/);
  assert.throws(
    () => addStep(trace, { location: 'file.js:1', claim: 'x', verdict: 'bogus' }),
    /Invalid verdict/,
  );
});

test('addStep appends to trace steps', () => {
  const trace = createTrace('verification', 'test');
  addStep(trace, { location: 'a.js:1', claim: 'first', evidence: 'ev1', verdict: 'verified' });
  addStep(trace, { location: 'b.js:2', claim: 'second', verdict: 'refuted' });
  assert.equal(trace.steps.length, 2);
  assert.equal(trace.steps[0].verdict, 'verified');
  assert.equal(trace.steps[1].evidence, '');
});

test('addEdgeCase appends descriptions', () => {
  const trace = createTrace('verification', 'test');
  addEdgeCase(trace, 'null input');
  addEdgeCase(trace, '');
  addEdgeCase(trace, 'timeout');
  assert.deepEqual(trace.edgeCases, ['null input', 'timeout']);
});

test('finalizeTrace computes correct summary', () => {
  const trace = createTrace('verification', 'test');
  addStep(trace, { location: 'a:1', claim: 'c1', verdict: 'verified' });
  addStep(trace, { location: 'a:2', claim: 'c2', verdict: 'verified' });
  addStep(trace, { location: 'a:3', claim: 'c3', verdict: 'unverified' });
  finalizeTrace(trace);

  assert.equal(trace.summary.totalSteps, 3);
  assert.equal(trace.summary.verified, 2);
  assert.equal(trace.summary.unverified, 1);
  assert.equal(trace.summary.refuted, 0);
  assert.ok(Math.abs(trace.summary.confidence - 0.667) < 0.01);
  assert.equal(trace.summary.passed, false); // 0.667 < 0.7 threshold
});

test('finalizeTrace passes when confidence meets threshold', () => {
  const trace = createTrace('verification', 'test');
  addStep(trace, { location: 'a:1', claim: 'c1', verdict: 'verified' });
  addStep(trace, { location: 'a:2', claim: 'c2', verdict: 'verified' });
  addStep(trace, { location: 'a:3', claim: 'c3', verdict: 'verified' });
  finalizeTrace(trace);
  assert.equal(trace.summary.confidence, 1);
  assert.equal(trace.summary.passed, true);
});

test('finalizeTrace fails if any step refuted even with high confidence', () => {
  const trace = createTrace('verification', 'test');
  addStep(trace, { location: 'a:1', claim: 'c1', verdict: 'verified' });
  addStep(trace, { location: 'a:2', claim: 'c2', verdict: 'verified' });
  addStep(trace, { location: 'a:3', claim: 'c3', verdict: 'verified' });
  addStep(trace, { location: 'a:4', claim: 'c4', verdict: 'refuted' });
  finalizeTrace(trace);
  assert.equal(trace.summary.confidence, 0.75);
  assert.equal(trace.summary.passed, false);
});

test('finalizeTrace handles empty trace', () => {
  const trace = createTrace('verification', 'test');
  finalizeTrace(trace);
  assert.equal(trace.summary.totalSteps, 0);
  assert.equal(trace.summary.confidence, 0);
  assert.equal(trace.summary.passed, false);
});

test('finalizeTrace accepts custom threshold', () => {
  const trace = createTrace('verification', 'test');
  addStep(trace, { location: 'a:1', claim: 'c1', verdict: 'verified' });
  addStep(trace, { location: 'a:2', claim: 'c2', verdict: 'unverified' });
  finalizeTrace(trace, { confidenceThreshold: 0.5 });
  assert.equal(trace.summary.passed, true);
});

test('DEFAULT_CONFIDENCE_THRESHOLD is 0.7', () => {
  assert.equal(DEFAULT_CONFIDENCE_THRESHOLD, 0.7);
});

test('traceForSelfHealFix — successful fix with changes', () => {
  const fix = {
    script: 'lint:fix',
    status: 'success',
    exitCode: 0,
    durationMs: 450,
    error: null,
    outputTail: 'Fixed 3 issues',
  };
  const trace = traceForSelfHealFix(fix, ['src/a.js', 'src/b.js']);
  assert.equal(trace.type, 'self-heal');
  assert.equal(trace.subject, 'lint:fix');
  assert.ok(trace.summary.passed);
  assert.equal(trace.summary.refuted, 0);
  assert.ok(trace.steps.length >= 3);
});

test('traceForSelfHealFix — failed fix', () => {
  const fix = {
    script: 'format',
    status: 'failed',
    exitCode: 1,
    durationMs: 200,
    error: 'spawn error',
    outputTail: 'Error: spawn error',
  };
  const trace = traceForSelfHealFix(fix, []);
  assert.equal(trace.summary.passed, false);
  assert.ok(trace.summary.refuted >= 1);
});

test('traceForSelfHealFix — success with error keywords in output', () => {
  const fix = {
    script: 'feedback:rules',
    status: 'success',
    exitCode: 0,
    durationMs: 100,
    error: null,
    outputTail: 'Warning: error patterns detected in feedback',
  };
  const trace = traceForSelfHealFix(fix, []);
  assert.ok(trace.steps.some((s) => s.verdict === 'unverified'));
});

test('traceForDpoPair — well-formed pair with rubric', () => {
  const pair = {
    prompt: 'Task domain: verification. How should the agent handle this scenario?',
    chosen: 'Run tests before claiming done',
    rejected: 'Claim done without tests',
    metadata: {
      errorId: 1,
      learningId: 10,
      matchScore: 2,
      overlapScore: 1,
      matchedKeys: ['verification'],
      errorTitle: 'MISTAKE: No test proof',
      learningTitle: 'SUCCESS: Always run tests',
      rubric: {
        learningWeightedScore: 0.89,
        errorWeightedScore: 0.32,
        weightedDelta: 0.57,
        errorFailingCriteria: ['verification_evidence'],
        learningFailingCriteria: [],
      },
    },
  };
  const trace = traceForDpoPair(pair);
  assert.equal(trace.type, 'dpo-pair');
  assert.ok(trace.summary.passed);
  assert.ok(trace.summary.confidence >= 0.7);
  assert.equal(trace.summary.refuted, 0);
  assert.ok(trace.edgeCases.length >= 2);
});

test('traceForDpoPair — pair without rubric', () => {
  const pair = {
    prompt: 'How should the agent respond?',
    chosen: 'Good response',
    rejected: 'Bad response',
    metadata: {
      errorId: 2,
      learningId: 11,
      matchScore: 1,
      overlapScore: 1,
      matchedKeys: ['api'],
      errorTitle: 'MISTAKE: Wrong API call',
      learningTitle: 'SUCCESS: Correct API call',
      rubric: null,
    },
  };
  const trace = traceForDpoPair(pair);
  assert.ok(trace.steps.some((s) => s.claim.includes('Rubric scores') && s.verdict === 'unverified'));
});

test('traceForDpoPair — pair with zero overlap is refuted', () => {
  const pair = {
    prompt: 'Short',
    chosen: 'x',
    rejected: 'y',
    metadata: {
      errorId: 3,
      learningId: 12,
      matchScore: 0,
      overlapScore: 0,
      matchedKeys: [],
      errorTitle: '',
      learningTitle: '',
      rubric: null,
    },
  };
  const trace = traceForDpoPair(pair);
  assert.ok(trace.summary.refuted >= 1);
  assert.equal(trace.summary.passed, false);
});

test('traceForProofCheck — passing check', () => {
  const trace = traceForProofCheck({
    name: 'api.healthz',
    passed: true,
    details: { status: 200 },
  });
  assert.equal(trace.type, 'proof-gate');
  assert.ok(trace.summary.passed);
  assert.equal(trace.summary.refuted, 0);
});

test('traceForProofCheck — failing check', () => {
  const trace = traceForProofCheck({
    name: 'api.auth.required',
    passed: false,
    details: { status: 200 },
  });
  assert.equal(trace.summary.passed, false);
  assert.ok(trace.summary.refuted >= 1);
});

test('computeControllability — empty trace scores 0', () => {
  const trace = createTrace('verification', 'test');
  const result = computeControllability(trace);
  assert.equal(result.score, 0);
  assert.deepEqual(result.flags, ['empty_trace']);
});

test('computeControllability — all-verified + no edge cases flags suspicion', () => {
  const trace = createTrace('verification', 'test');
  addStep(trace, { location: 'a:1', claim: 'c1', evidence: 'solid evidence here', verdict: 'verified' });
  addStep(trace, { location: 'a:2', claim: 'c2', evidence: 'more evidence here', verdict: 'verified' });
  addStep(trace, { location: 'a:3', claim: 'c3', evidence: 'good evidence here', verdict: 'verified' });
  const result = computeControllability(trace);
  assert.ok(result.flags.includes('all_verified'));
  assert.ok(result.flags.includes('no_edge_cases'));
  assert.ok(result.score >= 0.5);
});

test('computeControllability — identical evidence is flagged', () => {
  const trace = createTrace('verification', 'test');
  addStep(trace, { location: 'a:1', claim: 'c1', evidence: 'same', verdict: 'verified' });
  addStep(trace, { location: 'a:2', claim: 'c2', evidence: 'same', verdict: 'verified' });
  addStep(trace, { location: 'a:3', claim: 'c3', evidence: 'same', verdict: 'verified' });
  const result = computeControllability(trace);
  assert.ok(result.flags.includes('identical_evidence'));
});

test('computeControllability — thin evidence is flagged', () => {
  const trace = createTrace('verification', 'test');
  addStep(trace, { location: 'a:1', claim: 'c1', evidence: 'ok', verdict: 'verified' });
  addStep(trace, { location: 'a:2', claim: 'c2', evidence: 'yes', verdict: 'unverified' });
  addEdgeCase(trace, 'edge case present');
  const result = computeControllability(trace);
  assert.ok(result.flags.includes('thin_evidence'));
});

test('computeControllability — well-formed trace has low score', () => {
  const trace = createTrace('verification', 'test');
  addStep(trace, { location: 'a:1', claim: 'c1', evidence: 'Ran npm test, 45 tests passed in 2.3s', verdict: 'verified' });
  addStep(trace, { location: 'a:2', claim: 'c2', evidence: 'git diff shows 3 files changed', verdict: 'verified' });
  addStep(trace, { location: 'a:3', claim: 'c3', evidence: 'Coverage report: 87% lines', verdict: 'unverified' });
  addEdgeCase(trace, 'Module not loaded in CI environment');
  const result = computeControllability(trace);
  assert.equal(result.score, 0);
  assert.deepEqual(result.flags, []);
});

test('finalizeTrace includes controllability in summary', () => {
  const trace = createTrace('verification', 'test');
  addStep(trace, { location: 'a:1', claim: 'c1', evidence: 'ev', verdict: 'verified' });
  finalizeTrace(trace);
  assert.ok(typeof trace.summary.controllability === 'number');
  assert.ok(Array.isArray(trace.summary.controllabilityFlags));
});

test('aggregateTraces — mixed results', () => {
  const t1 = createTrace('verification', 'a');
  addStep(t1, { location: 'x:1', claim: 'c1', verdict: 'verified' });
  finalizeTrace(t1);

  const t2 = createTrace('verification', 'b');
  addStep(t2, { location: 'x:2', claim: 'c2', verdict: 'refuted' });
  finalizeTrace(t2);

  const agg = aggregateTraces([t1, t2]);
  assert.equal(agg.totalTraces, 2);
  assert.equal(agg.passedTraces, 1);
  assert.equal(agg.failedTraces, 1);
  assert.equal(agg.totalSteps, 2);
  assert.equal(agg.verified, 1);
  assert.equal(agg.refuted, 1);
  assert.equal(agg.allPassed, false);
  assert.ok(agg.averageConfidence > 0);
  assert.equal(typeof agg.flaggedTraces, 'number');
});

test('aggregateTraces — empty input', () => {
  const agg = aggregateTraces([]);
  assert.equal(agg.totalTraces, 0);
  assert.equal(agg.averageConfidence, 0);
  assert.equal(agg.allPassed, true);
});

test('self-heal integration — runSelfHeal includes reasoning', () => {
  const { runSelfHeal } = require('../scripts/self-heal');
  const report = runSelfHeal({ reason: 'test' });
  assert.ok(report.reasoning, 'runSelfHeal must return reasoning aggregate');
  assert.ok(Array.isArray(report.traces), 'runSelfHeal must return traces array');
  assert.equal(report.traces.length, report.plan.length);
  report.traces.forEach((trace) => {
    assert.ok(trace.traceId, 'each trace must have traceId');
    assert.ok(trace.summary, 'each trace must have summary');
    assert.equal(trace.type, 'self-heal');
  });
});

test('dpo-export integration — exported pairs include reasoning traces', () => {
  const { exportDpoFromMemories } = require('../scripts/export-dpo-pairs');
  const memories = [
    {
      id: 'e1',
      title: 'MISTAKE: Failed test',
      content: 'Did not run tests',
      category: 'error',
      tags: ['testing', 'verification'],
      rubricSummary: { weightedScore: 0.3, failingCriteria: ['correctness'] },
    },
    {
      id: 'l1',
      title: 'SUCCESS: Ran tests',
      content: 'Always run tests first',
      category: 'learning',
      tags: ['testing', 'verification'],
      rubricSummary: { weightedScore: 0.9, failingCriteria: [] },
    },
  ];
  const result = exportDpoFromMemories(memories);
  assert.ok(result.reasoning, 'export must return reasoning aggregate');
  assert.ok(result.pairs.length >= 1);
  const pair = result.pairs[0];
  assert.ok(pair.metadata.reasoningTrace, 'pair must have reasoningTrace');
  assert.ok(typeof pair.metadata.reasoningTrace.confidence === 'number');
  assert.ok(pair.metadata.reasoningTrace.traceId.startsWith('trace-'));
  assert.ok(Array.isArray(pair.metadata.reasoningTrace.edgeCases));
});
