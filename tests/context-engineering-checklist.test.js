'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

test('context-engineering checklist skill exists with course map', () => {
  const skill = path.join(ROOT, 'skills', 'context-engineering-checklist', 'SKILL.md');
  assert.ok(fs.existsSync(skill), 'skill path');
  const body = fs.readFileSync(skill, 'utf8');
  assert.ok(body.startsWith('---'), 'frontmatter');
  assert.match(body, /name:\s*context-engineering-checklist/);
  assert.match(body, /Unit 1|Skills/i);
  assert.match(body, /Unit 5|Hooks|gate/i);
  assert.match(body, /matchable|tool/i);
  assert.match(body, /AGENT-259|hard floor|PreToolUse/i);
});

test('gsd-ralph skill documents both loops', () => {
  const skill = path.join(ROOT, 'skills', 'gsd-ralph-context-loop', 'SKILL.md');
  assert.ok(fs.existsSync(skill));
  const body = fs.readFileSync(skill, 'utf8');
  assert.match(body, /Capture/);
  assert.match(body, /Ralph|Promote|Enforce/i);
  assert.match(body, /parallel/i);
});

test('context-engineering docs map HF course to ThumbGate', () => {
  const doc = path.join(ROOT, 'docs', 'context-engineering', 'README.md');
  assert.ok(fs.existsSync(doc));
  const body = fs.readFileSync(doc, 'utf8');
  assert.match(body, /huggingface\.co\/learn\/context-course/);
  assert.match(body, /GSD/);
  assert.match(body, /Ralph/);
});

test('context-engineering-pr-check workflow has verify phase', () => {
  const wf = path.join(ROOT, '.grok', 'workflows', 'context-engineering-pr-check.rhai');
  assert.ok(fs.existsSync(wf));
  const body = fs.readFileSync(wf, 'utf8');
  assert.match(body, /Verify|verify/);
  assert.match(body, /u5-hooks|hooks/);
});
