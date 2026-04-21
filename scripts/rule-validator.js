'use strict';

/**
 * scripts/rule-validator.js
 *
 * Pre-promotion validation harness for synthesized prevention rules.
 *
 * Why this exists:
 *   Before this module, `synthesizePreventionRule` (lesson-synthesis.js) auto-
 *   promoted any lesson that hit the occurrence threshold straight into
 *   `synthesized-rules.jsonl` — no check that the proposed rule actually
 *   matches the mistake pattern it was synthesized from, and no check that
 *   it doesn't also fire on recent positive-signal events from overlapping
 *   tags. That's the exact failure mode Autogenesis
 *   (https://arxiv.org/abs/2604.15034) calls out: candidate improvements
 *   must be validated through testing before integration, otherwise static
 *   agents accumulate self-contradicting rules that degrade precision.
 *
 *   We already had 3 of the 4 Autogenesis phases:
 *     - capability-gap identification (negative feedback events),
 *     - candidate generation (synthesizePreventionRule),
 *     - integration (append to synthesized-rules.jsonl).
 *   The missing phase was validation. This module fills it.
 *
 * Validation contract:
 *   A proposed rule is promotable iff:
 *     1. It matches the seed lesson that triggered promotion (otherwise the
 *        rule is tautologically broken — it wouldn't catch the mistake it
 *        was built for).
 *     2. Its precision on a recent-events sample clears a threshold
 *        (default 0.8) — of the events the rule fires on, most must carry
 *        the negative signal. A rule that blocks positive outcomes too is
 *        a regression, not a prevention.
 *
 *   Recall is reported for operator visibility but does not gate
 *   promotion — an overly specific rule is less harmful than an overly
 *   broad one.
 *
 * Design notes:
 *   - Pure functions, no IO. Caller supplies the event samples so tests
 *     stay hermetic and the validator can run inside captureFeedback
 *     without reaching for the filesystem.
 *   - Token matching is deliberately simple (lowercase, punctuation strip,
 *     length-2+ tokens, all-tokens-present) so the behavior is debuggable
 *     from the console. We are not competing with NLP — we are gating a
 *     one-line trigger string against a handful of sibling events.
 */

// Intentionally tiny stop list — we only drop noise that would erase the
// trigger's discriminative tokens. If a stop-word-only rule ever matches a
// positive event, that's a real false positive and we want to see it.
const STOP = new Set([
  'a', 'an', 'the', 'to', 'of', 'in', 'on', 'at', 'for', 'and', 'or',
  'is', 'are', 'was', 'were', 'be', 'do', 'does', 'did',
  'this', 'that', 'these', 'those',
  'it', 'its', 'i', 'you', 'we', 'they',
]);

// Modality / negation words that `synthesizePreventionRule` commonly
// inherits from lesson titles like "MISTAKE: never force-push". We want
// these tokens to survive ordinary tokenize() output (they're legitimate
// English), but we strip them from a rule's trigger before matching so
// the rule still fires on events that describe the mistake without
// echoing the modality. They remain meaningful in haystack positions.
const TRIGGER_MODALITY = new Set(['never', 'always', 'ever', 'must', 'not', 'no']);

/**
 * Strip a few common English suffixes so "force-pushed" in a bug report
 * matches a trigger token "push". We are NOT doing Porter-grade stemming;
 * the goal is just to keep morphological variants from silently breaking
 * the matcher. Minimum 3-char stem preserved so "goes" → "goe" (harmless)
 * but "is" / "as" stay intact.
 */
function stem(token) {
  if (token.length <= 3) return token;
  if (token.endsWith('ing') && token.length > 5) return token.slice(0, -3);
  if (token.endsWith('ed') && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('es') && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('s') && !token.endsWith('ss') && token.length > 3) {
    return token.slice(0, -1);
  }
  return token;
}

function tokenize(text) {
  if (text === null || text === undefined) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map(stem);
}

function eventText(event) {
  if (!event || typeof event !== 'object') return '';
  return [
    event.title,
    event.content,
    event.whatToChange,
    event.whatWentWrong,
    event.whatWorked,
    event.context,
  ].filter(Boolean).join(' ');
}

function eventSignal(event) {
  if (!event || typeof event !== 'object') return null;
  const raw = event.signal;
  if (!raw) return null;
  const lower = String(raw).toLowerCase();
  if (lower === 'up' || lower === 'positive') return 'positive';
  if (lower === 'down' || lower === 'negative') return 'negative';
  return lower;
}

/**
 * Does `rule` fire on `event`? A rule fires when every content token of
 * its trigger.condition appears in the event's combined text **in the
 * same relative order** (subsequence match). An empty trigger never fires
 * — that's a degenerate rule and we want the validator to reject it
 * rather than silently match everything.
 *
 * Order matters because it's the cheapest way to distinguish
 * "force-push to main caused incident" (trigger condition narrates the
 * action) from "main branch healthy, no force push" (same tokens, wrong
 * narrative). Without order we'd flag the second event as a false
 * positive against every rule built on the same vocabulary.
 */
