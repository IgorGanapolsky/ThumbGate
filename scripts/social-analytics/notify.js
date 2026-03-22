'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_DIGEST_PATH = path.join(REPO_ROOT, '.artifacts', 'social', 'digests', 'digest.json');

/**
 * Sends a formatted digest to Slack via an incoming webhook.
 * Skips silently if SLACK_WEBHOOK_URL is not set.
 *
 * @param {object} digest
 * @returns {Promise<void>}
 */
async function sendSlackDigest(digest) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!webhookUrl) {
    console.log('Slack webhook not configured, skipping notification');
    return;
  }

  const { period, summary, top_content } = digest;

  const followerLines = Object.entries(summary.follower_delta)
    .map(([platform, delta]) => {
      const sign = delta >= 0 ? '+' : '';
      return `• ${platform}: ${sign}${delta}`;
    })
    .join('\n');

  const topThree = (top_content || []).slice(0, 3);
  const topLines = topThree.length
    ? topThree
        .map((item, idx) => {
          const urlPart = item.post_url ? ` — <${item.post_url}|link>` : '';
          return `${idx + 1}. *${item.platform}* \`${item.post_id}\` — ${item.total_engagement} eng / ${(item.impressions || 0).toLocaleString()} impressions${urlPart}`;
        })
        .join('\n')
    : '_No content recorded._';

  const payload = {
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `Weekly Social Digest (${period.start} → ${period.end})`,
          emoji: false,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `*Impressions:* ${summary.total_impressions.toLocaleString()}`,
            `*Likes:* ${summary.total_likes.toLocaleString()}`,
            `*Comments:* ${summary.total_comments.toLocaleString()}`,
            `*Shares:* ${summary.total_shares.toLocaleString()}`,
            `*Engagement Rate:* ${summary.engagement_rate}`,
            '',
            '*Follower Delta:*',
            followerLines,
          ].join('\n'),
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Top 3 Content:*\n${topLines}`,
        },
      },
    ],
  };

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Slack webhook failed: ${response.status} ${response.statusText} — ${body}`);
  }

  console.log(`Slack digest sent for period ${period.start} → ${period.end}`);
}

/**
 * Returns a formatted string for terminal output. Always works — no Slack needed.
 *
 * @param {object} digest
 * @returns {string}
 */
function formatDigestForConsole(digest) {
  const { period, summary, top_content } = digest;

  const lines = [];

  lines.push('');
  lines.push(`Weekly Social Digest: ${period.start} -> ${period.end}`);
  lines.push('='.repeat(60));
  lines.push('');
  lines.push('SUMMARY');
  lines.push(`  Impressions    : ${summary.total_impressions.toLocaleString()}`);
  lines.push(`  Likes          : ${summary.total_likes.toLocaleString()}`);
  lines.push(`  Comments       : ${summary.total_comments.toLocaleString()}`);
  lines.push(`  Shares         : ${summary.total_shares.toLocaleString()}`);
  lines.push(`  Engagement Rate: ${summary.engagement_rate}`);
  lines.push('');
  lines.push('FOLLOWER DELTA');
  for (const [platform, delta] of Object.entries(summary.follower_delta)) {
    const sign = delta >= 0 ? '+' : '';
    lines.push(`  ${platform.padEnd(12)}: ${sign}${delta}`);
  }
  lines.push('');
  lines.push('TOP CONTENT');

  const topThree = (top_content || []).slice(0, 3);
  if (topThree.length === 0) {
    lines.push('  No content recorded in this period.');
  } else {
    topThree.forEach((item, idx) => {
      lines.push(`  ${idx + 1}. [${item.platform}] ${item.post_id}`);
      lines.push(`     Engagement: ${item.total_engagement}  Impressions: ${(item.impressions || 0).toLocaleString()}`);
      if (item.post_url) {
        lines.push(`     URL: ${item.post_url}`);
      }
    });
  }

  lines.push('');

  return lines.join('\n');
}

module.exports = {
  sendSlackDigest,
  formatDigestForConsole,
};

// Run as main: load latest digest and send.
if (require.main === module) {
  if (!fs.existsSync(DEFAULT_DIGEST_PATH)) {
    console.error(`Digest file not found: ${DEFAULT_DIGEST_PATH}`);
    console.error('Run scripts/social-analytics/digest.js first to generate it.');
    process.exit(1);
  }

  const digest = JSON.parse(fs.readFileSync(DEFAULT_DIGEST_PATH, 'utf8'));

  console.log(formatDigestForConsole(digest));

  sendSlackDigest(digest).catch((err) => {
    console.error('Failed to send Slack notification:', err.message);
    process.exit(1);
  });
}
