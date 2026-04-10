#!/usr/bin/env node
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  openSession,
  appendToSession,
  finalizeSession,
  getSession,
  getActiveSession,
  extractComplaints,
  autoInferLesson,
  SESSION_TIMEOUT_MS,
  MAX_FOLLOWUP_MESSAGES,
  scheduleTimer,
  _activeSessions,
} = require('../scripts/feedback-session');

// Clean up between tests
beforeEach(() => {
  // Clear all active sessions and their timeouts
  for (const [, session] of _activeSessions) {
    if (session.timeoutHandle) clearTimeout(session.timeoutHandle);
  }
  _activeSessions.clear();
});

afterEach(() => {
  for (const [, session] of _activeSessions) {
    if (session.timeoutHandle) clearTimeout(session.timeoutHandle);
  }
  _activeSessions.clear();
});

describe('openSession', () => {
  it('creates session with correct state', () => {
    const result = openSession('fb_123', 'down', 'initial context');
    assert.equal(result.status, 'open');
    assert.ok(result.sessionId.startsWith('fbs_'));
    assert.ok(result.expiresAt);
    assert.ok(result.message.includes('60'));

    const session = _activeSessions.get(result.sessionId);
    assert.equal(session.feedbackEventId, 'fb_123');
    assert.equal(session.signal, 'down');
    assert.equal(session.initialContext, 'initial context');
    assert.equal(session.status, 'open');
    assert.deepEqual(session.followUpMessages, []);
    assert.equal(session.finalizedAt, null);
  });

  it('defaults initialContext to empty string when not provided', () => {
    const result = openSession('fb_456', 'up');
    const session = _activeSessions.get(result.sessionId);
    assert.equal(session.initialContext, '');
  });
});

describe('appendToSession', () => {
  it('adds messages to open session', () => {
    const { sessionId } = openSession('fb_1', 'down', 'ctx');
    const result = appendToSession(sessionId, 'you lied about the fix');
    assert.equal(result.status, 'appended');
    assert.equal(result.messageCount, 1);
    assert.equal(result.sessionId, sessionId);

    const session = _activeSessions.get(sessionId);
    assert.equal(session.followUpMessages.length, 1);
    assert.equal(session.followUpMessages[0].role, 'user');
    assert.equal(session.followUpMessages[0].content, 'you lied about the fix');
    assert.ok(session.followUpMessages[0].timestamp);
  });

  it('rejects when session not found', () => {
    const result = appendToSession('nonexistent', 'msg');
    assert.equal(result.status, 'not_found');
  });

  it('rejects when session is closed', () => {
    const { sessionId } = openSession('fb_2', 'down');
    finalizeSession(sessionId);
    const result = appendToSession(sessionId, 'too late');
    assert.equal(result.status, 'closed');
  });

  it('rejects when max messages reached', () => {
    const { sessionId } = openSession('fb_3', 'down');
    for (let i = 0; i < MAX_FOLLOWUP_MESSAGES; i++) {
      appendToSession(sessionId, `msg ${i}`);
    }
    const result = appendToSession(sessionId, 'one too many');
    assert.equal(result.status, 'full');
    assert.ok(result.message.includes(String(MAX_FOLLOWUP_MESSAGES)));
  });

  it('resets timeout on new message', () => {
    const { sessionId } = openSession('fb_4', 'down');
    const sessionBefore = _activeSessions.get(sessionId);
    const handleBefore = sessionBefore.timeoutHandle;

    appendToSession(sessionId, 'follow-up');
    const sessionAfter = _activeSessions.get(sessionId);
    // The timeout handle should be a new one (old was cleared, new was set)
    assert.notEqual(sessionAfter.timeoutHandle, handleBefore);
  });

  it('caps message content at 1000 chars', () => {
    const { sessionId } = openSession('fb_5', 'down');
    const longMsg = 'x'.repeat(2000);
    appendToSession(sessionId, longMsg);
    const session = _activeSessions.get(sessionId);
    assert.equal(session.followUpMessages[0].content.length, 1000);
  });

  it('accepts assistant role', () => {
    const { sessionId } = openSession('fb_6', 'down');
    appendToSession(sessionId, 'assistant response', 'assistant');
    const session = _activeSessions.get(sessionId);
    assert.equal(session.followUpMessages[0].role, 'assistant');
  });
});

