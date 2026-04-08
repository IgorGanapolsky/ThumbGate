#!/usr/bin/env node
/**
 * Skill Quality Tracker
 *
 * Correlates tool call metrics to feedback signals by timestamp proximity.
 * After a sequence of tool calls and feedback captures, produces a per-skill
 * quality score derived from timestamp-proximity correlation.
 *
 * Ported from Subway_RN_Demo/.claude/scripts/feedback/skill-quality-tracker.js
 * PATH: PROJECT_ROOT = path.join(__dirname, '..') — 1 level up from scripts/
 */

'use strict';

const fs = require('fs');
const readline = require('readline');
const path = require('path');
const { resolveFeedbackDir } = require('./feedback-paths');

const METRICS_PATH = process.env.METRICS_PATH
  || path.join(resolveFeedbackDir(), 'tool-metrics.jsonl');

const FEEDBACK_PATH = process.env.FEEDBACK_PATH
  || path.join(resolveFeedbackDir(), 'feedback-log.jsonl');

// Correlation window: feedback within 60 seconds of a tool call is considered correlated
const CORRELATION_WINDOW_MS = 60_000;

/**
 * Safely parse a single JSON line.
 *
 * @param {string} line
 * @returns {object|null}
 */
function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/**
 * Load feedback entries from JSONL file.
 * Each entry needs: timestamp, feedback (signal).
 *
 * @param {string} filePath
 * @returns {Promise<Array<{ ts: number, feedback: string, tool: string|null }>>}
 */
async function loadFeedback(filePath) {
  const entries = [];
  if (!fs.existsSync(filePath)) return entries;

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const obj = parseLine(line);
    if (obj && obj.timestamp) {
      // Support both 'feedback' (Subway) and 'signal' (ThumbGate) field names
      const feedbackVal = obj.feedback || obj.signal;
      if (feedbackVal) {
        // Normalize to 'positive'/'negative' regardless of source schema
        let normalized = feedbackVal;
        if (feedbackVal === 'up') normalized = 'positive';
        else if (feedbackVal === 'down') normalized = 'negative';

        entries.push({
          ts: new Date(obj.timestamp).getTime(),
          feedback: normalized,
          tool: obj.tool_name || null,
        });
      }
    }
  }

  entries.sort((a, b) => a.ts - b.ts);
  return entries;
}

/**
 * Find correlated feedback for a tool call by timestamp proximity.
 *
 * Searches feedback entries within CORRELATION_WINDOW_MS of the metric timestamp.
 * If the feedback entry has a tool_name, it must match the metric's tool name.
 *
 * @param {number} metricTs - Timestamp of the tool call (ms)
 * @param {string} metricTool - Tool name
 * @param {Array<{ ts: number, feedback: string, tool: string|null }>} feedbackEntries
 * @returns {string|null} 'positive', 'negative', or null if no correlation found
 */
function correlateFeedback(metricTs, metricTool, feedbackEntries) {
  for (const fb of feedbackEntries) {
    if (Math.abs(fb.ts - metricTs) <= CORRELATION_WINDOW_MS) {
      // If feedback has a tool name, it must match; otherwise correlate by time alone
      if (!fb.tool || fb.tool === metricTool) {
        return fb.feedback;
      }
    }
  }
  return null;
}

/**
 * Process tool metrics JSONL and correlate with feedback.
 *
 * @param {string} metricsPath
 * @param {Array<{ ts: number, feedback: string, tool: string|null }>} feedbackEntries
 * @returns {Promise<{ totalToolUses: number, breakdown: object }>}
 */
