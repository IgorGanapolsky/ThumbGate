const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sprintBriefPath = path.join(__dirname, '..', 'docs', 'WORKFLOW_HARDENING_SPRINT.md');

test('workflow hardening sprint brief stays current, proof-backed, and commercially honest', () => {
  const brief = fs.readFileSync(sprintBriefPath, 'utf8');

  assert.match(brief, /Status: current/i);
  assert.match(brief, /one workflow/i);
  assert.match(brief, /one owner/i);
  assert.match(brief, /one proof review/i);
  assert.match(brief, /pilot-by-request/i);
  assert.match(brief, /igor\.ganapolsky@gmail\.com/i);
  assert.match(brief, /COMMERCIAL_TRUTH\.md/);
  assert.match(brief, /VERIFICATION_EVIDENCE\.md/);
  assert.doesNotMatch(brief, /^We are an official Anthropic partner\b/m);
});
