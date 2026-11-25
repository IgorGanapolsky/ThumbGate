#!/usr/bin/env node
'use strict';
// REQ-08: print the rules that are active on a fresh install, before any thumbs-down.
// Reads the shipped default gate file only (read-only). Usage: node scripts/default-rules-report.js
const fs = require('fs');
const path = require('path');

const { execSync } = require('child_process');

const file = path.join(__dirname, '..', 'config', 'gates', 'default.json');

// Label the counts with the revision they came from, so a saved report is not mistaken for the current file.
function sourceRevision() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: path.dirname(file), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (_) {
    return 'unknown';
  }
}
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const gates = Array.isArray(raw) ? raw : (raw.gates || []);
const tally = {};
console.log(`source: config/gates/default.json at ${sourceRevision()}`);
console.log('id | action | severity');
for (const g of gates) {
  const a = g.action || g.mode || 'unspecified';
  tally[a] = (tally[a] || 0) + 1;
  console.log(`${g.id} | ${a} | ${g.severity || '-'}`);
}
console.log(`total shipped rules: ${gates.length}; by action: ${JSON.stringify(tally)}`);
