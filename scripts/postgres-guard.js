'use strict';

/**
 * PostgreSQL Safety Guardrail
 *
 * Implements high-ROI safety mechanisms against autonomous AI agents connecting to
 * PostgreSQL databases, directly inspired by the Google DB team's "lean hard on AI
 * but constrain blast radius" mandate.
 *
 * Capabilities:
 * - SQL write-policy enforcement (DROP, mass UPDATE/DELETE)
 * - Schema change approval gates (ALTER TABLE)
 * - Privilege escalation restrictions (GRANT, CREATE ROLE)
 */

function evaluatePostgresQuery(query) {
  if (!query || typeof query !== 'string') {
    return { mode: 'allow', reason: 'empty or invalid query' };
  }

  const normalized = query.toUpperCase();

  // 1. Privilege and role restrictions
  if (normalized.includes('CREATE ROLE') || normalized.includes('ALTER ROLE') || normalized.includes('GRANT ALL')) {
    return { mode: 'block', reason: 'Agent is not permitted to create or modify PostgreSQL roles or grants.' };
  }

  // 2. Destructive operations (DROP)
  if (normalized.includes('DROP TABLE') || normalized.includes('DROP DATABASE') || normalized.includes('DROP SCHEMA')) {
    return { mode: 'block', reason: 'Destructive DROP operations are blocked for autonomous agents.' };
  }

  // 3. Schema change approval gates
  if (normalized.includes('ALTER TABLE')) {
    return { mode: 'warn', reason: 'Schema modification detected. Requires human review.' };
  }

  // 4. Mass UPDATE/DELETE without restrictive WHERE
  if (normalized.includes('UPDATE ') || normalized.includes('DELETE FROM ')) {
    const isUpsertConflictUpdate = normalized.includes('INSERT INTO ') && normalized.includes('ON CONFLICT') && normalized.includes('DO UPDATE SET');
    if (isUpsertConflictUpdate) {
      return { mode: 'allow', reason: 'safe upsert conflict handler' };
    }
    if (!normalized.includes('WHERE ')) {
      return { mode: 'block', reason: 'Unbounded UPDATE or DELETE without a WHERE clause is blocked.' };
    }
  }

  // 5. Query-cost and performance protections (Cartesian joins)
  if (normalized.includes('CROSS JOIN')) {
    return { mode: 'warn', reason: 'Cartesian join detected. Verify performance cost.' };
  }

  return { mode: 'allow', reason: 'safe' };
}

module.exports = {
  evaluatePostgresQuery,
};
