const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const landingPagePath = path.join(__dirname, '..', 'public', 'index.html');

function readLandingPage() {
  return fs.readFileSync(landingPagePath, 'utf8');
}

test('public landing page keeps FAQPage JSON-LD parity for SEO and GEO', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /"@type": "SoftwareApplication"/);
  assert.match(landingPage, /"@type": "FAQPage"/);
  assert.match(landingPage, /Who should upgrade to Pro\?/);
});

test('public landing page uses the injected checkout fallback token', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /__CHECKOUT_FALLBACK_URL__\?utm_source=website&utm_medium=cta_button&utm_campaign=pro_pack/);
  assert.match(landingPage, /const fallbackBase = '__CHECKOUT_FALLBACK_URL__';/);
  assert.doesNotMatch(landingPage, /const fallbackBase = 'https:\/\/iganapolsky\.gumroad\.com\/l\/tjovof';/);
});

test('public landing page enriches fallback checkout links with first-party attribution fields', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /url\.searchParams\.set\('trace_id', checkoutTraceId\)/);
  assert.match(landingPage, /url\.searchParams\.set\('acquisition_id', getAcquisitionId\(\)\)/);
  assert.match(landingPage, /url\.searchParams\.set\('visitor_id', getVisitorId\(\)\)/);
  assert.match(landingPage, /url\.searchParams\.set\('session_id', getSessionId\(\)\)/);
  assert.match(landingPage, /url\.searchParams\.set\('landing_path', attribution\.landingPath\)/);
  assert.match(landingPage, /url\.searchParams\.set\('referrer_host', attribution\.referrerHost\)/);
  assert.match(landingPage, /sendTelemetry\('checkout_fallback_redirect'/);
});

test('public landing page includes buyer-loss capture wired to telemetry and Plausible', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /id="buyer-feedback"/);
  assert.match(landingPage, /data-loss-reason="too_expensive"/);
  assert.match(landingPage, /data-loss-reason="missing_trust"/);
  assert.match(landingPage, /id="buyer-feedback-submit"/);
  assert.match(landingPage, /sendTelemetry\('reason_not_buying'/);
  assert.match(landingPage, /window\.plausible\('Buyer Feedback Submitted'/);
});
