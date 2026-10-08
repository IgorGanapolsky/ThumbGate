'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const REPO_ROOT = path.resolve(__dirname, '..');
const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-daily-publish-test-'));
const vaultDir = path.join(runtimeDir, 'vault');
const scriptPath = path.join(runtimeDir, 'scripts', 'thumbgate-daily-discoveries-publish.js');
const ledgerPath = path.join(runtimeDir, '.thumbgate', 'daily-discoveries-ledger.jsonl');
const lockPath = path.join(runtimeDir, '.thumbgate', 'daily-discoveries.lock');
const originalEnv = { DEVTO_API_KEY: process.env.DEVTO_API_KEY, VAULT_DIR: process.env.VAULT_DIR };
process.env.DEVTO_API_KEY = '';
process.env.VAULT_DIR = vaultDir;
for (const relative of [
  'scripts/thumbgate-daily-discoveries-publish.js',
  'scripts/daily-discoveries-topics.json',
  'scripts/social-analytics/utm.js',
  'scripts/social-analytics/publishers/devto.js',
]) {
  const destination = path.join(runtimeDir, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, relative), destination);
}
const cliOptions = {
  cwd: runtimeDir,
  encoding: 'utf8',
  env: { ...process.env, DEVTO_API_KEY: '', VAULT_DIR: vaultDir },
};
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
} = require(scriptPath);

const dateStr = getFormattedDate();
const topic = selectTopicForDay();
const outputPaths = [
  path.join('docs', 'marketing', 'daily-discoveries', `${dateStr}-${topic.slug}.md`),
  path.join('public', 'blog', `${dateStr}-${topic.slug}.html`),
];
const repoStatePaths = [
  ...outputPaths,
  path.join('.thumbgate', 'daily-discoveries-ledger.jsonl'),
  path.join('.thumbgate', 'daily-discoveries.lock'),
];
const repoStateBefore = repoStatePaths.map((relative) => {
  const absolute = path.join(REPO_ROOT, relative);
  return fs.existsSync(absolute) ? fs.readFileSync(absolute) : null;
});

test.beforeEach((t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Network disabled in publisher tests'); });
  process.env.DEVTO_API_KEY = '';
  for (const relative of ['.thumbgate', 'docs', 'public', 'vault']) {
    fs.rmSync(path.join(runtimeDir, relative), { recursive: true, force: true });
  }
  fs.mkdirSync(vaultDir, { recursive: true });
});

test.afterEach(() => {
  for (const [index, relative] of repoStatePaths.entries()) {
    const absolute = path.join(REPO_ROOT, relative);
    const actual = fs.existsSync(absolute) ? fs.readFileSync(absolute) : null;
    assert.deepEqual(actual, repoStateBefore[index], `publisher test changed repository ${relative}`);
  }
});

