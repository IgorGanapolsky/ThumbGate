'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDuplicateKey,
  findDuplicateGroups,
  normalizeText,
  parseArgs,
  run,
} = require('../scripts/social-analytics/cleanup-zernio-duplicates');

describe('cleanup-zernio-duplicates', () => {
  it('normalizes tracking links, punctuation, and hashtags out of duplicate text', () => {
    assert.equal(
      normalizeText('500 actions. 2.5 hours. https://thumbgate.ai/pro?utm_source=ig #ThumbGate'),
      '500 actions 2 5 hours',
    );
  });

  it('builds a platform-scoped key from title/caption/media signature', () => {
    const key = buildDuplicateKey({
      id: '1',
      platform: 'Instagram',
      title: '500 actions. 2.5 hours.',
      mediaItems: [{ key: 'uploads/card-500.png' }],
    });

    assert.match(key, /^instagram::500 actions 2 5 hours/);
    assert.match(key, /uploads card 500 png$/);
  });

  it('keeps the newest duplicate and marks older posts for deletion', () => {
    const groups = findDuplicateGroups([
      { id: 'old', platform: 'instagram', title: '500 actions. 2.5 hours.', createdAt: '2026-05-06T10:00:00Z' },
      { id: 'new', platform: 'instagram', title: '500 actions. 2.5 hours.', createdAt: '2026-05-06T12:00:00Z' },
      { id: 'tt', platform: 'tiktok', title: '500 actions. 2.5 hours.', createdAt: '2026-05-06T11:00:00Z' },
    ]);

    assert.equal(groups.length, 1);
    assert.equal(groups[0].keep.id, 'new');
    assert.deepEqual(groups[0].delete.map((post) => post.id), ['old']);
  });

  it('only targets instagram and tiktok by default', () => {
    const groups = findDuplicateGroups([
      { id: 'ig-1', platform: 'instagram', title: 'Same', createdAt: '2026-05-06T10:00:00Z' },
      { id: 'ig-2', platform: 'instagram', title: 'Same', createdAt: '2026-05-06T11:00:00Z' },
      { id: 'li-1', platform: 'linkedin', title: 'Same', createdAt: '2026-05-06T10:00:00Z' },
      { id: 'li-2', platform: 'linkedin', title: 'Same', createdAt: '2026-05-06T11:00:00Z' },
    ]);

    assert.equal(groups.length, 1);
    assert.equal(groups[0].keep.platform, 'instagram');
  });

  it('dry-runs by default and deletes only with explicit confirmation', async () => {
    const deleted = [];
    const deps = {
      listPosts: async () => [
        { id: 'a', platform: 'tiktok', content: 'Your AI agent just force-pushed to main.', createdAt: '2026-05-06T10:00:00Z' },
        { id: 'b', platform: 'tiktok', content: 'Your AI agent just force-pushed to main.', createdAt: '2026-05-06T11:00:00Z' },
      ],
      deletePost: async (id) => deleted.push(id),
    };

    const audit = await run({}, deps);
    assert.equal(audit.dryRun, true);
    assert.equal(audit.deleteCandidateCount, 1);
    assert.deepEqual(deleted, []);

    const live = await run({ confirmDelete: true }, deps);
    assert.equal(live.dryRun, false);
    assert.deepEqual(deleted, ['a']);
  });

  it('parses confirmation, platform, limit, status, and output args', () => {
    const opts = parseArgs([
      '--confirm-delete',
      '--platforms=instagram,tiktok',
      '--limit=50',
      '--status=published',
      '--out=/tmp/report.json',
    ]);

    assert.equal(opts.confirmDelete, true);
    assert.deepEqual(opts.platforms, ['instagram', 'tiktok']);
    assert.equal(opts.limit, 50);
    assert.equal(opts.status, 'published');
    assert.equal(opts.out, '/tmp/report.json');
  });
});
