'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DAILY_POST_ROTATION,
  classifyLinkedInPostAndDraftComment,
} = require('../scripts/linkedin-monetization-sentinel');

test('DAILY_POST_ROTATION: includes Hotdata POC, Operator Framework, and Decisive-Step DPO posts', () => {
  assert.ok(DAILY_POST_ROTATION.length >= 3);
  assert.equal(DAILY_POST_ROTATION[0].id, 'hotdata-lancedb-swap-poc');
  assert.match(DAILY_POST_ROTATION[0].body, /poc\/hotdata-lancedb-swap/);
  assert.match(DAILY_POST_ROTATION[1].body, /thumbgate\.ai\/operator-framework/);
});

test('classifyLinkedInPostAndDraftComment: drafts high-signal B2B comments for n8n, LangGraph, and MCP posts', () => {
  const n8nPost = classifyLinkedInPostAndDraftComment({
    urn: 'urn:li:activity:1001',
    author: 'Alex Builder',
    text: 'Just deployed an n8n AI agent workflow with webhook triggers for our client.',
  });
  assert.ok(n8nPost);
  assert.equal(n8nPost.category, 'workflow_automation_guardrail');
  assert.match(n8nPost.comment, /PreToolUse/);

  const lgPost = classifyLinkedInPostAndDraftComment({
    urn: 'urn:li:activity:1002',
    author: 'Sarah Systems',
    text: 'Scaling multi-agent LangGraph and CrewAI pipelines in production requires strict state handoffs.',
  });
  assert.ok(lgPost);
  assert.equal(lgPost.category, 'multi_agent_state_firewall');

  const mcpPost = classifyLinkedInPostAndDraftComment({
    urn: 'urn:li:activity:1003',
    author: 'Dev Infra',
    text: 'How are teams securing Claude Code and MCP tool calls against prompt injection?',
  });
  assert.ok(mcpPost);
  assert.equal(mcpPost.category, 'mcp_pretooluse_diode');
});

test('classifyLinkedInPostAndDraftComment: skips own posts and real-estate/tax-deed posts', () => {
  const own = classifyLinkedInPostAndDraftComment({
    urn: 'urn:li:activity:1004',
    author: 'Igor Ganapolsky',
    text: 'Deploying LangGraph agents with ThumbGate PreToolUse.',
  });
  assert.equal(own, null);

  const taxDeed = classifyLinkedInPostAndDraftComment({
    urn: 'urn:li:activity:1005',
    author: 'Someone Else',
    text: 'Palm Beach County tax-deed foreclosure auction results.',
  });
  assert.equal(taxDeed, null);
});
