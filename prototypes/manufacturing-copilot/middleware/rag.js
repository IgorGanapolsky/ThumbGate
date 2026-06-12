'use strict';

const { executeManufacturingGraph } = require('./graph');
/**
 * Checks if the user request implies executing a physical plant action (tool call).
 * Returns the proposed tool call object or null.
 */
function detectProposedToolCall(query) {
  const q = query.toLowerCase();

  if (q.includes('bypass') || q.includes('disable') || q.includes('override') || q.includes('mute')) {
    return {
      toolName: 'override_interlock',
      input: {
        machine: q.includes('vm-22') ? 'CNC Mill VM-22' : 'Hydraulic Press HP-400',
        parameter: 'safety_interlock',
        value: 'disabled'
      },
      description: 'Defeat machine safety guard or interlock switch'
    };
  }

  if (q.includes('shutdown') || q.includes('stop assembly') || q.includes('turn off')) {
    return {
      toolName: 'trigger_emergency_shutdown',
      input: {
        target: q.includes('c-3') ? 'Conveyor Line C-3' : 'Main Press Line HP-400',
        reason: 'Operator manual request'
      },
      description: 'Activate emergency power cutoff to manufacturing line'
    };
  }

  return null;
}

/**
 * ThumbGate PreAction Firewall: Evaluates tool calls against deterministic safety rules.
 * Returns { allowed: boolean, reason: string, gate: string }
 */
function evaluatePreToolUseGate(toolCall) {
  if (!toolCall) return { allowed: true };

  if (toolCall.toolName === 'override_interlock') {
    return {
      allowed: false,
      gate: 'no_safety_bypass',
      reason: 'CRITICAL SECURITY VIOLATION: Defeating or bypassing machine interlocks is strictly prohibited under safety regulation SP-110.'
    };
  }

  if (toolCall.toolName === 'trigger_emergency_shutdown') {
    return {
      allowed: false,
      gate: 'no_unauthorized_shutdown',
      reason: 'BLOCKED: Emergency line shutdown tool calls require supervisor authorization code or a detected sensor anomaly.'
    };
  }

  return { allowed: true };
}

/**
 * Public RAG facade. The actual chatbot workflow is a LangGraph state machine
 * using LangChain prompt/retriever components. ThumbGate is only invoked for
 * outbound tool-call firewall checks and feedback capture elsewhere.
 */
async function executeRAGPipeline(question, options = {}) {
  return executeManufacturingGraph(question, {
    detectProposedToolCall,
    evaluatePreToolUseGate,
    ...options,
  });
}

module.exports = {
  executeRAGPipeline,
  detectProposedToolCall,
  evaluatePreToolUseGate
};
