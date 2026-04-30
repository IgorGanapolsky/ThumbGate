'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const battlePlan = fs.readFileSync(
  path.join(__dirname, '..', 'FIRST_CUSTOMER_BATTLE_PLAN.md'),
  'utf8'
);

test('current revenue battle plan stays aligned with evidence-backed sales motion', () => {
  assert.match(battlePlan, /# Current Revenue Battle Plan/i);
  assert.match(battlePlan, /Workflow Hardening Sprint/i);
  assert.match(battlePlan, /Pro at `\$19\/mo or \$149\/yr`/);
  assert.match(battlePlan, /docs\/COMMERCIAL_TRUTH\.md/);
  assert.match(battlePlan, /docs\/VERIFICATION_EVIDENCE\.md/);
  assert.match(battlePlan, /Verify thread freshness before replying/i);
  assert.match(battlePlan, /Proof links belong after the buyer confirms the workflow pain/i);
  assert.match(battlePlan, /## Avoid/);
  assert.doesNotMatch(battlePlan, /^# First Customer Battle Plan\b/m);
  assert.doesNotMatch(battlePlan, /7-day free trial/i);
  assert.doesNotMatch(battlePlan, /hasn't repeated a single mistake/i);
});
