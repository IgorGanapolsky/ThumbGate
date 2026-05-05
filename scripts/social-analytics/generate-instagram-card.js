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
const DEFAULT_OUTPUT = path.join(REPO_ROOT, '.thumbgate', 'instagram-card.png');

const CARD_VARIANTS = [
  { headline: ['Voice agent', 'losing leads?'], sub: ['$499 diagnostic', 'slot open today.'] },
  { headline: ['Your AI agent', 'has amnesia.'], sub: ['Give it memory that', 'survives restarts.'] },
  { headline: ['CLAUDE.md is', 'a wish list.'], sub: ['ThumbGate is', 'enforcement.'] },
  { headline: ['One thumbs-down.', 'Never again.'], sub: ['Mistakes become', 'prevention rules.'] },
  { headline: ['33 pre-action', 'gates.'], sub: ['Block before execution.', 'Not after damage.'] },
  { headline: ['AI agent broke', 'production?'], sub: ['That exact pattern', 'is now blocked forever.'] },
  { headline: ['Fight AI', 'with AI.'], sub: ['Self-tuning gates.', 'Thompson Sampling.'] },
  { headline: ['Your agent can\'t', 'disable this.'], sub: ['Self-protection gates.', '4 layers deep.'] },
  { headline: ['NIST. SOC2.', 'OWASP. CWE.'], sub: ['Compliance tags on', 'every rule.'] },
  { headline: ['500 actions.', '2.5 hours.'], sub: ['Budget enforcement.', 'No runaway agents.'] },
  { headline: ['First AI-agent', 'cyberattack confirmed.'], sub: ['PreToolUse hooks', 'block before execution.'] },
];

async function generateInstagramCard(outputPath = DEFAULT_OUTPUT, options = {}) {
  const width = 1080;
  const height = 1080;

  // Pick a variant: explicit, random, or rotate based on day
  let variant;
  if (options.variantIndex !== undefined) {
    variant = CARD_VARIANTS[options.variantIndex % CARD_VARIANTS.length];
  } else {
    const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
    const hourSlot = Math.floor(new Date().getHours() / 8); // 3 slots per day
    variant = CARD_VARIANTS[(dayOfYear * 3 + hourSlot) % CARD_VARIANTS.length];
  }

  const envHeadline = process.env.THUMBGATE_INSTAGRAM_HEADLINE
    ? process.env.THUMBGATE_INSTAGRAM_HEADLINE.split('|').map((line) => line.trim()).filter(Boolean)
    : null;
  const envSub = process.env.THUMBGATE_INSTAGRAM_SUB
    ? process.env.THUMBGATE_INSTAGRAM_SUB.split('|').map((line) => line.trim()).filter(Boolean)
    : null;
  const h1 = options.headline || (envHeadline && envHeadline.length >= 2 ? envHeadline : null) || variant.headline;
  const sub = options.sub || (envSub && envSub.length >= 2 ? envSub : null) || variant.sub;

  // Create SVG markup for the card
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <!-- Background -->
      <rect width="${width}" height="${height}" fill="#0d1117"/>

      <!-- Main heading -->
      <text x="${width / 2}" y="400" font-size="72" font-weight="bold" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif">
        ${h1[0]}
      </text>
      <text x="${width / 2}" y="490" font-size="72" font-weight="bold" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif">
        ${h1[1]}
      </text>

      <!-- Subheading -->
      <text x="${width / 2}" y="620" font-size="48" text-anchor="middle" fill="#888888" font-family="Arial, sans-serif">
        ${sub[0]}
      </text>
      <text x="${width / 2}" y="680" font-size="48" text-anchor="middle" fill="#888888" font-family="Arial, sans-serif">
        ${sub[1]}
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
