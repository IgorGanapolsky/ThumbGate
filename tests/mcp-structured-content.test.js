'use strict';

// friction-1.10: MCP clients reject a tool result whose structuredContent is an array
// ("structuredContent expected record, received array"). retrieve_lessons returns a list.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-mcp-structured-'));
process.env.HOME = dir;
process.env.USERPROFILE = dir;
process.env.THUMBGATE_FEEDBACK_DIR = path.join(dir, 'feedback');
fs.mkdirSync(process.env.THUMBGATE_FEEDBACK_DIR, { recursive: true });

const { handleRequest } = require('../adapters/mcp/server-stdio');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('retrieve_lessons returns an object as structuredContent and keeps the list as text', async () => {
  const result = await handleRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'retrieve_lessons', arguments: { toolName: 'Bash', actionContext: 'git push' } },
  });
  const listed = JSON.parse(result.content[0].text);
  assert.ok(Array.isArray(listed), 'the text block stays a list for callers that parse it');
  assert.equal(Array.isArray(result.structuredContent), false, 'structuredContent must not be an array');
  assert.deepEqual(result.structuredContent, { results: listed });
});
