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
  assert.match(doc, /\$499/);
  assert.match(doc, /\$1500/);
  assert.match(doc, /\$97/);
  assert.match(doc, /Pay by Stripe or PayPal, whichever is easier/);
});

test('workflow migration checklist hides optional payment links until configured', () => {
  const page = fs.readFileSync(
    path.join(ROOT, 'public', 'guides', 'ai-agent-workflow-migration-checklist.html'),
    'utf8',
  );

  assert.match(page, /Pay \$499 diagnostic/);
  assert.match(page, /Pay \$499 diagnostic with PayPal/);
  assert.match(page, /Buy \$__SNAPSHOT_PRICE_DOLLARS__ snapshot via __MOR_PROVIDER__/);
  assert.match(page, /optional-payment-link/);
  assert.match(page, /href\.indexOf\('__'\)/);
});
