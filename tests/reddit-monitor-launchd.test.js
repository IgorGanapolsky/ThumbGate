const assert = require('node:assert/strict');
const cp = require('node:child_process');
const test = require('node:test');

const {
  buildRedditMonitorPlist,
  loadLaunchAgent,
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

test('reddit monitor launchctl calls use a fixed unwritable system PATH', (t) => {
  const calls = [];
  const originalExecFileSync = cp.execFileSync;
  cp.execFileSync = (binary, args, options) => {
    calls.push({ binary, args, options });
    if (args[0] === 'bootout') throw new Error('not loaded');
    return Buffer.from('');
  };
  t.after(() => {
    cp.execFileSync = originalExecFileSync;
  });

  loadLaunchAgent('/Users/test/Library/LaunchAgents/com.thumbgate.test.plist');

  assert.equal(calls.length, 3);
  calls.forEach((call) => {
    assert.equal(call.binary, '/bin/launchctl');
    assert.deepEqual(call.options.env, { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' });
  });
});
