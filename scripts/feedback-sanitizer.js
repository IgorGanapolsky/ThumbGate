'use strict';

const crypto = require('node:crypto');

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

// Transport keys that distinguish hook/session envelopes from ordinary JSON
// tool inputs. A JSON object is rejected only when it carries one of these
// keys; valid inputs such as {"filePath":"AGENTS.md"} must remain searchable.
const REJECT_SUBSTRINGS = [
  'session_id',
  'transcript_path',
  'prompt_id',
  'hook_event_name',
];
const REJECT_JSON_KEYS = new Set([
  ...REJECT_SUBSTRINGS,
  'sessionid',
  'transcriptpath',
  'promptid',
  'hookeventname',
]);

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

function parseJsonValue(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { ok: false, value: null };
  }
}

function hasTransportJsonKey(text) {
  const trimmed = String(text || '').trim();
  if (!/^[[{]/.test(trimmed)) return false;
  const parsedResult = parseJsonValue(trimmed);
  if (!parsedResult.ok) return false;
  const parsed = parsedResult.value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const keys = new Set(Object.keys(parsed).map((key) => key.toLowerCase()));
  return [...keys].some((key) => REJECT_JSON_KEYS.has(key));
}

// Positive rejection guard. Returns true when `text` is a transport/metadata
// blob that must never be stored as a lesson, because it:
//   (a) is a JSON object carrying a hook/session transport key, OR
//   (b) contains multiple known transport marker substrings, OR
//   (c) is dominated by filesystem-path tokens.
function looksLikeTransportBlob(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;

  if (hasTransportJsonKey(trimmed)) return true;

  // Multiple marker names identify non-JSON transport residue. A human
  // sentence that merely discusses `session_id` is not itself an envelope.
  const lower = trimmed.toLowerCase();
  const markerCount = REJECT_SUBSTRINGS.filter((marker) => lower.includes(marker)).length;
  if (markerCount >= 2) return true;

  // (b) Dominated by filesystem-path tokens.
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length > 0) {
    const pathTokens = tokens.filter(isPathToken);
    if (pathTokens.length > 0 && pathTokens.length / tokens.length > 0.5) {
      return true;
    }
  }

  return false;
}

function firstStringField(record, names) {
  for (const name of names) {
    if (typeof record[name] === 'string' && record[name].trim()) return record[name].trim();
    if (typeof record[name] === 'number' && Number.isFinite(record[name])) return String(record[name]);
  }
  return null;
}

/**
 * Extract the human prompt plus the minimum source metadata needed to identify
 * one hook event. Transcript paths and raw identifiers never enter lesson text;
 * callers hash the source fields before persistence.
 */
function extractPromptEnvelope(rawStdin) {
  const raw = typeof rawStdin === 'string' ? rawStdin : '';
  const trimmed = raw.trim();
  if (!trimmed) return { prompt: '' };

  if (/^[[{]/.test(trimmed)) {
    const parsedResult = parseJsonValue(trimmed);
    if (!parsedResult.ok) return { prompt: trimmed };
    const parsed = parsedResult.value;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        prompt: typeof parsed.prompt === 'string' ? parsed.prompt.trim() : '',
        sessionId: firstStringField(parsed, ['session_id', 'sessionId']),
        promptId: firstStringField(parsed, ['prompt_id', 'promptId']),
        projectDir: firstStringField(parsed, ['cwd', 'project', 'project_dir', 'projectDir']),
        timestamp: firstStringField(parsed, ['timestamp', 'created_at', 'createdAt']),
        hookEventName: firstStringField(parsed, ['hook_event_name', 'hookEventName']),
      };
    }
    return { prompt: '' };
  }

  return { prompt: trimmed };
}

// Persist ONLY the human `.prompt` field from a hook transport envelope.
function extractPromptText(rawStdin) {
  return extractPromptEnvelope(rawStdin).prompt;
}

function stripEphemeralText(text) {
  if (!text || typeof text !== 'string') return '';
  let stripped = String(text);
  for (const key of TRANSPORT_KEYS) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    const assignment = new RegExp(String.raw`["']?${escapedKey}["']?\s*[:=]\s*["']?[^"',}\]\s]+["']?`, 'gi');
    stripped = stripped.replace(assignment, ' ');
  }
  return stripped
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
  const raw = String(text || '').trim();
  // A raw hook-stdin PAYLOAD — a pure JSON object carrying transport markers
  // (session_id / transcript_path / prompt_id / hook_event_name) — is never a
  // human lesson; reject it whole, even when it also carries a `prompt` field
  // (that field is pulled out separately via extractPromptText). But do NOT
  // reject content JSON that carries no transport markers (e.g. a tool input
  // {"filePath":"…","reason":"…"}): it must survive so it can be matched against
  // patterns. The discriminator is the marker, not JSON-ness.
  if (hasTransportJsonKey(raw)) return '';
  // Otherwise scrub ephemeral marker key:value pairs and volatile paths, then
  // reject only if nothing substantive remains — so real feedback that arrives
  // next to hook metadata keeps the sentence while the metadata is stripped, and
  // space-separated marker residue / path-dominated blobs collapse to
  // transport-only text and are dropped by transportWordsOnly().
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
  extractPromptEnvelope,
  extractPromptText,
};
