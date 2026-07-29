#!/usr/bin/env node
'use strict';

/**
 * Document pipeline for ThumbGate RAG: parse → clean → chunk → metadata.
 *
 * Primary corpus is feedback/memory/skill-pack text. Markdown operator docs are
 * supported. PDF/binary is explicitly rejected with a clear error (no fake parse).
 */

const crypto = require('node:crypto');
const path = require('node:path');

const DEFAULT_CHUNK_CHARS = 900;
const DEFAULT_CHUNK_OVERLAP = 120;
const MIN_CHUNK_CHARS = 40;
const PLACEHOLDER_TOKENS = new Set([
  'thumbs down', 'thumbs up', 'thumb down', 'thumb up',
  'good', 'bad', 'ok', 'nice', 'verify', 'test', 'testing',
]);

function sha1(text) {
  return crypto.createHash('sha1').update(String(text || '')).digest('hex').slice(0, 16);
}

function looksLikePlaceholder(text) {
  const t = String(text || '').trim();
  if (!t || t.length < 20) return true;
  return PLACEHOLDER_TOKENS.has(t.toLowerCase().replace(/\.$/, ''));
}

function sanitizeText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[^\S\n]{2,}/g, ' ')
    .trim();
}

function tryLoadSanitizer() {
  try {
    return require('./feedback-sanitizer');
  } catch {
    return null;
  }
}

/**
 * Parse a single source into zero or more raw records.
 * @param {{ type?: string, id?: string, title?: string, content?: string, text?: string, signal?: string, tags?: string[], metadata?: object, source?: string }} input
 */
function parseDocument(input = {}) {
  const errors = [];
  const type = String(input.type || input.mediaType || 'text').toLowerCase();

  if (type === 'pdf' || type === 'application/pdf' || /\.pdf$/i.test(input.path || input.id || '')) {
    return {
      ok: false,
      records: [],
      errors: [{ code: 'pdf_not_supported', message: 'PDF ingest is not implemented; convert to markdown/text first.' }],
    };
  }

  if (type === 'jsonl' || (typeof input.content === 'string' && input.content.includes('\n') && input.content.trim().startsWith('{'))) {
    const lines = String(input.content || '').split('\n').filter((l) => l.trim());
    const records = [];
    for (let i = 0; i < lines.length; i++) {
      try {
        const row = JSON.parse(lines[i]);
        records.push({
          id: row.id || `jsonl-${i}-${sha1(lines[i])}`,
          title: row.title || row.context || '',
          content: row.content || row.whatWentWrong || row.whatWorked || row.context || '',
          signal: row.signal || row.feedback || '',
          tags: Array.isArray(row.tags) ? row.tags : [],
          metadata: { ...(row.metadata || {}), line: i, source: input.source || 'jsonl' },
          source: input.source || 'jsonl',
        });
      } catch (err) {
        errors.push({ code: 'jsonl_parse_error', line: i, message: err.message });
      }
    }
    return {
      ok: errors.length === 0 || records.length > 0,
      records,
      errors,
      parse_success_rate: lines.length ? records.length / lines.length : 0,
    };
  }

  if (type === 'markdown' || type === 'md' || type === 'text' || !type) {
    const raw = String(input.content || input.text || '');
    if (!raw.trim()) {
      return { ok: false, records: [], errors: [{ code: 'empty_document', message: 'No content' }] };
    }
    // Split on markdown ## headings when present; else single record.
    const sections = splitMarkdownSections(raw, input.title || input.id || 'document');
    const records = sections.map((sec, i) => ({
      id: input.id ? `${input.id}#${i}` : `doc-${sha1(sec.title + sec.content)}`,
      title: sec.title,
      content: sec.content,
      signal: input.signal || '',
      tags: Array.isArray(input.tags) ? [...input.tags] : [],
      metadata: { ...(input.metadata || {}), sectionIndex: i, source: input.source || 'markdown' },
      source: input.source || 'markdown',
    }));
    return { ok: true, records, errors, parse_success_rate: 1 };
  }

  // Structured memory/lesson object
  if (input.title || input.content || input.context) {
    return {
      ok: true,
      records: [{
        id: input.id || `rec-${sha1(input.title || input.content || '')}`,
        title: input.title || '',
        content: input.content || input.context || input.whatWentWrong || input.whatWorked || '',
        signal: input.signal || input.feedback || '',
        tags: Array.isArray(input.tags) ? input.tags : [],
        metadata: { ...(input.metadata || {}), source: input.source || 'memory' },
        source: input.source || 'memory',
      }],
      errors,
      parse_success_rate: 1,
    };
  }

  return {
    ok: false,
    records: [],
    errors: [{ code: 'unknown_document_type', message: `Unsupported type: ${type}` }],
  };
}

