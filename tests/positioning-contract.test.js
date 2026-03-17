const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

test('package metadata leads with reliability instead of generic memory-layer phrasing', () => {
  const packageJson = readJson('package.json');

  assert.match(packageJson.description, /reliability layer/i);
  assert.match(packageJson.description, /without orchestration overhead/i);
  assert.doesNotMatch(packageJson.description, /Universal Context & Memory Layer/i);
});

test('README explains the product as one-agent reliability instead of more orchestration', () => {
  const readme = readText('README.md');

  assert.match(readme, /Local-first reliability layer for AI coding agents\./);
  assert.match(readme, /Keeps one sharp agent on task/i);
  assert.match(readme, /without adding orchestration or subagent handoff overhead/i);
  assert.match(readme, /without another planner or swarm/i);
  assert.match(readme, /Use MCP Memory Gateway as the reliability layer for recall, gates, and proof\./);
});

test('continuity guide frames the gateway as downstream reliability, not a new orchestrator', () => {
  const guide = readText(path.join('docs', 'guides', 'continuity-tools-integration.md'));

  assert.match(guide, /without adding an extra orchestrator, planner, or subagent layer/i);
  assert.match(guide, /Base agent: does the actual work/);
  assert.match(guide, /What this is not/);
  assert.match(guide, /Keep one sharp agent\./);
  assert.match(guide, /Do not add an orchestration layer unless it improves output enough to justify the handoff overhead\./);
});

test('launch-content variants align with reliability-over-orchestration positioning', () => {
  const launchContent = readText(path.join('docs', 'marketing', 'LAUNCH_CONTENT.md'));

  assert.match(launchContent, /AI reliability system|reliability layer/i);
  assert.match(launchContent, /one sharp agent|repeated mistakes/i);
  assert.doesNotMatch(launchContent, /persistent memory layer that fixes this/i);
  assert.doesNotMatch(launchContent, /persistent memory for Claude Code/i);
});
