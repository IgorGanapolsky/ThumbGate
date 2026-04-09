'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { getFeedbackPaths } = require('./feedback-loop');
const { loadGateTemplates } = require('./gate-templates');

const DOCUMENTS_DIRNAME = 'documents';
const DOCUMENT_CATALOG_FILENAME = 'catalog.jsonl';
const DOCUMENT_FILE_SUFFIX = '.json';
const MAX_POLICY_PROPOSALS = 8;
const MAX_SEARCH_SCAN = 200;

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
};

const POLICY_LINE_PATTERN = /\b(?:must(?:\s+not)?|should(?:\s+not)?|do not|don't|never|always|required?|forbid(?:den)?|only|block(?:ed)?|deny|approved?|verify|verification|proof)\b/i;
const HIGH_SEVERITY_PATTERN = /\b(?:production|prod|main|master|force(?:\s|-)?push|drop|truncate|delete|secret|token|credential|api[_ -]?key|publish|release)\b/i;
const MEDIUM_SEVERITY_PATTERN = /\b(?:tests?|verify|verification|proof|review|ci|lint|branch|workflow|deploy)\b/i;

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
  return String(value || '')
    .replace(/\uFEFF/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
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

  return String(text || '').replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (match) => entityMap[match] || match);
}

/**
 * Strip HTML tags and dangerous content from a string.
 * This function is used for text extraction only — output is never rendered as HTML.
 * Defense-in-depth: strips scripts, styles, event handlers, and all remaining tags.
 */
