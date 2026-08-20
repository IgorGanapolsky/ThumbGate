"use strict";

/**
 * MiMinions Adapter
 *
 * Bridges MiMinions WorkflowRun / WorkflowTrace schemas (Pydantic-AI)
 * into ThumbGate reliability telemetry, pre-action WriteGuard interdiction,
 * and DPO feedback loops.
 */

const { classifyMcpTool, scrubSensitiveData, scanForDestructivePatterns, RISK_TIERS } = require("./mcp-writeguard");

/**
 * Validates and wraps a MiMinions tool invocation before execution.
 *
 * @param {Object} toolCall - { tool_name, args, kwargs }
 * @param {Object} [options] - Configuration overrides
 * @returns {Object} Evaluation verdict { allowed, tier, scrubbedKwargs, reason }
 */
function guardMiMinionsToolCall(toolCall, options = {}) {
  const toolName = toolCall.tool_name || toolCall.toolName || "unknown_tool";
  const tier = classifyMcpTool(toolName, options.toolOverrides);
  const rawKwargs = toolCall.kwargs || {};
  const scrubbedKwargs = scrubSensitiveData(rawKwargs);

  // Scan for destructive patterns if privileged
  const destructiveFindings = scanForDestructivePatterns(toolName, scrubbedKwargs);
  if (destructiveFindings.length > 0) {
    return {
      allowed: false,
      tier,
      decision: "blocked",
      reasons: destructiveFindings,
      scrubbedKwargs,
    };
  }

  if (tier === RISK_TIERS.ADMIN && !options.allowAdmin) {
    return {
      allowed: false,
      tier,
      decision: "escalated",
      reasons: ["Admin tool calls require explicit operator approval"],
      scrubbedKwargs,
    };
  }

  return {
    allowed: true,
    tier,
    decision: "allowed",
    reasons: [],
    scrubbedKwargs,
  };
}

/**
 * Converts a ThumbGate task outcome / receipt into a MiMinions-compatible WorkflowRun object.
 *
 * @param {Object} receipt - ThumbGate task receipt
 * @returns {Object} MiMinions WorkflowRun JSON schema
 */
function exportToMiMinionsWorkflowRun(receipt) {
  const agentName = receipt.agentName || receipt.agentId || "ThumbGate-Agent";
  const trace = [];

  // Agent prompt record
  trace.push({
    type: "agent",
    id: "run_" + (receipt.taskId || "task_0"),
    created_at: receipt.createdAt || new Date().toISOString(),
    prompt: receipt.prompt || "",
    output: receipt.result || receipt.summary || null,
  });

  // Tool execution records
  if (Array.isArray(receipt.toolCalls)) {
    receipt.toolCalls.forEach((tc, idx) => {
      trace.push({
        type: "tool",
        tool_name: tc.tool || tc.name || "unknown",
        args: tc.args || [],
        kwargs: scrubSensitiveData(tc.parameters || tc.kwargs || {}),
        result: tc.result || null,
        error: tc.error || null,
        order: idx + 1,
        timestamp: tc.timestamp || new Date().toISOString(),
        status: tc.status || (tc.error ? "error" : "success"),
        execution_time_ms: tc.latencyMs || tc.executionTimeMs || null,
      });
    });
  }

  return {
    schema_version: 2,
    id: "wf_" + (receipt.workflowId || receipt.taskId || "run"),
    created_at: receipt.createdAt || new Date().toISOString(),
    agent_name: agentName,
    trace,
  };
}

module.exports = {
  guardMiMinionsToolCall,
  exportToMiMinionsWorkflowRun,
};
