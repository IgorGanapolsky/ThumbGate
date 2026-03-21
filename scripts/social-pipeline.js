'use strict';

const cp = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_ASSET_HTML = path.join(
  REPO_ROOT,
  'docs',
  'marketing',
  'assets',
  'pre-action-gates-instagram-carousel.html'
);
const DEFAULT_CAPTION_PATH = path.join(
  REPO_ROOT,
  'docs',
  'marketing',
  'assets',
  'pre-action-gates-caption.txt'
);
const DEFAULT_OUTPUT_ROOT = path.join(REPO_ROOT, '.artifacts', 'social');
const DEFAULT_QUEUE_PATH = path.join(REPO_ROOT, '.rlhf', 'social-post-queue.json');
const DEFAULT_HISTORY_PATH = path.join(REPO_ROOT, '.rlhf', 'social-post-history.jsonl');
const DEFAULT_LAUNCHD_LABEL = 'io.github.IgorGanapolsky.mcp-memory-gateway.social';
const DEFAULT_SCHEDULE_INTERVAL_MINUTES = 15;
const DEFAULT_CHROME_PROFILE_ROOT = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'Google',
  'Chrome'
);
const DEFAULT_CHROME_PROFILE_DIR = 'Default';
const DEFAULT_EXPECTED_SLIDE_COUNT = 5;
const DEFAULT_EXPECTED_SLIDE_WIDTH = 1080;
const DEFAULT_EXPECTED_SLIDE_HEIGHT = 1080;
const INSTAGRAM_URL = 'https://www.instagram.com/';
const TIKTOK_UPLOAD_URL = 'https://www.tiktok.com/tiktokstudio/upload?lang=en';
const TIKTOK_CONTENT_URL = 'https://www.tiktok.com/tiktokstudio/content';
const INSTAGRAM_ACCEPT_PREFIX = 'image/';

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }

    const eqIndex = token.indexOf('=');
    if (eqIndex !== -1) {
      args[token.slice(2, eqIndex)] = token.slice(eqIndex + 1);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    index += 1;
  }
  return args;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function writeText(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function appendJsonLine(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`);
}

function loadJsonLines(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function slugify(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'social-post';
}

function resolvePath(input, fallback) {
  const target = input || fallback;
  if (!target) {
    return null;
  }
  return path.isAbsolute(target) ? target : path.resolve(REPO_ROOT, target);
}

function resolveChromeProfileRoot(input = DEFAULT_CHROME_PROFILE_ROOT) {
  if (!input) {
    return null;
  }
  return path.isAbsolute(input) ? input : path.resolve(REPO_ROOT, input);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function mimeTypeForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.mov') return 'video/quicktime';
  return 'application/octet-stream';
}

function readPngDimensions(filePath) {
  const buffer = fs.readFileSync(filePath);
  const pngSignature = '89504e470d0a1a0a';
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== pngSignature) {
    throw new Error(`Expected a PNG file at ${filePath}`);
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function validateSlideImages(
  slideImagePaths,
  {
    expectedCount = DEFAULT_EXPECTED_SLIDE_COUNT,
    expectedWidth = DEFAULT_EXPECTED_SLIDE_WIDTH,
    expectedHeight = DEFAULT_EXPECTED_SLIDE_HEIGHT,
  } = {}
) {
  if (!Array.isArray(slideImagePaths) || slideImagePaths.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} rendered slide images, received ${slideImagePaths ? slideImagePaths.length : 0}.`);
  }

  return slideImagePaths.map((slidePath, index) => {
    if (!fs.existsSync(slidePath)) {
      throw new Error(`Rendered slide ${index + 1} is missing at ${slidePath}`);
    }

    const stats = fs.statSync(slidePath);
    if (stats.size <= 0) {
      throw new Error(`Rendered slide ${index + 1} is empty at ${slidePath}`);
    }

    const { width, height } = readPngDimensions(slidePath);
    if (width !== expectedWidth || height !== expectedHeight) {
      throw new Error(
        `Rendered slide ${index + 1} must be ${expectedWidth}x${expectedHeight}; received ${width}x${height} at ${slidePath}`
      );
    }

    return {
      path: slidePath,
      sha256: hashFile(slidePath),
      sizeBytes: stats.size,
      width,
      height,
    };
  });
}

function extractHeadContent(html) {
  const match = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  if (!match) {
    throw new Error('Unable to locate <head> content in carousel HTML.');
  }
  return match[1];
}

function extractSlideBlocks(html) {
  const blocks = [];
  let searchIndex = 0;

  while (searchIndex < html.length) {
    const start = html.indexOf('<div class="slide', searchIndex);
    if (start === -1) {
      break;
    }

    let cursor = start;
    let depth = 0;
    let end = -1;

    while (cursor < html.length) {
      const nextOpen = html.indexOf('<div', cursor);
      const nextClose = html.indexOf('</div', cursor);

      if (nextClose === -1) {
        throw new Error('Unable to parse slide HTML. Found unbalanced <div> tags.');
      }

      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth += 1;
        cursor = html.indexOf('>', nextOpen);
        if (cursor === -1) {
          throw new Error('Unable to parse opening <div> tag while extracting slide blocks.');
        }
        cursor += 1;
        continue;
      }

      depth -= 1;
      cursor = html.indexOf('>', nextClose);
      if (cursor === -1) {
        throw new Error('Unable to parse closing </div> tag while extracting slide blocks.');
      }
      cursor += 1;
      if (depth === 0) {
        end = cursor;
        break;
      }
    }

    if (end === -1) {
      throw new Error('Unable to resolve the end of a slide block.');
    }

    blocks.push(html.slice(start, end));
    searchIndex = end;
  }

  return blocks;
}

function buildIsolatedSlideDocument(headContent, slideHtml) {
  const exportStyles = [
    '<style>',
    'html, body { width: 1080px; height: 1080px; margin: 0; padding: 0; overflow: hidden; background: #111; }',
    'body { display: block; }',
    '.slide-label { display: none !important; }',
    '.slide { margin: 0 !important; }',
    '</style>',
  ].join('');

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    headContent,
    exportStyles,
    '</head>',
    '<body>',
    slideHtml,
    '</body>',
    '</html>',
  ].join('');
}

function writeIsolatedSlideDocuments({ sourceHtmlPath, outputDir }) {
  const html = readText(sourceHtmlPath);
  const headContent = extractHeadContent(html);
  const slides = extractSlideBlocks(html);

  if (slides.length === 0) {
    throw new Error('No .slide blocks found in carousel HTML.');
  }

  ensureDir(outputDir);
  const slideDocuments = slides.map((slideHtml, index) => {
    const slidePath = path.join(outputDir, `slide-${String(index + 1).padStart(2, '0')}.html`);
    writeText(slidePath, buildIsolatedSlideDocument(headContent, slideHtml));
    return slidePath;
  });

  return slideDocuments;
}

function resolveCaptionSource({ sourceDir, captionPath, captionText }) {
  if (captionText !== undefined && captionText !== null) {
    const inlineCaptionPath = path.join(sourceDir, 'caption-source.txt');
    writeText(inlineCaptionPath, `${String(captionText).trim()}\n`);
    return {
      captionPath: inlineCaptionPath,
      caption: String(captionText).trim(),
      source: 'inline',
    };
  }

  const resolvedCaptionPath = resolvePath(captionPath, DEFAULT_CAPTION_PATH);
  return {
    captionPath: resolvedCaptionPath,
    caption: readText(resolvedCaptionPath).trim(),
    source: 'file',
  };
}

function findExecutable(candidates) {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (candidate.includes(path.sep) && fs.existsSync(candidate)) {
      return candidate;
    }

    const result = cp.spawnSync('which', [candidate], { encoding: 'utf8' });
    if (result.status === 0) {
      const resolved = result.stdout.trim();
      if (resolved) {
        return resolved;
      }
    }
  }
  return null;
}

function resolveChromeBinary() {
  const chrome = findExecutable([
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'Google Chrome',
    'google-chrome',
    'chromium',
    'chromium-browser',
  ]);
  if (!chrome) {
    throw new Error('Google Chrome binary not found. Set CHROME_BIN or install Google Chrome.');
  }
  return chrome;
}

function resolveFfmpegBinary() {
  const ffmpeg = findExecutable([process.env.FFMPEG_BIN, 'ffmpeg']);
  if (!ffmpeg) {
    throw new Error('ffmpeg binary not found. Set FFMPEG_BIN or install ffmpeg.');
  }
  return ffmpeg;
}

function renderSlides({ slideDocuments, outputDir, chromeBin, dryRun = false }) {
  ensureDir(outputDir);
  const slidePaths = slideDocuments.map((_, index) => (
    path.join(outputDir, `slide-${String(index + 1).padStart(2, '0')}.png`)
  ));

  if (dryRun) {
    return slidePaths;
  }

  for (let index = 0; index < slideDocuments.length; index += 1) {
    cp.execFileSync(chromeBin, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--allow-file-access-from-files',
      '--window-size=1080,1080',
      '--virtual-time-budget=5000',
      `--screenshot=${slidePaths[index]}`,
      pathToFileURL(slideDocuments[index]).href,
    ], { stdio: 'ignore' });
  }

  return slidePaths;
}

function buildFfmpegConcatManifest(slidePaths, durationSeconds) {
  const lines = [];
  for (const slidePath of slidePaths) {
    lines.push(`file '${slidePath.replace(/'/g, "'\\''")}'`);
    lines.push(`duration ${durationSeconds}`);
  }
  lines.push(`file '${slidePaths[slidePaths.length - 1].replace(/'/g, "'\\''")}'`);
  return `${lines.join('\n')}\n`;
}

