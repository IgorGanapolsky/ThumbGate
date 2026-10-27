const test = require('node:test');
const assert = require('node:assert');
const { buildCiGithubActionsPreToolUseWorkflowYaml } = require('../src/cloud-token-firewall');

test('buildCiGithubActionsPreToolUseWorkflowYaml correctly generates workflow file content', () => {
  const orgId = 'org_12345';
  const apiBaseUrl = 'https://api.thumbgate.io';

  const yaml = buildCiGithubActionsPreToolUseWorkflowYaml({ orgId, apiBaseUrl });

  // Verify pull_request trigger is present
  assert.match(yaml, /on:\s+pull_request:/, 'YAML should contain pull_request trigger');

  // Verify apiBaseUrl and endpoint
  assert.match(yaml, new RegExp(`POST "${apiBaseUrl}/v1/cloud/policy-sync"`), 'YAML should contain the correct endpoint');

  // Verify orgId is included
  assert.match(yaml, new RegExp(`"orgId": "${orgId}"`), 'YAML should include the orgId');

  // Verify threat packs are included
  assert.match(yaml, /"threatPacks": \["AWS", "SOC2", "Git\/DB"\]/, 'YAML should include AWS, SOC2, Git/DB threat packs');
});