function splitMarkdownSections(raw, fallbackTitle) {
  const text = String(raw || '');
  if (!/^#{1,3}\s+/m.test(text)) {
    return [{ title: fallbackTitle, content: text }];
  }
  const parts = text.split(/(?=^#{1,3}\s+)/m).map((p) => p.trim()).filter(Boolean);
  return parts.map((part) => {
    const m = part.match(/^#{1,3}\s+(.+)\n?([\s\S]*)$/);
    if (!m) return { title: fallbackTitle, content: part };
    return { title: m[1].trim(), content: (m[2] || '').trim() };
  });
}

/**
 * Clean a parsed record. Returns null if it should be dropped.
 */
function cleanRecord(record, options = {}) {
  if (!record) return { kept: false, reason: 'null_record', record: null };
  const sanitizer = tryLoadSanitizer();
  const title = sanitizeText(record.title);
  const content = sanitizeText(record.content);
  const combined = `${title}\n${content}`.trim();

  if (!combined) {
    return { kept: false, reason: 'empty_after_clean', record: null };
  }

  if (sanitizer && typeof sanitizer.looksLikeTransportBlob === 'function') {
    if (
      sanitizer.looksLikeTransportBlob(title)
      || sanitizer.looksLikeTransportBlob(content)
      || sanitizer.looksLikeTransportBlob(combined)
    ) {
      return { kept: false, reason: 'transport_blob', record: null };
    }
  }

  if (!options.keepPlaceholders && looksLikePlaceholder(combined)) {
    return { kept: false, reason: 'placeholder', record: null };
  }

  return {
    kept: true,
    reason: null,
    record: {
      ...record,
      title,
      content,
    },
  };
}

/**
 * Chunk long text with overlap. Short records stay single-chunk.
 */
function chunkText(text, options = {}) {
  const maxChars = Math.max(MIN_CHUNK_CHARS, Number(options.maxChars) || DEFAULT_CHUNK_CHARS);
  const overlap = Math.max(0, Math.min(maxChars - 1, Number(options.overlap) || DEFAULT_CHUNK_OVERLAP));
  const raw = String(text || '').trim();
  if (!raw) return [];
  if (raw.length <= maxChars) return [raw];

  const chunks = [];
  let start = 0;
  while (start < raw.length) {
    let end = Math.min(raw.length, start + maxChars);
    if (end < raw.length) {
      // Prefer break on paragraph/sentence boundary in the last 20% of the window.
      const window = raw.slice(start, end);
      const searchFrom = Math.floor(window.length * 0.8);
      const para = window.lastIndexOf('\n\n');
      const sent = window.lastIndexOf('. ');
      let breakAt = -1;
      if (para >= searchFrom) breakAt = para + 2;
      else if (sent >= searchFrom) breakAt = sent + 2;
      if (breakAt > 0) end = start + breakAt;
    }
    const piece = raw.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= raw.length) break;
    start = Math.max(0, end - overlap);
    if (start >= end) start = end; // safety
  }
  return chunks;
}

function chunkRecord(record, options = {}) {
  const pieces = chunkText(`${record.title ? `${record.title}\n\n` : ''}${record.content || ''}`, options);
  if (pieces.length === 0) return [];
  return pieces.map((content, i) => ({
    ...record,
    id: pieces.length === 1 ? record.id : `${record.id}::c${i}`,
    content,
    metadata: {
      ...(record.metadata || {}),
      chunkIndex: i,
      chunkTotal: pieces.length,
      parentId: record.id,
    },
  }));
}

const PATH_RE = /(?:\.\/|\/)?[\w.-]+(?:\/[\w.-]+)+(?:\.\w+)?/g;
const TOOL_HINTS = [
  'bash', 'shell', 'git', 'npm', 'node', 'curl', 'docker', 'railway',
  'stripe', 'prisma', 'sqlite', 'postgres', 'write', 'edit', 'read',
];

function extractMetadata(record) {
  const content = `${record.title || ''}\n${record.content || ''}`;
  const lower = content.toLowerCase();
  const tags = new Set(Array.isArray(record.tags) ? record.tags.map(String) : []);
  const toolsUsed = new Set(Array.isArray(record.metadata?.toolsUsed) ? record.metadata.toolsUsed : []);
  const filesInvolved = new Set(Array.isArray(record.metadata?.filesInvolved) ? record.metadata.filesInvolved : []);

  for (const hint of TOOL_HINTS) {
    if (lower.includes(hint)) {
      toolsUsed.add(hint);
      tags.add(hint);
    }
  }

  const paths = content.match(PATH_RE) || [];
  for (const p of paths.slice(0, 12)) {
    if (p.length > 3 && p.length < 200) filesInvolved.add(p);
  }

  let signal = record.signal || '';
  if (!signal) {
    if (/\b(never|don't|do not|blocked|mistake|fail|wrong)\b/i.test(content)) signal = 'negative';
    else if (/\b(always|worked|success|prefer)\b/i.test(content)) signal = 'positive';
  }

  const domain = record.metadata?.domain
    || (lower.includes('stripe') || lower.includes('payment') ? 'stripe-integration'
      : lower.includes('railway') || lower.includes('deploy') ? 'railway-deploy'
        : lower.includes('migration') || lower.includes('database') || lower.includes('prisma') ? 'database-migration'
          : 'general');

  return {
    ...record,
    signal,
    tags: [...tags],
    metadata: {
      ...(record.metadata || {}),
      domain,
      toolsUsed: [...toolsUsed],
      filesInvolved: [...filesInvolved],
      contentChars: content.length,
    },
  };
}

/**
 * Full pipeline: documents → cleaned chunks with metadata.
 * @returns {{ documents, chunks, metrics }}
 */
function runDocumentPipeline(inputs = [], options = {}) {
  const documents = [];
  const chunks = [];
  let parseAttempts = 0;
  let parseSuccesses = 0;
  let parseErrors = 0;
  let cleanKept = 0;
  let cleanRejected = 0;
  let placeholderRejects = 0;
  const sourceMix = {};

  const list = Array.isArray(inputs) ? inputs : [inputs];
  for (const input of list) {
    parseAttempts += 1;
    const parsed = parseDocument(input);
    parseErrors += (parsed.errors || []).length;
    if (parsed.ok && parsed.records.length) parseSuccesses += 1;

    for (const rec of parsed.records || []) {
      const cleaned = cleanRecord(rec, options);
      if (!cleaned.kept) {
        cleanRejected += 1;
        if (cleaned.reason === 'placeholder') placeholderRejects += 1;
        continue;
      }
      cleanKept += 1;
      const withMeta = extractMetadata(cleaned.record);
      documents.push(withMeta);
      const src = withMeta.source || 'unknown';
      sourceMix[src] = (sourceMix[src] || 0) + 1;

      const parts = chunkRecord(withMeta, options);
      for (const part of parts) {
        chunks.push(extractMetadata(part));
      }
    }
  }

  const chunkChars = chunks.map((c) => String(c.content || '').length);
  const sourceChars = documents.reduce((s, d) => s + String(d.content || '').length, 0);
  const chunkedChars = chunkChars.reduce((s, n) => s + n, 0);

  const metrics = {
    corpus_document_count: documents.length,
    corpus_source_mix: sourceMix,
    parse_success_rate: parseAttempts ? parseSuccesses / parseAttempts : 0,
    parse_error_count: parseErrors,
    records_emitted: documents.length,
    clean_reject_rate: (cleanKept + cleanRejected) ? cleanRejected / (cleanKept + cleanRejected) : 0,
    clean_kept_rate: (cleanKept + cleanRejected) ? cleanKept / (cleanKept + cleanRejected) : 0,
    placeholder_reject_count: placeholderRejects,
    chunk_count: chunks.length,
    avg_chunk_chars: chunkChars.length ? Math.round(chunkChars.reduce((a, b) => a + b, 0) / chunkChars.length) : 0,
    max_chunk_chars: chunkChars.length ? Math.max(...chunkChars) : 0,
    chunk_coverage_ratio: sourceChars ? Math.min(1, chunkedChars / sourceChars) : 0,
    metadata_field_fill_rate: documents.length
      ? documents.filter((d) => d.tags?.length || d.metadata?.toolsUsed?.length).length / documents.length
      : 0,
    records_with_tags_rate: documents.length
      ? documents.filter((d) => Array.isArray(d.tags) && d.tags.length > 0).length / documents.length
      : 0,
    records_with_signal_rate: documents.length
      ? documents.filter((d) => d.signal).length / documents.length
      : 0,
    no_transport_blob_rate: 1, // transport blobs rejected in clean
  };

  return { documents, chunks, metrics };
}

/**
 * Build eval/seed documents from skill packs so retrieval has a real corpus.
 */
function skillPacksToDocuments() {
  const docs = [];
  try {
    const mod = require('./skill-packs');
    const listed = typeof mod.listSkillPacks === 'function' ? mod.listSkillPacks() : [];
    for (const entry of listed) {
      const name = entry.name || entry.id;
      const pack = typeof mod.getSkillPack === 'function' ? mod.getSkillPack(name) : entry;
      if (!pack) continue;
      const rules = pack.rules || [];
      const triggers = pack.triggers || entry.triggers || [];
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        docs.push({
          type: 'text',
          id: `skill:${name}:${i}`,
          title: `${name}: ${String(rule).slice(0, 80)}`,
          content: rule,
          tags: [name, 'skill_pack', ...triggers.slice(0, 6)],
          signal: /NEVER|don't|do not/i.test(rule) ? 'negative' : 'positive',
          source: 'skill_pack',
          metadata: { domain: name },
        });
      }
    }
  } catch {
    // no skill packs available
  }
  return docs;
}

module.exports = {
  DEFAULT_CHUNK_CHARS,
  DEFAULT_CHUNK_OVERLAP,
  parseDocument,
  cleanRecord,
  chunkText,
  chunkRecord,
  extractMetadata,
  runDocumentPipeline,
  skillPacksToDocuments,
  looksLikePlaceholder,
  sanitizeText,
};
