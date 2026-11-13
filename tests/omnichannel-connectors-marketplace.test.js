'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SAAS_PORTFOLIO,
  OMNICHANNEL_CONNECTORS,
  getConnectorById,
  validateSaaSProfileCompliance,
} = require('../src/omnichannel-connectors-marketplace');

test('OMNICHANNEL_CONNECTORS covers Claude, Cursor, Gemini, ChatGPT, Grok, and Perplexity', () => {
  const ids = OMNICHANNEL_CONNECTORS.map((c) => c.id);
  assert.deepEqual(ids, ['claude', 'cursor', 'gemini', 'chatgpt', 'grok', 'perplexity']);

  for (const connector of OMNICHANNEL_CONNECTORS) {
    assert.equal(connector.remoteMcpUrl, 'https://thumbgate.ai/mcp');
    assert.ok(connector.cliInstallCommand.length > 5);
  }

  const claude = getConnectorById('claude');
  assert.match(claude.mobileInstructions, /Connections/);
  assert.equal( getConnectorById('gemini').iphoneBundleId, 'com.google.gemini');
  assert.equal(getConnectorById('chatgpt').openApiSchemaUrl, 'https://thumbgate.ai/openapi.json');
});

test('SAAS_PORTFOLIO highlights Dayglass, ThumbGate, and Mac YOLO Safeguards with zero real estate drift', () => {
  assert.deepEqual(
    SAAS_PORTFOLIO.map((p) => p.id),
    ['dayglass', 'thumbgate', 'mac_yolo_safeguards']
  );

  const bskyBio = [
    'AI Agent Infrastructure & macOS SaaS:',
    '• Dayglass (local macOS screen & meeting memory): https://dayglass.io',
    '• ThumbGate (<0.5ms PreToolUse firewall): https://thumbgate.ai',
    '• Mac YOLO Safeguards ($49): https://iganapolsky.gumroad.com/l/vcrho',
  ].join('\n');

  const check = validateSaaSProfileCompliance(bskyBio);
  assert.equal(check.compliant, true);
  assert.equal(check.hasRealEstate, false);

  const oldBio = 'FL tax-deed research — Broward · Palm Beach · Miami-Dade. Bird dog.';
  assert.equal(validateSaaSProfileCompliance(oldBio).compliant, false);
});
