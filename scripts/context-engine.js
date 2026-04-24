/**
 * Context Engine
 *
 * Inspired by Dropbox Dash's architecture for intelligent context retrieval.
 * Pre-computes knowledge bundles from project docs, routes queries to relevant
 * context, scores retrieval quality, and manages prompt templates.
 *
 * Key insight: instead of agents reading 100+ docs at runtime, pre-compute
 * topical bundles and route queries to the most relevant subset. This reduces
 * MCP tool calls and context window consumption.
 *
 * Context assembly engine for ThumbGate feedback memory.
 * PATH: PROJECT_ROOT = path.join(__dirname, '..') — 1 level up from scripts/
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { constructContextPack } = require('./contextfs');
const { ensureDir } = require('./fs-utils');

// ---------------------------------------------------------------------------
// Default paths
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_DOCS_DIR = path.join(PROJECT_ROOT, 'docs');
const CONTEXT_ENGINE_DIR = path.join(PROJECT_ROOT, '.claude', 'context-engine');
const DEFAULT_INDEX_PATH = path.join(CONTEXT_ENGINE_DIR, 'knowledge-index.json');
const DEFAULT_QUALITY_LOG_PATH = path.join(CONTEXT_ENGINE_DIR, 'quality-log.json');
const DEFAULT_REGISTRY_PATH = path.join(CONTEXT_ENGINE_DIR, 'prompt-registry.json');

// ---------------------------------------------------------------------------
// Category detection rules (from filename patterns)
// ---------------------------------------------------------------------------

// Order: specific domain rules first, broader categories last.
// This prevents "ANDROID_BUILD" matching BUILD→ci-cd before ANDROID→mobile-dev.
const CATEGORY_RULES = [
  { category: 'mobile-dev', pattern: /ANDROID|IOS|EXPO|TURBOMODULE|DEVICE|METRO|MMKV/i },
  { category: 'mcp-ai', pattern: /MCP|CONTEXT7|CLAUDE|AGENTIC|AGENT|(?:^|_)AI(?:_|\.)|MEMORY/i },
  { category: 'security', pattern: /SECURITY|CVE|CODEQL|INJECTION|AUDIT|PERMISSION/i },
  { category: 'testing', pattern: /TEST|COVERAGE|REASSURE|RNTL|MAESTRO|PERF/i },
  { category: 'ado-git', pattern: /(?:^|_)ADO(?:_|\.)|AZURE|PR_|SQUASH|BRANCH|GITFLOW|GIT_/i },
  { category: 'architecture', pattern: /ARCHITECTURE|FEATURE|PROJECT_STRUCTURE|PLUGIN|REDUX|CART/i },
  { category: 'ci-cd', pattern: /(?:^|_)CI(?:_|\.)|(?:^|_)CD(?:_|\.)|BUILD|WORKFLOW|PIPELINE|FIREBASE|(?:^|_)ACT(?:_|\.)/i },
];

// ---------------------------------------------------------------------------
// MCP Consolidation Manifest
// ---------------------------------------------------------------------------

const TOOL_CONSOLIDATION = {
  'context:retrieve': {
    sources: ['context7', 'knowledge-index'],
    description: 'Unified context retrieval',
  },
  'memory:query': {
    sources: ['jsonl-memory', 'lancedb-vectors'],
    description: 'Unified memory access',
  },
  'quality:check': {
    sources: ['sonarqube', 'eslint', 'jest'],
    description: 'Unified quality gate',
  },
  'docs:lookup': {
    sources: ['context7', 'knowledge-bundles'],
    description: 'Documentation lookup',
  },
};

// ---------------------------------------------------------------------------
// Utility: ensure directory exists
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Knowledge Bundle Builder
// ---------------------------------------------------------------------------

/**
 * Determine the category for a doc file based on its filename.
 *
 * @param {string} filename - The filename (e.g., "CI_FIXES.md")
 * @returns {string} Category string (e.g., "ci-cd", "testing", "general")
 */
function categorizeDoc(filename) {
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(filename)) {
      return rule.category;
    }
  }
  return 'general';
}

/**
 * Extract a summary from a markdown file: title + first 3 non-empty lines after it.
 *
 * @param {string} filePath - Absolute path to the markdown file
 * @returns {{ title: string, summary: string }} Extracted title and summary
 */
