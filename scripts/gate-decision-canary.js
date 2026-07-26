#!/usr/bin/env node
'use strict';

/**
 * Gate decision canary — drift detection for enforcement behaviour.
 *
 * ThumbGate's production failure mode is QUIET. It decides whether tool calls are blocked,
 * so a regression does not throw: a gate either stops firing (under-blocking, i.e. a bypass)
 * or starts firing on everything (over-blocking). Neither raises an error, and neither shows
 * up in uptime or latency monitoring. The 2026-07-26 audit found 62 evasion holes in shipped
 * code — every one of them was a gate silently not firing, and nothing anywhere reported it.
 *
 * This is the missing control named in docs/RELEASE-ROLLBACK.md: compare the distribution of
 * gate decisions against a recorded baseline and fail loudly when it shifts.
 *
 * Adapted golden signals for a guardrail (latency/traffic/errors/saturation do not describe
 * this system):
 *   traffic   — total evaluations since baseline
 *   silence   — a gate that used to block and now never does  (bypass signature)
 *   spike     — a gate whose share of blocks jumps            (over-blocking signature)
 *   novelty   — a gate that appears or disappears entirely
 *
 * Usage:
 *   node scripts/gate-decision-canary.js --snapshot   # record the current state as baseline
 *   node scripts/gate-decision-canary.js --check      # compare now against baseline
 *   node scripts/gate-decision-canary.js --check --json
 *
 * Exit codes: 0 = no drift, 1 = drift detected, 2 = cannot evaluate (no baseline/stats).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = process.env.THUMBGATE_HOME || path.join(os.homedir(), '.thumbgate');
const STATS_PATH = process.env.THUMBGATE_STATS_PATH || path.join(HOME, 'gate-stats.json');
const BASELINE_PATH = process.env.THUMBGATE_CANARY_BASELINE || path.join(HOME, 'gate-canary-baseline.json');

// A gate needs to have blocked at least this many times in the baseline before its going
// silent is meaningful. Below this it is noise, not signal.
const MIN_BASELINE_BLOCKS = Number(process.env.THUMBGATE_CANARY_MIN_BLOCKS || 20);
// Minimum evaluations since baseline before a comparison means anything.
const MIN_TRAFFIC = Number(process.env.THUMBGATE_CANARY_MIN_TRAFFIC || 50);
// A gate's share of total blocks may move by this much before it is called a spike.
const SPIKE_RATIO = Number(process.env.THUMBGATE_CANARY_SPIKE_RATIO || 3);

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function gateTotals(stats) {
  const byGate = (stats && stats.byGate) || {};
  const out = {};
  for (const [id, counts] of Object.entries(byGate)) {
    out[id] = {
      blocked: Number((counts && counts.blocked) || 0),
      warned: Number((counts && counts.warned) || 0),
    };
  }
  return out;
}

function snapshot() {
  const stats = readJson(STATS_PATH);
  if (!stats) {
    process.stderr.write(`gate-decision-canary: no stats at ${STATS_PATH}\n`);
    return 2;
  }
  const baseline = {
    recordedAtMs: Date.now(),
    totalBlocked: Number(stats.blocked || 0),
    totalWarned: Number(stats.warned || 0),
    byGate: gateTotals(stats),
  };
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2));
  process.stdout.write(`Baseline recorded: ${Object.keys(baseline.byGate).length} gates, `
    + `${baseline.totalBlocked} blocked / ${baseline.totalWarned} warned -> ${BASELINE_PATH}\n`);
  return 0;
}

/**
 * Compare two stat sets. Exported so tests can drive it without touching the filesystem.
 */
