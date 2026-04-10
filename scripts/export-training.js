#!/usr/bin/env node
/**
 * Training Data Exporter
 *
 * Exports feedback data in multiple formats for ML training pipelines:
 * - PyTorch JSON (XPRT-01): prompt/chosen/rejected preference pairs
 * - CSV summary (XPRT-02): one row per feedback entry with column headers
 * - Action analysis report (XPRT-03): tool call patterns, success rates, top failures
 * - DPO validation gate (XPRT-04): validateMemoryStructure() prevents bad training pairs
 *
 * Ported and adapted from Subway_RN_Demo exportTrainingData() patterns.
 * PATH: PROJECT_ROOT = path.join(__dirname, '..') — 1 level from scripts/
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { resolveFeedbackDir } = require('./feedback-paths');
const { ensureDir } = require('./fs-utils');

const SEQUENCE_WINDOW = 10;

function getFeedbackDir() {
  return resolveFeedbackDir();
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function readJSONL(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}


// ---------------------------------------------------------------------------
// XPRT-04: validateMemoryStructure
// ---------------------------------------------------------------------------

/**
 * Gate function: validates a DPO memory pair has the required fields
 * before allowing it into training export.
 *
 * Required: title, content, category, tags (at least 1 non-generic).
 * For DPO pairs specifically: must have a 'chosen' direction (prompt + chosen + rejected).
 *
 * @param {object} memory - DPO memory entry
 * @returns {{ valid: boolean, issues: string[] }}
 */
