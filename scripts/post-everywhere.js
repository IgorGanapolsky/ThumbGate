'use strict';

/**
 * post-everywhere.js
 * Unified CLI to post content to all social platforms from a single markdown post file.
 *
 * Usage:
 *   node scripts/post-everywhere.js docs/marketing/reddit-cursor-post.md
 *   node scripts/post-everywhere.js docs/marketing/reddit-cursor-post.md --dry-run
 *   node scripts/post-everywhere.js docs/marketing/reddit-cursor-post.md --platforms=reddit,linkedin,threads
 *
 * Active channels (2026-04-20 onward): reddit, linkedin, threads, bluesky,
 * instagram, youtube. X/Twitter was dropped from the default distribution
 * loop on 2026-04-20; its publisher module was retired.
 *
 * Post file format (markdown with metadata):
 *   # Reddit Post: r/cursor
 *   **Subreddit:** r/cursor
 *   **Title:** ...
 *   **Body:** ...
 *   **Comment (post immediately after):** ...
 *
 * The script parses the markdown, extracts platform-specific fields, and dispatches to
 * the appropriate publisher module.
 *
 * Env vars: see individual publisher modules for required credentials per platform.
 */

const fs = require('fs');
const path = require('path');
const { tagUrlsInText } = require('./social-analytics/utm');
const { isDuplicate, recordPost } = require('./social-analytics/publishers/zernio');

// ---------------------------------------------------------------------------
// Publisher imports (lazy — only loaded when needed)
// ---------------------------------------------------------------------------

function getPublisher(platform) {
  const publishers = {
    reddit: () => require('./social-analytics/publishers/reddit.js'),
    linkedin: () => require('./social-analytics/publishers/linkedin.js'),
    devto: () => require('./social-analytics/publishers/devto.js'),
    threads: () => require('./social-analytics/publishers/threads.js'),
    bluesky: () => require('./social-analytics/publishers/zernio.js'),
    instagram: () => require('./social-analytics/publishers/instagram.js'),
    tiktok: () => require('./social-analytics/publishers/tiktok.js'),
    youtube: () => require('./social-analytics/publishers/youtube.js'),
  };
  const loader = publishers[platform];
  if (!loader) throw new Error(`Unknown platform: ${platform}`);
  return loader();
}

// ---------------------------------------------------------------------------
// Markdown parser
// ---------------------------------------------------------------------------

/**
 * Parse a marketing post markdown file into structured fields.
 * Extracts: subreddit, title, body, comment, platform hints.
 */
function parsePostFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');

  const result = {
    platform: null,
    subreddit: null,
    title: null,
    body: null,
    comment: null,
    imagePath: null,
    tags: [],
  };

  // Detect platform from header. X/Twitter was retired 2026-04-20 and is no
  // longer mapped — any such header falls through to the default platform list.
  const header = lines[0] || '';
  if (/reddit/i.test(header)) result.platform = 'reddit';
  else if (/obsidian/i.test(header)) result.platform = 'reddit'; // Obsidian posts go to Reddit
  else if (/locallama/i.test(header)) result.platform = 'reddit';
  else if (/programming/i.test(header)) result.platform = 'reddit';
  else if (/linkedin/i.test(header)) result.platform = 'linkedin';
  else if (/threads/i.test(header)) result.platform = 'threads';
  else if (/bluesky|bsky/i.test(header)) result.platform = 'bluesky';
  else if (/instagram/i.test(header)) result.platform = 'instagram';
  else if (/youtube/i.test(header)) result.platform = 'youtube';
  else if (/dev\.to/i.test(header)) result.platform = 'devto';

  // Extract subreddit
  const subLine = lines.find((l) => /^\*\*Subreddit:\*\*/i.test(l.trim()));
  if (subLine) {
    const match = subLine.match(/r\/(\w+)/);
    if (match) result.subreddit = match[1];
  }

  // Extract title
  const titleLine = lines.find((l) => /^\*\*Title:\*\*/i.test(l.trim()));
  if (titleLine) {
    result.title = titleLine.replace(/^\*\*Title:\*\*\s*/i, '').trim();
  }

  // Optional image attachment (path relative to CWD or absolute).
  // Used by the Instagram dispatcher and any future media-required platforms.
  const imageLine = lines.find((l) => /^\*\*Image:\*\*/i.test(l.trim()));
  if (imageLine) {
    const raw = imageLine.replace(/^\*\*Image:\*\*\s*/i, '').trim();
    if (raw) result.imagePath = path.isAbsolute(raw) ? raw : path.resolve(raw);
  }

  // Extract body — content between **Body:** and the next **Comment or --- separator
  const bodyStartIdx = lines.findIndex((l) => /^\*\*Body:\*\*/i.test(l.trim()));
  if (bodyStartIdx !== -1) {
    const bodyLines = [];
    for (let i = bodyStartIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      // Stop at comment section or horizontal rule before comment
      if (/^\*\*Comment/i.test(line.trim())) break;
      if (line.trim() === '---' && i + 1 < lines.length && /^\*\*Comment/i.test(lines[i + 1].trim())) break;
      bodyLines.push(line);
    }
    result.body = bodyLines.join('\n').trim();
  }

  // Extract comment
  const commentStartIdx = lines.findIndex((l) => /^\*\*Comment/i.test(l.trim()));
  if (commentStartIdx !== -1) {
    const commentLines = [];
    for (let i = commentStartIdx + 1; i < lines.length; i++) {
      commentLines.push(lines[i]);
    }
    result.comment = commentLines.join('\n').trim();
  }

  return result;
}

// ---------------------------------------------------------------------------
// Platform dispatchers
// ---------------------------------------------------------------------------

async function postToReddit(parsed, dryRun) {
  const { subreddit, title, body, comment } = parsed;
  if (!subreddit || !title || !body) {
    throw new Error('Reddit post requires subreddit, title, and body');
  }

  if (dryRun) {
    console.log(`[dry-run] Reddit r/${subreddit}: "${title}" (${body.length} chars)`);
    if (comment) console.log(`[dry-run] Reddit follow-up comment: (${comment.length} chars)`);
    return { dryRun: true };
  }

  const reddit = getPublisher('reddit');
  const postData = await reddit.publishToReddit({ subreddit, title, text: body });

  // Reddit follow-up comments are manual-review only.
  if (comment && postData.name) {
    console.log('[post-everywhere] Reddit follow-up comment skipped; manual review required');
  }

  return postData;
}

async function postToLinkedIn(parsed, dryRun) {
  const text = parsed.body || '';
  if (!text) throw new Error('LinkedIn post requires body');

  if (dryRun) {
    console.log(`[dry-run] LinkedIn: "${text.slice(0, 100)}..." (${text.length} chars)`);
    return { dryRun: true };
  }

  const linkedin = getPublisher('linkedin');
  return linkedin.publishPost({ text });
}

async function postToDevTo(parsed, dryRun) {
  const { title, body } = parsed;
  if (!title || !body) throw new Error('Dev.to post requires title and body');

  if (dryRun) {
    console.log(`[dry-run] Dev.to: "${title}" (${body.length} chars)`);
    return { dryRun: true };
  }

  const devto = getPublisher('devto');
  return devto.publishArticle({ title, body_markdown: body, tags: parsed.tags });
}

async function postToTikTok(parsed, dryRun) {
  const text = parsed.body || '';
  if (!text) throw new Error('TikTok post requires body');

  if (dryRun) {
    console.log(`[dry-run] TikTok: "${text.slice(0, 100)}..." (${text.length} chars)`);
    return { dryRun: true };
  }

  const tiktok = getPublisher('tiktok');
  return tiktok.publishPost({ text });
}

