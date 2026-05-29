'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { evaluateSequenceState, saveState } = require('../scripts/sequence-guard');

const SEQUENCE_STATE_PATH = path.join(process.env.HOME || '/tmp', '.thumbgate', 'sequence-state.json');
const SESSION_ACTIONS_PATH = path.join(process.env.HOME || '/tmp', '.thumbgate', 'session-actions.json');

test('sequence-guard - sets dirty flag on source edit', () => {
  saveState({ dirty: false, lastEditAt: 0 });
  const result = evaluateSequenceState('Edit', { filePath: 'src/api/server.js' });
  assert.equal(result, null);
  const state = JSON.parse(fs.readFileSync(SEQUENCE_STATE_PATH, 'utf8'));
  assert.equal(state.dirty, true);
});

test('sequence-guard - blocks commit when dirty', () => {
  saveState({ dirty: true, lastEditAt: Date.now() });
  if (fs.existsSync(SESSION_ACTIONS_PATH)) {
    const actions = JSON.parse(fs.readFileSync(SESSION_ACTIONS_PATH, 'utf8'));
    delete actions.tests_passed;
    fs.writeFileSync(SESSION_ACTIONS_PATH, JSON.stringify(actions));
  }
  const result = evaluateSequenceState('Bash', { command: 'git commit -m "fixed"' });
  assert.ok(result);
  assert.equal(result.decision, 'deny');
});

test('sequence-guard - allows commit after tests_passed', () => {
  const editTime = Date.now();
  saveState({ dirty: true, lastEditAt: editTime });
  const actions = fs.existsSync(SESSION_ACTIONS_PATH) ? JSON.parse(fs.readFileSync(SESSION_ACTIONS_PATH, 'utf8')) : {};
  actions.tests_passed = { timestamp: editTime + 1000, metadata: {} };
  fs.writeFileSync(SESSION_ACTIONS_PATH, JSON.stringify(actions));
  const result = evaluateSequenceState('Bash', { command: 'git commit -m "verified"' });
  assert.equal(result, null);
});
