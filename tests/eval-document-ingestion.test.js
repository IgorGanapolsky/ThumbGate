'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildTextPdf,
  grade,
  runDocumentIngestionEval,
  scoreDimensions,
  writeMinimalDocx,
} = require('../scripts/eval-document-ingestion');
const { parseDocumentFile } = require('../scripts/document-parser');

test('generated PDF and DOCX fixtures exercise the production binary adapters', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-binary-fixtures-'));
  try {
    const docxPath = path.join(tempDir, 'fixture.docx');
    await writeMinimalDocx(docxPath, 'Verify production evidence.');
    const docx = await parseDocumentFile(docxPath);
    assert.match(docx.content, /Verify production evidence/);

    const hasPoppler = ['pdfinfo', 'pdftotext'].every((name) => {
      const paths = String(process.env.PATH || '').split(path.delimiter);
      return paths.some((directory) => {
        try {
          fs.accessSync(path.join(directory, name), fs.constants.X_OK);
          return true;
        } catch {
          return false;
        }
      });
    });
    if (!hasPoppler) {
      t.diagnostic('Poppler unavailable; production Docker installs poppler-utils');
      return;
    }
    const pdfPath = path.join(tempDir, 'fixture.pdf');
    fs.writeFileSync(pdfPath, buildTextPdf(
      'Verify production evidence with enough searchable text. Preserve citations, version lineage, and exact source metadata before every operational claim.',
    ));
    const pdf = await parseDocumentFile(pdfPath);
    assert.match(pdf.content, /Verify production evidence/);
    assert.equal(pdf.diagnostics.ocrTriggered, false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('ingestion scoring separates implementation readiness from evidence maturity', () => {
  const evidence = {
    adapters: {
      docx: { passed: true },
      pdf: { passed: true },
      ocr: { passed: false },
      capabilities: { tesseract: true, pdftoppm: true },
    },
    exactDuplicate: true,
    nearDuplicateQuarantined: true,
    normalized: true,
    instructionRiskTagged: true,
    boundedChunks: true,
    offsetProvenance: true,
    stableChunkReuse: true,
    scopeComplete: true,
    provenanceComplete: true,
    currentOnly: true,
    reindexComplete: true,
    reindexReconciled: true,
    versionIncremented: true,
    lineagePreserved: true,
    oldVersionRetired: true,
  };
  const scored = scoreDimensions(evidence);
  assert.equal(scored.dimensions.ocr, 70);
  assert.ok(scored.implementationScore > scored.evidenceMaturityScore);
  assert.notEqual(scored.implementationGrade, scored.evidenceMaturityGrade);
  assert.equal(grade(88), 'B+');
});

test('document ingestion evaluation measures every requested dimension', async () => {
  const reportPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-ingestion-report-')),
    'report.md',
  );
  try {
    const report = await runDocumentIngestionEval({
      liveAdapters: false,
      reportPath,
    });
    assert.deepEqual(Object.keys(report.dimensions), [
      'parsing',
      'ocr',
      'deduplication',
      'normalization',
      'chunking',
      'metadata',
      'incrementalUpdates',
      'reindexing',
      'versioning',
    ]);
    assert.ok(report.overallScore > 0);
    assert.ok(report.evidenceLimitations.some((item) => /live customer/i.test(item)));
    assert.match(fs.readFileSync(reportPath, 'utf8'), /Implementation readiness/);
  } finally {
    fs.rmSync(path.dirname(reportPath), { recursive: true, force: true });
  }
});
