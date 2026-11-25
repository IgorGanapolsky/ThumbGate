'use strict';

// AGENT-3667 item I: the opt-in shared-tree gate. Runs the real `gate-check` hook command.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');
const IDS = ['shared-tree-stash-reset', 'shared-tree-checkout', 'shared-tree-force-push', 'shared-tree-force-default-branch'];

function makeProject() {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-shared-'));
  cp.execFileSync('git', ['init', '-q'], { cwd: proj });
  const env = {
    ...process.env,
    HOME: proj,
    THUMBGATE_FEEDBACK_DIR: path.join(proj, '.thumbgate'),
    THUMBGATE_NO_RATE_LIMIT: '1',
    PWD: proj,
    CLAUDE_PROJECT_DIR: proj,
  };
  for (const name of ['THUMBGATE_STRICT_ENFORCEMENT', 'THUMBGATE_GOVERNANCE_MODE', 'THUMBGATE_SHARED_TREE', 'THUMBGATE_EXTRA_GATES']) delete env[name];
  return { proj, env };
}

function gateCheck({ proj, env }, command, cwd = proj, session = 'shared-test') {
  const input = JSON.stringify({ session_id: session, cwd, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });
  const res = cp.spawnSync(process.execPath, [CLI, 'gate-check'], { cwd, env, input, encoding: 'utf8', timeout: 60000 });
  const line = String(res.stdout).split('\n').filter((l) => l.startsWith('{')).pop() || '{}';
  const parsed = JSON.parse(line);
  const decision = (parsed.hookSpecificOutput && parsed.hookSpecificOutput.permissionDecision) || parsed.decision || 'allow';
  return { decision: decision === 'block' ? 'deny' : decision, raw: line };
}

const DENY = [
  'git stash', 'git stash pop', 'git stash -u', 'git reset', 'git reset --soft HEAD~1', 'git reset --mixed HEAD', 'git reset --hard HEAD~1',
  'git checkout main', 'git checkout -- src/a.js', 'git checkout -b other', 'git switch dev',
  'git push --force', 'git push -f origin feature/x', 'git push origin +feature/x', 'git push --force origin main',
  'git push --force-with-lease origin main', 'git push origin HEAD:main --force-with-lease', 'git push --force-with-lease origin master',
  'sudo git stash', 'bash -c "git reset --soft HEAD^"', 'git -C /repo stash',
];
const ALLOW = [
  'git status', 'git diff', 'git log --oneline', 'git stash list', 'git stash show', 'git branch -a',
  'git worktree add ../w -b feat', 'git add .', 'git commit -m "x"', 'git commit -m "reset the stash before checkout"',
  'git push --force-with-lease origin feature/x', 'git push origin feature/x', 'git push',
  'grep -rn "git stash" docs/', 'git log --grep=reset --oneline', 'echo "never git reset or git checkout here"', 'wc -l notes-about-stash.md',
];

test('(b) a fresh install lists no shared-tree gate and lets these commands through', () => {
  const config = require('../config/gates/default.json');
  for (const id of IDS) assert.equal(config.gates.some((g) => g.id === id), false, `${id} must not be in the default config`);
  const ctx = makeProject();
  try {
    // The always-on default gate already denies every force push, including --force-with-lease, so those are not part of this row.
    for (const command of ['git stash', 'git reset --soft HEAD~1', 'git checkout main']) {
      assert.equal(gateCheck(ctx, command).decision, 'allow', `off by default: ${command}`);
    }
  } finally {
    fs.rmSync(ctx.proj, { recursive: true, force: true });
  }
});

test('(a) with the gate on, every command in the table is allowed or denied as listed', () => {
  const ctx = makeProject();
  ctx.env.THUMBGATE_SHARED_TREE = '1';
  let shared = 0;
  try {
    for (const command of DENY) {
      const { decision, raw } = gateCheck(ctx, command);
      // git reset --hard is also denied by the always-on default gate; every other row is denied by the new gates.
      assert.equal(decision, 'deny', `expected deny: ${command}`);
      // Rows the always-on default gates also deny (reset --hard, plain force) report that gate first.
      if (!raw.includes('GATE:shared-tree')) continue;
      assert.match(raw, /worktree|own branch|pull request|--force-with-lease/, `deny message should say what to do: ${command}`);
      shared += 1;
    }
    assert.ok(shared >= 14, `the new gates should be the ones denying most rows, got ${shared}`);
    for (const command of ALLOW) assert.equal(gateCheck(ctx, command).decision, 'allow', `expected allow: ${command}`);
  } finally {
    fs.rmSync(ctx.proj, { recursive: true, force: true });
  }
});

test('a commit inside a linked worktree is allowed with the gate on', () => {
  const ctx = makeProject();
  ctx.env.THUMBGATE_SHARED_TREE = '1';
  try {
    cp.execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--allow-empty', '-qm', 'root'], { cwd: ctx.proj });
    const linked = `${ctx.proj}-linked`;
    cp.execFileSync('git', ['worktree', 'add', '-q', linked, '-b', 'lane-a'], { cwd: ctx.proj });
    try {
      // Checked first: a commit leaves a pending-review warning that, for now, answers the next hook call in place of a deny.
      const stash = gateCheck(ctx, 'git stash', linked, 'other-session');
      assert.equal(stash.decision, 'deny', stash.raw);
      assert.equal(gateCheck(ctx, 'git commit -m "work in my lane"', linked).decision, 'allow');
      assert.equal(gateCheck(ctx, 'git push --force-with-lease origin lane-a', linked).decision, 'allow');
    } finally {
      fs.rmSync(linked, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(ctx.proj, { recursive: true, force: true });
  }
});
