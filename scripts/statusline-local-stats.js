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
  // The status line is per project by default. Global totals mix every repo's
  // entries and are opt-in with THUMBGATE_STATUSLINE_SCOPE=global.
  const scope = String(process.env.THUMBGATE_STATUSLINE_SCOPE || 'project').toLowerCase();
  const stats = scope === 'global' && shouldAggregateFeedback({ env: process.env })
    ? computeAggregateFeedbackStats({ projectDir, env: process.env })
    : analyzeFeedback(undefined, { humanOnly: true, strictHuman: true });
  const payload = {
    ...normalizeStatsPayload(stats),
    aggregate: stats.aggregate || { enabled: false },
    updated_at: String(Math.floor(Date.now() / 1000)),
  };
  process.stdout.write(JSON.stringify(payload));
} catch (_) {
  process.exit(0);
}
