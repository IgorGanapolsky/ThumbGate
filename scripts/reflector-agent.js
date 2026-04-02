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
  const userMsgs = window.filter(m => m.role === 'user');
  const assistantMsgs = window.filter(m => m.role === 'assistant');

  const lastUser = userMsgs[userMsgs.length - 1]?.content || '';
  const lastAssistant = assistantMsgs[assistantMsgs.length - 1]?.content || '';
  const allText = window.map(m => m.content || '').join('\n');

  // Detect correction patterns — user telling assistant to stop/change
  const corrections = [];
  for (const msg of userMsgs) {
    const content = msg.content || '';
    const correctionPatterns = [
      /(?:don't|do not|never|stop)\s+(.{5,100})/gi,
      /(?:wrong|incorrect|that's not|no,)\s+(.{5,100})/gi,
      /(?:I said|I told you|I already)\s+(.{5,100})/gi,
      /(?:use|switch to|change to)\s+(.{5,100})\s+instead/gi,
    ];
    for (const pattern of correctionPatterns) {
      const matches = [...content.matchAll(pattern)];
      corrections.push(...matches.map(m => m[1].trim()));
    }
  }

  // Extract what tools were used
  const toolsUsed = new Set();
  const toolPattern = /(?:Read|Edit|Write|Bash|Grep|Glob|Agent|WebFetch|WebSearch)\s*(?:\(|tool)/gi;
  for (const match of allText.matchAll(toolPattern)) {
    toolsUsed.add(match[0].replace(/\s*[(\s].*/, ''));
  }

  // Extract file paths
  const files = new Set();
  const filePattern = /(?:src\/|scripts\/|tests\/|\.claude\/)[^\s,)'"<>]+/g;
  for (const match of allText.matchAll(filePattern)) {
    files.add(match[0]);
  }

  // Detect error messages
  const errors = [];
  const errorPattern = /(?:Error|FAIL|error|TypeError|401|403|404|500)[:\s][^\n]{0,100}/gi;
  for (const match of allText.matchAll(errorPattern)) {
    errors.push(match[0].trim());
  }

  return {
    userIntent: lastUser.slice(0, 300),
    assistantAction: lastAssistant.slice(0, 300),
    corrections,
    errorDetected: errors.length > 0,
    errors: errors.slice(0, 5),
    toolsUsed: [...toolsUsed],
    filesInvolved: [...files].slice(0, 10),
    messageCount: window.length,
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

module.exports = { reflect, analyzeConversation, checkRecurrence, generateProposedRule, formatReflectionMessage };
