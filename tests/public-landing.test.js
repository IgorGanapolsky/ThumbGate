const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PRODUCTHUNT_URL } = require('../scripts/distribution-surfaces');

const landingPagePath = path.join(__dirname, '..', 'public', 'index.html');

function readLandingPage() {
  return fs.readFileSync(landingPagePath, 'utf8');
}

test('public landing page keeps FAQPage JSON-LD parity for SEO and GEO', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /"@type": "SoftwareApplication"/);
  assert.match(landingPage, /"@type": "FAQPage"/);
  assert.match(landingPage, /Is ThumbGate real RLHF\?/);
  assert.match(landingPage, /What is the ThumbGate tech stack\?/);
  assert.match(landingPage, /What AI agents does ThumbGate work with\?/);
  assert.match(landingPage, /How are pre-action gates different from prompt rules\?/);
  assert.match(landingPage, /context engineering plus enforcement/i);
  assert.match(landingPage, /PreToolUse hook enforcement/i);
  assert.match(landingPage, /Thompson Sampling/i);
});

test('public landing page uses Stripe checkout links for Pro tier', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /buy\.stripe\.com/);
  assert.match(landingPage, /Get Pro/);
  assert.doesNotMatch(landingPage, /gumroad\.com/);
});

test('public landing page includes copy-to-clipboard install command', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /npx mcp-memory-gateway init/);
  assert.match(landingPage, /function copyInstall/);
  assert.match(landingPage, /navigator\.clipboard\.writeText/);
});

test('public landing page uses no Math.random for security', () => {
  const landingPage = readLandingPage();

  assert.doesNotMatch(landingPage, /Math\.random\(/);
});

test('public landing page keeps optional GA4 and Search Console hooks available for runtime injection', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /__GOOGLE_SITE_VERIFICATION_META__/);
  assert.match(landingPage, /__GA_BOOTSTRAP__/);
  assert.match(landingPage, /const gaMeasurementId = '__GA_MEASUREMENT_ID__';/);
  assert.match(landingPage, /const serverVisitorId = '__SERVER_VISITOR_ID__';/);
  assert.match(landingPage, /const serverSessionId = '__SERVER_SESSION_ID__';/);
  assert.match(landingPage, /const serverAcquisitionId = '__SERVER_ACQUISITION_ID__';/);
  assert.match(landingPage, /const serverTelemetryCaptured = '__SERVER_TELEMETRY_CAPTURED__' === 'true';/);
});

test('public landing page includes pricing section with Free and Pro tiers', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /class="price-card"/);
  assert.match(landingPage, /class="price-card pro"/);
  assert.match(landingPage, /\$0/);
  assert.match(landingPage, /\$49/);
  assert.match(landingPage, /One-time payment/);
  assert.match(landingPage, /Forever free/);
  assert.match(landingPage, /Install Free/);
  assert.match(landingPage, /Get Pro/);
});

test('public landing page includes Plausible analytics and search engine proof bar', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /\/js\/analytics\.js/);
  assert.match(landingPage, /npm downloads/i);
  assert.match(landingPage, /tests passing/i);
  assert.ok(landingPage.includes(PRODUCTHUNT_URL));
  assert.match(landingPage, /MIT licensed/i);
});

test('public landing page includes the three-step how-it-works section', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /id="how-it-works"/);
  assert.match(landingPage, /Feedback/);
  assert.match(landingPage, /Rules/);
  assert.match(landingPage, /Gates/);
  assert.match(landingPage, /Pre-Action Gates/i);
  assert.match(landingPage, /prevention rules/i);
  assert.match(landingPage, /Thompson Sampling/);
});

test('public landing page includes a Reddit campaign banner and subreddit-aware attribution logic', () => {
  // The ThumbGate page does not include Reddit campaign banner features.
  // Verify the page does not contain stale Reddit attribution artifacts.
  const landingPage = readLandingPage();

  assert.doesNotMatch(landingPage, /id="campaign-banner"/);
  assert.doesNotMatch(landingPage, /parseRedditCommunity/);
});

test('public landing page positions ThumbGate as human-in-the-loop enforcement for AI agents', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /ThumbGate/);
  assert.match(landingPage, /Stop AI Coding Agents From Repeating Mistakes/i);
  assert.match(landingPage, /Human-in-the-Loop Enforcement/i);
  assert.match(landingPage, /safety net for vibe coding/i);
  assert.match(landingPage, /Claude Code/);
  assert.match(landingPage, /Cursor/);
  assert.match(landingPage, /Codex/);
  assert.match(landingPage, /Gemini/);
  assert.match(landingPage, /Amp/);
  assert.match(landingPage, /OpenCode/);
  assert.match(landingPage, /MCP-compatible agent/i);
  assert.match(landingPage, /SQLite\+FTS5/);
  assert.doesNotMatch(landingPage, /mailto:/i);
  assert.doesNotMatch(landingPage, /official Anthropic partner/i);
});