function normalizeTikTokCaption(caption) {
  return String(caption || '')
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, '\'')
    .replace(/[—–]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderTikTokVideo({
  slidePaths,
  outputPath,
  slideDurationSeconds = 2.4,
  ffmpegBin,
  dryRun = false,
}) {
  if (!slidePaths || slidePaths.length === 0) {
    throw new Error('TikTok fallback video requires at least one slide image.');
  }

  ensureDir(path.dirname(outputPath));
  if (dryRun) {
    return outputPath;
  }

  const concatPath = path.join(path.dirname(outputPath), 'tiktok-slides.txt');
  writeText(concatPath, buildFfmpegConcatManifest(slidePaths, slideDurationSeconds));

  cp.execFileSync(ffmpegBin, [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatPath,
    '-f', 'lavfi',
    '-t', String(slidePaths.length * slideDurationSeconds + 0.5),
    '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-vf', 'fps=30,scale=1080:1080:flags=lanczos,pad=1080:1920:0:420:color=0x241f4f,format=yuv420p',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-profile:v', 'high',
    '-level', '4.1',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-shortest',
    '-movflags', '+faststart',
    outputPath,
  ], { stdio: 'ignore' });

  return outputPath;
}

function buildBundleManifest({
  id,
  sourceHtmlPath,
  captionPath,
  outputDir,
  slideDocumentPaths,
  slideImagePaths,
  slideImageMetadata,
  tiktokVideoPath,
  instagramCaptionPath,
  tiktokCaptionPath,
  instagramCaptionHash,
  tiktokCaptionHash,
  tiktokVideoHash,
  createdAt,
}) {
  return {
    id,
    createdAt,
    sourceHtmlPath,
    captionPath,
    outputDir,
    slideDocumentPaths,
    slideImagePaths,
    slideImageMetadata,
    instagramCaptionPath,
    tiktokCaptionPath,
    tiktokVideoPath,
    hashes: {
      instagramCaptionSha256: instagramCaptionHash,
      tiktokCaptionSha256: tiktokCaptionHash,
      tiktokVideoSha256: tiktokVideoHash,
    },
    platforms: {
      instagram: {
        type: 'carousel',
        assetPaths: slideImagePaths,
      },
      tiktok: {
        preferredType: 'photo-carousel',
        photoAssetPaths: slideImagePaths,
        videoAssetPath: tiktokVideoPath,
        assetPath: tiktokVideoPath,
      },
    },
  };
}

function prepareBundle({
  sourceHtmlPath,
  captionPath,
  captionText,
  outputDir,
  slug,
  slideDurationSeconds = 2.4,
  chromeBin,
  ffmpegBin,
  dryRun = false,
  renderSlidesFn = renderSlides,
  renderTikTokVideoFn = renderTikTokVideo,
}) {
  const bundleId = slugify(slug || path.basename(sourceHtmlPath, path.extname(sourceHtmlPath)));
  const bundleRoot = outputDir || path.join(DEFAULT_OUTPUT_ROOT, bundleId);
  const sourceDir = path.join(bundleRoot, 'source');
  const slidesDir = path.join(bundleRoot, 'slides');
  const captionsDir = path.join(bundleRoot, 'captions');
  const videoDir = path.join(bundleRoot, 'video');

  ensureDir(bundleRoot);
  ensureDir(sourceDir);
  ensureDir(slidesDir);
  ensureDir(captionsDir);
  ensureDir(videoDir);

  const resolvedChromeBin = chromeBin || (dryRun ? 'dry-run-chrome' : resolveChromeBinary());
  const resolvedFfmpegBin = ffmpegBin || (dryRun ? 'dry-run-ffmpeg' : resolveFfmpegBinary());

  const slideDocumentPaths = writeIsolatedSlideDocuments({
    sourceHtmlPath,
    outputDir: sourceDir,
  });
  const slideImagePaths = renderSlidesFn({
    slideDocuments: slideDocumentPaths,
    outputDir: slidesDir,
    chromeBin: resolvedChromeBin,
    dryRun,
  });
  const slideImageMetadata = validateSlideImages(slideImagePaths);

  const resolvedCaptionSource = resolveCaptionSource({
    sourceDir,
    captionPath,
    captionText,
  });
  const caption = resolvedCaptionSource.caption;
  const instagramCaptionPath = path.join(captionsDir, 'instagram.txt');
  const tiktokCaptionPath = path.join(captionsDir, 'tiktok.txt');
  writeText(instagramCaptionPath, `${caption}\n`);
  writeText(tiktokCaptionPath, `${normalizeTikTokCaption(caption)}\n`);

  const tiktokVideoPath = renderTikTokVideoFn({
    slidePaths: slideImagePaths,
    outputPath: path.join(videoDir, 'tiktok-fallback.mp4'),
    slideDurationSeconds,
    ffmpegBin: resolvedFfmpegBin,
    dryRun,
  });

  const manifest = buildBundleManifest({
    id: bundleId,
    createdAt: new Date().toISOString(),
    sourceHtmlPath,
    captionPath: resolvedCaptionSource.captionPath,
    outputDir: bundleRoot,
    slideDocumentPaths,
    slideImagePaths,
    slideImageMetadata,
    tiktokVideoPath,
    instagramCaptionPath,
    tiktokCaptionPath,
    instagramCaptionHash: hashFile(instagramCaptionPath),
    tiktokCaptionHash: hashFile(tiktokCaptionPath),
    tiktokVideoHash: hashFile(tiktokVideoPath),
  });

  const manifestPath = path.join(bundleRoot, 'bundle.json');
  writeJson(manifestPath, manifest);
  return { manifest, manifestPath };
}

function loadQueueState(queuePath = DEFAULT_QUEUE_PATH) {
  return readJson(queuePath, { entries: [] });
}

function saveQueueState(queuePath, queueState) {
  writeJson(queuePath, queueState);
}

function normalizePlatformList(platforms = []) {
  return [...new Set((platforms || []).map((platform) => String(platform).trim()).filter(Boolean))].sort();
}

function enqueueBundle({
  queuePath = DEFAULT_QUEUE_PATH,
  bundlePath,
  scheduledAt,
  platforms = ['instagram', 'tiktok'],
}) {
  const bundle = readJson(bundlePath, null);
  if (!bundle) {
    throw new Error(`Bundle manifest not found at ${bundlePath}`);
  }

  const queueState = loadQueueState(queuePath);
  const normalizedScheduledAt = new Date(scheduledAt).toISOString();
  const normalizedPlatforms = normalizePlatformList(platforms);
  const existingEntry = (queueState.entries || []).find((entry) => (
    entry.status === 'pending' &&
    entry.bundlePath === bundlePath &&
    entry.scheduledAt === normalizedScheduledAt &&
    JSON.stringify(normalizePlatformList(entry.platforms)) === JSON.stringify(normalizedPlatforms)
  ));

  if (existingEntry) {
    return existingEntry;
  }

  const entry = {
    id: `social_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    bundlePath,
    bundleId: bundle.id,
    scheduledAt: normalizedScheduledAt,
    platforms: normalizedPlatforms,
    status: 'pending',
    attempts: [],
    createdAt: new Date().toISOString(),
  };

  queueState.entries.push(entry);
  saveQueueState(queuePath, queueState);
  return entry;
}

function getDueEntries(queueState, now = new Date()) {
  return (queueState.entries || []).filter((entry) => (
    entry.status === 'pending' && new Date(entry.scheduledAt).getTime() <= now.getTime()
  ));
}

function loadPublishHistory(historyPath = DEFAULT_HISTORY_PATH) {
  return loadJsonLines(historyPath);
}

function buildPublishFingerprint({ platform, captionText, assetPaths = [] }) {
  const fingerprintPayload = {
    platform,
    captionSha256: hashText(captionText),
    assetHashes: assetPaths.map((assetPath) => ({
      path: path.basename(assetPath),
      sha256: hashFile(assetPath),
    })),
  };
  return hashText(JSON.stringify(fingerprintPayload));
}

function assertPublishNotDuplicated({ historyPath = DEFAULT_HISTORY_PATH, fingerprint, platform }) {
  const existing = loadPublishHistory(historyPath).find((entry) => (
    entry.platform === platform &&
    entry.status === 'published' &&
    entry.fingerprint === fingerprint
  ));

  if (existing) {
    throw new Error(
      `Duplicate ${platform} publish blocked. Matching content was already published at ${existing.publishedAt}. Use --force to bypass.`
    );
  }
}

function createPublishAttempt(bundle, platform) {
  const attemptId = `${platform}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const attemptDir = path.join(bundle.outputDir, 'publish-attempts', attemptId);
  ensureDir(attemptDir);
  return {
    attemptId,
    attemptDir,
    recordPath: path.join(attemptDir, 'attempt.json'),
  };
}

function writePublishAttemptRecord(recordPath, payload) {
  writeJson(recordPath, payload);
}

function appendPublishAttemptEvent(recordPath, event) {
  const existing = readJson(recordPath, {});
  const events = Array.isArray(existing.events) ? existing.events.slice() : [];
  events.push(event);
  writeJson(recordPath, {
    ...existing,
    lastEventAt: event.recordedAt || new Date().toISOString(),
    events,
  });
}

async function waitForChildExit(child, timeoutMs = 5000) {
  if (!child || child.exitCode !== null || child.killed) {
    return;
  }

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      if (child.exitCode === null && !child.killed) {
        try {
          child.kill('SIGKILL');
        } catch {
          // Process already exited.
        }
      }
      finish();
    }, timeoutMs);
    child.once('exit', finish);
    child.once('error', finish);
  });
}

async function removeDirWithRetries(dirPath, {
  retries = 8,
  delayMs = 250,
} = {}) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!['ENOTEMPTY', 'EBUSY', 'EPERM'].includes(error.code) || attempt === retries - 1) {
        throw error;
      }
      await sleep(delayMs);
    }
  }
}

