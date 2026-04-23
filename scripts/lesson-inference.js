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
const { resolveFeedbackDir } = require('./feedback-paths');
const { ensureParentDir, readJsonl } = require('./fs-utils');
const {
  buildStableId,
  extractFilePaths,
  extractToolCalls,
  extractErrors,
} = require('./conversation-context');

const LESSONS_FILE = 'lessons-index.jsonl';
const RECENT_LESSON_FILE = 'recent-lesson.json';

function getFeedbackDir() {
  return resolveFeedbackDir();
}

function getLessonBaseUrl() {
  const configuredOrigin = String(process.env.THUMBGATE_PUBLIC_APP_ORIGIN || '').trim().replace(/\/+$/, '');
  return configuredOrigin || 'http://localhost:3456';
}

function getLessonsPath() { return path.join(getFeedbackDir(), LESSONS_FILE); }
function getRecentLessonPath() { return path.join(getFeedbackDir(), RECENT_LESSON_FILE); }

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
    id: buildStableId('lesson'),
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
  lesson.link = `${getLessonBaseUrl()}/lessons#${lesson.id}`;

  const lessonsPath = getLessonsPath();
  ensureParentDir(lessonsPath);
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

function isNegativeSignal(signal) {
  return signal === 'negative' || signal === 'down';
}

function isPositiveSignal(signal) {
  return signal === 'positive' || signal === 'up';
}

function selectStatusbarLesson() {
  const lessons = readJsonl(getLessonsPath())
    .slice()
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const latestNegative = lessons.find((lesson) => isNegativeSignal(lesson.signal));
  if (latestNegative) return latestNegative;
  const latestPositive = lessons.find((lesson) => isPositiveSignal(lesson.signal));
  if (latestPositive) return latestPositive;
  return getRecentLesson();
}

function getLessonKind(lesson = {}) {
  const normalizedTitle = String(lesson.lesson || '').trim();
  if (isNegativeSignal(lesson.signal) || /^MISTAKE:/i.test(normalizedTitle)) return 'mistake';
  if (isPositiveSignal(lesson.signal) || /^SUCCESS:/i.test(normalizedTitle)) return 'success';
  if (/^LEARNING:/i.test(normalizedTitle)) return 'learning';
  if (/^PREFERENCE:/i.test(normalizedTitle)) return 'preference';
  return 'lesson';
}

function stripLessonPrefix(lessonText = '') {
  return String(lessonText || '').replace(/^(MISTAKE|SUCCESS|LEARNING|PREFERENCE):\s*/i, '').trim();
}

function formatLessonTimestamp(createdAt = '') {
  const parsed = new Date(createdAt);
  if (!Number.isFinite(parsed.getTime())) return '';
  const mm = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(parsed.getUTCDate()).padStart(2, '0');
  const yyyy = parsed.getUTCFullYear();
  const HH = String(parsed.getUTCHours()).padStart(2, '0');
  const MM = String(parsed.getUTCMinutes()).padStart(2, '0');
  const ss = String(parsed.getUTCSeconds()).padStart(2, '0');
  return `${mm}/${dd}/${yyyy} ${HH}:${MM}:${ss}`;
}

