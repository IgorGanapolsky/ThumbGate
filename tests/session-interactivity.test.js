'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  measureTurn,
  measureSession,
  contextGrowth,
  compareRuns,
  turnProblem,
  HIDDEN_WAIT_BUDGET,
} = require('../src/session-interactivity');

// Timestamps from the real 2026-08-25 production incident. The task was created
// 17:34:08Z and completed 17:34:53Z; the user watched a "CLOUD PENDING" spinner
// for most of it while the UI advertised a 90s lease.
const CREATED = Date.parse('2026-08-25T17:34:08Z');
const COMPLETED = Date.parse('2026-08-25T17:34:53Z');

// ---------------------------------------------------------------------------
// The defect this module exists to catch
// ---------------------------------------------------------------------------

test('THE INCIDENT: a fast generation behind a long queue is not a fast request', () => {
  // 45s wall. Generation was quick; the rest was waiting for a runner to claim.
  const turn = {
    submittedAt: CREATED,
    firstTokenAt: COMPLETED - 5_000, // 40s queued
    lastTokenAt: COMPLETED, // 5s generating
    outputTokens: 500,
  };
  const m = measureTurn(turn);

  assert.equal(m.ok, true);
  assert.equal(m.queueMs, 40_000);
  assert.equal(m.generationMs, 5_000);

  // Standard Interactivity sees only the 5s window and calls this excellent.
  assert.equal(m.standardInteractivity, 100);
  // E2E sees the 45s the person actually waited.
  assert.ok(m.e2eNormalizedInteractivity < 12, `got ${m.e2eNormalizedInteractivity}`);

  // The whole point: the two disagree by roughly 9x, and the user lives in the
  // smaller number.
  assert.ok(
    m.standardInteractivity / m.e2eNormalizedInteractivity > 8,
    'the metrics must diverge sharply when a request sits queued',
  );
});

test('a session flags when most of the wait is invisible to the standard metric', () => {
  const s = measureSession({
    id: 'incident',
    turns: [{
      submittedAt: CREATED,
      firstTokenAt: COMPLETED - 5_000,
      lastTokenAt: COMPLETED,
      outputTokens: 500,
    }],
  });

  assert.equal(s.status, 'OK');
  assert.equal(s.hiddenWaitMs, 40_000);
  assert.ok(s.hiddenWaitFraction > 0.8, `got ${s.hiddenWaitFraction}`);
  assert.equal(s.hiddenWaitExceedsBudget, true, 'an 89% invisible wait must breach the budget');
});

test('a genuinely responsive request does not trip the budget', () => {
  const s = measureSession({
    id: 'healthy',
    turns: [{ submittedAt: 0, firstTokenAt: 200, lastTokenAt: 10_000, outputTokens: 1_000 }],
  });
  assert.equal(s.status, 'OK');
  assert.ok(s.hiddenWaitFraction < HIDDEN_WAIT_BUDGET);
  assert.equal(s.hiddenWaitExceedsBudget, false);
});

// ---------------------------------------------------------------------------
// Session aggregation: tool gaps stay in the denominator
// ---------------------------------------------------------------------------

test('time between turns is counted as wait, not subtracted', () => {
  // Two turns, 30s of tool execution between them. Generation totals 10s.
  const s = measureSession({
    id: 'tool-gap',
    turns: [
      { submittedAt: 0, firstTokenAt: 100, lastTokenAt: 5_000, outputTokens: 250 },
      { submittedAt: 35_000, firstTokenAt: 35_100, lastTokenAt: 40_000, outputTokens: 250 },
    ],
  });

  assert.equal(s.status, 'OK');
  assert.equal(s.wallMs, 40_000);
  assert.ok(s.gapMs >= 29_000, `tool gap should survive, got ${s.gapMs}`);
  // 500 tokens over 40s end-to-end, versus 500 over ~9.8s of generation.
  assert.ok(s.e2eNormalizedInteractivity < 13);
  assert.ok(s.standardInteractivity > 45);
});

test('output tokens and wall time aggregate across every turn', () => {
  const s = measureSession({
    id: 'multi',
    turns: [
      { submittedAt: 0, firstTokenAt: 100, lastTokenAt: 1_100, outputTokens: 10 },
      { submittedAt: 2_000, firstTokenAt: 2_100, lastTokenAt: 3_100, outputTokens: 20 },
      { submittedAt: 4_000, firstTokenAt: 4_100, lastTokenAt: 5_100, outputTokens: 30 },
    ],
  });
  assert.equal(s.outputTokens, 60);
  assert.equal(s.wallMs, 5_100);
  assert.equal(s.turns, 3);
});

// ---------------------------------------------------------------------------
// Fail closed. An unmeasurable session is UNKNOWN, never fast.
// ---------------------------------------------------------------------------

