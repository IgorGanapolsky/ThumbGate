#!/usr/bin/env node
'use strict';

/**
 * Gate Coherence Analyzer — detects pseudo-unification across enforcement layers.
 *
 * Inspired by "Pseudo-Unification: Entropy Probing Reveals Divergent Information
 * Patterns in Unified Multimodal Models" (Yang et al., 2026). Shared parameters
 * don't guarantee consistent information flow — same applies to gates.
 *
 * ThumbGate has multiple enforcement layers (prevention rules, spec gates,
 * decision traces). This module checks whether they behave coherently:
 *
 *   1. Cross-layer contradiction detection: finds inputs where one layer
 *      blocks and another allows.
 *   2. Coverage gap analysis: identifies inputs that no layer evaluates.
 *   3. Coherence score: single metric for enforcement-layer alignment.
 */

const path = require('node:path');
const { evaluateAction, loadSpecDir, allSpecsToGateConfigs } = require('./spec-gate');

// ---------------------------------------------------------------------------
// Probe Definition
// ---------------------------------------------------------------------------

/**
 * A probe is a synthetic input used to test enforcement-layer behavior.
 * Each probe has an expected safety classification (dangerous/safe/ambiguous).
 */
function createProbe(id, input, expectedClass) {
  return {
    id,
    input: {
      tool: input.tool || null,
      command: input.command || null,
      content: input.content || null,
      action: input.action || null,
      sessionActions: input.sessionActions || [],
    },
    expectedClass, // 'dangerous', 'safe', or 'ambiguous'
  };
}

/**
 * Built-in probes covering the full threat surface.
 */
