'use strict';

// A status-line thumb counts only when a person gave it. `reviewOrigin: human`
// alone is not enough: the Claude-history sync and the auto-capture hook write
// entries with that origin from text they scraped, not from a deliberate click or
// capture_feedback call.
const NON_HUMAN_TAGS = new Set([
  'claude-history-sync',
  'auto-capture-fallback',
  'auto-capture',
  'auto-hook',
  'automated',
]);

function isCountedHumanFeedback(entry) {
  if (!entry || String(entry.reviewOrigin || '').trim().toLowerCase() !== 'human') return false;
  const tags = Array.isArray(entry.tags) ? entry.tags : [];
  if (tags.some((tag) => NON_HUMAN_TAGS.has(String(tag).trim().toLowerCase()))) return false;
  const source = String(entry.memorySource || entry.source || '').trim().toLowerCase();
  return !NON_HUMAN_TAGS.has(source);
}

module.exports = { NON_HUMAN_TAGS, isCountedHumanFeedback };
