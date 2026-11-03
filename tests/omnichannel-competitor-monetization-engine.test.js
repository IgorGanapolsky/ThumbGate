'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LINKS,
  COMPETITOR_MATRIX_OCT_2026,
  buildChannelPayloads,
  runOmnichannelBlitz,
} = require('../scripts/omnichannel-competitor-monetization-engine');

test('omnichannel competitor monetization engine covers all 10 required channels with live Gumroad and Stripe links', () => {
  const payloads = buildChannelPayloads();
  const expectedChannels = [
    'gumroad',
    'tiktok',
    'instagram',
    'youtube',
    'threads',
    'x',
    'reddit',
    'zyvop',
    'medium',
    'skool',
  ];

  assert.deepEqual(Object.keys(payloads), expectedChannels);
  assert.equal(LINKS.gumroadPlaybook999, 'https://iganapolsky.gumroad.com/l/odrkon');
  assert.equal(LINKS.gumroadBundle49, 'https://iganapolsky.gumroad.com/l/vcrho');
  assert.equal(LINKS.stripeProDirect19, 'https://thumbgate.ai/go/pro-direct');
  assert.equal(LINKS.stripeDiagnostic499, 'https://thumbgate.ai/diagnostic');
  assert.ok(COMPETITOR_MATRIX_OCT_2026.length >= 5);

  const receipt = runOmnichannelBlitz();
  assert.equal(receipt.ok, true);
  assert.equal(receipt.channelCount, 10);
  assert.equal(receipt.writtenFilesCount, 20);
});
