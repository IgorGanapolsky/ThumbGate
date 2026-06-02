'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.resolve(__dirname, '../bin/cli.js');
const {
  buildEnterprisePostgresSchema,
  buildJsonlMigrationSql,
  guardSqlBatch,
  normalizeEmbeddingDim,
} = require('../scripts/enterprise-postgres');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-enterprise-pg-'));
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 20000,
    env: {
      ...process.env,
      THUMBGATE_NO_NUDGE: '1',
      THUMBGATE_NO_TELEMETRY: '1',
    },
  });
}

test('enterprise Postgres schema includes pgvector, tenant tables, RLS, and HNSW index', () => {
  const sql = buildEnterprisePostgresSchema({ embeddingDim: 384 });
  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS vector/);
  assert.match(sql, /CREATE SCHEMA IF NOT EXISTS thumbgate/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS thumbgate\.feedback_events/);
  assert.match(sql, /embedding vector\(384\) NOT NULL/);
  assert.match(sql, /USING hnsw \(embedding vector_cosine_ops\)/);
  assert.match(sql, /ALTER TABLE thumbgate\.feedback_events ENABLE ROW LEVEL SECURITY/);

  const guard = guardSqlBatch(sql);
  assert.equal(guard.ok, true);
  assert.equal(guard.blocks.length, 0);
  assert.ok(guard.statementCount > 10);
});

test('enterprise migration SQL imports local JSONL with org and project scope', () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'feedback-log.jsonl'), `${JSON.stringify({
      id: 'fb_1',
      signal: 'down',
      context: "agent claimed deploy without proof",
      tags: ['deploy', 'proof'],
      timestamp: '2026-06-01T12:00:00.000Z',
    })}\n`);
    fs.writeFileSync(path.join(dir, 'memory-log.jsonl'), `${JSON.stringify({
      id: 'mem_1',
      sourceFeedbackId: 'fb_1',
      signal: 'negative',
      title: "Don't claim deploys without proof",
      content: 'Require CI URL or command output before claiming deploy success.',
      whatToChange: 'Verify deploy evidence first.',
      tags: ['deploy', 'proof'],
      timestamp: '2026-06-01T12:01:00.000Z',
    })}\n`);

    const sql = buildJsonlMigrationSql({
      feedbackDir: dir,
      orgId: 'acme',
      projectId: 'api',
      agentId: 'codex',
    });
    assert.match(sql, /INSERT INTO thumbgate\.organizations/);
    assert.match(sql, /INSERT INTO thumbgate\.feedback_events/);
    assert.match(sql, /INSERT INTO thumbgate\.lessons/);
    assert.match(sql, /'acme'/);
    assert.match(sql, /'api'/);
    assert.match(sql, /'fb_1'/);
    assert.match(sql, /'mem_1'/);
    assert.equal(guardSqlBatch(sql).ok, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('enterprise Postgres CLI writes schema and migration SQL', () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'feedback-log.jsonl'), '{"id":"fb_1","signal":"up","context":"worked"}\n');
    fs.writeFileSync(path.join(dir, 'memory-log.jsonl'), '{"id":"mem_1","sourceFeedbackId":"fb_1","signal":"positive","content":"worked"}\n');
    const schemaPath = path.join(dir, 'schema.sql');
    const migrationPath = path.join(dir, 'migration.sql');

    const schema = runCli(['setup-postgres', '--out', schemaPath, '--json'], dir);
    assert.equal(schema.status, 0, schema.stderr);
    const schemaPayload = JSON.parse(schema.stdout);
    assert.equal(schemaPayload.ok, true);
    assert.equal(schemaPayload.outputPath, schemaPath);
    assert.match(fs.readFileSync(schemaPath, 'utf8'), /CREATE EXTENSION IF NOT EXISTS vector/);

    const migration = runCli([
      'migrate-to-postgres',
      '--feedback-dir', dir,
      '--org-id', 'acme',
      '--project-id', 'api',
      '--out', migrationPath,
      '--json',
    ], dir);
    assert.equal(migration.status, 0, migration.stderr);
    const migrationPayload = JSON.parse(migration.stdout);
    assert.equal(migrationPayload.ok, true);
    assert.equal(migrationPayload.outputPath, migrationPath);
    assert.match(fs.readFileSync(migrationPath, 'utf8'), /INSERT INTO thumbgate\.feedback_events/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('embedding dimension normalization defaults to local-compatible 384', () => {
  assert.equal(normalizeEmbeddingDim(), 384);
  assert.equal(normalizeEmbeddingDim(768), 768);
  assert.equal(normalizeEmbeddingDim('bad'), 384);
});
