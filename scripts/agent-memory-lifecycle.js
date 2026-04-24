#!/usr/bin/env node
'use strict';

const MEMORY_TYPES = new Set(['episodic', 'semantic', 'procedural', 'preference', 'working']);

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeMemoryType(value) {
  const normalized = normalizeText(value).toLowerCase();
  return MEMORY_TYPES.has(normalized) ? normalized : 'episodic';
}

function buildMemoryLifecyclePolicy(input = {}) {
  return {
    generatedAt: normalizeText(input.generatedAt) || new Date().toISOString(),
    memoryTypes: [
      {
        type: 'working',
        purpose: 'Short-lived task context.',
        retention: 'session',
        promotionGate: 'discard unless referenced by outcome evidence',
      },
      {
        type: 'episodic',
        purpose: 'Specific agent actions, feedback, and outcomes.',
        retention: 'bounded_history',
        promotionGate: 'requires actionable context and source trace',
      },
      {
        type: 'semantic',
        purpose: 'Consolidated facts, standards, and reusable lessons.',
        retention: 'durable',
        promotionGate: 'requires deduplication and contradiction check',
      },
      {
        type: 'procedural',
        purpose: 'Reusable workflows, prompt programs, and gates.',
        retention: 'durable',
        promotionGate: 'requires test or replay evidence',
      },
      {
        type: 'preference',
        purpose: 'Operator style and decision preferences.',
        retention: 'durable_redactable',
        promotionGate: 'requires explicit user signal',
      },
    ],
    retrieval: {
      defaultTopK: 8,
      recencyWeight: 0.25,
      semanticWeight: 0.5,
      outcomeWeight: 0.25,
      requireSourceAnchors: true,
    },
    privacy: {
      piiScanRequired: true,
      secretScanRequired: true,
      exportRequiresRedaction: true,
    },
  };
}

function evaluateMemoryPromotion(memory = {}, policy = buildMemoryLifecyclePolicy()) {
  const type = normalizeMemoryType(memory.type);
  const content = normalizeText(memory.content);
  const source = normalizeText(memory.source);
  const outcome = normalizeText(memory.outcome);
  const issues = [];

  if (!content) issues.push('missing_content');
  if (!source) issues.push('missing_source_anchor');
  if (type !== 'preference' && !outcome) issues.push('missing_outcome');
  if (/api[_-]?key|secret|password|token|bearer\s+[a-z0-9._-]+/i.test(content)) {
    issues.push('secret_like_content');
  }
  if (type === 'preference' && memory.explicitUserSignal !== true) {
    issues.push('preference_without_explicit_signal');
  }

  return {
    type,
    decision: issues.length === 0 ? 'promote' : 'hold',
    issues,
    retrievalEligible: issues.length === 0 || !issues.includes('secret_like_content'),
    policyVersion: policy.generatedAt,
  };
}

module.exports = {
  buildMemoryLifecyclePolicy,
  evaluateMemoryPromotion,
  normalizeMemoryType,
};
