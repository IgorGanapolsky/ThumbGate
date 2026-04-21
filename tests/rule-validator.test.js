'use strict';

/**
 * tests/rule-validator.test.js — unit tests for the pre-promotion rule
 * validator added to plug the "validate before integrate" phase missing
 * from the auto-promote pipeline (cf. Autogenesis self-evolving agent
 * protocol, arxiv 2604.15034).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  tokenize,
  ruleMatches,
  scoreOnSample,
  validateProposedRule,
  DEFAULT_PRECISION_FLOOR,
} = require('../scripts/rule-validator');

function makeRule(condition, tags = []) {
  return {
    id: `rule_${Math.random().toString(36).slice(2, 8)}`,
    rule: {
      format: 'if-then-v1',
      trigger: { condition, type: 'recurring-mistake' },
      action: { type: 'avoid', description: `NEVER: ${condition}` },
      confidence: 0.8,
    },
    tags,
  };
}

function makeEvent(text, { signal = 'negative', tags = [] } = {}) {
  return { content: text, signal, tags };
}

/* ---------- tokenize ---------- */

test('tokenize drops stop words and short tokens, normalizes case', () => {
  const tokens = tokenize('Never force-push to the MAIN branch!!');
  assert.deepEqual(tokens.sort(), ['branch', 'force', 'main', 'never', 'push'].sort());
});

test('tokenize handles null / undefined / empty input', () => {
  assert.deepEqual(tokenize(null), []);
  assert.deepEqual(tokenize(undefined), []);
  assert.deepEqual(tokenize(''), []);
});

/* ---------- ruleMatches ---------- */

test('ruleMatches fires when every trigger token appears in the event', () => {
  const rule = makeRule('never force push main', ['git']);
  const event = makeEvent('The assistant force-pushed to main and broke the deploy never again');
  assert.equal(ruleMatches(rule, event), true);
});

test('ruleMatches does not fire when a trigger token is missing', () => {
  const rule = makeRule('never force push main', ['git']);
  const event = makeEvent('assistant pushed to develop branch safely');
  assert.equal(ruleMatches(rule, event), false);
});

test('ruleMatches rejects empty-trigger rules rather than matching everything', () => {
  const rule = makeRule('', ['git']);
  const event = makeEvent('anything at all');
  assert.equal(ruleMatches(rule, event), false);
});

/* ---------- scoreOnSample ---------- */

test('scoreOnSample computes precision/recall over in-scope events only', () => {
  const rule = makeRule('never force push main', ['git']);
  const events = [
    makeEvent('force-push to main caused incident',        { signal: 'negative', tags: ['git'] }),   // TP
    makeEvent('force push main worked fine for hotfix',    { signal: 'positive', tags: ['git'] }),   // FP
    makeEvent('main branch deploy healthy, no force push', { signal: 'negative', tags: ['git'] }),   // FN (no match)
    makeEvent('main deploy was clean and boring',          { signal: 'positive', tags: ['git'] }),   // TN
    // Out-of-scope — tags don't overlap, should be skipped entirely.
    makeEvent('force push main something',                 { signal: 'negative', tags: ['unrelated'] }),
  ];
  const score = scoreOnSample(rule, events);
  assert.equal(score.tp, 1);
  assert.equal(score.fp, 1);
  assert.equal(score.fn, 1);
  assert.equal(score.tn, 1);
  assert.equal(score.precision, 0.5);
  assert.equal(score.recall, 0.5);
});

test('scoreOnSample returns null precision when the rule never fires in scope', () => {
  const rule = makeRule('never force push main', ['git']);
  const events = [makeEvent('something unrelated', { signal: 'negative', tags: ['git'] })];
  const score = scoreOnSample(rule, events);
  assert.equal(score.precision, null);
});

/* ---------- validateProposedRule ---------- */

test('validateProposedRule rejects a rule that does not fire on its own seed lesson', () => {
  // Trigger token "nonexistenttoken" is nowhere in the seed — the rule is
  // tautologically broken and must be rejected with a diagnostic reason.
  const rule = makeRule('nonexistenttoken condition', ['git']);
  const seed = {
    signal: 'negative',
    title: 'MISTAKE: force-push main',
    content: 'Never force-push to main branch',
    tags: ['git'],
  };
  const report = validateProposedRule(rule, { seedLesson: seed, recentEvents: [] });
  assert.equal(report.shouldPromote, false);
  assert.equal(report.matchesSeed, false);
  assert.equal(report.reason, 'rule_does_not_match_seed_lesson');
});

test('validateProposedRule promotes a rule with insufficient sample but notes the reason', () => {
  const rule = makeRule('never force push main', ['git']);
  const seed = { signal: 'negative', content: 'never force push main', tags: ['git'] };
  const report = validateProposedRule(rule, { seedLesson: seed, recentEvents: [] });
  assert.equal(report.shouldPromote, true);
  assert.equal(report.matchesSeed, true);
  assert.equal(report.reason, 'insufficient_sample');
});

