'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SKILL_PATH = path.join(__dirname, '..', 'skills', 'agent-memory', 'SKILL.md');

test('Claude Skill file exists', () => {
  assert.ok(fs.existsSync(SKILL_PATH), 'skills/agent-memory/SKILL.md should exist');
});

test('Claude Skill has valid frontmatter', () => {
  const content = fs.readFileSync(SKILL_PATH, 'utf8');
  assert.match(content, /^---\n/, 'Should start with frontmatter delimiter');
  assert.match(content, /name:\s*.+/, 'Should have a name field');
  assert.match(content, /description:\s*.+/, 'Should have a description field');
  // Frontmatter should close
  const parts = content.split('---');
  assert.ok(parts.length >= 3, 'Should have opening and closing frontmatter delimiters');
});

test('Claude Skill references only tools that exist in MCP server', () => {
  const content = fs.readFileSync(SKILL_PATH, 'utf8');
  const { TOOLS } = require('../adapters/mcp/server-stdio');
  const toolNames = new Set(TOOLS.map(t => t.name));

  // Extract tool names referenced in the skill (backtick-quoted)
  const referenced = [];
  const toolPattern = /`(recall|capture_feedback|prevention_rules|feedback_stats|feedback_summary|commerce_recall)`/g;
  let match;
  while ((match = toolPattern.exec(content)) !== null) {
    referenced.push(match[1]);
  }

  assert.ok(referenced.length >= 3, 'Skill should reference at least 3 MCP tools');
  for (const tool of referenced) {
    assert.ok(toolNames.has(tool), `Skill references '${tool}' which must exist in MCP server`);
  }
});

test('Claude Skill does not reference dead hosted API endpoints', () => {
  const content = fs.readFileSync(SKILL_PATH, 'utf8');
  // Skill should primarily use MCP tools, not curl to hosted API
  const curlCount = (content.match(/curl\s/g) || []).length;
  assert.ok(curlCount === 0, 'Skill should use MCP tools, not curl commands to hosted API');
});

test('mcp-use integration guide exists', () => {
  const guidePath = path.join(__dirname, '..', 'docs', 'guides', 'mcp-use-integration.md');
  assert.ok(fs.existsSync(guidePath), 'docs/guides/mcp-use-integration.md should exist');
  const content = fs.readFileSync(guidePath, 'utf8');
  assert.match(content, /mcp-use/, 'Should reference mcp-use SDK');
  assert.match(content, /thumbgate/, 'Should reference our npm package');
  assert.match(content, /commerce/, 'Should mention commerce profile');
});
