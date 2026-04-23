'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const {
  DEFAULT_ASSET_HTML,
  DEFAULT_CAPTION_PATH,
  DEFAULT_HISTORY_PATH,
  appendPublishAttemptEvent,
  assertPublishNotDuplicated,
  buildPublishFingerprint,
  buildChromeJavaScriptAppleScript,
  buildContentEditableCaptionScript,
  buildLaunchAgentPlist,
  enqueueBundle,
  extractSlideBlocks,
  getDueEntries,
  loadQueueState,
  loadPublishHistory,
  normalizeTikTokCaption,
  preflightTikTokSession,
  prepareBundle,
  publishBundle,
  removeDirectoryWithRetries,
  resolveTikTokPublishTarget,
  stopChromeProcess,
  validateSlideImages,
  waitForProcessExit,
  writeIsolatedSlideDocuments,
} = require('../scripts/social-pipeline');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makePngBuffer(width, height) {
  const buffer = Buffer.alloc(33);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  buffer[24] = 8;
  buffer[25] = 6;
  buffer[26] = 0;
  buffer[27] = 0;
  buffer[28] = 0;
  buffer.writeUInt32BE(0, 29);
  return buffer;
}

test('canonical IG carousel asset exposes five slide blocks', () => {
  const html = fs.readFileSync(DEFAULT_ASSET_HTML, 'utf8');
  const slides = extractSlideBlocks(html);
  assert.equal(slides.length, 5);
  assert.match(slides[0], /slide-1/);
  assert.match(slides[4], /slide-5/);
});

test('isolated slide documents are generated from the canonical HTML asset', () => {
  const tempDir = makeTempDir('social-slides-');
  const documents = writeIsolatedSlideDocuments({
    sourceHtmlPath: DEFAULT_ASSET_HTML,
    outputDir: tempDir,
  });

  assert.equal(documents.length, 5);
  assert.equal(fs.existsSync(documents[0]), true);
  assert.match(fs.readFileSync(documents[0], 'utf8'), /slide-1/);
  assert.match(fs.readFileSync(documents[0], 'utf8'), /\.slide-label \{ display: none !important; \}/);
});

test('prepareBundle writes bundle manifest, captions, and deterministic asset paths', () => {
  const tempDir = makeTempDir('social-bundle-');
  const result = prepareBundle({
    sourceHtmlPath: DEFAULT_ASSET_HTML,
    captionPath: DEFAULT_CAPTION_PATH,
    outputDir: tempDir,
    slug: 'pre-action-checks',
    chromeBin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ffmpegBin: '/opt/homebrew/bin/ffmpeg',
    renderSlidesFn: ({ slideDocuments, outputDir }) => {
      return slideDocuments.map((_, index) => {
        const outPath = path.join(outputDir, `slide-${String(index + 1).padStart(2, '0')}.png`);
        fs.writeFileSync(outPath, makePngBuffer(1080, 1080));
        return outPath;
      });
    },
    renderTikTokVideoFn: ({ outputPath }) => {
      fs.writeFileSync(outputPath, 'video');
      return outputPath;
    },
  });

  assert.equal(fs.existsSync(result.manifestPath), true);
  assert.equal(result.manifest.slideImagePaths.length, 5);
  assert.equal(result.manifest.slideImageMetadata.length, 5);
  assert.equal(fs.existsSync(result.manifest.instagramCaptionPath), true);
  assert.equal(fs.existsSync(result.manifest.tiktokCaptionPath), true);
  assert.equal(fs.existsSync(result.manifest.tiktokVideoPath), true);
  assert.match(result.manifest.hashes.instagramCaptionSha256, /^[a-f0-9]{64}$/);
  assert.match(result.manifest.hashes.tiktokVideoSha256, /^[a-f0-9]{64}$/);
  assert.match(
    fs.readFileSync(result.manifest.tiktokCaptionPath, 'utf8'),
    /Pre-Action Checks don't ask - they enforce\./
  );
});