function resolveTikTokPublishTarget(bundle, readyState = {}) {
  const photoAssetPaths = bundle.platforms?.tiktok?.photoAssetPaths || bundle.slideImagePaths || [];
  const videoAssetPath = bundle.platforms?.tiktok?.videoAssetPath || bundle.platforms?.tiktok?.assetPath || bundle.tiktokVideoPath;
  const hasPhotoSurface = readyState.state === 'photo-upload-ready';

  if (hasPhotoSurface && photoAssetPaths.length > 0) {
    return {
      type: 'photo-carousel',
      assetPaths: photoAssetPaths,
      captionPath: bundle.tiktokCaptionPath,
    };
  }

  if (!videoAssetPath) {
    throw new Error('TikTok publish requires either photo assets or a fallback MP4 asset.');
  }

  return {
    type: 'video',
    assetPaths: [videoAssetPath],
    captionPath: bundle.tiktokCaptionPath,
  };
}

function parseBrowserResult(raw) {
  if (typeof raw !== 'string') {
    return raw;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildClickByTextScript(label) {
  return `
    (() => {
      const pattern = new RegExp('^\\\\s*' + ${JSON.stringify(escapeRegex(label))} + '\\\\s*$', 'i');
      const text = (element) => (element.innerText || element.getAttribute('aria-label') || '').trim();
      const target = [...document.querySelectorAll('button,[role=button],a')].find((element) => pattern.test(text(element)));
      if (!target) {
        return JSON.stringify({ clicked: false });
      }
      target.click();
      return JSON.stringify({ clicked: true, label: text(target) });
    })()
  `;
}

function shouldCopyChromePath(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  return ![
    'Cache',
    'Code Cache',
    'GPUCache',
    'GrShaderCache',
    'ShaderCache',
    'Crashpad',
    'DawnGraphiteCache',
    'DawnWebGPUCache',
    'Service Worker/CacheStorage',
    'Service Worker/ScriptCache',
  ].some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

function copyChromeProfileForAutomation({
  profileRoot = DEFAULT_CHROME_PROFILE_ROOT,
  profileDir = DEFAULT_CHROME_PROFILE_DIR,
}) {
  const resolvedProfileRoot = resolveChromeProfileRoot(profileRoot);
  const sourceProfileDir = path.join(resolvedProfileRoot, profileDir);
  if (!fs.existsSync(sourceProfileDir)) {
    throw new Error(`Chrome profile directory not found: ${sourceProfileDir}`);
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'social-chrome-profile-'));
  const localStatePath = path.join(resolvedProfileRoot, 'Local State');
  if (fs.existsSync(localStatePath)) {
    fs.copyFileSync(localStatePath, path.join(tempRoot, 'Local State'));
  }

  const destinationProfileDir = path.join(tempRoot, profileDir);
  fs.cpSync(sourceProfileDir, destinationProfileDir, {
    recursive: true,
    force: true,
    filter: (sourcePath) => {
      const relativePath = path.relative(sourceProfileDir, sourcePath);
      return shouldCopyChromePath(relativePath);
    },
  });

  return {
    tempRoot,
    profileDir,
  };
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on('error', reject);
  });
}

