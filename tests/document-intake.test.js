'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { __test__: apiServerTest } = require('../src/api/server');

const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-document-intake-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpFeedbackDir;

const {
  getDocumentPath,
  importDocument,
  listImportedDocuments,
  readImportedDocument,
  searchImportedDocuments,
  searchImportedDocumentsAsync,
  documentAccessAllowed,
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
  assert.equal(results[0]._retrieval.queryTransformation.strategy, 'original-only');
  assert.equal(results[0]._retrieval.queryTransformation.hydeApplied, false);
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

test('tenant and document ACLs fail closed across list, read, and search paths', async () => {
  const aclFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-document-acl-'));
  const alice = { tenantId: 'tenant-a', principalId: 'alice' };
  const aliceColleague = { tenantId: 'tenant-a', principalId: 'alex' };
  const bob = { tenantId: 'tenant-b', principalId: 'bob' };
  try {
    const privateDocument = importDocument({
      feedbackDir: aclFeedbackDir,
      title: 'Private Incident Plan',
      content: 'Rotate the incident credential after containment.',
      sourceFormat: 'text',
      accessContext: alice,
      visibility: 'private',
    });
    const tenantDocument = importDocument({
      feedbackDir: aclFeedbackDir,
      title: 'Tenant Release Plan',
      content: 'Run the tenant release verification suite.',
      sourceFormat: 'text',
      accessContext: alice,
      visibility: 'tenant',
    });

    assert.equal(documentAccessAllowed(privateDocument, alice), true);
    assert.equal(documentAccessAllowed(privateDocument, aliceColleague), false);
    assert.equal(documentAccessAllowed(privateDocument, bob), false);
    assert.equal(readImportedDocument(privateDocument.documentId, {
      feedbackDir: aclFeedbackDir,
    }), null, 'protected documents require an authorization context');
    assert.equal(readImportedDocument(privateDocument.documentId, {
      feedbackDir: aclFeedbackDir,
      accessContext: aliceColleague,
    }), null, 'same-tenant principals cannot read private documents by default');

    const aliceList = listImportedDocuments({ feedbackDir: aclFeedbackDir, accessContext: alice });
    const colleagueList = listImportedDocuments({
      feedbackDir: aclFeedbackDir,
      accessContext: aliceColleague,
    });
    const bobList = listImportedDocuments({ feedbackDir: aclFeedbackDir, accessContext: bob });
    assert.ok(aliceList.documents.some((entry) => entry.documentId === privateDocument.documentId));
    assert.equal(colleagueList.documents.some((entry) => entry.documentId === privateDocument.documentId), false);
    assert.ok(colleagueList.documents.some((entry) => entry.documentId === tenantDocument.documentId));
    assert.equal(bobList.total, 0);

    const unauthorizedLexical = searchImportedDocuments({
      feedbackDir: aclFeedbackDir,
      query: 'incident credential',
      accessContext: bob,
    });
    const unauthorizedHybrid = await searchImportedDocumentsAsync({
      feedbackDir: aclFeedbackDir,
      query: 'incident credential',
      accessContext: aliceColleague,
      queryRewrite: false,
    });
    assert.deepEqual(unauthorizedLexical, []);
    assert.equal(unauthorizedHybrid.some((entry) => entry.documentId === privateDocument.documentId), false);
  } finally {
    fs.rmSync(aclFeedbackDir, { recursive: true, force: true });
  }
});

test('private document storage identity prevents cross-principal ACL overwrite', () => {
  const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-document-owner-scope-'));
  const alice = { tenantId: 'tenant-shared', principalId: 'alice' };
  const bob = { tenantId: 'tenant-shared', principalId: 'bob' };
  try {
    const common = {
      feedbackDir: isolatedDir,
      title: 'Shared Title',
      content: 'Identical private source content.',
      sourceFormat: 'text',
      visibility: 'private',
    };
    const aliceDocument = importDocument({ ...common, accessContext: alice });
    const bobDocument = importDocument({ ...common, accessContext: bob });

    assert.notEqual(aliceDocument.documentId, bobDocument.documentId);
    assert.equal(readImportedDocument(aliceDocument.documentId, {
      feedbackDir: isolatedDir,
      accessContext: alice,
    })?.access.ownerId, 'alice');
    assert.equal(readImportedDocument(bobDocument.documentId, {
      feedbackDir: isolatedDir,
      accessContext: bob,
    })?.access.ownerId, 'bob');
    assert.equal(readImportedDocument(aliceDocument.documentId, {
      feedbackDir: isolatedDir,
      accessContext: bob,
    }), null);
    assert.equal(listImportedDocuments({
      feedbackDir: isolatedDir,
      accessContext: alice,
    }).documents.some((entry) => entry.documentId === bobDocument.documentId), false);
  } finally {
    fs.rmSync(isolatedDir, { recursive: true, force: true });
  }
});

test('hosted customer identities map to stable opaque tenant partitions', () => {
  const first = apiServerTest.buildHostedTenantIdentity({
    valid: true,
    customerId: 'customer-a@example.test',
    installId: 'install-a',
  });
  const rotated = apiServerTest.buildHostedTenantIdentity({
    valid: true,
    customerId: 'customer-a@example.test',
    installId: 'install-a',
  });
  const second = apiServerTest.buildHostedTenantIdentity({
    valid: true,
    customerId: 'customer-b@example.test',
    installId: 'install-b',
  });

  assert.deepEqual(first, rotated, 'key rotation preserves tenant and principal identity');
  assert.notEqual(first.partition, second.partition);
  assert.notEqual(first.accessContext.principalId, second.accessContext.principalId);
  assert.equal(JSON.stringify(first).includes('customer-a@example.test'), false);
  assert.match(first.partition, /^tenant_[a-f0-9]{24}$/);
});

test('hosted keys without a customer identity fail closed', () => {
  assert.equal(apiServerTest.buildHostedTenantIdentity({
    valid: true,
    installId: 'orphaned-install',
  }), null);
});

test('tenant partitions cannot escape the configured feedback root', () => {
  const base = { FEEDBACK_DIR: path.resolve('/tmp/thumbgate-tenant-root') };
  const identity = apiServerTest.buildHostedTenantIdentity({
    valid: true,
    customerId: '../../escape-attempt',
    installId: '../principal-attempt',
  });
  const partitioned = apiServerTest.partitionFeedbackPaths(base, identity);
  const relative = path.relative(base.FEEDBACK_DIR, partitioned.FEEDBACK_DIR);

  assert.equal(relative.startsWith('..'), false);
  assert.equal(path.isAbsolute(relative), false);
  assert.equal(partitioned.FEEDBACK_DIR.includes('escape-attempt'), false);
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
