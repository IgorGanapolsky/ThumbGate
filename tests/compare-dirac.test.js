'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'public', 'compare', 'dirac.html'), 'utf8');
const HUB = fs.readFileSync(path.join(ROOT, 'public', 'compare.html'), 'utf8');
const LLM = fs.readFileSync(path.join(ROOT, 'public', 'llm-context.md'), 'utf8');

test('compare page states adjacent not substitute and links the live Dirac site', () => {
  assert.match(PAGE, /Adjacent, not a substitute|adjacent, not a substitute|not a clone/i);
  assert.match(PAGE, /https:\/\/dirac\.run\//);
  assert.match(PAGE, /PreToolUse/);
  assert.match(PAGE, /hash-anchored|AST/i);
  assert.doesNotMatch(PAGE, /we power Dirac|we are Dirac/i);
});

test('compare page does not claim Dirac eval numbers as ThumbGate measurements', () => {
  assert.match(PAGE, /64\.8%/);
  assert.match(PAGE, /not ours|does not inherit|do not republish|not a ThumbGate measurement/i);
  assert.doesNotMatch(PAGE, /ThumbGate is 64\.8% cheaper/i);
  assert.doesNotMatch(PAGE, /we perform hash-anchored edits/i);
});

test('compare page does not claim default hard-block of rm -rf', () => {
  assert.doesNotMatch(PAGE, /hard-block(?:s)?\s+.*rm\s+-rf/i);
  assert.match(PAGE, /warn unless STRICT/i);
});

test('hub links the Dirac compare page', () => {
  assert.match(HUB, /href="\/compare\/dirac"/);
});

test('compare page exposes FAQPage JSON-LD for GEO parsers', () => {
  assert.match(PAGE, /"@type":\s*"FAQPage"/);
  assert.match(PAGE, /Is Dirac a ThumbGate competitor/);
});

test('filesystem catalog includes dirac.html so sitemap auto-include cannot miss it', () => {
  const compareDir = path.join(ROOT, 'public', 'compare');
  assert.ok(fs.existsSync(path.join(compareDir, 'dirac.html')));
  const catalog = fs.readdirSync(compareDir).filter((name) => name.endsWith('.html'));
  assert.ok(catalog.includes('dirac.html'));
});

test('llm-context names the Dirac boundary without inheriting their cost %', () => {
  assert.match(LLM, /\/compare\/dirac/);
  assert.match(LLM, /token-efficient coding agent/i);
  assert.doesNotMatch(LLM, /ThumbGate is 64\.8% cheaper/i);
});
