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
  assert.match(lessonsPage, /Gate deny/i);
  assert.match(lessonsPage, /Gate warn/i);
  assert.match(lessonsPage, /The chart combines recorded feedback events with daily gate-audit activity/i);
  assert.doesNotMatch(lessonsPage, /Mistakes Prevented/i);
  assert.doesNotMatch(lessonsPage, /Most Effective Rules/i);
});