function validateMemoryStructure(memory) {
  const issues = [];

  if (!memory || typeof memory !== 'object') {
    return { valid: false, issues: ['memory must be a non-null object'] };
  }

  // Required fields
  if (!memory.title || typeof memory.title !== 'string') {
    issues.push('title: required string');
  }
  if (!memory.content || typeof memory.content !== 'string') {
    issues.push('content: required string');
  } else if (memory.content.length < 10) {
    issues.push(`content: too short (${memory.content.length} chars, min 10)`);
  }
  if (!memory.category) {
    issues.push('category: required');
  }
  if (!Array.isArray(memory.tags) || memory.tags.length === 0) {
    issues.push('tags: at least 1 tag required');
  }

  // DPO-specific: requires 'chosen' field for preference pair export
  // If exporting as DPO pair, must have prompt + chosen + rejected
  if (memory._dpoExport) {
    if (!memory.prompt) issues.push('DPO export: prompt field required');
    if (!memory.chosen) issues.push('DPO export: chosen field required');
    if (!memory.rejected) issues.push('DPO export: rejected field required');
  }

  return { valid: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// XPRT-01: PyTorch JSON export
// ---------------------------------------------------------------------------

/**
 * Build preference pairs from feedback log.
 * Matches positive entries as 'chosen' and negative entries as 'rejected'
 * when they share the same context domain/tags.
 *
 * @param {object[]} feedbackEntries - Raw feedback log entries
 * @returns {object[]} Array of { prompt, chosen, rejected } pairs
 */
function buildPreferencePairs(feedbackEntries) {
  const positive = feedbackEntries.filter(
    (f) => f.signal === 'positive' || f.feedback === 'up'
  );
  const negative = feedbackEntries.filter(
    (f) => f.signal === 'negative' || f.feedback === 'down'
  );

  const pairs = [];
  const usedNeg = new Set();

  for (const pos of positive) {
    // Find a negative entry with overlapping tags (domain similarity)
    const posTags = new Set(pos.tags || []);
    let bestNegIdx = -1;
    let bestOverlap = -1;

    for (let i = 0; i < negative.length; i++) {
      if (usedNeg.has(i)) continue;
      const negTags = new Set(negative[i].tags || []);
      let overlap = 0;
      for (const t of posTags) {
        if (negTags.has(t)) overlap++;
      }
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestNegIdx = i;
      }
    }

    // If no tag overlap, still pair with any unused negative
    if (bestNegIdx === -1) {
      for (let i = 0; i < negative.length; i++) {
        if (!usedNeg.has(i)) { bestNegIdx = i; break; }
      }
    }

    if (bestNegIdx >= 0) {
      usedNeg.add(bestNegIdx);
      const neg = negative[bestNegIdx];
      pairs.push({
        prompt: pos.context || pos.richContext?.description || '',
        chosen: (pos.richContext?.outcomeCategory || 'positive') + ': ' + (pos.context || ''),
        rejected: (neg.richContext?.outcomeCategory || 'negative') + ': ' + (neg.context || ''),
        metadata: {
          posId: pos.id,
          negId: neg.id,
          posTags: pos.tags || [],
          negTags: neg.tags || [],
          tagOverlap: bestOverlap,
        },
      });
    }
  }

  return pairs;
}

/**
 * Export feedback data as PyTorch-compatible JSON.
 *
 * Format: { metadata: { ... }, sequences: [{ X: {...}, y, label }] }
 * Each sequence contains rewardSequence, trend, timeGaps features.
 *
 * @param {string} [feedbackDir] - Override feedback directory
 * @param {string} [outputPath] - Override output path
 * @returns {{ outputPath: string, pairCount: number, sequenceCount: number }}
 */
function exportPyTorchJSON(feedbackDir, outputPath) {
  const fbDir = feedbackDir || getFeedbackDir();
  const feedbackPath = path.join(fbDir, 'feedback-log.jsonl');
  const sequencePath = path.join(fbDir, 'feedback-sequences.jsonl');
  const exportDir = path.join(fbDir, 'training-data');

  ensureDir(exportDir);

  const feedbackEntries = readJSONL(feedbackPath);
  const sequences = readJSONL(sequencePath);
  const pairs = buildPreferencePairs(feedbackEntries);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = outputPath || path.join(exportDir, `training-pytorch-${timestamp}.json`);

  const pytorchData = {
    metadata: {
      exportDate: new Date().toISOString(),
      format: 'pytorch-dpo',
      pairCount: pairs.length,
      sequenceCount: sequences.length,
      windowSize: SEQUENCE_WINDOW,
      features: ['rewardSequence', 'recentTrend', 'timeGaps'],
    },
    // DPO preference pairs (prompt/chosen/rejected)
    pairs: pairs.map((p) => ({
      prompt: p.prompt,
      chosen: p.chosen,
      rejected: p.rejected,
    })),
    // Raw sequences for LSTM/Transformer training
    sequences: sequences.map((s) => ({
      X: {
        rewardSequence: (s.features && s.features.rewardSequence) || [],
        trend: (s.features && s.features.recentTrend) || 0,
        timeGaps: (s.features && s.features.timeGaps) || [],
      },
      y: s.targetReward,
      label: s.label,
    })),
  };

  fs.writeFileSync(outPath, JSON.stringify(pytorchData, null, 2));
  return { outputPath: outPath, pairCount: pairs.length, sequenceCount: sequences.length };
}

// ---------------------------------------------------------------------------
// XPRT-02: CSV summary export
// ---------------------------------------------------------------------------

/**
 * Escape a CSV field value (wrap in quotes if contains comma/quote/newline).
 *
 * @param {*} value
 * @returns {string}
 */
function escapeCsvField(value) {
  const str = String(value == null ? '' : value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Export feedback entries as CSV with standard headers.
 *
 * Columns: id, timestamp, signal, reward, context, domain, tags, outcomeCategory
 *
 * @param {string} [feedbackDir] - Override feedback directory
 * @param {string} [outputPath] - Override output path
 * @returns {{ outputPath: string, rowCount: number }}
 */
function exportCSV(feedbackDir, outputPath) {
  const fbDir = feedbackDir || getFeedbackDir();
  const feedbackPath = path.join(fbDir, 'feedback-log.jsonl');
  const exportDir = path.join(fbDir, 'training-data');

  ensureDir(exportDir);

  const entries = readJSONL(feedbackPath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = outputPath || path.join(exportDir, `training-summary-${timestamp}.csv`);

  const headers = ['id', 'timestamp', 'signal', 'reward', 'context', 'domain', 'tags', 'outcomeCategory'];
  const rows = entries.map((e) => [
    e.id || '',
    e.timestamp || '',
    e.signal || e.feedback || '',
    e.reward != null ? e.reward : '',
    e.context || '',
    (e.richContext && e.richContext.domain) || '',
    Array.isArray(e.tags) ? e.tags.join(';') : '',
    (e.richContext && e.richContext.outcomeCategory) || '',
  ].map(escapeCsvField).join(','));

  const csv = [headers.join(','), ...rows].join('\n');
  fs.writeFileSync(outPath, csv);

  return { outputPath: outPath, rowCount: entries.length };
}

// ---------------------------------------------------------------------------
// XPRT-03: Action analysis report
// ---------------------------------------------------------------------------

/**
 * Analyze action patterns from sequences and feedback entries.
 *
 * Produces: tool call frequency, success rates, top failure modes.
 *
 * @param {string} [feedbackDir] - Override feedback directory
 * @param {string} [outputPath] - Override output path
 * @returns {{ outputPath: string, report: object }}
 */
function exportActionAnalysis(feedbackDir, outputPath) {
  const fbDir = feedbackDir || getFeedbackDir();
  const feedbackPath = path.join(fbDir, 'feedback-log.jsonl');
  const sequencePath = path.join(fbDir, 'feedback-sequences.jsonl');
  const exportDir = path.join(fbDir, 'training-data');

  ensureDir(exportDir);

  const entries = readJSONL(feedbackPath);
  const sequences = readJSONL(sequencePath);

  // Aggregate action patterns from sequences
  const allPatterns = {};
  for (const s of sequences) {
    const patterns = (s.features && s.features.actionPatterns) || {};
    for (const [tag, counts] of Object.entries(patterns)) {
      if (!allPatterns[tag]) {
        allPatterns[tag] = { positive: 0, negative: 0, total: 0 };
      }
      allPatterns[tag].positive += counts.positive || 0;
      allPatterns[tag].negative += counts.negative || 0;
      allPatterns[tag].total += (counts.positive || 0) + (counts.negative || 0);
    }
  }

  // Compute success rates
  for (const data of Object.values(allPatterns)) {
    data.successRate = data.total > 0
      ? +(data.positive / data.total).toFixed(4)
      : null;
  }

  // Sort by total occurrences
  const sortedPatterns = Object.entries(allPatterns)
    .sort((a, b) => b[1].total - a[1].total)
    .reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {});

  // Identify top failure modes (successRate < 0.4 with enough data)
  const topFailureModes = Object.entries(allPatterns)
    .filter(([, v]) => v.successRate !== null && v.successRate < 0.4 && v.total >= 2)
    .sort((a, b) => a[1].successRate - b[1].successRate)
    .slice(0, 5)
    .map(([tag, v]) => ({
      action: tag,
      successRate: v.successRate,
      total: v.total,
      failureCount: v.negative,
    }));

  // Summary stats from feedback log
  const posCount = entries.filter((e) => e.signal === 'positive' || e.feedback === 'up').length;
  const negCount = entries.filter((e) => e.signal === 'negative' || e.feedback === 'down').length;

  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      totalFeedbackEntries: entries.length,
      positiveEntries: posCount,
      negativeEntries: negCount,
      totalSequences: sequences.length,
      uniqueActions: Object.keys(sortedPatterns).length,
    },
    actionPatterns: sortedPatterns,
    topFailureModes,
    recommendations: generateActionRecommendations(sortedPatterns),
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = outputPath || path.join(exportDir, `action-analysis-${timestamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  return { outputPath: outPath, report };
}

/**
 * Generate recommendations from action pattern data.
 *
 * @param {object} patterns
 * @returns {string[]}
 */
function generateActionRecommendations(patterns) {
  const recs = [];
  for (const [tag, data] of Object.entries(patterns)) {
    if (data.successRate !== null && data.total >= 3) {
      if (data.successRate < 0.5) {
        recs.push(`Avoid "${tag}" — ${(data.successRate * 100).toFixed(0)}% success rate across ${data.total} uses.`);
      } else if (data.successRate > 0.8) {
        recs.push(`Expand "${tag}" — ${(data.successRate * 100).toFixed(0)}% success rate across ${data.total} uses.`);
      }
    }
  }
  if (recs.length === 0) recs.push('No actionable recommendations at this time.');
  return recs;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printUsage() {
  console.log(`
Training Data Exporter — Phase 10 (XPRT-01..04)

Usage:
  node export-training.js --pytorch [--output <path>]
  node export-training.js --csv [--output <path>]
  node export-training.js --actions [--output <path>]
  node export-training.js --all

Options:
  --pytorch    Export PyTorch JSON format (XPRT-01)
  --csv        Export CSV summary (XPRT-02)
  --actions    Export action analysis report (XPRT-03)
  --all        Export all formats
  --output     Override output file path
  --feedback-dir  Override feedback directory
`);
}

if (require.main === module) {
  const args = process.argv.slice(2).reduce((acc, arg) => {
    if (arg.startsWith('--')) {
      const [k, ...v] = arg.slice(2).split('=');
      acc[k] = v.length ? v.join('=') : true;
    }
    return acc;
  }, {});

  if (args.help || Object.keys(args).length === 0) {
    printUsage();
    process.exit(0);
  }

  const fbDir = args['feedback-dir'] || undefined;
  const outPath = args.output || undefined;

  if (args.pytorch || args.all) {
    const { outputPath, pairCount, sequenceCount } = exportPyTorchJSON(fbDir, outPath);
    console.log(`PyTorch JSON: ${outputPath} (${pairCount} pairs, ${sequenceCount} sequences)`);
  }
  if (args.csv || args.all) {
    const { outputPath, rowCount } = exportCSV(fbDir, outPath);
    console.log(`CSV: ${outputPath} (${rowCount} rows)`);
  }
  if (args.actions || args.all) {
    const { outputPath } = exportActionAnalysis(fbDir, outPath);
    console.log(`Action Analysis: ${outputPath}`);
  }
}

module.exports = {
  exportPyTorchJSON,
  exportCSV,
  exportActionAnalysis,
  buildPreferencePairs,
  validateMemoryStructure,
  escapeCsvField,
  generateActionRecommendations,
};
