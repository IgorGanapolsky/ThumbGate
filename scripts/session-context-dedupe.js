'use strict';

// Per-session dedupe for the static context ThumbGate hooks attach to every tool call
// (recent corrective actions, recurring failure patterns). The same text re-read on every
// call costs input tokens; inject it only when it changed since the last injection in the
// same session. Context matched to the current tool call is never routed through here.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function storeDir(options = {}) {
  return options.dir || process.env.THUMBGATE_CONTEXT_DEDUPE_DIR
    || path.join(os.tmpdir(), 'thumbgate-context-dedupe');
}

function safeSessionId(sessionId) {
  return String(sessionId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}

function hashText(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function readHash(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).hash || '';
  } catch {
    return '';
  }
}

/**
 * @param {string} sessionId
 * @param {string|null} text static context for this call
 * @returns {string|null} text if it should be injected, null if identical to the last
 *   injection in this session. Without a session id nothing is deduped.
 */
function dedupeSessionContext(sessionId, text, options = {}) {
  if (typeof text !== 'string' || text.length === 0) return null;
  const sid = safeSessionId(sessionId);
  if (!sid) return text;
  const file = path.join(storeDir(options), `${sid}.json`);
  const hash = hashText(text);
  if (readHash(file) === hash) return null;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ hash, at: Date.now() }));
  } catch {
    // a failed write only means the next call injects again
  }
  return text;
}

function logInjection(entry, options = {}) {
  try {
    const dir = options.logDir || process.env.THUMBGATE_CONTEXT_DEDUPE_LOG_DIR || storeDir(options);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'injection-bytes.jsonl'), `${JSON.stringify(entry)}\n`);
  } catch {
    // logging is best effort
  }
}

module.exports = { dedupeSessionContext, logInjection, hashText };