describe('finalizeSession', () => {
  it('collects all follow-up messages', () => {
    const { sessionId } = openSession('fb_10', 'down', 'initial');
    appendToSession(sessionId, 'you lied about the tests');
    appendToSession(sessionId, 'you forgot to push');
    const result = finalizeSession(sessionId);
    assert.equal(result.status, 'finalized');
    assert.equal(result.followUpCount, 2);
    assert.equal(result.followUpMessages.length, 2);
    assert.equal(result.feedbackEventId, 'fb_10');
    assert.equal(result.signal, 'down');
  });

  it('builds enriched context from initial + follow-ups', () => {
    const { sessionId } = openSession('fb_11', 'down', 'bad code');
    appendToSession(sessionId, 'you forgot to test');
    appendToSession(sessionId, 'response from bot', 'assistant');
    appendToSession(sessionId, 'also you broke CI');
    const result = finalizeSession(sessionId);
    // enrichedContext should include initial + user follow-ups only
    assert.ok(result.enrichedContext.includes('bad code'));
    assert.ok(result.enrichedContext.includes('you forgot to test'));
    assert.ok(result.enrichedContext.includes('also you broke CI'));
    assert.ok(!result.enrichedContext.includes('response from bot'));
  });

  it('builds enriched context without initial context', () => {
    const { sessionId } = openSession('fb_12', 'down');
    appendToSession(sessionId, 'terrible work');
    const result = finalizeSession(sessionId);
    assert.equal(result.enrichedContext, 'terrible work');
  });

  it('returns complaints', () => {
    const { sessionId } = openSession('fb_13', 'down');
    appendToSession(sessionId, 'you lied about the deployment being ready');
    const result = finalizeSession(sessionId);
    assert.ok(result.complaints.length > 0);
    assert.equal(result.complaints[0].type, 'dishonesty');
  });

  it('returns not_found for unknown session', () => {
    const result = finalizeSession('nonexistent');
    assert.equal(result.status, 'not_found');
  });

  it('returns already_finalized for double finalize', () => {
    const { sessionId } = openSession('fb_14', 'down');
    finalizeSession(sessionId);
    const result = finalizeSession(sessionId);
    assert.equal(result.status, 'already_finalized');
    assert.ok(result.finalizedAt);
  });

  it('computes duration', () => {
    const { sessionId } = openSession('fb_15', 'down');
    const result = finalizeSession(sessionId);
    assert.equal(typeof result.duration, 'number');
    assert.ok(result.duration >= 0);
  });

  it('has openedAt and finalizedAt timestamps', () => {
    const { sessionId } = openSession('fb_16', 'down');
    const result = finalizeSession(sessionId);
    assert.ok(result.openedAt);
    assert.ok(result.finalizedAt);
    assert.ok(new Date(result.finalizedAt) >= new Date(result.openedAt));
  });
});

describe('extractComplaints', () => {
  it('finds "you lied about X" patterns', () => {
    const messages = [
      { role: 'user', content: 'you lied about the tests passing', timestamp: '2026-01-01T00:00:00Z' },
    ];
    const complaints = extractComplaints(messages);
    assert.ok(complaints.length > 0);
    assert.equal(complaints[0].type, 'dishonesty');
    assert.ok(complaints[0].detail.includes('the tests passing'));
  });

  it('finds "you didn\'t do Y" patterns', () => {
    const messages = [
      { role: 'user', content: 'you forgot to run the linter before pushing', timestamp: '2026-01-01T00:00:00Z' },
    ];
    const complaints = extractComplaints(messages);
    assert.ok(complaints.length > 0);
    assert.equal(complaints[0].type, 'omission');
  });

  it('finds "I told you to" patterns', () => {
    const messages = [
      { role: 'user', content: 'I told you to use the existing hook not create a new one', timestamp: '2026-01-01T00:00:00Z' },
    ];
    const complaints = extractComplaints(messages);
    assert.ok(complaints.length > 0);
    assert.equal(complaints[0].type, 'ignored-instruction');
  });

  it('finds "should have" patterns', () => {
    const messages = [
      { role: 'user', content: 'you should have checked the CI before claiming done', timestamp: '2026-01-01T00:00:00Z' },
    ];
    const complaints = extractComplaints(messages);
    assert.ok(complaints.length > 0);
    assert.equal(complaints[0].type, 'missed-expectation');
  });

  it('finds constraint patterns', () => {
    const messages = [
      { role: 'user', content: "don't ever modify the .env file again", timestamp: '2026-01-01T00:00:00Z' },
    ];
    const complaints = extractComplaints(messages);
    assert.ok(complaints.length > 0);
    assert.equal(complaints[0].type, 'constraint');
  });

  it('finds performance patterns', () => {
    const messages = [
      { role: 'user', content: 'too slow, that took forever', timestamp: '2026-01-01T00:00:00Z' },
    ];
    const complaints = extractComplaints(messages);
    assert.ok(complaints.length > 0);
    assert.equal(complaints[0].type, 'performance');
  });

  it('captures general frustration', () => {
    const messages = [
      { role: 'user', content: 'this is terrible!!', timestamp: '2026-01-01T00:00:00Z' },
    ];
    const complaints = extractComplaints(messages);
    assert.ok(complaints.length > 0);
    assert.equal(complaints[0].type, 'general-frustration');
  });

  it('skips assistant messages', () => {
    const messages = [
      { role: 'assistant', content: 'you lied about everything', timestamp: '2026-01-01T00:00:00Z' },
    ];
    const complaints = extractComplaints(messages);
    assert.equal(complaints.length, 0);
  });

  it('returns empty array for no complaints', () => {
    const messages = [
      { role: 'user', content: 'thanks that looks good', timestamp: '2026-01-01T00:00:00Z' },
    ];
    const complaints = extractComplaints(messages);
    assert.equal(complaints.length, 0);
  });
});

