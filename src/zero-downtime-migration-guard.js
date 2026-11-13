/**
 * Zero-Downtime Database Migration State Machine.
 * 
 * Inspired by Maude Lemaire (Scaling Slack, GitHub, and Cursor):
 * "Isolate raw queries into a minimal abstraction before migrating:
 * When consolidating tables across hundreds of call sites, first regex-locate
 * all queries and copy-paste them 1-to-1 into a basic wrapper class without
 * optimizing them. Once isolated behind feature flags, execute the standard
 * sequence: double-write to both tables, backfill historical data,
 * shadow-read to compare discrepancies in a data warehouse, and gradually roll out."
 */

'use strict';

const MIGRATION_PHASES = [
  'ISOLATE',      // Step 1: Raw queries isolated into wrapper class behind feature flags
  'DOUBLE_WRITE',  // Step 2: Write to both old and new tables; read from old
  'BACKFILL',      // Step 3: Backfill historical records from old to new
  'SHADOW_READ',   // Step 4: Read from old (authoritative) and new, diffing mismatches
  'CUTOVER',       // Step 5: Read and write primarily to new table; old is fallback
  'CLEANUP',       // Step 6: Deprecate old table and remove double-write logic
];

class ZeroDowntimeMigrationGuard {
  constructor(migrationConfig = {}) {
    this.name = migrationConfig.name || 'unnamed-migration';
    this.sourceTable = migrationConfig.sourceTable;
    this.targetTable = migrationConfig.targetTable;
    this.featureFlagKey = migrationConfig.featureFlagKey;
    this.currentPhase = migrationConfig.initialPhase || 'ISOLATE';
    this.history = [{ phase: this.currentPhase, timestamp: new Date().toISOString() }];
  }

  canTransitionTo(nextPhase) {
    const curIdx = MIGRATION_PHASES.indexOf(this.currentPhase);
    const nextIdx = MIGRATION_PHASES.indexOf(nextPhase);

    if (curIdx === -1 || nextIdx === -1) {
      return { allowed: false, reason: `Unknown migration phase '${nextPhase}'` };
    }

    if (nextIdx !== curIdx + 1 && nextIdx !== curIdx - 1) {
      return {
        allowed: false,
        reason: `Invalid transition: cannot jump from '${this.currentPhase}' to '${nextPhase}'. Standard zero-downtime order is: ${MIGRATION_PHASES.join(' -> ')}`,
      };
    }

    return { allowed: true };
  }

  advancePhase(nextPhase, verificationEvidence = {}) {
    const check = this.canTransitionTo(nextPhase);
    if (!check.allowed) {
      throw new Error(check.reason);
    }

    // Phase-specific entry invariants
    if (nextPhase === 'DOUBLE_WRITE' && !verificationEvidence.wrapperIsolated) {
      throw new Error('Cannot advance to DOUBLE_WRITE without verified query wrapper isolation behind a feature flag.');
    }
    if (nextPhase === 'SHADOW_READ' && !verificationEvidence.backfillComplete) {
      throw new Error('Cannot advance to SHADOW_READ before historical data backfill is 100% verified complete.');
    }
    if (nextPhase === 'CUTOVER' && (verificationEvidence.discrepancyRate === undefined || verificationEvidence.discrepancyRate > 0.0001)) {
      throw new Error(`Cannot advance to CUTOVER: shadow read discrepancy rate (${verificationEvidence.discrepancyRate}) must be <= 0.01%.`);
    }

    const previousPhase = this.currentPhase;
    this.currentPhase = nextPhase;
    this.history.push({
      phase: nextPhase,
      previousPhase,
      evidence: verificationEvidence,
      timestamp: new Date().toISOString(),
    });

    return {
      ok: true,
      migration: this.name,
      previousPhase,
      currentPhase: this.currentPhase,
      allowedRollbackPhase: previousPhase,
    };
  }

  getStatus() {
    return {
      migration: this.name,
      sourceTable: this.sourceTable,
      targetTable: this.targetTable,
      featureFlagKey: this.featureFlagKey,
      currentPhase: this.currentPhase,
      phasesOrder: MIGRATION_PHASES,
      history: this.history,
    };
  }
}

module.exports = {
  ZeroDowntimeMigrationGuard,
  MIGRATION_PHASES,
};
