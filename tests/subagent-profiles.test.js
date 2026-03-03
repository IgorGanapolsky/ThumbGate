const test = require('node:test');
const assert = require('node:assert/strict');
const {
  listSubagentProfiles,
  getSubagentProfile,
  validateSubagentProfiles,
} = require('../scripts/subagent-profiles');

test('lists and loads subagent profiles', () => {
  const names = listSubagentProfiles();
  assert.ok(names.includes('pr_workflow'));
  const profile = getSubagentProfile('pr_workflow');
  assert.equal(profile.mcpProfile, 'default');
});

test('subagent profiles validate against mcp policy', () => {
  const result = validateSubagentProfiles();
  assert.equal(result.valid, true);
  assert.equal(result.issues.length, 0);
});
