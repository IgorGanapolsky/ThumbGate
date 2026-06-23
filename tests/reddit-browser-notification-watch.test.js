'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ageMinutes,
  isRecentNotification,
  parseNotificationBlocks,
  scoreNotification,
} = require('../scripts/reddit-browser-notification-watch');

test('parseNotificationBlocks extracts Reddit chat and reply notifications', () => {
  const notifications = parseNotificationBlocks(`
Notifications
Mark all as read
leogodin217
leogodin217 accepted your chat invite!
1h ago
u/ClaudeAI-mod-bot replied to your post in r/ClaudeAI
Thanks for submitting your work to r/ClaudeAI! Please submit your project as a comment in the Megathread.
2h ago
u/Obvious_Gap_5768 replied to your comment in r/ClaudeCode
Yeah the decisions layer was the one that surprised me most too.
10d ago
  `);

  assert.equal(notifications.length, 3);
  assert.equal(notifications[0].author, 'leogodin217');
  assert.match(notifications[0].kind, /accepted your chat invite/i);
  assert.equal(notifications[0].preview, '');
  assert.equal(notifications[0].age, '1h ago');
  assert.equal(notifications[0].ageMinutes, 60);
  assert.equal(notifications[1].subreddit, 'ClaudeAI');
  assert.equal(notifications[2].subreddit, 'ClaudeCode');
  assert.ok(notifications[0].fingerprint);
});

test('scoreNotification prioritizes buyer signals and suppresses hostile/meta replies', () => {
  const buyer = scoreNotification({
    author: 'leogodin217',
    kind: 'leogodin217 accepted your chat invite!',
    preview: 'I am interested in ThumbGate and a Workflow Hardening Diagnostic.',
  });
  assert.ok(buyer.score > 5);
  assert.ok(buyer.reasons.includes('chat_accepted'));
  assert.ok(buyer.reasons.includes('buyer_signal'));

  const hostile = scoreNotification({
    author: 'someone',
    kind: 'u/someone replied to your post in r/devops',
    preview: 'This is spam bot slop.',
  });
  assert.ok(hostile.score < 0);
  assert.ok(hostile.reasons.includes('hostile_or_meta'));
});

test('age helpers keep heartbeat action focused on recent Reddit signals', () => {
  assert.equal(ageMinutes('Just now'), 0);
  assert.equal(ageMinutes('2h ago'), 120);
  assert.equal(ageMinutes('3d ago'), 4320);
  assert.equal(isRecentNotification({ age: '1h ago' }), true);
  assert.equal(isRecentNotification({ age: '10d ago' }), false);
});
