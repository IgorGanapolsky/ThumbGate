'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

test('AI coding project-management operating model documents current sources and ThumbGate hierarchy', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'AI_CODING_PROJECT_MANAGEMENT_2026.md'), 'utf8');

  assert.match(doc, /GitHub Projects \+ Issues \+ PRs as the system of record/);
  assert.match(doc, /Use case: a buyer\/operator problem/);
  assert.match(doc, /Milestone: a measurable outcome/);
  assert.match(doc, /Agent-ready issue: one bounded PR-sized unit of work/);
  assert.match(doc, /https:\/\/docs\.github\.com\/en\/enterprise-server@3\.16/);
  assert.match(doc, /https:\/\/openai\.com\/codex\//);
  assert.match(doc, /https:\/\/linear\.app\/agents/);
  assert.match(doc, /https:\/\/arxiv\.org\/abs\/2602\.01655/);
});

test('Ready for Agent issue template requires PM metadata for AI coding work', () => {
  const template = fs.readFileSync(path.join(ROOT, '.github', 'ISSUE_TEMPLATE', 'ready-for-agent.yml'), 'utf8');

  for (const field of [
    'use_case_bucket',
    'milestone',
    'phase',
    'agent_lane',
    'risk_tier',
    'telemetry_expected',
    'rollback_path',
    'token_cost_budget',
  ]) {
    assert.match(template, new RegExp(`id: ${field}`), `missing ${field}`);
  }
  assert.match(template, /revenue-truth/);
  assert.match(template, /agent-reliability/);
  assert.match(template, /operator-productivity/);
  assert.match(template, /P0 production\/revenue\/security/);
});

test('AI agent operating model skill makes the PM and token-burn workflow repeatable', () => {
  const skill = fs.readFileSync(
    path.join(ROOT, '.claude', 'skills', 'ai-agent-operating-model', 'SKILL.md'),
    'utf8',
  );

  assert.match(skill, /name: ai-agent-operating-model/);
  assert.match(skill, /use case -> milestone -> phase -> agent-ready issue -> PR proof packet/);
  assert.match(skill, /token-burn reviews/);
  assert.match(skill, /docs\/AI_CODING_PROJECT_MANAGEMENT_2026\.md/);
  assert.match(skill, /npm run test:ai-project-management/);
  assert.match(skill, /package-boundary/);

  const lines = skill.split('\n').length;
  assert.ok(lines < 160, `skill should stay compact, got ${lines} lines`);
});

test('daily memory records the durable PM, token-burn, and packaging lessons', () => {
  const memory = fs.readFileSync(path.join(ROOT, 'memory', '2026-06-07.md'), 'utf8');

  assert.match(memory, /spec-driven development plus eval-driven/);
  assert.match(memory, /GitHub Issues\/Projects\/PRs remain the default source of truth/);
  assert.match(memory, /token burn is not a vanity metric/i);
  assert.match(memory, /scripts\/dashboard\.js -> scripts\/token-burn\.js/);
  assert.match(memory, /npm pack --dry-run --json/);
});
