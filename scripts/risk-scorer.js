#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_FEEDBACK_DIR = path.join(PROJECT_ROOT, '.claude', 'memory', 'feedback');
const DEFAULT_MODEL_PATH = path.join(DEFAULT_FEEDBACK_DIR, 'risk-model.json');
const DEFAULT_SEQUENCE_PATH = path.join(DEFAULT_FEEDBACK_DIR, 'feedback-sequences.jsonl');

const DOMAIN_FEATURES = [
  'general',
  'testing',
  'security',
  'performance',
  'ui-components',
  'api-integration',
  'git-workflow',
  'documentation',
  'debugging',
  'architecture',
  'data-modeling',
];

const RISK_WORD_RE = /\b(fail|error|wrong|missing|skip|regress|unsafe|blocked|rejected)\b/i;
const VERIFY_WORD_RE = /\b(test|verify|coverage|evidence|log|proof)\b/i;
const SAFETY_WORD_RE = /\b(budget|path|guardrail|safe|security|risk)\b/i;
const SUCCESS_WORD_RE = /\b(pass|worked|fixed|success|verified)\b/i;

function resolveFeedbackDir(feedbackDir) {
  return feedbackDir || process.env.RLHF_FEEDBACK_DIR || DEFAULT_FEEDBACK_DIR;
}

