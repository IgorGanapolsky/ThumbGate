#!/usr/bin/env node
'use strict';

/**
 * Feedback Sessions
 *
 * When a user gives thumbs up/down, a session opens. Follow-up messages
 * within a time window enrich the session. When the window closes,
 * the full context is used to infer the lesson.
 *
 * Flow:
 * 1. User gives 👎 → openSession() → returns sessionId
 * 2. User types "you lied about X" → appendToSession(sessionId, message)
 * 3. User types "you forgot Y" → appendToSession(sessionId, message)
 * 4. 60s passes OR next assistant response → finalizeSession(sessionId)
 * 5. Lesson is re-inferred with ALL follow-up context
 */

const fs = require('fs');
const path = require('path');

const SESSION_TIMEOUT_MS = 60000; // 60 seconds
const MAX_FOLLOWUP_MESSAGES = 20;

// In-memory store for active sessions (keyed by sessionId)
const activeSessions = new Map();

/**
 * Open a new feedback session after a thumbs up/down signal.
 * The session stays open for follow-up messages.
 */
function openSession(feedbackEventId, signal, initialContext) {
  const sessionId = `fbs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const session = {
    sessionId,
    feedbackEventId,
    signal,
    initialContext: initialContext || '',
    followUpMessages: [],
    openedAt: new Date().toISOString(),
    status: 'open',
    timeoutHandle: null,
    finalizedAt: null,
  };

  // Auto-finalize after timeout
  session.timeoutHandle = setTimeout(() => {
    if (session.status === 'open') {
      finalizeSession(sessionId);
    }
  }, SESSION_TIMEOUT_MS);
  if (session.timeoutHandle.unref) session.timeoutHandle.unref();

  activeSessions.set(sessionId, session);

  return {
    sessionId,
    status: 'open',
    message: `Feedback session opened. Follow-up messages will be captured for ${SESSION_TIMEOUT_MS / 1000}s.`,
    expiresAt: new Date(Date.now() + SESSION_TIMEOUT_MS).toISOString(),
  };
}

/**
 * Append a follow-up message to an open session.
 * Called when user types additional context after thumbs up/down.
 */
function appendToSession(sessionId, message, role = 'user') {
  const session = activeSessions.get(sessionId);
  if (!session) {
    return { status: 'not_found', message: `No active session: ${sessionId}` };
  }
  if (session.status !== 'open') {
    return { status: 'closed', message: `Session already finalized at ${session.finalizedAt}` };
  }
  if (session.followUpMessages.length >= MAX_FOLLOWUP_MESSAGES) {
    return { status: 'full', message: `Session has reached max ${MAX_FOLLOWUP_MESSAGES} messages` };
  }

  session.followUpMessages.push({
    role,
    content: (message || '').slice(0, 1000), // Cap per-message
    timestamp: new Date().toISOString(),
  });

  // Reset timeout — user is still typing
  if (session.timeoutHandle) {
    clearTimeout(session.timeoutHandle);
  }
  session.timeoutHandle = setTimeout(() => {
    if (session.status === 'open') {
      finalizeSession(sessionId);
    }
  }, SESSION_TIMEOUT_MS);
  if (session.timeoutHandle.unref) session.timeoutHandle.unref();

  return {
    status: 'appended',
    messageCount: session.followUpMessages.length,
    sessionId,
  };
}

/**
 * Finalize a session — collect all follow-up messages and re-infer the lesson.
 * Called automatically after timeout, or manually when assistant responds.
 */
function finalizeSession(sessionId) {
  const session = activeSessions.get(sessionId);
  if (!session) {
    return { status: 'not_found' };
  }
  if (session.status !== 'open') {
    return { status: 'already_finalized', finalizedAt: session.finalizedAt };
  }

  // Clear timeout
  if (session.timeoutHandle) {
    clearTimeout(session.timeoutHandle);
    session.timeoutHandle = null;
  }

  session.status = 'finalized';
  session.finalizedAt = new Date().toISOString();

  // Build the enriched context from follow-up messages
  const followUpText = session.followUpMessages
    .filter(m => m.role === 'user')
    .map(m => m.content)
    .join('\n');

  const enrichedContext = session.initialContext
    ? `${session.initialContext}\n\nFollow-up:\n${followUpText}`
    : followUpText;

  // Extract specific complaints/corrections from follow-ups
  const complaints = extractComplaints(session.followUpMessages);

  const result = {
    status: 'finalized',
    sessionId,
    feedbackEventId: session.feedbackEventId,
    signal: session.signal,
    enrichedContext,
    followUpMessages: session.followUpMessages,
    followUpCount: session.followUpMessages.length,
    complaints,
    duration: new Date(session.finalizedAt) - new Date(session.openedAt),
    openedAt: session.openedAt,
    finalizedAt: session.finalizedAt,
  };

  // Persist to disk for durability
  try {
    persistSession(result);
  } catch (_err) { /* non-critical */ }

  // Clean up from active sessions after a delay (allow reads)
  const cleanupTimer = setTimeout(() => activeSessions.delete(sessionId), 5000);
  if (cleanupTimer.unref) cleanupTimer.unref();

  return result;
}

/**
 * Extract specific complaints/corrections from follow-up messages.
 * These are the actual lesson content.
 */
function extractComplaints(messages) {
  const complaints = [];

  for (const msg of messages) {
    if (msg.role !== 'user') continue;
    const content = msg.content || '';

    const patterns = [
      { regex: /you (?:lied|lying) (?:about|to me about)\s+(.{5,200})/gi, type: 'dishonesty' },
      { regex: /you (?:didn't|did not|forgot to|failed to|never)\s+(.{5,200})/gi, type: 'omission' },
      { regex: /you (?:broke|ruined|messed up|screwed up)\s+(.{5,200})/gi, type: 'damage' },
      { regex: /(?:wrong|incorrect|bad|terrible|stupid)\s+(.{5,200})/gi, type: 'quality' },
      { regex: /(?:I said|I told you|I asked you to)\s+(.{5,200})/gi, type: 'ignored-instruction' },
      { regex: /(?:don't|do not|never|stop)\s+(.{5,200})/gi, type: 'constraint' },
      { regex: /(?:should have|should've|why didn't you)\s+(.{5,200})/gi, type: 'missed-expectation' },
      { regex: /(?:too slow|took too long|waste of time|5 minutes)\s*(.{0,200})/gi, type: 'performance' },
    ];

    for (const p of patterns) {
      for (const match of content.matchAll(p.regex)) {
        complaints.push({
          type: p.type,
          detail: match[1].trim().slice(0, 200),
          source: content.slice(0, 100),
          timestamp: msg.timestamp,
        });
      }
    }

    // If no pattern matched but message is clearly a complaint, capture it raw
    if (complaints.length === 0 && /[!?]{2,}|fuck|shit|stupid|terrible|wrong|bad|lied/.test(content)) {
      complaints.push({
        type: 'general-frustration',
        detail: content.slice(0, 200),
        source: content.slice(0, 100),
        timestamp: msg.timestamp,
      });
    }
  }

  return complaints;
}

/**
 * Get an active session by ID
 */
function getSession(sessionId) {
  return activeSessions.get(sessionId) || null;
}

/**
 * Get the most recent open session (if any)
 */
function getActiveSession() {
  for (const [, session] of activeSessions) {
    if (session.status === 'open') return session;
  }
  return null;
}

/**
 * Persist finalized session to disk
 */
function persistSession(result) {
  const { getFeedbackPaths, appendJSONL } = require('./feedback-loop');
  const paths = getFeedbackPaths();
  const sessionLogPath = path.join(path.dirname(paths.FEEDBACK_LOG_PATH), 'feedback-sessions.jsonl');
  appendJSONL(sessionLogPath, result);
}

module.exports = {
  openSession,
  appendToSession,
  finalizeSession,
  getSession,
  getActiveSession,
  extractComplaints,
  SESSION_TIMEOUT_MS,
  MAX_FOLLOWUP_MESSAGES,
  // For testing
  _activeSessions: activeSessions,
};
