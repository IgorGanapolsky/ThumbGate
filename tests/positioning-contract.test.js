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

test('package metadata leads with Pre-Action Gates instead of generic memory-layer phrasing', () => {
  const packageJson = readJson('package.json');

  assert.match(packageJson.description, /Pre-action gates/i);
  assert.match(packageJson.description, /prevention rules/i);
  assert.doesNotMatch(packageJson.description, /Universal Context & Memory Layer/i);
});

test('README explains the product as one-agent reliability instead of more orchestration', () => {
  const readme = readText('README.md');

  assert.match(readme, /pre-action gates/i);
  assert.match(readme, /without another planner or swarm/i);
  assert.match(readme, /reliability/i);
});

test('README exposes lesson search as a free self-hosted MCP surface', () => {
  const readme = readText('README.md');

  assert.match(readme, /search_lessons/i);
  assert.match(readme, /self-hosted users can invoke `search_lessons` directly through MCP/i);
  assert.match(readme, /npx mcp-memory-gateway lessons/i);
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

  assert.match(launchContent, /MCP Memory Gateway/i);
  assert.match(launchContent, /Pre-Action Gates/i);
  assert.match(launchContent, /feedback-to-enforcement pipeline|repeated mistakes/i);
  assert.doesNotMatch(launchContent, /Agentic Feedback Studio/i);
  assert.doesNotMatch(launchContent, /persistent memory layer that fixes this/i);
});

test('GEO demand engine prioritizes action queries and proof-backed fan-out surfaces', () => {
  const geoDemandEngine = readText(path.join('docs', 'GEO_DEMAND_ENGINE_MAR2026.md'));

  assert.match(geoDemandEngine, /Workflow Hardening Fit Checker/i);
  assert.match(geoDemandEngine, /Can AI fully satisfy this query without a click\?/i);
  assert.match(geoDemandEngine, /Workflow Hardening Sprint/i);
  assert.match(geoDemandEngine, /Pro at \$49 one-time/i);
  assert.match(geoDemandEngine, /VERIFICATION_EVIDENCE\.md/);
  assert.match(geoDemandEngine, /COMMERCIAL_TRUTH\.md/);
  assert.match(geoDemandEngine, /bannerbear\.com/i);
  assert.match(geoDemandEngine, /mcpserverspot\.com/i);
  assert.match(geoDemandEngine, /bestofthemcp\.com/i);
  assert.match(geoDemandEngine, /digitalocean\.com/i);
  assert.match(geoDemandEngine, /medium\.com/i);
  assert.doesNotMatch(geoDemandEngine, /founding members/i);
  assert.doesNotMatch(geoDemandEngine, /customer proof/i);
});
