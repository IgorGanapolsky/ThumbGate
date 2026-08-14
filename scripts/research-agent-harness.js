'use strict';

/**
 * Multi-step research agent harness (hypothesis → experiment → verify → claim)
 *
 * EdotEnv transfer: research agents must not skip verification before claiming
 * progress. ThumbGate enforces ordered steps and fails closed on claim-without-
 * evidence. Difficulty can ratchet ("harder next round") when prior rounds pass.
 *
 * Not a market simulator and not affiliated with EdotEnv.
 */

const { evaluateEdotEnvStep } = require('./edotenv-rl-gateway');

const STEPS = ['hypothesis', 'experiment', 'verify', 'claim'];

const DEFAULT_STATE = () => ({
  round: 1,
  difficulty: 1,
  completed: [],
  evidence: [],
  claims: [],
  history: [],
});

/**
 * Advance one research step under gate policy.
 * @param {object} input
 * @param {object} [input.state]
 * @param {string} input.step - hypothesis | experiment | verify | claim
 * @param {object} [input.payload]
 * @param {object} [input.toolCall] - optional tool action to evaluate
 */
function advanceResearchStep(input = {}) {
  const state = {
    ...DEFAULT_STATE(),
    ...(input.state || {}),
    completed: [...((input.state && input.state.completed) || [])],
    evidence: [...((input.state && input.state.evidence) || [])],
    claims: [...((input.state && input.state.claims) || [])],
    history: [...((input.state && input.state.history) || [])],
  };
  const step = String(input.step || '').toLowerCase();
  const payload = input.payload && typeof input.payload === 'object' ? input.payload : {};
  const difficulty = Math.max(1, Number(state.difficulty) || 1);

  if (!STEPS.includes(step)) {
    return deny(state, step, 'unknown_step', `Step must be one of: ${STEPS.join(', ')}`);
  }

  // Optional tool action interdiction at every step
  if (input.toolCall) {
    const gate = evaluateEdotEnvStep({
      agentId: payload.agentId || state.agentId || 'research_agent',
      environmentId: payload.environmentId || 'research_harness_v1',
      toolName: input.toolCall.toolName || input.toolCall.name,
      params: input.toolCall.params || input.toolCall.arguments || {},
    });
    if (!gate.allowed) {
      return {
        allowed: false,
        decision: 'deny',
        code: 'TOOL_INTERDICTED',
        reason: gate.reason,
        gate,
        state,
        difficulty,
      };
    }
  }

  const orderIdx = STEPS.indexOf(step);
  // Claim has a dedicated code path for missing verify (sales-clearer failure).
  if (step !== 'claim') {
    for (let i = 0; i < orderIdx; i += 1) {
      if (!state.completed.includes(STEPS[i])) {
        // At higher difficulty, strict ordering; level 1 still requires hypothesis before experiment
        if (difficulty >= 2 || STEPS[i] === 'verify' || STEPS[i] === 'hypothesis') {
          return deny(
            state,
            step,
            'ORDER_VIOLATION',
            `Cannot run '${step}' before completing '${STEPS[i]}' (difficulty=${difficulty})`
          );
        }
      }
    }
  }

  if (step === 'hypothesis') {
    if (!payload.hypothesis || String(payload.hypothesis).trim().length < 8) {
      return deny(state, step, 'WEAK_HYPOTHESIS', 'hypothesis text required (min 8 chars)');
    }
    state.completed = uniquePush(state.completed, 'hypothesis');
    state.history.push({ step, at: nowIso(), hypothesis: String(payload.hypothesis).slice(0, 500) });
    return allow(state, step, 'Hypothesis recorded');
  }

  if (step === 'experiment') {
    if (!payload.experimentId && !payload.method) {
      return deny(state, step, 'MISSING_EXPERIMENT', 'experimentId or method required');
    }
    state.completed = uniquePush(state.completed, 'experiment');
    state.history.push({
      step,
      at: nowIso(),
      experimentId: payload.experimentId || null,
      method: payload.method || null,
    });
    return allow(state, step, 'Experiment recorded');
  }

  if (step === 'verify') {
    const evidence = payload.evidence || payload.result || payload.receipt;
    if (!evidence) {
      return deny(state, step, 'MISSING_EVIDENCE', 'verify requires evidence/result/receipt');
    }
    // Difficulty ≥3: require explicit pass flag
    if (difficulty >= 3 && payload.passed !== true && payload.ok !== true) {
      return deny(state, step, 'VERIFY_NOT_PASSED', 'difficulty≥3 requires passed:true or ok:true');
    }
    state.completed = uniquePush(state.completed, 'verify');
    state.evidence.push({
      at: nowIso(),
      evidence: typeof evidence === 'string' ? evidence.slice(0, 1000) : evidence,
      passed: payload.passed === true || payload.ok === true,
    });
    state.history.push({ step, at: nowIso() });
    return allow(state, step, 'Verification recorded');
  }

  // claim
  if (!state.completed.includes('verify') || state.evidence.length === 0) {
    return deny(state, step, 'CLAIM_WITHOUT_VERIFY', 'Cannot claim without prior verification evidence');
  }
  // Difficulty ≥4: last verify must be passed
  const lastEv = state.evidence[state.evidence.length - 1];
  if (difficulty >= 4 && !lastEv.passed) {
    return deny(state, step, 'CLAIM_ON_FAILED_VERIFY', 'difficulty≥4 forbids claim after failed verify');
  }
  if (!payload.claim || String(payload.claim).trim().length < 8) {
    return deny(state, step, 'WEAK_CLAIM', 'claim text required (min 8 chars)');
  }

  state.completed = uniquePush(state.completed, 'claim');
  state.claims.push({ at: nowIso(), claim: String(payload.claim).slice(0, 500) });
  state.history.push({ step, at: nowIso() });

  // Harder next round (EdotEnv transfer): successful full cycle raises difficulty
  const next = {
    ...state,
    round: (Number(state.round) || 1) + 1,
    difficulty: Math.min(5, difficulty + 1),
    completed: [], // reset cycle; evidence retained for audit
  };

  return {
    allowed: true,
    decision: 'allow',
    code: 'CLAIM_ACCEPTED',
    reason: 'Claim accepted with verification evidence; difficulty ratcheted',
    state: next,
    previousDifficulty: difficulty,
    difficulty: next.difficulty,
    harderNextRound: next.difficulty > difficulty,
  };
}