test.after(() => {
  fs.rmSync(runtimeDir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

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
  assert.ok(fs.existsSync(lockPath));
  fs.utimesSync(lockPath, fortyMinutesAgo, fortyMinutesAgo);
  const reclaimed = acquireRunLock();
  assert.equal(reclaimed, true, 'stale lock should be reclaimed');
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

  recordLedgerEntry({ date: '2026-09-23', status: 'published', devto: { id: 123, url: 'https://dev.to/test/discovery' } });
  assert.equal(hasAlreadyPublishedToday('2026-09-23'), true);
  recordLedgerEntry({ date: '2026-09-24', status: 'published', devto: null });
  assert.equal(hasAlreadyPublishedToday('2026-09-24'), false, 'local outputs are not a remote receipt');
});

test('recordLedgerEntry appends JSON lines to ledger', () => {
  const entry = { date: '2026-01-01', status: 'test', topic: 'test' };
  recordLedgerEntry(entry);
  const exists = hasAlreadyPublishedToday('2026-01-01');
  assert.equal(exists, false, 'status is not published so returns false');
});

test('runDailyPublish dry-run returns preview without writing outputs or ledger', async () => {
  const result = await runDailyPublish({ dryRun: true });
  assert.equal(result.status, 'dry_run_preview');
  assert.equal(result.dryRun, true);
  assert.ok(result.topic);
  assert.ok(result.title);
  assert.ok(result.canonicalUrl);
  assert.ok(result.previewSnippet);
  assert.equal(fs.existsSync(ledgerPath), false);
  for (const relative of outputPaths) assert.equal(fs.existsSync(path.join(runtimeDir, relative)), false);
  assert.deepEqual(fs.readdirSync(vaultDir), []);
});

test('runDailyPublish returns skipped when already published today', async () => {
  recordLedgerEntry({ date: dateStr, status: 'published', devto: { id: 123, url: 'https://dev.to/test/discovery' } });
  const result = await runDailyPublish({ force: false });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /Already published daily discovery/);
  for (const relative of outputPaths) assert.equal(fs.existsSync(path.join(runtimeDir, relative)), false);
  assert.deepEqual(fs.readdirSync(vaultDir), []);
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
  const stdoutDryRun = execFileSync(process.execPath, [scriptPath, '--dry-run'], cliOptions);
  assert.match(stdoutDryRun, /\[ThumbGate Daily Discoveries\] Status: dry_run_preview/);

  const stdoutJson = execFileSync(process.execPath, [scriptPath, '--dry-run', '--json'], cliOptions);
  const parsed = JSON.parse(stdoutJson);
  assert.equal(parsed.status, 'dry_run_preview');
  assert.equal(parsed.dryRun, true);
});


test('runDailyPublish stages local outputs without claiming publication or blocking retries', async () => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await runDailyPublish();
    assert.equal(result.status, 'staged');
    assert.ok(fs.readFileSync(result.stagedPath, 'utf8').includes(result.title));
    assert.ok(fs.readFileSync(result.publicBlogHtmlPath, 'utf8').includes(result.title));
    assert.equal(hasAlreadyPublishedToday(result.date), false);
    assert.equal(fs.existsSync(lockPath), false);
  }
  const entries = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(entries.length, 2);
  for (const entry of entries) {
    assert.equal(entry.status, 'staged');
    assert.equal(entry.devto, null);
    assert.equal(entry.publishedAt, undefined);
    assert.ok(entry.stagedAt);
  }
});

test('CLI stages outputs only inside the isolated runtime', () => {
  const result = JSON.parse(execFileSync(process.execPath, [scriptPath, '--json'], cliOptions));
  assert.equal(result.status, 'staged');
  for (const relative of outputPaths) {
    assert.equal(fs.existsSync(path.join(runtimeDir, relative)), true);
  }
  assert.equal(fs.existsSync(path.join(vaultDir, 'Research', 'Daily-Discoveries', path.basename(result.stagedPath))), true);
  assert.equal(hasAlreadyPublishedToday(result.date), false);
});


test('runDailyPublish records a confirmed remote receipt and skips the next run', async (t) => {
  const publisher = require(path.join(runtimeDir, 'scripts/social-analytics/publishers/devto.js'));
  const receipt = { id: 123, url: 'https://dev.to/test/discovery' };
  const publish = t.mock.method(publisher, 'publishArticle', async () => receipt);
  process.env.DEVTO_API_KEY = 'test-only-never-sent';
  const result = await runDailyPublish();
  assert.equal(result.status, 'published');
  const entries = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].status, 'publication_unknown');
  const entry = entries[1];
  assert.equal(entry.status, 'published');
  assert.deepEqual(entry.devto, receipt);
  assert.ok(entry.publishedAt);
  assert.equal(entry.stagedAt, undefined);
  assert.equal(hasAlreadyPublishedToday(result.date), true);
  assert.equal((await runDailyPublish()).status, 'skipped');
  assert.equal(publish.mock.callCount(), 1);
});

