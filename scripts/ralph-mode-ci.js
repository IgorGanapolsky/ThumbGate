#!/usr/bin/env node
'use strict';

/**
 * Ralph Mode CI — runs in GitHub Actions with secrets injected.
 * Handles: X tweets, X mention replies, LinkedIn posts, GitHub issue monitoring,
 * GitHub repo search + outreach, dev.to publishing, ThumbGate stats.
 */

const crypto = require('crypto');
const https = require('https');

// ── Env ─────────────────────────────────────────────────────────────────
const X_API_KEY = process.env.X_API_KEY;
const X_API_SECRET = process.env.X_API_SECRET;
const X_ACCESS_TOKEN = process.env.X_ACCESS_TOKEN;
const X_ACCESS_TOKEN_SECRET = process.env.X_ACCESS_TOKEN_SECRET;
const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN;
const LINKEDIN_ACCESS_TOKEN = process.env.LINKEDIN_ACCESS_TOKEN;
const LINKEDIN_PERSON_URN = process.env.LINKEDIN_PERSON_URN;
const DEVTO_API_KEY = process.env.DEVTO_API_KEY;
const GH_TOKEN = process.env.GH_TOKEN;

// ── X OAuth 1.0a ───────────────────────────────────────────────────────
function oauthSign(method, url, params, consumerSecret, tokenSecret) {
  const sp = Object.keys(params).sort().map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
  const bs = method + '&' + encodeURIComponent(url) + '&' + encodeURIComponent(sp);
  return crypto.createHmac('sha1', encodeURIComponent(consumerSecret) + '&' + encodeURIComponent(tokenSecret)).update(bs).digest('base64');
}

function xAuthHeader(method, url) {
  const p = {
    oauth_consumer_key: X_API_KEY,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: X_ACCESS_TOKEN,
    oauth_version: '1.0',
  };
  p.oauth_signature = oauthSign(method, url, p, X_API_SECRET, X_ACCESS_TOKEN_SECRET);
  return 'OAuth ' + Object.keys(p).sort().map(k => encodeURIComponent(k) + '="' + encodeURIComponent(p[k]) + '"').join(', ');
}

// ── Helpers ─────────────────────────────────────────────────────────────
async function postTweet(text) {
  const url = 'https://api.twitter.com/2/tweets';
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: xAuthHeader('POST', url), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const j = await r.json();
  return { id: j.data?.id, error: j.detail };
}

async function replyTweet(text, replyTo) {
  const url = 'https://api.twitter.com/2/tweets';
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: xAuthHeader('POST', url), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, reply: { in_reply_to_tweet_id: replyTo } }),
  });
  const j = await r.json();
  return { id: j.data?.id, error: j.detail };
}

async function postLinkedIn(text) {
  const r = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + LINKEDIN_ACCESS_TOKEN,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify({
      author: LINKEDIN_PERSON_URN,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text },
          shareMediaCategory: 'NONE',
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    }),
  });
  const j = await r.json();
  return { id: j.id, status: r.status };
}

async function ghApi(endpoint) {
  const r = await fetch('https://api.github.com' + endpoint, {
    headers: { Authorization: 'token ' + GH_TOKEN, Accept: 'application/vnd.github+json' },
  });
  return r.json();
}

async function ghPostComment(repo, issueNum, body) {
  const r = await fetch(`https://api.github.com/repos/${repo}/issues/${issueNum}/comments`, {
    method: 'POST',
    headers: {
      Authorization: 'token ' + GH_TOKEN,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body }),
  });
  return r.json();
}

// ── State file (persisted via git) ──────────────────────────────────────
const fs = require('fs');
const STATE_PATH = '.thumbgate/ralph-state.json';

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return {}; }
}

