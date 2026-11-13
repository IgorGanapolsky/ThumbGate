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

test('a second re-audit, an unranked finding, a write tool, or a comprehension side file is not a Goldfish review', () => {
  const base = {
    targetFile: 'docs/designs/checkout.md',
    authorSessionId: 'elephant-1',
    reviewerSessionId: 'goldfish-1',
    linkedFiles: ['scripts/billing.js'],
    findings: [{ rank: 'blocker' }],
    reviewerTools: ['read', 'grep', 'glob'],
    stages: STAGES,
  };
  const capped = buildGoldfishReviewPacket({ ...base, reauditCount: 2 });
  assert.equal(capped.goldfish, false);
  assert.ok(capped.reasons.includes('reaudit_cap_exceeded'));

  const unranked = buildGoldfishReviewPacket({ ...base, findings: [{ rank: 'note' }] });
  assert.equal(unranked.goldfish, false);
  assert.ok(unranked.reasons.includes('unranked_finding'));

  const writeTool = buildGoldfishReviewPacket({ ...base, reviewerTools: ['read', 'bash'] });
  assert.equal(writeTool.goldfish, false);
  assert.ok(writeTool.reasons.includes('reviewer_tools_not_read_only'));

  const skipped = buildGoldfishReviewPacket({ ...base, stages: ['critic', 'zoom_out'] });
  assert.equal(skipped.goldfish, false);
  assert.ok(skipped.reasons.includes('stages_out_of_order'));

  const sideFile = buildGoldfishReviewPacket({
    ...base,
    comprehensionFiles: ['docs/designs/checkout.md', 'scripts/billing.js'],
  });
  assert.equal(sideFile.goldfish, false);
  assert.ok(sideFile.reasons.includes('comprehension_must_read_target_only'));

  const once = buildGoldfishReviewPacket({ ...base, reauditCount: 1 });
  assert.equal(once.goldfish, true);
  assert.deepEqual(once.comprehensionFiles, ['docs/designs/checkout.md']);
  assert.deepEqual(once.contextFiles, ['docs/designs/checkout.md', 'scripts/billing.js']);
  assert.deepEqual(once.reviewerTools, ['read', 'grep', 'glob']);
});
