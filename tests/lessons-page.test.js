'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const lessonsPage = fs.readFileSync(path.join(__dirname, '..', 'public', 'lessons.html'), 'utf8');

test('lessons page uses defensible live-metric language', () => {
  assert.match(lessonsPage, /Actions Blocked/i);
  assert.match(lessonsPage, /Recorded gate denies, not inferred repeats/i);
  assert.match(lessonsPage, /Improvement Over Time/i);
  assert.match(lessonsPage, /Recent Feedback \+ Gate Activity/i);
  assert.match(lessonsPage, /Fast path rate/i);
  assert.match(lessonsPage, /Override rate/i);
  assert.match(lessonsPage, /Rollback rate/i);
  assert.match(lessonsPage, /recorded evaluations and outcomes/i);
  assert.match(lessonsPage, /Gate deny/i);
  assert.match(lessonsPage, /Gate warn/i);
  assert.match(lessonsPage, /The chart combines recorded feedback events with daily gate-audit activity\. Decision-loop metrics above come from recorded evaluations and outcomes/i);
  assert.doesNotMatch(lessonsPage, /Mistakes Prevented/i);
  assert.doesNotMatch(lessonsPage, /Most Effective Rules/i);
});

test('lessons share-feedback dialog asks for a reason before submit', () => {
  const { FEEDBACK_REASONS } = require('../scripts/product-feedback');
  assert.match(lessonsPage, /id="feedbackTitle">Share feedback</);
  assert.match(lessonsPage, /id="feedbackSubmit"[^>]*disabled/);
  assert.match(lessonsPage, /placeholder="Share details \(optional\)"/);
  assert.doesNotMatch(lessonsPage, /feedbackCategory/);
  assert.doesNotMatch(lessonsPage, /Useful autonomy|Fast and efficient|Followed my instructions|Good code \/ output quality/);
  for (const reason of FEEDBACK_REASONS) {
    assert.match(lessonsPage, new RegExp(`data-reason="${reason.id}"`));
    assert.match(lessonsPage, new RegExp(`\\+ ${reason.label}`));
  }
  assert.match(lessonsPage, /unless Other is the only reason/);
  assert.match(lessonsPage, /function feedbackDetail\(\)/);
  assert.match(lessonsPage, /var feedbackSubmitPending = false/);
  assert.match(lessonsPage, /var ready = !feedbackSubmitPending/);
  assert.match(lessonsPage, /var feedbackOpener = null/);
});
