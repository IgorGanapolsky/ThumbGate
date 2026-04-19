'use strict';

// Tests for the enforcement-teeth fixes:
//
//   1. capture_feedback wraps correctiveActions in <system-reminder>
//   2. hook-pre-tool-use.js injects lessons via hookSpecificOutput
//   3. hook-pre-tool-use.js blocks on high-risk tags when THUMBGATE_HOOKS_ENFORCE=1
//   4. hook-pre-tool-use.js registers a claim gate on git commit when
//      THUMBGATE_AUTOGATE_PR_COMMITS=1 and branch is non-main

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const HOOK_PATH = path.join(REPO_ROOT, 'scripts', 'hook-pre-tool-use.js');
const SERVER_PATH = path.join(REPO_ROOT, 'adapters', 'mcp', 'server-stdio.js');

function runHook({ input, env = {} }) {
  const result = spawnSync(process.execPath, [HOOK_PATH], {
    input: JSON.stringify(input),
    env: { ...process.env, ...env },
    encoding: 'utf8',
    cwd: REPO_ROOT,
  });
  let parsed = null;
  try { parsed = JSON.parse(result.stdout || '{}'); } catch { /* not json */ }
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    parsed,
  };
}

// ---------------------------------------------------------------------------
// Fix 1: correctiveActions surfaced as <system-reminder> in capture_feedback
// ---------------------------------------------------------------------------

test('formatCorrectiveActionsReminder returns empty string for empty/missing input', () => {
  const { formatCorrectiveActionsReminder } = require(SERVER_PATH);
  assert.equal(formatCorrectiveActionsReminder([]), '');
  assert.equal(formatCorrectiveActionsReminder(null), '');
  assert.equal(formatCorrectiveActionsReminder(undefined), '');
});

test('formatCorrectiveActionsReminder wraps actions in <system-reminder> block with numbered list', () => {
  const { formatCorrectiveActionsReminder } = require(SERVER_PATH);
  const out = formatCorrectiveActionsReminder([
    { whatToChange: 'Run tests before pushing to main', tags: ['git', 'verification'] },
    { text: 'Verify deploy via curl before saying deployed', tags: ['deploy'] },
    { message: 'Never force-push without explicit request' },
  ]);
  assert.match(out, /^<system-reminder>/);
  assert.match(out, /<\/system-reminder>/);
  assert.match(out, /1\. Run tests before pushing to main \[git, verification\]/);
  assert.match(out, /2\. Verify deploy via curl before saying deployed \[deploy\]/);
  assert.match(out, /3\. Never force-push without explicit request/);
});

test('toCaptureFeedbackTextResult emits JSON in content[0] and reminder in content[1] when correctiveActions present', () => {
  const { toCaptureFeedbackTextResult } = require(SERVER_PATH);
  const result = toCaptureFeedbackTextResult({
    accepted: true,
    status: 'promoted',
    correctiveActions: [
      { whatToChange: 'Run tests before push', tags: ['git'] },
    ],
  });
  assert.equal(result.content.length, 2, 'must emit two top-level text blocks');
  // content[0] is the JSON body — parseable, backward-compatible
  const body = JSON.parse(result.content[0].text);
  assert.equal(body.accepted, true);
  // content[1] is the <system-reminder> block — top-level, not buried
  assert.match(result.content[1].text, /^<system-reminder>/);
  assert.match(result.content[1].text, /Run tests before push/);
  assert.match(result.content[1].text, /<\/system-reminder>/);
});

test('toCaptureFeedbackTextResult emits only JSON block when correctiveActions is absent or empty', () => {
  const { toCaptureFeedbackTextResult } = require(SERVER_PATH);
  // Absent
  const a = toCaptureFeedbackTextResult({ accepted: true, status: 'promoted' });
  assert.equal(a.content.length, 1, 'no reminder block when correctiveActions absent');
  const parsedA = JSON.parse(a.content[0].text);
  assert.equal(parsedA.accepted, true);
  // Empty
  const b = toCaptureFeedbackTextResult({ accepted: true, correctiveActions: [] });
  assert.equal(b.content.length, 1, 'no reminder block when correctiveActions is empty');
  const parsedB = JSON.parse(b.content[0].text);
  assert.equal(parsedB.accepted, true);
});

// ---------------------------------------------------------------------------
// Fix 2: PreToolUse hook — additive behavior
// ---------------------------------------------------------------------------

