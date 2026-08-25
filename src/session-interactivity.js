'use strict';

/**
 * Session-level interactivity: what the user actually waited, not what the
 * server was busy for.
 *
 * Taken from NVIDIA's SemiAnalysis AgentX methodology, which reports two rates
 * side by side and treats the gap between them as the finding:
 *
 *   Standard Interactivity
 *     "output tokens divided by the elapsed time from the first token to the
 *     last"
 *
 *   E2E Normalized Interactivity
 *     "average output-token rate per user over the full request, calculated by
 *     dividing total output tokens by the time from request submission to
 *     final-token delivery"
 *
 * Standard starts the clock at the first token. Everything before that -- queue
 * time, scheduling, a runner that has not claimed the work yet -- is invisible
 * to it. E2E starts at submission, so it counts what the person counts.
 *
 * WHY THIS EXISTS HERE
 *
 * 2026-08-25, production: a task was created at 17:34:08Z and completed at
 * 17:34:53Z. The execution itself was quick and the UI advertised a "90s
 * lease", so by any server-side measure the system was healthy. The user spent
 * that time looking at a spinner reading "Waiting for the fenced VPS runner to
 * pick this up". Standard Interactivity would have scored that request well.
 *
 * A metric that cannot see queue time cannot see that outage. This module
 * exists so that class of defect shows up as a number rather than as a
 * screenshot.
 *
 * WHY SESSIONS AND NOT REQUESTS
 *
 * Also from AgentX: "Agentic sessions are long, stateful, and variable: they
 * chain model calls, tool use, and growing context rather than following a
 * fixed prompt-and-response pattern." Their sample session grows from roughly
 * 60K to 400K tokens, and industry figures they cite put a single agentic
 * request at ~15x the tokens of ordinary chat. Per-call averages hide all of
 * that, so everything below aggregates over a whole session and keeps tool
 * gaps in the denominator: a tool call the user waits through is wait, whoever
 * is executing it.
 */

/** A turn is only usable if these are present and ordered. */
const REQUIRED = ['submittedAt', 'firstTokenAt', 'lastTokenAt'];

/**
 * Fraction of total wall time that may be invisible to Standard Interactivity
 * before it is called out. Deliberately generous: this is meant to catch a
 * request that spent most of its life queued, not to police a slow scheduler.
 */
const HIDDEN_WAIT_BUDGET = 0.25;

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Validate one turn, returning a reason string when unusable.
 *
 * Unusable turns are never silently dropped: a session whose turns cannot be
 * measured must report as UNKNOWN rather than as fast, for the same reason the
 * incident above went unnoticed.
 */
function turnProblem(turn) {
  if (!turn || typeof turn !== 'object') return 'not an object';
  for (const field of REQUIRED) {
    if (!isFiniteNumber(turn[field])) return `missing or non-numeric ${field}`;
  }
  if (turn.firstTokenAt < turn.submittedAt) return 'firstTokenAt precedes submittedAt';
  if (turn.lastTokenAt < turn.firstTokenAt) return 'lastTokenAt precedes firstTokenAt';
  if (!isFiniteNumber(turn.outputTokens) || turn.outputTokens < 0) {
    return 'missing or negative outputTokens';
  }
  return null;
}

/**
 * Measure a single turn.
 *
 * Rates are tokens per second. A zero-length generation window yields a null
 * rate rather than Infinity -- an unmeasurable rate is not an infinitely fast
 * one, and reporting Infinity here would flatter exactly the pathological case
 * this module is watching for.
 */
function measureTurn(turn) {
  const problem = turnProblem(turn);
  if (problem) return { ok: false, problem };

  const queueMs = turn.firstTokenAt - turn.submittedAt;
  const generationMs = turn.lastTokenAt - turn.firstTokenAt;
  const totalMs = turn.lastTokenAt - turn.submittedAt;
  const rate = (ms) => (ms > 0 ? (turn.outputTokens / ms) * 1000 : null);

  return {
    ok: true,
    outputTokens: turn.outputTokens,
    queueMs,
    generationMs,
    totalMs,
    ttftMs: queueMs,
    standardInteractivity: rate(generationMs),
    e2eNormalizedInteractivity: rate(totalMs),
  };
}

/**
 * Aggregate a whole session.
 *
 * The denominator for E2E is submission of the first turn to the final token of
 * the last, which means time spent in tool calls between turns stays counted.
 * That is intentional: from the user's chair a tool call is indistinguishable
 * from thinking, and a serving stack that offloads work into tools should not
 * get to subtract that time from its own score.
 *
 * @param {Object} session - { id, turns: [{ submittedAt, firstTokenAt, lastTokenAt, outputTokens, promptTokens? }] }
 * @returns {Object} measurement, always including `status`
 */
