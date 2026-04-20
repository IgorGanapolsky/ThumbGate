'use strict';

/**
 * scripts/bayes-optimal-gate.js
 *
 * Bayes-optimal decision layer for ThumbGate's pre-tool-use gate.
 *
 * Why this exists:
 *   The legacy gate blocks a tool call when any matched lesson tag has a
 *   heuristic risk score ≥ a global threshold. That is a "threshold on a
 *   heuristic" rule, not a Bayes-optimal decision. It cannot express two
 *   facts that matter in practice:
 *     1. Different tags carry different empirical harm rates (a prior).
 *     2. Mis-classification is asymmetric — letting a harmful `deploy-prod`
 *        call through is far more expensive than briefly blocking a safe
 *        lint fix. A single global threshold cannot reflect that.
 *
 * What this module provides:
 *   - `computeBayesPosterior(...)` — P(harmful | tags) combining the trained
 *     model's probability (if present), the base rate, and per-tag empirical
 *     risk rates via a clipped Bayes-factor update.
 *   - `bayesOptimalDecision(...)` — cost-weighted argmax over {block, allow}
 *     using a configurable loss matrix. Block iff the expected loss of
 *     allowing exceeds the expected loss of blocking.
 *   - `computeBayesErrorRate(rows)` — the irreducible error floor of the
 *     current feature set (tag signatures). Useful as a stopping rule when
 *     tuning the scorer.
 *
 * No external deps. Pure functions; the only IO is an optional
 * `config/enforcement.json` read inside `loadLossMatrix()`.
 */

const fs = require('node:fs');
const path = require('node:path');

// Baseline loss matrix. `default` applies when no tag-specific override
// matches. Higher = more expensive. The asymmetry below reflects the
// observed cost of real ThumbGate incidents: false-allow on a destructive
// or production-facing action costs hours of recovery and credibility;
// false-block costs the operator one explicit override flag.
const DEFAULT_LOSS_MATRIX = {
  falseAllow: {
    default: 1.0,
    'deploy-prod': 100.0,
    'destructive': 50.0,
    'secrets': 1000.0,
    'force-push-main': 200.0,
    'data-loss': 500.0,
  },
  falseBlock: {
    default: 1.0,
  },
};

const ENFORCEMENT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'enforcement.json');

/**
 * Load the loss matrix from `config/enforcement.json` if present, otherwise
 * return the baked-in default. Any parse/IO failure falls back to defaults —
 * the Bayes gate must never deadlock the hook on a config problem.
 */
function loadLossMatrix(configPath = ENFORCEMENT_CONFIG_PATH) {
  try {
    if (!fs.existsSync(configPath)) return DEFAULT_LOSS_MATRIX;
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!raw || typeof raw !== 'object' || !raw.lossMatrix) return DEFAULT_LOSS_MATRIX;
    return {
      falseAllow: { ...DEFAULT_LOSS_MATRIX.falseAllow, ...(raw.lossMatrix.falseAllow || {}) },
      falseBlock: { ...DEFAULT_LOSS_MATRIX.falseBlock, ...(raw.lossMatrix.falseBlock || {}) },
    };
  } catch {
    return DEFAULT_LOSS_MATRIX;
  }
}

/**
 * Look up the maximum applicable cost for a side of the loss matrix.
 * A single high-cost tag (e.g. `deploy-prod`) dominates — one dangerous tag
 * in a bundle of otherwise innocuous tags must still flip the decision.
 */
function resolveCost(matrixSide, tags) {
  const defaultCost = Number(matrixSide?.default ?? 1);
  let cost = Number.isFinite(defaultCost) ? defaultCost : 1;
  for (const tag of tags || []) {
    const key = String(tag || '').trim().toLowerCase();
    if (!key) continue;
    const candidate = Number(matrixSide?.[key]);
    if (Number.isFinite(candidate) && candidate > cost) cost = candidate;
  }
  return cost;
}

/**
 * Clip a number to [min, max]. Used to bound the Bayes factor so a single
 * noisy tag (e.g. 1/1 harmful) cannot flip the decision on the basis of one
 * observation. The clip window is conservative on purpose.
 */
