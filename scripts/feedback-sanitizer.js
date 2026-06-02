'use strict';

const crypto = require('crypto');

const TRANSPORT_KEYS = new Set([
  'hookeventname',
  'hook_event_name',
  'sessionid',
  'session_id',
  'transcriptpath',
  'transcript_path',
  'timestamp',
  'createdat',
  'created_at',
  'updatedat',
  'updated_at',
  'cwd',
  'pid',
  'processid',
  'process_id',
  'promptid',
  'prompt_id',
  'traceid',
  'trace_id',
  'requestid',
  'request_id',
  'installid',
  'install_id',
  'visitorsessionid',
  'visitor_session_id',
  'toolinput',
  'tool_input',
]);

const TRANSPORT_WORDS = new Set([
  ...TRANSPORT_KEYS,
  'hook',
  'event',
  'userpromptsubmit',
  'user_prompt_submit',
  'pretooluse',
  'pre_tool_use',
  'posttooluse',
  'post_tool_use',
  'claude',
  'codex',
  'projects',
  'redacted',
  'tmp',
  'private',
  'folders',
  'json',
]);

function stripEphemeralText(text) {
  if (!text || typeof text !== 'string') return '';
  return String(text)
    .replace(/["']?(?:hook_?event_?name|session_?id|transcript_?path|timestamp|created_?at|updated_?at|cwd|pid|process_?id|prompt_?id|trace_?id|request_?id|install_?id|visitor_?session_?id)["']?\s*[:=]\s*["']?[^"',}\]\s]+["']?/gi, ' ')
    .replace(/\/(?:private\/)?tmp\/[^\s"',}\]]+/gi, ' ')
    .replace(/\/var\/folders\/[^\s"',}\]]+/gi, ' ')
    .replace(/\/Users\/[^/\s]+\/\.(?:claude|codex|thumbgate)\/[^\s"',}\]]+/gi, ' ')
    .replace(/\/Users\/[^/\s]+\/\.config\/thumbgate\/[^\s"',}\]]+/gi, ' ')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ' ')
    .replace(/\b[0-9a-f]{24,}\b/gi, ' ')
    .replace(/\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?z?\b/gi, ' ')
    .replace(/\b\d{10,13}\b/g, ' ')
    .replace(/:\d{4,5}\b/g, ':PORT');
}

function transportWordsOnly(text) {
  const tokens = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9_ -]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3);
  if (tokens.length === 0) return true;
  return tokens.every((token) => TRANSPORT_WORDS.has(token));
}

function sanitizeFeedbackText(text) {
  const stripped = stripEphemeralText(text)
    .replace(/\/Users\/[^\s/]+/g, '/Users/redacted')
    .replace(/\s+/g, ' ')
    .trim();
  if (transportWordsOnly(stripped)) return '';
  return stripped;
}

function actionFingerprint(parts) {
  const raw = Array.isArray(parts) ? parts.join(' ') : String(parts || '');
  const stable = sanitizeFeedbackText(raw)
    .toLowerCase()
    .replace(/[^a-z0-9._:/ -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!stable || transportWordsOnly(stable)) return null;
  return crypto.createHash('sha256').update(stable).digest('hex').slice(0, 16);
}

module.exports = {
  TRANSPORT_WORDS,
  sanitizeFeedbackText,
  actionFingerprint,
  transportWordsOnly,
};
