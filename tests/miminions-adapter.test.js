"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { guardMiMinionsToolCall, exportToMiMinionsWorkflowRun } = require("../src/miminions-adapter");
const { RISK_TIERS } = require("../src/mcp-writeguard");

test("MiMinions Adapter: guards safe tool calls and scrubs parameters", () => {
  const safeCall = {
    tool_name: "view_file",
    args: [],
    kwargs: {
      path: "README.md",
      auth_token: "mock-token-sample-12345",
    },
  };

  const verdict = guardMiMinionsToolCall(safeCall);
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.decision, "allowed");
  assert.equal(verdict.tier, RISK_TIERS.READ);
  assert.equal(verdict.scrubbedKwargs.auth_token, "[REDACTED]");
  assert.equal(verdict.scrubbedKwargs.path, "README.md");
});

test("MiMinions Adapter: blocks destructive command patterns", () => {
  const dangerousCall = {
    tool_name: "run_command",
    kwargs: {
      CommandLine: "rm -rf / && rm -rf /var",
    },
  };

  const verdict = guardMiMinionsToolCall(dangerousCall);
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.decision, "blocked");
  assert.equal(verdict.tier, RISK_TIERS.PRIVILEGED_WRITE);
  assert.ok(verdict.reasons.length > 0);
});

test("MiMinions Adapter: escalates admin-level tool calls without authorization", () => {
  const adminCall = {
    tool_name: "set_branch_governance",
    kwargs: {
      branch: "main",
    },
  };

  const verdict = guardMiMinionsToolCall(adminCall, { allowAdmin: false });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.decision, "escalated");
  assert.equal(verdict.tier, RISK_TIERS.ADMIN);
});

test("MiMinions Adapter: exports ThumbGate receipts into valid MiMinions WorkflowRun schema", () => {
  const receipt = {
    taskId: "task_4829",
    workflowId: "wf_9921",
    agentName: "Ship-Engineer",
    createdAt: "2026-08-19T12:00:00Z",
    prompt: "Refactor database queries for performance",
    result: "All queries optimized and tested.",
    toolCalls: [
      {
        tool: "grep_search",
        parameters: { query: "SELECT" },
        result: "Found 12 occurrences",
        latencyMs: 45,
      },
      {
        tool: "replace_file_content",
        parameters: { TargetFile: "db.js", apiKey: "mock-api-key-sample" },
        result: "Replaced line 42",
        latencyMs: 12,
      },
    ],
  };

  const workflowRun = exportToMiMinionsWorkflowRun(receipt);
  assert.equal(workflowRun.schema_version, 2);
  assert.equal(workflowRun.id, "wf_wf_9921");
  assert.equal(workflowRun.agent_name, "Ship-Engineer");
  assert.equal(workflowRun.trace.length, 3); // 1 agent + 2 tools

  const agentRecord = workflowRun.trace[0];
  assert.equal(agentRecord.type, "agent");
  assert.equal(agentRecord.prompt, "Refactor database queries for performance");
  assert.equal(agentRecord.output, "All queries optimized and tested.");

  const toolRecord1 = workflowRun.trace[1];
  assert.equal(toolRecord1.type, "tool");
  assert.equal(toolRecord1.tool_name, "grep_search");
  assert.equal(toolRecord1.execution_time_ms, 45);

  const toolRecord2 = workflowRun.trace[2];
  assert.equal(toolRecord2.type, "tool");
  assert.equal(toolRecord2.tool_name, "replace_file_content");
  assert.equal(toolRecord2.kwargs.apiKey, "[REDACTED]");
});
