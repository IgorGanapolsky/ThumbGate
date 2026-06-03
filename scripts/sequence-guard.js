#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const SEQUENCE_STATE_PATH = path.join(process.env.HOME || '/tmp', '.thumbgate', 'sequence-state.json');
const SESSION_ACTIONS_PATH = path.join(process.env.HOME || '/tmp', '.thumbgate', 'session-actions.json');
const EDIT_LIKE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);
const COMPLETION_BASH_PATTERN = /\b(?:git\s+commit|gh\s+pr\s+merge|npm\s+publish|yarn\s+publish|pnpm\s+publish)\b/i;

function loadState() {
  try {
    if (!fs.existsSync(SEQUENCE_STATE_PATH)) return { repos: {} };
    const raw = JSON.parse(fs.readFileSync(SEQUENCE_STATE_PATH, 'utf8'));
    if (raw && typeof raw === 'object' && raw.repos && typeof raw.repos === 'object') return raw;
    // Legacy flat format ({dirty,lastEditAt}) was a single GLOBAL bucket that caused
    // cross-repo contamination (an edit in repo A blocked commits in repo B). Drop it
    // and start per-repo; the worst case is one extra commit allowed, never a wrong block.
    return { repos: {} };
  } catch {
    return { repos: {} };
  }
}

function saveState(state) {
  try {
    fs.mkdirSync(path.dirname(SEQUENCE_STATE_PATH), { recursive: true });
    fs.writeFileSync(SEQUENCE_STATE_PATH, JSON.stringify(state, null, 2));
  } catch (e) {}
}

// Resolve which repo an action belongs to, so "edited but not verified" is tracked
// per-repo instead of one global flag. Walks up from the action's path to the nearest
// .git; falls back to the base directory when none is found.
function expandHome(p) {
  return String(p || '').replace(/^~(?=\/|$)/, process.env.HOME || '');
}

function resolveRepoKey(toolName, toolInput = {}) {
  let base = '';
  if (EDIT_LIKE_TOOLS.has(toolName)) {
    const fp = toolInput.file_path || toolInput.path || toolInput.filePath || toolInput.target_path;
    if (fp) base = path.dirname(path.resolve(expandHome(String(fp))));
  } else if (toolName === 'Bash') {
    const cmd = String(toolInput.command || '');
    // honor both `cd <path>` and `git -C <path>` — both set the effective repo dir
    const m = cmd.match(/\bcd\s+(['"]?)([^&;|'"]+)\1/)
      || cmd.match(/\bgit\b[^&;|]*?\s-C\s+(['"]?)([^&;|'"\s]+)\1/);
    if (m) base = path.resolve(expandHome(m[2].trim()));
  }
  if (!base && toolInput.repoPath) base = path.resolve(expandHome(String(toolInput.repoPath)));
  if (!base) base = process.cwd();

  let dir = base;
  for (let i = 0; i < 40; i++) {
    try {
      if (fs.existsSync(path.join(dir, '.git'))) return dir;
    } catch { /* ignore */ }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return base;
}

function evaluateSequenceState(toolName, toolInput) {
  const state = loadState();
  const now = Date.now();
  const repoKey = resolveRepoKey(toolName, toolInput);
  const entry = state.repos[repoKey] || { dirty: false, lastEditAt: 0 };

  if (EDIT_LIKE_TOOLS.has(toolName)) {
    entry.dirty = true;
    entry.lastEditAt = now;
    state.repos[repoKey] = entry;
    saveState(state);
  }

  let testsPassedAt = 0;
  try {
    if (fs.existsSync(SESSION_ACTIONS_PATH)) {
      const actions = JSON.parse(fs.readFileSync(SESSION_ACTIONS_PATH, 'utf8'));
      if (actions.tests_passed) testsPassedAt = actions.tests_passed.timestamp;
    }
  } catch {}

  // tests_passed is a global signal (no repo attribution); treat it as clearing the
  // dirty flag for any repo whose last edit predates the passing test run.
  if (testsPassedAt > entry.lastEditAt && entry.dirty) {
    entry.dirty = false;
    state.repos[repoKey] = entry;
    saveState(state);
  }

  const isCompletion = (toolName === 'Bash' && COMPLETION_BASH_PATTERN.test(toolInput.command || '')) ||
                       (toolName === 'complete_handoff');

  if (isCompletion && entry.dirty) {
    return {
      decision: 'deny',
      gate: 'workflow-sequence-violation',
      message: '✗ THUMBGATE: Action blocked. Source edited but not verified.',
      severity: 'critical'
    };
  }
  return null;
}

module.exports = { evaluateSequenceState, loadState, saveState, resolveRepoKey };