function extractDocSummary(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return { title: path.basename(filePath, '.md'), summary: '' };
  }

  const lines = content.split('\n');
  let title = path.basename(filePath, '.md');
  let titleLineIndex = -1;

  // Find first heading line
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('#')) {
      title = trimmed.replace(/^#+\s*/, '');
      titleLineIndex = i;
      break;
    }
  }

  // Collect first 3 non-empty lines after the title
  const summaryLines = [];
  const startIdx = titleLineIndex + 1;
  for (let i = startIdx; i < lines.length && summaryLines.length < 3; i++) {
    const trimmed = lines[i].trim();
    if (trimmed && !trimmed.startsWith('#')) {
      summaryLines.push(trimmed);
    }
  }

  return { title, summary: summaryLines.join(' ') };
}

/**
 * Scan a docs directory and build a pre-computed knowledge index.
 *
 * Groups markdown files into topical bundles by category, extracts titles
 * and summaries, and writes the index to disk for fast runtime lookup.
 *
 * @param {string} [docsDir] - Path to the docs directory (default: project docs/)
 * @param {string} [outputPath] - Path to write the index JSON (default: .claude/context-engine/knowledge-index.json)
 * @returns {{ bundles: object, totalDocs: number, generatedAt: string }} The generated index
 */
function buildKnowledgeIndex(docsDir, outputPath) {
  const docs = docsDir || DEFAULT_DOCS_DIR;
  const output = outputPath || DEFAULT_INDEX_PATH;
  const bundles = {};

  // Scan for .md files
  let files;
  try {
    files = fs.readdirSync(docs).filter((f) => f.endsWith('.md'));
  } catch {
    files = [];
  }

  for (const file of files) {
    const filePath = path.join(docs, file);
    const category = categorizeDoc(file);
    const { title, summary } = extractDocSummary(filePath);

    if (!bundles[category]) {
      bundles[category] = {
        category,
        docs: [],
        keywords: [],
      };
    }

    const doc = {
      filename: file,
      title,
      summary,
    };

    bundles[category].docs.push(doc);

    // Extract keywords from title and filename
    const words = `${title} ${file.replace(/[._-]/g, ' ')}`
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2 && w !== 'md');

    for (const word of words) {
      if (!bundles[category].keywords.includes(word)) {
        bundles[category].keywords.push(word);
      }
    }
  }

  const index = {
    bundles,
    metadata: {
      builtAt: new Date().toISOString(),
      docCount: files.length,
      version: '1.0.0',
      checksum: crypto
        .createHash('sha256')
        .update(JSON.stringify(bundles))
        .digest('hex')
        .slice(0, 12),
    },
  };

  // Persist to disk
  try {
    ensureDir(path.dirname(output));
    fs.writeFileSync(output, JSON.stringify(index, null, 2));
  } catch {
    // Non-critical — index still returned in memory
  }

  return index;
}

// ---------------------------------------------------------------------------
// Context Router
// ---------------------------------------------------------------------------

/**
 * Score a single bundle against a set of query tokens.
 *
 * Counts how many query tokens match the bundle's keywords, then normalizes
 * by bundle size to avoid large bundles always winning.
 *
 * @param {string[]} queryTokens - Lowercased query words
 * @param {{ keywords: string[], docs: object[] }} bundle - A knowledge bundle
 * @returns {number} Relevance score (higher is better)
 */
function scoreBundle(queryTokens, bundle) {
  if (!bundle.keywords.length || !queryTokens.length) return 0;

  let matches = 0;
  for (const token of queryTokens) {
    for (const keyword of bundle.keywords) {
      if (keyword.includes(token) || token.includes(keyword)) {
        matches++;
        break; // Count each token at most once
      }
    }
  }

  // Normalize: raw matches / sqrt(bundle size) to balance precision vs. recall
  const bundleSize = bundle.docs.length || 1;
  return matches / Math.sqrt(bundleSize);
}

/**
 * Route a natural-language query to the most relevant knowledge bundles.
 *
 * Replaces multiple MCP tool calls with a single pre-computed lookup.
 *
 * @param {string} query - Natural-language query (e.g., "How do I fix Android build errors?")
 * @param {string} [indexPath] - Path to the knowledge index JSON
 * @param {number} [topN=3] - Number of top bundles to return
 * @returns {{ query: string, results: object[] }} Top-N bundles with scores and doc references
 */
/**
 * Base routing logic for bundles.
 */
