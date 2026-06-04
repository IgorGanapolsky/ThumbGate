'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildYcHnEngagementPack,
  buildYcHnEngagementSchedule,
  formatYcHnEngagementPack,
  installYcHnEngagementSchedule,
  writeYcHnEngagementPack,
} = require('../scripts/yc-hn-engagement-pack');

test('YC/HN engagement pack is draft-only and anti-spam by default', () => {
  const pack = buildYcHnEngagementPack({ generatedAt: '2026-06-04T20:31:00.000Z' });

  assert.equal(pack.name, 'thumbgate-yc-hn-engagement-pack');
  assert.equal(pack.status, 'draft_review_required');
  assert.match(pack.noAutoPostRule, /Never auto-post/i);
  assert.ok(pack.opportunityFilters.some((filter) => /valuable if the product name were removed/i.test(filter)));
  assert.ok(pack.dailyCadence.some((item) => item.action === 'scan'));
  assert.ok(pack.dailyCadence.some((item) => item.action === 'contribute'));
  assert.ok(pack.dailyCadence.some((item) => item.action === 'measure'));
});

test('current YC LinkedIn draft stays value-first and does not paste a product link', () => {
  const pack = buildYcHnEngagementPack();
  const draft = pack.currentLinkedInDraft.comment;

  assert.match(pack.currentLinkedInDraft.source, /RASPIRE/i);
  assert.match(draft, /Congrats/i);
  assert.match(draft, /action boundary/i);
  assert.doesNotMatch(draft, /https?:\/\//i);
  assert.doesNotMatch(draft, /thumbgate\.ai/i);
  assert.ok(pack.currentLinkedInDraft.whyItWorks.some((reason) => /does not paste a product link/i.test(reason)));
});

test('Show HN draft reflects current positioning and avoids stale claims', () => {
  const pack = buildYcHnEngagementPack();
  const text = pack.showHnDraft.text;

  assert.match(pack.showHnDraft.title, /Show HN: ThumbGate/i);
  assert.match(text, /npx thumbgate init/);
  assert.match(text, /warn\+audit/);
  assert.match(text, /observability\/cost controls/);
  assert.doesNotMatch(text, /8,300/i);
  assert.doesNotMatch(text, /v1\.21\.0/i);
  assert.doesNotMatch(text, /5 rules/i);
});

test('formatted pack writes markdown and json artifacts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-yc-hn-'));
  const { jsonPath, markdownPath, pack } = writeYcHnEngagementPack(dir, {
    generatedAt: '2026-06-04T20:31:00.000Z',
  });

  assert.equal(fs.existsSync(jsonPath), true);
  assert.equal(fs.existsSync(markdownPath), true);
  assert.equal(JSON.parse(fs.readFileSync(jsonPath, 'utf8')).name, pack.name);

  const markdown = fs.readFileSync(markdownPath, 'utf8');
  assert.match(markdown, /YC \/ Hacker News Engagement Pack/);
  assert.match(markdown, /LinkedIn Draft For Current YC Post/);
  assert.match(markdown, /Show HN Draft/);
  assert.equal(markdown, formatYcHnEngagementPack(pack));
});

test('schedule preview creates a daily draft-only local job', () => {
  const schedule = buildYcHnEngagementSchedule({
    repoRoot: '/repo/thumbgate',
    outputDir: '/repo/thumbgate/docs/marketing',
  });

  assert.equal(schedule.id, 'thumbgate-yc-hn-engagement-drafts');
  assert.equal(schedule.schedule, 'daily 8:30');
  assert.equal(schedule.autoPost, false);
  assert.match(schedule.description, /Never posts automatically/i);
  assert.match(schedule.command, /writeYcHnEngagementPack/);
  assert.match(schedule.command, /autoPost: false/);
  assert.equal(schedule.workingDirectory, '/repo/thumbgate');
});

test('install schedule delegates to schedule-manager without posting', () => {
  const calls = [];
  const result = installYcHnEngagementSchedule({
    repoRoot: '/repo/thumbgate',
    outputDir: '/repo/thumbgate/docs/marketing',
    schedule: 'daily 9:15',
  }, {
    createSchedule(schedule) {
      calls.push(schedule);
      return { success: true, schedule };
    },
  });

  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].schedule, 'daily 9:15');
  assert.equal(calls[0].autoPost, false);
  assert.doesNotMatch(calls[0].command, /publishApproved|createRecord|sendReply|schedulePost/i);
});
