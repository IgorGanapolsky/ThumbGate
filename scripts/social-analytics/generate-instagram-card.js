#!/usr/bin/env node
'use strict';

/**
 * generate-instagram-card.js
 * Creates a 1080x1080 ThumbGate Instagram card using sharp.
 *
 * Usage:
 *   node generate-instagram-card.js [--output=path/to/output.png]
 *
 * Output: .thumbgate/instagram-card.png (default)
 */

const fs = require('fs');
const path = require('path');
let sharp;
try { sharp = require('sharp'); } catch { /* optional dependency */ }

const REPO_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_OUTPUT = path.join(REPO_ROOT, '.rlhf', 'instagram-card.png');

async function generateInstagramCard(outputPath = DEFAULT_OUTPUT) {
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

  if (!sharp) {
    throw new Error('sharp is not installed. Run: npm install sharp');
  }

  try {
    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Generate PNG from SVG
    await sharp(Buffer.from(svg))
      .png()
      .toFile(outputPath);

    console.log(`✅ Instagram card generated: ${outputPath}`);
    console.log(`   Size: 1080x1080 PNG`);
    console.log(`   File size: ${fs.statSync(outputPath).size} bytes`);
    return outputPath;
  } catch (err) {
    console.error(`❌ Image generation failed: ${err.message}`);
    throw err;
  }
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const outputArg = args.find((a) => a.startsWith('--output='));
  const outputPath = outputArg ? outputArg.slice(9) : DEFAULT_OUTPUT;

  (async () => {
    try {
      await generateInstagramCard(outputPath);
      process.exit(0);
    } catch (err) {
      process.exit(1);
    }
  })();
}

module.exports = { generateInstagramCard, DEFAULT_OUTPUT };
