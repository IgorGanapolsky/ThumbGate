#!/usr/bin/env node
'use strict';

const path = require('path');
const {
  listFeedbackArtifactPaths,
  resolveFeedbackDir,
  resolveProjectDir,
} = require('./feedback-paths');

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map((value) => path.resolve(value)))];
}

function getStatuslineCacheCandidates(options = {}) {
  const env = options.env || process.env;
  const projectDir = resolveProjectDir({ cwd: options.cwd, env });
  const feedbackDir = resolveFeedbackDir({ projectDir, env });

  return unique([
    ...listFeedbackArtifactPaths('statusline_cache.json', { projectDir, env }),
    path.join(feedbackDir, 'statusline_cache.json'),
  ]);
}

if (require.main === module) {
  process.stdout.write(JSON.stringify({ candidates: getStatuslineCacheCandidates() }));
}

module.exports = { getStatuslineCacheCandidates };
