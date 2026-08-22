#!/usr/bin/env node

/**
 * ThumbGate — Simatree Enterprise Data Lifecycle & BI Governance Engine
 *
 * Inspired by Wesley Flores (Managing Partner at Simatree, Top 25 Information Manager,
 * Computerworld Best Practices BI Leader).
 *
 * Core Principles:
 * 1. "Why Before How" — Data operations require explicit business intent and rollback receipts.
 * 2. Full Lifecycle Data Governance — Interdicts unverified schema/table mutations, lakehouse drops,
 *    and ungrounded batch modifications across BigQuery, Snowflake, Databricks, and Postgres.
 * 3. Bayesian Uncertainty Estimation — Computes statistical posterior confidence bounds before
 *    AI data agents dispatch queries or mutations against enterprise analytics tables.
 * 4. PMO Transformation Gates — Validates multi-stage IT modernization milestones with verifiable receipts.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * One part of a SQL object name, in every form the advertised warehouses emit:
 * a bare identifier (`customers`), a double-quoted one (Postgres/Snowflake),
 * a backtick-quoted one (BigQuery/Databricks — note it may contain dots and
 * hyphens, as in `prod-project.analytics.customers`), or a bracketed one
 * (SQL Server, `[dbo]`).
 */
const SQL_IDENT_PART = '(?:[\\w$]+|"[^"]+"|`[^`]+`|\\[[^\\]]+\\])';

/**
 * A possibly schema- or project-qualified table reference: one or more parts
 * joined by dots.
 *
 * WHY THIS IS NOT `\w+`: `\w+` matches only the single-part form. With it,
 * `DELETE FROM analytics.customers;` failed the destructive test entirely and
 * received an authorized receipt with no rollback plan, no risk tier and no
 * declared targetEntities — the exact full-table deletion this gate exists to
 * stop. Every qualified and quoted form was equally invisible.
 */
const QUALIFIED_TABLE = `${SQL_IDENT_PART}(?:\\s*\\.\\s*${SQL_IDENT_PART})*`;

const DESTRUCTIVE_SQL_PATTERNS = [
  /\bDROP\s+(TABLE|DATABASE|SCHEMA|VIEW|INDEX)\b/i,
  /\bTRUNCATE\s+(TABLE)?\b/i,
  /\bALTER\s+TABLE\s+.*\b(DROP\s+COLUMN|RENAME\s+TO)\b/i,
  new RegExp(`\\bDELETE\\s+FROM\\s+${QUALIFIED_TABLE}(\\s+WHERE\\s+(1=1|TRUE))?\\s*;?$`, 'i'),
  // An UPDATE with no WHERE clause rewrites every row. The previous form put the
  // negative lookahead after `.*`, where backtracking always satisfies it, so the
  // clause was inert and the pattern reduced to "any UPDATE ... SET".
  new RegExp(`\\bUPDATE\\s+${QUALIFIED_TABLE}\\s+SET\\b(?![\\s\\S]*\\bWHERE\\b)`, 'i'),
];

const LOW_SIGNAL_INTENT_PATTERNS = [
  /^(test|testing|fix|update|clean|temp|misc|stuff|run|do it|asap)$/i,
  /^(as per request|needed|required|ticket|todo)$/i,
];

/**
 * Evaluates whether a data mutation complies with the "Why Before How" intent mandate.
 *
 * @param {Object} payload
 * @param {string} payload.sql - SQL statement or data operation command
 * @param {string} [payload.businessIntent] - Explicit rationale for the operation
 * @param {string} [payload.riskTier] - 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
 * @param {Array<string>} [payload.targetEntities] - Target tables/views
 * @param {Object} [payload.rollbackPlan] - Defined rollback procedure or snapshot ID
 * @returns {Object} Evaluation verdict and telemetry
 */
