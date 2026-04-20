'use strict';

/**
 * tests/bayes-optimal-gate.test.js — unit tests for the Bayes-optimal
 * decision layer used by the pre-tool-use hook.
 *
 * The module is a pure-function library — no IO other than loading
 * config/enforcement.json — so every test works on hand-built fixtures.
 *
 * Covered surfaces:
 *   - DEFAULT_LOSS_MATRIX / loadLossMatrix     (config fallback)
 *   - resolveCost                              (tag-dominance + defaults)
 *   - clip, normalizeTag, buildRiskRateMap     (primitive helpers)
 *   - computeBayesPosterior                    (prior seed, Bayes-factor update, clipping)
 *   - bayesOptimalDecision                     (cost-weighted argmax)
 *   - computeBayesErrorRate                    (irreducible error floor)
 *   - tagSignature, isHarmful                  (bucketing helpers)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const bayes = require('../scripts/bayes-optimal-gate');

/* ---------- DEFAULT_LOSS_MATRIX / loadLossMatrix ---------- */

test('DEFAULT_LOSS_MATRIX encodes the expected asymmetry between false-allow and false-block', () => {
  const m = bayes.DEFAULT_LOSS_MATRIX;
  assert.equal(m.falseAllow.default, 1.0);
  assert.equal(m.falseBlock.default, 1.0);
  // Production/secret-handling tags must cost many orders of magnitude more
  // than a baseline false-block: that asymmetry is the whole point.
  assert.ok(m.falseAllow['secrets'] >= 100, 'secrets false-allow should dwarf default false-block');
  assert.ok(m.falseAllow['deploy-prod'] >= 10, 'deploy-prod false-allow should dwarf default false-block');
  assert.ok(m.falseAllow['destructive'] >= 10, 'destructive false-allow should dwarf default false-block');
});

test('loadLossMatrix falls back to defaults when the config file is missing', () => {
  const missing = path.join(os.tmpdir(), `thumbgate-no-config-${Date.now()}.json`);
  const m = bayes.loadLossMatrix(missing);
  assert.deepEqual(m, bayes.DEFAULT_LOSS_MATRIX);
});

