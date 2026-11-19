'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  COOLDOWN_MS,
  PRICING_URL,
  STATE_FILE,
  buildLine,
  maybeUpsell,
  attachUpsell,
  withFirstBlockUpsell,
  gateIdFromReason,
} = require('../scripts/first-block-upsell');

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-11-19T12:00:00Z');
const notExempt = () => null;

function freshDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-upsell-'));
}

function denyOutput(gate = 'force-push') {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `[GATE:${gate}] blocked`,
    },
  });
}

test('shown once on the first real block, naming what was stopped, with the pricing link', () => {
  const stateDir = freshDir();
  const result = maybeUpsell({ gate: 'force-push', env: {}, now: T0, stateDir, exempt: notExempt });
  assert.equal(result.show, true);
  assert.match(result.line, /^ThumbGate just stopped a force push\. Pro adds .+ - thumbgate\.ai\/pricing\?utm_source=cli&utm_medium=first_block$/);
  assert.ok(result.line.includes(PRICING_URL));
  assert.ok(!result.line.includes('\n'), 'one line');
  const again = maybeUpsell({ gate: 'force-push', env: {}, now: T0 + 1000, stateDir, exempt: notExempt });
  assert.deepEqual({ show: again.show, reason: again.reason }, { show: false, reason: 'cooldown' });
});

test('not shown again within 7 days, shown again once 7 days have passed', () => {
  const stateDir = freshDir();
  assert.equal(maybeUpsell({ gate: 'force-push', env: {}, now: T0, stateDir, exempt: notExempt }).show, true);
  const justBefore = maybeUpsell({ gate: 'git-reset-hard', env: {}, now: T0 + COOLDOWN_MS - 1, stateDir, exempt: notExempt });
  assert.equal(justBefore.show, false);
  const atSeven = maybeUpsell({ gate: 'git-reset-hard', env: {}, now: T0 + 7 * DAY, stateDir, exempt: notExempt });
  assert.equal(atSeven.show, true);
  assert.match(atSeven.line, /a hard reset/);
  const state = JSON.parse(fs.readFileSync(path.join(stateDir, STATE_FILE), 'utf8'));
  assert.equal(state.shownCount, 2);
  assert.equal(maybeUpsell({ gate: 'force-push', env: {}, now: T0 + 7 * DAY + 1000, stateDir, exempt: notExempt }).show, false);
});

test('never shown in CI, and a CI block does not use up the first showing', () => {
  const stateDir = freshDir();
  for (const name of ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'JENKINS_URL']) {
    const result = maybeUpsell({ gate: 'force-push', env: { [name]: 'true' }, now: T0, stateDir, exempt: notExempt });
    assert.deepEqual({ show: result.show, reason: result.reason }, { show: false, reason: 'ci' }, name);
  }
  assert.equal(fs.existsSync(path.join(stateDir, STATE_FILE)), false, 'no state written in CI');
  assert.equal(maybeUpsell({ gate: 'force-push', env: {}, now: T0, stateDir, exempt: notExempt }).show, true);
});

test('THUMBGATE_NO_UPSELL=1 turns it off and writes nothing', () => {
  const stateDir = freshDir();
  const result = maybeUpsell({ gate: 'force-push', env: { THUMBGATE_NO_UPSELL: '1' }, now: T0, stateDir, exempt: notExempt });
  assert.deepEqual({ show: result.show, reason: result.reason }, { show: false, reason: 'opt-out' });
  assert.equal(fs.existsSync(path.join(stateDir, STATE_FILE)), false);
});

test('never writes to stdout or stderr (the line is data for the host, not terminal output)', () => {
  const stateDir = freshDir();
  const writes = [];
  const realOut = process.stdout.write;
  const realErr = process.stderr.write;
  process.stdout.write = (chunk) => { writes.push(String(chunk)); return true; };
  process.stderr.write = (chunk) => { writes.push(String(chunk)); return true; };
  try {
    maybeUpsell({ gate: 'force-push', env: {}, now: T0, stateDir, exempt: notExempt });
    withFirstBlockUpsell(denyOutput(), { env: {}, now: T0 + 8 * DAY, stateDir, exempt: notExempt });
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  }
  assert.deepEqual(writes, []);
});

