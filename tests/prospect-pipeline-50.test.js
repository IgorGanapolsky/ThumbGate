'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const {
  OFFER_DETAILS,
  PROSPECT_ACCOUNTS,
  getProspectsBySegment,
  summarizeProspectPipeline,
  exportAsJsonl,
} = require('../scripts/prospect-pipeline-50');

test('Prospect Pipeline — Contains exactly 50 qualified target accounts', () => {
  assert.equal(PROSPECT_ACCOUNTS.length, 50);
});

test('Prospect Pipeline — Distributes across 3 target buyer segments correctly', () => {
  const consultancies = getProspectsBySegment('consultancy');
  const platformEng = getProspectsBySegment('platform_eng');
  const aiProduct = getProspectsBySegment('ai_product');

  assert.equal(consultancies.length, 18);
  assert.equal(platformEng.length, 16);
  assert.equal(aiProduct.length, 16);
  assert.equal(consultancies.length + platformEng.length + aiProduct.length, 50);
});

test('Prospect Pipeline — Every account has required workflow owner and evidence fields', () => {
  const requiredKeys = [
    'id',
    'accountName',
    'segment',
    'domain',
    'workflowOwnerPersona',
    'budgetHolderPersona',
    'agentEnvironment',
    'repeatedFailureMode',
    'concreteEnforcementOffer',
    'firstTouchSubject',
    'firstTouchBody',
  ];

  for (const acc of PROSPECT_ACCOUNTS) {
    for (const key of requiredKeys) {
      assert.ok(acc[key], `Account ${acc.id} is missing field: ${key}`);
      assert.equal(typeof acc[key], 'string', `Account ${acc.id} field ${key} must be a string`);
    }
    assert.ok(acc.concreteEnforcementOffer.includes('$499 Setup Sprint'), `${acc.id} offer must be $499 Setup Sprint`);
    assert.ok(acc.firstTouchBody.includes('$499'), `${acc.id} first touch body must reference $499`);
    assert.ok(acc.domain.includes('.'), `${acc.id} domain must be valid`);
  }
});

test('Prospect Pipeline — Offer is the bounded $499 Setup Sprint with written proof', () => {
  assert.equal(OFFER_DETAILS.priceUsd, 499);
  assert.equal(OFFER_DETAILS.offerId, 'sprint_diagnostic');
  assert.equal(OFFER_DETAILS.checkoutUrl, 'https://thumbgate.ai/diagnostic');
  assert.ok(OFFER_DETAILS.deliverables.length >= 4);
  assert.ok(OFFER_DETAILS.refundGuarantee.includes('100% refund'));
});

test('Prospect Pipeline — Summarize and JSONL export produce valid data', () => {
  const summary = summarizeProspectPipeline();
  assert.equal(summary.totalAccounts, 50);
  assert.equal(summary.projectedPipelineValueUsd, 50 * 499);

  const jsonl = exportAsJsonl();
  const lines = jsonl.trim().split('\n');
  assert.equal(lines.length, 50);
  for (const line of lines) {
    const parsed = JSON.parse(line);
    assert.ok(parsed.id);
    assert.equal(parsed.offerPriceUsd, 499);
    assert.equal(parsed.stage, 'targeted');
  }
});

test('Prospect Pipeline — CLI flags execute cleanly (--json, --summary, --segment)', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'prospect-pipeline-50.js');

  const jsonOut = execFileSync(process.execPath, [scriptPath, '--json'], { encoding: 'utf8' });
  const parsedJson = JSON.parse(jsonOut);
  assert.equal(parsedJson.length, 50);

  const segmentOut = execFileSync(process.execPath, [scriptPath, '--json', '--segment=consultancy'], { encoding: 'utf8' });
  const parsedSegment = JSON.parse(segmentOut);
  assert.equal(parsedSegment.length, 18);

  const summaryOut = execFileSync(process.execPath, [scriptPath, '--summary'], { encoding: 'utf8' });
  const parsedSummary = JSON.parse(summaryOut);
  assert.equal(parsedSummary.totalAccounts, 50);
});
