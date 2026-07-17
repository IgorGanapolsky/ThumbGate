'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

function publicSourceFiles(directory = PUBLIC_DIR) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) return publicSourceFiles(resolved);
    return /\.(?:html|js)$/i.test(entry.name) ? [resolved] : [];
  });
}

test('public sources cannot expose raw Stripe Payment Links or pre-confirmed checkout URLs', () => {
  const violations = [];
  for (const file of publicSourceFiles()) {
    const source = fs.readFileSync(file, 'utf8');
    if (/href=["'][^"']*(?:buy\.stripe\.com|paypal\.com\/ncp\/payment)/i.test(source)) {
      violations.push(`${path.relative(PUBLIC_DIR, file)}: raw external payment link`);
    }
    if (/href=["'][^"']*CHECKOUT_URL__/i.test(source)) {
      violations.push(`${path.relative(PUBLIC_DIR, file)}: runtime payment URL placeholder`);
    }
    if (/\/checkout\/pro\?[^"'\s>]*\bconfirm=(?:1|true)\b/i.test(source)) {
      violations.push(`${path.relative(PUBLIC_DIR, file)}: pre-confirmed Pro checkout URL`);
    }
  }
  assert.deepEqual(violations, [], violations.join('\n'));
});

test('public diagnostic and Pro paths require explicit intent surfaces', () => {
  const diagnostic = fs.readFileSync(path.join(PUBLIC_DIR, 'diagnostic.html'), 'utf8');
  const pricing = fs.readFileSync(path.join(PUBLIC_DIR, 'pricing.html'), 'utf8');
  const buyerIntent = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'buyer-intent.js'), 'utf8');

  assert.match(diagnostic, /action="\/go\/diagnostic-pay" method="POST"/);
  assert.match(diagnostic, /name="customer_email"[^>]*required/);
  assert.match(pricing, /href="\/diagnostic\?/);
  assert.doesNotMatch(pricing, /\/checkout\/pro\?confirm=1/);
  assert.doesNotMatch(buyerIntent, /proHref[^;]+confirm\s*:\s*['"]1['"]/s);
});