function readJSONL(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function average(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

function max(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return values.reduce((best, value) => Math.max(best, Number(value || 0)), 0);
}

function countNegatives(values) {
  return (values || []).filter((value) => Number(value) < 0).length;
}

function countPositives(values) {
  return (values || []).filter((value) => Number(value) > 0).length;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildVocabulary(rows, key, limit) {
  const counts = new Map();
  rows.forEach((row) => {
    const values = key === 'targetTags'
      ? toArray(row.targetTags || row.tags)
      : row[key] ? [row[key]] : [];
    values.forEach((value) => {
      const normalized = String(value || '').trim().toLowerCase();
      if (!normalized) return;
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    });
  });

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

function buildFeatureRegistry(rows, options = {}) {
  return {
    topTags: buildVocabulary(rows, 'targetTags', options.maxTags || 8),
    topSkills: buildVocabulary(rows, 'skill', options.maxSkills || 4),
    domains: DOMAIN_FEATURES,
  };
}

function deriveTargetRisk(row) {
  if (typeof row.targetRisk === 'number') return row.targetRisk > 0 ? 1 : 0;
  if (typeof row.accepted === 'boolean' && row.accepted === false) return 1;
  const label = String(row.label || row.signal || '').toLowerCase();
  return label === 'negative' ? 1 : 0;
}

function deriveActionNegativeRate(actionPatterns) {
  const entries = Object.values(actionPatterns || {});
  if (entries.length === 0) return 0;
  const rates = entries.map((entry) => {
    const positive = Number(entry.positive || 0);
    const negative = Number(entry.negative || 0);
    const total = positive + negative;
    return total > 0 ? negative / total : 0;
  });
  return average(rates);
}

function extractFeatureMap(row, registry) {
  const rewardSequence = toArray(row.features && row.features.rewardSequence);
  const timeGaps = toArray(row.features && row.features.timeGaps);
  const currentTags = toArray(row.targetTags || row.tags).map((tag) => String(tag).trim().toLowerCase());
  const currentSkill = String(row.skill || '').trim().toLowerCase();
  const domain = String(row.domain || row.richContext && row.richContext.domain || 'general').trim().toLowerCase();
  const context = String(row.context || '').toLowerCase();
  const rubric = row.rubric || {};
  const filePathCount = Number(row.filePathCount || 0);
  const hasErrorType = row.errorType ? 1 : 0;
  const failingCriteria = toArray(rubric.failingCriteria);
  const failingGuardrails = toArray(rubric.failingGuardrails);
  const judgeDisagreements = toArray(rubric.judgeDisagreements);
  const weightedScore = Number(rubric.weightedScore);

  const features = {
    recentTrend: Number(row.features && row.features.recentTrend || 0),
    sequenceLength: rewardSequence.length,
    recentNegativeCount: countNegatives(rewardSequence),
    recentPositiveCount: countPositives(rewardSequence),
    avgTimeGap: average(timeGaps),
    maxTimeGap: max(timeGaps),
    tagCount: currentTags.length,
    filePathCount,
    hasErrorType,
    hasRubric: rubric.weightedScore != null ? 1 : 0,
    rubricWeightedScore: Number.isFinite(weightedScore) ? weightedScore : 0.5,
    failingCriteriaCount: failingCriteria.length,
    failingGuardrailsCount: failingGuardrails.length,
    judgeDisagreementCount: judgeDisagreements.length,
    actionNegativeRate: deriveActionNegativeRate(row.features && row.features.actionPatterns),
    containsRiskWord: RISK_WORD_RE.test(context) ? 1 : 0,
    containsVerificationWord: VERIFY_WORD_RE.test(context) ? 1 : 0,
    containsSafetyWord: SAFETY_WORD_RE.test(context) ? 1 : 0,
    containsSuccessWord: SUCCESS_WORD_RE.test(context) ? 1 : 0,
  };

  registry.domains.forEach((knownDomain) => {
    features[`domain:${knownDomain}`] = domain === knownDomain ? 1 : 0;
  });
  registry.topTags.forEach((tag) => {
    features[`tag:${tag}`] = currentTags.includes(tag) ? 1 : 0;
  });
  registry.topSkills.forEach((skill) => {
    features[`skill:${skill}`] = currentSkill === skill ? 1 : 0;
  });

  return features;
}

function candidateThresholds(values) {
  const uniques = [...new Set(values.map((value) => Number(value || 0)))].sort((left, right) => left - right);
  if (uniques.length <= 1) return uniques.length === 1 ? [uniques[0]] : [0];
  if (uniques.length <= 6) {
    return uniques.slice(0, -1).map((value, index) => (value + uniques[index + 1]) / 2);
  }

  const percentiles = [0.2, 0.4, 0.6, 0.8].map((pct) => {
    const position = Math.min(uniques.length - 2, Math.max(0, Math.floor((uniques.length - 1) * pct)));
    return (uniques[position] + uniques[position + 1]) / 2;
  });
  return [...new Set(percentiles)];
}

function stumpPredict(value, threshold, polarity) {
  const decision = Number(value || 0) > threshold ? 1 : -1;
  return decision * polarity;
}

function findBestWeakLearner(examples, weights, featureNames) {
  let best = null;

  featureNames.forEach((feature) => {
    const values = examples.map((example) => example.features[feature]);
    const thresholds = candidateThresholds(values);
    thresholds.forEach((threshold) => {
      [-1, 1].forEach((polarity) => {
        let error = 0;
        const predictions = [];
        examples.forEach((example, index) => {
          const prediction = stumpPredict(example.features[feature], threshold, polarity);
          predictions.push(prediction);
          if (prediction !== example.label) {
            error += weights[index];
          }
        });

        if (!best || error < best.error) {
          best = {
            feature,
            threshold,
            polarity,
            error,
            predictions,
          };
        }
      });
    });
  });

  return best;
}

function normalizeWeights(weights) {
  const total = weights.reduce((sum, value) => sum + value, 0) || 1;
  return weights.map((value) => value / total);
}

function trainingAccuracy(model, examples) {
  if (examples.length === 0) return 0;
  const correct = examples.filter((example) => {
    const prediction = predictRisk(model, example.row);
    return prediction.label === (example.label === 1 ? 'high-risk' : 'low-risk');
  }).length;
  return correct / examples.length;
}

function buildPatternSummary(rows) {
  function summarize(valuesFn) {
    const buckets = new Map();
    rows.forEach((row) => {
      valuesFn(row).forEach((value) => {
        const key = String(value || '').trim().toLowerCase();
        if (!key) return;
        if (!buckets.has(key)) {
          buckets.set(key, { key, total: 0, highRisk: 0 });
        }
        const bucket = buckets.get(key);
        bucket.total += 1;
        bucket.highRisk += deriveTargetRisk(row);
      });
    });

    return [...buckets.values()]
      .filter((bucket) => bucket.total >= 2)
      .map((bucket) => ({
        ...bucket,
        riskRate: Math.round((bucket.highRisk / bucket.total) * 1000) / 1000,
      }))
      .sort((left, right) => right.riskRate - left.riskRate || right.total - left.total || left.key.localeCompare(right.key))
      .slice(0, 5);
  }

  return {
    tags: summarize((row) => toArray(row.targetTags || row.tags)),
    domains: summarize((row) => [row.domain || row.richContext && row.richContext.domain || 'general']),
    skills: summarize((row) => row.skill ? [row.skill] : []),
  };
}

function trainRiskModel(rows, options = {}) {
  const registry = buildFeatureRegistry(rows, options);
  const examples = rows.map((row) => ({
    row,
    label: deriveTargetRisk(row) === 1 ? 1 : -1,
    features: extractFeatureMap(row, registry),
  }));

  const model = {
    version: 1,
    algorithm: 'adaboost-stumps',
    trainedAt: new Date().toISOString(),
    exampleCount: examples.length,
    highRiskExamples: examples.filter((example) => example.label === 1).length,
    baseRate: examples.length > 0
      ? examples.filter((example) => example.label === 1).length / examples.length
      : 0,
    featureRegistry: registry,
    featureNames: examples[0] ? Object.keys(examples[0].features) : [],
    learners: [],
    patterns: buildPatternSummary(rows),
    metrics: {
      trainingAccuracy: 0,
      rounds: 0,
      mode: 'baseline',
    },
  };

  if (examples.length < 6 || model.highRiskExamples === 0 || model.highRiskExamples === examples.length) {
    model.metrics.trainingAccuracy = trainingAccuracy(model, examples);
    return model;
  }

  let weights = normalizeWeights(Array(examples.length).fill(1));
  const rounds = Math.max(1, Math.min(12, Number(options.rounds || 8)));

  for (let round = 0; round < rounds; round += 1) {
    const learner = findBestWeakLearner(examples, weights, model.featureNames);
    if (!learner) break;

    const clippedError = Math.min(Math.max(learner.error, 1e-6), 1 - 1e-6);
    if (clippedError >= 0.5) break;

    const alpha = 0.5 * Math.log((1 - clippedError) / clippedError);
    model.learners.push({
      feature: learner.feature,
      threshold: learner.threshold,
      polarity: learner.polarity,
      alpha: Math.round(alpha * 1000) / 1000,
    });

    weights = normalizeWeights(weights.map((weight, index) => (
      weight * Math.exp(-alpha * examples[index].label * learner.predictions[index])
    )));
  }

  model.metrics.rounds = model.learners.length;
  model.metrics.mode = model.learners.length > 0 ? 'boosted' : 'baseline';
  model.metrics.trainingAccuracy = trainingAccuracy(model, examples);
  return model;
}

function rawScore(model, row) {
  if (!model || !model.featureRegistry) {
    return 0;
  }

  if (!model.learners || model.learners.length === 0) {
    const centeredBase = Number(model.baseRate || 0.5) - 0.5;
    return centeredBase * 2;
  }

  const features = extractFeatureMap(row, model.featureRegistry);
  return model.learners.reduce((sum, learner) => (
    sum + learner.alpha * stumpPredict(features[learner.feature], learner.threshold, learner.polarity)
  ), 0);
}

function predictRisk(model, row) {
  const score = rawScore(model, row);
  const probability = model.learners && model.learners.length > 0
    ? 1 / (1 + Math.exp(-2 * score))
    : Number(model.baseRate || 0);
  return {
    score: Math.round(score * 1000) / 1000,
    probability: Math.round(probability * 1000) / 1000,
    label: probability >= 0.5 ? 'high-risk' : 'low-risk',
  };
}

function buildRiskCandidate(params = {}, historyRows = []) {
  const currentTags = toArray(params.tags)
    .map((tag) => String(tag).trim())
    .filter(Boolean);
  const rewardSequence = historyRows.slice(-10).map((row) => Number(row.targetReward || 0)).filter((value) => Number.isFinite(value));
  const timeGaps = [];
  for (let index = Math.max(0, historyRows.length - 10); index < historyRows.length; index += 1) {
    if (index === 0) continue;
    const previous = Date.parse(historyRows[index - 1].timestamp || '');
    const current = Date.parse(historyRows[index].timestamp || '');
    if (Number.isFinite(previous) && Number.isFinite(current)) {
      timeGaps.push((current - previous) / 1000 / 60);
    }
  }

  return {
    context: params.context || '',
    targetTags: currentTags,
    skill: params.skill || null,
    domain: params.domain || 'general',
    filePathCount: Number(params.filePathCount || 0),
    errorType: params.errorType || null,
    rubric: params.rubric || null,
    features: {
      rewardSequence,
      recentTrend: rewardSequence.length > 0 ? average(rewardSequence.slice(-5)) : 0,
      timeGaps,
      actionPatterns: {},
    },
  };
}

function modelPathFor(feedbackDir) {
  return path.join(resolveFeedbackDir(feedbackDir), 'risk-model.json');
}

function sequencePathFor(feedbackDir) {
  return path.join(resolveFeedbackDir(feedbackDir), 'feedback-sequences.jsonl');
}

function saveRiskModel(model, feedbackDir) {
  const targetPath = modelPathFor(feedbackDir);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(model, null, 2)}\n`);
  return targetPath;
}

function loadRiskModel(feedbackDir) {
  const targetPath = modelPathFor(feedbackDir);
  if (!fs.existsSync(targetPath)) return null;
  return JSON.parse(fs.readFileSync(targetPath, 'utf8'));
}

function trainAndPersistRiskModel(feedbackDir, options = {}) {
  const resolvedDir = resolveFeedbackDir(feedbackDir);
  const rows = readJSONL(sequencePathFor(resolvedDir));
  const model = trainRiskModel(rows, options);
  const modelPath = saveRiskModel(model, resolvedDir);
  return { model, modelPath, rows };
}

function getRiskSummary(feedbackDir) {
  const resolvedDir = resolveFeedbackDir(feedbackDir);
  const rows = readJSONL(sequencePathFor(resolvedDir));
  if (rows.length === 0) return null;

  const model = loadRiskModel(resolvedDir) || trainRiskModel(rows);
  return {
    exampleCount: model.exampleCount,
    baseRate: Math.round((model.baseRate || 0) * 1000) / 1000,
    mode: model.metrics.mode,
    trainingAccuracy: Math.round((model.metrics.trainingAccuracy || 0) * 1000) / 1000,
    highRiskTags: model.patterns.tags,
    highRiskDomains: model.patterns.domains,
    highRiskSkills: model.patterns.skills,
  };
}

module.exports = {
  DEFAULT_MODEL_PATH,
  DEFAULT_SEQUENCE_PATH,
  buildFeatureRegistry,
  buildRiskCandidate,
  deriveTargetRisk,
  extractFeatureMap,
  loadRiskModel,
  modelPathFor,
  predictRisk,
  readJSONL,
  saveRiskModel,
  sequencePathFor,
  trainAndPersistRiskModel,
  trainRiskModel,
  getRiskSummary,
};

if (require.main === module) {
  const { model, modelPath } = trainAndPersistRiskModel();
  process.stdout.write(`${JSON.stringify({ modelPath, model }, null, 2)}\n`);
}