function buildStatusbarLessonLabel(lesson = {}) {
  const kind = getLessonKind(lesson);
  const prefix = kind === 'mistake'
    ? 'Latest mistake'
    : kind === 'success'
      ? 'Latest success'
      : 'Latest lesson';
  const timestamp = formatLessonTimestamp(lesson.createdAt);
  return timestamp ? `${prefix} ${timestamp}` : prefix;
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
// 2b. Context Stuffing — dump all lessons for injection into agent context
// ---------------------------------------------------------------------------

/**
 * Returns ALL lessons condensed for context-window injection.
 * Bypasses RAG/search — just stuff everything into context.
 * For most projects (20-200 lessons), this is 1K-10K tokens.
 * @param {object} opts
 * @param {number} opts.maxTokenBudget - approximate token budget (default 10000)
 * @param {string} opts.signal - filter by 'positive' or 'negative'
 * @param {string} opts.format - 'compact' (default) or 'full'
 * @returns {{ lessons: string, count: number, truncated: boolean }}
 */
function getAllLessonsForContext({ maxTokenBudget = 10000, signal, format = 'compact' } = {}) {
  let lessons = readJsonl(getLessonsPath());
  if (signal) lessons = lessons.filter((l) => l.signal === signal || (signal === 'negative' && l.signal === 'down') || (signal === 'positive' && l.signal === 'up'));

  // Sort by confidence descending — most important lessons first
  lessons.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

  const lines = [];
  let approxTokens = 0;
  let truncated = false;

  for (const l of lessons) {
    let line;
    if (format === 'compact') {
      const sig = l.signal === 'positive' || l.signal === 'up' ? 'DO' : 'AVOID';
      line = `[${sig}] ${l.lesson || l.inferredLesson || ''}`;
    } else {
      line = JSON.stringify({ signal: l.signal, lesson: l.lesson || l.inferredLesson, confidence: l.confidence, tags: l.tags, createdAt: l.createdAt });
    }

    const lineTokens = Math.ceil(line.length / 4); // rough token estimate
    if (approxTokens + lineTokens > maxTokenBudget) {
      truncated = true;
      break;
    }

    lines.push(line);
    approxTokens += lineTokens;
  }

  return {
    lessons: lines.join('\n'),
    count: lines.length,
    totalAvailable: lessons.length,
    truncated,
    approxTokens,
  };
}

// ---------------------------------------------------------------------------
// 3. Statusbar Data Provider
// ---------------------------------------------------------------------------

/**
 * Get data for the Claude Code statusbar.
 * Returns the most recent lesson with link, formatted for display.
 */
function getStatusbarLessonData() {
  const recent = selectStatusbarLesson();
  if (!recent) return { hasLesson: false, text: null, link: null };

  const normalizedLesson = stripLessonPrefix(recent.lesson || '');

  // Distill to actionable insight: prefer structured rule action, then
  // whatToChange, then the lesson text itself. Raw user feedback
  // ("are you sure?", "is this working?") is not useful in a statusbar.
  let displayText = normalizedLesson;
  if (recent.structuredRule && recent.structuredRule.action && recent.structuredRule.action.description) {
    displayText = recent.structuredRule.action.description;
  } else if (recent.whatToChange || recent.what_to_change) {
    displayText = String(recent.whatToChange || recent.what_to_change);
  }

  // Clean up: strip noise prefixes, collapse whitespace
  displayText = displayText
    .replace(/^CRITICAL ERROR - User frustrated:\s*/i, '')
    .replace(/^thumbs?\s*(up|down)\s*:?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Truncate to 60 chars (enough to be readable, short enough for statusbar)
  const truncated = displayText.length > 60 ? displayText.slice(0, 57) + '...' : displayText;

  return {
    hasLesson: true,
    text: truncated,
    link: recent.link,
    lessonId: recent.id,
    confidence: recent.confidence,
    createdAt: recent.createdAt,
    label: buildStatusbarLessonLabel(recent),
    kind: getLessonKind(recent),
  };
}

// ---------------------------------------------------------------------------
// 4. Structured IF/THEN Lesson Extraction (v0.9.4)
// ---------------------------------------------------------------------------

function inferStructuredLesson(conversationWindow, signal, context) {
  const normalizedWindow = Array.isArray(conversationWindow) ? conversationWindow : [];
  const userMessages = normalizedWindow.filter(m => m.role === 'user');
  const assistantMessages = normalizedWindow.filter(m => m.role === 'assistant');
  const lastUser = userMessages[userMessages.length - 1]?.content || '';
  const lastAssistant = assistantMessages[assistantMessages.length - 1]?.content || '';
  const filePaths = extractFilePaths(normalizedWindow);
  const toolCalls = extractToolCalls(normalizedWindow);
  const errorPatterns = extractErrors(normalizedWindow);

  return {
    format: 'if-then-v1',
    trigger: extractTrigger(lastUser),
    action: extractAction(lastAssistant, signal),
    signal,
    confidence: calculateConfidence(normalizedWindow, context),
    scope: inferScope(filePaths, toolCalls),
    examples: [{ userIntent: lastUser.slice(0, 300), assistantAction: lastAssistant.slice(0, 300), outcome: signal === 'positive' ? 'approved' : 'rejected' }],
    metadata: { toolsUsed: toolCalls, filesInvolved: filePaths.slice(0, 10), errorPatterns: errorPatterns.slice(0, 5), conversationLength: normalizedWindow.length, inferredAt: new Date().toISOString() },
  };
}

function extractTrigger(userMsg) {
  const text = String(userMsg || '').trim();
  const lower = text.toLowerCase();
  const leadingPhrases = [
    { phrases: ['fix ', 'debug ', 'solve ', 'investigate '], type: 'debugging' },
    { phrases: ['implement ', 'add ', 'create ', 'build '], type: 'implementation' },
    { phrases: ['why ', 'how ', 'what ', 'where '], type: 'question' },
    { phrases: ['don\'t ', 'do not ', 'never ', 'stop ', 'avoid '], type: 'constraint' },
  ];

  for (const entry of leadingPhrases) {
    const match = consumePhrase(lower, text, entry.phrases);
    if (match) return { condition: match, type: entry.type };
  }

  const errorIndex = ['error', 'fail', 'crash', 'broken', 'wrong']
    .map((token) => lower.indexOf(token))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  if (Number.isInteger(errorIndex)) {
    return {
      condition: text.slice(errorIndex).replace(/^[:\-\s]+/, '').slice(0, 120).trim() || text.slice(0, 120).trim(),
      type: 'error-report',
    };
  }

  return { condition: text.slice(0, 120).trim(), type: 'general' };
}

function extractAction(assistantMsg, signal) {
  return signal === 'positive'
    ? { type: 'do', description: `Repeat this approach: ${assistantMsg.slice(0, 200).trim()}` }
    : { type: 'avoid', description: `Avoid this approach: ${assistantMsg.slice(0, 200).trim()}` };
}

function calculateConfidence(window, context) {
  let s = 0.5;
  if (window.length >= 3) s += 0.1;
  if (window.length >= 5) s += 0.1;
  if (context && context.length > 20) s += 0.1;
  if (extractFilePaths(window).length > 0) s += 0.1;
  return Math.min(s, 1.0);
}

function inferScope(filePaths, toolCalls) {
  if (filePaths.length === 0 && toolCalls.length === 0) return 'global';
  if (filePaths.length <= 2) return 'file-level';
  return 'project-level';
}

function consumePhrase(lower, original, phrases) {
  for (const phrase of phrases) {
    if (!lower.startsWith(phrase)) continue;
    const value = original.slice(phrase.length).replace(/^[:\-\s]+/, '').slice(0, 120).trim();
    return value || original.slice(0, 120).trim();
  }
  return null;
}

// ---------------------------------------------------------------------------
// 6. LLM-Powered Structured Lesson Extraction
// ---------------------------------------------------------------------------

function createLessonPromptExample([
  signal,
  conversationWindow,
  triggerCondition,
  triggerType,
  actionType,
  actionDescription,
  confidence,
  scope,
  tags,
]) {
  return {
    signal,
    conversationWindow: conversationWindow.join('\n'),
    output: {
      trigger: { condition: triggerCondition, type: triggerType },
      action: { type: actionType, description: actionDescription },
      confidence,
      scope,
      tags,
    },
  };
}

// Five multishot exemplars pinned as a constant so they can be inspected/tested
// independently of the prompt string. Each example pairs a (signal,
// conversation_window) with the exact JSON output Claude should emit. These
// were drafted from real ThumbGate incident classes: Edit-before-Read,
// force-push-to-main, deploy-verification, mock-to-live-in-tests, and
// regression-test-pinning. Changing any example shifts lesson extraction
// behavior — treat it like a prompt version bump.
const LLM_LESSON_MULTISHOT_EXAMPLES = [
  [
    'negative',
    [
      '[user]: why is my edit failing?',
      '[assistant]: I\'ll try editing src/api/server.js — Edit(src/api/server.js) failed: File has not been read yet.',
      '[assistant]: Let me Read(src/api/server.js) first, then retry Edit.',
      '[user]: that worked. thumbs down on the first attempt though.',
    ],
    'about to call Edit on a file that has not been Read in this session',
    'constraint',
    'avoid',
    'Never call Edit on a file without first calling Read on it — the tool rejects unread files',
    0.9,
    'global',
    ['Edit', 'Read', 'tool-use', 'preconditions'],
  ],
  [
    'negative',
    [
      '[assistant]: Running git push --force origin main to clean up history.',
      '[user]: NO. Never force-push to main. Thumbs down.',
    ],
    'about to run git push with --force or -f on the main branch',
    'constraint',
    'avoid',
    'Never force-push to main; use incremental commits and open a new PR if history needs adjustment',
    0.95,
    'project-level',
    ['git', 'force-push', 'main-branch', 'destructive'],
  ],
  [
    'positive',
    [
      '[user]: the deploy failed again, can you just verify with curl before declaring done?',
      '[assistant]: Running curl https://thumbgate-production.up.railway.app/health and grepping for the expected version.',
      '[assistant]: Got {"version":"1.15.0"} — matches package.json. Deploy confirmed.',
      '[user]: perfect. thumbs up.',
    ],
    'after merging a PR that touches deployable code',
    'implementation',
    'do',
    'Curl the /health endpoint and grep for the expected version before claiming a deploy succeeded',
    0.85,
    'project-level',
    ['deploy', 'verification', 'curl', 'railway'],
  ],
  [
    'negative',
    [
      '[user]: these test failures are weird',
      '[assistant]: Let me check... the tests are using mocked Stripe. Maybe real Stripe is needed?',
      '[assistant]: Replaced mocks with live Stripe calls. Tests now passing.',
      '[user]: tests should not call real Stripe in CI. Thumbs down.',
    ],
    'a test is failing and the temptation is to replace mocks with live API calls',
    'debugging',
    'avoid',
    'Never swap mocks for real external API calls to make tests pass — inject dependencies and stub the client instead',
    0.9,
    'project-level',
    ['testing', 'mocking', 'stripe', 'ci'],
  ],
  [
    'positive',
    [
      '[user]: add a regression test that pins the distinct tier icons',
      '[assistant]: Added assert.notEqual(proIcon, teamIcon) to tests/billing.test.js, plus the URL regex per tier.',
      '[user]: great, locking that in. thumbs up.',
    ],
    'fixing a bug where two products rendered with the same asset',
    'implementation',
    'do',
    'Add a regression assertion that pins the distinct values (e.g. assert.notEqual(a,b)) so the collapse cannot silently return',
    0.9,
    'file-level',
    ['regression-test', 'stripe', 'billing', 'tier'],
  ],
].map(createLessonPromptExample);

function renderMultishotExamplesForPrompt(examples = LLM_LESSON_MULTISHOT_EXAMPLES) {
  return examples.map((ex) => (
    `<example>
<signal>${ex.signal}</signal>
<conversation_window>
${ex.conversationWindow}
</conversation_window>
<output>${JSON.stringify(ex.output)}</output>
</example>`
  )).join('\n');
}

// Anthropic's prompt-engineering playbook (ref: anthropic.skilljar.com
// Prompt Engineering course) recommends XML tags to scope context blocks and
// multishot exemplars so the model sees the exact expected shape before being
// asked to produce it. Both techniques apply cleanly here because the output
// is a strict JSON schema and the extraction task has five recurring incident
// classes (see LLM_LESSON_MULTISHOT_EXAMPLES).
const LLM_LESSON_SYSTEM_PROMPT = `You are a lesson extraction engine for an AI coding agent safety system called ThumbGate.

<task>
Given a feedback signal (positive or negative) and a conversation window, extract a structured if-then lesson that would prevent the same mistake (negative) or reinforce the same success (positive) in future sessions.
</task>

<output_schema>
Return ONLY valid JSON matching this exact shape — no prose, no code fences, no text outside the JSON object:
{
  "trigger": { "condition": "<when this lesson applies>", "type": "<debugging|implementation|question|error-report|constraint>" },
  "action":  { "type": "<do|avoid>", "description": "<specific action to take or avoid>" },
  "confidence": <0.0 to 1.0>,
  "scope": "<global|file-level|project-level>",
  "tags": ["<relevant tags>"]
}
</output_schema>

<guidelines>
- Be specific and actionable. "Avoid editing files without reading them first" beats "Avoid bad edits".
- confidence should reflect how clear the lesson is from the window. A single ambiguous exchange caps around 0.5; a reproduced failure with a confirmed fix can reach 0.9.
- tags should include tool names, file types, or domain areas mentioned in the conversation.
- Emit JSON only. No code fences, no commentary.
</guidelines>

<examples>
${renderMultishotExamplesForPrompt()}
</examples>`;

function buildLessonUserPrompt({ signal, context, windowText }) {
  const normalizedSignal = signal === 'positive' || signal === 'up' ? 'positive' : 'negative';
  const parts = [`<signal>${normalizedSignal}</signal>`];
  if (context) parts.push(`<user_context>${context}</user_context>`);
  parts.push(`<conversation_window>\n${windowText}\n</conversation_window>`);
  return parts.join('\n');
}

async function inferStructuredLessonLLM(conversationWindow, signal, context) {
  const { isAvailable, callClaude, MODELS } = require('./llm-client');
  if (!isAvailable()) return null;

  const normalizedWindow = Array.isArray(conversationWindow) ? conversationWindow : [];
  if (normalizedWindow.length === 0 && !context) return null;

  const windowText = normalizedWindow
    .slice(-10)
    .map((m) => `[${m.role}]: ${(m.content || '').slice(0, 400)}`)
    .join('\n')
    .slice(0, 4000);

  const userPrompt = buildLessonUserPrompt({ signal, context, windowText });

  const raw = await callClaude({
    systemPrompt: LLM_LESSON_SYSTEM_PROMPT,
    userPrompt,
    model: MODELS.FAST,
    maxTokens: 512,
  });

  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed.trigger || !parsed.action) return null;

    const filePaths = extractFilePaths(normalizedWindow);
    const toolCalls = extractToolCalls(normalizedWindow);
    const errorPatterns = extractErrors(normalizedWindow);
    const userMessages = normalizedWindow.filter((m) => m.role === 'user');
    const assistantMessages = normalizedWindow.filter((m) => m.role === 'assistant');
    const lastUser = userMessages[userMessages.length - 1]?.content || '';
    const lastAssistant = assistantMessages[assistantMessages.length - 1]?.content || '';

    return {
      format: 'if-then-v1-llm',
      trigger: parsed.trigger,
      action: parsed.action,
      signal: signal === 'positive' || signal === 'up' ? 'positive' : 'negative',
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
      scope: parsed.scope || inferScope(filePaths, toolCalls),
      examples: [{ userIntent: lastUser.slice(0, 300), assistantAction: lastAssistant.slice(0, 300), outcome: signal === 'positive' || signal === 'up' ? 'approved' : 'rejected' }],
      metadata: { toolsUsed: toolCalls, filesInvolved: filePaths.slice(0, 10), errorPatterns: errorPatterns.slice(0, 5), conversationLength: normalizedWindow.length, inferredAt: new Date().toISOString(), llmModel: MODELS.FAST },
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    };
  } catch {
    return null;
  }
}

module.exports = {
  inferFromSurroundingMessages, createLesson, getRecentLesson,
  searchLessons, getLessonStats, getStatusbarLessonData, getAllLessonsForContext,
  getLessonsPath, getRecentLessonPath,
  selectStatusbarLesson, getLessonKind, stripLessonPrefix,
  formatLessonTimestamp, buildStatusbarLessonLabel,
  inferStructuredLesson, inferStructuredLessonLLM,
  extractTrigger, extractAction, extractToolCalls,
  extractFilePaths, extractErrors, calculateConfidence, inferScope,
  // Exported for prompt-shape regression tests.
  LLM_LESSON_SYSTEM_PROMPT, LLM_LESSON_MULTISHOT_EXAMPLES,
  renderMultishotExamplesForPrompt, buildLessonUserPrompt,
};
