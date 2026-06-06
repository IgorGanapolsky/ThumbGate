'use strict';

/**
 * Database Safety Guardrail
 *
 * High-ROI pre-action checks for autonomous agents touching relational
 * databases. The core insight: an agent can hallucinate UI safely enough to
 * review, but a hallucinated SQL write, migration, role change, or production
 * config tweak can destroy data before review ever happens.
 */

const DANGEROUS_MIGRATION_COMMANDS = [
  /\bprisma\s+migrate\s+deploy\b/i,
  /\bprisma\s+migrate\s+reset\b/i,
  /\bsequelize(?:-cli)?\s+db:migrate\b/i,
  /\brails\s+db:migrate\b/i,
  /\bknex\s+migrate:(?:latest|up|rollback)\b/i,
  /\bflyway\s+migrate\b/i,
  /\bliquibase\s+update\b/i,
];

function stripSqlComments(query) {
  const source = String(query || '');
  let output = '';
  let index = 0;
  let previousWasSpace = true;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '-' && next === '-') {
      index += 2;
      while (index < source.length && source[index] !== '\n' && source[index] !== '\r') {
        index += 1;
      }
      if (!previousWasSpace) {
        output += ' ';
        previousWasSpace = true;
      }
      continue;
    }

    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1;
      }
      index = Math.min(index + 2, source.length);
      if (!previousWasSpace) {
        output += ' ';
        previousWasSpace = true;
      }
      continue;
    }

    if (char.trim() === '') {
      if (!previousWasSpace) {
        output += ' ';
        previousWasSpace = true;
      }
    } else {
      output += char;
      previousWasSpace = false;
    }
    index += 1;
  }

  return output.trim();
}

function normalizeSql(query) {
  return stripSqlComments(query).toUpperCase();
}

function isProductionTarget({ env, databaseUrl, command } = {}) {
  const haystack = [env, databaseUrl, command].filter(Boolean).join(' ').toLowerCase();
  return /\b(prod|production|primary|railway|rds|aurora|cloudsql|neon\.tech|supabase\.co)\b/.test(haystack);
}

function hasHumanApproval({ approvalToken, approved, humanApproved } = {}) {
  return Boolean(approvalToken || approved === true || humanApproved === true);
}

function hasRollbackEvidence({ hasBackup, backupPath, snapshotId, rollbackPlan, migrationReversible } = {}) {
  return Boolean(hasBackup || backupPath || snapshotId || rollbackPlan || migrationReversible === true);
}

function hasDryRunEvidence({ hasDryRun, dryRunOutput, hasExplain, explainPlan } = {}) {
  return Boolean(hasDryRun || dryRunOutput || hasExplain || explainPlan);
}

function isUnboundedWhere(normalized) {
  return /\bWHERE\s+(?:1\s*=\s*1|TRUE)\b/.test(normalized);
}

function evaluatePostgresQuery(query, options = {}) {
  if (!query || typeof query !== 'string') {
    return { mode: 'allow', reason: 'empty or invalid query' };
  }

  const normalized = normalizeSql(query);
  const production = isProductionTarget(options);

  if (/\b(CREATE|ALTER)\s+ROLE\b/.test(normalized) || /\bGRANT\s+ALL\b/.test(normalized)) {
    return { mode: 'block', reason: 'Agent is not permitted to create or modify PostgreSQL roles or grants.' };
  }

  if (/\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/.test(normalized) || /\bTRUNCATE\s+(TABLE\s+)?\w+/i.test(normalized)) {
    if (production && hasHumanApproval(options) && hasRollbackEvidence(options)) {
      return { mode: 'warn', reason: 'Destructive production SQL has approval and rollback evidence; require final human review before execution.' };
    }
    return { mode: 'block', reason: 'Destructive DROP/TRUNCATE operations are blocked for autonomous agents unless production approval and rollback proof are attached.' };
  }

  if (/\bALTER\s+TABLE\b/.test(normalized) || /\bDROP\s+COLUMN\b/.test(normalized)) {
    if (production && (!hasHumanApproval(options) || !hasRollbackEvidence(options))) {
      return { mode: 'block', reason: 'Production schema changes require human approval plus backup, snapshot, or rollback evidence.' };
    }
    return { mode: 'warn', reason: 'Schema modification detected. Requires human review.' };
  }

  if (/\bUPDATE\s+\w+/.test(normalized) || /\bDELETE\s+FROM\s+\w+/.test(normalized)) {
    if (!/\bWHERE\b/.test(normalized) || isUnboundedWhere(normalized)) {
      return { mode: 'block', reason: 'Unbounded UPDATE or DELETE without a restrictive WHERE clause is blocked.' };
    }
    if (production && !hasDryRunEvidence(options)) {
      return { mode: 'warn', reason: 'Production write query should include dry-run or EXPLAIN evidence before execution.' };
    }
  }

  if (/\bCROSS\s+JOIN\b/.test(normalized)) {
    return { mode: 'warn', reason: 'Cartesian join detected. Verify performance cost.' };
  }

  if (production && /\bCREATE\s+INDEX\b/.test(normalized) && !/\bCONCURRENTLY\b/.test(normalized)) {
    return { mode: 'warn', reason: 'Production CREATE INDEX without CONCURRENTLY can lock writes; require DBA review.' };
  }

  return { mode: 'allow', reason: 'safe' };
}

function evaluateDatabaseAgentAction(action = {}) {
  const command = String(action.command || '');
  const query = action.query || action.sql;

  if (query) {
    return evaluatePostgresQuery(query, action);
  }

  if (DANGEROUS_MIGRATION_COMMANDS.some((pattern) => pattern.test(command))) {
    if (isProductionTarget(action) && (!hasHumanApproval(action) || !hasRollbackEvidence(action) || !hasDryRunEvidence(action))) {
      return { mode: 'block', reason: 'Production database migrations require human approval, rollback evidence, and dry-run proof before an agent can run them.' };
    }
    return { mode: 'warn', reason: 'Database migration command detected. Verify target, rollback, and dry-run evidence.' };
  }

  return { mode: 'allow', reason: 'safe' };
}

module.exports = {
  evaluateDatabaseAgentAction,
  evaluatePostgresQuery,
  normalizeSql,
};
