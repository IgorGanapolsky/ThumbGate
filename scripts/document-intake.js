'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { getFeedbackPaths } = require('./feedback-loop');
const { loadGateTemplates } = require('./gate-templates');

const DOCUMENTS_DIRNAME = 'documents';
const DOCUMENT_CATALOG_FILENAME = 'catalog.jsonl';
const DOCUMENT_DEDUP_EVENTS_FILENAME = 'dedup-events.jsonl';
const DOCUMENT_FILE_SUFFIX = '.json';
const MAX_POLICY_PROPOSALS = 8;
const MAX_SEARCH_SCAN = 200;
const DOCUMENT_SCHEMA_VERSION = 2;
const PARSER_VERSION = 'thumbgate-parser-v2';
const CLEANER_VERSION = 'thumbgate-cleaner-v2';
const DEFAULT_CHUNK_MAX_CHARS = 1200;
const DEFAULT_CHUNK_OVERLAP_CHARS = 120;
const MIN_CHUNK_CHARS = 240;
const VALID_VISIBILITIES = new Set(['private', 'shared', 'public']);
const NEAR_DUPLICATE_THRESHOLD = 0.92;
const INSTRUCTION_RISK_PATTERNS = [
  /\bignore (?:all |any )?(?:previous|prior|system|developer) instructions?\b/i,
  /\breveal (?:the )?(?:system|developer) prompt\b/i,
  /\byou are now\b/i,
  /\bjailbreak\b/i,
  /\bdo not follow (?:the )?(?:system|developer|user) instructions?\b/i,
];

const TEXT_FORMAT_ALIASES = {
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.txt': 'text',
  '.text': 'text',
  '.rst': 'text',
  '.adoc': 'text',
  '.csv': 'text',
  '.log': 'text',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.json': 'json',
  '.html': 'html',
  '.htm': 'html',
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.tif': 'image',
  '.tiff': 'image',
  '.bmp': 'image',
  '.webp': 'image',
};

const POLICY_LINE_PATTERNS = [
  /\bmust\b/i,
  /\bmust\s+not\b/i,
  /\bshould\b/i,
  /\bshould\s+not\b/i,
  /\bdo not\b/i,
  /\bdon't\b/i,
  /\bnever\b/i,
  /\balways\b/i,
  /\brequired?\b/i,
  /\bforbid(?:den)?\b/i,
  /\bonly\b/i,
  /\bblock(?:ed)?\b/i,
  /\bdeny\b/i,
  /\bapproved?\b/i,
  /\bverify\b/i,
  /\bverification\b/i,
  /\bproof\b/i,
];
const HIGH_SEVERITY_PATTERNS = [
  /\bproduction\b/i,
  /\bprod\b/i,
  /\bmain\b/i,
  /\bmaster\b/i,
  /\bforce(?:\s|-)?push\b/i,
  /\bdrop\b/i,
  /\btruncate\b/i,
  /\bdelete\b/i,
  /\bsecret\b/i,
  /\btoken\b/i,
  /\bcredential\b/i,
  /\bapi[_ -]?key\b/i,
  /\bpublish\b/i,
  /\brelease\b/i,
];
const MEDIUM_SEVERITY_PATTERNS = [
  /\btests?\b/i,
  /\bverify\b/i,
  /\bverification\b/i,
  /\bproof\b/i,
  /\breview\b/i,
  /\bci\b/i,
  /\blint\b/i,
  /\bbranch\b/i,
  /\bworkflow\b/i,
  /\bdeploy\b/i,
];
const BLOCK_ACTION_PATTERNS = [
  /\bnever\b/i,
  /\bmust not\b/i,
  /\bdo not\b/i,
  /\bdon't\b/i,
  /\bforbid(?:den)?\b/i,
  /\bblock(?:ed)?\b/i,
  /\bdeny\b/i,
];
const WARN_ACTION_PATTERNS = [
  /\balways\b/i,
  /\brequired?\b/i,
  /\bverify\b/i,
  /\bverification\b/i,
  /\bproof\b/i,
  /\breview\b/i,
];

const TEMPLATE_HINTS = {
  'never-force-push-main': [
    /force(?:\s|-)?push/i,
    /git\s+push\s+(?:--force|-f)/i,
    /protected branch/i,
  ],
  'never-skip-tests-before-commit': [
    /skip\s+tests?/i,
    /before\s+commit/i,
    /run\s+(?:the\s+)?tests?/i,
    /\bci\b/i,
    /\blint\b/i,
  ],
  'evidence-before-done': [
    /\b(?:evidence|proof)\b/i,
    /\bverified?\b/i,
    /\bdone\b/i,
    /claim(?:ing)?\s+success/i,
  ],
  'protect-production-sql': [
    /\b(?:drop|truncate|delete)\b/i,
    /\b(?:production|prod)\b/i,
    /\b(?:sql|database|db|table|tables)\b/i,
  ],
  'back-up-env-before-edit': [
    /\.env\b/i,
    /\b(?:backup|back up|copy)\b/i,
    /\b(?:secret|token|credential)\b/i,
  ],
  'promote-known-good-workflows': [
    /\bknown[-\s]?good\b/i,
    /\brecommended workflow\b/i,
    /\bgolden path\b/i,
    /\bbest practice(?:s)?\b/i,
  ],
};

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function writeJsonl(filePath, records) {
  ensureDir(path.dirname(filePath));
  const body = records.map((record) => JSON.stringify(record)).join('\n');
  fs.writeFileSync(filePath, body ? `${body}\n` : '', 'utf8');
}

function normalizeText(value) {
  const withoutBom = String(value || '').split('\uFEFF').join('');
  const withoutZeroWidth = withoutBom.replaceAll(/[\u200B-\u200D\u2060]/g, '');
  const withoutUnsafeControls = stripUnsafeControls(withoutZeroWidth);
  const normalizedNewlines = normalizeNewlines(withoutUnsafeControls);
  const trimmedLines = normalizedNewlines
    .split('\n')
    .map(trimTrailingSpacesAndTabs)
    .join('\n');
  return collapseBlankLines(trimmedLines).trim();
}

function stripUnsafeControls(value) {
  let output = '';
  for (const char of String(value || '')) {
    const code = char.charCodeAt(0);
    const allowedWhitespace = char === '\n' || char === '\r' || char === '\t';
    if ((code < 32 || code === 127) && !allowedWhitespace) continue;
    output += char;
  }
  return output;
}

function safeArray(values) {
  return Array.isArray(values) ? values : [];
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return Array.from(new Set(tags
    .map((tag) => String(tag || '').trim())
    .filter(Boolean)));
}

