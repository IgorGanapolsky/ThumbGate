#!/usr/bin/env node
'use strict';

const { analyzeFeedback } = require('./feedback-loop');
const { normalizeStatsPayload } = require('./hook-thumbgate-cache-updater');

try {
  const stats = analyzeFeedback();
  const payload = {
    ...normalizeStatsPayload(stats),
    updated_at: String(Math.floor(Date.now() / 1000)),
  };
  process.stdout.write(JSON.stringify(payload));
} catch (_) {
  process.exit(0);
}
