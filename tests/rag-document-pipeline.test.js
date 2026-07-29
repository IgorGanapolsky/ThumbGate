'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseDocument,
  cleanRecord,
  chunkText,
  extractMetadata,
  runDocumentPipeline,
  skillPacksToDocuments,
} = require('../scripts/rag-document-pipeline');

test('parseDocument rejects PDF with explicit error (no fake parse)', () => {
  const r = parseDocument({ type: 'pdf', content: '%PDF-1.4 binary' });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'pdf_not_supported');
});

test('parseDocument splits markdown on headings', () => {
  const r = parseDocument({
    type: 'markdown',
    id: 'ops',
    content: '# One\nAlpha rule about idempotency.\n\n## Two\nBeta rule about health endpoint.\n',
  });
  assert.equal(r.ok, true);
  assert.ok(r.records.length >= 2);
  assert.match(r.records[0].content, /idempotency/i);
});

test('cleanRecord drops placeholder thumbs text', () => {
  const dropped = cleanRecord({ id: '1', title: '', content: 'thumbs down' });
  assert.equal(dropped.kept, false);
  assert.equal(dropped.reason, 'placeholder');
});

test('chunkText splits long docs with overlap and respects max', () => {
  const long = `${'Always back up the database. '.repeat(80)}END_MARKER`;
  const chunks = chunkText(long, { maxChars: 200, overlap: 40 });
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => c.length <= 220));
  assert.ok(chunks.some((c) => c.includes('back up') || c.includes('database')));
});

test('extractMetadata finds tools and domain hints', () => {
  const meta = extractMetadata({
    id: 'x',
    title: 'Stripe mistake',
    content: 'NEVER store raw card numbers when creating a PaymentIntent',
    tags: [],
  });
  assert.equal(meta.signal, 'negative');
  assert.ok(meta.tags.includes('stripe') || meta.metadata.domain === 'stripe-integration');
});

test('skillPacksToDocuments seeds a non-empty corpus', () => {
  const docs = skillPacksToDocuments();
  assert.ok(docs.length >= 6, `expected skill pack rules, got ${docs.length}`);
  assert.ok(docs.some((d) => /idempotency/i.test(d.content)));
});

test('runDocumentPipeline emits metrics for every early stage', () => {
  const docs = skillPacksToDocuments().slice(0, 10);
  const { documents, chunks, metrics } = runDocumentPipeline(docs);
  assert.ok(documents.length > 0);
  assert.ok(chunks.length > 0);
  assert.ok(metrics.corpus_document_count > 0);
  assert.ok(metrics.parse_success_rate > 0);
  assert.ok(metrics.chunk_count > 0);
  assert.ok(metrics.records_with_tags_rate >= 0);
});
