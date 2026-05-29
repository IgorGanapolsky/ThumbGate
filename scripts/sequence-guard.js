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
    if (!fs.existsSync(SEQUENCE_STATE_PATH)) return { dirty: false, lastEditAt: 0 };
    return JSON.parse(fs.readFileSync(SEQUENCE_STATE_PATH, 'utf8'));
  } catch {
    return { dirty: false, lastEditAt: 0 };
  }
}

function saveState(state) {
  try {
    fs.mkdirSync(path.dirname(SEQUENCE_STATE_PATH), { recursive: true });
    fs.writeFileSync(SEQUENCE_STATE_PATH, JSON.stringify(state, null, 2));
  } catch (e) {}
}

function evaluateSequenceState(toolName, toolInput) {
  const state = loadState();
  const now = Date.now();

  if (EDIT_LIKE_TOOLS.has(toolName)) {
    state.dirty = true;
    state.lastEditAt = now;
    saveState(state);
  }

  let testsPassedAt = 0;
  try {
    if (fs.existsSync(SESSION_ACTIONS_PATH)) {
      const actions = JSON.parse(fs.readFileSync(SESSION_ACTIONS_PATH, 'utf8'));
      if (actions.tests_passed) testsPassedAt = actions.tests_passed.timestamp;
    }
  } catch {}

  if (testsPassedAt > state.lastEditAt) {
    state.dirty = false;
    saveState(state);
  }

  const isCompletion = (toolName === 'Bash' && COMPLETION_BASH_PATTERN.test(toolInput.command || '')) ||
                       (toolName === 'complete_handoff');

  if (isCompletion && state.dirty) {
    return {
      decision: 'deny',
      gate: 'workflow-sequence-violation',
      message: '✗ THUMBGATE: Action blocked. Source edited but not verified.',
      severity: 'critical'
    };
  }
  return null;
}

module.exports = { evaluateSequenceState, loadState, saveState };
