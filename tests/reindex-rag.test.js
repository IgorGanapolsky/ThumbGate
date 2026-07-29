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

test('re-index dry-run predicts and real run persists legacy document chunk backfill', async () => {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-reindex-legacy-'));
  const documentsDir = path.join(feedbackDir, 'documents');
  const documentId = 'doc_legacy_policy_test';
  const documentPath = path.join(documentsDir, `${documentId}.json`);
  const indexed = [];
  try {
    fs.mkdirSync(documentsDir, { recursive: true });
    const legacyDocument = {
      documentId,
      title: 'Legacy policy',
      sourceType: 'inline',
      sourceFormat: 'markdown',
      importedAt: '2026-07-01T00:00:00.000Z',
      tags: ['legacy'],
      excerpt: 'Always verify the release receipt.',
      fingerprint: 'legacy-fingerprint',
      content: '# Legacy policy\n\nAlways verify the release receipt before claiming production.',
    };
    fs.writeFileSync(documentPath, `${JSON.stringify(legacyDocument, null, 2)}\n`);
    fs.writeFileSync(
      path.join(documentsDir, 'catalog.jsonl'),
      `${JSON.stringify(legacyDocument)}\n`,
    );

    const dryRun = await reindexRag({ feedbackDir, dryRun: true });
    assert.equal(dryRun.status, 'dry_run');
    assert.equal(dryRun.legacyDocumentsToUpgrade, 1);
    assert.equal(dryRun.expectedChunks, 1);
    assert.equal(JSON.parse(fs.readFileSync(documentPath, 'utf8')).chunks, undefined);

    const result = await reindexRag({ feedbackDir }, {
      indexDocument: async (document) => {
        indexed.push(document);
        return { embeddedCount: document.chunks.length, reusedCount: 0 };
      },
      retireDocument: async () => ({ retired: false }),
      getRagIndexStatus: async () => ({ schemaVersion: 2, tables: ['rag_legacy'] }),
    });
    const persisted = JSON.parse(fs.readFileSync(documentPath, 'utf8'));
    assert.equal(result.status, 'complete');
    assert.equal(result.migratedLegacyDocuments, 1);
    assert.equal(result.reconciliation.migratedLegacyDocuments, 1);
    assert.equal(indexed.length, 1);
    assert.equal(indexed[0].chunks.length, 1);
    assert.equal(persisted.schemaVersion, 2);
    assert.equal(persisted.chunks.length, 1);
    assert.equal(persisted.migration.reason, 'reindex_legacy_document_backfill');
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('re-index pages through the complete catalog beyond the 200-row listing cap', async () => {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-reindex-full-catalog-'));
  try {
    for (let index = 0; index < 205; index += 1) {
      importDocument({
        feedbackDir,
        title: `Catalog document ${index}`,
        content: `# Document ${index}\n\nAlways verify catalog row ${index}.`,
        sourceFormat: 'markdown',
        proposeGates: false,
      });
    }
    const result = await reindexRag({ feedbackDir, dryRun: true });
    assert.equal(result.status, 'dry_run');
    assert.equal(result.currentDocuments, 205);
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('re-index safely takes over a lock owned by a dead process', async () => {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-reindex-stale-lock-'));
  try {
    importDocument({
      feedbackDir,
      title: 'Stale lock recovery',
      content: '# Recovery\n\nResume after a terminated re-index process.',
      sourceFormat: 'markdown',
      proposeGates: false,
    });
    const paths = resolveReindexPaths({ feedbackDir });
    fs.mkdirSync(path.dirname(paths.lockPath), { recursive: true });
    fs.writeFileSync(paths.lockPath, `${JSON.stringify({
      pid: 2_147_483_647,
      startedAt: '2026-07-01T00:00:00.000Z',
    })}\n`);
    const result = await reindexRag({ feedbackDir }, {
      indexDocument: async (document) => ({
        embeddedCount: document.chunks.length,
        reusedCount: 0,
      }),
      retireDocument: async () => ({ retired: false }),
      getRagIndexStatus: async () => ({ schemaVersion: 2, tables: ['rag_stale_lock'] }),
    });
    assert.equal(result.status, 'complete');
    assert.equal(fs.existsSync(paths.lockPath), false);
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

test('re-index deterministically resumes a partial failure without repeating completed embeddings', async () => {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-reindex-resume-'));
  const attempts = [];
  try {
    const first = importDocument({
      feedbackDir,
      title: 'First checkpoint',
      sourceUrl: 'https://example.invalid/checkpoint/first',
      content: '# First\n\nCheckpoint one must not be embedded twice.',
      sourceFormat: 'markdown',
      proposeGates: false,
    });
    const second = importDocument({
      feedbackDir,
      title: 'Second checkpoint',
      sourceUrl: 'https://example.invalid/checkpoint/second',
      content: '# Second\n\nCheckpoint two fails once and then recovers.',
      sourceFormat: 'markdown',
      proposeGates: false,
    });
    let injectFailure = true;
    let seededFailureDocumentId = null;
    const dependencies = {
      indexDocument: async (document) => {
        attempts.push(document.documentId);
        if (injectFailure && attempts.length === 2) {
          seededFailureDocumentId = document.documentId;
          throw new Error('seeded embedding outage');
        }
        return { embeddedCount: document.chunks.length, reusedCount: 0 };
      },
      retireDocument: async () => ({ retired: false }),
      getRagIndexStatus: async () => ({
        schemaVersion: 2,
        tables: ['thumbgate_rag_v2_test_384'],
      }),
    };

    const failed = await reindexRag({ feedbackDir }, dependencies);
    assert.equal(failed.status, 'partial_failure');
    assert.equal(attempts.length, 2);
    assert.deepEqual(failed.completedDocumentIds, [attempts[0]]);
    assert.notEqual(attempts[0], seededFailureDocumentId);

    injectFailure = false;
    const replay = await reindexRag({ feedbackDir }, dependencies);
    assert.equal(replay.status, 'complete');
    assert.deepEqual(new Set(replay.completedDocumentIds), new Set([first.documentId, second.documentId]));
    assert.deepEqual(
      attempts,
      [attempts[0], seededFailureDocumentId, seededFailureDocumentId],
      'replay must retry only the failed document',
    );
    assert.equal(replay.reconciliation.documentCountMatches, true);
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});
