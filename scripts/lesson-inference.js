/**
 * Infer a structured IF/THEN lesson from a conversation window.
 * Uses a lightweight local inference approach (no external API calls).
 * Falls back to pattern matching if no LLM is available.
 */

'use strict';

function inferStructuredLesson(conversationWindow, signal, context) {
  // Extract the key elements from conversation
  const userMessages = conversationWindow.filter(m => m.role === 'user');
  const assistantMessages = conversationWindow.filter(m => m.role === 'assistant');

  const lastUser = userMessages[userMessages.length - 1]?.content || '';
  const lastAssistant = assistantMessages[assistantMessages.length - 1]?.content || '';

  // Extract structured elements
  const trigger = extractTrigger(lastUser, lastAssistant, signal);
  const action = extractAction(lastAssistant, signal);
  const toolCalls = extractToolCalls(conversationWindow);
  const filePaths = extractFilePaths(conversationWindow);
  const errorMessages = extractErrors(conversationWindow);

  // Build IF/THEN rule
  const rule = {
    format: 'if-then-v1',
    trigger: trigger,           // IF this situation occurs...
    action: action,             // THEN do/avoid this...
    signal: signal,
    confidence: calculateConfidence(conversationWindow, context),
    scope: inferScope(filePaths, toolCalls),  // file-level, project-level, global
    examples: [{
      userIntent: lastUser.slice(0, 300),
      assistantAction: lastAssistant.slice(0, 300),
      outcome: signal === 'positive' ? 'approved' : 'rejected',
    }],
    metadata: {
      toolsUsed: toolCalls,
      filesInvolved: filePaths.slice(0, 10),
      errorPatterns: errorMessages.slice(0, 5),
      conversationLength: conversationWindow.length,
      inferredAt: new Date().toISOString(),
    },
  };

  return rule;
}

function extractTrigger(userMsg, assistantMsg, signal) {
  // Pattern: what situation led to this feedback?
  // Look for: questions, commands, error descriptions, file references
  const patterns = [
    { regex: /(?:fix|debug|solve|investigate)\s+(.{10,80})/i, type: 'debugging' },
    { regex: /(?:implement|add|create|build)\s+(.{10,80})/i, type: 'implementation' },
    { regex: /(?:why|how|what|where)\s+(.{10,80})/i, type: 'question' },
    { regex: /(?:error|fail|crash|broken|wrong)\s*[:\-]?\s*(.{10,80})/i, type: 'error-report' },
    { regex: /(?:don't|never|stop|avoid)\s+(.{10,80})/i, type: 'constraint' },
  ];

  for (const p of patterns) {
    const match = userMsg.match(p.regex);
    if (match) {
      return { condition: match[1].trim(), type: p.type };
    }
  }

  return { condition: userMsg.slice(0, 120).trim(), type: 'general' };
}

function extractAction(assistantMsg, signal) {
  if (signal === 'positive') {
    return {
      type: 'do',
      description: `Repeat this approach: ${assistantMsg.slice(0, 200).trim()}`,
    };
  }
  return {
    type: 'avoid',
    description: `Avoid this approach: ${assistantMsg.slice(0, 200).trim()}`,
  };
}

function extractToolCalls(window) {
  const tools = new Set();
  for (const msg of window) {
    const content = msg.content || '';
    // Match common tool patterns in Claude Code output
    const toolMatches = content.match(/(?:Read|Edit|Write|Bash|Grep|Glob|Agent|WebFetch)\s*\(/g);
    if (toolMatches) {
      toolMatches.forEach(t => tools.add(t.replace(/\s*\($/, '')));
    }
  }
  return [...tools];
}

function extractFilePaths(window) {
  const paths = new Set();
  for (const msg of window) {
    const content = msg.content || '';
    const matches = content.match(/(?:src\/|scripts\/|tests\/|\.claude\/|adapters\/)[^\s,)'"<>]+/g);
    if (matches) matches.forEach(p => paths.add(p));
  }
  return [...paths];
}

function extractErrors(window) {
  const errors = new Set();
  for (const msg of window) {
    const content = msg.content || '';
    const matches = content.match(/(?:Error|FAIL|error|TypeError|ReferenceError|401|403|404|500)[:\s][^\n]{0,100}/gi);
    if (matches) matches.forEach(e => errors.add(e.trim()));
  }
  return [...errors];
}

function calculateConfidence(window, context) {
  let score = 0.5;
  if (window.length >= 3) score += 0.1;
  if (window.length >= 5) score += 0.1;
  if (context && context.length > 20) score += 0.1;
  // File paths present = more specific = higher confidence
  const hasFiles = window.some(m => /(?:src\/|scripts\/)/.test(m.content || ''));
  if (hasFiles) score += 0.1;
  return Math.min(score, 1.0);
}

function inferScope(filePaths, toolCalls) {
  if (filePaths.length === 0 && toolCalls.length === 0) return 'global';
  if (filePaths.length <= 2) return 'file-level';
  return 'project-level';
}

module.exports = {
  inferStructuredLesson,
  extractTrigger,
  extractAction,
  extractToolCalls,
  extractFilePaths,
  extractErrors,
  calculateConfidence,
  inferScope,
};
