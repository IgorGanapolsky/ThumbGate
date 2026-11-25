#!/usr/bin/env node
'use strict';

/**
 * History Distiller — Self-Healing Brain for ThumbGate (Pro feature).
 *
 * When a user gives thumbs-down, this module:
 * 1. Takes the last N conversation messages (chatHistory)
 * 2. Identifies the failed tool call and its context
 * 3. Auto-proposes a lesson: "I noticed X. I've recorded a rule to NEVER do X. Correct?"
 * 4. Creates a prevention rule if the user confirms
 *
 * This closes the gap from "manual guardrail" to "self-healing brain."
 * Strategic value: justifies Pro $19/mo subscription via outcome-based intelligence.
 */

const { createLesson, inferFromSurroundingMessages } = require('./lesson-inference');
const contextfs = require('./contextfs');

// ---------------------------------------------------------------------------
// Chat History Analysis
// ---------------------------------------------------------------------------


const MAX_CORRECTION_CHARS = 400;
const RECENT_USER_MESSAGES = 2;

const ANTI_PATTERNS = [
  { pattern: /\b(?:tailwind|tw-)\b/i, label: 'Tailwind CSS', ruleTemplate: 'NEVER use Tailwind CSS in this project' },
  { pattern: /(?:force[- ]?push|push\s*--force|--force)\b/i, label: 'force push', ruleTemplate: 'NEVER force-push to any branch' },
  { pattern: /\b(?:rm\s+-rf|delete\s+all)\b/i, label: 'destructive deletion', ruleTemplate: 'NEVER run destructive delete commands without confirmation' },
  { pattern: /\bskip\s*(?:test|ci|check)/i, label: 'skipping tests', ruleTemplate: 'NEVER skip tests or CI checks' },
  { pattern: /\b(?:mock(?:ed|ing)?|stub(?:bed|bing)?)\b.*\b(?:database|db)\b/i, label: 'mocking database', ruleTemplate: 'NEVER mock the database — use real test instances' },
  { pattern: /\b(?:hardcod|hard[- ]cod)/i, label: 'hardcoded values', ruleTemplate: 'NEVER hardcode secrets, URLs, or configuration values' },
  { pattern: /\b(?:console\.log|print\s+debug)\b/i, label: 'debug logging', ruleTemplate: 'NEVER leave debug console.log/print statements in production code' },
  { pattern: /\b(?:any\b.*type|:\s*any\b)/i, label: 'TypeScript any', ruleTemplate: 'NEVER use the `any` type — use proper type annotations' },
];

/**
 * Analyze chat history to find the correction pattern.
 * Looks for: user corrected the agent about something → agent did it again → user gave thumbs down.
 *
 * @param {Array} chatHistory - Array of {role, content} messages, most recent last
 * @param {Object} failedToolCall - The tool call that triggered the thumbs-down
 * @returns {{ correction, antiPattern, proposedRule, confidence, evidence }}
 */
