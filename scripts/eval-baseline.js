#!/usr/bin/env node
'use strict';

/**
 * eval-baseline.js — record the current engine's verdict for every mined production command.
 *
 * Pairs with tests/gate-golden-set.test.js. The mined cases supply REAL commands; this
 * supplies the expectation. Production's own verdict cannot serve as the expectation because
 * most gates are state-conditional and the trace does not record the state that produced them.
 * What is worth defending is that a real command's verdict does not change silently.
 *
 * Re-run deliberately after an intended behaviour change, never to make a red test go green
 * without reading what moved.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const gatesEngine = require('./gates-engine.js');

const GOLDEN = path.join(__dirname, '..', 'evals', 'gate-decisions.golden.jsonl');
const OUT = path.join(__dirname, '..', 'evals', 'gate-decisions.baseline.json');

async function main() {
  if (!fs.existsSync(GOLDEN)) {
    process.stderr.write('eval-baseline: no golden set — run: npm run eval:mine\n');
    return 2;
  }
  const cases = fs.readFileSync(GOLDEN, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-baseline-state-'));
  gatesEngine.STATE_PATH = path.join(sandbox, 'gate-state.json');
  gatesEngine.STATS_PATH = path.join(sandbox, 'gate-stats.json');
  gatesEngine.CONSTRAINTS_PATH = path.join(sandbox, 'session-constraints.json');
  gatesEngine.SESSION_ACTIONS_PATH = path.join(sandbox, 'session-actions.json');
  gatesEngine.GOVERNANCE_STATE_PATH = path.join(sandbox, 'governance-state.json');

  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-baseline-repo-'));
  const git = (a) => execFileSync('git', a, { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  git(['init']); git(['config', 'user.email', 't@example.com']); git(['config', 'user.name', 't']);
  fs.writeFileSync(path.join(repo, 'seed.txt'), 'seed\n');
  git(['add', 'seed.txt']); git(['commit', '-m', 'init']);
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'app.js'), 'code\n');

  const verdicts = {};
  for (const c of cases) {
    const v = await gatesEngine.evaluateGatesAsync(c.toolName, { command: c.command, cwd: repo });
    verdicts[`${c.toolName}|${c.command}`] = v ? v.decision : 'none';
  }
  fs.rmSync(sandbox, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });

  const counts = {};
  for (const d of Object.values(verdicts)) counts[d] = (counts[d] || 0) + 1;
  fs.writeFileSync(OUT, JSON.stringify({ cases: Object.keys(verdicts).length, counts, verdicts }, null, 2));
  process.stdout.write(`Baselined ${Object.keys(verdicts).length} case(s): `
    + Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ') + `\n  -> ${OUT}\n`);
  return 0;
}

if (require.main && require.main.filename === module.filename) {
  main().then((c) => process.exit(c));
}
