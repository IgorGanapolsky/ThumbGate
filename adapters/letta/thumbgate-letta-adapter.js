#!/usr/bin/env node
'use strict';

const { normalizeProviderAction } = require('../../scripts/provider-action-normalizer');

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function firstString(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function extractLettaToolCall(input = {}) {
  const event = asObject(input);
  const toolCall = asObject(event.toolCall || event.tool_call || event.lettaToolCall);
  const functionCall = asObject(toolCall.function || event.function);
  const mcp = asObject(event.mcp || event.mcpToolCall);
  const clientTool = asObject(event.clientTool || event.client_tool);
  const params = asObject(event.params);

  const name = firstString(
    event.toolName,
    event.name,
    toolCall.name,
    functionCall.name,
    clientTool.name,
    mcp.name,
    params.name
  );
  const args = asObject(
    event.arguments
      || event.args
      || event.input
      || toolCall.arguments
      || toolCall.input
      || functionCall.arguments
      || clientTool.arguments
      || clientTool.input
      || mcp.arguments
      || params.arguments
  );

  return {
    id: firstString(event.id, event.toolCallId, event.tool_call_id, toolCall.id, clientTool.id),
    name,
    arguments: args,
    server: firstString(event.mcpServer, mcp.server, params.server),
    surface: firstString(event.surface, event.executionSurface, clientTool.name ? 'client-tool' : mcp.name || params.name ? 'mcp-tool' : 'server-tool'),
  };
}

function normalizeLettaAction(input = {}) {
  const event = asObject(input);
  const toolCall = extractLettaToolCall(event);

  const normalized = normalizeProviderAction({
    ...event,
    provider: 'letta',
    toolCall: {
      id: toolCall.id,
      name: toolCall.name,
      input: toolCall.arguments,
    },
    toolName: toolCall.name,
    input: toolCall.arguments,
    mcpServer: toolCall.server,
  });

  return {
    ...normalized,
    provider: 'letta',
    agentRuntime: 'letta',
    letta: {
      agentId: firstString(event.agentId, event.agent_id),
      messageId: firstString(event.messageId, event.message_id),
      surface: toolCall.surface,
      toolCallId: toolCall.id,
    },
  };
}

function normalizeGateDecision(decision = {}) {
  const value = asObject(decision);
  const raw = firstString(value.decision, value.mode, value.action, value.status).toLowerCase();
  const blocked = value.allowed === false
    || value.accepted === false
    || value.blocked === true
    || ['block', 'deny', 'denied', 'reject', 'rejected'].includes(raw);
  const approvalRequired = value.requiresApproval === true || raw === 'approve';
  return {
    allowed: !blocked && !approvalRequired,
    blocked,
    approvalRequired,
    reason: firstString(value.reason, value.message, Array.isArray(value.reasons) ? value.reasons.join('; ') : ''),
    raw: value,
  };
}

function createLettaToolGuard({ gateCheck, executeTool, onDecision } = {}) {
  if (typeof gateCheck !== 'function') {
    throw new TypeError('createLettaToolGuard requires a gateCheck function');
  }
  if (typeof executeTool !== 'function') {
    throw new TypeError('createLettaToolGuard requires an executeTool function');
  }

  return async function guardedLettaTool(input = {}) {
    const normalizedAction = normalizeLettaAction(input);
    const decision = normalizeGateDecision(await gateCheck(normalizedAction));
    if (typeof onDecision === 'function') {
      await onDecision({ normalizedAction, decision });
    }
    if (!decision.allowed) {
      const error = new Error(decision.reason || 'ThumbGate blocked this Letta tool call before execution.');
      error.code = decision.approvalRequired ? 'THUMBGATE_APPROVAL_REQUIRED' : 'THUMBGATE_BLOCKED';
      error.thumbgate = { normalizedAction, decision };
      throw error;
    }
    return executeTool(input, { normalizedAction, decision });
  };
}

module.exports = {
  createLettaToolGuard,
  extractLettaToolCall,
  normalizeGateDecision,
  normalizeLettaAction,
};
