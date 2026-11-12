'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildGoldfishReviewPacket, STAGES, MAX_REAUDITS } = require('../scripts/egm-goldfish-packet');

test('a fresh reviewer packet excludes host instructions and lesson logs', () => {
  const packet = buildGoldfishReviewPacket({
    targetFile: 'docs/designs/checkout.md',
    authorSessionId: 'elephant-1',
    reviewerSessionId: 'goldfish-1',
    linkedFiles: ['scripts/billing.js'],
  });
  assert.equal(packet.goldfish, true);
  assert.deepEqual(packet.stages, STAGES);
  assert.equal(packet.maxReaudits, MAX_REAUDITS);
  assert.equal(packet.comprehensionReadsTargetOnly, true);
  assert.deepEqual(packet.contextFiles, ['docs/designs/checkout.md', 'scripts/billing.js']);
});

test('a same-session self-grade or leaked host file is not a Goldfish review', () => {
  const sameSession = buildGoldfishReviewPacket({
    targetFile: 'docs/designs/checkout.md',
    authorSessionId: 'elephant-1',
    reviewerSessionId: 'elephant-1',
  });
  assert.equal(sameSession.goldfish, false);
  assert.ok(sameSession.reasons.includes('same_session_is_not_a_goldfish_review'));

  const leaked = buildGoldfishReviewPacket({
    targetFile: 'docs/designs/checkout.md',
    authorSessionId: 'elephant-1',
    reviewerSessionId: 'goldfish-1',
    linkedFiles: ['AGENTS.md', 'memory-log.jsonl'],
  });
  assert.equal(leaked.goldfish, false);
  assert.deepEqual(leaked.contextFiles, []);
  assert.ok(leaked.reasons.includes('host_instructions_or_lessons_leaked_into_goldfish_context'));
});
