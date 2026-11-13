'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const {
  INCEPTION_PROGRAM_DETAILS,
  THUMBGATE_COMPANY_PROFILE,
  CLOUD_CREDITS_OFFERS,
  NIM_NEMO_ENTERPRISE_OFFER,
  generateInceptionProfile,
  generateCloudCreditsChecklist,
  generateNimNeMoOffer,
  auditInceptionReadiness,
} = require('../scripts/nvidia-inception-portal');

test('NVIDIA Inception Portal — Program details and verified membership status', () => {
  assert.equal(INCEPTION_PROGRAM_DETAILS.status, 'ACCEPTED_MEMBER');
  assert.equal(INCEPTION_PROGRAM_DETAILS.programName, 'NVIDIA Inception');
  assert.equal(INCEPTION_PROGRAM_DETAILS.senderEmail, 'inceptionprogram@nvidia.com');
  assert.ok(INCEPTION_PROGRAM_DETAILS.portalUrl.includes('nvidia.com'));
  assert.ok(INCEPTION_PROGRAM_DETAILS.badgeMarkdown.includes('img.shields.io/badge/NVIDIA_Inception-Member-76b900'));
});

test('NVIDIA Inception Portal — Company and product profile structured for portal submission', () => {
  assert.equal(THUMBGATE_COMPANY_PROFILE.companyName, 'ThumbGate');
  assert.equal(THUMBGATE_COMPANY_PROFILE.website, 'https://thumbgate.ai');
  assert.ok(THUMBGATE_COMPANY_PROFILE.stage.includes('$499 Setup Sprint'));
  assert.ok(THUMBGATE_COMPANY_PROFILE.nvidiaTechnologiesUsed.some((t) => t.includes('NeMo Guardrails')));
  assert.ok(THUMBGATE_COMPANY_PROFILE.nvidiaTechnologiesUsed.some((t) => t.includes('NIM')));

  const profile = generateInceptionProfile();
  assert.equal(profile.portalSubmissionPayload.company_name, 'ThumbGate');
  assert.equal(profile.portalSubmissionPayload.primary_contact, 'igor@igorganapolsky.com');
  assert.ok(profile.portalSubmissionPayload.cloud_provider_interest.includes('AWS'));
  assert.ok(profile.portalSubmissionPayload.cloud_provider_interest.includes('GCP'));
});

test('NVIDIA Inception Portal — Cloud credits checklist aggregates >= $400,000 across 4 hyperscalers', () => {
  const credits = generateCloudCreditsChecklist();
  assert.ok(credits.summary.totalAvailableCreditsUsd >= 400000);
  assert.equal(credits.summary.providersCount, 4);
  assert.equal(credits.offers.length, 4);

  const providers = credits.offers.map((o) => o.provider);
  assert.ok(providers.some((p) => p.includes('AWS')));
  assert.ok(providers.some((p) => p.includes('Google Cloud')));
  assert.ok(providers.some((p) => p.includes('Microsoft Azure')));
  assert.ok(providers.some((p) => p.includes('Oracle Cloud')));

  assert.ok(credits.immediateActions.length >= 4);
});

test('NVIDIA Inception Portal — NIM & NeMo Guardrails $499 enterprise setup sprint offer', () => {
  const offer = generateNimNeMoOffer();
  assert.equal(offer.priceUsd, 499);
  assert.equal(offer.checkoutUrl, 'https://thumbgate.ai/diagnostic');
  assert.ok(offer.deliverables.some((d) => d.includes('PreToolUse')));
  assert.ok(offer.deliverables.some((d) => d.includes('Colang 2.0')));
  assert.ok(offer.deliverables.some((d) => d.includes('Spotify Confidence')));
});

test('NVIDIA Inception Portal — Readiness audit passes with all checks green', () => {
  const audit = auditInceptionReadiness();
  assert.equal(audit.status, 'PASS');
  assert.ok(audit.checks.length >= 4);
  for (const c of audit.checks) {
    assert.equal(c.ok, true, `Audit check failed: ${c.id}`);
  }
});

test('NVIDIA Inception Portal — CLI executes flags cleanly (--json, --profile, --credits, --offer)', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'nvidia-inception-portal.js');

  const jsonOut = execFileSync(process.execPath, [scriptPath, '--json'], { encoding: 'utf8' });
  const parsedAudit = JSON.parse(jsonOut);
  assert.equal(parsedAudit.status, 'PASS');

  const profOut = execFileSync(process.execPath, [scriptPath, '--profile'], { encoding: 'utf8' });
  const parsedProf = JSON.parse(profOut);
  assert.equal(parsedProf.company.companyName, 'ThumbGate');

  const credOut = execFileSync(process.execPath, [scriptPath, '--credits'], { encoding: 'utf8' });
  const parsedCred = JSON.parse(credOut);
  assert.ok(parsedCred.summary.totalAvailableCreditsUsd >= 400000);

  const offOut = execFileSync(process.execPath, [scriptPath, '--offer'], { encoding: 'utf8' });
  const parsedOff = JSON.parse(offOut);
  assert.equal(parsedOff.priceUsd, 499);
});
