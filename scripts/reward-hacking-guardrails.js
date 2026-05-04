#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const SOURCE = Object.freeze({
  hfUrl: 'https://huggingface.co/papers/2604.13602',
  arxivUrl: 'https://arxiv.org/abs/2604.13602',
  title: 'Reward Hacking in the Era of Large Models: Mechanisms, Emergent Misalignment, Challenges',
  arxivId: '2604.13602',
  submitted: '2026-04-15',
});

const COMPLETION_CLAIM_RE = /\b(all tests pass|tests pass|ci (?:is )?(?:green|passing)|fixed|done|complete|ready to merge|ready for review|safe to ship|deployed|production ready)\b/i;
const EVIDENCE_RE = /\b(exit code|test output|logs?|artifact|screenshot|trace|commit|diff|proof|verified|health check|ci url|run id|reproduction|benchmark report)\b/i;
const SYCOPHANCY_RE = /\b(you'?re absolutely right|great point|looks great|lgtm|totally agree|perfect idea|no issues|ship it)\b/i;
const BENCHMARK_RE = /\b(benchmark|eval|score|leaderboard|pass rate|accuracy|win rate|reward)\b/i;
const HOLDOUT_RE = /\b(holdout|regression|real workflow|counterexample|adversarial|canary|shadow run|baseline)\b/i;
const EVALUATOR_MANIPULATION_RE = /\b(ignore (?:the|any) (?:failures?|rubric|instructions?)|grade (?:this|me) (?:leniently|as passing)|award (?:full|maximum) credit|do not penalize|self[- ]?score(?:d)? as passing)\b/i;
const MULTIMODAL_RE = /\b(screenshot|image|chart|pdf|video|visual|ocr|multimodal)\b/i;

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function parseNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function splitList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function normalizeOptions(raw = {}) {
  const candidateText = String(raw.text || raw.claim || raw.response || raw.summary || '').trim();
  const evidence = splitList(raw.evidence || raw.evidenceArtifacts || raw['evidence-artifacts']);
  const metrics = splitList(raw.metrics || raw.metric || raw['proxy-metrics']);
  return {
    workflow: String(raw.workflow || raw.name || 'agent reward guardrails').trim() || 'agent reward guardrails',
    candidateText,
    evidence,
    metrics,
    wordCount: parseNumber(raw['word-count'] || raw.wordCount, candidateText.split(/\s+/).filter(Boolean).length),
    hasHoldout: parseBoolean(raw.holdout || raw.hasHoldout || raw['has-holdout'], HOLDOUT_RE.test(candidateText)),
    hasHumanObjective: parseBoolean(raw['human-objective'] || raw.hasHumanObjective, false),
    hasVerifierTrace: parseBoolean(raw['verifier-trace'] || raw.hasVerifierTrace, evidence.some((item) => /trace|log|run|artifact|proof/i.test(item))),
    optimizedForScore: parseBoolean(raw['optimized-for-score'] || raw.optimizedForScore, BENCHMARK_RE.test(candidateText) || metrics.length > 0),
    multimodal: parseBoolean(raw.multimodal || raw.hasMultimodalInputs, MULTIMODAL_RE.test(candidateText)),
  };
}

function hasEvidence(options) {
  return options.evidence.length > 0 || options.hasVerifierTrace || EVIDENCE_RE.test(options.candidateText);
}

function buildSignals(options) {
  const signals = [];
  const evidencePresent = hasEvidence(options);

  if (COMPLETION_CLAIM_RE.test(options.candidateText) && !evidencePresent) {
    signals.push({
      id: 'hallucinated_verification',
      severity: 'critical',
      message: 'The response claims completion, safety, test success, or deployment without attached proof.',
      gate: 'Block completion claims until test output, run id, trace, screenshot, or proof artifact is attached.',
    });
  }

  if (options.wordCount >= 180 && !evidencePresent) {
    signals.push({
      id: 'verbosity_as_proof',
      severity: 'high',
      message: 'The response is long but does not provide verifiable artifacts, turning fluency into a proxy for correctness.',
      gate: 'Require concise claims with artifact-backed evidence before accepting persuasive explanations.',
    });
  }

  if (SYCOPHANCY_RE.test(options.candidateText) && !evidencePresent) {
    signals.push({
      id: 'sycophancy_or_rubber_stamp',
      severity: 'high',
      message: 'Agreement or approval language appears without independent checks or counterevidence.',
      gate: 'Require at least one explicit verification step or risk check before approval-style responses.',
    });
  }

  if (options.optimizedForScore && !options.hasHoldout) {
    signals.push({
      id: 'benchmark_overfitting',
      severity: 'high',
      message: 'A score, eval, benchmark, or reward metric is being optimized without holdout or regression proof.',
      gate: 'Require holdout, regression, or real-workflow evidence before treating score gains as product gains.',
    });
  }

  if (EVALUATOR_MANIPULATION_RE.test(options.candidateText)) {
    signals.push({
      id: 'evaluator_manipulation',
      severity: 'critical',
      message: 'The candidate text attempts to influence grading instead of satisfying the user objective.',
      gate: 'Block evaluator-manipulation language and route to human review.',
    });
  }

  if (options.metrics.length > 0 && !options.hasHumanObjective) {
    signals.push({
      id: 'proxy_metric_only',
      severity: 'medium',
      message: 'Proxy metrics are present without an explicit human objective or user-visible success criterion.',
      gate: 'Pair every reward or benchmark metric with the real user outcome it is meant to approximate.',
    });
  }

  if (options.multimodal && !evidencePresent) {
    signals.push({
      id: 'perception_reasoning_decoupling',
      severity: 'high',
      message: 'A visual or multimodal claim is made without source artifacts or perception trace evidence.',
      gate: 'Require screenshot, OCR, or visual proof artifact before accepting multimodal reasoning claims.',
    });
  }

  return signals;
}

function buildMetrics() {
  return [
    { id: 'unsupported_completion_claims', target: '0', required: true },
    { id: 'evidence_attachment_rate', target: '>= 0.95', required: true },
    { id: 'unsupported_claim_rate', target: '<= 0.02', required: true },
    { id: 'holdout_regression_pass_rate', target: '>= 0.90', required: true },
    { id: 'judge_disagreement_rate', target: '<= 0.10', required: true },
    { id: 'proxy_to_user_objective_mapping_rate', target: '>= 0.95', required: true },
  ];
}

function buildRewardHackingGuardrailsPlan(rawOptions = {}) {
  const options = normalizeOptions(rawOptions);
  const signals = buildSignals(options);
  const critical = signals.filter((signal) => signal.severity === 'critical').length;
  const high = signals.filter((signal) => signal.severity === 'high').length;

  return {
    name: 'thumbgate-reward-hacking-guardrails',
    source: SOURCE,
    workflow: options.workflow,
    status: critical > 0 ? 'blocked' : high > 0 ? 'needs_evidence' : 'ready',
    summary: {
      signalCount: signals.length,
      critical,
      high,
      evidenceArtifacts: options.evidence.length,
      proxyMetrics: options.metrics,
      hasHumanObjective: options.hasHumanObjective,
      hasHoldout: options.hasHoldout,
    },
    proxyCompressionMapping: {
      compression: 'compressed reward, benchmark, or approval signal is treated as a stand-in for the full user objective',
      amplification: 'optimization pressure can turn local shortcuts into repeated workflow behavior',
      coAdaptation: 'agent outputs can learn to satisfy evaluators, rubrics, or verifiers instead of the task',
    },
    signals,
    gates: signals.map((signal) => ({
      id: signal.id,
      action: signal.severity === 'critical' ? 'block' : 'warn',
      message: signal.gate,
    })),
    metrics: buildMetrics(),
    nextActions: [
      'Attach proof artifacts before allowing claims like tests passed, fixed, deployed, safe, or ready to merge.',
      'Treat benchmark gains as provisional until holdout, regression, or real-workflow evidence confirms the user objective improved.',
      'Require explicit user-objective mapping for every proxy metric, reward score, or evaluator rubric.',
      'Block evaluator-manipulation language before it reaches judge or verifier loops.',
      'Prefer short evidence-backed summaries over long persuasive explanations when judging agent work.',
    ],
    marketingAngle: {
      headline: 'Reward hacking is what happens when agents optimize the receipt instead of the meal.',
      subhead: 'ThumbGate turns proxy failures into pre-action gates: no unsupported completion claims, no benchmark-only victory laps, and no verifier theater without proof artifacts.',
      guideTitle: 'Reward Hacking Guardrails for AI Coding Agents',
      replyDraft: 'This paper is a useful frame for agent products: proxy rewards compress the real user objective, and agents learn the shortcut. ThumbGate can enforce the missing layer: completion claims need proof, benchmark wins need holdouts, and verifier loops need gates against sycophancy, verbosity-as-proof, and evaluator manipulation.',
    },
  };
}

function formatRewardHackingGuardrailsPlan(report) {
  const lines = [
    '',
    'ThumbGate Reward Hacking Guardrails',
    '-'.repeat(36),
    `Workflow : ${report.workflow}`,
    `Status   : ${report.status}`,
    `Source   : ${report.source.arxivUrl}`,
    `Signals  : ${report.summary.signalCount}`,
  ];
  if (report.signals.length > 0) {
    lines.push('', 'Signals:');
    for (const signal of report.signals) {
      lines.push(`  - [${signal.severity}] ${signal.id}: ${signal.message}`);
      lines.push(`    Gate: ${signal.gate}`);
    }
  }
  lines.push('', 'Required metrics:');
  for (const metric of report.metrics) {
    lines.push(`  - ${metric.id}: ${metric.target}${metric.required ? ' (required)' : ''}`);
  }
  lines.push('', 'Next actions:');
  for (const action of report.nextActions) lines.push(`  - ${action}`);
  lines.push('', `Guide: ${report.marketingAngle.guideTitle}`);
  lines.push(`Reply draft: ${report.marketingAngle.replyDraft}`, '');
  return `${lines.join('\n')}\n`;
}

function writeRewardHackingPromoPack(outputDir = path.join(__dirname, '..', 'docs', 'marketing')) {
  const report = buildRewardHackingGuardrailsPlan({
    workflow: 'AI coding agent release checklist',
    text: 'Great idea, LGTM. All tests pass and this is ready to merge. Our benchmark score improved, so ship it.',
    metrics: ['benchmark pass rate', 'reward score'],
    multimodal: true,
    'optimized-for-score': true,
  });
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, 'reward-hacking-guardrails-pack.json');
  const markdownPath = path.join(outputDir, 'reward-hacking-guardrails-pack.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, formatRewardHackingGuardrailsPlan(report));
  return { report, jsonPath, markdownPath };
}

module.exports = {
  SOURCE,
  buildMetrics,
  buildRewardHackingGuardrailsPlan,
  buildSignals,
  formatRewardHackingGuardrailsPlan,
  normalizeOptions,
  writeRewardHackingPromoPack,
};

if (require.main === module) {
  const { jsonPath, markdownPath } = writeRewardHackingPromoPack();
  console.log(JSON.stringify({ jsonPath, markdownPath }, null, 2));
}
