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

// Before #5119 the MCP server stamped every capture_feedback call
// `reviewOrigin: automated`, so a thumb the agent recorded for the person sits in
// the log looking like a script's entry. Such a row is recognisable by what the
// capture tool writes and scripts and hooks do not: a store-learning or
// store-mistake action inside an agent session, with no source marker and no
// scraper tag. Rows from the shared store only count for the project named in
// scope.projectId, which the caller checks.
const MCP_CAPTURE_ACTIONS = new Set(['store-learning', 'store-mistake']);

function isLegacyMcpCapture(entry) {
  if (!entry || String(entry.reviewOrigin || '').trim().toLowerCase() !== 'automated') return false;
  if (!MCP_CAPTURE_ACTIONS.has(String(entry.actionType || ''))) return false;
  const sessionId = entry.scope && entry.scope.sessionId;
  if (typeof sessionId !== 'string' || !sessionId.startsWith('session_')) return false;
  if (entry.memorySource || entry.source || entry.sourceEvent) return false;
  const tags = Array.isArray(entry.tags) ? entry.tags : [];
  return !tags.some((tag) => NON_HUMAN_TAGS.has(String(tag).trim().toLowerCase()));
}

module.exports = { NON_HUMAN_TAGS, isCountedHumanFeedback, isLegacyMcpCapture };
