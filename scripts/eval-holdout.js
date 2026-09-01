#!/usr/bin/env node
'use strict';

/**
 * eval-holdout.js — double-blind holdout seal for the mined gate-decisions benchmark.
 *
 * Problem (Google DeepMind, 2026): benchmark contamination inflates scores — research
 * found signs of leakage in about half of 31 models tested. DeepMind's answer was the
 * first double-blind evaluation (confidential GPU + PySyft): the evaluator never sees
 * the model weights, the provider never sees the questions, and only permitted results
 * leave the enclave.
 *
 * Our local adaptation, no confidential hardware required:
 *
 *   Blind 1 (questions hidden from the tuning loop): the golden set is partitioned
 *           deterministically (sha256 of the canonical case key) into a PUBLIC slice
 *           that development may tune against, and a HOLDOUT slice whose questions are
 *           never written down in plaintext. The holdout manifest stores only case
 *           hashes and sealed verdicts.
 *   Blind 2 (state hidden from the evaluator): holdout replay runs the engine in an
 *           isolated sandbox with empty feedback/memory state — the learned corpus
 *           cannot leak into holdout verdicts (same discipline as eval-baseline.js).
 *
 * Modes:
 *   --freeze   derive the partition, replay the holdout slice in a sandbox, and write
 *              evals/gate-decisions.holdout.json (caseHash + sealed verdict only —
 *              never the raw command). Re-freeze deliberately, like eval:baseline.
 *   --check    verify the seal WITHOUT replaying anything: partition reproducibility,
 *              no case swapped in/out, no raw question text leaked into the manifest,
 *              content hash intact. CI-safe; exit 1 on any violation.
 *   --verify   replay the holdout slice and compare against the sealed verdicts.
 *              Deliberately reports only the aggregate (compared/drifted) — the
 *              "permitted results" pattern. Per-case detail stays inside the script.
 *
 * The hash scheme is the contract: caseHash = sha256(toolName + '\u0000' + command),
 * hex. A case is holdout when its first 8 hex chars fall under holdoutRatio * 2^32.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const GOLDEN = process.env.THUMBGATE_EVAL_GOLDEN
  || path.join(__dirname, '..', 'evals', 'gate-decisions.golden.jsonl');
const HOLDOUT_MANIFEST = process.env.THUMBGATE_EVAL_HOLDOUT
  || path.join(__dirname, '..', 'evals', 'gate-decisions.holdout.json');
const DEFAULT_HOLDOUT_RATIO = 1 / 3;

function caseHash(toolName, command) {
  return crypto.createHash('sha256')
    .update(`${toolName}\u0000${command}`)
    .digest('hex');
}

function isHoldout(hash, ratio = DEFAULT_HOLDOUT_RATIO) {
  const bucket = parseInt(hash.slice(0, 8), 16);
  return bucket < Math.floor(ratio * 0x100000000);
}

function loadGolden(goldenPath = GOLDEN) {
  if (!fs.existsSync(goldenPath)) {
    throw new Error(`no golden set at ${goldenPath} — run: npm run eval:mine`);
  }
  return fs.readFileSync(goldenPath, 'utf8')
    .split('\n').filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

function partition(cases, ratio = DEFAULT_HOLDOUT_RATIO) {
  const holdout = [];
  const publicCases = [];
  for (const c of cases) {
    const hash = caseHash(c.toolName, c.command);
    (isHoldout(hash, ratio) ? holdout : publicCases).push({ ...c, caseHash: hash });
  }
  return { holdout, publicCases };
}

function contentHash(manifest) {
  const body = { ...manifest };
  delete body.contentHash;
  return crypto.createHash('sha256')
    .update(JSON.stringify(body))
    .digest('hex');
}

// --- Sandbox replay (blind 2): isolated engine state, empty learned corpus ---

function makeSandbox() {
  const gatesEngine = require('./gates-engine.js');
  const original = {
    STATE_PATH: gatesEngine.STATE_PATH,
    STATS_PATH: gatesEngine.STATS_PATH,
    CONSTRAINTS_PATH: gatesEngine.CONSTRAINTS_PATH,
    SESSION_ACTIONS_PATH: gatesEngine.SESSION_ACTIONS_PATH,
    GOVERNANCE_STATE_PATH: gatesEngine.GOVERNANCE_STATE_PATH,
  };
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-holdout-state-'));
  gatesEngine.STATE_PATH = path.join(stateDir, 'gate-state.json');
  gatesEngine.STATS_PATH = path.join(stateDir, 'gate-stats.json');
  gatesEngine.CONSTRAINTS_PATH = path.join(stateDir, 'session-constraints.json');
  gatesEngine.SESSION_ACTIONS_PATH = path.join(stateDir, 'session-actions.json');
  gatesEngine.GOVERNANCE_STATE_PATH = path.join(stateDir, 'governance-state.json');

  const emptyFeedbackDir = path.join(stateDir, 'empty-feedback');
  fs.mkdirSync(emptyFeedbackDir, { recursive: true });
  const origFeedback = process.env.THUMBGATE_FEEDBACK_DIR;
  const origMemory = process.env.CLAUDE_MEMORY_DIR;
  process.env.THUMBGATE_FEEDBACK_DIR = emptyFeedbackDir;
  process.env.CLAUDE_MEMORY_DIR = emptyFeedbackDir;

  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-holdout-repo-'));
  const GIT_BIN = ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git']
    .find((candidate) => fs.existsSync(candidate));
  if (!GIT_BIN) throw new Error('no git binary at a known absolute path');
  const git = (a) => execFileSync(GIT_BIN, a, {
    cwd: repo,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin' },
  });
  git(['init']); git(['config', 'user.email', 't@example.com']); git(['config', 'user.name', 't']);
  fs.writeFileSync(path.join(repo, 'seed.txt'), 'seed\n');
  git(['add', 'seed.txt']); git(['commit', '-m', 'init']);
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'app.js'), 'code\n');

  return {
    gatesEngine,
    repo,
    dispose() {
      Object.assign(gatesEngine, original);
      if (origFeedback !== undefined) process.env.THUMBGATE_FEEDBACK_DIR = origFeedback;
      else delete process.env.THUMBGATE_FEEDBACK_DIR;
      if (origMemory !== undefined) process.env.CLAUDE_MEMORY_DIR = origMemory;
      else delete process.env.CLAUDE_MEMORY_DIR;
      fs.rmSync(stateDir, { recursive: true, force: true });
      fs.rmSync(repo, { recursive: true, force: true });
    },
  };
}

async function replayHoldout(holdoutCases) {
  const sandbox = makeSandbox();
  try {
    const verdicts = new Map();
    for (const c of holdoutCases) {
      const v = await sandbox.gatesEngine.evaluateGatesAsync(c.toolName, {
        command: c.command,
        cwd: sandbox.repo,
      });
      verdicts.set(c.caseHash, v ? v.decision : 'none');
    }
    return verdicts;
  } finally {
    sandbox.dispose();
  }
}

// --- Modes ---

async function freeze(ratio = DEFAULT_HOLDOUT_RATIO) {
  const cases = loadGolden();
  const { holdout, publicCases } = partition(cases, ratio);
  const verdicts = await replayHoldout(holdout);

  const manifest = {
    version: 1,
    scheme: 'sha256(toolName + NUL + command); holdout when first 8 hex < ratio * 2^32',
    holdoutRatio: ratio,
    holdoutThreshold: Math.floor(ratio * 0x100000000),
    goldenCases: cases.length,
    holdoutCases: holdout.length,
    publicCases: publicCases.length,
    holdout: holdout.map((c) => ({
      caseHash: c.caseHash,
      gateId: c.expect?.gateId || null,
      sealedVerdict: verdicts.get(c.caseHash),
    })),
    sealedAt: new Date().toISOString(),
  };
  manifest.contentHash = contentHash(manifest);
  fs.writeFileSync(HOLDOUT_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(
    `Holdout sealed: ${holdout.length}/${cases.length} cases held out `
    + `(public ${publicCases.length}) -> ${HOLDOUT_MANIFEST}\n`,
  );
  return 0;
}

function check() {
  if (!fs.existsSync(HOLDOUT_MANIFEST)) {
    process.stderr.write('eval-holdout check: no manifest — run: npm run eval:holdout:freeze\n');
    return 2;
  }
  const raw = fs.readFileSync(HOLDOUT_MANIFEST, 'utf8');
  const manifest = JSON.parse(raw);
  const violations = [];

  // 1. Content hash intact (manifest not hand-edited after sealing).
  if (manifest.contentHash !== contentHash(manifest)) {
    violations.push('contentHash mismatch — manifest edited after sealing');
  }

  // 2. Partition reproducibility: the manifest must describe exactly the holdout
  //    slice the hash scheme derives from the CURRENT golden set. Catches both
  //    golden-set edits that smuggle cases in/out of the holdout and manifest swaps.
  const cases = loadGolden();
  const { holdout: derivedHoldout } = partition(cases, manifest.holdoutRatio ?? DEFAULT_HOLDOUT_RATIO);
  const derived = new Set(derivedHoldout.map((c) => c.caseHash));
  const sealed = new Set((manifest.holdout || []).map((e) => e.caseHash));
  if (manifest.goldenCases !== cases.length) {
    violations.push(`goldenCases ${manifest.goldenCases} != current ${cases.length}`);
  }
  for (const hash of derived) {
    if (!sealed.has(hash)) violations.push(`derived holdout case ${hash.slice(0, 12)}… missing from manifest`);
  }
  for (const hash of sealed) {
    if (!derived.has(hash)) violations.push(`manifest case ${hash.slice(0, 12)}… not in derived holdout`);
  }
  if (sealed.size === 0) violations.push('holdout is empty — nothing is sealed');

  // 3. Leak guard: the questions must not appear in the manifest. The seal is
  //    worthless if raw commands were pasted in alongside their hashes.
  for (const c of cases) {
    const probe = String(c.command || '').slice(0, 40);
    if (probe.length >= 20 && raw.includes(probe)) {
      violations.push(`raw question text leaked into manifest (${probe.slice(0, 20)}…)`);
      break;
    }
  }

  if (violations.length > 0) {
    process.stderr.write(`eval-holdout check: SEAL BROKEN\n  ${violations.join('\n  ')}\n`);
    return 1;
  }
  process.stdout.write(
    `Holdout seal intact: ${sealed.size}/${cases.length} cases sealed, no question leakage.\n`,
  );
  return 0;
}

async function verify() {
  if (!fs.existsSync(HOLDOUT_MANIFEST)) {
    process.stderr.write('eval-holdout verify: no manifest — run: npm run eval:holdout:freeze\n');
    return 2;
  }
  const manifest = JSON.parse(fs.readFileSync(HOLDOUT_MANIFEST, 'utf8'));
  const cases = loadGolden();
  const { holdout } = partition(cases, manifest.holdoutRatio ?? DEFAULT_HOLDOUT_RATIO);
  const byHash = new Map(holdout.map((c) => [c.caseHash, c]));
  const verdicts = await replayHoldout(holdout);

  const sealedCount = (manifest.holdout || []).length;
  let compared = 0;
  let drifted = 0;
  for (const entry of manifest.holdout || []) {
    const c = byHash.get(entry.caseHash);
    if (!c) continue;
    compared += 1;
    if (verdicts.get(entry.caseHash) !== entry.sealedVerdict) drifted += 1;
  }
  if (sealedCount === 0 || compared !== sealedCount) {
    process.stderr.write(
      `Holdout verify: partition drift — compared ${compared} of ${sealedCount} sealed cases. `
      + 'Run: npm run eval:holdout:check\n',
    );
    return 1;
  }
  // Permitted-results pattern: only the aggregate leaves this function. Per-case
  // drift detail is deliberately not printed, so the holdout stays un-memorable.
  process.stdout.write(
    `Holdout verify: compared=${compared} drifted=${drifted} (sealed set)\n`,
  );
  if (drifted > 0) {
    process.stderr.write(
      'Holdout verdicts moved. If the change is intended, re-freeze deliberately: npm run eval:holdout:freeze\n',
    );
    return 1;
  }
  return 0;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--freeze')) return freeze();
  if (args.has('--check')) return check();
  if (args.has('--verify')) return verify();
  process.stderr.write('usage: eval-holdout.js --freeze | --check | --verify\n');
  return 2;
}

module.exports = {
  caseHash,
  isHoldout,
  partition,
  contentHash,
  loadGolden,
  freeze,
  check,
  verify,
  GOLDEN,
  HOLDOUT_MANIFEST,
  DEFAULT_HOLDOUT_RATIO,
};

if (require.main?.filename === module.filename) {
  main().then((c) => process.exit(c));
}
