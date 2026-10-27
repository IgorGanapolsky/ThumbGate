const test = require('node:test');
const assert = require('node:assert');
const { formatTeamPolicySyncSummary } = require('../src/api/server');

test('formatTeamPolicySyncSummary returns concise summary', () => {
  const result = formatTeamPolicySyncSummary('org-123');
  assert.strictEqual(
    result,
    'Synced 3 Curated Threat Packs (AWS Production Safeguards, SOC2 Secret Leak Prevention, Destructive Git & DB Blocks) and 59 total rules for org org-123.'
  );
});