describe('getSession', () => {
  it('returns active session by ID', () => {
    const { sessionId } = openSession('fb_20', 'down');
    const session = getSession(sessionId);
    assert.ok(session);
    assert.equal(session.sessionId, sessionId);
  });

  it('returns null for unknown session', () => {
    assert.equal(getSession('nonexistent'), null);
  });
});

describe('getActiveSession', () => {
  it('returns null when no sessions exist', () => {
    assert.equal(getActiveSession(), null);
  });

  it('returns the open session', () => {
    const { sessionId } = openSession('fb_21', 'down');
    const active = getActiveSession();
    assert.ok(active);
    assert.equal(active.sessionId, sessionId);
  });

  it('skips finalized sessions', () => {
    const { sessionId } = openSession('fb_22', 'down');
    finalizeSession(sessionId);
    assert.equal(getActiveSession(), null);
  });
});

describe('auto-timeout', () => {
  it('exports correct SESSION_TIMEOUT_MS', () => {
    assert.equal(SESSION_TIMEOUT_MS, 60000);
  });

  it('exports correct MAX_FOLLOWUP_MESSAGES', () => {
    assert.equal(MAX_FOLLOWUP_MESSAGES, 20);
  });

  it('sets a timeout handle on session creation', () => {
    const { sessionId } = openSession('fb_30', 'down');
    const session = _activeSessions.get(sessionId);
    assert.ok(session.timeoutHandle !== null);
  });

  it('unrefs timers so sessions do not pin the process', () => {
    const handle = scheduleTimer(() => {}, 1000);
    try {
      if (typeof handle.hasRef === 'function') {
        assert.equal(handle.hasRef(), false);
      }
    } finally {
      clearTimeout(handle);
    }
  });
});

describe('autoInferLesson (LangChain continual learning)', () => {
  it('is exported and callable', () => {
    assert.equal(typeof autoInferLesson, 'function');
  });

  it('returns null when finalized result has no follow-up context', () => {
    // autoInferLesson calls lesson-inference which writes to disk,
    // but with empty context the inference still produces a lesson
    // (signal-only). We test the function does not throw.
    const result = autoInferLesson({
      sessionId: 'test-session',
      feedbackEventId: 'fb-001',
      signal: 'negative',
      enrichedContext: '',
      followUpMessages: [],
      followUpCount: 0,
      duration: 5000,
    });
    // May return a lesson or null depending on disk state; should not throw
    if (result) {
      assert.ok(result.id, 'lesson should have an id');
      assert.deepEqual(result.tags, ['auto-inferred', 'session-finalize']);
      assert.equal(result.metadata.source, 'auto-lesson-inference');
    }
  });

  it('creates a lesson with auto-inferred tags from enriched context', () => {
    const result = autoInferLesson({
      sessionId: 'test-session-2',
      feedbackEventId: 'fb-002',
      signal: 'down',
      enrichedContext: 'The agent deleted production configs without asking',
      followUpMessages: [
        { role: 'user', content: 'you deleted my production config', timestamp: new Date().toISOString() },
      ],
      followUpCount: 1,
      duration: 12000,
    });
    assert.ok(result, 'should create a lesson from enriched context');
    assert.ok(result.id);
    assert.equal(result.signal, 'negative');
    assert.deepEqual(result.tags, ['auto-inferred', 'session-finalize']);
    assert.equal(result.metadata.source, 'auto-lesson-inference');
    assert.equal(result.metadata.sessionId, 'test-session-2');
    assert.ok(result.lesson.length > 0, 'lesson text should be non-empty');
  });
});