function evaluateDataLifecycleIntent(payload = {}) {
  const sql = String(payload.sql || '').trim();
  const businessIntent = String(payload.businessIntent || '').trim();
  const riskTier = String(payload.riskTier || 'MEDIUM').toUpperCase();
  const targetEntities = Array.isArray(payload.targetEntities) ? payload.targetEntities : [];
  const rollbackPlan = payload.rollbackPlan && typeof payload.rollbackPlan === 'object' ? payload.rollbackPlan : null;

  const violations = [];
  let isDestructive = false;

  for (const pattern of DESTRUCTIVE_SQL_PATTERNS) {
    if (pattern.test(sql)) {
      isDestructive = true;
      break;
    }
  }

  // 1. Intent check
  if (!businessIntent) {
    violations.push('MISSING_BUSINESS_INTENT: Data operations require an explicit "why" before execution.');
  } else if (businessIntent.length < 15 || LOW_SIGNAL_INTENT_PATTERNS.some((p) => p.test(businessIntent))) {
    violations.push(`INSUFFICIENT_BUSINESS_INTENT: Intent "${businessIntent}" lacks context-grounded rationale.`);
  }

  // 2. Destructive SQL checks
  if (isDestructive) {
    if (!rollbackPlan || !rollbackPlan.snapshotId) {
      violations.push('DESTRUCTIVE_MUTATION_WITHOUT_ROLLBACK: Destructive SQL requires a verified snapshotId or restore receipt.');
    }
    if (riskTier !== 'HIGH' && riskTier !== 'CRITICAL') {
      violations.push('INVALID_RISK_TIER: Destructive operations must be classified as HIGH or CRITICAL risk.');
    }
    if (targetEntities.length === 0) {
      violations.push('UNSPECIFIED_TARGET_ENTITIES: Destructive operations must declare explicit targetEntities.');
    }
  }

  const allowed = violations.length === 0;
  const score = Math.max(0, 100 - (violations.length * 35));

  return {
    allowed,
    score,
    isDestructive,
    intentValidated: Boolean(businessIntent && businessIntent.length >= 15),
    riskTier,
    targetEntities,
    violations,
    receipt: allowed ? {
      gate: 'simatree-data-governance',
      timestamp: new Date().toISOString(),
      intent: businessIntent,
      entities: targetEntities,
      authorized: true,
    } : null,
  };
}

/**
 * Estimates Bayesian uncertainty and posterior confidence bounds for AI data queries.
 *
 * @param {Object} metrics
 * @param {number} [metrics.sampleSize=100] - Number of historical benchmark runs
 * @param {number} [metrics.priorSuccessRate=0.95] - Prior probability of successful execution (0-1)
 * @param {number} [metrics.observedFailures=0] - Observed anomalies or schema drift incidents
 * @param {number} [metrics.schemaDriftScore=0.0] - Drift score between 0.0 (pristine) and 1.0 (corrupted)
 * @param {number} [metrics.uncertaintyThreshold=0.20] - Max tolerable posterior uncertainty (0-1)
 * @returns {Object} Bayesian posterior metrics and safety gate verdict
 */
function estimateBayesianUncertainty(metrics = {}) {
  const sampleSize = Math.max(1, Number(metrics.sampleSize) || 100);
  const priorSuccess = Math.min(1, Math.max(0.1, Number(metrics.priorSuccessRate) || 0.95));
  const observedFailures = Math.max(0, Number(metrics.observedFailures) || 0);
  const schemaDriftScore = Math.min(1, Math.max(0, Number(metrics.schemaDriftScore) || 0.0));
  const threshold = Number(metrics.uncertaintyThreshold) || 0.20;

  // Beta distribution update (Beta(alpha, beta))
  // Prior pseudo-counts: alpha_0 = priorSuccess * 10, beta_0 = (1 - priorSuccess) * 10
  const alpha0 = priorSuccess * 10;
  const beta0 = (1 - priorSuccess) * 10;

  const observedSuccesses = Math.max(0, sampleSize - observedFailures);
  const alphaPost = alpha0 + observedSuccesses;
  const betaPost = beta0 + observedFailures + (schemaDriftScore * 10);

  const posteriorMean = alphaPost / (alphaPost + betaPost);
  const posteriorVariance = (alphaPost * betaPost) / (Math.pow(alphaPost + betaPost, 2) * (alphaPost + betaPost + 1));
  const uncertainty = Math.min(1, Math.sqrt(posteriorVariance) * 3 + schemaDriftScore * 0.4);

  const safe = uncertainty <= threshold && posteriorMean >= 0.80;

  return {
    safe,
    posteriorMean: Number(posteriorMean.toFixed(4)),
    uncertainty: Number(uncertainty.toFixed(4)),
    threshold,
    schemaDriftScore,
    verdict: safe ? 'CONFIDENT_EXECUTION' : 'HIGH_UNCERTAINTY_INTERDICTED',
    recommendation: safe
      ? 'Execute data pipeline stage autonomously.'
      : 'Require operator escalation or rollback snapshot pre-execution.',
  };
}

