'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const payload = JSON.stringify({
  hook_event_name: 'Stop',
  stop_hook_active: false,
  last_assistant_message: 'No completion or deployment claim.',
});

const commands = [
  ['bash', ['scripts/hook-stop-self-score.sh']],
  ['bash', ['scripts/hook-stop-verify-deploy.sh']],
  ['bash', ['scripts/hook-stop-pr-thread-check.sh']],
  [process.execPath, ['scripts/hook-stop-anti-claim.js']],
  [process.execPath, ['scripts/meta-agent-loop.js', '--hook', '--dry-run']],
  // Exercise the legacy command too: running hosts may have cached it before
  // settings changed, so stdin Stop-payload detection must keep it JSON-safe.
  [process.execPath, ['scripts/meta-agent-loop.js', '--dry-run']],
];

test('every configured Stop hook emits empty stdout or one valid JSON object', async (t) => {
  for (const [command, args] of commands) {
    await t.test(args.join(' '), () => {
      const result = spawnSync(command, args, {
        cwd: ROOT,
        input: payload,
        encoding: 'utf8',
        timeout: 30000,
        env: { ...process.env, CLAUDE_RESPONSE: '' },
      });
      assert.equal(result.status, 0, result.stderr);
      const stdout = (result.stdout || '').trim();
      if (stdout) assert.doesNotThrow(() => JSON.parse(stdout), stdout);
    });
  }
});

test('PR-thread hook ignores "completed sales" commercial research', () => {
  const result = spawnSync('bash', ['scripts/hook-stop-pr-thread-check.sh'], {
    cwd: ROOT,
    input: JSON.stringify({
      hook_event_name: 'Stop',
      last_assistant_message: 'Public evidence does not establish customers, completed sales, revenue, or measurable outcomes.',
    }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_RESPONSE: '' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal((result.stdout || '').trim(), '');
});
