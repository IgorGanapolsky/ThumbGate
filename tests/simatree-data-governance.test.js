'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const {
  evaluateDataLifecycleIntent,
  estimateBayesianUncertainty,
  auditPMOTransformationGate,
  checkDoctor,
  DESTRUCTIVE_SQL_PATTERNS,
} = require('../scripts/simatree-data-governance');

test('simatree-data-governance: allows benign SELECT query with grounded intent', () => {
  const result = evaluateDataLifecycleIntent({
    sql: 'SELECT customer_id, revenue FROM analytics.sales_monthly WHERE year = 2026',
    businessIntent: 'Executive dashboard quarterly revenue cohort calculation for Q3 board meeting.',
    riskTier: 'LOW',
    targetEntities: ['analytics.sales_monthly'],
  });

  assert.equal(result.allowed, true);
  assert.equal(result.score, 100);
  assert.equal(result.isDestructive, false);
  assert.equal(result.violations.length, 0);
  assert.ok(result.receipt);
  assert.equal(result.receipt.authorized, true);
});

test('simatree-data-governance: rejects destructive DROP TABLE without rollback snapshot', () => {
  const result = evaluateDataLifecycleIntent({
    sql: 'DROP TABLE raw_events.user_clicks;',
    businessIntent: 'Cleaning up obsolete analytics staging tables.',
    riskTier: 'LOW',
    targetEntities: [],
  });

  assert.equal(result.allowed, false);
  assert.equal(result.isDestructive, true);
  assert.ok(result.violations.some((v) => v.includes('DESTRUCTIVE_MUTATION_WITHOUT_ROLLBACK')));
  assert.ok(result.violations.some((v) => v.includes('INVALID_RISK_TIER')));
  assert.ok(result.violations.some((v) => v.includes('UNSPECIFIED_TARGET_ENTITIES')));
  assert.equal(result.receipt, null);
});

test('simatree-data-governance: permits destructive TRUNCATE when fully authorized with snapshot and CRITICAL risk', () => {
  const result = evaluateDataLifecycleIntent({
    sql: 'TRUNCATE TABLE staging.user_session_logs;',
    businessIntent: 'End-of-month partition maintenance and pipeline compaction routine.',
    riskTier: 'CRITICAL',
    targetEntities: ['staging.user_session_logs'],
    rollbackPlan: {
      snapshotId: 'snap_20260821_session_logs_backup',
      restoreTimeSeconds: 45,
    },
  });

  assert.equal(result.allowed, true);
  assert.equal(result.isDestructive, true);
  assert.equal(result.violations.length, 0);
  assert.ok(result.receipt);
});

test('simatree-data-governance: rejects empty or low-signal business intent', () => {
  const missing = evaluateDataLifecycleIntent({
    sql: 'SELECT * FROM users;',
    businessIntent: '',
  });
  assert.equal(missing.allowed, false);
  assert.ok(missing.violations.some((v) => v.includes('MISSING_BUSINESS_INTENT')));

  const lowSignal = evaluateDataLifecycleIntent({
    sql: 'SELECT * FROM users;',
    businessIntent: 'temp test',
  });
  assert.equal(lowSignal.allowed, false);
  assert.ok(lowSignal.violations.some((v) => v.includes('INSUFFICIENT_BUSINESS_INTENT')));
});

test('simatree-data-governance: estimateBayesianUncertainty calculates confidence and flags high drift', () => {
  const confident = estimateBayesianUncertainty({
    sampleSize: 500,
    priorSuccessRate: 0.99,
    observedFailures: 2,
    schemaDriftScore: 0.01,
  });

  assert.equal(confident.safe, true);
  assert.equal(confident.verdict, 'CONFIDENT_EXECUTION');
  assert.ok(confident.uncertainty < 0.20);
  assert.ok(confident.posteriorMean > 0.90);

  const risky = estimateBayesianUncertainty({
    sampleSize: 20,
    priorSuccessRate: 0.80,
    observedFailures: 8,
    schemaDriftScore: 0.75,
  });

  assert.equal(risky.safe, false);
  assert.equal(risky.verdict, 'HIGH_UNCERTAINTY_INTERDICTED');
  assert.ok(risky.uncertainty > 0.20);
});

test('simatree-data-governance: auditPMOTransformationGate validates multi-stage modernization plans', () => {
  const validPlan = auditPMOTransformationGate({
    stages: [
      {
        id: 'STAGE_1',
        name: 'Schema Lineage Discovery',
        outcomeMetric: '100% table dependency mapping',
        owner: 'Lead Enterprise Architect',
        isMutating: false,
      },
      {
        id: 'STAGE_2',
        name: 'Lakehouse Data Migration',
        outcomeMetric: 'zero row-loss checksum parity',
        owner: 'Data Platform Team',
        isMutating: true,
        rollbackReceipt: 'receipt_snap_39201',
      },
    ],
  });

  assert.equal(validPlan.compliant, true);
  assert.equal(validPlan.score, 100);
  assert.equal(validPlan.findings.length, 0);

  const invalidPlan = auditPMOTransformationGate({
    stages: [
      {
        id: 'STAGE_1',
        // missing name, outcomeMetric, owner
        isMutating: true,
      },
    ],
  });

  assert.equal(invalidPlan.compliant, false);
  assert.ok(invalidPlan.findings.length >= 3);

  const emptyPlan = auditPMOTransformationGate({});
  assert.equal(emptyPlan.compliant, false);
  assert.equal(emptyPlan.score, 0);
});

test('simatree-data-governance: checkDoctor returns healthy state', () => {
  const doctor = checkDoctor();
  assert.equal(doctor.ok, true);
  assert.equal(doctor.name, 'simatree-data-governance');
  assert.equal(doctor.evaluator, 'ONLINE');
  assert.equal(doctor.bayesianModel, 'ONLINE');
  assert.equal(doctor.pmoGate, 'ONLINE');
});

test('simatree-data-governance: gate JSON configuration is valid and matches schema', () => {
  const gatePath = path.join(__dirname, '..', 'config', 'gates', 'simatree-data-governance.json');
  assert.ok(fs.existsSync(gatePath));

  const parsed = JSON.parse(fs.readFileSync(gatePath, 'utf8'));
  assert.equal(parsed.id, 'simatree-data-governance');
  assert.equal(parsed.category, 'Enterprise Data & Analytics Governance');
  assert.equal(parsed.enforcementMode, 'ENFORCE');
  assert.ok(Array.isArray(parsed.patterns));
  assert.ok(parsed.patterns.length >= 2);
});

test('simatree-data-governance: CLI execution handles --doctor and --sql flags', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'simatree-data-governance.js');

  const doctorOut = execSync(`node "${scriptPath}" --doctor`, { encoding: 'utf8' });
  const doctorJson = JSON.parse(doctorOut);
  assert.equal(doctorJson.ok, true);

  const sqlOut = execSync(
    `node "${scriptPath}" --sql "SELECT count(1) FROM dim_customers" --why "Annual customer retention KPI reporting"`,
    { encoding: 'utf8' }
  );
  const sqlJson = JSON.parse(sqlOut);
  assert.equal(sqlJson.allowed, true);
  assert.equal(sqlJson.isDestructive, false);
});
