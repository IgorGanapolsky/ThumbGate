'use strict';

/**
 * X publisher for API v2 POST /2/tweets.
 *
 * Required env vars:
 *   X_OAUTH2_USER_TOKEN or X_BEARER_TOKEN
 *
 * The token must be a user-context token with tweet.write, users.read, and
 * tweet.read scope. App-only bearer tokens cannot create posts.
 */

const X_API_BASE = 'https://api.x.com/2';

function requireUserToken(env = process.env) {
  const token = env.X_OAUTH2_USER_TOKEN || env.X_ACCESS_TOKEN || env.X_BEARER_TOKEN;
  if (!token) {
    throw new Error('X_OAUTH2_USER_TOKEN env var is required for POST /2/tweets');
  }
  return token;
}

const MAX_X_SHORT_CHARS = 280;
const MAX_X_PREMIUM_ARTICLE_CHARS = 25000;

function buildXArticleTerminalBannerSvg({
  windowTitle = 'Claude Code · Cursor · OMP',
  guideLabel = 'Claude Code · full guide',
  heroTitle = "ThumbGate's",
  heroAccent = '59 gates',
  installCmd = 'npx thumbgate@latest init',
  modelStatusLine = '/model Opus 5.5 · $252/mo Jellyfish avg · <0.5ms PreToolUse',
} = {}) {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">',
    '  <rect width="1200" height="630" fill="#0d1117"/>',
    '  <rect x="60" y="45" width="1080" height="540" rx="16" fill="#161b22" stroke="#30363d" stroke-width="2"/>',
    '  <circle cx="95" cy="80" r="7" fill="#ff5f56"/>',
    '  <circle cx="118" cy="80" r="7" fill="#ffbd2e"/>',
    '  <circle cx="141" cy="80" r="7" fill="#27c93f"/>',
    `  <text x="165" y="85" fill="#8b949e" font-family="monospace" font-size="15">+ ${windowTitle}</text>`,
    '  <rect x="970" y="62" width="140" height="30" rx="6" fill="#f0f6fc"/>',
    '  <text x="985" y="82" fill="#0d1117" font-family="monospace" font-weight="bold" font-size="14">@IgorGanapolsky</text>',
    `  <text x="115" y="135" fill="#d29922" font-family="monospace" font-size="16">— ${guideLabel} ————————————————</text>`,
    '  <rect x="95" y="160" width="440" height="260" rx="12" fill="#0d1117" stroke="#d29922" stroke-width="1.5"/>',
    `  <text x="315" y="275" text-anchor="middle" fill="#f0f6fc" font-family="sans-serif" font-weight="bold" font-size="42">${heroTitle}</text>`,
    `  <text x="315" y="330" text-anchor="middle" fill="#e3b341" font-family="Georgia, serif" font-style="italic" font-size="44">${heroAccent}</text>`,
    '  <rect x="565" y="160" width="540" height="260" rx="12" fill="#0d1117" stroke="#30363d" stroke-width="1.5"/>',
    '  <text x="595" y="205" fill="#e3b341" font-family="monospace" font-weight="bold" font-size="17">Tips for getting started</text>',
    '  <text x="595" y="232" fill="#c9d1d9" font-family="monospace" font-size="16">59 curated rules, one install ($0 token tax)</text>',
    '  <text x="595" y="280" fill="#e3b341" font-family="monospace" font-weight="bold" font-size="17">Tested on real tasks</text>',
    '  <text x="595" y="310" fill="#f0f6fc" font-family="monospace" font-size="16">/swarm-claim · exit 3 stops losing agent writes</text>',
    '  <text x="595" y="338" fill="#f0f6fc" font-family="monospace" font-size="16">/teams-reply · 1 reply per message (0 double-posts)</text>',
    '  <text x="595" y="366" fill="#f0f6fc" font-family="monospace" font-size="16">/az-pr-draft · holds draft PR until cross-review</text>',
    `  <text x="95" y="475" fill="#8b949e" font-family="monospace" font-size="16">${modelStatusLine}</text>`,
    '  <rect x="95" y="495" width="520" height="46" rx="8" fill="#0d1117" stroke="#30363d" stroke-width="1"/>',
    `  <text x="115" y="524" fill="#58a6ff" font-family="monospace" font-size="18">&gt; ${installCmd}</text>`,
    '</svg>',
  ].join('\n');
}

