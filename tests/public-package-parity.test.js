'use strict';

/**
 * Regression prevention: ensures every HTML page in public/ ships in the npm package.
 *
 * Without this test, new HTML files added to public/ silently don't ship because
 * package.json `files` uses an explicit allowlist (not globs).
 *
 * This was hit repeatedly:
 *   - 1.5.0: public/dashboard.html missing from whitelist → broken `npx thumbgate pro`
 *   - 1.5.1: same
 *   - 1.5.3: public/pro.html, public/blog.html, public/learn.html missing
 * Fixed in 1.5.4 by adding them + this test to prevent recurrence.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

describe('public/ package parity', () => {
  test('every HTML file in public/ must be in package.json files whitelist', () => {
    const publicDir = path.join(ROOT, 'public');
    const htmlFiles = fs.readdirSync(publicDir)
      .filter((name) => name.endsWith('.html'))
      .map((name) => `public/${name}`);

    const whitelist = new Set(pkg.files);
    const missing = htmlFiles.filter((f) => !whitelist.has(f));

    assert.deepEqual(
      missing,
      [],
      `HTML files in public/ that will NOT ship in npm package: ${missing.join(', ')}. ` +
      `Add them to package.json "files" array.`,
    );
  });

  test('every file listed under public/ in whitelist actually exists', () => {
    const publicWhitelist = pkg.files.filter((f) => f.startsWith('public/'));
    const missingFromDisk = publicWhitelist.filter(
      (f) => !fs.existsSync(path.join(ROOT, f)),
    );

    assert.deepEqual(
      missingFromDisk,
      [],
      `Whitelist references files that don't exist on disk: ${missingFromDisk.join(', ')}. ` +
      `Remove stale entries from package.json "files" array.`,
    );
  });

  test('critical shipped HTML files have correct pricing', () => {
    // Guard against $99/seat Team pricing leaking back into any shipped HTML
    const shipped = pkg.files
      .filter((f) => f.startsWith('public/') && f.endsWith('.html'))
      .map((f) => path.join(ROOT, f));

    for (const filePath of shipped) {
      const content = fs.readFileSync(filePath, 'utf8');
      // Allow "Previously $99/seat" (explicit historical reference)
      // Ban any OTHER "$99/seat" occurrence
      const stripped = content.replace(/Previously \$99\/seat/g, '');
      assert.ok(
        !/\$99\s*\/?\s*seat/i.test(stripped),
        `${path.basename(filePath)} contains stale $99/seat pricing — Team is now $49/seat`,
      );
    }
  });
});
