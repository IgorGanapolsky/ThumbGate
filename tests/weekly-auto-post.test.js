const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-wap-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

const wp = require('../scripts/weekly-auto-post');

test.after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

// === Generate Post File ===
// With THUMBGATE_FEEDBACK_DIR pointed at a fresh tmp, there is no activity,
// so the generator MUST suppress the post — no file written, no content to
// publish. This is the 2026-04-21 Bluesky-disaster regression guard.
test('generateWeeklyPostFile suppresses zero-activity windows (no file written)', () => {
  const r = wp.generateWeeklyPostFile({ periodDays: 7 });
  assert.equal(r.suppressed, true);
  assert.equal(r.filePath, null);
  assert.equal(r.filename, null);
  assert.ok(r.date);
  assert.ok(r.stats);
  assert.match(r.suppressedReason, /no activity/);
});

test('generateWeeklyPostFile returns numeric stats even when suppressed', () => {
  const r = wp.generateWeeklyPostFile({ periodDays: 1 });
  assert.equal(typeof r.stats.blockedCount, 'number');
  assert.equal(typeof r.stats.hoursSaved, 'number');
});

// === Run Weekly Post (dry run) ===
test('runWeeklyPost dry run on zero-activity window returns suppressed', async () => {
  const r = await wp.runWeeklyPost({ periodDays: 7, dryRun: true });
  assert.equal(r.suppressed, true);
  assert.equal(r.posted, false);
  assert.equal(r.postResult, null);
  assert.equal(r.zernioResult, null);
  assert.equal(r.generated.filePath, null);
});

test('runWeeklyPost does NOT attempt to publish when suppressed', async () => {
  // Even with dryRun:false, a suppressed generation must short-circuit BEFORE
  // any publisher is imported/called. This is the critical guarantee that
  // blocks a "blocked 0 mistakes" post from reaching Bluesky/X/LinkedIn.
  const r = await wp.runWeeklyPost({ periodDays: 7, dryRun: false });
  assert.equal(r.suppressed, true);
  assert.equal(r.posted, false);
  assert.equal(r.zernioResult, null);
  assert.equal(r.postResult, null);
});

// === Schedule ===
test('createWeeklyPostSchedule creates monday 10am schedule', () => {
  const r = wp.createWeeklyPostSchedule({ day: 'monday', time: '10:00', dryRun: true });
  assert.ok(r.success);
  assert.equal(r.schedule.id, 'thumbgate-weekly-post');
  assert.equal(r.schedule.schedule, 'weekly monday 10:00');
  assert.ok(r.schedule.command.includes('runWeeklyPost'));
});

// === List Posts ===
test('listWeeklyPosts returns generated files', () => {
  // Seed a fixture directly because the generator now refuses to write when
  // there is no activity in the window (anti-zero-stats-post guard).
  fs.mkdirSync(wp.POSTS_DIR, { recursive: true });
  const fixturePath = path.join(wp.POSTS_DIR, 'weekly-stats-2099-01-01.md');
  fs.writeFileSync(fixturePath, '---\ntitle: fixture\n---\n\nseed\n');
  try {
    const posts = wp.listWeeklyPosts();
    assert.ok(posts.length >= 1);
    assert.ok(posts[0].filename.endsWith('.md'));
    assert.ok(posts[0].date);
  } finally {
    fs.unlinkSync(fixturePath);
  }
});

// === POSTS_DIR ===
test('POSTS_DIR is under .thumbgate', () => {
  assert.ok(wp.POSTS_DIR.includes('.thumbgate'));
});
