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

// This test previously asserted a `patterns`/`regex`/`id` shape. It passed
// while the gate contributed zero rules to the engine, because it validated a
// schema the runtime never reads. It now asserts the schema loadGatesConfig
// actually consumes; "the rules also fire" is covered further down.
test('simatree-data-governance: gate JSON matches the schema the runtime loader reads', () => {
  const gatePath = path.join(__dirname, '..', 'config', 'gates', 'simatree-data-governance.json');
  assert.ok(fs.existsSync(gatePath));

  const parsed = JSON.parse(fs.readFileSync(gatePath, 'utf8'));
  assert.equal(parsed.harness, 'simatree-data-governance');
  assert.equal(parsed.metadata.category, 'Enterprise Data & Analytics Governance');
  assert.equal(parsed.metadata.enforcementMode, 'ENFORCE');
  assert.ok(Array.isArray(parsed.gates), 'must be a `gates` array, not `patterns`');
  assert.ok(parsed.gates.length >= 2);
  assert.ok(
    !Object.prototype.hasOwnProperty.call(parsed, 'patterns'),
    'a leftover `patterns` key is dead config and invites the same silent-inert regression'
  );
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

// ---------------------------------------------------------------------------
// Regression: qualified and quoted table names
//
// The matcher used to be `DELETE\s+FROM\s+\w+...`. `\w+` matches only the
// single-part form, so `DELETE FROM analytics.customers;` was classified
// non-destructive and received an AUTHORIZED receipt with no rollback plan, no
// HIGH/CRITICAL risk tier and no declared targetEntities — precisely the
// full-table deletion this gate exists to interdict. Every schema-, project-
// and quote-qualified form the advertised warehouses emit was equally
// invisible.
// ---------------------------------------------------------------------------

const QUALIFIED_DELETES = [
  ['bare', 'DELETE FROM customers;'],
  ['schema-qualified (Postgres/Snowflake)', 'DELETE FROM analytics.customers;'],
  ['project-qualified (BigQuery)', 'DELETE FROM prod_project.analytics.customers;'],
  ['double-quoted parts', 'DELETE FROM "analytics"."customers";'],
  ['backtick-quoted, dots and hyphens inside', 'DELETE FROM `prod-project.analytics.customers`;'],
  ['bracket-quoted (SQL Server)', 'DELETE FROM [dbo].[Customers];'],
  ['whitespace around the dot', 'DELETE FROM analytics . customers;'],
];

for (const [label, sql] of QUALIFIED_DELETES) {
  test(`simatree-data-governance: full-table DELETE is destructive — ${label}`, () => {
    const result = evaluateDataLifecycleIntent({
      sql,
      businessIntent: 'Quarterly GDPR erasure run for opted-out EU customer records.',
      riskTier: 'MEDIUM',
      targetEntities: [],
    });

    assert.equal(result.isDestructive, true, `${sql} must be classified destructive`);
    assert.equal(result.allowed, false, `${sql} must not receive an authorized receipt`);
    assert.ok(
      result.violations.some((v) => v.startsWith('DESTRUCTIVE_MUTATION_WITHOUT_ROLLBACK')),
      'missing rollback plan must be reported'
    );
    assert.ok(
      result.violations.some((v) => v.startsWith('UNSPECIFIED_TARGET_ENTITIES')),
      'missing targetEntities must be reported'
    );
  });
}

test('simatree-data-governance: reads and WHERE-scoped updates stay non-destructive', () => {
  for (const sql of [
    'SELECT * FROM analytics.customers;',
    'SELECT count(1) FROM `proj.ds.customers`;',
    'UPDATE analytics.customers SET tier = 1 WHERE customer_id = 7;',
  ]) {
    const result = evaluateDataLifecycleIntent({
      sql,
      businessIntent: 'Executive dashboard quarterly revenue cohort calculation.',
      riskTier: 'LOW',
      targetEntities: ['analytics.customers'],
    });
    assert.equal(result.isDestructive, false, `${sql} must not be flagged destructive`);
    assert.equal(result.allowed, true, `${sql} must be allowed`);
  }
});

test('simatree-data-governance: an UPDATE with no WHERE clause is destructive', () => {
  const result = evaluateDataLifecycleIntent({
    sql: 'UPDATE analytics.customers SET tier = 1;',
    businessIntent: 'Reset every customer to the base tier ahead of the pricing migration.',
    riskTier: 'MEDIUM',
    targetEntities: [],
  });
  assert.equal(result.isDestructive, true);
  assert.equal(result.allowed, false);
});

// ---------------------------------------------------------------------------
// Regression: the harness config must load into the engine that consumes it
//
// scripts/gates-engine.js loadGatesConfig() reads ONLY a top-level `gates`
// array of rules carrying a `pattern` string, and compiles each with
// new RegExp(pattern) — no flags. The config previously shipped a
// `patterns`/`regex` shape, so loadOne() returned nothing and the harness
// contributed ZERO rules: the advertised pre-action enforcement was entirely
// inactive while looking configured.
//
// Note both halves are load-bearing. matchGate() wraps compilation in a
// try/catch that swallows a bad pattern into "no match", so an inline (?i)
// flag — invalid in JS RegExp — would also leave a correctly-shaped gate
// permanently inert. These tests therefore assert the rules FIRE, not merely
// that they load.
// ---------------------------------------------------------------------------

const { loadGatesConfig, matchesGate } = require('../scripts/gates-engine');

function loadSimatreeGates() {
  const configDir = path.join(__dirname, '..', 'config', 'gates');
  const cfg = loadGatesConfig(
    path.join(configDir, 'default.json'),
    path.join(configDir, 'simatree-data-governance.json')
  );
  return Object.fromEntries(
    cfg.gates.filter((g) => String(g.id || '').startsWith('simatree-')).map((g) => [g.id, g])
  );
}

test('simatree gate config: the runtime loader actually picks up the rules', () => {
  const raw = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '..', 'config', 'gates', 'simatree-data-governance.json'),
      'utf8'
    )
  );
  assert.ok(
    Array.isArray(raw.gates),
    'config must expose a top-level `gates` array — loadGatesConfig reads nothing else'
  );
  assert.ok(
    raw.gates.every((g) => typeof g.pattern === 'string' && g.pattern.length > 0),
    'each rule must carry a `pattern` string; a `regex` key is invisible to the loader'
  );
  for (const g of raw.gates) {
    assert.doesNotThrow(
      () => new RegExp(g.pattern),
      `pattern for ${g.id} must compile with new RegExp and no flags — matchGate swallows a throw into "no match"`
    );
    assert.ok(
      !g.pattern.includes('(?i)'),
      `${g.id}: inline (?i) is invalid in JS RegExp; spell case-insensitivity out as character classes`
    );
  }

  const loaded = loadSimatreeGates();
  assert.deepEqual(
    Object.keys(loaded).sort(),
    ['simatree-destructive-sql', 'simatree-missing-intent'],
    'both Simatree rules must reach the engine'
  );
});

