#!/usr/bin/env node
/**
 * Reddit Comment Dispatcher
 *
 * Posts a single reply to a Reddit comment or submission using the password-grant
 * OAuth flow with the ThumbGate-owned REDDIT_* credentials.
 *
 * Designed for `gh workflow run reddit-comment-dispatch.yml` so the CEO never has
 * to context-switch into a browser to engage with a single high-intent commenter.
 *
 * Usage:
 *   node scripts/reddit-comment.js --parent-url=https://www.reddit.com/r/ClaudeCode/comments/1td3mzx/comment/olsk1mh/ --text="..."
 *   node scripts/reddit-comment.js --parent-fullname=t1_olsk1mh --text="..."
 *   node scripts/reddit-comment.js --parent-url=... --text=... --dry-run
 *
 * Required env (provided by the workflow via secrets):
 *   REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD
 *
 * Optional env:
 *   REDDIT_USER_AGENT — UA string for Reddit's API (defaults to a ThumbGate UA).
 *
 * Exit codes:
 *   0 success — prints the new comment's permalink on stdout
 *   1 transient/expected failure (auth 401, rate-limit, validation error)
 *   2 misuse — missing args / malformed URL
 */

'use strict';

const path = require('node:path');

const REDDIT_AUTH_URL = 'https://www.reddit.com/api/v1/access_token';
const REDDIT_API_BASE = 'https://oauth.reddit.com';
const DEFAULT_USER_AGENT =
  'thumbgate-comment-dispatcher/1.0 (by /u/' + (process.env.REDDIT_USERNAME || 'thumbgate') + ')';

function parseArgs(argv) {
  const args = { dryRun: false };
  for (const raw of argv.slice(2)) {
    if (raw === '--dry-run' || raw === '--dry') {
      args.dryRun = true;
      continue;
    }
    const eq = raw.indexOf('=');
    if (eq === -1 || !raw.startsWith('--')) continue;
    const key = raw.slice(2, eq);
    const val = raw.slice(eq + 1);
    if (key === 'parent-url') args.parentUrl = val;
    else if (key === 'parent-fullname') args.parentFullname = val;
    else if (key === 'text') args.text = val;
  }
  return args;
}

/**
 * Parse a Reddit comment or submission URL into a fullname (t1_xxx or t3_xxx).
 *
 * Accepts:
 *   https://www.reddit.com/r/X/comments/POST_ID/comment/COMMENT_ID/  -> t1_COMMENT_ID
 *   https://www.reddit.com/r/X/comments/POST_ID/slug/                -> t3_POST_ID
 *   https://reddit.com/comments/POST_ID                              -> t3_POST_ID
 *   https://old.reddit.com/r/X/comments/POST_ID/slug/COMMENT_ID/     -> t1_COMMENT_ID
 */
function parseFullnameFromUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)reddit\.com$/.test(parsed.hostname)) return null;
  const parts = parsed.pathname.split('/').filter(Boolean);
  // Comment URL: /r/<sub>/comments/<post36>/comment/<comment36>[/]
  const commentIdx = parts.indexOf('comment');
  if (commentIdx !== -1 && parts[commentIdx + 1]) {
    return 't1_' + parts[commentIdx + 1];
  }
  // Some old.reddit comment URLs use /comments/<post>/<slug>/<comment>/
  const commentsIdx = parts.indexOf('comments');
  if (commentsIdx !== -1 && parts.length >= commentsIdx + 4) {
    // Last path segment in /r/X/comments/POST/slug/COMMENT
    const last = parts[parts.length - 1];
    // Heuristic: comment IDs are base36, 5–10 chars. Slugs are longer + lowercase words.
    if (last && /^[a-z0-9]{5,10}$/i.test(last) && last !== parts[commentsIdx + 1]) {
      return 't1_' + last;
    }
  }
  // Submission URL: /r/<sub>/comments/<post36>/<slug>/ → reply to the post itself
  if (commentsIdx !== -1 && parts[commentsIdx + 1]) {
    return 't3_' + parts[commentsIdx + 1];
  }
  return null;
}

async function fetchAccessToken({ clientId, clientSecret, username, password, userAgent }) {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'password',
    username,
    password,
  }).toString();
  const res = await fetch(REDDIT_AUTH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': userAgent,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Reddit token endpoint returned ${res.status} ${res.statusText} — ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  if (!json.access_token) {
    throw new Error(`Reddit token response missing access_token: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return json.access_token;
}

async function postComment({ accessToken, userAgent, parentFullname, text }) {
  const body = new URLSearchParams({
    thing_id: parentFullname,
    text,
    api_type: 'json',
  }).toString();
  const res = await fetch(`${REDDIT_API_BASE}/api/comment`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': userAgent,
    },
    body,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Reddit /api/comment returned ${res.status} ${res.statusText} — ${JSON.stringify(json).slice(0, 200)}`);
  }
  // Reddit's wrapped error shape: { json: { errors: [...], data: {...} } }
  const errors = json?.json?.errors;
  if (Array.isArray(errors) && errors.length) {
    throw new Error(`Reddit /api/comment validation errors: ${JSON.stringify(errors).slice(0, 200)}`);
  }
  const things = json?.json?.data?.things;
  const created = Array.isArray(things) && things[0]?.data ? things[0].data : null;
  if (!created) {
    throw new Error(`Reddit /api/comment returned no created comment: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return {
    fullname: created.name,
    permalink: created.permalink ? `https://www.reddit.com${created.permalink}` : null,
    bodyExcerpt: (created.body || '').slice(0, 120),
  };
}

async function main(argv) {
  const args = parseArgs(argv);
  if (!args.text || (!args.parentUrl && !args.parentFullname)) {
    process.stderr.write(
      'Usage: reddit-comment.js --parent-url=<URL> --text=<TEXT> [--dry-run]\n' +
        '   or: reddit-comment.js --parent-fullname=t1_xxx --text=<TEXT> [--dry-run]\n'
    );
    process.exit(2);
  }

  const parentFullname =
    args.parentFullname || parseFullnameFromUrl(args.parentUrl);
  if (!parentFullname) {
    process.stderr.write(`Could not parse a Reddit fullname from --parent-url=${args.parentUrl}\n`);
    process.exit(2);
  }

  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  const username = process.env.REDDIT_USERNAME;
  const password = process.env.REDDIT_PASSWORD;
  if (!clientId || !clientSecret || !username || !password) {
    process.stderr.write('Missing REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, or REDDIT_PASSWORD in env\n');
    process.exit(2);
  }

  const userAgent = process.env.REDDIT_USER_AGENT || DEFAULT_USER_AGENT;

  if (args.dryRun) {
    process.stdout.write(
      JSON.stringify(
        {
          dryRun: true,
          parentFullname,
          textPreview: args.text.slice(0, 200),
          textLength: args.text.length,
          username,
          userAgent,
        },
        null,
        2
      ) + '\n'
    );
    return;
  }

  const accessToken = await fetchAccessToken({ clientId, clientSecret, username, password, userAgent });
  const result = await postComment({ accessToken, userAgent, parentFullname, text: args.text });
  process.stdout.write(JSON.stringify({ posted: true, ...result }, null, 2) + '\n');
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`reddit-comment dispatcher failed: ${err.message}\n`);
    process.exit(1);
  });
}

module.exports = { parseArgs, parseFullnameFromUrl, fetchAccessToken, postComment };
