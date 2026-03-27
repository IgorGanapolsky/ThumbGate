#!/usr/bin/env node
/**
 * Congruence checker — ensures branding, tech stack, and version are
 * consistent across all public-facing materials.
 *
 * Runs in CI on every PR. Fails if any surface is out of sync.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const errors = [];

function read(rel) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, 'utf-8');
}

function check(condition, message) {
  if (!condition) errors.push(message);
}

// --- Version congruence ---
const pkg = JSON.parse(read('package.json'));
const version = pkg.version;

const landingHtml = read('public/index.html') || '';
const readmeMd = read('README.md') || '';
const agentsMd = read('AGENTS.md') || '';
const claudeMd = read('CLAUDE.md') || '';
const geminiMd = read('GEMINI.md') || '';
const serverStdio = read('adapters/mcp/server-stdio.js') || '';

check(
  landingHtml.includes(`v${version}`),
  `public/index.html missing version v${version} (found in package.json)`
);

check(
  serverStdio.includes(`version: '${version}'`),
  `adapters/mcp/server-stdio.js missing version '${version}'`
);

// --- Brand congruence: "ThumbGate" must appear in all public surfaces ---
const brandSurfaces = {
  'public/index.html (nav)': landingHtml.includes('ThumbGate</a>'),
  'public/index.html (title)': landingHtml.includes('<title>ThumbGate'),
  'README.md (heading)': readmeMd.startsWith('# ThumbGate'),
  'package.json (description)': pkg.description.includes('ThumbGate'),
  'AGENTS.md': agentsMd.includes('ThumbGate'),
  'CLAUDE.md': claudeMd.includes('ThumbGate'),
  'GEMINI.md': geminiMd.includes('ThumbGate'),
};

for (const [surface, present] of Object.entries(brandSurfaces)) {
  check(present, `Brand "ThumbGate" missing from ${surface}`);
}

// --- Tech stack congruence: key terms must appear in both README and landing page ---
const techTerms = [
  'SQLite',
  'FTS5',
  'MemAlign',
  'Thompson Sampling',
  'LanceDB',
  'PreToolUse',
];

for (const term of techTerms) {
  check(
    readmeMd.includes(term),
    `Tech term "${term}" missing from README.md`
  );
  check(
    landingHtml.includes(term),
    `Tech term "${term}" missing from public/index.html`
  );
}

// --- SEO positioning terms must appear on landing page ---
const seoTerms = ['human-in-the-loop', 'vibe coding'];
for (const term of seoTerms) {
  check(
    landingHtml.toLowerCase().includes(term.toLowerCase()),
    `SEO term "${term}" missing from public/index.html`
  );
}

// --- FAQPage schema must exist for rich results ---
check(
  landingHtml.includes('"@type": "FAQPage"'),
  'public/index.html missing FAQPage JSON-LD schema (needed for Google rich results)'
);

// --- Honest disclaimer must be on both surfaces ---
check(
  readmeMd.includes('not RLHF weight training'),
  'README.md missing honest disclaimer ("not RLHF weight training")'
);
check(
  landingHtml.includes('not RLHF') || landingHtml.includes('Is this real RLHF'),
  'public/index.html missing honest disclaimer (FAQ or inline)'
);

// --- Report ---
if (errors.length > 0) {
  console.error(`\n❌ Congruence check FAILED — ${errors.length} issue(s):\n`);
  for (const e of errors) {
    console.error(`  • ${e}`);
  }
  console.error('');
  process.exit(1);
} else {
  console.log(`✅ Congruence check passed — version v${version}, brand "ThumbGate", ${techTerms.length} tech terms verified across all surfaces.`);
}
