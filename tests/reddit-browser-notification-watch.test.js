'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  ageMinutes,
  isRecentNotification,
  parseNotificationBlocks,
  scoreNotification,
  run,
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

test('run handles parsing, state caching, and appending notifications', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reddit-watch-test-'));
  const stateFile = path.join(tmpDir, 'state.json');
  const eventsFile = path.join(tmpDir, 'events.jsonl');

  process.env.THUMBGATE_REDDIT_BROWSER_STATE_FILE = stateFile;
  process.env.THUMBGATE_REDDIT_BROWSER_EVENTS_FILE = eventsFile;

  try {
    const mockNotifications = [
      {
        author: 'leogodin217',
        kind: 'accepted your chat invite!',
        preview: 'Hi',
        age: '1h ago',
        ageMinutes: 60,
        score: 5,
        reasons: ['chat_accepted'],
        fingerprint: 'leogodin217|accepted your chat invite!||hi|1h ago',
      },
    ];

    const result = await run({
      dryRun: false,
      readNotifications: () => mockNotifications,
    });

    assert.equal(result.notifications, 1);
    assert.equal(result.fresh, 1);
    assert.equal(result.actionable, 1);

    // Verify files were written
    assert.ok(fs.existsSync(stateFile));
    assert.ok(fs.existsSync(eventsFile));

    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.ok(state.seen[mockNotifications[0].fingerprint]);

    const events = fs.readFileSync(eventsFile, 'utf8').trim().split('\n');
    assert.equal(events.length, 1);
    const parsedEvent = JSON.parse(events[0]);
    assert.equal(parsedEvent.author, 'leogodin217');

    // Run again - should not be fresh
    const result2 = await run({
      dryRun: false,
      readNotifications: () => mockNotifications,
    });
    assert.equal(result2.fresh, 0);
    assert.equal(result2.actionable, 0);

  } finally {
    delete process.env.THUMBGATE_REDDIT_BROWSER_STATE_FILE;
    delete process.env.THUMBGATE_REDDIT_BROWSER_EVENTS_FILE;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
});
