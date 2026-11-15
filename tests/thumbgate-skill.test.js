#!/usr/bin/env node
'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SKILL_DIR = path.join(__dirname, '..', '.claude', 'skills', 'thumbgate');
const SKILL_MD = path.join(SKILL_DIR, 'SKILL.md');

describe('thumbgate-skill', () => {
  test('SKILL.md exists and has valid frontmatter', () => {
    assert.ok(fs.existsSync(SKILL_MD), 'SKILL.md must exist');
    const content = fs.readFileSync(SKILL_MD, 'utf-8');

    // Valid YAML frontmatter delimiters
    assert.ok(content.startsWith('---'), 'starts with frontmatter delimiter');
    const secondDelim = content.indexOf('---', 3);
    assert.ok(secondDelim > 3, 'has closing frontmatter delimiter');

    const frontmatter = content.slice(3, secondDelim);
    assert.ok(frontmatter.includes('name: thumbgate'), 'name field is "thumbgate"');
    assert.ok(frontmatter.includes('description:'), 'has description field');
  });

  test('SKILL.md description includes key trigger words', () => {
    const content = fs.readFileSync(SKILL_MD, 'utf-8');

    // These trigger words help Claude auto-invoke the skill
    assert.ok(content.toLowerCase().includes('pre-action checks'), 'mentions pre-action checks');
    assert.ok(content.includes('thumbs-up/down'), 'mentions thumbs-up/down');
    assert.ok(content.includes('prevention rules'), 'mentions prevention rules');
    assert.ok(content.includes('block known-bad patterns'), 'mentions blocking');
    assert.ok(content.includes('feedback'), 'mentions feedback');
    assert.ok(content.includes('DPO'), 'mentions DPO');
  });

  test('SKILL.md body includes quick start, commands, and architecture', () => {
    const content = fs.readFileSync(SKILL_MD, 'utf-8');

    assert.ok(content.includes('npx thumbgate init'), 'has install command');
    assert.ok(content.includes('capture_feedback'), 'documents capture_feedback tool');
    assert.ok(content.includes('search_lessons'), 'documents search_lessons tool');
    assert.ok(content.includes('recall'), 'documents recall tool');
    assert.ok(content.includes('prevention_rules'), 'documents prevention_rules tool');
    assert.ok(content.includes('SQLite+FTS5'), 'mentions tech stack');
    assert.ok(content.includes('Thompson Sampling'), 'mentions Thompson Sampling');
    assert.ok(content.includes('PreToolUse'), 'mentions PreToolUse hooks');
  });

  test('SKILL.md references Pro features and upgrade link', () => {
    const content = fs.readFileSync(SKILL_MD, 'utf-8');

    assert.ok(content.includes('Pro Features'), 'has Pro section');
    assert.ok(content.includes('Multi-hop recall'), 'mentions multi-hop recall');
    assert.ok(content.includes('Synthetic DPO'), 'mentions synthetic DPO');
    assert.match(content, /https:\/\/thumbgate-production\.up\.railway\.app\/go\/pro[^\s)]*/, 'has attributed checkout link');
    assert.ok(content.includes('https://thumbgate.ai/pricing'), 'links to configured Pro pricing');
    assert.match(content, /self-serve software and does not include implementation services/, 'states the Pro service boundary');
    assert.doesNotMatch(content, /\$499|\$1,500|Setup Sprint|workflow hardening sprint/i, 'does not advertise retired services');
    assert.doesNotMatch(content, /founder[- ]license/i, 'does not mention retired founder-license positioning');
  });

  test('agent rulebooks and harnesses do not sell retired services', () => {
    const root = path.join(__dirname, '..');
    const files = [
      '.agents/skills/thumbgate/SKILL.md',
      '.agents/skills/snapchat-abm-playbook-steal/SKILL.md',
      'skills/snapchat-abm-playbook-steal/SKILL.md',
      '.agents/skills/supporter-compute-lane-not-clone/SKILL.md',
      '.agents/skills/zero-outbound-spend-they-pay-us/SKILL.md',
      'harnesses/creator-partnership-review.md',
      'harnesses/workflow-hardening-sprint.md'
    ];
    for (const file of files) {
      const text = fs.readFileSync(path.join(root, file), 'utf8');
      assert.doesNotMatch(text, /\$499|\$1,500|Setup Sprint|qualified workflow sprint leads/i, file);
    }
    const harness = fs.readFileSync(path.join(root, 'harnesses/workflow-hardening-sprint.md'), 'utf8');
    const metadata = JSON.parse(harness.split('---')[1]);
    assert.equal(metadata.id, 'workflow-hardening-sprint', 'preserves the harness identifier');
    assert.equal(metadata.title, 'Local workflow verification');
    assert.match(harness, /# Local workflow verification/);
  });

  test('SKILL.md links to reference files that exist', () => {
    const content = fs.readFileSync(SKILL_MD, 'utf-8');

    // Extract reference links
    const refLinks = content.match(/<references\/[^>]+>/g) || [];
    assert.ok(refLinks.length >= 2, `has ${refLinks.length} reference links (need 2+)`);

    for (const link of refLinks) {
      const refPath = link.slice(1, -1);
      const fullPath = path.join(SKILL_DIR, refPath);
      assert.ok(fs.existsSync(fullPath), `reference file exists: ${refPath}`);
    }
  });

  test('setup-guides reference covers all major agents', () => {
    const guides = fs.readFileSync(path.join(SKILL_DIR, 'references', 'setup-guides.md'), 'utf-8');

    assert.ok(guides.includes('Claude Code'), 'covers Claude Code');
    assert.ok(guides.includes('Cursor'), 'covers Cursor');
    assert.ok(guides.includes('Codex'), 'covers Codex');
    assert.ok(guides.includes('Gemini'), 'covers Gemini');
    assert.ok(guides.includes('Claude Desktop'), 'covers Claude Desktop');
    assert.ok(guides.includes('thumbgate'), 'references npm package');
  });

  test('gate-config reference documents Thompson Sampling and custom checks', () => {
    const config = fs.readFileSync(path.join(SKILL_DIR, 'references', 'gate-config.md'), 'utf-8');

    assert.ok(config.includes('Thompson Sampling'), 'documents Thompson Sampling');
    assert.ok(config.includes('Auto-Promoted Checks'), 'documents auto-promotion');
    assert.ok(config.includes('Custom Checks'), 'documents custom checks');
    assert.ok(config.includes('no-force-push'), 'lists default gate');
    assert.ok(config.includes('no-drop-table'), 'lists critical gate');
    assert.ok(config.includes('7-day half-life'), 'documents decay');
  });

  test('SKILL.md is under 500 lines (best practice)', () => {
    const content = fs.readFileSync(SKILL_MD, 'utf-8');
    const lines = content.split('\n').length;
    assert.ok(lines < 500, `SKILL.md is ${lines} lines (should be under 500)`);
  });

  test('skill directory has correct structure', () => {
    assert.ok(fs.existsSync(SKILL_DIR), 'skill directory exists');
    assert.ok(fs.existsSync(path.join(SKILL_DIR, 'SKILL.md')), 'has SKILL.md');
    assert.ok(fs.existsSync(path.join(SKILL_DIR, 'references')), 'has references/');
    assert.ok(fs.existsSync(path.join(SKILL_DIR, 'references', 'setup-guides.md')), 'has setup-guides.md');
    assert.ok(fs.existsSync(path.join(SKILL_DIR, 'references', 'gate-config.md')), 'has gate-config.md');
  });
});