function clip(value, min, max) {
  if (Number.isNaN(value) || value === undefined || value === null) return min;
  // +Infinity/-Infinity are finite conceptually at the bounds — clamp them to
  // the nearest edge rather than silently collapsing to `min`.
  if (value === Infinity) return max;
  if (value === -Infinity) return min;
  if (typeof value !== 'number') return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Normalize a tag into the canonical lowercase key used by the model's
 * pattern summary. Returns an empty string for falsy or non-string tags.
 */
function normalizeTag(tag) {
  return String(tag || '').trim().toLowerCase();
}

/**
 * Build a Map(tag -> riskRate) from the model's `highRiskTags` array.
 * `riskRate` is empirical P(harmful | tag) computed from feedback sequences
 * by `risk-scorer.buildPatternSummary`.
 */
function buildRiskRateMap(highRiskTags) {
  const map = new Map();
  if (!Array.isArray(highRiskTags)) return map;
  for (const bucket of highRiskTags) {
    const key = normalizeTag(bucket?.key || bucket?.tag);
    if (!key) continue;
    const rate = Number(bucket?.riskRate ?? bucket?.rate);
    if (Number.isFinite(rate) && rate >= 0 && rate <= 1) {
      map.set(key, rate);
    }
  }
  return map;
}

/**
 * Compute P(harmful | tags) as a Bayes-factor update over a starting
 * probability. If `modelProbability` is supplied (the trained scorer's
 * direct output), it seeds the update — richer feature evidence than the
 * raw base rate. Otherwise we fall back to the prior.
 *
 * For each observed tag with a known empirical risk rate, we multiply the
 * current odds by `riskRate / prior` (the Bayes factor), then convert odds
 * back to probability. The Bayes factor is clipped to [0.25, 4.0] to keep a
 * single sparsely-observed tag from dominating.
 */
function computeBayesPosterior({ tags, riskByTag, baseRate, modelProbability } = {}) {
  const prior = clip(Number(baseRate) || 0, 0.01, 0.99);
  const seed = Number.isFinite(modelProbability) ? clip(modelProbability, 0.01, 0.99) : prior;

  let odds = seed / (1 - seed);
  const rateMap = riskByTag instanceof Map
    ? riskByTag
    : new Map(Object.entries(riskByTag || {}).map(([k, v]) => [normalizeTag(k), Number(v)]));

  const evidence = [];
  for (const tag of tags || []) {
    const key = normalizeTag(tag);
    if (!key) continue;
    const rate = rateMap.get(key);
    if (!Number.isFinite(rate)) continue;
    const bayesFactor = clip(rate / prior, 0.25, 4.0);
    odds *= bayesFactor;
    evidence.push({ tag: key, rate, bayesFactor: round3(bayesFactor) });
  }

  const pHarmful = odds / (1 + odds);
  return {
    pHarmful: round3(pHarmful),
    pSafe: round3(1 - pHarmful),
    prior: round3(prior),
    seed: round3(seed),
    evidence,
  };
}

/**
 * Cost-weighted Bayes-optimal decision. Block iff
 *   E[loss | allow] = P(harmful) * cost(falseAllow)
 * exceeds
 *   E[loss | block] = P(safe)    * cost(falseBlock).
 *
 * This reduces to the usual Bayes classifier when both costs are equal.
 */
function bayesOptimalDecision(posterior, tags, lossMatrix = DEFAULT_LOSS_MATRIX) {
  const pHarmful = clip(Number(posterior?.pHarmful), 0, 1);
  const pSafe = clip(Number(posterior?.pSafe ?? 1 - pHarmful), 0, 1);
  const cFalseAllow = resolveCost(lossMatrix?.falseAllow || {}, tags);
  const cFalseBlock = resolveCost(lossMatrix?.falseBlock || {}, tags);
  const lossAllow = pHarmful * cFalseAllow;
  const lossBlock = pSafe * cFalseBlock;
  return {
    decision: lossAllow > lossBlock ? 'block' : 'allow',
    expectedLoss: {
      allow: round3(lossAllow),
      block: round3(lossBlock),
    },
    costs: { falseAllow: cFalseAllow, falseBlock: cFalseBlock },
  };
}

/**
 * Bayes error rate: the irreducible error floor of a classifier built on
 * the current feature set, estimated empirically from `rows`.
 *
 * For each tag signature s we have n_s rows of which k_s were harmful. The
 * optimal per-signature prediction errs with probability min(k/n, 1-k/n).
 * Weighting by P(s) = n_s / N and summing gives the Bayes error rate.
 *
 * Returns null when `rows` is empty or not an array.
 */
function computeBayesErrorRate(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const buckets = new Map();
  for (const row of rows) {
    const sig = tagSignature(row);
    if (!buckets.has(sig)) buckets.set(sig, { total: 0, harmful: 0 });
    const bucket = buckets.get(sig);
    bucket.total += 1;
    if (isHarmful(row)) bucket.harmful += 1;
  }

  const total = rows.length;
  let err = 0;
  for (const { total: n, harmful: k } of buckets.values()) {
    const p = n === 0 ? 0 : k / n;
    err += (n / total) * Math.min(p, 1 - p);
  }
  return round3(err);
}

function tagSignature(row) {
  const raw = Array.isArray(row?.targetTags)
    ? row.targetTags
    : Array.isArray(row?.tags)
      ? row.tags
      : [];
  const normalized = raw.map(normalizeTag).filter(Boolean).sort();
  return normalized.join('|') || '__none__';
}

/**
 * Mirror of `risk-scorer.deriveTargetRisk` so this module has no cycle back
 * into risk-scorer. Kept intentionally narrow — if risk-scorer's definition
 * broadens, revisit here too.
 */
function isHarmful(row) {
  if (!row || typeof row !== 'object') return false;
  if (typeof row.targetRisk === 'number') return row.targetRisk > 0;
  if (typeof row.accepted === 'boolean' && row.accepted === false) return true;
  const label = String(row.label || row.signal || '').toLowerCase();
  return label === 'negative';
}

function round3(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}

module.exports = {
  DEFAULT_LOSS_MATRIX,
  ENFORCEMENT_CONFIG_PATH,
  loadLossMatrix,
  resolveCost,
  buildRiskRateMap,
  computeBayesPosterior,
  bayesOptimalDecision,
  computeBayesErrorRate,
  tagSignature,
  isHarmful,
  clip,
  normalizeTag,
};
