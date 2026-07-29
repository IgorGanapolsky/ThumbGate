#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const PARSER_ADAPTER_VERSION = 'thumbgate-document-adapters-v1';
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const DEFAULT_OCR_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_PAGES = 100;
const MIN_TEXT_CHARS_PER_PAGE = 80;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.webp']);

function makeParserError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function resolveExecutable(name, env = process.env) {
  const searchPaths = String(env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const directory of searchPaths) {
    const candidate = path.join(directory, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Continue to the next PATH entry.
    }
  }
  return null;
}

async function runCommand(executable, args, options = {}) {
  const result = await execFileAsync(executable, args, {
    encoding: options.encoding || 'utf8',
    timeout: Number(options.timeoutMs) || DEFAULT_COMMAND_TIMEOUT_MS,
    maxBuffer: Number(options.maxBuffer) || DEFAULT_MAX_BYTES * 2,
    windowsHide: true,
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function assertFileSize(filePath, maxBytes = DEFAULT_MAX_BYTES) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw makeParserError('THUMBGATE_DOCUMENT_NOT_FILE', 'document path must be a file');
  if (stat.size > maxBytes) {
    throw makeParserError(
      'THUMBGATE_DOCUMENT_TOO_LARGE',
      `document is ${stat.size} bytes; maximum is ${maxBytes}`,
    );
  }
  return stat.size;
}

function parsePdfPageCount(output) {
  const match = String(output || '').match(/^Pages:\s+(\d+)/mi);
  return match ? Math.max(1, Number(match[1])) : 1;
}

function parseTesseractTsv(tsv) {
  const rows = String(tsv || '').split('\n').slice(1);
  const words = [];
  const confidences = [];
  let previousLine = null;
  for (const row of rows) {
    if (!row.trim()) continue;
    const columns = row.split('\t');
    if (columns.length < 12) continue;
    const lineKey = columns.slice(1, 5).join(':');
    const confidence = Number(columns[10]);
    const text = columns.slice(11).join('\t').trim();
    if (!text) continue;
    if (previousLine !== null && previousLine !== lineKey) words.push('\n');
    else if (words.length > 0 && words[words.length - 1] !== '\n') words.push(' ');
    words.push(text);
    previousLine = lineKey;
    if (Number.isFinite(confidence) && confidence >= 0) confidences.push(confidence);
  }
  return {
    text: words.join('').replaceAll(/[ \t]+\n/g, '\n').trim(),
    confidence: confidences.length
      ? Number((confidences.reduce((sum, value) => sum + value, 0) / confidences.length).toFixed(2))
      : null,
    wordCount: confidences.length,
  };
}

async function parseDocx(filePath) {
  let mammoth;
  try {
    mammoth = require('mammoth');
  } catch {
    throw makeParserError(
      'THUMBGATE_DOCX_PARSER_UNAVAILABLE',
      'DOCX parsing requires the installed mammoth dependency',
    );
  }
  const result = await mammoth.extractRawText({ path: filePath });
  return {
    content: result.value || '',
    diagnostics: {
      adapter: 'mammoth.extractRawText',
      warnings: (result.messages || []).length,
      ocrTriggered: false,
      ocrStatus: 'not_needed',
    },
  };
}

async function runOcrOnImage(filePath, options = {}) {
  const resolve = options.resolveExecutable || resolveExecutable;
  const execute = options.runCommand || runCommand;
  const tesseract = resolve('tesseract', options.env);
  if (!tesseract) {
    throw makeParserError(
      'THUMBGATE_OCR_UNAVAILABLE',
      'OCR was required but the tesseract executable is unavailable',
    );
  }
  const language = String(options.ocrLanguage || 'eng').replaceAll(/[^a-z0-9_+-]/gi, '');
  const { stdout } = await execute(
    tesseract,
    [filePath, 'stdout', '-l', language || 'eng', '--psm', '6', 'tsv'],
    {
      timeoutMs: Number(options.ocrTimeoutMs) || DEFAULT_OCR_TIMEOUT_MS,
      maxBuffer: DEFAULT_MAX_BYTES * 2,
    },
  );
  return parseTesseractTsv(stdout);
}

function listRenderedPages(tempDir, prefix) {
  return fs.readdirSync(tempDir)
    .filter((name) => name.startsWith(`${prefix}-`) && name.endsWith('.png'))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .map((name) => path.join(tempDir, name));
}

async function ocrPdf(filePath, pageCount, options = {}) {
  const resolve = options.resolveExecutable || resolveExecutable;
  const execute = options.runCommand || runCommand;
  const pdftoppm = resolve('pdftoppm', options.env);
  if (!pdftoppm) {
    throw makeParserError(
      'THUMBGATE_PDF_OCR_RENDERER_UNAVAILABLE',
      'Scanned PDF OCR requires the pdftoppm executable',
    );
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-pdf-ocr-'));
  const prefixName = 'page';
  const outputPrefix = path.join(tempDir, prefixName);
  try {
    const maxPages = Math.min(pageCount, Number(options.maxPages) || DEFAULT_MAX_PAGES);
    await execute(
      pdftoppm,
      ['-png', '-r', '200', '-f', '1', '-l', String(maxPages), filePath, outputPrefix],
      {
        timeoutMs: Number(options.ocrTimeoutMs) || DEFAULT_OCR_TIMEOUT_MS,
        maxBuffer: DEFAULT_MAX_BYTES,
      },
    );
    const pages = listRenderedPages(tempDir, prefixName);
    if (pages.length === 0) {
      throw makeParserError('THUMBGATE_PDF_OCR_RENDER_FAILED', 'PDF renderer produced no page images');
    }
    const outputs = [];
    for (const page of pages) outputs.push(await runOcrOnImage(page, options));
    const confidences = outputs.map((entry) => entry.confidence).filter(Number.isFinite);
    return {
      text: outputs.map((entry, index) => `## Page ${index + 1}\n\n${entry.text}`).join('\n\n'),
      confidence: confidences.length
        ? Number((confidences.reduce((sum, value) => sum + value, 0) / confidences.length).toFixed(2))
        : null,
      pages: outputs.length,
      wordCount: outputs.reduce((sum, entry) => sum + entry.wordCount, 0),
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function parsePdf(filePath, options = {}) {
  const resolve = options.resolveExecutable || resolveExecutable;
  const execute = options.runCommand || runCommand;
  const pdftotext = resolve('pdftotext', options.env);
  const pdfinfo = resolve('pdfinfo', options.env);
  if (!pdftotext || !pdfinfo) {
    throw makeParserError(
      'THUMBGATE_PDF_PARSER_UNAVAILABLE',
      'PDF parsing requires the pdftotext and pdfinfo executables',
    );
  }
  const [info, extracted] = await Promise.all([
    execute(pdfinfo, [filePath], { timeoutMs: options.commandTimeoutMs }),
    execute(pdftotext, ['-layout', '-enc', 'UTF-8', filePath, '-'], {
      timeoutMs: options.commandTimeoutMs,
      maxBuffer: DEFAULT_MAX_BYTES * 2,
    }),
  ]);
  const pageCount = parsePdfPageCount(info.stdout);
  if (pageCount > (Number(options.maxPages) || DEFAULT_MAX_PAGES)) {
    throw makeParserError(
      'THUMBGATE_PDF_PAGE_LIMIT',
      `PDF has ${pageCount} pages; maximum is ${Number(options.maxPages) || DEFAULT_MAX_PAGES}`,
    );
  }
  const embeddedText = String(extracted.stdout || '').trim();
  const textCharsPerPage = embeddedText.replaceAll(/\s/g, '').length / Math.max(pageCount, 1);
  const ocrNeeded = options.forceOcr === true || textCharsPerPage < MIN_TEXT_CHARS_PER_PAGE;
  if (!ocrNeeded) {
    return {
      content: embeddedText,
      diagnostics: {
        adapter: 'poppler.pdftotext',
        pageCount,
        textCharsPerPage: Number(textCharsPerPage.toFixed(2)),
        ocrTriggered: false,
        ocrStatus: 'not_needed',
        ocrConfidence: null,
      },
    };
  }
  const ocr = await ocrPdf(filePath, pageCount, options);
  if (!ocr.text.trim()) {
    throw makeParserError('THUMBGATE_OCR_EMPTY', 'OCR completed but returned no text');
  }
  return {
    content: ocr.text,
    diagnostics: {
      adapter: 'poppler.pdftoppm+tesseract',
      pageCount,
      textCharsPerPage: Number(textCharsPerPage.toFixed(2)),
      ocrTriggered: true,
      ocrStatus: 'success',
      ocrConfidence: ocr.confidence,
      ocrWordCount: ocr.wordCount,
    },
  };
}

async function parseImage(filePath, options = {}) {
  const ocr = await runOcrOnImage(filePath, options);
  if (!ocr.text.trim()) throw makeParserError('THUMBGATE_OCR_EMPTY', 'OCR returned no text');
  return {
    content: ocr.text,
    diagnostics: {
      adapter: 'tesseract',
      pageCount: 1,
      ocrTriggered: true,
      ocrStatus: 'success',
      ocrConfidence: ocr.confidence,
      ocrWordCount: ocr.wordCount,
    },
  };
}

async function parseDocumentFile(filePath, options = {}) {
  const resolvedPath = path.resolve(String(filePath || ''));
  const bytes = assertFileSize(resolvedPath, Number(options.maxBytes) || DEFAULT_MAX_BYTES);
  const extension = path.extname(resolvedPath).toLowerCase();
  let parsed;
  let sourceFormat;
  if (extension === '.pdf') {
    parsed = await parsePdf(resolvedPath, options);
    sourceFormat = 'pdf';
  } else if (extension === '.docx') {
    parsed = await parseDocx(resolvedPath, options);
    sourceFormat = 'docx';
  } else if (IMAGE_EXTENSIONS.has(extension)) {
    parsed = await parseImage(resolvedPath, options);
    sourceFormat = 'image';
  } else {
    return null;
  }
  return {
    content: parsed.content,
    sourceFormat,
    diagnostics: {
      parserAdapterVersion: PARSER_ADAPTER_VERSION,
      sourceBytes: bytes,
      ...parsed.diagnostics,
    },
  };
}

module.exports = {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_PAGES,
  IMAGE_EXTENSIONS,
  MIN_TEXT_CHARS_PER_PAGE,
  PARSER_ADAPTER_VERSION,
  parseDocumentFile,
  parsePdfPageCount,
  parseTesseractTsv,
  resolveExecutable,
  runCommand,
};
