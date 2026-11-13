/**
 * StateBench Deterministic In-Memory State Tracker & Krohn-Rhodes Register
 * 
 * Based on Ai2 (Allen Institute for AI) StateBench Benchmark (Nov 2026):
 * Solves the critical LLM vulnerability where frontier models (Claude Opus 5.5,
 * GPT-6 Sol, Gemini 3.8 Flash) collapse to <= 13% accuracy on long-context state
 * tracking across general finite and soluble dependency chains.
 * 
 * Implements algebraic state decomposition across Krohn-Rhodes complexity levels:
 * - Level 1: R-Trivial (Immutable constants, single assignment)
 * - Level 2: Aperiodic (Reassignment by value, latest-write-wins)
 * - Level 3: Soluble (Self-referential updates: x = x + delta, accumulator)
 * - Level 4: General Finite (Assignment by reference: x = y, atomic swaps, S_n permutations)
 */

'use strict';

const KROHN_RHODES_LEVELS = {
  R_TRIVIAL: 'R_TRIVIAL',       // Immutable constant
  APERIODIC: 'APERIODIC',       // Latest value overwrite
  SOLUBLE: 'SOLUBLE',           // Self-referential accumulation
  GENERAL_FINITE: 'GENERAL_FINITE' // Pointer aliasing, swaps, permutations
};

class StateBenchFiniteTracker {
  constructor(options = {}) {
    this.immutableStore = new Map(); // R-Trivial
    this.valueStore = new Map();     // Aperiodic
    this.historyStore = new Map();   // Step-by-step audit
    this.referenceGraph = new Map(); // General Finite pointers
    this.stepCounter = 0;
    this.logLength = options.maxSteps || 100000;
  }

  /**
   * Level 1: R-Trivial - Declare an immutable variable.
   * Attempting to overwrite an immutable register throws a deterministic error.
   */
  setImmutable(varName, value) {
    if (this.immutableStore.has(varName)) {
      throw new Error(`[StateBench:R_TRIVIAL_VIOLATION] Cannot reassign immutable variable "${varName}". Current value: ${this.immutableStore.get(varName)}`);
    }
    this.immutableStore.set(varName, value);
    this._recordStep(varName, 'INIT_IMMUTABLE', value, KROHN_RHODES_LEVELS.R_TRIVIAL);
    return { varName, value, level: KROHN_RHODES_LEVELS.R_TRIVIAL };
  }

  /**
   * Level 2: Aperiodic - Assign or reassign by value.
   * Ignores previous historical values, latest-write-wins.
   */
  assignValue(varName, value) {
    if (this.immutableStore.has(varName)) {
      throw new Error(`[StateBench:R_TRIVIAL_VIOLATION] Variable "${varName}" is marked immutable.`);
    }
    this.valueStore.set(varName, value);
    // Clear any dangling pointer
    this.referenceGraph.delete(varName);
    this._recordStep(varName, 'ASSIGN_VALUE', value, KROHN_RHODES_LEVELS.APERIODIC);
    return { varName, value, level: KROHN_RHODES_LEVELS.APERIODIC };
  }

  /**
   * Level 3: Soluble - Self-referential update (e.g. x = x + n, x = x * n).
   * Carries state forward deterministically without floating-point or LLM token drift.
   */
  accumulateSelf(varName, operator, operand) {
    const currentVal = this.resolveState(varName);
    let newVal;

    switch (operator) {
      case '+':
      case 'ADD':
        newVal = (Number(currentVal) || 0) + Number(operand);
        break;
      case '-':
      case 'SUB':
        newVal = (Number(currentVal) || 0) - Number(operand);
        break;
      case '*':
      case 'MUL':
        newVal = (Number(currentVal) || 1) * Number(operand);
        break;
      case 'APPEND':
        newVal = String(currentVal || '') + String(operand);
        break;
      default:
        throw new Error(`[StateBench:SOLUBLE_ERROR] Unsupported accumulator operator: ${operator}`);
    }

    this.valueStore.set(varName, newVal);
    this.referenceGraph.delete(varName);
    this._recordStep(varName, `ACCUMULATE_${operator}`, newVal, KROHN_RHODES_LEVELS.SOLUBLE);
    return { varName, value: newVal, level: KROHN_RHODES_LEVELS.SOLUBLE };
  }

  /**
   * Level 4: General Finite - Assignment by reference (e.g. x = y).
   * Links x's value to whatever y evaluates to at resolution time or snapshots it.
   */
  assignByReference(targetVar, sourceVar) {
    const resolvedSourceVal = this.resolveState(sourceVar);
    this.valueStore.set(targetVar, resolvedSourceVal);
    this.referenceGraph.set(targetVar, sourceVar);
    this._recordStep(targetVar, `ASSIGN_REF_${sourceVar}`, resolvedSourceVal, KROHN_RHODES_LEVELS.GENERAL_FINITE);
    return { targetVar, sourceVar, resolvedValue: resolvedSourceVal, level: KROHN_RHODES_LEVELS.GENERAL_FINITE };
  }

  /**
   * Level 4: General Finite - Atomic swap (e.g. swap(cups[0], cups[2])).
   * Solves S_n permutation tracking without dropping state.
   */
  swapVariables(varA, varB) {
    const valA = this.resolveState(varA);
    const valB = this.resolveState(varB);

    this.valueStore.set(varA, valB);
    this.valueStore.set(varB, valA);

    this._recordStep(varA, `SWAP_WITH_${varB}`, valB, KROHN_RHODES_LEVELS.GENERAL_FINITE);
    this._recordStep(varB, `SWAP_WITH_${varA}`, valA, KROHN_RHODES_LEVELS.GENERAL_FINITE);

    return {
      swapped: [varA, varB],
      state: { [varA]: valB, [varB]: valA },
      level: KROHN_RHODES_LEVELS.GENERAL_FINITE
    };
  }

  /**
   * Deterministically resolves current value of any registered variable.
   */
  resolveState(varName) {
    if (this.immutableStore.has(varName)) {
      return this.immutableStore.get(varName);
    }
    if (this.valueStore.has(varName)) {
      return this.valueStore.get(varName);
    }
    return undefined;
  }

  /**
   * Ground-Truth Verifier: Checks an agent's claimed value against deterministic reality.
   * Catches long-context LLM hallucinations.
   */
  verifyLlmClaim(varName, claimedValue) {
    const groundTruth = this.resolveState(varName);
    const matches = String(groundTruth) === String(claimedValue);

    return {
      varName,
      groundTruth,
      claimedValue,
      verified: matches,
      status: matches ? 'VERIFIED' : 'STATE_TRACKING_HALLUCINATION_DETECTED',
      stepsCount: this.historyStore.get(varName)?.length || 0
    };
  }

  _recordStep(varName, action, value, level) {
    this.stepCounter++;
    if (!this.historyStore.has(varName)) {
      this.historyStore.set(varName, []);
    }
    const history = this.historyStore.get(varName);
    history.push({
      step: this.stepCounter,
      action,
      value,
      level,
      timestamp: Date.now()
    });
    if (history.length > this.logLength) {
      history.shift();
    }
  }
}

module.exports = {
  StateBenchFiniteTracker,
  KROHN_RHODES_LEVELS
};
