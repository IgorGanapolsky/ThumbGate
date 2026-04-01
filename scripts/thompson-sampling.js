#!/usr/bin/env node
/**
 * Thompson Sampling Beta-Bernoulli Module
 *
 * Implements per-category reliability estimates (ML-01) and exponential
 * time-decay weighting with half-life of 7 days (ML-02).
 *
 * Source: Direct port of train_from_feedback.py (Subway_RN_Demo) lines 218-293.
 * Algorithm: Beta-Bernoulli update with Marsaglia-Tsang gamma sampling for
 *            posterior draws. Zero external npm dependencies.
 *
 * Usage:
 *   const ts = require('./thompson-sampling');
 *   const model = ts.loadModel(modelPath);
 *   ts.updateModel(model, { signal: 'positive', timestamp: '...', categories: ['testing'] });
 *   const rel = ts.getReliability(model);
 *   const post = ts.samplePosteriors(model);
 */

'use strict';

const fs = require('fs');
const { parseTimestamp } = require('./feedback-schema');
const { getEffectiveSetting } = require('./evolution-state');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Exponential decay half-life in days. 2^(-age/HALF_LIFE_DAYS) weights recent feedback higher. */
const HALF_LIFE_DAYS = 7.0;

/**
 * Minimum weight floor so that very old feedback still contributes (minimally),
 * and invalid timestamps do not silently zero out updates.
 */
const DECAY_FLOOR = 0.01;

/**
 * Minimum number of real samples before a category's posterior mean is trusted
 * over the uniform prior. Below this threshold, getCalibration() marks the
 * category as "uncalibrated" — callers should treat reliability estimates as
 * speculative and fall back to rule-based decisions.
 */
const MIN_SAMPLES_THRESHOLD = 5;

/**
 * Default category taxonomy — mirrors Subway's 8-keyword categories plus
 * 'uncategorized' as the catch-all. Used when initializing a new model.
 */
const DEFAULT_CATEGORIES = [
  'code_edit',
  'git',
  'testing',
  'pr_review',
  'search',
  'architecture',
  'security',
  'debugging',
  'product_recommendation',
  'brand_compliance',
  'sizing',
  'pricing',
  'regulatory',
  'uncategorized',
];

// ---------------------------------------------------------------------------
// Time-Decay Weight
// ---------------------------------------------------------------------------

/**
 * Compute exponential time-decay weight for a feedback timestamp.
 *
 * Formula: weight = max(2^(-ageDays / HALF_LIFE_DAYS), DECAY_FLOOR)
 *
 * At age=0 days: weight ≈ 1.0
 * At age=7 days: weight ≈ 0.5
 * At age=∞ days: weight → DECAY_FLOOR (0.01)
 *
 * Returns DECAY_FLOOR for invalid/null timestamps so callers never receive 0.
 *
 * @param {string|null|undefined} timestamp - ISO 8601 timestamp string
 * @returns {number} Weight in [DECAY_FLOOR, 1.0]
 */
function timeDecayWeight(timestamp) {
  const d = parseTimestamp(timestamp);
  const decayFloor = getEffectiveSetting('decay_floor', DECAY_FLOOR);
  const halfLifeDays = getEffectiveSetting('half_life_days', HALF_LIFE_DAYS);
  if (!d) return decayFloor;
  const ageDays = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(Math.pow(2, -ageDays / halfLifeDays), decayFloor);
}

// ---------------------------------------------------------------------------
// Model Lifecycle
// ---------------------------------------------------------------------------

/**
 * Create a fresh Beta-Bernoulli model with uniform priors (alpha=1, beta=1)
 * for all DEFAULT_CATEGORIES. The uniform prior encodes "no information yet."
 *
 * @returns {Object} Initial model object
 */
function createInitialModel() {
  const now = new Date().toISOString();
  const categories = {};
  DEFAULT_CATEGORIES.forEach((cat) => {
    categories[cat] = { alpha: 1.0, beta: 1.0, samples: 0, last_updated: null };
  });
  return {
    version: 1,
    created: now,
    updated: now,
    total_entries: 0,
    categories,
  };
}