test('loadLossMatrix falls back to defaults when the config file is malformed JSON', () => {
  const tmp = path.join(os.tmpdir(), `thumbgate-bad-config-${Date.now()}.json`);
  fs.writeFileSync(tmp, '{ this is not json');
  try {
    const m = bayes.loadLossMatrix(tmp);
    assert.deepEqual(m, bayes.DEFAULT_LOSS_MATRIX);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('loadLossMatrix merges overrides from config/enforcement.json', () => {
  const tmp = path.join(os.tmpdir(), `thumbgate-override-${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify({
    lossMatrix: {
      falseAllow: { 'my-custom-tag': 77 },
      falseBlock: { 'annoying-tag': 5 },
    },
  }));
  try {
    const m = bayes.loadLossMatrix(tmp);
    assert.equal(m.falseAllow['my-custom-tag'], 77, 'override must be merged');
    // Defaults must survive through the merge.
    assert.equal(m.falseAllow.default, 1.0);
    assert.equal(m.falseAllow['secrets'], bayes.DEFAULT_LOSS_MATRIX.falseAllow['secrets']);
    assert.equal(m.falseBlock['annoying-tag'], 5);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('loadLossMatrix returns defaults when config is missing the lossMatrix key', () => {
  const tmp = path.join(os.tmpdir(), `thumbgate-no-lossmatrix-${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ somethingElse: true }));
  try {
    assert.deepEqual(bayes.loadLossMatrix(tmp), bayes.DEFAULT_LOSS_MATRIX);
  } finally {
    fs.unlinkSync(tmp);
  }
});

/* ---------- resolveCost ---------- */

test('resolveCost returns the default when no tags match overrides', () => {
  const cost = bayes.resolveCost(bayes.DEFAULT_LOSS_MATRIX.falseAllow, ['innocuous-tag', 'lint']);
  assert.equal(cost, bayes.DEFAULT_LOSS_MATRIX.falseAllow.default);
});

test('resolveCost returns the MAX cost across multiple matching tags (a single high-cost tag dominates)', () => {
  // Mixing `lint` (default) with `deploy-prod` (expensive) must return the
  // deploy-prod cost. Otherwise a single innocuous tag could dilute a real
  // risk signal.
  const cost = bayes.resolveCost(bayes.DEFAULT_LOSS_MATRIX.falseAllow, ['lint', 'deploy-prod']);
  assert.equal(cost, bayes.DEFAULT_LOSS_MATRIX.falseAllow['deploy-prod']);
});

test('resolveCost handles the empty tag list', () => {
  assert.equal(bayes.resolveCost(bayes.DEFAULT_LOSS_MATRIX.falseAllow, []), 1.0);
  assert.equal(bayes.resolveCost(bayes.DEFAULT_LOSS_MATRIX.falseAllow, null), 1.0);
});

test('resolveCost normalizes tag case before lookup', () => {
  const cost = bayes.resolveCost(bayes.DEFAULT_LOSS_MATRIX.falseAllow, ['DEPLOY-PROD']);
  assert.equal(cost, bayes.DEFAULT_LOSS_MATRIX.falseAllow['deploy-prod']);
});

test('resolveCost treats missing matrix side defensively', () => {
  assert.equal(bayes.resolveCost(undefined, ['foo']), 1.0);
  assert.equal(bayes.resolveCost({}, ['foo']), 1.0);
});

/* ---------- clip + normalizeTag ---------- */

test('clip keeps values inside [min, max] and handles non-finite input', () => {
  assert.equal(bayes.clip(0.5, 0, 1), 0.5);
  assert.equal(bayes.clip(-2, 0, 1), 0);
  assert.equal(bayes.clip(5, 0, 1), 1);
  assert.equal(bayes.clip(NaN, 0, 1), 0);
  assert.equal(bayes.clip(Infinity, 0, 1), 1);
});

test('normalizeTag lowercases and trims', () => {
  assert.equal(bayes.normalizeTag('  Deploy-Prod  '), 'deploy-prod');
  assert.equal(bayes.normalizeTag(''), '');
  assert.equal(bayes.normalizeTag(null), '');
  assert.equal(bayes.normalizeTag(undefined), '');
});

/* ---------- buildRiskRateMap ---------- */

test('buildRiskRateMap keeps valid riskRate buckets and drops invalid ones', () => {
  const map = bayes.buildRiskRateMap([
    { key: 'deploy-prod', riskRate: 0.9 },
    { tag: 'lint', rate: 0.05 },
    { key: '', riskRate: 0.8 },       // no key → drop
    { key: 'bad', riskRate: -0.1 },    // negative → drop
    { key: 'bad2', riskRate: 1.5 },    // > 1 → drop
    { key: 'unclean', riskRate: NaN }, // NaN → drop
  ]);
  assert.equal(map.size, 2);
  assert.equal(map.get('deploy-prod'), 0.9);
  assert.equal(map.get('lint'), 0.05);
});

test('buildRiskRateMap returns an empty Map for non-array input', () => {
  assert.equal(bayes.buildRiskRateMap(null).size, 0);
  assert.equal(bayes.buildRiskRateMap(undefined).size, 0);
  assert.equal(bayes.buildRiskRateMap('not-an-array').size, 0);
});

/* ---------- computeBayesPosterior ---------- */

test('computeBayesPosterior returns the prior when no tag evidence applies', () => {
  const post = bayes.computeBayesPosterior({
    tags: ['unknown-tag'],
    riskByTag: new Map([['other-tag', 0.9]]),
    baseRate: 0.2,
  });
  assert.equal(post.prior, 0.2);
  assert.equal(post.pHarmful, 0.2);
  assert.equal(post.pSafe, 0.8);
  assert.deepEqual(post.evidence, []);
});

test('computeBayesPosterior shifts probability toward harm when tags match risky tags', () => {
  const post = bayes.computeBayesPosterior({
    tags: ['deploy-prod'],
    riskByTag: new Map([['deploy-prod', 0.8]]),
    baseRate: 0.2,
  });
  // Risky tag with rate 4× the prior must pull the posterior above the prior.
  assert.ok(post.pHarmful > 0.2);
  assert.equal(post.evidence.length, 1);
  assert.equal(post.evidence[0].tag, 'deploy-prod');
  assert.equal(post.evidence[0].bayesFactor, 4); // clipped at the ceiling
});

test('computeBayesPosterior shifts probability toward safe when tags match historically-safe tags', () => {
  const post = bayes.computeBayesPosterior({
    tags: ['lint'],
    riskByTag: new Map([['lint', 0.02]]),
    baseRate: 0.5,
  });
  // Rate 0.02 / prior 0.5 = 0.04, clipped up to 0.25. Still pulls the
  // posterior down.
  assert.ok(post.pHarmful < 0.5, `expected pHarmful < 0.5, got ${post.pHarmful}`);
});

test('computeBayesPosterior seeds from modelProbability when provided', () => {
  const post = bayes.computeBayesPosterior({
    tags: [],
    riskByTag: new Map(),
    baseRate: 0.1,
    modelProbability: 0.7,
  });
  assert.equal(post.seed, 0.7, 'seed must equal provided modelProbability');
  assert.equal(post.pHarmful, 0.7, 'no evidence means the seed is the posterior');
});

test('computeBayesPosterior clips Bayes factor to prevent single-sample tag from dominating', () => {
  // If a tag has rate 1.0 and prior 0.01, the raw factor is 100 — one tag
  // would pin the posterior at 1.0. We clip the factor at 4.0 so a single
  // observation can't veto by itself; an attacker-worthy conclusion
  // requires multiple independent signals.
  const post = bayes.computeBayesPosterior({
    tags: ['wild-tag'],
    riskByTag: new Map([['wild-tag', 1.0]]),
    baseRate: 0.01,
  });
  assert.equal(post.evidence[0].bayesFactor, 4, 'bayesFactor must clip at 4.0');
  // With starting odds ≈ 0.01 and factor 4 → posterior ≈ 0.039, not 1.
  assert.ok(post.pHarmful < 0.1);
});

test('computeBayesPosterior handles both Map and plain-object riskByTag', () => {
  const fromMap = bayes.computeBayesPosterior({
    tags: ['x'],
    riskByTag: new Map([['x', 0.9]]),
    baseRate: 0.3,
  });
  const fromObj = bayes.computeBayesPosterior({
    tags: ['x'],
    riskByTag: { x: 0.9 },
    baseRate: 0.3,
  });
  assert.equal(fromMap.pHarmful, fromObj.pHarmful);
});

/* ---------- bayesOptimalDecision ---------- */

test('bayesOptimalDecision allows when both costs are symmetric and posterior favors safe', () => {
  const d = bayes.bayesOptimalDecision({ pHarmful: 0.3, pSafe: 0.7 }, ['lint']);
  assert.equal(d.decision, 'allow');
  assert.ok(d.expectedLoss.block > d.expectedLoss.allow);
});

test('bayesOptimalDecision blocks when both costs are symmetric and posterior favors harm', () => {
  const d = bayes.bayesOptimalDecision({ pHarmful: 0.7, pSafe: 0.3 }, ['lint']);
  assert.equal(d.decision, 'block');
});

test('bayesOptimalDecision BLOCKS a low-posterior action when the cost of allowing it is extreme (deploy-prod)', () => {
  // pHarmful = 0.05 — in a threshold-on-heuristic rule this would sail
  // through. In a Bayes-optimal rule with cost(falseAllow | deploy-prod) =
  // 100, it correctly blocks: E[loss|allow] = 0.05 * 100 = 5.0 >
  // E[loss|block] = 0.95 * 1.0 = 0.95.
  const d = bayes.bayesOptimalDecision({ pHarmful: 0.05, pSafe: 0.95 }, ['deploy-prod']);
  assert.equal(d.decision, 'block', 'high-cost tag must dominate a low posterior');
  assert.ok(d.expectedLoss.allow > d.expectedLoss.block);
});

test('bayesOptimalDecision ALLOWS a moderate-posterior action when the matching tag has no cost override', () => {
  const d = bayes.bayesOptimalDecision({ pHarmful: 0.4, pSafe: 0.6 }, ['unknown']);
  assert.equal(d.decision, 'allow');
});

test('bayesOptimalDecision reports expected loss and the applied costs', () => {
  const d = bayes.bayesOptimalDecision(
    { pHarmful: 0.1, pSafe: 0.9 },
    ['secrets'],
  );
  assert.equal(d.costs.falseAllow, bayes.DEFAULT_LOSS_MATRIX.falseAllow.secrets);
  assert.equal(d.costs.falseBlock, 1);
  assert.equal(d.expectedLoss.allow, 0.1 * bayes.DEFAULT_LOSS_MATRIX.falseAllow.secrets);
  assert.equal(d.expectedLoss.block, 0.9);
});

test('bayesOptimalDecision accepts a custom loss matrix and honors its overrides', () => {
  const custom = { falseAllow: { default: 1, flash: 50 }, falseBlock: { default: 1 } };
  const d = bayes.bayesOptimalDecision({ pHarmful: 0.1, pSafe: 0.9 }, ['flash'], custom);
  assert.equal(d.decision, 'block');
});

/* ---------- computeBayesErrorRate ---------- */

test('computeBayesErrorRate returns null for empty or invalid input', () => {
  assert.equal(bayes.computeBayesErrorRate([]), null);
  assert.equal(bayes.computeBayesErrorRate(null), null);
  assert.equal(bayes.computeBayesErrorRate('not-an-array'), null);
});

test('computeBayesErrorRate is 0 when every tag signature is perfectly separable', () => {
  const rows = [
    { tags: ['a'], signal: 'negative' },
    { tags: ['a'], signal: 'negative' },
    { tags: ['b'], signal: 'positive' },
    { tags: ['b'], signal: 'positive' },
  ];
  assert.equal(bayes.computeBayesErrorRate(rows), 0);
});

test('computeBayesErrorRate equals 0.5 when a single signature is 50/50', () => {
  const rows = [
    { tags: ['a'], signal: 'negative' },
    { tags: ['a'], signal: 'positive' },
  ];
  assert.equal(bayes.computeBayesErrorRate(rows), 0.5);
});

test('computeBayesErrorRate weights bucket error by bucket frequency', () => {
  // 80 perfectly-separable rows on tag "a" + 20 50/50 rows on tag "b" →
  // overall floor is 0.2 * 0.5 = 0.10.
  const rows = [
    ...Array.from({ length: 40 }, () => ({ tags: ['a'], signal: 'negative' })),
    ...Array.from({ length: 40 }, () => ({ tags: ['a'], signal: 'negative' })),
    ...Array.from({ length: 10 }, () => ({ tags: ['b'], signal: 'negative' })),
    ...Array.from({ length: 10 }, () => ({ tags: ['b'], signal: 'positive' })),
  ];
  assert.equal(bayes.computeBayesErrorRate(rows), 0.1);
});

/* ---------- tagSignature + isHarmful ---------- */

test('tagSignature is order-independent and canonicalizes case', () => {
  const a = bayes.tagSignature({ tags: ['Lint', 'deploy-prod'] });
  const b = bayes.tagSignature({ tags: ['DEPLOY-PROD', 'lint'] });
  assert.equal(a, b);
  assert.equal(a, 'deploy-prod|lint');
});

test('tagSignature falls back to __none__ for rows with no tags', () => {
  assert.equal(bayes.tagSignature({}), '__none__');
  assert.equal(bayes.tagSignature({ tags: [] }), '__none__');
  assert.equal(bayes.tagSignature(null), '__none__');
});

test('tagSignature prefers targetTags over tags when both are present', () => {
  const sig = bayes.tagSignature({ targetTags: ['a', 'b'], tags: ['ignored'] });
  assert.equal(sig, 'a|b');
});

test('isHarmful mirrors risk-scorer.deriveTargetRisk', () => {
  assert.equal(bayes.isHarmful({ targetRisk: 1 }), true);
  assert.equal(bayes.isHarmful({ targetRisk: 0 }), false);
  assert.equal(bayes.isHarmful({ accepted: false }), true);
  assert.equal(bayes.isHarmful({ accepted: true }), false);
  assert.equal(bayes.isHarmful({ label: 'negative' }), true);
  assert.equal(bayes.isHarmful({ signal: 'negative' }), true);
  assert.equal(bayes.isHarmful({ signal: 'positive' }), false);
  assert.equal(bayes.isHarmful({}), false);
  assert.equal(bayes.isHarmful(null), false);
});

/* ---------- integration: posterior + decision together ---------- */

test('end-to-end: a single deploy-prod tag flips the decision even with thin evidence', () => {
  const rateMap = new Map([['deploy-prod', 0.85]]);
  const post = bayes.computeBayesPosterior({
    tags: ['deploy-prod'],
    riskByTag: rateMap,
    baseRate: 0.1,
  });
  const decision = bayes.bayesOptimalDecision(post, ['deploy-prod']);
  assert.equal(decision.decision, 'block');
});

test('end-to-end: a low-cost tag with high posterior still blocks under default equal costs', () => {
  const rateMap = new Map([['flaky-tag', 0.9]]);
  const post = bayes.computeBayesPosterior({
    tags: ['flaky-tag'],
    riskByTag: rateMap,
    baseRate: 0.5,
  });
  const decision = bayes.bayesOptimalDecision(post, ['flaky-tag']);
  assert.equal(decision.decision, 'block');
  assert.ok(post.pHarmful > 0.5);
});

test('end-to-end: a near-zero posterior with no cost override does not block', () => {
  const rateMap = new Map([['chatter', 0.02]]);
  const post = bayes.computeBayesPosterior({
    tags: ['chatter'],
    riskByTag: rateMap,
    baseRate: 0.1,
  });
  const decision = bayes.bayesOptimalDecision(post, ['chatter']);
  assert.equal(decision.decision, 'allow');
});
