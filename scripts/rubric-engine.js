#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_RUBRIC_PATH = path.join(PROJECT_ROOT, 'config', 'rubrics', 'default-v1.json');

function getRubricPath() {
  return process.env.RLHF_RUBRIC_PATH || DEFAULT_RUBRIC_PATH;
}

function loadRubricConfig() {
  const raw = fs.readFileSync(getRubricPath(), 'utf-8');
  const rubric = JSON.parse(raw);

  if (!rubric || typeof rubric !== 'object') {
    throw new Error('Invalid rubric config: expected object');
  }
  if (!rubric.rubricId || typeof rubric.rubricId !== 'string') {
    throw new Error('Invalid rubric config: rubricId is required');
  }
  if (!Array.isArray(rubric.criteria) || rubric.criteria.length === 0) {
    throw new Error('Invalid rubric config: criteria must be a non-empty array');
  }

  const seen = new Set();
  let totalWeight = 0;
  rubric.criteria.forEach((criterion) => {
    if (!criterion.id || typeof criterion.id !== 'string') {
      throw new Error('Invalid rubric config: criterion id is required');
    }
    if (seen.has(criterion.id)) {
      throw new Error(`Invalid rubric config: duplicate criterion '${criterion.id}'`);
    }
    seen.add(criterion.id);

    const weight = Number(criterion.weight);
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new Error(`Invalid rubric config: criterion '${criterion.id}' has invalid weight`);
    }
    totalWeight += weight;

    const minPassingScore = Number(criterion.minPassingScore || 3);
    if (!Number.isFinite(minPassingScore) || minPassingScore < 1 || minPassingScore > 5) {
      throw new Error(`Invalid rubric config: criterion '${criterion.id}' has invalid minPassingScore`);
    }
  });

  if (Math.abs(totalWeight - 1) > 0.001) {
    throw new Error(`Invalid rubric config: weights must sum to 1.0 (got ${totalWeight.toFixed(3)})`);
  }

  return rubric;
}

function parseRubricScores(input) {
  if (input == null) return [];
  if (Array.isArray(input)) return input;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error('rubricScores must be an array');
    }
    return parsed;
  }
  throw new Error('rubricScores must be array or JSON string');
}

function normalizeRubricScores(rawScores, rubric = loadRubricConfig()) {
  const scores = parseRubricScores(rawScores);
  if (scores.length === 0) return [];

  const criterionMap = new Map(rubric.criteria.map((c) => [c.id, c]));
  return scores.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`rubricScores[${index}] must be an object`);
    }
    const criterion = String(item.criterion || '').trim();
    if (!criterionMap.has(criterion)) {
      throw new Error(`rubricScores[${index}] unknown criterion '${criterion}'`);
    }

    const score = Number(item.score);
    if (!Number.isFinite(score) || score < 1 || score > 5) {
      throw new Error(`rubricScores[${index}] score must be between 1 and 5`);
    }

    return {
      criterion,
      score,
      evidence: item.evidence ? String(item.evidence).trim() : '',
      judge: item.judge ? String(item.judge).trim() : 'unknown',
    };
  });
}

function groupByCriterion(scores) {
  const grouped = {};
  scores.forEach((scoreItem) => {
    if (!grouped[scoreItem.criterion]) grouped[scoreItem.criterion] = [];
    grouped[scoreItem.criterion].push(scoreItem);
  });
  return grouped;
}

function evaluateGuardrails(guardrails, rubric = loadRubricConfig()) {
  const input = guardrails && typeof guardrails === 'object' ? guardrails : {};
  const expected = Array.isArray(rubric.guardrails) ? rubric.guardrails : [];

  const status = {};
  const failed = [];
  expected.forEach((g) => {
    const value = input[g.key];
    const normalized = value === true ? true : value === false ? false : null;
    status[g.key] = normalized;
    if (normalized === false) failed.push(g.key);
  });

  return {
    status,
    failed,
  };
}

function evaluateJudgeAgreement(scoresByCriterion) {
  const disagreements = [];
  for (const [criterion, entries] of Object.entries(scoresByCriterion)) {
    if (entries.length < 2) continue;
    const values = entries.map((e) => e.score);
    const max = Math.max(...values);
    const min = Math.min(...values);
    if (max - min >= 2) {
      disagreements.push({
        criterion,
        max,
        min,
        judges: entries.map((e) => e.judge),
      });
    }
  }
  return disagreements;
}

function buildRubricEvaluation({ rubricScores, guardrails } = {}) {
  const rubric = loadRubricConfig();
  const normalizedScores = normalizeRubricScores(rubricScores, rubric);
  const scoresByCriterion = groupByCriterion(normalizedScores);
  const guardrailResult = evaluateGuardrails(guardrails, rubric);

  const criterionBreakdown = {};
  const failingCriteria = [];
  const missingEvidenceClaims = [];
  let weightedScore = 0;

  rubric.criteria.forEach((criterion) => {
    const entries = scoresByCriterion[criterion.id] || [];
    const avg = entries.length > 0
      ? entries.reduce((sum, item) => sum + item.score, 0) / entries.length
      : null;

    criterionBreakdown[criterion.id] = {
      averageScore: avg,
      minPassingScore: Number(criterion.minPassingScore || 3),
      judgeCount: entries.length,
      label: criterion.label || criterion.id,
    };

    if (avg != null) {
      weightedScore += (avg / 5) * Number(criterion.weight);
      if (avg < Number(criterion.minPassingScore || 3)) {
        failingCriteria.push(criterion.id);
      }
    }

    if (criterion.requiresEvidence && entries.some((entry) => entry.score >= 4 && !entry.evidence)) {
      missingEvidenceClaims.push(criterion.id);
    }
  });

  const judgeDisagreements = evaluateJudgeAgreement(scoresByCriterion);
  const blockReasons = [];
  if (failingCriteria.length > 0) blockReasons.push(`failing_criteria:${failingCriteria.join(',')}`);
  if (guardrailResult.failed.length > 0) blockReasons.push(`failed_guardrails:${guardrailResult.failed.join(',')}`);
  if (judgeDisagreements.length > 0) blockReasons.push('judge_disagreement');
  if (missingEvidenceClaims.length > 0) blockReasons.push(`missing_evidence:${missingEvidenceClaims.join(',')}`);

  return {
    rubricId: rubric.rubricId,
    rubricVersion: rubric.version || 1,
    weightedScore: Math.round(weightedScore * 1000) / 1000,
    criterionBreakdown,
    failingCriteria,
    guardrails: guardrailResult.status,
    failingGuardrails: guardrailResult.failed,
    judgeDisagreements,
    missingEvidenceClaims,
    promotionEligible: blockReasons.length === 0,
    blockReasons,
    rubricScores: normalizedScores,
  };
}

module.exports = {
  DEFAULT_RUBRIC_PATH,
  getRubricPath,
  loadRubricConfig,
  parseRubricScores,
  normalizeRubricScores,
  evaluateGuardrails,
  evaluateJudgeAgreement,
  buildRubricEvaluation,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const scoresArg = args.find((arg) => arg.startsWith('--scores='));
  const guardrailsArg = args.find((arg) => arg.startsWith('--guardrails='));

  if (!scoresArg) {
    console.log(JSON.stringify(loadRubricConfig(), null, 2));
    process.exit(0);
  }

  const scores = scoresArg.replace('--scores=', '');
  const guardrails = guardrailsArg ? JSON.parse(guardrailsArg.replace('--guardrails=', '')) : {};
  const result = buildRubricEvaluation({ rubricScores: scores, guardrails });
  console.log(JSON.stringify(result, null, 2));
}
