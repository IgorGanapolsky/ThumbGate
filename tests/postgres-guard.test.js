'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { evaluateDatabaseAgentAction, evaluatePostgresQuery, normalizeSql } = require('../scripts/postgres-guard');

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
    assert.match(res.reason, /Destructive DROP\/TRUNCATE/i);
  });

  await t.test('blocks truncate operations', () => {
    const res = evaluatePostgresQuery('TRUNCATE TABLE audit_events;');
    assert.strictEqual(res.mode, 'block');
    assert.match(res.reason, /DROP\/TRUNCATE/i);
  });

  await t.test('allows destructive production SQL only as final-review warning with approval and rollback evidence', () => {
    const res = evaluatePostgresQuery('DROP TABLE stale_imports;', {
      env: 'production',
      approvalToken: 'approved-by-dba',
      snapshotId: 'snap_123',
    });
    assert.strictEqual(res.mode, 'warn');
    assert.match(res.reason, /approval and rollback evidence/i);
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

  await t.test('blocks WHERE true write queries as unbounded', () => {
    const res = evaluatePostgresQuery('DELETE FROM users WHERE 1 = 1;');
    assert.strictEqual(res.mode, 'block');
    assert.match(res.reason, /restrictive WHERE/i);
  });

  await t.test('blocks production schema changes without rollback evidence', () => {
    const res = evaluatePostgresQuery('ALTER TABLE users DROP COLUMN legacy_id;', {
      env: 'production',
      approvalToken: 'ticket-123',
    });
    assert.strictEqual(res.mode, 'block');
    assert.match(res.reason, /backup, snapshot, or rollback/i);
  });

  await t.test('warns production writes without dry-run or explain evidence', () => {
    const res = evaluatePostgresQuery('UPDATE users SET plan = $1 WHERE id = $2;', {
      databaseUrl: 'postgres://app@prod-db.example.com/app',
    });
    assert.strictEqual(res.mode, 'warn');
    assert.match(res.reason, /dry-run or EXPLAIN/i);
  });

  await t.test('warns production CREATE INDEX without CONCURRENTLY', () => {
    const res = evaluatePostgresQuery('CREATE INDEX idx_events_user_id ON events(user_id);', {
      env: 'production',
    });
    assert.strictEqual(res.mode, 'warn');
    assert.match(res.reason, /CONCURRENTLY/i);
  });

  await t.test('blocks production migration commands without approval, rollback, and dry-run proof', () => {
    const res = evaluateDatabaseAgentAction({
      command: 'npx prisma migrate deploy',
      env: 'production',
      hasBackup: true,
      approvalToken: 'approved-by-dba',
    });
    assert.strictEqual(res.mode, 'block');
    assert.match(res.reason, /dry-run proof/i);
  });

  await t.test('warns migration command with full production proof bundle', () => {
    const res = evaluateDatabaseAgentAction({
      command: 'npx prisma migrate deploy',
      env: 'production',
      approvalToken: 'approved-by-dba',
      snapshotId: 'snap_123',
      hasDryRun: true,
    });
    assert.strictEqual(res.mode, 'warn');
    assert.match(res.reason, /Migration command detected/i);
  });

  await t.test('normalizes SQL comments before matching', () => {
    assert.equal(normalizeSql('SELECT 1; -- DROP TABLE bait'), 'SELECT 1;');
    assert.equal(normalizeSql('SELECT /* DROP TABLE bait */ 1;'), 'SELECT 1;');
  });
});
