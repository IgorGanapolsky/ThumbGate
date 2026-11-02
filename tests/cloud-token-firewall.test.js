'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  estimateTokenCount,
  computeLoopSignature,
  compactTokenPayload,
  interceptAgentRequest,
  normalizeProjectSlug,
  validateSsoToken,
  revokeSsoToken,
  listCustomerProjects,
  registerCustomerProject,
  getOrCreateTenantUsage,
  resetCloudFirewallStateForTests,
  evaluateWajoFoTrustAndTaskCompletionSteal,
} = require('../src/cloud-token-firewall');

const {
  partitionFeedbackPaths,
  buildIntakeAlertRateLimitKey,
} = require('../src/api/server').__test__;

test.beforeEach(() => {
  resetCloudFirewallStateForTests();
});

test.afterEach(() => {
  resetCloudFirewallStateForTests();
});

test('cloud-token-firewall: normalizeProjectSlug protects against prototype pollution keys', () => {
  assert.equal(normalizeProjectSlug('__proto__'), 'default');
  assert.equal(normalizeProjectSlug('constructor'), 'default');
  assert.equal(normalizeProjectSlug('prototype'), 'default');
  assert.equal(normalizeProjectSlug('__PROTO__'), 'default');
  assert.equal(normalizeProjectSlug('PROTOTYPE'), 'default');
  assert.equal(normalizeProjectSlug('my-cool-project'), 'my-cool-project');
  assert.equal(normalizeProjectSlug('../../../etc/passwd'), 'etc-passwd');
});

test('cloud-token-firewall: registerCustomerProject rejects prototype pollution names and slugs', () => {
  const result = registerCustomerProject({
    name: '__proto__',
    slug: '__proto__',
    email: 'user@example.com',
  });
  assert.equal(result.ok, true);
  assert.equal(result.project.slug, 'default');
  assert.equal(({})['polluted'], undefined);
  assert.equal(Object.prototype.polluted, undefined);
});

test('cloud-token-firewall: getOrCreateTenantUsage sanitizes dangerous keys without prototype pollution', () => {
  const entry = getOrCreateTenantUsage('__proto__', 'cloud_indie');
  assert.equal(entry.tenantKey, 'anonymous');
  assert.equal(({})['tenantKey'], undefined);
  assert.equal(Object.prototype.tenantKey, undefined);
});

test('cloud-token-firewall: interceptAgentRequest enforces loop breaker and detects repeated tool calls', async () => {
  const toolCall = {
    name: 'bash',
    arguments: { cmd: 'ls -la' },
  };
  const messages = [{ role: 'user', content: 'run ls' }];

  const first = await interceptAgentRequest({
    sessionId: 'session_1',
    agentId: 'agent_1',
    toolCall,
    messages,
    maxLoopRepeats: 3,
  });
  assert.equal(first.ok, true);
  assert.equal(first.decision, 'ALLOW');
  assert.equal(first.repeatCount, 1);

  const second = await interceptAgentRequest({
    sessionId: 'session_1',
    agentId: 'agent_1',
    toolCall,
    messages,
    maxLoopRepeats: 3,
  });
  assert.equal(second.ok, true);
  assert.equal(second.repeatCount, 2);

  const third = await interceptAgentRequest({
    sessionId: 'session_1',
    agentId: 'agent_1',
    toolCall,
    messages,
    maxLoopRepeats: 3,
  });
  assert.equal(third.ok, false);
  assert.equal(third.decision, 'KILL_LOOP');
  assert.equal(third.loopDetected, true);
  assert.equal(third.repeatCount, 3);
});

test('cloud-token-firewall: evictedResultSignatures cannot be abused with non-string or dangerous keys to bypass loop detection', async () => {
  const toolCall = {
    name: 'read_file',
    arguments: { path: 'test.txt' },
  };
  const messages = [{ role: 'user', content: 'read test' }];

  // Advance repeat count to 2
  await interceptAgentRequest({ sessionId: 'sess_bypass', agentId: 'ag_bypass', toolCall, messages });
  await interceptAgentRequest({ sessionId: 'sess_bypass', agentId: 'ag_bypass', toolCall, messages });

  // Pass malicious evictedResultSignatures attempting prototype pollution or arbitrary bypass
  const blocked = await interceptAgentRequest({
    sessionId: 'sess_bypass',
    agentId: 'ag_bypass',
    toolCall,
    messages,
    evictedResultSignatures: ['__proto__', 'constructor', null, { toString: () => 'polluted' }],
  });
  assert.equal(blocked.loopDetected, true);
  assert.equal(blocked.decision, 'KILL_LOOP');
  assert.equal(Object.prototype.polluted, undefined);
});

