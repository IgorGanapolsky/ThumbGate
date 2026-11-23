#!/usr/bin/env node
'use strict';

// Replay every scenario with the gate on and with the gate off, each in a fresh child process
// with its own throwaway HOME and feedback dir. Usage:
//   npm run scenarios            human-readable table, exit 0 only when every reproduced scenario
//                                is prevented with the gate on and NOT prevented with it off
//   npm run scenarios -- --json  the same results as JSON

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { SCENARIOS, NOT_REPRODUCED } = require('./scenarios');

const WORKER_MARK = '@@scenario-result@@';

function childEnv(mode, home, feedbackDir) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('THUMBGATE_')) delete env[key];
  }
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    THUMBGATE_FEEDBACK_DIR: feedbackDir,
    THUMBGATE_PRO_MODE: '1',
    THUMBGATE_NO_RATE_LIMIT: '1',
    THUMBGATE_DISABLE_TELEMETRY: '1',
    THUMBGATE_MONTHLY_BUDGET_USD: mode === 'on' ? '10' : '1000000',
  };
}

function replay(id, mode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-scenario-'));
  const home = path.join(root, 'home');
  const feedbackDir = path.join(root, 'feedback');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(feedbackDir, { recursive: true });
  try {
    const child = spawnSync(process.execPath, [__filename, '--worker', id, mode, root], {
      env: childEnv(mode, home, feedbackDir),
      encoding: 'utf8',
      timeout: 60000,
    });
    const line = String(child.stdout || '').split('\n').find((l) => l.startsWith(WORKER_MARK));
    if (!line) {
      return { prevented: null, evidence: `worker produced no result (exit ${child.status}): ${String(child.stderr || '').trim().slice(-300)}` };
    }
    return JSON.parse(line.slice(WORKER_MARK.length));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runAll() {
  const results = SCENARIOS.map((scenario) => {
    const on = replay(scenario.id, 'on');
    const off = replay(scenario.id, 'off');
    return {
      id: scenario.id,
      class: scenario.class,
      description: scenario.description,
      off: scenario.off,
      gap: Boolean(scenario.gap),
      on,
      offResult: off,
      ok: scenario.gap ? on.prevented !== null && off.prevented !== null : on.prevented === true && off.prevented === false,
    };
  });
  const suite = results.filter((r) => !r.gap);
  return { results, notReproduced: NOT_REPRODUCED, ok: suite.every((r) => r.ok) && results.every((r) => r.ok) };
}

function worker(id, mode, root) {
  const scenario = SCENARIOS.find((s) => s.id === id);
  if (!scenario) throw new Error(`unknown scenario ${id}`);
  const outcome = scenario.run({ mode, dir: root });
  process.stdout.write(`${WORKER_MARK}${JSON.stringify(outcome)}\n`);
}

function label(prevented) {
  if (prevented === true) return 'PASS (harm prevented)';
  if (prevented === false) return 'FAIL (harm happened)';
  return 'ERROR';
}

function printReport(report) {
  for (const r of report.results) {
    const tag = r.gap
      ? (r.on.prevented === false ? 'known gap: default gates do not stop this' : 'now prevented: move this into the suite')
      : (r.ok ? 'ok' : 'NOT OK');
    process.stdout.write(`\n[${tag}] ${r.id}  (${r.class})\n`);
    process.stdout.write(`  ${r.description}\n`);
    process.stdout.write(`  gate ON : ${label(r.on.prevented)} - ${r.on.evidence}\n`);
    process.stdout.write(`  gate OFF: ${label(r.offResult.prevented)} - ${r.offResult.evidence}\n`);
    process.stdout.write(`  off means: ${r.off}\n`);
  }
  for (const n of report.notReproduced) {
    process.stdout.write(`\n[not reproduced] ${n.id}  (${n.class})\n  ${n.reason}\n`);
  }
  const suite = report.results.filter((r) => !r.gap);
  const passing = suite.filter((r) => r.ok).length;
  const gaps = report.results.filter((r) => r.gap).length;
  process.stdout.write(`\n${passing}/${suite.length} scenarios prevented with the gate on and happen with it off; ${gaps} known gap(s); ${report.notReproduced.length} not reproduced.\n`);
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  const args = process.argv.slice(2);
  if (args[0] === '--worker') {
    worker(args[1], args[2], args[3]);
  } else {
    const report = runAll();
    if (args.includes('--json')) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else printReport(report);
    process.exit(report.ok ? 0 : 1);
  }
}

module.exports = { runAll, replay };
