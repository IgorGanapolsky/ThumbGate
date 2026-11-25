'use strict';

/**
 * Pre-action holds and the chat send gate. Everything here runs BEFORE the tool call, never as a score afterwards.
 *
 * 2026-11-25, from a Cursor session: a thumbs-down did not stop the next post. It reached the agent as plain words,
 * and the agent sent four more bubbles to the same colleague chat. Two fixes:
 *
 * 1. Hold. A person's thumbs-down places a hold on the action that drew it:
 *    - the last action was a chat or colleague post: every new post is refused until the last bubble is edited in
 *      place (an edit-message call on that chat releases the hold);
 *    - the last action was anything else: the same tool (for a shell command, the same first three words) is refused
 *      until the person says to go on (the same first three words; a thumbs-up, "go ahead", "continue", "unblock", "release").
 *    - no recorded last action: new posts are refused until an edit or the person says to go on.
 *    Holds expire after 24 hours so a forgotten one never locks a project forever.
 *
 * 2. Send rules, checked on every post and every edit of a post:
 *    - a raw URL (a bare http(s) link, not a [label](url) or <url|label> link) is refused;
 *    - "I do not know" / "I don't know" is refused;
 *    - a second NEW bubble in the same chat within the bubble window (default 15 minutes) is refused: edit the last
 *      bubble instead.
 *
 * State lives in <feedback dir>/send-gate-state.json. Disable everything with THUMBGATE_SEND_GATE=0.
 */

const fs = require('node:fs');
const path = require('node:path');

const FILE_NAME = 'send-gate-state.json';
const HOLD_TTL_MS = 24 * 60 * 60 * 1000;
const LAST_ACTION_WINDOW_MS = 30 * 60 * 1000;
const DUPLICATE_MS = 60 * 1000; // the plugin hook and gate-check can both see one call: same text within 60s counts once
const KEEP_ACTIONS = 40;

function bubbleWindowMs() {
  const raw = Number(process.env.THUMBGATE_CHAT_BUBBLE_WINDOW_MIN);
  return (Number.isFinite(raw) && raw > 0 ? raw : 15) * 60 * 1000;
}

function enabled() {
  return process.env.THUMBGATE_SEND_GATE !== '0';
}

// ---------------------------------------------------------------------------
// Tool classification
// ---------------------------------------------------------------------------

/** The tool's own name without an mcp__<server>__ prefix, lowercased. */
function baseToolName(toolName) {
  const name = String(toolName || '').toLowerCase();
  const parts = name.split('__');
  return parts.length >= 3 && parts[0] === 'mcp' ? parts.slice(2).join('__') : name;
}

const NOT_A_POST_RE = /draft|schedul|delete|remove|reaction|react|unreact|read|list|search|get|fetch|history|mark|close|resolve|subscribe|status|widget|checklist|progress|label|rename/;
const EDIT_RE = /(?:^|[_.-])(?:edit|update|patch)[_.-]?(?:chat[_.-]?)?(?:message|msg|post|bubble|reply)s?(?:$|[_.-])|^chat[_.-]update$|(?:message|msg|post)[_.-]?(?:edit|update)(?:$|[_.-])/;
const POST_RE = /(?:^|[_.-])(?:send|post|reply)(?:[_.-]?(?:to[_.-]?)?(?:chat[_.-]?|channel[_.-]?|thread[_.-]?|direct[_.-]?|dm[_.-]?)?(?:message|msg|reply|text|dm|chat|bubble)s?)?(?:$|[_.-])|postmessage|sendmessage/;

/** 'post' | 'edit' | null for a tool call. */
function classifyTool(toolName) {
  const base = baseToolName(toolName);
  if (!base) return null;
  // Email has its own gate (outbound-email-send); these rules are for chat and colleague posts.
  if (/mail/.test(String(toolName).toLowerCase())) return null;
  if (EDIT_RE.test(base)) return 'edit';
  if (NOT_A_POST_RE.test(base)) return null;
  if (POST_RE.test(base)) return 'post';
  return null;
}

const CHAT_KEYS = ['chat_id', 'chatId', 'channel_id', 'channelId', 'channel', 'conversation_id', 'conversationId', 'thread_id', 'threadId', 'thread_ts', 'room', 'room_id', 'to', 'recipient', 'recipient_id', 'user_id', 'session_id'];
const TEXT_KEYS = ['text', 'message', 'content', 'body', 'markdown', 'html', 'value'];

function chatKeyOf(toolName, toolInput = {}) {
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  for (const key of CHAT_KEYS) {
    const value = input[key];
    if (value != null && String(value).trim()) return `${key}:${String(value).trim().slice(0, 120)}`;
  }
  return `tool:${baseToolName(toolName)}`;
}

function textOf(toolInput = {}) {
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  for (const key of TEXT_KEYS) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (value && typeof value === 'object') {
      if (typeof value.text === 'string') return value.text;
      if (typeof value.content === 'string') return value.content;
    }
  }
  return '';
}

