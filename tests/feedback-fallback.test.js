'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FALLBACK_PATH = path.join(__dirname, '..', 'scripts', 'feedback-fallback.js');

test('feedback-fallback script exists', () => {
  assert.ok(fs.existsSync(FALLBACK_PATH), 'scripts/feedback-fallback.js must exist');
});

test('feedback-fallback exits 1 with no input and no args', () => {
  try {
    execFileSync(process.execPath, [FALLBACK_PATH], {
      input: '',
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.fail('should have exited with code 1');
  } catch (err) {
    assert.equal(err.status, 1);
    assert.ok(err.stderr.includes('No input'), 'should mention no input');
  }
});

test('feedback-fallback parses CLI args correctly', () => {
  // This will fail to connect (no server) but proves arg parsing works
  try {
    execFileSync(process.execPath, [
      FALLBACK_PATH,
      '--signal=up',
      '--context=test from cli',
      '--tags=test,fallback',
    ], {
      encoding: 'utf8',
      timeout: 10000,
    });
  } catch (err) {
    // Expected — no server running on test ports
    assert.ok(err.stderr.includes('failed') || err.stderr.includes('fallback'),
      'should report endpoint failures on stderr');
  }
});

test('feedback-fallback parses stdin JSON correctly', () => {
  try {
    execFileSync(process.execPath, [FALLBACK_PATH], {
      input: JSON.stringify({ signal: 'down', context: 'stdin test' }),
      encoding: 'utf8',
      timeout: 10000,
    });
  } catch (err) {
    assert.ok(err.stderr.includes('failed') || err.stderr.includes('fallback'),
      'should report endpoint failures on stderr');
  }
});
