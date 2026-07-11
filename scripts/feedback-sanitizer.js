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

// Positive-rejection markers: any raw feedback text that carries one of these
// substrings is a hook/session transport payload, never a human lesson. Unlike
// TRANSPORT_WORDS (a denylist that a blob can slip past when it also contains
// non-transport path fragments like "workspace", "git", the repo name or
// "jsonl"), these markers force an outright reject.
const REJECT_SUBSTRINGS = [
  'session_id',
  'transcript_path',
  'prompt_id',
  'hook_event_name',
];

// A token is treated as a filesystem-path fragment when it contains a path
// separator, ends in a machine-file extension, or is a bare UUID.
function isPathToken(token) {
  if (!token) return false;
  return (
    token.includes('/') ||
    token.includes('\\') ||
    /\.(?:jsonl|json|log|sqlite|db)$/i.test(token) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)
  );
}

// Positive rejection guard. Returns true when `text` is a transport/metadata
// blob that must never be stored as a lesson, because it:
//   (a) parses as JSON (a structured payload, not a sentence), OR
//   (b) contains a known transport marker substring, OR
//   (c) is dominated by filesystem-path tokens.
function looksLikeTransportBlob(text) {
  const raw = String(text || '');
  const trimmed = raw.trim();
  if (!trimmed) return false;

  // (a) Anything that parses as JSON is a payload, not a human lesson.
  if (/^[[{]/.test(trimmed)) {
    try {
      JSON.parse(trimmed);
      return true;
    } catch (_) {
      /* not valid JSON — fall through to substring/path checks */
    }
  }

  // (b) Known transport marker substrings.
  const lower = trimmed.toLowerCase();
  if (REJECT_SUBSTRINGS.some((marker) => lower.includes(marker))) return true;

  // (c) Dominated by filesystem-path tokens.
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length > 0) {
    const pathTokens = tokens.filter(isPathToken);
    if (pathTokens.length > 0 && pathTokens.length / tokens.length >= 0.5) {
      return true;
    }
  }

  return false;
}

// Extract the human prompt text from a UserPromptSubmit hook stdin payload.
// Claude Code / Codex deliver the hook input as a JSON object
// {"session_id":..,"transcript_path":..,"cwd":..,"prompt":"<human text>"}.
// We must persist ONLY the `.prompt` field as feedback/lesson content — never
// the whole stdin object. A JSON object with no `prompt` field is pure
// transport metadata and yields no prompt text.
function extractPromptText(rawStdin) {
  const raw = typeof rawStdin === 'string' ? rawStdin : '';
  const trimmed = raw.trim();
  if (!trimmed) return '';

  if (/^[[{]/.test(trimmed)) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        if (typeof parsed.prompt === 'string') return parsed.prompt.trim();
        // Structured payload with no human prompt field → no lesson text.
        return '';
      }
      // Parsed to an array / scalar — not a user prompt.
      return '';
    } catch (_) {
      // Not valid JSON — a genuine human prompt that merely starts with a
      // brace/bracket. Fall through and return it verbatim.
      return trimmed;
    }
  }

  return trimmed;
}

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
  // Positive rejection first: JSON payloads, transport markers, and
  // path-dominated blobs are always "transport only" regardless of the
  // incidental non-transport words they contain.
  if (looksLikeTransportBlob(text)) return true;
  const tokens = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9_ -]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3);
  if (tokens.length === 0) return true;
  return tokens.every((token) => TRANSPORT_WORDS.has(token));
}

function sanitizeFeedbackText(text) {
  // Reject transport/metadata blobs outright, on the ORIGINAL text — before
  // stripEphemeralText scrubs the marker keys that identify them.
  if (looksLikeTransportBlob(text)) return '';
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
  REJECT_SUBSTRINGS,
  sanitizeFeedbackText,
  actionFingerprint,
  transportWordsOnly,
  looksLikeTransportBlob,
  extractPromptText,
};