function composeXArticleFullGuide({
  title = "How to Use ThumbGate's 59 PreToolUse Gates in Claude Code & Cursor (Full Guide)",
  jellyfishSpendUsd = 252,
} = {}) {
  const body = [
    `# ${title}`,
    '',
    `Jellyfish just reported that Claude Code bills hit $${jellyfishSpendUsd} a month per developer ($1,666/mo for 90th-percentile power users) as software factories automate code production.`,
    '',
    "ThumbGate is free, it's MIT licensed, and it takes one command to install.",
    '',
    "But a benchmark doesn't tell you what to type on day one. So three of the gates got a real test run in Claude Code and Cursor, in a live multi-agent project, on real tasks:",
    '',
    '1. `swarm-claim-exit-3-write-after-loss` caught `swarm-claim.py` exiting `3` when another agent already held the story, recorded it as a thumbs-down, and denied the losing agent\'s next `Edit`, `but commit`, and `git push` with `continue: false` — stopping the #1 multi-agent token leak cold.',
    '2. `teams-single-reply-per-message` allowed the first reply to a teammate on Microsoft Teams and hard-denied a second send on the same message or point.',
    '3. `az-repos-pr-publish-requires-cross-review` blocked `az repos pr update --is-draft false` until a review comment from the other engineer existed, preventing premature auto-merges.',
    '',
    '## Day-1 Commands (Copy & Run)',
    '',
    '```bash',
    'npx thumbgate@latest init',
    'npx thumbgate check --tool Bash --input \'{"command":"az repos pr update --id 69 --is-draft false"}\'',
    '```',
    '',
    '## Full Production Links & 4-Tier Value Ladder',
    '',
    '• Free Open-Source CLI (MIT): `npx thumbgate@latest init` (https://github.com/IgorGanapolsky/ThumbGate)',
    '• $9.99 2026 AI Agent Infrastructure & Cost Playbook: https://iganapolsky.gumroad.com/l/odrkon',
    '• $49 Complete Production Rule-Pack & DPO/AKV Kit (1-Time Corporate Expense): https://iganapolsky.gumroad.com/l/vcrho',
    '• $19/mo or $149/yr ThumbGate Pro (Direct 1-Click Stripe): https://thumbgate.ai/go/pro-direct',
    '• $499 48-Hr Enterprise Workflow Hardening Gate Diagnostic: https://thumbgate.ai/diagnostic',
  ].join('\n');

  const promotionTweet = [
    `Claude Code bills just hit $${jellyfishSpendUsd}/mo per developer (Jellyfish Oct 2026).`,
    '',
    'We tested 3 sub-0.5ms PreToolUse gates in Claude Code & Cursor on real multi-agent tasks:',
    '• Stop losing agents writing after claim exit 3',
    '• Block duplicate Teams replies',
    '• Hold draft PRs until cross-reviewed',
    '',
    'Full guide + 1-command install ↓',
    'https://thumbgate.ai/go/pro-direct',
  ].join('\n');

  const replyPlugTweet = [
    'Grab the exact production configs & rule packs here:',
    '• Free MIT CLI: npx thumbgate@latest init',
    '• $9.99 Playbook: https://iganapolsky.gumroad.com/l/odrkon',
    '• $49 1-Time Expense Kit: https://iganapolsky.gumroad.com/l/vcrho',
    '• $19/mo Pro Direct: https://thumbgate.ai/go/pro-direct',
  ].join('\n');

  return {
    title,
    articleMarkdown: body,
    characterCount: body.length,
    fitsXPremiumLongForm: body.length <= MAX_X_PREMIUM_ARTICLE_CHARS,
    bannerSvg: buildXArticleTerminalBannerSvg(),
    promotionTweet,
    replyPlugTweet,
  };
}

async function publishPost({
  text,
  mode = 'post',
  replyToTweetId = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!text) throw new Error('text is required');
  const token = requireUserToken(env);
  const maxChars = (mode === 'article' || mode === 'long_form')
    ? MAX_X_PREMIUM_ARTICLE_CHARS
    : MAX_X_SHORT_CHARS;
  const trimmed = [...String(text)].slice(0, maxChars).join('');

  const payload = { text: trimmed };
  if (replyToTweetId) {
    payload.reply = { in_reply_to_tweet_id: String(replyToTweetId) };
  }

  const res = await fetchImpl(`${X_API_BASE}/tweets`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`X API ${res.status}: ${body}`);
  }

  const json = await res.json();
  const id = json?.data?.id;
  const url = id ? `https://x.com/i/web/status/${id}` : null;
  return { ...json, id, url, mode, characterCount: [...trimmed].length };
}

module.exports = {
  MAX_X_SHORT_CHARS,
  MAX_X_PREMIUM_ARTICLE_CHARS,
  buildXArticleTerminalBannerSvg,
  composeXArticleFullGuide,
  publishPost,
};
