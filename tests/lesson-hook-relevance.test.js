'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  estimateTokens,
  isRawTranscriptFragment,
  lessonMatchesToolCall,
  selectInjectableLessons,
  formatInjectableReminder,
  MAX_INJECTED_LESSONS,
  MAX_INJECTED_TOKENS,
  LESSON_REPEAT_MS,
} = require('../scripts/lesson-hook-relevance');
const { distillFeedbackHistory } = require('../scripts/feedback-history-distiller');

const thumbgateLesson = {
  id: 'lesson-billing',
  title: 'Do not redirect a blocked confirm to the Payment Link',
  whatToChange: 'Return 403 from scripts/billing.js when createCheckoutSession sees a fixture email.',
  tags: ['bash', 'billing'],
  metadata: { toolsUsed: ['Bash'], project: 'thumbgate' },
  scope: { projectId: 'thumbgate' },
};

const otherRepoLesson = {
  id: 'lesson-psn',
  title: 'StockService query',
  whatToChange: 'Run the Helix query in Eci.Psn.StockService before changing the document count.',
  tags: ['bash', 'repo:eci.psn.stockservice'],
  metadata: { toolsUsed: ['Bash'], project: 'Eci.Psn.StockService' },
  scope: { projectId: 'Eci.Psn.StockService' },
};

test('a lesson is injected only when the tool, path term, and repo match', () => {
  const call = {
    toolName: 'Bash',
    actionContext: 'node --test tests/checkout-no-live-probe.test.js',
    project: 'thumbgate',
  };
  assert.equal(lessonMatchesToolCall(thumbgateLesson, {
    ...call,
    actionContext: 'node scripts/billing.js --check',
  }), true);
  assert.equal(lessonMatchesToolCall(otherRepoLesson, {
    toolName: 'Bash',
    actionContext: 'node scripts/billing.js --check',
    project: 'thumbgate',
  }), false);
  assert.equal(lessonMatchesToolCall(thumbgateLesson, {
    toolName: 'Read',
    actionContext: 'scripts/billing.js',
    project: 'thumbgate',
  }), false);
  assert.equal(lessonMatchesToolCall(thumbgateLesson, {
    toolName: 'Bash',
    actionContext: 'echo hello',
    project: 'thumbgate',
  }), false);
});

test('transcript fragments are never injected and capture stops producing them', () => {
  assert.equal(isRawTranscriptFragment('<task-notification> ignored'), true);
  assert.equal(isRawTranscriptFragment('<pasted_content> secret'), true);
  assert.equal(isRawTranscriptFragment('It ignored a prior instruction: <task-notification>'), true);
  const fragment = {
    id: 'fragment',
    whatToChange: 'It ignored a prior instruction: <task-notification>',
    tags: ['bash', 'billing'],
    metadata: { toolsUsed: ['Bash'] },
    scope: { projectId: 'thumbgate' },
  };
  assert.equal(lessonMatchesToolCall(fragment, {
    toolName: 'Bash',
    actionContext: 'node scripts/billing.js',
    project: 'thumbgate',
  }), false);

  const distilled = distillFeedbackHistory({
    signal: 'negative',
    chatHistory: [
      { author: 'user', text: '<task-notification> do not ignore this' },
      { author: 'user', text: '<pasted_content> never do that' },
    ],
  });
  assert.equal(distilled.lessonProposal, null);
  assert.equal(distilled.usedHistory, false);
});

test('nothing matches means no reminder and no hot-risk filler', () => {
  const selected = selectInjectableLessons([otherRepoLesson], {
    toolName: 'Bash',
    actionContext: 'node scripts/billing.js',
    project: 'thumbgate',
    sessionId: '',
    record: false,
  });
  assert.deepEqual(selected, []);
  assert.equal(formatInjectableReminder(selected), '');
  assert.doesNotMatch(formatInjectableReminder([]), /HOT RISK SIGNALS/);
});

test('injection is capped at two lessons and 150 tokens, and a lesson repeats only after 30 minutes', () => {
  const lessons = [1, 2, 3].map((n) => ({
    id: `lesson-${n}`,
    whatToChange: `Fix scripts/billing.js path ${n} ${'detail '.repeat(40)}`,
    tags: ['bash'],
    metadata: { toolsUsed: ['Bash'] },
    scope: { projectId: 'thumbgate' },
  }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-hook-relevance-'));
  const first = selectInjectableLessons(lessons, {
    toolName: 'Bash',
    actionContext: 'node scripts/billing.js',
    project: 'thumbgate',
    sessionId: 'sess-relevance',
    seenDir: dir,
    now: 1_000,
  });
  assert.equal(first.length, MAX_INJECTED_LESSONS);
  const reminder = formatInjectableReminder(first);
  assert.ok(estimateTokens(reminder) <= MAX_INJECTED_TOKENS, `reminder is ${estimateTokens(reminder)} tokens`);
  assert.doesNotMatch(reminder, /HOT RISK SIGNALS/);

  const repeated = selectInjectableLessons(lessons, {
    toolName: 'Bash',
    actionContext: 'node scripts/billing.js',
    project: 'thumbgate',
    sessionId: 'sess-relevance',
    seenDir: dir,
    now: 1_000 + LESSON_REPEAT_MS - 1,
  });
  assert.ok(repeated.every((lesson) => lesson.id === 'lesson-3'));
  assert.ok(!repeated.some((lesson) => lesson.id === 'lesson-1' || lesson.id === 'lesson-2'));

  const later = selectInjectableLessons(lessons, {
    toolName: 'Bash',
    actionContext: 'node scripts/billing.js',
    project: 'thumbgate',
    sessionId: 'sess-relevance',
    seenDir: dir,
    now: 1_000 + LESSON_REPEAT_MS,
  });
  assert.equal(later.length, MAX_INJECTED_LESSONS);
});
