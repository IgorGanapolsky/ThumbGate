'use strict';

const fs = require('fs');
const path = require('path');
const { getFeedbackPaths, readJSONL, writePreventionRules } = require('./feedback-loop');
const { findSimilarLesson, mergeIntoExisting, jaccardSimilarity, tokenize, canonicalHash } = require('./lesson-synthesis');
const { analyze, promoteToGates } = require('./feedback-to-rules');

function consolidateMemory(feedbackDir, pkgRoot) {
  const paths = getFeedbackPaths({ feedbackDir });
  const memoryLogPath = paths.MEMORY_LOG_PATH;
  
  if (!fs.existsSync(memoryLogPath)) {
    return { consolidated: 0, removed: 0 };
  }

  const rawEntries = readJSONL(memoryLogPath);
  if (rawEntries.length === 0) {
    return { consolidated: 0, removed: 0 };
  }

  console.error(`🧠 [Dreaming] Loading ${rawEntries.length} memory entries...`);

  const consolidated = [];
  let removedCount = 0;

  for (const newRecord of rawEntries) {
    // Check if we already have a similar lesson in our consolidated list
    let bestMatch = null;
    let bestScore = 0;
    let matchType = null;

    // 1. Check for canonical-hash exact match
    const newHash = canonicalHash(newRecord.title);
    for (const mem of consolidated) {
      if (canonicalHash(mem.title) === newHash) {
        bestMatch = mem;
        bestScore = 1.0;
        matchType = 'canonical';
        break;
      }
    }

    // 2. Check for Jaccard token overlap
    if (!bestMatch) {
      const newTokens = tokenize(newRecord.title + ' ' + (newRecord.content || ''));
      for (const mem of consolidated) {
        const memTokens = tokenize((mem.title || '') + ' ' + (mem.content || ''));
        const score = jaccardSimilarity(newTokens, memTokens);
        if (score > bestScore && score >= 0.6) {
          bestScore = score;
          bestMatch = mem;
          matchType = 'jaccard';
        }
      }
    }

    if (bestMatch) {
      // Merge into existing
      bestMatch.occurrences = (bestMatch.occurrences || 1) + (newRecord.occurrences || 1);
      bestMatch.lastUpdated = new Date().toISOString();
      
      // Combine merged feedback IDs
      bestMatch.mergedFeedbackIds = Array.from(new Set([
        ...(bestMatch.mergedFeedbackIds || []),
        ...(newRecord.mergedFeedbackIds || []),
        newRecord.id
      ])).slice(-20);

      // Enrich content if new record adds info
      if (newRecord.content && newRecord.content.length > (bestMatch.content || '').length) {
        bestMatch.content = newRecord.content;
      }

      // Combine tags
      const combinedTags = new Set([...(bestMatch.tags || []), ...(newRecord.tags || [])]);
      bestMatch.tags = Array.from(combinedTags);

      removedCount++;
    } else {
      consolidated.push({ ...newRecord });
    }
  }

  if (removedCount > 0) {
    console.error(`🧹 [Dreaming] Consolidated duplicate lessons: merged ${removedCount} duplicates into ${consolidated.length} unique lessons.`);
    // Rewrite memory log
    fs.writeFileSync(memoryLogPath, consolidated.map(JSON.stringify).join('\n') + '\n');
  } else {
    console.error('✨ [Dreaming] No duplicate lessons found.');
  }

  return { consolidated: consolidated.length, removed: removedCount };
}

async function dream(options = {}) {
  const pkgRoot = options.pkgRoot || path.join(__dirname, '..');
  const feedbackDir = options.feedbackDir || process.cwd();
  
  console.error('💤 [Dreaming] Starting background memory consolidation ("Silicon Dreaming")...');

  // 1. Consolidate memory-log.jsonl
  const consResult = consolidateMemory(options.feedbackDir, pkgRoot);

  // 2. Run feedback-to-rules analysis on feedback-log.jsonl to promote new auto-gates
  const paths = getFeedbackPaths({ feedbackDir: options.feedbackDir });
  if (fs.existsSync(paths.FEEDBACK_LOG_PATH)) {
    console.error('📊 [Dreaming] Analyzing feedback history for recurring issues...');
    const feedbackEntries = readJSONL(paths.FEEDBACK_LOG_PATH);
    const analysisReport = analyze(feedbackEntries);
    console.error(`🔒 [Dreaming] Promoted gates from feedback: ${analysisReport.recurringIssues.length} recurring issues analyzed.`);
  }

  // 3. Rebuild prevention-rules.md
  console.error('📝 [Dreaming] Rebuilding prevention-rules.md...');
  const rulesResult = writePreventionRules(options.rulesPath, Number(options.minOccurrences || 2));

  return {
    success: true,
    lessonsCount: consResult.consolidated,
    consolidated: consResult.removed,
    rulesPath: rulesResult.path,
  };
}

module.exports = { consolidateMemory, dream };
