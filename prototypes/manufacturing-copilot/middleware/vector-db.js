'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { embed } = require('../../../scripts/vector-store');
const { scanForInjection } = require('./guardrails');

// Env override lets each test process use an isolated index dir, so e2e
// stub-embedding runs can never poison the dev/demo vector store.
const LANCE_DIR = process.env.MANUFACTURING_LANCE_DIR || path.join(__dirname, '../db/lancedb');
let _ftsDbPath = process.env.MANUFACTURING_FTS_PATH || path.join(__dirname, '../db/fts.sqlite');
const TABLE_NAME = 'manufacturing_chunks';

let _ftsDb = null;

function getFtsDb() {
  if (_ftsDb) return _ftsDb;
  if (_ftsDbPath !== ':memory:') {
    const dbDir = path.dirname(_ftsDbPath);
    _deps.fs.mkdirSync(dbDir, { recursive: true });
  }
  _ftsDb = new Database(_ftsDbPath);
  if (_ftsDbPath !== ':memory:') {
    _ftsDb.pragma('journal_mode = WAL');
  }
  _ftsDb.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
      title,
      text,
      source UNINDEXED,
      fileName UNINDEXED,
      sourceTitle UNINDEXED,
      sourceUrl UNINDEXED,
      sourcePage UNINDEXED,
      sourcePdf UNINDEXED
    );
  `);
  return _ftsDb;
}

function extractSectionMetadata(section, file) {
  const value = (key) => section.match(new RegExp(`^<!--\\s*${key}:\\s*([^\\n]+?)\\s*-->`, 'mi'))?.[1]?.trim() || null;
  return {
    sourceTitle: value('source_title') || file.source,
    sourceUrl: value('source_url') || '',
    sourcePage: value('source_page') || '',
    sourcePdf: value('source_pdf') || '',
  };
}

let _db = null;
let _table = null;
let _quarantined = [];
let _seedPromise = null;
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
  _ftsDbPath = ':memory:';
  if (_ftsDb) {
    try { _ftsDb.close(); } catch {}
    _ftsDb = null;
  }
  _quarantined = [];
  _seedPromise = null;
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
  _ftsDbPath = process.env.MANUFACTURING_FTS_PATH || path.join(__dirname, '../db/fts.sqlite');
  if (_ftsDb) {
    try { _ftsDb.close(); } catch {}
    _ftsDb = null;
  }
  _quarantined = [];
  _seedPromise = null;
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
function seedVectorDatabase() {
  if (!_seedPromise) {
    _seedPromise = seedVectorDatabaseOnce().finally(() => {
      _seedPromise = null;
    });
  }
  return _seedPromise;
}

async function seedVectorDatabaseOnce() {
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

      const metadata = extractSectionMetadata(sec, file);
      // Strip citation metadata HTML comments from the stored/quoted text so
      // they never leak into answers; metadata is preserved in columns below.
      const cleanText = sec.replace(/<!--[\s\S]*?-->/g, '').replace(/\n{3,}/g, '\n\n').trim();
      console.log(`[VectorDB] Generating embedding for chunk: "${title}" (${file.source})`);
      const vector = await _deps.embed(cleanText);

      records.push({
        vector,
        text: cleanText,
        title,
        source: file.source,
        fileName: file.name,
        // Coalesce nulls to '' so LanceDB/Arrow can infer string columns even
        // when the first chunk lacks citation metadata.
        sourceTitle: metadata.sourceTitle || '',
        sourceUrl: metadata.sourceUrl || '',
        sourcePage: metadata.sourcePage || '',
        sourcePdf: metadata.sourcePdf || ''
      });
    }
  }

  // Create or overwrite the LanceDB table
  if (records.length > 0) {
    _table = await db.createTable(TABLE_NAME, records, { mode: 'overwrite', overwrite: true });
    console.log(`[VectorDB] Successfully indexed ${records.length} chunks into LanceDB table "${TABLE_NAME}".`);

    // Populate SQLite FTS5 database
    try {
      const ftsDb = getFtsDb();
      ftsDb.exec('DELETE FROM documents_fts');
      const insertStmt = ftsDb.prepare(`
        INSERT INTO documents_fts (title, text, source, fileName, sourceTitle, sourceUrl, sourcePage, sourcePdf)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertMany = ftsDb.transaction((rows) => {
        for (const r of rows) {
          insertStmt.run(
            r.title,
            r.text,
            r.source,
            r.fileName,
            r.sourceTitle || '',
            r.sourceUrl || '',
            r.sourcePage || '',
            r.sourcePdf || ''
          );
        }
      });
      insertMany(records);
      console.log(`[VectorDB] Successfully indexed ${records.length} chunks into SQLite FTS5 database.`);
    } catch (err) {
      console.warn('[VectorDB] SQLite FTS5 seeding failed:', err.message);
    }
    
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