function normalizeNewlines(value) {
  let result = '';
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char !== '\r') {
      result += char;
      continue;
    }
    result += '\n';
    if (text[index + 1] === '\n') {
      index += 1;
    }
  }
  return result;
}

function trimTrailingSpacesAndTabs(value) {
  const text = String(value || '');
  let end = text.length;
  while (end > 0 && (text[end - 1] === ' ' || text[end - 1] === '\t')) {
    end -= 1;
  }
  return text.slice(0, end);
}

function collapseBlankLines(value) {
  const compacted = [];
  let blankCount = 0;
  for (const line of String(value || '').split('\n')) {
    if (line === '') {
      blankCount += 1;
      if (blankCount <= 2) compacted.push(line);
      continue;
    }
    blankCount = 0;
    compacted.push(line);
  }
  return compacted.join('\n');
}

function slugify(value) {
  const output = [];
  let previousWasDash = false;
  for (const char of String(value || '').toLowerCase()) {
    const code = char.charCodeAt(0);
    const isAlphanumeric = (code >= 97 && code <= 122) || (code >= 48 && code <= 57);
    if (isAlphanumeric) {
      output.push(char);
      previousWasDash = false;
      continue;
    }
    if (!previousWasDash && output.length > 0) {
      output.push('-');
      previousWasDash = true;
    }
  }
  if (output[output.length - 1] === '-') {
    output.pop();
  }
  return output.join('');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function matchesAnyPattern(value, patterns) {
  return patterns.some((pattern) => pattern.test(value));
}

function decodeHtmlEntities(text) {
  const entityMap = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
  };

  return String(text || '').replaceAll(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (match) => entityMap[match] || match);
}

function stripElementBlocks(html, tagName) {
  let remaining = String(html || '');
  let lower = remaining.toLowerCase();
  const openToken = `<${tagName}`;
  const closeToken = `</${tagName}`;
  let result = '';

  while (remaining) {
    const openIndex = lower.indexOf(openToken);
    if (openIndex === -1) {
      result += remaining;
      break;
    }

    result += remaining.slice(0, openIndex);
    const closeIndex = lower.indexOf(closeToken, openIndex + openToken.length);
    if (closeIndex === -1) break;

    const closeEnd = remaining.indexOf('>', closeIndex + closeToken.length);
    if (closeEnd === -1) break;

    remaining = remaining.slice(closeEnd + 1);
    lower = remaining.toLowerCase();
  }

  return result;
}

function stripHtmlComments(html) {
  let remaining = String(html || '');
  let result = '';

  while (remaining) {
    const start = remaining.indexOf('<!--');
    if (start === -1) {
      result += remaining;
      break;
    }

    result += remaining.slice(0, start);
    const end = remaining.indexOf('-->', start + 4);
    if (end === -1) break;
    remaining = remaining.slice(end + 3);
  }

  return result;
}

function getTagName(tagContent) {
  const trimmed = String(tagContent || '').trim();
  let start = 0;
  if (trimmed[start] === '/') start += 1;

  let end = start;
  while (end < trimmed.length) {
    const char = trimmed[end];
    const code = char.charCodeAt(0);
    const isNameChar = (code >= 97 && code <= 122)
      || (code >= 65 && code <= 90)
      || (code >= 48 && code <= 57)
      || char === '-';
    if (!isNameChar) break;
    end += 1;
  }

  return trimmed.slice(start, end).toLowerCase();
}

function htmlToText(html) {
  const blockTags = new Set([
    'p', 'div', 'section', 'article', 'header', 'footer', 'aside', 'main',
    'li', 'tr', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br',
  ]);
  const withoutScripts = stripElementBlocks(html, 'script');
  const withoutStyles = stripElementBlocks(withoutScripts, 'style');
  const text = stripHtmlComments(withoutStyles);
  let result = '';
  let cursor = 0;

  while (cursor < text.length) {
    const tagStart = text.indexOf('<', cursor);
    if (tagStart === -1) {
      result += text.slice(cursor);
      break;
    }

    result += text.slice(cursor, tagStart);
    const tagEnd = text.indexOf('>', tagStart + 1);
    if (tagEnd === -1) {
      result += ' ';
      break;
    }

    const tagName = getTagName(text.slice(tagStart + 1, tagEnd));
    result += blockTags.has(tagName) ? '\n' : ' ';
    cursor = tagEnd + 1;
  }

  return result;
}

/**
 * Strip HTML tags and dangerous content from a string.
 * This function is used for text extraction only — output is never rendered as HTML.
 * Defense-in-depth: strips scripts, styles, event handlers, and all remaining tags.
 */
function stripHtml(html) {
  return normalizeText(decodeHtmlEntities(htmlToText(html)));
}

function inferSourceFormat(filePath, explicitFormat) {
  if (explicitFormat) {
    return String(explicitFormat).trim().toLowerCase();
  }

  const ext = path.extname(String(filePath || '')).toLowerCase();
  return TEXT_FORMAT_ALIASES[ext] || null;
}

function normalizeDocumentBody(rawContent, sourceFormat) {
  const normalizedFormat = String(sourceFormat || '').trim().toLowerCase();
  const rawText = String(rawContent || '');
  if (!rawText.trim()) {
    throw new Error('document content is empty');
  }

  if (normalizedFormat === 'html') {
    return stripHtml(rawText);
  }

  if (normalizedFormat === 'json') {
    try {
      const parsed = JSON.parse(rawText);
      return normalizeText(JSON.stringify(parsed, null, 2));
    } catch {
      return normalizeText(rawText);
    }
  }

  if (['markdown', 'text', 'yaml', 'pdf', 'docx', 'image'].includes(normalizedFormat)) {
    return normalizeText(rawText);
  }

  throw new Error(`Unsupported document format: ${normalizedFormat || 'unknown'}`);
}

function detectInstructionRisk(content) {
  const matchedPatterns = INSTRUCTION_RISK_PATTERNS
    .map((pattern, index) => (pattern.test(content) ? `instruction_pattern_${index + 1}` : null))
    .filter(Boolean);
  return {
    detected: matchedPatterns.length > 0,
    matchedPatterns,
  };
}

function cleanDocumentBody(rawContent, sourceFormat) {
  const normalized = normalizeDocumentBody(rawContent, sourceFormat);
  const instructionRisk = detectInstructionRisk(normalized);
  return {
    content: normalized,
    diagnostics: {
      cleanerVersion: CLEANER_VERSION,
      originalBytes: Buffer.byteLength(String(rawContent || ''), 'utf8'),
      cleanedBytes: Buffer.byteLength(normalized, 'utf8'),
      emptyAfterCleaning: normalized.length === 0,
      instructionRisk,
    },
  };
}

