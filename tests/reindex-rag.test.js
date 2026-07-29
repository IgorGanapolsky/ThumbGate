'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { importDocument } = require('../scripts/document-intake');
const { reindexRag, resolveReindexPaths } = require('../scripts/reindex-rag');

test('re-index reports dry-run cardinality without mutating the index', async () => {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-reindex-dry-'));
  try {
    const document = importDocument({
      feedbackDir,
      title: 'Reindex Policy',
      content: '# Reindex\n\nAlways verify the index receipt.',
      sourceFormat: 'markdown',
      proposeGates: false,
    });
    const result = await reindexRag({ feedbackDir, dryRun: true });
    assert.equal(result.status, 'dry_run');
    assert.equal(result.currentDocuments, 1);
    assert.equal(result.expectedChunks, document.chunks.length);
    assert.equal(fs.existsSync(resolveReindexPaths({ feedbackDir }).statePath), false);
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('re-index checkpoints work, retires stale versions, and reconciles completion', async () => {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-reindex-run-'));
  const indexed = [];
  const retired = [];
  try {
    const first = importDocument({
      feedbackDir,
      title: 'Versioned Reindex Policy',
      sourceUrl: 'https://example.invalid/reindex',
      content: '# Reindex\n\nUse the old blue path.',
      sourceFormat: 'markdown',
      proposeGates: false,
    });
    const second = importDocument({
      feedbackDir,
      title: 'Versioned Reindex Policy',
      sourceUrl: 'https://example.invalid/reindex',
      content: '# Reindex\n\nUse the current green path.',
      sourceFormat: 'markdown',
      proposeGates: false,
    });
    const result = await reindexRag({ feedbackDir }, {
      indexDocument: async (document) => {
        indexed.push(document.documentId);
        return { embeddedCount: 1, reusedCount: document.chunks.length - 1 };
      },
      retireDocument: async (documentId) => {
        retired.push(documentId);
        return { retired: true };
      },
      getRagIndexStatus: async () => ({
        schemaVersion: 2,
        tables: ['thumbgate_rag_v2_test_384'],
      }),
    });
    assert.equal(result.status, 'complete');
    assert.deepEqual(indexed, [second.documentId]);
    assert.deepEqual(retired, [first.documentId]);
    assert.equal(result.reconciliation.documentCountMatches, true);
    assert.equal(fs.existsSync(resolveReindexPaths({ feedbackDir }).lockPath), false);
    assert.equal(
      JSON.parse(fs.readFileSync(resolveReindexPaths({ feedbackDir }).statePath)).status,
      'complete',
    );
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});
