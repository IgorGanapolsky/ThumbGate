'use strict';

/**
 * Shared helpers for dashboard size / heap failures (prod feedback logs).
 */

function isDashboardDataLimitError(err) {
  const message = String(err && err.message ? err.message : err || '');
  return /string longer than|Cannot create a string|ENOMEM|JavaScript heap|out of memory/i.test(message);
}

function formatDashboardLimitDetail(err, { phase = 'assembly' } = {}) {
  const cause = err && err.message ? err.message : 'string/heap limit';
  if (phase === 'stringify') {
    return 'Dashboard JSON exceeded the runtime string limit. '
      + 'Use a bounded feedback window or rotate oversized logs. '
      + `Cause: ${cause}`;
  }
  return 'Feedback/memory logs exceeded the safe in-memory limit for dashboard assembly. '
    + 'Logs are now tail-capped; if this persists, rotate oversized JSONL under the feedback dir. '
    + `Cause: ${cause}`;
}

module.exports = {
  isDashboardDataLimitError,
  formatDashboardLimitDetail,
};
