#!/usr/bin/env node
'use strict';

/**
 * Spec Gate — proactive correctness enforcement for agent actions.
 *
 * Prevention rules are reactive (learned from past failures). Spec gates are
 * proactive: operators define "correct" upfront as a lightweight spec, and
 * gates enforce it from the start of a session.
 *
 * Spec format (JSON):
 *   {
 *     "name": "deployment-safety",
 *     "constraints": [
 *       { "id": "no-force-push", "scope": "bash", "deny": "git push -f|--force", "reason": "..." },
 *       { "id": "no-secrets", "scope": "content", "deny": "AKIA[A-Z0-9]{16}", "reason": "..." }
 *     ],
 *     "invariants": [
 *       { "id": "tests-pass", "require": "npm test", "before": "git commit", "reason": "..." }
 *     ]
 *   }
 *
 * Integration: feeds into gates-engine as an additive spec layer alongside
 * default gates and auto-promoted prevention rules.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { readJsonl, appendJsonl, ensureParentDir } = require('./fs-utils');
const { resolveFeedbackDir } = require('./feedback-paths');

const SPEC_DIR = path.join(__dirname, '..', 'config', 'specs');
const SPEC_AUDIT_FILE = 'spec-gate-audit.jsonl';

// ---------------------------------------------------------------------------
// Spec Loading
// ---------------------------------------------------------------------------

function loadSpec(specPath) {
  const resolved = path.resolve(specPath);
  const raw = fs.readFileSync(resolved, 'utf8');
  const spec = JSON.parse(raw);
  return validateSpec(spec, resolved);
}

function loadSpecDir(dirPath = SPEC_DIR) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return loadSpec(path.join(dirPath, f));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function validateSpec(spec, sourcePath = null) {
  if (!spec || typeof spec !== 'object') {
    throw new Error('Spec must be a JSON object.');
  }
  const name = normalizeText(spec.name, 120);
  if (!name) throw new Error('Spec requires a "name" field.');

  const constraints = Array.isArray(spec.constraints)
    ? spec.constraints.map((c) => validateConstraint(c)).filter(Boolean)
    : [];
  const invariants = Array.isArray(spec.invariants)
    ? spec.invariants.map((inv) => validateInvariant(inv)).filter(Boolean)
    : [];

  if (constraints.length === 0 && invariants.length === 0) {
    throw new Error('Spec must have at least one constraint or invariant.');
  }

  return {
    name,
    description: normalizeText(spec.description, 500) || '',
    version: normalizeText(spec.version, 20) || '1',
    sourcePath: sourcePath || null,
    constraints,
    invariants,
  };
}

function validateConstraint(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = normalizeText(raw.id, 80);
  const deny = normalizeText(raw.deny, 500);
  if (!id || !deny) return null;

  return {
    id,
    scope: normalizeText(raw.scope, 40) || 'any',
    deny,
    reason: normalizeText(raw.reason, 500) || 'Blocked by spec constraint.',
    severity: normalizeSeverity(raw.severity),
  };
}

function validateInvariant(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = normalizeText(raw.id, 80);
  const require_ = normalizeText(raw.require, 200);
  const before = normalizeText(raw.before, 200);
  if (!id || !require_ || !before) return null;

  return {
    id,
    require: require_,
    before,
    reason: normalizeText(raw.reason, 500) || 'Invariant not satisfied.',
    severity: normalizeSeverity(raw.severity),
  };
}

// ---------------------------------------------------------------------------
// Constraint Evaluation
// ---------------------------------------------------------------------------

function evaluateConstraints(spec, { tool, command, content } = {}) {
  const results = [];
  const input = buildEvaluationInput({ tool, command, content });

  for (const constraint of spec.constraints) {
    const matched = matchConstraint(constraint, input);
    results.push({
      specName: spec.name,
      constraintId: constraint.id,
      type: 'constraint',
      passed: !matched,
      reason: matched ? constraint.reason : null,
      severity: constraint.severity,
    });
  }

  return results;
}

function evaluateInvariants(spec, { action, sessionActions = [] } = {}) {
  const results = [];

  for (const inv of spec.invariants) {
    if (!actionMatches(action, inv.before)) continue;
    const satisfied = sessionActions.some((a) => actionMatches(a, inv.require));
    results.push({
      specName: spec.name,
      invariantId: inv.id,
      type: 'invariant',
      passed: satisfied,
      reason: satisfied ? null : inv.reason,
      severity: inv.severity,
    });
  }

  return results;
}

function evaluateAction(specs, context = {}) {
  const allResults = [];

  for (const spec of specs) {
    const constraintResults = evaluateConstraints(spec, context);
    const invariantResults = evaluateInvariants(spec, context);
    allResults.push(...constraintResults, ...invariantResults);
  }

  const blocked = allResults.filter((r) => !r.passed);
  return {
    allowed: blocked.length === 0,
    results: allResults,
    blocked,
    blockedCount: blocked.length,
    totalChecked: allResults.length,
    evaluatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Gate Config Generation
// ---------------------------------------------------------------------------

function specToGateConfigs(spec) {
  return spec.constraints.map((c) => ({
    id: `spec:${spec.name}:${c.id}`,
    layer: 'Spec',
    pattern: c.deny,
    action: 'block',
    message: `[Spec: ${spec.name}] ${c.reason}`,
    severity: c.severity,
    source: 'spec',
    specName: spec.name,
    specVersion: spec.version,
  }));
}

function allSpecsToGateConfigs(specs) {
  return specs.flatMap(specToGateConfigs);
}

// ---------------------------------------------------------------------------
// Audit Trail
// ---------------------------------------------------------------------------

function getAuditPath({ feedbackDir } = {}) {
  const dir = feedbackDir || resolveFeedbackDir();
  return path.join(dir, SPEC_AUDIT_FILE);
}

function recordSpecAudit(evaluation, context = {}, options = {}) {
  const entry = {
    id: `specaudit_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    timestamp: new Date().toISOString(),
    allowed: evaluation.allowed,
    blockedCount: evaluation.blockedCount,
    totalChecked: evaluation.totalChecked,
    blocked: evaluation.blocked,
    tool: context.tool || null,
    command: normalizeText(context.command, 200) || null,
    action: normalizeText(context.action, 200) || null,
  };
  appendJsonl(getAuditPath(options), entry);
  return entry;
}

function loadSpecAudit(options = {}) {
  return readJsonl(getAuditPath(options));
}

function summarizeSpecAudit(entries) {
  let totalChecks = 0;
  let totalBlocked = 0;
  const bySpec = new Map();
  const byConstraint = new Map();

  for (const entry of entries) {
    totalChecks += entry.totalChecked || 0;
    totalBlocked += entry.blockedCount || 0;
    for (const block of entry.blocked || []) {
      const specKey = block.specName || 'unknown';
      bySpec.set(specKey, (bySpec.get(specKey) || 0) + 1);
      const cKey = block.constraintId || block.invariantId || 'unknown';
      byConstraint.set(cKey, (byConstraint.get(cKey) || 0) + 1);
    }
  }

  return {
    totalEvaluations: entries.length,
    totalChecks,
    totalBlocked,
    blockRate: entries.length > 0 ? Math.round((totalBlocked / Math.max(totalChecks, 1)) * 100) : 0,
    topBlockedSpecs: Array.from(bySpec.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([name, count]) => ({ name, count })),
    topBlockedConstraints: Array.from(byConstraint.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([id, count]) => ({ id, count })),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildEvaluationInput({ tool, command, content } = {}) {
  return {
    bash: normalizeText(command, 2000) || '',
    content: normalizeText(content, 5000) || '',
    tool: normalizeText(tool, 80) || '',
    combined: [command, content, tool].filter(Boolean).join(' '),
  };
}

function matchConstraint(constraint, input) {
  try {
    const regex = new RegExp(constraint.deny, 'i');
    const scope = constraint.scope || 'any';
    if (scope === 'bash') return regex.test(input.bash);
    if (scope === 'content') return regex.test(input.content);
    if (scope === 'tool') return regex.test(input.tool);
    return regex.test(input.combined);
  } catch {
    return false;
  }
}

function actionMatches(action, pattern) {
  if (!action || !pattern) return false;
  try {
    return new RegExp(pattern, 'i').test(String(action));
  } catch {
    return String(action).toLowerCase().includes(String(pattern).toLowerCase());
  }
}

function normalizeText(value, maxLength = 500) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizeSeverity(value) {
  const valid = ['critical', 'warning', 'info'];
  const normalized = normalizeText(value, 20);
  return normalized && valid.includes(normalized) ? normalized : 'critical';
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function isCliInvocation(argv = process.argv) {
  const invokedPath = argv[1];
  return invokedPath ? path.resolve(invokedPath) === __filename : false;
}

if (isCliInvocation()) {
  const command = process.argv[2] || 'check';
  const specDir = process.argv[3] || SPEC_DIR;

  if (command === 'check') {
    const specs = loadSpecDir(specDir);
    console.log(JSON.stringify({
      specsLoaded: specs.length,
      totalConstraints: specs.reduce((n, s) => n + s.constraints.length, 0),
      totalInvariants: specs.reduce((n, s) => n + s.invariants.length, 0),
      specs: specs.map((s) => ({ name: s.name, version: s.version, constraints: s.constraints.length, invariants: s.invariants.length })),
    }, null, 2));
  } else if (command === 'gates') {
    const specs = loadSpecDir(specDir);
    const gates = allSpecsToGateConfigs(specs);
    console.log(JSON.stringify({ version: 1, gates }, null, 2));
  } else if (command === 'audit') {
    const entries = loadSpecAudit();
    console.log(JSON.stringify(summarizeSpecAudit(entries), null, 2));
  } else {
    console.error(`Unknown command: ${command}. Use: check, gates, audit`);
    process.exit(1);
  }
}

module.exports = {
  SPEC_DIR,
  allSpecsToGateConfigs,
  evaluateAction,
  evaluateConstraints,
  evaluateInvariants,
  loadSpec,
  loadSpecAudit,
  loadSpecDir,
  recordSpecAudit,
  specToGateConfigs,
  summarizeSpecAudit,
  validateSpec,
};
