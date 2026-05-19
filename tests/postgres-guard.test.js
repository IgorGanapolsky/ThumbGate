'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { evaluatePostgresQuery } = require('../scripts/postgres-guard');

test('postgres-guard', async (t) => {
  await t.test('allows safe queries', () => {
    const res = evaluatePostgresQuery('SELECT * FROM users WHERE id = 1;');
    assert.strictEqual(res.mode, 'allow');
  });

  await t.test('blocks role modifications', () => {
    const res = evaluatePostgresQuery('CREATE ROLE admin;');
    assert.strictEqual(res.mode, 'block');
    assert.match(res.reason, /roles or grants/i);
  });

  await t.test('blocks destructive operations', () => {
    const res = evaluatePostgresQuery('DROP TABLE users;');
    assert.strictEqual(res.mode, 'block');
    assert.match(res.reason, /Destructive DROP/i);
  });

  await t.test('warns on schema changes', () => {
    const res = evaluatePostgresQuery('ALTER TABLE users ADD COLUMN age INT;');
    assert.strictEqual(res.mode, 'warn');
    assert.match(res.reason, /Schema modification/i);
  });

  await t.test('blocks mass updates/deletes without WHERE', () => {
    let res = evaluatePostgresQuery('DELETE FROM users;');
    assert.strictEqual(res.mode, 'block');
    
    res = evaluatePostgresQuery('UPDATE users SET name = "Test";');
    assert.strictEqual(res.mode, 'block');

    res = evaluatePostgresQuery('DELETE FROM users WHERE id = 1;');
    assert.strictEqual(res.mode, 'allow');
  });
});
