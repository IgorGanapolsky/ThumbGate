'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { generateReply, monitor } = require('../scripts/social-reply-monitor');

test('monitor defaults to Reddit and LinkedIn only (X retired 2026-04-20)', async () => {
  // Run in dry-run with invalid creds so platform checks short-circuit without network.
  // We only want to confirm the default platform list no longer dispatches to X.
  const prev = { ...process.env };
  for (const key of ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET', 'REDDIT_USERNAME', 'REDDIT_PASSWORD',
                     'LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_PERSON_URN']) {
    delete process.env[key];
  }
  try {
    const results = await monitor({ dryRun: true });
    assert.ok('reddit' in results, 'Reddit must be in default platform list');
    assert.ok('linkedin' in results, 'LinkedIn must be in default platform list');
    assert.ok(!('x' in results), 'X must not be in the default platform list after 2026-04-20 retirement');
  } finally {
    Object.assign(process.env, prev);
  }
});

test('generateReply acknowledges reddit process advice without pitching the product', async () => {
  const reply = await generateReply(
    'I have found that having skills that define specific processes works better. Another important thing is to review all your context docs for inconsistencies.',
    {
      platform: 'reddit',
      author: 'leogodin217',
      isQuestion: false,
    }
  );

  assert.match(reply, /matches what i have seen/i);
  assert.match(reply, /conflicting context docs/i);
  assert.doesNotMatch(reply, /https?:\/\//i);
  assert.doesNotMatch(reply, /npx thumbgate init/i);
});

test('generateReply returns null for hostile meta reddit comments', async () => {
  const reply = await generateReply(
    'This sounds like bot spam and not what I asked for.',
    {
      platform: 'reddit',
      author: 'someone_else',
      isQuestion: false,
    }
  );

  assert.equal(reply, null);
});
