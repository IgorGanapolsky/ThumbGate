#!/usr/bin/env node
'use strict';

/**
 * generate-slides.js
 * Generates PNG slide frames for the ThumbGate marketing short video.
 *
 * Output: slide_01.png … slide_NN.png in the same directory as this script.
 * ffmpeg then stitches them into an MP4 (see weekly-social-post.yml).
 *
 * Dimensions: 1080×1920 (9:16 vertical — TikTok/Reels/Shorts)
 * Each slide is held for 3–6 seconds by the framerate passed to ffmpeg.
 *
 * Requires: Python 3 + Pillow  (pip install Pillow)
 *
 * Usage:
 *   node .artifacts/youtube-short/generate-slides.js
 *   node .artifacts/youtube-short/generate-slides.js --campaign=v1.4.0
 *   node .artifacts/youtube-short/generate-slides.js --out=/tmp/slides
 */

const { execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

// ---------------------------------------------------------------------------
// Slide definitions — edit these to update all video content
// ---------------------------------------------------------------------------

const SLIDES = [
  {
    id: 1,
    holdSeconds: 4,
    title: ['Your AI agent', 'just force-pushed', 'to main.'],
    subtitle: 'It wiped 3 open PRs.',
    lines: [],
    cta: null,
  },
  {
    id: 2,
    holdSeconds: 5,
    title: ['You told it not to.', 'It did it again.'],
    subtitle: 'Prompts are suggestions. Not constraints.',
    lines: [],
    cta: null,
  },
  {
    id: 3,
    holdSeconds: 6,
    title: ['ThumbGate', 'intercepts it:'],
    subtitle: null,
    lines: [
      '→ Agent: git push --force origin main',
      '→ PreToolUse hook fires',
      '→ Gate #4: force-push to main',
      '✗ BLOCKED — rule auto-promoted',
      '  after 1 previous failure.',
    ],
    cta: null,
  },
  {
    id: 4,
    holdSeconds: 5,
    title: ['The feedback loop:'],
    subtitle: null,
    lines: [
      '👎  bad action captured',
      '→ lesson written to SQLite DB',
      '→ prevention rule generated',
      '→ PreToolUse gate activated',
      '✓  same mistake: blocked forever',
    ],
    cta: null,
  },
  {
    id: 5,
    holdSeconds: 5,
    title: ['Not a prompt.', 'A physical block.'],
    subtitle: 'Works with Claude Code, Cursor, Codex CLI.',
    lines: [
      'npx thumbgate serve',
    ],
    cta: null,
  },
  {
    id: 6,
    holdSeconds: 6,
    title: ['ThumbGate', 'v1.4.0'],
    subtitle: 'Free + Open Source',
    lines: [],
    cta: {
      line1: 'Try it free →',
      line2: 'github.com/IgorGanapolsky/ThumbGate',
    },
  },
];

// ---------------------------------------------------------------------------
// Python renderer — uses Pillow for font rendering
// ---------------------------------------------------------------------------

function buildPythonScript(slides, outDir) {
  return `
import os
from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1920
OUT_DIR = ${JSON.stringify(outDir)}
os.makedirs(OUT_DIR, exist_ok=True)

FONT_PATHS = {
    'bold':  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    'regular': '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    'mono':  '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
}

def font(name, size):
    p = FONT_PATHS.get(name, FONT_PATHS['regular'])
    try:
        return ImageFont.truetype(p, size)
    except:
        return ImageFont.load_default()

import json as _json
SLIDES = _json.loads(${JSON.stringify(JSON.stringify(slides))})

def bg():
    img = Image.new('RGB', (W, H), '#0a0a0f')
    d = ImageDraw.Draw(img)
    for i in range(H):
        r = i/H
        d.line([(0,i),(W,i)], fill=(int(10+8*(1-r)), int(10+2*(1-r)), int(15+30*(1-r))))
    return img, d

def draw_slide(s, idx):
    img, d = bg()
    # Top + bottom accent bars
    d.rectangle([(0,0),(W,8)], fill='#6366f1')
    d.rectangle([(0,H-8),(W,H)], fill='#6366f1')

    y = 200
    title_lines = s.get('title', [])
    for tl in title_lines:
        f = font('bold', 76)
        d.text((80, y), tl, font=f, fill='#ffffff')
        y += 95
    y += 20

    subtitle = s.get('subtitle')
    if subtitle:
        f = font('regular', 44)
        d.text((80, y), subtitle, font=f, fill='#8888aa')
        y += 65
    y += 20

    lines = s.get('lines', [])
    if lines:
        code_y0 = y - 20
        code_y1 = y + len(lines)*58 + 25
        d.rectangle([(40, code_y0),(W-40, code_y1)], fill='#12121e', outline='#2a2a3f', width=2)
        for line in lines:
            color = '#ffffff'
            px = 70
            if line.startswith('✗'):
                d.text((px, y), '✗', font=font('bold', 38), fill='#ef4444')
                d.text((px+40, y), line[1:], font=font('mono', 36), fill='#ffaaaa')
            elif line.startswith('✓'):
                d.text((px, y), '✓', font=font('bold', 38), fill='#22c55e')
                d.text((px+40, y), line[1:], font=font('mono', 36), fill='#aaffaa')
            elif line.startswith('→'):
                d.text((px, y), '→', font=font('regular', 38), fill='#6366f1')
                d.text((px+40, y), line[1:], font=font('mono', 36), fill='#d0d8f0')
            elif line.startswith('👎'):
                d.text((px, y), line, font=font('mono', 36), fill='#fbbf24')
            else:
                d.text((px, y), line, font=font('mono', 36), fill='#d0d8f0')
            y += 58

    cta = s.get('cta')
    if cta:
        cy = H - 320
        d.rectangle([(60, cy),(W-60, cy+180)], fill='#6366f1')
        d.text((80, cy+24), cta['line1'], font=font('bold', 56), fill='#ffffff')
        d.text((80, cy+100), cta['line2'], font=font('regular', 38), fill='#e0e8ff')

    fname = os.path.join(OUT_DIR, f'slide_{idx:02d}.png')
    img.save(fname, 'PNG')
    print(f'  Wrote {fname}')

for i, slide in enumerate(SLIDES):
    draw_slide(slide, i+1)

print(f'Generated {len(SLIDES)} slides in {OUT_DIR}')
`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const outDir = args.find(a => a.startsWith('--out='))?.slice(6)
    || path.join(__dirname);

  const campaign = args.find(a => a.startsWith('--campaign='))?.slice(11) || 'default';

  console.log(`[generate-slides] campaign=${campaign} out=${outDir}`);

  const pyScript = buildPythonScript(SLIDES, outDir);
  const tmpPy = path.join(require('node:os').tmpdir(), 'thumbgate_slides.py');
  fs.writeFileSync(tmpPy, pyScript);

  try {
    execSync(`python3 ${tmpPy}`, { stdio: 'inherit' });
  } catch (err) {
    console.error('[generate-slides] Python render failed:', err.message);
    process.exit(1);
  }

  // Write a manifest so CI knows what was generated
  const manifest = {
    campaign,
    generatedAt: new Date().toISOString(),
    slides: SLIDES.map((s, i) => ({
      file: `slide_${String(i + 1).padStart(2, '0')}.png`,
      holdSeconds: s.holdSeconds,
    })),
    totalDuration: SLIDES.reduce((sum, s) => sum + s.holdSeconds, 0),
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[generate-slides] Done. Total video duration: ${manifest.totalDuration}s`);
}

main();