/**
 * Load an existing model from disk. Falls back to createInitialModel() only
 * if the file does not exist or contains invalid JSON.
 *
 * IMPORTANT: Never call createInitialModel() directly when you intend to
 * update an existing model — that would reset all accumulated posteriors.
 *
 * @param {string} modelPath - Absolute or relative path to feedback_model.json
 * @returns {Object} Parsed model or fresh initial model
 */
function loadModel(modelPath) {
  if (fs.existsSync(modelPath)) {
    try {
      return JSON.parse(fs.readFileSync(modelPath, 'utf-8'));
    } catch (_err) {
      // Corrupt JSON — fall through to createInitialModel()
    }
  }
  return createInitialModel();
}

/**
 * Persist a model object to disk as formatted JSON.
 *
 * Creates parent directories if needed. Updates `model.updated` timestamp
 * before writing so the file reflects the time of save.
 *
 * @param {Object} model - Model object to persist
 * @param {string} modelPath - Absolute or relative path to write
 */
function saveModel(model, modelPath) {
  model.updated = new Date().toISOString();
  const dir = require('path').dirname(modelPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(modelPath, `${JSON.stringify(model, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// Model Update
// ---------------------------------------------------------------------------

/**
 * Apply a single weighted Beta-Bernoulli update to the model.
 *
 * For positive signal:  alpha += timeDecayWeight(timestamp) * weightMultiplier
 * For negative signal:  beta  += timeDecayWeight(timestamp) * weightMultiplier
 *
 * Updates all provided categories. If a category is not in the model yet,
 * it is added with default priors before applying the update.
 *
 * Mutates model in place AND returns the model for chaining.
 *
 * @param {Object} model - Model object (mutated in place)
 * @param {Object} params
 * @param {'positive'|'negative'} params.signal - Feedback direction
 * @param {string} params.timestamp - ISO 8601 timestamp for decay calculation
 * @param {string[]} [params.categories] - Categories to update; defaults to ['uncategorized']
 * @param {number} [params.weightMultiplier] - Optional multiplier for stronger/slower updates
 * @returns {Object} The mutated model
 */
function updateModel(model, { signal, timestamp, categories, weightMultiplier }) {
  const multiplier = Number.isFinite(weightMultiplier) && weightMultiplier > 0 ? weightMultiplier : 1;
  const weight = timeDecayWeight(timestamp) * multiplier;
  const isPositive = signal === 'positive';
  const cats = categories && categories.length ? categories : ['uncategorized'];

  cats.forEach((cat) => {
    if (!model.categories[cat]) {
      model.categories[cat] = { alpha: 1.0, beta: 1.0, samples: 0, last_updated: null };
    }
    if (isPositive) {
      model.categories[cat].alpha += weight;
    } else {
      model.categories[cat].beta += weight;
    }
    model.categories[cat].samples += 1;
    model.categories[cat].last_updated = timestamp;
  });

  model.total_entries = (model.total_entries || 0) + 1;
  model.updated = new Date().toISOString();
  return model;
}

// ---------------------------------------------------------------------------
// Reliability Estimation
// ---------------------------------------------------------------------------

/**
 * Compute per-category reliability as the Beta posterior mean:
 *   reliability = alpha / (alpha + beta)
 *
 * With uniform priors (alpha=1, beta=1), reliability starts at 0.5.
 * More positive signal → approaches 1.0.
 * More negative signal → approaches 0.0.
 *
 * @param {Object} model - Model object containing categories
 * @returns {Object} Map of category → { alpha, beta, reliability, samples }
 */
function getReliability(model) {
  const results = {};
  for (const [cat, params] of Object.entries(model.categories || {})) {
    const total = params.alpha + params.beta;
    results[cat] = {
      alpha: params.alpha,
      beta: params.beta,
      reliability: total > 0 ? params.alpha / total : 0.5,
      samples: params.samples,
    };
  }
  return results;
}

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

/**
 * Check whether a single category has enough samples to be trusted.
 *
 * @param {Object} model - Model object containing categories
 * @param {string} category - Category name to check
 * @returns {boolean} true if samples >= MIN_SAMPLES_THRESHOLD
 */
function isCalibrated(model, category) {
  const cat = model.categories && model.categories[category];
  if (!cat) return false;
  return cat.samples >= MIN_SAMPLES_THRESHOLD;
}

/**
 * Return per-category calibration report: reliability, sample count,
 * calibrated flag, and a confidence tier (high / medium / low / none).
 *
 * Confidence tiers:
 *   none   — 0 samples (pure prior)
 *   low    — 1–4 samples (speculative)
 *   medium — 5–19 samples (usable)
 *   high   — 20+ samples (trustworthy)
 *
 * @param {Object} model - Model object containing categories
 * @returns {Object} Map of category → { reliability, samples, calibrated, confidence }
 */
function getCalibration(model) {
  const results = {};
  for (const [cat, params] of Object.entries(model.categories || {})) {
    const total = params.alpha + params.beta;
    const reliability = total > 0 ? params.alpha / total : 0.5;
    const samples = params.samples || 0;
    const calibrated = samples >= MIN_SAMPLES_THRESHOLD;

    let confidence;
    if (samples === 0) confidence = 'none';
    else if (samples < MIN_SAMPLES_THRESHOLD) confidence = 'low';
    else if (samples < 20) confidence = 'medium';
    else confidence = 'high';

    results[cat] = { reliability, samples, calibrated, confidence };
  }
  return results;
}

// ---------------------------------------------------------------------------
// Posterior Sampling
// ---------------------------------------------------------------------------

/**
 * Draw one sample from the Beta posterior for each category via the
 * Marsaglia-Tsang (2000) gamma ratio method. No external library needed.
 *
 * betaSample(alpha, beta) = gammaSample(alpha) / (gammaSample(alpha) + gammaSample(beta))
 *
 * This is the JS equivalent of Python's random.betavariate(alpha, beta).
 * Used for Thompson Sampling action selection (explore via uncertainty).
 *
 * @param {Object} model - Model object containing categories
 * @returns {Object} Map of category → float sample in [0, 1]
 */
function samplePosteriors(model) {
  const samples = {};
  for (const [cat, params] of Object.entries(model.categories || {})) {
    samples[cat] = betaSample(
      Math.max(params.alpha, 0.01),
      Math.max(params.beta, 0.01),
    );
  }
  return samples;
}

// ---------------------------------------------------------------------------
// Internal: Marsaglia-Tsang Gamma Sampling (2000)
// ---------------------------------------------------------------------------

/**
 * Sample from Gamma(shape, 1) using Marsaglia-Tsang (2000) algorithm.
 * Handles shape < 1 via Johnk's method (shape+1 recursion with U^(1/shape) scaling).
 *
 * @param {number} shape - Shape parameter (must be > 0)
 * @returns {number} Gamma-distributed sample
 */
function gammaSample(shape) {
  if (shape < 1) {
    return gammaSample(1 + shape) * Math.pow(Math.random(), 1 / shape);
  }

  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);

  // Rejection sampling loop — terminates quickly for shape >= 1
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let x;
    let v;
    do {
      x = gaussSample();
      v = 1 + c * x;
    } while (v <= 0);

    v = v * v * v;
    const u = Math.random();

    if (u < 1 - 0.0331 * (x * x) * (x * x)) {
      return d * v;
    }
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
      return d * v;
    }
  }
}

/**
 * Draw a standard normal sample using Box-Muller with rejection sampling.
 * Avoids the log(0) edge case by rejecting s===0.
 *
 * @returns {number} Standard normal sample
 */
function gaussSample() {
  let u;
  let v;
  let s;
  do {
    u = Math.random() * 2 - 1;
    v = Math.random() * 2 - 1;
    s = u * u + v * v;
  } while (s >= 1 || s === 0);
  return u * Math.sqrt((-2 * Math.log(s)) / s);
}

/**
 * Sample from Beta(alpha, beta) using the gamma ratio method.
 *
 * @param {number} alpha - Alpha shape parameter (> 0)
 * @param {number} beta - Beta shape parameter (> 0)
 * @returns {number} Beta-distributed sample in [0, 1]
 */
function betaSample(alpha, beta) {
  const x = gammaSample(alpha);
  const y = gammaSample(beta);
  return x / (x + y);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  timeDecayWeight,
  loadModel,
  saveModel,
  createInitialModel,
  updateModel,
  getReliability,
  isCalibrated,
  getCalibration,
  samplePosteriors,
  HALF_LIFE_DAYS,
  DECAY_FLOOR,
  MIN_SAMPLES_THRESHOLD,
  DEFAULT_CATEGORIES,
};