function diffDecisions(baseline, current) {
  const findings = [];
  const baseGates = (baseline && baseline.byGate) || {};
  const curGates = gateTotals(current);

  const deltaBlocked = Number(current.blocked || 0) - Number(baseline.totalBlocked || 0);
  const deltaWarned = Number(current.warned || 0) - Number(baseline.totalWarned || 0);
  const traffic = deltaBlocked + deltaWarned;

  if (traffic < MIN_TRAFFIC) {
    return { traffic, deltaBlocked, deltaWarned, findings, evaluated: false };
  }

  for (const [id, base] of Object.entries(baseGates)) {
    const cur = curGates[id] || { blocked: 0, warned: 0 };
    const gateDelta = cur.blocked - base.blocked;

    // SILENCE: a gate that carried real volume and has now stopped blocking entirely while
    // the system kept working. This is what a bypass looks like from the outside.
    if (base.blocked >= MIN_BASELINE_BLOCKS && gateDelta === 0) {
      findings.push({
        kind: 'silent',
        gate: id,
        detail: `blocked ${base.blocked} times before baseline, 0 times across ${traffic} evaluations since`,
      });
    }

    // SPIKE: a gate taking a much larger share of blocks than it used to.
    if (deltaBlocked > 0 && base.blocked > 0) {
      const baseShare = base.blocked / Math.max(1, baseline.totalBlocked);
      const curShare = gateDelta / deltaBlocked;
      if (curShare > baseShare * SPIKE_RATIO && gateDelta >= MIN_BASELINE_BLOCKS) {
        findings.push({
          kind: 'spike',
          gate: id,
          detail: `share of blocks rose from ${(baseShare * 100).toFixed(1)}% to ${(curShare * 100).toFixed(1)}%`,
        });
      }
    }
  }

  // NOVELTY: a gate that existed at baseline and is gone from the config entirely.
  for (const id of Object.keys(baseGates)) {
    if (!(id in curGates) && baseGates[id].blocked >= MIN_BASELINE_BLOCKS) {
      findings.push({ kind: 'disappeared', gate: id, detail: 'gate no longer present in stats' });
    }
  }

  return { traffic, deltaBlocked, deltaWarned, findings, evaluated: true };
}

function check(asJson) {
  const baseline = readJson(BASELINE_PATH);
  const stats = readJson(STATS_PATH);
  if (!baseline) {
    process.stderr.write(`gate-decision-canary: no baseline at ${BASELINE_PATH}; run --snapshot first\n`);
    return 2;
  }
  if (!stats) {
    process.stderr.write(`gate-decision-canary: no stats at ${STATS_PATH}\n`);
    return 2;
  }

  const result = diffDecisions(baseline, stats);

  if (asJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result.findings.length ? 1 : 0;
  }

  if (!result.evaluated) {
    process.stdout.write(`Not enough traffic since baseline (${result.traffic} evaluations, `
      + `need ${MIN_TRAFFIC}). No verdict.\n`);
    return 0;
  }

  process.stdout.write(`Since baseline: ${result.traffic} evaluations `
    + `(${result.deltaBlocked} blocked, ${result.deltaWarned} warned)\n`);

  if (!result.findings.length) {
    process.stdout.write('No enforcement drift detected.\n');
    return 0;
  }

  process.stdout.write(`\nENFORCEMENT DRIFT — ${result.findings.length} finding(s):\n`);
  for (const finding of result.findings) {
    const label = finding.kind === 'silent' ? 'SILENT (possible bypass)'
      : finding.kind === 'spike' ? 'SPIKE (possible over-blocking)'
        : 'DISAPPEARED';
    process.stdout.write(`  [${label}] ${finding.gate}\n      ${finding.detail}\n`);
  }
  process.stdout.write('\nA silent gate is the signature of a bypass: enforcement stopped without an error.\n'
    + 'See docs/RELEASE-ROLLBACK.md to roll the dist-tag back while you investigate.\n');
  return 1;
}

function main(argv) {
  const args = new Set(argv);
  if (args.has('--snapshot')) return snapshot();
  if (args.has('--check')) return check(args.has('--json'));
  process.stdout.write('Usage: gate-decision-canary.js [--snapshot | --check [--json]]\n');
  return 0;
}

module.exports = { diffDecisions, gateTotals, MIN_BASELINE_BLOCKS, MIN_TRAFFIC, SPIKE_RATIO };

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
