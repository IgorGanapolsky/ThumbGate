/**
 * VelocityEngine: Mitigating the "Slowness Tax"
 * Based on West Monroe's "Why Speed Matters" research.
 * 
 * Core Principle: Decision hesitation (The Slowness Tax) erodes revenue.
 * Implementation: Fast-Path routing for high-confidence decisions 
 * and proactive "Decision-Deadlock" detection.
 */

class VelocityEngine {
  constructor(options = {}) {
    this.slownessTaxRate = options.slownessTaxRate || 0.05; // 5% revenue erosion per unit of delay
    this.confidenceThreshold = options.confidenceThreshold || 0.85;
  }

  /**
   * Calculates the "Slowness Tax" cost of a delayed decision.
   * @param {number} potentialValue - The projected revenue/value of the decision.
   * @param {number} delayHours - Hours of delay in decision/execution.
   */
  calculateSlownessTax(potentialValue, delayHours) {
    const tax = potentialValue * this.slownessTaxRate * (delayHours / 24);
    return {
      costOfDelay: tax,
      remainingValue: potentialValue - tax,
      verdict: tax > (potentialValue * 0.1) ? 'CRITICAL_SLOWNESS' : 'ACCEPTABLE_DELAY'
    };
  }

  /**
   * Fast-Path Routing: Bypasses complex multi-agent critique for 
   * high-confidence, low-risk actions.
   */
  determineRoute(confidence, riskLevel) {
    if (confidence >= this.confidenceThreshold && riskLevel === 'LOW') {
      return {
        route: 'FAST_PATH',
        action: 'EXECUTE_IMMEDIATELY',
        reason: 'High confidence, low risk. Avoiding the Slowness Tax.'
      };
    }
    return {
      route: 'STANDARD_PATH',
      action: 'CRITIQUE_AND_VERIFY',
      reason: 'Confidence below threshold or risk too high for Fast-Path.'
    };
  }

  /**
   * Decision-Deadlock Detection: Identifies when an agent loop 
   * is oscillating without converging on a decision.
   */
  detectDeadlock(history) {
    if (history.length < 3) return { deadlocked: false };
    
    const lastThree = history.slice(-3);
    const isOscillating = lastThree[0].decision === lastThree[2].decision && 
                         lastThree[0].decision !== lastThree[1].decision;

    return {
      deadlocked: isOscillating,
      remediation: isOscillating ? 'FORCE_ESCALATION_TO_HUMAN' : 'CONTINUE_ITERATION'
    };
  }
}

module.exports = { VelocityEngine };
