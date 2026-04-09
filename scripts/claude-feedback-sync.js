'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  captureFeedback,
  getFeedbackPaths,
  readJSONL,
  analyzeFeedback,
} = require('./feedback-loop');
const { normalizeFeedbackText } = require('./feedback-quality');
const {
  resolveFeedbackDir,
  resolveProjectDir,
} = require('./feedback-paths');
const { refreshStatuslineCache } = require('./hook-thumbgate-cache-updater');

const SYNC_STATE_FILE = 'claude-feedback-sync-state.json';
const DEFAULT_RECENT_FEEDBACK_LIMIT = 250;
const DEFAULT_PROCESSED_ID_LIMIT = 512;
const DUPLICATE_WINDOW_MS = 30 * 1000;

function getClaudeHistoryPath(options = {}) {
  if (options.historyPath) return options.historyPath;
  if (process.env.THUMBGATE_CLAUDE_HISTORY_PATH) return process.env.THUMBGATE_CLAUDE_HISTORY_PATH;
  const homeDir = options.homeDir || process.env.HOME || process.env.USERPROFILE || '';
  return path.join(homeDir, '.claude', 'history.jsonl');
}

function getSyncStatePath(options = {}) {
  const feedbackDir = resolveFeedbackDir({ feedbackDir: options.feedbackDir });
  return path.join(feedbackDir, SYNC_STATE_FILE);
}

function readSyncState(options = {}) {
  const statePath = getSyncStatePath(options);
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return {
      historyOffset: Number(parsed.historyOffset || 0),
      historySize: Number(parsed.historySize || 0),
      processedIds: Array.isArray(parsed.processedIds) ? parsed.processedIds : [],
      statePath,
    };
  } catch {
    return {
      historyOffset: 0,
      historySize: 0,
      processedIds: [],
      statePath,
    };
  }
}

function writeSyncState(state, options = {}) {
  const statePath = getSyncStatePath(options);
  const payload = {
    historyOffset: Number(state.historyOffset || 0),
    historySize: Number(state.historySize || 0),
    processedIds: Array.isArray(state.processedIds) ? state.processedIds.slice(-DEFAULT_PROCESSED_ID_LIMIT) : [],
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(payload, null, 2));
  return payload;
}

function readHistoryEntriesSince(filePath, state) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      entries: [],
      nextOffset: 0,
      size: 0,
    };
  }

  const stat = fs.statSync(filePath);
  const safeOffset = state && state.historyOffset > 0 && state.historyOffset <= stat.size
    ? state.historyOffset
    : 0;

  const fileBuffer = fs.readFileSync(filePath);
  const contents = fileBuffer.slice(safeOffset).toString('utf8');

  const entries = contents
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return {
    entries,
    nextOffset: stat.size,
    size: stat.size,
  };
}

function normalizeProjectPath(value) {
  try {
    return value ? path.resolve(String(value)) : null;
  } catch {
    return null;
  }
}

function parseHistoryTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    const numeric = Number(text);
    return numeric > 1e12 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function detectSignal(text) {
  const normalized = String(text || '').toLowerCase();
  if (/(thumbs?\s*down|that failed|that was wrong|fix this)/i.test(normalized)) return 'down';
  if (/(thumbs?\s*up|that worked|looks good|nice work|perfect|good job)/i.test(normalized)) return 'up';
  return null;
}

