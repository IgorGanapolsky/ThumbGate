#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

/**
 * Create a 1080x1080 social card image with SVG and convert to PNG
 */
async function createInstagramCard() {
  const width = 1080;
  const height = 1080;

  // Create SVG markup for the card
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <!-- Background -->
      <rect width="${width}" height="${height}" fill="#0d1117"/>

      <!-- Main heading -->
      <text x="${width / 2}" y="400" font-size="72" font-weight="bold" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif">
        Your AI agent
      </text>
      <text x="${width / 2}" y="490" font-size="72" font-weight="bold" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif">
        has amnesia.
      </text>

      <!-- Subheading -->
      <text x="${width / 2}" y="620" font-size="48" text-anchor="middle" fill="#888888" font-family="Arial, sans-serif">
        Give it memory that
      </text>
      <text x="${width / 2}" y="680" font-size="48" text-anchor="middle" fill="#888888" font-family="Arial, sans-serif">
        survives restarts.
      </text>

      <!-- Brand -->
      <text x="${width / 2}" y="950" font-size="56" font-weight="bold" text-anchor="middle" fill="#00d9ff" font-family="Arial, sans-serif">
        ThumbGate
      </text>
    </svg>
  `;

  const outputPath = path.join(__dirname, 'instagram-card.png');

  try {
    await sharp(Buffer.from(svg)).png().toFile(outputPath);
    console.log(`✅ Image created: ${outputPath}`);
    return outputPath;
  } catch (err) {
    console.error(`❌ Image creation failed: ${err.message}`);
    throw err;
  }
}

/**
 * Post to Instagram via Zernio API
 */
async function postToInstagram(imageBuffer) {
  const apiKey = process.env.ZERNIO_API_KEY;
  if (!apiKey) {
    throw new Error('ZERNIO_API_KEY environment variable is required');
  }

  const caption = `Your AI coding agent forgets everything between sessions.

ThumbGate gives it memory that survives restarts. Thumbs-down a mistake → it becomes a prevention rule → the agent can't repeat it.

One command: npx mcp-memory-gateway init

Works with Claude Code, Cursor, Codex, Gemini.

#AIAgents #DeveloperTools #CodingAgents #MCP #OpenSource #ClaudeCode #ThumbGate`;

  const accountId = process.env.ZERNIO_INSTAGRAM_ACCOUNT_ID;
  if (!accountId) {
    throw new Error('ZERNIO_INSTAGRAM_ACCOUNT_ID environment variable is required');
  }

  try {
    // Zernio API: POST /posts with image as base64
    const base64Image = imageBuffer.toString('base64');

    const body = {
      content: caption,
      publishNow: true,
      platforms: [
        {
          platform: 'instagram',
          accountId: accountId,
        },
      ],
      // Try to include media — the API might support this
      media: [
        {
          type: 'image',
          data: `data:image/png;base64,${base64Image}`,
        },
      ],
    };

    const response = await fetch('https://zernio.com/api/v1/posts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Zernio API ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    console.log(`✅ Post published to Instagram: ${result.id || 'unknown'}`);
    return result;
  } catch (err) {
    console.error(`❌ Instagram post failed: ${err.message}`);
    throw err;
  }
}

async function main() {
  try {
    console.log('Step 1: Creating Instagram card...');
    const imagePath = await createInstagramCard();

    console.log('Step 2: Reading image file...');
    const imageBuffer = fs.readFileSync(imagePath);

    console.log('Step 3: Posting to Instagram via Zernio...');
    const result = await postToInstagram(imageBuffer);

    console.log('✅ Success! Instagram post completed.');
    console.log(`Post ID: ${result.id || 'unknown'}`);
  } catch (err) {
    console.error(`❌ Failed: ${err.message}`);
    process.exit(1);
  }
}

main();
