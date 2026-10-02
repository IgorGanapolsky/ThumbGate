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
     * Supports both Strands native event format (event.toolUse, event.cancel)
     * and direct parameters ({ toolName, input }).
     */
    async beforeToolCall(event = {}) {
      if (!preActionEnabled) {
        return { allow: true };
      }

      const toolName = event.toolUse?.name || event.toolName || '';
      const input = event.toolUse?.input !== undefined ? event.toolUse.input : event.input;

      const evaluation = evaluatePreActionDiode({ name: toolName, input });
      if (evaluation.decision === 'BLOCK') {
        const reason = evaluation.violation || 'Action blocked by ThumbGate pre-action diode';
        if (typeof event === 'object' && event !== null) {
          event.cancel = true;
          event.reason = reason;
        }
        return {
          allow: false,
          decision: 'BLOCK',
          reason,
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
     * Truncates oversized returns to enforce token efficiency.
     * Supports updating native event.result in place.
     */
    async afterToolCall(event = {}) {
      const rawResult = event.result !== undefined ? event.result : event;
      const outputText = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult);
      const shunt = evaluateOutputShunt(outputText, shuntConfig);

      if (shunt.shunted) {
        if (typeof event === 'object' && event !== null && 'result' in event) {
          event.result = shunt.shuntedContent;
        }
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
        result: rawResult,
      };
    },

    /**
     * Hook called when context utilization reaches threshold (e.g. 75%).
     * Pins critical prevention rules so they are never forgotten during compaction.
     */
    async onContextCompaction({ history = [], pinnedRules = [] } = {}) {
      const preservedRules = pinnedRules.map((r) => `[PINNED RULE]: ${r}`);
      return {
        compacted: true,
        injectedPrefix: preservedRules.join('\n'),
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Helper to register ThumbGate middleware with a Strands Agent instance.
 */
function registerStrandsGatePlugin(agent, options = {}) {
  const middleware = createStrandsGateMiddleware(options);
  if (agent && typeof agent.addHook === 'function') {
    agent.addHook('beforeToolCall', (e) => middleware.beforeToolCall(e));
    agent.addHook('afterToolCall', (e) => middleware.afterToolCall(e));
  }
  return middleware;
}

module.exports = {
  createStrandsGateMiddleware,
  registerStrandsGatePlugin,
};
