'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const indexHtml = read('public', 'index.html');
const compareHtml = read('public', 'compare.html');
const orchestrationHtml = read('public', 'compare', 'ai-experience-orchestration.html');
const platformTeamsHtml = read('public', 'use-cases', 'platform-teams.html');
const regulatedHtml = read('public', 'use-cases', 'regulated-workflows.html');

test('homepage positions ThumbGate as the enforcement layer inside orchestration', () => {
  assert.match(indexHtml, /Enforcement is the missing layer in AI orchestration/i);
  assert.match(indexHtml, /what should happen next/i);
  assert.match(indexHtml, /what is allowed to execute/i);
  assert.match(indexHtml, /Broad orchestration platforms/i);
  assert.match(indexHtml, /ThumbGate/i);
});

test('homepage links to new orchestration comparison and buyer workflow pages', () => {
  assert.match(indexHtml, /\/compare\/ai-experience-orchestration/);
  assert.match(indexHtml, /\/use-cases\/platform-teams/);
  assert.match(indexHtml, /\/use-cases\/regulated-workflows/);
});

test('compare hub links to orchestration comparison page', () => {
  assert.match(compareHtml, /Evaluating bigger orchestration platforms/i);
  assert.match(compareHtml, /\/compare\/ai-experience-orchestration/);
});

test('orchestration comparison page exists with schema and stack framing', () => {
  assert.match(orchestrationHtml, /"@type": "TechArticle"/);
  assert.match(orchestrationHtml, /AI experience orchestration still needs an enforcement layer/i);
  assert.match(orchestrationHtml, /Use orchestration to decide what should happen next/i);
  assert.match(orchestrationHtml, /Use ThumbGate to decide what is allowed to execute/i);
  assert.match(orchestrationHtml, /Claude Code, Cursor, Codex, Gemini, Amp, OpenCode/i);
});

test('platform-team use case page exists with rollout language', () => {
  assert.match(platformTeamsHtml, /ThumbGate for platform teams/i);
  assert.match(platformTeamsHtml, /one repo, one owner, and one repeated AI failure/i);
  assert.match(platformTeamsHtml, /shared lessons/i);
  assert.match(platformTeamsHtml, /workflow hardening sprint/i);
});

test('regulated workflow page exists without fake compliance claims', () => {
  assert.match(regulatedHtml, /regulated and high-trust workflows/i);
  assert.match(regulatedHtml, /approval boundaries/i);
  assert.match(regulatedHtml, /execution control/i);
  assert.match(regulatedHtml, /does not market itself as a compliance badge/i);
});
