const test = require('node:test');
const assert = require('node:assert/strict');

const { escapeMarkdownTableCell } = require('../scripts/markdown-escape');

test('escapeMarkdownTableCell escapes backslashes, pipes, and newlines', () => {
  assert.equal(
    escapeMarkdownTableCell('path\\segment | line 1\nline 2'),
    'path\\\\segment \\| line 1 line 2'
  );
});
