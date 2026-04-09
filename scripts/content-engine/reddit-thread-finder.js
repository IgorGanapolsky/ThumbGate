#!/usr/bin/env node
'use strict';

/**
 * reddit-thread-finder.js
 * Searches Reddit for threads where people are discussing AI agent mistakes,
 * governance, or safety pain points — threads where a ThumbGate reply would
 * be genuinely helpful.
 *
 * Usage:
 *   node scripts/content-engine/reddit-thread-finder.js
 *   node scripts/content-engine/reddit-thread-finder.js --dry-run
 *   node scripts/content-engine/reddit-thread-finder.js --limit 20
 *
 * No Reddit auth required — uses the public JSON API.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const USER_AGENT = 'script:thumbgate-content:v1.0 (by /u/thumbgate_bot)';

const SUBREDDITS = [
  'ChatGPTCoding',
  'ClaudeAI',
  'cursor',
  'devops',
  'SoftwareEngineering',
  'ExperiencedDevs',
  'MachineLearning',
  'LocalLLaMA',
];

const SEARCH_KEYWORDS = [
  'agent broke',
  'agent deleted',
  'AI overwrote',
  'force push',
  'lost my code',
  'prevent AI from',
  'stop Claude from',
  'stop Cursor from',
  'guardrails',
  'AI agent safety',
  'coding agent mistakes',
  'agent governance',
  'pre-commit hook AI',
  'AI code review',
  'agent permissions',
];

const RATE_LIMIT_MS = 2000; // 2 seconds between requests

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { dryRun: false, limit: 10 };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') {
      opts.dryRun = true;
    } else if (args[i] === '--limit' && args[i + 1]) {
      opts.limit = parseInt(args[i + 1], 10) || 10;
      i++;
    }
  }

  return opts;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    };

    https
      .get(url, options, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return resolve(httpsGet(res.headers.location));
        }

        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject(
              new Error(`HTTP ${res.statusCode} for ${url}: ${body.slice(0, 200)}`)
            );
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`JSON parse error for ${url}: ${e.message}`));
          }
        });
      })
      .on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Reddit search
// ---------------------------------------------------------------------------

/**
 * Search a single subreddit for a keyword.
 * Returns up to `limit` post objects from the listing.
 */
