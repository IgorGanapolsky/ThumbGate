'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { embed } = require('../../../scripts/vector-store');
const { scanForInjection } = require('./guardrails');

// Env override lets each test process use an isolated index dir, so e2e
// stub-embedding runs can never poison the dev/demo vector store.
const LANCE_DIR = process.env.MANUFACTURING_LANCE_DIR || path.join(__dirname, '../db/lancedb');
const TABLE_NAME = 'manufacturing_chunks';

let _db = null;
let _table = null;
let _quarantined = [];
let _deps = {
  fs,
  embed,
  importLanceDB: () => import('@lancedb/lancedb'),
  dataDir: path.join(__dirname, '../data'),
  scanForInjection,
};

function configureVectorDBForTest(overrides = {}) {
  _deps = { ..._deps, ...overrides };
  _db = null;
  _table = null;
  _quarantined = [];
}

function resetVectorDBForTest() {
  _deps = {
    fs,
    embed,
    importLanceDB: () => import('@lancedb/lancedb'),
    dataDir: path.join(__dirname, '../data'),
    scanForInjection,
  };
  _db = null;
  _table = null;
  _quarantined = [];
}

// Report of chunks rejected at ingestion (for the UI / API surface).
function getIngestionReport() {
  return { quarantined: _quarantined };
}

async function getDB() {
  if (!_db) {
    const lancedb = await _deps.importLanceDB();
    _deps.fs.mkdirSync(LANCE_DIR, { recursive: true });
    _db = await lancedb.connect(LANCE_DIR);
  }
  return _db;
}

async function getTable() {
  const db = await getDB();
  if (!_table) {
    try {
      _table = await db.openTable(TABLE_NAME);
    } catch {
      _table = null;
    }
  }
  return _table;
}

/**
 * Parses markdown manuals, splits them into headers and chunks, generates embeddings,
 * and populates the local LanceDB vector database.
 */
async function seedVectorDatabase() {
  const db = await getDB();
  console.log('[VectorDB] Seeding LanceDB vector database...');

  const dataFiles = [
    { name: 'safety-procedures.md', source: 'Safety Procedures Manual' },
    { name: 'maintenance-manual.md', source: 'Maintenance Manual' },
    { name: 'quality-standards.md', source: 'Quality Control Standards' }
  ];

  const records = [];
  _quarantined = [];

  for (const file of dataFiles) {
    const filePath = path.join(_deps.dataDir, file.name);
    if (!_deps.fs.existsSync(filePath)) {
      console.warn(`[VectorDB] Warning: File not found ${filePath}`);
      continue;
    }

    const text = _deps.fs.readFileSync(filePath, 'utf-8');
    const sections = text.split(/(?=\n##\s+)/);

    for (const sec of sections) {
      if (!sec.trim()) continue;

      const headerMatch = sec.match(/##\s+([^\n]+)/);
      const title = headerMatch ? headerMatch[1].trim() : 'General Header';

      // Ingestion-time defense: a poisoned document never becomes "ground
      // truth". Chunks carrying injection payloads are quarantined here, so
      // the vector DB only ever contains clean, truthful content.
      const scan = _deps.scanForInjection(sec, 'ingestion');
      if (scan.status === 'block') {
        console.warn(`[VectorDB] QUARANTINED chunk "${title}" (${file.source}): ${scan.detail}`);
        _quarantined.push({ title, source: file.source, fileName: file.name, hits: scan.hits });
        continue;
      }

      console.log(`[VectorDB] Generating embedding for chunk: "${title}" (${file.source})`);
      const vector = await _deps.embed(sec.trim());

      records.push({
        vector,
        text: sec.trim(),
        title,
        source: file.source,
        fileName: file.name
      });
    }
  }

  // Create or overwrite the LanceDB table
  if (records.length > 0) {
    _table = await db.createTable(TABLE_NAME, records, { overwrite: true });
    console.log(`[VectorDB] Successfully indexed ${records.length} chunks into LanceDB table "${TABLE_NAME}".`);
    
    // Create an HNSW vector index for maximum speed and accuracy.
    // On a corpus this small LanceDB may refuse to train the index
    // (minimum-row requirements); exact cosine scan is then used, which is
    // both faster and exact at this scale — the API surface stays identical.
    console.log('[VectorDB] Creating HNSW index for vector table...');
    try {
      const lancedb = await _deps.importLanceDB();
      await _table.createIndex('vector', {
        config: lancedb.Index.hnswSq({ distanceType: 'cosine' }),
      });
      console.log('[VectorDB] HNSW indexing complete!');
    } catch (err) {
      console.warn(`[VectorDB] HNSW index skipped (corpus below training threshold): ${err.message}`);
    }
  }
}

/**
 * Searches the LanceDB database using HNSW approximate nearest neighbor (ANN) vector matching.
 */
async function queryVectorDB(query, topK = 2) {
  let table = await getTable();
  if (!table) {
    console.log('[VectorDB] Table not initialized. Seeding database first...');
    await seedVectorDatabase();
    table = await getTable();
  }

  const codeMatch = query.match(/\b(SP|MM)-\d{3}\b/i);
  const embeddingVector = await _deps.embed(query);
  
  // Query LanceDB using cosine similarity vector search
  // Retrieve a candidate pool for hybrid procedure code boosting/reranking only when a code is queried
  const candidateLimit = codeMatch ? Math.max(topK, 5) : topK;
  const results = await table
    .search(embeddingVector)
    .distanceType('cosine')
    .limit(candidateLimit)
    .toArray();

  // Keyword/Code boosting (hybrid RAG reranker):
  // If query contains a procedure ID like SP-101 or MM-201, bubble matching document to the top
  if (codeMatch) {
    const code = codeMatch[0].toUpperCase();
    results.sort((a, b) => {
      const aHas = (a.title + ' ' + a.text).toUpperCase().includes(code);
      const bHas = (b.title + ' ' + b.text).toUpperCase().includes(code);
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;
      return 0;
    });
  }

  // Slice to requested topK and map results
  return results.slice(0, topK).map(row => ({
    title: row.title,
    text: row.text,
    score: 2.0 - row._distance, // Convert distance metric to a confidence score where higher is better
    source: row.source,
    fileName: row.fileName
  }));
}

module.exports = {
  seedVectorDatabase,
  queryVectorDB,
  getIngestionReport,
  configureVectorDBForTest,
  resetVectorDBForTest,
};
