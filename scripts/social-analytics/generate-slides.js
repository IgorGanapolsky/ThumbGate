#!/usr/bin/env node
'use strict';

/**
 * generate-slides.js
 * Generates PNG slide frames for ThumbGate marketing short videos.
 *
 * 6 rotating templates — each tells a different story about the product.
 * Templates are rotated by the post-scheduler so CI never reposts the
 * same content within the configured cooldown window.
 *
 * Output: slide_01.png … slide_NN.png  +  manifest.json
 * ffmpeg stitches them into MP4 via the video-autopilot CI workflow.
 *
 * Usage:
 *   node scripts/social-analytics/generate-slides.js
 *   node scripts/social-analytics/generate-slides.js --template=2
 *   node scripts/social-analytics/generate-slides.js --template=auto --out=/tmp
 */

const { execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

// ---------------------------------------------------------------------------
// Templates — 6 distinct story arcs, each 28-35 seconds
// Edit content here; rendering logic is unchanged.
// ---------------------------------------------------------------------------

const TEMPLATES = {

  // 1 — Force-push wipes PRs
  1: {
    name: 'force-push',
    slides: [
      { holdSeconds: 4, title: ['Your AI agent', 'just force-pushed', 'to main.'], subtitle: 'It wiped 3 open PRs.', lines: [], cta: null },
      { holdSeconds: 4, title: ['You told it not to.', 'It did it again.'], subtitle: 'Prompts are suggestions — not constraints.', lines: [], cta: null },
      { holdSeconds: 6, title: ['ThumbGate blocks it:'], subtitle: null, lines: ['→ Agent: git push --force origin main', '→ PreToolUse hook fires', '→ Gate #4: force-push to main', '✗ BLOCKED — rule auto-promoted', '  after 1 previous failure.'], cta: null },
      { holdSeconds: 5, title: ['The feedback loop:'], subtitle: null, lines: ['👎  bad action captured', '→ lesson written to SQLite DB', '→ prevention rule generated', '→ PreToolUse gate activated', '✓  same mistake: blocked forever'], cta: null },
      { holdSeconds: 6, title: ['ThumbGate', 'v1.4.1'], subtitle: 'Live GPT + local gates', lines: [], cta: { line1: 'Try the GPT →', line2: 'chatgpt.com/g/g-69dcfd1cd5f881918ae31874631d6f08-thumbgate' } },
    ],
  },

  // 2 — Deleted prod config
  2: {
    name: 'deleted-config',
    slides: [
      { holdSeconds: 4, title: ['AI agent deleted', 'your prod config.'], subtitle: '"It looked unused."', lines: [], cta: null },
      { holdSeconds: 4, title: ['2 hours of rollback.', 'For a file it', '"cleaned up".'], subtitle: null, lines: [], cta: null },
      { holdSeconds: 6, title: ['Gate auto-created', 'after 1 failure:'], subtitle: null, lines: ['→ Agent: rm config/prod.json', '→ PreToolUse hook fires', '→ Pattern: rm config/*.json', '✗ BLOCKED — protected path', '  Add to .thumbgate/allowlist', '  to override explicitly.'], cta: null },
      { holdSeconds: 5, title: ['Every 👎 becomes', 'a permanent gate.'], subtitle: null, lines: ['1 failure  → warn gate', '3 failures → hard block', 'No config change required.', 'Automatic.'], cta: null },
      { holdSeconds: 6, title: ['ThumbGate', 'v1.4.1'], subtitle: 'npx thumbgate serve', lines: [], cta: { line1: 'Try the GPT →', line2: 'chatgpt.com/g/g-69dcfd1cd5f881918ae31874631d6f08-thumbgate' } },
    ],
  },

  // 3 — Session amnesia
  3: {
    name: 'session-amnesia',
    slides: [
      { holdSeconds: 4, title: ['Every new session,', 'your AI agent', 'forgets everything.'], subtitle: null, lines: [], cta: null },
      { holdSeconds: 5, title: ['You re-explain.', 'It breaks the', 'same thing.', 'You fix it again.'], subtitle: 'Sound familiar?', lines: [], cta: null },
      { holdSeconds: 6, title: ['ThumbGate gives it', 'persistent memory:'], subtitle: null, lines: ['→ 👎 on bad action', '→ lesson stored in SQLite+FTS5', '→ retrieved next session', '→ gate blocks same mistake', '✓  learning that persists'], cta: null },
      { holdSeconds: 5, title: ['Session 1 vs 50:'], subtitle: null, lines: ['Session 1: same mistakes', 'Session 10: fewer mistakes', 'Session 50: gates block them', '  before you even see them.', 'Compounding prevention.'], cta: null },
      { holdSeconds: 6, title: ['ThumbGate', 'v1.4.1'], subtitle: 'Works with ChatGPT, Claude Code, Cursor, Codex CLI', lines: [], cta: { line1: 'Open the GPT →', line2: 'chatgpt.com/g/g-69dcfd1cd5f881918ae31874631d6f08-thumbgate' } },
    ],
  },

  // 4 — Thompson Sampling (technical)
  4: {
    name: 'thompson-sampling',
    slides: [
      { holdSeconds: 4, title: ['How do gates decide', 'which lessons', 'matter most?'], subtitle: 'Thompson Sampling.', lines: [], cta: null },
      { holdSeconds: 6, title: ['Each gate has a', 'Beta distribution:'], subtitle: null, lines: ['Gate starts: Beta(1,1) = uniform', '👎 on trigger: alpha += 1', '👍 no issue:   beta  += 1', '→ High alpha = high-priority gate', '→ Rarely triggered = auto-demoted'], cta: null },
      { holdSeconds: 5, title: ['After ~20 cycles,', 'gates self-sort:'], subtitle: null, lines: ['force-push   → Beta(18,2)  HIGH', 'rm config    → Beta(12,3)  HIGH', 'npm audit    → Beta(2,15) demoted', '✓  signal rises, noise falls'], cta: null },
      { holdSeconds: 5, title: ['No tuning.', 'No config.', 'Self-correcting.'], subtitle: 'The gate ranking adapts to your codebase.', lines: [], cta: null },
      { holdSeconds: 6, title: ['ThumbGate', 'v1.4.1'], subtitle: 'Thompson Sampling + LanceDB vector search', lines: [], cta: { line1: 'Try the GPT →', line2: 'chatgpt.com/g/g-69dcfd1cd5f881918ae31874631d6f08-thumbgate' } },
    ],
  },

  // 5 — 30-second install demo
  5: {
    name: 'install-demo',
    slides: [
      { holdSeconds: 4, title: ['Stop your AI agent', 'from making the', 'same mistakes.'], subtitle: 'Install in 30 seconds.', lines: [], cta: null },
      { holdSeconds: 5, title: ['Step 1:'], subtitle: null, lines: ['npx thumbgate serve', '', '✓  MCP server running on :3001', '✓  SQLite lesson DB initialised', '✓  PreToolUse hook active'], cta: null },
      { holdSeconds: 5, title: ['Step 2:'], subtitle: null, lines: ['Give a thumbs-down:', 'thumbgate feedback --down \\', '  "agent deleted prod config"', '', '→ Lesson captured + indexed'], cta: null },
      { holdSeconds: 5, title: ['Step 3:', '(automatic)'], subtitle: null, lines: ['→ Prevention rule generated', '→ Gate created: rm config/*', '→ Next time agent tries it:', '✗ BLOCKED before execution'], cta: null },
      { holdSeconds: 6, title: ['ThumbGate', 'v1.4.1'], subtitle: 'Free. Open source. No sign-up.', lines: [], cta: { line1: 'Open the GPT first', line2: 'chatgpt.com/g/g-69dcfd1cd5f881918ae31874631d6f08-thumbgate' } },
    ],
  },

  // 6 — Before/After comparison
  6: {
    name: 'before-after',
    slides: [
      { holdSeconds: 4, title: ['Before ThumbGate:'], subtitle: null, lines: ['Agent runs dangerous command', 'You notice after deploy', 'You write a rule in CLAUDE.md', 'Agent ignores it next session', 'Repeat forever.'], cta: null },
      { holdSeconds: 4, title: ['After ThumbGate:'], subtitle: null, lines: ['Agent tries dangerous command', '✗ BLOCKED by PreToolUse gate', 'Gate was promoted from your 👎', '✓  Never reaches production'], cta: null },
      { holdSeconds: 5, title: ['The difference:'], subtitle: null, lines: ['CLAUDE.md   = suggestion', 'ThumbGate   = enforcement', '', 'Rules in files get ignored.', 'Gates cannot be ignored.'], cta: null },
      { holdSeconds: 5, title: ['What changes:'], subtitle: null, lines: ['→ mistakes blocked pre-execution', '→ lessons persist across sessions', '→ gates auto-promote from failures', '→ DPO export for fine-tuning', '✓  compounding safety over time'], cta: null },
      { holdSeconds: 6, title: ['ThumbGate', 'v1.4.1'], subtitle: 'Free + Open Source', lines: [], cta: { line1: 'Try the GPT →', line2: 'chatgpt.com/g/g-69dcfd1cd5f881918ae31874631d6f08-thumbgate' } },
    ],
  },

};

// ---------------------------------------------------------------------------
// Python renderer (unchanged — handles all templates via SLIDES var)
// ---------------------------------------------------------------------------

function buildPythonScript(slides, outDir) {
  return `
import os, json as _json
from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1920
OUT_DIR = ${JSON.stringify(outDir)}
os.makedirs(OUT_DIR, exist_ok=True)

FONT_PATHS = {
    'bold':    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    'regular': '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    'mono':    '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
}

def font(name, size):
    try: return ImageFont.truetype(FONT_PATHS.get(name, FONT_PATHS['regular']), size)
    except: return ImageFont.load_default()

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
    d.rectangle([(0,0),(W,8)], fill='#6366f1')
    d.rectangle([(0,H-8),(W,H)], fill='#6366f1')
    y = 200
    for tl in s.get('title', []):
        d.text((80, y), tl, font=font('bold', 76), fill='#ffffff')
        y += 95
    y += 20
    sub = s.get('subtitle')
    if sub:
        d.text((80, y), sub, font=font('regular', 44), fill='#8888aa')
        y += 65
    y += 20
    lines = s.get('lines', [])
    if lines:
        d.rectangle([(40, y-20),(W-40, y+len(lines)*58+25)], fill='#12121e', outline='#2a2a3f', width=2)
        for line in lines:
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
    img.save(os.path.join(OUT_DIR, f'slide_{idx:02d}.png'), 'PNG')
    print(f'  Wrote slide_{idx:02d}.png')

for i, slide in enumerate(SLIDES): draw_slide(slide, i+1)
print(f'Generated {len(SLIDES)} slides → {OUT_DIR}')
`;
}

// ---------------------------------------------------------------------------
// Template selector
// ---------------------------------------------------------------------------

/**
 * Pick the next template to use, avoiding recent repeats.
 * Reads marketing DB if available; falls back to round-robin by hour.
 */
function pickTemplate(requestedId) {
  if (requestedId && requestedId !== 'auto') {
    const id = Number.parseInt(requestedId, 10);
    if (!TEMPLATES[id]) { console.error(`Unknown template id: ${id}`); process.exit(1); }
    return id;
  }

  // Try to pick least-recently-used from marketing DB
  try {
    const db = require('./db/marketing-db');
    const recent = db.list({ type: 'video', days: 30, limit: 100 });
    const usedTemplates = new Set(
      recent.map(r => { try { return JSON.parse(r.extra_json || '{}').templateId; } catch { return null; } }).filter(Boolean)
    );
    const allIds = Object.keys(TEMPLATES).map(Number);
    const unused = allIds.filter(id => !usedTemplates.has(id));
    if (unused.length > 0) return unused[0]; // pick first unused
    // All used — pick oldest
    const templateCounts = {};
    for (const r of recent) {
      try { const t = JSON.parse(r.extra_json || '{}').templateId; if (t) templateCounts[t] = (templateCounts[t] || 0) + 1; } catch {}
    }
    const sortedIds = [...allIds];
    sortedIds.sort((a, b) => (templateCounts[a] || 0) - (templateCounts[b] || 0));
    return sortedIds[0];
  } catch {
    // Fallback: round-robin by 4-hour block
    const block = Math.floor(Date.now() / (4 * 3600 * 1000));
    const ids = Object.keys(TEMPLATES).map(Number);
    return ids[block % ids.length];
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const outDir = args.find(a => a.startsWith('--out='))?.slice(6) || path.join(__dirname);
  const campaign = args.find(a => a.startsWith('--campaign='))?.slice(11) || 'default';
  const templateArg = args.find(a => a.startsWith('--template='))?.slice(11) || 'auto';

  const templateId = pickTemplate(templateArg);
  const template = TEMPLATES[templateId];

  console.log(`[generate-slides] template=${templateId}(${template.name}) campaign=${campaign} out=${outDir}`);

  const pyScript = buildPythonScript(template.slides, outDir);
  const tmpPy = path.join(require('node:os').tmpdir(), 'thumbgate_slides.py');
  fs.writeFileSync(tmpPy, pyScript);

  try {
    execSync(`python3 ${tmpPy}`, { stdio: 'inherit' });
  } catch (err) {
    console.error('[generate-slides] Python render failed:', err.message);
    process.exit(1);
  }

  const manifest = {
    templateId,
    templateName: template.name,
    campaign,
    generatedAt: new Date().toISOString(),
    slides: template.slides.map((s, i) => ({
      file: `slide_${String(i + 1).padStart(2, '0')}.png`,
      holdSeconds: s.holdSeconds,
    })),
    totalDuration: template.slides.reduce((sum, s) => sum + s.holdSeconds, 0),
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[generate-slides] Done. template=${templateId} duration=${manifest.totalDuration}s`);
}

main();
