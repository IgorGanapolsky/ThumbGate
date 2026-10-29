'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { evaluateUniverseDeliveryPretool } = require('../scripts/universe-2026-delivery-gate');

const ROOT = path.resolve(__dirname, '..');
const PAID_VERB = 'subscribe to';
const OPEN_WORD = 'uncapped';

test('read, edit, and bash stay allowed', () => {
  for (const call of [
    { toolName: 'Read', toolInput: { file_path: 'scripts/universe-2026-delivery-gate.js' } },
    { toolName: 'Edit', toolInput: { file_path: 'scripts/hook-pre-tool-use.js', old_string: 'a', new_string: 'b' } },
    { toolName: 'Bash', toolInput: { command: 'ls scripts' } },
    { toolName: 'Bash', toolInput: { command: 'echo continue the refactor' } },
    { toolName: 'Bash', toolInput: { command: 'echo complete the form' } },
  ]) {
    const verdict = evaluateUniverseDeliveryPretool(call);
    assert.equal(verdict.ok, true, JSON.stringify(call));
    assert.deepEqual(verdict.blockers, []);
  }
});

test('an empty call is allowed', () => {
  const verdict = evaluateUniverseDeliveryPretool();
  assert.equal(verdict.ok, true);
  assert.equal(verdict.source, 'github-universe-2026');
});

