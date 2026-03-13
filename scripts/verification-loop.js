'use strict';

const path = require('path');
const { readJSONL, getFeedbackPaths } = require('./feedback-loop');
const {
  buildPartnerStrategy,
  computePartnerReward,
  resolveVerificationRetries,
} = require('./partner-orchestration');

const MAX_RETRIES = 3;
const DEFAULT_MODEL_PATH = path.join(__dirname, '..', '.rlhf', 'verification-model.json');

/**
 * Run a single verification step against prevention rules.
 * Returns { passed: boolean, violations: string[], score: number }
 *
 * @param {object} params
 * @param {string} params.context - The output/action to verify
 * @param {string[]} params.tags - Domain tags
 * @param {string} [params.skill] - Skill that produced the output
 * @returns {object} verification result
 */
function verifyAgainstRules(params) {
  const { MEMORY_LOG_PATH } = getFeedbackPaths();
  const memories = readJSONL(MEMORY_LOG_PATH).filter(m => m.category === 'error');

  const violations = [];
  const context = (params.context || '').toLowerCase();

  for (const mem of memories) {
    const mistakeContent = (mem.content || '').toLowerCase();
    const mistakeTitle = (mem.title || '').toLowerCase();

    const avoidMatch = mistakeContent.match(/how to avoid:\s*(.+)/i);
    const avoidRule = avoidMatch ? avoidMatch[1].trim() : null;

    const keywords = extractKeywords(mistakeTitle);
    const overlap = keywords.filter(kw => context.includes(kw));

    if (overlap.length >= 2) {
      violations.push({
        ruleSource: mem.id || 'unknown',
        pattern: mistakeTitle.slice(0, 100),
        avoidRule: avoidRule || 'Review and prevent recurrence',
        matchedKeywords: overlap,
      });
    }
  }

  const score = violations.length === 0 ? 1.0 : Math.max(0, 1 - (violations.length * 0.3));

  return {
    passed: violations.length === 0,
    violations,
    score,
    checkedRules: memories.length,
  };
}

/**
 * Extract meaningful keywords from a string (4+ char words, no stopwords).
 */
function extractKeywords(text) {
  const stopwords = new Set(['this', 'that', 'with', 'from', 'have', 'been', 'were', 'what', 'when', 'where', 'which', 'their', 'about', 'would', 'could', 'should', 'without', 'before', 'after', 'mistake']);
  return (text || '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !stopwords.has(w));
}

/**
 * Execute a verification loop with retries.
 *
 * @param {object} params
 * @param {string} params.context - The action/output to verify
 * @param {string[]} [params.tags] - Domain tags
 * @param {string} [params.skill] - Originating skill
 * @param {function} [params.onRetry] - Called with (attempt, violations) when retrying; should return amended context string
 * @param {number} [params.maxRetries] - Max retry attempts (default 3)
 * @param {string} [params.modelPath] - Path to Thompson model for verification
 * @returns {object} { accepted, attempts, finalVerification, history, thompsonUpdate }
 */
function runVerificationLoop(params) {
  const requestedMaxRetries = Number.isFinite(params.maxRetries) ? params.maxRetries : MAX_RETRIES;
  const partnerStrategy = buildPartnerStrategy({
    partnerProfile: params.partnerProfile,
  });
  const maxRetries = resolveVerificationRetries(requestedMaxRetries, partnerStrategy);
  const modelPath = params.modelPath || DEFAULT_MODEL_PATH;
  const tags = Array.isArray(params.tags) ? params.tags : [];
  const history = [];

  let currentContext = params.context || '';
  let accepted = false;
  let finalVerification = null;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const verification = verifyAgainstRules({
      context: currentContext,
      tags,
      skill: params.skill,
    });

    history.push({
      attempt,
      passed: verification.passed,
      violationCount: verification.violations.length,
      score: verification.score,
      timestamp: new Date().toISOString(),
    });

    if (verification.passed) {
      accepted = true;
      finalVerification = verification;
      break;
    }

    finalVerification = verification;

    if (attempt > maxRetries) break;

    if (typeof params.onRetry === 'function') {
      const amended = params.onRetry(attempt, verification.violations);
      if (typeof amended === 'string' && amended.trim()) {
        currentContext = amended;
      }
    }
  }

  const ts = require('./thompson-sampling');
  const model = ts.loadModel(modelPath);
  const signal = accepted ? 'positive' : 'negative';
  const partnerReward = computePartnerReward({
    accepted,
    attempts: history.length,
    violationCount: finalVerification && Array.isArray(finalVerification.violations)
      ? finalVerification.violations.length
      : 0,
    partnerStrategy,
  });
  const categories = [...new Set([
    ...(tags.length ? tags : ['uncategorized']),
    partnerStrategy.partnerCategory,
  ])];
  ts.updateModel(model, {
    signal,
    timestamp: new Date().toISOString(),
    categories,
    weightMultiplier: partnerReward.weightMultiplier,
  });
  ts.saveModel(model, modelPath);
  const thompsonUpdate = {
    signal,
    partnerCategory: partnerStrategy.partnerCategory,
    weightMultiplier: partnerReward.weightMultiplier,
    reliability: ts.getReliability(model),
  };

  return {
    accepted,
    attempts: history.length,
    maxRetries,
    requestedMaxRetries,
    finalVerification,
    history,
    partnerStrategy,
    partnerReward,
    thompsonUpdate,
  };
}