/**
 * Run a full research cycle script (array of steps) under a starting difficulty.
 */
function runResearchCycle(steps = [], options = {}) {
  let state = {
    ...DEFAULT_STATE(),
    difficulty: Math.max(1, Number(options.difficulty) || 1),
    agentId: options.agentId || 'research_agent',
  };
  const outcomes = [];
  for (const s of steps) {
    const out = advanceResearchStep({ ...s, state });
    outcomes.push(out);
    if (!out.allowed) {
      return {
        success: false,
        stoppedAt: s.step,
        code: out.code,
        reason: out.reason,
        outcomes,
        state: out.state,
      };
    }
    state = out.state;
  }
  return {
    success: true,
    outcomes,
    state,
    finalDifficulty: state.difficulty,
  };
}

function deny(state, step, code, reason) {
  return {
    allowed: false,
    decision: 'deny',
    code,
    reason,
    step,
    state,
    difficulty: state.difficulty,
  };
}

function allow(state, step, reason) {
  return {
    allowed: true,
    decision: 'allow',
    code: 'OK',
    reason,
    step,
    state,
    difficulty: state.difficulty,
  };
}

function uniquePush(arr, item) {
  if (arr.includes(item)) return arr;
  return [...arr, item];
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Optional curriculum glue: after a successful claim, suggest next difficulty
 * using the EdotEnv-style harder-next-round frontier.
 */
function nextDifficultyAfterClaim(state = {}) {
  const difficulty = Math.max(1, Number(state.difficulty) || 1);
  // advanceResearchStep already ratchets on claim; this helper is for callers
  // that only hold the post-claim state.
  return {
    difficulty,
    harderNextRound: difficulty > 1,
    maxDifficulty: 5,
  };
}

module.exports = {
  STEPS,
  advanceResearchStep,
  runResearchCycle,
  DEFAULT_STATE,
  nextDifficultyAfterClaim,
};
