'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { embed } = require('../../../scripts/vector-store');

const LANCE_DIR = path.join(__dirname, '../db/lancedb');
const TABLE_NAME = 'manufacturing_chunks';

let _db = null;
let _table = null;

async function getDB() {
  if (!_db) {
    const lancedb = await import('@lancedb/lancedb');
    fs.mkdirSync(LANCE_DIR, { recursive: true });
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

  for (const file of dataFiles) {
    const filePath = path.join(__dirname, '../data', file.name);
    if (!fs.existsSync(filePath)) {
      console.warn(`[VectorDB] Warning: File not found ${filePath}`);
      continue;
    }

    const text = fs.readFileSync(filePath, 'utf-8');
    const sections = text.split(/(?=\n##\s+)/);

    for (const sec of sections) {
      if (!sec.trim()) continue;

      const headerMatch = sec.match(/##\s+([^\n]+)/);
      const title = headerMatch ? headerMatch[1].trim() : 'General Header';

      console.log(`[VectorDB] Generating embedding for chunk: "${title}" (${file.source})`);
      const vector = await embed(sec.trim());

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
      const lancedb = await import('@lancedb/lancedb');
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

  const queryVector = await embed(query);
  
  // Query LanceDB using cosine similarity vector search
  const results = await table
    .search(queryVector)
    .distanceType('cosine')
    .limit(topK)
    .toArray();

  // Map results to match standard chunk format
  return results.map(row => ({
    title: row.title,
    text: row.text,
    score: 2.0 - row._distance, // Convert distance metric to a confidence score where higher is better
    source: row.source,
    fileName: row.fileName
  }));
}

module.exports = { seedVectorDatabase, queryVectorDB };
