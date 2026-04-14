#!/usr/bin/env node
'use strict';

const path = require('path');
const { loadModel, getCalibration, DEFAULT_CATEGORIES } = require('./thompson-sampling');
const { generateSkills } = require('./skill-generator');
const { resolveFeedbackDir } = require('./feedback-paths');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default reliability threshold — categories below this trigger skill generation */
const DEFAULT_RELIABILITY_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Bridge Thompson Sampling reliability scores to skill generation.
 *
 * 1. Load the Thompson model and compute per-category calibration.
 * 2. Identify calibrated categories with reliability below threshold.
 * 3. For each low-reliability category, run skill generation scoped to
 *    that category's tags.
 * 4. Return a summary of triggered categories, generated skills, and
 *    categories skipped due to insufficient data.
 *
 * @param {object} [options]
 * @param {string} [options.modelPath] - Path to feedback_model.json
 * @param {string} [options.feedbackDir] - Override feedback directory
 * @param {number} [options.threshold] - Reliability threshold (default 0.5)
 * @param {number} [options.minClusterSize] - Min entries per skill cluster (default 2)
 * @param {boolean} [options.dryRun] - If true, return results without writing files
 * @returns {{
 *   threshold: number,
 *   triggeredCategories: Array<{category: string, reliability: number, confidence: string}>,
 *   skippedCategories: Array<{category: string, reason: string, reliability: number, samples: number}>,
 *   generatedSkills: Array<{skillName: string, filePath: string, ruleCount: number, evidenceCount: number, triggeredBy: string}>,
 *   summary: string
 * }}
 */
function generateReliabilityTriggeredSkills(options) {
  if (!options) options = {};

  const feedbackDir = options.feedbackDir || resolveFeedbackDir();
  const modelPath = options.modelPath || path.join(feedbackDir, 'feedback_model.json');
  const threshold = typeof options.threshold === 'number' ? options.threshold : DEFAULT_RELIABILITY_THRESHOLD;
  const minClusterSize = typeof options.minClusterSize === 'number' ? options.minClusterSize : 2;
  const dryRun = options.dryRun || false;

  // Step 1: Load model and get calibration
  const model = loadModel(modelPath);
  const calibration = getCalibration(model);

  const triggeredCategories = [];
  const skippedCategories = [];
  const allGeneratedSkills = [];

  // Step 2: Evaluate each category
  for (const category of DEFAULT_CATEGORIES) {
    const cal = calibration[category];
    if (!cal) continue;

    // Skip sub-arm categories (e.g. "testing:decision")
    if (category.includes(':')) continue;

    if (!cal.calibrated) {
      skippedCategories.push({
        category,
        reason: 'uncalibrated',
        reliability: cal.reliability,
        samples: cal.samples,
      });
      continue;
    }

    if (cal.reliability >= threshold) {
      skippedCategories.push({
        category,
        reason: 'healthy',
        reliability: cal.reliability,
        samples: cal.samples,
      });
      continue;
    }

    // Category is calibrated AND below threshold — trigger skill generation
    triggeredCategories.push({
      category,
      reliability: cal.reliability,
      confidence: cal.confidence,
    });

    // Step 3: Generate skills scoped to this category
    const skills = generateSkills({
      feedbackDir,
      minClusterSize,
      minTagOverlap: 1, // Lower overlap since we're already scoped by category
      dryRun,
    });

    // Filter to skills whose tags include this category
    const categorySkills = skills.filter(
      (s) => s.skillName.includes(category) || s.skillName.includes(category.replace(/_/g, '-'))
    );

    for (const skill of categorySkills) {
      allGeneratedSkills.push({
        ...skill,
        triggeredBy: category,
      });
    }
  }

  // Deduplicate skills (same skill might match multiple categories)
  const seen = new Set();
  const dedupedSkills = [];
  for (const skill of allGeneratedSkills) {
    if (!seen.has(skill.skillName)) {
      seen.add(skill.skillName);
      dedupedSkills.push(skill);
    }
  }

  const summary = triggeredCategories.length === 0
    ? `All ${Object.keys(calibration).length} calibrated categories are above ${threshold} reliability. No skills triggered.`
    : `${triggeredCategories.length} low-reliability categor${triggeredCategories.length === 1 ? 'y' : 'ies'} detected → ${dedupedSkills.length} skill(s) generated.`;

  return {
    threshold,
    triggeredCategories,
    skippedCategories,
    generatedSkills: dedupedSkills,
    summary,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  const thresholdArg = process.argv.find((a) => a.startsWith('--threshold='));
  const threshold = thresholdArg ? parseFloat(thresholdArg.split('=')[1]) : undefined;

  const result = generateReliabilityTriggeredSkills({ dryRun, threshold });
  console.log(JSON.stringify(result, null, 2));
}

module.exports = {
  generateReliabilityTriggeredSkills,
  DEFAULT_RELIABILITY_THRESHOLD,
};
