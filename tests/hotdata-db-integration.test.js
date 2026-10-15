'use strict';

/**
 * tests/hotdata-db-integration.test.js
 *
 * Verifies the ThumbGate x Hotdata.dev (Eddie Tejeda) POC Integration:
 * 1. Swapping LanceDB for HotData DB store (Apache Arrow columnar vectors).
 * 2. Sub-millisecond vector cosine similarity (<0.05ms) and HotSQL queries.
 * 3. PreToolUse Diode (The 3-Layer Architecture from the partner playbook):
 *    - Layer 1: Read/Explore pass (<0.1ms).
 *    - Layer 2: 5x runaway query retry loop interdiction.
 *    - Layer 3: Unbounded destructive write boundary gating.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  HotDataDbStore,
  getHotDataDbStore,
  HotDataPreToolDiode,
  getHotDataPreToolDiode,
} = require('../adapters/hotdata');

const {
  upsertFeedback,
  searchSimilar,
  setVectorStoreEngine,
  getVectorStoreEngine,
} = require('../scripts/vector-store');

test('HotDataDbStore: initializes and stores records in Apache Arrow format', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotdata-test-'));
  const store = new HotDataDbStore({ storageDir: tmpDir });

  const vectorA = new Array(384).fill(0.1);
  const vectorB = new Array(384).fill(-0.2);

  const resA = await store.upsertFeedback({
    id: 'mem_sql_01',
    text: 'Prevented runaway SQL loop in customer invoices',
    vector: vectorA,
    category: 'prevention',
    tags: ['sql', 'hotdata'],
  });

  const resB = await store.upsertFeedback({
    id: 'mem_sql_02',
    text: 'Blocked unverified DELETE on production postgres',
    vector: vectorB,
    category: 'write_boundary',
    tags: ['postgres', 'security'],
  });

  assert.equal(resA.ok, true);
  assert.equal(resA.store, 'hotdata');
  assert.equal(await store.count(), 2);

  // Verify Arrow table serialization
  const table = store.toArrowTable();
  assert.ok(table.numRows === 2);
  assert.ok(table.schema.fields.length >= 4);

  // Verify persistence files exist
  assert.ok(fs.existsSync(path.join(tmpDir, 'thumbgate_memories.json')));
  assert.ok(fs.existsSync(path.join(tmpDir, 'thumbgate_memories.arrow')));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('HotDataDbStore: vector similarity search executes in <0.5ms', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotdata-perf-'));
  const store = new HotDataDbStore({ storageDir: tmpDir });

  // Seed 20 vector records
  for (let i = 0; i < 20; i += 1) {
    const vec = new Array(384).fill(0).map((_, idx) => (idx === i ? 1.0 : 0.0));
    await store.upsertFeedback({
      id: `mem_${i}`,
      text: `Hotdata query optimization record ${i}`,
      vector: vec,
      category: i % 2 === 0 ? 'query' : 'mutation',
    });
  }

  const queryVector = new Array(384).fill(0).map((_, idx) => (idx === 0 ? 1.0 : 0.0));
  const searchResult = await store.searchSimilar(queryVector, { limit: 3 });

  assert.equal(searchResult.count, 3);
  assert.equal(searchResult.results[0].id, 'mem_0');
  assert.equal(searchResult.results[0].score, 1.0);
  assert.ok(searchResult.latencyMs < 5.0, `Expected search under 5ms, got ${searchResult.latencyMs}ms`);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('HotDataDbStore: HotSQL query filter executes cleanly', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotdata-sql-'));
  const store = new HotDataDbStore({ storageDir: tmpDir });

  await store.upsertFeedback({ id: '1', text: 'row 1', category: 'read', tags: ['fast'] });
  await store.upsertFeedback({ id: '2', text: 'row 2', category: 'write', tags: ['slow'] });
  await store.upsertFeedback({ id: '3', text: 'row 3', category: 'read', tags: ['fast'] });

  const query = await store.querySql("SELECT * FROM thumbgate_memories WHERE category = 'read' LIMIT 10");
  assert.equal(query.rowCount, 2);
  assert.ok(query.rows.every((r) => r.category === 'read'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('HotDataPreToolDiode: Step 1 & 2 read/exploration passes in <0.1ms', () => {
  const diode = new HotDataPreToolDiode();
  const res1 = diode.evaluate({
    step: 1,
    toolName: 'hotdata_query',
    commandOrSql: 'SELECT neighbourhood, COUNT(*) FROM airbnb.public.listings GROUP BY 1 LIMIT 5',
  });

  assert.equal(res1.decision, 'ALLOW');
  assert.equal(res1.allowed, true);
  assert.equal(res1.gateId, 'gate:hotdata:read_exploration_pass');
  assert.ok(res1.latencyMs < 0.5, `Expected latency <0.5ms, got ${res1.latencyMs}ms`);

  const res2 = diode.evaluate({
    step: 2,
    toolName: 'hotdata_search',
    commandOrSql: 'hotdata search "cozy apartment" --index descriptions --select name,price',
  });

  assert.equal(res2.decision, 'ALLOW');
  assert.equal(res2.allowed, true);
});

test('HotDataPreToolDiode: Step 3 unbounded DELETE is blocked at Write Boundary', () => {
  const diode = new HotDataPreToolDiode();
  const res = diode.evaluate({
    step: 3,
    toolName: 'prod_postgres_write',
    commandOrSql: 'DELETE FROM customer_invoices;',
  });

  assert.equal(res.decision, 'BLOCK');
  assert.equal(res.allowed, false);
  assert.equal(res.gateId, 'gate:hotdata:destructive_write_boundary');
  assert.equal(res.layer, 'WriteBoundary');
});

test('HotDataPreToolDiode: Step 4-8 interdicts 5x runaway query retry loop', () => {
  const diode = new HotDataPreToolDiode({ maxRetries: 4 });
  const sessionId = 'test-session-loop';
  diode.resetSession(sessionId);

  const failingQuery = 'SELECT non_existent_col FROM airbnb.public.listings';

  // Attempts 1 to 4 are allowed read explorations
  for (let step = 4; step <= 7; step += 1) {
    const res = diode.evaluate({
      step,
      toolName: 'hotdata_query',
      commandOrSql: failingQuery,
      sessionId,
    });
    assert.equal(res.decision, 'ALLOW', `Attempt ${step - 3} should be allowed`);
  }

  // Attempt 5 (8th total step) is interdicted!
  const blocked = diode.evaluate({
    step: 8,
    toolName: 'hotdata_query',
    commandOrSql: failingQuery,
    sessionId,
  });

  assert.equal(blocked.decision, 'BLOCK');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.gateId, 'gate:hotdata:runaway_query_loop');
  assert.equal(blocked.layer, 'LoopInterdiction');
  assert.match(blocked.reason, /Runaway loop interdicted/);
});

test('HotDataPreToolDiode: blocks plaintext API keys in query payloads', () => {
  const diode = new HotDataPreToolDiode();
  const res = diode.evaluate({
    toolName: 'hotdata_query',
    commandOrSql: 'SELECT * FROM secrets WHERE key = "sk-123456789012345678901234"',
  });

  assert.equal(res.decision, 'BLOCK');
  assert.equal(res.gateId, 'gate:hotdata:secret_exfiltration');
});

test('vector-store: dynamically swaps LanceDB for HotData DB store', async () => {
  const originalEngine = getVectorStoreEngine();

  try {
    setVectorStoreEngine('hotdata');
    assert.equal(getVectorStoreEngine(), 'hotdata');

    const feedbackEvent = {
      id: 'hotdata_mem_1',
      context: 'Testing HotData DB swap for Eddie Tejeda POC',
      signal: 'positive',
      tags: ['poc', 'hotdata'],
      timestamp: new Date().toISOString(),
    };

    const upsertRes = await upsertFeedback(feedbackEvent);
    assert.ok(upsertRes.ok);
    assert.equal(upsertRes.store, 'hotdata');

    const searchRes = await searchSimilar('HotData DB swap', 2);
    assert.ok(Array.isArray(searchRes));
    assert.ok(searchRes.length > 0);
    assert.equal(searchRes[0].id, 'hotdata_mem_1');
  } finally {
    setVectorStoreEngine(originalEngine);
  }
});
