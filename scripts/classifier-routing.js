#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'gate-classifier-routing.json');

function clamp01(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(1, Math.max(0, number));
}

function riskRank(risk) {
  const normalized = String(risk || 'medium').toLowerCase();
  if (['critical', 'block', 'regulated'].includes(normalized)) return 4;
  if (['high', 'dangerous'].includes(normalized)) return 3;
  if (['medium', 'warn'].includes(normalized)) return 2;
  return 1;
}

function loadClassifierRoutingConfig(configPath = DEFAULT_CONFIG_PATH) {
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function lane(config, laneName, reason, input, overrides = {}) {
  const laneConfig = (config.lanes && config.lanes[laneName]) || {};
  return {
    lane: laneName,
    reason,
    requiresEvidence: Boolean(laneConfig.requiresEvidence || overrides.requiresEvidence),
    cloudAllowed: Boolean(laneConfig.cloudAllowed),
    maxLatencyMs: laneConfig.maxLatencyMs,
    risk: String(input.risk || 'medium').toLowerCase(),
    ambiguity: clamp01(input.ambiguity),
  };
}

function routeClassifier(input = {}, config = loadClassifierRoutingConfig()) {
  const thresholds = config.thresholds || {};
  const labelCount = Number(input.labelCount || input.examples || 0);
  const latencyBudgetMs = Number(input.latencyBudgetMs || 0);
  const ambiguity = clamp01(input.ambiguity);
  const risk = riskRank(input.risk);
  const largeBatch = Number(input.batchRows || 0) >= Number(thresholds.largeBatchRows || 50);
  const privacySensitive = Boolean(input.privacySensitive || input.containsSecrets || input.customerData);
  const allowCloud = Boolean(input.allowCloud);

  if (input.hasHardRule || input.exactPolicyMatch) {
    return lane(config, 'deterministic', 'exact hard rule or policy match; do not spend model tokens', input);
  }

  if (input.semanticCacheHit || input.equivalentRepeat) {
    return lane(config, 'semantic_cache', 'semantically equivalent repeat; reuse the proven prior decision without a model call', input);
  }

  if (input.rubricFailed || input.missingEvidence || input.completionClaimWithoutProof) {
    return lane(config, 'rubric_gate', 'rubric or completion evidence failed; block done claims until proof exists', input);
  }

  if (input.structuredDataset && (input.missingProvenance || input.missingSources)) {
    return lane(config, 'rubric_gate', 'structured data claim is missing source provenance', input);
  }

  if (privacySensitive && !allowCloud && risk >= 3 && ambiguity >= Number(thresholds.mediumAmbiguity || 0.35)) {
    return lane(config, 'human_review', 'private high-risk ambiguous action; keep data local and require approval', input);
  }

  if (labelCount >= Number(thresholds.classicalMinExamples || 40) && (largeBatch || latencyBudgetMs <= Number(thresholds.lowLatencyBudgetMs || 300)) && ambiguity < Number(thresholds.mediumAmbiguity || 0.35)) {
    return lane(config, 'local_classical', 'enough examples and low ambiguity; use cheap local classification', input);
  }

  if (risk >= 3 && ambiguity >= Number(thresholds.highRiskAmbiguity || 0.65)) {
    if (allowCloud && latencyBudgetMs >= Number(thresholds.llmMinLatencyBudgetMs || 2000)) {
      return lane(config, 'llm_judge', 'high-risk semantic ambiguity; use a budget-capped LLM judge with evidence', input);
    }
    return lane(config, 'human_review', 'high-risk ambiguity without approved cloud/budget route', input);
  }

  if (labelCount < Number(thresholds.classicalMinExamples || 40) || ambiguity >= Number(thresholds.mediumAmbiguity || 0.35)) {
    return lane(config, 'local_semantic', 'sparse labels or fuzzy intent; use local semantic recall before any LLM', input);
  }

  return lane(config, config.defaultLane || 'local_classical', 'default local route for routine gate classification', input);
}

function explainClassifierRoute(input = {}, config = loadClassifierRoutingConfig()) {
  const decision = routeClassifier(input, config);
  const laneConfig = (config.lanes && config.lanes[decision.lane]) || {};
  return {
    ...decision,
    description: laneConfig.description || '',
    useFor: laneConfig.useFor || [],
  };
}

function parseArgs(argv) {
  const input = {};
  for (const arg of argv) {
    if (arg === '--hard-rule') input.hasHardRule = true;
    else if (arg === '--privacy-sensitive') input.privacySensitive = true;
    else if (arg === '--allow-cloud') input.allowCloud = true;
    else if (arg === '--customer-data') input.customerData = true;
    else if (arg === '--semantic-cache-hit') input.semanticCacheHit = true;
    else if (arg === '--equivalent-repeat') input.equivalentRepeat = true;
    else if (arg === '--rubric-failed') input.rubricFailed = true;
    else if (arg === '--missing-evidence') input.missingEvidence = true;
    else if (arg === '--structured-dataset') input.structuredDataset = true;
    else if (arg === '--missing-provenance') input.missingProvenance = true;
    else if (arg.startsWith('--risk=')) input.risk = arg.slice('--risk='.length);
    else if (arg.startsWith('--ambiguity=')) input.ambiguity = Number(arg.slice('--ambiguity='.length));
    else if (arg.startsWith('--labels=')) input.labelCount = Number(arg.slice('--labels='.length));
    else if (arg.startsWith('--latency-ms=')) input.latencyBudgetMs = Number(arg.slice('--latency-ms='.length));
    else if (arg.startsWith('--batch-rows=')) input.batchRows = Number(arg.slice('--batch-rows='.length));
  }
  return input;
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  explainClassifierRoute,
  loadClassifierRoutingConfig,
  routeClassifier,
};

if (require.main === module) {
  const decision = explainClassifierRoute(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
}
