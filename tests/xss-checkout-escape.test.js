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
  // The escaped form must be present in the prefilled_email value attribute.
  assert.match(html, /name="prefilled_email" value="[^"]*&lt;script&gt;/, 'email must be entity-encoded inside the value attribute');
  // A single-quote payload must also be neutralized.
  const html2 = renderCheckoutIntentPage(`x' onmouseover='alert(1)`);
  assert.ok(!html2.includes(`' onmouseover='`), 'single-quote breakout must not survive');
});
