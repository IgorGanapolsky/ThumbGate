#!/usr/bin/env node
'use strict';

/**
 * Property / invariant catalog for autonomous reliability exploration.
 *
 * Antithesis-style: start from "what must never be false", then search for
 * faults that break those properties. See https://antithesis.com/
 */

const INVARIANTS = Object.freeze([
  {
    id: 'gate-force-push-blocked',
    name: 'Force-push to main is never allowed under strict enforcement',
    category: 'gates',
    severity: 'critical',
  },
  {
    id: 'gate-result-shape',
    name: 'Gate evaluation always returns a structured allow/block/warn decision',
    category: 'gates',
    severity: 'high',
  },
  {
    id: 'gate-never-throws',
    name: 'Gate evaluation must not throw on toxic tool inputs',
    category: 'gates',
    severity: 'high',
  },
  {
    id: 'retrieval-scope-isolation',
    name: 'Scoped retrieval never returns out-of-scope memory ids',
    category: 'retrieval',
    severity: 'critical',
  },
  {
    id: 'retrieval-never-throws',
    name: 'Lesson retrieval must not throw on empty/corrupt stores',
    category: 'retrieval',
    severity: 'high',
  },
  {
    id: 'retrieval-top-k-bound',
    name: 'Retrieval returns at most maxResults lessons',
    category: 'retrieval',
    severity: 'medium',
  },
  {
    id: 'feedback-schema-rejects-empty',
    name: 'Feedback schema rejects empty / invalid capture payloads',
    category: 'feedback',
    severity: 'high',
  },
  {
    id: 'ir-metrics-bounded',
    name: 'IR metrics always return numbers in [0,1]',
    category: 'eval',
    severity: 'medium',
  },
  {
    id: 'replay-determinism',
    name: 'Same seed + fault schedule yields identical explorer results',
    category: 'meta',
    severity: 'critical',
  },
]);

function listInvariants(category) {
  if (!category) return [...INVARIANTS];
  return INVARIANTS.filter((i) => i.category === category);
}

function getInvariant(id) {
  return INVARIANTS.find((i) => i.id === id) || null;
}

module.exports = {
  INVARIANTS,
  listInvariants,
  getInvariant,
};