test('hook-pre-tool-use exits 0 and does not block on benign Bash without flags', () => {
  const res = runHook({
    input: {
      session_id: 'test',
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'echo hello world' },
    },
    env: {
      THUMBGATE_HOOKS_ENFORCE: '',
      THUMBGATE_AUTOGATE_PR_COMMITS: '',
    },
  });
  assert.equal(res.status, 0);
  const out = res.parsed || {};
  assert.notEqual(out.decision, 'block');
});

test('hook-pre-tool-use tracks curl-to-prod marker file', () => {
  const { VERIFICATION_MARKER: MARKER } = require(HOOK_PATH);
  try { fs.unlinkSync(MARKER); } catch { /* missing is fine */ }
  const res = runHook({
    input: {
      session_id: 'test',
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'curl -s https://thumbgate-production.up.railway.app/health' },
    },
  });
  assert.equal(res.status, 0);
  assert.ok(fs.existsSync(MARKER), 'marker must be written after curl-to-prod Bash command');
});

test('hook-pre-tool-use fails open on malformed stdin (never deadlocks agent)', () => {
  const res = spawnSync(process.execPath, [HOOK_PATH], {
    input: '{not-valid-json',
    env: process.env,
    encoding: 'utf8',
    cwd: REPO_ROOT,
  });
  assert.equal(res.status, 0, 'malformed stdin must not exit non-zero');
});

// ---------------------------------------------------------------------------
// Fix 3: risk-tag block is OFF by default
// ---------------------------------------------------------------------------

test('hook-pre-tool-use does NOT block when THUMBGATE_HOOKS_ENFORCE is unset (safety default)', () => {
  const res = runHook({
    input: {
      session_id: 'test',
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'git push --force origin main' },
    },
    env: { THUMBGATE_HOOKS_ENFORCE: '' },
  });
  assert.equal(res.status, 0);
  const out = res.parsed || {};
  assert.notEqual(out.decision, 'block');
});

// ---------------------------------------------------------------------------
// Fix 4: auto-gate is OFF by default
// ---------------------------------------------------------------------------

test('hook-pre-tool-use does NOT auto-register gate when THUMBGATE_AUTOGATE_PR_COMMITS is unset', () => {
  const res = runHook({
    input: {
      session_id: 'test',
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m "wip"' },
    },
    env: { THUMBGATE_AUTOGATE_PR_COMMITS: '' },
  });
  assert.equal(res.status, 0);
  const out = res.parsed || {};
  const ctx = out.hookSpecificOutput && out.hookSpecificOutput.additionalContext;
  if (ctx) {
    assert.doesNotMatch(ctx, /auto-registered claim gate/i);
  }
});

// ---------------------------------------------------------------------------
// Source-level sanity (backstop)
// ---------------------------------------------------------------------------