function analyzeChatHistory(chatHistory, failedToolCall = null) {
  const messages = Array.isArray(chatHistory) ? chatHistory : [];
  if (messages.length === 0) return { correction: null, antiPattern: null, proposedRule: null, confidence: 0, evidence: [] };

  const evidence = [];
  let bestAntiPattern = null;
  let userCorrection = null;

  // Scan for user corrections (messages where user said "don't", "stop", "no", "never", "wrong")
  const correctionPatterns = [
    /\b(?:don'?t|do not|stop|never|wrong|no,?\s+(?:that|not|I said))\b/i,
    /\b(?:I (?:told|said|asked) you|I already|we don'?t)\b/i,
    /\b(?:should(?:n'?t| not)|must not|not supposed to)\b/i,
  ];

  // Only the person's own latest short messages can be a correction. Pasted briefs,
  // task notifications and system text contain "never"/"don't" without being feedback,
  // and an old message in the window says nothing about this thumbs-down.
  const SYSTEM_TEXT = /<(?:task-notification|pasted_content|system-reminder)\b|\[SYSTEM NOTIFICATION/i;
  const recentUserTexts = messages
    .filter((m) => m && m.role === 'user')
    .map((m) => String(m.content || m.text || ''))
    .filter((text) => text.length > 0 && text.length <= MAX_CORRECTION_CHARS && !SYSTEM_TEXT.test(text))
    .slice(-RECENT_USER_MESSAGES)
    .reverse();
  for (const text of recentUserTexts) {
    if (correctionPatterns.some((cp) => cp.test(text))) {
      userCorrection = text.slice(0, 200);
      evidence.push({ type: 'user_correction', text: userCorrection });
      break;
    }
  }

  // Scan assistant messages for anti-patterns
  const assistantMessages = messages.filter((m) => m.role === 'assistant').map((m) => m.content || m.text || '');
  const allAssistantText = assistantMessages.join('\n');

  // Also check the failed tool call
  const toolCallText = failedToolCall
    ? `${failedToolCall.tool || ''} ${failedToolCall.input || ''} ${failedToolCall.output || ''}`
    : '';
  const combinedText = `${allAssistantText}\n${toolCallText}`;

  for (const ap of ANTI_PATTERNS) {
    if (ap.pattern.test(combinedText)) {
      bestAntiPattern = ap;
      evidence.push({ type: 'anti_pattern', label: ap.label });
      break;
    }
  }

  // Build proposed rule
  let proposedRule = null;
  let confidence = 0;

  if (bestAntiPattern && userCorrection) {
    proposedRule = bestAntiPattern.ruleTemplate;
    confidence = 90;
  } else if (bestAntiPattern) {
    proposedRule = bestAntiPattern.ruleTemplate;
    confidence = 60;
  } else if (userCorrection) {
    // Extract the "don't X" part as a rule
    const dontMatch = userCorrection.match(/(?:don'?t|never|stop)\s+(.{5,60})/i);
    if (dontMatch) {
      proposedRule = `NEVER ${dontMatch[1].trim().replace(/[.!?]+$/, '')}`;
      confidence = 50;
    }
  }

  return {
    correction: userCorrection,
    antiPattern: bestAntiPattern ? bestAntiPattern.label : null,
    proposedRule,
    confidence,
    evidence,
    messageCount: messages.length,
  };
}

// ---------------------------------------------------------------------------
// History-Aware Distillation (the main entry point)
// ---------------------------------------------------------------------------

/**
 * Distill a lesson from chat history when thumbs-down is received.
 * This is the "Reflector" agent — it takes conversation context and
 * auto-proposes what went wrong + a prevention rule.
 *
 * @param {Object} opts
 * @param {Array} opts.chatHistory - Last N messages [{role, content}]
 * @param {Object} [opts.failedToolCall] - The tool call that failed
 * @param {string} [opts.feedbackContext] - User's feedback context string
 * @param {string} [opts.signal] - 'negative' or 'positive'
 * @returns {{ lesson, proposedRule, confirmation, autoCreated }}
 */
function distillFromHistory({ chatHistory = [], failedToolCall = null, feedbackContext = '', signal = 'negative' } = {}) {
  // Step 1: Analyze chat history for corrections and anti-patterns
  const analysis = analyzeChatHistory(chatHistory, failedToolCall);

  // Step 2: Infer from surrounding messages (leverage existing module)
  const inference = inferFromSurroundingMessages({
    priorMessages: chatHistory.slice(-10),
    signal,
    feedbackContext,
  });

  // Step 3: Build the auto-proposed lesson
  let proposedWhatWentWrong;
  let proposedRule = analysis.proposedRule;

  if (analysis.correction && analysis.antiPattern) {
    proposedWhatWentWrong = `I noticed I used ${analysis.antiPattern} despite your earlier correction: "${analysis.correction.slice(0, 100)}". This has been recorded as a mistake.`;
  } else if (analysis.antiPattern) {
    proposedWhatWentWrong = `I detected a ${analysis.antiPattern} anti-pattern in my output that likely caused the issue.`;
  } else if (analysis.correction) {
    // No anti-pattern was found, so the mistake itself is unknown: say only what the history shows.
    proposedWhatWentWrong = `Thumbs down right after the instruction "${analysis.correction.slice(0, 100)}". The specific mistake was not stated.`;
  } else if (inference.inferredAction) {
    proposedWhatWentWrong = `The ${inference.inferredAction.type} action on ${inference.inferredAction.target} did not produce the expected result.`;
  } else {
    proposedWhatWentWrong = feedbackContext || 'The agent action did not meet expectations.';
  }

  // Step 4: Build confirmation message
  const confirmation = proposedRule
    ? `I've recorded a rule: "${proposedRule}". Correct?`
    : `Lesson captured: "${proposedWhatWentWrong.slice(0, 100)}". Any corrections?`;

  // Step 5: Auto-create the lesson
  const lesson = createLesson({
    signal,
    inferredLesson: proposedWhatWentWrong,
    triggerMessage: inference.triggerMessage,
    priorSummary: inference.priorSummary,
    confidence: analysis.confidence || inference.confidence,
    tags: analysis.antiPattern ? [analysis.antiPattern] : [],
    metadata: { distilled: true, hasCorrection: !!analysis.correction, hasAntiPattern: !!analysis.antiPattern },
  });

  // Step 6: If high confidence + anti-pattern, auto-install prevention rule
  let ruleInstalled = false;
  if (proposedRule && analysis.confidence >= 60) {
    try {
      contextfs.registerPreventionRules(`# Auto-Distilled Rule\n\n- ${proposedRule}\n\nSource: history-distiller (confidence: ${analysis.confidence}%)`, { source: 'history-distiller', lessonId: lesson.id });
      ruleInstalled = true;
    } catch { /* non-critical */ }
  }

  return {
    lesson,
    proposedWhatWentWrong,
    proposedRule,
    confirmation,
    ruleInstalled,
    analysis,
    inference: { action: inference.inferredAction, confidence: inference.confidence },
    autoCreated: true,
  };
}

module.exports = {
  ANTI_PATTERNS, analyzeChatHistory, distillFromHistory,
};