async function processMetrics(metricsPath, feedbackEntries) {
  const breakdown = {};
  let totalToolUses = 0;

  if (!fs.existsSync(metricsPath)) return { totalToolUses, breakdown };

  const rl = readline.createInterface({
    input: fs.createReadStream(metricsPath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const obj = parseLine(line);
    if (!obj || !obj.tool_name) continue;

    totalToolUses++;
    const name = obj.tool_name;

    if (!breakdown[name]) {
      breakdown[name] = { uses: 0, correlatedPositive: 0, correlatedNegative: 0 };
    }

    breakdown[name].uses++;

    const ts = new Date(obj.timestamp).getTime();
    if (!isNaN(ts)) {
      const signal = correlateFeedback(ts, name, feedbackEntries);
      if (signal === 'positive') breakdown[name].correlatedPositive++;
      else if (signal === 'negative') breakdown[name].correlatedNegative++;
    }
  }

  return { totalToolUses, breakdown };
}

/**
 * Compute per-tool success rates from correlation counts.
 * Mutates the breakdown object in place.
 *
 * @param {object} breakdown - { toolName: { uses, correlatedPositive, correlatedNegative } }
 */
function computeSuccessRates(breakdown) {
  for (const tool of Object.values(breakdown)) {
    const correlated = tool.correlatedPositive + tool.correlatedNegative;
    tool.successRate = correlated > 0
      ? +(tool.correlatedPositive / correlated).toFixed(4)
      : null;
  }
}

/**
 * Return top-performing tools sorted by success rate.
 *
 * @param {object} breakdown
 * @param {number} [min=10] - Minimum uses threshold
 * @param {number} [limit=5] - Maximum entries to return
 * @returns {Array<{ tool: string, successRate: number, uses: number }>}
 */
function topPerformers(breakdown, min = 10, limit = 5) {
  return Object.entries(breakdown)
    .filter(([, v]) => v.uses >= min && v.successRate !== null)
    .sort((a, b) => b[1].successRate - a[1].successRate || b[1].uses - a[1].uses)
    .slice(0, limit)
    .map(([name, v]) => ({ tool: name, successRate: v.successRate, uses: v.uses }));
}

/**
 * Return tools with high negative correlation (potential trouble spots).
 * Threshold: >30% negative rate among correlated feedback.
 *
 * @param {object} breakdown
 * @returns {Array<{ tool: string, negativeRate: number, uses: number }>}
 */
function troubleSpots(breakdown) {
  return Object.entries(breakdown)
    .filter(([, v]) => {
      const total = v.correlatedPositive + v.correlatedNegative;
      return total > 0 && v.correlatedNegative / total > 0.3;
    })
    .map(([name, v]) => {
      const total = v.correlatedPositive + v.correlatedNegative;
      return {
        tool: name,
        negativeRate: +(v.correlatedNegative / total).toFixed(4),
        uses: v.uses,
      };
    })
    .sort((a, b) => b.negativeRate - a.negativeRate);
}

/**
 * Generate actionable recommendations from top performers and trouble spots.
 *
 * @param {Array} top - topPerformers result
 * @param {Array} trouble - troubleSpots result
 * @param {object} breakdown - full breakdown
 * @returns {string[]}
 */
function generateRecommendations(top, trouble, breakdown) {
  const recs = [];

  for (const t of trouble) {
    recs.push(
      `Investigate "${t.tool}" — ${(t.negativeRate * 100).toFixed(1)}% negative correlation across ${t.uses} uses.`
    );
  }

  if (top.length > 0) {
    recs.push(
      `"${top[0].tool}" is the top performer (${(top[0].successRate * 100).toFixed(1)}% success). Consider expanding its usage patterns.`
    );
  }

  const uncorrelated = Object.entries(breakdown).filter(
    ([, v]) => v.uses >= 10 && v.successRate === null
  );
  if (uncorrelated.length > 0) {
    recs.push(
      `${uncorrelated.length} tool(s) with 10+ uses have no correlated feedback — consider adding coverage.`
    );
  }

  if (recs.length === 0) recs.push('No actionable recommendations at this time.');
  return recs;
}

/**
 * Main entry point: load data, correlate, produce report.
 *
 * @returns {Promise<object>} Full skill quality report
 */
async function run() {
  const feedbackEntries = await loadFeedback(FEEDBACK_PATH);
  const { totalToolUses, breakdown } = await processMetrics(METRICS_PATH, feedbackEntries);

  computeSuccessRates(breakdown);

  const top = topPerformers(breakdown);
  const trouble = troubleSpots(breakdown);
  const recommendations = generateRecommendations(top, trouble, breakdown);

  const report = {
    generatedAt: new Date().toISOString(),
    totalToolUses,
    toolBreakdown: breakdown,
    topPerformers: top,
    troubleSpots: trouble,
    recommendations,
  };

  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (require.main === module) {
  run().catch(() => {}).finally(() => process.exit(0));
}

module.exports = {
  parseLine,
  correlateFeedback,
  computeSuccessRates,
  topPerformers,
  troubleSpots,
  generateRecommendations,
  loadFeedback,
  processMetrics,
  run,
  CORRELATION_WINDOW_MS,
};
