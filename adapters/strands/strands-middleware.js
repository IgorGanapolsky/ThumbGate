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
  const defaultPinnedRules = options.pinnedRules && options.pinnedRules.length > 0
    ? options.pinnedRules
    : ['Always verify against local tests before claiming completion'];

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
     * Supports updating native event.result in place (retaining ToolResultBlock structure).
     */
    async afterToolCall(event = {}) {
      const rawResult = event.result !== undefined ? event.result : event;
      let outputText = '';
      if (typeof rawResult === 'string') {
        outputText = rawResult;
      } else if (rawResult && typeof rawResult === 'object') {
        if (Array.isArray(rawResult.content)) {
          outputText = rawResult.content.map((c) => (typeof c === 'string' ? c : c.text || '')).join('\n');
        } else if (typeof rawResult.text === 'string') {
          outputText = rawResult.text;
        } else {
          outputText = JSON.stringify(rawResult);
        }
      } else {
        outputText = String(rawResult || '');
      }

      const shunt = evaluateOutputShunt(outputText, shuntConfig);

      if (shunt.shunted) {
        if (typeof event === 'object' && event !== null && 'result' in event) {
          if (event.result && typeof event.result === 'object') {
            if (Array.isArray(event.result.content)) {
              event.result.content = [{ type: 'text', text: shunt.shuntedContent }];
            } else if ('text' in event.result) {
              event.result.text = shunt.shuntedContent;
            } else {
              event.result.content = [{ type: 'text', text: shunt.shuntedContent }];
            }
          } else {
            event.result = shunt.shuntedContent;
          }
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
     * Hook or ContextStrategy called when context utilization reaches threshold.
     * Implements Strands ContextStrategy.apply(context) returning boolean while
     * retaining pinned rules in conversation history.
     */
    onContextCompaction(param = {}) {
      const context = param.context || param;
      const history = Array.isArray(param.history)
        ? param.history
        : (context && Array.isArray(context.messages) ? context.messages : []);
      const pinnedRules = (param && Array.isArray(param.pinnedRules) && param.pinnedRules.length > 0)
        ? param.pinnedRules
        : defaultPinnedRules;
      const preservedRules = pinnedRules.map((r) => `[PINNED RULE]: ${r}`);

      let applied = false;
      if (preservedRules.length > 0) {
        const prefix = preservedRules.join('\n');
        if (history.length > 0 && typeof history[0] === 'object') {
          if (typeof history[0].content === 'string') {
            if (!history[0].content.includes('[PINNED RULE]')) {
              history[0].content = `${prefix}\n\n${history[0].content}`;
              applied = true;
            }
          } else if (Array.isArray(history[0].content)) {
            history[0].content.unshift({ type: 'text', text: prefix });
            applied = true;
          }
        } else if (Array.isArray(history)) {
          history.unshift({ role: 'system', content: prefix });
          applied = true;
        }
      }

      return {
        compacted: true,
        applied,
        injectedPrefix: preservedRules.join('\n'),
        timestamp: new Date().toISOString(),
      };
    },

    /**
     * Strands ContextStrategy contract: apply(context) => boolean
     */
    apply(context) {
      if (!context) return false;
      const res = this.onContextCompaction(context);
      return res && typeof res === 'object' ? Boolean(res.applied || res.compacted) : Boolean(res);
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
    agent.addHook('onContextCompaction', (e) => middleware.onContextCompaction(e));
  }
  if (agent && agent.contextManager) {
    if (typeof agent.contextManager.addStrategy === 'function') {
      agent.contextManager.addStrategy(middleware);
    } else if (typeof agent.contextManager.onCompaction === 'function') {
      agent.contextManager.onCompaction((e) => middleware.onContextCompaction(e));
    }
  }
  return middleware;
}

module.exports = {
  createStrandsGateMiddleware,
  registerStrandsGatePlugin,
};
