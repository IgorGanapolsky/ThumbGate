#!/usr/bin/env node
'use strict';

/**
 * instagram-thumbgate-post.js
 * Posts ThumbGate Instagram card and caption via Zernio API.
 *
 * Usage:
 *   node instagram-thumbgate-post.js [--image-path=path/to/image.png]
 */

const path = require('path');
const {
  publishPost,
  schedulePost,
  getConnectedAccounts,
  uploadLocalMedia,
} = require('./publishers/zernio');

const THUMBGATE_CAPTION = `Your AI coding agent has amnesia. It forgets everything between sessions.

ThumbGate gives it memory that survives restarts. Thumbs-down a mistake → it becomes a prevention rule → the agent can't repeat it.

One command: npx thumbgate init

Works with Claude Code, Cursor, Codex, Gemini.

#AIAgents #DeveloperTools #ClaudeCode #ThumbGate`;

async function postThumbGateToInstagram(options = {}) {
  const caption = String(options.caption || THUMBGATE_CAPTION).trim();
  const imagePath = options.imagePath ? path.resolve(options.imagePath) : '';
  const schedule = String(options.schedule || '').trim();
  const timezone = String(options.timezone || 'America/New_York').trim() || 'America/New_York';

  try {
    console.log('[instagram] Fetching Zernio connected accounts...');
    const accounts = await getConnectedAccounts();

    // Find Instagram account
    const instagramAccount = accounts.find((a) => a.platform === 'instagram');
    if (!instagramAccount) {
      throw new Error('No Instagram account found in Zernio. Please connect Instagram first.');
    }

    console.log(`[instagram] Found Instagram account: ${instagramAccount.accountId}`);

    const platforms = [
      {
        platform: 'instagram',
        accountId: instagramAccount.accountId,
      },
    ];

    if (!imagePath) {
      throw new Error('Instagram posts require an imagePath because Zernio requires media content for Instagram posts.');
    }

    console.log(`[instagram] Uploading Instagram media from ${imagePath}...`);
    const mediaItem = await uploadLocalMedia(imagePath);

    const publishOptions = {
      mediaItems: [mediaItem],
      utm: options.utm,
    };

    let result;
    if (schedule) {
      console.log(`[instagram] Scheduling Instagram post for ${schedule} (${timezone})...`);
      result = await schedulePost(caption, platforms, schedule, timezone, publishOptions);
    } else {
      console.log('[instagram] Publishing ThumbGate caption to Instagram...');
      result = await publishPost(caption, platforms, publishOptions);
    }
    if (result && result.blocked) {
      const reasons = Array.isArray(result.reasons)
        ? result.reasons.map((reason) => reason.reason || reason.id || String(reason)).join(', ')
        : 'quality gate blocked the caption';
      throw new Error(`Instagram post blocked: ${reasons}`);
    }

    if (schedule) {
      console.log('✅ Instagram post scheduled successfully!');
    } else {
      console.log('✅ Post published successfully!');
    }
    console.log(`Post ID: ${result.id || result.data?.id || 'unknown'}`);
    return result;
  } catch (err) {
    console.error(`❌ Failed to post to Instagram: ${err.message}`);
    throw err;
  }
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const imageArg = args.find((arg) => arg.startsWith('--image-path='));
  const imagePath = imageArg ? imageArg.slice('--image-path='.length) : '';

  (async () => {
    try {
      await postThumbGateToInstagram({ imagePath });
      process.exit(0);
    } catch (err) {
      process.exit(1);
    }
  })();
}

module.exports = { postThumbGateToInstagram, THUMBGATE_CAPTION };
