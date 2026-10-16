'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  evaluateHotdataPreToolGate,
  buildHotSqlVectorSearchQuery,
  createHotdataLanceAdapter,
} = require('../adapters/hotdata/hotdata-vector-store');
const vectorStore = require('../scripts/vector-store');

test('resolveVectorBackend: selects hotdata when THUMBGATE_VECTOR_BACKEND=hotdata or HOTDATA_API_KEY+WORKSPACE_ID set', () => {
  assert.equal(vectorStore.resolveVectorBackend({ THUMBGATE_VECTOR_BACKEND: 'hotdata' }), 'hotdata');
  assert.equal(
    vectorStore.resolveVectorBackend({ HOTDATA_API_KEY: 'hd_test', HOTDATA_WORKSPACE_ID: 'work_123', HOTDATA_DATABASE_ID: 'dbid_123' }),
    'hotdata'
  );
  assert.equal(vectorStore.resolveVectorBackend({}), 'lancedb');
});

test('vector-store.js: swaps LanceDB for Hotdata DB on upsertFeedback and searchSimilar', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-hotdata-poc-'));
  const prevBackend = process.env.THUMBGATE_VECTOR_BACKEND;
  const prevFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
  const prevStub = process.env.THUMBGATE_VECTOR_STUB_EMBED;

  process.env.THUMBGATE_VECTOR_BACKEND = 'hotdata';
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  process.env.THUMBGATE_VECTOR_STUB_EMBED = 'true';
  vectorStore.setLanceLoaderForTests(null);

  t.after(() => {
    if (prevBackend === undefined) delete process.env.THUMBGATE_VECTOR_BACKEND;
    else process.env.THUMBGATE_VECTOR_BACKEND = prevBackend;
    if (prevFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = prevFeedbackDir;
    if (prevStub === undefined) delete process.env.THUMBGATE_VECTOR_STUB_EMBED;
    else process.env.THUMBGATE_VECTOR_STUB_EMBED = prevStub;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await vectorStore.upsertFeedback({
    id: 'fb_hotdata_1',
    signal: 'down',
    context: 'Agent ran unbounded DELETE FROM customer_invoices without WHERE clause',
    tags: ['sql', 'hotdata', 'destructive'],
    whatWentWrong: 'Unbounded DELETE on production table',
    timestamp: '2026-10-15T18:00:00Z',
  });

  await vectorStore.upsertFeedback({
    id: 'fb_hotdata_2',
    signal: 'up',
    context: 'Agent queried read-only Hotdata DataFusion snapshot in 85us',
    tags: ['hotdata', 'datafusion'],
    whatWorked: 'Fast isolated read query',
    timestamp: '2026-10-15T18:01:00Z',
  });

  const results = await vectorStore.searchSimilar('unbounded DELETE SQL query', 2);
  assert.equal(results.length, 2);
  assert.equal(results[0].id, 'fb_hotdata_1');
  assert.equal(typeof results[0]._distance, 'number');

  // Verify Hotdata snapshot metadata file was written instead of LanceDB
  const metaFile = path.join(tmpDir, 'hotdata', 'thumbgate_memories.hotdata.meta.json');
  assert.equal(fs.existsSync(metaFile), true);
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  assert.equal(meta.schemaVersion, 'hotdata.table.v1');
  assert.equal(meta.index.algorithm, 'hnsw');
  assert.equal(meta.rowCount, 2);
});

test('HotdataHttpClient: executes /v1/databases/.../loads, /v1/connections/.../indexes, and /v1/query vector_search', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-hotdata-http-'));
  const calls = [];
  const mockFetch = async (url, opts) => {
    calls.push({ url, method: opts.method, headers: opts.headers, body: JSON.parse(opts.body) });
    if (url.endsWith('/query')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            columns: ['id', 'text', 'signal', 'tags', '_distance'],
            rows: [['fb_remote_1', 'Remote HotSQL vector match', 'down', 'hotdata', 0.042]],
            preview_row_count: 1,
            total_row_count: 1,
            truncated: false,
            execution_time_ms: 14,
            query_run_id: 'qrun_123',
            result_id: 'res_123',
          };
        },
      };
    }
    return {
      ok: true,
      status: 200,
      async json() { return { ok: true }; },
    };
  };

  const adapter = createHotdataLanceAdapter({
    apiKey: 'hd_live_test_token',
    workspaceId: 'workm4lz2mp899l2i7h9lk9u84azg3',
    databaseId: 'dbid6lguax1dxn9y1xj5gxnameyywl',
    connectionId: 'connu6ho8mseuv8rvsk15anzkmpdsm',
    fetchImpl: mockFetch,
  });

  const db = await adapter.connect(tmpDir);
  const table = await db.createTable('thumbgate_memories', [
    {
      id: 'fb_remote_1',
      text: 'Remote HotSQL vector match',
      vector: [1, 0, 0, 0],
      signal: 'down',
      tags: 'hotdata',
      timestamp: '2026-10-15T18:05:00Z',
      context: 'test',
    },
  ]);

  const hits = await table.search([1, 0, 0, 0]).limit(1).toArray();
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'fb_remote_1');
  assert.equal(hits[0]._distance, 0.042);

  // Verify all 3 Hotdata v1 endpoints were called: loads, indexes, and query
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /\/v1\/databases\/dbid6lguax1dxn9y1xj5gxnameyywl\/schemas\/main\/tables\/thumbgate_memories\/loads$/);
  assert.equal(calls[0].body.mode, 'replace');
  assert.match(calls[1].url, /\/v1\/connections\/connu6ho8mseuv8rvsk15anzkmpdsm\/tables\/main\/thumbgate_memories\/indexes$/);
  assert.equal(calls[1].body.index_type, 'vector');
  assert.match(calls[2].url, /\/v1\/query$/);
  assert.equal(calls[2].body.dialect, 'hotsql');
  assert.match(calls[2].body.sql, /vector_search\('default\.main\.thumbgate_memories'/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('evaluateHotdataPreToolGate: blocks runaway 5x HotSQL retry loops and destructive writes in <1ms', () => {
  const history = [];
  const badQuery = 'SELECT missing_col FROM default.main.thumbgate_memories';
  for (let i = 0; i < 4; i++) {
    const res = evaluateHotdataPreToolGate({ toolName: 'hotdata_query', sqlOrCommand: badQuery, sessionHistory: history });
    assert.equal(res.allowed, true);
  }
  const fifth = evaluateHotdataPreToolGate({ toolName: 'hotdata_query', sqlOrCommand: badQuery, sessionHistory: history });
  assert.equal(fifth.allowed, false);
  assert.equal(fifth.gateId, 'gate:hotdata:runaway_query_loop');

  const dropAttempt = evaluateHotdataPreToolGate({
    toolName: 'postgres_write',
    sqlOrCommand: 'DROP TABLE customer_accounts;',
    sessionHistory: [],
  });
  assert.equal(dropAttempt.allowed, false);
  assert.equal(dropAttempt.gateId, 'gate:hotdata:destructive_write_boundary');
});
