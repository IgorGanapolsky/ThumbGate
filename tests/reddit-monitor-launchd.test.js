const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildRedditMonitorPlist,
} = require('../scripts/reddit-monitor-launchd');

test('reddit monitor LaunchAgent does not inject writable PATH entries', () => {
  const plist = buildRedditMonitorPlist({
    repoDir: '/tmp/thumbgate-reddit-monitor-test',
    trackedThreads: 'https://www.reddit.com/r/ClaudeCode/comments/example/',
  });

  assert.equal(plist.includes('<key>PATH</key>'), false);
  assert.equal(plist.includes('/opt/homebrew/bin:/usr/local/bin'), false);
  assert.match(plist, /<string>\/bin\/bash<\/string>/);
});