function ruleMatches(rule, event) {
  const trigger = rule && rule.rule && rule.rule.trigger && rule.rule.trigger.condition;
  const rawTokens = tokenize(trigger);
  const tokens = rawTokens.filter((t) => !TRIGGER_MODALITY.has(t));
  if (tokens.length === 0) return false;

  const haystack = tokenize(eventText(event));
  let hi = 0;
  for (const t of tokens) {
    while (hi < haystack.length && haystack[hi] !== t) hi += 1;
    if (hi >= haystack.length) return false;
    hi += 1;
  }
  return true;
}

/**
 * Count true-positive / false-positive / false-negative / true-negative
 * firings on a sample. Tags are used to scope the sample — only events
 * that share at least one tag with the rule are considered, on the premise
 * that a rule about git force-push shouldn't be precision-scored against
 * deploy-pipeline events it was never meant to see.
 */
function scoreOnSample(rule, events, { scopeTags = null } = {}) {
  const ruleTags = new Set((rule.tags || []).filter(Boolean).map((t) => String(t).toLowerCase()));
  const scope = scopeTags ? new Set(scopeTags.map((t) => String(t).toLowerCase())) : null;

  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;

  for (const event of Array.isArray(events) ? events : []) {
    const tags = Array.isArray(event.tags)
      ? event.tags.map((t) => String(t).toLowerCase())
      : [];

    // Out-of-scope events are ignored — they have nothing to say about
    // this rule's precision.
    if (scope && tags.length > 0 && !tags.some((t) => scope.has(t))) continue;
    if (ruleTags.size > 0 && tags.length > 0 && !tags.some((t) => ruleTags.has(t))) continue;

    const fires = ruleMatches(rule, event);
    const signal = eventSignal(event);

    if (signal === 'negative' && fires) tp += 1;
    else if (signal === 'positive' && fires) fp += 1;
    else if (signal === 'negative' && !fires) fn += 1;
    else if (signal === 'positive' && !fires) tn += 1;
  }

  const firings = tp + fp;
  const negatives = tp + fn;
  return {
    tp,
    fp,
    fn,
    tn,
    precision: firings > 0 ? tp / firings : null,
    recall: negatives > 0 ? tp / negatives : null,
  };
}

const DEFAULT_PRECISION_FLOOR = 0.8;
const DEFAULT_MIN_SAMPLE = 3;

/**
 * Top-level validator. Returns a detailed report plus a boolean
 * `shouldPromote`. The caller (feedback-loop) stamps the report onto the
 * rule record so downstream operators can see why a rule was or wasn't
 * promoted — silent rejection is worse than a rejected rule we can audit.
 *
 * Thresholds are overridable but the defaults are deliberately loose for
 * Stage-1 rollout: precision ≥ 0.8, with a minimum of 3 sampled events in
 * scope. Below the minimum sample, the validator promotes the rule but
 * flags `reason: 'insufficient_sample'` so we don't starve the gate of new
 * rules while feedback volume is still small.
 */
function validateProposedRule(rule, {
  seedLesson,
  recentEvents = [],
  precisionFloor = DEFAULT_PRECISION_FLOOR,
  minSample = DEFAULT_MIN_SAMPLE,
} = {}) {
  const report = {
    shouldPromote: false,
    reason: null,
    matchesSeed: false,
    precision: null,
    recall: null,
    sampleSize: 0,
    tp: 0,
    fp: 0,
    fn: 0,
    tn: 0,
  };

  if (!rule || !rule.rule) {
    report.reason = 'invalid_rule_shape';
    return report;
  }

  // Invariant 1: the rule must fire on the seed lesson. If it doesn't, the
  // trigger extraction dropped the discriminative tokens and the rule is
  // broken regardless of what the sample says.
  report.matchesSeed = seedLesson ? ruleMatches(rule, seedLesson) : false;
  if (!report.matchesSeed) {
    report.reason = 'rule_does_not_match_seed_lesson';
    return report;
  }

  // Invariant 2: precision on recent overlapping-tag events. We pass
  // scopeTags = rule.tags so the scorer restricts to the same topical
  // cluster as the rule.
  const scoreReport = scoreOnSample(rule, recentEvents, { scopeTags: rule.tags });
  Object.assign(report, scoreReport);
  report.sampleSize = scoreReport.tp + scoreReport.fp + scoreReport.fn + scoreReport.tn;

  if (report.sampleSize < minSample) {
    // Permissive path: we can't prove harm, so allow promotion but flag
    // the rule for later audit when more data accumulates.
    report.shouldPromote = true;
    report.reason = 'insufficient_sample';
    return report;
  }

  if (report.precision === null) {
    // Rule never fired on the in-scope sample. Still worth promoting
    // because the seed invariant held — absence of firings just means
    // this topic is quiet in recent history.
    report.shouldPromote = true;
    report.reason = 'no_firings_in_sample';
    return report;
  }

  if (report.precision < precisionFloor) {
    report.shouldPromote = false;
    report.reason = 'precision_below_floor';
    return report;
  }

  report.shouldPromote = true;
  report.reason = 'validated';
  return report;
}

module.exports = {
  tokenize,
  eventText,
  eventSignal,
  ruleMatches,
  scoreOnSample,
  validateProposedRule,
  DEFAULT_PRECISION_FLOOR,
  DEFAULT_MIN_SAMPLE,
};
