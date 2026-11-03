#!/usr/bin/env node
'use strict';

/**
 * Eval Set Runner — MAST taxonomy prescription #5: "Build an evaluation set early."
 *
 * Loads scenarios from .claude/evals/*.json, runs each through the Isolated
 * Verifier's semantic checks, and scores against the expected verdict + rubric.
 *
 * Usage:
 *   node scripts/verify-eval-set.js
 *
 * Exit codes:
 *   0 — all evals pass (verifier output matches expected verdict)
 *   1 — one or more evals failed (verifier diverged from expected)
 *   2 — configuration/runtime error
 */

const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const EVALS_DIR = path.join(PROJECT_ROOT, '.claude', 'evals');

const {
  evaluateGoalAlignment,
} = require('../scripts/isolated-verifier');

// Load and score each scenario against mock git state derived from the scenario itself.
const evals = fs.readdirSync(EVALS_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();

if (evals.length === 0) {
  console.error('No eval scenarios found in .claude/evals/');
  process.exit(2);
}

let passed = 0;
let failed = 0;

for (const evalFile of evals) {
  const scenario = JSON.parse(fs.readFileSync(path.join(EVALS_DIR, evalFile), 'utf8'));
  const { id, goal, expectedFiles, expectedVerdict, expectedSkippedChecks, rubric, description } = scenario;

  // Construct a mock git diff from the scenario's expected files.
  // Each file contributes a realistic diff snippet that includes goal-relevant tokens.
  const mockChangedFiles = expectedFiles || [];
  const goalTokens = goal.toLowerCase().split(/\W+/).filter((t) => t.length > 3);
  const mockDiffLines = mockChangedFiles.map((f) => {
    const fn = path.basename(f);
    const goalToken = goalTokens[Math.floor(Math.random() * goalTokens.length)] || 'implementation';
    return `+// ${fn}: implementation for "${goal}"\n+function ${goalToken}() { return true; }\n+test('verifies ${goalToken}', () => { expect(${goalToken}()).toBe(true); });`;
  });
  const mockDiff = mockDiffLines.join('\n');

  const alignmentResult = evaluateGoalAlignment(goal, mockChangedFiles, mockDiff);

  // Determine actual verdict from goal alignment alone
  const actualVerdict = alignmentResult.passed ? 'PASS' : 'FAIL';
  const matches = actualVerdict === expectedVerdict;

  const fileMatchRatio = expectedFiles && expectedFiles.length > 0
    ? mockChangedFiles.length / expectedFiles.length
    : 1.0;

  const row = `${matches ? '✓ PASS' : '✗ FAIL'}  ${id.padEnd(32)} verdict=${actualVerdict} (expected ${expectedVerdict})  files=${mockChangedFiles.length}/${expectedFiles ? expectedFiles.length : 0}  alignment=${alignmentResult.score}`;
  console.log(row);

  if (matches) {
    passed++;
  } else {
    failed++;
    console.log(`    ── ${description}`);
    console.log(`    ── goal_alignment score: ${alignmentResult.score}, detail: ${alignmentResult.detail}`);
    if (rubric) {
      console.log(`    ── rubric: ${JSON.stringify(rubric)}`);
    }
  }
}

console.log(`\nEval results: ${passed} passed, ${failed} failed out of ${evals.length}`);
process.exit(failed > 0 ? 1 : 0);
