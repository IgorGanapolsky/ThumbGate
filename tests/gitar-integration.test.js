'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('Gitar review instructions capture ThumbGate-specific high-risk surfaces', () => {
  const rules = read('.gitar/review/thumbgate-core-review-rules.md');

  assert.match(rules, /scripts\/gates-engine\.js/);
  assert.match(rules, /adapters\/mcp\//);
  assert.match(rules, /bin\/cli\.js/);
  assert.match(rules, /ChatGPT native thumbs buttons are not ThumbGate memory capture/);
  assert.match(rules, /official marketplace\/listing claims/i);
  assert.match(rules, /dry-run mode/i);
});

test('Gitar feedback instructions require repeatable findings before ThumbGate promotion', () => {
  const rules = read('.gitar/review/thumbgate-feedback-to-rules.md');

  assert.match(rules, /Promote to ThumbGate Lessons/i);
  assert.match(rules, /more than one PR/i);
  assert.match(rules, /Do Not Promote/i);
  assert.match(rules, /chmod 600/);
  assert.match(rules, /thumbs down:/);
  assert.match(rules, /thumbs up:/);
});

test('Gitar approval policy prevents AI-only approval on high-risk ThumbGate changes', () => {
  const policy = read('.gitar/config/approve.md');

  assert.match(policy, /must not be the sole approval authority/i);
  assert.match(policy, /Do not auto-approve PRs that touch/i);
  assert.match(policy, /scripts\/gates-engine\.js/);
  assert.match(policy, /\.github\/workflows\//);
  assert.match(policy, /Stripe, Railway, GCP, Vertex, Dialogflow CX, Sentry, Sonar, npm, GitHub Release/);
  assert.match(policy, /Human or existing repository merge policy remains the final authority/);
});

test('Gitar pilot runbook keeps rollout non-blocking until measured', () => {
  const doc = read('docs/integrations/gitar-pilot.md');

  assert.match(doc, /Run Gitar as non-blocking/i);
  assert.match(doc, /Keep branch protection unchanged during the pilot/i);
  assert.match(doc, /False positives per PR/i);
  assert.match(doc, /Findings converted to ThumbGate lessons/i);
  assert.match(doc, /Do not let it auto-merge/i);
  assert.match(doc, /Promote Gitar from advisory to required only if/i);
});