test('validateProposedRule promotes when precision meets floor', () => {
  const rule = makeRule('never force push main', ['git']);
  const seed = { signal: 'negative', content: 'never force push main', tags: ['git'] };
  // Four true positives, zero false positives → precision 1.0.
  const events = [
    makeEvent('force-push main incident one',    { signal: 'negative', tags: ['git'] }),
    makeEvent('force-push main incident two',    { signal: 'negative', tags: ['git'] }),
    makeEvent('force-push main broke ci again',  { signal: 'negative', tags: ['git'] }),
    makeEvent('main deploy healthy, boring run', { signal: 'positive', tags: ['git'] }), // TN
  ];
  const report = validateProposedRule(rule, { seedLesson: seed, recentEvents: events });
  assert.equal(report.shouldPromote, true);
  assert.equal(report.reason, 'validated');
  assert.equal(report.precision, 1);
  assert.ok(report.sampleSize >= 3);
});

test('validateProposedRule rejects when precision drops below floor', () => {
  const rule = makeRule('force push main', ['git']);
  const seed = { signal: 'negative', content: 'force push main', tags: ['git'] };
  // 1 TP + 3 FPs → precision 0.25, well under the 0.8 default floor.
  const events = [
    makeEvent('force push main incident',          { signal: 'negative', tags: ['git'] }),
    makeEvent('force push main hotfix worked fine',{ signal: 'positive', tags: ['git'] }),
    makeEvent('force push main release ok',        { signal: 'positive', tags: ['git'] }),
    makeEvent('force push main recovery success',  { signal: 'positive', tags: ['git'] }),
  ];
  const report = validateProposedRule(rule, { seedLesson: seed, recentEvents: events });
  assert.equal(report.shouldPromote, false);
  assert.equal(report.reason, 'precision_below_floor');
  assert.ok(report.precision < DEFAULT_PRECISION_FLOOR);
});

test('validateProposedRule honors caller-supplied precisionFloor override', () => {
  const rule = makeRule('force push main', ['git']);
  const seed = { signal: 'negative', content: 'force push main', tags: ['git'] };
  const events = [
    makeEvent('force push main incident',           { signal: 'negative', tags: ['git'] }),
    makeEvent('force push main broke prod again',   { signal: 'negative', tags: ['git'] }),
    makeEvent('force push main hotfix worked fine', { signal: 'positive', tags: ['git'] }),
  ];
  // precision = 2/3 ≈ 0.667. Floor 0.5 → promote. Default 0.8 → reject.
  const permissive = validateProposedRule(rule, {
    seedLesson: seed, recentEvents: events, precisionFloor: 0.5,
  });
  assert.equal(permissive.shouldPromote, true);

  const strict = validateProposedRule(rule, {
    seedLesson: seed, recentEvents: events, precisionFloor: 0.8,
  });
  assert.equal(strict.shouldPromote, false);
});

test('validateProposedRule promotes when no in-scope firings occur', () => {
  const rule = makeRule('never force push main', ['git']);
  const seed = { signal: 'negative', content: 'never force push main', tags: ['git'] };
  // Plenty of in-scope positive events, none trigger the rule → precision
  // undefined, but seed matches, so we still promote with a diagnostic.
  const events = [
    makeEvent('merged pr via squash cleanly',    { signal: 'positive', tags: ['git'] }),
    makeEvent('branch protection held firmly',   { signal: 'positive', tags: ['git'] }),
    makeEvent('review completed with no issues', { signal: 'positive', tags: ['git'] }),
  ];
  const report = validateProposedRule(rule, { seedLesson: seed, recentEvents: events });
  assert.equal(report.shouldPromote, true);
  assert.equal(report.reason, 'no_firings_in_sample');
  assert.equal(report.precision, null);
});

test('validateProposedRule rejects invalid rule shape without crashing', () => {
  const report = validateProposedRule({}, { seedLesson: {}, recentEvents: [] });
  assert.equal(report.shouldPromote, false);
  assert.equal(report.reason, 'invalid_rule_shape');
});

test('validateProposedRule respects positive signals from "up" alias', () => {
  const rule = makeRule('force push main', ['git']);
  const seed = { signal: 'negative', content: 'force push main', tags: ['git'] };
  // Callers that haven't migrated to "positive" still send "up". The
  // normalizer must treat them equivalently, otherwise the false-positive
  // count is under-reported.
  const events = [
    makeEvent('force push main incident',      { signal: 'negative', tags: ['git'] }),
    makeEvent('force push main was fine today',{ signal: 'up',       tags: ['git'] }),
    makeEvent('force push main worked fine',   { signal: 'up',       tags: ['git'] }),
    makeEvent('force push main all good',      { signal: 'up',       tags: ['git'] }),
  ];
  const report = validateProposedRule(rule, { seedLesson: seed, recentEvents: events });
  assert.equal(report.fp, 3, '"up" must be normalized to positive');
  assert.equal(report.shouldPromote, false);
});
