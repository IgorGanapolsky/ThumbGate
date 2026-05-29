'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'scripts');
const REQUIRE_PROOF = path.join(SCRIPTS_DIR, 'require-proof.js');
const INGEST_FEEDBACK = path.join(SCRIPTS_DIR, 'ingest-manual-feedback.js');
const TEST_DIR = path.join(REPO_ROOT, 'tests', 'proof-test-sandbox');
const SESSION_ACTIONS_PATH = path.join(process.env.HOME || '/tmp', '.thumbgate', 'session-actions.json');

function setTestAction(actionId, exists = true) {
  if (!fs.existsSync(path.dirname(SESSION_ACTIONS_PATH))) {
    fs.mkdirSync(path.dirname(SESSION_ACTIONS_PATH), { recursive: true });
  }
  let actions = {};
  if (fs.existsSync(SESSION_ACTIONS_PATH)) {
    actions = JSON.parse(fs.readFileSync(SESSION_ACTIONS_PATH, 'utf8'));
  }
  if (exists) {
    actions[actionId] = { timestamp: Date.now(), metadata: { test: true } };
  } else {
    delete actions[actionId];
  }
  fs.writeFileSync(SESSION_ACTIONS_PATH, JSON.stringify(actions));
}

test('require-proof.js - blocks commit when source changed but no tests_passed', (t) => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
  execSync('git init', { cwd: TEST_DIR });
  
  const srcFile = path.join(TEST_DIR, 'scripts', 'logic.js');
  fs.mkdirSync(path.dirname(srcFile), { recursive: true });
  fs.writeFileSync(srcFile, 'console.log("test");');
  execSync('git add scripts/logic.js', { cwd: TEST_DIR });

  setTestAction('tests_passed', false);

  try {
    execSync(`node ${REQUIRE_PROOF}`, { cwd: TEST_DIR, stdio: 'pipe' });
    assert.fail('Should have failed without tests_passed evidence');
  } catch (err) {
    assert.ok(err.stderr.toString().includes('Completion evidence missing'), 'Error message should mention missing evidence');
  }
});

test('require-proof.js - allows commit when tests_passed is tracked', (t) => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
  execSync('git init', { cwd: TEST_DIR });
  
  const srcFile = path.join(TEST_DIR, 'scripts', 'logic.js');
  fs.mkdirSync(path.dirname(srcFile), { recursive: true });
  fs.writeFileSync(srcFile, 'console.log("test");');
  execSync('git add scripts/logic.js', { cwd: TEST_DIR });

  setTestAction('tests_passed', true);

  const output = execSync(`node ${REQUIRE_PROOF}`, { cwd: TEST_DIR, encoding: 'utf8' });
  assert.ok(output.includes('completion evidence verified'), 'Should verify completion evidence');
});

test('ingest-manual-feedback.js - ingests and marks files as ingested', (t) => {
  const memoryDir = path.join(REPO_ROOT, 'memory');
  if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true });
  
  const feedbackFile = path.join(memoryDir, 'feedback_test_mistake.md');
  const content = 'MISTAKE: This is a test failure';
  fs.writeFileSync(feedbackFile, content);

  execSync(`node ${INGEST_FEEDBACK}`, { cwd: REPO_ROOT });

  assert.ok(!fs.existsSync(feedbackFile), 'Original file should be gone');
  assert.ok(fs.existsSync(`${feedbackFile}.ingested`), 'File should be marked as ingested');
  
  if (fs.existsSync(`${feedbackFile}.ingested`)) fs.unlinkSync(`${feedbackFile}.ingested`);
});