test('INVARIANT: one unmeasurable turn makes the whole session UNKNOWN', () => {
  // Measuring only the good turns would understate the wait, which is the exact
  // failure mode this module was written to remove.
  const s = measureSession({
    id: 'partial',
    turns: [
      { submittedAt: 0, firstTokenAt: 100, lastTokenAt: 1_000, outputTokens: 10 },
      { submittedAt: 2_000, firstTokenAt: null, lastTokenAt: 3_000, outputTokens: 10 },
    ],
  });
  assert.equal(s.status, 'UNKNOWN');
  assert.equal(s.measuredTurns, 1);
  assert.equal(s.totalTurns, 2);
  assert.match(s.problems[0].problem, /firstTokenAt/);
});

test('INVARIANT: an unmeasurable rate is null, never Infinity', () => {
  // A zero-length generation window must not read as infinitely fast.
  const m = measureTurn({ submittedAt: 0, firstTokenAt: 500, lastTokenAt: 500, outputTokens: 42 });
  assert.equal(m.ok, true);
  assert.equal(m.standardInteractivity, null);
  assert.ok(Number.isFinite(m.e2eNormalizedInteractivity));
});

test('an empty or missing session reports NO_DATA', () => {
  assert.equal(measureSession({ id: 'x', turns: [] }).status, 'NO_DATA');
  assert.equal(measureSession({}).status, 'NO_DATA');
  assert.equal(measureSession(null).status, 'NO_DATA');
});

test('out-of-order and malformed timestamps are named, not swallowed', () => {
  assert.match(turnProblem({ submittedAt: 100, firstTokenAt: 50, lastTokenAt: 200, outputTokens: 1 }), /precedes submittedAt/);
  assert.match(turnProblem({ submittedAt: 0, firstTokenAt: 100, lastTokenAt: 50, outputTokens: 1 }), /precedes firstTokenAt/);
  assert.match(turnProblem({ submittedAt: 0, firstTokenAt: 1, lastTokenAt: 2, outputTokens: -5 }), /negative outputTokens/);
  assert.match(turnProblem(null), /not an object/);
});

// ---------------------------------------------------------------------------
// Context growth: what a fixed-length benchmark cannot show
// ---------------------------------------------------------------------------

test('context growth across a session is reported as a factor', () => {
  // Mirrors the AgentX sample session shape: ~60K growing to ~400K.
  const g = contextGrowth({
    id: 'growth',
    turns: [
      { submittedAt: 0, firstTokenAt: 10, lastTokenAt: 1_000, outputTokens: 100, promptTokens: 60_000 },
      { submittedAt: 2_000, firstTokenAt: 2_010, lastTokenAt: 3_000, outputTokens: 100, promptTokens: 400_000 },
    ],
  });
  assert.equal(g.status, 'OK');
  assert.equal(g.first, 60_000);
  assert.equal(g.last, 400_000);
  assert.ok(Math.abs(g.growthFactor - 6.667) < 0.01);
});

test('context growth without prompt tokens reports NO_DATA rather than 1x', () => {
  const g = contextGrowth({
    id: 'no-prompts',
    turns: [{ submittedAt: 0, firstTokenAt: 10, lastTokenAt: 100, outputTokens: 5 }],
  });
  assert.equal(g.status, 'NO_DATA');
});

// ---------------------------------------------------------------------------
// Replay comparison: same traffic, or the comparison is meaningless
// ---------------------------------------------------------------------------

const run = (id, lastToken) => ({
  id,
  turns: [{ submittedAt: 0, firstTokenAt: 100, lastTokenAt: lastToken, outputTokens: 1_000 }],
});

test('comparing two runs over the same sessions yields a speedup', () => {
  const c = compareRuns([run('a', 10_000)], [run('a', 5_000)]);
  assert.equal(c.status, 'OK');
  assert.ok(Math.abs(c.speedup - 2) < 0.01, `expected ~2x, got ${c.speedup}`);
  assert.equal(c.sessions, 1);
});

test('INVARIANT: comparing runs over different traffic is refused', () => {
  // "Because every system receives the same recorded traffic, observed
  // differences reflect the serving stack rather than benchmark-specific
  // tuning." Different traffic measures the traffic.
  const c = compareRuns([run('a', 10_000)], [run('b', 5_000)]);
  assert.equal(c.status, 'INVALID');
  assert.match(c.reason, /same sessions/);
});

test('a run containing an unmeasurable session cannot produce a speedup', () => {
  const broken = { id: 'a', turns: [{ submittedAt: 0, firstTokenAt: null, lastTokenAt: 1, outputTokens: 1 }] };
  const c = compareRuns([run('a', 10_000)], [broken]);
  assert.equal(c.status, 'UNKNOWN');
});
