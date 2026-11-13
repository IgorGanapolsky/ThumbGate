'use strict';

/**
 * ThumbGate SDLC Tsunami Guardrails
 *
 * Architectural Steal: Mitch Ashley & Brad Shimmin (Agents of Dev Ep 44)
 * 1. "Lazy Pull Requests" and intelligent CI cancellation: automatically halt in-flight
 *    builds when a newly submitted PR commit supersedes earlier work.
 * 2. Enforce governance and business policies at the database layer: codify spending thresholds,
 *    approval workflows, and immutable audit logs inside database triggers and CHECK constraints.
 * 3. Deploy fast decisioning models inside multi-agent terminal stacks (Jev pattern):
 *    fast Type-1 decisioning engine doing rapid boolean checks, multi-option triage,
 *    and confidence scoring for red/blue teaming.
 */

const Database = require('better-sqlite3');

/**
 * CI Build Cancellation Manager:
 * Cancels stale in-flight builds when a new commit lands on the same branch or PR.
 */
class LazyPipelineManager {
  constructor() {
    this.activeRuns = new Map(); // branchName -> { commitSha, runId, cancelFn, startedAt }
    this.completedRuns = [];
    this.cancelledRuns = [];
  }

  /**
   * Registers a new pipeline run for a branch/commit.
   * If an existing run is in-flight for this branch, cancels it immediately.
   */
  registerRun(branch, commitSha, cancelCallback = null) {
    const existing = this.activeRuns.get(branch);
    if (existing) {
      // Cancel previous in-flight run
      if (typeof existing.cancelFn === 'function') {
        try {
          existing.cancelFn({ reason: `Superseded by newer commit ${commitSha.slice(0, 7)}` });
        } catch { /* ignore */ }
      }

      this.cancelledRuns.push({
        branch,
        commitSha: existing.commitSha,
        runId: existing.runId,
        cancelledAt: Date.now(),
        reason: `Superseded by commit ${commitSha.slice(0, 7)}`,
      });
      this.activeRuns.delete(branch);
    }

    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newRun = {
      runId,
      branch,
      commitSha,
      cancelFn: cancelCallback,
      startedAt: Date.now(),
    };

    this.activeRuns.set(branch, newRun);
    return {
      runId,
      cancelledPrevious: Boolean(existing),
      previousCommitSha: existing ? existing.commitSha : null,
    };
  }

  /**
   * Completes a run successfully.
   */
  completeRun(branch, runId) {
    const current = this.activeRuns.get(branch);
    if (current && current.runId === runId) {
      this.activeRuns.delete(branch);
      this.completedRuns.push({ ...current, completedAt: Date.now() });
      return true;
    }
    return false;
  }
}

/**
 * Database-Layer Immutable Policy Engine:
 * Sets up SQLite tables with hard schema CHECK constraints and append-only triggers.
 */
function createPolicyDatabase(dbPath = ':memory:') {
  const db = new Database(dbPath);

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Table 1: Spending limits with hardware-level CHECK constraints
  db.exec(`
    CREATE TABLE IF NOT EXISTS spending_limits (
      id TEXT PRIMARY KEY,
      service_name TEXT NOT NULL,
      max_authorized_cents INTEGER NOT NULL,
      current_spent_cents INTEGER NOT NULL DEFAULT 0,
      CONSTRAINT chk_spend_cap CHECK (current_spent_cents <= max_authorized_cents)
    );
  `);

  // Table 2: Immutable audit ledger with SQLite trigger preventing updates or deletes
  db.exec(`
    CREATE TABLE IF NOT EXISTS immutable_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TRIGGER IF NOT EXISTS trg_prevent_audit_update
    BEFORE UPDATE ON immutable_audit_log
    BEGIN
      SELECT RAISE(ABORT, 'ThumbGate Database Diode: Audit log records are strictly immutable and cannot be updated.');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_prevent_audit_delete
    BEFORE DELETE ON immutable_audit_log
    BEGIN
      SELECT RAISE(ABORT, 'ThumbGate Database Diode: Audit log records are strictly immutable and cannot be deleted.');
    END;
  `);

  return db;
}

/**
 * Type-1 Jev Fast Decisioning Engine:
 * Evaluates high-velocity operational questions in <5ms without spinning heavy frontier LLM calls.
 */
function jevType1Decision(context = {}) {
  const {
    command = '',
    targetPath = '',
    agentName = 'claude',
    requestedTokens = 1000,
  } = context;

  const start = Date.now();

  // Rule 1: Instant boolean check for destructive file modification
  if (/(?:rm\s+-rf|\.env|id_rsa|\/dev\/null)/i.test(command) || /(?:\.env|\.ssh)/i.test(targetPath)) {
    return {
      decision: 'REJECT',
      confidence: 0.99,
      latencyMs: Date.now() - start,
      category: 'destructive_safety',
      reason: 'Prohibited shell or file pattern',
    };
  }

  // Rule 2: Token budget check
  if (requestedTokens > 50_000) {
    return {
      decision: 'ESCALATE_TO_FRONTIER',
      confidence: 0.95,
      latencyMs: Date.now() - start,
      category: 'token_scale',
      reason: 'Token request exceeds Type-1 fast threshold, routing to Laguna S / Frontier',
    };
  }

  // Rule 3: Safe execution
  return {
    decision: 'APPROVE',
    confidence: 0.98,
    latencyMs: Date.now() - start,
    category: 'safe_operation',
    reason: 'Compliant with fast Type-1 operational rules',
  };
}

module.exports = {
  LazyPipelineManager,
  createPolicyDatabase,
  jevType1Decision,
};
