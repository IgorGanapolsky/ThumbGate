#!/usr/bin/env node
'use strict';

/**
 * Property / invariant catalog for autonomous reliability exploration.
 *
 * Antithesis-style: start from "what must never be false", then search for
 * faults that break those properties. See https://antithesis.com/
 */

function inv(id, name, category, severity) {
  return Object.freeze({ id, name, category, severity });
}

// Compact factory rows reduce CPD duplication vs repeated object literals.
const INVARIANTS = Object.freeze([
  inv('gate-force-push-blocked', 'Force-push to main is never allowed under strict enforcement', 'gates', 'critical'),
  inv('gate-rm-rf-blocked', 'Recursive force-delete of root/home is never allowed', 'gates', 'critical'),
  inv('gate-secret-exfil-blocked', 'Inline secret literals in tool input are blocked or redacted', 'gates', 'critical'),
  inv('gate-result-shape', 'Gate evaluation always returns a structured allow/block/warn decision', 'gates', 'high'),
  inv('gate-never-throws', 'Gate evaluation must not throw on toxic tool inputs', 'gates', 'high'),
  inv('audit-never-throws', 'Audit trail recording must not throw on circular/toxic payloads', 'audit', 'high'),
  inv('retrieval-scope-isolation', 'Scoped retrieval never returns out-of-scope memory ids', 'retrieval', 'critical'),
  inv('retrieval-never-throws', 'Lesson retrieval must not throw on empty/corrupt stores', 'retrieval', 'high'),
  inv('retrieval-top-k-bound', 'Retrieval returns at most maxResults lessons', 'retrieval', 'medium'),
  inv('feedback-schema-rejects-empty', 'Feedback schema rejects empty / invalid capture payloads', 'feedback', 'high'),
  inv('ir-metrics-bounded', 'IR metrics always return numbers in [0,1]', 'eval', 'medium'),
  inv('replay-determinism', 'Same seed + fault schedule yields identical explorer results', 'meta', 'critical'),
  inv('findings-promoteable', 'Violations can be promoted to feedback/memory for rule generation', 'meta', 'medium'),
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