function extractPromptText(entry) {
  const candidates = [
    entry && entry.display,
    entry && entry.message && entry.message.content,
    entry && entry.attachment && entry.attachment.prompt,
    entry && entry.content,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return '';
}

function buildExternalId(entry, promptText) {
  const hash = crypto.createHash('sha1');
  hash.update(String(entry.sessionId || ''));
  hash.update('|');
  hash.update(String(entry.timestamp || ''));
  hash.update('|');
  hash.update(String(entry.project || entry.cwd || ''));
  hash.update('|');
  hash.update(String(promptText || ''));
  return `claude-history:${hash.digest('hex')}`;
}

function toHistoryCandidate(entry, options = {}) {
  const promptText = extractPromptText(entry);
  const signal = detectSignal(promptText);
  if (!signal) return null;

  const projectDir = normalizeProjectPath(options.projectDir);
  const entryProject = normalizeProjectPath(entry.project || entry.cwd || '');
  if (projectDir && entryProject && entryProject !== projectDir && !entryProject.startsWith(`${projectDir}${path.sep}`)) {
    return null;
  }
  if (projectDir && !entryProject) {
    return null;
  }

  return {
    externalId: buildExternalId(entry, promptText),
    promptText,
    signal,
    timestampMs: parseHistoryTimestamp(entry.timestamp),
  };
}

function normalizeCandidateText(value) {
  return normalizeFeedbackText(String(value || '').replace(/\s+/g, ' '));
}

function hasMatchingFeedbackEntry(candidate, feedbackEntries) {
  const candidateText = normalizeCandidateText(candidate.promptText);
  if (!candidateText) return false;

  return feedbackEntries.some((entry) => {
    const signal = entry && entry.signal === 'negative' ? 'down' : 'up';
    if (signal !== candidate.signal) return false;

    const feedbackText = normalizeCandidateText(
      entry.submittedContext
      || entry.context
      || entry.whatWentWrong
      || entry.whatWorked
      || ''
    );
    if (feedbackText !== candidateText) return false;

    const feedbackTimestamp = Date.parse(entry.timestamp || '');
    if (!Number.isFinite(feedbackTimestamp) || !Number.isFinite(candidate.timestampMs)) {
      return true;
    }
    return Math.abs(feedbackTimestamp - candidate.timestampMs) <= DUPLICATE_WINDOW_MS;
  });
}

function syncClaudeHistoryFeedback(options = {}) {
  if (options.disabled || process.env.THUMBGATE_DISABLE_CLAUDE_HISTORY_SYNC === '1') {
    return {
      importedCount: 0,
      skippedCount: 0,
      reason: 'disabled',
    };
  }

  const originalEnv = {
    THUMBGATE_FEEDBACK_DIR: process.env.THUMBGATE_FEEDBACK_DIR,
    THUMBGATE_PROJECT_DIR: process.env.THUMBGATE_PROJECT_DIR,
    THUMBGATE_CLAUDE_HISTORY_PATH: process.env.THUMBGATE_CLAUDE_HISTORY_PATH,
  };

  if (options.feedbackDir) process.env.THUMBGATE_FEEDBACK_DIR = options.feedbackDir;
  if (options.projectDir && !options.feedbackDir) process.env.THUMBGATE_PROJECT_DIR = options.projectDir;
  if (options.historyPath) process.env.THUMBGATE_CLAUDE_HISTORY_PATH = options.historyPath;

  try {
    const feedbackDir = resolveFeedbackDir({ feedbackDir: options.feedbackDir });
    const projectDir = normalizeProjectPath(options.projectDir) || resolveProjectDir({
      cwd: process.cwd(),
      env: process.env,
    });
    const historyPath = getClaudeHistoryPath(options);
    const state = readSyncState({ feedbackDir });
    const history = readHistoryEntriesSince(historyPath, state);
    const existingEntries = readJSONL(path.join(feedbackDir, 'feedback-log.jsonl'), {
      maxLines: DEFAULT_RECENT_FEEDBACK_LIMIT,
    });

    let importedCount = 0;
    let skippedCount = 0;
    const processedIds = new Set(state.processedIds || []);

    for (const entry of history.entries) {
      const candidate = toHistoryCandidate(entry, { projectDir });
      if (!candidate) continue;
      if (processedIds.has(candidate.externalId)) {
        skippedCount += 1;
        continue;
      }

      if (hasMatchingFeedbackEntry(candidate, existingEntries)) {
        processedIds.add(candidate.externalId);
        skippedCount += 1;
        continue;
      }

      const captureResult = captureFeedback({
        signal: candidate.signal,
        context: candidate.promptText,
        whatWentWrong: candidate.signal === 'down' ? candidate.promptText : undefined,
        whatWorked: candidate.signal === 'up' ? candidate.promptText : undefined,
        tags: ['claude-history-sync', 'auto-capture-fallback'],
      });

      if (captureResult && captureResult.feedbackEvent) {
        existingEntries.push(captureResult.feedbackEvent);
      }
      processedIds.add(candidate.externalId);
      importedCount += 1;
    }

    writeSyncState({
      historyOffset: history.nextOffset,
      historySize: history.size,
      processedIds: Array.from(processedIds),
    }, { feedbackDir });

    if (importedCount > 0) {
      refreshStatuslineCache(analyzeFeedback(path.join(feedbackDir, 'feedback-log.jsonl')), path.join(feedbackDir, 'statusline_cache.json'));
    }

    return {
      importedCount,
      skippedCount,
      historyPath,
      feedbackDir,
      projectDir,
    };
  } finally {
    if (originalEnv.THUMBGATE_FEEDBACK_DIR == null) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = originalEnv.THUMBGATE_FEEDBACK_DIR;

    if (originalEnv.THUMBGATE_PROJECT_DIR == null) delete process.env.THUMBGATE_PROJECT_DIR;
    else process.env.THUMBGATE_PROJECT_DIR = originalEnv.THUMBGATE_PROJECT_DIR;

    if (originalEnv.THUMBGATE_CLAUDE_HISTORY_PATH == null) delete process.env.THUMBGATE_CLAUDE_HISTORY_PATH;
    else process.env.THUMBGATE_CLAUDE_HISTORY_PATH = originalEnv.THUMBGATE_CLAUDE_HISTORY_PATH;
  }
}

module.exports = {
  SYNC_STATE_FILE,
  detectSignal,
  extractPromptText,
  getClaudeHistoryPath,
  hasMatchingFeedbackEntry,
  parseHistoryTimestamp,
  readHistoryEntriesSince,
  readSyncState,
  syncClaudeHistoryFeedback,
  toHistoryCandidate,
  writeSyncState,
};
