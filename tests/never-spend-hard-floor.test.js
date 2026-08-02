'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  evaluateGates,
  loadGatesConfig,
  applyEnforcementPosture,
} = require('../scripts/gates-engine');

const spendGuard = require('../scripts/thumbgate-spend-guard');

test('spend-guard denies Apollo upgrade and Stripe checkout, allows free search', () => {
  assert.equal(
    spendGuard.evaluateSpend('Bash', { command: 'apollo people search --q founder' }).decision,
    'allow',
  );
  assert.equal(
    spendGuard.evaluateSpend('Bash', {
      command: 'open https://app.apollo.io/#/settings/plans/upgrade',
    }).decision,
    'deny',
  );
  assert.equal(
    spendGuard.evaluateSpend('WebFetch', {
      url: 'https://app.apollo.io/settings/plans/upgrade',
    }).decision,
    'deny',
  );
  assert.equal(
    spendGuard.evaluateSpend('Bash', {
      command: 'curl -X POST https://checkout.stripe.com/c/pay/cs_test',
    }).decision,
    'deny',
  );
});

test('never-spend force-promote block is not warn-by-default soft-denied', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-never-spend-'));
  const autoPath = path.join(tmp, 'auto-promoted-gates.json');
  fs.writeFileSync(
    autoPath,
    JSON.stringify({
      version: 1,
      gates: [
        {
          id: 'hard-never-spend-any',
          pattern: 'app\\.apollo\\.io|checkout\\.stripe\\.com|apollo\\s*pro|buy\\s+credits?',
          action: 'block',
          message: 'HARD BAN spend',
          severity: 'critical',
          source: 'force-promote',
          permanent: true,
          hardFloor: true,
        },
      ],
    }),
  );

  // Point feedback dir so getAutoGatesPath resolves under tmp.
  // auto-promote-gates uses getFeedbackLogPath parent; inject via env if supported.
  const prevFeedback = process.env.THUMBGATE_FEEDBACK_DIR;
  const prevStrict = process.env.THUMBGATE_STRICT_ENFORCEMENT;
  process.env.THUMBGATE_FEEDBACK_DIR = tmp;
  delete process.env.THUMBGATE_STRICT_ENFORCEMENT;

  try {
    // Write auto gates where getAutoGatesPath expects them
    const realAuto = require('../scripts/auto-promote-gates');
    const target = realAuto.getAutoGatesPath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(autoPath, target);

    const denied = evaluateGates('Bash', {
      command: 'open https://app.apollo.io/#/settings/plans/upgrade',
    });
    assert.ok(denied, 'expected a gate result');
    assert.equal(denied.decision, 'deny');
    assert.equal(denied.gate, 'hard-never-spend-any');
    assert.equal(!!denied.warnByDefault, false);

    // Posture must not soft-warn never-spend even without STRICT.
    const postured = applyEnforcementPosture({
      decision: 'deny',
      gate: 'hard-never-spend-any',
      message: 'HARD BAN spend',
      severity: 'critical',
    });
    assert.equal(postured.decision, 'deny');
    assert.equal(!!postured.warnByDefault, false);
  } finally {
    if (prevFeedback === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = prevFeedback;
    if (prevStrict === undefined) delete process.env.THUMBGATE_STRICT_ENFORCEMENT;
    else process.env.THUMBGATE_STRICT_ENFORCEMENT = prevStrict;
  }
});
