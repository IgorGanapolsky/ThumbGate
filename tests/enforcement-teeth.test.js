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
  const MARKER = '/tmp/.thumbgate-last-deploy-verify';
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