async function waitForChromeCdp(port, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        return response.json();
      }
    } catch {
      // Keep polling until Chrome exposes CDP.
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for Chrome DevTools on port ${port}`);
}

function createAppleScriptBrowserSession() {
  return {
    name: 'apple-events',
    async healthCheck() {
      executeChromeJavaScript({
        urlPrefix: 'chrome://newtab/',
        openUrl: 'chrome://newtab/',
        js: 'JSON.stringify({ ok: true, href: location.href })',
      });
    },
    async evaluate(spec) {
      return executeChromeJavaScript(spec);
    },
    async poll(spec) {
      return pollChromeState(spec);
    },
    async screenshot() {
      return null;
    },
    async setInputFiles() {
      return null;
    },
    async clickText({ urlPrefix, openUrl, text }) {
      return parseBrowserResult(executeChromeJavaScript({
        urlPrefix,
        openUrl,
        js: buildClickByTextScript(text),
      }));
    },
    async close() {
      return null;
    },
  };
}

async function createPlaywrightBrowserSession({
  chromeBin,
  profileRoot = DEFAULT_CHROME_PROFILE_ROOT,
  profileDir = DEFAULT_CHROME_PROFILE_DIR,
  headless = false,
}) {
  const { chromium } = require('playwright-core');
  const { tempRoot } = copyChromeProfileForAutomation({
    profileRoot,
    profileDir,
  });
  const port = await getAvailablePort();
  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${tempRoot}`,
    `--profile-directory=${profileDir}`,
    '--disable-blink-features=AutomationControlled',
    '--allow-file-access-from-files',
    '--disable-background-networking',
    '--no-default-browser-check',
    '--no-first-run',
    '--no-sandbox',
  ];
  if (headless) {
    chromeArgs.push('--headless=new', '--disable-gpu', '--hide-scrollbars');
  }
  chromeArgs.push('about:blank');

  const chromeProcess = cp.spawn(chromeBin, chromeArgs, {
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  let stderr = '';
  chromeProcess.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });

  let browser = null;
  try {
    await waitForChromeCdp(port);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  } catch (error) {
    if (!chromeProcess.killed) {
      chromeProcess.kill('SIGTERM');
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
    throw new Error(`Failed to launch copied-profile Chrome automation session: ${error.message}${stderr ? `\n${stderr.trim()}` : ''}`);
  }
  const context = browser.contexts()[0];
  if (!context) {
    await browser.close();
    if (!chromeProcess.killed) {
      chromeProcess.kill('SIGTERM');
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
    throw new Error(`Chrome launched without a CDP context. stderr: ${stderr.trim()}`);
  }

  async function getPage({ urlPrefix, openUrl }) {
    let page = context.pages().find((candidate) => candidate.url().startsWith(urlPrefix));
    if (!page) {
      page = await context.newPage();
      await page.goto(openUrl || urlPrefix, {
        waitUntil: 'domcontentloaded',
      });
    } else {
      await page.bringToFront();
    }
    await page.waitForLoadState('domcontentloaded');
    return page;
  }

  async function setInputFiles({ urlPrefix, openUrl, files, accept = 'any', multiple = false }) {
    const page = await getPage({ urlPrefix, openUrl });
    const handles = await page.locator('input[type=file]').elementHandles();
    for (const handle of handles) {
      const acceptAttribute = (await handle.getAttribute('accept')) || '';
      const allowsMultiple = (await handle.getAttribute('multiple')) !== null;
      const matchesAccept = accept === 'any' ||
        (accept === 'image' && (/image\//i.test(acceptAttribute) || allowsMultiple)) ||
        (accept === 'video' && /video\//i.test(acceptAttribute));
      const matchesMultiple = !multiple || allowsMultiple;
      if (!matchesAccept || !matchesMultiple) {
        continue;
      }
      await handle.setInputFiles(files);
      return {
        ok: true,
        filesLength: files.length,
        accept: acceptAttribute,
        multiple: allowsMultiple,
      };
    }
    return {
      ok: false,
      reason: 'no-matching-file-input',
      filesLength: 0,
    };
  }

  async function clickText({ urlPrefix, openUrl, text }) {
    const page = await getPage({ urlPrefix, openUrl });
    const exactPattern = new RegExp(`^\\s*${escapeRegex(text)}\\s*$`, 'i');
    const locatorCandidates = [
      page.getByRole('button', { name: exactPattern }).first(),
      page.locator('button,[role=button],a').filter({ hasText: exactPattern }).first(),
    ];

    for (const locator of locatorCandidates) {
      const count = await locator.count().catch(() => 0);
      if (!count) {
        continue;
      }
      await locator.click();
      return { clicked: true, label: text };
    }

    return { clicked: false, label: text };
  }

  return {
    name: 'playwright',
    async healthCheck() {
      const page = await getPage({
        urlPrefix: 'chrome://newtab/',
        openUrl: 'chrome://newtab/',
      });
      await page.evaluate(() => document.title);
    },
    async evaluate(spec) {
      const page = await getPage(spec);
      return page.evaluate((script) => window.eval(script), spec.js);
    },
    async poll({ urlPrefix, openUrl, js, timeoutMs = 20000, intervalMs = 1000, isReady }) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const parsed = parseBrowserResult(await this.evaluate({ urlPrefix, openUrl, js }));
        if (isReady(parsed)) {
          return parsed;
        }
        await sleep(intervalMs);
      }
      throw new Error(`Timed out waiting for browser state on ${urlPrefix}`);
    },
    async screenshot({ urlPrefix, openUrl, outputPath }) {
      const page = await getPage({ urlPrefix, openUrl });
      ensureDir(path.dirname(outputPath));
      await page.screenshot({ path: outputPath, fullPage: false });
      return outputPath;
    },
    async setInputFiles(spec) {
      return setInputFiles(spec);
    },
    async clickText(spec) {
      return clickText(spec);
    },
    async close() {
      const closeErrors = [];
      try {
        await browser.close();
      } catch (error) {
        closeErrors.push(new Error(`browser.close failed: ${error.message}`));
      }

      if (chromeProcess.exitCode === null && !chromeProcess.killed) {
        try {
          chromeProcess.kill('SIGTERM');
        } catch (error) {
          closeErrors.push(new Error(`chromeProcess.kill failed: ${error.message}`));
        }
      }

      await waitForChildExit(chromeProcess);

      try {
        await removeDirWithRetries(tempRoot);
      } catch (error) {
        closeErrors.push(new Error(`temp profile cleanup failed: ${error.message}`));
      }

      if (closeErrors.length > 0) {
        throw new Error(closeErrors.map((error) => error.message).join('; '));
      }
    },
  };
}

async function createBrowserSession({
  browserBackend = 'auto',
  chromeBin = resolveChromeBinary(),
  profileRoot = DEFAULT_CHROME_PROFILE_ROOT,
  profileDir = DEFAULT_CHROME_PROFILE_DIR,
  headless = false,
} = {}) {
  if (browserBackend === 'apple-events') {
    const session = createAppleScriptBrowserSession();
    await session.healthCheck();
    return session;
  }

  if (browserBackend === 'playwright') {
    return createPlaywrightBrowserSession({
      chromeBin,
      profileRoot,
      profileDir,
      headless,
    });
  }

  const appleEventsSession = createAppleScriptBrowserSession();
  try {
    await appleEventsSession.healthCheck();
    return appleEventsSession;
  } catch {
    return createPlaywrightBrowserSession({
      chromeBin,
      profileRoot,
      profileDir,
      headless,
    });
  }
}

async function captureAttemptScreenshot(session, attempt, name, spec) {
  if (!attempt || !session || typeof session.screenshot !== 'function') {
    return null;
  }
  const outputPath = path.join(attempt.attemptDir, `${name}.png`);
  try {
    return await session.screenshot({
      ...spec,
      outputPath,
    });
  } catch {
    return null;
  }
}

function escapeAppleScriptString(value) {
  return `"${String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')}"`;
}

function runAppleScript(script) {
  if (process.platform !== 'darwin') {
    throw new Error('Chrome social automation requires macOS and AppleScript.');
  }

  return cp.execFileSync('osascript', ['-'], {
    encoding: 'utf8',
    input: script,
  }).trim();
}

function buildChromeJavaScriptAppleScript({ urlPrefix, openUrl, tempJsPath }) {
  return [
    'tell application "Google Chrome"',
    '  activate',
    `  set targetPrefix to ${escapeAppleScriptString(urlPrefix)}`,
    `  set openTarget to ${escapeAppleScriptString(openUrl || urlPrefix)}`,
    '  set targetWindow to missing value',
    '  set targetTabIndex to 0',
    '  set targetTab to missing value',
    '  repeat with w in windows',
    '    set currentTabIndex to 1',
    '    repeat with t in tabs of w',
    '      if (URL of t starts with targetPrefix) then',
    '        set targetWindow to w',
    '        set targetTabIndex to currentTabIndex',
    '        exit repeat',
    '      end if',
    '      set currentTabIndex to currentTabIndex + 1',
    '    end repeat',
    '    if targetWindow is not missing value then exit repeat',
    '  end repeat',
    '  if targetWindow is not missing value then',
    '    if (index of targetWindow) is not 1 then set index of targetWindow to 1',
    '    if (active tab index of targetWindow) is not targetTabIndex then set active tab index of targetWindow to targetTabIndex',
    '    set targetTab to active tab of targetWindow',
    '  end if',
    '  if targetTab is missing value then',
    '    if (count of windows) = 0 then make new window',
    '    tell window 1',
    '      set targetTab to make new tab with properties {URL:openTarget}',
    '      set active tab index to index of targetTab',
    '    end tell',
    '    delay 1',
    '  end if',
    `  set jsCode to read POSIX file ${escapeAppleScriptString(tempJsPath)}`,
    '  return execute targetTab javascript jsCode',
    'end tell',
  ].join('\n');
}

function executeChromeJavaScript({ urlPrefix, openUrl, js }) {
  const tempJsPath = path.join(
    os.tmpdir(),
    `social-pipeline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.js`
  );
  writeText(tempJsPath, js);

  const appleScript = buildChromeJavaScriptAppleScript({
    urlPrefix,
    openUrl,
    tempJsPath,
  });

  try {
    return runAppleScript(appleScript);
  } finally {
    fs.rmSync(tempJsPath, { force: true });
  }
}

async function pollChromeState({ urlPrefix, openUrl, js, timeoutMs = 20000, intervalMs = 1000, isReady }) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const raw = executeChromeJavaScript({ urlPrefix, openUrl, js });
    let parsed = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Keep raw string if it is not JSON.
    }
    if (isReady(parsed)) {
      return parsed;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for Chrome state on ${urlPrefix}`);
}

function buildBrowserUploadScript(filePaths) {
  const files = filePaths.map((filePath) => ({
    name: path.basename(filePath),
    type: mimeTypeForPath(filePath),
    b64: fs.readFileSync(filePath).toString('base64'),
  }));

  return `
    (async () => {
      const input = document.querySelector('input[type=file]');
      if (!input) {
        return JSON.stringify({ ok: false, reason: 'no-file-input' });
      }
      const files = ${JSON.stringify(files)};
      const dt = new DataTransfer();
      for (const entry of files) {
        const binary = atob(entry.b64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }
        dt.items.add(new File([bytes], entry.name, { type: entry.type, lastModified: Date.now() }));
      }
      input.files = dt.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return JSON.stringify({
        ok: true,
        filesLength: input.files ? input.files.length : 0,
        body: document.body ? document.body.innerText.slice(0, 2400) : ''
      });
    })()
  `;
}

const INSTAGRAM_COMPOSER_JS = `
  (() => {
    const text = (element) => (element.innerText || element.getAttribute('aria-label') || '').trim();
    if (document.querySelector('input[type=file][multiple]')) {
      return JSON.stringify({ state: 'ready' });
    }
    const post = [...document.querySelectorAll('button,[role=button],a')].find((element) => /^post$/i.test(text(element)));
    if (post) {
      post.click();
      return JSON.stringify({ state: 'clicked-post' });
    }
    const create = [...document.querySelectorAll('button,[role=button],a')].find((element) => /^create$/i.test(text(element)));
    if (create) {
      create.click();
      return JSON.stringify({ state: 'clicked-create' });
    }
    return JSON.stringify({ state: 'waiting', title: document.title });
  })()
`;

const INSTAGRAM_EDITOR_JS = `
  (() => {
    const text = (element) => (element.innerText || element.getAttribute('aria-label') || '').trim();
    const editor = document.querySelector('textarea,[contenteditable=true]');
    const share = [...document.querySelectorAll('button,[role=button],a')].find((element) => /^share$/i.test(text(element)));
    const next = [...document.querySelectorAll('button,[role=button],a')].find((element) => /^next$/i.test(text(element)));
    const body = document.body ? document.body.innerText.slice(0, 2400) : '';
    return JSON.stringify({
      hasEditor: Boolean(editor),
      shareVisible: Boolean(share),
      nextVisible: Boolean(next),
      hasError: /something went wrong|try again/i.test(body),
      body,
    });
  })()
`;

const INSTAGRAM_PREFLIGHT_JS = `
  (() => {
    const text = (element) => (element.innerText || element.getAttribute('aria-label') || '').trim();
    const post = [...document.querySelectorAll('button,[role=button],a')].find((element) => /^post$/i.test(text(element)));
    const create = [...document.querySelectorAll('button,[role=button],a')].find((element) => /^create$/i.test(text(element)));
    const multiInput = document.querySelector('input[type=file][multiple]');
    const loginInput = document.querySelector('input[name="username"], input[name="password"], input[autocomplete="username"], input[autocomplete="current-password"]');
    const body = document.body ? document.body.innerText.slice(0, 2400) : '';
    return JSON.stringify({
      url: location.href,
      title: document.title,
      body,
      loggedOut: Boolean(loginInput) || location.pathname.startsWith('/accounts/login'),
      state: multiInput ? 'ready' : post ? 'post-visible' : create ? 'create-visible' : 'waiting',
    });
  })()
`;

function buildInstagramCaptionScript(caption) {
  return `
    (() => {
      const caption = ${JSON.stringify(caption)};
      const textarea = document.querySelector('textarea');
      if (textarea) {
        textarea.focus();
        textarea.value = caption;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        return JSON.stringify({ ok: true, mode: 'textarea' });
      }
      const editor = document.querySelector('[contenteditable=true]');
      if (!editor) {
        return JSON.stringify({ ok: false, reason: 'no-caption-editor' });
      }
      editor.focus();
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, caption);
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: caption }));
      return JSON.stringify({ ok: true, mode: 'contenteditable', text: editor.innerText.slice(0, 400) });
    })()
  `;
}

function buildContentEditableCaptionScript(caption) {
  return `
    (() => {
      const caption = ${JSON.stringify(caption)};
      const editor = document.querySelector('[contenteditable=true]');
      if (!editor) {
        return JSON.stringify({ ok: false, reason: 'no-editor' });
      }
      editor.focus();
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, caption);
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: caption }));
      return JSON.stringify({ ok: true, text: editor.innerText.slice(0, 400) });
    })()
  `;
}

const INSTAGRAM_NEXT_JS = `
  (() => {
    const text = (element) => (element.innerText || element.getAttribute('aria-label') || '').trim();
    const next = [...document.querySelectorAll('button,[role=button],a')].find((element) => /^next$/i.test(text(element)));
    if (!next) {
      return JSON.stringify({ clicked: false });
    }
    next.click();
    return JSON.stringify({ clicked: true });
  })()
`;

const INSTAGRAM_SHARE_JS = `
  (() => {
    const text = (element) => (element.innerText || element.getAttribute('aria-label') || '').trim();
    const share = [...document.querySelectorAll('button,[role=button],a')].find((element) => /^share$/i.test(text(element)));
    if (!share) {
      return JSON.stringify({ clicked: false });
    }
    share.click();
    return JSON.stringify({ clicked: true });
  })()
`;

const INSTAGRAM_CLOSE_JS = `
  (() => {
    const text = (element) => (element.innerText || element.getAttribute('aria-label') || '').trim();
    const close = [...document.querySelectorAll('button,[role=button],svg')].find((element) => /close/i.test(text(element)));
    if (close && close.closest('button')) {
      close.closest('button').click();
      return JSON.stringify({ closed: true });
    }
    const discard = [...document.querySelectorAll('button,[role=button],a')].find((element) => /^discard$/i.test(text(element)));
    if (discard) {
      discard.click();
      return JSON.stringify({ discarded: true });
    }
    return JSON.stringify({ closed: false });
  })()
