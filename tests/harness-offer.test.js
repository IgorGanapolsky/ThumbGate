'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assessHarnessOffer } = require('../scripts/commercial-offer');

const PITCH = [
  'ThumbGate stops an AI coding agent before a known-bad tool call goes out.',
  'Install free with: npx thumbgate init',
  'Pro is $19/month or $149/year: https://thumbgate.ai/checkout/pro',
  'Setup Sprint is $499 once for one workflow: https://thumbgate.ai/pricing',
].join('\n');

test('the public pitch sells the gate at the three prices', () => {
  const verdict = assessHarnessOffer(PITCH);
  assert.equal(verdict.allow, true);
  assert.equal(verdict.reason, 'harness_offer');
  assert.deepEqual(verdict.prices, [19, 149, 499]);
});

test('a model, a margin, a customer line, another price, or a real-estate list is refused', () => {
  const cases = [
    [`${PITCH}\nBuy our model.`, 'model_is_not_the_product'],
    [`${PITCH}\n94.2% margin.`, 'unmeasured_return'],
    [`${PITCH}\n15x cheaper after Jevons.`, 'unmeasured_return'],
    [`${PITCH}\nOur customers and logos.`, 'unmeasured_claim'],
    [`${PITCH}\nSkool tax-deed list and BountiClaw.`, 'wrong_list'],
    [`${PITCH}\nReal estate parcels.`, 'wrong_list'],
    [`${PITCH}\nPlaybook $9.99.`, 'forbidden_price'],
    [`${PITCH}\nBundle $49.`, 'forbidden_price'],
    [`${PITCH}\nTeam $79/mo.`, 'forbidden_price'],
    [`${PITCH}\nSprint $1,500.`, 'forbidden_price'],
    [`${PITCH}\nPilot $3,000.`, 'forbidden_price'],
  ];
  for (const [text, reason] of cases) {
    const verdict = assessHarnessOffer(text);
    assert.equal(verdict.allow, false, reason);
    assert.equal(verdict.reason, reason);
  }
  const bundle = assessHarnessOffer(`${PITCH}\nBundle $49.`);
  assert.ok(bundle.prices.includes(499));
  assert.ok(bundle.prices.includes(49));
});

test('a blank line or a price without the gate is not the offer', () => {
  assert.deepEqual(assessHarnessOffer(''), { allow: false, reason: 'not_text' });
  assert.deepEqual(assessHarnessOffer(null), { allow: false, reason: 'not_text' });
  const partial = assessHarnessOffer('ThumbGate stops a known-bad tool call. Pro is $19/month or $149/year. Setup Sprint is $499 once.');
  assert.equal(partial.allow, false);
  assert.equal(partial.reason, 'not_the_harness');
});
