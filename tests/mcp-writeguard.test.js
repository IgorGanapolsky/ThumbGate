'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RISK_TIERS,
  classifyMcpTool,
  scrubSensitiveData,
  scanForDestructivePatterns,
  evaluateMcpCall,
  exportCloudflareWriteGuardPolicy,
} = require('../src/mcp-writeguard.js');

test('MCP WriteGuard: classifies standard tools into correct risk tiers', () => {
  assert.equal(classifyMcpTool('view_file'), RISK_TIERS.READ);
  assert.equal(classifyMcpTool('grep_search'), RISK_TIERS.READ);
  assert.equal(classifyMcpTool('list_dir'), RISK_TIERS.READ);
  assert.equal(classifyMcpTool('write_to_file'), RISK_TIERS.WRITE);
  assert.equal(classifyMcpTool('replace_file_content'), RISK_TIERS.WRITE);
  assert.equal(classifyMcpTool('run_command'), RISK_TIERS.PRIVILEGED_WRITE);
  assert.equal(classifyMcpTool('manage_task'), RISK_TIERS.PRIVILEGED_WRITE);
  assert.equal(classifyMcpTool('set_branch_governance'), RISK_TIERS.ADMIN);
  assert.equal(classifyMcpTool('approve_protected_action'), RISK_TIERS.ADMIN);
});

test('MCP WriteGuard: handles custom policy overrides and heuristics', () => {
  assert.equal(classifyMcpTool('delete_database_record'), RISK_TIERS.PRIVILEGED_WRITE);
  assert.equal(classifyMcpTool('create_user_profile'), RISK_TIERS.WRITE);
  assert.equal(classifyMcpTool('fetch_custom_data'), RISK_TIERS.READ);

  const customOverrides = {
    custom_safe_query: { tier: RISK_TIERS.READ },
    dangerous_custom_script: { tier: RISK_TIERS.ADMIN },
  };
  assert.equal(classifyMcpTool('custom_safe_query', customOverrides), RISK_TIERS.READ);
  assert.equal(classifyMcpTool('dangerous_custom_script', customOverrides), RISK_TIERS.ADMIN);
});

test('MCP WriteGuard: scrubs sensitive keys and inline auth tokens from parameters', () => {
  const dirtyParams = {
    user: 'igorganapolsky',
    apiKey: 'test-api-key-value-12345',
    authToken: 'test-auth-token-value-67890',
    password: 'mock-password-val',
    nested: {
      client_secret: 'mock-client-secret-val',
      regularKey: 'regularValue',
      authorizationHeader: 'Bearer test-token-not-a-secret',
    },
  };

  const scrubbed = scrubSensitiveData(dirtyParams);

  assert.equal(scrubbed.user, 'igorganapolsky');
  assert.equal(scrubbed.apiKey, '[REDACTED]');
  assert.equal(scrubbed.authToken, '[REDACTED]');
  assert.equal(scrubbed.password, '[REDACTED]');
  assert.equal(scrubbed.nested.client_secret, '[REDACTED]');
  assert.equal(scrubbed.nested.regularKey, 'regularValue');
  assert.match(scrubbed.nested.authorizationHeader, /Bearer \[REDACTED\]/);
});

test('MCP WriteGuard: detects dangerous destructive command patterns', () => {
  const safe = scanForDestructivePatterns('run_command', { CommandLine: 'npm test' });
  assert.equal(safe.length, 0);

  const rmRoot = scanForDestructivePatterns('run_command', { CommandLine: 'rm -rf /' });
  assert.ok(rmRoot.length > 0);

  const dropTable = scanForDestructivePatterns('run_command', { CommandLine: 'DROP TABLE users CASCADE' });
  assert.ok(dropTable.length > 0);

  const forcePush = scanForDestructivePatterns('run_command', { CommandLine: 'git push origin main --force' });
  assert.ok(forcePush.length > 0);
});

test('MCP WriteGuard: evaluates calls and emits structured attribution receipts', () => {
  const allowed = evaluateMcpCall({
    server: 'github',
    tool: 'view_file',
    parameters: { path: 'README.md' },
    context: { user: 'developer-1', sessionId: 'sess-123' },
  });

  assert.equal(allowed.decision, 'allowed');
  assert.equal(allowed.riskTier, 'read');
  assert.equal(allowed.tool, 'view_file');
  assert.equal(allowed.user, 'developer-1');
  assert.equal(allowed.sessionId, 'sess-123');
  assert.ok(allowed.eventId.startsWith('wg_'));

  const blocked = evaluateMcpCall({
    server: 'terminal',
    tool: 'run_command',
    parameters: { CommandLine: 'rm -rf /tmp/data && rm -rf /' },
    context: { user: 'agent-bot', sessionId: 'sess-999' },
  });

  assert.equal(blocked.decision, 'blocked');
  assert.equal(blocked.riskTier, 'privileged_write');
  assert.ok(blocked.reasons.length > 0);

  const escalated = evaluateMcpCall(
    {
      server: 'governance',
      tool: 'set_branch_governance',
      parameters: { branch: 'main' },
    },
    { allowAdmin: false }
  );

  assert.equal(escalated.decision, 'escalated');
  assert.equal(escalated.riskTier, 'admin');
});

test('MCP WriteGuard: exports valid Cloudflare WriteGuard policy JSON', () => {
  const tools = ['view_file', 'write_to_file', 'run_command', 'set_branch_governance'];
  const policy = exportCloudflareWriteGuardPolicy(tools);

  assert.equal(policy.version, '1.0');
  assert.equal(policy.engine, 'ThumbGate-WriteGuard');
  assert.equal(policy.policies.view_file.riskTier, 'read');
  assert.equal(policy.policies.view_file.action, 'allow');
  assert.equal(policy.policies.run_command.riskTier, 'privileged_write');
  assert.equal(policy.policies.run_command.action, 'guard');
  assert.equal(policy.policies.set_branch_governance.riskTier, 'admin');
  assert.equal(policy.policies.set_branch_governance.action, 'escalate');
});

test('MCP WriteGuard CLI: parseArgs parses options correctly', () => {
  const { parseArgs } = require('../scripts/mcp-writeguard.js');
  const parsed = parseArgs([
    '--tool', 'write_to_file',
    '--server', 'filesystem',
    '--params', '{"path":"/tmp/test"}',
    '--json',
    '--audit-log', '/tmp/audit.log',
  ]);

  assert.equal(parsed.tool, 'write_to_file');
  assert.equal(parsed.server, 'filesystem');
  assert.deepEqual(parsed.params, { path: '/tmp/test' });
  assert.equal(parsed.json, true);
  assert.equal(parsed.auditLog, '/tmp/audit.log');
});
