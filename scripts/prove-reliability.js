#!/usr/bin/env node
'use strict';

/**
 * prove-reliability.js — CI/self-heal proof lane for Antithesis-style exploration.
 *
 * Fixed seed + bounded iterations so the lane is deterministic and cheap.
 * Exit 0 only when zero invariant violations.
 *
 * High-ROI: moves harness bugs from production agent sessions (Scenario #2)
 * to pre-merge proof (Scenario #1). See docs/AUTONOMOUS_RELIABILITY_EXPLORER.md.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  exploreReliability,
  formatExplorerReport,
  writeReport,
  promoteFindings,
} = require('./autonomous-reliability-explorer');

const ROOT = path.join(__dirname, '..');
const DEFAULT_SEED = 42;
const DEFAULT_ITERATIONS = 10;

function resolveProofDir(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.THUMBGATE_PROOF_DIR) return path.resolve(process.env.THUMBGATE_PROOF_DIR);
  if (process.env.THUMBGATE_RELIABILITY_PROOF_DIR) {
    return path.resolve(process.env.THUMBGATE_RELIABILITY_PROOF_DIR);
  }
  return path.join(ROOT, 'proof');
}

function proveReliability(options = {}) {
  const seed = options.seed != null ? Number(options.seed) : DEFAULT_SEED;
  const iterations = options.iterations != null
    ? Number(options.iterations)
    : DEFAULT_ITERATIONS;
  const proofDir = resolveProofDir(options.proofDir);
  const promote = options.promote !== false;

  const report = exploreReliability({
    seed,
    iterations,
    checkReplay: options.checkReplay !== false,
  });

  const paths = writeReport(report, proofDir);
  let promotion = null;
  if (promote && report.findings.length > 0) {
    promotion = promoteFindings(report, { outDir: proofDir });
    report.promotion = promotion;
    writeReport(report, proofDir);
  }

  const proof = {
    phase: 'autonomous-reliability-explorer',
    generatedAt: new Date().toISOString(),
    seed,
    iterations,
    passed: Boolean(report.summary?.passed),
    violations: report.summary?.violations ?? report.findings.length,
    byInvariant: report.summary?.byInvariant || {},
    reproduction: report.reproduction,
    rca: report.rca || [],
    promotion,
    artifacts: {
      reportJson: paths.jsonPath,
      reportMd: paths.mdPath,
    },
  };

  const proofJson = path.join(proofDir, 'reliability-proof.json');
  const proofMd = path.join(proofDir, 'reliability-proof.md');
  fs.mkdirSync(proofDir, { recursive: true });
  fs.writeFileSync(proofJson, JSON.stringify(proof, null, 2));
  fs.writeFileSync(
    proofMd,
    [
      '# Reliability proof (Antithesis-style)',
      '',
      `- **Status:** ${proof.passed ? 'PASS' : 'FAIL'}`,
      `- **Seed:** ${seed}`,
      `- **Iterations:** ${iterations}`,
      `- **Violations:** ${proof.violations}`,
      '',
      '## Reproduction',
      '',
      '```bash',
      proof.reproduction?.command || `node scripts/autonomous-reliability-explorer.js --seed=${seed}`,
      '```',
      '',
      formatExplorerReport(report),
      '',
    ].join('\n'),
  );

  proof.artifacts.proofJson = proofJson;
  proof.artifacts.proofMd = proofMd;
  return proof;
}

function parseArgs(argv = process.argv.slice(2)) {
  const opts = {};
  for (const a of argv) {
    if (a.startsWith('--seed=')) opts.seed = Number(a.slice(7));
    else if (a.startsWith('--iterations=')) opts.iterations = Number(a.slice(13));
    else if (a.startsWith('--out=') || a.startsWith('--proof-dir=')) {
      opts.proofDir = a.includes('proof-dir') ? a.slice(12) : a.slice(6);
    } else if (a === '--no-promote') opts.promote = false;
  }
  if (process.env.THUMBGATE_RELIABILITY_SEED) {
    opts.seed = Number(process.env.THUMBGATE_RELIABILITY_SEED);
  }
  if (process.env.THUMBGATE_RELIABILITY_ITERATIONS) {
    opts.iterations = Number(process.env.THUMBGATE_RELIABILITY_ITERATIONS);
  }
  return opts;
}

function isMain() {
  return process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
}

if (isMain()) {
  const proof = proveReliability(parseArgs());
  console.log(fs.readFileSync(proof.artifacts.proofMd, 'utf8'));
  console.log(`Wrote ${proof.artifacts.proofJson}`);
  // Explicit exit so npm/CI never treat FAIL as success under pipe/async noise
  process.exit(proof.passed ? 0 : 1);
}

module.exports = {
  proveReliability,
  DEFAULT_SEED,
  DEFAULT_ITERATIONS,
  resolveProofDir,
};
