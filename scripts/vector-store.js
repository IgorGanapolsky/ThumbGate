'use strict';

const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_LANCE_DIR = path.join(PROJECT_ROOT, '.claude', 'memory', 'feedback', 'lancedb');

// Module-level cache — prevents re-importing on every upsertFeedback() call
// First ESM import takes ~200ms; second is instant from cache.
let _lancedb = null;
let _pipeline = null;
const TABLE_NAME = 'rlhf_memories';

async function getLanceDB() {
  if (!_lancedb) {
    _lancedb = await import('@lancedb/lancedb');
  }
  return _lancedb;
}

async function getEmbeddingPipeline() {
  if (!_pipeline) {
    const { pipeline } = await import('@huggingface/transformers');
    _pipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true,
    });
  }
  return _pipeline;
}

async function embed(text) {
  const pipe = await getEmbeddingPipeline();
  const output = await pipe(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data); // Float32Array -> plain number[] for LanceDB Arrow serialization
}

async function upsertFeedback(feedbackEvent) {
  const lanceDir = process.env.RLHF_FEEDBACK_DIR
    ? path.join(process.env.RLHF_FEEDBACK_DIR, 'lancedb')
    : DEFAULT_LANCE_DIR;

  const { connect } = await getLanceDB();
  const db = await connect(lanceDir);

  const textForEmbedding = [
    feedbackEvent.context || '',
    (feedbackEvent.tags || []).join(' '),
    feedbackEvent.whatWentWrong || '',
    feedbackEvent.whatWorked || '',
  ].filter(Boolean).join('. ');

  const vector = await embed(textForEmbedding);

  const record = {
    id: feedbackEvent.id,
    text: textForEmbedding,
    vector,
    signal: feedbackEvent.signal,
    tags: (feedbackEvent.tags || []).join(','),
    timestamp: feedbackEvent.timestamp,
    context: feedbackEvent.context || '',
  };

  const tableNames = await db.tableNames();
  if (tableNames.includes(TABLE_NAME)) {
    const table = await db.openTable(TABLE_NAME);
    await table.add([record]);
  } else {
    await db.createTable(TABLE_NAME, [record]);
  }
}

async function searchSimilar(queryText, limit = 5) {
  const lanceDir = process.env.RLHF_FEEDBACK_DIR
    ? path.join(process.env.RLHF_FEEDBACK_DIR, 'lancedb')
    : DEFAULT_LANCE_DIR;

  const { connect } = await getLanceDB();
  const db = await connect(lanceDir);

  const tableNames = await db.tableNames();
  if (!tableNames.includes(TABLE_NAME)) return [];

  const vector = await embed(queryText);
  const table = await db.openTable(TABLE_NAME);
  const results = await table.search(vector).limit(limit).toArray();
  return results;
}

module.exports = { upsertFeedback, searchSimilar, TABLE_NAME };
