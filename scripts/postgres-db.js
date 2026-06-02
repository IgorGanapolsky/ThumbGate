'use strict';

/**
 * Team/Enterprise PostgreSQL + pgvector storage adapter.
 *
 * Local installs stay on SQLite/LanceDB. This module is only selected when
 * THUMBGATE_STORAGE=postgres or DATABASE_URL/THUMBGATE_DATABASE_URL is set.
 */

const {
  buildEnterprisePostgresSchema,
  normalizeEmbeddingDim,
} = require('./enterprise-postgres');

let _pgPool = null;

function tenant(options = {}) {
  return {
    orgId: options.orgId || process.env.THUMBGATE_ORG_ID || 'default-org',
    projectId: options.projectId || process.env.THUMBGATE_PROJECT_ID || 'default-project',
    agentId: options.agentId || process.env.THUMBGATE_AGENT_ID || 'default-agent',
  };
}

function getPool() {
  if (_pgPool) return _pgPool;
  const connectionString = process.env.DATABASE_URL || process.env.THUMBGATE_DATABASE_URL;
  if (!connectionString) {
    throw new Error('Postgres storage selected but DATABASE_URL is not configured');
  }

  const { Pool } = require('pg');
  _pgPool = new Pool({
    connectionString,
    max: Number(process.env.THUMBGATE_PG_POOL_MAX || 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  return _pgPool;
}

async function query(text, params = []) {
  const pool = getPool();
  return pool.query(text, params);
}

async function initPostgresDB(options = {}) {
  const t = tenant(options);
  const embeddingDim = normalizeEmbeddingDim(options.embeddingDim || options['embedding-dim']);
  await query(buildEnterprisePostgresSchema({ embeddingDim, enableRls: options.enableRls !== false }));
  await query(
    `INSERT INTO thumbgate.organizations (id, name)
     VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
    [t.orgId, options.orgName || process.env.THUMBGATE_ORG_NAME || t.orgId],
  );
  await query(
    `INSERT INTO thumbgate.projects (id, org_id, slug, name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name`,
    [t.projectId, t.orgId, options.projectSlug || t.projectId, options.projectName || t.projectId],
  );
  await query(
    `INSERT INTO thumbgate.agents (id, org_id, project_id, name, kind)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET project_id = EXCLUDED.project_id, name = EXCLUDED.name`,
    [t.agentId, t.orgId, t.projectId, options.agentName || t.agentId, options.agentKind || 'agent'],
  );
}

function normalizedSignal(value) {
  if (value === 'up' || value === 'positive') return 'positive';
  return 'negative';
}

function vectorLiteral(embedding) {
  const expectedDim = normalizeEmbeddingDim();
  if (!Array.isArray(embedding) || embedding.length !== expectedDim) return null;
  return `[${embedding.map(Number).join(',')}]`;
}

async function upsertLessonPg(feedbackEvent, memoryRecord = null, embedding = null, options = {}) {
  const t = tenant(options);
  const id = memoryRecord?.id || feedbackEvent.id;
  const signal = normalizedSignal(feedbackEvent.signal);
  const tags = Array.isArray(feedbackEvent.tags) ? feedbackEvent.tags : [];
  const payload = { feedbackEvent, memoryRecord };
  await initPostgresDB({ ...options, enableRls: options.enableRls });

  await query(
    `INSERT INTO thumbgate.feedback_events
       (id, org_id, project_id, agent_id, signal, context, tags, payload, source, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
     ON CONFLICT (id) DO UPDATE SET
       context = EXCLUDED.context,
       tags = EXCLUDED.tags,
       payload = EXCLUDED.payload`,
    [
      feedbackEvent.id,
      t.orgId,
      t.projectId,
      t.agentId,
      signal,
      feedbackEvent.context || null,
      tags,
      JSON.stringify(feedbackEvent),
      feedbackEvent.source || 'storage-adapter',
      feedbackEvent.timestamp || new Date().toISOString(),
    ],
  );

  await query(
    `INSERT INTO thumbgate.lessons
       (id, org_id, project_id, source_feedback_id, signal, title, content, what_to_change, importance, tags, payload, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       content = EXCLUDED.content,
       what_to_change = EXCLUDED.what_to_change,
       importance = EXCLUDED.importance,
       tags = EXCLUDED.tags,
       payload = EXCLUDED.payload`,
    [
      id,
      t.orgId,
      t.projectId,
      feedbackEvent.id,
      signal,
      memoryRecord?.title || feedbackEvent.context || id,
      memoryRecord?.content || feedbackEvent.whatWentWrong || feedbackEvent.whatWorked || '',
      feedbackEvent.whatToChange || memoryRecord?.whatToChange || '',
      memoryRecord?.importance || (signal === 'negative' ? 'high' : 'medium'),
      tags,
      JSON.stringify(payload),
      feedbackEvent.timestamp || new Date().toISOString(),
    ],
  );

  const vector = vectorLiteral(embedding);
  if (vector) {
    await query(
      `INSERT INTO thumbgate.lesson_embeddings
         (org_id, project_id, lesson_id, feedback_event_id, kind, text, embedding, embedding_model, metadata)
       VALUES ($1, $2, $3, $4, 'lesson', $5, $6::vector, $7, $8::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [
        t.orgId,
        t.projectId,
        id,
        feedbackEvent.id,
        [feedbackEvent.context, feedbackEvent.whatWentWrong, feedbackEvent.whatWorked].filter(Boolean).join('. '),
        vector,
        process.env.THUMBGATE_EMBED_MODEL || 'local-bge-small',
        JSON.stringify({ source: 'storage-adapter' }),
      ],
    );
  }

  return id;
}

async function searchLessonsSimilarPg(queryEmbedding, options = {}) {
  const t = tenant(options);
  const limit = Math.min(options.limit || 10, 50);
  const signal = options.signal ? normalizedSignal(options.signal) : null;
  const vector = vectorLiteral(queryEmbedding);
  const params = [t.orgId, t.projectId];
  let sql = `
    SELECT l.id, l.signal, l.title, l.content, l.what_to_change AS "whatToChange",
           l.importance, l.tags, l.created_at AS timestamp`;

  if (vector) {
    params.push(vector);
    sql += `, (e.embedding <=> $${params.length}::vector) AS distance
      FROM thumbgate.lessons l
      JOIN thumbgate.lesson_embeddings e ON e.lesson_id = l.id
      WHERE l.org_id = $1 AND l.project_id = $2`;
  } else {
    sql += `
      FROM thumbgate.lessons l
      WHERE l.org_id = $1 AND l.project_id = $2`;
  }

  if (signal) {
    params.push(signal);
    sql += ` AND l.signal = $${params.length}`;
  }
  if (options.tags && options.tags.length) {
    params.push(options.tags);
    sql += ` AND l.tags @> $${params.length}`;
  }
  params.push(limit);
  sql += vector ? ` ORDER BY distance ASC LIMIT $${params.length}` : ` ORDER BY l.created_at DESC LIMIT $${params.length}`;
  const res = await query(sql, params);
  return res.rows;
}

async function upsertBrainMemoryPg(entry, embedding = null, options = {}) {
  const t = tenant(options);
  await initPostgresDB({ ...options, enableRls: options.enableRls });
  const tags = Array.isArray(entry.tags) ? entry.tags : [];
  await query(
    `INSERT INTO thumbgate.brain_memories
       (id, org_id, project_id, memory_type, title, content, source, tags, payload, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       content = EXCLUDED.content,
       source = EXCLUDED.source,
       tags = EXCLUDED.tags,
       payload = EXCLUDED.payload`,
    [
      entry.id,
      t.orgId,
      t.projectId,
      entry.type || entry.memoryType || 'log',
      entry.title,
      entry.content || '',
      entry.source,
      tags,
      JSON.stringify(entry),
      entry.timestamp || new Date().toISOString(),
    ],
  );
  const vector = vectorLiteral(embedding);
  if (vector) {
    await query(
      `INSERT INTO thumbgate.lesson_embeddings
         (org_id, project_id, brain_memory_id, kind, text, embedding, embedding_model, metadata)
       VALUES ($1, $2, $3, 'brain_memory', $4, $5::vector, $6, $7::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [
        t.orgId,
        t.projectId,
        entry.id,
        [entry.title, entry.content].filter(Boolean).join('. '),
        vector,
        process.env.THUMBGATE_EMBED_MODEL || 'local-bge-small',
        JSON.stringify({ source: 'storage-adapter' }),
      ],
    );
  }
  return entry.id;
}

async function searchBrainMemorySimilarPg(queryEmbedding, limit = 5, type = null, options = {}) {
  const t = tenant(options);
  const vector = vectorLiteral(queryEmbedding);
  const params = [t.orgId, t.projectId];
  let sql = `
    SELECT b.id, b.memory_type AS type, b.title, b.content, b.source, b.tags, b.created_at AS timestamp`;
  if (vector) {
    params.push(vector);
    sql += `, (e.embedding <=> $${params.length}::vector) AS distance
      FROM thumbgate.brain_memories b
      JOIN thumbgate.lesson_embeddings e ON e.brain_memory_id = b.id
      WHERE b.org_id = $1 AND b.project_id = $2`;
  } else {
    sql += `
      FROM thumbgate.brain_memories b
      WHERE b.org_id = $1 AND b.project_id = $2`;
  }
  if (type) {
    params.push(type);
    sql += ` AND b.memory_type = $${params.length}`;
  }
  params.push(Math.min(limit || 5, 50));
  sql += vector ? ` ORDER BY distance ASC LIMIT $${params.length}` : ` ORDER BY b.created_at DESC LIMIT $${params.length}`;
  const res = await query(sql, params);
  return res.rows;
}

async function recordActionReceiptPg(receipt, options = {}) {
  const t = tenant(options);
  await initPostgresDB({ ...options, enableRls: options.enableRls });
  await query(
    `INSERT INTO thumbgate.action_receipts
       (id, org_id, project_id, agent_id, action_hash, before_hash, after_hash, exit_code, outcome, payload, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
     ON CONFLICT (id) DO UPDATE SET outcome = EXCLUDED.outcome, payload = EXCLUDED.payload`,
    [
      receipt.id,
      t.orgId,
      t.projectId,
      t.agentId,
      receipt.actionHash || receipt.id,
      receipt.beforeHash || null,
      receipt.afterHash || null,
      Number.isInteger(receipt.exitCode) ? receipt.exitCode : null,
      receipt.outcome || receipt.status || null,
      JSON.stringify(receipt),
      receipt.timestamp || new Date().toISOString(),
    ],
  );
  return receipt.id;
}

async function recordGateFiringPg(firing, options = {}) {
  const t = tenant(options);
  await initPostgresDB({ ...options, enableRls: options.enableRls });
  await query(
    `INSERT INTO thumbgate.gate_firings
       (org_id, project_id, rule_id, agent_id, decision, tool_name, action, payload, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
    [
      t.orgId,
      t.projectId,
      firing.ruleId || null,
      t.agentId,
      firing.decision || firing.verdict || 'block',
      firing.toolName || null,
      firing.action || firing.actionTaken || null,
      JSON.stringify(firing),
      firing.timestamp || new Date().toISOString(),
    ],
  );
}

async function closePgPool() {
  if (_pgPool) {
    await _pgPool.end();
    _pgPool = null;
  }
}

module.exports = {
  closePgPool,
  initPostgresDB,
  query,
  recordActionReceiptPg,
  recordGateFiringPg,
  searchBrainMemorySimilarPg,
  searchLessonsSimilarPg,
  tenant,
  upsertBrainMemoryPg,
  upsertLessonPg,
};
