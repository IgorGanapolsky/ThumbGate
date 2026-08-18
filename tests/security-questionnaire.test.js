'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getSecurityQuestionnaire,
  renderSecurityOverviewHtml,
  toMarkdown,
} = require('../src/security-questionnaire');

test('questionnaire refuses certification theater', () => {
  const pack = getSecurityQuestionnaire();
  assert.equal(pack.certification, false);
  assert.ok(pack.items.length >= 12);
  const soc2 = pack.items.find((item) => item.id === 'soc2');
  assert.match(soc2.answer, /No\./);
  assert.doesNotMatch(soc2.answer, /Type II certified|we are SOC 2/i);
});

test('questionnaire covers GPC, subprocessors, and receipts', () => {
  const pack = getSecurityQuestionnaire();
  const ids = pack.items.map((item) => item.id);
  for (const id of ['gpc', 'subprocessors', 'audit', 'vuln', 'source-code']) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
  assert.match(pack.items.find((item) => item.id === 'gpc').answer, /Sec-GPC/);
  assert.match(pack.items.find((item) => item.id === 'subprocessors').answer, /Stripe/);
  assert.match(pack.items.find((item) => item.id === 'audit').answer, /broker-execution-receipt/);
});

test('HTML overview keeps counsel sentinels and publishes the questionnaire', () => {
  const html = renderSecurityOverviewHtml();
  assert.match(html, /Security overview/i);
  assert.match(html, /72 hours/);
  assert.match(html, /Vulnerability disclosure/i);
  assert.match(html, /not a SOC 2 report/i);
  assert.match(html, /security@thumbgate\.ai/i);
  assert.match(html, /Vendor questionnaire/);
  assert.match(html, /\/security\.json/);
  assert.match(html, /FAQPage/);
  assert.match(html, /Your Privacy Choices/);
  assert.doesNotMatch(html, /<script[^>]+src=/i);
});

test('markdown export is pasteable and refuses SOC 2 attestation', () => {
  const md = toMarkdown();
  assert.match(md, /# ThumbGate security questionnaire/);
  assert.match(md, /not a SOC 2 report/);
  assert.match(md, /Do you have SOC 2/);
});
