const test = require('node:test');
const assert = require('node:assert/strict');
const {
  loadMcpPolicy,
  getAllowedTools,
  isToolAllowed,
  getActiveMcpProfile,
  assertToolAllowed,
} = require('../scripts/mcp-policy');

test('loads mcp policy and profiles', () => {
  const policy = loadMcpPolicy();
  assert.ok(policy.profiles.default);
  assert.ok(policy.profiles.dispatch);
  assert.ok(policy.profiles.locked);
});

test('profile allowlists differentiate permissions', () => {
  const defaultTools = getAllowedTools('default');
  const dispatchTools = getAllowedTools('dispatch');
  const lockedTools = getAllowedTools('locked');
  assert.ok(defaultTools.length > lockedTools.length);
  assert.ok(dispatchTools.length > lockedTools.length);
  assert.ok(defaultTools.length > dispatchTools.length);
  assert.ok(isToolAllowed('feedback_summary', 'locked'));
  assert.equal(isToolAllowed('capture_feedback', 'locked'), false);
  assert.ok(isToolAllowed('verify_claim', 'locked'));
  assert.ok(isToolAllowed('plan_intent', 'locked'));
  assert.ok(isToolAllowed('dashboard', 'dispatch'));
  assert.ok(isToolAllowed('verify_claim', 'dispatch'));
  assert.equal(isToolAllowed('capture_feedback', 'dispatch'), false);
  assert.equal(isToolAllowed('start_handoff', 'dispatch'), false);
  assert.ok(isToolAllowed('track_action', 'default'));
  assert.ok(isToolAllowed('report_product_issue', 'default'));
  assert.ok(isToolAllowed('report_product_issue', 'essential'));
  assert.equal(isToolAllowed('track_action', 'readonly'), false);
  assert.ok(isToolAllowed('register_claim_gate', 'default'));
});

test('assertToolAllowed throws for denied tools', () => {
  assert.throws(() => assertToolAllowed('capture_feedback', 'locked'), /not allowed/);
});

test('subagent profile resolves mcp profile and conflicts are rejected', () => {
  const prevSubagent = process.env.THUMBGATE_SUBAGENT_PROFILE;
  const prevMcpProfile = process.env.THUMBGATE_MCP_PROFILE;

  process.env.THUMBGATE_SUBAGENT_PROFILE = 'review_workflow';
  delete process.env.THUMBGATE_MCP_PROFILE;
  assert.equal(getActiveMcpProfile(), 'readonly');

  process.env.THUMBGATE_MCP_PROFILE = 'default';
  assert.throws(() => getActiveMcpProfile(), /MCP profile conflict/);

  if (typeof prevSubagent === 'string') process.env.THUMBGATE_SUBAGENT_PROFILE = prevSubagent;
  else delete process.env.THUMBGATE_SUBAGENT_PROFILE;
  if (typeof prevMcpProfile === 'string') process.env.THUMBGATE_MCP_PROFILE = prevMcpProfile;
  else delete process.env.THUMBGATE_MCP_PROFILE;
});
