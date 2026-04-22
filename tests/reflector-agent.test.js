#!/usr/bin/env node
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Isolate these unit tests from the developer's real feedback DB.
// `checkRecurrence` → `retrieveWithRerankingSync` → `retrieveRelevantLessons`
// reads `memory-log.jsonl` under the resolved feedback dir. When the dev
// machine has real lessons, assertions that expect zero matches flip. Pin
// THUMBGATE_FEEDBACK_DIR to a fresh empty tmpdir for the lifetime of this
// file so the tests exercise the pure logic under a deterministic DB state.
const TMP_FEEDBACK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-reflector-'));
const PRIOR_FEEDBACK_DIR = process.env.THUMBGATE_FEEDBACK_DIR;
process.env.THUMBGATE_FEEDBACK_DIR = TMP_FEEDBACK_DIR;

// We test the pure functions directly — they don't call lesson-retrieval internally
// except checkRecurrence, which we test with its try/catch fallback behavior
const {
  reflect,
  analyzeConversation,
  checkRecurrence,
  generateProposedRule,
  formatReflectionMessage,
} = require('../scripts/reflector-agent');

// --- Test data ---

const conversationWithCorrection = [
  { role: 'user', content: 'Fix the login bug in src/features/auth/login.tsx' },
  { role: 'assistant', content: 'I\'ll edit the file using Edit tool' },
  { role: 'user', content: 'No, don\'t edit the .env file directly. That breaks the auth token.' },
  { role: 'assistant', content: 'Sorry, I\'ll revert that change.' },
];

const conversationWithError = [
  { role: 'user', content: 'Push the changes to develop' },
  { role: 'assistant', content: 'Running Bash(git push origin develop) ... Error: 403 forbidden' },
  { role: 'user', content: 'Wrong. Never push to develop directly.' },
];

const conversationMinimal = [
  { role: 'user', content: 'Do the thing' },
  { role: 'assistant', content: 'Done.' },
];

const emptyConversation = [];

// --- Tests ---