test('public landing page hero features both thumbs up AND thumbs down prominently', () => {
  const landingPage = readLandingPage();

  // Hero big emoji must show BOTH thumbs — not just one
  assert.match(landingPage, /class="hero-thumbs">👍👎</);
  // Headline leads with pain: stop dangerous mistakes
  assert.match(landingPage, /Stop your AI coding agent from repeating/i);
  assert.match(landingPage, /dangerous and dumb mistakes/i);
  // Signal pills must show both
  assert.match(landingPage, /signal-pill signal-up/);
  assert.match(landingPage, /signal-pill signal-down/);
  assert.match(landingPage, /👍 reinforces what worked/);
  assert.match(landingPage, /👎 blocks the mistake/);
  // Persona targeting
  assert.match(landingPage, /class="hero-persona"/);
  assert.match(landingPage, /power users of Claude Code/i);
  // Plain-language value prop
  assert.match(landingPage, /immune system for your AI agent/i);
});

test('public landing page Pro tier uses outcome-framed bullets that justify upgrade', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /audit and refine rules across repos/i);
  assert.match(landingPage, /teams and multiple agents share one central lesson DB/i);
  assert.match(landingPage, /turn real failures into model-improving datasets/i);
  assert.match(landingPage, /help wiring gates into your most critical agents/i);
  assert.match(landingPage, /Upgrade when your experiment becomes a team workflow/i);
});

test('public landing page includes FAQ section with accordion interaction', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /id="faq"/);
  assert.match(landingPage, /Common questions/);
  assert.match(landingPage, /Is this real RLHF\?/);
  assert.match(landingPage, /What's the tech stack\?/);
  assert.match(landingPage, /What AI agents and editors does this work with\?/);
  assert.match(landingPage, /Do I need a cloud account\?/);
  assert.match(landingPage, /How are gates different from prompt rules\?/);
  assert.match(landingPage, /Is the \$49 a subscription\?/);
  assert.match(landingPage, /classList\.toggle\('open'\)/);
});

test('public landing page includes compatibility section for AI agent surfaces', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /id="compatibility"/);
  assert.match(landingPage, /AI CLIs/i);
  assert.match(landingPage, /Codex now ships with a repo-local app plugin profile/i);
  assert.match(landingPage, /Claude Desktop plugin/i);
  assert.match(landingPage, /Editor workflows/i);
  assert.match(landingPage, /Install in 30 seconds/i);
  assert.match(landingPage, /compatibility-grid/);
  assert.match(landingPage, /View setup guide/);
  assert.match(landingPage, /Get the Claude plugin/);
  assert.match(landingPage, /Browse plugins/);
  assert.match(landingPage, /View on npm/);
});

test('public landing page includes Plausible custom event tracking for all CTAs', () => {
  const landingPage = readLandingPage();

  // install_copy fires directly in copyInstall function
  assert.match(landingPage, /plausible\('install_copy'\)/);

  // trackClick wires up CTA events by selector and event name
  assert.match(landingPage, /trackClick\('.btn-pro', 'checkout_start'/);
  assert.match(landingPage, /trackClick\('.btn-free', 'install_click'/);
  assert.match(landingPage, /trackClick\('.nav-cta', 'checkout_start'/);
  assert.match(landingPage, /plausible\('faq_open'/);
  assert.match(landingPage, /plausible\('scroll_depth'/);
  assert.match(landingPage, /trackClick\('.proof-bar a', 'proof_bar_click'\)/);
  assert.match(landingPage, /trackClick\('.compat-card', 'compat_click'\)/);
  assert.match(landingPage, /trackClick\('.seo-card', 'seo_page_click'\)/);

  // Safety: typeof check before calling plausible
  assert.match(landingPage, /typeof plausible === 'function'/);

  // Scroll depth tracks 25%, 50%, 75%, 100%
  assert.match(landingPage, /scrollMarks/);
  assert.match(landingPage, /depth: mark \+ '%'/);
});

test('public landing page internally links to high-intent comparison and guide pages', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /id="compare-guides"/);
  assert.match(landingPage, /High-intent comparison and guide pages/i);
  assert.match(landingPage, /href="\/compare\/speclock"/);
  assert.match(landingPage, /href="\/compare\/mem0"/);
  assert.match(landingPage, /href="\/guides\/pre-action-gates"/);
  assert.match(landingPage, /href="\/guides\/claude-code-feedback"/);
  assert.match(landingPage, /GSD Pages/);
});
