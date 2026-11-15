'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

test('payment rails doc pins Stripe, PayPal, and Merchant of Record roles', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'PAYMENT_RAILS.md'), 'utf8');

  assert.match(doc, /Stripe primary/);
  assert.match(doc, /PayPal fallback/);
  assert.match(doc, /Digital Merchant of Record/);
  assert.match(doc, /service offers are retired/);
  assert.match(doc, /self-serve Pro checkout at `\/checkout\/pro`/);
  assert.match(doc, /\$97/);
  assert.match(doc, /\$1,000\/hour/);
  assert.match(doc, /\$24,000/);
  assert.match(doc, /evidence_incomplete/);
  assert.match(doc, /node scripts\/revenue-target-control\.js/);
  assert.match(doc, /do not create or distribute checkout links for them/);
});

test('workflow migration checklist routes payment through the intent gate', () => {
  const page = fs.readFileSync(
    path.join(ROOT, 'public', 'guides', 'ai-agent-workflow-migration-checklist.html'),
    'utf8',
  );

  assert.match(page, /self-serve Pro/);
  assert.match(page, /href="\/pricing"/);
  assert.doesNotMatch(page, /\$499|\/diagnostic|Setup Sprint/);
  assert.doesNotMatch(page, /optional-payment-link|CHECKOUT_URL|buy\.stripe\.com|paypal\.com/);
});
