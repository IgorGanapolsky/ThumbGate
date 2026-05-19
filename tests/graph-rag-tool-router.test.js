'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { filterAllowedTools } = require('../scripts/graph-rag-tool-router');

test('graph-rag-tool-router', async (t) => {
  await t.test('allows safe tools in prod', () => {
    const res = filterAllowedTools(['read_file'], 'prod');
    assert.deepStrictEqual(res.allowed, ['read_file']);
    assert.deepStrictEqual(res.blocked, []);
  });

  await t.test('blocks high-risk tools in prod', () => {
    const res = filterAllowedTools(['bash'], 'prod');
    assert.deepStrictEqual(res.allowed, []);
    assert.strictEqual(res.blocked[0].tool, 'bash');
    assert.match(res.blocked[0].reason, /Not allowed in prod/);
  });

  await t.test('allows high-risk tools in dev with permission', () => {
    const res = filterAllowedTools(['bash', 'read_file'], 'dev', ['sysadmin']);
    assert.deepStrictEqual(res.allowed, ['bash', 'read_file']);
  });

  await t.test('blocks high-risk tools in dev without permission', () => {
    const res = filterAllowedTools(['bash'], 'dev', []);
    assert.deepStrictEqual(res.allowed, []);
    assert.match(res.blocked[0].reason, /Missing permissions/);
  });
});
