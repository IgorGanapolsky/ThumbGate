'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const {
  buildEngagementAudit,
  parseArgs,
  PLATFORM_CAPABILITIES,
  formatDateInTimezone,
} = require('../scripts/social-analytics/engagement-audit');

test('buildEngagementAudit returns structured audit with all platforms', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engagement-'));
  const audit = buildEngagementAudit({
    date: '2026-04-07',
    replyStatePath: path.join(tmp, 'state.json'),
    draftsPath: path.join(tmp, 'drafts.jsonl'),
    launchAssetsPath: path.join(tmp, 'assets.json'),
  });
  assert.equal(audit.date, '2026-04-07');
  assert.ok(audit.platforms.x);
  assert.ok(audit.platforms.reddit);
  assert.ok(audit.platforms.linkedin);
  assert.equal(audit.totals.checked, 0);
  assert.equal(audit.totals.replied, 0);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('parseArgs extracts date and timezone', () => {
  const opts = parseArgs(['--date=2026-04-07', '--timezone=UTC']);
  assert.equal(opts.date, '2026-04-07');
  assert.equal(opts.timezone, 'UTC');
});

test('platform capabilities cover all expected platforms', () => {
  const expected = ['x', 'reddit', 'linkedin', 'instagram', 'tiktok', 'youtube', 'devto'];
  for (const platform of expected) {
    assert.ok(PLATFORM_CAPABILITIES[platform], `Missing capability for ${platform}`);
  }
});