/**
 * Validates PMO transformation stages for enterprise data architectures.
 *
 * @param {Object} plan - Multi-stage transformation plan
 * @param {Array<Object>} plan.stages - Sequence of milestone stages
 * @returns {Object} PMO compliance audit result
 */
function auditPMOTransformationGate(plan = {}) {
  const stages = Array.isArray(plan.stages) ? plan.stages : [];
  const findings = [];

  if (stages.length === 0) {
    return {
      compliant: false,
      score: 0,
      findings: ['PLAN_EMPTY: Transformation plan contains no actionable milestone stages.'],
    };
  }

  stages.forEach((stage, idx) => {
    const stageId = stage.id || `stage_${idx + 1}`;
    if (!stage.name) {
      findings.push(`${stageId}: Missing stage name.`);
    }
    if (!stage.outcomeMetric) {
      findings.push(`${stageId}: Missing measurable outcomeMetric.`);
    }
    if (!stage.rollbackReceipt && stage.isMutating) {
      findings.push(`${stageId}: Mutating stage lacks verifiable rollbackReceipt.`);
    }
    if (!stage.owner) {
      findings.push(`${stageId}: Missing assigned stakeholder / owner.`);
    }
  });

  const compliant = findings.length === 0;
  const score = Math.max(0, 100 - (findings.length * 20));

  return {
    compliant,
    score,
    totalStages: stages.length,
    findings,
  };
}

/**
 * Doctor check verifying runtime integrity.
 */
function checkDoctor() {
  const sampleEvaluation = evaluateDataLifecycleIntent({
    sql: 'SELECT customer_id, revenue FROM analytics.sales_monthly WHERE year = 2026',
    businessIntent: 'Monthly recurring revenue cohort analysis for Q3 executive review.',
    riskTier: 'LOW',
    targetEntities: ['analytics.sales_monthly'],
  });

  const sampleBayesian = estimateBayesianUncertainty({
    sampleSize: 200,
    priorSuccessRate: 0.98,
    observedFailures: 1,
    schemaDriftScore: 0.02,
  });

  const samplePMO = auditPMOTransformationGate({
    stages: [
      {
        id: 'STAGE_1',
        name: 'Lakehouse Ingestion Validation',
        outcomeMetric: 'zero_schema_mismatch',
        owner: 'data-engineering',
        isMutating: false,
      },
    ],
  });

  const ok = sampleEvaluation.allowed && sampleBayesian.safe && samplePMO.compliant;

  return {
    ok,
    name: 'simatree-data-governance',
    version: '1.35.0',
    evaluator: sampleEvaluation.allowed ? 'ONLINE' : 'ERROR',
    bayesianModel: sampleBayesian.safe ? 'ONLINE' : 'ERROR',
    pmoGate: samplePMO.compliant ? 'ONLINE' : 'ERROR',
    timestamp: new Date().toISOString(),
  };
}

// CLI Interface
// Path-based main check: the `require.main === module` form trips SonarCloud S3403.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const args = process.argv.slice(2);

  if (args.includes('--doctor')) {
    const report = checkDoctor();
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  }

  if (args.includes('--eval')) {
    const evalIdx = args.indexOf('--eval');
    const input = args[evalIdx + 1] || '{}';
    try {
      const payload = JSON.parse(input);
      const res = evaluateDataLifecycleIntent(payload);
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.allowed ? 0 : 1);
    } catch (err) {
      console.error(`Invalid JSON input: ${err.message}`);
      process.exit(1);
    }
  }

  if (args.includes('--sql')) {
    const sqlIdx = args.indexOf('--sql');
    const sql = args[sqlIdx + 1] || '';
    const whyIdx = args.indexOf('--why');
    const why = whyIdx !== -1 ? args[whyIdx + 1] : '';

    const res = evaluateDataLifecycleIntent({
      sql,
      businessIntent: why,
      targetEntities: ['unspecified'],
    });

    console.log(JSON.stringify(res, null, 2));
    process.exit(res.allowed ? 0 : 1);
  }

  console.log('Usage: node scripts/simatree-data-governance.js [--doctor | --eval <json> | --sql <query> --why <intent>]');
  process.exit(0);
}

module.exports = {
  evaluateDataLifecycleIntent,
  estimateBayesianUncertainty,
  auditPMOTransformationGate,
  checkDoctor,
  DESTRUCTIVE_SQL_PATTERNS,
};
