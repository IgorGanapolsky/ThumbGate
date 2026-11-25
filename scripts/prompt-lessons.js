#!/usr/bin/env node
'use strict';

// AGENT-3667, 24 Nov 2026 (faults brief, item B): lessons used to arrive only after the miss. This UserPromptSubmit
// step reads the prompt, picks the top three stored lessons that match its topic, prints them as context before the
// agent's first tool call, and logs each injection to lesson-injections.jsonl (the log fault D measures from).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_PROMPT_LESSONS = 3;
const MAX_LESSON_CHARS = 220;
const INJECTION_LOG = 'lesson-injections.jsonl';
const STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'always', 'because', 'before', 'being', 'could', 'does', 'doing', 'done', 'each',
  'from', 'have', 'here', 'into', 'just', 'like', 'make', 'more', 'need', 'only', 'other', 'over', 'please', 'should',
  'some', 'that', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'want', 'what', 'when', 'where',
  'which', 'will', 'with', 'would', 'your', 'thumbs', 'thumb', 'down', 'work', 'thing',
]);

function promptTerms(prompt) {
  const seen = new Set();
  for (const word of String(prompt || '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length >= 4 && !STOP_WORDS.has(word)) seen.add(word);
  }
  return [...seen];
}

function lessonText(lesson) {
  const { lessonDisplayText } = require('./lesson-hook-relevance');
  return lessonDisplayText(lesson);
}

function lessonTags(lesson) {
  return (Array.isArray(lesson.tags) ? lesson.tags : []).map((tag) => String(tag).toLowerCase());
}

// A tag hit counts double: a lesson tagged "dotloop" is about dotloop even when its sentence is short.
function scorePromptLesson(lesson, terms) {
  const text = lessonText(lesson).toLowerCase();
  const tags = lessonTags(lesson);
  let score = 0;
  let tagHit = false;
  for (const term of terms) {
    if (tags.some((tag) => tag === term || tag.includes(term))) { score += 2; tagHit = true; }
    else if (text.includes(term)) score += 1;
  }
  // One stray shared word is not a match; a tag hit or two shared words is.
  return tagHit || score >= 2 ? score : 0;
}

function selectPromptLessons(lessons, prompt, { limit = MAX_PROMPT_LESSONS } = {}) {
  const { isRawTranscriptFragment } = require('./lesson-hook-relevance');
  const terms = promptTerms(prompt);
  if (terms.length === 0) return [];
  const seenText = new Set();
  return (Array.isArray(lessons) ? lessons : [])
    .filter((lesson) => lesson && !lesson.pruned && !lesson.demoted)
    .map((lesson, index) => ({ lesson, index, text: lessonText(lesson).replace(/\s+/g, ' '), score: 0 }))
    .filter((row) => row.text && !isRawTranscriptFragment(row.text))
    .map((row) => ({ ...row, score: scorePromptLesson(row.lesson, terms) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .filter((row) => (seenText.has(row.text) ? false : seenText.add(row.text)))
    .slice(0, limit)
    .map((row) => row.lesson);
}

function formatPromptReminder(lessons) {
  const lines = (lessons || []).map((lesson, index) => {
    let text = lessonText(lesson).replace(/\s+/g, ' ');
    if (text.length > MAX_LESSON_CHARS) text = `${text.slice(0, MAX_LESSON_CHARS - 1).trim()}…`;
    return `${index + 1}. ${text}`;
  });
  if (lines.length === 0) return '';
  return ['<system-reminder>', 'ThumbGate lessons that match this task (read before the first tool call):', ...lines, '</system-reminder>'].join('\n');
}

function logInjections(feedbackDir, lessons, { sessionId = '', prompt = '', surface = 'prompt', now = new Date() } = {}) {
  if (!lessons.length) return [];
  fs.mkdirSync(feedbackDir, { recursive: true });
  const promptHash = crypto.createHash('sha256').update(String(prompt)).digest('hex').slice(0, 16);
  const rows = lessons.map((lesson) => ({
    injectedAt: now.toISOString(),
    surface,
    sessionId: String(sessionId || ''),
    promptHash,
    lessonId: String(lesson.id || ''),
    tags: lessonTags(lesson),
  }));
  fs.appendFileSync(path.join(feedbackDir, INJECTION_LOG), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  return rows;
}

function readPromptInput(env, stdinText) {
  let prompt = env.CLAUDE_USER_PROMPT || '';
  let sessionId = env.CLAUDE_SESSION_ID || '';
  let cwd = env.CLAUDE_PROJECT_DIR || process.cwd();
  if (stdinText) {
    try {
      const parsed = JSON.parse(stdinText);
      if (typeof parsed.prompt === 'string') prompt = parsed.prompt;
      sessionId = parsed.session_id || parsed.sessionId || sessionId;
      cwd = parsed.cwd || cwd;
    } catch { /* plain text prompts are fine */ }
  }
  return { prompt, sessionId, cwd };
}

function run({ prompt, sessionId, cwd }) {
  if (!String(prompt || '').trim()) return '';
  const { resolveFeedbackDir } = require('./feedback-paths');
  const { resolveLocalProject } = require('./project-identity');
  const feedbackDir = resolveFeedbackDir({ cwd, feedbackDir: process.env.THUMBGATE_FEEDBACK_DIR || undefined });
  const projectKey = resolveLocalProject(cwd).projectKey;
  const rows = require('./project-catalog').readProjectRows(feedbackDir, 'memory-log.jsonl', { projectKey });
  const chosen = selectPromptLessons(rows, prompt);
  if (chosen.length === 0) return '';
  logInjections(feedbackDir, chosen, { sessionId, prompt });
  return formatPromptReminder(chosen);
}

if (require.main === module) {
  let stdinText = '';
  try { if (!process.stdin.isTTY) stdinText = fs.readFileSync(0, 'utf8'); } catch { /* no stdin */ }
  try {
    const out = run(readPromptInput(process.env, stdinText));
    if (out) process.stdout.write(`${out}\n`);
  } catch { /* a lesson lookup never blocks a prompt */ }
}

module.exports = { MAX_PROMPT_LESSONS, INJECTION_LOG, promptTerms, scorePromptLesson, selectPromptLessons, formatPromptReminder, logInjections, readPromptInput, run };
