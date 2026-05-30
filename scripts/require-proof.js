#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function hasSessionAction(actionId) {
  const path_ = path.join(process.env.HOME || '/tmp', '.thumbgate', 'session-actions.json');
  if (!fs.existsSync(path_)) return false;
  try {
    const actions = JSON.parse(fs.readFileSync(path_, 'utf8'));
    return Boolean(actions[actionId]);
  } catch { return false; }
}

function run() {
  const stagedFiles = execSync('git diff --cached --name-only', { encoding: 'utf8' }).split('\n').filter(Boolean);
  const sourceChanged = stagedFiles.some(f => f.includes('scripts/') || f.includes('adapters/') || (f.endsWith('.js') && !f.includes('test')));
  
  if (sourceChanged && !hasSessionAction('tests_passed')) {
    console.error('✗ THUMBGATE ERROR: Completion evidence missing.');
    process.exit(1);
  }
  console.log('✓ ThumbGate: completion evidence verified');
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  run();
}