async function postToYouTube(parsed, dryRun) {
  const { title, body } = parsed;
  if (!title || !body) throw new Error('YouTube post requires title and body');

  if (dryRun) {
    console.log(`[dry-run] YouTube: "${title}" (${body.length} chars)`);
    return { dryRun: true };
  }

  const youtube = getPublisher('youtube');
  return youtube.publishPost({ title, description: body });
}

/**
 * Publish to Instagram via Zernio.
 *
 * Instagram requires media, so this dispatcher:
 *   1. Uses parsed.imagePath if provided in the markdown metadata
 *      (e.g. `**Image:** path/to/card.png`), OR
 *   2. Falls back to auto-generating a ThumbGate card via sharp.
 *
 * Caption = title + body (truncated to 2200 chars, Instagram's limit).
 */
async function postToInstagram(parsed, dryRun, deps = {}) {
  const caption = [parsed.title, parsed.body]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 2200);
  if (!caption) throw new Error('Instagram post requires title or body');

  if (dryRun) {
    console.log(`[dry-run] Instagram: "${caption.slice(0, 100)}..." (${caption.length} chars)`);
    return { dryRun: true };
  }

  let imagePath = parsed.imagePath;
  if (!imagePath) {
    // Auto-generate ThumbGate card (requires sharp as optional dep).
    const generateInstagramCard = deps.generateInstagramCard
      || require('./social-analytics/generate-instagram-card').generateInstagramCard;
    const defaultPath = path.resolve(__dirname, '..', '.thumbgate', 'instagram-card.png');
    imagePath = await generateInstagramCard(defaultPath);
  }

  const postThumbGateToInstagram = deps.postThumbGateToInstagram
    || require('./social-analytics/instagram-thumbgate-post').postThumbGateToInstagram;
  return postThumbGateToInstagram({ caption, imagePath });
}

async function postToThreads(parsed, dryRun) {
  const text = [parsed.title, parsed.body].filter(Boolean).join('\n\n').slice(0, 500);
  if (!text) throw new Error('Threads post requires title or body');

  if (dryRun) {
    console.log(`[dry-run] Threads: "${text.slice(0, 100)}..." (${text.length} chars)`);
    return { dryRun: true };
  }

  const threads = getPublisher('threads');
  return threads.publishPost({ text });
}

