'use strict';

const crypto = require('crypto');

const TOOL_NAMES = ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob', 'Agent', 'WebFetch', 'WebSearch'];
const PATH_PREFIXES = ['src/', 'scripts/', 'tests/', '.claude/', 'adapters/'];
const ERROR_KEYWORDS = ['error', 'fail', 'failed', 'typeerror', 'referenceerror', '401', '403', '404', '500', 'crash', 'broken', 'bug'];

function buildStableId(prefix) {
  if (typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function normalizeConversationWindow(window) {
  if (!Array.isArray(window)) return [];
  return window
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const role = String(entry.role || entry.author || 'unknown').trim();
      const content = String(entry.content || entry.text || '').trim();
      if (!content) return null;
      return {
        role,
        content,
        timestamp: entry.timestamp || null,
      };
    })
    .filter(Boolean);
}

function trimToken(token) {
  return String(token || '')
    .replace(/^[^A-Za-z0-9./_-]+/, '')
    .replace(/[^A-Za-z0-9./_-]+$/, '');
}

function extractPathFromToken(token) {
  const cleaned = trimToken(token);
  if (!cleaned) return null;
  for (const prefix of PATH_PREFIXES) {
    const index = cleaned.indexOf(prefix);
    if (index === -1) continue;
    const candidate = trimToken(cleaned.slice(index));
    if (candidate.startsWith(prefix)) return candidate;
  }
  return null;
}

function extractFilePaths(window) {
  const paths = new Set();
  for (const entry of normalizeConversationWindow(window)) {
    for (const token of entry.content.split(/\s+/)) {
      const pathValue = extractPathFromToken(token);
      if (pathValue) paths.add(pathValue);
    }
  }
  return [...paths];
}

function extractToolCalls(window) {
  const tools = new Set();
  for (const entry of normalizeConversationWindow(window)) {
    const text = entry.content;
    for (const toolName of TOOL_NAMES) {
      if (text.includes(`${toolName}(`) || text.includes(`${toolName} tool`)) {
        tools.add(toolName);
      }
    }
  }
  return [...tools];
}

function extractErrors(window) {
  const errors = new Set();
  for (const entry of normalizeConversationWindow(window)) {
    for (const line of entry.content.split('\n')) {
      const normalized = line.trim();
      if (!normalized) continue;
      const lower = normalized.toLowerCase();
      if (ERROR_KEYWORDS.some((keyword) => lower.includes(keyword))) {
        errors.add(normalized.slice(0, 120));
      }
    }
  }
  return [...errors];
}

module.exports = {
  buildStableId,
  normalizeConversationWindow,
  extractFilePaths,
  extractToolCalls,
  extractErrors,
};
