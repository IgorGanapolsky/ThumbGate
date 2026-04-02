#!/usr/bin/env node
'use strict';

/**
 * Statusline helper for most recent lesson.
 * Called by statusline.sh — outputs JSON for the shell to consume.
 */

const { getStatusbarLessonData } = require('./lesson-inference');

try {
  const data = getStatusbarLessonData();
  process.stdout.write(JSON.stringify(data));
} catch (e) {
  process.stdout.write(JSON.stringify({ hasLesson: false, text: null, lessonId: null, error: e.message }));
}
