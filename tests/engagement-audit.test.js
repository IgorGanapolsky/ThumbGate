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
  isValidDate,
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

test('isValidDate verifies date values correctly', () => {
  assert.equal(isValidDate('2026-04-07'), true);
  assert.equal(isValidDate(1712448000000), true);
  assert.equal(isValidDate(new Date()), true);
  assert.equal(isValidDate(null), false);
  assert.equal(isValidDate(undefined), false);
  assert.equal(isValidDate(''), false);
  assert.equal(isValidDate('not-a-date'), false);
  assert.equal(isValidDate(true), false);
  assert.equal(isValidDate(false), false);
});

test('formatDateInTimezone handles invalid date values gracefully', () => {
  assert.equal(formatDateInTimezone('not-a-date'), '');
  assert.equal(formatDateInTimezone(null), '');
  assert.equal(formatDateInTimezone(undefined), '');
  assert.equal(formatDateInTimezone(''), '');
  assert.equal(formatDateInTimezone('2026-04-07', 'UTC'), '2026-04-07');
});

test('buildEngagementAudit filters invalid/missing dates gracefully', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engagement-invalid-'));
  
  const stateData = {
    repliedTo: {
      valid: { platform: 'x', at: '2026-04-07T12:00:00Z' },
      invalidAt: { platform: 'x', at: 'not-a-date' },
      missingAt: { platform: 'x' },
      nullAt: { platform: 'x', at: null },
      undefinedAt: { platform: 'x', at: undefined },
    }
  };
  
  const draftsData = [
    { platform: 'x', draftedAt: '2026-04-07T13:00:00Z' },
    { platform: 'x', draftedAt: 'invalid' },
    { platform: 'x', draftedAt: null },
    { platform: 'x' }
  ];

  fs.writeFileSync(path.join(tmp, 'state.json'), JSON.stringify(stateData));
  fs.writeFileSync(path.join(tmp, 'drafts.jsonl'), draftsData.map(d => JSON.stringify(d)).join('\n') + '\n');
  fs.writeFileSync(path.join(tmp, 'assets.json'), JSON.stringify({}));

  const audit = buildEngagementAudit({
    date: '2026-04-07',
    timezone: 'UTC',
    replyStatePath: path.join(tmp, 'state.json'),
    draftsPath: path.join(tmp, 'drafts.jsonl'),
    launchAssetsPath: path.join(tmp, 'assets.json'),
  });

  // Only the valid ones (1 in repliedTo, 1 in drafts) should be counted
  assert.equal(audit.totals.checked, 1);
  assert.equal(audit.totals.replied, 1);
  assert.equal(audit.totals.drafted, 1);
  assert.equal(audit.platforms.x.checked, 1);
  assert.equal(audit.platforms.x.replied, 1);
  assert.equal(audit.platforms.x.drafted, 1);

  fs.rmSync(tmp, { recursive: true, force: true });
});
