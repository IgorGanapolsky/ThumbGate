#!/usr/bin/env node
/**
 * render.js — headless-record the ThumbGate explainer animation to MP4.
 *
 * 1. Loads scripts/render-demo-video/index.html in a 1920x1080 chromium page.
 * 2. Records the viewport for ~92 s (timeline is 90 s + 1.5 s head/tail).
 * 3. Uses Playwright's built-in video recording (webm) → ffmpeg → H.264 mp4.
 * 4. If scripts/render-demo-video/narration.mp3 exists, muxes it into the final mp4.
 *
 * Usage:
 *   node scripts/render-demo-video/render.js
 *   node scripts/render-demo-video/render.js --out=public/assets/tiktok-agent-memory.mp4
 *
 * Dependencies: playwright-core (installed), ffmpeg on PATH.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const {
  buildVirtualClockTimeline,
  seekVirtualClockFrame,
  checkSceneGate,
  verifyMp4ArtifactCompletion,
} = require('../cli-demo');
const ROOT = path.resolve(__dirname, '../..');
const HTML = path.join(__dirname, 'index.html');
const DEFAULT_OUT = path.join(ROOT, 'public/assets/tiktok-agent-memory.mp4');
const AUDIO = path.join(__dirname, 'narration.mp3');

const WIDTH = 1920;
const HEIGHT = 1080;
const TIMELINE_MS = 95_000;
const TAIL_MS = 1_000;

function parseArgs(argv) {
  const out = { out: DEFAULT_OUT };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--out=')) out.out = path.resolve(ROOT, a.slice(6));
  }
  return out;
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}`);
}

async function main() {
  const args = parseArgs(process.argv);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-render-'));
  const videoDir = path.join(workDir, 'video');
  fs.mkdirSync(videoDir, { recursive: true });

  console.log(`[render] launching headless chromium (1920x1080)`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    recordVideo: { dir: videoDir, size: { width: WIDTH, height: HEIGHT } },
  });
  const page = await context.newPage();
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push(err.message || String(err)));

  const timelineSpec = buildVirtualClockTimeline({
    durationSeconds: TIMELINE_MS / 1000,
    fps: 30,
    width: WIDTH,
    height: HEIGHT,
    crf: 18,
  });
  await page.addInitScript((fps) => {
    window.__virtualClockFrame = 0;
    window.__virtualClockFps = fps;
    window.__seekVirtualFrame = (idx) => {
      window.__virtualClockFrame = idx;
      window.__virtualTimeMs = (idx / fps) * 1000;
    };
  }, timelineSpec.fps);
  await page.goto('file://' + HTML);
  const sampleCheck = seekVirtualClockFrame(0, timelineSpec.fps);
  await page.evaluate((idx) => window.__seekVirtualFrame && window.__seekVirtualFrame(idx), sampleCheck.frameIndex);
  const initialText = await page.evaluate(() => (document.body && document.body.innerText) || '');
  const sceneCheck = checkSceneGate({
    jsErrors,
    sampleFrames: [{ timestampSeconds: 0, visibleText: initialText }],
  });
  if (!sceneCheck.readyToRender) {
    await context.close();
    await browser.close();
    throw new Error(`[check_scene] aborted before ffmpeg encode: ${sceneCheck.reason}`);
  }

  // timelineSpec initialized before page load so virtual clock is injected deterministically.
  console.log(`[render] playing timeline (${(TIMELINE_MS + TAIL_MS) / 1000}s, codec=${timelineSpec.codec}, crf=${timelineSpec.crf})`);

  // Wait for the timeline flag set at t=90s, then a tail for the last scene to settle.
  await page.waitForFunction(() => window.__renderDone === true, null, { timeout: TIMELINE_MS + 10_000, polling: 250 });
  await page.waitForTimeout(TAIL_MS);

  const videoHandle = page.video();
  await context.close();
  await browser.close();

  const webmPath = await videoHandle.path();
  console.log(`[render] raw webm captured: ${webmPath}`);

  const silentMp4 = path.join(workDir, 'silent.mp4');
  console.log(`[render] transcoding webm → silent mp4 (H.264, yuv420p, ${timelineSpec.fps} fps, crf ${timelineSpec.crf})`);
  sh('ffmpeg', [
    '-y',
    '-i', webmPath,
    '-c:v', timelineSpec.codec,
    '-preset', 'medium',
    '-crf', String(timelineSpec.crf),
    '-pix_fmt', timelineSpec.pixelFormat,
    '-r', String(timelineSpec.fps),
    '-movflags', '+faststart',
    silentMp4,
  ]);
  fs.mkdirSync(path.dirname(args.out), { recursive: true });

  if (fs.existsSync(AUDIO)) {
    console.log(`[render] muxing narration → ${path.relative(ROOT, args.out)}`);
    sh('ffmpeg', [
      '-y',
      '-i', silentMp4,
      '-i', AUDIO,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '160k',
      '-shortest',
      '-movflags', '+faststart',
      args.out,
    ]);
  } else {
    console.log(`[render] no narration.mp3 found — writing silent video (add audio later with ffmpeg)`);
    fs.copyFileSync(silentMp4, args.out);
  }

  const size = fs.statSync(args.out).size;
  const completion = verifyMp4ArtifactCompletion({
    events: ['tool.started', 'tool.completed', 'turn.completed'],
    blobArtifact: { url: args.out, sizeBytes: size },
  });
  if (!completion.done) {
    throw new Error(`[render] MP4 completion verification failed: ${completion.status}`);
  }
  console.log(`\n✅ wrote ${(size / 1024 / 1024).toFixed(2)} MB → ${path.relative(ROOT, args.out)} (${completion.status})`);
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
