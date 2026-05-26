'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildLessonBundleFromDir,
  customerSyncHash,
  getAccountSyncDir,
  mergeLessonBundleIntoDir,
} = require('../scripts/lesson-sync');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-lesson-sync-'));
}

test('lesson sync builds and merges portable lesson bundles with dedupe', () => {
  const sourceDir = tempDir();
  const targetDir = tempDir();
  fs.writeFileSync(path.join(sourceDir, 'feedback-log.jsonl'), `${JSON.stringify({
    id: 'fb_sync_1',
    signal: 'down',
    title: 'Do not ship without webhook proof',
    context: 'Webhook was assumed working',
    whatToChange: 'Run the webhook test before claiming revenue observability',
    tags: ['stripe', 'proof'],
    timestamp: '2026-05-26T12:00:00.000Z',
  })}\n`);

  const bundle = buildLessonBundleFromDir(sourceDir, { source: { client: 'test' } });
  assert.equal(bundle.lessonCount, 1);
  assert.equal(bundle.source.client, 'test');
  assert.equal(bundle.lessons[0].signal, 'down');

  const first = mergeLessonBundleIntoDir(bundle, targetDir, { importTag: 'pro-sync-test' });
  const second = mergeLessonBundleIntoDir(bundle, targetDir, { importTag: 'pro-sync-test' });
  assert.equal(first.imported, 1);
  assert.equal(first.skippedDuplicate, 0);
  assert.equal(second.imported, 0);
  assert.equal(second.skippedDuplicate, 1);

  const targetRows = fs.readFileSync(path.join(targetDir, 'feedback-log.jsonl'), 'utf8').trim().split('\n');
  assert.equal(targetRows.length, 1);
  assert.match(targetRows[0], /pro-sync-test/);

  fs.rmSync(sourceDir, { recursive: true, force: true });
  fs.rmSync(targetDir, { recursive: true, force: true });
});

test('customer sync directories are stable encoded namespaces, not raw Stripe customer IDs', () => {
  const rootDir = tempDir();
  const syncDir = getAccountSyncDir(rootDir, 'cus_live_sensitive');
  assert.equal(path.dirname(syncDir), path.join(rootDir, 'hosted-sync'));
  assert.equal(path.basename(syncDir), customerSyncHash('cus_live_sensitive'));
  assert.doesNotMatch(syncDir, /cus_live_sensitive/);
  fs.rmSync(rootDir, { recursive: true, force: true });
});