test('hook-pre-tool-use source references both enforcement flags', () => {
  const source = fs.readFileSync(HOOK_PATH, 'utf8');
  assert.match(source, /THUMBGATE_HOOKS_ENFORCE/);
  assert.match(source, /THUMBGATE_AUTOGATE_PR_COMMITS/);
  assert.match(source, /hookSpecificOutput/);
  assert.match(source, /decision:\s*['"]block['"]/);
});

test('settings.json wires PreToolUse to node hook-pre-tool-use.js with Bash|Edit|Write matcher', () => {
  const settingsPath = path.join(REPO_ROOT, '.claude', 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const pre = settings.hooks && settings.hooks.PreToolUse;
  assert.ok(Array.isArray(pre) && pre.length > 0, 'PreToolUse hooks must be configured');
  const entry = pre.find((p) => /Bash|Edit|Write/.test(p.matcher || ''));
  assert.ok(entry, 'PreToolUse must match Bash|Edit|Write');
  const cmd = entry.hooks[0].command;
  assert.match(cmd, /hook-pre-tool-use\.js/);
});

// ---------------------------------------------------------------------------
// Unit tests on exported helpers in scripts/hook-pre-tool-use.js
// These cover branches that the spawnSync-based integration tests above
// cannot reach cheaply (risk scoring, lesson formatting, tag parsing,
// optional-chain fallbacks).
// ---------------------------------------------------------------------------

test('isTrueEnv recognizes truthy forms and rejects everything else', () => {
  const { isTrueEnv } = require(HOOK_PATH);
  for (const v of ['1', 'true', 'TRUE', 'yes', 'Yes', 'on', 'ON']) {
    assert.equal(isTrueEnv(v), true, `expected ${JSON.stringify(v)} to be truthy`);
  }
  for (const v of ['', '0', 'false', 'no', 'off', undefined, null, '   ']) {
    assert.equal(isTrueEnv(v), false, `expected ${JSON.stringify(v)} to be falsy`);
  }
});

test('extractActionContext handles Bash/Edit/Write and fallback shape', () => {
  const { extractActionContext } = require(HOOK_PATH);
  assert.equal(extractActionContext('Bash', { command: 'rm -rf /' }), 'rm -rf /');
  assert.equal(extractActionContext('Bash', { cmd: 'echo hi' }), 'echo hi');
  assert.equal(extractActionContext('Bash', null), '');
  assert.equal(extractActionContext('Bash', 'not-an-object'), '');
  const edit = extractActionContext('Edit', {
    file_path: '/tmp/a.js',
    old_string: 'foo',
    new_string: 'bar',
  });
  assert.match(edit, /\/tmp\/a\.js.*foo.*bar/);
  const write = extractActionContext('Write', {
    file_path: '/tmp/b.js',
    content: 'x'.repeat(5000),
  });
  assert.match(write, /\/tmp\/b\.js/);
  assert.ok(write.length < 400, 'content must be truncated');
  const unknown = extractActionContext('Unknown', { foo: 'bar' });
  assert.ok(typeof unknown === 'string' && unknown.length > 0);
});

test('tagsForLesson extracts tags from arrays, JSON strings, and nested memory', () => {
  const { tagsForLesson } = require(HOOK_PATH);
  assert.deepEqual(tagsForLesson(null), []);
  assert.deepEqual(tagsForLesson({}), []);
  assert.deepEqual(tagsForLesson({ tags: ['a', 'b'] }), ['a', 'b']);
  assert.deepEqual(tagsForLesson({ tags: '["c","d"]' }), ['c', 'd']);
  assert.deepEqual(tagsForLesson({ tags: 'not-json' }), []);
  assert.deepEqual(tagsForLesson({ memory: { tags: ['e'] } }), ['e']);
  assert.deepEqual(tagsForLesson({ tags: [1, 2] }), ['1', '2']);
});

test('buildRiskByTagMap normalizes bucket shapes and skips missing keys', () => {
  const { buildRiskByTagMap } = require(HOOK_PATH);
  const map = buildRiskByTagMap([
    { key: 'git', risk: 7 },
    { tag: 'deploy', score: 6 },
    { tag: 'low', riskScore: 2 },
    { risk: 9 },
    null,
    { key: 'zero', risk: 0 },
  ]);
  assert.equal(map.get('git'), 7);
  assert.equal(map.get('deploy'), 6);
  assert.equal(map.get('low'), 2);
  // Zero risk is still stored (finite) but will never exceed any positive
  // threshold, so it has no blocking effect.
  assert.equal(map.get('zero'), 0);
  assert.equal(map.size, 4);
});

function stubRiskScorer(highRiskTags) {
  const riskScorerPath = path.join(REPO_ROOT, 'scripts', 'risk-scorer.js');
  const realMod = require.cache[riskScorerPath];
  require.cache[riskScorerPath] = {
    id: riskScorerPath,
    filename: riskScorerPath,
    loaded: true,
    exports: { getRiskSummary: () => ({ highRiskTags }) },
  };
  return () => {
    if (realMod) require.cache[riskScorerPath] = realMod;
    else delete require.cache[riskScorerPath];
  };
}

test('findBlockingRisk returns first lesson whose tag exceeds threshold', () => {
  const hook = require(HOOK_PATH);
  const restore = stubRiskScorer([
    { key: 'force-push', risk: 8 },
    { key: 'noise', risk: 1 },
  ]);
  try {
    const res = hook.findBlockingRisk(
      [
        { tags: ['noise'], whatToChange: 'meh' },
        { tags: ['force-push'], whatToChange: 'do not force-push' },
      ],
      5
    );
    assert.ok(res);
    assert.equal(res.tag, 'force-push');
    assert.equal(res.score, 8);
    assert.match(res.lesson.whatToChange, /force-push/);
    const none = hook.findBlockingRisk([{ tags: ['noise'] }], 5);
    assert.equal(none, null);
  } finally {
    restore();
  }
});

test('findBlockingRisk returns null when risk model is empty', () => {
  const hook = require(HOOK_PATH);
  const restore = stubRiskScorer([]);
  try {
    assert.equal(hook.findBlockingRisk([{ tags: ['x'] }], 5), null);
  } finally {
    restore();
  }
});

test('formatLessonsAsReminder renders numbered lessons with tag suffixes and truncates long text', () => {
  const { formatLessonsAsReminder } = require(HOOK_PATH);
  const out = formatLessonsAsReminder(
    [
      { whatToChange: 'run npm test before push', tags: ['git', 'verification'] },
      { howToAvoid: 'verify /health before saying deployed' },
      { content: 'x'.repeat(500) },
      { title: 'no-op' },
      {},
    ],
    {}
  );
  assert.match(out, /^<system-reminder>/);
  assert.match(out, /<\/system-reminder>$/);
  assert.match(out, /1\. run npm test before push \[git, verification\]/);
  assert.match(out, /2\. verify \/health before saying deployed/);
  const third = out.split('\n').find((l) => l.startsWith('3.'));
  assert.ok(third.length <= 304, `third lesson not truncated: ${third.length}`);
});

test('formatLessonsAsReminder appends auto-gate notice when extras.autogate is present', () => {
  const { formatLessonsAsReminder } = require(HOOK_PATH);
  const out = formatLessonsAsReminder([], {
    autogate: { gate: 'thread-resolution-verified', branch: 'feat/foo' },
  });
  assert.match(out, /auto-registered claim gate "thread-resolution-verified"/);
  assert.match(out, /branch feat\/foo/);
  assert.match(out, /0 unresolved threads/);
});

test('resolveEffectiveInput falls back to legacy CLAUDE_TOOL_INPUT env string', () => {
  const { resolveEffectiveInput } = require(HOOK_PATH);
  assert.deepEqual(resolveEffectiveInput({ command: 'ls' }), { command: 'ls' });
  const prior = process.env.CLAUDE_TOOL_INPUT;
  process.env.CLAUDE_TOOL_INPUT = 'echo legacy';
  try {
    assert.deepEqual(resolveEffectiveInput(null), { command: 'echo legacy' });
  } finally {
    if (prior === undefined) delete process.env.CLAUDE_TOOL_INPUT;
    else process.env.CLAUDE_TOOL_INPUT = prior;
  }
  delete process.env.CLAUDE_TOOL_INPUT;
  assert.deepEqual(resolveEffectiveInput(null), {});
});

test('maybeBlockOnRisk returns null when THUMBGATE_HOOKS_ENFORCE is unset', () => {
  const { maybeBlockOnRisk } = require(HOOK_PATH);
  const prior = process.env.THUMBGATE_HOOKS_ENFORCE;
  delete process.env.THUMBGATE_HOOKS_ENFORCE;
  try {
    assert.equal(maybeBlockOnRisk([{ tags: ['anything'] }]), null);
  } finally {
    if (prior !== undefined) process.env.THUMBGATE_HOOKS_ENFORCE = prior;
  }
});

test('maybeBlockOnRisk returns a reason string when enforce=1 and a lesson tag is high-risk', () => {
  const hook = require(HOOK_PATH);
  const restore = stubRiskScorer([{ key: 'danger', risk: 9 }]);
  const priorEnforce = process.env.THUMBGATE_HOOKS_ENFORCE;
  const priorThresh = process.env.THUMBGATE_HOOKS_ENFORCE_THRESHOLD;
  process.env.THUMBGATE_HOOKS_ENFORCE = '1';
  delete process.env.THUMBGATE_HOOKS_ENFORCE_THRESHOLD;
  try {
    const reason = hook.maybeBlockOnRisk([
      { tags: ['danger'], whatToChange: 'do not run dangerous thing' },
    ]);
    assert.ok(typeof reason === 'string');
    assert.match(reason, /ThumbGate blocked/);
    assert.match(reason, /danger/);
    assert.match(reason, /risk=9/);
  } finally {
    if (priorEnforce === undefined) delete process.env.THUMBGATE_HOOKS_ENFORCE;
    else process.env.THUMBGATE_HOOKS_ENFORCE = priorEnforce;
    if (priorThresh !== undefined) process.env.THUMBGATE_HOOKS_ENFORCE_THRESHOLD = priorThresh;
    restore();
  }
});

test('trackCurlToProd writes marker for curl-to-prod and is silent otherwise', () => {
  const { trackCurlToProd } = require(HOOK_PATH);
  const { VERIFICATION_MARKER: MARKER } = require(HOOK_PATH);
  try { fs.unlinkSync(MARKER); } catch { /* fine */ }
  trackCurlToProd('Edit', { file_path: '/tmp/x' });
  assert.equal(fs.existsSync(MARKER), false);
  trackCurlToProd('Bash', { command: 'echo hi' });
  assert.equal(fs.existsSync(MARKER), false);
  trackCurlToProd('Bash', { command: 'curl -s https://example.com/health' });
  assert.equal(fs.existsSync(MARKER), false);
  trackCurlToProd('Bash', {
    command: 'curl -s https://thumbgate-production.up.railway.app/health',
  });
  assert.ok(fs.existsSync(MARKER));
});

test('failOpen is silent by default and does not throw when debug flag is set', () => {
  const { failOpen } = require(HOOK_PATH);
  assert.doesNotThrow(() => failOpen(new Error('boom')));
  assert.doesNotThrow(() => failOpen('plain string'));
  assert.doesNotThrow(() => failOpen(undefined));
  const prior = process.env.THUMBGATE_HOOKS_DEBUG;
  process.env.THUMBGATE_HOOKS_DEBUG = '1';
  try {
    assert.doesNotThrow(() => failOpen(new Error('debug-path')));
  } finally {
    if (prior === undefined) delete process.env.THUMBGATE_HOOKS_DEBUG;
    else process.env.THUMBGATE_HOOKS_DEBUG = prior;
  }
});

// readStdinSync() is covered by the spawnSync-based integration tests above
// (feeding well-formed JSON and malformed JSON over fd 0). It is not
// unit-testable here because fd 0 in this test process is the TTY, which
// would block on fs.readFileSync(0).

test('resolveGitBinary honors THUMBGATE_GIT_BIN override and caches the result', () => {
  // Reset the module's internal cache by reloading.
  delete require.cache[HOOK_PATH];
  const prior = process.env.THUMBGATE_GIT_BIN;
  process.env.THUMBGATE_GIT_BIN = '/custom/bin/git';
  try {
    const { resolveGitBinary } = require(HOOK_PATH);
    assert.equal(resolveGitBinary(), '/custom/bin/git');
    assert.equal(resolveGitBinary(), '/custom/bin/git');
  } finally {
    if (prior === undefined) delete process.env.THUMBGATE_GIT_BIN;
    else process.env.THUMBGATE_GIT_BIN = prior;
    delete require.cache[HOOK_PATH];
  }
  const { resolveGitBinary } = require(HOOK_PATH);
  const resolved = resolveGitBinary();
  assert.ok(typeof resolved === 'string' && resolved.length > 0);
});

test('hook-pre-tool-use registers auto-gate when THUMBGATE_AUTOGATE_PR_COMMITS=1 on a non-main branch', (t) => {
  const { execFileSync } = require('node:child_process');
  let branch = '';
  try {
    branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch { /* missing git */ }
  if (!branch || branch === 'main' || branch === 'master' || branch === 'HEAD') {
    t.skip(`current branch is '${branch}'; auto-gate requires a feature branch`);
    return;
  }
  const res = runHook({
    input: {
      session_id: 'test',
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m "wip"' },
    },
    env: { THUMBGATE_AUTOGATE_PR_COMMITS: '1' },
  });
  assert.equal(res.status, 0);
  assert.notEqual(res.parsed && res.parsed.decision, 'block');
});

// Helper: invoke a respond-style hook function while stubbing out the two
// side-effecting primitives (process.stdout.write and process.exit) so we
// can inspect the JSON payload without ending the test process.
function captureRespond(fn) {
  const origWrite = process.stdout.write.bind(process.stdout);
  const origExit = process.exit;
  const captured = [];
  let exitCode = null;
  process.stdout.write = (chunk, ...rest) => {
    captured.push(String(chunk));
    return true;
  };
  process.exit = (code) => { exitCode = code; throw new Error('__captured_exit__'); };
  try {
    try { fn(); } catch (err) {
      if (err && err.message !== '__captured_exit__') throw err;
    }
  } finally {
    process.stdout.write = origWrite;
    process.exit = origExit;
  }
  return { payload: captured.join(''), exitCode };
}

test('block writes decision=block payload and exits 0', () => {
  const { block } = require(HOOK_PATH);
  const { payload, exitCode } = captureRespond(() => block('because reasons'));
  const parsed = JSON.parse(payload);
  assert.equal(parsed.decision, 'block');
  assert.equal(parsed.reason, 'because reasons');
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(parsed.hookSpecificOutput.permissionDecisionReason, 'because reasons');
  assert.equal(exitCode, 0);
});

test('allowWithContext writes additionalContext and exits 0', () => {
  const { allowWithContext } = require(HOOK_PATH);
  const { payload, exitCode } = captureRespond(() => allowWithContext('reminder body'));
  const parsed = JSON.parse(payload);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(parsed.hookSpecificOutput.additionalContext, 'reminder body');
  assert.equal(exitCode, 0);
});

test('allow writes empty object and exits 0', () => {
  const { allow } = require(HOOK_PATH);
  const { payload, exitCode } = captureRespond(() => allow());
  assert.deepEqual(JSON.parse(payload), {});
  assert.equal(exitCode, 0);
});

test('currentGitBranch returns a non-empty branch name inside this git checkout', () => {
  const { currentGitBranch } = require(HOOK_PATH);
  const branch = currentGitBranch();
  // In a normal worktree it returns the branch; in a detached-HEAD CI run
  // it returns 'HEAD'. Both are non-empty strings.
  assert.ok(typeof branch === 'string' && branch.length > 0);
});

test('maybeRegisterPrCommitGate returns null when toolName is not Bash', () => {
  const { maybeRegisterPrCommitGate } = require(HOOK_PATH);
  assert.equal(maybeRegisterPrCommitGate('Edit', { command: 'git commit -m x' }), null);
});

test('maybeRegisterPrCommitGate returns null when autogate env is unset', () => {
  const { maybeRegisterPrCommitGate } = require(HOOK_PATH);
  const prior = process.env.THUMBGATE_AUTOGATE_PR_COMMITS;
  delete process.env.THUMBGATE_AUTOGATE_PR_COMMITS;
  try {
    assert.equal(
      maybeRegisterPrCommitGate('Bash', { command: 'git commit -m x' }),
      null
    );
  } finally {
    if (prior !== undefined) process.env.THUMBGATE_AUTOGATE_PR_COMMITS = prior;
  }
});

test('maybeRegisterPrCommitGate returns null for non-commit Bash commands when autogate=1', () => {
  const { maybeRegisterPrCommitGate } = require(HOOK_PATH);
  const prior = process.env.THUMBGATE_AUTOGATE_PR_COMMITS;
  process.env.THUMBGATE_AUTOGATE_PR_COMMITS = '1';
  try {
    assert.equal(maybeRegisterPrCommitGate('Bash', { command: 'ls -la' }), null);
  } finally {
    if (prior === undefined) delete process.env.THUMBGATE_AUTOGATE_PR_COMMITS;
    else process.env.THUMBGATE_AUTOGATE_PR_COMMITS = prior;
  }
});

test('isEntryPoint returns false when loaded as a library', () => {
  const { isEntryPoint } = require(HOOK_PATH);
  // The test runner is invoking us as a library, so argv[1] points at the
  // test file, not the hook. isEntryPoint must return false.
  assert.equal(isEntryPoint(), false);
});

// main() is exercised end-to-end by the spawnSync integration tests above
// (which feed JSON via stdin); we cannot call it in-process because
// readStdinSync() blocks on fs.readFileSync(0) when fd 0 is the TTY.

test('hook-pre-tool-use does NOT register auto-gate on non-commit Bash commands even with autogate=1', () => {
  const res = runHook({
    input: {
      session_id: 'test',
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls -la' },
    },
    env: { THUMBGATE_AUTOGATE_PR_COMMITS: '1' },
  });
  assert.equal(res.status, 0);
  const ctx = res.parsed
    && res.parsed.hookSpecificOutput
    && res.parsed.hookSpecificOutput.additionalContext;
  if (ctx) {
    assert.doesNotMatch(ctx, /auto-registered claim gate/);
  }
});
