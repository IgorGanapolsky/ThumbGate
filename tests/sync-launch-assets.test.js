'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildLaunchAssetState,
  parseArgs,
  syncLaunchAssets,
} = require('../scripts/social-analytics/sync-launch-assets');

test('parseArgs supports limit and state path overrides', () => {
  const parsed = parseArgs([
    '--limit=80',
    '--state-path=.thumbgate/custom-launch-assets.json',
  ]);

  assert.equal(parsed.limit, 80);
  assert.match(parsed.statePath, /custom-launch-assets\.json$/);
});

test('buildLaunchAssetState groups launch and campaign posts by marker and platform', () => {
  const state = buildLaunchAssetState([
    {
      _id: 'launch_x_1',
      status: 'published',
      createdAt: '2026-04-06T19:00:00.000Z',
      content: 'https://thumbgate-production.up.railway.app/?utm_content=launch_post_twitter',
      platforms: [{ platform: 'twitter' }],
    },
    {
      _id: 'campaign_ig_1',
      status: 'scheduled',
      createdAt: '2026-04-06T19:10:00.000Z',
      scheduledFor: '2026-04-07T10:15:00.000Z',
      content: 'https://thumbgate-production.up.railway.app/?utm_content=campaign_proof_pack',
      platforms: [{ platform: 'instagram' }],
    },
    {
      _id: 'campaign_ig_older',
      status: 'scheduled',
      createdAt: '2026-04-06T18:10:00.000Z',
      scheduledFor: '2026-04-07T10:15:00.000Z',
      content: 'https://thumbgate-production.up.railway.app/?utm_content=campaign_proof_pack',
      platforms: [{ platform: 'instagram' }],
    },
  ]);

  assert.equal(state.launchPosts.twitter.id, 'launch_x_1');
  assert.equal(state.campaignPosts.proof_pack.instagram.id, 'campaign_ig_1');
  assert.equal(state.campaignPosts.proof_pack.instagram.marker, 'campaign_proof_pack');
});

test('syncLaunchAssets writes a durable launch asset registry', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-launch-assets-'));
  const statePath = path.join(tmpDir, 'social-launch-assets.json');
  const result = await syncLaunchAssets({
    statePath,
    limit: 20,
  }, {
    listPosts: async () => ([
      {
        _id: 'launch_li_1',
        status: 'published',
        createdAt: '2026-04-06T19:01:00.000Z',
        content: 'https://thumbgate-production.up.railway.app/?utm_content=launch_post_linkedin',
        platforms: [{ platform: 'linkedin' }],
      },
      {
        _id: 'campaign_x_1',
        status: 'scheduled',
        createdAt: '2026-04-06T19:02:00.000Z',
        scheduledFor: '2026-04-07T18:45:00.000Z',
        content: 'https://thumbgate-production.up.railway.app/?utm_content=campaign_checkout_path',
        platforms: [{ platform: 'twitter' }],
      },
    ]),
  });

  const written = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(result.launchCount, 1);
  assert.equal(result.campaignCount, 1);
  assert.equal(written.launchPosts.linkedin.id, 'launch_li_1');
  assert.equal(written.campaignPosts.checkout_path.twitter.id, 'campaign_x_1');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
