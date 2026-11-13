'use strict';

/**
 * xss-checkout-escape.test.js
 *
 * Regression for CodeQL js/reflected-xss #252: the `?email=` search param was
 * reflected into the checkout page's value="..." attribute via
 * escapeHtmlAttribute(), which escaped & " < > but NOT single quotes or
 * backticks — leaving it context-fragile and unrecognized as a sanitizer.
 * escapeHtmlAttribute is now a complete HTML-entity encoder.
 */

const { test } = require('node:test');
const assert = require('node:assert');

const { escapeHtmlAttribute, renderCheckoutIntentPage } = require('../src/api/server.js').__test__;

test('escapeHtmlAttribute escapes all attribute-breaking characters (& " \' ` < >)', () => {
  const raw = `a&b"c'd\`e<f>g`;
  const out = escapeHtmlAttribute(raw);
  assert.ok(!out.includes('"'), 'double quote must be escaped');
  assert.ok(!out.includes("'"), 'single quote must be escaped');
  assert.ok(!out.includes('`'), 'backtick must be escaped');
  assert.ok(!out.includes('<'), '< must be escaped');
  assert.ok(!out.includes('>'), '> must be escaped');
  assert.equal(out, 'a&amp;b&quot;c&#39;d&#96;e&lt;f&gt;g');
});

test('escapeHtmlAttribute escapes ALL occurrences (global), not just the first', () => {
  assert.equal(escapeHtmlAttribute('"a"b"'), '&quot;a&quot;b&quot;');
  assert.equal(escapeHtmlAttribute("'x'y'"), '&#39;x&#39;y&#39;');
});

test('checkout page does not reflect a malicious email as executable markup', () => {
  const attack = `"><script>alert(document.cookie)</script><input value='`;
  const html = renderCheckoutIntentPage(attack);
  // The raw attack sequence must never appear verbatim in the output.
  assert.ok(!html.includes('<script>alert(document.cookie)</script>'), 'script tag must not survive');
  assert.ok(!html.includes(`"><script`), 'attribute breakout sequence must not survive');
  // The escaped form must be present in the buyer-email value attribute.
  assert.match(html, /name="customer_email" value="[^"]*&lt;script&gt;/, 'email must be entity-encoded inside the value attribute');
  // A single-quote payload must also be neutralized.
  const html2 = renderCheckoutIntentPage(`x' onmouseover='alert(1)`);
  assert.ok(!html2.includes(`' onmouseover='`), 'single-quote breakout must not survive');
});

test('checkout page Pro copy stays truthful about personal vs Enterprise features', () => {
  const html = renderCheckoutIntentPage('buyer@example.com');
  assert.match(html, /Pro<\/strong> removes solo caps and adds personal recall, proof, exports, and adapter maintenance/);
  assert.match(html, /Personal dashboard: gate stats, rule evidence, DPO export/);
  assert.match(html, /Enterprise service work is qualified after intake; hosted team sync and a hosted org dashboard are not generally available/);
  assert.doesNotMatch(html, /Lessons synced across all your machines/i);
  assert.doesNotMatch(html, /Hosted dashboard: gate stats, DPO export, org-wide rule library/i);
});

test('renderCheckoutIntentPage embeds server-resolved identity defaults and dwell telemetry safely', () => {
  const html = renderCheckoutIntentPage('buyer@example.com', null, {
    traceId: 'trace_checkout_42',
    analyticsMetadata: {
      visitorId: 'visitor_checkout_42',
      sessionId: 'session_checkout_42',
      acquisitionId: 'acq_checkout_42',
    },
  });
  assert.match(html, /"traceId":"trace_checkout_42"/);
  assert.match(html, /"visitorId":"visitor_checkout_42"/);
  assert.match(html, /"sessionId":"session_checkout_42"/);
  assert.match(html, /"acquisitionId":"acq_checkout_42"/);
  assert.match(html, /engagementMs:\s*engagementMs/);
  assert.match(html, /dwellBucket:\s*resolveDwellBucket\(engagementMs\)/);
});

test('renderCheckoutIntentPage preserves incoming LinkedIn carousel UTM, creator, and campaign_variant on direct Stripe and Annual CTAs', () => {
  const parsed = new URL(
    'https://thumbgate.ai/checkout/pro?utm_source=linkedin&utm_medium=carousel&utm_campaign=viral_agent_firewall&creator=iganapolsky&campaign_variant=ab_direct_stripe_19',
  );
  const html = renderCheckoutIntentPage('', parsed, { includeHiddenAttribution: true });
  assert.match(html, /href="\/go\/pro-direct\?[^"]*utm_source=linkedin/);
  assert.match(html, /href="\/go\/pro-direct\?[^"]*utm_medium=carousel/);
  assert.match(html, /href="\/go\/pro-direct\?[^"]*utm_campaign=viral_agent_firewall/);
  assert.match(html, /href="\/go\/pro-direct\?[^"]*creator=iganapolsky/);
  assert.match(html, /href="\/go\/pro-direct\?[^"]*campaign_variant=ab_direct_stripe_19/);
  assert.match(html, /href="\/go\/pro-annual\?[^"]*creator=iganapolsky/);
  assert.match(html, /href="\/go\/pro-annual\?[^"]*campaign_variant=ab_direct_stripe_19/);
});
