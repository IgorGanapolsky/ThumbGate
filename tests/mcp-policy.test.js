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
  assert.ok(policy.profiles.locked);
});

test('profile allowlists differentiate permissions', () => {
  const defaultTools = getAllowedTools('default');
  const lockedTools = getAllowedTools('locked');
  assert.ok(defaultTools.length > lockedTools.length);
  assert.ok(isToolAllowed('feedback_summary', 'locked'));
  assert.equal(isToolAllowed('capture_feedback', 'locked'), false);
  assert.ok(isToolAllowed('plan_intent', 'locked'));
});

test('assertToolAllowed throws for denied tools', () => {
  assert.throws(() => assertToolAllowed('capture_feedback', 'locked'), /not allowed/);
});

test('subagent profile resolves mcp profile and conflicts are rejected', () => {
  const prevSubagent = process.env.RLHF_SUBAGENT_PROFILE;
  const prevMcpProfile = process.env.RLHF_MCP_PROFILE;

  process.env.RLHF_SUBAGENT_PROFILE = 'review_workflow';
  delete process.env.RLHF_MCP_PROFILE;
  assert.equal(getActiveMcpProfile(), 'readonly');

  process.env.RLHF_MCP_PROFILE = 'default';
  assert.throws(() => getActiveMcpProfile(), /MCP profile conflict/);

  if (typeof prevSubagent === 'string') process.env.RLHF_SUBAGENT_PROFILE = prevSubagent;
  else delete process.env.RLHF_SUBAGENT_PROFILE;
  if (typeof prevMcpProfile === 'string') process.env.RLHF_MCP_PROFILE = prevMcpProfile;
  else delete process.env.RLHF_MCP_PROFILE;
});
