#!/usr/bin/env node
'use strict';

/**
 * Lesson Inference — surrounding message context extraction + lesson linking.
 *
 * When a user gives thumbs up/down, this module:
 * 1. Reads the surrounding conversation context (prior + following messages)
 * 2. Infers what the lesson is from that context
 * 3. Creates a structured lesson with a stable link
 * 4. Provides data for the statusbar to show the most recent lesson
 *
 * Competing with Mem0: our advantage is local-first + structured inference,
 * not just raw storage.
 */

const fs = require('fs');
const path = require('path');

const LESSONS_FILE = 'lessons-index.jsonl';
const RECENT_LESSON_FILE = 'recent-lesson.json';

function getFeedbackDir() {
  return process.env.RLHF_FEEDBACK_DIR || path.join(process.cwd(), '.rlhf');
}

function getLessonsPath() { return path.join(getFeedbackDir(), LESSONS_FILE); }
function getRecentLessonPath() { return path.join(getFeedbackDir(), RECENT_LESSON_FILE); }

function readJsonl(fp) {
  if (!fs.existsSync(fp)) return [];
  const raw = fs.readFileSync(fp, 'utf-8').trim();
  if (!raw) return [];
  return raw.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function ensureDir(p) { const d = path.dirname(p); if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

// ---------------------------------------------------------------------------
// 1. Surrounding Message Context Extraction
// ---------------------------------------------------------------------------

/**
 * Extract lesson context from surrounding messages.
 * Takes the conversation turns before/after the feedback signal.
 *
 * @param {Object} opts
 * @param {Array} opts.priorMessages - Messages before the feedback (most recent first)
 * @param {Array} opts.followingMessages - Messages after the feedback
 * @param {string} opts.signal - 'positive' or 'negative'
 * @param {string} opts.feedbackContext - User-provided context string
 * @returns {{ inferredLesson, triggerMessage, priorSummary, confidence }}
 */
function inferFromSurroundingMessages({ priorMessages = [], followingMessages = [], signal, feedbackContext = '' } = {}) {
  const prior = priorMessages.slice(0, 5); // Last 5 messages before feedback
  const following = followingMessages.slice(0, 3); // Next 3 messages after

  // The trigger message is typically the last assistant message before feedback
  const triggerMessage = prior.find((m) => m.role === 'assistant') || prior[0] || null;
  const triggerText = triggerMessage ? (triggerMessage.content || triggerMessage.text || '') : '';

  // Extract what the agent did
  const actionPatterns = [
    { regex: /(?:edited|modified|changed|updated)\s+(.+?)(?:\.|$)/i, type: 'edit' },
    { regex: /(?:created|wrote|added)\s+(.+?)(?:\.|$)/i, type: 'create' },
    { regex: /(?:ran|executed|running)\s+(.+?)(?:\.|$)/i, type: 'command' },
    { regex: /(?:fixed|resolved|patched)\s+(.+?)(?:\.|$)/i, type: 'fix' },
    { regex: /(?:deployed|pushed|merged)\s+(.+?)(?:\.|$)/i, type: 'deploy' },
    { regex: /(?:deleted|removed|dropped)\s+(.+?)(?:\.|$)/i, type: 'delete' },
  ];

  let inferredAction = null;
  for (const ap of actionPatterns) {
    const match = triggerText.match(ap.regex);
    if (match) { inferredAction = { type: ap.type, target: match[1].trim().slice(0, 100) }; break; }
  }

  // Build the lesson
  const isNegative = signal === 'negative' || signal === 'down';
  let inferredLesson;

  if (isNegative && inferredAction) {
    inferredLesson = `Avoid: ${inferredAction.type} on ${inferredAction.target}. ${feedbackContext || 'User signaled this approach failed.'}`;
  } else if (!isNegative && inferredAction) {
    inferredLesson = `Repeat: ${inferredAction.type} on ${inferredAction.target}. ${feedbackContext || 'User confirmed this approach works.'}`;
  } else if (feedbackContext) {
    inferredLesson = feedbackContext;
  } else {
    inferredLesson = `${isNegative ? 'Negative' : 'Positive'} signal on agent output. No specific action inferred.`;
  }

  // Summarize prior context
  const priorSummary = prior.slice(0, 3).map((m) => {
    const role = m.role || 'unknown';
    const text = (m.content || m.text || '').slice(0, 80);
    return `[${role}] ${text}`;
  }).join(' → ');

  // Confidence: higher if we have more context
  const contextSignals = [
    feedbackContext.length > 10,
    !!inferredAction,
    prior.length >= 2,
    !!triggerMessage,
  ];
  const confidence = Math.round((contextSignals.filter(Boolean).length / contextSignals.length) * 100);

  return { inferredLesson, triggerMessage: triggerText.slice(0, 200), priorSummary, inferredAction, confidence, signal };
}

// ---------------------------------------------------------------------------
// 2. Lesson Index & Linking
// ---------------------------------------------------------------------------

/**
 * Create a lesson record with a stable link and store in the index.
 */
function createLesson({ feedbackId, signal, inferredLesson, triggerMessage, priorSummary, confidence, tags = [], metadata = {} } = {}) {
  const lesson = {
    id: `lesson_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    feedbackId: feedbackId || null,
    signal: signal || 'unknown',
    lesson: inferredLesson || '',
    triggerMessage: triggerMessage || '',
    priorSummary: priorSummary || '',
    confidence: confidence || 0,
    tags,
    metadata,
    createdAt: new Date().toISOString(),
    link: null, // populated below
  };

  // Stable link: dashboard deep-link to this lesson
  lesson.link = `http://localhost:9876/lessons#${lesson.id}`;

  const lessonsPath = getLessonsPath();
  ensureDir(lessonsPath);
  fs.appendFileSync(lessonsPath, JSON.stringify(lesson) + '\n');

  // Update recent lesson for statusbar
  const recentPath = getRecentLessonPath();
  fs.writeFileSync(recentPath, JSON.stringify(lesson, null, 2) + '\n');

  return lesson;
}

/**
 * Get the most recent lesson (for statusbar display).
 */
function getRecentLesson() {
  const p = getRecentLessonPath();
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

/**
 * Search lessons by query text.
 */
function searchLessons({ query = '', limit = 10, signal } = {}) {
  const lessons = readJsonl(getLessonsPath());
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);

  return lessons
    .filter((l) => !signal || l.signal === signal)
    .map((l) => {
      const haystack = `${l.lesson} ${l.triggerMessage} ${l.priorSummary} ${(l.tags || []).join(' ')}`.toLowerCase();
      let score = 0;
      for (const t of tokens) { if (t.length > 2 && haystack.includes(t)) score += 1; }
      return { ...l, _score: score };
    })
    .filter((l) => tokens.length === 0 || l._score > 0)
    .sort((a, b) => b._score - a._score || new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
}

/**
 * Get lesson stats.
 */
function getLessonStats() {
  const lessons = readJsonl(getLessonsPath());
  const positive = lessons.filter((l) => l.signal === 'positive' || l.signal === 'up').length;
  const negative = lessons.filter((l) => l.signal === 'negative' || l.signal === 'down').length;
  const avgConfidence = lessons.length > 0 ? Math.round(lessons.reduce((s, l) => s + (l.confidence || 0), 0) / lessons.length) : 0;
  return { total: lessons.length, positive, negative, avgConfidence };
}

// ---------------------------------------------------------------------------
// 3. Statusbar Data Provider
// ---------------------------------------------------------------------------

/**
 * Get data for the Claude Code statusbar.
 * Returns the most recent lesson with link, formatted for display.
 */
function getStatusbarLessonData() {
  const recent = getRecentLesson();
  if (!recent) return { hasLesson: false, text: null, link: null };

  const emoji = (recent.signal === 'negative' || recent.signal === 'down') ? '👎' : '👍';
  const truncated = recent.lesson.length > 60 ? recent.lesson.slice(0, 57) + '...' : recent.lesson;

  return {
    hasLesson: true,
    text: `${emoji} ${truncated}`,
    link: recent.link,
    lessonId: recent.id,
    confidence: recent.confidence,
    createdAt: recent.createdAt,
  };
}

// ---------------------------------------------------------------------------
// 4. Structured IF/THEN Lesson Extraction (v0.9.4)
// ---------------------------------------------------------------------------

function inferStructuredLesson(conversationWindow, signal, context) {
  const userMessages = conversationWindow.filter(m => m.role === 'user');
  const assistantMessages = conversationWindow.filter(m => m.role === 'assistant');
  const lastUser = userMessages[userMessages.length - 1]?.content || '';
  const lastAssistant = assistantMessages[assistantMessages.length - 1]?.content || '';

  return {
    format: 'if-then-v1',
    trigger: extractTrigger(lastUser),
    action: extractAction(lastAssistant, signal),
    signal,
    confidence: calculateConfidence(conversationWindow, context),
    scope: inferScope(extractFilePaths(conversationWindow), extractToolCalls(conversationWindow)),
    examples: [{ userIntent: lastUser.slice(0, 300), assistantAction: lastAssistant.slice(0, 300), outcome: signal === 'positive' ? 'approved' : 'rejected' }],
    metadata: { toolsUsed: extractToolCalls(conversationWindow), filesInvolved: extractFilePaths(conversationWindow).slice(0, 10), errorPatterns: extractErrors(conversationWindow).slice(0, 5), conversationLength: conversationWindow.length, inferredAt: new Date().toISOString() },
  };
}

function extractTrigger(userMsg) {
  const patterns = [
    { regex: /(?:fix|debug|solve|investigate)\s+(.{10,80})/i, type: 'debugging' },
    { regex: /(?:implement|add|create|build)\s+(.{10,80})/i, type: 'implementation' },
    { regex: /(?:why|how|what|where)\s+(.{10,80})/i, type: 'question' },
    { regex: /(?:error|fail|crash|broken|wrong)\s*[:\-]?\s*(.{10,80})/i, type: 'error-report' },
    { regex: /(?:don't|never|stop|avoid)\s+(.{10,80})/i, type: 'constraint' },
  ];
  for (const p of patterns) { const m = userMsg.match(p.regex); if (m) return { condition: m[1].trim(), type: p.type }; }
  return { condition: userMsg.slice(0, 120).trim(), type: 'general' };
}

function extractAction(assistantMsg, signal) {
  return signal === 'positive'
    ? { type: 'do', description: `Repeat this approach: ${assistantMsg.slice(0, 200).trim()}` }
    : { type: 'avoid', description: `Avoid this approach: ${assistantMsg.slice(0, 200).trim()}` };
}

function extractToolCalls(window) {
  const tools = new Set();
  for (const msg of window) { const m = (msg.content || '').match(/(?:Read|Edit|Write|Bash|Grep|Glob|Agent|WebFetch)\s*\(/g); if (m) m.forEach(t => tools.add(t.replace(/\s*\($/, ''))); }
  return [...tools];
}

function extractFilePaths(window) {
  const paths = new Set();
  for (const msg of window) { const m = (msg.content || '').match(/(?:src\/|scripts\/|tests\/|\.claude\/|adapters\/)[^\s,)'"<>]+/g); if (m) m.forEach(p => paths.add(p)); }
  return [...paths];
}

function extractErrors(window) {
  const errors = new Set();
  for (const msg of window) { const m = (msg.content || '').match(/(?:Error|FAIL|error|TypeError|ReferenceError|401|403|404|500)[:\s][^\n]{0,100}/gi); if (m) m.forEach(e => errors.add(e.trim())); }
  return [...errors];
}

function calculateConfidence(window, context) {
  let s = 0.5;
  if (window.length >= 3) s += 0.1;
  if (window.length >= 5) s += 0.1;
  if (context && context.length > 20) s += 0.1;
  if (window.some(m => /(?:src\/|scripts\/)/.test(m.content || ''))) s += 0.1;
  return Math.min(s, 1.0);
}

function inferScope(filePaths, toolCalls) {
  if (filePaths.length === 0 && toolCalls.length === 0) return 'global';
  if (filePaths.length <= 2) return 'file-level';
  return 'project-level';
}

module.exports = {
  inferFromSurroundingMessages, createLesson, getRecentLesson,
  searchLessons, getLessonStats, getStatusbarLessonData,
  getLessonsPath, getRecentLessonPath,
  inferStructuredLesson, extractTrigger, extractAction, extractToolCalls,
  extractFilePaths, extractErrors, calculateConfidence, inferScope,
};
