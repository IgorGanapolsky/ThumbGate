#!/usr/bin/env node
'use strict';

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function classifyRetrievalFailure(input = {}) {
  const query = normalizeText(input.query);
  const evidence = normalizeText(input.evidence);
  const confidence = Number(input.confidence ?? 0.5);
  const failed = input.failed === true || confidence < 0.35 || /unknown|not enough|cannot determine/i.test(evidence);
  if (!failed) return 'none';
  if (!query) return 'irreducible';
  if (/\band\b|\bor\b|,|;|\bcompare\b|\bmultiple\b/i.test(query)) return 'question_decomposition';
  if (evidence && !new RegExp(query.split(/\s+/).slice(0, 3).join('|'), 'i').test(evidence)) return 'query_rewrite';
  if (evidence.length > 1200 || /irrelevant|too broad|many results/i.test(evidence)) return 'evidence_focus';
  return 'query_rewrite';
}

function routeRetrievalSkill(input = {}) {
  const failure = classifyRetrievalFailure(input);
  const skill = {
    none: 'skip_retrieval',
    query_rewrite: 'rewrite_query',
    question_decomposition: 'decompose_question',
    evidence_focus: 'focus_evidence',
    irreducible: 'exit_unknown',
  }[failure];
  return {
    failure,
    skill,
    retrieve: failure !== 'none' && failure !== 'irreducible',
    reason: failure === 'none'
      ? 'Model answer is sufficiently confident; retrieval would waste budget.'
      : failure === 'irreducible'
        ? 'Query lacks enough structure for retrieval; ask for clarification or return unknown.'
        : 'Failure state detected; route to a typed retrieval repair skill before retrying generation.',
  };
}

module.exports = {
  classifyRetrievalFailure,
  routeRetrievalSkill,
};
