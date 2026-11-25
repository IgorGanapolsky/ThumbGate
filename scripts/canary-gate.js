'use strict';

// AGENT-3667 item J1: canary file gate. The user names a decoy credential file outside the project. Any Read, Edit,
// Write, Grep, Glob or Bash action that reaches that path is denied and recorded as "reached outside".
// Off by default: with no canary path configured nothing here runs. Matching is on the resolved path of an action's
// target, not on words: an echo or a grep pattern that merely names the path is not a touch.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FILE_KEYS = ['file_path', 'path', 'notebook_path'];
const PRINT_ONLY = new Set(['echo', 'printf']);
const PATTERN_FIRST = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack']);
const WRAPPERS = new Set(['sudo', 'command', 'exec', 'time', 'nohup', 'env', 'nice']);

function homeOf(env) {
  return env.HOME || os.homedir();
}

function expand(token, env, cwd) {
  let t = String(token || '');
  const home = homeOf(env);
  if (t === '~') t = home;
  else if (t.startsWith('~/')) t = path.join(home, t.slice(2));
  t = t.replace(/^\$\{?HOME\}?(?=\/|$)/, home);
  return path.resolve(cwd || process.cwd(), t);
}

function real(p) {
  try { return fs.realpathSync(p); } catch { return p; }
}

function configPath(env) {
  return path.join(homeOf(env), '.config', 'thumbgate', 'canary.json');
}

/** The decoy paths in force: THUMBGATE_CANARY_FILES (path-delimited) wins, else ~/.config/thumbgate/canary.json. */
function loadCanaryPaths(env = process.env) {
  let raw = [];
  if (env.THUMBGATE_CANARY_FILES && env.THUMBGATE_CANARY_FILES.trim()) {
    raw = env.THUMBGATE_CANARY_FILES.split(path.delimiter);
  } else {
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath(env), 'utf8'));
      raw = Array.isArray(parsed.paths) ? parsed.paths : [];
    } catch { /* no canary configured */ }
  }
  return raw.map((p) => String(p).trim()).filter(Boolean).map((p) => real(expand(p, env, homeOf(env))));
}

function canaryStatus(env = process.env) {
  const paths = loadCanaryPaths(env);
  return { enabled: paths.length > 0, paths, configFile: configPath(env) };
}

function writeCanaryPaths(paths, env = process.env) {
  const file = configPath(env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ paths }, null, 2)}\n`);
  return file;
}

const inside = (target, canary) => target === canary || target.startsWith(`${canary}${path.sep}`);
const covers = (target, canary) => canary.startsWith(`${target}${path.sep}`);

function globToRegExp(token) {
  const body = token.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*').replace(/\?/g, '[^/]');
  return new RegExp(`^${body}$`);
}

// Minimal shell split: quotes group, whitespace separates. No variable or command substitution is resolved.
function words(segment) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(segment)) !== null) out.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);
  return out;
}

function bashSegments(command) {
  const segments = [];
  for (const part of String(command || '').split(/&&|\|\||[;|\n]/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const inner = trimmed.match(/^(?:sudo\s+)?(?:bash|sh|zsh)\s+-c\s+(['"])([\s\S]*)\1\s*$/);
    if (inner) segments.push(...bashSegments(inner[2]));
    else segments.push(trimmed);
  }
  return segments;
}

function bashTouch(command, canaries, env, cwd) {
  for (const segment of bashSegments(command)) {
    let args = words(segment);
    while (args.length && (WRAPPERS.has(args[0]) || /^\S+=\S*$/.test(args[0]))) args = args.slice(1);
    if (!args.length) continue;
    const argv0 = path.basename(args[0]);
    if (PRINT_ONLY.has(argv0)) continue;
    let rest = args.slice(1);
    if (PATTERN_FIRST.has(argv0) && !rest.some((a) => /^(-e|-f|--regexp|--file)(=|$)/.test(a))) {
      const firstPositional = rest.findIndex((a) => !a.startsWith('-'));
      if (firstPositional >= 0) rest = rest.filter((_, i) => i !== firstPositional);
    }
    for (const arg of rest) {
      let value = arg.replace(/^[<>]+/, '').replace(/^@/, '');
      if (arg.startsWith('-')) {
        const eq = arg.indexOf('=');
        if (eq < 0) continue;
        value = arg.slice(eq + 1).replace(/^@/, '');
      }
      if (!value) continue;
      if (/[*?]/.test(value)) {
        const pattern = globToRegExp(expand(value, env, cwd));
        const hit = canaries.find((c) => pattern.test(c));
        if (hit) return { path: hit, how: 'bash_glob' };
        continue;
      }
      const target = real(expand(value, env, cwd));
      const hit = canaries.find((c) => inside(target, c));
      if (hit) return { path: hit, how: 'bash_path' };
    }
  }
  return null;
}

/** Does this tool call reach a canary path? Returns { path, how } or null. */
function touchedCanary({ toolName, toolInput = {}, cwd = process.cwd(), env = process.env, canaries = loadCanaryPaths(env) }) {
  if (!canaries.length) return null;
  const tool = String(toolName || '');
  for (const key of FILE_KEYS) {
    if (typeof toolInput[key] !== 'string' || !toolInput[key]) continue;
    const target = real(expand(toolInput[key], env, cwd));
    const hit = canaries.find((c) => inside(target, c));
    if (hit) return { path: hit, how: `${tool || 'tool'}_${key}` };
    // A recursive search rooted above the decoy would read it.
    if (/^(Grep|Glob|LS)$/.test(tool)) {
      const above = canaries.find((c) => covers(target, c));
      if (above) return { path: above, how: `${tool}_search_covers_canary` };
    }
  }
  if (tool === 'Bash' && typeof toolInput.command === 'string') return bashTouch(toolInput.command, canaries, env, cwd);
  return null;
}

function recordAttempt(attempt, env = process.env) {
  try {
    const { resolveFeedbackDir } = require('./feedback-paths');
    const dir = resolveFeedbackDir({ env });
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'canary-attempts.jsonl'), `${JSON.stringify({ ts: new Date().toISOString(), event: 'reached_outside', ...attempt })}\n`);
  } catch { /* recording is best effort; the deny still stands */ }
}

/** Hard-floor evaluation: a deny result for the gate engine, or null. */
function evaluateCanaryGate(input = {}, env = process.env) {
  const toolName = input.tool_name || input.toolName || '';
  const toolInput = input.tool_input || input.toolInput || {};
  const cwd = input.cwd || process.cwd();
  const hit = touchedCanary({ toolName, toolInput, cwd, env });
  if (!hit) return null;
  recordAttempt({ tool: toolName, path: hit.path, how: hit.how, sessionId: input.session_id || null }, env);
  return {
    decision: 'deny',
    gate: 'canary-file',
    severity: 'critical',
    hardDeny: true,
    message: `Blocked: ${toolName} reached the decoy credential file ${hit.path}. That is outside what this task needs. The attempt was recorded as "reached outside".`,
    reasoning: [`canary path touched through ${hit.how}`],
  };
}

module.exports = { loadCanaryPaths, canaryStatus, writeCanaryPaths, touchedCanary, evaluateCanaryGate, configPath };