/**
 * Get verification reliability stats from the Thompson model.
 * Returns per-category reliability from accumulated verification outcomes.
 *
 * @param {string} [modelPath] - Path to model file
 * @returns {object} reliability map
 */
function getVerificationReliability(modelPath) {
  const ts = require('./thompson-sampling');
  const model = ts.loadModel(modelPath || DEFAULT_MODEL_PATH);
  return ts.getReliability(model);
}

/**
 * Sample Thompson posteriors to decide which categories need more verification.
 * Lower samples → less reliable → verify more aggressively.
 *
 * @param {string} [modelPath] - Path to model file
 * @returns {object} { samples, recommendations }
 */
function sampleVerificationPosteriors(modelPath) {
  const ts = require('./thompson-sampling');
  const model = ts.loadModel(modelPath || DEFAULT_MODEL_PATH);
  const samples = ts.samplePosteriors(model);

  const recommendations = [];
  for (const [category, sample] of Object.entries(samples)) {
    if (sample < 0.4) {
      recommendations.push(`HIGH-RISK: '${category}' needs stricter verification (sample=${sample.toFixed(3)})`);
    } else if (sample < 0.6) {
      recommendations.push(`MODERATE: '${category}' has mixed verification results (sample=${sample.toFixed(3)})`);
    }
  }

  return { samples, recommendations };
}

module.exports = {
  verifyAgainstRules,
  extractKeywords,
  runVerificationLoop,
  getVerificationReliability,
  sampleVerificationPosteriors,
  MAX_RETRIES,
  DEFAULT_MODEL_PATH,
};

if (require.main === module) {
  const args = {};
  process.argv.slice(2).forEach(arg => {
    if (!arg.startsWith('--')) return;
    const [key, ...rest] = arg.slice(2).split('=');
    args[key] = rest.length > 0 ? rest.join('=') : true;
  });

  if (args.verify) {
    const result = runVerificationLoop({
      context: args.context || '',
      tags: (args.tags || '').split(',').filter(Boolean),
      skill: args.skill,
      maxRetries: Number(args.retries || MAX_RETRIES),
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.accepted ? 0 : 1);
  }

  if (args.reliability) {
    console.log(JSON.stringify(getVerificationReliability(), null, 2));
    process.exit(0);
  }

  if (args.sample) {
    console.log(JSON.stringify(sampleVerificationPosteriors(), null, 2));
    process.exit(0);
  }

  console.log(`Usage:
  node scripts/verification-loop.js --verify --context="..." --tags=testing,api --skill=executor
  node scripts/verification-loop.js --reliability
  node scripts/verification-loop.js --sample`);
}