function stripHtml(html) {
  const withLineBreaks = String(html || '')
    // Remove script blocks entirely — use greedy end-tag match to handle malformed markup
    .replace(/<script[\s\S]*?<\/script[^>]*>/gi, ' ')
    // Remove style blocks
    .replace(/<style[\s\S]*?<\/style[^>]*>/gi, ' ')
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Strip event-handler attributes (onclick, onerror, onload, etc.) before removing tags
    .replace(/\s+on[a-z][a-z0-9]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, ' ')
    // Strip javascript: and data: URIs in attributes
    .replace(/(?:href|src|action)\s*=\s*(?:"(?:javascript|data):[^"]*"|'(?:javascript|data):[^']*')/gi, '')
    // Add line breaks for block-level elements
    .replace(/<\/(?:p|div|section|article|header|footer|aside|main|li|tr|td|th|h[1-6]|br)\s*>/gi, '\n')
    // Remove all remaining tags
    .replace(/<[^>]+>/g, ' ');
  return normalizeText(decodeHtmlEntities(withLineBreaks));
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

  if (['markdown', 'text', 'yaml'].includes(normalizedFormat)) {
    return normalizeText(rawText);
  }

  throw new Error(`Unsupported document format: ${normalizedFormat || 'unknown'}`);
}

function extractTitle({ explicitTitle, filePath, rawContent, normalizedContent, sourceFormat }) {
  const provided = String(explicitTitle || '').trim();
  if (provided) return provided;

  const markdownHeading = String(normalizedContent || '').match(/^#\s+(.+)$/m);
  if (markdownHeading && markdownHeading[1]) {
    return markdownHeading[1].trim();
  }

  if (sourceFormat === 'html') {
    const titleMatch = String(rawContent || '').match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      return decodeHtmlEntities(titleMatch[1]).trim();
    }
  }

  if (sourceFormat === 'json') {
    try {
      const parsed = JSON.parse(String(rawContent || ''));
      if (parsed && typeof parsed === 'object') {
        for (const key of ['title', 'name', 'policy', 'document']) {
          const value = parsed[key];
          if (typeof value === 'string' && value.trim()) {
            return value.trim();
          }
        }
      }
    } catch {
      // Fall through to file name.
    }
  }

  if (filePath) {
    return path.basename(filePath, path.extname(filePath));
  }

  return 'Imported document';
}

function extractHeadings(content) {
  return String(content || '')
    .split('\n')
    .map((line) => line.match(/^#{1,6}\s+(.+)$/))
    .filter(Boolean)
    .map((match) => match[1].trim())
    .slice(0, 12);
}

function buildExcerpt(content, maxLength = 280) {
  const compact = String(content || '').replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1)}\u2026`;
}

function normalizePolicyLine(line) {
  return String(line || '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/\s+/g, ' ')
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
    .filter((line) => POLICY_LINE_PATTERN.test(line));

  return uniqueBy(lines, (line) => line.toLowerCase()).slice(0, MAX_POLICY_PROPOSALS * 2);
}

function inferProposalSeverity(statement) {
  if (HIGH_SEVERITY_PATTERN.test(statement)) return 'critical';
  if (MEDIUM_SEVERITY_PATTERN.test(statement)) return 'high';
  return 'medium';
}

function inferProposalAction(statement) {
  if (/\b(?:never|must not|do not|don't|forbid(?:den)?|block(?:ed)?|deny)\b/i.test(statement)) {
    return 'block';
  }
  if (/\b(?:always|required?|verify|verification|proof|review)\b/i.test(statement)) {
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
  const proposalId = `proposal_${sha256(`${document.documentId}:${statement}`).slice(0, 12)}`;
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
  };
}

function getDocumentPath(documentId, options = {}) {
  const { documentsDir } = getDocumentStorePaths(options);
  return path.join(documentsDir, `${documentId}${DOCUMENT_FILE_SUFFIX}`);
}

function buildDocumentSummary(document) {
  return {
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

  const filtered = documents.filter((document) => {
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
  const summaries = listImportedDocuments({
    ...options,
    limit: MAX_SEARCH_SCAN,
  }).documents.filter((entry) => entry.documentId !== document.documentId);
  const nextSummaries = [
    buildDocumentSummary(document),
    ...summaries,
  ].sort((left, right) => String(right.importedAt).localeCompare(String(left.importedAt)));
  writeJsonl(paths.catalogPath, nextSummaries);
  return document;
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
    .map((document) => {
      const scored = scoreImportedDocument(document, tokens);
      return {
        ...document,
        _score: Number(scored.score.toFixed(4)),
        _matchedTokens: scored.matchedTokens,
      };
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

  const rawContent = hasContent
    ? String(options.content)
    : fs.readFileSync(sourcePath, 'utf8');
  const sourceFormat = inferSourceFormat(sourcePath, options.sourceFormat);
  if (!sourceFormat) {
    throw new Error('Unsupported document format. Supported formats: markdown, text, yaml, json, html.');
  }

  const normalizedContent = normalizeDocumentBody(rawContent, sourceFormat);
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
  const document = {
    documentId,
    title,
    sourceType: sourcePath ? 'file' : 'inline',
    sourcePath,
    sourceName,
    sourceFormat,
    sourceUrl: options.sourceUrl ? String(options.sourceUrl).trim() : null,
    importedAt,
    tags: normalizeTags(options.tags),
    fingerprint,
    excerpt: buildExcerpt(normalizedContent),
    content: normalizedContent,
    contentBytes: Buffer.byteLength(normalizedContent, 'utf8'),
    lineCount: normalizedContent.split('\n').filter(Boolean).length,
    headings: extractHeadings(normalizedContent),
  };
  document.proposals = options.proposeGates === false
    ? []
    : proposeGatesFromDocument(document, options);
  document.matchedTemplateIds = document.proposals
    .map((proposal) => proposal.templateId)
    .filter(Boolean);

  persistDocument(document, options);
  return document;
}

module.exports = {
  DOCUMENTS_DIRNAME,
  DOCUMENT_CATALOG_FILENAME,
  getDocumentStorePaths,
  getDocumentPath,
  importDocument,
  listImportedDocuments,
  normalizeDocumentBody,
  proposeGatesFromDocument,
  readImportedDocument,
  searchImportedDocuments,
};
