'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GUIDE_PATH = path.join(__dirname, '..', 'docs', 'marketing', 'mcp-directories.md');
const GUIDE = fs.readFileSync(GUIDE_PATH, 'utf8');

test('MCP directory guide points operators at the live repair pack artifacts', () => {
  assert.match(GUIDE, /mcp-directory-revenue-pack\.md/);
  assert.match(GUIDE, /mcp-directory-operator-queue\.csv/);
});

test('MCP directory guide reflects the current live directory status snapshot', () => {
  assert.match(GUIDE, /mcp\.so\/server\/thumbgate\/IgorGanapolsky/);
  assert.match(GUIDE, /Glama: canonical `IgorGanapolsky\/ThumbGate` listing resolves/);
  assert.match(GUIDE, /Smithery: search still resolves to `rlhf-loop\/thumbgate`/);
  assert.match(GUIDE, /punkpeye\/awesome-mcp-servers: entry exists but still points to `IgorGanapolsky\/mcp-memory-gateway`/);
  assert.match(GUIDE, /appcypher\/awesome-mcp-servers: no current ThumbGate entry found/);
});

test('MCP directory guide no longer claims stale submission-only states', () => {
  assert.doesNotMatch(GUIDE, /\*\*Status:\*\* CONTACT INITIATED \(March 19, 2026\)/);
  assert.doesNotMatch(GUIDE, /## 4\. mcp\.so[\s\S]*\*\*Status:\*\* NOT YET LISTED/);
});