test('queue state persists pending entries and due filtering only returns scheduled work', () => {
  const tempDir = makeTempDir('social-queue-');
  const bundlePath = path.join(tempDir, 'bundle.json');
  const queuePath = path.join(tempDir, 'queue.json');

  fs.writeFileSync(bundlePath, JSON.stringify({ id: 'bundle-1' }));
  const entry = enqueueBundle({
    queuePath,
    bundlePath,
    scheduledAt: '2026-03-20T10:00:00.000Z',
    platforms: ['instagram', 'tiktok'],
  });

  const queueState = loadQueueState(queuePath);
  assert.equal(queueState.entries.length, 1);
  assert.equal(queueState.entries[0].id, entry.id);

  const due = getDueEntries(queueState, new Date('2026-03-20T10:01:00.000Z'));
  assert.equal(due.length, 1);
  assert.equal(due[0].bundleId, 'bundle-1');

  const notDue = getDueEntries(queueState, new Date('2026-03-20T09:59:00.000Z'));
  assert.equal(notDue.length, 0);
});

test('enqueueBundle is idempotent for the same pending bundle, schedule, and platforms', () => {
  const tempDir = makeTempDir('social-queue-dedupe-');
  const bundlePath = path.join(tempDir, 'bundle.json');
  const queuePath = path.join(tempDir, 'queue.json');

  fs.writeFileSync(bundlePath, JSON.stringify({ id: 'bundle-1' }));
  const first = enqueueBundle({
    queuePath,
    bundlePath,
    scheduledAt: '2026-03-20T10:00:00.000Z',
    platforms: ['tiktok', 'instagram', 'instagram'],
  });
  const second = enqueueBundle({
    queuePath,
    bundlePath,
    scheduledAt: '2026-03-20T10:00:00.000Z',
    platforms: ['instagram', 'tiktok'],
  });

  const queueState = loadQueueState(queuePath);
  assert.equal(first.id, second.id);
  assert.deepEqual(first.platforms, ['instagram', 'tiktok']);
  assert.equal(queueState.entries.length, 1);
});

test('Chrome AppleScript only focuses a window/tab when it is not already frontmost', () => {
  const script = buildChromeJavaScriptAppleScript({
    urlPrefix: 'https://www.instagram.com/',
    openUrl: 'https://www.instagram.com/',
    tempJsPath: '/tmp/social-proof.js',
  });

  assert.match(script, /if \(index of targetWindow\) is not 1 then set index of targetWindow to 1/);
  assert.match(script, /if \(active tab index of targetWindow\) is not targetTabIndex then set active tab index of targetWindow to targetTabIndex/);
});

test('normalizeTikTokCaption collapses multiline IG captions to one line', () => {
  const input = [
    'Every AI memory tool asks the agent to cooperate.',
    'Pre-Action Checks do not ask — they enforce.',
    '#OpenSource',
  ].join('\n');

  assert.equal(
    normalizeTikTokCaption(input),
    'Every AI memory tool asks the agent to cooperate. Pre-Action Checks do not ask - they enforce. #OpenSource'
  );
});

test('validateSlideImages enforces five non-empty 1080x1080 PNG slides', () => {
  const tempDir = makeTempDir('social-validate-');
  const slidePaths = [];
  for (let index = 0; index < 5; index += 1) {
    const slidePath = path.join(tempDir, `slide-${index + 1}.png`);
    fs.writeFileSync(slidePath, makePngBuffer(1080, 1080));
    slidePaths.push(slidePath);
  }

  const metadata = validateSlideImages(slidePaths);
  assert.equal(metadata.length, 5);
  assert.equal(metadata[0].width, 1080);
  assert.equal(metadata[0].height, 1080);
  assert.match(metadata[0].sha256, /^[a-f0-9]{64}$/);
});

test('prepareBundle accepts inline caption text and persists it as a source file', () => {
  const tempDir = makeTempDir('social-inline-caption-');
  const caption = 'The only MCP tool that learns from failures AND enforces what it learns.';
  const result = prepareBundle({
    sourceHtmlPath: DEFAULT_ASSET_HTML,
    captionText: caption,
    outputDir: tempDir,
    slug: 'inline-caption',
    chromeBin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ffmpegBin: '/opt/homebrew/bin/ffmpeg',
    renderSlidesFn: ({ slideDocuments, outputDir }) => slideDocuments.map((_, index) => {
      const outPath = path.join(outputDir, `slide-${String(index + 1).padStart(2, '0')}.png`);
      fs.writeFileSync(outPath, makePngBuffer(1080, 1080));
      return outPath;
    }),
    renderTikTokVideoFn: ({ outputPath }) => {
      fs.writeFileSync(outputPath, 'video');
      return outputPath;
    },
  });

  assert.equal(fs.existsSync(result.manifest.captionPath), true);
  assert.equal(fs.readFileSync(result.manifest.captionPath, 'utf8').trim(), caption);
});