test('simatree gate config: destructive-SQL rule fires on qualified names, not on reads', () => {
  const gate = loadSimatreeGates()['simatree-destructive-sql'];
  assert.ok(gate, 'destructive-sql gate must load');
  assert.equal(gate.action, 'block');

  for (const command of [
    'DELETE FROM analytics.customers;',
    'DELETE FROM `proj.ds.customers`;',
    'DELETE FROM "analytics"."customers";',
    'DELETE FROM [dbo].[Customers];',
    'DROP TABLE analytics.customers',
    'drop table analytics.customers',
    'TRUNCATE TABLE staging.logs',
  ]) {
    assert.equal(matchesGate(gate, 'Bash', { command }), true, `must fire on: ${command}`);
  }

  for (const command of [
    'SELECT * FROM analytics.customers',
    'npm test',
  ]) {
    assert.equal(matchesGate(gate, 'Bash', { command }), false, `must stay quiet on: ${command}`);
  }
});

test('simatree gate config: missing-intent rule fires on placeholder intents only', () => {
  const gate = loadSimatreeGates()['simatree-missing-intent'];
  assert.ok(gate, 'missing-intent gate must load');

  assert.equal(matchesGate(gate, 'Bash', { command: 'psql -f m.sql # intent: test' }), true);
  assert.equal(matchesGate(gate, 'Bash', { command: 'psql -f m.sql # INTENT: ASAP' }), true);
  assert.equal(
    matchesGate(gate, 'Bash', {
      command: 'psql -f m.sql # intent: quarterly GDPR erasure of opted-out EU rows',
    }),
    false
  );
});
