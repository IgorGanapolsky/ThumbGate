'use strict';

// Activation onboarding (`thumbgate quickstart`) tests.
//
// Proves two things:
//   (a) The non-interactive / piped / CI path is INERT and unchanged — it
//       prints a hint, exits 0, never prompts, never hangs, and writes NO
//       prevention-rule state. This protects automation (the hard safety
//       constraint: non-TTY behavior must not regress).
//   (b) The guided flow promotes a real block rule AND the demonstrated block
//       fires — the activation "aha" — using temp HOME / THUMBGATE_FEEDBACK_DIR
//       / THUMBGATE_PROJECT_DIR so it never touches real state.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const CLI_PATH = path.join(PROJECT_ROOT, 'bin', 'cli.js');
const ACTIVATION_MODULE = path.join(PROJECT_ROOT, 'scripts', 'activation-quickstart');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tg-activation-'));
}

function isolatedEnv(cwd) {
  const homeDir = path.join(cwd, '.home');
  const feedbackDir = path.join(cwd, '.thumbgate');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(feedbackDir, { recursive: true });
  return {
    ...process.env,
    THUMBGATE_NO_NUDGE: '1',
    THUMBGATE_NO_TELEMETRY: '1',
    THUMBGATE_FEEDBACK_DIR: feedbackDir,
    THUMBGATE_PROJECT_DIR: cwd,
    PATH: process.env.PATH,
    HOME: homeDir,
    USERPROFILE: homeDir,
    XDG_CONFIG_HOME: path.join(homeDir, '.config'),
  };
}

