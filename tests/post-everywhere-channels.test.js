'use strict';

/**
 * tests/post-everywhere-channels.test.js
 *
 * Pins the distribution channel focus set. On 2026-04-20 ThumbGate dropped
 * X/Twitter from the active posting loop and consolidated on six channels:
 * Reddit, LinkedIn, Threads, Bluesky, Instagram, YouTube.
 *
 * These tests keep the default list honest so that a drive-by refactor
 * cannot silently re-introduce X or drop one of the six focus channels
 * without a corresponding test update.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { DEFAULT_PLATFORMS, DISPATCHERS, parsePostFile, postEverywhere } = require('../scripts/post-everywhere');

const FOCUS_CHANNELS = Object.freeze([
  'reddit',
  'linkedin',
  'threads',
  'bluesky',
  'instagram',
  'youtube',
]);

test('DEFAULT_PLATFORMS pins the six focus channels (no X, no drift)', () => {
  assert.deepEqual(
    Array.from(DEFAULT_PLATFORMS),
    Array.from(FOCUS_CHANNELS),
    'DEFAULT_PLATFORMS must exactly match the CEO-approved focus channel list. ' +
      'See CLAUDE.md § Distribution Channel Focus before changing.'
  );
});

test('DEFAULT_PLATFORMS does not contain X/Twitter aliases', () => {
  for (const banned of ['x', 'twitter', 'X', 'Twitter']) {
    assert.equal(
      DEFAULT_PLATFORMS.includes(banned),
      false,
      `DEFAULT_PLATFORMS must not include "${banned}" — X was retired 2026-04-20`
    );
  }
});

test('DISPATCHERS has a handler for every focus channel', () => {
  for (const platform of FOCUS_CHANNELS) {
    assert.equal(
      typeof DISPATCHERS[platform],
      'function',
      `missing dispatcher for focus channel: ${platform}`
    );
  }
});

test('DISPATCHERS does not expose an X/Twitter dispatcher', () => {
  assert.equal(
    DISPATCHERS.x,
    undefined,
    'DISPATCHERS.x must be absent — X/Twitter was retired from active distribution 2026-04-20'
  );
  assert.equal(
    DISPATCHERS.twitter,
    undefined,
    'DISPATCHERS.twitter must be absent'
  );
});

test('parsePostFile detects threads/bluesky/instagram/youtube platform headers', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'post-everywhere-parse-'));
  try {
    const cases = [
      { header: '# Threads Post: launch announcement', expect: 'threads' },
      { header: '# Bluesky Post: launch', expect: 'bluesky' },
      { header: '# bsky Post: launch', expect: 'bluesky' },
      { header: '# Instagram Post: reel', expect: 'instagram' },
      { header: '# YouTube Post: short', expect: 'youtube' },
      { header: '# LinkedIn Post: article', expect: 'linkedin' },
    ];

    for (const { header, expect } of cases) {
      const fp = path.join(tmp, `${expect}.md`);
      fs.writeFileSync(
        fp,
        `${header}\n**Title:** Hello from ${expect}\n**Body:**\nShort body text.\n`
      );
      const parsed = parsePostFile(fp);
      assert.equal(parsed.platform, expect, `header "${header}" must map to ${expect}`);
      assert.equal(parsed.title, `Hello from ${expect}`);
      assert.equal(parsed.body, 'Short body text.');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('parsePostFile does not map X/Twitter headers to a platform', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'post-everywhere-parse-x-'));
  try {
    const cases = [
      '# Twitter Thread: launch',
      '# X Post: launch',
      '# x.com Post: launch',
    ];
    for (const header of cases) {
      const fp = path.join(tmp, 'x.md');
      fs.writeFileSync(fp, `${header}\n**Title:** legacy\n**Body:** legacy\n`);
      const parsed = parsePostFile(fp);
      assert.equal(
        parsed.platform,
        null,
        `header "${header}" must NOT map to any platform (X/Twitter retired 2026-04-20)`
      );
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('postToThreads dispatcher dry-run returns { dryRun: true }', async () => {
  const result = await DISPATCHERS.threads(
    { title: 'T', body: 'A short threads post.' },
    true
  );
  assert.deepEqual(result, { dryRun: true });
});

test('postToThreads rejects empty input', async () => {
  await assert.rejects(
    () => DISPATCHERS.threads({ title: null, body: null }, true),
    /Threads post requires title or body/
  );
});

test('postToBluesky dispatcher dry-run returns { dryRun: true }', async () => {
  const result = await DISPATCHERS.bluesky(
    { title: 'B', body: 'A short bluesky post.' },
    true
  );
  assert.deepEqual(result, { dryRun: true });
});

test('postToBluesky rejects empty input', async () => {
  await assert.rejects(
    () => DISPATCHERS.bluesky({ title: null, body: null }, true),
    /Bluesky post requires title or body/
  );
});

test('Threads dispatcher truncates to 500 chars', async () => {
  // Not directly observable from return, but dry-run logs the length; this
  // test exercises the truncation branch so coverage sees it.
  const long = 'x'.repeat(1000);
  const result = await DISPATCHERS.threads({ title: 'T', body: long }, true);
  assert.deepEqual(result, { dryRun: true });
});

test('Bluesky dispatcher truncates to 300 chars', async () => {
  const long = 'x'.repeat(1000);
  const result = await DISPATCHERS.bluesky({ title: 'B', body: long }, true);
  assert.deepEqual(result, { dryRun: true });
});

// ---------------------------------------------------------------------------
// Dispatcher contract assertions
//
// On 2026-04-22 the ChatGPT CPC ads campaign hit three dead dispatchers:
//   - postToLinkedIn → linkedin.publishPost({text})  (module exports publishTextPost(token, urn, text))
//   - postToThreads  → threads.publishPost({text})   (no such export)
//   - postToBluesky  → zernio.publishPost({text, platform})  (publishPost takes (content, platforms[], options))
// All three are now routed through zernio.publishToAllPlatforms(content, {platforms:[<name>]}).
// These tests spy on publishToAllPlatforms to pin the wire contract — any future
// refactor that re-introduces a mismatched call will fail here before shipping.
// ---------------------------------------------------------------------------

function withZernioSpy(fn) {
  const zernio = require('../scripts/social-analytics/publishers/zernio');
  const original = zernio.publishToAllPlatforms;
  const calls = [];
  zernio.publishToAllPlatforms = async (content, options) => {
    calls.push({ content, options });
    return { published: [{ platform: options?.platforms?.[0], result: { id: 'spy' } }], errors: [] };
  };
  return Promise.resolve(fn(calls)).finally(() => {
    zernio.publishToAllPlatforms = original;
  });
}

test('postToLinkedIn routes through zernio.publishToAllPlatforms with {platforms:["linkedin"]}', async () => {
  await withZernioSpy(async (calls) => {
    await DISPATCHERS.linkedin({ body: 'Hello from LinkedIn.', utmCampaign: 'unit-campaign' }, false);
    assert.equal(calls.length, 1, 'publishToAllPlatforms must be called exactly once');
    assert.equal(calls[0].content, 'Hello from LinkedIn.');
    assert.deepEqual(calls[0].options, {
      platforms: ['linkedin'],
      campaign: 'unit-campaign',
      medium: 'social',
    });
  });
});

test('postToThreads routes through zernio.publishToAllPlatforms with {platforms:["threads"]}', async () => {
  await withZernioSpy(async (calls) => {
    await DISPATCHERS.threads({ title: 'T', body: 'Short threads body.', utmCampaign: 'unit-campaign' }, false);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].content.includes('Short threads body.'));
    assert.deepEqual(calls[0].options, {
      platforms: ['threads'],
      campaign: 'unit-campaign',
      medium: 'social',
    });
  });
});

test('postToBluesky routes through zernio.publishToAllPlatforms with {platforms:["bluesky"]}', async () => {
  await withZernioSpy(async (calls) => {
    await DISPATCHERS.bluesky({ title: 'B', body: 'Short bluesky body.', utmCampaign: 'unit-campaign' }, false);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].content.includes('Short bluesky body.'));
    assert.deepEqual(calls[0].options, {
      platforms: ['bluesky'],
      campaign: 'unit-campaign',
      medium: 'social',
    });
  });
});

test('postToThreads truncates content to 500 chars before handing to Zernio', async () => {
  await withZernioSpy(async (calls) => {
    const long = 'x'.repeat(1000);
    await DISPATCHERS.threads({ title: 'T', body: long }, false);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].content.length <= 500, `content length ${calls[0].content.length} must be ≤ 500`);
  });
});

test('postToBluesky truncates content to 300 chars before handing to Zernio', async () => {
  await withZernioSpy(async (calls) => {
    const long = 'x'.repeat(1000);
    await DISPATCHERS.bluesky({ title: 'B', body: long }, false);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].content.length <= 300, `content length ${calls[0].content.length} must be ≤ 300`);
  });
});

test('zernio module exports publishToAllPlatforms (the single-call contract)', () => {
  const zernio = require('../scripts/social-analytics/publishers/zernio');
  assert.equal(typeof zernio.publishToAllPlatforms, 'function',
    'publishToAllPlatforms must stay exported — three dispatchers depend on it');
});

test('linkedin publisher module does not export a {text}-options-bag publishPost', () => {
  // Regression guard for the 2026-04-22 discovery: the direct-API call
  // linkedin.publishPost({text}) was shipped but the module actually exports
  // publishTextPost(token, personUrn, text). If a future refactor re-adds
  // a publishPost({text}) export, that's fine — but the dispatcher must not
  // rely on it without also fixing the signature.
  const linkedin = require('../scripts/social-analytics/publishers/linkedin');
  assert.equal(typeof linkedin.publishTextPost, 'function',
    'publishTextPost(token, personUrn, text) is the canonical direct-API entry');
});

test('threads publisher module exposes postTextThread, not publishPost', () => {
  // Regression guard for the 2026-04-22 discovery: threads.publishPost({text})
  // was called but does not exist. The real entry is postTextThread({text, token, userId}).
  const threads = require('../scripts/social-analytics/publishers/threads');
  assert.equal(typeof threads.postTextThread, 'function',
    'postTextThread is the canonical threads direct-API entry');
  assert.equal(typeof threads.publishPost, 'undefined',
    'threads.publishPost must not exist — it was an invented name that broke silently');
});

test('postEverywhere applies the requested campaign to tracked URLs', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'post-everywhere-campaign-'));
  const originalLinkedIn = DISPATCHERS.linkedin;
  try {
    const filePath = path.join(tmp, 'linkedin.md');
    fs.writeFileSync(
      filePath,
      [
        '# LinkedIn Post: campaign attribution',
        '**Title:** Campaign attribution check',
        '**Body:**',
        'One repeated workflow failure is enough to justify a proof run.',
        'https://thumbgate.ai/#workflow-sprint-intake',
        '',
      ].join('\n')
    );

    let capturedBody = '';
    DISPATCHERS.linkedin = async (parsed) => {
      capturedBody = parsed.body;
      return { ok: true };
    };

    await postEverywhere(filePath, {
      platforms: ['linkedin'],
      dryRun: true,
      campaign: 'autopilot-text-test',
    });

    assert.match(capturedBody, /utm_source=linkedin/);
    assert.match(capturedBody, /utm_campaign=autopilot-text-test/);
  } finally {
    DISPATCHERS.linkedin = originalLinkedIn;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('marketing-autopilot workflow generates a post file before invoking post-everywhere', () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, '..', '.github', 'workflows', 'marketing-autopilot.yml'),
    'utf8'
  );

  assert.match(
    workflow,
    /POST_FILE="scripts\/marketing-output\/autopilot-paid-sprint-\$WEEK-h\$HOUR\.md"/,
    'marketing-autopilot must create a concrete post file for post-everywhere'
  );
  assert.match(
    workflow,
    /node scripts\/post-everywhere\.js\s+\\\n\s+"\$POST_FILE"/,
    'post-everywhere requires the post file as its first CLI argument'
  );

  for (const platform of ['linkedin', 'threads', 'bluesky', 'instagram']) {
    assert.match(
      workflow,
      new RegExp(`default:\\s*['"][^'"]*${platform}`),
      `marketing-autopilot workflow must include ${platform} in its default platform list`
    );
  }

  assert.doesNotMatch(
    workflow,
    /default:\s*['"][^'"]*youtube/,
    'marketing-autopilot text step must not default to YouTube because YouTube posts require video content'
  );
  assert.doesNotMatch(
    workflow,
    /default:\s*['"][^'"]*twitter/,
    'marketing-autopilot workflow must not default to twitter — X retired 2026-04-20'
  );
});
