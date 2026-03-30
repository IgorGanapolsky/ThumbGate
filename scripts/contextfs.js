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
const crypto = require('crypto');
const os = require('os');
const PROJECT_ROOT = path.join(__dirname, '..');
const HOME = os.homedir();
const {
  retrieveHierarchicalDocuments,
  shouldUseHierarchicalRetrieval,
} = require('./xmemory-lite');

const CONTEXTFS_RETRIEVAL_VERSION = 'xmemory-lite-v1';

function getFeedbackBaseDir() {
  if (process.env.RLHF_FEEDBACK_DIR) return process.env.RLHF_FEEDBACK_DIR;

  const localRlhf = path.join(process.cwd(), '.rlhf');
  const localClaude = path.join(process.cwd(), '.claude', 'memory', 'feedback');
  
  if (fs.existsSync(localRlhf)) return localRlhf;
  if (fs.existsSync(localClaude)) return localClaude;

  const projectName = path.basename(process.cwd()) || 'default';
  return path.join(HOME, '.rlhf', 'projects', projectName);
}

const FEEDBACK_DIR = getFeedbackBaseDir();
const CONTEXTFS_ROOT = process.env.RLHF_CONTEXTFS_DIR
  || (FEEDBACK_DIR.endsWith('contextfs') ? FEEDBACK_DIR : path.join(FEEDBACK_DIR, 'contextfs'));

