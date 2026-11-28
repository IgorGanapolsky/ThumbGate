'use strict';

// Opt-in: a tool call you gave 👍 becomes an automatic approval the next time.
//
// Runs after every ThumbGate check in `gate-check`. It only ever upgrades a call
// ThumbGate already let through (no deny, no block) to `permissionDecision: "allow"`,
// which skips the agent's own permission prompt. It never touches a denied call,
// so the hard-block list (secrets, force-push, rm -rf, DROP TABLE...) always wins.
//
// Learned approvals come from feedback-log.jsonl: entries with signal "positive"
// whose lastAction names the tool call. A later 👎 on the same pattern revokes it.
//
// Turn on:  npx thumbgate auto-approve on      (or THUMBGATE_AUTO_APPROVE=1)
// Turn off: npx thumbgate auto-approve off

const fs = require('fs');
const path = require('path');

const CONFIG_FILE = 'auto-approve.json';
const TAIL_BYTES = 2 * 1024 * 1024;
const DEFAULT_MIN_COMMAND = 1;
const DEFAULT_MIN_TOOL = 2;

// Shell syntax that could chain a second, unreviewed command onto an approved prefix.
const SHELL_CHAINING = /[;&|`<>\n\r]|\$\(/;
// Never auto-approved, whatever the thumbs-up history says.
const NEVER_AUTO = [
  /^(?:sudo|doas|su|rm|rmdir|dd|mkfs\S*|shred|chmod|chown|chgrp|kill|killall|pkill|eval|exec|source|\.)$/i,
];
const NEVER_AUTO_COMMAND = [
  /\bgit\s+push\b.*(?:\s-f\b|--force|--delete|\s:\S)/i,
  /\bgit\s+(?:reset\s+--hard|clean\b|filter-branch|filter-repo)/i,
  /\bgit\s+branch\s+-D\b/i,
  /\b(?:drop|truncate)\s+(?:table|database|schema)\b/i,
  /\b(?:node|nodejs|python\d*(?:\.\d+)?|ruby|perl|php|bash|sh|zsh|deno|bun)\s+(?:-\S*[ec]\b|--eval\b)/i,
  /\bnpm\s+(?:publish|unpublish)\b/i,
  /--no-verify\b/i,
];
const NEVER_AUTO_TOOLS = /^(?:Write|NotebookEdit)$/i;

function isTrue(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function feedbackDirFor(options = {}) {
  if (options.feedbackDir) return options.feedbackDir;
  const { resolveFeedbackDir } = require('./feedback-paths');
  return resolveFeedbackDir({ cwd: options.cwd || process.cwd() });
}

function configPath(options = {}) {
  return path.join(feedbackDirFor(options), CONFIG_FILE);
}

function readConfig(options = {}) {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(options), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeConfig(config, options = {}) {
  const file = configPath(options);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return file;
}

function settings(options = {}) {
  const env = options.env || process.env;
  const config = readConfig(options);
  const envFlag = env.THUMBGATE_AUTO_APPROVE;
  const enabled = envFlag !== undefined && envFlag !== '' ? isTrue(envFlag) : config.enabled === true;
  const num = (v, d) => (Number.isInteger(Number(v)) && Number(v) >= 1 ? Number(v) : d);
  return {
    enabled,
    minCommand: num(config.minThumbsUp, DEFAULT_MIN_COMMAND),
    minTool: num(config.minThumbsUpForWholeTool, DEFAULT_MIN_TOOL),
  };
}

function tokenize(command) {
  return String(command || '').trim().split(/\s+/).filter(Boolean);
}

function isNeverAutoCommand(command) {
  const text = String(command || '').trim();
  if (!text) return true;
  if (SHELL_CHAINING.test(text)) return true;
  const tokens = tokenize(text);
  // A leading VAR=value can change what the command loads (LD_PRELOAD, NODE_OPTIONS...).
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) return true;
  // A pathed program (./git, /tmp/x/git) is a different executable from the bare name you approved.
  if (/[\\/~]/.test(tokens[0])) return true;
  const program = tokens[0];
  if (NEVER_AUTO.some((re) => re.test(program))) return true;
  return NEVER_AUTO_COMMAND.some((re) => re.test(text));
}

// The pattern a thumbs-up teaches: the program plus its subcommand ("npm test",
// "git status"), or just the program when the next word is a flag ("ls").
function commandKey(command) {
  const tokens = tokenize(command);
  if (!tokens.length) return null;
  const program = tokens[0];
  const sub = tokens[1];
  return sub && !sub.startsWith('-') ? `${program} ${sub}` : program;
}

function keyForCall(toolName, toolInput) {
  const tool = String(toolName || '').trim();
  if (!tool) return null;
  if (/^(?:Bash|Shell|run_shell_command|exec_command)$/i.test(tool)) {
    const command = toolInput && (toolInput.command || toolInput.cmd);
    if (typeof command !== 'string' || isNeverAutoCommand(command)) return null;
    const key = commandKey(command);
    return key ? { kind: 'command', key: `Bash:${key}`, label: key } : null;
  }
  if (NEVER_AUTO_TOOLS.test(tool)) return null;
  return { kind: 'tool', key: `tool:${tool}`, label: tool };
}

function keyForFeedback(entry) {
  const action = entry && entry.lastAction;
  if (!action || typeof action !== 'object') return null;
  const tool = action.tool || (entry.metadata && entry.metadata.tool) || '';
  if (!tool || tool === 'unknown') return null;
  if (/^(?:Bash|Shell|run_shell_command|exec_command)$/i.test(tool)) {
    if (typeof action.command !== 'string' || isNeverAutoCommand(action.command)) return null;
    const key = commandKey(action.command);
    return key ? `Bash:${key}` : null;
  }
  return `tool:${tool}`;
}

function signalOf(entry) {
  const s = String((entry && entry.signal) || '').toLowerCase();
  if (s === 'positive' || s === 'up') return 'up';
  if (s === 'negative' || s === 'down') return 'down';
  return null;
}

function readFeedbackTail(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const { size } = fs.fstatSync(fd);
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split('\n');
    if (start > 0) lines.shift();
    const out = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch { /* skip a torn line */ }
    }
    return out;
  } catch {
    return [];
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

// Ids marked "not a person's thumb" (scripts/not-a-thumb.js) never grant an approval.
function notCountedIds(feedbackDir, options = {}) {
  const dirs = new Set([feedbackDir]);
  try {
    const { resolveProjectDir } = require('./feedback-paths');
    dirs.add(path.join(resolveProjectDir({ cwd: options.cwd || process.cwd(), env: options.env || process.env }), '.thumbgate'));
  } catch { /* project dir is optional */ }
  const ids = new Set();
  for (const dir of dirs) {
    let text = '';
    try { text = fs.readFileSync(path.join(dir, 'not-counted-feedback.jsonl'), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      try { const row = JSON.parse(line); if (row && row.id) ids.add(String(row.id)); } catch { /* skip */ }
    }
  }
  return ids;
}

// Only a person's own thumb teaches an approval: script probes, history scrapes and
// auto-capture fallbacks are left out, as they are from every human count.
function isPersonsThumb(entry, excluded) {
  if (entry && entry.id && excluded.has(String(entry.id))) return false;
  const { isCountedHumanFeedback, isLegacyMcpCapture } = require('./human-feedback');
  return isCountedHumanFeedback(entry) || isLegacyMcpCapture(entry);
}

// key -> { up, down, last } in log order, so the most recent thumb wins.
function learnedPatterns(options = {}) {
  const dir = feedbackDirFor(options);
  const file = path.join(dir, 'feedback-log.jsonl');
  const excluded = notCountedIds(dir, options);
  const patterns = new Map();
  for (const entry of readFeedbackTail(file)) {
    const signal = signalOf(entry);
    if (!signal) continue;
    // A thumbs-down from anyone still revokes; only a thumbs-up must be a person's.
    if (signal === 'up' && !isPersonsThumb(entry, excluded)) continue;
    const key = keyForFeedback(entry);
    if (!key) continue;
    const row = patterns.get(key) || { up: 0, down: 0, last: null };
    row[signal] += 1;
    row.last = signal;
    patterns.set(key, row);
  }
  return patterns;
}

function approvalFor(toolName, toolInput, options = {}) {
  const conf = settings(options);
  if (!conf.enabled) return null;
  const call = keyForCall(toolName, toolInput);
  if (!call) return null;
  const row = learnedPatterns(options).get(call.key);
  if (!row || row.last !== 'up') return null;
  const min = call.kind === 'command' ? conf.minCommand : conf.minTool;
  if (row.up < min) return null;
  return { key: call.key, label: call.label, thumbsUp: row.up };
}

function isDeniedOutput(parsed) {
  if (!parsed || typeof parsed !== 'object') return true;
  if (parsed.decision === 'block' || parsed.continue === false) return true;
  const hook = parsed.hookSpecificOutput || {};
  return Boolean(hook.permissionDecision) && hook.permissionDecision !== 'allow';
}

// Upgrade an allowed gate-check verdict to an explicit allow when the call matches a learned 👍.
function applyAutoApprove(output, input = {}, options = {}) {
  try {
    const parsed = output ? JSON.parse(output) : {};
    if (isDeniedOutput(parsed)) return output;
    const toolName = input.tool_name || input.toolName;
    const toolInput = input.tool_input || input.toolInput || {};
    const approval = approvalFor(toolName, toolInput, { cwd: input.cwd, ...options });
    if (!approval) return output;
    const times = approval.thumbsUp === 1 ? 'once' : `${approval.thumbsUp} times`;
    const hook = parsed.hookSpecificOutput || {};
    return JSON.stringify({
      ...parsed,
      hookSpecificOutput: {
        ...hook,
        hookEventName: hook.hookEventName || 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: `ThumbGate auto-approved "${approval.label}": you gave it 👍 ${times}. Turn off with: npx thumbgate auto-approve off`,
      },
    });
  } catch {
    return output;
  }
}

function listApprovals(options = {}) {
  const conf = settings(options);
  const rows = [];
  for (const [key, row] of learnedPatterns(options)) {
    const kind = key.startsWith('Bash:') ? 'command' : 'tool';
    const min = kind === 'command' ? conf.minCommand : conf.minTool;
    const label = key.replace(/^(?:Bash|tool):/, '');
    if (kind === 'command' && isNeverAutoCommand(label)) continue;
    if (kind === 'tool' && NEVER_AUTO_TOOLS.test(label)) continue;
    rows.push({ pattern: label, kind, thumbsUp: row.up, thumbsDown: row.down, active: row.last === 'up' && row.up >= min });
  }
  return rows.sort((a, b) => b.thumbsUp - a.thumbsUp);
}

function runCli(args = [], options = {}) {
  const log = options.log || console.log;
  const sub = String(args[0] || 'status').toLowerCase();
  const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  if (sub === 'on' || sub === 'off') {
    const config = { ...readConfig(options), enabled: sub === 'on' };
    const min = flag('--min');
    if (min !== undefined) config.minThumbsUp = Number(min);
    const file = writeConfig(config, options);
    log(`ThumbGate auto-approve is ${sub.toUpperCase()} (${file}).`);
    if (sub === 'on') {
      log('A tool call you give 👍 is approved automatically next time. Hard blocks still win, and a 👎 on the same pattern revokes it.');
    }
    return 0;
  }
  if (sub === 'status' || sub === 'list') {
    const conf = settings(options);
    log(`Auto-approve: ${conf.enabled ? 'ON' : 'OFF'} (commands need ${conf.minCommand} 👍, whole tools need ${conf.minTool} 👍)`);
    const rows = listApprovals(options);
    if (!rows.length) {
      log('No learned approvals yet. Give 👍 right after a tool call you want approved automatically.');
      return 0;
    }
    for (const row of rows) {
      log(`  ${row.active ? '✓' : '·'} ${row.pattern}  (👍 ${row.thumbsUp}, 👎 ${row.thumbsDown})`);
    }
    return 0;
  }
  log('Usage: npx thumbgate auto-approve [on|off|status] [--min N]');
  return 1;
}

module.exports = {
  applyAutoApprove,
  approvalFor,
  commandKey,
  isNeverAutoCommand,
  keyForCall,
  learnedPatterns,
  listApprovals,
  runCli,
  settings,
};
