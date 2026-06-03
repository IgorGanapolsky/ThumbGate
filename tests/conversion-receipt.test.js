'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCaptureReceipt,
  buildStatsReceipt,
  trackedProUrl,
} = require('../scripts/commercial-offer');

test('trackedProUrl adds CLI conversion attribution without losing the canonical route', () => {
  const url = new URL(trackedProUrl('cli_test', 'receipt_test'));
  assert.equal(url.hostname, 'thumbgate.ai');
  assert.equal(url.pathname, '/go/pro');
  assert.equal(url.searchParams.get('utm_source'), 'cli_test');
  assert.equal(url.searchParams.get('utm_medium'), 'cli');
  assert.equal(url.searchParams.get('utm_campaign'), 'pro_conversion');
  assert.equal(url.searchParams.get('utm_content'), 'receipt_test');
});

test('buildCaptureReceipt turns a saved thumbs signal into a paid-intent next step', () => {
  const receipt = buildCaptureReceipt({
    signal: 'down',
    feedbackId: 'fb_123',
    memoryId: 'mem_456',
    actionType: 'block',
  });

  assert.match(receipt, /Value receipt/);
  assert.match(receipt, /Stored proof\s*:\s*DOWN feedback \(fb_123\)/);
  assert.match(receipt, /Local memory\s*:\s*mem_456/);
  assert.match(receipt, /npx thumbgate stats/);
  assert.match(receipt, /npx thumbgate cost/);
  assert.match(receipt, /utm_source=cli_capture_receipt/);
  assert.match(receipt, /utm_campaign=pro_conversion/);
});

test('buildStatsReceipt stays quiet when there is no proof or failure pressure', () => {
  assert.equal(buildStatsReceipt({ negatives: 0, gatesBlocked: 0, gatesWarned: 0, totalGates: 0 }), '');
});

test('buildStatsReceipt routes proven friction to Pro and Team surfaces', () => {
  const receipt = buildStatsReceipt({
    negatives: 3,
    gatesBlocked: 8,
    gatesWarned: 2,
    totalGates: 5,
    autoPromotedGates: 2,
  });

  assert.match(receipt, /Paid-intent next step/);
  assert.match(receipt, /10 gate interventions/);
  assert.match(receipt, /5 gates \(2 auto-promoted\)/);
  assert.match(receipt, /3 negative signals/);
  assert.match(receipt, /npx thumbgate cost/);
  assert.match(receipt, /utm_source=cli_stats_receipt/);
});
