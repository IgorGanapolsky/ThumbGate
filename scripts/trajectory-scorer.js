#!/usr/bin/env node
'use strict';

/**
 * Trajectory Scorer — Strategic Drift Detection.
 *
 * Measures the "Semantic Distance" between the original user intent 
 * (from primer.md) and the current set of changed files.
 *
 * If the agent modifies too many unrelated files, it triggers a safety block.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getTrajectoryScore(options = {}) {
  const projectRoot = options.projectRoot || process.cwd();
  const primerPath = path.join(projectRoot, 'primer.md');

  if (!fs.existsSync(primerPath)) return { score: 0, drift: false };

  const intent = fs.readFileSync(primerPath, 'utf8').toLowerCase();
  
  // Get currently modified files (unstaged + staged)
  let changedFiles = [];
  try {
    const output = execSync('git diff --name-only HEAD', { cwd: projectRoot, encoding: 'utf8' });
    changedFiles = output.split('\n').filter(f => f.trim());
  } catch {
    return { score: 0, drift: false };
  }

  if (changedFiles.length === 0) return { score: 0, drift: false };

  // Calculate drift: How many changed files are NOT mentioned in the intent?
  let driftCount = 0;
  for (const file of changedFiles) {
    const base = path.basename(file).toLowerCase();
    if (!intent.includes(base)) {
      driftCount++;
    }
  }

  const driftRatio = driftCount / changedFiles.length;
  const isDrifting = driftRatio > 0.6 && changedFiles.length > 3;

  return {
    score: Number((1 - driftRatio).toFixed(2)),
    changedCount: changedFiles.length,
    driftCount,
    isDrifting,
    message: isDrifting 
      ? `🚫 THUMBGATE: Strategic Drift Detected. You have modified ${changedFiles.length} files, but ${driftCount} of them were not mentioned in the original intent. Please refocus or update the intent.`
      : null
  };
}

module.exports = {
  getTrajectoryScore
};
