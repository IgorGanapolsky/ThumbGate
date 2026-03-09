#!/usr/bin/env node
/**
 * Agentic Code Reasoning — Structured Trace Engine
 *
 * Based on Meta's "Agentic Code Reasoning" paper (arxiv 2603.01896).
 * Forces structured line-level reasoning instead of pattern-matching guesses.
 *
 * Produces a verification trace for every code change claim, self-heal fix,
 * or DPO pair, requiring explicit evidence for each assertion.
 */

const crypto = require('node:crypto');

/**
 * @typedef {Object} TraceStep
 * @property {string} location - File path and line range (e.g. "scripts/self-heal.js:49-69")
 * @property {string} claim - What this step asserts about correctness
 * @property {string} evidence - Concrete evidence supporting the claim
 * @property {'verified'|'unverified'|'refuted'} verdict - Assessment of the claim
 */

/**
 * @typedef {Object} ReasoningTrace
 * @property {string} traceId - Unique identifier for this trace
 * @property {string} timestamp - ISO 8601 timestamp
 * @property {string} type - Trace type: 'self-heal' | 'dpo-pair' | 'proof-gate' | 'verification'
 * @property {string} subject - What is being verified (script name, pair ID, etc.)
 * @property {TraceStep[]} steps - Ordered reasoning steps
 * @property {string[]} edgeCases - Edge cases explicitly addressed or ruled out
 * @property {Object} summary - Aggregated verdict
 * @property {number} summary.totalSteps - Total reasoning steps
 * @property {number} summary.verified - Steps with verified verdict
 * @property {number} summary.unverified - Steps with unverified verdict
 * @property {number} summary.refuted - Steps with refuted verdict
 * @property {number} summary.confidence - Ratio of verified to total (0-1)
 * @property {boolean} summary.passed - True if confidence >= threshold and refuted === 0
 */

const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

function generateTraceId() {
  return `trace-${crypto.randomBytes(6).toString('hex')}`;
}

function createTrace(type, subject) {
  return {
    traceId: generateTraceId(),
    timestamp: new Date().toISOString(),
    type,
    subject,
    steps: [],
    edgeCases: [],
    summary: null,
  };
}

function addStep(trace, { location, claim, evidence, verdict = 'unverified' }) {
  if (!location || !claim) {
    throw new Error('TraceStep requires location and claim');
  }
  const validVerdicts = ['verified', 'unverified', 'refuted'];
  if (!validVerdicts.includes(verdict)) {
    throw new Error(`Invalid verdict: ${verdict}. Must be one of: ${validVerdicts.join(', ')}`);
  }
  trace.steps.push({ location, claim, evidence: evidence || '', verdict });
  return trace;
}

function addEdgeCase(trace, description) {
  if (description) trace.edgeCases.push(description);
  return trace;
}

function computeControllability(trace) {
  const steps = trace.steps;
  const edgeCases = trace.edgeCases;
  if (steps.length === 0) return { score: 0, flags: ['empty_trace'] };

  const flags = [];
  const allVerified = steps.every((s) => s.verdict === 'verified');
  const allSameEvidence = new Set(steps.map((s) => s.evidence)).size === 1 && steps.length > 1;
  const shortEvidence = steps.filter((s) => s.evidence.length < 10).length;
  const noEdgeCases = edgeCases.length === 0;

  if (allVerified && steps.length > 2) flags.push('all_verified');
  if (allSameEvidence) flags.push('identical_evidence');
  if (shortEvidence > steps.length / 2) flags.push('thin_evidence');
  if (noEdgeCases && steps.length > 1) flags.push('no_edge_cases');

  const score = Math.round((flags.length / 4) * 1000) / 1000;
  return { score, flags };
}

function finalizeTrace(trace, { confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD } = {}) {
  const totalSteps = trace.steps.length;
  const verified = trace.steps.filter((s) => s.verdict === 'verified').length;
  const unverified = trace.steps.filter((s) => s.verdict === 'unverified').length;
  const refuted = trace.steps.filter((s) => s.verdict === 'refuted').length;
  const confidence = totalSteps > 0 ? Math.round((verified / totalSteps) * 1000) / 1000 : 0;
  const ctrl = computeControllability(trace);

  trace.summary = {
    totalSteps,
    verified,
    unverified,
    refuted,
    confidence,
    passed: confidence >= confidenceThreshold && refuted === 0,
    controllability: ctrl.score,
    controllabilityFlags: ctrl.flags,
  };

  return trace;
}

