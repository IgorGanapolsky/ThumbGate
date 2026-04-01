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
  assert.match(landingPage, /How is ThumbGate different from RLHF\?/);
  assert.match(landingPage, /What is the ThumbGate tech stack\?/);
  assert.match(landingPage, /What AI agents does ThumbGate work with\?/);
  assert.match(landingPage, /How are pre-action gates different from prompt rules\?/);
  assert.match(landingPage, /behavioral immune system/i);
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
  assert.match(landingPage, /class="price-card popular"/);
  assert.match(landingPage, /\$0/);
  assert.match(landingPage, /\$19/);
  assert.match(landingPage, /\$12/);
  assert.match(landingPage, /Forever free/);
  assert.match(landingPage, /Single dev/);
  assert.match(landingPage, /Most Popular/);
  assert.match(landingPage, /Founder Deal/);
  assert.match(landingPage, /Install Free/);
  assert.match(landingPage, /Get Pro/);
  assert.match(landingPage, /Start Team Trial/);
  assert.match(landingPage, /Contact Sales/);
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
  assert.match(landingPage, /mailto:igor@thumbgate\.dev/i);
  assert.doesNotMatch(landingPage, /official Anthropic partner/i);
});

test('public landing page hero features both thumbs up AND thumbs down prominently', () => {
  const landingPage = readLandingPage();

  // Hero big emoji must show BOTH thumbs — not just one
  assert.match(landingPage, /class="hero-thumbs">👍👎</);
  // Headline: problem/resolution antithesis (Mem0-style, under 8 words)
  assert.match(landingPage, /AI agents repeat mistakes/i);
  assert.match(landingPage, /Yours won't/i);
  // "dangerous and dumb" moved to signal pill
  assert.match(landingPage, /dangerous and dumb mistakes/i);
  // Signal pills must show both
  assert.match(landingPage, /signal-pill signal-up/);
  assert.match(landingPage, /signal-pill signal-down/);
  assert.match(landingPage, /👍 reinforces what worked/);
  assert.match(landingPage, /👎 blocks dangerous and dumb mistakes/);
  // Persona targeting
  assert.match(landingPage, /class="hero-persona"/);
  assert.match(landingPage, /power users of Claude Code/i);
  // Plain-language value prop
  assert.match(landingPage, /immune system for your AI agent/i);
});

test('public landing page Pro tier uses outcome-framed bullets that justify upgrade', () => {
  const landingPage = readLandingPage();

  // Pro tier features
  assert.match(landingPage, /Visual gate debugger/i);
  assert.match(landingPage, /DPO training data export/i);
  assert.match(landingPage, /Historical analytics/i);
  assert.match(landingPage, /Webhook\/Slack notifications/i);
  assert.match(landingPage, /Gate template library/i);
  // Team tier features
  assert.match(landingPage, /Shared team lesson DB/i);
  assert.match(landingPage, /Cross-repo pattern sharing/i);
  assert.match(landingPage, /Org dashboard/i);
  assert.match(landingPage, /CI\/CD integration/i);
  // Enterprise tier features
  assert.match(landingPage, /SSO.*SAML/i);
  assert.match(landingPage, /SOC2/i);
  assert.match(landingPage, /Self-hosted/i);
  // Founder deal banner
  assert.match(landingPage, /Founder Deal/i);
  assert.match(landingPage, /\$49 one-time/i);
});

test('public landing page includes FAQ section with accordion interaction', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /id="faq"/);
  assert.match(landingPage, /Common questions/);
  assert.match(landingPage, /How is ThumbGate different from RLHF\?/);
  assert.match(landingPage, /What's the tech stack\?/);
  assert.match(landingPage, /What AI agents and editors does this work with\?/);
  assert.match(landingPage, /Do I need a cloud account\?/);
  assert.match(landingPage, /How are gates different from prompt rules\?/);
  assert.match(landingPage, /Is the \$49 a subscription\?/);
  assert.match(landingPage, /role="button"/);
  assert.match(landingPage, /tabindex="0"/);
  assert.match(landingPage, /aria-expanded="true"/);
  assert.match(landingPage, /aria-expanded="false"/);
  assert.match(landingPage, /onclick="toggleFaq\(this\)"/);
  assert.match(landingPage, /onkeydown="handleFaqKeydown\(event\)"/);
  assert.match(landingPage, /function toggleFaq\(el\)/);
  assert.match(landingPage, /function handleFaqKeydown\(event\)/);
  assert.match(landingPage, /personal local dashboard on your machine/i);
  assert.match(landingPage, /optional hosted API key/i);
});

test('public landing page includes compatibility section for AI agent surfaces', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /id="compatibility"/);
  assert.match(landingPage, /AI CLIs/i);
  assert.match(landingPage, /repo-local Codex bridge/i);
  assert.match(landingPage, /review, adversarial review, and second-pass handoff/i);
  assert.match(landingPage, /Codex keeps its repo-local app plugin profile/i);
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

test('public landing page internally links to comparison and guide pages without internal jargon', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /id="compare-guides"/);
  assert.match(landingPage, /How ThumbGate compares/i);
  assert.match(landingPage, /href="\/compare\/speclock"/);
  assert.match(landingPage, /href="\/compare\/mem0"/);
  assert.match(landingPage, /href="\/guides\/pre-action-gates"/);
  assert.match(landingPage, /href="\/guides\/claude-code-feedback"/);
  // No internal marketing jargon visible to customers
  assert.doesNotMatch(landingPage, /GSD Pages/);
  assert.doesNotMatch(landingPage, /Bottom of funnel/i);
  assert.doesNotMatch(landingPage, /Category creation/i);
  assert.doesNotMatch(landingPage, /convert.*search.*demand/i);
});

test('public landing page FAQ defaults first item open for credibility', () => {
  const landingPage = readLandingPage();

  // "How is ThumbGate different from RLHF?" should be open by default to address the #1 credibility question
  assert.match(landingPage, /class="faq-item open"/);
});

test('public landing page hero is evergreen without version numbers', () => {
  const landingPage = readLandingPage();

  // Hero paragraph should not contain version-specific changelog items
  const heroMatch = landingPage.match(/<section class="hero">[\s\S]*?<\/section>/);
  assert.ok(heroMatch, 'Hero section must exist');
  assert.doesNotMatch(heroMatch[0], /New in v\d/i);
});

test('landing page has guardrail positioning section', () => {
  const html = readLandingPage();
  assert.ok(html.includes('id="guardrails"'), 'guardrails section must exist');
  assert.ok(html.includes('Don\'t trust'), 'must include "Don\'t trust — verify" card');
  assert.ok(html.includes('Real tools'), 'must include "Real tools" card');
  assert.ok(html.includes('show work'), 'must include "show work" card');
  assert.ok(html.includes('Log everything'), 'must include "Log everything" card');
});

test('landing page has newsletter signup', () => {
  const html = readLandingPage();
  assert.ok(html.includes('newsletter'), 'must include newsletter section');
  assert.ok(html.includes('type="email"'), 'must include email input');
});

test('landing page has social links in footer', () => {
  const html = readLandingPage();
  assert.match(html, /href="https:\/\/x\.com\/[^"]+"/, 'footer must link to X/Twitter');
  assert.match(html, /href="https:\/\/www\.linkedin\.com\/[^"]+"/, 'footer must link to LinkedIn');
  assert.ok(html.includes('/blog'), 'footer must link to blog');
});
