'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'mcp-allowlists.json'), 'utf8'));
const { TOOLS, getExposedTools, getToolCapability } = require('../adapters/mcp/server-stdio');

function packedExistsSync(absolutePath) {
  const relativePath = path.relative(ROOT, absolutePath).split(path.sep).join('/');
  return pkg.files.some((entry) => {
    const normalized = String(entry).replace(/\/$/, '');
    return relativePath === normalized || relativePath.startsWith(`${normalized}/`);
  });
}

test('factory essential profile exposes only allowed, executable tools', () => {
  const allowed = new Set(policy.profiles.essential);
  const exposed = getExposedTools('essential');
  assert.ok(exposed.length > 0);
  for (const tool of exposed) {
    assert.equal(allowed.has(tool.name), true, `${tool.name} is not allowed by essential`);
    assert.equal(getToolCapability(tool.name).available, true, `${tool.name} is not executable`);
  }
});

test('public package never advertises a tool whose implementation is absent', () => {
  for (const profileName of Object.keys(policy.profiles)) {
    const exposed = getExposedTools(profileName, { existsSync: packedExistsSync });
    for (const tool of exposed) {
      assert.equal(
        getToolCapability(tool.name, { existsSync: packedExistsSync }).available,
        true,
        `${profileName} exposed unavailable ${tool.name}`,
      );
    }
  }
});

test('public package hides managed-agent tools and keeps packaged retrieval executable', () => {
  const exposedNames = new Set(getExposedTools('default', { existsSync: packedExistsSync }).map((tool) => tool.name));
  assert.equal(exposedNames.has('managed_agent_status'), false);
  assert.equal(exposedNames.has('run_managed_lesson_agent'), false);
  assert.equal(exposedNames.has('retrieve_lessons'), true);
  assert.equal(getToolCapability('retrieve_lessons', { existsSync: packedExistsSync }).available, true);
});

test('every registry tool that is advertised is executable', () => {
  const advertised = new Set();
  for (const profileName of Object.keys(policy.profiles)) {
    for (const tool of getExposedTools(profileName, { existsSync: packedExistsSync })) advertised.add(tool.name);
  }
  for (const tool of TOOLS) {
    if (advertised.has(tool.name)) {
      assert.equal(getToolCapability(tool.name, { existsSync: packedExistsSync }).available, true);
    }
  }
});
