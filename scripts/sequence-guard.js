#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function resolveStatePath(filename) {
  const dir = process.env.THUMBGATE_STATE_DIR || 
              (process.env.XDG_STATE_HOME ? path.join(process.env.XDG_STATE_HOME, 'thumbgate') : null) ||
              (process.env.CODEX_SANDBOX ? path.join(require('os').tmpdir(), 'thumbgate') : null) ||
              path.join(process.env.HOME || '/tmp', '.thumbgate');
  return path.join(dir, filename);
}

const SEQUENCE_STATE_PATH = resolveStatePath('sequence-state.json');
const SESSION_ACTIONS_PATH = resolveStatePath('session-actions.json');
const GOVERNANCE_STATE_PATH = resolveStatePath('governance-state.json');

const EDIT_LIKE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);
const COMPLETION_BASH_PATTERN = /\b(?:git\s+commit|gh\s+pr\s+merge|npm\s+publish|yarn\s+publish|pnpm\s+publish)\b/i;

function loadState() {
  try {
    if (!fs.existsSync(SEQUENCE_STATE_PATH)) return { repos: {} };
    const raw = JSON.parse(fs.readFileSync(SEQUENCE_STATE_PATH, 'utf8'));
    if (raw && typeof raw === 'object' && raw.repos && typeof raw.repos === 'object') return raw;
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

function resolveRepoKey(toolName, toolInput = {}) {
  let base = '';
  if (EDIT_LIKE_TOOLS.has(toolName)) {
    const fp = toolInput.file_path || toolInput.path || toolInput.filePath || toolInput.target_path;
    if (fp) base = path.dirname(path.resolve(String(fp)));
  } else if (toolName === 'Bash') {
    const cmd = String(toolInput.command || '');
    const m = cmd.match(/\bcd\s+(['"]?)([^&;|'"]+)\1/);
    if (m) base = path.resolve(m[2].trim());
  }
  if (!base && toolInput.repoPath) base = path.resolve(String(toolInput.repoPath));
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

function normalizePosix(filePath) {
  return String(filePath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .trim();
}

function normalizeGlob(glob) {
  return normalizePosix(glob).replace(/\/+$/, '');
}

function globToRegExp(glob) {
  const normalized = normalizeGlob(glob);
  let pattern = '^';
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const next = normalized[i + 1];
    if (char === '*') {
      if (next === '*') {
        pattern += '.*';
        i += 1;
      } else {
        pattern += '[^/]*';
      }
      continue;
    }
    if ('\\^$+?.()|{}[]'.includes(char)) {
      pattern += `\\${char}`;
      continue;
    }
    pattern += char;
  }
  pattern += '$';
  return new RegExp(pattern);
}

function matchesGlob(filePath, glob) {
  if (!glob) return false;
  try {
    return globToRegExp(glob).test(normalizePosix(filePath));
  } catch {
    return false;
  }
}

function matchesAnyGlob(filePath, globs) {
  return Array.isArray(globs) && globs.some((glob) => matchesGlob(filePath, glob));
}

function getRepoModifiedFiles(repoPath) {
  const files = new Set();
  try {
    if (!fs.existsSync(path.join(repoPath, '.git'))) {
      return [];
    }
    // Staged files
    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: repoPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    staged.split('\n').map(f => f.trim()).filter(Boolean).forEach(f => files.add(f));

    // Unstaged files
    const unstaged = execFileSync('git', ['diff', '--name-only'], { cwd: repoPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    unstaged.split('\n').map(f => f.trim()).filter(Boolean).forEach(f => files.add(f));

    // Untracked files
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: repoPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    untracked.split('\n').map(f => f.trim()).filter(Boolean).forEach(f => files.add(f));
  } catch (e) {
    // Ignore execution failures
  }
  return [...files];
}

function evaluateSequenceState(toolName, toolInput) {
  const state = loadState();
  const now = Date.now();
  const repoKey = resolveRepoKey(toolName, toolInput);
  const entry = state.repos[repoKey] || { dirty: false, lastEditAt: 0 };

  // 1. Task Scope Verification
  let taskScope = null;
  try {
    if (fs.existsSync(GOVERNANCE_STATE_PATH)) {
      const gov = JSON.parse(fs.readFileSync(GOVERNANCE_STATE_PATH, 'utf8'));
      if (gov && gov.taskScope && typeof gov.taskScope === 'object') {
        taskScope = gov.taskScope;
      }
    }
  } catch {}

  if (taskScope && Array.isArray(taskScope.allowedPaths) && taskScope.allowedPaths.length > 0) {
    // Block file edits immediately if they touch files outside allowed paths
    if (EDIT_LIKE_TOOLS.has(toolName)) {
      const fp = toolInput.file_path || toolInput.path || toolInput.filePath || toolInput.target_path;
      if (fp) {
        const resolvedFp = path.resolve(String(fp));
        let repoRelPath = resolvedFp;
        if (taskScope.repoPath) {
          const resolvedRepoPath = path.resolve(taskScope.repoPath);
          if (resolvedFp.startsWith(resolvedRepoPath)) {
            repoRelPath = path.relative(resolvedRepoPath, resolvedFp);
          }
        }
        if (!matchesAnyGlob(repoRelPath, taskScope.allowedPaths)) {
          return {
            decision: 'deny',
            gate: 'task-scope-violation',
            message: `✗ THUMBGATE: Action blocked. File edit outside declared task scope: ${repoRelPath}. Allowed paths: ${taskScope.allowedPaths.join(', ')}`,
            severity: 'critical'
          };
        }
      }
    }
  }

  // 2. Dirty check tracking
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

  // tests_passed is a global signal; treat it as clearing dirty flag
  if (testsPassedAt > entry.lastEditAt && entry.dirty) {
    entry.dirty = false;
    state.repos[repoKey] = entry;
    saveState(state);
  }

  const isCompletion = (toolName === 'Bash' && COMPLETION_BASH_PATTERN.test(toolInput.command || '')) ||
                       (toolName === 'complete_handoff');

  if (isCompletion) {
    // Enforce Task Scope during commits / handoffs
    if (taskScope && Array.isArray(taskScope.allowedPaths) && taskScope.allowedPaths.length > 0) {
      const repoPath = taskScope.repoPath ? path.resolve(taskScope.repoPath) : repoKey;
      const modifiedFiles = getRepoModifiedFiles(repoPath);
      const outsideFiles = modifiedFiles.filter(f => !matchesAnyGlob(f, taskScope.allowedPaths));
      if (outsideFiles.length > 0) {
        return {
          decision: 'deny',
          gate: 'task-scope-violation',
          message: `✗ THUMBGATE: Action blocked. Staged or modified files outside declared task scope: ${outsideFiles.join(', ')}. Allowed paths: ${taskScope.allowedPaths.join(', ')}`,
          severity: 'critical'
        };
      }
    }

    // Verify tests passed
    if (entry.dirty) {
      return {
        decision: 'deny',
        gate: 'workflow-sequence-violation',
        message: '✗ THUMBGATE: Action blocked. Source edited but not verified.',
        severity: 'critical'
      };
    }
  }

  return null;
}

module.exports = { evaluateSequenceState, loadState, saveState, resolveRepoKey, getRepoModifiedFiles };
