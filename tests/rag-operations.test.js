'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { importDocument } = require('../scripts/document-intake');
const { RagRunTelemetry } = require('../scripts/rag-stage-contract');
const {
  getRagOperationsSnapshot,
  summarizeDocuments,
} = require('../scripts/rag-operations');

test('document operations summary separates freshness, deduplication, and indexing states', () => {
  const summary = summarizeDocuments([
    {
      isCurrent: true,
      sourceFormat: 'markdown',
      deduplication: { status: 'unique' },
      indexing: { status: 'indexed' },
    },
    {
      isCurrent: false,
      sourceFormat: 'pdf',
      deduplication: { status: 'near_duplicate_review' },
      indexing: { status: 'quarantined' },
    },
    {
      isCurrent: true,
      sourceFormat: 'pdf',
      deduplication: { status: 'unique' },
      indexing: { status: 'pending_retry' },
    },
  ]);

  assert.equal(summary.total, 3);
  assert.equal(summary.current, 2);
  assert.equal(summary.stale, 1);
  assert.equal(summary.byFormat.pdf, 2);
  assert.equal(summary.pendingRetry, 1);
  assert.equal(summary.quarantined, 1);
});

test('RAG operations snapshot exposes contracts, telemetry, catalog, and index status', async () => {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-rag-operations-'));
  try {
    const document = importDocument({
      feedbackDir,
      title: 'Operations policy',
      content: '# Policy\n\nAlways verify production before claiming success.',
      sourceFormat: 'markdown',
      proposeGates: false,
    });
    document.indexing = { status: 'pending_retry' };
    const documentPath = path.join(feedbackDir, 'documents', `${document.documentId}.json`);
    fs.writeFileSync(documentPath, `${JSON.stringify(document, null, 2)}\n`);

    const telemetry = new RagRunTelemetry({
      feedbackDir,
      query: 'private operations question',
    });
    telemetry.start('retrieval').success('retrieval', { returnedCount: 1 });
    telemetry.finish({ resultCount: 1 });

    const snapshot = await getRagOperationsSnapshot({
      feedbackDir,
      getIndexStatus: async () => ({
        schemaVersion: 2,
        directory: '/redacted-for-test',
        tables: ['rag_chunks_test'],
      }),
    });

    assert.equal(snapshot.schemaVersion, 1);
    assert.ok(snapshot.stages.some((stage) => stage.id === 'documents'));
    assert.equal(snapshot.health.runs, 1);
    assert.equal(snapshot.health.stages.retrieval.successRate, 1);
    assert.equal(snapshot.documents.total, 1);
    assert.equal(snapshot.index.available, true);
    assert.deepEqual(snapshot.index.tables, ['rag_chunks_test']);
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('RAG operations snapshot reports vector index failures without hiding stage health', async () => {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-rag-operations-failure-'));
  try {
    const snapshot = await getRagOperationsSnapshot({
      feedbackDir,
      getIndexStatus: async () => {
        throw new TypeError('private connection detail');
      },
    });
    assert.equal(snapshot.index.available, false);
    assert.equal(snapshot.index.errorType, 'TypeError');
    assert.equal('message' in snapshot.index, false);
    assert.equal(snapshot.health.runs, 0);
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});
