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
const agentixHtml = read('public', 'compare', 'agentix-labs.html');
const farAiHtml = read('public', 'compare', 'far-ai.html');
const platformTeamsHtml = read('public', 'use-cases', 'platform-teams.html');
const regulatedHtml = read('public', 'use-cases', 'regulated-workflows.html');
const deploymentReadinessHtml = read('public', 'guides', 'ai-deployment-readiness.html');

test('homepage explains the enforcement point without an orchestration essay', () => {
  assert.match(indexHtml, /Pre-action checks—and the systems that refine them/i);
  assert.match(indexHtml, /Stop AI agent mistakes before they cost you/i);
  assert.match(indexHtml, /Capture feedback/i);
  assert.match(indexHtml, /Remember locally/i);
  assert.match(indexHtml, /Rank and refine/i);
  assert.match(indexHtml, /Gate the next action/i);
  assert.doesNotMatch(indexHtml, /Enforcement is the missing layer in AI orchestration/i);
});

test('homepage routes research through one guide-library link', () => {
  assert.match(indexHtml, /href="\/learn"/);
  assert.doesNotMatch(indexHtml, /id="compare-guides"/);
});

test('compare hub links to orchestration comparison page', () => {
  assert.match(compareHtml, /Evaluating bigger orchestration platforms/i);
  assert.match(compareHtml, /\/compare\/ai-experience-orchestration/);
});

test('compare hub links to custom agent agency comparison page', () => {
  assert.match(compareHtml, /Comparing custom AI agent agencies/i);
  assert.match(compareHtml, /\/compare\/agentix-labs/);
});

test('orchestration comparison page exists with schema and stack framing', () => {
  assert.match(orchestrationHtml, /"@type": "TechArticle"/);
  assert.match(orchestrationHtml, /AI experience orchestration still needs an enforcement layer/i);
  assert.match(orchestrationHtml, /Use orchestration to decide what should happen next/i);
  assert.match(orchestrationHtml, /Use ThumbGate to decide what is allowed to execute/i);
  assert.match(orchestrationHtml, /Claude Code, Cursor, Codex, Gemini, Amp, OpenCode/i);
});

test('Agentix comparison page frames agency services as adjacent competition', () => {
  assert.match(agentixHtml, /"@type": "TechArticle"/);
  assert.match(agentixHtml, /ThumbGate vs Agentix Labs/i);
  assert.match(agentixHtml, /adjacent competition/i);
  assert.match(agentixHtml, /custom AI agent and automation services/i);
  assert.match(agentixHtml, /productized enforcement layer/i);
  assert.match(agentixHtml, /\$499 one-time Managed AI Agent Workflow Gate/i);
  assert.doesNotMatch(agentixHtml, /Pro \$19|\$149|Workflow Hardening Sprint/i);
});

test('FAR.AI comparison keeps research, evaluation, and runtime enforcement separate', () => {
  assert.match(farAiHtml, /"@type": "TechArticle"/);
  assert.match(farAiHtml, /"@type": "FAQPage"/);
  assert.match(farAiHtml, /Adjacent, not a direct product substitute/i);
  assert.match(farAiHtml, /They research failure modes\. We enforce what your agent may do next/i);
  assert.match(farAiHtml, /FAR\.AI discovers and measures failure modes/i);
  assert.match(farAiHtml, /That absence is our inference/i);
  assert.match(farAiHtml, /https:\/\/www\.far\.ai\/research/);
  assert.match(farAiHtml, /utm_source=far_ai_comparison/);
  assert.match(compareHtml, /href="\/compare\/far-ai"/);
});

test('platform-team use case page exists with rollout language', () => {
  assert.match(platformTeamsHtml, /ThumbGate for platform teams/i);
  assert.match(platformTeamsHtml, /one repo, one owner, and one repeated AI failure/i);
  assert.match(platformTeamsHtml, /shared lessons/i);
  assert.match(platformTeamsHtml, /managed workflow gate/i);
  assert.match(platformTeamsHtml, /href="\/diagnostic"/i);
});

test('regulated workflow page exists without fake compliance claims', () => {
  assert.match(regulatedHtml, /regulated and high-trust workflows/i);
  assert.match(regulatedHtml, /approval boundaries/i);
  assert.match(regulatedHtml, /execution control/i);
  assert.match(regulatedHtml, /does not market itself as a compliance badge/i);
});

test('deployment readiness guide converts OpenAI-style deployment demand into one managed gate', () => {
  assert.match(deploymentReadinessHtml, /AI Deployment Readiness/i);
  assert.match(deploymentReadinessHtml, /deployment companies/i);
  assert.match(deploymentReadinessHtml, /governance and proof layer/i);
  assert.match(deploymentReadinessHtml, /Managed AI Agent Workflow Gate/);
  assert.match(deploymentReadinessHtml, /\$499 one-time/i);
  assert.doesNotMatch(deploymentReadinessHtml, /\$1500|workflow-sprint-intake|Pro \$19|\$149/i);
});
