'use strict';
/**
 * Hybrid Feedback Context — Pre-Tool Guard Engine (ATTR-02)
 *
 * Builds attributed feedback state from multiple JSONL sources and compiles
 * it into a fast guard artifact for pre-tool execution decisions:
 *   block  — attributed negative patterns exceed threshold
 *   warn   — soft negative signal; proceed with caution
 *   allow  — no matching negative patterns (default)
 *
 * Exports:
 *   buildHybridState, evaluatePretool, compileGuardArtifact,
 *   writeGuardArtifact, readGuardArtifact, evaluateCompiledGuards,
 *   evaluatePretoolFromState, deriveConstraints, buildAdditionalContext
 */

const fs = require('fs');
const path = require('path');
const { resolveFeedbackDir } = require('./feedback-paths');
const { readJsonl } = require('./fs-utils');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function getHybridPaths(options = {}) {
  const feedbackDir = resolveFeedbackDir({
    cwd: options.cwd,
    env: options.env,
    feedbackDir: options.feedbackDir,
    home: options.home,
  });
  return {
    feedbackDir,
    feedbackLog: path.join(feedbackDir, 'feedback-log.jsonl'),
    inbox: path.join(feedbackDir, 'inbox.jsonl'),
    pendingSync: path.join(feedbackDir, 'pending_cortex_sync.jsonl'),
    attributedFeedback: path.join(feedbackDir, 'attributed-feedback.jsonl'),
    guardArtifact: path.join(feedbackDir, 'pretool-guards.json'),
  };
}

const PATHS = getHybridPaths();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'the', 'and', 'for', 'was', 'with', 'from', 'that', 'this', 'are', 'have',
  'has', 'had', 'not', 'but', 'they', 'you', 'can', 'will', 'all', 'any',
  'one', 'its', 'our', 'also', 'more', 'very', 'just', 'into', 'been',
  'bash', 'edit', 'write', 'tool', 'hook', 'clear',
]);

const NEG = new Set([
  'negative', 'thumbsdown', 'thumbs_down', 'thumbs-down', 'down', 'bad',
  'wrong', 'error', 'fail', 'failed', 'failure', 'mistake', 'bug', 'broken',
]);

const POS = new Set([
  'positive', 'thumbsup', 'thumbs_up', 'thumbs-up', 'up', 'good', 'correct',
  'success', 'pass', 'passed', 'great', 'excellent', 'perfect', 'works',
]);

const HYBRID_JSONL_READ_LIMIT = 400;

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

/**
 * Normalize text: strip /Users/ paths, port numbers, lowercase.
 */
function normalize(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/\/Users\/[^\s/]+/g, '/Users/redacted')
    .replace(/:\d{4,5}\b/g, ':PORT')
    .toLowerCase()
    .trim();
}

/**
 * Strip common feedback prefix tokens from a string.
 */
function stripFeedbackPrefix(text) {
  if (!text) return '';
  return text
    .replace(/^(thumbs?\s*(up|down)\s*:?\s*)/i, '')
    .replace(/^(positive|negative)\s*(feedback)?\s*:?\s*/i, '')
    .replace(/^(good|bad|wrong|error|fail(ed|ure)?)\s*:?\s*/i, '')
    .trim();
}

/**
 * Compose normalize + stripFeedbackPrefix.
 */
function normalizePatternText(text) {
  return normalize(stripFeedbackPrefix(text));
}

/**
 * Infer tool name from raw name or context keywords.
 */
function inferToolName(rawToolName, context) {
  if (rawToolName && rawToolName !== 'unknown') return rawToolName;
  const ctx = (context || '').toLowerCase();
  if (ctx.includes('bash') || ctx.includes('command') || ctx.includes('shell')) return 'Bash';
  if (ctx.includes('edit') || ctx.includes('patch') || ctx.includes('replace')) return 'Edit';
  if (ctx.includes('write') || ctx.includes('create file') || ctx.includes('overwrite')) return 'Write';
  if (ctx.includes('read') || ctx.includes('cat ') || ctx.includes('view file')) return 'Read';
  if (ctx.includes('search') || ctx.includes('grep') || ctx.includes('find')) return 'Grep';
  if (ctx.includes('glob') || ctx.includes('list files')) return 'Glob';
  return rawToolName || 'unknown';
}

