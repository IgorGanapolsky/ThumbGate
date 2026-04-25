const test = require('node:test');
const assert = require('node:assert/strict');

process.env.REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID || 'test-client';
process.env.REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET || 'test-secret';
process.env.REDDIT_USERNAME = process.env.REDDIT_USERNAME || 'test-user';
process.env.REDDIT_PASSWORD = process.env.REDDIT_PASSWORD || 'test-password';

const { buildWarmRedditMessages } = require('../scripts/reddit-dm-outreach');

test('reddit warm outreach stays discovery-first and avoids stale incentive language', () => {
  const messages = buildWarmRedditMessages('https://thumbgate-production.up.railway.app/#workflow-sprint-intake');

  assert.equal(messages.length, 4);
  assert.ok(messages.every((message) => /workflow/i.test(message.text)));
  assert.ok(messages.every((message) => /15-minute diagnostic|Worth 15 minutes|Open to a 15-minute diagnostic/i.test(message.text)));
  assert.ok(messages.every((message) => !/lifetime pro|no strings attached/i.test(message.text)));
});
