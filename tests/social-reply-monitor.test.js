'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildOwnedConversationQuery,
  collectXSearchCandidates,
  generateReply,
  isRevenueRelevantXTweet,
} = require('../scripts/social-reply-monitor');

test('isRevenueRelevantXTweet focuses on ThumbGate launch and monetization tweets', () => {
  assert.equal(isRevenueRelevantXTweet({ text: 'ThumbGate blocks repeated mistakes before they run.' }), true);
  assert.equal(isRevenueRelevantXTweet({ text: 'Start Pro: https://thumbgate.ai/checkout/pro' }), true);
  assert.equal(isRevenueRelevantXTweet({ text: 'Totally unrelated personal update.' }), false);
});

test('buildOwnedConversationQuery targets replies around a specific owned tweet', () => {
  assert.equal(
    buildOwnedConversationQuery('2041214638096814368', 'IgorGanapolsky'),
    'conversation_id:2041214638096814368 -from:IgorGanapolsky'
  );
});

test('collectXSearchCandidates searches owned ThumbGate conversations before keyword fallback', async () => {
  const calls = [];
  const result = await collectXSearchCandidates({
    ownUserId: '1733256637199073280',
    username: 'IgorGanapolsky',
    fetchOwnedTweets: async () => ([
      { id: 'launch_1', text: 'ThumbGate launch post with checkout link' },
      { id: 'personal_1', text: 'having coffee' },
    ]),
    searchTweets: async (query) => {
      calls.push(query);
      if (query.includes('launch_1')) {
        return [
          { id: 'reply_1', text: 'How does this compare to Mem0?', author_id: 'user_1' },
        ];
      }
      return [];
    },
  });

  assert.equal(result.searchMode, 'owned_conversations');
  assert.equal(result.tweets.length, 1);
  assert.equal(result.tweets[0].id, 'reply_1');
  assert.deepEqual(calls, ['conversation_id:launch_1 -from:IgorGanapolsky']);
});

test('collectXSearchCandidates falls back to keyword search when owned tweet replies are unavailable', async () => {
  const calls = [];
  const result = await collectXSearchCandidates({
    ownUserId: '1733256637199073280',
    username: 'IgorGanapolsky',
    fetchOwnedTweets: async () => ([
      { id: 'launch_1', text: 'ThumbGate launch post with checkout link' },
    ]),
    searchTweets: async (query) => {
      calls.push(query);
      if (query === 'thumbgate OR ThumbGate OR "pre-action gates"') {
        return { data: [{ id: 'mention_1', text: 'ThumbGate looks useful', author_id: 'user_2' }] };
      }
      return [];
    },
  });

  assert.equal(result.searchMode, 'keyword_fallback');
  assert.equal(result.tweets.length, 1);
  assert.equal(result.tweets[0].id, 'mention_1');
  assert.deepEqual(calls, [
    'conversation_id:launch_1 -from:IgorGanapolsky',
    'thumbgate OR ThumbGate OR "pre-action gates"',
  ]);
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