/** A bare link: http(s) not inside [label](url), <url|label> or <url>. */
function findRawUrl(text) {
  const stripped = String(text || '')
    .replace(/\[[^\]]*\]\(\s*https?:\/\/[^)\s]+\s*\)/gi, ' ')
    .replace(/<https?:\/\/[^>\s]+(?:\|[^>]*)?>/gi, ' ');
  const m = stripped.match(/https?:\/\/[^\s)>\]]+/i);
  return m ? m[0] : null;
}

const DONT_KNOW_RE = /\bI\s+(?:do\s+not|don['’]?t|dont)\s+know\b/i;

function hashText(text) {
  return require('node:crypto').createHash('sha256').update(String(text || '')).digest('hex').slice(0, 16);
}

// The first three words: `rm -rf tests/` holds that deletion, not every `rm -rf`; `git push origin` holds pushes there.
function shellSignature(command) {
  return String(command || '').trim().toLowerCase().split(/\s+/).slice(0, 3).join(' ');
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

function statePath(feedbackDir) {
  return path.join(feedbackDir, FILE_NAME);
}

function readState(feedbackDir) {
  try {
    const data = JSON.parse(fs.readFileSync(statePath(feedbackDir), 'utf8'));
    return {
      holds: Array.isArray(data.holds) ? data.holds : [],
      actions: Array.isArray(data.actions) ? data.actions : [],
      posts: data.posts && typeof data.posts === 'object' ? data.posts : {},
      approved: Array.isArray(data.approved) ? data.approved : [],
    };
  } catch {
    return { holds: [], actions: [], posts: {}, approved: [] };
  }
}

function writeState(feedbackDir, state) {
  fs.mkdirSync(feedbackDir, { recursive: true });
  fs.writeFileSync(statePath(feedbackDir), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function activeHolds(state, now) {
  return state.holds.filter((h) => h && !h.releasedAt && now - Date.parse(h.createdAt) < HOLD_TTL_MS);
}

// ---------------------------------------------------------------------------
// Holds
// ---------------------------------------------------------------------------

/**
 * A person's thumbs-down: hold the action that drew it. Returns the hold.
 * @param {{feedbackDir: string, sessionId?: string, reason?: string, now?: number}} opts
 */
function placeHold({ feedbackDir, sessionId = '', reason = '', now = Date.now() }) {
  if (!feedbackDir || !enabled()) return null;
  const state = readState(feedbackDir);
  const recent = state.actions.filter((a) => now - a.at <= LAST_ACTION_WINDOW_MS && (!sessionId || !a.sessionId || a.sessionId === sessionId));
  const last = recent[recent.length - 1] || null;
  const base = {
    id: `hold_${now.toString(36)}`,
    createdAt: new Date(now).toISOString(),
    sessionId: String(sessionId || ''),
    reason: String(reason || '').slice(0, 200),
  };
  let hold;
  if (!last || last.kind === 'post' || last.kind === 'edit') {
    hold = { ...base, kind: 'post', chatKey: last ? last.chatKey : null, toolName: last ? last.toolName : null };
  } else {
    hold = { ...base, kind: 'action', toolName: last.toolName, signature: last.signature || null };
  }
  state.holds.push(hold);
  state.holds = state.holds.slice(-20);
  writeState(feedbackDir, state);
  return hold;
}

const RELEASE_PROMPT_RE = /^\s*(?:ok(?:ay)?[,\s]+)?(?:go\s+ahead|continue|proceed|carry\s+on|resume|unblock|release(?:\s+the\s+hold)?|you\s+can\s+(?:send|post|go\s+on|continue))\b/i;

function isReleasePrompt(prompt) {
  return RELEASE_PROMPT_RE.test(String(prompt || ''));
}

/** The person said to go on: release every hold. Returns how many were released. */
function releaseHolds({ feedbackDir, now = Date.now(), by = 'person' }) {
  if (!feedbackDir) return 0;
  const state = readState(feedbackDir);
  let count = 0;
  for (const hold of activeHolds(state, now)) {
    hold.releasedAt = new Date(now).toISOString();
    hold.releasedBy = by;
    count += 1;
  }
  if (count) writeState(feedbackDir, state);
  return count;
}

/**
 * A person's thumbs-up: record the action that drew it as approved, so the next run can repeat it.
 * Returns the approval, or null when there was no recent action to approve.
 * @param {{feedbackDir: string, sessionId?: string, now?: number}} opts
 */
function recordApproval({ feedbackDir, sessionId = '', now = Date.now() }) {
  if (!feedbackDir || !enabled()) return null;
  const state = readState(feedbackDir);
  const recent = state.actions.filter((a) => now - a.at <= LAST_ACTION_WINDOW_MS && (!sessionId || !a.sessionId || a.sessionId === sessionId));
  const last = recent[recent.length - 1];
  if (!last) return null;
  const approval = {
    at: new Date(now).toISOString(),
    sessionId: String(sessionId || ''),
    toolName: last.toolName,
    kind: last.kind,
    chatKey: last.chatKey || null,
    signature: last.signature || null,
  };
  const existing = state.approved.find((a) => a.toolName === approval.toolName && a.signature === approval.signature && a.chatKey === approval.chatKey);
  if (existing) {
    existing.count = (existing.count || 1) + 1;
    existing.at = approval.at;
  } else {
    state.approved.push({ ...approval, count: 1 });
  }
  state.approved = state.approved.slice(-50);
  writeState(feedbackDir, state);
  return existing || state.approved[state.approved.length - 1];
}

function describeAction(a) {
  if (!a) return '';
  if (a.signature) return `\`${a.signature} …\``;
  return a.chatKey && !String(a.chatKey).startsWith('tool:') ? `${a.toolName} (${a.chatKey})` : a.toolName;
}

// ---------------------------------------------------------------------------
// The pre-action check
// ---------------------------------------------------------------------------

function deny(gate, message) {
  return { decision: 'deny', gate, message, severity: 'critical', reasoning: [] };
}

/**
 * Check one tool call before it runs. Returns a deny result, or null to let it through. When it lets the call
 * through, the call is recorded (last action, post count per chat, edit releases a post hold).
 * @param {{feedbackDir: string, toolName: string, toolInput: object, sessionId?: string, now?: number, record?: boolean}} opts
 */
function evaluate({ feedbackDir, toolName, toolInput = {}, sessionId = '', now = Date.now(), record = true }) {
  if (!enabled() || !feedbackDir || !toolName) return null;
  const kind = classifyTool(toolName);
  const state = readState(feedbackDir);
  const holds = activeHolds(state, now);
  const chatKey = kind ? chatKeyOf(toolName, toolInput) : null;
  const command = toolInput && (toolInput.command || toolInput.cmd);
  const signature = command ? shellSignature(command) : null;

  // 1. Holds from a thumbs-down.
  for (const hold of holds) {
    if (hold.kind === 'post' && kind === 'post') {
      return deny('thumbs-down-hold', `The person gave a thumbs-down after your last post${hold.chatKey ? ` (${hold.chatKey})` : ''}. New posts are refused until you edit the last bubble in place with the edit-message tool, or the person says "go ahead". Do not send a new message, and do not switch to another chat or tool to get around this.`);
    }
    if (hold.kind === 'action' && hold.toolName === toolName && (!hold.signature || hold.signature === signature)) {
      return deny('thumbs-down-hold', `The person gave a thumbs-down right after ${hold.signature ? `\`${hold.signature} …\`` : `the ${toolName} call`}. That action is held until the person says to go on (a thumbs-up or "go ahead"). Do not retry it or route around it with another tool; ask what to change.`);
    }
  }

  // 2. Send rules, on posts and on edits of a post.
  if (kind) {
    const text = textOf(toolInput);
    const url = findRawUrl(text);
    if (url) return deny('send-raw-url', `This message has a raw URL (${url.slice(0, 80)}). Put it behind a label, like [label](url), or leave it out.`);
    if (DONT_KNOW_RE.test(text)) return deny('send-i-do-not-know', 'This message says "I do not know". Find the answer first (open the page, run the check), or say what you will check and when.');
    if (kind === 'post') {
      const last = state.posts[chatKey];
      const sameCall = last && last.textHash === hashText(text) && now - last.at <= DUPLICATE_MS;
      if (last && !sameCall && now - last.at < bubbleWindowMs()) {
        return deny('send-second-bubble', `You already posted a new bubble in this chat ${Math.round((now - last.at) / 60000)} min ago. Edit that bubble in place with the edit-message tool instead of sending another one.`);
      }
    }
  }

  if (record) {
    let changed = false;
    if (kind === 'post') {
      const textHash = hashText(textOf(toolInput));
      const last = state.posts[chatKey];
      if (!(last && last.textHash === textHash && now - last.at <= DUPLICATE_MS)) state.posts[chatKey] = { at: now, toolName, textHash };
      changed = true;
    }
    if (kind === 'edit') {
      for (const hold of holds) {
        if (hold.kind === 'post' && (!hold.chatKey || hold.chatKey === chatKey || chatKey.startsWith('tool:'))) {
          hold.releasedAt = new Date(now).toISOString();
          hold.releasedBy = 'edit-in-place';
          changed = true;
        }
      }
    }
    const prev = state.actions[state.actions.length - 1];
    const dup = prev && prev.toolName === toolName && prev.signature === signature && prev.chatKey === chatKey && now - prev.at < 2000;
    if (!dup) {
      state.actions.push({ at: now, sessionId: String(sessionId || ''), toolName, kind: kind || 'action', chatKey, signature });
      state.actions = state.actions.slice(-KEEP_ACTIONS);
      changed = true;
    }
    if (changed) {
      for (const [key, value] of Object.entries(state.posts)) if (now - value.at > 24 * 60 * 60 * 1000) delete state.posts[key];
      try { writeState(feedbackDir, state); } catch { /* recording never blocks */ }
    }
  }
  return null;
}

module.exports = {
  FILE_NAME,
  classifyTool,
  chatKeyOf,
  textOf,
  findRawUrl,
  isReleasePrompt,
  placeHold,
  releaseHolds,
  recordApproval,
  describeAction,
  evaluate,
  readState,
};
