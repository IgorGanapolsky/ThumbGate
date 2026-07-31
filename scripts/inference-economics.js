#!/usr/bin/env node
'use strict';

function estimateDifficulty(input = {}) {
  let score = 0;
  const text = String(input.task || input.prompt || '');
  if (text.length > 1200) score += 20;
  if (/ambiguous|research|architecture|security|production|migration|legal|financial/i.test(text)) score += 25;
  if (Number(input.dollarImpact || 0) >= 1000) score += 25;
  if (Array.isArray(input.files) && input.files.length > 5) score += 15;
  if (input.requiresHumanApproval === true) score += 15;
  return Math.max(0, Math.min(100, score));
}

function planInferenceBudget(input = {}) {
  const difficulty = Number.isFinite(input.difficulty) ? input.difficulty : estimateDifficulty(input);
  const maxCostCents = Number.isFinite(Number(input.maxCostCents)) ? Number(input.maxCostCents) : 50;
  let depth = 'shallow';
  let reasoningEffort = 'low';
  let parallelCandidates = 1;
  let humanHandoff = false;

  if (difficulty >= 70) {
    depth = 'deep';
    reasoningEffort = 'high';
    parallelCandidates = 4;
    humanHandoff = true;
  } else if (difficulty >= 35) {
    depth = 'standard';
    reasoningEffort = 'medium';
    parallelCandidates = 2;
  }

  if (maxCostCents < 20 && depth === 'deep') {
    depth = 'standard';
    reasoningEffort = 'medium';
  }

  return {
    difficulty,
    maxCostCents,
    depth,
    reasoningEffort,
    parallelCandidates,
    // Backward-compatible alias. This is candidate-level application routing,
    // not internal MoE expert activation; remove after downstream migration.
    activeExperts: parallelCandidates,
    activeExpertsDeprecated: true,
    humanHandoff,
    telemetry: ['difficulty', 'depth', 'reasoningEffort', 'parallelCandidates', 'latencyMs', 'costCents', 'outcome'],
  };
}

module.exports = {
  estimateDifficulty,
  planInferenceBudget,
};
