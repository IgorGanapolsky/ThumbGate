const test = require('node:test');
const assert = require('node:assert/strict');

process.env.REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID || 'test-client';
process.env.REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET || 'test-secret';
process.env.REDDIT_USERNAME = process.env.REDDIT_USERNAME || 'test-user';
process.env.REDDIT_PASSWORD = process.env.REDDIT_PASSWORD || 'test-password';

const { buildWarmRedditMessages, markContacted } = require('../scripts/reddit-dm-outreach');

test('reddit warm outreach stays discovery-first and avoids stale incentive language', () => {
  const messages = buildWarmRedditMessages('https://thumbgate-production.up.railway.app/#workflow-sprint-intake');

  assert.equal(messages.length, 4);
  assert.ok(messages.every((message) => /workflow/i.test(message.text)));
  assert.ok(messages.every((message) => /paid AI-agent workflow diagnostic today/i.test(message.text)));
  assert.ok(messages.every((message) => /\$499, same-day kickoff/i.test(message.text)));
  assert.ok(messages.every((message) => !/lifetime pro|no strings attached/i.test(message.text)));
  assert.ok(messages.every((message) => !/15-minute diagnostic|Worth 15 minutes|Open to a 15-minute diagnostic/i.test(message.text)));
});

test('reddit outreach can mark successful warm sends as contacted', () => {
  let payload = null;
  const result = markContacted(
    { to: 'Deep_Ad1959' },
    {
      timestamp: '2026-05-05T19:00:00.000Z',
      advanceLead: (nextPayload) => {
        payload = nextPayload;
        return { unchanged: false };
      },
    },
  );

  assert.equal(result.leadId, 'reddit_deep_ad1959_r_cursor');
  assert.equal(payload.stage, 'contacted');
  assert.equal(payload.channel, 'reddit_dm');
  assert.match(payload.note, /\$499 workflow diagnostic/);
});

test('reddit warm outreach dry run can be filtered to one target', () => {
  const messages = buildWarmRedditMessages('https://thumbgate-production.up.railway.app/#workflow-sprint-intake')
    .filter((message) => new Set(['Deep_Ad1959']).has(message.to));

  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, 'Deep_Ad1959');
});
