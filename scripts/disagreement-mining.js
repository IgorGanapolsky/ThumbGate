#!/usr/bin/env node
/**
 * Disagreement Mining
 *
 * Inspired by Dropbox's "human-calibrated LLM labeling" approach.
 * The strongest learning signal comes from cases where the Thompson
 * Sampling model DISAGREES with actual user feedback signals. These
 * disagreements are prioritized for review and DPO pair generation.
 *
 * Zero external npm dependencies.
 */

'use strict';

const path = require('path');
const { loadModel, getReliability } = require('./thompson-sampling');
const { readJSONL, getFeedbackPaths, inferDomain } = require('./feedback-loop');
const { extractDomainKeys } = require('./export-dpo-pairs');

// ---------------------------------------------------------------------------
// Domain → Thompson category mapping
// ---------------------------------------------------------------------------

/**
 * Map an inferDomain() result to the closest Thompson Sampling category.
 * Thompson uses: code_edit, git, testing, pr_review, search, architecture,
 * security, debugging, uncategorized.
 *
 * @param {string} domain - Domain from inferDomain()
 * @returns {string} Thompson category key
 */
function domainToCategory(domain) {
  const mapping = {
    'testing': 'testing',
    'security': 'security',
    'debugging': 'debugging',
    'architecture': 'architecture',
    'git-workflow': 'git',
    'ui-components': 'code_edit',
    'api-integration': 'code_edit',
    'documentation': 'uncategorized',
    'data-modeling': 'architecture',
    'performance': 'debugging',
    'general': 'uncategorized',
  };
  return mapping[domain] || 'uncategorized';
}

// ---------------------------------------------------------------------------
// Core: Mine Disagreements
// ---------------------------------------------------------------------------

/**
 * Find disagreements between Thompson model predictions and actual user signals.
 *
 * A "disagreement" is when:
 * - Thompson reliability > highThreshold (e.g. 0.6) but user gave negative signal
 * - Thompson reliability < lowThreshold (e.g. 0.4) but user gave positive signal
 *
 * @param {Object} [opts]
 * @param {string} [opts.feedbackDir] - Override feedback dir
 * @param {string} [opts.modelPath] - Override model path
 * @param {number} [opts.highThreshold=0.6] - Reliability above which positive is expected
 * @param {number} [opts.lowThreshold=0.4] - Reliability below which negative is expected
 * @returns {{ disagreements: Array, stats: Object }}
 */
function mineDisagreements(opts) {
  const options = opts || {};
  const highThreshold = options.highThreshold != null ? options.highThreshold : 0.6;
  const lowThreshold = options.lowThreshold != null ? options.lowThreshold : 0.4;

  const paths = getFeedbackPaths();
  const feedbackDir = options.feedbackDir || paths.FEEDBACK_DIR;
  const modelPath = options.modelPath || path.join(feedbackDir, 'feedback_model.json');
  const feedbackLogPath = path.join(feedbackDir, 'feedback-log.jsonl');

  const model = loadModel(modelPath);
  const reliability = getReliability(model);
  const events = readJSONL(feedbackLogPath);

  const disagreements = [];

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (!event.signal) continue;

    const isPositive = event.signal === 'positive';
    const domain = inferDomain(event.tags, event.context);
    const category = domainToCategory(domain);
    const catReliability = reliability[category]
      ? reliability[category].reliability
      : 0.5;

    let disagreementType = null;
    let strength = 0;

    if (catReliability > highThreshold && !isPositive) {
      // Model thinks this category is reliable, but user disagrees
      disagreementType = 'model_overconfident';
      strength = catReliability - highThreshold;
    } else if (catReliability < lowThreshold && isPositive) {
      // Model thinks this category is unreliable, but user approves
      disagreementType = 'model_underconfident';
      strength = lowThreshold - catReliability;
    }

    if (disagreementType) {
      disagreements.push({
        feedbackIndex: i,
        feedbackId: event.id || `event-${i}`,
        signal: event.signal,
        domain,
        category,
        categoryReliability: catReliability,
        disagreementType,
        disagreementStrength: Math.round(strength * 1000) / 1000,
        context: event.context || '',
        tags: event.tags || [],
        timestamp: event.timestamp || null,
      });
    }
  }

  // Sort by disagreement strength descending (strongest signal first)
  disagreements.sort((a, b) => b.disagreementStrength - a.disagreementStrength);

  const rate = events.length > 0
    ? Math.round((disagreements.length / events.length) * 1000) / 1000
    : 0;

  return {
    disagreements,
    stats: {
      totalEvents: events.length,
      disagreementCount: disagreements.length,
      disagreementRate: rate,
      overconfident: disagreements.filter((d) => d.disagreementType === 'model_overconfident').length,
      underconfident: disagreements.filter((d) => d.disagreementType === 'model_underconfident').length,
    },
  };
}

// ---------------------------------------------------------------------------
// Amplify: Generate DPO pairs from disagreements
// ---------------------------------------------------------------------------

