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

test('hosted server routes /v1/trust-center and /v1/security-questionnaire/auto-answer respond correctly', async () => {
  process.env.THUMBGATE_API_KEY = 'test-api-key';
  const { startServer } = require('../src/api/server');
  const handle = await startServer({ port: 0, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${handle.port}`;

  try {
    // Test GET /v1/trust-center
    const tcRes = await fetch(`${baseUrl}/v1/trust-center`, {
      headers: { 'Authorization': 'Bearer test-api-key' },
    });
    assert.equal(tcRes.status, 200);
    const tcData = await tcRes.json();
    assert.equal(tcData.ok, true);
    assert.equal(tcData.trustCenter.organization, 'ThumbGate');

    // Test POST /v1/security-questionnaire/auto-answer
    const sqRes = await fetch(`${baseUrl}/v1/security-questionnaire/auto-answer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-api-key',
      },
      body: JSON.stringify({ questions: ['Do you train models on customer code?'] }),
    });
    assert.equal(sqRes.status, 200);
    const sqData = await sqRes.json();
    assert.equal(sqData.ok, true);
    assert.equal(sqData.count, 1);
    assert.equal(sqData.answers[0].matchedTopic, 'AI_MODEL_SAFETY_AND_TRAINING');

    // Test GET /v1/pentest/report
    const ptRes = await fetch(`${baseUrl}/v1/pentest/report`, {
      headers: { 'Authorization': 'Bearer test-api-key' },
    });
    assert.equal(ptRes.status, 200);
    const ptData = await ptRes.json();
    assert.equal(ptData.ok, true);
    assert.equal(ptData.report.standard, 'OneLeet-CAPR-v1');
  } finally {
    if (handle.server && typeof handle.server.close === 'function') {
      await new Promise((resolve) => handle.server.close(resolve));
    } else if (typeof handle.close === 'function') {
      await new Promise((resolve) => handle.close(resolve));
    }
  }
});
