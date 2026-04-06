#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: '/Users/igorganapolsky/workspace/git/igor/rlhf/.env' });

const apiKey = process.env.ZERNIO_API_KEY;
const accountId = process.env.ZERNIO_INSTAGRAM_ACCOUNT_ID;

if (!apiKey) {
  console.error('❌ ZERNIO_API_KEY not set');
  process.exit(1);
}

if (!accountId) {
  console.error('❌ ZERNIO_INSTAGRAM_ACCOUNT_ID not set');
  process.exit(1);
}

const caption = `Your AI coding agent forgets everything between sessions.

ThumbGate gives it memory that survives restarts. Thumbs-down a mistake → it becomes a prevention rule → the agent can't repeat it.

One command: npx mcp-memory-gateway init

Works with Claude Code, Cursor, Codex, Gemini.

#AIAgents #DeveloperTools #CodingAgents #MCP #OpenSource #ClaudeCode #ThumbGate`;

const body = {
  content: caption,
  publishNow: true,
  platforms: [
    {
      platform: 'instagram',
      accountId: accountId,
    },
  ],
};

(async () => {
  try {
    console.log('📱 Posting to Instagram via Zernio...');
    console.log(`Account ID: ${accountId}`);

    const response = await fetch('https://zernio.com/api/v1/posts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error(`❌ Zernio API ${response.status}`);
      console.error(`Response: ${responseText}`);
      process.exit(1);
    }

    const result = JSON.parse(responseText);
    console.log('✅ Post published successfully!');
    console.log(`Post ID: ${result.id || result.data?.id || 'unknown'}`);
    console.log(`Full response:`, JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
})();