async function postToBluesky(parsed, dryRun) {
  const text = [parsed.title, parsed.body].filter(Boolean).join('\n\n').slice(0, 300);
  if (!text) throw new Error('Bluesky post requires title or body');

  if (dryRun) {
    console.log(`[dry-run] Bluesky: "${text.slice(0, 100)}..." (${text.length} chars)`);
    return { dryRun: true };
  }

  // Bluesky posts route through Zernio's aggregator.
  const zernio = getPublisher('bluesky');
  return zernio.publishPost({ text, platform: 'bluesky' });
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

const DISPATCHERS = {
  reddit: postToReddit,
  linkedin: postToLinkedIn,
  devto: postToDevTo,
  tiktok: postToTikTok,
  youtube: postToYouTube,
  instagram: postToInstagram,
  threads: postToThreads,
  bluesky: postToBluesky,
};

async function postEverywhere(filePath, { platforms, dryRun, deps = {} } = {}) {
  const parsed = parsePostFile(filePath);
  console.log(`[post-everywhere] Parsed: platform=${parsed.platform}, subreddit=${parsed.subreddit}, title="${parsed.title}"`);

  const qualityGate = require('./social-quality-gate');
  const postText = [parsed.title, parsed.body, parsed.comment].filter(Boolean).join('\n');
  const gateResult = qualityGate.gatePost(postText);
  if (!gateResult.allowed) {
    const reasons = gateResult.findings.map(f => f.reason).join(', ');
    console.error(`[post-everywhere] BLOCKED by quality gate: ${reasons}`);
    return { blocked: true, reasons: gateResult.findings };
  }
  console.log('[post-everywhere] Quality gate: PASSED');

  // Determine which platforms to post to.
  // Default excludes devto — high-volume Dev.to posting is counterproductive (0 engagement on 427 posts).
  // Use --platforms=devto explicitly for monthly cross-posts only.
  // X/Twitter was removed from DEFAULT_PLATFORMS on 2026-04-20; current focus
  // is Reddit, LinkedIn, Threads, Bluesky, Instagram, YouTube.
  const targetPlatforms = platforms || (parsed.platform ? [parsed.platform] : Array.from(DEFAULT_PLATFORMS));

  // Preserve original body/comment so each platform gets a fresh UTM tag
  const originalBody = parsed.body;
  const originalComment = parsed.comment;

  // Tag trackable URLs with per-platform UTM parameters before dispatching
  const results = {};
  for (const platform of targetPlatforms) {
    const utmOpts = { source: platform, medium: 'social', campaign: 'organic' };
    parsed.body = originalBody ? tagUrlsInText(originalBody, utmOpts) : originalBody;
    parsed.comment = originalComment ? tagUrlsInText(originalComment, utmOpts) : originalComment;

    const dispatcher = DISPATCHERS[platform];
    if (!dispatcher) {
      console.warn(`[post-everywhere] No dispatcher for platform: ${platform}, skipping`);
      continue;
    }

    // Dedup guard: skip platforms where identical content was posted in last 24h
    const dedupContent = [parsed.title, parsed.body].filter(Boolean).join('\n');
    if (!dryRun && isDuplicate(dedupContent, platform)) {
      console.log(`[post-everywhere] ${platform}: SKIPPED — duplicate content within 24h`);
      results[platform] = { skipped: true, reason: 'duplicate_content_24h' };
      continue;
    }

    try {
      console.log(`\n[post-everywhere] Posting to ${platform}...`);
      // Dispatchers that support dep injection (currently just Instagram) get
      // the deps bag; others ignore the third arg.
      results[platform] = await dispatcher(parsed, dryRun, deps[platform] || {});
      if (!dryRun) recordPost(dedupContent, platform);
      console.log(`[post-everywhere] ${platform}: OK`);
    } catch (err) {
      console.error(`[post-everywhere] ${platform}: FAILED — ${err.message}`);
      results[platform] = { error: err.message };
    }
  }

  return results;
}

const DEFAULT_PLATFORMS = Object.freeze([
  'reddit',
  'linkedin',
  'threads',
  'bluesky',
  'instagram',
  'youtube',
]);

module.exports = { postEverywhere, parsePostFile, DEFAULT_PLATFORMS, DISPATCHERS };

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
if (require.main === module) {
  const args = process.argv.slice(2);
  const filePath = args.find((a) => !a.startsWith('--'));
  const dryRun = args.includes('--dry-run');

  function getArg(flag) {
    const prefix = `${flag}=`;
    const entry = args.find((a) => a.startsWith(prefix));
    return entry ? entry.slice(prefix.length) : null;
  }

  const platformsArg = getArg('--platforms');
  const platforms = platformsArg ? platformsArg.split(',').map((p) => p.trim()) : null;

  if (!filePath) {
    console.error('Usage: node scripts/post-everywhere.js <post-file.md> [--dry-run] [--platforms=reddit,linkedin,threads,bluesky,instagram,youtube]');
    process.exit(1);
  }

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exit(1);
  }

  // Load .env if available
  const envPath = path.resolve(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx);
        const value = trimmed.slice(eqIdx + 1);
        if (!process.env[key]) process.env[key] = value;
      }
    }
  }

  postEverywhere(resolved, { platforms, dryRun })
    .then((results) => {
      console.log('\n[post-everywhere] Results:', JSON.stringify(results, null, 2));
      const failed = Object.values(results).filter((r) => r.error);
      if (failed.length > 0) process.exit(1);
    })
    .catch((err) => {
      console.error('[post-everywhere] Fatal:', err.message);
      process.exit(1);
    });
}