test('a paying, creator or owner install never sees it and keeps its first showing', () => {
  const stateDir = freshDir();
  for (const reason of ['paid', 'creator', 'owner']) {
    const result = maybeUpsell({ gate: 'force-push', env: {}, now: T0, stateDir, exempt: () => reason });
    assert.deepEqual({ show: result.show, reason: result.reason }, { show: false, reason });
  }
  assert.equal(fs.existsSync(path.join(stateDir, STATE_FILE)), false);
});

test('stays quiet when the once-per-7-days state cannot be written', () => {
  const blocker = path.join(freshDir(), 'a-file');
  fs.writeFileSync(blocker, 'x');
  const result = maybeUpsell({ gate: 'force-push', env: {}, now: T0, stateDir: path.join(blocker, 'sub'), exempt: notExempt });
  assert.deepEqual({ show: result.show, reason: result.reason }, { show: false, reason: 'state-unwritable' });
});

test('corrupt state stays quiet and restarts the 7-day clock', () => {
  const stateDir = freshDir();
  fs.writeFileSync(path.join(stateDir, STATE_FILE), '{not json');
  const first = maybeUpsell({ gate: 'force-push', env: {}, now: T0, stateDir, exempt: notExempt });
  assert.deepEqual({ show: first.show, reason: first.reason }, { show: false, reason: 'state-corrupt' });
  assert.equal(maybeUpsell({ gate: 'force-push', env: {}, now: T0 + 3 * DAY, stateDir, exempt: notExempt }).show, false);
  assert.equal(maybeUpsell({ gate: 'force-push', env: {}, now: T0 + 7 * DAY, stateDir, exempt: notExempt }).show, true);
});

test('the line names the stopped action from a fixed phrase, never the command', () => {
  assert.match(buildLine('secret-exfiltration'), /a secret being sent out of your machine/);
  assert.match(buildLine('some-learned-gate-with-secret-sk-123'), /^ThumbGate just stopped a risky tool call\./);
  assert.ok(!buildLine('some-learned-gate-with-secret-sk-123').includes('sk-123'));
});

test('deny output gains a systemMessage; the reason the model reads is unchanged', () => {
  const stateDir = freshDir();
  const original = denyOutput('force-push');
  const out = JSON.parse(withFirstBlockUpsell(original, { env: {}, now: T0, stateDir, exempt: notExempt }));
  assert.match(out.systemMessage, /^ThumbGate just stopped a force push\. Pro adds /);
  assert.equal(out.hookSpecificOutput.permissionDecisionReason, JSON.parse(original).hookSpecificOutput.permissionDecisionReason);
  assert.ok(!JSON.stringify(out.hookSpecificOutput).includes('thumbgate.ai/pricing'), 'marketing never reaches the model');
});

test('allow, warn, approval and financial-control outputs are returned untouched', () => {
  const stateDir = freshDir();
  const opts = { env: {}, now: T0, stateDir, exempt: notExempt };
  const outputs = [
    JSON.stringify({}),
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: '[GATE:x] WARNING: y' } }),
    JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: '[GATE:x] APPROVAL REQUIRED: y' } }),
    denyOutput('financial-control'),
    'not json at all',
  ];
  for (const output of outputs) assert.equal(withFirstBlockUpsell(output, opts), output);
  assert.equal(fs.existsSync(path.join(stateDir, STATE_FILE)), false, 'none of these used up the first showing');
});

test('attachUpsell handles a hook response object and a block with no gate id via override', () => {
  const stateDir = freshDir();
  const response = {
    decision: 'block',
    reason: 'learned risk',
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'learned risk' },
  };
  const out = attachUpsell(response, { gateOverride: 'learned-lesson', env: {}, now: T0, stateDir, exempt: notExempt });
  assert.match(out.systemMessage, /a repeat of a mistake you told ThumbGate about/);
  assert.equal(gateIdFromReason('[GATE:force-push] x'), 'force-push');
  assert.equal(gateIdFromReason('no prefix'), null);
});

test('gates-engine runAsync is the wired path: opt-out leaves its output without a systemMessage', async () => {
  const feedbackDir = freshDir();
  const saved = { ...process.env };
  process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;
  process.env.THUMBGATE_NO_UPSELL = '1';
  delete process.env.CI;
  delete process.env.GITHUB_ACTIONS;
  try {
    const { runAsync } = require('../scripts/gates-engine');
    const output = await runAsync({ tool_name: 'Bash', tool_input: { command: 'git push --force origin main' } });
    const parsed = JSON.parse(output);
    assert.equal(parsed.hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(parsed.systemMessage, undefined);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