describe('reflector-agent', () => {

  after(() => {
    if (PRIOR_FEEDBACK_DIR === undefined) {
      delete process.env.THUMBGATE_FEEDBACK_DIR;
    } else {
      process.env.THUMBGATE_FEEDBACK_DIR = PRIOR_FEEDBACK_DIR;
    }
    try { fs.rmSync(TMP_FEEDBACK_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  describe('reflect()', () => {
    it('returns reflection_complete with conversation window + negative signal', () => {
      const result = reflect({
        conversationWindow: conversationWithCorrection,
        context: 'editing auth files',
        whatWentWrong: 'Edited .env directly',
        structuredRule: null,
        feedbackEvent: { id: 'fb_123' },
      });

      assert.equal(result.status, 'reflection_complete');
      assert.ok(result.analysis);
      assert.ok(result.recurrence);
      assert.ok(result.proposedRule);
      assert.ok(result.severity);
      assert.ok(result.message);
    });

    it('returns info severity on first occurrence (no matching lessons)', () => {
      const result = reflect({
        conversationWindow: conversationMinimal,
        context: 'test',
        whatWentWrong: 'wrong approach',
        structuredRule: null,
        feedbackEvent: null,
      });

      // With no lesson DB, recurrence check returns 0
      assert.equal(result.severity, 'info');
      assert.equal(result.recurrence.isRecurring, false);
    });

    it('includes proposedRule with user-correction source when corrections detected', () => {
      const result = reflect({
        conversationWindow: conversationWithCorrection,
        context: 'editing auth',
        whatWentWrong: null,
        structuredRule: null,
        feedbackEvent: null,
      });

      assert.equal(result.proposedRule.source, 'user-correction');
      assert.equal(result.proposedRule.confidence, 0.95);
    });

    it('uses whatWentWrong when no corrections in conversation', () => {
      const result = reflect({
        conversationWindow: conversationMinimal,
        context: 'test',
        whatWentWrong: 'deployed without running tests',
        structuredRule: null,
        feedbackEvent: null,
      });

      assert.equal(result.proposedRule.source, 'user-provided');
      assert.ok(result.proposedRule.rule.includes('deployed without running tests'));
    });
  });

  describe('analyzeConversation()', () => {
    it('extracts corrections from user messages', () => {
      const analysis = analyzeConversation(conversationWithCorrection);
      assert.ok(analysis.corrections.length > 0, 'Should detect corrections');
      assert.ok(analysis.corrections.some(c => c.includes('edit the .env file directly')));
    });

    it('extracts tools used from assistant messages', () => {
      const window = [
        { role: 'assistant', content: 'Running Bash(git status) and using Edit tool on the file' },
      ];
      const analysis = analyzeConversation(window);
      assert.ok(analysis.toolsUsed.length > 0);
    });

    it('extracts file paths from conversation', () => {
      const analysis = analyzeConversation(conversationWithCorrection);
      assert.ok(analysis.filesInvolved.length > 0);
      assert.ok(analysis.filesInvolved.some(f => f.includes('src/features/auth/login.tsx')));
    });

    it('detects error messages', () => {
      const analysis = analyzeConversation(conversationWithError);
      assert.equal(analysis.errorDetected, true);
      assert.ok(analysis.errors.length > 0);
    });

    it('handles empty conversation gracefully', () => {
      const analysis = analyzeConversation(emptyConversation);
      assert.equal(analysis.userIntent, '');
      assert.equal(analysis.assistantAction, '');
      assert.equal(analysis.corrections.length, 0);
      assert.equal(analysis.messageCount, 0);
    });

    it('reports messageCount accurately', () => {
      const analysis = analyzeConversation(conversationWithCorrection);
      assert.equal(analysis.messageCount, 4);
    });

    it('truncates userIntent to 300 chars', () => {
      const longWindow = [
        { role: 'user', content: 'A'.repeat(500) },
        { role: 'assistant', content: 'ok' },
      ];
      const analysis = analyzeConversation(longWindow);
      assert.equal(analysis.userIntent.length, 300);
    });
  });

  describe('checkRecurrence()', () => {
    it('returns zero count when lesson retrieval has no data', () => {
      // With no JSONL data, retrieveRelevantLessons returns empty
      const analysis = analyzeConversation(conversationMinimal);
      const recurrence = checkRecurrence(analysis, null);
      assert.equal(recurrence.count, 0);
      assert.deepEqual(recurrence.previousLessons, []);
    });

    it('gracefully handles errors in lesson retrieval', () => {
      // checkRecurrence wraps in try/catch — even if retrieval throws, it returns empty
      const analysis = { userIntent: '', assistantAction: '', corrections: [], toolsUsed: [] };
      const recurrence = checkRecurrence(analysis, null);
      assert.equal(typeof recurrence.count, 'number');
      assert.ok(Array.isArray(recurrence.previousLessons));
    });
  });

  describe('generateProposedRule()', () => {
    const noRecurrence = { count: 0, previousLessons: [] };

    it('uses user corrections as highest priority (confidence 0.95)', () => {
      const analysis = { corrections: ['edit .env directly'], filesInvolved: [], toolsUsed: [], userIntent: '' };
      const rule = generateProposedRule(analysis, null, noRecurrence, 'broke auth');

      assert.equal(rule.source, 'user-correction');
      assert.equal(rule.confidence, 0.95);
      assert.ok(rule.rule.includes('NEVER'));
      assert.ok(rule.rule.includes('edit .env directly'));
    });

    it('falls back to structured rule when no corrections available', () => {
      const analysis = { corrections: [], filesInvolved: [], toolsUsed: [], userIntent: '' };
      const structuredRule = {
        trigger: { condition: 'editing config files' },
        action: { type: 'avoid', description: 'skip .env modifications' },
        confidence: 0.8,
      };
      const rule = generateProposedRule(analysis, structuredRule, noRecurrence, null);

      assert.equal(rule.source, 'inferred');
      assert.ok(rule.rule.includes('IF'));
      assert.ok(rule.rule.includes('THEN'));
    });

    it('falls back to whatWentWrong when no corrections or structured rule', () => {
      const analysis = { corrections: [], filesInvolved: [], toolsUsed: [], userIntent: '' };
      const rule = generateProposedRule(analysis, null, noRecurrence, 'deployed to prod without tests');

      assert.equal(rule.source, 'user-provided');
      assert.equal(rule.confidence, 0.8);
      assert.ok(rule.rule.includes('AVOID:'));
      assert.ok(rule.rule.includes('deployed to prod'));
    });

    it('falls back to observation as last resort', () => {
      const analysis = { corrections: [], filesInvolved: [], toolsUsed: [], userIntent: 'fix login' };
      const rule = generateProposedRule(analysis, null, noRecurrence, null);

      assert.equal(rule.source, 'conversation-analysis');
      assert.equal(rule.confidence, 0.5);
      assert.ok(rule.rule.includes('Review approach'));
    });

    it('sets project scope when files are involved', () => {
      const analysis = { corrections: ['do X'], filesInvolved: ['src/foo.ts'], toolsUsed: [], userIntent: '' };
      const rule = generateProposedRule(analysis, null, noRecurrence, null);
      assert.equal(rule.scope, 'project');
    });

    it('sets global scope when no files involved', () => {
      const analysis = { corrections: ['do X'], filesInvolved: [], toolsUsed: [], userIntent: '' };
      const rule = generateProposedRule(analysis, null, noRecurrence, null);
      assert.equal(rule.scope, 'global');
    });

    it('includes recurrence info in proposed rule', () => {
      const recurrence = { count: 2, previousLessons: [{ id: 'l1' }, { id: 'l2' }] };
      const analysis = { corrections: [], filesInvolved: [], toolsUsed: [], userIntent: 'test' };
      const rule = generateProposedRule(analysis, null, recurrence, 'mistake');

      assert.equal(rule.isRecurring, true);
      assert.equal(rule.recurrenceCount, 2);
    });

    it('prefers user-correction over structured rule when both available', () => {
      const analysis = { corrections: ['use mock env'], filesInvolved: [], toolsUsed: [], userIntent: '' };
      const structuredRule = {
        trigger: { condition: 'editing config' },
        action: { type: 'avoid', description: 'skip .env' },
        confidence: 0.8,
      };
      const rule = generateProposedRule(analysis, structuredRule, noRecurrence, 'broke things');

      // 0.95 > 0.8, so user-correction wins
      assert.equal(rule.source, 'user-correction');
    });
  });

  describe('formatReflectionMessage()', () => {
    it('includes recurrence count for recurring mistakes', () => {
      const rule = { rule: 'NEVER edit .env' };
      const recurrence = { count: 2, previousLessons: [] };
      const analysis = { corrections: [], filesInvolved: [] };

      const msg = formatReflectionMessage(rule, recurrence, analysis);
      assert.ok(msg.includes('3 time(s)'));
    });

    it('omits recurrence prefix for first-time mistakes', () => {
      const rule = { rule: 'NEVER edit .env' };
      const recurrence = { count: 0, previousLessons: [] };
      const analysis = { corrections: [], filesInvolved: [] };

      const msg = formatReflectionMessage(rule, recurrence, analysis);
      assert.ok(!msg.includes('time(s)'));
    });

    it('includes file context when files are involved', () => {
      const rule = { rule: 'NEVER edit .env' };
      const recurrence = { count: 0, previousLessons: [] };
      const analysis = { corrections: [], filesInvolved: ['src/auth.ts', 'src/config.ts'] };

      const msg = formatReflectionMessage(rule, recurrence, analysis);
      assert.ok(msg.includes('src/auth.ts'));
    });

    it('includes correction text when corrections detected', () => {
      const rule = { rule: 'NEVER push to develop' };
      const recurrence = { count: 0, previousLessons: [] };
      const analysis = { corrections: ['push to develop directly'], filesInvolved: [] };

      const msg = formatReflectionMessage(rule, recurrence, analysis);
      assert.ok(msg.includes('corrected me'));
      assert.ok(msg.includes('push to develop'));
    });

    it('ends with "Correct?" for user confirmation', () => {
      const rule = { rule: 'NEVER do X' };
      const recurrence = { count: 0, previousLessons: [] };
      const analysis = { corrections: [], filesInvolved: [] };

      const msg = formatReflectionMessage(rule, recurrence, analysis);
      assert.ok(msg.includes('Correct?'));
    });
  });

  describe('integration: reflect with all params', () => {
    it('produces complete reflection with structured rule + corrections + whatWentWrong', () => {
      const result = reflect({
        conversationWindow: conversationWithCorrection,
        context: 'editing auth files',
        whatWentWrong: 'Edited .env directly',
        structuredRule: {
          trigger: { condition: 'editing config' },
          action: { type: 'avoid', description: 'skip .env' },
          confidence: 0.75,
        },
        feedbackEvent: { id: 'fb_integration_test' },
      });

      assert.equal(result.status, 'reflection_complete');
      assert.ok(result.proposedRule);
      // User correction should win over structured rule (0.95 > 0.75)
      assert.equal(result.proposedRule.source, 'user-correction');
      assert.ok(result.message.includes('Correct?'));
      assert.ok(result.analysis.filesInvolved.length > 0);
    });

    it('handles null/missing params gracefully', () => {
      const result = reflect({
        conversationWindow: null,
        context: null,
        whatWentWrong: null,
        structuredRule: null,
        feedbackEvent: null,
      });

      assert.equal(result.status, 'reflection_complete');
      assert.ok(result.proposedRule);
      assert.equal(result.proposedRule.source, 'conversation-analysis');
    });
  });
});
