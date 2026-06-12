'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeInput, quarantineChunks, unsafeOutputGate, safetyCitationGate } = require('../prototypes/manufacturing-copilot/middleware/gates');
const { routeQuestion } = require('../prototypes/manufacturing-copilot/middleware/router');
const { retrieve } = require('../prototypes/manufacturing-copilot/backend/cloud');

test('manufacturing copilot sanitizes employee identifiers and email before model use', () => {
  const result = sanitizeInput('EMP-10482 jane.supervisor@acme.example needs spill instructions');

  assert.equal(result.status, 'sanitized');
  assert.match(result.sanitized, /\[EMPLOYEE_ID\]/);
  assert.match(result.sanitized, /\[EMAIL\]/);
  assert.doesNotMatch(result.sanitized, /EMP-10482/);
});

test('manufacturing copilot routes lockout and interlock questions to safety', async () => {
  const result = await routeQuestion('Can I bypass the interlock before lockout/tagout on the HP-400 press?');

  assert.equal(result.route, 'safety');
});

test('manufacturing copilot quarantines prompt injection embedded in retrieved maintenance docs', () => {
  const chunks = retrieve('maintenance', 'Can I bypass the HP-400 interlock?', 4);
  const result = quarantineChunks(chunks);

  assert.equal(result.status, 'block');
  assert.ok(result.quarantined.some((chunk) => chunk.hits.length > 0));
  assert.ok(result.clean.length > 0);
});

test('manufacturing copilot blocks unsafe generated answers and enforces safety citations', () => {
  const unsafe = unsafeOutputGate('Bypass the interlock and skip lockout to save time.');
  const missingCitation = safetyCitationGate('Never bypass the interlock.', 'safety');
  const cited = safetyCitationGate('Never bypass the interlock. Follow SP-110.', 'safety');

  assert.equal(unsafe.status, 'block');
  assert.equal(missingCitation.status, 'block');
  assert.equal(cited.status, 'pass');
});
