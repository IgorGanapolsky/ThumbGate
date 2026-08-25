'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Isolate identity-plane state before the module graph resolves a feedback dir.
const FEEDBACK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-mcp-identity-'));
process.env.THUMBGATE_FEEDBACK_DIR = FEEDBACK_DIR;

const ENV_KEYS = ['THUMBGATE_SESSION_AGENT', 'THUMBGATE_AGENT_ID'];
const savedEnv = {};
for (const key of ENV_KEYS) savedEnv[key] = process.env[key];

function resetEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

test.beforeEach(() => resetEnv());
test.after(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

const { registerSessionIdentity } = require('../adapters/mcp/server-stdio');
const { loadAgentRegistry } = require('../scripts/audit-trail');

test('an unattributed MCP session registers a generated id and exports it', () => {
  const id = registerSessionIdentity();
  assert.ok(id, 'bootstrap returned an id');
  assert.equal(process.env.THUMBGATE_SESSION_AGENT, id);
  const row = loadAgentRegistry().find((agent) => agent.id === id);
  assert.ok(row, 'registry row exists');
  assert.equal(row.source, 'mcp');
  assert.equal(row.metadata.lifecycleStatus, 'active');
  assert.equal(row.metadata.transport, 'stdio');
});

test('an attributed but unregistered session registers its existing id', () => {
  process.env.THUMBGATE_SESSION_AGENT = 'mcp-boot-attributed-1';
  const id = registerSessionIdentity();
  assert.equal(id, 'mcp-boot-attributed-1');
  assert.equal(process.env.THUMBGATE_SESSION_AGENT, 'mcp-boot-attributed-1');
  const rows = loadAgentRegistry().filter((agent) => agent.id === 'mcp-boot-attributed-1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'mcp');
});

test('a second bootstrap for an already-registered id adds no duplicate row', () => {
  process.env.THUMBGATE_SESSION_AGENT = 'mcp-boot-attributed-1';
  registerSessionIdentity();
  const rows = loadAgentRegistry().filter((agent) => agent.id === 'mcp-boot-attributed-1');
  assert.equal(rows.length, 1);
});

test('bootstrap never overwrites a preexisting session attribution', () => {
  process.env.THUMBGATE_SESSION_AGENT = 'mcp-boot-preset-2';
  registerSessionIdentity();
  assert.equal(process.env.THUMBGATE_SESSION_AGENT, 'mcp-boot-preset-2');
});
