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
 *      until the person says to go on (the same first three words; a thumbs-up, "go ahead", "continue", "unblock", "release",
 *      or a plain order to fix). Read-only calls are never held, and a hold lands on the last call that was not a read.
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
 * Disable only the thumbs-down hold with `thumbgate holds off` (read on every call, so it works in a live session)
 * or THUMBGATE_THUMBS_DOWN_HOLD=0 (new sessions). `thumbgate holds release` clears the current holds.
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

// The first three words of each part that acts: `rm -rf tests/` holds that deletion, not every `rm -rf`. Setup in
// front of it (`export GH_TOKEN="$(gh auth token)"`, `cd`) and reads are not the action, so they hold nothing.
const firstWords = (words) => words.slice(0, 3).join(' ').toLowerCase().replace(/\s+/g, ' ');

/** The word lists of the parts of a command that act, including inside `$(…)`; null when it cannot be parsed. */
function actingSegments(command) {
  let text = String(command || '');
  if (text.includes('<<')) return null;
  const texts = [];
  for (let m = /\$\(([^()]*)\)/.exec(text); m; m = /\$\(([^()]*)\)/.exec(text)) {
    texts.push(m[1]);
    text = `${text.slice(0, m.index)}SUB${text.slice(m.index + m[0].length)}`;
  }
  const parsed = [text, ...texts].map((part) => shellSegments(part.replace(/\d*>>?\s*(?:"[^"]*"|'[^']*'|[^\s;|&<>()"']+)/g, ' ')));
  if (parsed.includes(null)) return null;
  return parsed.flat().map((words) => {
    let start = 0;
    while (SHELL_PREFIXES.has(words[start]) || /^[A-Za-z_]\w*\+?=/.test(words[start] || '')) start += 1;
    return words.slice(start);
  }).filter((words) => words.length && !['export', 'set'].includes(words[0])
    && firstWords(words) !== 'gh auth token' && !isReadSegment(words, new Set()));
}

function shellSignature(command) {
  const acting = actingSegments(command);
  if (!acting || !acting.length) return firstWords(String(command || '').trim().split(/\s+/));
  return [...new Set(acting.map(firstWords))].join('\n');
}

const sameAction = (held, current) => Boolean(current) && held.split('\n').some((part) => current.split('\n').includes(part));
const shownAction = (signature) => signature.split('\n').join(' …` and `');

// ---------------------------------------------------------------------------
// Read-only calls: never held by a thumbs-down, and never the action a hold lands on. Strict: anything unsure is a write.
// ---------------------------------------------------------------------------

const READ_TOOLS = new Set(['read', 'grep', 'glob', 'ls', 'notebookread', 'toolsearch', 'webfetch', 'websearch']);
const READ_NAME_RE = /^(?:get|list|search|read|find|view|describe|show|fetch)(?:[_-]|$)/;
const WRITE_WORD_RE = /(?:^|[_-])(?:create|delete|update|send|post|write|set|remove|add|run|exec|execute|mark|archive|trash|move|rename|label|edit|patch|upsert|insert|apply|merge|approve|cancel|start|stop|replace)(?:[_-]|$)/;
const READ_PROGRAMS = new Set(['ls', 'cat', 'head', 'tail', 'grep', 'rg', 'wc', 'find', 'echo', 'printf', 'pwd', 'stat', 'file', 'which', 'date', 'jq', 'cut', 'sort', 'tr', 'cd', 'sleep', 'true', 'false']);
const BANNED_ARGS = {
  find: /^-(?:delete|exec|execdir|ok|okdir|fprint0?|fprintf|fls)$/,
  sort: /^(?:-[a-zA-Z]*o|--output|--compress-program)/,
  rg: /^--pre/,
  date: /^(?:-s|--set)/,
};
const GIT_READS = new Set(['status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'blame', 'grep']);
const GH_READS = new Set(['pr view', 'pr list', 'pr checks', 'pr diff', 'pr status', 'issue view', 'issue list', 'run view', 'run list']);
const SHELL_PREFIXES = new Set(['do', 'then', 'else', 'if', 'elif', 'while', 'until', '!', 'time']);

/** Split a command into segments of words, or null when it redirects, substitutes, or cannot be parsed. */
function shellSegments(command) {
  const text = String(command || '').replace(/(?:[12]?>|&>)\s*\/dev\/null\b|[12]>&[12]\b/g, ' ');
  const segments = [[]];
  let word = '';
  let bare = ''; // the unquoted characters of the word, where the shell can still expand braces
  let braces = false;
  let quote = null;
  const endWord = () => {
    if (/\{[^{}]*(?:,|\.\.)[^{}]*\}/.test(bare)) braces = true;
    if (word) segments[segments.length - 1].push(word);
    word = '';
    bare = '';
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote !== "'" && (c === '`' || (c === '$' && text[i + 1] === '('))) return null;
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"') { word += text[i + 1] || ''; i += 1; } else word += c;
    } else if (c === '#' && !word) {
      while (i + 1 < text.length && text[i + 1] !== '\n') i += 1; // a comment, whatever quotes it holds
    } else if (c === '$' && (text[i + 1] === "'" || text[i + 1] === '"')) return null;
    else if (c === "'" || c === '"') quote = c;
    else if (c === '\\') { if (text[i + 1] !== '\n') word += text[i + 1] || ''; i += 1; }
    else if ('<>()'.includes(c)) return null;
    else if (';|&\n'.includes(c)) { endWord(); segments.push([]); }
    else if (/\s/.test(c)) endWord();
    else { word += c; bare += c; }
  }
  if (quote) return null;
  endWord();
  if (braces) return null; // `{-delete,-print}` becomes flags that no check here would see
  return segments.filter((s) => s.length);
}

/** An argument whose expansion cannot add a flag: no `$`, or this command's own loop variable inside a plain word. */
function safeArgument(arg, loopVars) {
  if (!arg.includes('$')) return true;
  if (arg.startsWith('$') || arg.startsWith('-')) return false;
  return arg.split('$').slice(1).every((rest) => loopVars.has((/^\{?([A-Za-z_]\w*)/.exec(rest) || [])[1]));
}

function isReadSegment(words, loopVars) {
  let start = 0;
  while (SHELL_PREFIXES.has(words[start])) start += 1;
  const [program, ...args] = words.slice(start);
  if (!program || program === 'done' || program === 'fi') return true;
  // A loop value or a variable standing alone could smuggle in a flag, so neither may.
  if (program === 'for') return !args.slice(1).some((a) => a.includes('$') || /(?:^|\s)-/.test(a));
  if ((program === 'git' || program === 'gh' || BANNED_ARGS[program]) && !args.every((a) => safeArgument(a, loopVars))) return false;
  // `-v` writes a variable (and evaluates an array subscript); a leading expansion could turn into it.
  if (program === 'printf' && /^(?:-v|-?\$)/.test(args[0] || '')) return false;
  if (program === 'git') return GIT_READS.has(args[0]) && !args.some((a) => /^(?:--output|--ext-diff|--open-files-in-pager|-[a-zA-Z]*O)/.test(a));
  if (program === 'gh') {
    // `gh api` is a GET only without a method or any field/body flag.
    if (args[0] === 'api') return !args.some((a) => /^(?:-(?!-)[a-zA-Z]*[XfF]|--method|--field|--raw-field|--input)/.test(a));
    return GH_READS.has(`${args[0]} ${args[1]}`) && !args.includes('--web') && !args.includes('-w');
  }
  return READ_PROGRAMS.has(program) && !(BANNED_ARGS[program] && args.some((a) => BANNED_ARGS[program].test(a)));
}

function isReadOnlyCall(toolName, toolInput = {}) {
  const command = toolInput && (toolInput.command || toolInput.cmd);
  const base = baseToolName(toolName);
  if (command || base === 'bash' || base === 'shell') {
    const segments = shellSegments(command);
    // Only plain literal values: a space or a glob could add a flag when the variable is expanded unquoted.
    const loopVars = new Set((segments || [])
      .filter((words) => words[0] === 'for' && words.slice(3).every((value) => /^[\w.:/@%+=,][\w.:/@%+=,-]*$/.test(value)))
      .map((words) => words[1]));
    return Boolean(segments && segments.length && segments.every((words) => isReadSegment(words, loopVars)));
  }
  if (READ_TOOLS.has(base)) return true;
  return READ_NAME_RE.test(base) && !WRITE_WORD_RE.test(base);
}

// ---------------------------------------------------------------------------
// History: the newest records, plus each session's latest action, so reads cannot push out what a hold lands on.
function trimActions(actions, now) {
  const latest = new Map();
  for (const a of actions) if (!a.readOnly && now - a.at <= LAST_ACTION_WINDOW_MS) latest.set(a.sessionId, a);
  const kept = new Set(latest.values());
  return actions.filter((a, i) => i >= actions.length - KEEP_ACTIONS || kept.has(a));
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
      holdsOff: data.holdsOff === true,
      taughtAt: typeof data.taughtAt === 'string' ? data.taughtAt : null,
    };
  } catch {
    return { holds: [], actions: [], posts: {}, approved: [], holdsOff: false, taughtAt: null };
  }
}

// Only the thumbs-down hold is switched off by these; the send rules (raw URL, "I do not know", second bubble) stay on.
// THUMBGATE_THUMBS_DOWN_HOLD=0 applies to new sessions; `thumbgate holds off` writes the state file, which every call reads.
function holdsEnabled(state) {
  return process.env.THUMBGATE_THUMBS_DOWN_HOLD !== '0' && !(state && state.holdsOff);
}

const HOLD_DOC_URL = 'https://thumbgate.ai/guide#holds';
const HOLD_EXITS = `Ways out (tell the person): they say "go ahead" or give a thumbs-up; they run \`npx thumbgate holds release\` to clear it now; or \`npx thumbgate holds off\` turns off only this hold and keeps every other gate. ${HOLD_DOC_URL}`;

/** Turn only the thumbs-down hold off or on for this project, and clear what is held when turning it off. */
function setHoldsEnabled({ feedbackDir, enabled: on, now = Date.now() }) {
  const state = readState(feedbackDir);
  state.holdsOff = !on;
  if (!on) for (const hold of activeHolds(state, now)) { hold.releasedAt = new Date(now).toISOString(); hold.releasedBy = 'holds-off'; }
  writeState(feedbackDir, state);
  return { holdsOff: state.holdsOff };
}

/** Active holds, for `thumbgate holds`. */
function listHolds({ feedbackDir, now = Date.now() }) {
  const state = readState(feedbackDir);
  return { holdsOff: !holdsEnabled(state), holds: activeHolds(state, now) };
}

/** Plain text for `thumbgate doctor`: each current hold and the one command that clears it. */
function formatHolds({ holdsOff, holds }) {
  const lines = ['Holds (pauses after a thumbs-down)'];
  if (holdsOff) lines.push('  holds: OFF for this project (`npx thumbgate holds on` turns them back on)');
  if (!holds.length) {
    lines.push('  none held right now');
    return lines.join('\n');
  }
  for (const hold of holds) {
    const what = hold.kind === 'post' ? `new chat posts${hold.chatKey ? ` (${hold.chatKey})` : ''}` : (hold.signature ? `\`${shownAction(hold.signature)} …\`` : hold.toolName);
    lines.push(`  held: ${what}  clear it: npx thumbgate holds release`);
  }
  lines.push('  `npx thumbgate holds release` clears every hold at once.');
  return lines.join('\n');
}

/** True the first time it is called for this project, so the exits are taught once. */
function teachOnce({ feedbackDir, now = Date.now() }) {
  const state = readState(feedbackDir);
  if (state.taughtAt) return false;
  state.taughtAt = new Date(now).toISOString();
  writeState(feedbackDir, state);
  return true;
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
  if (!holdsEnabled(state)) return null;
  const recent = state.actions.filter((a) => !a.readOnly && now - a.at <= LAST_ACTION_WINDOW_MS && (!sessionId || !a.sessionId || a.sessionId === sessionId));
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
  // Thumbs-downs in a row on the same action are one hold, not a pile that each needs releasing.
  const same = activeHolds(state, now).find((h) => h.kind === hold.kind && h.toolName === hold.toolName && (h.signature || null) === (hold.signature || null) && (h.chatKey || null) === (hold.chatKey || null));
  if (same) return { ...same, repeated: true };
  state.holds.push(hold);
  state.holds = state.holds.slice(-20);
  writeState(feedbackDir, state);
  return hold;
}

const RELEASE_PROMPT_RE = /^\s*(?:ok(?:ay)?[,\s]+)?(?:go\s+ahead|continue|proceed|carry\s+on|resume|unblock|release(?:\s+the\s+hold)?|you\s+can\s+(?:send|post|go\s+on|continue))\b/i;

// A plain order to fix what was marked wrong: "fix it", "please fix all problems", "ok, now repair this".
const FIX_PROMPT_RE = /^\s*(?:(?:ok(?:ay)?|please|now|then|just)[,\s]+)*(?:fix|repair)\b/i;

function isReleasePrompt(prompt) {
  return RELEASE_PROMPT_RE.test(String(prompt || '')) || FIX_PROMPT_RE.test(String(prompt || ''));
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
    textHash: last.textHash || null,
  };
  const existing = state.approved.find((a) => a.toolName === approval.toolName && a.signature === approval.signature && a.chatKey === approval.chatKey && (a.textHash || null) === approval.textHash);
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
  if (a.signature) return `\`${shownAction(a.signature)} …\``;
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
  const holds = holdsEnabled(state) ? activeHolds(state, now) : [];
  const chatKey = kind ? chatKeyOf(toolName, toolInput) : null;
  const command = toolInput && (toolInput.command || toolInput.cmd);
  const signature = command ? shellSignature(command) : null;

  // 1. Holds from a thumbs-down. A read changes nothing, so it is never held.
  const readOnly = !kind && isReadOnlyCall(toolName, toolInput);
  for (const hold of readOnly ? [] : holds) {
    if (hold.kind === 'post' && kind === 'post') {
      return deny('thumbs-down-hold', `The person gave a thumbs-down after your last post${hold.chatKey ? ` (${hold.chatKey})` : ''}. New posts are refused until you edit the last bubble in place with the edit-message tool, or the person says "go ahead". Do not send a new message, and do not switch to another chat or tool to get around this. ${HOLD_EXITS}`);
    }
    if (hold.kind === 'action' && hold.toolName === toolName && (!hold.signature || sameAction(hold.signature, signature))) {
      return deny('thumbs-down-hold', `The person gave a thumbs-down right after ${hold.signature ? `\`${shownAction(hold.signature)} …\`` : `the ${toolName} call`}. That action is held until the person says to go on (a thumbs-up or "go ahead"). Do not retry it or route around it with another tool; ask what to change. ${HOLD_EXITS}`);
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
    // Posts and edits have no command, so their wording (hashed) is what tells two approved posts apart.
    const textHash = kind ? hashText(textOf(toolInput)) : null;
    const dup = prev && prev.toolName === toolName && prev.signature === signature && prev.chatKey === chatKey && (prev.textHash || null) === textHash && Boolean(prev.readOnly) === readOnly && now - prev.at < 2000;
    if (!dup) {
      state.actions.push({ at: now, sessionId: String(sessionId || ''), toolName, kind: kind || 'action', chatKey, signature, ...(textHash ? { textHash } : {}), ...(readOnly ? { readOnly: true } : {}) });
      state.actions = trimActions(state.actions, now);
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
  isReadOnlyCall,
  isReleasePrompt,
  placeHold,
  releaseHolds,
  recordApproval,
  describeAction,
  evaluate,
  readState,
  setHoldsEnabled,
  listHolds,
  teachOnce,
  formatHolds,
  HOLD_EXITS,
};
