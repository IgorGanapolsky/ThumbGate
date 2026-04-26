'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const GUIDE_HTML = fs.readFileSync(path.join(ROOT, 'public', 'guide.html'), 'utf8');

test('guide keeps proof-backed conversion links close to the install path', () => {
  assert.match(GUIDE_HTML, /Commercial Truth/);
  assert.match(GUIDE_HTML, /docs\/COMMERCIAL_TRUTH\.md/);
  assert.match(GUIDE_HTML, /Verification Evidence/);
  assert.match(GUIDE_HTML, /proof\/automation\/report\.json/);
});

test('guide explains when to use Pro versus the workflow hardening sprint', () => {
  assert.match(GUIDE_HTML, /Workflow Hardening Sprint/i);
  assert.match(GUIDE_HTML, /one workflow, one owner, and one repeated failure/i);
  assert.match(GUIDE_HTML, /Get Pro — \$19\/mo or \$149\/yr/);
  assert.match(GUIDE_HTML, /#workflow-sprint-intake/);
});
