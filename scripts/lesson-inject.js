#!/usr/bin/env node
'use strict';

/**
 * Just-in-time lesson injection for agent hooks.
 *
 * Captured lessons only help if they reach the agent before it repeats the
 * mistake. This module ranks a project's lessons against the user's prompt
 * (UserPromptSubmit) or an outward action (PreToolUse) and prints at most a
 * few rules, or nothing when no lesson clearly matches. It also guards
 * `capture_feedback`: it stamps the caller's project and refuses negative
 * captures that carry no rule.
 *
 * Runs on every prompt, so it depends only on Node built-ins and
 * feedback-paths, and every failure exits 0 with no output.
 */

const fs = require('fs');
const path = require('path');
const {
  getGlobalTierDir,
  getHomeDir,
  getRuntimeDir,
  resolveFeedbackDir,
  resolveGitCommonRoot,
  resolveProjectIdentity,
} = require('./feedback-paths');

const MAX_LESSONS = 3;
const MAX_INJECT_CHARS = 1200;
const MAX_RULE_CHARS = 320;
const MAX_CONTEXT_CHARS = 140;
const MIN_MATCHED_TERMS = 2;
const MIN_COVERAGE = 0.4;
const SEEN_TTL_MS = 15 * 60 * 1000;
const MAX_LOG_LINES = 5000;
const GLOBAL_PROJECT_ID = 'global';
const CAPTURE_TOOL = 'mcp__thumbgate__capture_feedback';
const RULE_PREFIXES = ['How to avoid:', 'What worked:'];

const PRETOOL_MATCHER = [
  'Bash',
  CAPTURE_TOOL,
  'mcp__.*__(createJiraIssue|editJiraIssue|addOrEditJiraIssueComment|transitionJiraIssue'
    + '|createConfluenceContent|updateConfluenceContent|computer|browser_batch|form_input|act|run'
    + '|outlook_create_draft|send_message|send_mail)',
].join('|');

const OUTWARD_COMMAND = /\b(?:git|but)\s+push\b|\bgh\s+(?:pr\s+(?:create|merge|comment|review)|issue\s+(?:create|comment))\b|\baz\s+repos\s+pr\b|\bnpm\s+publish\b/;
const OUTWARD_WRITE_TOOL = /__(?:createJiraIssue|editJiraIssue|addOrEditJiraIssueComment|transitionJiraIssue|createConfluenceContent|updateConfluenceContent|outlook_create_draft|send_message|send_mail)$/;
const BROWSER_TOOL = /__(?:computer|browser_batch|form_input|act|run)$/;
const SEND_VERB = /\b(?:send|sends|sent|post|posts|reply|replies|submit|submits|publish|publishes)\b/i;

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'onto', 'over', 'what', 'when', 'where', 'which',
  'who', 'why', 'how', 'are', 'was', 'were', 'been', 'being', 'have', 'has', 'had', 'does', 'did', 'doing', 'not',
  'but', 'you', 'your', 'him', 'her', 'his', 'hers', 'they', 'them', 'their', 'its', 'our', 'ours', 'can', 'could',
  'should', 'would', 'will', 'shall', 'may', 'might', 'must', 'just', 'also', 'then', 'than', 'there', 'here',
  'about', 'after', 'before', 'again', 'all', 'any', 'each', 'some', 'such', 'only', 'own', 'same', 'very', 'too',
  'out', 'off', 'now', 'let', 'get', 'got', 'make', 'made', 'use', 'used', 'one', 'two', 'it', 'is', 'to', 'of',
  'in', 'on', 'at', 'by', 'an', 'as', 'or', 'if', 'so', 'do', 'be', 'me', 'my', 'we', 'us', 'please', 'thanks',
  'click', 'type', 'press', 'key', 'action', 'summary', 'input', 'text', 'ref', 'tab', 'name', 'mcp', 'true',
  'false', 'null', 'igor', 'agent',
]);

function stem(token) {
  if (token.length > 5 && token.endsWith('ing')) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && token.endsWith('ed')) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith('es')) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token) && !/^\d+$/.test(token))
    .map(stem);
}

