'use strict';

// SPEC — ThumbGate vs Tailscale Aperture comparison page (spec-driven-feature form)
//
// Intent: a buyer-intent GEO/SEO page positioning ThumbGate against Tailscale
// Aperture (identity-aware AI gateway, GA Aug 2026) for people searching
// "Aperture vs ThumbGate" / "AI agent governance": adjacent layers that compose,
// never a substitute claim in either direction.
//
// Behaviors (each pinned by a test below):
//  1. States adjacent-not-substitute and links the Aperture GA announcement.
//  2. Attributes gateway capabilities (identity-aware access, no-API-key
//     distribution, tailnet, audit) to Tailscale — never claims them as ours.
//  3. States ThumbGate's honest enforcement default ("warn unless STRICT").
//  4. Distinguishes the layers: PreToolUse (ours) vs network/gateway (theirs),
//     and includes the composability story.
//  5. Hub /compare links the page; sitemap coverage comes free from the
//     filesystem-derived renderSitemapXml (pinned by public-static-assets).
//  6. FAQPage JSON-LD present for AI-answer-engine eligibility.
//
// Non-goals: adopting Aperture infrastructure, republishing Tailscale pricing
// or token-bundle numbers, any claim that ThumbGate brokers model access.
//
// Verification: this file; sweep coverage in tests/public-static-assets.test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'public', 'compare', 'aperture.html'), 'utf8');
const HUB = fs.readFileSync(path.join(ROOT, 'public', 'compare.html'), 'utf8');

test('compare page states adjacent-not-substitute and links the Aperture GA post', () => {
  assert.match(PAGE, /Adjacent, not a substitute/i);
  assert.match(PAGE, /https:\/\/tailscale\.com\/blog\/aperture-ga/);
  assert.match(PAGE, /PreToolUse/);
  assert.match(PAGE, /identity-aware/i);
});

test('compare page attributes gateway capabilities to Tailscale, not ThumbGate', () => {
  assert.match(PAGE, /No API keys distributed|no API keys handed|without distributing API keys/i);
  assert.match(PAGE, /their GA announcement|Tailscale's announcement|Tailscale's GA announcement/i);
  assert.doesNotMatch(PAGE, /we run your tailnet(?!\s+and do not)/i);
  assert.match(PAGE, /do not run your tailnet/i);
  assert.doesNotMatch(PAGE, /ThumbGate brokers model access/i);
});

test('compare page states the honest enforcement default', () => {
  assert.match(PAGE, /warn unless STRICT/i);
  assert.doesNotMatch(PAGE, /hard-block(?:s)?\s+.*rm\s+-rf/i);
});

test('compare page separates the layers and includes the composability story', () => {
  assert.match(PAGE, /network path|network layer/i);
  assert.match(PAGE, /before execute/i);
  assert.match(PAGE, /Use both|compose/i);
  assert.match(PAGE, /cannot see/i);
});

test('hub links the Aperture compare page', () => {
  assert.match(HUB, /href="\/compare\/aperture"/);
});

test('compare page exposes FAQPage JSON-LD for GEO parsers', () => {
  assert.match(PAGE, /"@type":\s*"FAQPage"/);
  assert.match(PAGE, /Is Tailscale Aperture a ThumbGate competitor/);
});