function getDefaultProbes() {
  return [
    // Dangerous — must be blocked
    createProbe('force-push', { command: 'git push --force origin main' }, 'dangerous'),
    createProbe('force-push-short', { command: 'git push -f origin main' }, 'dangerous'),
    createProbe('hard-reset', { command: 'git reset --hard HEAD~3' }, 'dangerous'),
    createProbe('rm-rf-root', { command: 'rm -rf /' }, 'dangerous'),
    createProbe('aws-key', { content: 'key = "AKIAIOSFODNN7EXAMPLE"' }, 'dangerous'),
    createProbe('github-pat', { content: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij' }, 'dangerous'),
    createProbe('private-key', { content: '-----BEGIN RSA PRIVATE KEY-----' }, 'dangerous'),
    createProbe('drop-table', { command: 'DROP TABLE users' }, 'dangerous'),
    createProbe('drop-database', { command: 'DROP DATABASE production' }, 'dangerous'),
    createProbe('no-verify', { command: 'git commit --no-verify -m "skip"' }, 'dangerous'),

    // Safe — must pass
    createProbe('safe-push', { command: 'git push origin main' }, 'safe'),
    createProbe('safe-commit', { command: 'git commit -m "fix: typo"' }, 'safe'),
    createProbe('npm-test', { command: 'npm test' }, 'safe'),
    createProbe('npm-lint', { command: 'npm run lint' }, 'safe'),
    createProbe('select-query', { command: 'SELECT * FROM users' }, 'safe'),
    createProbe('normal-code', { content: 'const greeting = "hello world";' }, 'safe'),
    createProbe('soft-reset', { command: 'git reset --soft HEAD~1' }, 'safe'),
    createProbe('stash', { command: 'git stash' }, 'safe'),

    // Ambiguous — near-miss territory
    createProbe('push-with-force-word', { command: 'echo "use force push carefully"' }, 'ambiguous'),
    createProbe('delete-branch', { command: 'git branch -D feature-old' }, 'ambiguous'),
  ];
}

// ---------------------------------------------------------------------------
// Layer Evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a probe against the spec-gate layer.
 */
function evaluateSpecLayer(specs, probe) {
  const result = evaluateAction(specs, probe.input);
  return {
    layerId: 'spec-gate',
    blocked: !result.allowed,
    blockedBy: result.blocked.map((b) => b.constraintId || b.invariantId),
    checkedCount: result.totalChecked,
  };
}

/**
 * Evaluate a probe against prevention-rule gate configs.
 * Gate configs are pattern-based blocking rules (from allSpecsToGateConfigs).
 */
function evaluateGateConfigLayer(gateConfigs, probe) {
  const input = buildCombined(probe.input);
  const matches = [];

  for (const gate of gateConfigs) {
    try {
      const regex = new RegExp(gate.pattern, 'i');
      if (regex.test(input)) {
        matches.push(gate.id);
      }
    } catch {
      // skip invalid patterns
    }
  }

  return {
    layerId: 'gate-config',
    blocked: matches.length > 0,
    blockedBy: matches,
    checkedCount: gateConfigs.length,
  };
}

// ---------------------------------------------------------------------------
// Cross-Layer Coherence
// ---------------------------------------------------------------------------

/**
 * Run all probes across all enforcement layers.
 * Returns per-probe results showing each layer's verdict.
 */
function analyzeCoherence(specs, gateConfigs, probes) {
  const results = [];

  for (const probe of probes) {
    const specResult = evaluateSpecLayer(specs, probe);
    const gateResult = evaluateGateConfigLayer(gateConfigs, probe);

    const layers = [specResult, gateResult];
    const verdicts = layers.map((l) => l.blocked);
    const allAgree = verdicts.every((v) => v === verdicts[0]);

    // Check alignment with expected class
    let expectedBlocked = null;
    if (probe.expectedClass === 'dangerous') expectedBlocked = true;
    else if (probe.expectedClass === 'safe') expectedBlocked = false;
    // 'ambiguous' has no expected verdict

    let classification = 'coherent';
    if (!allAgree) {
      classification = 'contradiction';
    } else if (expectedBlocked !== null && verdicts[0] !== expectedBlocked) {
      classification = probe.expectedClass === 'dangerous' ? 'gap' : 'false-positive';
    }

    results.push({
      probeId: probe.id,
      expectedClass: probe.expectedClass,
      classification,
      layers,
      allAgree,
    });
  }

  return results;
}

/**
 * Compute coherence metrics from probe results.
 */
function computeCoherenceMetrics(probeResults) {
  const total = probeResults.length;
  const coherent = probeResults.filter((r) => r.classification === 'coherent').length;
  const contradictions = probeResults.filter((r) => r.classification === 'contradiction');
  const gaps = probeResults.filter((r) => r.classification === 'gap');
  const falsePositives = probeResults.filter((r) => r.classification === 'false-positive');

  const coherenceScore = total > 0 ? Math.round((coherent / total) * 100) : 0;

  let grade = 'unified';
  if (contradictions.length > 0 || gaps.length > 0) grade = 'divergent';
  else if (falsePositives.length > 0) grade = 'over-blocking';

  return {
    totalProbes: total,
    coherent,
    contradictions: contradictions.length,
    gaps: gaps.length,
    falsePositives: falsePositives.length,
    coherenceScore,
    grade,
    contradictionDetails: contradictions.map(summarizeProbeResult),
    gapDetails: gaps.map(summarizeProbeResult),
    falsePositiveDetails: falsePositives.map(summarizeProbeResult),
  };
}

/**
 * Full coherence analysis: load specs, generate gate configs, run probes.
 */
function runCoherenceAnalysis(specDir, probes) {
  const specs = loadSpecDir(specDir);
  const gateConfigs = allSpecsToGateConfigs(specs);
  const activeProbes = probes || getDefaultProbes();
  const results = analyzeCoherence(specs, gateConfigs, activeProbes);
  return computeCoherenceMetrics(results);
}

// ---------------------------------------------------------------------------
// Coverage Analysis
// ---------------------------------------------------------------------------

/**
 * Analyze which constraint IDs are exercised by the probe set.
 * Returns uncovered constraints (blind spots).
 */
function analyzeCoverage(specs, probes) {
  const allConstraintIds = new Set();
  for (const spec of specs) {
    for (const c of spec.constraints) allConstraintIds.add(c.id);
    for (const inv of spec.invariants) allConstraintIds.add(inv.id);
  }

  const exercisedIds = new Set();
  for (const probe of probes) {
    const result = evaluateAction(specs, probe.input);
    for (const b of result.blocked) {
      exercisedIds.add(b.constraintId || b.invariantId);
    }
  }

  const uncovered = Array.from(allConstraintIds).filter((id) => !exercisedIds.has(id));

  return {
    totalConstraints: allConstraintIds.size,
    exercised: exercisedIds.size,
    uncovered: uncovered.length,
    uncoveredIds: uncovered,
    coverageRate: allConstraintIds.size > 0
      ? Math.round((exercisedIds.size / allConstraintIds.size) * 100)
      : 100,
  };
}

// ---------------------------------------------------------------------------
// Format Output
// ---------------------------------------------------------------------------

function formatCoherenceReport(metrics, coverage) {
  const lines = [];
  lines.push(`Coherence Grade: ${metrics.grade.toUpperCase()}`);
  lines.push(`Coherence Score: ${metrics.coherenceScore}%`);
  lines.push(`Probes: ${metrics.totalProbes} total | ${metrics.coherent} coherent | ${metrics.contradictions} contradictions | ${metrics.gaps} gaps | ${metrics.falsePositives} false-positives`);

  if (coverage) {
    lines.push('');
    lines.push(`Coverage: ${coverage.coverageRate}% (${coverage.exercised}/${coverage.totalConstraints} constraints exercised)`);
    if (coverage.uncoveredIds.length > 0) {
      lines.push(`Uncovered: ${coverage.uncoveredIds.join(', ')}`);
    }
  }

  if (metrics.contradictionDetails.length > 0) {
    lines.push('');
    lines.push('Contradictions:');
    for (const d of metrics.contradictionDetails) {
      lines.push(`  - ${d.probeId} (${d.expectedClass}): ${d.layerSummary}`);
    }
  }

  if (metrics.gapDetails.length > 0) {
    lines.push('');
    lines.push('Coverage Gaps:');
    for (const d of metrics.gapDetails) {
      lines.push(`  - ${d.probeId}: expected block, all layers passed`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCombined(input) {
  return [input.command, input.content, input.tool].filter(Boolean).join(' ');
}

function summarizeProbeResult(r) {
  return {
    probeId: r.probeId,
    expectedClass: r.expectedClass,
    classification: r.classification,
    layerSummary: r.layers.map((l) => `${l.layerId}:${l.blocked ? 'BLOCK' : 'PASS'}`).join(' | '),
  };
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
  const specDir = process.argv[3] || path.join(__dirname, '..', 'config', 'specs');

  if (command === 'check') {
    const specs = loadSpecDir(specDir);
    const gateConfigs = allSpecsToGateConfigs(specs);
    const probes = getDefaultProbes();
    const results = analyzeCoherence(specs, gateConfigs, probes);
    const metrics = computeCoherenceMetrics(results);
    const coverage = analyzeCoverage(specs, probes);
    console.log(formatCoherenceReport(metrics, coverage));
    process.exit(metrics.grade === 'unified' ? 0 : 1);
  } else if (command === 'json') {
    const specs = loadSpecDir(specDir);
    const gateConfigs = allSpecsToGateConfigs(specs);
    const probes = getDefaultProbes();
    const results = analyzeCoherence(specs, gateConfigs, probes);
    const metrics = computeCoherenceMetrics(results);
    const coverage = analyzeCoverage(specs, probes);
    console.log(JSON.stringify({ metrics, coverage }, null, 2));
  } else {
    console.error(`Unknown command: ${command}. Use: check, json`);
    process.exit(1);
  }
}

module.exports = {
  analyzeCoverage,
  analyzeCoherence,
  computeCoherenceMetrics,
  createProbe,
  evaluateGateConfigLayer,
  evaluateSpecLayer,
  formatCoherenceReport,
  getDefaultProbes,
  runCoherenceAnalysis,
};
