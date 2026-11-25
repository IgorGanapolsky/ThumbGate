'use strict';

// Buyer-facing copy checks: the landing page and /pricing link to our two sister products in the footer.
// (The /diagnostic page sold the retired $499 Setup Sprint; it answers 410 and its HTML is gone.)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

for (const page of ['public/index.html', 'public/pricing.html']) {
  test(`${page} footer has an "Also by Igor" row linking Mac YOLO Safeguards and Dayglass`, () => {
    const html = read(page);
    const footer = html.slice(html.indexOf('<footer>'), html.indexOf('</footer>'));
    assert.match(footer, /<strong>Also by Igor<\/strong>/);
    assert.match(footer, /<a href="https:\/\/macyolosafeguards\.io\/\?utm_source=thumbgate" rel="noopener">Mac YOLO Safeguards<\/a>: Free menu bar app that cleans up what coding agents leave running on your Mac\./);
    assert.match(footer, /<a href="https:\/\/dayglass\.io\/\?utm_source=thumbgate" rel="noopener">Dayglass<\/a>: Private AI memory for your Mac calls and work, no meeting bot\./);
    assert.doesNotMatch(footer, /\/go\/|redirect/i, 'plain links, no tracking redirects');
  });
}
