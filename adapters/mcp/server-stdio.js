#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const {
  captureFeedback,
  feedbackSummary,
  analyzeFeedback,
  writePreventionRules,
  FEEDBACK_LOG_PATH,
} = require('../../scripts/feedback-loop');
const { appendFunnelEvent } = require('../../scripts/billing');
const {
  ensureContextFs,
  constructContextPack,
  evaluateContextPack,
  getProvenance,
  updateScratchpad,
} = require('../../scripts/contextfs');
const {
  listIntents,
  planIntent,
} = require('../../scripts/intent-router');
const {
  getActiveMcpProfile,
  getAllowedTools,
  assertToolAllowed,
} = require('../../scripts/mcp-policy');
const {
  evaluateGates,
  evaluateSecretGuard,
} = require('../../scripts/gates-engine');
const { TOOLS } = require('../../scripts/tool-registry');

const SERVER_INFO = { name: 'mcp-memory-gateway-mcp', version: '0.7.2' };
const SAFE_DATA_DIR = path.resolve(path.dirname(FEEDBACK_LOG_PATH));

async function callTool(name, args = {}) {
  assertToolAllowed(name, getActiveMcpProfile());
  const firewallResult = evaluateGates(name, args) || evaluateSecretGuard({ tool_name: name, tool_input: args });
  if (firewallResult && firewallResult.decision === 'deny') {
    const err = new Error(`Action blocked by Semantic Firewall: ${firewallResult.message}`);
    err.errorCategory = 'permission';
    err.isRetryable = false;
    throw err;
  }
  return await callToolInner(name, args);
}

async function callToolInner(name, args = {}) {
  if (name === 'capture_feedback') return { content: [{ type: 'text', text: JSON.stringify(captureFeedback(args), null, 2) }] };
  if (name === 'recall') {
    const similar = await constructContextPack({ query: args.query, maxItems: args.limit || 5 });
    return { content: [{ type: 'text', text: JSON.stringify(similar, null, 2) }] };
  }
  return { content: [{ type: 'text', text: `Executed ${name}` }] };
}

async function handleRequest(message) {
  if (message.method === 'initialize') return { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: SERVER_INFO };
  if (message.method === 'tools/list') return { tools: TOOLS };
  if (message.method === 'tools/call') return callTool(message.params.name, message.params.arguments);
  throw new Error(`Unsupported method: ${message.method}`);
}

function startStdioServer() {
  appendFunnelEvent({ stage: "activation", event: "mcp_server_started", evidence: "stdio_init" });
  process.stdin.resume();
  process.stdin.on('data', async (chunk) => {
    try {
      const request = JSON.parse(chunk.toString());
      const result = await handleRequest(request);
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
    } catch (err) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: err.message } }) + '\n');
    }
  });
}

if (require.main === module) startStdioServer();
module.exports = { TOOLS, handleRequest, callTool, startStdioServer };
