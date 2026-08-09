'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MANDATE_PATH = path.join(__dirname, '..', '.agents', 'skills', 'autonomous-execution-mandate', 'SKILL.md');

test('Autonomous Execution Mandate: skill file exists and defines zero-nudging rules', () => {
  assert.ok(fs.existsSync(MANDATE_PATH), 'autonomous-execution-mandate SKILL.md must exist');
  const content = fs.readFileSync(MANDATE_PATH, 'utf8');

  assert.match(content, /autonomous-execution-mandate/i);
  assert.match(content, /Autonomous Task Chaining/i);
  assert.match(content, /Zero Nudging/i);
  assert.match(content, /Strict Non-Overclaim Verification/i);
});
