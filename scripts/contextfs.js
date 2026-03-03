#!/usr/bin/env node
/**
 * ContextFS
 *
 * Persistent, file-system-native context store implementing:
 * - Constructor: build relevant context pack
 * - Loader: enforce bounded context size
 * - Evaluator: record pack outcome for learning loop
 */

const fs = require('fs');
const path = require('path');
const PROJECT_ROOT = path.join(__dirname, '..');
const FEEDBACK_DIR = process.env.RLHF_FEEDBACK_DIR || path.join(PROJECT_ROOT, '.claude', 'memory', 'feedback');

const CONTEXTFS_ROOT = process.env.RLHF_CONTEXTFS_DIR
  || path.join(FEEDBACK_DIR, 'contextfs');

const NAMESPACES = {
  rawHistory: 'raw_history',
  memoryError: path.join('memory', 'error'),
  memoryLearning: path.join('memory', 'learning'),
  rules: 'rules',
  tools: 'tools',
  provenance: 'provenance',
};
const DEFAULT_SEARCH_NAMESPACES = [
  NAMESPACES.memoryError,
  NAMESPACES.memoryLearning,
  NAMESPACES.rules,
  NAMESPACES.rawHistory,
];
const NAMESPACE_ALIAS_MAP = new Map([
  ...Object.entries(NAMESPACES).map(([key, value]) => [key, value]),
  ...Object.values(NAMESPACES).map((value) => [value, value]),
]);

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureContextFs() {
  Object.values(NAMESPACES).forEach((subPath) => {
    ensureDir(path.join(CONTEXTFS_ROOT, subPath));
  });
}

function nowIso() {
  return new Date().toISOString();
}

function toSlug(input) {
  return String(input || 'item')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function appendJsonl(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`);
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function listJsonFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  const files = fs.readdirSync(dirPath, { withFileTypes: true });
  const out = [];
  files.forEach((entry) => {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      out.push(...listJsonFiles(fullPath));
      return;
    }
    if (entry.isFile() && entry.name.endsWith('.json')) {
      out.push(fullPath);
    }
  });
  return out;
}

function recordProvenance(event) {
  ensureContextFs();
  const payload = {
    id: `prov_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: nowIso(),
    ...event,
  };
  appendJsonl(path.join(CONTEXTFS_ROOT, NAMESPACES.provenance, 'events.jsonl'), payload);
  return payload;
}

function writeContextObject({ namespace, title, content, tags = [], source, ttl = null, metadata = {} }) {
  ensureContextFs();

  const id = `${Date.now()}_${toSlug(title)}`;
  const filePath = path.join(CONTEXTFS_ROOT, namespace, `${id}.json`);

  const doc = {
    id,
    title,
    content,
    tags,
    source: source || 'unknown',
    ttl,
    metadata,
    createdAt: nowIso(),
    lastUsedAt: null,
  };

  writeJson(filePath, doc);

  recordProvenance({
    type: 'context_object_created',
    namespace,
    objectId: id,
    source: doc.source,
  });

  return {
    id,
    namespace,
    filePath,
    document: doc,
  };
}

function registerFeedback(feedbackEvent, memoryRecord = null) {
  ensureContextFs();

  const raw = writeContextObject({
    namespace: NAMESPACES.rawHistory,
    title: `feedback_${feedbackEvent.signal}_${feedbackEvent.id}`,
    content: JSON.stringify(feedbackEvent),
    tags: feedbackEvent.tags || [],
    source: 'feedback-event',
    metadata: {
      signal: feedbackEvent.signal,
      actionType: feedbackEvent.actionType,
    },
  });

  let memory = null;
  if (memoryRecord) {
    const namespace = memoryRecord.category === 'error'
      ? NAMESPACES.memoryError
      : NAMESPACES.memoryLearning;

    memory = writeContextObject({
      namespace,
      title: memoryRecord.title,
      content: memoryRecord.content,
      tags: memoryRecord.tags || [],
      source: 'feedback-memory',
      metadata: {
        category: memoryRecord.category,
        sourceFeedbackId: memoryRecord.sourceFeedbackId,
      },
    });
  }

  return { raw, memory };
}

function registerPreventionRules(markdown, metadata = {}) {
  return writeContextObject({
    namespace: NAMESPACES.rules,
    title: `prevention_rules_${new Date().toISOString().slice(0, 10)}`,
    content: markdown,
    tags: ['rules', 'prevention'],
    source: 'feedback-loop',
    metadata,
  });
}

