#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
let sharp;
try { sharp = require('sharp'); } catch { /* optional dependency */ }

const REPO_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_OUTPUT = path.join(REPO_ROOT, '.thumbgate', 'applyops-instagram-card.png');

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function generateApplyOpsInstagramCard(outputPath = DEFAULT_OUTPUT) {
  if (!sharp) {
    throw new Error('sharp is not installed. Run: npm install sharp');
  }

  const width = 1080;
  const height = 1080;
  const lines = [
    'Resume firms:',
    'audit technical',
    'candidate risk',
    'before rewrite.',
  ];
  const bullets = [
    '10 resume-risk audits',
    'Anonymized findings memo',
    '$500 deposit -> $1,500 pilot',
  ];

  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="1080" height="1080" fill="#111827"/>
      <rect x="72" y="72" width="936" height="936" rx="36" fill="#f8fafc"/>
      <text x="112" y="150" font-size="36" font-weight="700" fill="#0f766e" font-family="Arial, sans-serif">ApplyOps Partner Pilot</text>
      ${lines.map((line, i) => `
        <text x="112" y="${270 + i * 82}" font-size="70" font-weight="800" fill="#111827" font-family="Arial, sans-serif">${escapeXml(line)}</text>
      `).join('')}
      <rect x="112" y="660" width="856" height="2" fill="#d1d5db"/>
      ${bullets.map((line, i) => `
        <circle cx="132" cy="${740 + i * 62}" r="8" fill="#0f766e"/>
        <text x="160" y="${755 + i * 62}" font-size="38" font-weight="600" fill="#1f2937" font-family="Arial, sans-serif">${escapeXml(line)}</text>
      `).join('')}
      <text x="112" y="975" font-size="34" font-weight="700" fill="#0f766e" font-family="Arial, sans-serif">igorganapolsky.github.io/applyops/partners.html</text>
    </svg>
  `;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  console.log(`[applyops:instagram] card=${outputPath}`);
  console.log(`[applyops:instagram] bytes=${fs.statSync(outputPath).size}`);
  return outputPath;
}

if (require.main === module) {
  const outputArg = process.argv.find((arg) => arg.startsWith('--output='));
  const outputPath = outputArg ? outputArg.slice('--output='.length) : DEFAULT_OUTPUT;

  generateApplyOpsInstagramCard(outputPath).catch((err) => {
    console.error(`[applyops:instagram] failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { generateApplyOpsInstagramCard };
