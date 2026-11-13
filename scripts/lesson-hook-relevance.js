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

const COMMAND_TERMS = new Set([
  'push', 'merge', 'curl', 'deploy', 'health', 'force', 'approve', 'admin', 'railway', 'trunk',
]);
const FOREIGN_REPO_TAGS = new Set(['dayglass', 'stockservice', 'psn', 'screenpipe']);

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

function declaredToolMatches(lesson, toolName) {
  const tool = String(toolName || '').trim().toLowerCase();
  if (!tool) return false;
  const listed = [
    ...(lesson.metadata?.toolsUsed || []),
    ...(lesson.structuredRule?.metadata?.toolsUsed || []),
    lesson.tool,
    lesson.metadata?.tool,
  ].map((item) => String(item || '').trim().toLowerCase());
  return listed.includes(tool);
}

function actionMatchTerms(toolName, actionContext) {
  const context = String(actionContext || '').toLowerCase();
  const terms = new Set();
  const paths = context.match(/(?:[\w.-]+\/)+[\w.-]+|[\w.-]+\.(?:js|ts|mjs|cjs|md|json|yml|yaml|sh|py|html)/gi) || [];
  for (const found of paths) {
    terms.add(found);
    const base = found.split('/').pop();
    if (base && base.length >= 4) terms.add(base);
    const stem = base.replace(/\.[a-z0-9]+$/, '');
    if (stem.length >= 5) terms.add(stem);
  }
  for (const word of context.split(/[^a-z0-9]+/)) {
    if (COMMAND_TERMS.has(word)) terms.add(word);
  }
  terms.delete(String(toolName || '').trim().toLowerCase());
  return [...terms];
}

function lessonInCallRepo(lesson, project) {
  const {
    isLessonRelevantForProject,
    inferProjectFromLesson,
    normalizeProjectName,
  } = require('./project-scope');
  if (isLessonRelevantForProject(lesson, project)) return true;
  const target = normalizeProjectName(String(project || ''));
  if (target !== 'thumbgate') return false;
  const tags = (Array.isArray(lesson.tags) ? lesson.tags : [])
    .map((tag) => String(tag || '').trim().toLowerCase());
  if (tags.some((tag) => FOREIGN_REPO_TAGS.has(tag) || (tag.startsWith('repo:') && !tag.endsWith(':thumbgate') && !tag.endsWith('thumbgate')))) {
    return false;
  }
  const inferred = inferProjectFromLesson(lesson);
  if (!inferred || inferred === 'global') return true;
  const normalized = normalizeProjectName(inferred);
  return normalized === 'thumbgate';
}

function lessonMatchScore(lesson, { toolName, actionContext } = {}) {
  const toolHit = declaredToolMatches(lesson, toolName);
  const terms = actionMatchTerms(toolName, actionContext);
  const blob = lessonBlob(lesson);
  const hitTerms = terms.filter((term) => blob.includes(term));
  if (!toolHit && hitTerms.length === 0) return 0;
  let score = hitTerms.length + (toolHit ? 1 : 0);
  const gitMutation = hitTerms.some((term) => ['push', 'merge', 'force', 'approve', 'admin'].includes(term));
  if (gitMutation && blob.includes('branch protection')) score += 5;
  if (hitTerms.includes('health') && (blob.includes('/health') || blob.includes('health curl'))) score += 5;
  return score;
}

function lessonMatchesToolCall(lesson, options = {}) {
  const text = lessonDisplayText(lesson);
  if (!text || isRawTranscriptFragment(text)) return false;
  const { isTranscriptShaped, inferProjectFromLesson } = require('./project-scope');
  if (isTranscriptShaped(lesson) || isTranscriptShaped(text)) return false;
  if (options.project) {
    if (!lessonInCallRepo(lesson, options.project)) return false;
  } else {
    const { normalizeProjectName } = require('./project-scope');
    const inferred = inferProjectFromLesson(lesson);
    if (inferred && inferred !== 'global' && normalizeProjectName(inferred) !== 'thumbgate') return false;
  }
  return lessonMatchScore(lesson, options) > 0;
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
  const ranked = (Array.isArray(lessons) ? lessons : [])
    .map((lesson, index) => ({ lesson, index, score: lessonMatchesToolCall(lesson, options) ? lessonMatchScore(lesson, options) : 0 }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  for (const row of ranked) {
    const id = lessonIdentity(row.lesson);
    const last = Number(seen[id] || 0);
    if (id && last && now - last < LESSON_REPEAT_MS) continue;
    matched.push(row.lesson);
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