function baseRouteQuery(query, index, topN) {
  const queryTokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const scored = Object.entries(index.bundles)
    .map(([category, bundle]) => ({
      category,
      score: scoreBundle(queryTokens, bundle),
      docs: bundle.docs,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  return scored;
}

/**
 * Adaptive Retrieval Loop (Agentic RAG)
 * 
 * Step 1: Analyze query to expand tokens or identify intent.
 * Step 2: Perform retrieval with boosted weights for intent-matching categories.
 */
function routeQuery(query, indexPath, topN) {
  const idxPath = indexPath || DEFAULT_INDEX_PATH;
  const n = topN || 3;

  // Load index
  let index;
  try {
    index = JSON.parse(fs.readFileSync(idxPath, 'utf-8'));
  } catch {
    index = buildKnowledgeIndex(undefined, idxPath);
  }

  // Step 1: Intent Detection (Simple heuristic for now, can be LLM-backed)
  const lowerQuery = query.toLowerCase();
  let intentBoost = null;
  if (lowerQuery.includes('test') || lowerQuery.includes('jest')) intentBoost = 'testing';
  if (lowerQuery.includes('build') || lowerQuery.includes('ci')) intentBoost = 'ci-cd';
  if (lowerQuery.includes('security') || lowerQuery.includes('audit')) intentBoost = 'security';
  if (lowerQuery.includes('mobile') || lowerQuery.includes('android')) intentBoost = 'mobile-dev';
  if (lowerQuery.includes('memory') || lowerQuery.includes('thumbgate')) intentBoost = 'mcp-ai';

  // Step 2: Contextual Ranking
  const queryTokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const scored = Object.entries(index.bundles)
    .map(([category, bundle]) => {
      let score = scoreBundle(queryTokens, bundle);
      
      // Boost score if intent matches category
      if (intentBoost && category === intentBoost) {
        score *= 1.5; 
      }

      return {
        category,
        score,
        docs: bundle.docs,
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);

  // Recursive Retrieval (EvoSkill Hardening)
  // Drill down to get high-density structured state documents
  let denseContext = null;
  if (scored.length > 0) {
    try {
      denseContext = constructContextPack({
        query,
        maxItems: 3,
        namespaces: ['rules', 'memoryLearning', 'memoryError']
      });
    } catch (err) {
      // Graceful fallback if contextfs is unavailable
    }
  }

  return {
    query,
    intent: intentBoost,
    results: scored,
    denseContext: denseContext ? denseContext.items : [],
    indexAge: index.metadata && index.metadata.builtAt,
    retrievalType: intentBoost ? 'adaptive' : 'base',
  };
}

// ---------------------------------------------------------------------------
// Quality Scorer
// ---------------------------------------------------------------------------

/**
 * Score retrieval quality by comparing retrieved docs against expected topics.
 *
 * Uses a precision/recall-style metric:
 * - Precision: what fraction of retrieved docs are relevant to expected topics?
 * - Recall: what fraction of expected topics are covered by retrieved docs?
 *
 * @param {string} query - The original query
 * @param {string[]} retrievedDocs - Filenames of retrieved docs
 * @param {string[]} expectedTopics - Expected topic keywords to match against
 * @param {string} [logPath] - Optional path for the quality log
 * @returns {{ precision: number, recall: number, f1: number, query: string, timestamp: string }}
 */
function scoreRetrievalQuality(query, retrievedDocs, expectedTopics, logPath) {
  if (!retrievedDocs.length || !expectedTopics.length) {
    const result = {
      query,
      precision: 0,
      recall: 0,
      f1: 0,
      retrievedCount: retrievedDocs.length,
      expectedCount: expectedTopics.length,
      timestamp: new Date().toISOString(),
    };
    logQualityResult(result, logPath);
    return result;
  }

  const normalizedDocs = retrievedDocs.map((d) => d.toLowerCase());
  const normalizedTopics = expectedTopics.map((t) => t.toLowerCase());

  // Precision: how many retrieved docs match at least one expected topic?
  let relevantRetrieved = 0;
  for (const doc of normalizedDocs) {
    for (const topic of normalizedTopics) {
      if (doc.includes(topic) || topic.includes(doc.replace('.md', ''))) {
        relevantRetrieved++;
        break;
      }
    }
  }
  const precision = relevantRetrieved / normalizedDocs.length;

  // Recall: how many expected topics are covered by at least one retrieved doc?
  let topicsCovered = 0;
  for (const topic of normalizedTopics) {
    for (const doc of normalizedDocs) {
      if (doc.includes(topic) || topic.includes(doc.replace('.md', ''))) {
        topicsCovered++;
        break;
      }
    }
  }
  const recall = topicsCovered / normalizedTopics.length;

  // F1 harmonic mean
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  const result = {
    query,
    precision: Math.round(precision * 1000) / 1000,
    recall: Math.round(recall * 1000) / 1000,
    f1: Math.round(f1 * 1000) / 1000,
    retrievedCount: retrievedDocs.length,
    expectedCount: expectedTopics.length,
    timestamp: new Date().toISOString(),
  };

  logQualityResult(result, logPath);
  return result;
}

/**
 * Append a quality result to the JSONL quality log.
 *
 * @param {object} result - Quality score result object
 * @param {string} [logPath] - Path to the quality log file
 */
function logQualityResult(result, logPath) {
  const log = logPath || DEFAULT_QUALITY_LOG_PATH;
  const entry = { ...result };

  // Ensure timestamp is always present
  if (!entry.timestamp) {
    entry.timestamp = new Date().toISOString();
  }

  try {
    ensureDir(path.dirname(log));
    fs.appendFileSync(log, JSON.stringify(entry) + '\n');
  } catch {
    // Non-critical — scoring still works without persistence
  }
}

// ---------------------------------------------------------------------------
// Prompt Registry
// ---------------------------------------------------------------------------

/**
 * Load the prompt registry from disk.
 *
 * @param {string} [registryPath] - Path to the registry JSON
 * @returns {object} Map of prompt name → { template, metadata }
 */
function loadRegistry(registryPath) {
  const reg = registryPath || DEFAULT_REGISTRY_PATH;
  try {
    if (fs.existsSync(reg)) {
      return JSON.parse(fs.readFileSync(reg, 'utf-8'));
    }
  } catch {
    // Corrupted file — start fresh
  }
  return {};
}

/**
 * Save the prompt registry to disk.
 *
 * @param {object} registry - The full registry object
 * @param {string} [registryPath] - Path to the registry JSON
 */
function saveRegistry(registry, registryPath) {
  const reg = registryPath || DEFAULT_REGISTRY_PATH;
  try {
    ensureDir(path.dirname(reg));
    fs.writeFileSync(reg, JSON.stringify(registry, null, 2));
  } catch {
    // Non-critical — registry still works in memory
  }
}

/**
 * Register a prompt template with version and model compatibility metadata.
 *
 * @param {string} name - Unique prompt name (e.g., "code-review-system")
 * @param {string} template - The prompt template string
 * @param {{ version: string, models: string[], category: string }} metadata - Prompt metadata
 * @param {string} [registryPath] - Path to the registry JSON
 * @returns {{ name: string, registered: boolean }} Registration result
 */
function registerPrompt(name, template, metadata, registryPath) {
  const registry = loadRegistry(registryPath);

  // Support both metadata.models (array) and metadata.model (single string)
  let models = [];
  if (metadata && metadata.models) {
    models = metadata.models;
  } else if (metadata && metadata.model) {
    models = [metadata.model];
  }

  registry[name] = {
    template,
    metadata: {
      version: (metadata && metadata.version) || '1.0.0',
      models,
      category: (metadata && metadata.category) || 'general',
      lastUpdated: new Date().toISOString(),
    },
  };

  saveRegistry(registry, registryPath);
  return { name, registered: true };
}

/**
 * Retrieve a registered prompt, optionally filtering by model compatibility.
 *
 * @param {string} name - Prompt name to look up
 * @param {string} [modelId] - Optional model ID to check compatibility
 * @param {string} [registryPath] - Path to the registry JSON
 * @returns {{ name: string, template: string, metadata: object, compatible: boolean }|null}
 */
function getPrompt(name, modelId, registryPath) {
  const registry = loadRegistry(registryPath);
  const entry = registry[name];

  if (!entry) return null;

  const compatible =
    !modelId || !entry.metadata.models.length || entry.metadata.models.includes(modelId);

  // If a specific model was requested and it's not compatible, return null
  if (modelId && entry.metadata.models.length > 0 && !entry.metadata.models.includes(modelId)) {
    return null;
  }

  return {
    name,
    template: entry.template,
    metadata: entry.metadata,
    compatible,
  };
}

/**
 * List all registered prompts with their metadata.
 *
 * @param {string} [registryPath] - Path to the registry JSON
 * @returns {{ name: string, metadata: object }[]} Array of prompt entries
 */
function listPrompts(registryPath) {
  const registry = loadRegistry(registryPath);

  return Object.entries(registry).map(([name, entry]) => ({
    name,
    metadata: entry.metadata,
  }));
}

// ---------------------------------------------------------------------------
// Adaptive Context Compaction (OpenDev 5-stage algorithm)
// ---------------------------------------------------------------------------

/**
 * Compact a set of feedback entries using a 5-stage progressive algorithm.
 *
 * Stage 1: Group by signal type, keep top 10 per group
 * Stage 2: Truncate large text fields to perEntryMaxChars
 * Stage 3: Drop entries missing both context and whatWentWrong
 * Stage 4: Window to most recent windowSize (anchors preserved)
 * Stage 5: Deduplicate entries with identical whatWentWrong
 *
 * @param {object[]} entries - Feedback log entries
 * @param {object[]} [anchors=[]] - Anchor entries to always preserve
 * @param {{ windowSize?: number, perEntryMaxChars?: number }} [opts={}]
 * @returns {{ entries: object[], stage: number, removedCount: number, compacted: boolean }}
 */
function compactContext(entries, anchors, opts) {
  const anchorIds = new Set((anchors || []).map((a) => a.id));
  const options = opts || {};
  const windowSize = typeof options.windowSize === 'number' ? options.windowSize : 30;
  const perEntryMaxChars = typeof options.perEntryMaxChars === 'number' ? options.perEntryMaxChars : 512;

  const anchorEntries = entries.filter((e) => anchorIds.has(e.id));
  let working = entries.filter((e) => !anchorIds.has(e.id));
  const initial = working.length;

  // Stage 1: Group by signal, keep most recent 10 per signal type
  const bySignal = {};
  for (const entry of working) {
    const sig = entry.signal || 'unknown';
    if (!bySignal[sig]) bySignal[sig] = [];
    bySignal[sig].push(entry);
  }
  working = Object.values(bySignal).flatMap((group) => group.slice(-10));

  // Stage 2: Truncate large text fields
  working = working.map((entry) => {
    const truncated = { ...entry };
    if (truncated.context && truncated.context.length > perEntryMaxChars) {
      truncated.context = truncated.context.slice(0, perEntryMaxChars);
    }
    if (truncated.whatWentWrong && truncated.whatWentWrong.length > perEntryMaxChars) {
      truncated.whatWentWrong = truncated.whatWentWrong.slice(0, perEntryMaxChars);
    }
    return truncated;
  });

  // Stage 3: Drop low-information entries (empty context AND empty whatWentWrong)
  working = working.filter(
    (e) => (e.context && e.context.trim()) || (e.whatWentWrong && e.whatWentWrong.trim()),
  );

  // Stage 4: Window to most recent N
  if (working.length > windowSize) {
    working = working.slice(-windowSize);
  }

  // Stage 5: Deduplicate by whatWentWrong fingerprint
  const seen = new Set();
  working = working.filter((e) => {
    const key = e.whatWentWrong ? e.whatWentWrong.trim().toLowerCase() : null;
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Stage 6: Global token budget — drop entries (oldest first) until total chars fit
  let finalStage = 5;
  const totalMaxChars = typeof options.totalMaxChars === 'number' ? options.totalMaxChars : null;
  if (totalMaxChars !== null) {
    let budget = totalMaxChars;
    const budgeted = [];
    // Iterate newest-first so most recent entries are preserved
    for (let i = working.length - 1; i >= 0; i--) {
      const entrySize = JSON.stringify(working[i]).length;
      if (budget - entrySize < 0) break;
      budget -= entrySize;
      budgeted.unshift(working[i]);
    }
    if (budgeted.length < working.length) {
      working = budgeted;
      finalStage = 6;
    }
  }

  const removedCount = initial - working.length;
  return {
    entries: [...anchorEntries, ...working],
    stage: finalStage,
    removedCount,
    compacted: removedCount > 0,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Knowledge Bundle Builder
  buildKnowledgeIndex,
  categorizeDoc,
  extractDocSummary,

  // Context Router
  routeQuery,
  scoreBundle,

  // Quality Scorer
  scoreRetrievalQuality,
  logQualityResult,

  // Prompt Registry
  registerPrompt,
  getPrompt,
  listPrompts,

  // Adaptive Context Compaction
  compactContext,

  // MCP Consolidation Manifest
  TOOL_CONSOLIDATION,

  // Constants (for testing / external use)
  CATEGORY_RULES,
  DEFAULT_INDEX_PATH,
  DEFAULT_QUALITY_LOG_PATH,
  DEFAULT_REGISTRY_PATH,
};
