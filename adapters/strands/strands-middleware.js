'use strict';

/**
 * adapters/strands/strands-middleware.js
 *
 * ThumbGate Governance Middleware for AWS Strands Harness (`@strands-agents/harness` & Python `strands-harness`).
 *
 * Injects:
 * 1. PreToolUse Safety Diode: Intercepts and blocks dangerous or unverified tool mutations before execution.
 * 2. Token-Shunt Output Truncation: Prevents massive tool outputs from blowing up the context window.
 * 3. Context Compaction Guardian: Retains durable ThumbGate prevention rules during window compaction.
 */

const { evaluateOutputShunt, evaluatePreActionDiode } = require('../../scripts/strands-harness-doctor');

function createStrandsGateMiddleware(options = {}) {
  const shuntConfig = options.tokenShunt || { maxOutputLines: 350, maxOutputBytes: 16384 };
  const preActionEnabled = options.preActionDiode?.enabled !== false;

  return {
    name: 'thumbgate-strands-middleware',
    version: '1.0.0',

    /**
     * Hook called by Strands Harness right before a tool is dispatched.
     * Return { allow: true } to proceed, or { allow: false, reason } to halt tool execution.
     */
    async beforeToolCall({ toolName, input, context = {} }) {
      if (!preActionEnabled) {
        return { allow: true };
      }

      const evaluation = evaluatePreActionDiode({ name: toolName, input });
      if (evaluation.decision === 'BLOCK') {
        return {
          allow: false,
          decision: 'BLOCK',
          reason: evaluation.violation || 'Action blocked by ThumbGate pre-action diode',
          toolName,
          timestamp: new Date().toISOString(),
        };
      }

      return {
        allow: true,
        decision: 'ALLOW',
        toolName,
      };
    },

    /**
     * Hook called by Strands Harness right after a tool produces output.
     * Truncates oversized returns to enforce 45-77% token efficiency.
     */
    async afterToolCall({ toolName, result, context = {} }) {
      const outputText = typeof result === 'string' ? result : JSON.stringify(result);
      const shunt = evaluateOutputShunt(outputText, shuntConfig);

      if (shunt.shunted) {
        return {
          shunted: true,
          result: shunt.shuntedContent,
          reductionPct: shunt.reductionPct,
          originalLines: shunt.originalLineCount,
          shuntedLines: shunt.shuntedLineCount,
        };
      }

      return {
        shunted: false,
        result,
      };
    },

    /**
     * Hook called when context utilization reaches threshold (e.g. 75%).
     * Pins critical prevention rules so they are never forgotten during compaction.
     */
    async onContextCompaction({ history = [], pinnedRules = [] }) {
      const preservedRules = pinnedRules.map((r) => `[PINNED RULE]: ${r}`);
      return {
        compacted: true,
        injectedPrefix: preservedRules.join('\n'),
        timestamp: new Date().toISOString(),
      };
    },
  };
}

module.exports = {
  createStrandsGateMiddleware,
};
