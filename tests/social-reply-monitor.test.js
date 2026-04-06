'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildOwnedConversationQuery,
  collectXSearchCandidates,
  isRevenueRelevantXTweet,
} = require('../scripts/social-reply-monitor');

test('isRevenueRelevantXTweet focuses on ThumbGate launch and monetization tweets', () => {
  assert.equal(isRevenueRelevantXTweet({ text: 'ThumbGate blocks repeated mistakes before they run.' }), true);
  assert.equal(isRevenueRelevantXTweet({ text: 'Start Pro: https://thumbgate-production.up.railway.app/checkout/pro' }), true);
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