function extractMarkdownTitle(normalizedContent) {
  for (const line of String(normalizedContent || '').split('\n')) {
    if (!line.startsWith('# ')) continue;
    const title = line.slice(2).trim();
    if (title) return title;
  }
  return null;
}

function extractHtmlTitle(rawContent) {
  const html = String(rawContent || '');
  const lower = html.toLowerCase();
  const openStart = lower.indexOf('<title');
  if (openStart === -1) return null;
  const openEnd = html.indexOf('>', openStart + 6);
  if (openEnd === -1) return null;
  const closeStart = lower.indexOf('</title', openEnd + 1);
  if (closeStart === -1) return null;
  const title = decodeHtmlEntities(html.slice(openEnd + 1, closeStart)).trim();
  return title || null;
}

function extractJsonTitle(rawContent) {
  try {
    const parsed = JSON.parse(String(rawContent || ''));
    if (!parsed || typeof parsed !== 'object') return null;
    for (const key of ['title', 'name', 'policy', 'document']) {
      const value = parsed[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
  } catch {
    return null;
  }
  return null;
}

function extractFallbackTitle(filePath) {
  return filePath
    ? path.basename(filePath, path.extname(filePath))
    : 'Imported document';
}

function extractFormatTitle(sourceFormat, rawContent) {
  if (sourceFormat === 'html') {
    return extractHtmlTitle(rawContent);
  }
  if (sourceFormat === 'json') {
    return extractJsonTitle(rawContent);
  }
  return null;
}

function extractTitle({ explicitTitle, filePath, rawContent, normalizedContent, sourceFormat }) {
  const provided = String(explicitTitle || '').trim();
  if (provided) return provided;

  return extractMarkdownTitle(normalizedContent)
    || extractFormatTitle(sourceFormat, rawContent)
    || extractFallbackTitle(filePath);
}

function extractHeadings(content) {
  return String(content || '')
    .split('\n')
    .map(extractMarkdownHeading)
    .filter(Boolean)
    .slice(0, 12);
}

function extractMarkdownHeading(line) {
  const text = String(line || '');
  let level = 0;
  while (level < text.length && text[level] === '#' && level < 6) {
    level += 1;
  }
  if (level === 0 || text[level] !== ' ') return null;
  const heading = text.slice(level + 1).trim();
  return heading || null;
}

function parseMarkdownHeading(line) {
  const text = String(line || '');
  let level = 0;
  while (level < text.length && text[level] === '#' && level < 6) level += 1;
  if (level === 0 || text[level] !== ' ') return null;
  const title = text.slice(level + 1).trim();
  return title ? { level, title } : null;
}

function buildExcerpt(content, maxLength = 280) {
  const compact = String(content || '').replaceAll(/\s+/g, ' ').trim();
  if (!compact) return '';
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1)}\u2026`;
}

function normalizeScopeValue(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function buildDocumentScope(options = {}) {
  const visibility = String(options.visibility || 'private').trim().toLowerCase();
  if (!VALID_VISIBILITIES.has(visibility)) {
    throw new Error(`visibility must be one of: ${[...VALID_VISIBILITIES].join(', ')}`);
  }
  return {
    tenantId: normalizeScopeValue(options.tenantId) || 'local',
    projectId: normalizeScopeValue(options.projectId),
    entityId: normalizeScopeValue(options.entityId),
    visibility,
  };
}

function inferLanguage(content, explicitLanguage) {
  const provided = normalizeScopeValue(explicitLanguage);
  if (provided) return provided.toLowerCase();
  const letters = String(content || '').match(/\p{L}/gu) || [];
  if (letters.length === 0) return 'und';
  const asciiLetters = letters.filter((char) => /[a-z]/i.test(char)).length;
  return asciiLetters / letters.length >= 0.9 ? 'en' : 'und';
}

function extractEntities(content) {
  const text = String(content || '');
  const urls = Array.from(new Set(text.match(/https?:\/\/[^\s<>"')\]]+/g) || [])).slice(0, 20);
  const identifiers = Array.from(new Set(
    text.match(/\b(?:PR\s*#?\d+|[A-Z][A-Z0-9_]{2,}|[a-z][a-z0-9_-]*\.[a-z0-9_.-]+)\b/g) || [],
  )).slice(0, 30);
  return { urls, identifiers };
}

function buildTokenShingles(content, size = 5) {
  const words = String(content || '').toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || [];
  if (words.length < size) return new Set(words.length ? [words.join(' ')] : []);
  const shingles = new Set();
  for (let index = 0; index <= words.length - size; index += 1) {
    shingles.add(words.slice(index, index + size).join(' '));
    if (shingles.size >= 5000) break;
  }
  return shingles;
}

function computeNearDuplicateSimilarity(left, right) {
  const leftShingles = buildTokenShingles(left);
  const rightShingles = buildTokenShingles(right);
  if (leftShingles.size === 0 || rightShingles.size === 0) return 0;
  let intersection = 0;
  for (const shingle of leftShingles) {
    if (rightShingles.has(shingle)) intersection += 1;
  }
  const union = leftShingles.size + rightShingles.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function findDuplicateDocument(content, contentFingerprint, sourceKey, scope, options = {}) {
  const summaries = listImportedDocuments({
    ...options,
    includeStale: false,
    tenantId: scope.tenantId,
    limit: MAX_SEARCH_SCAN,
  }).documents;
  for (const summary of summaries) {
    if (summary.contentFingerprint === contentFingerprint) {
      return {
        kind: 'exact',
        similarity: 1,
        sameSource: summary.sourceKey === sourceKey,
        document: readImportedDocument(summary.documentId, options),
      };
    }
  }
  for (const summary of summaries) {
    if (summary.sourceKey === sourceKey) continue;
    const existing = readImportedDocument(summary.documentId, options);
    if (!existing) continue;
    const similarity = computeNearDuplicateSimilarity(content, existing.content);
    if (similarity >= (Number(options.nearDuplicateThreshold) || NEAR_DUPLICATE_THRESHOLD)) {
      return {
        kind: 'near',
        similarity,
        sameSource: false,
        document: existing,
      };
    }
  }
  return null;
}

function recordDedupEvent(event, options = {}) {
  const paths = getDocumentStorePaths(options);
  ensureDir(paths.documentsDir);
  fs.appendFileSync(
    path.join(paths.documentsDir, DOCUMENT_DEDUP_EVENTS_FILENAME),
    `${JSON.stringify(event)}\n`,
    'utf8',
  );
}

function scanLines(content) {
  const lines = [];
  let offset = 0;
  const text = String(content || '');
  while (offset < text.length) {
    const newline = text.indexOf('\n', offset);
    const endOffset = newline === -1 ? text.length : newline + 1;
    lines.push({
      text: text.slice(offset, newline === -1 ? text.length : newline),
      startOffset: offset,
      endOffset,
    });
    offset = endOffset;
  }
  if (text.length === 0) return [];
  return lines;
}

function trimRange(content, startOffset, endOffset) {
  let start = startOffset;
  let end = endOffset;
  while (start < end && /\s/.test(content[start])) start += 1;
  while (end > start && /\s/.test(content[end - 1])) end -= 1;
  return { startOffset: start, endOffset: end, content: content.slice(start, end) };
}

function buildDocumentSections(content, sourceIdentity, documentTitle) {
  const sections = [];
  const headingStack = [];
  let currentStart = 0;
  let currentPath = [];

  function closeSection(endOffset) {
    const range = trimRange(content, currentStart, endOffset);
    if (!range.content) return;
    const index = sections.length;
    sections.push({
      sectionId: `section_${sourceIdentity.slice(0, 12)}_${String(index).padStart(4, '0')}`,
      title: currentPath[currentPath.length - 1] || documentTitle,
      headingPath: [...currentPath],
      startOffset: range.startOffset,
      endOffset: range.endOffset,
      content: range.content,
      contentHash: sha256(range.content),
    });
  }

  for (const line of scanLines(content)) {
    const heading = parseMarkdownHeading(line.text);
    if (!heading) continue;
    if (line.startOffset > currentStart) closeSection(line.startOffset);
    headingStack.length = heading.level - 1;
    headingStack[heading.level - 1] = heading.title;
    currentPath = headingStack.filter(Boolean);
    currentStart = line.startOffset;
  }
  closeSection(content.length);

  if (sections.length === 0 && content) {
    const range = trimRange(content, 0, content.length);
    sections.push({
      sectionId: `section_${sourceIdentity.slice(0, 12)}_0000`,
      title: documentTitle,
      headingPath: [],
      startOffset: range.startOffset,
      endOffset: range.endOffset,
      content: range.content,
      contentHash: sha256(range.content),
    });
  }
  return sections;
}

function findChunkBoundary(text, startOffset, idealEnd, minEnd) {
  const delimiters = ['\n\n', '\n', '. ', '; ', ' '];
  for (const delimiter of delimiters) {
    const index = text.lastIndexOf(delimiter, idealEnd);
    if (index >= minEnd && index >= startOffset) {
      return index + delimiter.length;
    }
  }
  return idealEnd;
}

function advancePastWhitespace(text, offset) {
  let cursor = offset;
  while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
  return cursor;
}

function chunkSection(section, options = {}) {
  const maxChars = Math.max(
    MIN_CHUNK_CHARS,
    Number(options.maxChars) || DEFAULT_CHUNK_MAX_CHARS,
  );
  const overlapChars = Math.max(
    0,
    Math.min(Number(options.overlapChars) || DEFAULT_CHUNK_OVERLAP_CHARS, Math.floor(maxChars / 3)),
  );
  const text = section.content;
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    const idealEnd = Math.min(start + maxChars, text.length);
    const minEnd = Math.min(start + Math.floor(maxChars * 0.6), idealEnd);
    const end = idealEnd === text.length
      ? text.length
      : findChunkBoundary(text, start, idealEnd, minEnd);
    const range = trimRange(text, start, end);
    if (range.content) {
      chunks.push({
        parentId: section.sectionId,
        headingPath: [...section.headingPath],
        startOffset: section.startOffset + range.startOffset,
        endOffset: section.startOffset + range.endOffset,
        content: range.content,
        contentHash: sha256(range.content),
        estimatedTokens: Math.ceil(range.content.length / 4),
      });
    }
    if (end >= text.length) break;
    const nextStart = Math.max(end - overlapChars, start + 1);
    start = advancePastWhitespace(text, nextStart);
  }
  return chunks;
}

function buildDocumentChunks(document, options = {}) {
  const sourceIdentity = document.sourceKey || document.fingerprint;
  const sections = buildDocumentSections(document.content, sourceIdentity, document.title);
  const chunks = sections.flatMap((section) => chunkSection(section, {
    maxChars: options.chunkMaxChars,
    overlapChars: options.chunkOverlapChars,
  }));
  const occurrences = new Map();
  return {
    sections,
    chunks: chunks.map((chunk, index) => {
      const occurrence = (occurrences.get(chunk.contentHash) || 0) + 1;
      occurrences.set(chunk.contentHash, occurrence);
      return {
      ...chunk,
      chunkId: `chunk_${sourceIdentity.slice(0, 12)}_${chunk.contentHash.slice(0, 16)}_${occurrence}`,
      chunkIndex: index,
      documentId: document.documentId,
      sourceKey: document.sourceKey,
      title: document.title,
      scope: document.scope,
      sourceFormat: document.sourceFormat,
      sourceUrl: document.sourceUrl,
      importedAt: document.importedAt,
      trustLevel: document.trustLevel,
      instructionRisk: document.instructionRisk,
      version: document.version,
      isCurrent: document.isCurrent,
      };
    }),
  };
}

function normalizePolicyLine(line) {
  return String(line || '')
    .replaceAll(/^#{1,6}\s+/g, '')
    .replaceAll(/^[-*+]\s+/g, '')
    .replaceAll(/^\d+\.\s+/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

function uniqueBy(items, selector) {
  const seen = new Set();
  const results = [];
  for (const item of items) {
    const key = selector(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    results.push(item);
  }
  return results;
}

function extractPolicyStatements(content) {
  const lines = String(content || '')
    .split('\n')
    .map(normalizePolicyLine)
    .filter(Boolean)
    .filter((line) => line.length >= 18 && line.length <= 220)
    .filter((line) => matchesAnyPattern(line, POLICY_LINE_PATTERNS));

  return uniqueBy(lines, (line) => line.toLowerCase()).slice(0, MAX_POLICY_PROPOSALS * 2);
}

function inferProposalSeverity(statement) {
  if (matchesAnyPattern(statement, HIGH_SEVERITY_PATTERNS)) return 'critical';
  if (matchesAnyPattern(statement, MEDIUM_SEVERITY_PATTERNS)) return 'high';
  return 'medium';
}

function inferProposalAction(statement) {
  if (matchesAnyPattern(statement, BLOCK_ACTION_PATTERNS)) {
    return 'block';
  }
  if (matchesAnyPattern(statement, WARN_ACTION_PATTERNS)) {
    return 'warn';
  }
  return 'warn';
}

function tokenize(value) {
  return Array.from(new Set(
    String(value || '')
      .toLowerCase()
      .match(/[a-z0-9_.-]{3,}/g) || []
  ));
}

function countMatches(text, token) {
  const haystack = String(text || '').toLowerCase();
  if (!token || !haystack) return 0;

  let count = 0;
  let cursor = 0;
  while (count < 5) {
    const index = haystack.indexOf(token, cursor);
    if (index === -1) break;
    count += 1;
    cursor = index + token.length;
  }
  return count;
}

function scoreTemplateAgainstText(template, text) {
  const matchers = TEMPLATE_HINTS[template.id] || [];
  const hitCount = matchers.reduce((sum, matcher) => sum + (matcher.test(text) ? 1 : 0), 0);

  if (template.id === 'protect-production-sql') {
    return hitCount >= 2 ? hitCount : 0;
  }
  if (template.id === 'evidence-before-done') {
    return hitCount >= 2 ? hitCount : 0;
  }
  if (template.id === 'back-up-env-before-edit') {
    return hitCount >= 1 ? hitCount : 0;
  }
  return hitCount >= 1 ? hitCount : 0;
}

function findSupportingExcerpt(content, templateId) {
  const statements = extractPolicyStatements(content);
  const matchers = TEMPLATE_HINTS[templateId] || [];
  const statement = statements.find((line) => matchers.some((matcher) => matcher.test(line)));
  if (statement) return statement;
  return buildExcerpt(content, 220);
}

function buildTemplateProposal(document, template, score) {
  const evidence = findSupportingExcerpt(document.content, template.id);
  const proposalId = `proposal_${template.id}_${document.documentId.slice(-8)}`;
  return {
    proposalId,
    type: 'gate_template',
    status: 'proposed',
    title: template.name,
    templateId: template.id,
    sourceDocumentId: document.documentId,
    action: template.defaultAction,
    severity: template.severity,
    score,
    evidence,
    rationale: template.problem,
    roi: template.roi,
    rollout: template.rollout,
    readyToActivate: true,
    recommendedConfig: {
      id: `${template.id}-${document.documentId.slice(-8)}`,
      action: template.defaultAction,
      severity: template.severity,
      pattern: template.pattern,
      message: `Imported policy "${document.title}" recommends: ${template.name}.`,
    },
  };
}

function buildPolicyProposal(document, statement) {
  const proposalInput = `${document.documentId}:${statement}`;
  const proposalId = `proposal_${sha256(proposalInput).slice(0, 12)}`;
  const severity = inferProposalSeverity(statement);
  const action = inferProposalAction(statement);
  return {
    proposalId,
    type: 'policy_statement',
    status: 'proposed',
    title: statement.length > 96 ? `${statement.slice(0, 95)}\u2026` : statement,
    templateId: null,
    sourceDocumentId: document.documentId,
    action,
    severity,
    score: 1,
    evidence: statement,
    rationale: `Imported from policy document "${document.title}"`,
    roi: 'Converts human policy language into a reviewable ThumbGate gate candidate.',
    rollout: 'Review and tailor the command pattern before activation.',
    readyToActivate: false,
    recommendedConfig: {
      action,
      severity,
      message: statement,
      reviewRequired: true,
    },
  };
}

function proposeGatesFromDocument(document, options = {}) {
  const maxProposals = Number.isFinite(Number(options.maxProposals))
    ? Math.max(1, Math.min(12, Number(options.maxProposals)))
    : MAX_POLICY_PROPOSALS;
  const templates = safeArray(loadGateTemplates().templates);
  const templateProposals = templates
    .map((template) => ({
      template,
      score: scoreTemplateAgainstText(template, document.content),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((entry) => buildTemplateProposal(document, entry.template, entry.score));

  const consumedStatements = new Set(templateProposals.map((proposal) => proposal.evidence.toLowerCase()));
  const policyProposals = extractPolicyStatements(document.content)
    .filter((statement) => !consumedStatements.has(statement.toLowerCase()))
    .map((statement) => buildPolicyProposal(document, statement));

  return uniqueBy([
    ...templateProposals,
    ...policyProposals,
  ], (proposal) => proposal.proposalId).slice(0, maxProposals);
}

function getDocumentStorePaths(options = {}) {
  const feedbackDir = options.feedbackDir || getFeedbackPaths().FEEDBACK_DIR;
  const documentsDir = path.join(feedbackDir, DOCUMENTS_DIRNAME);
  return {
    feedbackDir,
    documentsDir,
    catalogPath: path.join(documentsDir, DOCUMENT_CATALOG_FILENAME),
    dedupEventsPath: path.join(documentsDir, DOCUMENT_DEDUP_EVENTS_FILENAME),
  };
}

function getDocumentPath(documentId, options = {}) {
  const { documentsDir } = getDocumentStorePaths(options);
  return path.join(documentsDir, `${documentId}${DOCUMENT_FILE_SUFFIX}`);
}

function buildDocumentSummary(document) {
  return {
    schemaVersion: document.schemaVersion || 1,
    documentId: document.documentId,
    title: document.title,
    sourceType: document.sourceType,
    sourcePath: document.sourcePath || null,
    sourceName: document.sourceName || null,
    sourceFormat: document.sourceFormat,
    importedAt: document.importedAt,
    tags: normalizeTags(document.tags),
    excerpt: document.excerpt,
    lineCount: document.lineCount,
    headingCount: safeArray(document.headings).length,
    proposalCount: safeArray(document.proposals).length,
    matchedTemplateIds: safeArray(document.matchedTemplateIds),
    fingerprint: document.fingerprint,
    contentFingerprint: document.contentFingerprint || null,
    sourceKey: document.sourceKey || null,
    version: document.version || 1,
    isCurrent: document.isCurrent !== false,
    supersedesDocumentId: document.supersedesDocumentId || null,
    supersededByDocumentId: document.supersededByDocumentId || null,
    scope: document.scope || buildDocumentScope(),
    trustLevel: document.trustLevel || 'untrusted',
    instructionRisk: document.instructionRisk || { detected: false, matchedPatterns: [] },
    parserVersion: document.parser && document.parser.version,
    chunkCount: safeArray(document.chunks).length,
    sectionCount: safeArray(document.sections).length,
    deduplication: document.deduplication || { status: 'unique' },
    indexing: document.indexing || { status: 'not_attempted' },
  };
}

function readImportedDocument(documentId, options = {}) {
  const filePath = getDocumentPath(String(documentId || '').trim(), options);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function listImportedDocuments(options = {}) {
  const limit = Number.isFinite(Number(options.limit))
    ? Math.max(1, Math.min(MAX_SEARCH_SCAN, Number(options.limit)))
    : 20;
  const query = String(options.query || '').trim().toLowerCase();
  const requestedTag = String(options.tag || '').trim().toLowerCase();
  const { catalogPath } = getDocumentStorePaths(options);
  const documents = readJsonl(catalogPath);

  const includeStale = options.includeStale === true;
  const requestedTenantId = normalizeScopeValue(options.tenantId);
  const requestedProjectId = normalizeScopeValue(options.projectId);
  const requestedVisibility = normalizeScopeValue(options.visibility);
  const filtered = documents.filter((document) => {
    if (!includeStale && document.isCurrent === false) return false;
    const scope = document.scope || {};
    if (requestedTenantId && scope.tenantId !== requestedTenantId) return false;
    if (requestedProjectId && scope.projectId !== requestedProjectId) return false;
    if (requestedVisibility && scope.visibility !== requestedVisibility) return false;
    const tags = safeArray(document.tags).map((tag) => String(tag).toLowerCase());
    const matchedTemplateIds = safeArray(document.matchedTemplateIds).map((tag) => String(tag).toLowerCase());
    if (requestedTag && !tags.includes(requestedTag) && !matchedTemplateIds.includes(requestedTag)) {
      return false;
    }
    if (!query) return true;
    const haystack = [
      document.title,
      document.excerpt,
      tags.join(' '),
      matchedTemplateIds.join(' '),
    ].join(' ').toLowerCase();
    return haystack.includes(query);
  });

  return {
    total: filtered.length,
    returned: filtered.slice(0, limit).length,
    documents: filtered.slice(0, limit),
  };
}

function persistDocument(document, options = {}) {
  const paths = getDocumentStorePaths(options);
  ensureDir(paths.documentsDir);
  writeJson(getDocumentPath(document.documentId, options), document);
  const summaries = readJsonl(paths.catalogPath)
    .filter((entry) => entry.documentId !== document.documentId)
    .map((entry) => {
      if (!document.sourceKey || entry.sourceKey !== document.sourceKey) return entry;
      const staleDocument = readImportedDocument(entry.documentId, options);
      if (staleDocument) {
        writeJson(getDocumentPath(entry.documentId, options), {
          ...staleDocument,
          isCurrent: false,
          supersededByDocumentId: document.documentId,
        });
      }
      return {
        ...entry,
        isCurrent: false,
        supersededByDocumentId: document.documentId,
      };
    });
  const nextSummaries = [
    buildDocumentSummary(document),
    ...summaries,
  ].sort((left, right) => String(right.importedAt).localeCompare(String(left.importedAt)));
  writeJsonl(paths.catalogPath, nextSummaries);
  return document;
}

function upgradeLegacyDocument(document, options = {}) {
  if (!document || typeof document !== 'object') {
    throw new Error('document is required for legacy migration');
  }
  if (
    Number(document.schemaVersion) >= DOCUMENT_SCHEMA_VERSION
    && safeArray(document.chunks).length > 0
  ) {
    const migrated = document._legacyMigrated === true;
    if (migrated && options.persist === true) persistDocument(document, options);
    return { document, migrated };
  }

  const sourceFormat = String(document.sourceFormat || 'text').toLowerCase();
  const cleaned = cleanDocumentBody(document.content, sourceFormat);
  const content = cleaned.content;
  const title = String(document.title || document.sourceName || 'Imported document').trim();
  const sourceKey = document.sourceKey || sha256([
    document.sourceUrl || '',
    document.sourcePath || '',
    document.sourceName || '',
    title,
  ].join('\n'));
  const importedAt = document.importedAt || nowIso();
  const upgraded = {
    ...document,
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    title,
    sourceFormat,
    sourceKey,
    importedAt,
    fingerprint: document.fingerprint || sha256(`${title}\n${content}`),
    contentFingerprint: document.contentFingerprint || sha256(content),
    version: Math.max(1, Number(document.version) || 1),
    isCurrent: document.isCurrent !== false,
    scope: document.scope || buildDocumentScope(),
    trustLevel: document.trustLevel === 'trusted' ? 'trusted' : 'untrusted',
    instructionRisk: document.instructionRisk || cleaned.diagnostics.instructionRisk,
    language: document.language || inferLanguage(content),
    entities: document.entities || extractEntities(content),
    deduplication: document.deduplication || { status: 'unique' },
    indexing: document.indexing || { status: 'not_attempted' },
    parser: document.parser || {
      version: PARSER_VERSION,
      format: sourceFormat,
      parsedAt: importedAt,
      diagnostics: {
        migratedLegacyDocument: true,
        ...cleaned.diagnostics,
      },
    },
    excerpt: document.excerpt || buildExcerpt(content),
    content,
    contentBytes: Buffer.byteLength(content, 'utf8'),
    lineCount: content.split('\n').filter(Boolean).length,
    headings: safeArray(document.headings).length
      ? document.headings
      : extractHeadings(content),
    proposals: safeArray(document.proposals),
    matchedTemplateIds: safeArray(document.matchedTemplateIds),
    migration: {
      fromSchemaVersion: Number(document.schemaVersion) || 1,
      migratedAt: nowIso(),
      reason: 'reindex_legacy_document_backfill',
    },
  };
  const chunked = buildDocumentChunks(upgraded, options);
  upgraded.sections = chunked.sections;
  upgraded.chunks = chunked.chunks;
  Object.defineProperty(upgraded, '_legacyMigrated', {
    value: true,
    enumerable: false,
  });

  if (options.persist === true) persistDocument(upgraded, options);
  return { document: upgraded, migrated: true };
}

function scoreImportedDocument(document, tokens) {
  const title = String(document.title || '');
  const excerpt = String(document.excerpt || '');
  const content = String(document.content || '');
  const tags = safeArray(document.tags);
  const proposalsText = safeArray(document.proposals)
    .map((proposal) => [proposal.title, proposal.evidence, proposal.templateId].filter(Boolean).join(' '))
    .join(' ');

  let score = 0;
  const matchedTokens = [];
  for (const token of tokens) {
    let tokenScore = 0;
    tokenScore += Math.min(1, countMatches(title, token)) * 5;
    tokenScore += Math.min(2, countMatches(excerpt, token)) * 3;
    tokenScore += Math.min(3, countMatches(content, token)) * 1;
    tokenScore += Math.min(2, countMatches(proposalsText, token)) * 2;
    tokenScore += tags.some((tag) => String(tag).toLowerCase().includes(token)) ? 2 : 0;
    if (tokenScore > 0) {
      matchedTokens.push(token);
      score += tokenScore;
    }
  }

  const phrase = tokens.join(' ');
  if (phrase && title.toLowerCase().includes(phrase)) {
    score += 4;
  }
  if (phrase && excerpt.toLowerCase().includes(phrase)) {
    score += 2;
  }

  return {
    score,
    matchedTokens,
  };
}

function searchImportedDocuments(options = {}) {
  const query = String(options.query || '').trim();
  if (!query) {
    throw new Error('query is required');
  }

  const tokens = tokenize(query);
  const docs = listImportedDocuments({
    ...options,
    limit: MAX_SEARCH_SCAN,
    query: '',
  }).documents
    .map((summary) => readImportedDocument(summary.documentId, options))
    .filter(Boolean)
    .flatMap((document) => {
      const chunks = safeArray(document.chunks).length
        ? document.chunks
        : [{
          chunkId: `${document.documentId}_legacy`,
          parentId: null,
          content: document.content,
          headingPath: [],
          startOffset: 0,
          endOffset: String(document.content || '').length,
        }];
      return chunks.map((chunk) => {
        const parentSection = safeArray(document.sections)
          .find((section) => section.sectionId === chunk.parentId);
        const scored = scoreImportedDocument({
          ...document,
          content: chunk.content,
          excerpt: chunk.content,
        }, tokens);
        return {
          ...document,
          content: chunk.content,
          excerpt: buildExcerpt(chunk.content),
          chunkId: chunk.chunkId,
          parentId: chunk.parentId,
          headingPath: safeArray(chunk.headingPath),
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          parentContext: parentSection ? parentSection.content : chunk.content,
          _score: Number(scored.score.toFixed(4)),
          _matchedTokens: scored.matchedTokens,
        };
      });
    })
    .filter((document) => document._score > 0)
    .sort((left, right) => {
      if (right._score !== left._score) return right._score - left._score;
      return String(right.importedAt).localeCompare(String(left.importedAt));
    });

  const limit = Number.isFinite(Number(options.limit))
    ? Math.max(1, Math.min(50, Number(options.limit)))
    : 10;
  return docs.slice(0, limit);
}

function importDocument(options = {}) {
  const hasFilePath = Boolean(options.filePath);
  const hasContent = typeof options.content === 'string' && options.content.trim().length > 0;
  if (!hasFilePath && !hasContent) {
    throw new Error('filePath or content is required');
  }

  const sourcePath = hasFilePath ? path.resolve(String(options.filePath)) : null;
  if (sourcePath && !fs.existsSync(sourcePath)) {
    throw new Error(`Path does not exist: ${sourcePath}`);
  }

  const sourceFormat = inferSourceFormat(sourcePath, options.sourceFormat);
  if (['pdf', 'docx', 'image'].includes(sourceFormat) && options.preparsedBinary !== true) {
    throw new Error(`${sourceFormat.toUpperCase()} files require importDocumentAsync so the binary parser can run safely`);
  }
  const rawContent = hasContent
    ? String(options.content)
    : fs.readFileSync(sourcePath, 'utf8');
  if (!sourceFormat) {
    throw new Error('Unsupported document format. Supported formats: markdown, text, yaml, json, html.');
  }

  const cleaned = cleanDocumentBody(rawContent, sourceFormat);
  const normalizedContent = cleaned.content;
  if (!normalizedContent) {
    throw new Error('document content is empty after normalization');
  }

  const title = extractTitle({
    explicitTitle: options.title,
    filePath: sourcePath,
    rawContent,
    normalizedContent,
    sourceFormat,
  });
  const fingerprint = sha256(`${title}\n${normalizedContent}`);
  const importedAt = nowIso();
  const sourceName = sourcePath ? path.basename(sourcePath) : null;
  const documentId = `doc_${slugify(title || sourceName || 'document').slice(0, 24) || 'document'}_${fingerprint.slice(0, 12)}`;
  const sourceKey = sha256([
    options.sourceUrl ? String(options.sourceUrl).trim() : '',
    sourcePath || '',
    title,
  ].join('\n'));
  const scope = buildDocumentScope(options);
  const contentFingerprint = sha256(normalizedContent);
  const duplicate = findDuplicateDocument(
    normalizedContent,
    contentFingerprint,
    sourceKey,
    scope,
    options,
  );
  if (duplicate && duplicate.kind === 'exact' && duplicate.document) {
    const event = {
      timestamp: importedAt,
      status: 'exact_duplicate',
      duplicateOf: duplicate.document.documentId,
      sourceKey,
      tenantId: scope.tenantId,
      contentFingerprint,
    };
    recordDedupEvent(event, options);
    return {
      ...duplicate.document,
      deduplication: event,
      indexing: {
        ...(duplicate.document.indexing || {}),
        status: duplicate.document.indexing && duplicate.document.indexing.status || 'already_present',
        skippedDuplicate: true,
      },
    };
  }
  const previous = listImportedDocuments({
    ...options,
    includeStale: true,
    limit: MAX_SEARCH_SCAN,
  }).documents.find((entry) => entry.sourceKey === sourceKey && entry.documentId !== documentId);
  const trustLevel = options.trustLevel === 'trusted' ? 'trusted' : 'untrusted';
  const document = {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    documentId,
    title,
    sourceType: sourcePath ? 'file' : 'inline',
    sourcePath,
    sourceName,
    sourceFormat,
    sourceUrl: options.sourceUrl ? String(options.sourceUrl).trim() : null,
    sourceKey,
    importedAt,
    tags: normalizeTags(options.tags),
    fingerprint,
    contentFingerprint,
    version: Number.isFinite(Number(options.version))
      ? Math.max(1, Number(options.version))
      : Math.max(1, Number(previous && previous.version || 0) + 1),
    isCurrent: !(duplicate && duplicate.kind === 'near'),
    supersedesDocumentId: previous ? previous.documentId : null,
    scope,
    trustLevel,
    instructionRisk: cleaned.diagnostics.instructionRisk,
    author: normalizeScopeValue(options.author),
    publishedAt: normalizeScopeValue(options.publishedAt),
    language: inferLanguage(normalizedContent, options.language),
    entities: extractEntities(normalizedContent),
    deduplication: duplicate && duplicate.kind === 'near'
      ? {
        status: 'near_duplicate_review',
        duplicateOf: duplicate.document.documentId,
        similarity: Number(duplicate.similarity.toFixed(4)),
      }
      : { status: 'unique' },
    parser: {
      version: options.parserDiagnostics && options.parserDiagnostics.parserAdapterVersion
        || PARSER_VERSION,
      format: sourceFormat,
      parsedAt: importedAt,
      diagnostics: {
        ...cleaned.diagnostics,
        ...(options.parserDiagnostics || {}),
      },
    },
    excerpt: buildExcerpt(normalizedContent),
    content: normalizedContent,
    contentBytes: Buffer.byteLength(normalizedContent, 'utf8'),
    lineCount: normalizedContent.split('\n').filter(Boolean).length,
    headings: extractHeadings(normalizedContent),
  };
  const chunked = buildDocumentChunks(document, options);
  document.sections = chunked.sections;
  document.chunks = chunked.chunks;
  document.proposals = options.proposeGates === false
    ? []
    : proposeGatesFromDocument(document, options);
  document.matchedTemplateIds = document.proposals
    .map((proposal) => proposal.templateId)
    .filter(Boolean);

  persistDocument(document, options);
  if (document.deduplication.status === 'near_duplicate_review') {
    recordDedupEvent({
      timestamp: importedAt,
      documentId: document.documentId,
      sourceKey,
      tenantId: scope.tenantId,
      ...document.deduplication,
    }, options);
  }
  return document;
}

async function importDocumentAsync(options = {}) {
  const { RagRunTelemetry } = require('./rag-stage-contract');
  const telemetry = options.telemetry || new RagRunTelemetry({
    query: options.title || options.filePath || options.sourceUrl || 'document import',
    feedbackDir: options.feedbackDir,
    scope: buildDocumentScope(options),
  });
  telemetry.start('documents', {
    sourceType: options.filePath ? 'file' : 'inline',
  });
  let document;
  try {
    let preparedOptions = options;
    if (options.filePath) {
      const { parseDocumentFile } = require('./document-parser');
      const parsedBinary = await parseDocumentFile(options.filePath, options.parserOptions || options);
      if (parsedBinary) {
        preparedOptions = {
          ...options,
          content: parsedBinary.content,
          sourceFormat: parsedBinary.sourceFormat,
          parserDiagnostics: parsedBinary.diagnostics,
          preparsedBinary: true,
        };
      }
    }
    document = importDocument(preparedOptions);
    telemetry.success('documents', { acceptedDocuments: 1 });
    telemetry.start('parsing').success('parsing', {
      sourceFormat: document.sourceFormat,
      parsedBytes: document.contentBytes,
      parserVersion: document.parser.version,
    });
    telemetry.start('cleaning').success('cleaning', {
      cleanedBytes: document.parser.diagnostics.cleanedBytes,
      instructionRisk: document.instructionRisk.detected,
    });
    telemetry.start('chunking').success('chunking', {
      chunkCount: document.chunks.length,
      sectionCount: document.sections.length,
      maxChunkChars: document.chunks.reduce(
        (maximum, chunk) => Math.max(maximum, chunk.content.length),
        0,
      ),
    });
    telemetry.start('metadata_extraction').success('metadata_extraction', {
      tenantPresent: Boolean(document.scope.tenantId),
      provenanceCoverage: document.chunks.every((chunk) => (
        chunk.parentId && Number.isFinite(chunk.startOffset) && Number.isFinite(chunk.endOffset)
      )),
      deduplicationStatus: document.deduplication.status,
    });
  } catch (error) {
    telemetry.failure('documents', error);
    telemetry.finish({ acceptedDocuments: 0 });
    throw error;
  }

  if (document.deduplication.status === 'exact_duplicate') {
    telemetry.finish({ indexed: true, duplicate: 'exact' });
    return document;
  }
  if (document.deduplication.status === 'near_duplicate_review') {
    document.indexing = {
      status: 'quarantined',
      reason: 'near_duplicate_review',
      attemptedAt: nowIso(),
    };
    persistDocument(document, options);
    telemetry.finish({ indexed: false, duplicate: 'near' });
    return document;
  }

  telemetry.start('embeddings', { chunkCount: document.chunks.length });
  telemetry.start('vector_database', { chunkCount: document.chunks.length });
  try {
    const { indexDocument } = require('./vector-store');
    const indexResult = await indexDocument(document, {
      feedbackDir: options.feedbackDir,
      timeoutMs: options.vectorTimeoutMs,
    });
    document.indexing = {
      status: 'indexed',
      indexedAt: nowIso(),
      ...indexResult,
    };
    telemetry.success('embeddings', {
      embeddedCount: indexResult.indexed,
      fallbackCount: indexResult.fallbackCount,
    });
    telemetry.success('vector_database', {
      indexedCount: indexResult.indexed,
      tableCount: indexResult.tables.length,
    });
  } catch (error) {
    document.indexing = {
      status: 'pending_retry',
      attemptedAt: nowIso(),
      errorType: error && error.name || 'Error',
      errorFingerprint: sha256(error && error.message || error).slice(0, 16),
    };
    telemetry.failure('embeddings', error);
    telemetry.failure('vector_database', error);
    if (options.requireVectorIndex === true) {
      persistDocument(document, options);
      telemetry.finish({ indexed: false });
      throw error;
    }
  }
  persistDocument(document, options);
  telemetry.finish({
    indexed: document.indexing.status === 'indexed',
    chunkCount: document.chunks.length,
  });
  return document;
}

async function retryPendingDocumentIndexes(options = {}) {
  const pending = listImportedDocuments({
    ...options,
    includeStale: false,
    limit: MAX_SEARCH_SCAN,
  }).documents
    .map((summary) => readImportedDocument(summary.documentId, options))
    .filter((document) => document && document.indexing && document.indexing.status === 'pending_retry');
  const results = [];
  for (const document of pending) {
    try {
      const { indexDocument } = require('./vector-store');
      const indexed = await indexDocument(document, options);
      document.indexing = { status: 'indexed', indexedAt: nowIso(), ...indexed };
      persistDocument(document, options);
      results.push({ documentId: document.documentId, status: 'indexed', indexed: indexed.indexed });
    } catch (error) {
      results.push({
        documentId: document.documentId,
        status: 'pending_retry',
        errorFingerprint: sha256(error && error.message || error).slice(0, 16),
      });
    }
  }
  return {
    attempted: pending.length,
    indexed: results.filter((result) => result.status === 'indexed').length,
    pending: results.filter((result) => result.status !== 'indexed').length,
    results,
  };
}

module.exports = {
  CLEANER_VERSION,
  DEFAULT_CHUNK_MAX_CHARS,
  DEFAULT_CHUNK_OVERLAP_CHARS,
  DOCUMENT_SCHEMA_VERSION,
  DOCUMENTS_DIRNAME,
  DOCUMENT_CATALOG_FILENAME,
  DOCUMENT_DEDUP_EVENTS_FILENAME,
  PARSER_VERSION,
  buildDocumentChunks,
  buildDocumentScope,
  cleanDocumentBody,
  computeNearDuplicateSimilarity,
  detectInstructionRisk,
  getDocumentStorePaths,
  getDocumentPath,
  importDocument,
  importDocumentAsync,
  listImportedDocuments,
  normalizeDocumentBody,
  proposeGatesFromDocument,
  readImportedDocument,
  retryPendingDocumentIndexes,
  searchImportedDocuments,
  upgradeLegacyDocument,
};
