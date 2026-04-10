#!/usr/bin/env node
/**
 * Reddit Thread Finder for ThumbGate Engagement
 *
 * Add to package.json:
 *   "content:reddit": "node scripts/content-engine/reddit-thread-finder.js"
 *   "content:reddit:dry": "node scripts/content-engine/reddit-thread-finder.js --dry-run"
 *   "content:reddit:limit": "node scripts/content-engine/reddit-thread-finder.js --limit 20"
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const SUBREDDITS = [
  'ChatGPTCoding', 'ClaudeAI', 'cursor', 'devops',
  'SoftwareEngineering', 'ExperiencedDevs', 'MachineLearning', 'LocalLLaMA'
];

const KEYWORDS = [
  'agent broke', 'agent deleted', 'force push', 'prevent AI from',
  'guardrails', 'agent governance', 'coding agent mistakes'
];

const USER_AGENT = 'script:thumbgate-content:v1.0';
const DELAY = 2000; // ms between requests
const DEFAULT_LIMIT = 10;

let dryRun = false;
let outputLimit = DEFAULT_LIMIT;

process.argv.slice(2).forEach(arg => {
  if (arg === '--dry-run') dryRun = true;
  if (arg.startsWith('--limit')) outputLimit = parseInt(arg.split('=')[1] || arg.split(' ')[1], 10);
});

function fetchReddit(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': USER_AGENT } }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
  });
}

async function searchSubreddit(sub, keyword) {
  const url = `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(keyword)}&sort=new&t=week&limit=5`;
  try {
    const data = await fetchReddit(url);
    return (data.data?.children || []).map(post => ({
      id: post.data.id,
      title: post.data.title,
      url: `https://reddit.com${post.data.permalink}`,
      subreddit: post.data.subreddit,
      score: post.data.score,
      numComments: post.data.num_comments,
      created: post.data.created_utc,
      selftext: post.data.selftext
    }));
  } catch (err) {
    console.error(`Error searching ${sub} for "${keyword}": ${err.message}`);
    return [];
  }
}

function scoreThread(thread) {
  const now = Math.floor(Date.now() / 1000);
  const ageHours = (now - thread.created) / 3600;
  const recencyScore = Math.max(0, 1 - ageHours / 168); // 0-1 over a week
  const upvoteScore = Math.log(Math.max(1, thread.score)) / Math.log(100);
  const commentScore = Math.log(Math.max(1, thread.numComments)) / Math.log(100);

  return (recencyScore * 0.5) + (upvoteScore * 0.3) + (commentScore * 0.2);
}

function generateReply(thread) {
  const context = thread.selftext.substring(0, 200);
  return `
**ThumbGate can help prevent this.** Our pre-action gates catch agent mistakes before they happen:
- Stop force pushes on protected branches
- Prevent deletions of critical files
- Verify AI actions before execution
- Capture lessons from failures to block similar mistakes

Learn more: https://thumbgate-production.up.railway.app/dashboard
`;
}

async function main() {
  console.log(`[${new Date().toISOString()}] Starting Reddit thread finder...`);

  const threads = {};
  let requestCount = 0;

  for (const sub of SUBREDDITS) {
    for (const keyword of KEYWORDS) {
      if (requestCount > 0) await new Promise(r => setTimeout(r, DELAY));

      console.log(`  Searching r/${sub} for "${keyword}"...`);
      const results = await searchSubreddit(sub, keyword);

      results.forEach(thread => {
        if (!threads[thread.id]) {
          threads[thread.id] = thread;
        }
      });
      requestCount++;
    }
  }

  const sorted = Object.values(threads)
    .sort((a, b) => scoreThread(b) - scoreThread(a))
    .slice(0, outputLimit);

  const date = new Date().toISOString().split('T')[0];
  const outputDir = path.join(__dirname, 'output');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let markdown = `# Reddit Threads - ${date}\n\nFound ${sorted.length} high-relevance threads.\n\n`;

  sorted.forEach((thread, idx) => {
    const score = scoreThread(thread);
    markdown += `## ${idx + 1}. ${thread.title}\n`;
    markdown += `**r/${thread.subreddit}** | [Link](${thread.url}) | Score: ${thread.score} | Comments: ${thread.numComments}\n`;
    markdown += `**Relevance Score:** ${score.toFixed(2)}\n\n`;

    if (!dryRun) {
      markdown += `**Suggested Reply:**\n${generateReply(thread)}\n\n`;
    }
    markdown += '---\n\n';
  });

  const outputFile = path.join(outputDir, `reddit-threads-${date}.md`);
  fs.writeFileSync(outputFile, markdown);

  console.log(`\n✅ Generated ${sorted.length} threads to ${outputFile}`);
  if (dryRun) console.log('   (--dry-run: no reply suggestions included)');
}

main().catch(err => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
