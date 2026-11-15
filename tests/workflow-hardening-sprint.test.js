const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sprintBriefPath = path.join(__dirname, '..', 'docs', 'WORKFLOW_HARDENING_SPRINT.md');

test('former service brief explicitly retires managed setup without relabeling it Pro', () => {
  const brief = fs.readFileSync(sprintBriefPath, 'utf8');
  assert.match(brief, /retired and is no longer available for purchase/);
  assert.match(brief, /Historical engagements do not describe the Pro subscription/);
  assert.match(brief, /free MIT local CLI/i);
  assert.match(brief, /Self-serve Pro adds recall, dashboard, adapters, and exports/);
  assert.match(brief, /https:\/\/thumbgate.ai\/checkout\/pro/);
  assert.doesNotMatch(brief, /Status: current|Public paid checkout|workflow-sprint-intake|same-day next step/i);
});