`;

const TIKTOK_READY_JS = `
  (() => {
    const text = (element) => (element.innerText || element.getAttribute('aria-label') || '').trim();
    const buttons = [...document.querySelectorAll('button,[role=button],a')];
    const gotIt = buttons.find((element) => /^got it$/i.test(text(element)));
    if (gotIt) {
      gotIt.click();
    }
    const retry = buttons.find((element) => /^retry$/i.test(text(element)));
    if (retry) {
      retry.click();
      return JSON.stringify({ state: 'clicked-retry' });
    }
    const continueButton = buttons.find((element) => /^continue$/i.test(text(element)));
    if (continueButton) {
      continueButton.click();
      return JSON.stringify({ state: 'clicked-continue' });
    }
    if (document.querySelector('[contenteditable=true]')) {
      return JSON.stringify({ state: 'editor-ready' });
    }
    const photoInput = [...document.querySelectorAll('input[type=file]')].find((element) => /image\\//i.test(element.accept || '') || element.multiple);
    if (photoInput) {
      return JSON.stringify({ state: 'photo-upload-ready', accept: photoInput.accept || '', multiple: !!photoInput.multiple });
    }
    const videoInput = [...document.querySelectorAll('input[type=file]')].find((element) => /video\\//i.test(element.accept || ''));
    if (videoInput) {
      return JSON.stringify({ state: 'video-upload-ready', accept: videoInput.accept || '', multiple: !!videoInput.multiple });
    }
    return JSON.stringify({ state: 'waiting', body: document.body ? document.body.innerText.slice(0, 1600) : '' });
  })()
`;

const TIKTOK_PREFLIGHT_JS = `
  (() => {
    const text = (element) => (element.innerText || element.getAttribute('aria-label') || '').trim();
    const body = document.body ? document.body.innerText.slice(0, 2400) : '';
    const loginInput = document.querySelector('input[name="username"], input[type="password"], input[autocomplete="username"], input[autocomplete="current-password"]');
    const buttons = [...document.querySelectorAll('button,[role=button],a')];
    const editor = document.querySelector('[contenteditable=true]');
    const photoInput = [...document.querySelectorAll('input[type=file]')].find((element) => /image\\//i.test(element.accept || '') || element.multiple);
    const videoInput = [...document.querySelectorAll('input[type=file]')].find((element) => /video\\//i.test(element.accept || ''));
    const loginButton = buttons.find((element) => /^(log in|login|sign up)$/i.test(text(element)));
    const state = editor ? 'editor-ready' : photoInput ? 'photo-upload-ready' : videoInput ? 'video-upload-ready' : 'waiting';
    return JSON.stringify({
      url: location.href,
      title: document.title,
      body,
      state,
      accept: (photoInput || videoInput || {}).accept || '',
      multiple: Boolean(photoInput && photoInput.multiple),
      loggedOut: Boolean(loginInput) || (Boolean(loginButton) && !editor && !photoInput && !videoInput),
    });
  })()
`;

const TIKTOK_FOCUS_EDITOR_JS = `
  (() => {
    const editor = document.querySelector('[contenteditable=true]');
    if (!editor) {
      return JSON.stringify({ ok: false, reason: 'no-editor' });
    }
    editor.focus();
    return JSON.stringify({ ok: true, text: editor.innerText.slice(0, 400) });
  })()
`;

const TIKTOK_SET_FOLLOWERS_JS = `
  (() => {
    const text = (element) => (element.innerText || element.getAttribute('aria-label') || '').trim();
    const buttons = [...document.querySelectorAll('button,[role=button],a,[role=combobox],div')];
    const openControl = buttons.find((element) => /^(followers|friends|only you|only me)$/i.test(text(element)));
    if (!openControl) {
      return JSON.stringify({ state: 'missing-privacy-control' });
    }
    if (/^followers$/i.test(text(openControl))) {
      return JSON.stringify({ state: 'already-followers' });
    }
    openControl.click();
    const option = [...document.querySelectorAll('button,[role=button],a,div,span')].find((element) => /^followers$/i.test(text(element)));
    if (option) {
      option.click();
      return JSON.stringify({ state: 'selected-followers' });
    }
    return JSON.stringify({ state: 'privacy-menu-opened' });
  })()
`;

const TIKTOK_POST_JS = `
  (() => {
    const text = (element) => (element.innerText || element.getAttribute('aria-label') || '').trim();
    const post = [...document.querySelectorAll('button,[role=button],a')].find((element) => /^post$/i.test(text(element)));
    if (!post) {
      return JSON.stringify({ clicked: false });
    }
    post.click();
    return JSON.stringify({ clicked: true });
  })()
`;

const TIKTOK_DISCARD_JS = `
  (() => {
    const text = (element) => (element.innerText || element.getAttribute('aria-label') || '').trim();
    const discard = [...document.querySelectorAll('button,[role=button],a')].find((element) => /^discard$/i.test(text(element)));
    if (!discard) {
      return JSON.stringify({ discarded: false });
    }
    discard.click();
    return JSON.stringify({ discarded: true });
  })()
`;

async function preflightInstagramSession(session, attempt = null) {
  const state = await session.poll({
    urlPrefix: INSTAGRAM_URL,
    openUrl: INSTAGRAM_URL,
    js: INSTAGRAM_PREFLIGHT_JS,
    isReady: (value) => value && (value.loggedOut || typeof value.body === 'string'),
  });
  if (attempt) {
    writePublishAttemptRecord(attempt.recordPath, {
      attemptId: attempt.attemptId,
      platform: 'instagram',
      status: 'preflight',
      recordedAt: new Date().toISOString(),
      state,
    });
  }
  if (state.loggedOut) {
    throw new Error('Instagram session unavailable in the selected Chrome profile.');
  }
  return state;
}

async function preflightTikTokSession(session, attempt = null) {
  try {
    const state = await session.poll({
      urlPrefix: 'https://www.tiktok.com/tiktokstudio/',
      openUrl: TIKTOK_UPLOAD_URL,
      js: TIKTOK_PREFLIGHT_JS,
      isReady: (value) => value && (
        value.loggedOut ||
        value.state === 'editor-ready' ||
        value.state === 'photo-upload-ready' ||
        value.state === 'video-upload-ready'
      ),
    });
    if (attempt) {
      writePublishAttemptRecord(attempt.recordPath, {
        attemptId: attempt.attemptId,
        platform: 'tiktok',
        status: 'preflight',
        recordedAt: new Date().toISOString(),
        state,
      });
    }
    if (state.loggedOut) {
      throw new Error('TikTok session unavailable in the selected Chrome profile.');
    }
    return state;
  } catch (error) {
    let fallbackState = null;
    try {
      fallbackState = parseBrowserResult(await session.evaluate({
        urlPrefix: 'https://www.tiktok.com/tiktokstudio/',
        openUrl: TIKTOK_UPLOAD_URL,
        js: TIKTOK_PREFLIGHT_JS,
      }));
    } catch {
      // Preserve the original error if the page is unavailable.
    }

    if (attempt) {
      writePublishAttemptRecord(attempt.recordPath, {
        attemptId: attempt.attemptId,
        platform: 'tiktok',
        status: 'preflight-failed',
        recordedAt: new Date().toISOString(),
        error: error.message,
        state: fallbackState,
      });
    }

    if (fallbackState && fallbackState.loggedOut) {
      throw new Error('TikTok session unavailable in the selected Chrome profile.');
    }

    if (fallbackState) {
      throw new Error(`TikTok did not reach an authenticated upload surface: ${JSON.stringify({
        url: fallbackState.url,
        title: fallbackState.title,
        state: fallbackState.state,
        body: fallbackState.body,
      })}`);
    }

    throw error;
  }
}

async function prepareInstagramDraft(bundle, session, { dryRun = false, attempt = null }) {
  const instagramAssets = bundle.platforms.instagram.assetPaths;
  if (!instagramAssets || instagramAssets.length === 0) {
    throw new Error('Instagram publish requires slide image assets.');
  }

  if (dryRun) {
    return {
      platform: 'instagram',
      mode: 'dry-run',
      assetCount: instagramAssets.length,
    };
  }

  await session.poll({
    urlPrefix: INSTAGRAM_URL,
    openUrl: INSTAGRAM_URL,
    js: INSTAGRAM_COMPOSER_JS,
    isReady: (state) => state && state.state === 'ready',
  });

  const uploadState = session.setInputFiles
    ? await session.setInputFiles({
      urlPrefix: INSTAGRAM_URL,
      openUrl: INSTAGRAM_URL,
      files: instagramAssets,
      accept: 'image',
      multiple: true,
    })
    : parseBrowserResult(await session.evaluate({
      urlPrefix: INSTAGRAM_URL,
      openUrl: INSTAGRAM_URL,
      js: buildBrowserUploadScript(instagramAssets),
    }));

  if (!uploadState.ok || uploadState.filesLength !== instagramAssets.length) {
    throw new Error(`Instagram upload failed: ${JSON.stringify(uploadState)}`);
  }
  if (attempt) {
    appendPublishAttemptEvent(attempt.recordPath, {
      platform: 'instagram',
      type: 'upload-complete',
      recordedAt: new Date().toISOString(),
      uploadState,
    });
  }
  await captureAttemptScreenshot(session, attempt, 'instagram-uploaded', {
    urlPrefix: INSTAGRAM_URL,
    openUrl: INSTAGRAM_URL,
  });

  await sleep(5000);

  let editorState = null;
  const editorStepStates = [];
  for (let index = 0; index < 5; index += 1) {
    editorState = parseBrowserResult(await session.evaluate({
      urlPrefix: INSTAGRAM_URL,
      openUrl: INSTAGRAM_URL,
      js: INSTAGRAM_EDITOR_JS,
    }));
    const stepState = {
      step: index + 1,
      recordedAt: new Date().toISOString(),
      state: editorState,
    };
    editorStepStates.push(stepState);
    if (attempt) {
      appendPublishAttemptEvent(attempt.recordPath, {
        platform: 'instagram',
        type: 'editor-state',
        ...stepState,
      });
    }
    if (editorState.hasEditor || editorState.shareVisible) {
      break;
    }
    if (editorState.hasError) {
      break;
    }
    if (!editorState.nextVisible) {
      await sleep(2000);
      continue;
    }
    const clickState = session.clickText
      ? await session.clickText({
        urlPrefix: INSTAGRAM_URL,
        openUrl: INSTAGRAM_URL,
        text: 'Next',
      })
      : parseBrowserResult(await session.evaluate({
        urlPrefix: INSTAGRAM_URL,
        openUrl: INSTAGRAM_URL,
        js: INSTAGRAM_NEXT_JS,
      }));
    if (attempt) {
      appendPublishAttemptEvent(attempt.recordPath, {
        platform: 'instagram',
        type: 'editor-next-click',
        recordedAt: new Date().toISOString(),
        step: index + 1,
        clickState,
      });
    }
    await captureAttemptScreenshot(session, attempt, `instagram-step-${index + 1}`, {
      urlPrefix: INSTAGRAM_URL,
      openUrl: INSTAGRAM_URL,
    });
    await sleep(4000);
  }

  if (!editorState || (!editorState.hasEditor && !editorState.shareVisible)) {
    if (attempt) {
      writePublishAttemptRecord(attempt.recordPath, {
        attemptId: attempt.attemptId,
        platform: 'instagram',
        status: editorState && editorState.hasError ? 'editor-error' : 'editor-timeout',
        recordedAt: new Date().toISOString(),
        uploadState,
        editorState,
        editorStepStates,
        events: readJson(attempt.recordPath, {}).events || [],
      });
    }
    throw new Error(`Instagram editor did not become ready: ${JSON.stringify(editorState)}`);
  }

  const caption = readText(bundle.instagramCaptionPath).trim();
  const captionState = parseBrowserResult(await session.evaluate({
    urlPrefix: INSTAGRAM_URL,
    openUrl: INSTAGRAM_URL,
    js: buildInstagramCaptionScript(caption),
  }));

  if (!captionState.ok) {
    throw new Error(`Instagram caption write failed: ${JSON.stringify(captionState)}`);
  }
  await captureAttemptScreenshot(session, attempt, 'instagram-draft-ready', {
    urlPrefix: INSTAGRAM_URL,
    openUrl: INSTAGRAM_URL,
  });

  const result = {
    platform: 'instagram',
    mode: 'draft-ready',
    assetCount: instagramAssets.length,
  };
  if (attempt) {
    writePublishAttemptRecord(attempt.recordPath, {
      attemptId: attempt.attemptId,
      platform: 'instagram',
      status: 'draft-ready',
      recordedAt: new Date().toISOString(),
      uploadState,
      captionState,
      result,
    });
  }
  return result;
}

async function publishInstagram(bundle, session, { dryRun = false, noShare = false, attempt = null }) {
  const draftState = await prepareInstagramDraft(bundle, session, { dryRun, attempt });
  if (dryRun || noShare) {
    return draftState;
  }

  const shareState = session.clickText
    ? await session.clickText({
      urlPrefix: INSTAGRAM_URL,
      openUrl: INSTAGRAM_URL,
      text: 'Share',
    })
    : parseBrowserResult(await session.evaluate({
      urlPrefix: INSTAGRAM_URL,
      openUrl: INSTAGRAM_URL,
      js: INSTAGRAM_SHARE_JS,
    }));

  if (!shareState.clicked) {
    throw new Error('Instagram share button was not available.');
  }

  await sleep(4000);
  const confirmationState = parseBrowserResult(await session.evaluate({
    urlPrefix: INSTAGRAM_URL,
    openUrl: INSTAGRAM_URL,
    js: `(() => JSON.stringify({
      url: location.href,
      title: document.title,
      body: document.body ? document.body.innerText.slice(0, 800) : ''
    }))()`,
  }));
  await captureAttemptScreenshot(session, attempt, 'instagram-published', {
    urlPrefix: INSTAGRAM_URL,
    openUrl: INSTAGRAM_URL,
  });
  const result = {
    platform: 'instagram',
    mode: 'published',
    finalUrl: confirmationState.url,
    confirmationState,
  };
  if (attempt) {
    writePublishAttemptRecord(attempt.recordPath, {
      attemptId: attempt.attemptId,
      platform: 'instagram',
      status: 'published',
      recordedAt: new Date().toISOString(),
      shareState,
      result,
    });
  }
  return result;
}

async function cleanupInstagramDraft(session) {
  await session.evaluate({
    urlPrefix: INSTAGRAM_URL,
    openUrl: INSTAGRAM_URL,
    js: INSTAGRAM_CLOSE_JS,
  });
  await sleep(500);
  await session.evaluate({
    urlPrefix: INSTAGRAM_URL,
    openUrl: INSTAGRAM_URL,
    js: INSTAGRAM_CLOSE_JS,
  });
}

async function prepareTikTokDraft(bundle, session, {
  dryRun = false,
  attempt = null,
  readyState = { state: 'video-upload-ready' },
} = {}) {
  const previewTarget = resolveTikTokPublishTarget(bundle, readyState);
  if (dryRun) {
    return {
      platform: 'tiktok',
      mode: 'dry-run',
      publishType: previewTarget.type,
      assetPaths: previewTarget.assetPaths,
    };
  }

  await session.poll({
    urlPrefix: 'https://www.tiktok.com/tiktokstudio/',
    openUrl: TIKTOK_UPLOAD_URL,
    js: TIKTOK_READY_JS,
    isReady: (state) => state && (
      state.state === 'photo-upload-ready' ||
      state.state === 'video-upload-ready' ||
      state.state === 'editor-ready'
    ),
  });

  const freshReadyState = parseBrowserResult(await session.evaluate({
    urlPrefix: 'https://www.tiktok.com/tiktokstudio/',
    openUrl: TIKTOK_UPLOAD_URL,
    js: TIKTOK_READY_JS,
  }));
  const target = resolveTikTokPublishTarget(bundle, freshReadyState);

  if (freshReadyState.state !== 'editor-ready') {
    const uploadState = session.setInputFiles
      ? await session.setInputFiles({
        urlPrefix: 'https://www.tiktok.com/tiktokstudio/',
        openUrl: TIKTOK_UPLOAD_URL,
        files: target.assetPaths,
        accept: target.type === 'photo-carousel' ? 'image' : 'video',
        multiple: target.type === 'photo-carousel',
      })
      : parseBrowserResult(await session.evaluate({
        urlPrefix: 'https://www.tiktok.com/tiktokstudio/',
        openUrl: TIKTOK_UPLOAD_URL,
        js: buildBrowserUploadScript(target.assetPaths),
      }));
    if (!uploadState.ok || uploadState.filesLength !== target.assetPaths.length) {
      throw new Error(`TikTok upload failed: ${JSON.stringify(uploadState)}`);
    }
    await captureAttemptScreenshot(session, attempt, 'tiktok-uploaded', {
      urlPrefix: 'https://www.tiktok.com/tiktokstudio/',
      openUrl: TIKTOK_UPLOAD_URL,
    });
    if (attempt) {
      writePublishAttemptRecord(attempt.recordPath, {
        attemptId: attempt.attemptId,
        platform: 'tiktok',
        status: 'upload-complete',
        recordedAt: new Date().toISOString(),
        readyState: freshReadyState,
        uploadState,
        target,
      });
    }
  }

  await session.poll({
    urlPrefix: 'https://www.tiktok.com/tiktokstudio/',
    openUrl: TIKTOK_UPLOAD_URL,
    js: TIKTOK_READY_JS,
    isReady: (state) => state && state.state === 'editor-ready',
  });

  await session.evaluate({
    urlPrefix: 'https://www.tiktok.com/tiktokstudio/',
    openUrl: TIKTOK_UPLOAD_URL,
    js: TIKTOK_FOCUS_EDITOR_JS,
  });
  const captionState = parseBrowserResult(await session.evaluate({
    urlPrefix: 'https://www.tiktok.com/tiktokstudio/',
    openUrl: TIKTOK_UPLOAD_URL,
    js: buildContentEditableCaptionScript(readText(bundle.tiktokCaptionPath).trim()),
  }));
  if (!captionState.ok) {
    throw new Error(`TikTok caption write failed: ${JSON.stringify(captionState)}`);
  }

  await session.evaluate({
    urlPrefix: 'https://www.tiktok.com/tiktokstudio/',
    openUrl: TIKTOK_UPLOAD_URL,
    js: TIKTOK_SET_FOLLOWERS_JS,
  });
  await captureAttemptScreenshot(session, attempt, 'tiktok-draft-ready', {
    urlPrefix: 'https://www.tiktok.com/tiktokstudio/',
    openUrl: TIKTOK_UPLOAD_URL,
  });

  const result = {
    platform: 'tiktok',
    mode: 'draft-ready',
    publishType: target.type,
    assetPaths: target.assetPaths,
  };
  if (attempt) {
    writePublishAttemptRecord(attempt.recordPath, {
      attemptId: attempt.attemptId,
      platform: 'tiktok',
      status: 'draft-ready',
      recordedAt: new Date().toISOString(),
      readyState: freshReadyState,
      captionState,
      result,
    });
  }
  return result;
}

async function publishTikTok(bundle, session, {
  dryRun = false,
  noShare = false,
  attempt = null,
  readyState = { state: 'video-upload-ready' },
} = {}) {
  const draftState = await prepareTikTokDraft(bundle, session, { dryRun, attempt, readyState });
  if (dryRun || noShare) {
    return draftState;
  }

  const postState = parseBrowserResult(await session.evaluate({
    urlPrefix: 'https://www.tiktok.com/tiktokstudio/',
    openUrl: TIKTOK_UPLOAD_URL,
    js: TIKTOK_POST_JS,
  }));

  if (!postState.clicked) {
    throw new Error('TikTok post button was not available.');
  }

  await session.poll({
    urlPrefix: TIKTOK_CONTENT_URL,
    openUrl: TIKTOK_CONTENT_URL,
    js: `
      (() => JSON.stringify({
        url: location.href,
        body: document.body ? document.body.innerText.slice(0, 2600) : ''
      }))()
    `,
    timeoutMs: 30000,
    intervalMs: 2000,
    isReady: (state) => state && typeof state.body === 'string' && state.body.includes(bundle.id.split('-').join(' ')) === false
      ? state.body.includes('Followers') && state.body.includes(readText(bundle.tiktokCaptionPath).trim().slice(0, 60))
      : state && typeof state.body === 'string' && state.body.includes(readText(bundle.tiktokCaptionPath).trim().slice(0, 60)),
  });

  const confirmationState = parseBrowserResult(await session.evaluate({
    urlPrefix: TIKTOK_CONTENT_URL,
    openUrl: TIKTOK_CONTENT_URL,
    js: `
      (() => JSON.stringify({
        url: location.href,
        title: document.title,
        body: document.body ? document.body.innerText.slice(0, 2400) : ''
      }))()
    `,
  }));
  await captureAttemptScreenshot(session, attempt, 'tiktok-published', {
    urlPrefix: TIKTOK_CONTENT_URL,
    openUrl: TIKTOK_CONTENT_URL,
  });
  const result = {
    platform: 'tiktok',
    mode: 'published',
    publishType: draftState.publishType,
    finalUrl: confirmationState.url,
    confirmationState,
  };
  if (attempt) {
    writePublishAttemptRecord(attempt.recordPath, {
      attemptId: attempt.attemptId,
      platform: 'tiktok',
      status: 'published',
      recordedAt: new Date().toISOString(),
      postState,
      result,
    });
  }
  return result;
}

async function cleanupTikTokDraft(session) {
  await session.evaluate({
    urlPrefix: 'https://www.tiktok.com/tiktokstudio/',
    openUrl: TIKTOK_UPLOAD_URL,
    js: TIKTOK_DISCARD_JS,
  });
}

async function publishBundle(bundlePath, options = {}) {
  const bundle = readJson(bundlePath, null);
  if (!bundle) {
    throw new Error(`Bundle manifest not found: ${bundlePath}`);
  }

  const platformSet = new Set(
    String(options.platforms || 'instagram,tiktok')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );

  const historyPath = options.historyPath || DEFAULT_HISTORY_PATH;
  const attempts = {};
  const fingerprints = {};
  const completedPlatforms = new Set();
  const results = [];
  let session = null;
  let publishError = null;

  if (platformSet.has('instagram')) {
    attempts.instagram = createPublishAttempt(bundle, 'instagram');
    fingerprints.instagram = buildPublishFingerprint({
      platform: 'instagram',
      captionText: readText(bundle.instagramCaptionPath).trim(),
      assetPaths: bundle.platforms.instagram.assetPaths,
    });
    writePublishAttemptRecord(attempts.instagram.recordPath, {
      attemptId: attempts.instagram.attemptId,
      platform: 'instagram',
      status: 'started',
      fingerprint: fingerprints.instagram,
      recordedAt: new Date().toISOString(),
    });
  }

  if (platformSet.has('tiktok')) {
    attempts.tiktok = createPublishAttempt(bundle, 'tiktok');
    fingerprints.tiktok = buildPublishFingerprint({
      platform: 'tiktok',
      captionText: readText(bundle.tiktokCaptionPath).trim(),
      assetPaths: bundle.platforms.tiktok.photoAssetPaths || bundle.slideImagePaths || [],
    });
    writePublishAttemptRecord(attempts.tiktok.recordPath, {
      attemptId: attempts.tiktok.attemptId,
      platform: 'tiktok',
      status: 'started',
      fingerprint: fingerprints.tiktok,
      recordedAt: new Date().toISOString(),
    });
  }

  if (!options.force && !options.dryRun && !options.noShare) {
    if (platformSet.has('instagram')) {
      assertPublishNotDuplicated({
        historyPath,
        fingerprint: fingerprints.instagram,
        platform: 'instagram',
      });
    }
    if (platformSet.has('tiktok')) {
      assertPublishNotDuplicated({
        historyPath,
        fingerprint: fingerprints.tiktok,
        platform: 'tiktok',
      });
    }
  }

  if (options.dryRun) {
    if (platformSet.has('instagram')) {
      results.push({
        platform: 'instagram',
        mode: 'dry-run',
        assetCount: bundle.platforms.instagram.assetPaths.length,
      });
    }
    if (platformSet.has('tiktok')) {
      const previewTarget = resolveTikTokPublishTarget(bundle, { state: 'video-upload-ready' });
      results.push({
        platform: 'tiktok',
        mode: 'dry-run',
        publishType: previewTarget.type,
        assetPaths: previewTarget.assetPaths,
      });
    }
    return results;
  }

  try {
    session = await createBrowserSession({
      browserBackend: options.browserBackend || 'auto',
      chromeBin: options.chromeBin || resolveChromeBinary(),
      profileRoot: options.profileRoot || DEFAULT_CHROME_PROFILE_ROOT,
      profileDir: options.profileDir || DEFAULT_CHROME_PROFILE_DIR,
      headless: Boolean(options.headless),
    });

    const preflightState = {};
    if (platformSet.has('instagram')) {
      preflightState.instagram = await preflightInstagramSession(session, attempts.instagram);
      await captureAttemptScreenshot(session, attempts.instagram, 'instagram-preflight', {
        urlPrefix: INSTAGRAM_URL,
        openUrl: INSTAGRAM_URL,
      });
    }
    if (platformSet.has('tiktok')) {
      preflightState.tiktok = await preflightTikTokSession(session, attempts.tiktok);
      await captureAttemptScreenshot(session, attempts.tiktok, 'tiktok-preflight', {
        urlPrefix: 'https://www.tiktok.com/tiktokstudio/',
        openUrl: TIKTOK_UPLOAD_URL,
      });
    }

    if (platformSet.has('instagram')) {
      const result = await publishInstagram(bundle, session, { ...options, attempt: attempts.instagram });
      appendJsonLine(historyPath, {
        platform: 'instagram',
        bundleId: bundle.id,
        fingerprint: fingerprints.instagram,
        status: result.mode,
        publishedAt: new Date().toISOString(),
        attemptId: attempts.instagram.attemptId,
        attemptDir: attempts.instagram.attemptDir,
        finalUrl: result.finalUrl || null,
        browserBackend: session.name,
      });
      completedPlatforms.add('instagram');
      results.push(result);
    }

    if (platformSet.has('tiktok')) {
      const result = await publishTikTok(bundle, session, {
        ...options,
        attempt: attempts.tiktok,
        readyState: preflightState.tiktok,
      });
      appendJsonLine(historyPath, {
        platform: 'tiktok',
        bundleId: bundle.id,
        fingerprint: fingerprints.tiktok,
        status: result.mode,
        publishType: result.publishType || null,
        publishedAt: new Date().toISOString(),
        attemptId: attempts.tiktok.attemptId,
        attemptDir: attempts.tiktok.attemptDir,
        finalUrl: result.finalUrl || null,
        browserBackend: session.name,
      });
      completedPlatforms.add('tiktok');
      results.push(result);
    }

    if (options.noShare && options.cleanupDrafts && !options.dryRun) {
      if (platformSet.has('instagram')) {
        await cleanupInstagramDraft(session);
      }
      if (platformSet.has('tiktok')) {
        await cleanupTikTokDraft(session);
      }
    }

    return results;
  } catch (error) {
    publishError = error;
    if (platformSet.has('instagram') && !completedPlatforms.has('instagram')) {
      appendJsonLine(historyPath, {
        platform: 'instagram',
        bundleId: bundle.id,
        fingerprint: fingerprints.instagram || null,
        status: 'failed',
        publishedAt: new Date().toISOString(),
        attemptId: attempts.instagram ? attempts.instagram.attemptId : null,
        attemptDir: attempts.instagram ? attempts.instagram.attemptDir : null,
        browserBackend: session ? session.name : options.browserBackend || 'auto',
        error: error.message,
      });
    }
    if (platformSet.has('tiktok') && !completedPlatforms.has('tiktok')) {
      appendJsonLine(historyPath, {
        platform: 'tiktok',
        bundleId: bundle.id,
        fingerprint: fingerprints.tiktok || null,
        status: 'failed',
        publishedAt: new Date().toISOString(),
        attemptId: attempts.tiktok ? attempts.tiktok.attemptId : null,
        attemptDir: attempts.tiktok ? attempts.tiktok.attemptDir : null,
        browserBackend: session ? session.name : options.browserBackend || 'auto',
        error: error.message,
      });
    }
    throw error;
  } finally {
    if (session) {
      try {
        await session.close();
      } catch (closeError) {
        if (!publishError) {
          throw closeError;
        }
        console.error(`[social-pipeline] session cleanup warning: ${closeError.message}`);
      }
    }
  }
}

async function publishDueQueueEntries({
  queuePath = DEFAULT_QUEUE_PATH,
  historyPath = DEFAULT_HISTORY_PATH,
  dryRun = false,
  noShare = false,
  cleanupDrafts = false,
  force = false,
  browserBackend = 'auto',
  profileRoot = DEFAULT_CHROME_PROFILE_ROOT,
  profileDir = DEFAULT_CHROME_PROFILE_DIR,
  headless = false,
  now = new Date(),
}) {
  const queueState = loadQueueState(queuePath);
  const dueEntries = getDueEntries(queueState, now);
  const results = [];

  for (const entry of dueEntries) {
    try {
      const publishResults = await publishBundle(entry.bundlePath, {
        platforms: entry.platforms.join(','),
        historyPath,
        dryRun,
        noShare,
        cleanupDrafts,
        force,
        browserBackend,
        profileRoot,
        profileDir,
        headless,
      });
      entry.status = dryRun || noShare ? 'prepared' : 'published';
      entry.publishedAt = new Date().toISOString();
      entry.attempts.push({
        at: entry.publishedAt,
        ok: true,
        results: publishResults,
      });
      results.push({ entry, publishResults });
    } catch (error) {
      entry.status = 'failed';
      entry.attempts.push({
        at: new Date().toISOString(),
        ok: false,
        error: error.message,
      });
      results.push({ entry, error: error.message });
    }
  }

  saveQueueState(queuePath, queueState);
  return results;
}

function buildLaunchAgentPlist({
  label = DEFAULT_LAUNCHD_LABEL,
  repoRoot = REPO_ROOT,
  queuePath = DEFAULT_QUEUE_PATH,
  intervalMinutes = DEFAULT_SCHEDULE_INTERVAL_MINUTES,
  nodeBin = process.execPath,
  scriptPath = path.join(REPO_ROOT, 'scripts', 'social-pipeline.js'),
}) {
  const intervalSeconds = Number(intervalMinutes) * 60;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${nodeBin}</string>
      <string>${scriptPath}</string>
      <string>publish-queue</string>
      <string>--queue</string>
      <string>${queuePath}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${repoRoot}</string>
    <key>StartInterval</key>
    <integer>${intervalSeconds}</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${path.join(repoRoot, '.artifacts', 'social', 'launchd.stdout.log')}</string>
    <key>StandardErrorPath</key>
    <string>${path.join(repoRoot, '.artifacts', 'social', 'launchd.stderr.log')}</string>
  </dict>
</plist>
`;
}

function installLaunchAgent({
  label = DEFAULT_LAUNCHD_LABEL,
  intervalMinutes = DEFAULT_SCHEDULE_INTERVAL_MINUTES,
  queuePath = DEFAULT_QUEUE_PATH,
  dryRun = false,
}) {
  const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
  const plist = buildLaunchAgentPlist({
    label,
    intervalMinutes,
    queuePath,
  });

  if (dryRun) {
    return { plistPath, plist };
  }

  writeText(plistPath, plist);
  try {
    cp.execFileSync('launchctl', ['unload', plistPath], { stdio: 'ignore' });
  } catch {
    // Ignore if not loaded yet.
  }
  cp.execFileSync('launchctl', ['load', '-w', plistPath], { stdio: 'ignore' });
  return { plistPath, plist };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const command = args._[0] || 'status';

  if (command === 'prepare') {
    const sourceHtmlPath = resolvePath(args.source, DEFAULT_ASSET_HTML);
    const outputDir = resolvePath(args.output, path.join(DEFAULT_OUTPUT_ROOT, slugify(args.slug || 'pre-action-gates')));
    const { manifestPath, manifest } = prepareBundle({
      sourceHtmlPath,
      captionPath: resolvePath(args.caption, DEFAULT_CAPTION_PATH),
      captionText: args['caption-text'],
      outputDir,
      slug: args.slug || 'pre-action-gates',
      slideDurationSeconds: Number(args['slide-seconds'] || 2.4),
      dryRun: Boolean(args['dry-run']),
    });
    console.log(JSON.stringify({ manifestPath, manifest }, null, 2));
    return;
  }

  if (command === 'post') {
    const sourceHtmlPath = resolvePath(args.source, DEFAULT_ASSET_HTML);
    const slug = args.slug || path.basename(sourceHtmlPath, path.extname(sourceHtmlPath));
    const outputDir = resolvePath(args.output, path.join(DEFAULT_OUTPUT_ROOT, slugify(slug)));
    const { manifestPath, manifest } = prepareBundle({
      sourceHtmlPath,
      captionPath: resolvePath(args.caption, DEFAULT_CAPTION_PATH),
      captionText: args['caption-text'],
      outputDir,
      slug,
      slideDurationSeconds: Number(args['slide-seconds'] || 2.4),
      dryRun: Boolean(args['dry-run']),
    });
    const results = await publishBundle(manifestPath, {
      platforms: args.platforms || 'instagram,tiktok',
      historyPath: resolvePath(args.history, DEFAULT_HISTORY_PATH),
      dryRun: Boolean(args['dry-run']),
      noShare: Boolean(args['no-share']),
      cleanupDrafts: Boolean(args['cleanup-drafts']),
      force: Boolean(args.force),
      browserBackend: args.backend || 'auto',
      profileRoot: resolveChromeProfileRoot(args['profile-root'] || DEFAULT_CHROME_PROFILE_ROOT),
      profileDir: args['profile-dir'] || DEFAULT_CHROME_PROFILE_DIR,
      headless: Boolean(args.headless),
    });
    console.log(JSON.stringify({ manifestPath, manifest, results }, null, 2));
    return;
  }

  if (command === 'queue') {
    const entry = enqueueBundle({
      queuePath: resolvePath(args.queue, DEFAULT_QUEUE_PATH),
      bundlePath: resolvePath(args.bundle),
      scheduledAt: args.when || args.at,
      platforms: String(args.platforms || 'instagram,tiktok').split(',').map((value) => value.trim()).filter(Boolean),
    });
    console.log(JSON.stringify(entry, null, 2));
    return;
  }

  if (command === 'publish') {
    const results = await publishBundle(resolvePath(args.bundle), {
      platforms: args.platforms || 'instagram,tiktok',
      historyPath: resolvePath(args.history, DEFAULT_HISTORY_PATH),
      dryRun: Boolean(args['dry-run']),
      noShare: Boolean(args['no-share']),
      cleanupDrafts: Boolean(args['cleanup-drafts']),
      force: Boolean(args.force),
      browserBackend: args.backend || 'auto',
      profileRoot: resolveChromeProfileRoot(args['profile-root'] || DEFAULT_CHROME_PROFILE_ROOT),
      profileDir: args['profile-dir'] || DEFAULT_CHROME_PROFILE_DIR,
      headless: Boolean(args.headless),
    });
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  if (command === 'publish-queue') {
    const results = await publishDueQueueEntries({
      queuePath: resolvePath(args.queue, DEFAULT_QUEUE_PATH),
      historyPath: resolvePath(args.history, DEFAULT_HISTORY_PATH),
      dryRun: Boolean(args['dry-run']),
      noShare: Boolean(args['no-share']),
      cleanupDrafts: Boolean(args['cleanup-drafts']),
      force: Boolean(args.force),
      browserBackend: args.backend || 'auto',
      profileRoot: resolveChromeProfileRoot(args['profile-root'] || DEFAULT_CHROME_PROFILE_ROOT),
      profileDir: args['profile-dir'] || DEFAULT_CHROME_PROFILE_DIR,
      headless: Boolean(args.headless),
      now: args.now ? new Date(args.now) : new Date(),
    });
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  if (command === 'install-scheduler') {
    const result = installLaunchAgent({
      label: args.label || DEFAULT_LAUNCHD_LABEL,
      intervalMinutes: Number(args['interval-minutes'] || DEFAULT_SCHEDULE_INTERVAL_MINUTES),
      queuePath: resolvePath(args.queue, DEFAULT_QUEUE_PATH),
      dryRun: Boolean(args['dry-run']),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'status') {
    const queuePath = resolvePath(args.queue, DEFAULT_QUEUE_PATH);
    const queueState = loadQueueState(queuePath);
    console.log(JSON.stringify({
      queuePath,
      historyPath: resolvePath(args.history, DEFAULT_HISTORY_PATH),
      publishHistory: loadPublishHistory(resolvePath(args.history, DEFAULT_HISTORY_PATH)),
      entries: queueState.entries || [],
    }, null, 2));
    return;
  }

  throw new Error(`Unknown command "${command}"`);
}

module.exports = {
  DEFAULT_ASSET_HTML,
  DEFAULT_CAPTION_PATH,
  DEFAULT_CHROME_PROFILE_DIR,
  DEFAULT_CHROME_PROFILE_ROOT,
  DEFAULT_HISTORY_PATH,
  DEFAULT_QUEUE_PATH,
  DEFAULT_LAUNCHD_LABEL,
  assertPublishNotDuplicated,
  buildBundleManifest,
  buildPublishFingerprint,
  buildChromeJavaScriptAppleScript,
  buildFfmpegConcatManifest,
  buildIsolatedSlideDocument,
  buildLaunchAgentPlist,
  buildBrowserUploadScript,
  buildContentEditableCaptionScript,
  appendPublishAttemptEvent,
  enqueueBundle,
  extractHeadContent,
  extractSlideBlocks,
  getDueEntries,
  loadQueueState,
  loadPublishHistory,
  normalizePlatformList,
  mimeTypeForPath,
  normalizeTikTokCaption,
  preflightTikTokSession,
  prepareBundle,
  publishBundle,
  resolveChromeProfileRoot,
  renderSlides,
  renderTikTokVideo,
  resolveTikTokPublishTarget,
  saveQueueState,
  slugify,
  validateSlideImages,
  writeIsolatedSlideDocuments,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
