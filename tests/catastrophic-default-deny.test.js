'use strict';

// A default install (no THUMBGATE_* enforcement variables) must DENY the catastrophic commands,
// the same way it denies secret exfiltration. Ordinary flagged actions still warn, and a warning
// never says "blocked" because the action runs.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const CLI = path.join(REPO, 'bin', 'cli.js');

function gateCheck(command, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-catastrophic-'));
  try {
    const clean = { ...process.env };
    for (const key of Object.keys(clean)) {
      if (/^THUMBGATE_/.test(key)) delete clean[key];
    }
    const res = spawnSync(process.execPath, [CLI, 'gate-check'], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: REPO }),
      cwd: REPO,
      env: {
        ...clean,
        THUMBGATE_STATE_DIR: dir,
        THUMBGATE_FEEDBACK_DIR: dir,
        THUMBGATE_NO_TELEMETRY: '1',
        THUMBGATE_NO_RATE_LIMIT: '1',
        THUMBGATE_NO_NUDGE: '1',
        ...env,
      },
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, `gate-check failed:\n${res.stderr}`);
    const raw = res.stdout || '';
    const hook = JSON.parse(raw.slice(raw.indexOf('{'))).hookSpecificOutput || {};
    return {
      decision: hook.permissionDecision || 'allow',
      text: `${hook.permissionDecisionReason || ''}${hook.additionalContext || ''}`,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const CATASTROPHIC = [
  ['git push --force origin main', 'force-push'],
  ['git push -f origin master', 'force-push'],
  ['git reset --hard HEAD~5', 'git-reset-hard'],
  ['git clean -fd', 'git-clean-force'],
  ['rm -rf ~/', 'rm-rf-home-or-root'],
  ['rm -rf /', 'rm-rf-home-or-root'],
  ['psql -c "DROP TABLE users"', 'db-drop-table-production'],
];

for (const [command, gate] of CATASTROPHIC) {
  test(`default install denies: ${command}`, () => {
    const out = gateCheck(command);
    assert.equal(out.decision, 'deny', out.text);
    assert.match(out.text, new RegExp(`GATE:${gate}`));
  });
}

test('catastrophic commands stay denied when posture is simulation', () => {
  const out = gateCheck('git reset --hard HEAD~5', { THUMBGATE_GOVERNANCE_MODE: 'simulation' });
  assert.equal(out.decision, 'deny', out.text);
});

test('a warning never says "blocked" because the action runs', () => {
  const engine = require('../scripts/gates-engine');
  const downgraded = engine.applyEnforcementPosture({
    decision: 'deny',
    gate: 'some-ordinary-gate',
    message: 'Thing is blocked because reasons.',
  });
  assert.equal(downgraded.decision, 'warn');
  assert.doesNotMatch(downgraded.message.replace('not blocked', ''), /blocked/i);
});
