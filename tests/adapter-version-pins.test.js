'use strict';

// Setup examples under adapters/ and plugins/ used to pin an exact npm version, and those pins rotted:
// adapters/{claw,hermes,perplexity} sat at thumbgate@1.26.8 while the package shipped 1.30.0. Even a
// pin kept in sync with each release freezes every config a user already copied. Since 2026-11-25
// (Igor: "how do we ensure people's agents always use the latest version") they run thumbgate@latest.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['adapters', 'plugins', '.claude-plugin', '.cursor-plugin'];
const SCAN_EXT = new Set(['.json', '.toml', '.yaml', '.yml', '.md', '.sh']);

function packageReferences() {
  const pinned = [];
  let latest = 0;
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!SCAN_EXT.has(path.extname(entry.name))) continue;
      const text = fs.readFileSync(full, 'utf8');
      for (const match of text.matchAll(/thumbgate@(\d+\.\d+\.\d+)/g)) {
        pinned.push(`${path.relative(ROOT, full)} -> thumbgate@${match[1]}`);
      }
      latest += (text.match(/thumbgate@latest/g) || []).length;
    }
  };
  for (const dir of SCAN_DIRS) walk(path.join(ROOT, dir));
  return { pinned, latest };
}

test('adapter and plugin setup examples follow thumbgate@latest, never a release pin', () => {
  const { pinned, latest } = packageReferences();
  // Vacuity guard: if the scan finds no launcher at all, the test proves nothing.
  assert.ok(latest >= 10, `expected setup examples to run thumbgate@latest; found ${latest}`);
  assert.deepEqual(pinned, [],
    'setup examples must not pin a release (a copied config would never update). Run `npm run version:sync` '
    + `or use thumbgate@latest:\n${pinned.join('\n')}`);
});
