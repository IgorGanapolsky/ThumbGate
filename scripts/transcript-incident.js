'use strict';

// What was thumbed down: the last tool call (or reply) and the turns before it, read from the Claude Code transcript.
// A transcript is picked only by proof, never by "most recent": its session id hashes to the hook's sessionHash, it is
// the Claude Code session the CLI is running in, or it holds this exact capture_feedback call. No proof, no incident.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { redactSecrets } = require('./secret-redaction');

const TAIL_BYTES = 2 * 1024 * 1024;
const RECENT_MS = 10 * 60 * 1000;
const OWN_TOOLS = /thumbgate|capture_feedback|^ToolSearch$/i;
const THUMB = /👎|thumbs?[\s_-]*down|^\s*(?:bad|wrong)\b/i;
const CLI_CAPTURE = /(?:thumbgate|cli\.js)\S*["']?\s+(?:capture|feedback)\b/;

function transcriptRoot() {
  return process.env.THUMBGATE_TRANSCRIPTS_DIR
    || path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
}

function listTranscripts(root = transcriptRoot()) {
  const files = [];
  try {
    for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      for (const name of fs.readdirSync(path.join(root, dir.name))) {
        if (name.endsWith('.jsonl')) files.push(path.join(root, dir.name, name));
      }
    }
  } catch { /* no transcripts on this machine */ }
  return files;
}

