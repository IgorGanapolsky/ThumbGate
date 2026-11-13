'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_INJECTED_LESSONS = 2;
const MAX_INJECTED_TOKENS = 150;
const LESSON_REPEAT_MS = 30 * 60 * 1000;
const CHARS_PER_TOKEN = 4;

const TRANSCRIPT_PREFIXES = Object.freeze([
  '<task-notification>',
  '<pasted_content',
  'it ignored a prior instruction: <',
]);

const TERM_STOPWORDS = new Set([
  'bash', 'node', 'npm', 'with', 'from', 'that', 'this', 'then', 'else',
  'true', 'false', 'null', 'echo', 'test', 'undefined', 'function', 'return',
  'const', 'async', 'await', 'the', 'and', 'for', 'not', 'git', 'yarn', 'pnpm',
]);

function estimateTokens(text) {
  return Math.ceil(String(text || '').length / CHARS_PER_TOKEN);
}

function lessonDisplayText(lesson) {
  if (!lesson || typeof lesson !== 'object') return '';
  return String(lesson.whatToChange || lesson.howToAvoid || lesson.content || lesson.title || '').trim();
}

function isRawTranscriptFragment(text) {
  const trimmed = String(text || '').trim().toLowerCase();
  if (!trimmed) return false;
  return TRANSCRIPT_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

function lessonIdentity(lesson) {
  if (!lesson || typeof lesson !== 'object') return '';
  return String(lesson.id || lesson.memoryId || lesson.canonicalId || lessonDisplayText(lesson)).slice(0, 180);
}

function lessonBlob(lesson) {
  const tags = Array.isArray(lesson.tags) ? lesson.tags : [];
  const tools = [
    ...(lesson.metadata?.toolsUsed || []),
    ...(lesson.structuredRule?.metadata?.toolsUsed || []),
    lesson.tool,
    lesson.metadata?.tool,
  ];
  return `${lessonDisplayText(lesson)} ${tags.join(' ')} ${tools.join(' ')}`.toLowerCase();
}

function toolNameMatches(lesson, toolName) {
  const tool = String(toolName || '').trim().toLowerCase();
  if (!tool) return false;
  const listed = [
    ...(lesson.metadata?.toolsUsed || []),
    ...(lesson.structuredRule?.metadata?.toolsUsed || []),
    ...(Array.isArray(lesson.tags) ? lesson.tags : []),
    lesson.tool,
    lesson.metadata?.tool,
  ].map((item) => String(item || '').trim().toLowerCase());
  if (listed.includes(tool)) return true;
  return new RegExp(`\\b${tool.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lessonBlob(lesson));
}

function actionMatchTerms(toolName, actionContext) {
  const context = String(actionContext || '');
  const terms = new Set();
  const tool = String(toolName || '').trim().toLowerCase();
  const paths = context.match(/(?:[\w.-]+\/)+[\w.-]+|[\w.-]+\.(?:js|ts|mjs|cjs|md|json|yml|yaml|sh|py|html)/gi) || [];
  for (const found of paths) {
    const lower = found.toLowerCase();
    terms.add(lower);
    const base = lower.split('/').pop();
    if (base && base.length >= 4) terms.add(base);
    const stem = base.replace(/\.[a-z0-9]+$/, '');
    if (stem.length >= 5) terms.add(stem);
  }
  for (const word of context.toLowerCase().split(/[^a-z0-9_./-]+/)) {
    const cleaned = word.replace(/^\/+|\/+$/g, '');
    if (cleaned.length < 5 || cleaned === tool || TERM_STOPWORDS.has(cleaned)) continue;
    terms.add(cleaned);
  }
  terms.delete(tool);
  return [...terms];
}

function lessonMatchesToolCall(lesson, { toolName, actionContext, project } = {}) {
  const text = lessonDisplayText(lesson);
  if (!text || isRawTranscriptFragment(text)) return false;
  const { isTranscriptShaped, isLessonRelevantForProject, inferProjectFromLesson } = require('./project-scope');
  if (isTranscriptShaped(lesson) || isTranscriptShaped(text)) return false;
  if (project) {
    if (!isLessonRelevantForProject(lesson, project)) return false;
  } else {
    const inferred = inferProjectFromLesson(lesson);
    if (inferred && inferred !== 'global' && inferred !== 'thumbgate') return false;
  }
  if (!toolNameMatches(lesson, toolName)) return false;
  const terms = actionMatchTerms(toolName, actionContext);
  if (terms.length === 0) return false;
  const blob = lessonBlob(lesson);
  return terms.some((term) => blob.includes(term));
}

function seenStorePath(sessionId, dir) {
  const safe = String(sessionId || 'nosession').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || 'nosession';
  return path.join(dir || path.join(os.tmpdir(), 'thumbgate-lesson-inject'), `${safe}.json`);
}

function readSeen(storePath) {
  try {
    return JSON.parse(fs.readFileSync(storePath, 'utf8'));
  } catch {
    return {};
  }
}

function writeSeen(storePath, seen) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(seen));
}

function selectInjectableLessons(lessons, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const sessionId = options.sessionId || '';
  const storePath = options.seenStorePath || (sessionId ? seenStorePath(sessionId, options.seenDir) : null);
  const seen = storePath ? readSeen(storePath) : (options.seen || {});
  const matched = [];
  for (const lesson of Array.isArray(lessons) ? lessons : []) {
    if (!lessonMatchesToolCall(lesson, options)) continue;
    const id = lessonIdentity(lesson);
    const last = Number(seen[id] || 0);
    if (id && last && now - last < LESSON_REPEAT_MS) continue;
    matched.push(lesson);
    if (matched.length >= MAX_INJECTED_LESSONS) break;
  }
  const kept = [];
  for (const lesson of matched) {
    const trial = formatInjectableReminder([...kept, lesson]);
    if (estimateTokens(trial) > MAX_INJECTED_TOKENS && kept.length > 0) break;
    kept.push(lesson);
  }
  if (options.record !== false && storePath && kept.length > 0) {
    const next = { ...seen };
    for (const lesson of kept) {
      const id = lessonIdentity(lesson);
      if (id) next[id] = now;
    }
    writeSeen(storePath, next);
  }
  return kept;
}

function formatInjectableReminder(lessons) {
  const bodies = [];
  let used = estimateTokens('<system-reminder>\nThumbGate prior lesson for this tool call:\n</system-reminder>');
  for (const lesson of (lessons || []).slice(0, MAX_INJECTED_LESSONS)) {
    let text = lessonDisplayText(lesson).replace(/\s+/g, ' ');
    if (!text || isRawTranscriptFragment(text)) continue;
    const prefix = `${bodies.length + 1}. `;
    let room = (MAX_INJECTED_TOKENS - used - estimateTokens(prefix) - 1) * CHARS_PER_TOKEN;
    if (room < 24) break;
    if (text.length > room) text = `${text.slice(0, Math.max(0, room - 1)).trim()}…`;
    const line = `${prefix}${text}`;
    bodies.push(line);
    used += estimateTokens(line) + 1;
  }
  if (bodies.length === 0) return '';
  return [
    '<system-reminder>',
    'ThumbGate prior lesson for this tool call:',
    ...bodies,
    '</system-reminder>',
  ].join('\n');
}

module.exports = {
  MAX_INJECTED_LESSONS,
  MAX_INJECTED_TOKENS,
  LESSON_REPEAT_MS,
  estimateTokens,
  isRawTranscriptFragment,
  lessonDisplayText,
  lessonMatchesToolCall,
  actionMatchTerms,
  selectInjectableLessons,
  formatInjectableReminder,
  seenStorePath,
};
