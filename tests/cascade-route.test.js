'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planCascadeRoute } = require('../scripts/switchyard-router');

test('a new task starts below the top tier and stays there when the check passes', () => {
  const simple = planCascadeRoute({ taskClass: 'simple' });
  assert.equal(simple.allow, true);
  assert.equal(simple.tier, 'local');
  assert.equal(simple.reason, 'start_low');
  assert.equal(simple.upgraded, false);
  assert.equal(simple.networkCall, false);
  assert.equal(simple.merge, false);

  const hard = planCascadeRoute({ taskClass: 'hard' });
  assert.equal(hard.tier, 'mid');
  assert.notEqual(hard.tier, 'frontier');

  const passed = planCascadeRoute({ taskClass: 'standard', tier: 'mid', checkPassed: true });
  assert.equal(passed.tier, 'mid');
  assert.equal(passed.reason, 'check_passed');
  assert.equal(passed.critique, null);
  assert.equal(passed.merge, false);
});

test('a failed check steps up one tier and can name a second family', () => {
  const once = planCascadeRoute({
    taskClass: 'simple',
    tier: 'local',
    checkPassed: false,
    primaryFamily: 'local',
    secondFamily: 'other',
  });
  assert.equal(once.tier, 'mid');
  assert.equal(once.reason, 'check_failed');
  assert.deepEqual(once.critique, { family: 'other' });

  const twice = planCascadeRoute({ taskClass: 'simple', tier: 'mid', checkPassed: false });
  assert.equal(twice.tier, 'frontier');
  assert.equal(twice.critique, null);

  const topped = planCascadeRoute({ taskClass: 'hard', tier: 'frontier', checkPassed: false });
  assert.equal(topped.tier, 'frontier');
  assert.equal(topped.upgraded, false);
  assert.equal(topped.reason, 'already_frontier');
});

test('a secret stays local and an unmeasured savings percent is not a result', () => {
  const secret = 'sk-localtestsecret';
  const blocked = planCascadeRoute({
    taskClass: 'simple',
    tier: 'local',
    checkPassed: false,
    secondFamily: 'other',
    apiKey: secret,
    claimedSavingsPct: 50,
  });
  assert.equal(blocked.tier, 'local');
  assert.equal(blocked.reason, 'secret_stays_local');
  assert.equal(blocked.critique, null);
  assert.equal(blocked.savingsPct, null);
  assert.equal(blocked.savingsClaim, 'refused');
  assert.equal(JSON.stringify(blocked).includes(secret), false);

  const claimed = planCascadeRoute({ taskClass: 'standard', claimedSavingsPct: 77 });
  assert.equal(claimed.tier, 'local');
  assert.equal(claimed.savingsPct, null);
  assert.equal(claimed.savingsClaim, 'refused');

  const measured = planCascadeRoute({
    taskClass: 'standard',
    measuredInputTokensBefore: 200,
    measuredInputTokensAfter: 150,
    claimedSavingsPct: 77,
  });
  assert.equal(measured.savingsPct, 25);
  assert.equal(measured.savingsClaim, 'does_not_match_counts');

  const unknown = planCascadeRoute({ taskClass: 'fusion', merge: true });
  assert.equal(unknown.allow, false);
  assert.equal(unknown.tier, 'local');
  assert.equal(unknown.reason, 'unknown_task');
  assert.equal(unknown.merge, false);
});