function normalizeNamespaces(namespaces) {
  if (!Array.isArray(namespaces) || namespaces.length === 0) {
    return [...DEFAULT_SEARCH_NAMESPACES];
  }

  const normalized = [];
  namespaces.forEach((rawValue) => {
    const value = String(rawValue || '').trim();
    const mapped = NAMESPACE_ALIAS_MAP.get(value);
    if (!mapped) {
      const err = new Error(`Unsupported namespace: ${value}`);
      err.code = 'INVALID_NAMESPACE';
      throw err;
    }
    if (!normalized.includes(mapped)) {
      normalized.push(mapped);
    }
  });

  return normalized;
}

function loadCandidates(namespaces) {
  ensureContextFs();
  const selected = normalizeNamespaces(namespaces);

  const docs = [];

  selected.forEach((namespace) => {
    const dir = path.join(CONTEXTFS_ROOT, namespace);
    const files = listJsonFiles(dir);
    files.forEach((filePath) => {
      try {
        const payload = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        docs.push({
          ...payload,
          namespace,
        });
      } catch {
        // ignore malformed files
      }
    });
  });

  return docs;
}

function scoreDocument(doc, queryTokens) {
  let score = 0;

  const haystack = `${doc.title || ''} ${doc.content || ''} ${(doc.tags || []).join(' ')}`.toLowerCase();

  queryTokens.forEach((token) => {
    if (token.length > 2 && haystack.includes(token)) {
      score += 3;
    }
  });

  if (doc.namespace.includes('memory/error')) score += 1;
  if (doc.namespace.includes('memory/learning')) score += 1;

  if (doc.createdAt) {
    const ageMs = Date.now() - new Date(doc.createdAt).getTime();
    if (Number.isFinite(ageMs)) {
      const hours = ageMs / (1000 * 60 * 60);
      if (hours < 24) score += 2;
      else if (hours < 24 * 7) score += 1;
    }
  }

  return score;
}

function constructContextPack({ query = '', maxItems = 8, maxChars = 6000, namespaces = [] } = {}) {
  const tokens = String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  const candidates = loadCandidates(namespaces)
    .map((doc) => ({ doc, score: scoreDocument(doc, tokens) }))
    .sort((a, b) => b.score - a.score);

  const selected = [];
  let usedChars = 0;

  for (const item of candidates) {
    if (selected.length >= maxItems) break;

    const snippet = `${item.doc.title}\n${item.doc.content || ''}`;
    if (usedChars + snippet.length > maxChars) continue;

    selected.push({
      id: item.doc.id,
      namespace: item.doc.namespace,
      title: item.doc.title,
      content: item.doc.content,
      tags: item.doc.tags || [],
      score: item.score,
    });
    usedChars += snippet.length;
  }

  const packId = `pack_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const pack = {
    packId,
    query,
    maxItems,
    maxChars,
    usedChars,
    createdAt: nowIso(),
    items: selected,
  };

  appendJsonl(path.join(CONTEXTFS_ROOT, NAMESPACES.provenance, 'packs.jsonl'), pack);
  recordProvenance({
    type: 'context_pack_constructed',
    packId,
    query,
    itemCount: selected.length,
    usedChars,
  });

  return pack;
}

function evaluateContextPack({ packId, outcome, signal = null, notes = '' }) {
  const evaluation = {
    id: `eval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    packId,
    outcome,
    signal,
    notes,
    timestamp: nowIso(),
  };

  appendJsonl(path.join(CONTEXTFS_ROOT, NAMESPACES.provenance, 'evaluations.jsonl'), evaluation);
  recordProvenance({
    type: 'context_pack_evaluated',
    packId,
    outcome,
    signal,
  });

  return evaluation;
}

function getProvenance(limit = 50) {
  const eventsPath = path.join(CONTEXTFS_ROOT, NAMESPACES.provenance, 'events.jsonl');
  const events = readJsonl(eventsPath);
  return events.slice(-limit);
}

module.exports = {
  CONTEXTFS_ROOT,
  NAMESPACES,
  ensureContextFs,
  recordProvenance,
  writeContextObject,
  registerFeedback,
  registerPreventionRules,
  normalizeNamespaces,
  constructContextPack,
  evaluateContextPack,
  getProvenance,
  readJsonl,
  DEFAULT_SEARCH_NAMESPACES,
};

if (require.main === module) {
  ensureContextFs();
  console.log(`ContextFS ready at ${CONTEXTFS_ROOT}`);
}
