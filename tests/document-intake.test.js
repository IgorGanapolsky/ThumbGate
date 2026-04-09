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
