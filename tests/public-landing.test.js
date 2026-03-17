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
  assert.match(landingPage, /Can I pair it with editor continuity tools or resume assistants\?/);
  assert.match(landingPage, /Do I need subagents or an orchestration layer to get value\?/);
  assert.match(landingPage, /optional context inputs/i);
  assert.match(landingPage, /same agent session/i);
  assert.match(landingPage, /no orchestration|no subagent handoff/i);
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
  assert.match(landingPage, /url\.searchParams\.set\('community', attribution\.community\)/);
  assert.match(landingPage, /url\.searchParams\.set\('post_id', attribution\.postId\)/);
  assert.match(landingPage, /url\.searchParams\.set\('comment_id', attribution\.commentId\)/);
  assert.match(landingPage, /url\.searchParams\.set\('campaign_variant', attribution\.campaignVariant\)/);
  assert.match(landingPage, /url\.searchParams\.set\('offer_code', attribution\.offerCode\)/);
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

test('public landing page includes a Reddit campaign banner and subreddit-aware attribution logic', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /id="campaign-banner"/);
  assert.match(landingPage, /parseRedditCommunity/);
  assert.match(landingPage, /utmSource !== 'reddit'/);
  assert.match(landingPage, /Use code/);
});

test('public landing page positions the gateway as continuity-friendly reliability without orchestration tax', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /AI Agent Reliability Without Orchestration Tax/i);
  assert.match(landingPage, /Keep one sharp agent\./);
  assert.match(landingPage, /without introducing another orchestration layer or subagent handoff tax/i);
  assert.match(landingPage, /No orchestration tax/);
  assert.match(landingPage, /same agent session/i);
  assert.match(landingPage, /Reliability layer, not orchestration layer\./);
  assert.doesNotMatch(landingPage, /same control plane/i);
});