test('cloud-token-firewall: tenant token quota is strictly enforced when cap is reached', async () => {
  const testTenant = 'test-quota-tenant';
  const usage = getOrCreateTenantUsage(testTenant, 'cloud_indie');
  usage.tokensOptimizedMonthly = 1_000_000; // indie cap is 1,000,000

  const res = await interceptAgentRequest({
    tenantKey: testTenant,
    tierId: 'cloud_indie',
    messages: [{ role: 'user', content: 'test message' }],
  });

  assert.equal(res.ok, false);
  assert.equal(res.decision, 'QUOTA_EXCEEDED');
  assert.equal(res.blocked, true);
});

test('cloud-token-firewall: compactTokenPayload and canonicalizeValue ignore dangerous object properties', () => {
  const malicious = JSON.parse('{"__proto__":{"polluted":true},"test":123}');
  const compacted = compactTokenPayload({
    messages: [{ role: 'user', content: malicious }],
  });
  assert.ok(compacted.originalTokens > 0);
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
});

test('cloud-token-firewall: Wajo FO requires exactly the approved HTTPS MCP endpoints', () => {
  const allowedEndpoints = ['https://mcp.api.wajo.ai/mcp', 'https://mcp.api.wajo.ai/fo'];
  assert.equal(evaluateWajoFoTrustAndTaskCompletionSteal().ok, true);
  assert.equal(evaluateWajoFoTrustAndTaskCompletionSteal({
    mcpServerEndpoints: [...allowedEndpoints].reverse(),
  }).ok, true);

  const invalidEndpointSets = [
    [...allowedEndpoints, 'https://attacker.example/collect'],
    [
      'https://attacker.example/path/https://mcp.api.wajo.ai/mcp',
      allowedEndpoints[1],
    ],
    ['http://mcp.api.wajo.ai/mcp', allowedEndpoints[1]],
    ['https://mcp.api.wajo.ai.attacker.example/mcp', allowedEndpoints[1]],
    ['https://user@mcp.api.wajo.ai/mcp', allowedEndpoints[1]],
    ['https://mcp.api.wajo.ai:8443/mcp', allowedEndpoints[1]],
    ['https://mcp.api.wajo.ai/mcp/extra', allowedEndpoints[1]],
    ['https://mcp.api.wajo.ai/mcp?redirect=https://attacker.example', allowedEndpoints[1]],
    [allowedEndpoints[0], allowedEndpoints[0]],
  ];

  for (const mcpServerEndpoints of invalidEndpointSets) {
    const result = evaluateWajoFoTrustAndTaskCompletionSteal({ mcpServerEndpoints });
    assert.equal(result.ok, false, JSON.stringify(mcpServerEndpoints));
    assert.ok(result.blockers.includes('wajo_fo_mcp_endpoints_incomplete'));
  }
});

test('api-server: partitionFeedbackPaths sanitizes partition against prototype pollution', () => {
  const basePaths = {
    FEEDBACK_DIR: '/tmp/feedback',
    FEEDBACK_LOG_PATH: '/tmp/feedback/feedback-log.jsonl',
  };

  const cleanIdentity = { partition: 'customer-123' };
  const partitioned = partitionFeedbackPaths(basePaths, cleanIdentity);
  assert.ok(partitioned.FEEDBACK_DIR.includes('customer-123'));

  const maliciousIdentity = { partition: '__proto__' };
  const safeFallback = partitionFeedbackPaths(basePaths, maliciousIdentity);
  assert.equal(safeFallback.FEEDBACK_DIR, basePaths.FEEDBACK_DIR);
  assert.equal(Object.prototype.polluted, undefined);
});

test('api-server: buildIntakeAlertRateLimitKey defends against header spoofing', () => {
  const mockReqWithSpoofedIp = {
    socket: { remoteAddress: '10.0.0.1' },
    headers: { 'x-real-ip': '1.2.3.4' },
  };

  // When not running on Railway, x-real-ip is untrusted and transport peer is used
  const keyNonRailway = buildIntakeAlertRateLimitKey(mockReqWithSpoofedIp, {});
  const expectedNonRailwayKey = require('node:crypto')
    .createHash('sha256')
    .update('10.0.0.1')
    .digest('hex');
  assert.equal(keyNonRailway, expectedNonRailwayKey);

  // When running on Railway with valid IP, x-real-ip is trusted
  const keyRailway = buildIntakeAlertRateLimitKey(mockReqWithSpoofedIp, {
    RAILWAY_ENVIRONMENT_ID: 'env_123',
  });
  const expectedRailwayKey = require('node:crypto')
    .createHash('sha256')
    .update('1.2.3.4')
    .digest('hex');
  assert.equal(keyRailway, expectedRailwayKey);
});
