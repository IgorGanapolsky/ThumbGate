#!/usr/bin/env node
'use strict';

const { analyzeFeedback } = require('./feedback-loop');
const {
  computeAggregateFeedbackStats,
  shouldAggregateFeedback,
} = require('./feedback-aggregate');
const { normalizeStatsPayload } = require('./hook-thumbgate-cache-updater');
const { syncClaudeHistoryFeedback } = require('./claude-feedback-sync');
const { resolveProjectDir } = require('./feedback-paths');

try {
  const projectDir = resolveProjectDir({ cwd: process.cwd(), env: process.env });
  syncClaudeHistoryFeedback({ projectDir });
  const scope = String(process.env.THUMBGATE_STATUSLINE_SCOPE || 'global').toLowerCase();
  const stats = scope !== 'project' && shouldAggregateFeedback({ env: process.env })
    ? computeAggregateFeedbackStats({ projectDir, env: process.env })
    : analyzeFeedback(undefined, { humanOnly: true });
  const payload = {
    ...normalizeStatsPayload(stats),
    aggregate: stats.aggregate || { enabled: false },
    updated_at: String(Math.floor(Date.now() / 1000)),
  };
  process.stdout.write(JSON.stringify(payload));
} catch (_) {
  process.exit(0);
}