/**
 * Classify an entry as 'positive', 'negative', or 'neutral'.
 */
function classify(entry) {
  const raw = String(entry.signal || entry.feedback || '').toLowerCase().trim();
  if (NEG.has(raw)) return 'negative';
  if (POS.has(raw)) return 'positive';
  return 'neutral';
}

/**
 * Extract ms from a timestamp value. Returns 0 on failure.
 */
function getTimestampMs(value) {
  if (!value) return 0;
  const ms = Date.parse(value);
  return isNaN(ms) ? 0 : ms;
}

/**
 * Extract meaningful keywords from text.
 * min 4 chars, no stopwords, max 8 tokens.
 */
function keywords(text) {
  if (!text) return [];
  const tokens = normalize(text)
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
  return [...new Set(tokens)].slice(0, 8);
}

/**
 * FNV-1a 32-bit hash.
 */
function hashText(text) {
  let hash = 2166136261;
  const str = String(text || '');
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// buildHybridState
// ---------------------------------------------------------------------------

/**
 * Build hybrid state by reading from all JSONL sources.
 *
 * @param {Object} opts
 * @param {string} [opts.feedbackLogPath]
 * @param {string} [opts.inboxPath]
 * @param {string} [opts.pendingSyncPath]
 * @param {string} [opts.attributedFeedbackPath]
 * @returns {Object} state
 */
function buildHybridState(opts) {
  const o = opts || {};
  const paths = getHybridPaths(o);
  const feedbackLogPath = o.feedbackLogPath || process.env.THUMBGATE_FEEDBACK_LOG || paths.feedbackLog;
  const inboxPath = o.inboxPath || process.env.THUMBGATE_FEEDBACK_INBOX || paths.inbox;
  const pendingSyncPath = o.pendingSyncPath || process.env.THUMBGATE_PENDING_SYNC || paths.pendingSync;
  const attributedFeedbackPath = o.attributedFeedbackPath || process.env.THUMBGATE_ATTRIBUTED_FEEDBACK || paths.attributedFeedback;

  const feedbackEntries = readJsonl(feedbackLogPath, HYBRID_JSONL_READ_LIMIT);
  const inboxEntries = readJsonl(inboxPath, HYBRID_JSONL_READ_LIMIT);
  const pendingSyncEntries = readJsonl(pendingSyncPath, HYBRID_JSONL_READ_LIMIT);
  const attributedEntries = readJsonl(attributedFeedbackPath, HYBRID_JSONL_READ_LIMIT);

  // Deduplicate by id across all sources
  const seen = new Set();
  const allEntries = [];
  for (const entry of [...feedbackEntries, ...inboxEntries, ...pendingSyncEntries]) {
    const key = entry.id || hashText(JSON.stringify(entry));
    if (!seen.has(key)) {
      seen.add(key);
      allEntries.push(entry);
    }
  }

  // Build counts
  let total = 0;
  let positive = 0;
  let negative = 0;
  const patternMap = {}; // normalized text -> { count, lastSeen, sources, text }
  const toolNegatives = {}; // toolName -> count
  const toolNegativesAttributed = {}; // toolName -> count (from attributed only)

  for (const entry of allEntries) {
    total++;
    const cls = classify(entry);
    if (cls === 'positive') positive++;
    if (cls === 'negative') {
      negative++;
      // Track tool-level negative counts
      const toolName = inferToolName(entry.toolName || entry.tool_name || 'unknown', entry.context || '');
      toolNegatives[toolName] = (toolNegatives[toolName] || 0) + 1;

      // Build pattern from context / whatWentWrong / what_went_wrong
      const rawText = [
        entry.context || '',
        entry.whatWentWrong || entry.what_went_wrong || '',
        entry.whatToChange || entry.what_to_change || '',
        entry.failureType || '',
        ...(Array.isArray(entry.tags) ? entry.tags : []),
        ...(entry.richContext && Array.isArray(entry.richContext.filePaths) ? entry.richContext.filePaths : []),
        ...(entry.structuredRule && entry.structuredRule.metadata && Array.isArray(entry.structuredRule.metadata.filesInvolved)
          ? entry.structuredRule.metadata.filesInvolved
          : []),
        entry.structuredRule && entry.structuredRule.action ? entry.structuredRule.action.description || '' : '',
        entry.structuredRule && entry.structuredRule.trigger ? entry.structuredRule.trigger.condition || '' : '',
        entry.richContext && entry.richContext.enforcement
          ? [
            entry.richContext.enforcement.scopeViolation ? 'scope violation' : '',
            entry.richContext.enforcement.approvalFailure ? 'approval failure' : '',
            entry.richContext.enforcement.protectedFileViolation ? 'protected file violation' : '',
          ].join(' ')
          : '',
      ].join(' ');
      const norm = normalizePatternText(rawText);
      if (!norm) continue;
      const words = keywords(norm);
      if (words.length < 2) continue; // need at least 2 meaningful words
      const patKey = words.slice(0, 4).join('_');
      if (!patternMap[patKey]) {
        patternMap[patKey] = { count: 0, lastSeen: 0, sources: [], text: norm, words };
      }
      patternMap[patKey].count++;
      const ts = getTimestampMs(entry.timestamp);
      if (ts > patternMap[patKey].lastSeen) patternMap[patKey].lastSeen = ts;
      patternMap[patKey].sources.push('feedbackLog');
    }
  }

  // Process attributed feedback separately to track attributed tool counts
  for (const entry of attributedEntries) {
    const toolName = inferToolName(entry.toolName || entry.tool_name || entry.attributed_tool || 'unknown', entry.context || '');
    toolNegativesAttributed[toolName] = (toolNegativesAttributed[toolName] || 0) + 1;

    const rawText = [
      entry.context || '',
      entry.whatWentWrong || entry.what_went_wrong || '',
      ...(Array.isArray(entry.tags) ? entry.tags : []),
      ...(entry.richContext && Array.isArray(entry.richContext.filePaths) ? entry.richContext.filePaths : []),
      ...(entry.structuredRule && entry.structuredRule.metadata && Array.isArray(entry.structuredRule.metadata.filesInvolved)
        ? entry.structuredRule.metadata.filesInvolved
        : []),
      entry.structuredRule && entry.structuredRule.action ? entry.structuredRule.action.description || '' : '',
      entry.structuredRule && entry.structuredRule.trigger ? entry.structuredRule.trigger.condition || '' : '',
      entry.richContext && entry.richContext.enforcement
        ? [
          entry.richContext.enforcement.scopeViolation ? 'scope violation' : '',
          entry.richContext.enforcement.approvalFailure ? 'approval failure' : '',
          entry.richContext.enforcement.protectedFileViolation ? 'protected file violation' : '',
        ].join(' ')
        : '',
    ].join(' ');
    const norm = normalizePatternText(rawText);
    if (!norm) continue;
    const words = keywords(norm);
    if (words.length < 2) continue;
    const patKey = words.slice(0, 4).join('_');
    if (!patternMap[patKey]) {
      patternMap[patKey] = { count: 0, lastSeen: 0, sources: [], text: norm, words };
    }
    // Mark as attributed source (prefer over raw feedbackLog)
    if (!patternMap[patKey].sources.includes('attributedFeedback')) {
      patternMap[patKey].sources.push('attributedFeedback');
    }
    patternMap[patKey].count++;
    const ts = getTimestampMs(entry.timestamp);
    if (ts > patternMap[patKey].lastSeen) patternMap[patKey].lastSeen = ts;
  }

  // Recurring = count >= 2
  const recurringNegativePatterns = Object.values(patternMap)
    .filter((p) => p.count >= 2)
    .sort((a, b) => b.count - a.count);

  // Prevention rules from feedbackLog (whatToChange fields)
  const preventionRules = allEntries
    .filter((e) => classify(e) === 'negative' && (e.whatToChange || e.what_to_change))
    .map((e) => normalize(e.whatToChange || e.what_to_change))
    .filter(Boolean);

  return {
    counts: { total, positive, negative },
    recurringNegativePatterns,
    preventionRules,
    negativeToolCounts: toolNegatives,
    negativeToolCountsAttributed: toolNegativesAttributed,
  };
}

// ---------------------------------------------------------------------------
// deriveConstraints
// ---------------------------------------------------------------------------

/**
 * Produce up to `max` actionable constraint strings from recurring patterns.
 *
 * @param {Object} state - from buildHybridState()
 * @param {number} [max=5]
 * @returns {string[]}
 */
function deriveConstraints(state, max) {
  const limit = max !== undefined ? max : 5;
  const constraints = [];

  // Top recurring patterns become constraints
  for (const pattern of (state.recurringNegativePatterns || []).slice(0, limit)) {
    const truncated = pattern.text.length > 100 ? pattern.text.slice(0, 100) + '...' : pattern.text;
    constraints.push(`Avoid: "${truncated}" (seen ${pattern.count}x)`);
  }

  // Prevention rules fill remaining slots
  const remaining = limit - constraints.length;
  for (const rule of (state.preventionRules || []).slice(0, remaining)) {
    const truncated = rule.length > 100 ? rule.slice(0, 100) + '...' : rule;
    constraints.push(`Rule: ${truncated}`);
  }

  return constraints.slice(0, limit);
}

// ---------------------------------------------------------------------------
// buildAdditionalContext
// ---------------------------------------------------------------------------

/**
 * Format a single summary string for pre-tool context injection.
 *
 * @param {Object} state
 * @param {string[]} constraints
 * @param {number} [maxChars=800]
 * @returns {string}
 */
function buildAdditionalContext(state, constraints, maxChars) {
  const limit = maxChars !== undefined ? maxChars : 800;
  const { counts } = state;
  const lines = [
    `Feedback history: ${counts.total} total (${counts.positive} positive, ${counts.negative} negative)`,
    `Recurring patterns: ${(state.recurringNegativePatterns || []).length}`,
  ];
  if (constraints && constraints.length > 0) {
    lines.push('Active constraints:');
    constraints.forEach((c) => lines.push(`  - ${c}`));
  }
  let result = lines.join('\n');
  if (result.length > limit) {
    result = result.slice(0, limit - 3) + '...';
  }
  return result;
}

// ---------------------------------------------------------------------------
// hasTwoKeywordHits
// ---------------------------------------------------------------------------

/**
 * Require 2+ keyword matches to reduce false positives (ATTR-03 no-false-positive invariant).
 *
 * @param {string} normalizedInput
 * @param {string[]} words - keyword list from a pattern
 * @returns {boolean}
 */
function hasTwoKeywordHits(normalizedInput, words) {
  if (!normalizedInput || !words || words.length === 0) return false;
  let hits = 0;
  for (const word of words) {
    if (normalizedInput.includes(word)) {
      hits++;
      if (hits >= 2) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// compileGuardArtifact
// ---------------------------------------------------------------------------

/**
 * Build deduped guards array from state.
 * Prefers patterns sourced from attributedFeedback. Assigns block/warn mode.
 *
 * @param {Object} state - from buildHybridState()
 * @param {Object} [opts]
 * @param {number} [opts.blockThreshold=3] - count >= this → block
 * @returns {Object} artifact
 */
function compileGuardArtifact(state, opts) {
  const o = opts || {};
  const blockThreshold = o.blockThreshold !== undefined ? o.blockThreshold : 3;

  const guards = [];
  const seenHashes = new Set();

  for (const pattern of state.recurringNegativePatterns || []) {
    const h = hashText(pattern.text);
    if (seenHashes.has(h)) continue;
    seenHashes.add(h);

    const isAttributed = pattern.sources && pattern.sources.includes('attributedFeedback');
    const mode = pattern.count >= blockThreshold ? 'block' : 'warn';

    guards.push({
      hash: h,
      text: pattern.text,
      words: pattern.words,
      count: pattern.count,
      lastSeen: pattern.lastSeen,
      attributed: isAttributed,
      mode,
    });
  }

  // Sort: attributed first, then by count desc
  guards.sort((a, b) => {
    if (a.attributed && !b.attributed) return -1;
    if (!a.attributed && b.attributed) return 1;
    return b.count - a.count;
  });

  return {
    compiledAt: new Date().toISOString(),
    guardCount: guards.length,
    blockThreshold,
    guards,
  };
}

// ---------------------------------------------------------------------------
// writeGuardArtifact / readGuardArtifact
// ---------------------------------------------------------------------------

/**
 * Atomic write via tmp → rename.
 *
 * @param {string} filePath
 * @param {Object} artifact
 */
function writeGuardArtifact(filePath, artifact) {
  const outPath = filePath || PATHS.guardArtifact;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tmp = `${outPath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(artifact, null, 2) + '\n');
  fs.renameSync(tmp, outPath);
}

/**
 * Read + validate a guard artifact.
 *
 * @param {string} [filePath]
 * @returns {Object|null} artifact or null if invalid/missing
 */
function readGuardArtifact(filePath) {
  const inPath = filePath || process.env.THUMBGATE_GUARDS_PATH || PATHS.guardArtifact;
  if (!fs.existsSync(inPath)) return null;
  try {
    const raw = fs.readFileSync(inPath, 'utf8');
    const obj = JSON.parse(raw);
    if (!Array.isArray(obj.guards)) return null;
    return obj;
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// evaluateCompiledGuards (fast path)
// ---------------------------------------------------------------------------

/**
 * Check compiled artifact against toolName + toolInput.
 *
 * @param {Object} artifact
 * @param {string} toolName
 * @param {string} toolInput
 * @returns {{ mode: string, reason: string, source: string }}
 */
function evaluateCompiledGuards(artifact, toolName, toolInput) {
  if (!artifact || !Array.isArray(artifact.guards)) {
    return { mode: 'allow', reason: '', source: 'compiled' };
  }

  const normInput = normalize(toolInput || '');
  const normTool = (toolName || '').toLowerCase();

  for (const guard of artifact.guards) {
    // Check if tool context is relevant
    const guardText = normalize(guard.text || '');
    const toolMentioned = guardText.includes(normTool) || normTool === 'unknown';

    if (hasTwoKeywordHits(normInput, guard.words || [])) {
      return {
        mode: guard.mode || 'warn',
        reason: `Matched guard pattern (count: ${guard.count}): "${(guard.text || '').slice(0, 80)}"`,
        source: 'compiled',
        guardHash: guard.hash,
        attributed: guard.attributed,
      };
    }

    // Also check tool-level match when input is empty or short
    if (normInput.length < 10 && toolMentioned && guard.count >= (artifact.blockThreshold || 3)) {
      return {
        mode: guard.mode || 'warn',
        reason: `Tool "${toolName}" has recurring negative patterns (count: ${guard.count})`,
        source: 'compiled',
        guardHash: guard.hash,
        attributed: guard.attributed,
      };
    }
  }

  return { mode: 'allow', reason: '', source: 'compiled' };
}

// ---------------------------------------------------------------------------
// evaluatePretoolFromState (live path)
// ---------------------------------------------------------------------------

/**
 * Live path: check recurringNegativePatterns + negativeToolCounts.
 *
 * @param {Object} state - from buildHybridState()
 * @param {string} toolName
 * @param {string} toolInput
 * @returns {{ mode: string, reason: string, source: string }}
 */
function evaluatePretoolFromState(state, toolName, toolInput) {
  const normInput = normalize(toolInput || '');
  const normTool = (toolName || '').toLowerCase();

  for (const pattern of state.recurringNegativePatterns || []) {
    if (hasTwoKeywordHits(normInput, pattern.words || [])) {
      const mode = pattern.count >= 3 ? 'block' : 'warn';
      return {
        mode,
        reason: `Recurring negative pattern (count: ${pattern.count}): "${(pattern.text || '').slice(0, 80)}"`,
        source: 'state',
      };
    }
  }

  // Tool-level check: if this tool has many attributed negatives
  const attrCount = (state.negativeToolCountsAttributed || {})[toolName] || 0;
  const rawCount = (state.negativeToolCounts || {})[toolName] || 0;
  if (attrCount >= 3 || rawCount >= 5) {
    return {
      mode: attrCount >= 3 ? 'block' : 'warn',
      reason: `Tool "${toolName}" has ${attrCount} attributed negative(s), ${rawCount} total negative(s)`,
      source: 'state',
    };
  }

  return { mode: 'allow', reason: '', source: 'state' };
}

// ---------------------------------------------------------------------------
// evaluatePretool (orchestrator)
// ---------------------------------------------------------------------------

/**
 * Main pre-tool evaluation. Tries compiled artifact first, falls back to live state.
 *
 * Important invariant: a tool+input with NEVER a negative returns {mode:'allow'}.
 * hasTwoKeywordHits and count >= 2 filters enforce this (ATTR-03 no-false-positives).
 *
 * @param {string} toolName
 * @param {string} toolInput
 * @param {Object} [opts]
 * @param {string} [opts.guardArtifactPath]
 * @param {string} [opts.feedbackLogPath]
 * @param {string} [opts.attributedFeedbackPath]
 * @returns {{ mode: 'block'|'warn'|'allow', reason: string, source: string }}
 */
function evaluatePretool(toolName, toolInput, opts) {
  const o = opts || {};

  // Fast path: compiled artifact
  const artifactPath = o.guardArtifactPath || process.env.THUMBGATE_GUARDS_PATH || getHybridPaths(o).guardArtifact;
  const artifact = readGuardArtifact(artifactPath);
  if (artifact) {
    const result = evaluateCompiledGuards(artifact, toolName, toolInput);
    if (result.mode !== 'allow') return result;
    // Even if compiled says allow, we're done (trust compiled)
    return result;
  }

  // Slow path: build live state
  const state = buildHybridState({
    feedbackLogPath: o.feedbackLogPath,
    attributedFeedbackPath: o.attributedFeedbackPath,
  });
  return evaluatePretoolFromState(state, toolName, toolInput);
}

// ---------------------------------------------------------------------------
// CLI main()
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);

  if (args[0] === '--pretool') {
    const toolName = args[1] || 'unknown';
    const rawInput = args[2] || '';
    let toolInput = rawInput;
    try {
      const parsed = JSON.parse(rawInput);
      toolInput = typeof parsed === 'object' ? JSON.stringify(parsed) : String(parsed);
    } catch (_) {
      toolInput = rawInput;
    }
    const result = evaluatePretool(toolName, toolInput);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.mode === 'block' ? 2 : 0);
    return;
  }

  if (args[0] === '--compile-guards') {
    const outPath = args[1] || PATHS.guardArtifact;
    const state = buildHybridState({});
    const artifact = compileGuardArtifact(state);
    writeGuardArtifact(outPath, artifact);
    console.log(JSON.stringify({ guardCount: artifact.guardCount, outPath, compiledAt: artifact.compiledAt }, null, 2));
    process.exit(0);
    return;
  }

  // Default: print full state + constraints + additional context
  const state = buildHybridState({});
  const constraints = deriveConstraints(state);
  const additionalContext = buildAdditionalContext(state, constraints);
  console.log('=== Hybrid Feedback State ===');
  console.log(JSON.stringify({ state, constraints, additionalContext }, null, 2));
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  buildHybridState,
  evaluatePretool,
  compileGuardArtifact,
  writeGuardArtifact,
  readGuardArtifact,
  evaluateCompiledGuards,
  evaluatePretoolFromState,
  deriveConstraints,
  buildAdditionalContext,
  // Internal helpers (exposed for testing)
  normalize,
  normalizePatternText,
  inferToolName,
  classify,
  keywords,
  hashText,
  hasTwoKeywordHits,
  readJsonl,
  getHybridPaths,
  PATHS,
};

if (require.main === module) {
  main();
}
