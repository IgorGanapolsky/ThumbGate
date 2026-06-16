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

test('importDocument performs URL deduplication and RAG drift tracking', () => {
  const url = 'https://thumbgate.ai/policies/standard-v1';
  
  // 1. First import
  const doc1 = importDocument({
    title: 'Standard Policy v1',
    content: 'Rule: Never run unvetted npm scripts.',
    sourceUrl: url,
    sourceFormat: 'text',
    feedbackDir: tmpFeedbackDir,
  });
  
  assert.equal(doc1.duplicate, undefined);
  assert.equal(doc1.updated, undefined);
  
  // 2. Second import of the identical URL and content (Deduplication)
  const doc2 = importDocument({
    title: 'Standard Policy v1',
    content: 'Rule: Never run unvetted npm scripts.',
    sourceUrl: url,
    sourceFormat: 'text',
    feedbackDir: tmpFeedbackDir,
  });
  
  assert.equal(doc2.duplicate, true);
  assert.equal(doc2.updated, false);
  assert.equal(doc2.dedupReason, 'url-and-content-unchanged');
  
  // 3. Import of identical content but DIFFERENT URL (Content deduplication)
  const doc3 = importDocument({
    title: 'Standard Policy v1',
    content: 'Rule: Never run unvetted npm scripts.',
    sourceUrl: 'https://mirror.thumbgate.ai/policies/standard-v1',
    sourceFormat: 'text',
    feedbackDir: tmpFeedbackDir,
  });
  
  assert.equal(doc3.duplicate, true);
  assert.equal(doc3.updated, false);
  assert.equal(doc3.dedupReason, 'content-identical');
  
  // 4. Import of same URL but EVOLVED content (RAG Drift)
  const doc4 = importDocument({
    title: 'Standard Policy v1',
    content: 'Rule: Never run unvetted npm scripts. Rule: Use pnpm whenever possible.',
    sourceUrl: url,
    sourceFormat: 'text',
    feedbackDir: tmpFeedbackDir,
  });
  
  assert.equal(doc4.duplicate, undefined);
  assert.equal(doc4.updated, true);
  assert.equal(doc4.dedupReason, 'url-content-updated');
  assert.equal(doc4.previousDocumentId, doc1.documentId);
  assert.equal(doc4.previousFingerprint, doc1.fingerprint);
  
  // 5. Verify the catalog only lists the newest version of the URL
  const listed = listImportedDocuments({
    feedbackDir: tmpFeedbackDir,
    query: 'Standard Policy',
  });
  
  const urlDocs = listed.documents.filter(doc => doc.sourceUrl === url);
  assert.equal(urlDocs.length, 1);
  assert.equal(urlDocs[0].documentId, doc4.documentId);
});

