'use strict';

/**
 * Meta-Policy Rule Extraction (DPO-03)
 *
 * Reads memory-log.jsonl, groups negative memories by domain, computes
 * recency-weighted confidence scores, detects trend direction, and writes
 * meta-policy-rules.json.
 *
 * Output file: {THUMBGATE_FEEDBACK_DIR}/meta-policy-rules.json
 *
 * This is a different artifact from prevention-rules.md (simpler occurrence counts).
 * Meta-policy rules have confidence + trend + recency weighting.
 *
 * Min occurrences threshold: 2 (consistent with buildPreventionRules())
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseTimestamp } = require('./feedback-schema');
const { timeDecayWeight } = require('./thompson-sampling');
const { inferDomain } = require('./feedback-loop');

const MIN_OCCURRENCES = 2;
const RECENT_DAYS = 7;
const RECENT_MS = RECENT_DAYS * 24 * 3600 * 1000;

/**
 * Extract meta-policy rules from memory-log.jsonl feedback trends.
 *
 * @param {object} opts
 * @param {string} [opts.feedbackDir] - Override feedback directory (default: THUMBGATE_FEEDBACK_DIR or ~/.claude/memory/feedback)
 * @returns {Array<{category: string, confidence: number, trend: string, occurrence_count: number, last_seen: string}>}
 */
function extractMetaPolicyRules(opts = {}) {
  const feedbackDir = opts.feedbackDir
    || process.env.THUMBGATE_FEEDBACK_DIR
    || path.join(os.homedir(), '.claude', 'memory', 'feedback');

  const memoryLogPath = path.join(feedbackDir, 'memory-log.jsonl');

  if (!fs.existsSync(memoryLogPath)) {
    return [];
  }

  const raw = fs.readFileSync(memoryLogPath, 'utf-8').trim();
  if (!raw) {
    return [];
  }

  // Parse all entries, skip malformed lines
  const allEntries = raw.split('\n').reduce((acc, line) => {
    if (!line.trim()) return acc;
    try {
      acc.push(JSON.parse(line));
    } catch {
      process.stderr.write(`meta-policy: skipping malformed line: ${line.slice(0, 80)}\n`);
    }
    return acc;
  }, []);

  if (allEntries.length === 0) {
    return [];
  }

  // Filter to negative memories only
  const negativeEntries = allEntries.filter(
    (e) => e.signal === 'negative' || e.feedback === 'down',
  );

  if (negativeEntries.length === 0) {
    return [];
  }

  // Group negative entries by domain
  const domainMap = new Map();
  for (const entry of negativeEntries) {
    const domain = inferDomain(entry.tags, entry.context);
    if (!domainMap.has(domain)) {
      domainMap.set(domain, []);
    }
    domainMap.get(domain).push(entry);
  }

  // Build rules for domains with enough occurrences
  const now = Date.now();
  const rules = [];

  for (const [domain, entries] of domainMap) {
    if (entries.length < MIN_OCCURRENCES) {
      continue;
    }

    // Compute avg time-decay weight across all negative entries
    const weights = entries.map((e) => timeDecayWeight(e.timestamp));
    const avg_weighted = weights.reduce((sum, w) => sum + w, 0) / weights.length;

    // Count recent negative entries (last 7 days)
    const recent_entries = entries.filter((e) => {
      const ts = parseTimestamp(e.timestamp);
      return ts && (now - ts.getTime()) < RECENT_MS;
    }).length;

    // Count recent positive entries for same domain (from full allEntries log)
    const recent_positive = allEntries.filter((e) => {
      if (e.signal !== 'positive' && e.feedback !== 'up') return false;
      const entryDomain = inferDomain(e.tags, e.context);
      if (entryDomain !== domain) return false;
      const ts = parseTimestamp(e.timestamp);
      return ts && (now - ts.getTime()) < RECENT_MS;
    }).length;

    // Compute confidence: min(0.95, 0.4 + (avg_weighted * 0.3) + (occurrence_count * 0.05))
    const confidence = Math.min(
      0.95,
      0.4 + (avg_weighted * 0.3) + (entries.length * 0.05),
    );

    // Determine trend
    let trend;
    if (recent_entries === 0 && recent_positive > 0) {
      trend = 'improving';
    } else if (recent_entries > 2 && recent_positive === 0) {
      trend = 'deteriorating';
    } else if (recent_entries > recent_positive) {
      trend = 'needs_attention';
    } else {
      trend = 'stable';
    }

    // Find most recent entry timestamp
    const timestamps = entries
      .map((e) => parseTimestamp(e.timestamp))
      .filter(Boolean)
      .sort((a, b) => b.getTime() - a.getTime());
    const last_seen = timestamps.length > 0
      ? timestamps[0].toISOString()
      : new Date().toISOString();

    rules.push({
      category: domain,
      confidence: Math.round(confidence * 1000) / 1000,
      trend,
      occurrence_count: entries.length,
      last_seen,
    });
  }

  // Sort by confidence descending (most urgent first)
  rules.sort((a, b) => b.confidence - a.confidence);

  return rules;
}

/**
 * Run meta-policy rule extraction and write results to meta-policy-rules.json.
 *
 * @param {object} opts - Same as extractMetaPolicyRules opts
 * @returns {{ rules: Array, outputPath: string }}
 */
function run(opts = {}) {
  const feedbackDir = opts.feedbackDir
    || process.env.THUMBGATE_FEEDBACK_DIR
    || path.join(os.homedir(), '.claude', 'memory', 'feedback');

  const rules = extractMetaPolicyRules({ ...opts, feedbackDir });

  // Ensure output directory exists
  if (!fs.existsSync(feedbackDir)) {
    fs.mkdirSync(feedbackDir, { recursive: true });
  }

  // Write to meta-policy-rules.json — NOT to prevention-rules.md (see RESEARCH.md Pitfall 4)
  const outputPath = path.join(feedbackDir, 'meta-policy-rules.json');
  fs.writeFileSync(
    outputPath,
    JSON.stringify({ generated: new Date().toISOString(), rules }, null, 2),
  );

  console.log(`meta-policy: extracted ${rules.length} rules`);
  return { rules, outputPath };
}

module.exports = { extractMetaPolicyRules, run };

if (require.main === module && process.argv.includes('--extract')) {
  try {
    run();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
