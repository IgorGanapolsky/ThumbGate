'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildStableId,
  normalizeConversationWindow,
  extractFilePaths,
  extractToolCalls,
  extractErrors,
} = require('../scripts/conversation-context');

test('buildStableId returns prefixed cryptographic ids', () => {
  const first = buildStableId('fbs');
  const second = buildStableId('fbs');
  assert.match(first, /^fbs_[a-f0-9]{12}$/);
  assert.match(second, /^fbs_[a-f0-9]{12}$/);
  assert.notEqual(first, second);
});

test('normalizeConversationWindow filters empty entries and maps aliases', () => {
  const window = normalizeConversationWindow([
    { author: 'user', text: ' Fix src/index.ts ' },
    null,
    { role: 'assistant', content: '' },
    { role: 'assistant', content: 'Read(src/index.ts)' },
  ]);

  assert.deepEqual(window, [
    { role: 'user', content: 'Fix src/index.ts', timestamp: null },
    { role: 'assistant', content: 'Read(src/index.ts)', timestamp: null },
  ]);
});

test('extractFilePaths finds paths inside plain text and tool calls', () => {
  const paths = extractFilePaths([
    { role: 'user', content: 'Check src/features/menu/hooks/useMenu.ts and scripts/build.js' },
    { role: 'assistant', content: 'Read(src/features/menu/hooks/useMenu.ts) then edit adapters/mcp/server-stdio.js' },
  ]);

  assert.ok(paths.includes('src/features/menu/hooks/useMenu.ts'));
  assert.ok(paths.includes('scripts/build.js'));
  assert.ok(paths.includes('adapters/mcp/server-stdio.js'));
});

test('extractToolCalls finds unique tool names across messages', () => {
  const tools = extractToolCalls([
    { role: 'assistant', content: 'Read(src/index.ts) then Bash(npm test)' },
    { role: 'assistant', content: 'Edit tool updated the file after Read(src/index.ts)' },
  ]);

  assert.deepEqual(tools.sort(), ['Bash', 'Edit', 'Read']);
});

test('extractErrors captures error-like lines without regex backtracking heuristics', () => {
  const errors = extractErrors([
    { role: 'assistant', content: 'TypeError: Cannot read properties of undefined\nEverything else looks fine' },
    { role: 'user', content: 'The 401 response means the token is invalid' },
  ]);

  assert.ok(errors.some((entry) => entry.includes('TypeError')));
  assert.ok(errors.some((entry) => entry.includes('401')));
});