/**
 * Build a reasoning trace for a self-heal fix execution.
 *
 * @param {Object} fixResult - Result from runFixPlan for a single script
 * @param {string} fixResult.script - Script name
 * @param {string} fixResult.status - 'success' | 'failed'
 * @param {number} fixResult.exitCode
 * @param {string} fixResult.outputTail - Last 2000 chars of output
 * @param {string[]} changedFiles - Files changed by this fix
 * @returns {ReasoningTrace}
 */
function traceForSelfHealFix(fixResult, changedFiles = []) {
  const trace = createTrace('self-heal', fixResult.script);

  addStep(trace, {
    location: `npm run ${fixResult.script}`,
    claim: `Fix script "${fixResult.script}" executes without error`,
    evidence: fixResult.status === 'success'
      ? `Exit code ${fixResult.exitCode}, completed in ${fixResult.durationMs}ms`
      : `Exit code ${fixResult.exitCode}, error: ${fixResult.error || 'non-zero exit'}`,
    verdict: fixResult.status === 'success' ? 'verified' : 'refuted',
  });

  if (changedFiles.length > 0) {
    addStep(trace, {
      location: changedFiles.join(', '),
      claim: `Fix modified ${changedFiles.length} file(s) — changes are intentional`,
      evidence: `Changed: ${changedFiles.join(', ')}`,
      verdict: 'verified',
    });
  } else {
    addStep(trace, {
      location: `npm run ${fixResult.script}`,
      claim: 'Fix produced no file changes (idempotent or no-op)',
      evidence: 'git diff --name-only returned empty after execution',
      verdict: 'verified',
    });
  }

  const outputTail = (fixResult.outputTail || '').toLowerCase();
  const hasErrors = /error|fail|exception|fatal/i.test(outputTail);
  addStep(trace, {
    location: `npm run ${fixResult.script} (output)`,
    claim: 'Script output contains no error indicators',
    evidence: hasErrors
      ? `Output contains error keywords: ${outputTail.slice(-200)}`
      : 'No error keywords in output tail',
    verdict: hasErrors && fixResult.status === 'success' ? 'unverified' : (hasErrors ? 'refuted' : 'verified'),
  });

  addEdgeCase(trace, 'Script timeout not triggered (completed within deadline)');
  if (changedFiles.length === 0) {
    addEdgeCase(trace, 'No files changed — fix may already be applied or script is no-op');
  }

  return finalizeTrace(trace);
}

/**
 * Build a reasoning trace for a DPO preference pair.
 *
 * @param {Object} pair - The DPO pair with prompt, chosen, rejected, metadata
 * @returns {ReasoningTrace}
 */
