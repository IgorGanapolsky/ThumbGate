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
  publishToAllPlatforms,
  getConnectedAccounts,
} = require('./publishers/zernio');

const THUMBGATE_CAPTION = `Your AI coding agent forgets everything between sessions.

ThumbGate gives it memory that survives restarts. Thumbs-down a mistake → it becomes a prevention rule → the agent can't repeat it.

One command: npx mcp-memory-gateway init

Works with Claude Code, Cursor, Codex, Gemini.

#AIAgents #DeveloperTools #CodingAgents #MCP #OpenSource #ClaudeCode #ThumbGate`;

async function postThumbGateToInstagram() {
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

    console.log('[instagram] Publishing ThumbGate caption to Instagram...');
    const result = await publishPost(THUMBGATE_CAPTION, platforms);

    console.log('✅ Post published successfully!');
    console.log(`Post ID: ${result.id || result.data?.id || 'unknown'}`);
    return result;
  } catch (err) {
    console.error(`❌ Failed to post to Instagram: ${err.message}`);
    throw err;
  }
}

// CLI execution
if (require.main === module) {
  (async () => {
    try {
      await postThumbGateToInstagram();
      process.exit(0);
    } catch (err) {
      process.exit(1);
    }
  })();
}

module.exports = { postThumbGateToInstagram, THUMBGATE_CAPTION };
