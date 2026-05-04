const assert = require('node:assert/strict');
const cp = require('node:child_process');
const test = require('node:test');

const {
  buildBlueskyMonitorPlist,
  buildBlueskyMonitorStatus,
  loadLaunchAgent,
} = require('../scripts/bluesky-monitor-launchd');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('bluesky monitor LaunchAgent does not inject writable PATH entries', () => {
  const plist = buildBlueskyMonitorPlist({
    repoDir: '/tmp/thumbgate-bluesky-monitor-test',
    nodeBin: '/opt/homebrew/bin/node',
  });

  assert.equal(plist.includes('<key>PATH</key>'), false);
  assert.equal(plist.includes('/opt/homebrew/bin:/usr/local/bin'), false);
  assert.match(plist, /<string>\/bin\/bash<\/string>/);
  assert.match(plist, /bluesky-monitor-cron\.sh/);
  assert.match(plist, /<key>NODE_BIN<\/key>/);
  assert.match(plist, /<string>\/opt\/homebrew\/bin\/node<\/string>/);
});

test('bluesky monitor LaunchAgent can opt into approved-draft publishing only', () => {
  const plist = buildBlueskyMonitorPlist({
    repoDir: '/tmp/thumbgate-bluesky-monitor-test',
    publishApproved: true,
  });

  assert.match(plist, /<key>THUMBGATE_BLUESKY_PUBLISH_APPROVED<\/key>/);
  assert.match(plist, /<string>true<\/string>/);
  assert.doesNotMatch(plist, /BLUESKY_APP_PASSWORD/);
});

test('bluesky monitor launchctl calls use a fixed unwritable system PATH', (t) => {
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

test('bluesky monitor status reports readiness without leaking credentials', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-bluesky-status-'));
  fs.mkdirSync(path.join(tmp, '.thumbgate'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.env'), [
    'BLUESKY_HANDLE=iganapolsky.bsky.social',
    'BLUESKY_APP_PASSWORD=super-secret-app-password',
  ].join('\n'));
  fs.writeFileSync(path.join(tmp, '.thumbgate', 'reply-monitor-state.json'), JSON.stringify({
    lastCheck: { bluesky: '2026-05-04T15:00:00.000Z' },
  }));
  fs.writeFileSync(path.join(tmp, '.thumbgate', 'reply-drafts.jsonl'), [
    JSON.stringify({ platform: 'bluesky', draftReply: 'draft one' }),
    JSON.stringify({ platform: 'bluesky', approved: true, draftReply: 'approved' }),
    JSON.stringify({ platform: 'reddit', draftReply: 'not counted' }),
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(tmp, '.thumbgate', 'bluesky-monitor.log'), 'first\nlast line\n');

  const status = buildBlueskyMonitorStatus({
    repoDir: tmp,
    plistPath: path.join(tmp, 'com.thumbgate.bluesky-monitor.plist'),
    env: {},
  });
  const serialized = JSON.stringify(status);

  assert.equal(status.credentials.BLUESKY_HANDLE, true);
  assert.equal(status.credentials.BLUESKY_APP_PASSWORD, true);
  assert.equal(status.canMonitor, true);
  assert.equal(status.drafts.blueskyCount, 2);
  assert.equal(status.drafts.approvedUnpostedCount, 1);
  assert.equal(status.state.lastCheck, '2026-05-04T15:00:00.000Z');
  assert.equal(status.log.lastLine, 'last line');
  assert.doesNotMatch(serialized, /super-secret-app-password/);
  assert.doesNotMatch(serialized, /iganapolsky\.bsky\.social/);

  fs.rmSync(tmp, { recursive: true, force: true });
});