// ---------------------------------------------------------------------------
// (a) Non-interactive path is inert and unchanged.
// ---------------------------------------------------------------------------
test('quickstart in a non-TTY run never prompts, exits 0, and writes no rule state', () => {
  const tmp = makeTmpDir();
  try {
    // Piped stdin => process.stdin.isTTY is undefined => non-interactive.
    const out = execFileSync(process.execPath, [CLI_PATH, 'quickstart'], {
      cwd: tmp,
      env: isolatedEnv(tmp),
      input: '', // closed stdin: if it tried to prompt it would hang -> timeout fail
      timeout: 15000,
      encoding: 'utf8',
    });

    // It prints the hint and points at the non-interactive setup command.
    assert.match(out, /interactive walkthrough/i);
    assert.match(out, /npx thumbgate init/);

    // It must NOT have prompted for "the mistake to block".
    assert.doesNotMatch(out, /The mistake to block/i);

    // And it must NOT have created any prevention-rule state — the
    // non-interactive path is fully inert.
    const autoGates = path.join(tmp, '.thumbgate', 'auto-promoted-gates.json');
    assert.equal(fs.existsSync(autoGates), false, 'non-interactive quickstart must not promote rules');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('quickstart exits 0 in non-TTY mode (does not block automation)', () => {
  const tmp = makeTmpDir();
  try {
    // execFileSync throws on non-zero exit; capturing stdout lets us assert the
    // non-interactive branch actually printed its hint (not just exited 0).
    const out = execFileSync(process.execPath, [CLI_PATH, 'quickstart'], {
      cwd: tmp,
      env: isolatedEnv(tmp),
      input: '',
      timeout: 15000,
      encoding: 'utf8',
    });
    assert.match(
      out,
      /interactive walkthrough|run it in a terminal/,
      'non-TTY quickstart should print the interactive-only hint'
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (b) Guided flow promotes a rule and the demonstrated block fires.
// ---------------------------------------------------------------------------
test('guided activation flow promotes a first rule and the demo block fires', async () => {
  const tmp = makeTmpDir();
  const feedbackDir = path.join(tmp, '.thumbgate');
  const homeDir = path.join(tmp, '.home');
  fs.mkdirSync(feedbackDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });

  // Redirect all state into the temp dirs for the duration of the call.
  const saved = {
    HOME: process.env.HOME,
    THUMBGATE_FEEDBACK_DIR: process.env.THUMBGATE_FEEDBACK_DIR,
    THUMBGATE_PROJECT_DIR: process.env.THUMBGATE_PROJECT_DIR,
    THUMBGATE_NO_TELEMETRY: process.env.THUMBGATE_NO_TELEMETRY,
  };
  process.env.HOME = homeDir;
  process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;
  process.env.THUMBGATE_PROJECT_DIR = tmp;
  process.env.THUMBGATE_NO_TELEMETRY = '1';

  // Fresh module instance so any cached path resolution uses temp env.
  delete require.cache[require.resolve(ACTIVATION_MODULE)];
  const { runActivationFlow } = require(ACTIVATION_MODULE);

  const lines = [];
  try {
    const result = await runActivationFlow({
      ask: async () => 'git push --force to main',
      out: (line) => lines.push(line),
      isTTY: true,
    });

    assert.equal(result.interactive, true);
    assert.equal(result.promoted, true, 'a prevention rule should be promoted');
    assert.equal(result.blocked, true, 'the demonstrated block should fire');
    assert.ok(result.gateId, 'a gate id should be returned');

    // The promoted rule was persisted into the isolated feedback dir.
    const autoGates = path.join(feedbackDir, 'auto-promoted-gates.json');
    assert.equal(fs.existsSync(autoGates), true, 'rule state should live in the temp dir');
    const data = JSON.parse(fs.readFileSync(autoGates, 'utf8'));
    assert.ok(
      data.gates.some((g) => g.id === result.gateId && g.action === 'block'),
      'the promoted gate should be a block rule',
    );

    // The user sees the aha + the Pro value tied to it.
    const text = lines.join('\n');
    assert.match(text, /just blocked it/i, 'output should show the block aha');
    assert.match(text, /pricing/i, 'output should tie value to Pro');
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (c) Branch coverage via dependency injection (hermetic — no real gates engine).
// ---------------------------------------------------------------------------
test('escapeRegex turns metacharacters into literal matches', () => {
  const { escapeRegex } = require(ACTIVATION_MODULE);
  assert.equal(escapeRegex('rm -rf /a.b*c?'), 'rm -rf /a\\.b\\*c\\?');
  // The escaped string must be a valid, literal-matching regex.
  const re = new RegExp(escapeRegex('a.b'));
  assert.equal(re.test('a.b'), true);
  assert.equal(re.test('axb'), false, 'the dot must be literal, not any-char');
});

test('guided flow reports a FLAGGED (warn) verdict when the gate does not block', async () => {
  const { runActivationFlow } = require(ACTIVATION_MODULE);
  const lines = [];
  const result = await runActivationFlow({
    ask: async () => 'edit .env directly',
    out: (line) => lines.push(line),
    isTTY: true,
    deps: {
      forcePromote: () => ({ gateId: 'gate_warn_1', totalGates: 1 }),
      runGate: async () => JSON.stringify({ decision: 'allow' }),
      captureFeedback: () => {},
      trackEvent: () => {},
    },
  });
  assert.equal(result.promoted, true);
  assert.equal(result.blocked, false, 'allow verdict => not blocked');
  assert.match(lines.join('\n'), /flagged it/i, 'warn posture must be reported honestly');
  assert.match(lines.join('\n'), /THUMBGATE_STRICT_ENFORCEMENT=1/, 'tells the user how to hard-block');
});

test('guided flow falls back to a starter example when the user enters nothing', async () => {
  const { runActivationFlow } = require(ACTIVATION_MODULE);
  const lines = [];
  let promotedPattern = null;
  const result = await runActivationFlow({
    ask: async () => '   ', // whitespace-only => treated as empty
    out: (line) => lines.push(line),
    isTTY: true,
    deps: {
      forcePromote: (pattern) => { promotedPattern = pattern; return { gateId: 'g1', totalGates: 1 }; },
      runGate: async () => JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny' } }),
      captureFeedback: () => {},
      trackEvent: () => {},
    },
  });
  assert.equal(result.blocked, true, 'deny via hookSpecificOutput counts as blocked');
  assert.match(lines.join('\n'), /starter example/i);
  assert.ok(promotedPattern && promotedPattern.length > 0, 'a non-empty pattern is still promoted');
});

test('guided flow swallows a capture-feedback error without aborting the aha', async () => {
  const { runActivationFlow } = require(ACTIVATION_MODULE);
  const lines = [];
  const result = await runActivationFlow({
    ask: async () => 'rm -rf node_modules',
    out: (line) => lines.push(line),
    isTTY: true,
    deps: {
      forcePromote: () => ({ gateId: 'g2', totalGates: 2 }),
      runGate: async () => JSON.stringify({ decision: 'block' }),
      captureFeedback: () => { throw new Error('capture backend down'); },
      trackEvent: () => { throw new Error('telemetry down'); },
    },
  });
  assert.equal(result.promoted, true, 'capture/telemetry failures must not block promotion');
  assert.equal(result.blocked, true);
});

test('runActivationFlow returns inert result for a non-TTY caller', async () => {
  const { runActivationFlow } = require(ACTIVATION_MODULE);
  const lines = [];
  let asked = false;
  const result = await runActivationFlow({
    ask: async () => { asked = true; return 'should-not-be-called'; },
    out: (line) => lines.push(line),
    isTTY: false,
  });
  assert.equal(asked, false, 'non-TTY must never prompt');
  assert.equal(result.interactive, false);
  assert.equal(result.promoted, false);
  assert.equal(result.blocked, false);
  assert.match(lines.join('\n'), /interactive walkthrough/i);
});
