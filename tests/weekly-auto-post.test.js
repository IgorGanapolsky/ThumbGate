const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-wap-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

const wp = require('../scripts/weekly-auto-post');

test.after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

// === Generate Post File ===
test('generateWeeklyPostFile creates markdown with frontmatter', () => {
  const r = wp.generateWeeklyPostFile({ periodDays: 7 });
  assert.ok(r.filePath.endsWith('.md'));
  assert.ok(fs.existsSync(r.filePath));
  const content = fs.readFileSync(r.filePath, 'utf-8');
  assert.ok(content.includes('---'));
  assert.ok(content.includes('title:'));
  assert.ok(content.includes('ThumbGate blocked'));
  assert.ok(content.includes('#ThumbGate'));
  assert.ok(r.date);
  assert.ok(r.stats);
});

test('generateWeeklyPostFile includes stats data', () => {
  const r = wp.generateWeeklyPostFile({ periodDays: 1 });
  assert.ok(typeof r.stats.blockedCount === 'number');
  assert.ok(typeof r.stats.hoursSaved === 'number');
});

// === Run Weekly Post (dry run) ===
test('runWeeklyPost dry run generates but does not post', async () => {
  const r = await wp.runWeeklyPost({ periodDays: 7, dryRun: true });
  assert.equal(r.dryRun, true);
  assert.equal(r.posted, false);
  assert.equal(r.postResult, null);
  assert.ok(r.generated.filePath);
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
  wp.generateWeeklyPostFile({ periodDays: 7 });
  const posts = wp.listWeeklyPosts();
  assert.ok(posts.length >= 1);
  assert.ok(posts[0].filename.endsWith('.md'));
  assert.ok(posts[0].date);
});

// === POSTS_DIR ===
test('POSTS_DIR is under .rlhf', () => {
  assert.ok(wp.POSTS_DIR.includes('.rlhf'));
});