function saveState(state) {
  fs.mkdirSync('.thumbgate', { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

// ── Tweet angles ────────────────────────────────────────────────────────
const TWEET_ANGLES = [
  'Your CLAUDE.md has 50 rules. Your agent ignores half.\n\nThumbGate turns each into a PreToolUse gate — a physical block before the tool call executes.\n\nnpx thumbgate quick-start\nhttps://github.com/IgorGanapolsky/ThumbGate',
  'Self-distillation: your AI agent learns from its own mistakes.\n\n1. Agent runs tool call\n2. System checks outcome\n3. Failure → rule auto-generated\n4. Next session: gate blocks it\n\nZero human feedback needed.\n\nhttps://github.com/IgorGanapolsky/ThumbGate',
  'Thompson Sampling for AI agent gates:\n\nEach gate: Beta(alpha, beta)\nCorrect block → alpha++ → tighter\nFalse positive → beta++ → relaxes\n\nNo thresholds. Gates converge on their own.\n\nhttps://github.com/IgorGanapolsky/ThumbGate',
  'Google DeepMind: hidden prompt injections commandeer AI agents 86% of the time.\n\nThumbGate gates the action, not the prompt. PreToolUse hooks are the last defense.\n\nhttps://github.com/IgorGanapolsky/ThumbGate',
  'Every AI agent framework ships memory. None ship enforcement.\n\nMemory: "Don\'t force-push to main"\nEnforcement: *physically blocked*\n\nThumbGate is the enforcement layer.\n\nhttps://github.com/IgorGanapolsky/ThumbGate',
  'Founding Member: $49 once. ThumbGate Pro forever.\n\n50 spots. No subscription.\n\nSelf-distillation, SQL MCP gates, Thompson Sampling, context-stuffing, 68 tools on Smithery.\n\nhttps://buy.stripe.com/aFa4gz1M84r419v7mb3sI05',
  'Context-stuffing: skip RAG entirely.\n\nDump ALL prevention rules into agent context at session start. 20-200 rules = 1K-10K tokens.\n\nInspired by Karpathy. Simpler. Faster.\n\nhttps://github.com/IgorGanapolsky/ThumbGate',
  'The AI agent safety stack:\n\nGovernance: Paperclip\nOrchestration: iloom\nContext: RepoWise\nEnforcement: ThumbGate\n\nAll open source. All necessary.\n\nhttps://github.com/IgorGanapolsky/ThumbGate',
];

// ── GitHub issues to monitor ────────────────────────────────────────────
const WATCHED_ISSUES = [
  { repo: 'leogodin217/leos_claude_starter', num: 1 },
  { repo: 'RepoWise/backend', num: 34 },
  { repo: 'ScaleLeanChris/paperclip-ing', num: 1 },
  { repo: 'sd0xdev/sd0x-dev-flow', num: 5 },
  { repo: 'logi-cmd/agent-guardrails', num: 3 },
];

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== RALPH MODE CI — ' + new Date().toISOString() + ' ===\n');
  const state = loadState();
  const report = { tweets: 0, replies: 0, linkedin: 0, ghIssues: 0, ghOutreach: 0 };

  // ── 1. Check X mentions and reply ──
  if (X_BEARER_TOKEN && X_API_KEY) {
    try {
      const bearer = decodeURIComponent(X_BEARER_TOKEN);
      const mentionsRes = await fetch(
        'https://api.twitter.com/2/tweets/search/recent?query=(@IgorGanapolsky OR thumbgate) -from:IgorGanapolsky&max_results=20&tweet.fields=author_id,text,created_at,id&expansions=author_id&user.fields=username',
        { headers: { Authorization: 'Bearer ' + bearer } }
      ).then(r => r.json());

      const mu = {};
      (mentionsRes.includes?.users || []).forEach(u => mu[u.id] = u);
      const lastChecked = state.lastMentionCheck || '2026-04-01T00:00:00Z';
      const newMentions = (mentionsRes.data || []).filter(
        t => new Date(t.created_at) > new Date(lastChecked) && (mu[t.author_id] || {}).username !== 'IgorGanapolsky'
      );

      console.log('X mentions since last check: ' + newMentions.length);

      for (const t of newMentions.slice(0, 5)) {
        const u = mu[t.author_id] || {};
        const replyText = '@' + u.username + ' ThumbGate: PreToolUse enforcement for AI agents. Thompson Sampling adapts confidence. 68 tools on Smithery.\n\nhttps://github.com/IgorGanapolsky/ThumbGate';
        const r = await replyTweet(replyText, t.id);
        console.log('  Replied to @' + u.username + ': ' + (r.id || r.error));
        report.replies++;
      }

      state.lastMentionCheck = new Date().toISOString();
    } catch (e) {
      console.log('X mentions error: ' + e.message);
    }

    // ── 2. Post new tweet ──
    try {
      const angleIndex = Math.floor(Date.now() / 7200000) % TWEET_ANGLES.length;
      const r = await postTweet(TWEET_ANGLES[angleIndex]);
      console.log('Tweet posted: ' + (r.id || r.error));
      report.tweets++;
    } catch (e) {
      console.log('Tweet error: ' + e.message);
    }
  } else {
    console.log('X: skipped (no API keys)');
  }

  // ── 3. LinkedIn post ──
  if (LINKEDIN_ACCESS_TOKEN && LINKEDIN_PERSON_URN) {
    try {
      const lastLinkedin = state.lastLinkedinPost || '2026-04-01T00:00:00Z';
      const hoursSince = (Date.now() - new Date(lastLinkedin).getTime()) / 3600000;
      if (hoursSince >= 4) {
        const angles = [
          'ThumbGate: pre-action gates for AI coding agents. 68 tools on Smithery. Works with Claude Code, Cursor, Codex, Gemini, Amp.\n\nnpx thumbgate quick-start\n\nhttps://github.com/IgorGanapolsky/ThumbGate',
          'Every AI agent framework ships memory. None ship enforcement.\n\nThumbGate adds PreToolUse hooks that block bad actions before execution. Thompson Sampling adapts. Self-distillation auto-learns.\n\nhttps://github.com/IgorGanapolsky/ThumbGate',
        ];
        const r = await postLinkedIn(angles[Math.floor(Date.now() / 14400000) % angles.length]);
        console.log('LinkedIn posted: ' + (r.id || r.status));
        state.lastLinkedinPost = new Date().toISOString();
        report.linkedin++;
      } else {
        console.log('LinkedIn: skipped (' + Math.round(4 - hoursSince) + 'hr until next)');
      }
    } catch (e) {
      console.log('LinkedIn error: ' + e.message);
    }
  } else {
    console.log('LinkedIn: skipped (no token)');
  }

  // ── 4. GitHub issue monitoring ──
  if (GH_TOKEN) {
    const knownComments = state.issueComments || {};

    for (const { repo, num } of WATCHED_ISSUES) {
      try {
        const issue = await ghApi('/repos/' + repo + '/issues/' + num);
        const key = repo + '#' + num;
        const prev = knownComments[key] || 0;

        if (issue.comments > prev) {
          console.log(key + ': ' + (issue.comments - prev) + ' new comment(s)');

          // Read latest comment
          const comments = await ghApi('/repos/' + repo + '/issues/' + num + '/comments?per_page=1&page=' + issue.comments);
          const latest = comments[0];
          if (latest && latest.user.login !== 'IgorGanapolsky') {
            const reply = 'Thanks for the response! ThumbGate adds PreToolUse enforcement — gates that block known-bad actions before execution. Thompson Sampling adapts confidence. Self-distillation auto-generates rules from outcomes.\n\n68 tools on [Smithery](https://smithery.ai/servers/rlhf-loop/thumbgate). Would love to explore integration.\n\nhttps://github.com/IgorGanapolsky/ThumbGate';
            await ghPostComment(repo, num, reply);
            console.log('  Replied to @' + latest.user.login);
            report.ghIssues++;
          }
        } else {
          console.log(key + ': no new comments');
        }

        knownComments[key] = issue.comments;
      } catch (e) {
        console.log(repo + '#' + num + ' error: ' + e.message);
      }
    }

    // ── 5. Search for new repos ──
    try {
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const search = await ghApi('/search/repositories?q=agent+safety+OR+pretooluse+OR+claude+code+hooks+OR+mcp+gate+pushed:>' + weekAgo + '&sort=stars&order=desc&per_page=5');
      const contacted = new Set(state.contactedRepos || []);
      let opened = 0;

      for (const repo of (search.items || [])) {
        if (opened >= 2) break;
        if (repo.stargazers_count < 3) continue;
        if (contacted.has(repo.full_name)) continue;
        if (repo.full_name.includes('IgorGanapolsky')) continue;

        const body = 'Hey — noticed you\'re building in the AI agent safety space. [ThumbGate](https://github.com/IgorGanapolsky/ThumbGate) adds PreToolUse hooks that block known-bad actions before execution, with Thompson Sampling for adaptive gate confidence and self-distillation for auto-learning from outcomes.\n\n68 tools on [Smithery](https://smithery.ai/servers/rlhf-loop/thumbgate). Could be complementary — would love to explore integration.\n\nMIT licensed, free tier available.';

        try {
          await fetch('https://api.github.com/repos/' + repo.full_name + '/issues', {
            method: 'POST',
            headers: {
              Authorization: 'token ' + GH_TOKEN,
              Accept: 'application/vnd.github+json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              title: 'Integration: ThumbGate enforcement layer for ' + repo.name,
              body: body,
            }),
          });
          console.log('Opened issue on ' + repo.full_name + ' (stars=' + repo.stargazers_count + ')');
          contacted.add(repo.full_name);
          opened++;
          report.ghOutreach++;
        } catch (e) {
          console.log('Issue creation failed on ' + repo.full_name + ': ' + e.message);
        }
      }

      state.contactedRepos = [...contacted];
    } catch (e) {
      console.log('Repo search error: ' + e.message);
    }

    // ── 6. ThumbGate stats ──
    try {
      const repo = await ghApi('/repos/IgorGanapolsky/ThumbGate');
      console.log('ThumbGate: stars=' + repo.stargazers_count + ' forks=' + repo.forks_count);
    } catch (e) {
      console.log('Stats error: ' + e.message);
    }

    // ── 7. awesome-mcp PR ──
    try {
      const pr = await ghApi('/repos/punkpeye/awesome-mcp-servers/pulls/4474');
      console.log('awesome-mcp#4474: state=' + pr.state + ' merged=' + pr.merged);
    } catch (e) {
      console.log('PR check error: ' + e.message);
    }

    state.issueComments = knownComments;
  } else {
    console.log('GitHub: skipped (no token)');
  }

  // ── Save state ──
  state.lastRun = new Date().toISOString();
  saveState(state);

  // ── Report ──
  console.log('\n=== REPORT ===');
  console.log('Tweets: ' + report.tweets);
  console.log('Replies: ' + report.replies);
  console.log('LinkedIn: ' + report.linkedin);
  console.log('GitHub issues responded: ' + report.ghIssues);
  console.log('GitHub outreach opened: ' + report.ghOutreach);
  console.log('=== DONE ===');
}

main().catch(e => {
  console.error('Ralph Mode CI fatal error:', e.message);
  process.exit(1);
});