const CLEARANCE_LEVELS = {
  operator: 0,
  supervisor: 1,
  plant_manager: 2,
};

function getChunkRequiredClearance(row) {
  const title = (row.title || '').toUpperCase();
  const text = (row.text || '').toUpperCase();

  // Rule 1: Safety System Bypasses / SP-110 require Plant Manager (Clearance 2)
  if (title.includes('SP-110') || title.includes('GUARDING') || text.includes('SP-110')) {
    return 2;
  }

  // Rule 2: Confined Space Entry SP-102 requires Supervisor (Clearance 1)
  if (title.includes('SP-102') || title.includes('CONFINED') || text.includes('SP-102')) {
    return 1;
  }

  // MM-201 and MM-210 require Supervisor (Clearance 1)
  if (title.includes('MM-201') || title.includes('MM-210') || text.includes('MM-201') || text.includes('MM-210')) {
    return 1;
  }

  return 0;
}

/**
 * Searches the LanceDB database using HNSW approximate nearest neighbor (ANN) vector matching.
 */
async function queryVectorDB(query, topK = 2, options = {}) {
  let table = await getTable();
  if (!table) {
    console.log('[VectorDB] Table not initialized. Seeding database first...');
    await seedVectorDatabase();
    table = await getTable();
  }

  const codeMatch = query.match(/\b(SP|MM|QC)-\d{3}\b/i);
  const embeddingVector = await _deps.embed(query);
  
  // Query LanceDB using cosine similarity vector search
  // Retrieve a candidate pool for hybrid procedure code boosting/reranking or fusion reranking
  const shouldRerank = options.rerank === true;
  const candidateLimit = shouldRerank 
    ? Math.max(topK * 3, 10) 
    : (codeMatch ? Math.max(topK, 15) : topK);

  let results;
  try {
    results = await table
      .search(embeddingVector)
      .distanceType('cosine')
      .limit(candidateLimit)
      .toArray();
  } catch (err) {
    console.warn('[VectorDB] Query failed, attempting to repair table by re-seeding:', err.message);
    await seedVectorDatabase();
    table = await getTable();
    results = await table
      .search(embeddingVector)
      .distanceType('cosine')
      .limit(candidateLimit)
      .toArray();
  }

  // Retrieve FTS candidates from SQLite FTS5 table to combine for hybrid search
  let ftsResults = [];
  if (_ftsDbPath !== ':memory:' || options.enableFtsForTest) {
    try {
      const ftsDb = getFtsDb();
      const terms = query
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      if (terms.length > 0) {
        const matchQuery = terms.map(t => `${t}*`).join(' OR ');
        ftsResults = ftsDb.prepare(`
          SELECT title, text, source, fileName, sourceTitle, sourceUrl, sourcePage, sourcePdf
          FROM documents_fts
          WHERE documents_fts MATCH ?
          LIMIT ?
        `).all(matchQuery, candidateLimit);
      }
    } catch (err) {
      console.warn('[VectorDB] SQLite FTS5 query failed:', err.message);
      // Fallback to LIKE query
      try {
        const ftsDb = getFtsDb();
        ftsResults = ftsDb.prepare(`
          SELECT title, text, source, fileName, sourceTitle, sourceUrl, sourcePage, sourcePdf
          FROM documents_fts
          WHERE title LIKE ? OR text LIKE ?
          LIMIT ?
        `).all(`%${query}%`, `%${query}%`, candidateLimit);
      } catch (fallbackErr) {
        console.warn('[VectorDB] SQLite FTS5 fallback query failed:', fallbackErr.message);
      }
    }
  }

  // Merge results and ftsResults (deduplicating by title + text)
  const candidateMap = new Map();
  results.forEach(r => {
    const key = `${r.title}::${r.text}`;
    candidateMap.set(key, { ...r });
  });

  ftsResults.forEach(r => {
    const key = `${r.title}::${r.text}`;
    if (!candidateMap.has(key)) {
      candidateMap.set(key, {
        ...r,
        _distance: 1.0, // Default distance for FTS-only matches (middle score range)
      });
    }
  });

  const combinedCandidates = Array.from(candidateMap.values());

  // Filter candidates by user role clearance level
  const userRole = options.metadataFilters?.role || options.role || 'operator';
  const userClearance = CLEARANCE_LEVELS[userRole] ?? 0;

  const clearedResults = combinedCandidates.filter(row => {
    const reqClearance = getChunkRequiredClearance(row);
    return userClearance >= reqClearance;
  });

  let finalResults = clearedResults;

  // Hybrid Fusion / Rerank Stage:
  // Blend semantic cosine score with token-overlap/keyword matching score
  if (shouldRerank) {
    const queryTerms = query.toLowerCase().split(/\W+/).filter(t => t.length > 2);
    const scored = clearedResults.map(row => {
      const docText = (row.title + ' ' + row.text).toLowerCase();
      let matches = 0;
      for (const term of queryTerms) {
        if (docText.includes(term)) {
          matches++;
        }
      }
      const overlapScore = queryTerms.length > 0 ? matches / queryTerms.length : 0;
      const semanticScore = 2.0 - row._distance; // 2.0 is max score when distance is 0
      // 50% semantic vector score, 50% keyword term overlap
      const score = semanticScore * 0.5 + overlapScore * 0.5;
      return {
        ...row,
        _blendedScore: Number(score.toFixed(6))
      };
    });
    // Sort candidates by the blended fusion score descending
    scored.sort((a, b) => b._blendedScore - a._blendedScore);
    finalResults = scored;
  }

  // Keyword/Code boosting (hybrid RAG reranker):
  // If query contains a procedure ID like SP-101 or MM-201, bubble matching document to the top
  if (codeMatch) {
    const code = codeMatch[0].toUpperCase();
    finalResults.sort((a, b) => {
      const aHas = (a.title + ' ' + a.text).toUpperCase().includes(code);
      const bHas = (b.title + ' ' + b.text).toUpperCase().includes(code);
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;
      return 0;
    });
  }

  // Slice to requested topK and map results
  return finalResults.slice(0, topK).map(row => {
    const mapped = {
      title: row.title,
      text: row.text,
      score: row._blendedScore !== undefined ? row._blendedScore : (2.0 - row._distance),
      source: row.source,
      fileName: row.fileName,
      page: row.page || row.sourcePage || null
    };
    for (const key of ['sourceTitle', 'sourceUrl', 'sourcePage', 'sourcePdf']) {
      if (row[key] !== undefined && row[key] !== null) mapped[key] = row[key];
    }
    return mapped;
  });
}

module.exports = {
  seedVectorDatabase,
  queryVectorDB,
  getIngestionReport,
  configureVectorDBForTest,
  resetVectorDBForTest,
};