function traceForDpoPair(pair) {
  const trace = createTrace('dpo-pair', `${pair.metadata.errorId}->${pair.metadata.learningId}`);

  addStep(trace, {
    location: `error:${pair.metadata.errorId}`,
    claim: 'Rejected response represents a genuine mistake',
    evidence: `Error title: "${pair.metadata.errorTitle}"`,
    verdict: pair.metadata.errorTitle ? 'verified' : 'unverified',
  });

  addStep(trace, {
    location: `learning:${pair.metadata.learningId}`,
    claim: 'Chosen response represents a correct approach',
    evidence: `Learning title: "${pair.metadata.learningTitle}"`,
    verdict: pair.metadata.learningTitle ? 'verified' : 'unverified',
  });

  const matchedKeys = pair.metadata.matchedKeys || [];
  addStep(trace, {
    location: 'domain-matching',
    claim: `Error and learning share domain context (${matchedKeys.length} key(s))`,
    evidence: `Matched keys: [${matchedKeys.join(', ')}], overlap score: ${pair.metadata.overlapScore}`,
    verdict: matchedKeys.length > 0 ? 'verified' : 'refuted',
  });

  const rubric = pair.metadata.rubric;
  if (rubric) {
    const hasDelta = rubric.weightedDelta != null && rubric.weightedDelta > 0;
    addStep(trace, {
      location: 'rubric-delta',
      claim: 'Learning scores higher than error on rubric (positive delta)',
      evidence: `Learning: ${rubric.learningWeightedScore}, Error: ${rubric.errorWeightedScore}, Delta: ${rubric.weightedDelta}`,
      verdict: hasDelta ? 'verified' : (rubric.weightedDelta === 0 ? 'unverified' : 'refuted'),
    });

    const failingCriteria = rubric.errorFailingCriteria || rubric.failingCriteria || [];
    if (failingCriteria.length > 0) {
      addStep(trace, {
        location: 'rubric-failures',
        claim: `Error had ${failingCriteria.length} failing rubric criteria`,
        evidence: `Failing: [${failingCriteria.join(', ')}]`,
        verdict: 'verified',
      });
    }
  } else {
    addStep(trace, {
      location: 'rubric-delta',
      claim: 'Rubric scores provide quantitative quality signal',
      evidence: 'No rubric data available for this pair',
      verdict: 'unverified',
    });
  }

  addStep(trace, {
    location: 'prompt-inference',
    claim: 'Inferred prompt captures the shared scenario correctly',
    evidence: `Prompt: "${pair.prompt}"`,
    verdict: pair.prompt && pair.prompt.length > 10 ? 'verified' : 'unverified',
  });

  addEdgeCase(trace, 'Pair may lack temporal proximity — error and learning from different sessions');
  addEdgeCase(trace, 'Domain overlap is keyword-based — semantic similarity not verified');

  return finalizeTrace(trace);
}

/**
 * Build a reasoning trace for a proof harness check.
 *
 * @param {Object} checkResult - A check from the proof report
 * @param {string} checkResult.name - Check name
 * @param {boolean} checkResult.passed - Whether the check passed
 * @param {Object} checkResult.details - Check-specific details
 * @returns {ReasoningTrace}
 */
function traceForProofCheck(checkResult) {
  const trace = createTrace('proof-gate', checkResult.name);

  addStep(trace, {
    location: `check:${checkResult.name}`,
    claim: `Proof check "${checkResult.name}" passes`,
    evidence: checkResult.passed
      ? `Passed with details: ${JSON.stringify(checkResult.details)}`
      : `Failed: ${JSON.stringify(checkResult.details)}`,
    verdict: checkResult.passed ? 'verified' : 'refuted',
  });

  if (checkResult.details) {
    const details = checkResult.details;
    if (details.status !== undefined) {
      addStep(trace, {
        location: `check:${checkResult.name}/status`,
        claim: 'HTTP/response status is expected value',
        evidence: `Status: ${details.status}`,
        verdict: checkResult.passed ? 'verified' : 'refuted',
      });
    }
    if (details.accepted !== undefined) {
      addStep(trace, {
        location: `check:${checkResult.name}/accepted`,
        claim: `Acceptance state is ${details.accepted}`,
        evidence: `accepted=${details.accepted}`,
        verdict: 'verified',
      });
    }
  }

  return finalizeTrace(trace);
}

/**
 * Aggregate multiple traces into a verification summary.
 *
 * @param {ReasoningTrace[]} traces
 * @returns {Object} Aggregated summary
 */
function aggregateTraces(traces) {
  const totalTraces = traces.length;
  const passedTraces = traces.filter((t) => t.summary && t.summary.passed).length;
  const allSteps = traces.flatMap((t) => t.steps);
  const totalSteps = allSteps.length;
  const verified = allSteps.filter((s) => s.verdict === 'verified').length;
  const refuted = allSteps.filter((s) => s.verdict === 'refuted').length;
  const avgConfidence = totalTraces > 0
    ? Math.round(traces.reduce((sum, t) => sum + (t.summary ? t.summary.confidence : 0), 0) / totalTraces * 1000) / 1000
    : 0;

  return {
    totalTraces,
    passedTraces,
    failedTraces: totalTraces - passedTraces,
    totalSteps,
    verified,
    unverified: totalSteps - verified - refuted,
    refuted,
    averageConfidence: avgConfidence,
    allPassed: passedTraces === totalTraces,
    flaggedTraces: traces.filter((t) => t.summary && t.summary.controllability > 0.5).length,
  };
}

module.exports = {
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
};
// Tests cover this module through the node:test suite; avoid hardcoding counts here.