test('a done claim without a verification token is denied', () => {
  const verdict = evaluateUniverseDeliveryPretool({
    toolName: 'Bash',
    toolInput: { command: 'echo the task is done' },
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.blockers.includes('universe_done_claim_missing_verification'));
});

test('a done claim with node --test is allowed', () => {
  const verdict = evaluateUniverseDeliveryPretool({
    toolName: 'Bash',
    toolInput: {
      command: 'echo the task is done && node --test tests/universe-2026-delivery-gate.test.js',
    },
  });
  assert.equal(verdict.ok, true);
});

test('deliveryStatus done without a token is denied', () => {
  const verdict = evaluateUniverseDeliveryPretool({
    toolName: 'Bash',
    toolInput: { command: 'true', deliveryStatus: 'done' },
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.blockers.includes('universe_done_claim_missing_verification'));
});

test('lite review cannot close a force push', () => {
  const verdict = evaluateUniverseDeliveryPretool({
    toolName: 'Bash',
    toolInput: { command: 'git push --force origin feat/universe-2026-delivery', reviewDepth: 'lite' },
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.blockers.includes('universe_lite_review_cannot_close_high_blast'));
});

test('the same force push with a test command is allowed', () => {
  const verdict = evaluateUniverseDeliveryPretool({
    toolName: 'Bash',
    toolInput: {
      command: 'git push --force origin feat/universe-2026-delivery && node --test tests/universe-2026-delivery-gate.test.js',
      reviewDepth: 'lite',
    },
  });
  assert.equal(verdict.ok, true);
});

test('npm publish without a lite marker is allowed by this gate', () => {
  const verdict = evaluateUniverseDeliveryPretool({
    toolName: 'Bash',
    toolInput: { command: 'npm publish --access public' },
  });
  assert.equal(verdict.ok, true);
});

test('production DDL closed on a lite review is denied', () => {
  const verdict = evaluateUniverseDeliveryPretool({
    toolName: 'Bash',
    toolInput: { command: 'psql production -c "ALTER TABLE users ADD COLUMN x int" # lite review' },
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.blockers.includes('universe_lite_review_cannot_close_high_blast'));
});

test('autoApply without reviewApproved is denied', () => {
  const verdict = evaluateUniverseDeliveryPretool({
    toolName: 'Bash',
    toolInput: { command: 'node scripts/apply-learned-gate.js', autoApply: true },
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.blockers.includes('universe_learning_auto_apply_needs_review'));
});

test('autoApply with reviewApproved is allowed', () => {
  const verdict = evaluateUniverseDeliveryPretool({
    toolName: 'Bash',
    toolInput: {
      command: 'node scripts/apply-learned-gate.js',
      autoApply: true,
      reviewApproved: true,
    },
  });
  assert.equal(verdict.ok, true);
});

test('continuing from cursor without a goal is denied', () => {
  const verdict = evaluateUniverseDeliveryPretool({
    toolName: 'Bash',
    toolInput: { command: 'echo continuing from cursor' },
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.blockers.includes('universe_continuity_missing_goal_or_last_verified_outcome'));
});

test('continuing from cursor with a goal and a last verified outcome is allowed', () => {
  const verdict = evaluateUniverseDeliveryPretool({
    toolName: 'Bash',
    toolInput: {
      command: 'echo continuing from cursor',
      goal: 'ship the delivery gate',
      lastVerifiedOutcome: 'tests/universe-2026-delivery-gate.test.js passed',
    },
  });
  assert.equal(verdict.ok, true);
});

test('a fresh session that does not claim continuity is allowed', () => {
  const verdict = evaluateUniverseDeliveryPretool({
    toolName: 'Bash',
    toolInput: { command: 'echo start a new session' },
  });
  assert.equal(verdict.ok, true);
});

test('subscribing to a paid Copilot plan is denied', () => {
  const verdict = evaluateUniverseDeliveryPretool({
    toolName: 'Bash',
    toolInput: { command: `${PAID_VERB} ${PAID_REST}` },
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.blockers.includes('universe_paid_plan_subscribe_denied'));
});

test('a route with no token ceiling is denied', () => {
  const verdict = evaluateUniverseDeliveryPretool({
    toolName: 'Bash',
    toolInput: { command: `set an ${OPEN_WORD} ${OPEN_TARGET}` },
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.blockers.includes('universe_uncapped_model_route_denied'));
});

test('a capped route is allowed', () => {
  const verdict = evaluateUniverseDeliveryPretool({
    toolName: 'Bash',
    toolInput: { command: 'set maxTokens: 4096' },
  });
  assert.equal(verdict.ok, true);
});

test('a null token ceiling on the tool input is denied', () => {
  const verdict = evaluateUniverseDeliveryPretool({
    toolName: 'Bash',
    toolInput: { command: 'set the route', maxTokens: null },
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.blockers.includes('universe_uncapped_model_route_denied'));
});

test('the gate script is outside the npm file list and the test is on test:gates', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.files.includes('scripts/universe-2026-delivery-gate.js'), false);
  assert.match(pkg.scripts['test:gates'], /tests\/universe-2026-delivery-gate\.test\.js/);
  const src = fs.readFileSync(path.join(ROOT, 'scripts/universe-2026-delivery-gate.js'), 'utf8');
  assert.doesNotMatch(src, /two points of opus|40%\s*less time|half the cost|reviewbench|copilot fusion/i);
});

test('the hook calls the gate and fail-opens', () => {
  const hook = fs.readFileSync(path.join(ROOT, 'scripts/hook-pre-tool-use.js'), 'utf8');
  assert.match(hook, /evaluateUniverseDeliveryPretool/);
  assert.match(hook, /universe-2026:/);
  const start = hook.indexOf("require('./universe-2026-delivery-gate')");
  assert.ok(start > 0);
  const window = hook.slice(Math.max(0, start - 80), start + 420);
  assert.match(window, /try \{/);
  assert.match(window, /failOpen\(err\)/);
});

test('the live hook denies an unverified done claim and allows ls', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-universe-hook-'));
  const hook = path.join(ROOT, 'scripts/hook-pre-tool-use.js');
  function run(command) {
    const result = spawnSync(process.execPath, [hook], {
      input: JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        cwd: dir,
        tool_input: { command },
      }),
      encoding: 'utf8',
      timeout: 30000,
      env: {
        ...process.env,
        THUMBGATE_FEEDBACK_DIR: path.join(dir, 'feedback'),
        THUMBGATE_HOOKS_ENFORCE: '',
        THUMBGATE_AUTOGATE_PR_COMMITS: '',
      },
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout || '{}');
  }
  try {
    const denied = run('echo the task is done');
    assert.equal(denied.decision, 'block');
    assert.match(String(denied.reason || ''), /universe-2026: universe_done_claim_missing_verification/);
    const allowed = run('ls scripts');
    assert.notEqual(allowed.decision, 'block');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const PAID_REST = 'GitHub Copilot Enterprise';
const OPEN_TARGET = 'model route';

test('writing this gate and its test stays allowed', () => {
  for (const name of [
    'scripts/universe-2026-delivery-gate.js',
    'tests/universe-2026-delivery-gate.test.js',
    'scripts/hook-pre-tool-use.js',
  ]) {
    const verdict = evaluateUniverseDeliveryPretool({
      toolName: 'Write',
      toolInput: { file_path: name, content: fs.readFileSync(path.join(ROOT, name), 'utf8') },
    });
    assert.equal(verdict.ok, true, `${name} ${verdict.blockers.join(',')}`);
  }
});