function readEntries(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const { size } = fs.fstatSync(fd);
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    const entries = [];
    for (const line of buffer.toString('utf8').split('\n')) {
      try {
        const entry = JSON.parse(line);
        if (entry && !entry.isSidechain && !entry.isMeta) entries.push(entry);
      } catch { /* blank or cut line */ }
    }
    return entries;
  } catch {
    return [];
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function blocksOf(entry) {
  const content = entry.message && entry.message.content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? content.filter(Boolean) : [];
}

// Flatten to ordered items: what the person typed, what the agent said, what the agent ran.
function itemsOf(entries) {
  const items = [];
  for (const entry of entries) {
    const role = entry.type;
    if (role !== 'user' && role !== 'assistant') continue;
    const blocks = blocksOf(entry);
    if (role === 'user' && blocks.some((b) => b.type === 'tool_result')) continue;
    for (const block of blocks) {
      if (block.type === 'text' && block.text && block.text.trim()) {
        // System-injected user text starts with a tag; it is not the person talking.
        if (role === 'user' && block.text.trimStart().startsWith('<')) continue;
        items.push({ role, text: block.text.trim(), at: Date.parse(entry.timestamp) });
      } else if (role === 'assistant' && block.type === 'tool_use') {
        items.push({ role, tool: block.name || 'tool', input: block.input || {} });
      }
    }
  }
  return items;
}

function actionOf(item) {
  const command = typeof item.input.command === 'string' ? item.input.command : '';
  return command ? { tool: item.tool, command } : { tool: item.tool, input: item.input };
}

function asMessage(item) {
  const text = item.tool
    ? `${item.tool} ${typeof item.input.command === 'string' ? item.input.command : JSON.stringify(item.input)}`
    : item.text;
  return { role: item.role, content: redactSecrets(text).slice(0, 500) };
}

// The correction the person typed, if their message holds one: a clause that tells the agent what to do.
const DIRECTIVE = /^(?:(?:please|instead|next time|first)\b|(?:always|never|do not|don't|use|run|rebase|ask|check|read|verify|test|stop|keep|wait|show|fix|add|remove|open|commit)\s)|\b(?:instead|should have|should)\b/i;
function correctionIn(text) {
  const clauses = String(text || '').replace(/^\s*(?:👎|thumbs?[\s_-]*down)[\s:,-]*/iu, '').split(/(?:[.;!\n]+|\s[—-]\s)\s*/);
  const found = clauses.map((c) => c.trim()).filter((c) => c.split(/\s+/).length >= 3 && DIRECTIVE.test(c));
  return found.length ? redactSecrets(found.join('; ')).slice(0, 400) : null;
}

// `items` ends just before the thumbs-down. Returns { lastAction, conversationWindow } or null.
function incidentFrom(items) {
  const usable = items.filter((item) => !(item.tool && OWN_TOOLS.test(item.tool)));
  let start = usable.length - 1;
  while (start >= 0 && usable[start].role !== 'user') start -= 1;
  if (start < 0) return null;
  let at = usable.length - 1;
  while (at > start && !usable[at].tool) at -= 1;
  // With a tool call: the window stops before it. Without one: the window ends with the reply itself.
  const before = at > start ? usable.slice(0, at) : usable;
  if (at <= start && usable.length - 1 === start) return null;
  // Keep the request being worked on even when many steps followed it.
  const request = before[start];
  const rest = before.slice(start + 1).slice(-8);
  const earlier = before.slice(0, start).slice(-Math.max(0, 9 - rest.length));
  return {
    lastAction: at > start ? actionOf(usable[at]) : null,
    conversationWindow: [...earlier, request, ...rest].map(asMessage),
  };
}

// Hook path: cut at this thumbs-down prompt when the transcript already holds it.
function beforePrompt(items, prompt) {
  const wanted = String(prompt || '').trim();
  const last = items[items.length - 1];
  if (last && last.role === 'user' && !last.tool && (last.text === wanted || THUMB.test(last.text))) return items.slice(0, -1);
  return items;
}

// A history import runs long after the thumb, so the transcript has moved on: cut at that very prompt, wherever it is.
// Not found, or typed more than once with no way to tell which, means no incident rather than a later one.
function atPrompt(items, prompt, timestamp) {
  const wanted = String(prompt || '').trim();
  const hits = items.flatMap((item, i) => (item.role === 'user' && item.text === wanted ? [i] : []));
  if (hits.length < 2) return hits.length ? items.slice(0, hits[0]) : null;
  const stamp = Date.parse(timestamp);
  const near = hits.filter((i) => Math.abs(items[i].at - stamp) < 60 * 1000);
  return near.length === 1 ? items.slice(0, near[0]) : null;
}

// CLI path: `thumbgate capture` run from inside a session. Cut before that command, and before the thumb it answers.
function beforeCliCapture(items) {
  const isCapture = (item) => Boolean(item.tool) && CLI_CAPTURE.test(String(item.input.command || ''));
  let at = items.length - 1;
  while (at >= 0 && !isCapture(items[at])) at -= 1;
  const kept = (at >= 0 ? items.slice(0, at) : items).filter((item) => !isCapture(item));
  let prompt = kept.length - 1;
  while (prompt >= 0 && kept[prompt].role !== 'user') prompt -= 1;
  return prompt >= 0 && THUMB.test(kept[prompt].text) ? kept.slice(0, prompt) : kept;
}

function findBySession(sessionHash, hash) {
  return listTranscripts().find((file) => {
    const own = hash(path.basename(file, '.jsonl'));
    return own === sessionHash || hash(own) === sessionHash;
  });
}

function isThisCall(item, call) {
  return Boolean(item.tool && /capture_feedback$/.test(item.tool))
    && ['signal', 'context', 'whatWentWrong', 'whatToChange'].every((key) => (item.input[key] || '') === (call[key] || ''));
}

// MCP path: the one recent transcript that contains this exact call. Two matches are ambiguous, so none.
function findByCall(call) {
  const matches = [];
  for (const file of listTranscripts()) {
    try {
      if (Date.now() - fs.statSync(file).mtimeMs > RECENT_MS) continue;
    } catch { continue; }
    const items = itemsOf(readEntries(file));
    for (let i = items.length - 1; i >= 0; i -= 1) {
      if (!isThisCall(items[i], call)) continue;
      let prompt = i - 1;
      while (prompt >= 0 && items[prompt].role !== 'user') prompt -= 1;
      matches.push(items.slice(0, prompt >= 0 && THUMB.test(items[prompt].text) ? prompt : i));
      break;
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function resolveIncident({ sourceEvent, mcpCall, sessionId, prompt, hash }) {
  try {
    if (sessionId) {
      const file = listTranscripts().find((candidate) => path.basename(candidate, '.jsonl') === sessionId);
      return file ? incidentFrom(beforeCliCapture(itemsOf(readEntries(file)))) : null;
    }
    if (mcpCall) {
      const items = findByCall(mcpCall);
      return items ? incidentFrom(items) : null;
    }
    if (!sourceEvent || !sourceEvent.sessionHash) return null;
    const file = findBySession(sourceEvent.sessionHash, hash);
    if (!file) return null;
    const items = itemsOf(readEntries(file));
    const kept = sourceEvent.source === 'claude-history' ? atPrompt(items, prompt, sourceEvent.timestamp) : beforePrompt(items, prompt);
    return kept ? incidentFrom(kept) : null;
  } catch {
    return null; // capture must never fail because a transcript is odd
  }
}

module.exports = { resolveIncident, incidentFrom, itemsOf, correctionIn };
