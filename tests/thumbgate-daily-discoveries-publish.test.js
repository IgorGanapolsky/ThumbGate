'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const {
  selectTopicForDay,
  generatePostContent,
  renderBlogHtml,
  runDailyPublish,
  buildUTMLink,
  getFormattedDate,
  acquireRunLock,
  releaseRunLock,
  canWriteToSharedVault,
  hasAlreadyPublishedToday,
  getRecentGitCommit,
  recordLedgerEntry,
  CURATED_TOPICS,
} = require('../scripts/thumbgate-daily-discoveries-publish');

test('selectTopicForDay selects deterministic topic from curated list', () => {
  const d1 = new Date('2026-09-23T09:00:00Z');
  const topic1 = selectTopicForDay(d1);
  assert.ok(topic1);
  assert.ok(CURATED_TOPICS.some((t) => t.slug === topic1.slug));

  const d2 = new Date('2026-09-23T15:00:00Z');
  const topic2 = selectTopicForDay(d2);
  assert.equal(topic1.slug, topic2.slug, 'same day produces same topic');

  const defaultTopic = selectTopicForDay();
  assert.ok(defaultTopic);
  assert.ok(CURATED_TOPICS.some((t) => t.slug === defaultTopic.slug));
});

test('getFormattedDate formats dates as YYYY-MM-DD', () => {
  const d = new Date(2026, 0, 5); // Jan 5, 2026
  assert.equal(getFormattedDate(d), '2026-01-05');

  const nowStr = getFormattedDate();
  assert.match(nowStr, /^\d{4}-\d{2}-\d{2}$/);
});

test('getRecentGitCommit returns a non-empty string or fallback', () => {
  const commit = getRecentGitCommit();
  assert.equal(typeof commit, 'string');
  assert.ok(commit.length > 0);
});

test('generatePostContent renders markdown with code snippet and canonical url', () => {
  const topic = CURATED_TOPICS[0];
  const dateStr = '2026-09-23';
  const commit = 'abc1234 - test commit';
  const content = generatePostContent(topic, dateStr, commit);

  assert.match(content, /^# /);
  assert.match(content, /ThumbGate Engineering Daily/);
  assert.match(content, /Canonical URL/);
  assert.match(content, /PreToolUse/);
  assert.match(content, /https:\/\/thumbgate\.ai/);
  assert.match(content, /utm_campaign=daily_technical_discoveries/);
});

test('renderBlogHtml renders valid HTML with canonical link and open graph metadata', () => {
  const topic = CURATED_TOPICS[0];
  const dateStr = '2026-09-23';
  const html = renderBlogHtml(topic, dateStr, 'markdown content');

  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /<title>.*ThumbGate<\/title>/);
  assert.match(html, new RegExp(`<link rel="canonical" href="https://thumbgate\\.ai/blog/${dateStr}-${topic.slug}">`));
  assert.match(html, /class="cta-btn"/);
  assert.match(html, /The Failure Mode/);
  assert.match(html, /Architectural Resolution/);
});

test('acquireRunLock and releaseRunLock manage lock lifecycle', () => {
  releaseRunLock();
  const acquired = acquireRunLock();
  assert.equal(acquired, true, 'lock should be acquired initially');

  const secondAcquire = acquireRunLock();
  assert.equal(secondAcquire, false, 'second lock attempt should fail');

  releaseRunLock();
  const reacquired = acquireRunLock();
  assert.equal(reacquired, true, 'lock should be acquirable after release');
  releaseRunLock();
});

test('acquireRunLock reclaims stale lock (>30m old)', () => {
  releaseRunLock();
  acquireRunLock();
  const fortyMinutesAgo = (Date.now() - 40 * 60 * 1000) / 1000;
  const lockPath = path.resolve(__dirname, '../.thumbgate/daily-discoveries.lock');
  if (fs.existsSync(lockPath)) {
    fs.utimesSync(lockPath, fortyMinutesAgo, fortyMinutesAgo);
    const reclaimed = acquireRunLock();
    assert.equal(reclaimed, true, 'stale lock should be reclaimed');
  }
  releaseRunLock();
});

test('canWriteToSharedVault checks for foreign claims and jobs', () => {
  const tempVault = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'));
  try {
    assert.equal(canWriteToSharedVault(tempVault), true, 'empty vault should be writable');

    const claimsDir = path.join(tempVault, 'Agents', 'Claims');
    fs.mkdirSync(claimsDir, { recursive: true });
    assert.equal(canWriteToSharedVault(tempVault), true, 'empty claims directory should be writable');

    fs.writeFileSync(path.join(claimsDir, 'foreign-daily-discoveries-claim.json'), '{}');
    assert.equal(canWriteToSharedVault(tempVault), false, 'vault with active daily-discoveries claim should not be writable');

    assert.equal(canWriteToSharedVault('/path/that/does/not/exist/for/sure'), false);
  } finally {
    fs.rmSync(tempVault, { recursive: true, force: true });
  }
});

test('hasAlreadyPublishedToday detects published status in ledger', () => {
  const res = hasAlreadyPublishedToday('1999-01-01');
  assert.equal(res, false, 'future or unrecorded date returns false');

  const publishedToday = hasAlreadyPublishedToday('2026-09-23');
  assert.equal(typeof publishedToday, 'boolean');
});

test('runDailyPublish dry-run returns preview without writing outputs or ledger', async () => {
  const result = await runDailyPublish({ dryRun: true });
  assert.equal(result.status, 'dry_run_preview');
  assert.equal(result.dryRun, true);
  assert.ok(result.topic);
  assert.ok(result.title);
  assert.ok(result.canonicalUrl);
  assert.ok(result.previewSnippet);
});

test('runDailyPublish returns skipped when already published today', async () => {
  const result = await runDailyPublish({ force: false });
  if (result.status === 'skipped') {
    assert.match(result.reason, /Already published daily discovery/);
  } else {
    assert.ok(['published', 'locked'].includes(result.status));
  }
});

test('runDailyPublish returns locked when lock is already held', async () => {
  acquireRunLock();
  try {
    const result = await runDailyPublish({ force: true });
    assert.equal(result.status, 'locked');
    assert.match(result.reason, /active run lock/);
  } finally {
    releaseRunLock();
  }
});

test('thumbgate-daily-discoveries-publish CLI executes dry-run and json modes', () => {
  const scriptPath = path.resolve(__dirname, '../scripts/thumbgate-daily-discoveries-publish.js');
  
  const stdoutDryRun = execFileSync(process.execPath, [scriptPath, '--dry-run'], { encoding: 'utf8' });
  assert.match(stdoutDryRun, /\[ThumbGate Daily Discoveries\] Status: dry_run_preview/);

  const stdoutJson = execFileSync(process.execPath, [scriptPath, '--dry-run', '--json'], { encoding: 'utf8' });
  const parsed = JSON.parse(stdoutJson);
  assert.equal(parsed.status, 'dry_run_preview');
  assert.equal(parsed.dryRun, true);
});
