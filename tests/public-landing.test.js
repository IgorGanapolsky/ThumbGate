const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const landingPagePath = path.join(__dirname, '..', 'public', 'index.html');

function readLandingPage() {
  return fs.readFileSync(landingPagePath, 'utf8');
}

test('public landing page includes SoftwareApplication JSON-LD with pricing offers', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /"@context": "https:\/\/schema\.org"/);
  assert.match(landingPage, /"@type": "SoftwareApplication"/);
  assert.match(landingPage, /"name": "ThumbGate"/);
  assert.match(landingPage, /"applicationCategory": "DeveloperApplication"/);
  assert.match(landingPage, /"price": "0"/);
  assert.match(landingPage, /"price": "49"/);
  assert.match(landingPage, /"priceCurrency": "USD"/);
});

test('public landing page has correct title and meta description', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /ThumbGate — Train Your AI Agent With/);
  assert.match(landingPage, /Pre-Action Gates for AI coding agents/);
  assert.match(landingPage, /mcp-memory-gateway/);
});

test('public landing page links to Stripe checkout and shows pricing tiers', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /buy\.stripe\.com/);
  assert.match(landingPage, /\$0/);
  assert.match(landingPage, /\$49/);
  assert.match(landingPage, /Free/);
  assert.match(landingPage, /Pro/);
  assert.match(landingPage, /One-time payment/);
});

test('public landing page includes Plausible analytics and template placeholders', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /plausible\.io\/js\/script\.js/);
  assert.match(landingPage, /__GA_BOOTSTRAP__/);
  assert.match(landingPage, /__GOOGLE_SITE_VERIFICATION_META__/);
});

test('public landing page does not contain removed old-page features', () => {
  const landingPage = readLandingPage();

  assert.doesNotMatch(landingPage, /__PRO_PRICE_DOLLARS__/);
  assert.doesNotMatch(landingPage, /serverVisitorId/);
  assert.doesNotMatch(landingPage, /"@type": "FAQPage"/);
  assert.doesNotMatch(landingPage, /"@type": "Organization"/);
  assert.doesNotMatch(landingPage, /buyer-feedback/);
  assert.doesNotMatch(landingPage, /Reliability Studio/i);
  assert.doesNotMatch(landingPage, /Workflow Hardening Fit Checker/i);
  assert.doesNotMatch(landingPage, /Reddit campaign banner/i);
  assert.doesNotMatch(landingPage, /id="campaign-banner"/);
  assert.doesNotMatch(landingPage, /crypto\.getRandomValues/);
});
