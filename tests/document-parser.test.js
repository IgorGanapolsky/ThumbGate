'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  parseDocumentFile,
  parseTesseractTsv,
} = require('../scripts/document-parser');

test('Tesseract TSV parsing preserves line boundaries and averages confidence', () => {
  const tsv = [
    'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
    '5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t90\tNever',
    '5\t1\t1\t1\t1\t2\t10\t0\t10\t10\t80\tforce-push',
    '5\t1\t1\t1\t2\t1\t0\t10\t10\t10\t100\tmain',
  ].join('\n');
  const parsed = parseTesseractTsv(tsv);
  assert.equal(parsed.text, 'Never force-push\nmain');
  assert.equal(parsed.confidence, 90);
  assert.equal(parsed.wordCount, 3);
});

test('PDF adapter uses embedded text without OCR when text density is sufficient', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-parser-pdf-'));
  const pdfPath = path.join(tempDir, 'policy.pdf');
  fs.writeFileSync(pdfPath, '%PDF-test');
  const calls = [];
  try {
    const parsed = await parseDocumentFile(pdfPath, {
      resolveExecutable: (name) => `/mock/${name}`,
      runCommand: async (executable) => {
        calls.push(executable);
        if (executable.endsWith('pdfinfo')) return { stdout: 'Pages: 2\n', stderr: '' };
        return {
          stdout: 'This policy contains enough embedded text to exceed the OCR threshold. '.repeat(4),
          stderr: '',
        };
      },
    });
    assert.equal(parsed.sourceFormat, 'pdf');
    assert.equal(parsed.diagnostics.ocrTriggered, false);
    assert.equal(parsed.diagnostics.ocrStatus, 'not_needed');
    assert.equal(calls.some((entry) => entry.endsWith('tesseract')), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('image adapter invokes bounded OCR and returns confidence diagnostics', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-parser-image-'));
  const imagePath = path.join(tempDir, 'policy.png');
  fs.writeFileSync(imagePath, 'fake-image');
  try {
    const parsed = await parseDocumentFile(imagePath, {
      resolveExecutable: () => '/mock/tesseract',
      runCommand: async () => ({
        stdout: [
          'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
          '5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t95\tVerify',
          '5\t1\t1\t1\t1\t2\t10\t0\t10\t10\t85\tevidence',
        ].join('\n'),
        stderr: '',
      }),
    });
    assert.equal(parsed.sourceFormat, 'image');
    assert.equal(parsed.content, 'Verify evidence');
    assert.equal(parsed.diagnostics.ocrConfidence, 90);
    assert.equal(parsed.diagnostics.ocrStatus, 'success');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('OCR-required input fails explicitly when the executable is unavailable', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-parser-no-ocr-'));
  const imagePath = path.join(tempDir, 'scan.png');
  fs.writeFileSync(imagePath, 'fake-image');
  try {
    await assert.rejects(
      () => parseDocumentFile(imagePath, { resolveExecutable: () => null }),
      (error) => error.code === 'THUMBGATE_OCR_UNAVAILABLE',
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
