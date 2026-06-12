'use strict';

const path = require('node:path');
const { Trace } = require('./langsmith');
const llm = require('./llm');
const { queryVectorDB } = require('./vector-db');
const { redactPii } = require('../../../scripts/pii-scanner');
const { redactSecrets } = require('../../../scripts/secret-redaction');
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
 * Refined RAG pipeline showing:
 * 1. Semantic retrieval (RAG) using HNSW LanceDB for standard questions.
 * 2. PreToolUse tool calling interception for harmful operations.
 */
async function executeRAGPipeline(question) {
  const trace = new Trace('manufacturing_copilot_ask', { question });
  const gatesReport = [];

  try {
    // 1. Detect if the query tries to execute a tool action
    const proposedToolCall = detectProposedToolCall(question);

    if (proposedToolCall) {
      // Trace the tool evaluation span
      const gateResult = await trace.span('pre_tool_use_gate', 'llm', { proposedToolCall }, async () => {
        const evaluation = evaluatePreToolUseGate(proposedToolCall);
        gatesReport.push({
          gate: evaluation.gate || 'tool_safety',
          status: evaluation.allowed ? 'pass' : 'block',
          detail: evaluation.allowed ? 'Tool call allowed' : evaluation.reason,
          toolName: proposedToolCall.toolName,
          input: proposedToolCall.input
        });
        return evaluation;
      });

      if (!gateResult.allowed) {
        const output = {
          answer: `[ThumbGate Firewall Blocked Action]\nTool: ${proposedToolCall.toolName}\nReason: ${gateResult.reason}`,
          status: 'blocked',
          toolCall: proposedToolCall,
          gates: gatesReport,
        };
        return trace.end(output);
      }
    }

    // 2. Standard Query: Perform semantic lookup on LanceDB
    const retrievedChunks = await trace.span('retrieval', 'retriever', { query: question }, async () => {
      return await queryVectorDB(question, 1); // Get top matching chunk
    });

    const context = retrievedChunks.length > 0 ? retrievedChunks[0].text : 'No matching manual procedures found.';
    const systemPrompt = `You are a plant assistant for Acme Fabrication Plant 7 floor supervisors.
Answer operational questions accurately based on the provided reference documentation.
Keep your answer concise and reference the safety procedure code (like SP-xxx or MM-xxx) if available.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Context:\n${context}\n\nQuestion: ${question}` }
    ];

    const modelResponse = await trace.span('llm_call', 'llm', { messages }, async () => {
      return await llm.chat(messages, { temperature: 0 });
    });

    const sanitizedAnswer = redactSecrets(redactPii(modelResponse));

    const successOutput = {
      answer: sanitizedAnswer,
      status: 'pass',
      toolCall: null,
      gates: [
        {
          gate: 'rlhf_feedback_layer',
          status: 'pass',
          detail: 'Answer generated. Operator feedback thumbs-up/down requested.'
        }
      ],
      retrievedChunks: retrievedChunks.map(c => ({ title: c.title, source: c.source }))
    };

    return trace.end(successOutput);

  } catch (error) {
    console.error('[rag-pipeline] Failure:', error);
    const failOutput = {
      answer: `Internal Error: ${error.message}`,
      status: 'error',
      gates: []
    };
    return trace.end(failOutput);
  }
}

module.exports = {
  executeRAGPipeline,
  detectProposedToolCall,
  evaluatePreToolUseGate
};
