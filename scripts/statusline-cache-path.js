#!/usr/bin/env node
'use strict';

const path = require('path');
const { resolveFeedbackDir } = require('./feedback-paths');

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map((value) => path.resolve(value)))];
}

function getStatuslineCacheCandidates(options = {}) {
  const cwd = options.cwd || process.cwd();
  const home = options.home || process.env.HOME || process.env.USERPROFILE || '';
  const feedbackDir = resolveFeedbackDir({ cwd, env: options.env || process.env });

  return unique([
    path.join(feedbackDir, 'statusline_cache.json'),
    path.join(cwd, '.thumbgate', 'statusline_cache.json'),
    home ? path.join(home, '.thumbgate', 'statusline_cache.json') : null,
  ]);
}

if (require.main === module) {
  process.stdout.write(JSON.stringify({ candidates: getStatuslineCacheCandidates() }));
}

module.exports = { getStatuslineCacheCandidates };
