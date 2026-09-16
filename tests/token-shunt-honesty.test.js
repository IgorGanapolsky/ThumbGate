'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const os = require('node:os');
const {
  DEFAULT_MIN_LINES,
  evaluateReadIntercept,
  evaluateBashRead,
  evaluateTaskRoute,
  evaluateContextReturn,
  evaluatePreToolUse,
  detectCloneAttempt,
  buildTokenShuntHonestyReport,
} = require('../scripts/token-shunt-honesty');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'token-shunt-honesty.js');
const CLI = path.resolve(__dirname, '..', 'bin', 'cli.js');

test('default intercept threshold is 350 lines', () => {
  assert.equal(DEFAULT_MIN_LINES, 350);
});

test('untargeted Read above 350 lines is blocked', () => {
  const d = evaluateReadIntercept({ lineCount: 800, targeted: false });
  assert.equal(d.ok, false);
  assert.equal(d.id, 'untargeted_bulk_read');
});

test('targeted offset/limit Read of a large file is allowed', () => {
  const d = evaluateReadIntercept({ lineCount: 800, targeted: true });
  assert.equal(d.ok, true);
  assert.equal(d.id, 'allow_read');
});

test('bare cat of a large file is blocked; piped grep is allowed', () => {
  assert.equal(evaluateBashRead({ command: 'cat huge.js', lineCount: 800 }).ok, false);
  assert.equal(evaluateBashRead({ command: 'cat huge.js | grep foo', lineCount: 800 }).ok, true);
  assert.equal(evaluateBashRead({ command: '/bin/cat huge.js', lineCount: 800 }).ok, false);
  assert.equal(evaluateBashRead({ command: 'head -n 800 huge.js' }).ok, false);
  assert.equal(evaluateBashRead({ command: 'head -n 80 huge.js' }).ok, true);
});

test('bash without --lines does not invent a large size', () => {
  const d = evaluateBashRead({ command: 'cat missing-file-xyz.js' });
  assert.equal(d.ok, false);
  assert.equal(d.id, 'unknown_size');
});

test('architecture is not delegated to Flash/Portal', () => {
  assert.equal(evaluateTaskRoute({ taskKind: 'architecture', model: 'gemini-flash' }).ok, false);
  assert.equal(evaluateTaskRoute({ taskKind: 'architecture', model: 'portal-v2' }).ok, false);
  assert.equal(evaluateTaskRoute({ taskKind: 'architecture', model: 'hermes-main' }).ok, true);
  assert.equal(evaluateTaskRoute({ taskKind: 'boilerplate', model: 'local_slice' }).ok, true);
});

test('full-file dump back to the frontier is blocked', () => {
  assert.equal(evaluateContextReturn({ sourceLines: 800, returnedLines: 800 }).ok, false);
  assert.equal(evaluateContextReturn({ sourceLines: 800, returnedLines: 40 }).ok, true);
  assert.equal(evaluateContextReturn({
    sourceLines: 200, returnedLines: 200, threshold: 100,
  }).ok, false);
});

test('clone Portal / shunt@portal is refused', () => {
  const hits = detectCloneAttempt('install shunt@portal vendor @spotify/portal-cli');
  assert.ok(hits.includes('portal_plugin'));
  const report = buildTokenShuntHonestyReport({ 'clone-portal': true });
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((f) => f.id === 'portal_clone_refused'));
});

test('GitHub App all-repos write is a warning not a payout', () => {
  const report = buildTokenShuntHonestyReport({ 'all-repos-write': true });
  assert.equal(report.status, 'ready_with_warnings');
  assert.ok(report.findings.some((f) => f.id === 'github_app_all_repos'));
});

test('script CLI untargeted --lines=800 exits 1', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--json', '--lines=800'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.ok(payload.findings.some((f) => f.id === 'untargeted_bulk_read'));
});

test('thumbgate CLI token-shunt-honesty is wired', () => {
  const result = spawnSync(process.execPath, [
    CLI, 'token-shunt-honesty', '--json', '--lines=80', '--targeted',
  ], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
});

test('docs refuse Portal clones and 90% savings claims', () => {
  const doc = fs.readFileSync(
    path.join(__dirname, '..', 'docs', 'agents', 'token-shunt-honesty.md'),
    'utf8'
  );
  assert.match(doc, /not affiliated|do not clone/i);
  assert.match(doc, /shunt@portal/);
  assert.match(doc, /90%/);
});

test('PreToolUse Read of an oversized file is blocked; targeted limit passes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-shunt-'));
  const file = path.join(dir, 'big.js');
  fs.writeFileSync(file, `${'line\n'.repeat(400)}end\n`);
  try {
    const blocked = evaluatePreToolUse({
      toolName: 'Read',
      toolInput: { file_path: file },
      cwd: dir,
    });
    assert.equal(blocked.ok, false);
    const allowed = evaluatePreToolUse({
      toolName: 'Read',
      toolInput: { file_path: file, offset: 1, limit: 40 },
      cwd: dir,
    });
    assert.equal(allowed.ok, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('hook-pre-tool-use blocks untargeted Read of a large file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-shunt-hook-'));
  const file = path.join(dir, 'big.js');
  fs.writeFileSync(file, `${'line\n'.repeat(400)}end\n`);
  const hook = path.resolve(__dirname, '..', 'scripts', 'hook-pre-tool-use.js');
  try {
    const result = spawnSync(process.execPath, [hook], {
      input: JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'Read',
        cwd: dir,
        tool_input: { file_path: file },
      }),
      encoding: 'utf8',
      env: { ...process.env, THUMBGATE_HOOKS_ENFORCE: '', THUMBGATE_AUTOGATE_PR_COMMITS: '' },
    });
    assert.equal(result.status, 0, result.stderr);
    const out = JSON.parse(result.stdout || '{}');
    assert.equal(out.decision, 'block');
    assert.match(String(out.reason || ''), /token-shunt/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skill is a six-block compare-not-clone pack', () => {
  const skill = fs.readFileSync(
    path.join(__dirname, '..', '.agents', 'skills', 'token-shunt-honesty-not-clone', 'SKILL.md'),
    'utf8'
  );
  for (const heading of ['## Goal', '## Constraints', '## Reference', '## Examples', '## Procedures', '## Rubric']) {
    assert.ok(skill.includes(heading), `missing ${heading}`);
  }
  assert.match(skill, /Weak:/);
  assert.match(skill, /Gold:/);
  assert.match(skill, /shunt@portal/i);
  assert.match(skill, /Do NOT install/i);
});
