'use strict';

// No page calls posthog.capture without loading PostHog. The home page used to call window.posthog.capture twice
// with no loader on the page; those dead calls are gone. A page may only call posthog.capture if it also loads PostHog.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '..', 'public');
const pages = fs.readdirSync(publicDir).filter((name) => name.endsWith('.html'));

test('no public page calls posthog.capture without a PostHog loader on the same page', () => {
  const orphans = [];
  for (const name of pages) {
    const html = fs.readFileSync(path.join(publicDir, name), 'utf8');
    if (!/posthog\s*\.\s*capture\s*\(/.test(html)) continue;
    if (!/posthog\.com|posthog-js|posthog\.init|posthog\.load/i.test(html)) orphans.push(name);
  }
  assert.deepEqual(orphans, []);
});

test('the home page has no posthog calls left', () => {
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  assert.equal(/window\.posthog/.test(html), false);
});
