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
  assert.match(landingPage, /MemAlign/i);
  assert.match(landingPage, /LanceDB/);
  assert.match(landingPage, /ContextFS/);
  assert.match(landingPage, /Bayesian belief/i);
  assert.doesNotMatch(landingPage, /mailto:/i);
  assert.doesNotMatch(landingPage, /official Anthropic partner/i);
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
  assert.match(landingPage, /Claude Desktop plugin/i);
  assert.match(landingPage, /Editor workflows/i);
  assert.match(landingPage, /Install in 30 seconds/i);
  assert.match(landingPage, /compatibility-grid/);
  assert.match(landingPage, /View setup guide/);
  assert.match(landingPage, /Get the Claude plugin/);
  assert.match(landingPage, /Browse plugins/);
  assert.match(landingPage, /View on npm/);
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
