#!/usr/bin/env node
'use strict';

const path = require('path');
const os = require('os');
const {
  getAggregateStatuslineCachePath,
  shouldAggregateFeedback,
} = require('./feedback-aggregate');
const {
  listFeedbackArtifactPaths,
  resolveFeedbackDir,
  resolveProjectDir,
} = require('./feedback-paths');

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map((value) => path.resolve(value)))];
}

function hasIsolatedTempFeedbackDir(env = process.env) {
  if (!env.THUMBGATE_FEEDBACK_DIR) return false;
  try {
    return path.resolve(env.THUMBGATE_FEEDBACK_DIR).startsWith(path.resolve(os.tmpdir()) + path.sep);
  } catch {
    return false;
  }
}

function getStatuslineCacheCandidates(options = {}) {
  const env = options.env || process.env;
  const projectDir = resolveProjectDir({ cwd: options.cwd, env });
  const feedbackDir = resolveFeedbackDir({ projectDir, env });

  return unique([
    shouldAggregateFeedback({ env }) && !hasIsolatedTempFeedbackDir(env) && getAggregateStatuslineCachePath({ env }),
    ...listFeedbackArtifactPaths('statusline_cache.json', { projectDir, env }),
    path.join(feedbackDir, 'statusline_cache.json'),
  ]);
}

if (require.main === module) {
  process.stdout.write(JSON.stringify({ candidates: getStatuslineCacheCandidates() }));
}

module.exports = { getStatuslineCacheCandidates };
