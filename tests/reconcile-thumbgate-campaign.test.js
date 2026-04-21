'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseArgs,
  reconcileCampaignState,
} = require('../scripts/social-analytics/reconcile-thumbgate-campaign');

test('reconcile parseArgs supports duplicate cancellation and state path', () => {
  const parsed = parseArgs([
    '--cancel-duplicates',
    '--limit=25',
    '--state-path=/tmp/thumbgate-state.json',
  ]);

  assert.equal(parsed.cancelDuplicates, true);
  assert.equal(parsed.limit, 25);
  assert.equal(parsed.statePath, '/tmp/thumbgate-state.json');
});

test('reconcileCampaignState writes canonical state and cancels duplicates', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-reconcile-'));
  const statePath = path.join(tmpDir, 'campaign-state.json');
  const cancelled = [];

  const result = await reconcileCampaignState({
    cancelDuplicates: true,
    scheduleTimes: [
      '2026-04-07T10:15:00-04:00',
      '2026-04-07T14:30:00-04:00',
      '2026-04-07T18:45:00-04:00',
    ],
    statePath,
  }, {
    listPosts: async () => ([
      {
        _id: 'proof_x_1',
        status: 'scheduled',
        content: 'https://thumbgate.ai/?utm_content=campaign_proof_pack',
        createdAt: '2026-04-06T19:00:00.000Z',
        scheduledFor: '2026-04-07T14:15:00.000Z',
        platforms: [{ platform: 'twitter' }],
      },
      {
        _id: 'proof_x_2',
        status: 'scheduled',
        content: 'https://thumbgate.ai/?utm_content=campaign_proof_pack',
        createdAt: '2026-04-06T19:10:00.000Z',
        scheduledFor: '2026-04-07T14:15:00.000Z',
        platforms: [{ platform: 'twitter' }],
      },
      {
        _id: 'checkout_linkedin_1',
        status: 'scheduled',
        content: 'https://thumbgate.ai/?utm_content=campaign_checkout_path',
        createdAt: '2026-04-06T19:20:00.000Z',
        scheduledFor: '2026-04-07T22:45:00.000Z',
        platforms: [{ platform: 'linkedin' }],
      },
    ]),
    deletePost: async (postId) => {
      cancelled.push(postId);
      return { id: postId, deleted: true };
    },
  });

  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

  assert.equal(result.kept.length, 2);
  assert.equal(result.duplicates.length, 1);
  assert.deepEqual(cancelled, ['proof_x_2']);
  assert.equal(
    state.scheduled['2026-04-07T10:15:00-04:00::proof_pack::twitter'].id,
    'proof_x_1'
  );
  assert.equal(
    state.scheduled['2026-04-07T18:45:00-04:00::checkout_path::linkedin'].id,
    'checkout_linkedin_1'
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
