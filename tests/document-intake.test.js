'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-document-intake-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpFeedbackDir;

const {
  getDocumentPath,
  importDocument,
  listImportedDocuments,
  readImportedDocument,
  searchImportedDocuments,
  searchImportedDocumentsAsync,
} = require('../scripts/document-intake');

test.after(() => {
  fs.rmSync(tmpFeedbackDir, { recursive: true, force: true });
  delete process.env.THUMBGATE_FEEDBACK_DIR;
});

test('importDocument stores markdown policy docs and proposes gate templates with provenance', () => {
  const docPath = path.join(tmpFeedbackDir, 'release-policy.md');
  fs.writeFileSync(docPath, [
    '# Release Policy',
    '',
    '- Never force-push to main.',
    '- Always run tests before commit.',
    '- Do not drop production tables without review.',
  ].join('\n'));

  const document = importDocument({
    filePath: docPath,
    tags: ['policy', 'team'],
  });

  assert.match(document.documentId, /^doc_/);
  assert.equal(document.title, 'Release Policy');
  assert.equal(document.sourceFormat, 'markdown');
  assert.equal(document.tags.includes('policy'), true);
  assert.equal(fs.existsSync(getDocumentPath(document.documentId, { feedbackDir: tmpFeedbackDir })), true);
  assert.ok(document.proposals.some((proposal) => proposal.templateId === 'never-force-push-main'));
  assert.ok(document.proposals.some((proposal) => proposal.templateId === 'never-skip-tests-before-commit'));
  assert.ok(document.proposals.some((proposal) => proposal.templateId === 'protect-production-sql'));

  const stored = readImportedDocument(document.documentId, { feedbackDir: tmpFeedbackDir });
  assert.equal(stored.documentId, document.documentId);
  assert.match(stored.content, /Never force-push to main/);
});

test('document listing and search surfaces imported runbooks for ThumbGate recall', () => {
  const document = importDocument({
    title: 'Incident Runbook',
    content: [
      '# Incident Runbook',
      '',
      'Always gather verification evidence before saying done.',
      'Back up the .env file before editing local credentials.',
      'Use the golden path when a workflow already has proof.',
    ].join('\n'),
    sourceFormat: 'markdown',
    tags: ['runbook', 'incident'],
  });

  const listed = listImportedDocuments({
    feedbackDir: tmpFeedbackDir,
    query: 'incident',
    limit: 10,
  });
  assert.equal(listed.total >= 1, true);
  assert.ok(listed.documents.some((entry) => entry.documentId === document.documentId));

  const results = searchImportedDocuments({
    feedbackDir: tmpFeedbackDir,
    query: 'verification evidence done',
    limit: 5,
  });
  assert.equal(results.length >= 1, true);
  assert.equal(results[0].documentId, document.documentId);
  assert.ok(results[0].proposals.some((proposal) => proposal.templateId === 'evidence-before-done'));
});

test('async document search ranks child chunks and hydrates bounded parent evidence', async () => {
  const filler = 'ordinary operational notes without relevant details. '.repeat(80);
  const target = importDocument({
    title: 'Deep Runbook',
    content: `${filler}\nIdempotency prevents duplicate payment processing.`,
    sourceFormat: 'markdown',
    tags: ['payments', 'runbook'],
  });
  importDocument({
    title: 'Cooking Notes',
    content: 'Recipe ingredients and kitchen temperature guidance.',
    sourceFormat: 'text',
    tags: ['cooking'],
  });
  const conceptEmbedder = async (text) => {
    const value = String(text).toLowerCase();
    const payment = /(charge|replay|idempotency|duplicate payment)/.test(value);
    return payment ? [1, 0, 0] : [0, 1, 0];
  };

  const results = await searchImportedDocumentsAsync({
    feedbackDir: tmpFeedbackDir,
    query: 'charge replay protection',
    limit: 3,
    maxChunkChars: 180,
    chunkOverlap: 30,
    embedder: conceptEmbedder,
    embedderId: 'document-concept-test',
    metadataFilters: { tags: ['payments', 'runbook'] },
  });

  assert.equal(results[0].documentId, target.documentId);
  assert.equal(results[0]._retrieval.parentChild, true);
  assert.equal(results[0]._retrieval.semanticProvider, 'document-concept-test');
  assert.ok(results[0]._retrieval.chunkCount > 1);
  assert.ok(results[0]._matchedChunks.length <= 3);
  assert.ok(results[0]._matchedChunks.some((chunk) => /idempotency/i.test(chunk.content)));
  assert.ok(results[0]._matchedChunks.some((chunk) => chunk.startChar > 1000));
  assert.equal(results.some((result) => result.title === 'Cooking Notes'), false);
});

test('async document search rejects tool-only candidates without query or dense evidence', async () => {
  importDocument({
    title: 'Reading Notes',
    content: 'Read this ordinary handbook before beginning routine work.',
    sourceFormat: 'text',
    tags: ['reading'],
  });

  const results = await searchImportedDocumentsAsync({
    feedbackDir: tmpFeedbackDir,
    query: 'quantum flux capacitor',
    queryRewrite: false,
    embedder: async () => [],
    embedderId: 'no-dense-results',
  });

  assert.deepEqual(results, []);
});

test('metadata-filtered document searches preserve cached vectors across filters', async () => {
  importDocument({
    title: 'Alpha Cache Note',
    content: 'Alpha-specific recovery evidence.',
    sourceFormat: 'text',
    tags: ['cache-alpha'],
  });
  importDocument({
    title: 'Beta Cache Note',
    content: 'Beta-specific recovery evidence.',
    sourceFormat: 'text',
    tags: ['cache-beta'],
  });

  let documentEmbeds = 0;
  const countingEmbedder = async (text, options = {}) => {
    if (options.kind === 'document') documentEmbeds += 1;
    return String(text).toLowerCase().includes('alpha') ? [1, 0] : [0, 1];
  };
  const shared = {
    feedbackDir: tmpFeedbackDir,
    limit: 1,
    embedder: countingEmbedder,
    embedderId: 'filtered-cache-test',
  };

  await searchImportedDocumentsAsync({
    ...shared,
    query: 'alpha recovery',
    metadataFilters: { tags: ['cache-alpha'] },
  });
  await searchImportedDocumentsAsync({
    ...shared,
    query: 'beta recovery',
    metadataFilters: { tags: ['cache-beta'] },
  });
  const afterDistinctFilters = documentEmbeds;
  await searchImportedDocumentsAsync({
    ...shared,
    query: 'alpha recovery',
    metadataFilters: { tags: ['cache-alpha'] },
  });

  assert.equal(afterDistinctFilters, 2, 'each filtered document is embedded once');
  assert.equal(documentEmbeds, 2, 'returning to a prior filter reuses its cached vector');
});

test('importDocument strips script/style tags even when closing tags include whitespace', () => {
  const document = importDocument({
    content: [
      '<html>',
      '<head>',
      '<title>HTML Policy</title>',
      '<style>body { color: red; }</style \t\n noop>',
      '</head>',
      '<body>',
      '<script>window.pwned = true;</script \t\n bar>',
      '<p>Never force-push to main.</p>',
      '</body>',
      '</html>',
    ].join(''),
    sourceFormat: 'html',
    tags: ['policy'],
  });

  assert.equal(document.title, 'HTML Policy');
  assert.doesNotMatch(document.content, /window\.pwned/);
  assert.doesNotMatch(document.content, /color:\s*red/);
  assert.match(document.content, /Never force-push to main/);
});
