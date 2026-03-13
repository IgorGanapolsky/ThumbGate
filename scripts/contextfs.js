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
    const existingMemory = findExistingContextObject({
      namespace,
      title: memoryRecord.title,
      content: memoryRecord.content,
      tags: memoryRecord.tags || [],
      source: 'feedback-memory',
    });

    if (existingMemory) {
      memory = {
        id: existingMemory.document.id,
        namespace,
        filePath: existingMemory.filePath,
        document: existingMemory.document,
        deduped: true,
      };

      recordProvenance({
        type: 'context_object_deduped',
        namespace,
        objectId: existingMemory.document.id,
        source: 'feedback-memory',
        metadata: {
          sourceFeedbackId: memoryRecord.sourceFeedbackId,
        },
      });
    } else {
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

/* ── Memex-style Indexed Memory ────────────────────────────────── */

const MEMEX_INDEX_FILE = 'memex-index.jsonl';

function getMemexIndexPath() {
  return path.join(CONTEXTFS_ROOT, NAMESPACES.provenance, MEMEX_INDEX_FILE);
}

function buildIndexEntry(doc, filePath) {
  return {
    id: doc.id,
    namespace: doc.namespace || '',
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
    .filter((entry) => !nsFilter || nsFilter.has(entry.namespace))
    .map((entry) => {
      const haystack = `${entry.title} ${entry.digest} ${(entry.tags || []).join(' ')}`.toLowerCase();
      let score = 0;
      tokens.forEach((t) => { if (t.length > 2 && haystack.includes(t)) score += 3; });
      if (entry.namespace.includes('memory/error')) score += 1;
      if (entry.namespace.includes('memory/learning')) score += 1;
      if (entry.createdAt) {
        const hours = (Date.now() - new Date(entry.createdAt).getTime()) / 3_600_000;
        if (Number.isFinite(hours)) {
          if (hours < 24) score += 2;
          else if (hours < 168) score += 1;
        }
      }
      return { entry, score };
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

  for (const hit of hits) {
    if (items.length >= maxItems) break;
    const full = dereferenceEntry(hit);
    if (!full) continue;

    const snippet = `${full.title}\n${full.content || ''}`;
    if (usedChars + snippet.length > maxChars) continue;

    const structuredContext = {
      rawContent: full.content || '',
      reasoning: null,
      whatWentWrong: null,
      whatToChange: null,
      rubricFailure: null
    };

    const lines = (full.content || '').split('\n');
    for (const line of lines) {
      if (line.startsWith('Reasoning:')) structuredContext.reasoning = line.replace('Reasoning:', '').trim();
      else if (line.startsWith('What went wrong:')) structuredContext.whatWentWrong = line.replace('What went wrong:', '').trim();
      else if (line.startsWith('How to avoid:')) structuredContext.whatToChange = line.replace('How to avoid:', '').trim();
      else if (line.startsWith('Rubric failing criteria:')) structuredContext.rubricFailure = line.replace('Rubric failing criteria:', '').trim();
    }

    items.push({
      id: full.id,
      namespace: hit.namespace,
      title: full.title,
      structuredContext,
      tags: full.tags || [],
      score: hit._score,
    });
    usedChars += snippet.length;
    dereferenced.push(hit.id);
  }

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

  const selected = [];
  let usedChars = 0;

  for (const item of candidates) {
    if (selected.length >= maxItems) break;

    const snippet = `${item.doc.title}\n${item.doc.content || ''}`;
    if (usedChars + snippet.length > maxChars) continue;

    // Context Structuralizer (EvoSkill Hardening)
    // Parse unstructured text back into a high-density State Document
    const structuredContext = {
      rawContent: item.doc.content || '',
      reasoning: null,
      whatWentWrong: null,
      whatToChange: null,
      rubricFailure: null
    };

    const lines = (item.doc.content || '').split('\n');
    for (const line of lines) {
      if (line.startsWith('Reasoning:')) structuredContext.reasoning = line.replace('Reasoning:', '').trim();
      else if (line.startsWith('What went wrong:')) structuredContext.whatWentWrong = line.replace('What went wrong:', '').trim();
      else if (line.startsWith('How to avoid:')) structuredContext.whatToChange = line.replace('How to avoid:', '').trim();
      else if (line.startsWith('Rubric failing criteria:')) structuredContext.rubricFailure = line.replace('Rubric failing criteria:', '').trim();
    }

    selected.push({
      id: item.doc.id,
      namespace: item.doc.namespace,
      title: item.doc.title,
      structuredContext,
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
    namespaces: normalizedNamespaces,
    createdAt: nowIso(),
    items: selected,
    cache: {
      hit: false,
    },
    sourceHash,
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
  tokenizeQuery,
  querySimilarity,
  findSemanticCacheHit,
  getSemanticCacheConfig,
  buildIndexEntry,
  loadMemexIndex,
  dereferenceEntry,
  searchMemexIndex,
  constructMemexPack,
};

if (require.main === module) {
  ensureContextFs();
  console.log(`ContextFS ready at ${CONTEXTFS_ROOT}`);
}