test('runDailyPublish blocks unresolved publication outcomes even with force', async (t) => {
  const publisher = require(path.join(runtimeDir, 'scripts/social-analytics/publishers/devto.js'));
  const publish = t.mock.method(publisher, 'publishArticle', async () => ({ id: 123, url: 'https://dev.to/test/discovery' }));
  process.env.DEVTO_API_KEY = 'test-only-never-sent';
  recordLedgerEntry({ date: dateStr, status: 'publication_unknown', devto: null });
  for (const force of [false, true]) {
    const result = await runDailyPublish({ force });
    assert.equal(result.status, 'publication_unknown');
    assert.match(result.reason, /reconcil/i);
  }
  assert.equal(publish.mock.callCount(), 0);
  assert.equal(hasAlreadyPublishedToday(dateStr), false);
  assert.equal(fs.existsSync(lockPath), false);
  for (const relative of outputPaths) assert.equal(fs.existsSync(path.join(runtimeDir, relative)), false);
});

test('runDailyPublish persists ambiguous receipts and prevents duplicate retries', async (t) => {
  const publisher = require(path.join(runtimeDir, 'scripts/social-analytics/publishers/devto.js'));
  process.env.DEVTO_API_KEY = 'test-only-never-sent';
  for (const receipt of [null, {}, { id: 123 }, { id: 0, url: 'https://dev.to/test/post' }, { id: 123, url: 'not-a-url' }, { id: 123, url: 'https://example.com/post' }]) {
    fs.rmSync(ledgerPath, { force: true });
    const publish = t.mock.method(publisher, 'publishArticle', async () => receipt);
    const result = await runDailyPublish();
    assert.equal(result.status, 'publication_unknown');
    assert.match(result.reason, /reconcil/i);
    const entry = JSON.parse(fs.readFileSync(ledgerPath, 'utf8').trim());
    assert.equal(entry.status, 'publication_unknown');
    assert.equal(entry.publishedAt, undefined);
    assert.equal(entry.devto, null);
    assert.ok(entry.attemptedAt);
    assert.equal(entry.canonicalUrl, result.canonicalUrl);
    assert.equal(fs.existsSync(lockPath), false);
    assert.equal(hasAlreadyPublishedToday(dateStr), false);
    assert.equal((await runDailyPublish()).status, 'publication_unknown');
    assert.equal((await runDailyPublish({ force: true })).status, 'publication_unknown');
    const cliResult = JSON.parse(execFileSync(process.execPath, [scriptPath, '--json', '--force'], cliOptions));
    assert.equal(cliResult.status, 'publication_unknown');
    assert.equal(fs.readFileSync(ledgerPath, 'utf8').trim().split('\n').length, 1);
    assert.equal(publish.mock.callCount(), 1);
    publish.mock.restore();
  }
});

test('runDailyPublish holds ambiguous transport and JSON failures instead of repeating the POST', async (t) => {
  process.env.DEVTO_API_KEY = 'test-only-never-sent';
  for (const failure of ['transport', 'json']) {
    fs.rmSync(ledgerPath, { force: true });
    const post = t.mock.method(globalThis, 'fetch', async (url, options) => {
      assert.equal(url, 'https://dev.to/api/articles');
      assert.equal(options.method, 'POST');
      const attempt = JSON.parse(fs.readFileSync(ledgerPath, 'utf8').trim());
      assert.equal(attempt.status, 'publication_unknown', 'hold must be persisted before sending');
      if (failure === 'transport') throw new Error('connection lost after sending');
      return { ok: true, json: async () => { throw new SyntaxError('invalid response JSON'); } };
    });
    await assert.rejects(runDailyPublish(), /connection lost|invalid response JSON/);
    assert.equal(fs.existsSync(ledgerPath), true, 'unknown attempt must survive a response failure');
    const entry = JSON.parse(fs.readFileSync(ledgerPath, 'utf8').trim());
    assert.equal(entry.status, 'publication_unknown');
    assert.equal(entry.publishedAt, undefined);
    assert.equal(hasAlreadyPublishedToday(dateStr), false);
    assert.equal(fs.existsSync(lockPath), false);
    assert.equal((await runDailyPublish()).status, 'publication_unknown');
    assert.equal((await runDailyPublish({ force: true })).status, 'publication_unknown');
    const cliResult = JSON.parse(execFileSync(process.execPath, [scriptPath, '--json', '--force'], cliOptions));
    assert.equal(cliResult.status, 'publication_unknown');
    assert.equal(post.mock.callCount(), 1);
    post.mock.restore();
  }
});
