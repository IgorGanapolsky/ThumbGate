#!/usr/bin/env node
'use strict';

const { analyzeFeedback } = require('./feedback-loop');
const { normalizeStatsPayload } = require('./hook-thumbgate-cache-updater');
const { syncClaudeHistoryFeedback } = require('./claude-feedback-sync');
const { resolveProjectDir } = require('./feedback-paths');
const { aggregateFeedbackStats } = require('./feedback-aggregate-stats');

try {
  const projectDir = resolveProjectDir({ cwd: process.cwd(), env: process.env });
  syncClaudeHistoryFeedback({ projectDir });
  const stats = analyzeFeedback();

  // Default to a GLOBAL view: sum thumbs across every feedback store so the
  // statusline shows the true cross-project total instead of only the slice for
  // the folder it runs in (see feedback-aggregate-stats.js for the 2026-06-06
  // incident). Opt back into per-folder counts with THUMBGATE_STATUSLINE_SCOPE=project.
  const scope = String(process.env.THUMBGATE_STATUSLINE_SCOPE || 'global').toLowerCase();
  let counts = stats;
  if (scope !== 'project') {
    try {
      const agg = aggregateFeedbackStats({ cwd: process.cwd(), env: process.env });
      counts = {
        ...stats,
        totalPositive: agg.totalPositive,
        totalNegative: agg.totalNegative,
        total: agg.total,
        approvalRate: agg.approvalRate,
      };
    } catch {
      counts = stats; // any aggregation failure falls back to project-scope counts
    }
  }

  const payload = {
    ...normalizeStatsPayload(counts),
    updated_at: String(Math.floor(Date.now() / 1000)),
  };
  process.stdout.write(JSON.stringify(payload));
} catch (_) {
  process.exit(0);
}
