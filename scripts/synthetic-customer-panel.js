#!/usr/bin/env node
'use strict';

/**
 * Narrow behavioral simulation for ONE conversion decision.
 *
 * Process steal from Simile-style work (and the 2026-08 discussion that
 * pointed at it): do not build a digital twin of everyone. Simulate one
 * intervention × one population × one measurable outcome, rank concrete
 * alternatives, and refuse to treat the ranking as observed lift.
 *
 * Complementary to PR #3647's evaluateBehavioralSimulation hypothesis
 * gate — this file is the actual 10×3 scenario runner. Do not dual-edit
 * scripts/knowledge-layer-plan.js.
 *
 * The scorer is a labeled heuristic, not a trained model. Fine-tune only
 * after holdout ranking is measured.
 */

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 'thumbgate.synthetic-customer-panel.v1';
const ACTION_SPACE = Object.freeze(['opt_in', 'compare', 'bookmark', 'object', 'bounce']);
const REQUIRED_PERSONA_FIELDS = Object.freeze([
  'id',
  'name',
  'background',
  'goals',
  'currentContext',
  'constraints',
  'purchaseTriggers',
  'objections',
  'historicalActions',
  'preferences',
  'statedBeliefs',
  'observedVsStated',
  'likelyResponseByOffer',
  'weights',
  'biases',
  'actionSpace',
  'memory',
  'evidenceIds',
]);
const WEIGHT_KEYS = Object.freeze([
  'costProof',
  'riskReversal',
  'socialProof',
  'timeToValue',
  'evidenceDensity',
  'priceClarity',
]);
const DEFAULT_PANEL_PATH = path.join(
  __dirname,
  '..',
  'evals',
  'synthetic-customer-panel',
  'panel.json',
);
const MINIMUM_PERSONAS = 5;
const MINIMUM_VARIANTS = 2;
const MINIMUM_HOLDOUT_PAIRS = 5;
const MINIMUM_HOLDOUT_ACCURACY = 0.7;
const TRAFFIC_SPLIT = Object.freeze({ min: 0.1, max: 0.2 });

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function round4(value) {
  return Number(clamp01(value).toFixed(4));
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function evidenceById(panel) {
  const map = new Map();
  for (const row of asArray(panel.evidence)) {
    if (row && row.id) map.set(row.id, row);
  }
  return map;
}

function validatePanel(panel) {
  const issues = [];
  if (!panel || typeof panel !== 'object') {
    return { ok: false, issues: ['missing_panel'] };
  }
  const decision = panel.decision || {};
  if (!decision.intervention) issues.push('missing_intervention');
  if (!decision.population) issues.push('missing_population');
  if (!decision.outcomeMetric) issues.push('missing_outcome_metric');

  const personas = asArray(panel.personas);
  const variants = asArray(panel.variants);
  const evidence = evidenceById(panel);
  if (personas.length < MINIMUM_PERSONAS) issues.push('insufficient_personas');
  if (variants.length < MINIMUM_VARIANTS) issues.push('insufficient_variants');

  const personaIds = new Set();
  for (const persona of personas) {
    if (!persona || !persona.id) {
      issues.push('persona_missing_id');
      continue;
    }
    if (personaIds.has(persona.id)) issues.push(`duplicate_persona:${persona.id}`);
    personaIds.add(persona.id);
    for (const field of REQUIRED_PERSONA_FIELDS) {
      if (persona[field] === undefined || persona[field] === null || persona[field] === '') {
        issues.push(`persona_missing_${field}:${persona.id}`);
      }
    }
    const actions = asArray(persona.actionSpace);
    if (ACTION_SPACE.some((action) => !actions.includes(action))) {
      issues.push(`persona_narrow_action_space:${persona.id}`);
    }
    const observed = asArray(persona.evidenceIds)
      .map((id) => evidence.get(id))
      .filter((row) => row && row.kind === 'observed' && row.sourceId && (row.observedAt || row.timestamp));
    if (observed.length === 0) issues.push(`persona_missing_observed_evidence:${persona.id}`);
  }

  const variantIds = new Set();
  for (const variant of variants) {
    if (!variant || !variant.id) {
      issues.push('variant_missing_id');
      continue;
    }
    if (variantIds.has(variant.id)) issues.push(`duplicate_variant:${variant.id}`);
    variantIds.add(variant.id);
    if (!variant.headline || !variant.cta) issues.push(`variant_missing_copy:${variant.id}`);
    const attributes = variant.attributes || {};
    for (const key of WEIGHT_KEYS) {
      if (!Number.isFinite(Number(attributes[key]))) {
        issues.push(`variant_missing_attribute:${variant.id}:${key}`);
      }
    }
  }

  const contextCheck = collectContexts(panel.contexts);
  issues.push(...contextCheck.issues);

  return { ok: issues.length === 0, issues, personaIds, variantIds };
}

function collectContexts(raw) {
  const issues = [];
  const ids = new Set();
  const valid = [];
  for (const context of asArray(raw)) {
    if (!context || typeof context !== 'object' || Array.isArray(context) || !context.id) {
      issues.push('context_invalid');
      continue;
    }
    if (ids.has(context.id)) {
      issues.push(`duplicate_context:${context.id}`);
      continue;
    }
    ids.add(context.id);
    valid.push(context);
  }
  if (valid.length === 0) issues.push('missing_contexts');
  return { valid, issues };
}

function retrieveEvidence(persona, panel, limit = 5) {
  const catalog = evidenceById(panel);
  const selected = [];
  for (const id of asArray(persona.evidenceIds)) {
    const row = catalog.get(id);
    if (row) selected.push(row);
  }
  const tags = new Set(asArray(persona.tags));
  if (selected.length < limit) {
    for (const row of asArray(panel.evidence)) {
      if (selected.some((item) => item.id === row.id)) continue;
      const overlap = asArray(row.tags).some((tag) => tags.has(tag));
      if (overlap) selected.push(row);
      if (selected.length >= limit) break;
    }
  }
  return selected.slice(0, limit).map((row) => ({
    id: row.id,
    kind: row.kind,
    sourceId: row.sourceId,
    sourceUrl: row.sourceUrl || null,
    observedAt: row.observedAt || row.timestamp || null,
    quote: row.quote || null,
  }));
}

function contextBoost(contextId, attributes) {
  if (contextId === 'comparison_page') return 0.16 * clamp01(attributes.comparisonFriendly);
  if (contextId === 'pricing_page') return 0.14 * clamp01(attributes.priceClarity);
  if (contextId === 'ad_click') return 0.1 * clamp01(attributes.timeToValue);
  return 0;
}

function scorePersonaVariant(persona, variant, contextId) {
  const weights = persona.weights || {};
  const attributes = variant.attributes || {};
  const biases = persona.biases || {};
  let raw = 0;
  let denom = 0;
  for (const key of WEIGHT_KEYS) {
    const weight = clamp01(weights[key]);
    raw += weight * clamp01(attributes[key]);
    denom += weight;
  }
  let score = denom > 0 ? raw / denom : 0;
  score -= clamp01(weights.hypeAllergy) * clamp01(attributes.hype) * 0.55;
  if (clamp01(weights.costProof) >= 0.85) {
    score += 0.18 * clamp01(attributes.costProof);
  }
  score -= clamp01(biases.statusQuo) * 0.12;
  score -= clamp01(biases.comparisonShopping) * (1 - clamp01(attributes.comparisonFriendly)) * 0.12;
  score -= clamp01(biases.timePoverty) * (1 - clamp01(attributes.timeToValue)) * 0.32;
  score -= clamp01(biases.socialProofNeed) * (1 - clamp01(attributes.socialProof)) * 0.14;
  score -= clamp01(biases.overclaimAllergy) * clamp01(attributes.hype) * 0.35;
  score -= clamp01(biases.priceSensitivity) * (1 - clamp01(attributes.priceClarity)) * 0.12;
  score += contextBoost(contextId, attributes);
  return round4(score);
}

function chooseAction(score, persona, variant) {
  const biases = persona.biases || {};
  const allowed = asArray(persona.actionSpace).filter((action) => ACTION_SPACE.includes(action));
  const pick = (action) => (allowed.includes(action) ? action : allowed[0] || 'bounce');
  if (score < 0.34) return pick('bounce');
  if (clamp01(biases.overclaimAllergy) >= 0.85 && clamp01((variant.attributes || {}).hype) >= 0.45) {
    return pick('object');
  }
  if (score < 0.48) return pick('object');
  if (clamp01(biases.comparisonShopping) >= 0.7 && score < 0.78) return pick('compare');
  if (clamp01(biases.statusQuo) >= 0.7 && score < 0.72) return pick('bookmark');
  if (score >= 0.58) return pick('opt_in');
  if (clamp01(biases.comparisonShopping) >= 0.4) return pick('compare');
  return pick('bookmark');
}

function confidenceFor(score, evidenceCount) {
  return round4(0.35 + 0.4 * score + 0.05 * Math.min(3, evidenceCount));
}

function reasonFor(persona, variant, action, evidence) {
  const bits = [];
  if (action === 'opt_in') bits.push(`${variant.id} lowers the next-action cost enough to try doctor`);
  if (action === 'compare') bits.push(`${persona.id} will keep comparing because perceived risk is still high`);
  if (action === 'object') bits.push(`${persona.id} objects: ${asArray(persona.objections)[0] || 'unverified claim'}`);
  if (action === 'bounce') bits.push(`${variant.id} does not clear ${persona.id}'s constraint`);
  if (action === 'bookmark') bits.push(`${persona.id} delays; status-quo bias still wins`);
  const source = evidence[0] ? evidence[0].sourceId : 'no-source';
  bits.push(`retrieved ${source}`);
  return bits.join('; ');
}

function stepAgent(persona, variant, context, panel) {
  const evidence = retrieveEvidence(persona, panel);
  const memory = [...asArray(persona.memory), `saw:${variant.id}@${context.id}`];
  const score = scorePersonaVariant(persona, variant, context.id);
  const action = chooseAction(score, persona, variant);
  const likely = (persona.likelyResponseByOffer || {})[variant.id] || null;
  return {
    personaId: persona.id,
    variantId: variant.id,
    contextId: context.id,
    score,
    action,
    nextAction: action === 'opt_in' ? 'run_doctor' : action === 'compare' ? 'open_compare' : 'leave',
    confidence: confidenceFor(score, evidence.length),
    objections: asArray(persona.objections).slice(0, 2),
    reasoning: reasonFor(persona, variant, action, evidence),
    likelyResponse: likely,
    evidence,
    memory,
    goals: asArray(persona.goals),
    environment: {
      contextId: context.id,
      headline: variant.headline,
      cta: variant.cta,
      sourceUrl: variant.sourceUrl || null,
    },
  };
}

function runScenarios(panel, options = {}) {
  const source = options.contexts !== undefined ? options.contexts : panel.contexts;
  const contexts = collectContexts(source).valid;
  const runs = [];
  for (const persona of asArray(panel.personas)) {
    for (const variant of asArray(panel.variants)) {
      for (const context of contexts) {
        runs.push(stepAgent(persona, variant, context, panel));
      }
    }
  }
  return runs;
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rankVariants(panel, runs) {
  const byVariant = new Map();
  for (const variant of asArray(panel.variants)) {
    byVariant.set(variant.id, {
      variantId: variant.id,
      name: variant.name,
      riskReversal: variant.riskReversal || null,
      scores: [],
      optIns: 0,
      actions: 0,
    });
  }
  for (const run of runs) {
    const row = byVariant.get(run.variantId);
    if (!row) continue;
    row.scores.push(run.score);
    row.actions += 1;
    if (run.action === 'opt_in') row.optIns += 1;
  }
  const ranked = [...byVariant.values()]
    .map((row) => ({
      variantId: row.variantId,
      name: row.name,
      riskReversal: row.riskReversal,
      meanScore: round4(mean(row.scores)),
      optInRate: row.actions ? round4(row.optIns / row.actions) : 0,
      modeledNotMeasured: true,
    }))
    .sort((left, right) => {
      if (right.meanScore !== left.meanScore) return right.meanScore - left.meanScore;
      return left.variantId.localeCompare(right.variantId);
    });
  return ranked.map((row, index) => ({ ...row, rank: index + 1 }));
}

function segmentWinners(panel, runs) {
  const segments = [];
  for (const persona of asArray(panel.personas)) {
    const scores = new Map();
    for (const run of runs) {
      if (run.personaId !== persona.id) continue;
      const current = scores.get(run.variantId) || [];
      current.push(run.score);
      scores.set(run.variantId, current);
    }
    const ordered = [...scores.entries()]
      .map(([variantId, values]) => ({ variantId, meanScore: mean(values) }))
      .sort((left, right) => right.meanScore - left.meanScore);
    const winner = ordered[0];
    if (!winner) continue;
    const variant = asArray(panel.variants).find((item) => item.id === winner.variantId);
    segments.push({
      personaId: persona.id,
      predictedVariantId: winner.variantId,
      meanScore: round4(winner.meanScore),
      because: variant
        ? variant.riskReversal || variant.headline
        : 'highest heuristic affinity',
      biases: persona.biases,
    });
  }
  return segments;
}

function observationKey(row) {
  return `${row.personaId}:${row.variantId}`;
}

function pairwiseAccuracy(predictions, observations, personaFilter = null) {
  const predictionMap = new Map();
  for (const row of predictions) {
    if (personaFilter && !personaFilter.has(row.personaId)) continue;
    predictionMap.set(observationKey(row), Number(row.score));
  }
  const observationMap = new Map();
  for (const row of observations) {
    if (personaFilter && !personaFilter.has(row.personaId)) continue;
    observationMap.set(observationKey(row), Number(row.outcome));
  }
  const personaIds = [...new Set([...predictionMap.keys(), ...observationMap.keys()]
    .map((key) => key.split(':')[0]))];
  const variantIds = [...new Set([...predictionMap.keys(), ...observationMap.keys()]
    .map((key) => key.split(':')[1]))];
  let total = 0;
  let correct = 0;
  const mismatches = [];
  for (const personaId of personaIds) {
    for (let i = 0; i < variantIds.length; i += 1) {
      for (let j = i + 1; j < variantIds.length; j += 1) {
        const leftKey = `${personaId}:${variantIds[i]}`;
        const rightKey = `${personaId}:${variantIds[j]}`;
        if (!predictionMap.has(leftKey) || !predictionMap.has(rightKey)) continue;
        if (!observationMap.has(leftKey) || !observationMap.has(rightKey)) continue;
        const predicted = Math.sign(predictionMap.get(leftKey) - predictionMap.get(rightKey));
        const observed = Math.sign(observationMap.get(leftKey) - observationMap.get(rightKey));
        if (predicted === 0 || observed === 0) continue;
        total += 1;
        if (predicted === observed) correct += 1;
        else {
          mismatches.push({
            personaId,
            predictedWinner: predicted > 0 ? variantIds[i] : variantIds[j],
            observedWinner: observed > 0 ? variantIds[i] : variantIds[j],
          });
        }
      }
    }
  }
  return {
    total,
    correct,
    accuracy: total ? Number((correct / total).toFixed(4)) : null,
    mismatches,
  };
}

function meanScorePredictions(runs) {
  const buckets = new Map();
  for (const run of runs) {
    const key = `${run.personaId}:${run.variantId}`;
    const current = buckets.get(key) || { personaId: run.personaId, variantId: run.variantId, scores: [] };
    current.scores.push(run.score);
    buckets.set(key, current);
  }
  return [...buckets.values()].map((row) => ({
    personaId: row.personaId,
    variantId: row.variantId,
    score: mean(row.scores),
  }));
}

function evaluateHoldout(panel, runs, options = {}) {
  const observations = asArray(options.observations || panel.observations);
  const observed = observations.filter((row) => row && row.kind === 'observed');
  const fixtures = observations.filter((row) => row && row.kind === 'fixture');
  const usable = observed.length ? observed : fixtures;
  const holdoutIds = asArray(options.holdoutPersonaIds || panel.holdoutPersonaIds)
    .filter(Boolean);
  const holdoutSet = new Set(holdoutIds);
  const predictions = meanScorePredictions(runs);
  const overall = pairwiseAccuracy(predictions, usable);
  const holdout = holdoutIds.length
    ? pairwiseAccuracy(predictions, usable, holdoutSet)
    : { total: 0, correct: 0, accuracy: null, mismatches: [] };
  const livePromotionAllowed = holdoutIds.length > 0
    && observed.length > 0
    && holdout.total >= MINIMUM_HOLDOUT_PAIRS
    && holdout.accuracy !== null
    && holdout.accuracy >= MINIMUM_HOLDOUT_ACCURACY;
  return {
    observationCount: observations.length,
    observedCount: observed.length,
    fixtureCount: fixtures.length,
    overallPairwiseAccuracy: overall.accuracy,
    holdoutPairs: holdout.total,
    holdoutPairwiseAccuracy: holdout.accuracy,
    minimumHoldoutPairs: MINIMUM_HOLDOUT_PAIRS,
    minimumAccuracy: MINIMUM_HOLDOUT_ACCURACY,
    mismatches: holdout.mismatches,
    livePromotionAllowed,
    evidenceGrade: livePromotionAllowed ? 'holdout_ranking_passed' : 'modeledNotMeasured',
  };
}

function buildRecommendation(panel, ranked, segments, evaluation) {
  const top = ranked[0];
  const second = ranked[1];
  const supporting = segments.filter((row) => row.predictedVariantId === (top && top.variantId));
  const segmentNames = supporting.map((row) => row.personaId);
  const because = top && top.riskReversal
    ? `${top.riskReversal[0].toLowerCase()}${top.riskReversal.slice(1)}`
    : 'it scored highest on the labeled heuristic';
  const who = segmentNames.length
    ? segmentNames.slice(0, 3).join(', ')
    : 'the configured personas';
  const split = second
    ? `validate with a ${Math.round(TRAFFIC_SPLIT.min * 100)}–${Math.round(TRAFFIC_SPLIT.max * 100)}% traffic split of ${top.variantId} vs ${second.variantId}`
    : 'validate with a holdout before any traffic split';
  const hypothesis = top
    ? `${top.name} is predicted to work for ${who} because ${because}; ${split}. Simulated ranking is modeledNotMeasured until observed holdout rankings meet the threshold.`
    : 'No variant ranked.';
  return {
    hypothesis,
    predictedTop: top ? top.variantId : null,
    challenger: second ? second.variantId : null,
    supportingPersonas: segmentNames,
    liveExperiment: {
      status: evaluation.livePromotionAllowed ? 'holdout_passed_still_needs_monitored_rollout' : 'recommended_not_launched',
      outcomeMetric: panel.decision.outcomeMetric,
      trafficSplit: TRAFFIC_SPLIT,
      variants: [top && top.variantId, second && second.variantId].filter(Boolean),
    },
    claimBoundary: evaluation.livePromotionAllowed
      ? 'The simulated ranking matched the configured holdout threshold; deployment still requires a monitored traffic split. This is not observed conversion lift.'
      : 'Simulation output is a hypothesis, not observed conversion lift or a production winner.',
  };
}

function ingestObservations(rows, options = {}) {
  const allowFixture = options.allowFixture === true;
  const ingested = [];
  for (const row of asArray(rows)) {
    if (!row || !row.personaId || !row.variantId) {
      throw new Error('observation requires personaId and variantId');
    }
    if (!Number.isFinite(Number(row.outcome))) {
      throw new Error(`observation outcome must be numeric for ${row.personaId}:${row.variantId}`);
    }
    const kind = row.kind;
    if (kind !== 'observed' && !(allowFixture && kind === 'fixture')) {
      throw new Error(`refusing ${kind || 'unlabeled'} observation; pass kind=observed or allowFixture for tests`);
    }
    ingested.push({
      personaId: row.personaId,
      variantId: row.variantId,
      outcome: Number(row.outcome),
      kind,
      sourceId: row.sourceId || null,
      observedAt: row.observedAt || row.timestamp || null,
    });
  }
  return ingested;
}

function runPanel(panel, options = {}) {
  const validation = validatePanel(panel);
  const runs = validation.ok ? runScenarios(panel, options) : [];
  const ranked = rankVariants(panel, runs);
  const segments = segmentWinners(panel, runs);
  const observations = options.observations
    ? ingestObservations(options.observations, { allowFixture: options.allowFixture === true })
    : asArray(panel.observations);
  const evaluation = evaluateHoldout({ ...panel, observations }, runs, options);
  const recommendation = buildRecommendation(panel, ranked, segments, evaluation);
  return {
    schemaVersion: SCHEMA_VERSION,
    scoring: 'labeled_heuristic_not_a_trained_model',
    decision: panel.decision,
    validation,
    runDecision: validation.ok ? 'allow' : 'deny',
    deploymentDecision: evaluation.livePromotionAllowed ? 'allow' : 'deny',
    modeledNotMeasured: evaluation.evidenceGrade === 'modeledNotMeasured',
    ranked,
    segments,
    runs,
    evaluation,
    recommendation,
    fineTune: {
      allowed: false,
      reason: 'Prototype with retrieved public evidence plus a heuristic. Fine-tune only after holdout mismatches accumulate from randomized traffic splits.',
    },
  };
}

function loadPanel(filePath = DEFAULT_PANEL_PATH) {
  return loadJson(filePath);
}

function formatText(result) {
  const lines = [];
  lines.push(`decision: ${result.decision.intervention} → ${result.decision.outcomeMetric}`);
  lines.push(`run: ${result.runDecision}  deploy: ${result.deploymentDecision}  grade: ${result.evaluation.evidenceGrade}`);
  lines.push('ranking (heuristic, modeledNotMeasured unless holdout passed):');
  for (const row of result.ranked) {
    lines.push(`  ${row.rank}. ${row.variantId}  score=${row.meanScore}  opt_in=${row.optInRate}`);
  }
  lines.push(result.recommendation.hypothesis);
  lines.push(result.recommendation.claimBoundary);
  if (result.evaluation.mismatches.length) {
    lines.push(`mismatches logged: ${result.evaluation.mismatches.length}`);
  }
  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const options = { json: false, panelPath: DEFAULT_PANEL_PATH, observationsPath: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--panel') options.panelPath = argv[i + 1];
    else if (arg.startsWith('--panel=')) options.panelPath = arg.slice('--panel='.length);
    else if (arg === '--observations') options.observationsPath = argv[i + 1];
    else if (arg.startsWith('--observations=')) options.observationsPath = arg.slice('--observations='.length);
  }
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const panel = loadPanel(options.panelPath);
  const extra = {};
  if (options.observationsPath) {
    extra.observations = loadJson(options.observationsPath);
    extra.allowFixture = true;
  }
  const result = runPanel(panel, extra);
  if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(formatText(result));
  return result.runDecision === 'allow' ? 0 : 2;
}

module.exports = {
  ACTION_SPACE,
  DEFAULT_PANEL_PATH,
  MINIMUM_HOLDOUT_ACCURACY,
  MINIMUM_HOLDOUT_PAIRS,
  SCHEMA_VERSION,
  TRAFFIC_SPLIT,
  chooseAction,
  evaluateHoldout,
  formatText,
  ingestObservations,
  loadPanel,
  main,
  pairwiseAccuracy,
  rankVariants,
  retrieveEvidence,
  runPanel,
  runScenarios,
  scorePersonaVariant,
  stepAgent,
  validatePanel,
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
