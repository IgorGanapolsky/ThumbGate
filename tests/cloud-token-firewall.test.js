const { test } = require('node:test');
const assert = require('assert');
const { exportTeamPolicyAsPreventionRulesMarkdown } = require('../src/cloud-token-firewall.js');

test('exportTeamPolicyAsPreventionRulesMarkdown formats policy correctly', () => {
  const result = exportTeamPolicyAsPreventionRulesMarkdown({ orgId: 'org_123' });

  assert.ok(result.includes('# Prevention Rules'));
  assert.ok(result.includes('## Curated Threat Packs'));
  assert.ok(result.includes('- core-identity-protection'));
  assert.ok(result.includes('- cloud-infrastructure-rules'));

  assert.ok(result.includes('## Custom Rules'));
  assert.ok(result.includes('- no-plaintext-secrets'));
  assert.ok(result.includes('- enforce-tls-1.2'));
});