/**
 * Generate amplified DPO pairs from disagreements.
 * For each disagreement, synthesize a preference pair where:
 * - chosen = what the user signal implies (corrective direction)
 * - rejected = what the model predicted
 *
 * @param {Array} disagreements - From mineDisagreements()
 * @returns {Array} DPO preference pairs with amplification metadata
 */
function amplifyFromDisagreements(disagreements) {
  if (!Array.isArray(disagreements)) return [];

  return disagreements.map((d) => {
    const domainKeys = extractDomainKeys({
      tags: d.tags,
      title: d.context,
    });
    const domainLabel = domainKeys.length > 0 ? domainKeys.join(', ') : d.domain;

    const prompt = `Domain: ${domainLabel}. ` +
      `The agent performed a ${d.domain} task. ` +
      (d.context ? `Context: ${d.context}` : 'How should the agent handle this scenario?');

    let chosen;
    let rejected;

    if (d.disagreementType === 'model_overconfident') {
      // Model thought it was good, user said no — user's correction is "chosen"
      chosen = `The agent should NOT rely on its current ${d.domain} approach. ` +
        `User feedback indicates failure despite model confidence of ${d.categoryReliability.toFixed(2)}. ` +
        'Corrective action needed.';
      rejected = `The agent's ${d.domain} approach is reliable ` +
        `(model confidence: ${d.categoryReliability.toFixed(2)}). Continue current behavior.`;
    } else {
      // Model thought it was bad, user said it was fine — model is too cautious
      chosen = `The agent's ${d.domain} approach succeeded. ` +
        `User approved despite model skepticism (confidence: ${d.categoryReliability.toFixed(2)}). ` +
        'This approach should be trusted more.';
      rejected = `The agent's ${d.domain} approach is unreliable ` +
        `(model confidence: ${d.categoryReliability.toFixed(2)}). Avoid this approach.`;
    }

    return {
      prompt,
      chosen,
      rejected,
      metadata: {
        disagreementStrength: d.disagreementStrength,
        disagreementType: d.disagreementType,
        domain: d.domain,
        category: d.category,
        originalFeedbackId: d.feedbackId,
        amplified: true,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Calibrate: Cross-reference prevention rules with Thompson model
// ---------------------------------------------------------------------------

/**
 * Calibrate prevention rules by cross-referencing disagreements.
 * Only promote rules where BOTH Thompson model AND user signals agree
 * on the failure pattern (concordance check).
 *
 * @param {string} [feedbackDir] - Override feedback dir
 * @returns {{ calibratedRules: Array, droppedRules: Array, concordanceRate: number }}
 */
function calibratePreventionRules(feedbackDir) {
  const paths = getFeedbackPaths();
  const dir = feedbackDir || paths.FEEDBACK_DIR;
  const modelPath = path.join(dir, 'feedback_model.json');
  const memoryLogPath = path.join(dir, 'memory-log.jsonl');

  const model = loadModel(modelPath);
  const reliability = getReliability(model);
  const memories = readJSONL(memoryLogPath);

  // Filter to error memories only
  const errorMemories = memories.filter((m) => m.category === 'error');

  const calibratedRules = [];
  const droppedRules = [];

  for (const mem of errorMemories) {
    const domain = inferDomain(mem.tags, mem.content || mem.title || '');
    const category = domainToCategory(domain);
    const catReliability = reliability[category]
      ? reliability[category].reliability
      : 0.5;

    const rule = {
      domain,
      category,
      title: mem.title || '',
      categoryReliability: catReliability,
      memoryId: mem.id || null,
    };

    // Concordance: both user (error memory) and Thompson (low reliability) agree
    if (catReliability < 0.5) {
      calibratedRules.push(rule);
    } else {
      droppedRules.push(rule);
    }
  }

  const total = calibratedRules.length + droppedRules.length;
  const concordanceRate = total > 0
    ? Math.round((calibratedRules.length / total) * 1000) / 1000
    : 1;

  return {
    calibratedRules,
    droppedRules,
    concordanceRate,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  argv.forEach((arg) => {
    if (!arg.startsWith('--')) return;
    const [key, ...rest] = arg.slice(2).split('=');
    args[key] = rest.length ? rest.join('=') : true;
  });
  return args;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));

  if (args.calibrate) {
    const result = calibratePreventionRules(args['feedback-dir']);
    console.log(JSON.stringify(result, null, 2));
  } else {
    // --mine or --amplify (amplify implies mine)
    const result = mineDisagreements({
      feedbackDir: args['feedback-dir'],
      modelPath: args['model-path'],
      highThreshold: args['high-threshold'] ? Number(args['high-threshold']) : undefined,
      lowThreshold: args['low-threshold'] ? Number(args['low-threshold']) : undefined,
    });

    if (args.amplify) {
      const pairs = amplifyFromDisagreements(result.disagreements);
      console.log(JSON.stringify({ pairs, stats: result.stats }, null, 2));
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  mineDisagreements,
  amplifyFromDisagreements,
  calibratePreventionRules,
  domainToCategory,
};