test('publishBundle dry-run returns both platforms without requiring a browser session', async () => {
  const tempDir = makeTempDir('social-post-dry-run-');
  const prepared = prepareBundle({
    sourceHtmlPath: DEFAULT_ASSET_HTML,
    captionPath: DEFAULT_CAPTION_PATH,
    outputDir: tempDir,
    slug: 'dry-run-social-post',
    chromeBin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ffmpegBin: '/opt/homebrew/bin/ffmpeg',
    renderSlidesFn: ({ slideDocuments, outputDir }) => slideDocuments.map((_, index) => {
      const outPath = path.join(outputDir, `slide-${String(index + 1).padStart(2, '0')}.png`);
      fs.writeFileSync(outPath, makePngBuffer(1080, 1080));
      return outPath;
    }),
    renderTikTokVideoFn: ({ outputPath }) => {
      fs.writeFileSync(outputPath, 'video');
      return outputPath;
    },
  });

  const results = await publishBundle(prepared.manifestPath, {
    platforms: 'instagram,tiktok',
    dryRun: true,
    browserBackend: 'apple-events',
  });

  assert.equal(results.length, 2);
  assert.deepEqual(results.map((entry) => entry.platform), ['instagram', 'tiktok']);
  assert.equal(results[0].mode, 'dry-run');
  assert.equal(results[1].publishType, 'video');
});

test('duplicate publish protection blocks an already-published matching payload', () => {
  const tempDir = makeTempDir('social-history-');
  const historyPath = path.join(tempDir, 'history.jsonl');
  const assetPath = path.join(tempDir, 'slide-01.png');
  fs.writeFileSync(assetPath, makePngBuffer(1080, 1080));
  const fingerprint = buildPublishFingerprint({
    platform: 'instagram',
    captionText: 'Repeated content',
    assetPaths: [assetPath],
  });

  fs.writeFileSync(historyPath, JSON.stringify({
    platform: 'instagram',
    status: 'published',
    fingerprint,
    publishedAt: '2026-03-21T12:00:00.000Z',
  }) + '\n');

  assert.throws(
    () => assertPublishNotDuplicated({ historyPath, fingerprint, platform: 'instagram' }),
    /Duplicate instagram publish blocked/
  );
  assert.equal(loadPublishHistory(historyPath).length, 1);
});

test('appendPublishAttemptEvent preserves prior attempt metadata and appends events', () => {
  const tempDir = makeTempDir('social-attempt-events-');
  const recordPath = path.join(tempDir, 'attempt.json');

  fs.writeFileSync(recordPath, JSON.stringify({
    attemptId: 'instagram-123',
    platform: 'instagram',
    status: 'started',
  }, null, 2));

  appendPublishAttemptEvent(recordPath, {
    type: 'upload-complete',
    recordedAt: '2026-03-21T18:00:00.000Z',
  });
  appendPublishAttemptEvent(recordPath, {
    type: 'editor-state',
    recordedAt: '2026-03-21T18:00:01.000Z',
  });

  const attempt = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  assert.equal(attempt.attemptId, 'instagram-123');
  assert.equal(attempt.status, 'started');
  assert.equal(attempt.lastEventAt, '2026-03-21T18:00:01.000Z');
  assert.deepEqual(attempt.events.map((event) => event.type), ['upload-complete', 'editor-state']);
});

test('preflightTikTokSession reports a precise unauthenticated failure instead of a bare timeout', async () => {
  const session = {
    async poll() {
      throw new Error('Timed out waiting for browser state on https://www.tiktok.com/tiktokstudio/');
    },
    async evaluate() {
      return JSON.stringify({
        url: 'https://www.tiktok.com/login',
        title: 'Log in | TikTok',
        body: 'Log in to TikTok',
        state: 'waiting',
        loggedOut: true,
      });
    },
  };

  await assert.rejects(
    () => preflightTikTokSession(session),
    /TikTok session unavailable in the selected Chrome profile\./
  );
});

