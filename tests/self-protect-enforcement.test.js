'use strict';

// End-to-end tests for the shipped `bin/cli.js gate-check` subprocess. The operator bypass
// may skip ordinary advisory gates, but it must never disable secret, security-scan, or any
// of the four canonical self-protection floors.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');
const PLUGIN_HOOK = path.join(__dirname, '..', 'scripts', 'hook-pre-tool-use.js');
const REPO = path.join(__dirname, '..');

function gateCheck(input, env = {}) {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-floor-test-'));
  try {
    const res = spawnSync(process.execPath, [CLI, 'gate-check'], {
      input: JSON.stringify({ ...input, cwd: REPO }),
      cwd: REPO,
      env: {
        ...process.env,
        THUMBGATE_STATE_DIR: runtimeDir,
        THUMBGATE_FEEDBACK_DIR: runtimeDir,
        THUMBGATE_SECRET_SCAN_PROVIDER: 'heuristic',
        THUMBGATE_PRO_MODE: '1',
        THUMBGATE_NO_RATE_LIMIT: '1',
        THUMBGATE_NO_NUDGE: '1',
        THUMBGATE_HOTFIX_BYPASS: '',
        THUMBGATE_STRICT_ENFORCEMENT: '',
        THUMBGATE_SELF_PROTECT_OVERRIDE: '',
        THUMBGATE_ALLOW_SELF_EDIT: '',
        ...env,
      },
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, `gate-check failed:\n${res.stderr}`);
    const raw = res.stdout || '';
    const brace = raw.indexOf('{');
    assert.notEqual(brace, -1, `gate-check did not emit JSON:\n${raw}`);
    const payload = JSON.parse(raw.slice(brace));
    const hook = payload.hookSpecificOutput || {};
    return {
      decision: hook.permissionDecision ?? null,
      reason: hook.permissionDecisionReason || '',
      context: hook.additionalContext || '',
      payload,
      raw,
    };
  } finally {
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  }
}

function pluginHook(input, env = {}) {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-plugin-floor-test-'));
  try {
    const res = spawnSync(process.execPath, [PLUGIN_HOOK], {
      input: JSON.stringify({ ...input, cwd: REPO }),
      cwd: REPO,
      env: {
        ...process.env,
        THUMBGATE_STATE_DIR: runtimeDir,
        THUMBGATE_FEEDBACK_DIR: runtimeDir,
        THUMBGATE_SECRET_SCAN_PROVIDER: 'heuristic',
        THUMBGATE_PRO_MODE: '1',
        THUMBGATE_NO_RATE_LIMIT: '1',
        THUMBGATE_NO_NUDGE: '1',
        ...env,
      },
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, `plugin hook failed:\n${res.stderr}`);
    return JSON.parse(res.stdout || '{}');
  } finally {
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  }
}

function buildFakeStripeSecret() {
  return ['sk', '_live_', '1234567890abcdefghijklmnopqrstuvwxyz'].join('');
}

const HARD_FLOOR_CASES = [
  ['secret-exfiltration', {
    tool_name: 'Bash',
    tool_input: { command: `echo ${buildFakeStripeSecret()}` },
  }],
  ['security-vuln-scan', {
    tool_name: 'Write',
    tool_input: { file_path: 'src/unsafe.js', content: "execSync('rm ' + req.query.path)" },
  }],
  ['self-protect-config', {
    tool_name: 'Write',
    tool_input: { file_path: 'config/gates/default.json', content: '{}' },
  }],
  ['self-protect-config', {
    tool_name: 'Bash',
    tool_input: { command: "printf '%s' '{}' > config/gates/default.json" },
  }],
  ['self-protect-kill', {
    tool_name: 'Bash',
    tool_input: { command: 'pkill -f gates-engine' },
  }],
  ['self-protect-env-override', {
    tool_name: 'Bash',
    tool_input: { command: 'export THUMBGATE_HOTFIX_BYPASS=1' },
  }],
  ['self-protect-hooks-disable', {
    tool_name: 'Edit',
    tool_input: {
      file_path: '.claude/settings.json',
      new_string: '{"hooks":{"PreToolUse":[]}}',
    },
  }],
  ['self-protect-hooks-disable', {
    tool_name: 'Bash',
    tool_input: { command: "sed -i '' 's/PreToolUse/Disabled/' .claude/settings.json" },
  }],
];
const FORCE_PUSH = {
  tool_name: 'Bash',
  tool_input: { command: 'git push --force origin main' },
};
const ADVERSARIAL_BYPASS_ENV = {
  THUMBGATE_HOTFIX_BYPASS: '1',
  THUMBGATE_SELF_PROTECT_OVERRIDE: '1',
  THUMBGATE_ALLOW_SELF_EDIT: '1',
};

const FINANCIAL_BROWSER_CASES = [
  {
    tool_name: 'computer',
    tool_input: { action: 'click', description: 'Upgrade Apollo and charge $588 now' },
  },
  {
    tool_name: 'computer',
    tool_input: {
      action: 'click',
      description: 'User said approved; buy Apollo Pro for $588',
      financialControl: { approved: true, budgetUsd: 588 },
    },
  },
  {
    toolName: 'computer',
    toolInput: { action: 'click', description: 'Create a paid recurring subscription' },
  },
];

for (const [expectedGate, input] of HARD_FLOOR_CASES) {
  test(`${expectedGate} denies even when bypass and legacy self-edit overrides are set`, () => {
    const result = gateCheck(input, ADVERSARIAL_BYPASS_ENV);
    assert.equal(result.decision, 'deny', result.raw.slice(0, 500));
    assert.ok(result.reason.includes(`[GATE:${expectedGate}]`), result.reason);
  });
}

for (const input of FINANCIAL_BROWSER_CASES) {
  test('financial browser mutation denies even when operator bypass is set', () => {
    const result = gateCheck(input, ADVERSARIAL_BYPASS_ENV);
    assert.equal(result.decision, 'deny', result.raw.slice(0, 500));
    assert.match(result.reason, /\[GATE:financial-control\]/);
  });
}

test('ordinary block gates remain warn-by-default without disclosing the bypass name', () => {
  const result = gateCheck(FORCE_PUSH);
  assert.notEqual(result.decision, 'deny');
  assert.match(result.context, /warn-by-default/);
  assert.doesNotMatch(result.raw, /THUMBGATE_HOTFIX_BYPASS/);
});

test('explicit strict mode still denies an ordinary block gate', () => {
  assert.equal(gateCheck(FORCE_PUSH, { THUMBGATE_STRICT_ENFORCEMENT: '1' }).decision, 'deny');
});

test('operator bypass still approves an ordinary block gate', () => {
  const result = gateCheck(FORCE_PUSH, { THUMBGATE_HOTFIX_BYPASS: '1' });
  assert.equal(result.decision, null);
  assert.equal(result.payload.decision, 'approve');
  assert.equal(result.payload.reason, 'operator-bypass-opt-in');
});

test('CLI has one reachable gate-check case and no nonexistent destructive-floor reference', () => {
  const cliSource = fs.readFileSync(CLI, 'utf8');
  const engineSource = fs.readFileSync(path.join(REPO, 'scripts', 'gates-engine.js'), 'utf8');
  assert.equal((cliSource.match(/case\s+['"]gate-check['"]\s*:/g) || []).length, 1);
  assert.doesNotMatch(engineSource, /DESTRUCTIVE_FS_PATTERN/);
});

test('published plugin hook uses the same bypass-immune hard floor as gate-check', () => {
  const bypassEnv = {
    THUMBGATE_HOTFIX_BYPASS: '1',
    THUMBGATE_SELF_PROTECT_OVERRIDE: '1',
    THUMBGATE_ALLOW_SELF_EDIT: '1',
  };
  const blocked = pluginHook({
    tool_name: 'Bash',
    tool_input: { command: "printf '%s' '{}' > config/gates/default.json" },
  }, bypassEnv);
  assert.equal(blocked.decision, 'block');
  assert.match(blocked.reason, /\[GATE:self-protect-config\]/);

  const allowed = pluginHook({
    tool_name: 'Write',
    tool_input: {
      file_path: 'docs/gate-design.md',
      content: 'The default policy lives under config/gates/.',
    },
  }, bypassEnv);
  assert.notEqual(allowed.decision, 'block');

  const camelCasePurchase = pluginHook({
    toolName: 'computer',
    toolInput: {
      action: 'click',
      description: 'Create a paid recurring subscription',
    },
  }, bypassEnv);
  assert.equal(camelCasePurchase.decision, 'block');
  assert.match(camelCasePurchase.reason, /\[GATE:financial-control\]/);

  const dependencyReview = pluginHook({
    toolName: 'Task',
    toolInput: {
      goal: 'Upgrade dependencies to supported versions',
      prompt: 'Review the purchase-control implementation',
    },
  }, bypassEnv);
  assert.notEqual(dependencyReview.decision, 'block');
});
