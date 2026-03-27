const test = require('node:test');
const assert = require('node:assert/strict');

const { escapeMarkdownTableCell } = require('../scripts/markdown-escape');

test('escapeMarkdownTableCell escapes backslashes, pipes, and newlines', () => {
  assert.equal(
    escapeMarkdownTableCell('path\\segment | line 1\nline 2'),
    'path\\\\segment \\| line 1 line 2'
  );
});

test('escapeMarkdownTableCell handles empty and null input', () => {
  assert.equal(escapeMarkdownTableCell(''), '');
  assert.equal(escapeMarkdownTableCell(null), '');
  assert.equal(escapeMarkdownTableCell(undefined), '');
});

test('escapeMarkdownTableCell handles plain text unchanged', () => {
  assert.equal(escapeMarkdownTableCell('hello world'), 'hello world');
});

test('escapeMarkdownTableCell handles carriage return + newline', () => {
  assert.equal(escapeMarkdownTableCell('line1\r\nline2'), 'line1 line2');
});

test('escapeMarkdownTableCell handles multiple pipes', () => {
  assert.equal(escapeMarkdownTableCell('a|b|c'), 'a\\|b\\|c');
});
