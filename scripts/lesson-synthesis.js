'use strict';
const fs = require('fs');
const path = require('path');
const { canonicalHash, findCanonicalDuplicate } = require('./lesson-canonical');

const SIMILARITY_THRESHOLD = 0.6;
const AUTO_PROMOTE_THRESHOLD = 3;

/**
 * Read JSONL file and return parsed records.
 * Self-contained to avoid circular dependency with feedback-loop.
 */
function readJSONLLocal(filePath, { maxLines = 500 } = {}) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(Boolean);
  const tail = maxLines > 0 ? lines.slice(-maxLines) : lines;
  const results = [];
  for (const line of tail) {
    try { results.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }
  return results;
}

/**
 * Append a record to a JSONL file.
 */
function appendJSONLLocal(filePath, record) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
}

/**
 * Find a similar existing lesson by comparing titles and context.
 *
 * Two-layer dedup:
 *   1. Canonical-hash match (cross-session). Punctuation/stop-word/wording
 *      drift is normalized away, so "never force-push main" and "Don't
 *      force push main." collapse to the same hash. When a hash matches,
 *      similarity is reported as 1.0 and we skip the Jaccard pass.
 *   2. Jaccard token overlap (legacy within-session path). Catches
 *      rewordings that survive canonicalization (new keywords, different
 *      root verb) above the 0.6 threshold.
 *
 * The canonical pass runs first because it's O(N) with constant work per
 * entry and rejects trivial duplicates before we pay the Jaccard price.
 */
function findSimilarLesson(memoryLogPath, newRecord) {
  const existing = readJSONLLocal(memoryLogPath, { maxLines: 200 });

  // Layer 1: canonical-hash exact match (normalization-invariant).
  const canonicalMatch = findCanonicalDuplicate(existing, newRecord);
  if (canonicalMatch) {
    return { match: canonicalMatch, similarity: 1, matchType: 'canonical' };
  }

  // Layer 2: Jaccard token overlap (original behavior).
  const newTokens = tokenize(newRecord.title + ' ' + (newRecord.content || ''));

  let bestMatch = null;
  let bestScore = 0;

  for (const mem of existing) {
    const memTokens = tokenize((mem.title || '') + ' ' + (mem.content || ''));
    const score = jaccardSimilarity(newTokens, memTokens);
    if (score > bestScore && score >= SIMILARITY_THRESHOLD) {
      bestScore = score;
      bestMatch = mem;
    }
  }

  return bestMatch ? { match: bestMatch, similarity: bestScore, matchType: 'jaccard' } : null;
}

/**
 * Merge a new feedback event into an existing lesson.
 * Increments occurrence count, updates timestamp, enriches context.
 */
function mergeIntoExisting(memoryLogPath, existingLesson, newRecord, newFeedbackEvent) {
  const merged = {
    ...existingLesson,
    occurrences: (existingLesson.occurrences || 1) + 1,
    lastUpdated: new Date().toISOString(),
    mergedFeedbackIds: [
      ...(existingLesson.mergedFeedbackIds || []),
      newFeedbackEvent.id
    ].slice(-20), // Keep last 20 IDs
  };

  // Enrich context if the new one adds information
  if (newRecord.content && newRecord.content.length > (existingLesson.content || '').length) {
    merged.content = newRecord.content;
  }

  // Update the record in-place by rewriting the JSONL
  updateRecordInJsonl(memoryLogPath, existingLesson.id, merged);

  return merged;
}

/**
 * Check if a lesson should be auto-promoted to a prevention rule.
 * Threshold: 3+ occurrences.
 */
function shouldAutoPromote(lesson) {
  return (lesson.occurrences || 1) >= AUTO_PROMOTE_THRESHOLD;
}

/**
 * Generate a structured prevention rule from a high-frequency lesson.
 */
function synthesizePreventionRule(lesson) {
  const title = lesson.title || '';
  const content = lesson.content || '';

  // Extract the core mistake pattern
  const mistakeMatch = title.match(/^MISTAKE:\s*(.+)/i);
  const mistake = mistakeMatch ? mistakeMatch[1].trim() : title;

  // Build IF/THEN rule
  return {
    id: 'synth_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    type: 'auto-promoted',
    source: 'lesson-synthesis',
    sourceLessonId: lesson.id,
    occurrences: lesson.occurrences || 1,
    rule: {
      format: 'if-then-v1',
      trigger: { condition: mistake, type: 'recurring-mistake' },
      action: { type: 'avoid', description: 'NEVER: ' + mistake },
      confidence: Math.min(0.5 + (lesson.occurrences || 1) * 0.1, 0.95),
      scope: inferScopeFromTags(lesson.tags || []),
    },
    humanReadable: 'After ' + (lesson.occurrences || 1) + ' occurrences: NEVER ' + mistake,
    tags: [...(lesson.tags || []), 'auto-promoted', 'synthesized'],
    createdAt: new Date().toISOString(),
  };
}

/**
 * Update a single record in a JSONL file by ID.
 */
function updateRecordInJsonl(filePath, recordId, updatedRecord) {
  if (!fs.existsSync(filePath)) return false;
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
  let found = false;
  const updated = lines.map(function(line) {
    try {
      const obj = JSON.parse(line);
      if (obj.id === recordId) {
        found = true;
        return JSON.stringify(updatedRecord);
      }
      return line;
    } catch { return line; }
  });
  if (found) {
    fs.writeFileSync(filePath, updated.join('\n') + '\n');
  }
  return found;
}

/**
 * Delete a single record from a JSONL file by ID.
 */
function deleteRecordFromJsonl(filePath, recordId) {
  if (!fs.existsSync(filePath)) return false;
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
  const filtered = lines.filter(function(line) {
    try {
      const obj = JSON.parse(line);
      return obj.id !== recordId;
    } catch { return true; }
  });
  if (filtered.length === lines.length) return false;
  fs.writeFileSync(filePath, filtered.length ? filtered.join('\n') + '\n' : '');
  return true;
}

function tokenize(text) {
  return (text || '').toLowerCase().split(/[\s.,;:!?()\[\]{}"'`]+/).filter(function(t) { return t.length > 3; });
}

function jaccardSimilarity(setA, setB) {
  var a = new Set(setA);
  var b = new Set(setB);
  var intersection = 0;
  a.forEach(function(item) { if (b.has(item)) intersection++; });
  var union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function inferScopeFromTags(tags) {
  if (tags.some(function(t) { return t.includes('file') || t.includes('src/'); })) return 'file-level';
  if (tags.some(function(t) { return t.includes('project') || t.includes('repo'); })) return 'project-level';
  return 'global';
}

module.exports = {
  findSimilarLesson,
  mergeIntoExisting,
  shouldAutoPromote,
  synthesizePreventionRule,
  updateRecordInJsonl,
  deleteRecordFromJsonl,
  readJSONLLocal,
  appendJSONLLocal,
  jaccardSimilarity,
  tokenize,
  inferScopeFromTags,
  canonicalHash,
  SIMILARITY_THRESHOLD,
  AUTO_PROMOTE_THRESHOLD,
};
