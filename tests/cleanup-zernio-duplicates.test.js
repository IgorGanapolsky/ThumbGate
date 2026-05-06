const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CONFIRM_TOKEN,
  cleanupZernioDuplicates,
  findDuplicatePosts,
  normalizeContent,
  parseArgs,
} = require('../scripts/social-analytics/cleanup-zernio-duplicates');

test('normalizes URLs and whitespace for stable duplicate grouping', () => {
  assert.equal(
    normalizeContent('Same post   https://thumbgate.ai/?utm_source=instagram&utm_content=a'),
    'same post <url>'
  );
});

test('findDuplicatePosts keeps newest TikTok/Instagram post and marks older duplicates', () => {
  const groups = findDuplicatePosts([
    { id: 'ig-old', platforms: [{ platform: 'instagram' }], content: '500 actions. 2.5 hours.', createdAt: '2026-05-06T10:00:00Z' },
    { id: 'ig-new', platforms: [{ platform: 'instagram' }], content: '500 actions.   2.5 hours.', createdAt: '2026-05-06T11:00:00Z' },
    { id: 'tt-old', platforms: [{ platform: 'tiktok' }], content: 'Your AI agent just force-pushed to main.', createdAt: '2026-05-06T09:00:00Z' },
    { id: 'tt-new', platforms: [{ platform: 'tiktok' }], content: 'Your AI agent just force-pushed to main.', createdAt: '2026-05-06T12:00:00Z' },
    { id: 'li-ignore', platforms: [{ platform: 'linkedin' }], content: '500 actions. 2.5 hours.', createdAt: '2026-05-06T12:00:00Z' },
  ]);

  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.keep.id).sort(), ['ig-new', 'tt-new']);
  assert.deepEqual(groups.flatMap((group) => group.delete.map((post) => post.id)).sort(), ['ig-old', 'tt-old']);
});

test('cleanupZernioDuplicates dry-runs by default and does not delete', async () => {
  const deleted = [];
  const result = await cleanupZernioDuplicates({}, {
    listPosts: async () => [
      { id: 'old', platforms: [{ platform: 'instagram' }], content: 'dup', createdAt: '2026-05-06T10:00:00Z' },
      { id: 'new', platforms: [{ platform: 'instagram' }], content: 'dup', createdAt: '2026-05-06T11:00:00Z' },
    ],
    deletePost: async (id) => deleted.push(id),
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.candidateDeleteCount, 1);
  assert.deepEqual(deleted, []);
});

test('cleanupZernioDuplicates requires hard confirmation before live delete', async () => {
  await assert.rejects(
    cleanupZernioDuplicates({ dryRun: false }, {
      listPosts: async () => [
        { id: 'old', platform: 'tiktok', content: 'dup', createdAt: '2026-05-06T10:00:00Z' },
        { id: 'new', platform: 'tiktok', content: 'dup', createdAt: '2026-05-06T11:00:00Z' },
      ],
      deletePost: async () => ({}),
    }),
    /Live deletion requires/
  );
});

test('cleanupZernioDuplicates deletes older duplicates when confirmed', async () => {
  const deleted = [];
  const result = await cleanupZernioDuplicates({
    dryRun: false,
    confirmDelete: CONFIRM_TOKEN,
  }, {
    listPosts: async () => [
      { id: 'old', platform: 'instagram', content: 'dup', createdAt: '2026-05-06T10:00:00Z' },
      { id: 'new', platform: 'instagram', content: 'dup', createdAt: '2026-05-06T11:00:00Z' },
    ],
    deletePost: async (id) => {
      deleted.push(id);
      return { ok: true };
    },
  });

  assert.equal(result.deletedCount, 1);
  assert.deepEqual(deleted, ['old']);
});

test('parseArgs supports live-delete inputs', () => {
  assert.deepEqual(parseArgs([
    '--delete',
    `--confirm-delete=${CONFIRM_TOKEN}`,
    '--platforms=instagram,tiktok',
    '--statuses=published,scheduled',
    '--limit=50',
  ]), {
    confirmDelete: CONFIRM_TOKEN,
    dryRun: false,
    limit: 50,
    platforms: ['instagram', 'tiktok'],
    statuses: ['published', 'scheduled'],
  });
});
