'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  autoAnswerSecurityQuestionnaire,
  buildTrustCenterData,
} = require('../scripts/security-questionnaire-responder');

test('security questionnaire responder answers standard compliance inquiries with citations', () => {
  const sampleQuestions = [
    'How do you enforce access control and least privilege for agents?',
    'Is customer data encrypted in transit using TLS?',
    'Do you train AI models on customer code?',
    'What subprocessors do you use?',
  ];

  const answers = autoAnswerSecurityQuestionnaire(sampleQuestions);
  assert.equal(answers.length, 4);

  assert.equal(answers[0].matchedTopic, 'ACCESS_CONTROL');
  assert.ok(answers[0].codeCitation);
  assert.ok(answers[0].evidenceHash.startsWith('sha256:'));

  assert.equal(answers[1].matchedTopic, 'ENCRYPTION_AND_TRANSIT');
  assert.equal(answers[2].matchedTopic, 'AI_MODEL_SAFETY_AND_TRAINING');
  assert.equal(answers[3].matchedTopic, 'SUBPROCESSORS_AND_SUPPLY_CHAIN');
});

test('buildTrustCenterData produces verifiable trust center with digest', () => {
  const trustCenter = buildTrustCenterData();
  assert.equal(trustCenter.organization, 'ThumbGate');
  assert.ok(trustCenter.trustCenterDigest.startsWith('sha256:'));
  assert.ok(trustCenter.continuousPentest.certificateSignature);
  assert.ok(trustCenter.verifiedControls.length >= 7);
});