test('preflightTikTokSession reports the last observed page state on timeout', async () => {
  const tempDir = makeTempDir('social-tiktok-preflight-');
  const attempt = {
    attemptId: 'tiktok-timeout',
    recordPath: path.join(tempDir, 'attempt.json'),
  };
  const session = {
    async poll() {
      throw new Error('Timed out waiting for browser state on https://www.tiktok.com/tiktokstudio/');
    },
    async evaluate() {
      return JSON.stringify({
        url: 'https://www.tiktok.com/tiktokstudio/upload?lang=en',
        title: 'TikTok Studio',
        state: 'waiting',
        body: '',
      });
    },
  };

  await assert.rejects(
    () => preflightTikTokSession(session, attempt),
    /TikTok did not reach an authenticated upload surface/
  );

  const record = JSON.parse(fs.readFileSync(attempt.recordPath, 'utf8'));
  assert.equal(record.status, 'preflight-timeout');
  assert.equal(record.state.state, 'waiting');
});

test('removeDirectoryWithRetries recovers from a transient ENOTEMPTY cleanup error', async () => {
  const tempDir = makeTempDir('social-cleanup-');
  fs.writeFileSync(path.join(tempDir, 'proof.txt'), 'ok');

  const originalRmSync = fs.rmSync;
  let calls = 0;
  fs.rmSync = function patchedRmSync(targetPath, options) {
    calls += 1;
    if (calls === 1) {
      const error = new Error('directory not empty');
      error.code = 'ENOTEMPTY';
      throw error;
    }
    return originalRmSync.call(fs, targetPath, options);
  };

  try {
    await removeDirectoryWithRetries(tempDir, { attempts: 3, delayMs: 0 });
  } finally {
    fs.rmSync = originalRmSync;
  }

  assert.ok(calls >= 2);
  assert.equal(fs.existsSync(tempDir), false);
});

test('stopChromeProcess terminates a spawned child before temp-profile cleanup', async () => {
  const child = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], {
    stdio: 'ignore',
  });

  await stopChromeProcess(child, 2000);
  await waitForProcessExit(child, 2000);

  assert.ok(child.exitCode !== null || child.signalCode !== null);
});

test('contenteditable caption script embeds the caption without requiring System Events', () => {
  const script = buildContentEditableCaptionScript('Pre-Action Checks');
  assert.match(script, /Pre-Action Checks/);
  assert.doesNotMatch(script, /System Events/);
});

test('TikTok publish target prefers photo carousel when the surface supports image uploads', () => {
  const bundle = {
    slideImagePaths: ['/tmp/slide-01.png', '/tmp/slide-02.png'],
    tiktokCaptionPath: '/tmp/tiktok.txt',
    platforms: {
      tiktok: {
        photoAssetPaths: ['/tmp/slide-01.png', '/tmp/slide-02.png'],
        videoAssetPath: '/tmp/fallback.mp4',
      },
    },
  };

  const photoTarget = resolveTikTokPublishTarget(bundle, { state: 'photo-upload-ready' });
  const videoTarget = resolveTikTokPublishTarget(bundle, { state: 'video-upload-ready' });

  assert.equal(photoTarget.type, 'photo-carousel');
  assert.deepEqual(photoTarget.assetPaths, ['/tmp/slide-01.png', '/tmp/slide-02.png']);
  assert.equal(videoTarget.type, 'video');
  assert.deepEqual(videoTarget.assetPaths, ['/tmp/fallback.mp4']);
});

test('launchd plist targets publish-queue on a fixed interval', () => {
  const plist = buildLaunchAgentPlist({
    label: 'io.github.IgorGanapolsky.test-social',
    repoRoot,
    queuePath: path.join(repoRoot, '.thumbgate', 'social-post-queue.json'),
    intervalMinutes: 30,
    nodeBin: '/usr/local/bin/node',
    scriptPath: path.join(repoRoot, 'scripts', 'social-pipeline.js'),
  });

  assert.match(plist, /io\.github\.IgorGanapolsky\.test-social/);
  assert.match(plist, /publish-queue/);
  assert.match(plist, /social-post-queue\.json/);
  assert.match(plist, /<integer>1800<\/integer>/);
});
