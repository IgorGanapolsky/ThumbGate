/**
 * Reflector Agent — Self-Healing Brain
 *
 * On negative feedback, analyzes the conversation window to:
 * 1. Identify what the assistant did wrong
 * 2. Check if this is a recurring mistake
 * 3. Propose a specific, actionable rule
 * 4. Return the proposal for user confirmation
 *
 * This transforms ThumbGate from "Manual Guardrail" to "Self-Healing Brain"
 */

'use strict';

const { retrieveRelevantLessons } = require('./lesson-retrieval');
const {
  extractFilePaths,
  extractToolCalls,
  extractErrors,
  normalizeConversationWindow,
} = require('./conversation-context');

/**
 * Run a post-mortem analysis on a negative feedback event.
 * @param {object} params
 * @param {Array} params.conversationWindow - Last N conversation turns
 * @param {string} params.context - One-line context from the caller
 * @param {string} params.whatWentWrong - What the caller said went wrong
 * @param {object} params.structuredRule - IF/THEN rule from lesson-inference
 * @param {object} params.feedbackEvent - The stored feedback event
 * @returns {object} Reflection result with proposed rule and recurrence info
 */
function reflect(params) {
  const { conversationWindow, context, whatWentWrong, structuredRule, feedbackEvent } = params;

  // 1. Extract what happened from the conversation
  const analysis = analyzeConversation(conversationWindow || []);

  // 2. Check for recurrence — has this mistake happened before?
  const recurrence = checkRecurrence(analysis, feedbackEvent);

  // 3. Generate a human-readable proposed rule
  const proposedRule = generateProposedRule(analysis, structuredRule, recurrence, whatWentWrong);

  // 4. Determine severity based on recurrence
  const severity = recurrence.count >= 3 ? 'critical' : recurrence.count >= 1 ? 'warning' : 'info';

  return {
    status: 'reflection_complete',
    analysis: {
      userIntent: analysis.userIntent,
      assistantAction: analysis.assistantAction,
      errorDetected: analysis.errorDetected,
      toolsUsed: analysis.toolsUsed,
      filesInvolved: analysis.filesInvolved,
    },
    recurrence: {
      isRecurring: recurrence.count > 0,
      count: recurrence.count,
      previousLessons: recurrence.previousLessons.map(l => ({
        id: l.id,
        title: l.title,
        timestamp: l.timestamp,
      })),
    },
    proposedRule: proposedRule,
    severity: severity,
    message: formatReflectionMessage(proposedRule, recurrence, analysis),
  };
}

function analyzeConversation(window) {
  const normalizedWindow = normalizeConversationWindow(window);
  const userMsgs = normalizedWindow.filter(m => m.role === 'user');
  const assistantMsgs = normalizedWindow.filter(m => m.role === 'assistant');

  const lastUser = userMsgs[userMsgs.length - 1]?.content || '';
  const lastAssistant = assistantMsgs[assistantMsgs.length - 1]?.content || '';
  const corrections = extractCorrections(userMsgs);
  const toolsUsed = extractToolCalls(normalizedWindow);
  const filesInvolved = extractFilePaths(normalizedWindow).slice(0, 10);
  const errors = extractErrors(normalizedWindow).slice(0, 5);

  return {
    userIntent: lastUser.slice(0, 300),
    assistantAction: lastAssistant.slice(0, 300),
    corrections,
    errorDetected: errors.length > 0,
    errors,
    toolsUsed,
    filesInvolved,
    messageCount: normalizedWindow.length,
  };
}

function checkRecurrence(analysis, feedbackEvent) {
  // Search existing lessons for similar mistakes
  let previousLessons = [];
  try {
    const context = `${analysis.userIntent} ${analysis.assistantAction} ${analysis.corrections.join(' ')}`;
    const toolName = analysis.toolsUsed[0] || 'unknown';
    previousLessons = retrieveRelevantLessons(toolName, context, { maxResults: 5 });
    // Filter to only negative lessons
    previousLessons = previousLessons.filter(l => l.signal === 'negative');
  } catch (_err) {
    // Non-critical — recurrence check is best-effort
  }

  return {
    count: previousLessons.length,
    previousLessons,
  };
}

function generateProposedRule(analysis, structuredRule, recurrence, whatWentWrong) {
  // Build the most specific rule we can from available data
  const parts = [];

  // Use corrections from conversation as the strongest signal
  if (analysis.corrections.length > 0) {
    const correction = analysis.corrections[0];
    parts.push({
      type: 'constraint',
      rule: `NEVER ${correction}`,
      source: 'user-correction',
      confidence: 0.95,
    });
  }

  // Use structured rule if available
  if (structuredRule?.trigger && structuredRule?.action) {
    parts.push({
      type: structuredRule.action.type === 'avoid' ? 'constraint' : 'preference',
      rule: `IF ${structuredRule.trigger.condition} THEN ${structuredRule.action.description}`,
      source: 'inferred',
      confidence: structuredRule.confidence || 0.7,
    });
  }

  // Use whatWentWrong as fallback
  if (parts.length === 0 && whatWentWrong) {
    parts.push({
      type: 'lesson',
      rule: `AVOID: ${whatWentWrong}`,
      source: 'user-provided',
      confidence: 0.8,
    });
  }

  // Use analysis as last resort
  if (parts.length === 0) {
    parts.push({
      type: 'observation',
      rule: `Review approach when: ${analysis.userIntent.slice(0, 80)}`,
      source: 'conversation-analysis',
      confidence: 0.5,
    });
  }

  // Pick highest confidence rule
  const best = parts.sort((a, b) => b.confidence - a.confidence)[0];

  return {
    ...best,
    isRecurring: recurrence.count > 0,
    recurrenceCount: recurrence.count,
    scope: analysis.filesInvolved.length > 0 ? 'project' : 'global',
  };
}

function formatReflectionMessage(proposedRule, recurrence, analysis) {
  const prefix = recurrence.count > 0
    ? `I've made this mistake ${recurrence.count + 1} time(s) now. `
    : '';

  const ruleText = proposedRule.rule;

  const correction = analysis.corrections.length > 0
    ? ` I noticed you corrected me: "${analysis.corrections[0].slice(0, 80)}".`
    : '';

  const fileContext = analysis.filesInvolved.length > 0
    ? ` (in ${analysis.filesInvolved.slice(0, 3).join(', ')})`
    : '';

  return `${prefix}${correction} I've recorded a rule${fileContext}: "${ruleText}". Correct?`;
}

function extractCorrections(userMessages) {
  const results = [];
  const phraseSets = [
    ['don\'t ', 'do not ', 'never ', 'stop '],
    ['wrong ', 'incorrect ', 'that\'s not ', 'no, '],
    ['i said ', 'i told you ', 'i already '],
    ['use ', 'switch to ', 'change to '],
  ];

  for (const message of userMessages) {
    const content = String(message.content || '').trim();
    const lower = content.toLowerCase();
    if (!lower) continue;

    for (const phrases of phraseSets) {
      for (const phrase of phrases) {
        const index = lower.indexOf(phrase);
        if (index === -1) continue;
        let detail = content.slice(index + phrase.length).trim();
        const insteadIndex = detail.toLowerCase().indexOf(' instead');
        if (insteadIndex >= 0) {
          detail = detail.slice(0, insteadIndex).trim();
        }
        if (detail) results.push(detail.slice(0, 100));
        break;
      }
    }
  }

  return results;
}

module.exports = { reflect, analyzeConversation, checkRecurrence, generateProposedRule, formatReflectionMessage };
