#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

let sharp;
try { sharp = require('sharp'); } catch { /* optional dependency */ }

const REPO_ROOT = path.resolve(__dirname, '../..');
const ASSETS_DIR = path.join(REPO_ROOT, 'docs', 'marketing', 'assets');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function renderSvg({ width, height, titleLines, subtitleLines, footerLine, showBadge }) {
  const bg = `
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="${width}" y2="${height}" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#061015"/>
        <stop offset="0.58" stop-color="#0b1820"/>
        <stop offset="1" stop-color="#12323a"/>
      </linearGradient>
      <linearGradient id="gate" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#8cf5d1"/>
        <stop offset="1" stop-color="#22d3ee"/>
      </linearGradient>
      <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="${Math.round(height * 0.03)}" stdDeviation="${Math.round(height * 0.03)}" flood-color="#000000" flood-opacity="0.35"/>
      </filter>
    </defs>
  `;

  const padX = Math.round(width * 0.07);
  const titleSize = Math.round(height * 0.12);
  const subtitleSize = Math.round(height * 0.05);
  const labelSize = Math.round(height * 0.04);

  const titleY0 = Math.round(height * 0.33);
  const subtitleY0 = Math.round(height * 0.62);
  const footerY = Math.round(height * 0.92);

  const badgeSize = Math.round(Math.min(width, height) * 0.25);
  const badgeX = Math.round(width - padX - badgeSize);
  const badgeY = Math.round(height * 0.18);

  const title = titleLines
    .map((line, idx) => (
      `<text x="${padX}" y="${titleY0 + idx * Math.round(titleSize * 1.05)}" fill="#f5f7fb" font-size="${titleSize}" font-weight="900" font-family="Arial">${escapeXml(line)}</text>`
    ))
    .join('\n');

  const subtitle = subtitleLines
    .map((line, idx) => (
      `<text x="${padX}" y="${subtitleY0 + idx * Math.round(subtitleSize * 1.25)}" fill="#b9d7de" font-size="${subtitleSize}" font-weight="700" font-family="Arial">${escapeXml(line)}</text>`
    ))
    .join('\n');

  const footer = footerLine
    ? `<text x="${padX}" y="${footerY}" fill="#22d3ee" font-size="${labelSize}" font-weight="800" font-family="Arial">${escapeXml(footerLine)}</text>`
    : '';

  const badge = showBadge ? `
    <g transform="translate(${badgeX} ${badgeY})" filter="url(#soft)">
      <rect width="${badgeSize}" height="${badgeSize}" rx="${Math.round(badgeSize * 0.22)}" fill="#061015"/>
      <rect x="${Math.round(badgeSize * 0.13)}" y="${Math.round(badgeSize * 0.13)}" width="${Math.round(badgeSize * 0.74)}" height="${Math.round(badgeSize * 0.74)}" rx="${Math.round(badgeSize * 0.2)}" fill="#0b1820" stroke="url(#gate)" stroke-width="${Math.max(8, Math.round(badgeSize * 0.05))}"/>
      <path d="M${Math.round(badgeSize * 0.31)} ${Math.round(badgeSize * 0.67)}V${Math.round(badgeSize * 0.38)}c0-${Math.round(badgeSize * 0.1)} ${Math.round(badgeSize * 0.08)}-${Math.round(badgeSize * 0.18)} ${Math.round(badgeSize * 0.18)}-${Math.round(badgeSize * 0.18)}h${Math.round(badgeSize * 0.09)}c${Math.round(badgeSize * 0.1)} 0 ${Math.round(badgeSize * 0.18)} ${Math.round(badgeSize * 0.08)} ${Math.round(badgeSize * 0.18)} ${Math.round(badgeSize * 0.18)}v${Math.round(badgeSize * 0.29)}" fill="none" stroke="#8cf5d1" stroke-width="${Math.max(10, Math.round(badgeSize * 0.07))}" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="${Math.round(badgeSize * 0.5)}" y="${Math.round(badgeSize * 0.6)}" text-anchor="middle" fill="#e7fbff" font-family="Arial" font-size="${Math.round(badgeSize * 0.26)}" font-weight="900">TG</text>
      <rect x="${Math.round(badgeSize * 0.3)}" y="${Math.round(badgeSize * 0.69)}" width="${Math.round(badgeSize * 0.4)}" height="${Math.max(10, Math.round(badgeSize * 0.06))}" rx="${Math.round(badgeSize * 0.03)}" fill="#22d3ee"/>
    </g>
  ` : '';

  const decor = `
    <rect width="${width}" height="${height}" fill="url(#bg)"/>
    <path d="M${Math.round(width * 0.67)} 0h${Math.round(width * 0.33)}v${height}H${Math.round(width * 0.72)}c-${Math.round(width * 0.055)}-${Math.round(height * 0.13)}-${Math.round(width * 0.083)}-${Math.round(height * 0.29)}-${Math.round(width * 0.083)}-${Math.round(height * 0.465)} 0-${Math.round(height * 0.205)} ${Math.round(width * 0.01)}-${Math.round(height * 0.38)} ${Math.round(width * 0.03)}-${Math.round(height * 0.536)}z" fill="#0e252e" opacity="0.72"/>
    <g opacity="0.16" stroke="#8cf5d1" stroke-width="1">
      <path d="M${padX} ${Math.round(height * 0.22)}h${Math.round(width * 0.35)}"/>
      <path d="M${padX} ${Math.round(height * 0.29)}h${Math.round(width * 0.27)}"/>
      <path d="M${padX} ${Math.round(height * 0.36)}h${Math.round(width * 0.31)}"/>
      <path d="M${padX} ${Math.round(height * 0.43)}h${Math.round(width * 0.24)}"/>
    </g>
  `;

  return `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="ThumbGate Operator Lab asset">
      ${bg}
      ${decor}
      ${badge}
      ${title}
      ${subtitle}
      ${footer}
    </svg>
  `;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function writePng({ outPath, width, height, titleLines, subtitleLines, footerLine, showBadge }) {
  if (!sharp) {
    throw new Error('sharp is not installed (required to render marketing assets).');
  }

  const svg = renderSvg({ width, height, titleLines, subtitleLines, footerLine, showBadge });
  await sharp(Buffer.from(svg)).png().toFile(outPath);
  return outPath;
}

function runFfmpeg({ inputPng, outputMp4, width, height, seconds }) {
  const args = [
    '-y',
    '-loop', '1',
    '-i', inputPng,
    '-t', String(seconds),
    '-vf', `scale=${width}:${height},format=yuv420p`,
    '-r', '30',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-crf', '26',
    outputMp4,
  ];

  const result = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed (${result.status}) writing ${outputMp4}`);
  }
}

async function main() {
  ensureDir(ASSETS_DIR);

  const heroPath = path.join(ASSETS_DIR, 'thumbgate-operator-lab-about-hero.png');
  const landscapePath = path.join(ASSETS_DIR, 'thumbgate-operator-lab-social-landscape.png');
  const squarePath = path.join(ASSETS_DIR, 'thumbgate-operator-lab-social-square.png');
  const storyPath = path.join(ASSETS_DIR, 'thumbgate-operator-lab-social-story.png');
  const explainerPath = path.join(ASSETS_DIR, 'thumbgate-operator-lab-explainer.mp4');
  const explainerVerticalPath = path.join(ASSETS_DIR, 'thumbgate-operator-lab-explainer-vertical.mp4');

  await writePng({
    outPath: heroPath,
    width: 1200,
    height: 675,
    titleLines: ['ThumbGate Operator Lab'],
    subtitleLines: ['Stop repeated AI-agent mistakes.', 'Turn feedback into pre-action gates.'],
    footerLine: 'npx thumbgate init',
    showBadge: true,
  });

  await writePng({
    outPath: landscapePath,
    width: 1600,
    height: 900,
    titleLines: ['Stop repeated', 'AI-agent mistakes'],
    subtitleLines: ['Pre-Action Gates • Workflow Hardening', 'Claude Code • Codex • Cursor • Gemini CLI'],
    footerLine: 'https://www.skool.com/thumbgate-operator-lab-6000',
    showBadge: true,
  });

  await writePng({
    outPath: squarePath,
    width: 1080,
    height: 1080,
    titleLines: ['One thumbs-down.', 'Never again.'],
    subtitleLines: ['Mistakes become prevention rules.', 'Enforced before execution.'],
    footerLine: 'ThumbGate Operator Lab',
    showBadge: true,
  });

  await writePng({
    outPath: storyPath,
    width: 1080,
    height: 1920,
    titleLines: ['Stop repeated', 'AI-agent mistakes'],
    subtitleLines: ['Post one failure → get one gate.', 'Proof-driven workflow hardening.'],
    footerLine: 'thumbgate-production.up.railway.app/guide',
    showBadge: true,
  });

  runFfmpeg({ inputPng: landscapePath, outputMp4: explainerPath, width: 1280, height: 720, seconds: 9 });
  runFfmpeg({ inputPng: storyPath, outputMp4: explainerVerticalPath, width: 1080, height: 1920, seconds: 9 });

  console.log('✅ Operator Lab assets generated in docs/marketing/assets');
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});

