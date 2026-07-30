'use strict';

// Adapter configs pin an exact npm version so a user's harness launches a known build.
// Those pins are hand-edited and silently rot: adapters/{claw,hermes,perplexity} sat at
// thumbgate@1.26.8 while the package shipped 1.30.0 — four minor versions of gate fixes
// that those harnesses would never have fetched. Nothing compared the pins to the version.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const VERSION = require('../package.json').version;
const SCAN_DIRS = ['adapters', 'plugins', '.claude-plugin', '.cursor-plugin'];
const SCAN_EXT = new Set(['.json', '.toml', '.yaml', '.yml', '.md', '.sh']);

function pinnedReferences() {
  const hits = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!SCAN_EXT.has(path.extname(entry.name))) continue;
      const text = fs.readFileSync(full, 'utf8');
      for (const match of text.matchAll(/thumbgate@(\d+\.\d+\.\d+)/g)) {
        hits.push({ file: path.relative(ROOT, full), version: match[1] });
      }
    }
  };
  for (const dir of SCAN_DIRS) walk(path.join(ROOT, dir));
  return hits;
}

test('every pinned adapter version matches the shipped package version', () => {
  const hits = pinnedReferences();
  // Vacuity guard: if the scan finds nothing, the test proves nothing.
  assert.ok(hits.length >= 5,
    `expected adapter configs to pin thumbgate@<version>; found ${hits.length}. `
    + 'If pins moved or were replaced by @latest, update SCAN_DIRS or delete this test.');

  const stale = hits.filter((h) => h.version !== VERSION);
  assert.deepEqual(stale, [],
    `adapter pins disagree with package.json (${VERSION}). Users of these harnesses would `
    + `fetch an old build:\n${stale.map((s) => `  ${s.file} -> thumbgate@${s.version}`).join('\n')}`);
});
