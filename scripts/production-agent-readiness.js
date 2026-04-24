#!/usr/bin/env node
'use strict';

function evaluateProductionAgentReadiness(input = {}) {
  const signals = {
    subAgents: Array.isArray(input.subAgents) && input.subAgents.length >= 2,
    structuredOutputs: input.structuredOutputs === true,
    dynamicRag: input.dynamicRag === true,
    observability: input.observability === true || input.tracing === true,
    circuitBreakers: input.circuitBreakers === true,
  };
  const missing = Object.entries(signals)
    .filter(([, present]) => !present)
    .map(([name]) => name);
  const score = Math.round((Object.values(signals).filter(Boolean).length / Object.keys(signals).length) * 100);
  return {
    status: missing.length === 0 ? 'production_ready' : score >= 60 ? 'needs_hardening' : 'prototype',
    score,
    signals,
    missing,
    requiredFixes: missing.map((name) => ({
      subAgents: 'Split monolithic prompts into narrow sub-agent stages.',
      structuredOutputs: 'Use runtime-validated schemas instead of prompt-only JSON formatting.',
      dynamicRag: 'Replace hardcoded context with refreshed retrieval over indexed source material.',
      observability: 'Emit traces for model calls, tool calls, tokens, latency, and stage failures.',
      circuitBreakers: 'Set retry, timeout, loop, and spend limits before production use.',
    }[name])),
  };
}

module.exports = {
  evaluateProductionAgentReadiness,
};
