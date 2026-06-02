'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readJsonl } = require('./fs-utils');
const { evaluatePostgresQuery } = require('./postgres-guard');

const DEFAULT_EMBEDDING_DIM = 384;
const ORG_SCOPED_TABLES = Object.freeze([
  'projects',
  'agents',
  'feedback_events',
  'lessons',
  'prevention_rules',
  'gate_firings',
  'action_receipts',
  'brain_memories',
  'lesson_embeddings',
]);

function normalizeEmbeddingDim(value) {
  const parsed = Number(
    value
      || process.env.THUMBGATE_ENTERPRISE_EMBED_DIM
      || process.env.THUMBGATE_GEMINI_EMBED_DIM
      || process.env.THUMBGATE_EMBED_DIM
      || DEFAULT_EMBEDDING_DIM
  );
  if (!Number.isInteger(parsed) || parsed < 2 || parsed > 16000) return DEFAULT_EMBEDDING_DIM;
  return parsed;
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlJson(value) {
  return `${sqlLiteral(JSON.stringify(value || {}))}::jsonb`;
}

function sqlTextArray(values) {
  const arr = Array.isArray(values) ? values : [];
  if (arr.length === 0) return 'ARRAY[]::text[]';
  return `ARRAY[${arr.map((value) => sqlLiteral(value)).join(', ')}]::text[]`;
}

function sqlTimestamp(value) {
  return `${sqlLiteral(value || new Date().toISOString())}::timestamptz`;
}

function statementCount(sql) {
  return splitSqlStatements(sql).length;
}

function splitSqlStatements(sql) {
  return String(sql || '')
    .split(';')
    .map((stmt) => stmt.trim())
    .filter(Boolean);
}

function buildRlsSql(tableName) {
  return `
ALTER TABLE thumbgate.${tableName} ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ${tableName}_org_isolation ON thumbgate.${tableName};
CREATE POLICY ${tableName}_org_isolation ON thumbgate.${tableName}
  USING (org_id = current_setting('thumbgate.org_id', true))
  WITH CHECK (org_id = current_setting('thumbgate.org_id', true));`;
}

function buildEnterprisePostgresSchema(options = {}) {
  const embeddingDim = normalizeEmbeddingDim(options.embeddingDim || options['embedding-dim']);
  const enableRls = options.enableRls !== false && options.rls !== false;
  const rlsSql = enableRls ? ORG_SCOPED_TABLES.map(buildRlsSql).join('\n') : '';

  return `-- ThumbGate Team/Enterprise Postgres + pgvector schema
-- Generated ${new Date().toISOString()}
-- Local installs keep SQLite + LanceDB. This schema is for shared hosted memory.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS thumbgate;

CREATE TABLE IF NOT EXISTS thumbgate.organizations (
  id text PRIMARY KEY,
  name text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS thumbgate.projects (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES thumbgate.organizations(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug)
);

CREATE TABLE IF NOT EXISTS thumbgate.agents (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES thumbgate.organizations(id) ON DELETE CASCADE,
  project_id text REFERENCES thumbgate.projects(id) ON DELETE SET NULL,
  name text,
  kind text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS thumbgate.feedback_events (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES thumbgate.organizations(id) ON DELETE CASCADE,
  project_id text REFERENCES thumbgate.projects(id) ON DELETE SET NULL,
  agent_id text REFERENCES thumbgate.agents(id) ON DELETE SET NULL,
  signal text NOT NULL CHECK (signal IN ('positive', 'negative', 'up', 'down')),
  context text,
  tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS thumbgate.lessons (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES thumbgate.organizations(id) ON DELETE CASCADE,
  project_id text REFERENCES thumbgate.projects(id) ON DELETE SET NULL,
  source_feedback_id text REFERENCES thumbgate.feedback_events(id) ON DELETE SET NULL,
  signal text NOT NULL CHECK (signal IN ('positive', 'negative', 'up', 'down')),
  title text,
  content text,
  what_to_change text,
  importance text NOT NULL DEFAULT 'medium',
  tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS thumbgate.prevention_rules (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES thumbgate.organizations(id) ON DELETE CASCADE,
  project_id text REFERENCES thumbgate.projects(id) ON DELETE SET NULL,
  lesson_id text REFERENCES thumbgate.lessons(id) ON DELETE SET NULL,
  rule_type text NOT NULL DEFAULT 'pattern',
  pattern text NOT NULL,
  severity text NOT NULL DEFAULT 'block',
  enabled boolean NOT NULL DEFAULT true,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS thumbgate.gate_firings (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES thumbgate.organizations(id) ON DELETE CASCADE,
  project_id text REFERENCES thumbgate.projects(id) ON DELETE SET NULL,
  rule_id text REFERENCES thumbgate.prevention_rules(id) ON DELETE SET NULL,
  agent_id text REFERENCES thumbgate.agents(id) ON DELETE SET NULL,
  decision text NOT NULL CHECK (decision IN ('allow', 'warn', 'block', 'deny')),
  tool_name text,
  action text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS thumbgate.action_receipts (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES thumbgate.organizations(id) ON DELETE CASCADE,
  project_id text REFERENCES thumbgate.projects(id) ON DELETE SET NULL,
  agent_id text REFERENCES thumbgate.agents(id) ON DELETE SET NULL,
  action_hash text NOT NULL,
  before_hash text,
  after_hash text,
  exit_code integer,
  outcome text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS thumbgate.brain_memories (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES thumbgate.organizations(id) ON DELETE CASCADE,
  project_id text REFERENCES thumbgate.projects(id) ON DELETE SET NULL,
  memory_type text NOT NULL DEFAULT 'log',
  title text NOT NULL,
  content text NOT NULL,
  source text NOT NULL,
  tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS thumbgate.lesson_embeddings (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES thumbgate.organizations(id) ON DELETE CASCADE,
  project_id text REFERENCES thumbgate.projects(id) ON DELETE SET NULL,
  lesson_id text REFERENCES thumbgate.lessons(id) ON DELETE CASCADE,
  feedback_event_id text REFERENCES thumbgate.feedback_events(id) ON DELETE CASCADE,
  brain_memory_id text REFERENCES thumbgate.brain_memories(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('lesson', 'feedback', 'brain_memory', 'rule')),
  text text NOT NULL,
  embedding vector(${embeddingDim}) NOT NULL,
  embedding_model text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tg_feedback_org_project_created ON thumbgate.feedback_events(org_id, project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tg_lessons_org_project_created ON thumbgate.lessons(org_id, project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tg_rules_org_project_enabled ON thumbgate.prevention_rules(org_id, project_id, enabled);
CREATE INDEX IF NOT EXISTS idx_tg_gate_firings_org_project_created ON thumbgate.gate_firings(org_id, project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tg_action_receipts_action_hash ON thumbgate.action_receipts(org_id, project_id, action_hash);
CREATE INDEX IF NOT EXISTS idx_tg_brain_memories_org_project_created ON thumbgate.brain_memories(org_id, project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tg_feedback_tags ON thumbgate.feedback_events USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_tg_lessons_tags ON thumbgate.lessons USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_tg_brain_memories_tags ON thumbgate.brain_memories USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_tg_lesson_embeddings_hnsw ON thumbgate.lesson_embeddings USING hnsw (embedding vector_cosine_ops);
${rlsSql}
`;
}

function feedbackSignal(record) {
  if (record.signal === 'up' || record.signal === 'positive') return record.signal;
  return record.signal === 'down' ? 'negative' : (record.signal || 'negative');
}

function normalizeTags(record) {
  if (Array.isArray(record.tags)) return record.tags.map(String).filter(Boolean);
  if (typeof record.tags === 'string') return record.tags.split(',').map((tag) => tag.trim()).filter(Boolean);
  return [];
}

function buildJsonlMigrationSql(options = {}) {
  const feedbackDir = options.feedbackDir || options['feedback-dir'] || process.cwd();
  const orgId = options.orgId || options['org-id'];
  const projectId = options.projectId || options['project-id'];
  if (!orgId || !projectId) {
    throw new Error('Postgres migration requires --org-id and --project-id');
  }

  const agentId = options.agentId || options['agent-id'] || 'imported-agent';
  const orgName = options.orgName || options['org-name'] || orgId;
  const projectSlug = options.projectSlug || options['project-slug'] || projectId;
  const feedback = readJsonl(path.join(feedbackDir, 'feedback-log.jsonl'));
  const memories = readJsonl(path.join(feedbackDir, 'memory-log.jsonl'));
  const lines = [
    '-- ThumbGate local JSONL -> Team/Enterprise Postgres migration',
    `-- Source: ${feedbackDir}`,
    'BEGIN;',
    `INSERT INTO thumbgate.organizations (id, name) VALUES (${sqlLiteral(orgId)}, ${sqlLiteral(orgName)}) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;`,
    `INSERT INTO thumbgate.projects (id, org_id, slug, name) VALUES (${sqlLiteral(projectId)}, ${sqlLiteral(orgId)}, ${sqlLiteral(projectSlug)}, ${sqlLiteral(projectSlug)}) ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name;`,
    `INSERT INTO thumbgate.agents (id, org_id, project_id, name, kind) VALUES (${sqlLiteral(agentId)}, ${sqlLiteral(orgId)}, ${sqlLiteral(projectId)}, ${sqlLiteral(agentId)}, 'import') ON CONFLICT (id) DO UPDATE SET project_id = EXCLUDED.project_id;`,
  ];

  for (const record of feedback) {
    if (!record.id) continue;
    lines.push(`INSERT INTO thumbgate.feedback_events (id, org_id, project_id, agent_id, signal, context, tags, payload, source, created_at)
VALUES (${sqlLiteral(record.id)}, ${sqlLiteral(orgId)}, ${sqlLiteral(projectId)}, ${sqlLiteral(agentId)}, ${sqlLiteral(feedbackSignal(record))}, ${sqlLiteral(record.context || '')}, ${sqlTextArray(normalizeTags(record))}, ${sqlJson(record)}, ${sqlLiteral(record.source || 'local-jsonl')}, ${sqlTimestamp(record.timestamp || record.createdAt)})
ON CONFLICT (id) DO UPDATE SET context = EXCLUDED.context, tags = EXCLUDED.tags, payload = EXCLUDED.payload;`);
  }

  for (const record of memories) {
    if (!record.id) continue;
    const sourceFeedbackId = record.sourceFeedbackId || record.feedbackId || null;
    const signal = feedbackSignal(record);
    lines.push(`INSERT INTO thumbgate.lessons (id, org_id, project_id, source_feedback_id, signal, title, content, what_to_change, importance, tags, payload, created_at)
VALUES (${sqlLiteral(record.id)}, ${sqlLiteral(orgId)}, ${sqlLiteral(projectId)}, ${sqlLiteral(sourceFeedbackId)}, ${sqlLiteral(signal)}, ${sqlLiteral(record.title || record.context || record.id)}, ${sqlLiteral(record.content || record.whatWentWrong || record.whatWorked || '')}, ${sqlLiteral(record.whatToChange || '')}, ${sqlLiteral(record.importance || 'medium')}, ${sqlTextArray(normalizeTags(record))}, ${sqlJson(record)}, ${sqlTimestamp(record.timestamp || record.createdAt)})
ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content, what_to_change = EXCLUDED.what_to_change, tags = EXCLUDED.tags, payload = EXCLUDED.payload;`);
  }

  lines.push('COMMIT;');
  return `${lines.join('\n')}\n`;
}

function guardSqlBatch(sql) {
  const warnings = [];
  const blocks = [];
  for (const statement of splitSqlStatements(sql)) {
    const verdict = evaluatePostgresQuery(statement);
    if (verdict.mode === 'block') blocks.push({ statement: statement.slice(0, 180), reason: verdict.reason });
    if (verdict.mode === 'warn') warnings.push({ statement: statement.slice(0, 180), reason: verdict.reason });
  }
  return { ok: blocks.length === 0, warnings, blocks, statementCount: statementCount(sql) };
}

async function applySql(options = {}) {
  const sql = String(options.sql || '');
  const databaseUrl = options.databaseUrl || process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for --apply');
  const guard = guardSqlBatch(sql);
  if (!guard.ok) {
    const reasons = guard.blocks.map((block) => block.reason).join('; ');
    throw new Error(`Postgres guard blocked SQL: ${reasons}`);
  }
  const Client = options.Client || require('pg').Client;
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
  return { ok: true, ...guard };
}

function writeSqlIfRequested(sql, outputPath) {
  if (!outputPath) return null;
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, sql);
  return outputPath;
}

module.exports = {
  DEFAULT_EMBEDDING_DIM,
  ORG_SCOPED_TABLES,
  applySql,
  buildEnterprisePostgresSchema,
  buildJsonlMigrationSql,
  guardSqlBatch,
  normalizeEmbeddingDim,
  splitSqlStatements,
  statementCount,
  writeSqlIfRequested,
};
