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

test('the 201st import does not evict earlier documents from the catalog', () => {
  // Regression: persistDocument rebuilt the catalog via listImportedDocuments, whose limit
  // is CLAMPED to MAX_SEARCH_SCAN(200) internally — so import cap+1 silently dropped the
  // oldest summaries; files stayed on disk but became unlistable and unsearchable. The
  // store honours THUMBGATE_FEEDBACK_DIR, already pinned for this file, so assert on the
  // catalog's line-count delta after importing well past the cap.
  const catalogPath = path.join(tmpFeedbackDir, 'documents', 'catalog.jsonl');
  const countCatalog = () => (fs.existsSync(catalogPath)
    ? fs.readFileSync(catalogPath, 'utf8').split('\n').filter(Boolean).length
    : 0);
  const before = countCatalog();
  const total = 210;
  for (let i = 0; i < total; i += 1) {
    importDocument({ content: `# Evict Doc ${i}\n\nbody ${i}`, sourceFormat: 'markdown', title: `Evict Doc ${i}` });
  }
  const after = countCatalog();
  assert.equal(after, before + total,
    `catalog grew by ${after - before}/${total} — imports beyond the search cap were evicted`);
});
