#!/usr/bin/env node
'use strict';

/**
 * validate-social-post.js — Pre-flight per-platform length validation.
 *
 * Zernio (and most multi-platform schedulers) validate at publish-time, not
 * at schedule-time. A 900-char draft queued across X + LinkedIn + Threads
 * silently fails on Threads 6 hours later because Threads caps at 500.
 *
 * Run this BEFORE you paste anything into Zernio:
 *   node scripts/validate-social-post.js docs/marketing/x-launch-thread.md
 *   cat draft.md | node scripts/validate-social-post.js
 *   node scripts/validate-social-post.js --text "Your draft here"
 *
 * Exits 0 if every platform accepts the draft, 1 otherwise.
 */

const fs = require('node:fs');

const LIMITS = {
  threads:   { max: 500,  note: 'Meta/Threads API hard limit. Exceeding = publish failure (code:100 THApiException).' },
  x:         { max: 280,  note: 'Free X/Twitter. Premium lifts to 4000 but most audiences still read first-280 preview.' },
  x_premium: { max: 4000, note: 'Only if the posting account has X Premium.' },
  mastodon:  { max: 500,  note: 'Default Mastodon instance cap. Some instances go higher.' },
  bluesky:   { max: 300,  note: 'Bluesky post character limit.' },
  linkedin:  { max: 3000, note: 'LinkedIn feed post. First 210 chars are the preview.' },
  instagram: { max: 2200, note: 'Instagram caption limit. First 125 chars show before "more".' },
  facebook:  { max: 63206, note: 'Practically unlimited, but engagement drops past 250 chars.' },
  reddit:    { max: 40000, note: 'Reddit selftext body. Title is 300.' },
  hn_title:  { max: 80,   note: 'Hacker News title. Most important constraint when doing Show HN.' },
};

function charCount(text) {
  // Threads/X/Meta count UTF-16 code units, which is what String.length gives us.
  // Emojis outside BMP count as 2. Close enough for a pre-flight gate.
  return Array.from(text).length > text.length
    ? text.length // grapheme explosion — use raw code-unit count (what Meta does)
    : text.length;
}

function parseArgs(argv) {
  const out = { files: [], text: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--text') { out.text = argv[++i]; continue; }
    if (a === '-') { out.files.push('-'); continue; }
    if (a.startsWith('--')) continue;
    out.files.push(a);
  }
  return out;
}

function readSources(args) {
  const sources = [];
  if (args.text) sources.push({ name: '<--text>', body: args.text });
  for (const f of args.files) {
    if (f === '-') {
      const body = fs.readFileSync(0, 'utf8');
      sources.push({ name: '<stdin>', body });
    } else {
      sources.push({ name: f, body: fs.readFileSync(f, 'utf8') });
    }
  }
  if (!sources.length && !process.stdin.isTTY) {
    sources.push({ name: '<stdin>', body: fs.readFileSync(0, 'utf8') });
  }
  return sources;
}

function extractBlocks(source) {
  // If markdown file: pull each ```text ``` fenced block as a separate post.
  // Otherwise: treat whole file as one post.
  const text = source.body;
  const fenceRe = /```(?:text|post|tweet|thread)?\n([\s\S]*?)```/g;
  const blocks = [];
  let m;
  while ((m = fenceRe.exec(text)) !== null) {
    blocks.push({ label: `${source.name} block#${blocks.length + 1}`, body: m[1].trim() });
  }
  if (blocks.length === 0) {
    blocks.push({ label: source.name, body: text.trim() });
  }
  return blocks;
}

// HN title is a different post-type (title string, not body). Exclude from
// default "is this a valid feed post" check; only included for awareness.
const FEED_POST_PLATFORMS = new Set([
  'threads', 'x', 'x_premium', 'mastodon', 'bluesky',
  'linkedin', 'instagram', 'facebook', 'reddit',
]);

function evaluateBlock(block) {
  const len = charCount(block.body);
  const results = [];
  for (const [platform, { max, note }] of Object.entries(LIMITS)) {
    const ok = len <= max;
    const blocking = FEED_POST_PLATFORMS.has(platform);
    results.push({ platform, ok, len, max, note, over: Math.max(0, len - max), blocking });
  }
  return { block, len, results };
}

function render(evals) {
  let failures = 0;
  for (const ev of evals) {
    console.log(`\n■ ${ev.block.label}  (${ev.len} chars)`);
    console.log('  ' + ev.block.body.slice(0, 120).replace(/\n/g, ' ') + (ev.block.body.length > 120 ? '…' : ''));
    for (const r of ev.results) {
      const marker = r.ok ? '✓' : (r.blocking ? '✗' : '⚠');
      const tail = r.ok ? '' : `  — OVER by ${r.over} (${r.note})`;
      console.log(`    ${marker} ${r.platform.padEnd(10)} ${r.len}/${r.max}${tail}`);
      if (!r.ok && r.blocking) failures++;
    }
  }
  console.log('');
  return failures;
}

function main() {
  const args = parseArgs(process.argv);
  const sources = readSources(args);
  if (!sources.length) {
    console.error('Usage: validate-social-post.js <file.md> [...]  |  --text "..."  |  echo "..." | validate-social-post.js');
    process.exit(2);
  }
  const evals = sources.flatMap((s) => extractBlocks(s).map(evaluateBlock));
  const failures = render(evals);
  if (failures > 0) {
    console.log(`${failures} platform limit(s) exceeded. Shorten before scheduling.`);
    process.exit(1);
  }
  console.log('All drafts fit every platform limit. Safe to schedule.');
}

main();
