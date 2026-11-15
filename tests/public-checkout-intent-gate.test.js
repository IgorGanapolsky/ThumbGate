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

test('retired diagnostic has no payment form and current plans preserve checkout confirmation', () => {
  const diagnostic = fs.readFileSync(path.join(PUBLIC_DIR, 'diagnostic.html'), 'utf8');
  const pricing = fs.readFileSync(path.join(PUBLIC_DIR, 'pricing.html'), 'utf8');
  const founders = fs.readFileSync(path.join(PUBLIC_DIR, 'founders.html'), 'utf8');
  const buyerIntent = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'buyer-intent.js'), 'utf8');
  assert.match(diagnostic, /offer has been retired/i);
  assert.match(diagnostic, /href="\/pricing"/);
  assert.doesNotMatch(diagnostic, /<form|diagnostic-pay/);
  assert.match(pricing, /href="\/checkout\/pro"/);
  assert.match(founders, /href="\/pricing"/);
  for (const source of [pricing, founders]) assert.doesNotMatch(source, /diagnostic-pay|sprint_diagnostic|\/checkout\/pro\?confirm=1/);
  assert.doesNotMatch(buyerIntent, /proHref[^;]+confirm\s*:\s*['"]1['"]/s);
});

test('public marketing forms never POST to the read-only pricing page', () => {
  const violations = [];
  for (const file of publicSourceFiles()) {
    const source = fs.readFileSync(file, 'utf8');
    for (const form of source.matchAll(/<form\b[^>]*>/gi)) {
      if (/action=["']\/pricing(?:[?#["']|$)/i.test(form[0]) && /method=["']post["']/i.test(form[0])) {
        violations.push(path.relative(PUBLIC_DIR, file));
      }
    }
  }
  assert.deepEqual(violations, []);
});

test('secondary acquisition pages offer actual self-serve Pro checkout without service delivery promises', () => {
  for (const name of ['founders.html', 'peter.html', 'operator-framework.html', 'blog/inside-your-boundary.html']) {
    const source = fs.readFileSync(path.join(PUBLIC_DIR, name), 'utf8');
    assert.match(source, /href="\/checkout\/pro"/, name);
    assert.doesNotMatch(source, /two business days|we install (?:and configure|the gate)|managed delivery|one configured (?:local|pre-action) gate|Buy the Pro enterprise gate/i, name);
  }
  const comparison = fs.readFileSync(path.join(PUBLIC_DIR, 'compare/agentix-labs.html'), 'utf8');
  assert.doesNotMatch(comparison, /fixed-price managed workflow gate|A configured local gate, a regression test|Get the managed workflow gate/);
});