async function searchSubreddit(subreddit, keyword, limit = 5) {
  const q = encodeURIComponent(keyword);
  const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${q}&sort=new&t=week&limit=${limit}&restrict_sr=1`;

  try {
    const data = await httpsGet(url);
    const children = data?.data?.children || [];
    return children.map((c) => ({ ...c.data, _subreddit: subreddit, _keyword: keyword }));
  } catch (err) {
    console.error(`  ⚠ Search failed (r/${subreddit} + "${keyword}"): ${err.message}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Relevance scoring
// ---------------------------------------------------------------------------

const NOW_MS = Date.now();
const ONE_DAY_MS = 86400 * 1000;

/**
 * Score a thread by recency (decays over 7 days), upvotes, and comment count.
 * Higher = more worth replying to.
 */
function scoreThread(post) {
  const ageMs = NOW_MS - post.created_utc * 1000;
  const ageDays = ageMs / ONE_DAY_MS;
  const recencyScore = Math.max(0, 7 - ageDays) / 7; // 1.0 on day 0 → 0.0 on day 7

  const upvoteScore = Math.log10(Math.max(1, post.ups || 0)) / 4; // log10(10000)/4 = 1.0
  const commentScore = Math.log10(Math.max(1, post.num_comments || 0)) / 3;

  return recencyScore * 0.5 + upvoteScore * 0.3 + commentScore * 0.2;
}

// ---------------------------------------------------------------------------
// Reply generator
// ---------------------------------------------------------------------------

// Pain point → technical insight mapping
const PAIN_POINT_PATTERNS = [
  {
    patterns: ['force push', 'lost my code', 'deleted', 'overwrote'],
    insight:
      'The root issue is that most AI agents execute destructive operations without a confirmation gate. ' +
      'A pre-tool hook that intercepts `git push --force`, file deletions, and overwrites before they run ' +
      'gives you a human-in-the-loop checkpoint at the exact moment the damage would happen.',
    angle: 'destructive-operation gate',
  },
  {
    patterns: ['guardrails', 'prevent AI from', 'stop Claude from', 'stop Cursor from', 'agent permissions'],
    insight:
      'The challenge with most guardrail approaches is they operate at the prompt level — you tell the model ' +
      'what not to do. Tool-level enforcement is more reliable: intercept the actual tool call (file write, ' +
      'bash exec, git op) via a PreToolUse hook before it reaches the filesystem.',
    angle: 'tool-level enforcement',
  },
  {
    patterns: ['agent broke', 'agent governance', 'coding agent mistakes', 'agent safety'],
    insight:
      'Agent mistakes tend to cluster around a small set of failure modes: wrong-scope edits, missing ' +
      'context, and no rollback checkpoint. Capturing each failure as a structured lesson and automatically ' +
      'generating a prevention rule means the agent that burned you once never burns you the same way again.',
    angle: 'feedback-to-prevention loop',
  },
  {
    patterns: ['pre-commit hook AI', 'AI code review'],
    insight:
      'Pre-commit hooks work great for human commits but miss AI-generated changes that bypass the commit ' +
      'step entirely (direct file writes, in-place edits). A PreToolUse hook fires before the write, not ' +
      'after, which is the safer enforcement point.',
    angle: 'pre-write enforcement',
  },
];

function detectAngle(post) {
  const text = `${post.title} ${post.selftext || ''}`.toLowerCase();

  for (const entry of PAIN_POINT_PATTERNS) {
    if (entry.patterns.some((p) => text.includes(p.toLowerCase()))) {
      return entry;
    }
  }

  // Fallback
  return {
    insight:
      'The general pattern here is that AI agents need enforcement at the tool-call layer, not just at ' +
      'the prompt layer. Once a tool call is intercepted you can gate it, log it, or require human approval.',
    angle: 'tool-call interception',
  };
}

function generateReply(post) {
  const entry = detectAngle(post);
  const subreddit = post._subreddit;

  return `Hey, this thread hits on something we ran into constantly while building with AI agents.

${entry.insight}

We built ThumbGate (https://github.com/IgorGanapolsky/ThumbGate) specifically around the ${entry.angle} problem. It adds PreToolUse hooks that intercept agent tool calls before they execute, captures thumbs-up/down feedback on each action, promotes that feedback into persistent memory, and auto-generates prevention rules so the same mistake can't recur.

If you want to try it on your own setup:

\`\`\`
npx thumbgate@latest init
\`\`\`

It wires itself into your \`.claude/settings.json\` in about 30 seconds — no Reddit or OAuth credentials needed, just runs locally.

Happy to answer questions about the ${entry.angle} implementation if useful for your r/${subreddit} thread.`;
}

// ---------------------------------------------------------------------------
// De-duplication
// ---------------------------------------------------------------------------

function deduplicateByPostId(posts) {
  const seen = new Set();
  return posts.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function formatDate(utcSeconds) {
  return new Date(utcSeconds * 1000).toISOString().slice(0, 10);
}

function buildMarkdown(threads, opts) {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [];

  lines.push(`# ThumbGate Reddit Thread Opportunities — ${today}`);
  lines.push('');
  lines.push(
    `> Generated by \`scripts/content-engine/reddit-thread-finder.js\` | ` +
      `${threads.length} threads | dry-run: ${opts.dryRun}`
  );
  lines.push('');
  lines.push('---');
  lines.push('');

  threads.forEach((t, i) => {
    lines.push(`## ${i + 1}. [r/${t._subreddit}] ${t.title}`);
    lines.push('');
    lines.push(`- **URL**: https://reddit.com${t.permalink}`);
    lines.push(`- **Posted**: ${formatDate(t.created_utc)}`);
    lines.push(`- **Upvotes**: ${t.ups ?? 0} | **Comments**: ${t.num_comments ?? 0}`);
    lines.push(`- **Relevance score**: ${t._score.toFixed(3)}`);
    lines.push(`- **Matched keyword**: \`${t._keyword}\``);
    lines.push('');

    if (t.selftext && t.selftext.length > 0) {
      const preview = t.selftext.slice(0, 300).replace(/\n+/g, ' ');
      lines.push(`**Thread excerpt**: ${preview}${t.selftext.length > 300 ? '…' : ''}`);
      lines.push('');
    }

    if (!opts.dryRun) {
      lines.push('### Suggested reply');
      lines.push('');
      lines.push('```');
      lines.push(t._suggestedReply);
      lines.push('```');
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  });

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs();

  console.log('🔍 ThumbGate Reddit Thread Finder');
  console.log(`   dry-run: ${opts.dryRun} | limit: ${opts.limit}`);
  console.log('');

  const allPosts = [];
  const totalSearches = SUBREDDITS.length * SEARCH_KEYWORDS.length;
  let searchCount = 0;

  for (const subreddit of SUBREDDITS) {
    for (const keyword of SEARCH_KEYWORDS) {
      searchCount++;
      process.stdout.write(
        `\r   Searching (${searchCount}/${totalSearches}): r/${subreddit} + "${keyword}"${' '.repeat(20)}`
      );

      const posts = await searchSubreddit(subreddit, keyword, 5);
      allPosts.push(...posts);

      if (searchCount < totalSearches) {
        await sleep(RATE_LIMIT_MS);
      }
    }
  }

  process.stdout.write('\n');
  console.log(`\n   Raw results: ${allPosts.length} posts (before de-dup)`);

  // De-duplicate, score, sort
  const unique = deduplicateByPostId(allPosts);
  console.log(`   Unique posts: ${unique.length}`);

  const scored = unique
    .map((p) => ({ ...p, _score: scoreThread(p) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, opts.limit);

  console.log(`   Top ${scored.length} threads selected`);

  // Generate replies
  if (!opts.dryRun) {
    scored.forEach((t) => {
      t._suggestedReply = generateReply(t);
    });
  }

  // Write markdown output
  const today = new Date().toISOString().slice(0, 10);
  const outputDir = path.join(__dirname, 'output');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `reddit-threads-${today}.md`);
  const markdown = buildMarkdown(scored, opts);
  fs.writeFileSync(outputPath, markdown, 'utf8');

  console.log(`\n✅ Output saved to: ${outputPath}`);
  console.log('');

  // Print summary to stdout
  scored.forEach((t, i) => {
    console.log(`${i + 1}. [${t._score.toFixed(3)}] r/${t._subreddit} — ${t.title.slice(0, 80)}`);
  });
}

// ---------------------------------------------------------------------------
// Weekly analytics summary (exported for programmatic use)
// ---------------------------------------------------------------------------

/**
 * Read the social analytics SQLite DB and return a summary object containing:
 *   - top5Posts: top 5 posts by engagement (likes + comments + shares)
 *   - weekOverWeekGrowth: follower growth vs previous week per platform
 *   - bestContentType: content_type with highest average engagement
 *
 * @param {string} [dbPath] - path to analytics.sqlite (defaults to the
 *   canonical path in scripts/social-analytics/db/analytics.sqlite)
 * @returns {{ top5Posts: object[], weekOverWeekGrowth: object[], bestContentType: object[] }}
 */
function weeklyAnalyticsSummary(dbPath) {
  const DEFAULT_DB = path.join(
    __dirname,
    '..',
    'social-analytics',
    'db',
    'analytics.sqlite'
  );

  const resolvedPath = dbPath || DEFAULT_DB;

  let Database;
  try {
    Database = require('better-sqlite3');
  } catch (e) {
    throw new Error(
      'better-sqlite3 is required for weeklyAnalyticsSummary. ' +
        'Run: npm install better-sqlite3'
    );
  }

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Analytics DB not found at: ${resolvedPath}`);
  }

  const db = new Database(resolvedPath, { readonly: true });

  // Check whether the expected tables exist; return empty summary if the DB
  // has not been populated yet (e.g. first run before pollers have run).
  const tableNames = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name);

  if (!tableNames.includes('engagement_metrics')) {
    db.close();
    return {
      top5Posts: [],
      weekOverWeekGrowth: [],
      bestContentType: [],
      _warning: 'engagement_metrics table not found — DB may not be populated yet. Run the social analytics pollers first.',
    };
  }

  try {
    // Top 5 posts by total engagement (likes + comments + shares)
    const top5Posts = db
      .prepare(
        `SELECT
           platform,
           content_type,
           post_id,
           post_url,
           published_at,
           metric_date,
           likes,
           comments,
           shares,
           (likes + comments + shares) AS total_engagement
         FROM engagement_metrics
         ORDER BY total_engagement DESC
         LIMIT 5`
      )
      .all();

    // Week-over-week follower growth per platform
    // Compare the most recent snapshot to the snapshot ~7 days prior
    const weekOverWeekGrowth = db
      .prepare(
        `WITH ranked AS (
           SELECT
             platform,
             follower_count,
             snapshot_date,
             ROW_NUMBER() OVER (PARTITION BY platform ORDER BY snapshot_date DESC) AS rn
           FROM follower_snapshots
         ),
         latest AS (SELECT platform, follower_count FROM ranked WHERE rn = 1),
         prev   AS (SELECT platform, follower_count FROM ranked WHERE rn = 7)
         SELECT
           l.platform,
           l.follower_count AS current_followers,
           COALESCE(p.follower_count, l.follower_count) AS prev_followers,
           (l.follower_count - COALESCE(p.follower_count, l.follower_count)) AS growth,
           ROUND(
             CAST(l.follower_count - COALESCE(p.follower_count, l.follower_count) AS REAL)
             / MAX(1, COALESCE(p.follower_count, l.follower_count)) * 100,
             2
           ) AS growth_pct
         FROM latest l
         LEFT JOIN prev p ON l.platform = p.platform
         ORDER BY growth DESC`
      )
      .all();

    // Best performing content type (by average total engagement)
    const bestContentType = db
      .prepare(
        `SELECT
           content_type,
           COUNT(*) AS post_count,
           ROUND(AVG(likes + comments + shares), 1) AS avg_engagement,
           SUM(likes + comments + shares) AS total_engagement
         FROM engagement_metrics
         GROUP BY content_type
         ORDER BY avg_engagement DESC
         LIMIT 5`
      )
      .all();

    return { top5Posts, weekOverWeekGrowth, bestContentType };
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// CLI entry-point guard
// ---------------------------------------------------------------------------

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ Fatal error:', err.message);
    process.exit(1);
  });
}

module.exports = { weeklyAnalyticsSummary, scoreThread, generateReply };