function truncate(text, maxChars) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= maxChars) return value;
  const cut = value.slice(0, maxChars - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut}…`;
}

function readJsonl(filePath, maxLines = MAX_LOG_LINES) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }
  const rows = [];
  for (const line of raw.split('\n').slice(-maxLines)) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // A torn concurrent append must not hide the rest of the log.
    }
  }
  return rows;
}

function extractRule(memory) {
  const lines = String(memory.content || '').split('\n');
  for (const prefix of RULE_PREFIXES) {
    const line = lines.find((candidate) => candidate.startsWith(prefix));
    if (line && line.slice(prefix.length).trim()) return line.slice(prefix.length).trim();
  }
  return null;
}

function ownerOf(memory, feedback) {
  return (memory.scope && memory.scope.projectId)
    || (feedback && feedback.scope && feedback.scope.projectId)
    || null;
}

/**
 * Load rule-bearing lessons from one store.
 * `onlyProjectId` limits a shared store (another project's) to records
 * stamped for this project or for the global tier.
 */
function loadStoreLessons(feedbackDir, { tier, projectId, onlyProjectId } = {}) {
  const feedbackById = new Map(
    readJsonl(path.join(feedbackDir, 'feedback-log.jsonl')).map((row) => [row.id, row]),
  );
  const lessons = [];
  for (const memory of readJsonl(path.join(feedbackDir, 'memory-log.jsonl'))) {
    if (!memory || memory.pruned) continue;
    const rule = extractRule(memory);
    if (!rule) continue;
    const feedback = feedbackById.get(memory.sourceFeedbackId) || null;
    const owner = ownerOf(memory, feedback);
    if (onlyProjectId) {
      if (owner !== onlyProjectId && owner !== GLOBAL_PROJECT_ID) continue;
    } else if (owner && owner !== projectId && owner !== GLOBAL_PROJECT_ID && tier !== 'global') {
      continue;
    }
    lessons.push({
      id: memory.id,
      sourceFeedbackId: memory.sourceFeedbackId || null,
      canonicalHash: memory.canonicalHash || null,
      title: memory.title || '',
      rule,
      context: (feedback && feedback.context) || '',
      tags: Array.isArray(memory.tags) ? memory.tags : [],
      timestamp: memory.timestamp || '',
      tier: owner === GLOBAL_PROJECT_ID ? 'global' : tier,
    });
  }
  return lessons;
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function storeOptions(options) {
  // Resolve stores from explicit inputs only: a hook inherits whatever
  // THUMBGATE_FEEDBACK_DIR its parent had, which is exactly the misrouting
  // this module exists to work around.
  return { home: getHomeDir(options), env: { HOME: getHomeDir(options) }, includeStored: false };
}

/** Stores where a capture for this project may have landed, other than its own. */
function listSharedStores(options = {}) {
  const runtimeDir = getRuntimeDir(options);
  const stores = [];
  const profile = readJsonFile(path.join(runtimeDir, 'local-feedback-profile.json'));
  if (profile && profile.feedbackDir) stores.push(profile.feedbackDir);
  const active = readJsonFile(path.join(runtimeDir, 'active-project.json'));
  if (active && active.projectDir) {
    stores.push(resolveFeedbackDir({ ...storeOptions(options), projectDir: active.projectDir }));
  }
  return stores;
}

function dedupeLessons(lessons) {
  const byKey = new Map();
  for (const lesson of lessons) {
    const key = lesson.sourceFeedbackId || lesson.canonicalHash || lesson.rule.toLowerCase();
    const existing = byKey.get(key);
    if (!existing || String(lesson.timestamp) > String(existing.timestamp)) byKey.set(key, lesson);
  }
  return [...byKey.values()];
}

function collectLessons(options = {}) {
  const identity = resolveProjectIdentity({ ...storeOptions(options), cwd: options.cwd });
  const globalDir = getGlobalTierDir(options);
  const lessons = loadStoreLessons(globalDir, { tier: 'global' });
  if (!identity) return { identity: null, lessons: dedupeLessons(lessons) };

  const ownDir = path.resolve(resolveFeedbackDir({ ...storeOptions(options), projectDir: identity.projectDir }));
  lessons.push(...loadStoreLessons(ownDir, { tier: 'project', projectId: identity.projectId }));
  const seen = new Set([ownDir, path.resolve(globalDir)]);
  for (const store of listSharedStores(options)) {
    const resolved = path.resolve(store);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    lessons.push(...loadStoreLessons(resolved, { tier: 'project', onlyProjectId: identity.projectId }));
  }
  return { identity, lessons: dedupeLessons(lessons) };
}

function rankLessons(query, lessons, { maxResults = MAX_LESSONS } = {}) {
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length < MIN_MATCHED_TERMS || lessons.length === 0) return [];

  const docs = lessons.map((lesson) => ({
    lesson,
    terms: new Set(tokenize([lesson.title, lesson.rule, lesson.context, lesson.tags.join(' ')].join(' '))),
  }));
  const docFreq = new Map();
  for (const doc of docs) {
    for (const term of doc.terms) docFreq.set(term, (docFreq.get(term) || 0) + 1);
  }
  const idf = (term) => Math.log(1 + (docs.length + 1) / ((docFreq.get(term) || 0) + 0.5));
  const queryWeight = queryTerms.reduce((sum, term) => sum + idf(term), 0);

  return docs
    .map(({ lesson, terms }) => {
      const matched = queryTerms.filter((term) => terms.has(term));
      const score = matched.reduce((sum, term) => sum + idf(term), 0);
      return { ...lesson, matched, score, coverage: queryWeight > 0 ? score / queryWeight : 0 };
    })
    .filter((hit) => hit.matched.length >= MIN_MATCHED_TERMS && hit.coverage >= MIN_COVERAGE)
    .sort((a, b) => (b.score - a.score) || String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, maxResults);
}

function formatInjection(hits, identity) {
  if (hits.length === 0) return '';
  const scopeLabel = identity ? identity.projectId : 'all projects';
  const header = `ThumbGate lessons for ${scopeLabel} (past feedback that matches this request; follow them):`;
  let text = header;
  const included = [];
  for (const hit of hits) {
    const when = hit.context ? ` [when: ${truncate(hit.context, MAX_CONTEXT_CHARS)}]` : '';
    const line = `\n- ${truncate(hit.rule, MAX_RULE_CHARS)}${when}`;
    if (text.length + line.length > MAX_INJECT_CHARS) break;
    text += line;
    included.push(hit);
  }
  return included.length > 0 ? text : '';
}

function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

function seenCachePath(sessionId, options = {}) {
  const safe = String(sessionId || '').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 120);
  return safe ? path.join(getRuntimeDir(options), 'lesson-inject-seen', `${safe}.json`) : null;
}

function filterUnseen(hits, sessionId, options = {}) {
  const cachePath = seenCachePath(sessionId, options);
  if (!cachePath) return hits;
  const now = options.now || Date.now();
  const seen = readJsonFile(cachePath) || {};
  return hits.filter((hit) => !(seen[hit.id] && now - seen[hit.id] < SEEN_TTL_MS));
}

function markSeen(hits, sessionId, options = {}) {
  const cachePath = seenCachePath(sessionId, options);
  if (!cachePath || hits.length === 0) return;
  const now = options.now || Date.now();
  const seen = readJsonFile(cachePath) || {};
  for (const [id, at] of Object.entries(seen)) {
    if (now - at >= SEEN_TTL_MS) delete seen[id];
  }
  for (const hit of hits) seen[hit.id] = now;
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(seen));
}

function findLessons(query, options = {}) {
  const { identity, lessons } = collectLessons(options);
  const hits = filterUnseen(rankLessons(query, lessons), options.sessionId, options);
  const text = formatInjection(hits, identity);
  const injected = text ? hits.filter((hit) => text.includes(truncate(hit.rule, MAX_RULE_CHARS))) : [];
  return {
    projectId: identity ? identity.projectId : null,
    candidates: lessons.length,
    lessons: injected.map(({ id, sourceFeedbackId, rule, tier, matched, score }) => ({
      id, sourceFeedbackId, rule, tier, matched, score: Number(score.toFixed(3)),
    })),
    text,
    chars: text.length,
    estTokens: estimateTokens(text),
  };
}

function collectStrings(value, out = [], onlyKey = null) {
  if (Array.isArray(value)) value.forEach((item) => collectStrings(item, out, onlyKey));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string') {
        if (!onlyKey || key === onlyKey) out.push(item);
      } else {
        collectStrings(item, out, onlyKey);
      }
    }
  } else if (typeof value === 'string' && !onlyKey) {
    out.push(value);
  }
  return out;
}

/** Text describing an outward action, or null for any other tool call. */
function describeOutwardAction(toolName, toolInput = {}) {
  const name = String(toolName || '');
  if (name === 'Bash') {
    const command = String(toolInput.command || '');
    return OUTWARD_COMMAND.test(command) ? `${command} ${toolInput.description || ''}` : null;
  }
  if (OUTWARD_WRITE_TOOL.test(name)) {
    return `${name.split('__').pop()} ${collectStrings(toolInput).join(' ')}`.slice(0, 4000);
  }
  if (BROWSER_TOOL.test(name)) {
    // A step's summary says what it does; its typed text is mostly noise to the ranker.
    const summaries = collectStrings(toolInput, [], 'action_summary');
    const text = (summaries.length > 0 ? summaries : collectStrings(toolInput)).join(' ').slice(0, 4000);
    return SEND_VERB.test(text) ? text : null;
  }
  return null;
}

function isNegativeSignal(signal) {
  return ['down', 'negative', 'thumbs_down', 'thumbsdown'].includes(String(signal || '').toLowerCase());
}

function guardCapture(toolInput = {}, options = {}) {
  if (isNegativeSignal(toolInput.signal) && !String(toolInput.whatToChange || '').trim()) {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'ThumbGate: a negative capture needs whatToChange, the rule to follow next time. '
          + 'A lesson with no rule is never retrieved. Retry with whatWentWrong and whatToChange filled in.',
      },
    };
  }
  if (toolInput.projectId) return null;
  const identity = resolveProjectIdentity({ ...storeOptions(options), cwd: options.cwd });
  if (!identity) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput: { ...toolInput, projectId: identity.projectId, projectDir: identity.projectDir },
    },
  };
}

function contextOutput(hookEventName, query, options) {
  const result = findLessons(query, options);
  if (!result.text) return null;
  markSeen(result.lessons, options.sessionId, options);
  return { hookSpecificOutput: { hookEventName, additionalContext: result.text } };
}

function handleHookEvent(event, payload = {}, options = {}) {
  const hookOptions = { ...options, cwd: payload.cwd || options.cwd, sessionId: payload.session_id };
  if (event === 'prompt') {
    return payload.prompt ? contextOutput('UserPromptSubmit', payload.prompt, hookOptions) : null;
  }
  if (event === 'pretool') {
    if (payload.tool_name === CAPTURE_TOOL) return guardCapture(payload.tool_input, hookOptions);
    const query = describeOutwardAction(payload.tool_name, payload.tool_input);
    return query ? contextOutput('PreToolUse', query, hookOptions) : null;
  }
  return null;
}

/**
 * Append copies of misrouted captures to the store of the project they belong
 * to (or to the global tier), stamped with that project. The source store is
 * never modified.
 */
function rescopeLessons({ fromDir, ids = [], projectDir, global = false, ...options }) {
  const targetDir = global
    ? getGlobalTierDir(options)
    : resolveFeedbackDir({ ...storeOptions(options), projectDir: resolveGitCommonRoot(projectDir) || projectDir });
  const projectId = global ? GLOBAL_PROJECT_ID : path.basename(resolveGitCommonRoot(projectDir) || projectDir);
  const wanted = (id) => ids.some((prefix) => id && String(id).startsWith(prefix));
  const stamp = (row) => ({
    ...row,
    scope: { ...(row.scope || {}), projectId },
    rescopedFrom: fromDir,
  });

  fs.mkdirSync(targetDir, { recursive: true });
  const copied = { feedback: [], memory: [] };
  for (const [file, key, matches] of [
    ['feedback-log.jsonl', 'feedback', (row) => wanted(row.id)],
    ['memory-log.jsonl', 'memory', (row) => wanted(row.sourceFeedbackId)],
  ]) {
    const targetPath = path.join(targetDir, file);
    const existing = new Set(readJsonl(targetPath, Infinity).map((row) => row.id));
    const rows = readJsonl(path.join(fromDir, file), Infinity).filter((row) => matches(row) && !existing.has(row.id));
    if (rows.length > 0) {
      fs.appendFileSync(targetPath, rows.map((row) => JSON.stringify(stamp(row))).join('\n') + '\n');
    }
    copied[key] = rows.map((row) => row.id);
  }
  return { targetDir, projectId, copied };
}

function hookCommand(scriptPath, event) {
  const quote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;
  // `node` from PATH survives runtime upgrades; process.execPath is a versioned install path.
  return `node ${quote(scriptPath)} ${event}-hook`;
}

/**
 * Copy this module into a stable directory and register its hooks in a
 * Claude Code settings file, keeping every existing hook and a backup.
 */
function installClaude({ settingsPath, targetDir, now = new Date() }) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const file of ['lesson-inject.js', 'feedback-paths.js']) {
    fs.copyFileSync(path.join(__dirname, file), path.join(targetDir, file));
  }
  // Pin CommonJS: a `"type": "module"` package.json in any parent (often ~) would break the copies.
  fs.writeFileSync(path.join(targetDir, 'package.json'), '{ "type": "commonjs" }\n');
  const scriptPath = path.join(targetDir, 'lesson-inject.js');
  const raw = fs.readFileSync(settingsPath, 'utf8');
  const backupPath = `${settingsPath}.bak-lesson-inject-${now.toISOString().replace(/[:.]/g, '-')}`;
  fs.writeFileSync(backupPath, raw);

  const settings = JSON.parse(raw);
  settings.hooks = settings.hooks || {};
  const wanted = [
    ['UserPromptSubmit', null, hookCommand(scriptPath, 'prompt')],
    ['PreToolUse', PRETOOL_MATCHER, hookCommand(scriptPath, 'pretool')],
  ];
  const changed = [];
  for (const [event, matcher, command] of wanted) {
    const entries = (settings.hooks[event] || []).filter((entry) => !(entry.hooks || [])
      .some((hook) => String(hook.command || '').includes('lesson-inject.js')));
    const entry = { hooks: [{ type: 'command', command, timeout: 5 }] };
    if (matcher) entry.matcher = matcher;
    entries.push(entry);
    settings.hooks[event] = entries;
    changed.push({ event, matcher, command });
  }
  const tempPath = `${settingsPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(settings, null, 2)}\n`);
  fs.renameSync(tempPath, settingsPath);
  return { settingsPath, backupPath, scriptPath, changed };
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function parseFlags(argv) {
  const flags = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      flags._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) flags[key] = true;
    else {
      flags[key] = next;
      i += 1;
    }
  }
  return flags;
}

function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  if (command === 'prompt-hook' || command === 'pretool-hook') {
    try {
      const payload = JSON.parse(readStdin() || '{}');
      const output = handleHookEvent(command.replace('-hook', ''), payload);
      if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
    } catch {
      // Retrieval must never block a prompt or a tool call.
    }
    return 0;
  }
  const flags = parseFlags(rest);
  let result;
  if (command === 'query') {
    result = findLessons(flags._.join(' '), { cwd: flags.cwd || process.cwd() });
  } else if (command === 'rescope') {
    result = rescopeLessons({
      fromDir: flags.from,
      ids: String(flags.ids || '').split(',').filter(Boolean),
      projectDir: flags['project-dir'],
      global: flags.global === true,
    });
  } else if (command === 'install-claude') {
    const home = getHomeDir();
    result = installClaude({
      settingsPath: flags.settings || path.join(home, '.claude', 'settings.json'),
      targetDir: flags.target || path.join(home, '.thumbgate', 'hooks', 'lesson-inject'),
    });
  } else {
    process.stderr.write('Usage: lesson-inject.js prompt-hook|pretool-hook|query <text> [--cwd dir]|rescope --from dir --ids a,b (--project-dir dir|--global)|install-claude [--settings file] [--target dir]\n');
    return 1;
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

module.exports = {
  MAX_INJECT_CHARS,
  MAX_LESSONS,
  PRETOOL_MATCHER,
  collectLessons,
  describeOutwardAction,
  estimateTokens,
  findLessons,
  formatInjection,
  guardCapture,
  handleHookEvent,
  installClaude,
  rankLessons,
  rescopeLessons,
  tokenize,
};

if (require.main === module) {
  process.exitCode = main();
}