function measureSession(session) {
  const turns = session && Array.isArray(session.turns) ? session.turns : null;
  if (!turns || turns.length === 0) {
    return { status: 'NO_DATA', id: session && session.id, reason: 'no turns supplied' };
  }

  const measured = [];
  const problems = [];
  turns.forEach((turn, index) => {
    const result = measureTurn(turn);
    if (result.ok) measured.push({ index, ...result });
    else problems.push({ index, problem: result.problem });
  });

  // Any unmeasurable turn makes the session total unknowable. Reporting the
  // measurable subset would understate the wait, which is the failure mode.
  if (problems.length) {
    return {
      status: 'UNKNOWN',
      id: session && session.id,
      reason: 'one or more turns could not be measured',
      problems,
      measuredTurns: measured.length,
      totalTurns: turns.length,
    };
  }

  const outputTokens = measured.reduce((sum, t) => sum + t.outputTokens, 0);
  const sessionStart = Math.min(...turns.map((t) => t.submittedAt));
  const sessionEnd = Math.max(...turns.map((t) => t.lastTokenAt));
  const wallMs = sessionEnd - sessionStart;

  const generationMs = measured.reduce((sum, t) => sum + t.generationMs, 0);
  const queueMs = measured.reduce((sum, t) => sum + t.queueMs, 0);
  // Whatever is left is time between turns: tool execution, agent deliberation,
  // scheduling. The user waited through all of it.
  const gapMs = Math.max(0, wallMs - generationMs - queueMs);

  const rate = (ms) => (ms > 0 ? (outputTokens / ms) * 1000 : null);
  const standard = rate(generationMs);
  const e2e = rate(wallMs);

  const hiddenMs = wallMs - generationMs;
  const hiddenFraction = wallMs > 0 ? hiddenMs / wallMs : 0;

  return {
    status: 'OK',
    id: session && session.id,
    turns: measured.length,
    outputTokens,
    promptTokensFirst: firstPromptTokens(turns),
    promptTokensLast: lastPromptTokens(turns),
    wallMs,
    generationMs,
    queueMs,
    gapMs,
    standardInteractivity: standard,
    e2eNormalizedInteractivity: e2e,
    // The headline: how much of the user's wait the standard metric cannot see.
    hiddenWaitMs: hiddenMs,
    hiddenWaitFraction: hiddenFraction,
    hiddenWaitExceedsBudget: hiddenFraction > HIDDEN_WAIT_BUDGET,
  };
}

function firstPromptTokens(turns) {
  const first = turns.find((t) => isFiniteNumber(t && t.promptTokens));
  return first ? first.promptTokens : null;
}

function lastPromptTokens(turns) {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (isFiniteNumber(turns[i] && turns[i].promptTokens)) return turns[i].promptTokens;
  }
  return null;
}

/**
 * Context growth across a session, the other thing fixed-length benchmarks
 * cannot show. AgentX reports a session growing ~60K -> ~400K tokens; a
 * benchmark pinned at 8K in / 1K out would call that the same workload.
 */
function contextGrowth(session) {
  const measurement = measureSession(session);
  if (measurement.status !== 'OK') return measurement;
  const { promptTokensFirst: first, promptTokensLast: last } = measurement;
  if (!isFiniteNumber(first) || !isFiniteNumber(last) || first <= 0) {
    return { status: 'NO_DATA', reason: 'promptTokens not reported on enough turns' };
  }
  return { status: 'OK', first, last, growthFactor: last / first };
}

/**
 * Compare two serving configurations over the SAME recorded sessions.
 *
 * AgentX is explicit about why replay matters: "Because every system receives
 * the same recorded traffic, observed differences reflect the serving stack
 * rather than benchmark-specific tuning." Comparing runs over different traffic
 * measures the traffic.
 */
function compareRuns(baseline, candidate) {
  const ids = (run) => (run || []).map((s) => s && s.id).join('|');
  if (ids(baseline) !== ids(candidate)) {
    return {
      status: 'INVALID',
      reason: 'runs did not replay the same sessions in the same order',
    };
  }

  const summarize = (run) => {
    const results = run.map(measureSession);
    if (results.some((r) => r.status !== 'OK')) {
      return { status: 'UNKNOWN', results };
    }
    const tokens = results.reduce((sum, r) => sum + r.outputTokens, 0);
    const wall = results.reduce((sum, r) => sum + r.wallMs, 0);
    return {
      status: 'OK',
      results,
      outputTokens: tokens,
      wallMs: wall,
      e2eNormalizedInteractivity: wall > 0 ? (tokens / wall) * 1000 : null,
    };
  };

  const a = summarize(baseline);
  const b = summarize(candidate);
  if (a.status !== 'OK' || b.status !== 'OK') {
    return { status: 'UNKNOWN', reason: 'a session in one run could not be measured', baseline: a, candidate: b };
  }
  if (!a.e2eNormalizedInteractivity) {
    return { status: 'UNKNOWN', reason: 'baseline rate is not measurable' };
  }

  return {
    status: 'OK',
    baseline: a.e2eNormalizedInteractivity,
    candidate: b.e2eNormalizedInteractivity,
    speedup: b.e2eNormalizedInteractivity / a.e2eNormalizedInteractivity,
    sessions: baseline.length,
  };
}

module.exports = {
  measureTurn,
  measureSession,
  contextGrowth,
  compareRuns,
  turnProblem,
  HIDDEN_WAIT_BUDGET,
};