const NAMESPACES = {
  rawHistory: 'raw_history',
  memoryError: path.join('memory', 'error'),
  memoryLearning: path.join('memory', 'learning'),
  rules: 'rules',
  tools: 'tools',
  provenance: 'provenance',
  session: 'session',
  research: 'research',
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

const PACK_TEMPLATES = {
  'bug-investigation': {
    namespaces: ['memoryError', 'rules'],
    maxItems: 10,
    maxChars: 8000,
    queryPrefix: 'bug failure error crash',
  },
  'session-resume': {
    namespaces: ['session', 'memoryLearning', 'rules'],
    maxItems: 8,
    maxChars: 6000,
    queryPrefix: 'session context resume',
  },
  'sales-call-prep': {
    namespaces: ['memoryLearning', 'rules'],
    maxItems: 6,
    maxChars: 4000,
    queryPrefix: 'value proof evidence workflow',
  },
  'competitor-scan': {
    namespaces: ['memoryLearning', 'memoryError'],
    maxItems: 8,
    maxChars: 6000,
    queryPrefix: 'competitor comparison alternative',
  },
  'research-brief': {
    namespaces: ['research'],
    maxItems: 10,
    maxChars: 8000,
    queryPrefix: 'research paper',
  },
  'autoresearch-brief': {
    namespaces: ['research', 'memoryLearning', 'rules'],
    maxItems: 12,
    maxChars: 10000,
    queryPrefix: 'research benchmark experiment reliability',
  },
  'gtm-research': {
    namespaces: ['research', 'memoryLearning'],
    maxItems: 10,
    maxChars: 8000,
    queryPrefix: 'marketing conversion acquisition research',
  },
};

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

function inferNamespaceFromPath(filePath) {
  if (!filePath) return '';
  const relativeDir = path.relative(CONTEXTFS_ROOT, path.dirname(filePath));
  if (!relativeDir || relativeDir.startsWith('..')) return '';
  return relativeDir;
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

function tokenizeQuery(query) {
  return String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function uniqueTokens(tokens) {
  return Array.from(new Set(tokens));
}

function querySimilarity(tokensA, tokensB) {
  const setA = new Set(uniqueTokens(tokensA));
  const setB = new Set(uniqueTokens(tokensB));
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function buildSemanticCacheKey({ namespaces, maxItems, maxChars }) {
  return JSON.stringify({
    retrievalVersion: CONTEXTFS_RETRIEVAL_VERSION,
    namespaces: normalizeNamespaces(namespaces),
    maxItems,
    maxChars,
  });
}

function getSemanticCacheConfig() {
  const enabled = process.env.RLHF_SEMANTIC_CACHE_ENABLED !== 'false';
  const thresholdRaw = Number(process.env.RLHF_SEMANTIC_CACHE_THRESHOLD || '0.7');
  const ttlSecondsRaw = Number(process.env.RLHF_SEMANTIC_CACHE_TTL_SECONDS || '86400');
  const threshold = Number.isFinite(thresholdRaw) ? Math.min(1, Math.max(0, thresholdRaw)) : 0.7;
  const ttlSeconds = Number.isFinite(ttlSecondsRaw) ? Math.max(60, ttlSecondsRaw) : 86400;
  return { enabled, threshold, ttlSeconds };
}

function getSemanticCachePath() {
  return path.join(CONTEXTFS_ROOT, NAMESPACES.provenance, 'semantic-cache.jsonl');
}

function loadSemanticCacheEntries() {
  return readJsonl(getSemanticCachePath());
}

function appendSemanticCacheEntry(entry) {
  appendJsonl(getSemanticCachePath(), entry);
}

function getSourceHash(namespaces) {
  const hasher = crypto.createHash('sha256');
  const normalizedNamespaces = normalizeNamespaces(namespaces);

  for (const ns of normalizedNamespaces) {
    const dirPath = path.join(CONTEXTFS_ROOT, ns);
    if (!fs.existsSync(dirPath)) continue;

    const files = fs.readdirSync(dirPath).sort();
    for (const file of files) {
      if (file.endsWith('.json') || file.endsWith('.jsonl') || file.endsWith('.md')) {
        const filePath = path.join(dirPath, file);
        try {
          const stats = fs.statSync(filePath);
          hasher.update(`${file}:${stats.mtimeMs}:${stats.size}`);
        } catch {
          // Skip if file disappeared
        }
      }
    }
  }
  return hasher.digest('hex');
}

function findSemanticCacheHit({ query, namespaces, maxItems, maxChars }) {
  const { enabled, threshold, ttlSeconds } = getSemanticCacheConfig();
  if (!enabled) return null;

  const entries = loadSemanticCacheEntries();
  if (entries.length === 0) return null;

  const now = Date.now();
  const queryTokens = tokenizeQuery(query);
  const key = buildSemanticCacheKey({ namespaces, maxItems, maxChars });
  const currentSourceHash = getSourceHash(namespaces);

  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (!entry || entry.key !== key || !entry.pack) continue;

    // Zero-Waste Caching: validate source hash
    if (entry.sourceHash !== currentSourceHash) {
      continue;
    }

    const createdMs = new Date(entry.timestamp || 0).getTime();
    if (Number.isFinite(createdMs) && now - createdMs > ttlSeconds * 1000) {
      continue;
    }

    const score = querySimilarity(queryTokens, Array.isArray(entry.tokens) ? entry.tokens : []);
    if (score >= threshold) {
      return {
        score,
        entry,
      };
    }
  }

  return null;
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
    namespace,
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
  indexContextObject(doc, filePath);

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

function mergeMetadata(existingMetadata = {}, incomingMetadata = {}) {
  const merged = { ...existingMetadata };

  Object.entries(incomingMetadata).forEach(([key, value]) => {
    if (value === undefined) return;

    const currentValue = merged[key];
    if (Array.isArray(currentValue) && Array.isArray(value)) {
      merged[key] = [...new Set([...currentValue, ...value])];
      return;
    }

    merged[key] = value;
  });

  return merged;
}

function normalizeTagList(tags) {
  return Array.isArray(tags)
    ? [...new Set(tags.map((tag) => String(tag)))]
      .sort()
    : [];
}

function findExistingContextObject({ namespace, title, content, tags = [], source }) {
  ensureContextFs();

  const expectedTags = normalizeTagList(tags);
  const dirPath = path.join(CONTEXTFS_ROOT, namespace);
  const files = listJsonFiles(dirPath).sort();

  for (const filePath of files) {
    try {
      const doc = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (doc.title !== title || doc.content !== content || doc.source !== source) {
        continue;
      }

      if (JSON.stringify(normalizeTagList(doc.tags)) !== JSON.stringify(expectedTags)) {
        continue;
      }

      return {
        filePath,
        document: doc,
      };
    } catch {
      // Ignore malformed entries while searching for exact duplicates.
    }
  }

  return null;
}

function upsertContextObject({ namespace, title, content, tags = [], source, ttl = null, metadata = {} }) {
  const existing = findExistingContextObject({
    namespace,
    title,
    content,
    tags,
    source,
  });

  if (!existing) {
    return writeContextObject({
      namespace,
      title,
      content,
      tags,
      source,
      ttl,
      metadata,
    });
  }

  const mergedDocument = {
    ...existing.document,
    ttl: ttl === null ? existing.document.ttl || null : ttl,
    metadata: mergeMetadata(existing.document.metadata || {}, metadata),
  };
  writeJson(existing.filePath, mergedDocument);

  recordProvenance({
    type: 'context_object_deduped',
    namespace,
    objectId: existing.document.id,
    source: source || existing.document.source || 'unknown',
  });

  return {
    id: mergedDocument.id,
    namespace,
    filePath: existing.filePath,
    document: mergedDocument,
    deduped: true,
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
    memory = upsertContextObject({
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

function buildStructuredContext(doc) {
  const structuredContext = {
    rawContent: doc.content || '',
    reasoning: null,
    whatWentWrong: null,
    whatToChange: null,
    rubricFailure: null,
  };

  const lines = (doc.content || '').split('\n');
  for (const line of lines) {
    if (line.startsWith('Reasoning:')) structuredContext.reasoning = line.replace('Reasoning:', '').trim();
    else if (line.startsWith('What went wrong:')) structuredContext.whatWentWrong = line.replace('What went wrong:', '').trim();
    else if (line.startsWith('How to avoid:')) structuredContext.whatToChange = line.replace('How to avoid:', '').trim();
    else if (line.startsWith('Rubric failing criteria:')) structuredContext.rubricFailure = line.replace('Rubric failing criteria:', '').trim();
  }

  return structuredContext;
}

function measureDocumentChars(doc) {
  return `${doc.title || ''}\n${doc.content || ''}`.length;
}

function selectFlatContextItems(candidates, maxItems, maxChars) {
  const selected = [];
  let usedChars = 0;
  let skippedByMaxChars = 0;

  for (const item of candidates) {
    if (selected.length >= maxItems) break;

    const snippetLength = measureDocumentChars(item.doc);
    if (usedChars + snippetLength > maxChars) {
      skippedByMaxChars += 1;
      continue;
    }

    selected.push({
      id: item.doc.id,
      namespace: item.doc.namespace,
      title: item.doc.title,
      structuredContext: buildStructuredContext(item.doc),
      tags: item.doc.tags || [],
      score: item.score,
    });
    usedChars += snippetLength;
  }

  return {
    items: selected,
    usedChars,
    skippedByMaxChars,
    retrieval: {
      strategy: 'flat',
      themeCount: 0,
      semanticCount: 0,
      selectedThemes: [],
      selectedSemanticGroups: [],
      representativeCount: selected.length,
      expandedEpisodes: 0,
      queryCoverage: null,
      initialCoverage: null,
      coverageTarget: null,
    },
  };
}

/* ── Memex-style Indexed Memory ────────────────────────────────── */

const MEMEX_INDEX_FILE = 'memex-index.jsonl';

function getMemexIndexPath() {
  return path.join(CONTEXTFS_ROOT, NAMESPACES.provenance, MEMEX_INDEX_FILE);
}

function buildIndexEntry(doc, filePath) {
  const resolvedNamespace = doc.namespace || inferNamespaceFromPath(filePath);
  return {
    id: doc.id,
    namespace: resolvedNamespace,
    title: doc.title || '',
    tags: doc.tags || [],
    digest: String(doc.content || '').slice(0, 120),
    createdAt: doc.createdAt || nowIso(),
    stableRef: filePath,
  };
}

function indexContextObject(doc, filePath) {
  const entry = buildIndexEntry(doc, filePath);
  appendJsonl(getMemexIndexPath(), entry);
  return entry;
}

function loadMemexIndex() {
  return readJsonl(getMemexIndexPath());
}

function dereferenceEntry(entry) {
  if (!entry || !entry.stableRef) return null;
  try {
    return JSON.parse(fs.readFileSync(entry.stableRef, 'utf-8'));
  } catch {
    return null;
  }
}

function searchMemexIndex({ query = '', maxResults = 10, namespaces = [] } = {}) {
  const index = loadMemexIndex();
  const tokens = tokenizeQuery(query);
  const nsFilter = namespaces.length > 0 ? new Set(normalizeNamespaces(namespaces)) : null;

  const scored = index
    .filter((entry) => {
      const entryNamespace = entry.namespace || inferNamespaceFromPath(entry.stableRef);
      return !nsFilter || nsFilter.has(entryNamespace);
    })
    .map((entry) => {
      const entryNamespace = entry.namespace || inferNamespaceFromPath(entry.stableRef);
      const haystack = `${entry.title} ${entry.digest} ${(entry.tags || []).join(' ')}`.toLowerCase();
      let score = 0;
      tokens.forEach((t) => { if (t.length > 2 && haystack.includes(t)) score += 3; });
      if (entryNamespace.includes('memory/error')) score += 1;
      if (entryNamespace.includes('memory/learning')) score += 1;
      if (entry.createdAt) {
        const hours = (Date.now() - new Date(entry.createdAt).getTime()) / 3_600_000;
        if (Number.isFinite(hours)) {
          if (hours < 24) score += 2;
          else if (hours < 168) score += 1;
        }
      }
      return { entry: { ...entry, namespace: entryNamespace }, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  return scored.map((x) => ({ ...x.entry, _score: x.score }));
}

function constructMemexPack({ query = '', maxItems = 8, maxChars = 6000, namespaces = [] } = {}) {
  const normalizedNamespaces = normalizeNamespaces(namespaces);
  const hits = searchMemexIndex({ query, maxResults: maxItems * 2, namespaces: normalizedNamespaces });

  const items = [];
  let usedChars = 0;
  const dereferenced = [];
  let skippedByMaxChars = 0;

  for (const hit of hits) {
    if (items.length >= maxItems) break;
    const full = dereferenceEntry(hit);
    if (!full) continue;

    const snippetLength = measureDocumentChars(full);
    if (usedChars + snippetLength > maxChars) {
      skippedByMaxChars += 1;
      continue;
    }

    items.push({
      id: full.id,
      namespace: hit.namespace,
      title: full.title,
      structuredContext: buildStructuredContext(full),
      tags: full.tags || [],
      score: hit._score,
    });
    usedChars += snippetLength;
    dereferenced.push(hit.id);
  }

  const visibility = {
    itemCount: items.length,
    sourceCandidateCount: hits.length,
    hiddenCount: Math.max(hits.length - items.length, 0),
    maxItemsHit: hits.length > maxItems && items.length >= maxItems,
    maxCharsHit: skippedByMaxChars > 0,
    skippedByMaxChars,
    remainingCharBudget: Math.max(maxChars - usedChars, 0),
    visibleTitles: items.slice(0, 5).map((item) => item.title),
  };

  const packId = `memex_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const pack = {
    packId,
    query,
    maxItems,
    maxChars,
    usedChars,
    namespaces: normalizedNamespaces,
    createdAt: nowIso(),
    items,
    indexHits: hits.length,
    dereferencedCount: dereferenced.length,
    visibility,
    cache: { hit: false },
  };

  appendJsonl(path.join(CONTEXTFS_ROOT, NAMESPACES.provenance, 'packs.jsonl'), pack);
  recordProvenance({
    type: 'memex_pack_constructed',
    packId,
    query,
    indexHits: hits.length,
    dereferencedCount: dereferenced.length,
    usedChars,
  });

  return pack;
}

function constructContextPack({ query = '', maxItems = 8, maxChars = 6000, namespaces = [] } = {}) {
  const normalizedNamespaces = normalizeNamespaces(namespaces);
  const tokens = tokenizeQuery(query);
  const sourceHash = getSourceHash(normalizedNamespaces);

  const cacheHit = findSemanticCacheHit({
    query,
    namespaces: normalizedNamespaces,
    maxItems,
    maxChars,
  });

  if (cacheHit) {
    const packId = `pack_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const cachedPack = cacheHit.entry.pack;
    const pack = {
      ...cachedPack,
      packId,
      query,
      createdAt: nowIso(),
      cache: {
        hit: true,
        similarity: Number(cacheHit.score.toFixed(4)),
        matchedQuery: cacheHit.entry.query,
        sourcePackId: cachedPack.packId,
      },
    };

    appendJsonl(path.join(CONTEXTFS_ROOT, NAMESPACES.provenance, 'packs.jsonl'), pack);
    recordProvenance({
      type: 'context_pack_cache_hit',
      packId,
      sourcePackId: cachedPack.packId,
      query,
      similarity: Number(cacheHit.score.toFixed(4)),
      itemCount: Array.isArray(pack.items) ? pack.items.length : 0,
    });

    return pack;
  }

  const candidates = loadCandidates(normalizedNamespaces)
    .map((doc) => ({ doc, score: scoreDocument(doc, tokens) }))
    .sort((a, b) => b.score - a.score);

  const hierarchicalRetrievalEnabled = shouldUseHierarchicalRetrieval(normalizedNamespaces);
  const selection = hierarchicalRetrievalEnabled
    ? retrieveHierarchicalDocuments({
      documents: candidates.map((candidate) => candidate.doc),
      query,
      maxItems,
      maxChars,
      scorer: scoreDocument,
      measureDocument: measureDocumentChars,
    })
    : selectFlatContextItems(candidates, maxItems, maxChars);

  const selected = selection.items.map((doc) => ({
    id: doc.id,
    namespace: doc.namespace,
    title: doc.title,
    structuredContext: buildStructuredContext(doc),
    tags: doc.tags || [],
    score: scoreDocument(doc, tokens),
  }));
  const usedChars = selection.usedChars;
  const skippedByMaxChars = selection.skippedByMaxChars;

  const visibility = {
    itemCount: selected.length,
    sourceCandidateCount: candidates.length,
    hiddenCount: Math.max(candidates.length - selected.length, 0),
    maxItemsHit: candidates.length > maxItems && selected.length >= maxItems,
    maxCharsHit: skippedByMaxChars > 0,
    skippedByMaxChars,
    remainingCharBudget: Math.max(maxChars - usedChars, 0),
    visibleTitles: selected.slice(0, 5).map((item) => item.title),
  };

  const packId = `pack_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const pack = {
    packId,
    query,
    maxItems,
    maxChars,
    usedChars,
    namespaces: normalizedNamespaces,
    createdAt: nowIso(),
    items: selected,
    visibility,
    cache: {
      hit: false,
    },
    sourceHash,
    retrieval: selection.retrieval,
  };

  appendJsonl(path.join(CONTEXTFS_ROOT, NAMESPACES.provenance, 'packs.jsonl'), pack);
  appendSemanticCacheEntry({
    id: `cache_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: nowIso(),
    key: buildSemanticCacheKey({
      namespaces: normalizedNamespaces,
      maxItems,
      maxChars,
    }),
    query,
    tokens,
    sourceHash,
    pack,
  });
  recordProvenance({
    type: 'context_pack_constructed',
    packId,
    query,
    itemCount: selected.length,
    usedChars,
    sourceHash,
    retrievalStrategy: selection.retrieval.strategy,
  });

  return pack;
}

function evaluateContextPack({ packId, outcome, signal = null, notes = '', rubricEvaluation = null }) {
  const evaluation = {
    id: `eval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    packId,
    outcome,
    signal,
    notes,
    rubricEvaluation,
    timestamp: nowIso(),
  };

  appendJsonl(path.join(CONTEXTFS_ROOT, NAMESPACES.provenance, 'evaluations.jsonl'), evaluation);
  recordProvenance({
    type: 'context_pack_evaluated',
    packId,
    outcome,
    signal,
    rubricPromotionEligible: rubricEvaluation ? rubricEvaluation.promotionEligible : null,
  });

  return evaluation;
}

function getProvenance(limit = 50) {
  const eventsPath = path.join(CONTEXTFS_ROOT, NAMESPACES.provenance, 'events.jsonl');
  const events = readJsonl(eventsPath);
  return events.slice(-limit);
}

/**
 * Write a session handoff primer to contextfs/session/primer.json.
 * Captures git state, last task, next step, and blockers so the next
 * session starts with full context — no manual primer.md needed.
 */
function writeSessionHandoff({ project, branch, lastTask, nextStep, blockers, openFiles, customContext } = {}) {
  ensureDir(path.join(CONTEXTFS_ROOT, NAMESPACES.session));

  let gitContext = {};
  try {
    const { execSync } = require('child_process');
    const cwd = process.cwd();
    gitContext = {
      branch: branch || execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf8' }).trim(),
      lastCommits: execSync('git log --oneline -5', { cwd, encoding: 'utf8' }).trim().split('\n'),
      modifiedFiles: execSync('git diff --name-only HEAD~1 2>/dev/null || echo ""', { cwd, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
      status: execSync('git status --short', { cwd, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
    };
  } catch (_) {
    gitContext = { branch: branch || 'unknown', lastCommits: [], modifiedFiles: [], status: [] };
  }

  const primer = {
    id: `session_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    timestamp: nowIso(),
    project: project || path.basename(process.cwd()),
    git: gitContext,
    lastTask: lastTask || null,
    nextStep: nextStep || null,
    blockers: Array.isArray(blockers) ? blockers : (blockers ? [blockers] : []),
    openFiles: Array.isArray(openFiles) ? openFiles : [],
    customContext: customContext || null,
  };

  const primerPath = path.join(CONTEXTFS_ROOT, NAMESPACES.session, 'primer.json');
  fs.writeFileSync(primerPath, JSON.stringify(primer, null, 2));

  // Sync to primer.md if it exists
  const mdPrimerPath = path.join(process.cwd(), 'primer.md');
  if (fs.existsSync(mdPrimerPath)) {
    try {
      let md = fs.readFileSync(mdPrimerPath, 'utf8');
      if (primer.lastTask) {
        md = md.replace(/## Last Completed Task\n- .*/, `## Last Completed Task\n- ${primer.lastTask}`);
      }
      if (primer.nextStep) {
        md = md.replace(/## Exact Next Step\n- .*/, `## Exact Next Step\n- ${primer.nextStep}`);
      }
      if (primer.blockers.length > 0) {
        md = md.replace(/## Open Blockers\n(?:- .*\n)*/, `## Open Blockers\n${primer.blockers.map(b => `- ${b}`).join('\n')}\n`);
      }
      fs.writeFileSync(mdPrimerPath, md);
      
      // Trigger full memory refresh (Layer 3, 4, 5)
      const { execSync } = require('child_process');
      execSync('./bin/memory.sh', { stdio: 'ignore' });
    } catch (e) {
      console.error('Warning: Failed to sync to primer.md:', e.message);
    }
  }

  recordProvenance({
    action: 'session_handoff',
    source: 'session',
    detail: `Handoff: ${primer.lastTask || 'no task'} → ${primer.nextStep || 'no next step'}`,
  });

  return primer;
}

/**
 * Read the most recent session handoff primer.
 */
function readSessionHandoff() {
  const primerPath = path.join(CONTEXTFS_ROOT, NAMESPACES.session, 'primer.json');
  if (!fs.existsSync(primerPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(primerPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function constructTemplatedPack({ template, query } = {}) {
  const config = PACK_TEMPLATES[template];
  if (!config) {
    throw new Error(`Unknown pack template: "${template}". Available: ${Object.keys(PACK_TEMPLATES).join(', ')}`);
  }

  const fullQuery = `${config.queryPrefix} ${query || ''}`.trim();
  const pack = constructContextPack({
    query: fullQuery,
    namespaces: config.namespaces,
    maxItems: config.maxItems,
    maxChars: config.maxChars,
  });
  pack.template = template;
  return pack;
}

function listPackTemplates() {
  return Object.entries(PACK_TEMPLATES).map(([name, config]) => ({
    name,
    namespaces: config.namespaces,
    maxItems: config.maxItems,
    maxChars: config.maxChars,
    queryPrefix: config.queryPrefix,
  }));
}

module.exports = {
  CONTEXTFS_ROOT,
  NAMESPACES,
  ensureContextFs,
  recordProvenance,
  writeContextObject,
  upsertContextObject,
  registerFeedback,
  registerPreventionRules,
  normalizeNamespaces,
  constructContextPack,
  evaluateContextPack,
  getProvenance,
  readJsonl,
  DEFAULT_SEARCH_NAMESPACES,
  tokenizeQuery,
  querySimilarity,
  findSemanticCacheHit,
  getSemanticCacheConfig,
  buildIndexEntry,
  loadMemexIndex,
  dereferenceEntry,
  searchMemexIndex,
  constructMemexPack,
  writeSessionHandoff,
  readSessionHandoff,
  PACK_TEMPLATES,
  constructTemplatedPack,
  listPackTemplates,
};

if (require.main === module) {
  ensureContextFs();
  console.log(`ContextFS ready at ${CONTEXTFS_ROOT}`);
}
